# ERP Order Lifecycle

This document traces the full lifecycle of an order through the Powerstik ERP system, from sales order creation to invoicing.

```
Sales Order -> Artwork -> Approvals -> Work Order -> Production -> Packing -> Dispatch -> Invoice
```

---

## 1. Sales Order Creation

### SO Number Generation

SO numbers are generated using a prefix + financial year (FY) counter system.

```sql
create table public.so_counters (
  fy     text not null,      -- e.g. '2425' for FY 2024-25
  prefix text not null,      -- e.g. 'SL', 'SLF', 'SLC'
  last_no integer default 0, -- Auto-incrementing counter
  primary key (fy, prefix)
);
```

The format is `{prefix}{sequence}/{fy}`, for example: `SL001/2425`, `SLF042/2425`.

Common prefixes:
- **SL** -- Standard sales orders (eligible for WO creation)
- **SLF** -- Flexo-specific orders
- **SLC** -- Service/consumable orders

### Data Written

On creation, three inserts occur:
1. `sales_orders` -- Header record (SO number, client, dates, totals)
2. `sales_order_lines` -- One row per line item (product, qty, rate, GST, approval statuses)
3. `artworks` -- One artwork record auto-created per SO line (see next section)

The `idempotency_keys` table records the submission key to prevent duplicates.

---

## 2. Artwork Assignment

### Auto-Creation from SO Lines

When a sales order is saved, the system automatically creates one artwork record per SO line via `createArtworksFromSoLines()`.

### Artwork Number Sequence

```sql
create table public.artwork_sequences (
  prefix  text not null,     -- e.g. 'ART'
  last_no bigint default 0   -- Auto-incrementing counter
);
```

Each artwork record stores production specifications:

| Field              | Purpose                                      |
|--------------------|----------------------------------------------|
| `artwork_no`       | Unique artwork identifier                    |
| `product_type`     | Offset, Flexo, Corrugated, Digital           |
| `plate_status`     | PENDING / ORDERED / RECEIVED                 |
| `die_status`       | PENDING / ORDERED / RECEIVED                 |
| `sheet_length/width` | Sheet dimensions in mm                     |
| `sheet_ups`        | Number of impressions per sheet              |
| `across_ups / along_ups / total_ups` | Layout configuration    |
| `printing_colors`  | Color specification                          |
| `plate_size / plate_count` | Plate requirements                    |
| `die_count`        | Die requirements                             |
| `status`           | PENDING / APPROVED / REJECTED                |

### Artwork Working Screen

The `v_artwork_jobs` view joins artworks with SO and client data to power the artwork department's working screen, showing all artwork tasks with their current status.

---

## 3. Approval Workflow

SO lines require three independent approvals before they are eligible for work order creation.

### Approval Fields on sales_order_lines

| Field              | Values                        | Approver Role               |
|--------------------|-------------------------------|-----------------------------|
| `accounts_status`  | PENDING / APPROVED / REJECTED | Users with `can_approve_accounts` |
| `business_status`  | PENDING / APPROVED / REJECTED | Users with `can_approve_business` |

### Artwork Status

| Field    | Values                        | Set By                     |
|----------|-------------------------------|----------------------------|
| `status` | PENDING / APPROVED / REJECTED | Artwork department          |

### Approval Visibility

The `v_sales_order_lines_for_approval` view surfaces lines pending approval, and the rollup cache (`sales_order_rollup_cache`) aggregates line-level approval statuses to the SO header level for dashboard display.

---

## 4. Work Order Candidate Selection

The `v_workorder_candidates` view determines which SO lines are eligible for WO creation.

### Eligibility Criteria

A line appears as a WO candidate only when ALL of these conditions are met:

1. **Artwork APPROVED** -- `artworks.status = 'APPROVED'`
2. **Accounts APPROVED** -- `sales_order_lines.accounts_status = 'APPROVED'`
3. **Business APPROVED** -- `sales_order_lines.business_status = 'APPROVED'`
4. **SO not cancelled** -- `sales_orders.status <> 'CANCELLED'`
5. **Not a service item** -- Product code is not `SLC001` (Flexo Printing Plate), `SLC002` (Offset Printing Plate), or `SLC003` (Die)
6. **Remaining quantity > 0** -- `qty - processed_qty > 0` (partial WOs are allowed, so only the unprocessed balance is shown)

### Computed Fields in the View

```sql
-- Remaining qty available for WO
GREATEST(sol.qty - COALESCE(wt.processed_qty, 0), 0) as remaining_qty

-- Approval stage display
CASE
  WHEN rejected_stage_list <> '' THEN 'Rejected at ' || rejected_stage_list
  WHEN pending_stage_list <> ''  THEN 'Pending at ' || pending_stage_list
  ELSE 'Approved'
END as approval_stage

-- Boolean: all 3 approvals passed, no rejections
rejected_stage_list = '' AND pending_stage_list = '' as can_create_wo
```

### Department Categorization

The view also classifies each line into a department category based on product type or SO line category:

