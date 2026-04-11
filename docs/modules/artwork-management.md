# Artwork Management Module

## Overview

The Artwork module manages artwork preparation, plate/die status tracking, and artwork approval. It sits between sales order entry and work order creation in the lifecycle. An artwork record is auto-created for each SO line and tracks the visual/technical specification before production.

## Tables

| Table | Purpose |
|-------|---------|
| `artworks` | Artwork specs per SO line - plate/die status, sheet layout, UPS, printing colors |
| `artwork_sequences` | Auto-incrementing artwork number sequences by product type prefix |

## Key Fields

| Field | Description |
|-------|-------------|
| `so_id` / `line_no` | Links artwork to a specific SO line |
| `artwork_no` | Unique artwork identifier |
| `product_type` | Product type category (determines WO module routing) |
| `plate_status` | NEW, OLD, NA - whether a new plate is needed |
| `die_status` | NEW, OLD, NA - whether a new die is needed |
| `status` | Overall artwork status (PENDING, APPROVED, REJECTED) |
| `sheet_length` / `sheet_width` | Sheet dimensions for printing |
| `sheet_ups` | Number of ups on the sheet |
| `across_ups` / `along_ups` / `total_ups` | Detailed ups breakdown |
| `teeth` | Cylinder teeth count (for flexo) |
| `across_gap_mm` / `along_gap_mm` | Gap between labels (for flexo) |
| `across_width` | Across width dimension |
| `printing_colors` | Number/description of printing colors |
| `plate_size` / `plate_count` | Plate specifications |
| `has_hybrid_plate` | Whether artwork uses hybrid plates |
| `die_count` | Number of dies required |
| `artwork_at` | When artwork was prepared |
| `approved_at` | When artwork was approved |

## Key Functions (Code.gs)

| Function | Purpose |
|----------|---------|
| `createArtworksFromSoLines(soId)` | Auto-create artwork records for all SO lines |
| `getArtworkJobs()` | List artworks via `v_artwork_jobs` view |
| `getArtworkWorkbench(fromDate, toDate, pendingOnly)` | Get artwork workbench data (grouped view) |
| `saveArtworkBulk(payload)` | Save artwork specs for multiple records |
| `saveArtworkGroup(payload)` | Save artwork as a group (same artwork_no) |
| `approveArtwork(id)` / `approveArtworkGroup(artworkNo)` | Approve artwork |
| `unapproveArtwork(id)` / `unapproveArtworkGroup(artworkNo)` | Revert approval |
| `getArtworkReference(artworkNo)` | Load artwork reference data for WO creation |
| `getFlexoArtworkApprovalData(soNo, lineNo, artworkNo)` | Get flexo-specific artwork data for WO |

## Artwork Workbench

The artwork workbench (`getArtworkWorkbench`) is the main working screen for the artwork department. It:

1. Fetches artwork jobs from `v_artwork_jobs` view within a date range
2. Groups jobs by `artwork_no`
3. Enriches with FG stock data (`_getFgStockByProductCodes_`)
4. Presents grouped artwork records with status indicators

The workbench supports:
- Date range filtering
- Pending-only filter
- Group-level operations (approve all lines under an artwork number)

## Artwork Lifecycle

```
SO Line Created ──> Artwork Auto-Created (status: null/PENDING)
                            |
                    Artwork Prepared (plate/die status set, sheet layout defined)
                            |
                    Artwork Approved (status: APPROVED, approved_at set)
                            |
                    Available for WO creation (via v_workorder_candidates)
```

## Plate and Die Procurement

When `plate_status` or `die_status` is `NEW`, the artwork appears in the Plates and Dies procurement screen:

- `getPlateDieJobs()` fetches artworks where plate or die is NEW
- Links to `purchase_artwork_procurement` for tracking orders to vendors
- Connects to purchase order flow for plate/die ordering

## Views

| View | Purpose |
|------|---------|
| `v_artwork_jobs` | Main artwork working screen - joins artworks + SO lines + SO header + client |
| `v_purchase_plate_die_jobs` | Artworks needing new plates or dies |

## Integration

- **Sales Orders**: Artworks auto-created when SO lines are saved
- **Work Orders**: Artwork status must be APPROVED for WO candidate eligibility; artwork data (sheet layout, UPS, colors) flows into WO snapshot
- **Flexo WO**: `getFlexoArtworkApprovalData()` fetches flexo-specific artwork specs (teeth, across_width, gaps) for flexo WO creation
- **Purchasing**: Plate/die procurement tracked via `purchase_artwork_procurement`
