# Item Master Module

## Overview

The Item Master module manages the product catalog with Bill of Materials (BOM) support, revision control, and routing templates. Items can be manufacturing-enabled with multi-revision BOMs that track materials and process routing. The module also supports item merging for deduplication.

## Tables

| Table | Purpose |
|-------|---------|
| `items` | Product/item master |
| `item_sequences` | Item code auto-increment |
| `item_bom_revisions` | BOM revision management |
| `item_bom_materials` | BOM materials per revision |
| `item_bom_routing` | BOM routing steps per revision |

## Item Fields

| Field | Description |
|-------|-------------|
| `item_code` | Auto-generated unique code (e.g., IT000001) |
| `item_name` | Product name |
| `category` | Product category (e.g., Stickers, Labels, Corrugated Box) |
| `hsn_group` | HSN code group for GST |
| `unit` | Unit of measure (Pcs, Kgs, Meter) |
| `default_rate` | Default selling rate |
| `gst_pct` | GST percentage |
| `client_code` / `client_name` | Client-specific items |
| `manufacturing_enabled` | Whether item has BOM support |
| `revision_controlled` | Whether BOM uses revision control |
| `product_category` | Flat, Corrugated, or Flexo (determines WO module) |
| `wo_module` | WOW or FLEXOWO |
| `item_lifecycle_status` | DRAFT, ACTIVE, INACTIVE, OBSOLETE |
| `current_revision_no` | Current active BOM revision number |
| `length_mm` / `width_mm` / `height_mm` / `dimension_unit` | Physical dimensions of the finished good (used by sheet-conversion planning, packing weight estimates, and BOM material calculations) |

> The Item Master section starts at roughly line 7715 in `Code.gs` (`saveItem`).

## BOM Revision System

BOMs are versioned through revisions:

```
item_code ──> item_bom_revisions (revision 1: ARCHIVED)
                                 (revision 2: ACTIVE, is_current=true)
                                 (revision 3: DRAFT)
```

### Revision States

| Status | Description |
|--------|-------------|
| `DRAFT` | Under preparation, can be edited |
| `ACTIVE` | Currently in use (`is_current = true`) |
| `ARCHIVED` | Previous version, read-only |

Only one revision can be `is_current = true` per item (enforced by partial unique index `item_bom_revisions_current_uk`).

### BOM Materials

Each revision has materials:

| Field | Description |
|-------|-------------|
| `material_type` | RAW_MATERIAL (default) |
| `material_group` | Material grouping |
| `material_item_code` | FK to items or inv_items |
| `material_name` | Material description |
| `qty_per_unit` | Quantity required per unit of output |
| `uom` | Unit of measure |
| `wastage_pct` | Wastage percentage |
| `gsm` / `deckle_mm` / `cut_size_mm` | Paper specifications |
| `flute` / `ply_no` | Corrugation details |
| `extra_json` | Additional metadata |

### BOM Routing

Each revision has routing steps:

| Field | Description |
|-------|-------------|
| `sequence_no` | Step order |
| `department` | Production department |
| `operation_name` | Operation description |
| `machine_name` | Default machine |
| `setup_time_min` / `run_time_min` | Time estimates |
| `standard_rate_qty_per_hour` | Standard production rate |
| `outsource` | Whether step is outsourced |

## Key Functions (Code.gs)

| Function | Purpose |
|----------|---------|
| `saveItem(item)` | Create or update an item |
| `getItems(params)` | List items with filtering |
| `generateItemCode_()` | Generate next item code |
| `itemMasterListItems(params, token)` | List items for item master UI |
| `itemMasterGetReferenceData(token)` | Get reference data (categories, HSN groups, etc.) |
| `itemMasterGetItem(itemCode, token)` | Get complete item with BOM |
| `itemMasterGetActiveBom(itemCode, token)` | Get active BOM for an item |
| `itemMasterCreateRevision(payload, token)` | Create a new BOM revision |
| `itemMasterSaveRevision(payload, token)` | Save BOM revision (materials + routing) |
| `itemMasterActivateRevision(revisionId, token)` | Activate a revision (archives current) |
| `itemMasterToggleItem(itemCode, active, token)` | Toggle item active status |
| `itemMasterPreviewMerge(sourceCode, targetCode, token)` | Preview item merge |
| `itemMasterMergeItems(payload, token)` | Merge two items |

## Item Merge

The merge feature handles deduplication by moving all references from a source item to a target item:

1. `itemMasterPreviewMerge()` scans all tables for references to the source item
2. Shows count of affected records in each table
3. `itemMasterMergeItems()` executes the merge:
   - Updates `sales_order_lines.product_code/product_name`
   - Updates `work_order_jobs.product_name`
   - Updates `packing_records.product_code/product_name`
   - Updates `dispatch_records.product_code/product_name`
   - Updates `invoice_lines.product_code/product_name`
   - Patches WO `snapshot_json` to update product references
   - Deactivates the source item

## Views

The previous `v_item_bom_current` view has been removed. The current active revision is read directly from `item_bom_revisions WHERE is_current = true` — the partial unique index `item_bom_revisions_current_uk` guarantees there is at most one such row per item. `itemMasterGetActiveBom()` in Code.gs does this lookup.

## Integration

- **Sales Orders**: Items referenced by `product_code` in SO lines; `v_sales_order_item_picker` exposes the picker dataset.
- **Work Orders**: Item's `product_category` and `wo_module` determine WO type.
- **Inventory**: `syncItemToInventory_()` ensures `inv_items` stays in sync.
- **Costing**: Item properties (HSN, GST, default rate, dimensions) feed into cost estimation.