| Pattern Match  | Department Category |
|----------------|---------------------|
| `%FLEXO%`      | FLEXO               |
| `%CORR%`       | CORRUGATION         |
| `%DIGITAL%`    | DIGITAL             |
| `%OFFSET%`     | OFFSET              |

---

## 5. Work Order Creation

### Two WO Types

| Type    | WO Number Prefix | Description                              |
|---------|-------------------|------------------------------------------|
| Offset  | `WOW`             | Offset printing work orders              |
| Flexo   | `FLEXOWO`         | Flexo printing work orders               |

### WO Number Sequence

```sql
create table public.wo_sequence (
  id      uuid not null default gen_random_uuid(),
  last_no integer default 0
);
```

### snapshot_json

When a work order is created, the current state of all associated SO lines is captured in a `snapshot_json` field on the `work_orders` table:

```sql
create table public.work_orders (
  id            uuid not null default gen_random_uuid(),
  wo_number     text not null,       -- Unique, e.g. 'WOW-0042'
  wo_date       date,
  status        text,
  created_by    text,
  snapshot_json jsonb                -- Immutable snapshot of SO data at WO creation
);
```

The snapshot captures product details, quantities, artwork specs, and client information as they existed at the moment of WO creation. This ensures that subsequent edits to the SO do not retroactively change what was planned for production.

### Related Tables

On WO creation, three child tables are populated:

| Table                  | Purpose                                             |
|------------------------|-----------------------------------------------------|
| `work_order_jobs`      | SO lines assigned to this WO (product, qty, artwork)|
| `work_order_materials` | Raw materials required (paper GSM, deckle, cut size)|
| `work_order_routing`   | Process routing steps (department, machine, sequence)|

### work_order_routing Structure

```sql
create table public.work_order_routing (
  wo_id          uuid,
  so_number      text,
  line_no        text,
  process_name   text,        -- e.g. 'PRINTING', 'LAMINATION', 'DIE_CUT'
  sequence_no    integer,     -- Execution order
  department     text,
  planned_machine text,
  planned_qty    numeric default 0,
  completed_qty  numeric default 0,
  status         text default 'PENDING'
);
```

---

## 6. Production Entry

Production entries log actual machine-level output against routing steps.

### Two Entry Models

**Batch entry** (`production_entries`): Post-facto recording of completed production.

```sql
create table public.production_entries (
  wo_id           uuid,
  routing_id      uuid,        -- FK to work_order_routing
  entry_datetime  timestamp with time zone,
  machine         text,
  operator_name   text,
  produced_qty    numeric,
  rejected_qty    numeric,
  ok_qty          numeric,     -- produced_qty - rejected_qty
  downtime_reason text,
  so_number       text,
  line_no         text
);
```

**Live entry** (`production_live_entries`): Real-time tracking with start/end timestamps and status transitions.

```sql
-- Status flow: RUNNING -> COMPLETED | STOPPED | HOLD
create table public.production_live_entries (
  wo_id           uuid,
  routing_id      uuid,
  job_card_no     text,
  machine         text,
  status          text default 'RUNNING',   -- RUNNING, COMPLETED, STOPPED, HOLD
  start_at        timestamp with time zone,
  end_at          timestamp with time zone,
  produced_qty    numeric(14,2),
  rejected_qty    numeric(14,2),
  ok_qty          numeric(14,2),
  downtime_minutes numeric(14,2)
);
```

Production entries update the `completed_qty` on the corresponding `work_order_routing` record, enabling progress tracking per process step.

---

## 7. Packing Records

After production, finished goods are packed and marked ready for dispatch.

### One Record Per SO Line

```sql
create table public.packing_records (
  so_id              uuid,
  so_line_id         uuid,       -- Unique index enforces one record per SO line
  so_number          text,
  line_no            integer,
  order_qty          numeric,
  produced_qty       numeric,
  packed_qty         numeric default 0,
  ready_to_dispatch  boolean default false,
  packed_by          text,
  packed_at          timestamp
);
```

The unique index on `so_line_id` ensures exactly one packing record exists per SO line. The `ready_to_dispatch` flag signals to the dispatch team that the goods are available.

---

## 8. Dispatch Records

Dispatch records track the physical shipment of goods. Unlike packing (one record per SO line), multiple dispatch records can exist per SO line for partial shipments.

```sql
create table public.dispatch_records (
  dispatch_no   text,         -- Sequential dispatch number
  so_id         uuid,
  so_line_id    uuid,
  so_number     text,
  line_no       integer,
  packed_qty    numeric,      -- Reference qty from packing
  dispatch_qty  numeric,      -- Qty actually dispatched
  transporter   text,
  lr_no         text,         -- Lorry receipt number
  vehicle_no    text,
  dispatch_date date,
  status        text default 'DISPATCHED'
);
```

Dispatch numbers are sequenced via the `dispatch_sequence` table.

The `v_dispatch_board` and `v_dispatch_queue_fast` views power the dispatch dashboard, showing what is ready and what has been shipped.

---

## 9. Invoice / Challan Generation

### Invoice Lifecycle

```
DRAFT -> POSTED -> (immutable)
              \-> CANCELLED
```

