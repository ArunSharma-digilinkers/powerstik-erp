# Packing and Dispatch Module

## Overview

The Packing and Dispatch modules track post-production packaging and shipment of finished goods. Packing records the cumulative packed qty per SO line (one `packing_records` row per line), every individual posting is logged in `packing_entry_log`, and every edit is audited. Dispatch records track individual shipments with transporter details. These are separate but closely linked modules.

> The Packing + Dispatch section starts at roughly line 25851 in `Code.gs` (`savePackingBulk`).

## Tables

| Table | Purpose |
|-------|---------|
| `packing_records` | One row per SO line — packed qty, ready-to-dispatch flag |
| `packing_entry_log` | One row per individual packing posting (rolls up into the above) |
| `packing_entry_audit_log` | Audit trail for packing edits / reversals |
| `dispatch_records` | Multiple rows per SO line — dispatch qty, transporter, vehicle, LR |
| `fg_opening_stock` | Finished goods opening balances |
| `fg_opening_dispatch_entries` | FG opening stock dispatches |
| `fg_stock_adjustments` | FG stock adjustments (linked to packing / opening / SO line) |

> The `dispatch_sequence` table has been removed. Dispatch numbers are now generated in Apps Script.

## Packing

### Key Constraint

One packing record per SO line (enforced by `uq_packing_records_so_line_id` partial unique index where `so_line_id IS NOT NULL`).

### Packing Record Fields

| Field | Description |
|-------|-------------|
| `so_id` / `so_line_id` | Links to the sales order line |
| `so_number` / `line_no` | Denormalized SO reference |
| `product_code` / `product_name` | Product details |
| `order_qty` | Original order quantity |
| `produced_qty` | Production output |
| `packed_qty` | Quantity packed |
| `ready_to_dispatch` | Boolean flag indicating dispatch readiness |
| `packed_by` / `packed_at` | Who packed and when |

### Per-posting log

`packing_entry_log` records each individual posting (operator, qty, weight kg, source stage, ready-to-dispatch flag). `packing_records` is the cumulative roll-up per SO line. `packing_entry_audit_log` keeps the before/after JSON of every edit / reversal along with the `changed_by` and `reason`.

### Key Functions

| Function | Purpose |
|----------|---------|
| `savePackingBulk(entries)` | Save multiple packing records — writes both `packing_entry_log` (per posting) and updates the roll-up `packing_records` row; on edits, also writes `packing_entry_audit_log`. |
| `packGetDataset(params, token)` | Get packing queue dataset |

### Packing Queue

`v_packing_queue_fast` is the main packing view. It:
- Joins `work_order_jobs` with `work_orders` and `sales_order_lines`
- Calculates `produced_qty` from the final production routing step (excluding Packing, Dispatch, QC, Cutting stages)
- Shows only items where `produced_qty > 0`
- Includes department category, delivery dates, transport mode, and artwork number

## Dispatch

### Dispatch Record Fields

| Field | Description |
|-------|-------------|
| `dispatch_no` | Auto-generated dispatch number |
| `so_line_id` | Links to the SO line being dispatched |
| `dispatch_qty` | Quantity dispatched in this shipment |
| `transporter` | Transporter/courier name |
| `lr_no` | Lorry receipt number |
| `vehicle_no` | Vehicle number |
| `dispatch_date` | Date of dispatch |
| `status` | Default: DISPATCHED |

### Key Functions

| Function | Purpose |
|----------|---------|
| `saveDispatchBulk(entries)` | Save multiple dispatch records |
| `dispatchGetDataset(params, token)` | Get dispatch queue dataset |

### Dispatch Queue

`v_dispatch_queue_fast` extends the packing queue to show only items where `ready_to_dispatch = true`, adding:
- `dispatched_qty` (sum of all dispatch records for the SO line)
- Balance = packed_qty - dispatched_qty

## FG Stock Management

Finished goods stock is tracked separately for:

1. **SO-linked FG**: Packed quantities from production (via `packing_records`)
2. **Opening FG**: Legacy/initial stock loaded via `fg_opening_stock`

### Key Functions

| Function | Purpose |
|----------|---------|
| `fgGetBootstrap(token)` | Get FG stock initial data |
| `fgGetDashboard(params, token)` | FG stock dashboard |
| `fgSaveOpeningStock(payload, token)` | Save opening FG stock |
| `fgSaveOpeningDispatch(payload, token)` | Record dispatch from opening stock |
| `fgSaveStockAdjustment(payload, token)` | Record FG stock adjustment |
| `fgPostPackedDispatch(payload, token)` | Post dispatch from packed stock |

### FG Stock Adjustments

`fg_stock_adjustments` records adjustments with:
- `source_type` - Where the stock came from (PACKING or OPENING)
- `pack_id` / `opening_id` - Reference to source record
- `so_line_id` - Links back to SO for traceability
- `adjustment_qty` - Positive or negative adjustment
- `reason` / `remarks` - Why the adjustment was made

## Views

| View | Purpose |
|------|---------|
| `v_packing_queue_fast` | Fast packing queue with production totals |
| `v_packing_board` | Packing board (balance = produced - packed) |
| `v_dispatch_queue_fast` | Fast dispatch queue (extends packing queue) |
| `v_dispatch_board` | Items ready to dispatch with balance qty |
| `v_fg_stock_available` | FG stock available for dispatch (per client / product) |
| `v_billing_dispatch_summary` | Dispatch totals per SO line for billing |
| `v_billing_packing_summary` | Packing totals per SO line for billing |
| `v_report_dispatch_register` | Date-ranged dispatch register |
| `v_report_dispatch_discrepancy_lines` | Lines where dispatched qty doesn't match SO qty |

## Triggers / Cascades

- `trg_sales_order_line_status_from_dispatch` (on `dispatch_records`) recomputes the parent `sales_order_lines.status` whenever a dispatch row is inserted / updated / deleted — so the SO line auto-flips to `PARTIAL_DISPATCHED` or `CLOSED` without any application code change.

## Integration

- **Production**: Produced qty flows from production entries into the packing queue.
- **Billing**: Dispatched qty determines billable quantity — `v_billing_line_read_model` exposes `dispatch_billable_qty` and `fg_billable_qty` (see [Invoicing](invoicing.md)).
- **Reports**: Delivery performance, unbilled dispatch, dispatch register, and dispatch discrepancy reports all read from this module.
- **SO line status**: Auto-cascaded via the trigger family — see [business-rules.md](../database/business-rules.md).
