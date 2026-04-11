# Packing and Dispatch Module

## Overview

The Packing and Dispatch modules track post-production packaging and shipment of finished goods. Packing records quantity packed per SO line (one record per line), while dispatch records track individual shipments with transporter details. These are separate but closely linked modules.

## Tables

| Table | Purpose |
|-------|---------|
| `packing_records` | One record per SO line - packed qty, ready-to-dispatch flag |
| `dispatch_records` | Multiple records per SO line - dispatch qty, transporter, vehicle |
| `dispatch_sequence` | Auto-increment for dispatch numbers |
| `fg_opening_stock` | Finished goods opening balances |
| `fg_opening_dispatch_entries` | FG opening stock dispatches |
| `fg_stock_adjustments` | FG stock adjustments (linked to packing/opening/SO line) |

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

### Key Functions

| Function | Purpose |
|----------|---------|
| `savePackingBulk(entries)` | Save multiple packing records |
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
| `v_packing_board` | Legacy packing board (balance = produced - packed) |
| `v_packing_queue_fast` | Fast packing queue with production totals |
| `v_dispatch_board` | Items ready to dispatch with balance qty |
| `v_dispatch_queue_fast` | Fast dispatch queue (extends packing queue) |
| `v_billing_dispatch_summary` | Dispatch totals per SO line for billing |
| `v_billing_packing_summary` | Packing totals per SO line for billing |

## Integration

- **Production**: Produced qty flows from production entries into packing queue
- **Billing**: Dispatched qty determines billable quantity; `v_billing_line_read_model` calculates `dispatch_billable_qty` and `fg_billable_qty`
- **Reports**: Delivery performance and unbilled dispatch reports use dispatch data
