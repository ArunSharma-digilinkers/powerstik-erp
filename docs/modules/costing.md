# Costing Module

## Overview

The Costing module estimates product costs by breaking down raw material costs and process costs. It currently supports sticker costing with a master revision system for maintaining rate tables. Each costing record calculates a selling price from raw materials, processes, overheads, and profit margins.

> The Costing section starts at roughly line 12324 in `Code.gs` (`saveCostingRequest`).

## Tables

| Table | Purpose |
|-------|---------|
| `costing_records` | Product costing records |
| `costing_line_items` | Cost breakup line items (raw material + process) |
| `costing_master_revisions` | Versioned rate master data |
| `costing_audit_log` | Audit trail for changes |

## Costing Record Fields

| Field | Description |
|-------|-------------|
| `costing_no` | Unique costing number |
| `product_type` | Currently only `STICKER` |
| `status` | DRAFT, REVIEWED, APPROVED, ARCHIVED |
| `costing_date` / `costing_time` | When costing was prepared |
| `client_name` / `job_reference` | Reference details |
| `order_qty` / `order_qty_with_wastage` / `wastage_pct` | Quantity with wastage |
| `sticker_length/width` (in/mm) | Sticker dimensions |
| `dimension_mode` | IN (inches) or MM (millimeters) |
| `base_square_in` / `calculated_square_in` | Area calculations |
| `area_uplift_pct` | Area adjustment percentage |
| `printing_colors` | Number of colors |
| `lamination_type` / `lamination_micron` / `lamination_weight_kg` | Lamination details |
| `plate_square_in` / `plate_rate` / `die_rate` | Plate and die costs |

### Cost Breakup

| Field | Description |
|-------|-------------|
| `raw_material_total_value` / `_per_unit` / `_per_sq_in` | Raw material totals |
| `process_total_value` / `_per_unit` / `_per_sq_in` | Process totals |
| `raw_material_share_pct` / `process_share_pct` | Cost share split |
| `basic_rate` | Base cost rate |
| `overhead_pct` / `overhead_value` | Overheads |
| `total_with_overheads` | Cost + overheads |
| `profit_pct` / `profit_value` | Profit margin |
| `selling_price` / `selling_price_per_sq_in` | Final selling price |
| `total_order_value` | Total value for the order |

### Snapshots

| Field | Description |
|-------|-------------|
| `master_revision_id` / `master_revision_no` | Which master revision was used |
| `master_snapshot_json` | Snapshot of master rates at costing time |
| `input_json` | Input parameters used |
| `calc_json` | Detailed calculation steps |

## Costing Line Items

Each costing has line items in two groups:

| Group | Description |
|-------|-------------|
| `RAW_MATERIAL` | Paper, lamination, adhesive, ink, etc. |
| `PROCESS` | Printing, die cutting, lamination process, packing, etc. |

Line item fields:
- `line_code` / `line_name` - Item identifier and description
- `line_source` - STANDARD (from master) or ADDITIONAL (manually added)
- `quantity` / `rate` / `value` - Cost calculation
- `per_unit` / `per_sq_in` - Cost per unit and per square inch
- `meta_json` - Additional calculation metadata

## Master Revisions

Costing uses a master revision system for rate tables:

| Status | Description |
|--------|-------------|
| `DRAFT` | Being prepared |
| `ACTIVE` | Currently in use (`is_current = true`) |
| `ARCHIVED` | Previous version |

Only one revision can be current per costing type (partial unique index).

Master data includes:
- `values_json` - Rate tables (paper rates, process rates, overhead percentages)
- `summary_json` - Summary of the master revision

## Key Functions (Code.gs)

| Function | Purpose |
|----------|---------|
| `saveCostingRequest(payload)` | Save a costing record with line items |
| `autoCalculateCorrugatedCost(payload)` | Auto-calculate corrugated box cost |
| `_nextCostingNo_(productType)` | Generate next costing number |
| `ensureCostingRequestSheet()` | Ensure the costing request sheet exists |

## Audit Log

The `costing_audit_log` tracks all changes:
- `entity_type` - COSTING or MASTER
- `action` - What was done
- `snapshot_json` - State at the time of the action
- `created_by` - Who made the change

## Integration

- **Item Master**: Product dimensions and specifications feed into costing
- **Sales Orders**: Costing helps determine selling prices for SO line rates
