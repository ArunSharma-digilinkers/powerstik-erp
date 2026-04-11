# Inventory Module

## Overview

The Inventory module manages raw material stock with lot-level tracking, FIFO allocation, and a double-entry ledger. It handles receipts (from purchase orders and direct), issues (to work orders), returns to supplier, returns from production, and adjustments. Stock levels are maintained via materialized views for performance.

## Tables

| Table | Purpose |
|-------|---------|
| `inv_items` | Raw material items (code, name, category, department, UOM) |
| `inv_ledger` | Movement ledger - every in/out transaction |
| `inv_lots` | Lot/batch tracking with FIFO |
| `inv_lot_allocations` | Lot-level allocation records |
| `inv_purchase_requests` | Purchase requests (PR) from inventory |
| `inv_item_sequences` | Item code auto-increment |
| `inv_pr_sequences` | PR number auto-increment |

## Inventory Ledger

The `inv_ledger` table is the core of inventory tracking. Every movement creates a ledger entry:

| Field | Description |
|-------|-------------|
| `item_id` | FK to `inv_items` |
| `location` | Stock location (default: MAIN) |
| `ref_type` | Transaction type (see below) |
| `ref_no` | Reference number (PO number, WO ID, PR number) |
| `qty_in` | Quantity received (must be > 0 if used) |
| `qty_out` | Quantity issued (must be > 0 if used) |
| `rate` | Transaction rate |
| `value` | Transaction value |
| `remarks` | For issues: contains material_key linking to WO material |
| `department` | Department for the transaction |
| `batch_no` | Batch reference |

### Constraints

- **Single-direction**: Each entry must have either `qty_in > 0` or `qty_out > 0`, never both (`chk_single_direction`)
- **Non-negative**: Both `qty_in` and `qty_out` must be >= 0
- **Rate non-negative**: Rate must be >= 0

### Reference Types (`ref_type`)

| Type | Description |
|------|-------------|
| `RECEIPT` | Direct receipt (no PO) |
| `PR-RECEIPT` | Receipt against a purchase request |
| `PO-RECEIPT` | Receipt against a purchase order line |
| `ISSUE` | Material issue to a work order |
| `RTS` | Return to supplier |
| `RFP` | Return from production |
| `ADJUSTMENT` | Stock adjustment |
| `REVERSAL` | Reversal of a previous transaction |

## Lot Tracking (FIFO)

The `inv_lots` table tracks individual batches:

| Field | Description |
|-------|-------------|
| `batch_no` | Unique batch identifier |
| `source_type` | Where the lot came from (RECEIPT, PO-RECEIPT, etc.) |
| `qty_received` | Original quantity received |
| `qty_available` | Current available quantity |
| `rate` | Receipt rate |
| `receipt_date` | When received |

When issuing material, `invAllocateLots_()` allocates from the oldest lots first (FIFO). `inv_lot_allocations` records which lots were drawn from.

## Stock Views (Materialized)

### `inv_stock_mv` - Current Stock Balances

Aggregates ledger entries by item and location:
- `qty` = sum(qty_in) - sum(qty_out)
- `avg_rate` = weighted average from lots (preferred) or inbound ledger entries
- `value` = qty * avg_rate
- `last_movement_at` = latest ledger entry timestamp

### `inv_stock_analytics_mv` - Stock Analytics

Extends stock data with:
- `ageing_days` - Days since oldest lot receipt
- `movement_class` - FAST_MOVING (< 30 days), SLOW_MOVING (30-60 days), NON_MOVING (> 60 days)
- `avg_daily_consumption` - Based on 30-day issue window
- `avg_lead_time_days` - Based on PR-to-receipt time
- `minimum_stock_level` - Calculated reorder point (lead_time * daily_consumption * 1.2 safety factor)

Both are refreshed by `refreshStockMV_()`.

## Key Functions (Code.gs)

| Function | Purpose |
|----------|---------|
| `invSaveItem(payload)` | Create/update an inventory item |
| `invListItemsJSON(opts)` | List inventory items |
| `invSearchItemsJSON(q)` | Search items by name/code |
| `invAppendLedger_(p)` | Core function to add a ledger entry |
| `invPostDirectReceipt(payload)` | Post a direct receipt (no PO) |
| `invPostPurchaseReceipt(payload)` | Post receipt against a PR |
| `invPostIssue(payload)` | Issue material to a work order |
| `invPostIssueBulk(rows)` | Bulk issue multiple materials |
| `invPostRTS(payload)` | Return to supplier |
| `invPostRFP(payload)` | Return from production |
| `invPostAdjustment(payload)` | Stock adjustment |
| `invReverseLedgerTransaction(ledgerId, reason)` | Reverse a previous transaction |
| `invCreatePurchaseRequest(payload)` | Create a purchase request |
| `invListPurchaseRequestsJSON(opts)` | List purchase requests |
| `invGetStockSnapshotJSON(opts)` | Get current stock snapshot |
| `invListWorkOrdersForIssue()` | List WOs needing material issue |
| `invGetCurrentStockQty(itemCode, location)` | Get current stock quantity |
| `invGetCurrentAvgRate(itemCode, location)` | Get current average rate |

## Purchase Request Flow

1. Inventory team identifies low stock or WO material need
2. `invCreatePurchaseRequest()` creates a PR with item, qty, department
3. PR appears in purchase module (`v_purchase_requests_open`)
4. Purchase team creates a PO referencing the PR
5. When PO receipt is posted, PR's `received_qty` is updated
6. PR auto-closes when received_qty >= requested_qty

## WO Material Issue Flow

1. WO is created with materials in `work_order_materials`
2. `invListWorkOrdersForIssue()` shows WOs with pending materials
3. `wo_material_pending` view calculates pending qty per material
4. User issues material via `invPostIssue()`:
   - Creates ledger entry (ref_type: ISSUE, ref_no: WO ID, remarks: material_key)
   - Allocates from FIFO lots
5. Stock materialized views updated on next refresh

## Integration

- **Work Orders**: Material requirements from `work_order_materials` drive issue
- **Purchasing**: Purchase requests trigger PO creation; PO receipts update inventory
- **Item Master**: `syncItemToInventory_()` ensures inv_items stays in sync with items table
- **Reports**: Stock analytics feed dashboard reports
