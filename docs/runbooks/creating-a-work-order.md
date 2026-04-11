# Runbook: Creating a Work Order

## Prerequisites

- User must have `can_create` permission on the `WOW` module
- SO lines must be fully approved (accounts + business + artwork all APPROVED)
- SO must not be cancelled
- Remaining quantity > 0 (order qty minus already-processed qty)

## Offset/Digital Work Order

### 1. Navigate to WO Page

Go to the Work Order page (`?page=wow`) in the web app.

### 2. Select SO Lines

The WO candidate list shows approved SO lines from `v_workorder_candidates`. Each line shows:
- SO number, date, client name
- Product, quantity, remaining quantity
- Approval status, artwork status
- Department category (Offset, Digital, Corrugated)

Select one or more SO lines to include in the work order. Lines for the same WO should typically be from the same client and product type.

### 3. Configure Paper and Layout

| Field | Description |
|-------|-------------|
| Paper Stock | Art Paper, Art Card, Maplitho, etc. |
| GSM | Paper weight (60-450 GSM) |
| Paper Size | Deckle x Cut Size (e.g., 23x36 in) |
| Print Style | Single Side, Front-Back, Work-Turn, Work-Tumble |
| Grain | With Grain, Across Grain, NA |
| Coating | None, Aqueous, UV, Drip Off |
| UPS | Number of ups per sheet |

The system calculates:
- **Core sheets** = order qty / UPS
- **Wastage sheets** = based on wastage percentage
- **Total sheets** = core + wastage

### 4. Define Routing

Add process steps in sequence:

| Step | Department | Machine | Notes |
|------|-----------|---------|-------|
| 1 | Printing | Heidelberg SM74 | First step |
| 2 | Lamination | Lamination 01 | If required |
| 3 | Die Cutting | Die Cutting 01 | If required |
| 4 | Packing | Manual Packing | Final step |

Available machines are filtered by department (`DEFAULT_MASTERS.machinesByDept`).

### 5. Save Work Order

Click Save. The system (`saveWorkOrder()`) will:
1. Generate WO number (e.g., `WO-2526/0042`)
2. Create `work_orders` record with `snapshot_json`
3. Create `work_order_jobs` records for each SO line
4. Create `work_order_materials` records for paper and other materials
5. Create `work_order_routing` records for each process step
6. Update `sales_order_rollup_cache` (WO status becomes CREATED)

## Flexo Work Order

### 1. Navigate to Flexo WO Page

Go to `?page=flexowo`.

### 2. Select SO Lines

Same as offset, but filtered for Flexo department category only.

### 3. Configure Flexo Details

| Field | Description |
|-------|-------------|
| Label Type | Front, Back, Top, Bottom, Neck, Flat Label |
| Winding Direction | Clock Wise, Anti Clock Wise, Sheet Form |
| Finished Format | Sheet Form, Roll Form, Fan Fold, Cut Label |
| Die Type | Rotary Die, Flatbed Die, None |
| Teeth | Cylinder teeth (from cylinder master) |
| Across Width | Web width |
| Across/Along UPS | Label arrangement |
| Across/Along Gap | Gap between labels (mm) |

The system auto-fetches artwork approval data (`getFlexoArtworkApprovalData`) to pre-fill teeth, UPS, and gap values.

### 4. Define Flexo Routing

Flexo routing options include:
- Flexo Printing
- Flexo Printing + Lamination
- Flexo Printing + Die Cutting
- Flexo Printing + Lamination + Die Cutting
- Flexo Die Cutting Offline
- Inspection/Slitting
- Packing

### 5. Save

`saveFlexoWorkOrder()` creates the WO with flexo-specific snapshot data including running meter calculations.

## After WO Creation

- WO appears in Production stage queue
- Materials appear in inventory issue queue (`invListWorkOrdersForIssue`)
- WO can be printed (`printWorkOrder` or `printFlexoWorkOrder`)
- SO rollup cache shows `wo_status: CREATED`

## Deleting a Work Order

`deleteWorkOrder(woNo)` cascades deletion to:
- `work_order_jobs` (CASCADE)
- `work_order_materials`
- `work_order_routing` (CASCADE, also cascades to `production_entries`)

This is destructive and removes all production data. Only delete if the WO was created in error.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| SO line not in candidate list | Not fully approved | Check accounts/business/artwork status |
| "Remaining qty is 0" | Already fully covered by other WOs | Check existing WO list for the SO line |
| Product not eligible | Service-only item (SLC001-003) | These items don't need WOs |
| Flexo line in offset candidates | Mismatch | Flexo items only show in flexo WO page |
