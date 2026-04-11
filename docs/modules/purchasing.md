# Purchasing Module

## Overview

The Purchasing module manages vendor master data, purchase order creation, goods receipt, and artwork plate/die procurement. It integrates with both the inventory system (for raw material POs) and the artwork system (for plate/die POs).

## Tables

| Table | Purpose |
|-------|---------|
| `purchase_vendors` | Vendor master data |
| `purchase_orders` | PO headers |
| `purchase_order_lines` | PO line items |
| `purchase_po_receipts` | PO receipt entries |
| `purchase_artwork_procurement` | Artwork plate/die procurement tracking |
| `purchase_requests` | Legacy purchase requests |

## Vendor Master

| Field | Description |
|-------|-------------|
| `vendor_code` | Unique vendor code |
| `vendor_name` | Vendor company name |
| `contact_person` / `email` / `phone` | Contact details |
| `gstin` | GST number |
| `address` / `city` / `state` | Location |
| `category` | Vendor category |
| `is_active` | Active status |

## Purchase Orders

### PO Header

| Field | Description |
|-------|-------------|
| `po_no` | Unique PO number |
| `order_date` | PO date |
| `vendor_id` / `vendor_name` | Vendor reference |
| `payment_terms` / `delivery_terms` / `freight_terms` | Terms |
| `status` | OPEN, CLOSED, CANCELLED |
| `basic_total` / `tax_total` / `freight_value` / `total_value` | Amounts |

### PO Lines

| Field | Description |
|-------|-------------|
| `source_type` | INVENTORY_PR, ARTWORK_PLATE, ARTWORK_DIE |
| `source_ref` | Reference (PR number or artwork key) |
| `item_code` / `item_name` | Item details |
| `qty` / `rate` / `amount` | Line values |
| `tax_pct` / `tax_amount` / `total_amount` | Tax details |
| `department` / `job_ref` | Tracking fields |

### PO Receipts

| Field | Description |
|-------|-------------|
| `po_line_id` | FK to PO line |
| `source_type` | Receipt source type |
| `receipt_date` | Date received |
| `challan_no` | Supplier's delivery challan |
| `qty` / `rate` | Received quantity and rate |

## Key Functions (Code.gs)

| Function | Purpose |
|----------|---------|
| `purchaseListVendorsJSON()` | List all vendors |
| `purchaseSaveVendor(payload)` | Create or update a vendor |
| `purchaseSetVendorStatus(payload)` | Activate/deactivate vendor |
| `purchaseListPOsJSON(opts)` | List purchase orders |
| `purchaseCreatePO(payload)` | Create a new PO from inventory PRs |
| `purchaseCreateArtworkPO(payload)` | Create a PO for plate/die procurement |
| `purchaseUpdatePO(payload)` | Update an existing PO |
| `purchaseReceivePOLine(payload)` | Receive against a PO line |
| `purchaseReceiveArtworkPOLine(payload)` | Receive artwork plate/die |
| `purchaseReceiveArtworkPOBulk(payload)` | Bulk receive artwork items |
| `purchaseGetPOPrintData(poNo)` | Get PO data for printing |
| `purchaseDashboardSummaryJSON(opts)` | Purchase dashboard summary |
| `purchaseBootstrapJSON(opts)` | Initial load data for purchase module |

## PO Creation Flows

### Inventory PO

1. Purchase requests created from inventory module
2. `purchaseListInventoryRequestsJSON()` shows open PRs
3. User selects PRs and creates PO via `purchaseCreatePO()`
4. PO lines reference PRs via `source_type: INVENTORY_PR`, `source_ref: PR number`
5. On receipt (`purchaseReceivePOLine`):
   - Creates `purchase_po_receipts` entry
   - Posts inventory receipt (`invPostPOReceiptLine_`)
   - Updates PR received_qty
   - Auto-closes PR if fully received
   - Updates PO status if all lines received

### Artwork PO (Plate/Die)

1. Artwork with `plate_status: NEW` or `die_status: NEW` appears in procurement screen
2. User creates artwork PO via `purchaseCreateArtworkPO()`
3. PO lines have `source_type: ARTWORK_PLATE` or `ARTWORK_DIE`
4. `source_ref` = artwork_key
5. On receipt:
   - Updates `purchase_artwork_procurement` record
   - Updates artwork plate/die status

## PO Status Management

`_purchaseUpdatePOStatus_(poNo)` auto-derives PO status:
- Check each line: ordered_qty vs received_qty
- If all lines fully received: status = CLOSED
- Otherwise: status = OPEN

## Artwork Procurement Tracking

`purchase_artwork_procurement` tracks plate/die procurement independently of POs:

| Field | Description |
|-------|-------------|
| `artwork_key` | Unique identifier (artwork_no or so_id + line_no) |
| `type` | PLATE or DIE |
| `vendor` | Supplier |
| `ordered_on` / `received_on` | Order and receipt dates |
| `challan_no` | Delivery challan reference |
| `count` / `cost` | Quantity and cost |
| `status` | ACTIVE, etc. |
| `plate_size` / `plate_count` | Plate details |
| `die_count` | Die details |

## Views

| View | Purpose |
|------|---------|
| `v_purchase_plate_die_jobs` | Artworks needing plate/die procurement |
| `v_purchase_requests_open` | Open inventory purchase requests with pending qty |

## Integration

- **Inventory**: PO receipts post to inventory ledger; PRs drive PO creation
- **Artwork**: Plate/die procurement tracked against artworks
- **Reports**: Procurement section in dashboard