Invoices start as `DRAFT` during preparation. Once finalized, they are marked `POSTED`, which locks all associated invoice lines via the `trg_lock_invoice_lines` trigger (prevents UPDATE or DELETE on `invoice_lines` for posted invoices).

### Invoice Structure

```sql
create table public.invoices (
  invoice_no     text,           -- Unique, sequenced per FY + prefix
  client_code    text,
  invoice_date   date,
  status         text,           -- DRAFT, POSTED, CANCELLED
  billing_mode   text,           -- dispatch, fg, direct
  document_type  text default 'INVOICE',  -- INVOICE or CHALLAN
  -- Bill-to / Ship-to party details (denormalized from client_parties)
  bill_to_party_id text,
  bill_to_name     text,
  bill_to_address  text,
  bill_to_gstin    text,
  bill_to_state    text,
  ship_to_party_id text,
  ship_to_name     text,
  ship_to_address  text,
  ship_to_gstin    text,
  ship_to_state    text,
  -- Transport
  transporter    text,
  vehicle_no     text,
  lr_no          text,
  eway_bill_no   text,
  -- Totals
  subtotal       numeric,
  tax_total      numeric(18,2),
  grand_total    numeric,
  freight        numeric(18,2) default 0,
  posted_at      timestamp with time zone
);
```

### Invoice Lines

Each invoice line links back to a specific SO line:

```sql
create table public.invoice_lines (
  invoice_id      uuid,        -- FK to invoices
  so_id           uuid,        -- FK to sales_orders
  so_line_id      uuid,        -- FK to sales_order_lines
  qty             numeric(14,3),
  rate            numeric(14,2),
  line_amount     numeric(14,2),
  source_mode     text,        -- How this line was sourced (dispatch/fg/direct)
  -- Snapshot fields for audit trail
  dispatch_qty_snapshot  numeric(18,3),
  ordered_qty_snapshot   numeric(18,3),
  billed_qty_snapshot    numeric(18,3)
);
```

A unique index on `(invoice_id, so_line_id)` prevents billing the same SO line twice on the same invoice.

### Over-Billing Prevention

The `trg_prevent_over_billing` trigger checks that the total billed quantity across all invoices for a given SO line does not exceed the ordered quantity. The `so_line_billed_qty` view aggregates billed quantities:

```sql
create view public.so_line_billed_qty as
select
  il.so_line_id,
  sum(il.qty) as billed_qty
from invoice_lines il
join invoices i on i.id = il.invoice_id
where i.status <> 'CANCELLED'
group by il.so_line_id;
```

### Three Billing Modes

| Mode       | Source Data               | Use Case                              |
|------------|---------------------------|---------------------------------------|
| Dispatch   | `dispatch_records`        | Bill based on dispatched quantities   |
| FG (Finished Goods) | `packing_records` | Bill based on packed/ready quantities |
| Direct     | Manual entry              | Bill without WO/dispatch reference    |

### Invoice Number Sequencing

```sql
create table public.invoice_sequences (
  fy      text not null,     -- Financial year
  prefix  text not null,     -- Document prefix
  last_no integer default 0
);
```

---

## 10. Service Items -- Direct Billing Path

Three product codes represent service/consumable items that bypass the production workflow entirely:

| Code     | Description            |
|----------|------------------------|
| `SLC001` | Flexo Printing Plate   |
| `SLC002` | Offset Printing Plate  |
| `SLC003` | Die                    |

These items:
- Are excluded from `v_workorder_candidates` (no WO is created)
- Are billed directly via the "direct" billing mode
- Skip the Artwork -> Approval -> WO -> Production -> Packing -> Dispatch pipeline

---

## Lifecycle Summary Table

| Stage        | Table(s)                          | Key Status Values                | Trigger/Constraint                     |
|--------------|-----------------------------------|----------------------------------|----------------------------------------|
| Sales Order  | `sales_orders`, `sales_order_lines` | OPEN, HOLD, CANCELLED          | `trg_sales_order_rollup_*` (3 triggers)|
| Artwork      | `artworks`                        | PENDING, APPROVED, REJECTED      | `trg_artworks_updated`                 |
| Approval     | `sales_order_lines` (status cols) | PENDING, APPROVED, REJECTED      | RBAC (`can_approve_*` permissions)     |
| Work Order   | `work_orders`, `work_order_jobs`  | (status on WO)                   | `trg_sales_order_rollup_from_work_order_jobs` |
| Routing      | `work_order_routing`              | PENDING, IN_PROGRESS, COMPLETED  | --                                     |
| Production   | `production_entries`, `production_live_entries` | RUNNING, COMPLETED, STOPPED, HOLD | `trg_production_live_entries_updated_at` |
| Packing      | `packing_records`                 | `ready_to_dispatch` flag         | Unique index on `so_line_id`           |
| Dispatch     | `dispatch_records`                | DISPATCHED                       | --                                     |
| Invoice      | `invoices`, `invoice_lines`       | DRAFT, POSTED, CANCELLED        | `trg_lock_invoice_lines`, `trg_prevent_over_billing` |
