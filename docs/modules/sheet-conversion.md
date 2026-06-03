# Inventory Sheet Conversion

## Overview

Sheet conversion handles the case where a raw paper / board *sheet* (e.g. 28×40 inch, 350 GSM) is cut down into multiple smaller sheets (e.g. one 13×19 production sheet plus a few smaller ones plus some waste). The module:

1. Posts a `qty_out` ledger row against the source item.
2. Posts a `qty_in` ledger row plus a new `inv_lots` row for each non-waste output.
3. Pro-rates the source value across the outputs by area share so the total inventory value stays consistent.
4. Records everything in `inv_sheet_conversions` + lines + allocations so the posting is fully reversible.

> The Sheet Conversion section starts at roughly line 20521 in `Code.gs` (`invPostSheetConversion`). The standalone HTML scaffold for the legacy conversion flow lives in `/InventoryConvert.html`.

## Tables

| Table | Purpose |
|-------|---------|
| `inv_sheet_conversions` | Header (source item, source qty, source area, total source value, status) |
| `inv_sheet_conversion_lines` | One row per output (cut size or waste) — qty, area, share %, target lot |
| `inv_sheet_conversion_allocations` | Which source lot(s) supplied each output (mirrors `inv_lot_allocations`) |
| `inv_sheet_conversion_sequences` | Counter for `conversion_no` |

The corresponding `inv_ledger` rows use `ref_type = 'SHEET-CONVERSION'` and `ref_no = conversion_no`.

See [schema-overview.md](../database/schema-overview.md#inv_sheet_conversions) for the full column list.

## Key Functions (Code.gs)

| Function | Purpose |
|----------|---------|
| `invPostSheetConversion(payload, token)` | Post a new conversion — validates source qty / area, allocates from FIFO lots, writes header + lines + allocations + ledger + new lots, computes `share_pct` and pro-rated `value` per output. |
| `invReverseSheetConversion(conversionId, reason, token)` | Reverse a posted conversion — writes inverse ledger rows, marks header `status = 'REVERSED'`. Lines and allocations are kept for audit. |
| `invGetSheetConversionPrintData(conversionId, token)` | Pulls header + lines for the conversion print / re-display screen. |
| `invListSheetConversionsJSON(opts, token)` | Lists conversion headers with status filter. |

## Posting Logic (Step by Step)

Given:
- Source item `S` with batch `B`, current rate `R`, area `A_src`.
- Outputs `O_i` with `qty_i`, `length_i`, `width_i`, `ups_i`.

`invPostSheetConversion()`:

1. Compute `source_area_mm2 = A_src = source_qty × source_length_mm × source_width_mm`.
2. For each output `O_i`:
   - `line_area_mm2 = qty_i × length_i × width_i / ups_i` (waste lines use their own area directly).
   - `share_pct = line_area_mm2 / source_area_mm2`.
   - `rate = R` (carried from source) — every non-waste line inherits the source rate.
   - `value = source_value × share_pct`.
3. Sum `waste_area_mm2 = source_area_mm2 - Σ line_area_mm2`. `waste_value = source_value × waste_share_pct`.
4. Write a `qty_out` ledger row for the source (`ref_type = 'SHEET-CONVERSION'`).
5. Allocate the source qty from `inv_lots` (FIFO) and write `inv_sheet_conversion_allocations`.
6. For each non-waste output:
   - Write a `qty_in` ledger row with the pro-rated rate and value.
   - Create a new `inv_lots` row (`target_lot_id`) so future issues can FIFO from it.
7. Update the header totals (`source_value`, `waste_value`, `stock_lines`, `total_lines`).

Result: net inventory value before and after the conversion is identical — only the item / batch breakdown changes.

## Reversal

`invReverseSheetConversion()` writes the inverse ledger rows (source `qty_in`, outputs `qty_out`), zeroes the `qty_available` on the target lots, and flips the header to `status = 'REVERSED'` with `reversed_at` / `reversed_by`. The original lines and allocations are kept for audit.

## Constraints / Behaviours

- The conversion must consume from a single source item (multi-source conversions are modelled as multiple conversions).
- `is_waste = true` lines do **not** create a new lot; they only carry value out for cost-share accounting.
- The conversion can be partially reversed by reversing the entire conversion and re-posting a smaller one.
- `conversion_no` is generated via `inv_sheet_conversion_sequences` (one counter per prefix).

## Views

There is no dedicated workbench view yet — the listing screen reads `inv_sheet_conversions` directly with a join to `inv_items` for the source-item display name. The combined `v_inventory_transaction_register` surfaces the resulting ledger rows alongside receipts and issues.

## Integration

- **Inventory**: Shares the `inv_ledger` / `inv_lots` / `inv_lot_allocations` primitives. Every conversion appears in `v_inventory_transaction_register`.
- **Item Master**: Source and output items must exist in `items` (and `inv_items` after `syncItemToInventory_()`).
- **Production**: Conversions are typically posted when production needs a specific cut size that isn't held as stock — the resulting target lots are then issued to the WO via `invPostIssue()`.

## See Also

- [Inventory module](inventory.md) — ledger / lot / FIFO primitives that this builds on.
- [schema-overview.md](../database/schema-overview.md#inv_sheet_conversions) — column-level table reference.
- [business-rules.md](../database/business-rules.md#sheet-conversion-posting) — short notes on posting behaviour.
