# Inventory Module

## Overview

The Inventory module manages raw material stock with lot-level tracking, FIFO allocation, and a double-entry ledger. It handles receipts (PO + direct), issues to work orders, returns to supplier (RTS), returns from production (RFP), adjustments, **rate corrections**, and **sheet conversions** (one raw sheet → multiple cut sizes). Stock levels are maintained via materialized views for performance.

> Sheet conversion is large enough that it has its own [Sheet Conversion module doc](sheet-conversion.md). This file covers the rest.

## Tables

| Table | Purpose |
|-------|---------|
| `inv_items` | Raw material items (code, name, category, department, UOM) |
| `inv_ledger` | Movement ledger - every in/out transaction |
| `inv_lots` | Lot/batch tracking with FIFO |
| `inv_lot_allocations` | Lot-level allocation records |
| `inv_purchase_requests` | Purchase requests (PR) from inventory |
| `inv_rts_returns` | Return-to-supplier records (one per `inv_ledger` reversal) |
| `inv_rate_corrections` | Post-hoc receipt-rate corrections with audit |
| `inv_sheet_conversions` (+ `_lines`, `_allocations`, `_sequences`) | Sheet-to-sheet conversion postings |
| `inv_item_sequences` / `inv_pr_sequences` / `inv_sheet_conversion_sequences` | Counters |

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
| `RTS` | Return to supplier (mirrored in `inv_rts_returns`) |
| `RFP` | Return from production |
| `ADJUSTMENT` | Stock adjustment |
| `RATE-CORRECTION` | Compensating row written by a rate correction (paired with the original receipt) |
| `SHEET-CONVERSION` | Source out / output in posted by `invPostSheetConversion()` |
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

The Inventory section starts at roughly line 19999 (`invPostIssue`). Sheet conversion (~20521) and rate correction (~20912) are physically nearby and share the same ledger helpers.

| Function | Purpose |
|----------|---------|
| `invSaveItem(payload)` | Create/update an inventory item |
| `invListItemsJSON(opts)` | List inventory items |
| `invSearchItemsJSON(q)` | Search items by name/code |
| `invAppendLedger_(p)` | Core helper to write a ledger row + matching lot allocation |
| `invPostDirectReceipt(payload)` | Post a direct receipt (no PO) |
| `invPostPurchaseReceipt(payload)` | Post receipt against a PR |
| `invPostIssue(payload)` | Issue material to a work order |
| `invPostIssueBulk(rows)` | Bulk issue multiple materials |
| `invPostRTS(payload)` | Return to supplier (writes `inv_rts_returns` + paired ledger row) |
| `invPostRFP(payload)` | Return from production |
| `invPostAdjustment(payload)` | Stock adjustment |
| `invPostSheetConversion(payload)` | Post a sheet-to-sheet conversion (see [Sheet Conversion](sheet-conversion.md)) |
| `invPreviewRateCorrection(payload)` | Dry-run a rate correction — returns the deltas without committing |
| `invApplyRateCorrection(payload)` | Apply a rate correction — rewrites receipt rate, writes compensating ledger rows, records `inv_rate_corrections` |
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

1. WO is created with materials in `work_order_materials`.
2. `invListWorkOrdersForIssue()` shows WOs with pending materials.
3. `inv_wo_issue_requirement_v` / `inv_wo_issue_requirement_fast_v` expose planned qty; `inv_wo_issue_status_v` / `inv_wo_issue_status_fast_v` show planned vs issued. (These replace the older `wo_material_pending` view.)
4. `inv_wo_issue_material_source_v` lists candidate lots / receipts (FIFO) to issue from.
5. User issues material via `invPostIssue()`:
   - Writes a ledger entry (ref_type: ISSUE, ref_no: WO ID, remarks: material_key).
   - Allocates from FIFO lots via `invAllocateLots_()` + `inv_lot_allocations`.
6. Stock materialized views are refreshed by `refreshStockMV_()`.

## Rate Correction Flow

When a receipt was posted at the wrong rate (typo, vendor rate-change after the fact), `invApplyRateCorrection()`:
1. Writes the new rate onto the source `inv_ledger` receipt row and the `inv_lots` rate for any qty still available.
2. For the portion already issued, writes compensating `inv_ledger` rows (ref_type: `RATE-CORRECTION`) so the total stock value stays consistent.
3. Records a row in `inv_rate_corrections` with the full delta (`stock_value_delta`, `issue_value_delta`, `affected_ledger_ids`).

`invPreviewRateCorrection()` runs the same logic in dry-run mode and returns the deltas without committing.

## RTS (Return to Supplier) Flow

1. User picks the lot / receipt being returned and the debit-note number from the RTS screen.
2. `invPostRTS()` writes:
   - A `qty_out` row to `inv_ledger` with ref_type = `RTS`.
   - A row in `inv_rts_returns` carrying the vendor paperwork (debit note, transporter, etc.) keyed to that ledger row.
   - A matching `inv_lot_allocations` row reducing the source lot.
3. The `inv_rts_register_v` view exposes everything for the register screen.

## Registers

The inventory module is read by a set of register views:

| View | Shows |
|------|-------|
| `inv_receipt_register_v` | Every receipt (direct / PR / PO) |
| `inv_issue_register_v` | Every issue (to a WO) |
| `inv_adjustment_register_v` | Every adjustment |
| `inv_rfp_register_v` | Inventory PRs and their pending qty |
| `inv_rts_register_v` | RTS returns with debit-note info |
| `v_inventory_transaction_register` | Combined timeline of all the above |

## Integration

- **Work Orders**: Material requirements from `work_order_materials` drive issue.
- **Purchasing**: Purchase requests trigger PO creation; PO receipts update inventory; rate corrections can be invoked from the receipt screen.
- **Item Master**: `syncItemToInventory_()` ensures `inv_items` stays in sync with the `items` table.
- **Sheet Conversion**: Sheet conversions consume inventory and create new inventory, sharing the same ledger / lot / allocation primitives — see [Sheet Conversion module doc](sheet-conversion.md).
- **Reports**: Stock analytics feed the inventory and planning dashboards.
