# Powerstik ERP

An in-house ERP system for a printing & packaging company, built on **Google Sheets** (user interface) and **Supabase / PostgreSQL** (data layer).

## What This System Does

Manages the full order-to-invoice lifecycle for a printing and packaging operation:

1. **Sales Orders** - Capture customer orders with line-level products, pricing, GST, and delivery dates
2. **Artwork Management** - Track artwork preparation, plate/die status, and approvals (accounts + business)
3. **Work Orders** - Bundle approved SO lines into production-ready work orders with materials and routing
4. **Production** - Record machine-level output (produced, rejected, OK qty) against routing steps
5. **Packing & Dispatch** - Track packed quantities and dispatch-readiness per SO line
6. **Invoicing** - Generate invoices with GST breakup, bill-to/ship-to parties, and transport details

## Architecture at a Glance

```
Google Sheets (UI)          Supabase (Backend)
+-----------------+         +------------------+
| Sheet Tabs      | ------> | PostgreSQL DB    |
| Apps Script     |  REST   | Functions        |
| Named Ranges    | <------ | Triggers         |
| Formulas        |   API   | Views            |
+-----------------+         +------------------+
```

- **Frontend**: Google Sheets workbook with tabs for each module. Users interact only with Sheets.
- **Backend**: Supabase project providing PostgreSQL database, REST API, and server-side logic.
- **Integration**: Google Apps Script makes REST calls to Supabase to read/write data.

## Core Data Model

```
clients
  |
  v
sales_orders ──> sales_order_lines
  |                    |
  v                    v
artworks          packing_records
  |                    |
  v                    v
work_orders ──> work_order_jobs
  |
  ├──> work_order_materials
  |
  └──> work_order_routing
            |
            v
       production_entries

invoices ──> invoice_lines ──> (links back to sales_orders + sales_order_lines)
```

### Key Tables

| Table | Purpose |
|-------|---------|
| `sales_orders` | Order header - client, SO number, date, PO reference |
| `sales_order_lines` | Line items - product, qty, rate, GST, approval statuses |
| `artworks` | Artwork specs per SO line - plate/die details, sheet layout, approval tracking |
| `work_orders` | Production batch header - WO number, date, status, snapshot JSON |
| `work_order_jobs` | SO lines pulled into a work order with production-relevant fields |
| `work_order_materials` | Raw materials required per work order (paper GSM, deckle, cut size) |
| `work_order_routing` | Process steps (sequence, department, machine, planned vs completed qty) |
| `production_entries` | Machine-level production logs (operator, qty produced/rejected, downtime) |
| `packing_records` | Packing status per SO line - packed qty, dispatch readiness |
| `invoices` | Invoice header - bill-to/ship-to, transport details, GST totals |
| `invoice_lines` | Invoice line items linked back to SO lines with billing snapshots |

### Key Views

| View | Purpose |
|------|---------|
| `v_artwork_jobs` | Joins artworks with SO data for the artwork department's working screen |
| `v_workorder_candidates` | Shows approved SO lines eligible for work order creation (with remaining qty) |

## Order Lifecycle

```
SO Created ─> Lines Added ─> Artwork Prepared ─> Accounts Approved
                                                        |
                                                  Business Approved
                                                        |
                                              WO Created (snapshot taken)
                                                        |
                                              Production Logged
                                                        |
                                              Packing Recorded
                                                        |
                                              Invoice Generated
```

**Key gate**: A sales order line can only become a work order candidate when:
- Artwork status = `APPROVED`
- Accounts status = `APPROVED`
- Business status = `APPROVED`
- SO number starts with `SL`

## Business Rules Enforced in Database

| Rule | Mechanism |
|------|-----------|
| Auto-set `updated_at` on artwork changes | Trigger: `trg_artworks_updated` |
| Prevent editing/deleting posted invoice lines | Trigger: `trg_lock_invoice_lines` |
| Prevent billing more than dispatched qty | Trigger: `trg_prevent_over_billing` |
| Invoice status restricted to DRAFT/POSTED/CANCELLED | Check constraint: `invoice_status_chk` |
| One packing record per SO line | Unique index: `uq_packing_records_so_line_id` |
| One invoice line per SO line per invoice | Unique index: `ux_invoice_so_line` |
| One material entry per material key per WO | Unique index: `uq_wom_material` |

## Documentation Map

| Section | What You'll Find |
|---------|-----------------|
| [Architecture](architecture/overview.md) | System design, data flow, integration details |
| [Database](database/schema-overview.md) | Full schema reference, views, business rules |
| [Modules](modules/sales-orders.md) | Per-module deep dives (SO, artwork, WO, production, packing, invoicing) |
| [Sheets](sheets/workbook-map.md) | Workbook tabs, linked scripts, named ranges |
| [Runbooks](runbooks/adding-a-new-client.md) | Step-by-step guides for common operations |
| [Decisions](decisions/adr-001-sheets-as-frontend.md) | Architectural Decision Records (ADRs) |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| User Interface | Google Sheets |
| Scripting | Google Apps Script |
| Database | PostgreSQL (via Supabase) |
| API | Supabase REST API (PostgREST) |
| Auth | Supabase API keys (service role / anon) |
| Hosting | Supabase cloud |
