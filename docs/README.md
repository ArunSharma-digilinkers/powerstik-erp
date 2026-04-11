# Powerstik ERP

An in-house ERP system for a printing & packaging company, built on **Google Sheets** (user interface), **Google Apps Script** (integration layer), and **Supabase / PostgreSQL** (data layer).

## What This System Does

Manages the full order-to-invoice lifecycle for a printing and packaging operation:

1. **Sales Orders** - Capture customer orders with line-level products, pricing, GST, and delivery dates
2. **Artwork Management** - Track artwork preparation, plate/die status, and approvals (accounts + business)
3. **Work Orders** - Bundle approved SO lines into production-ready work orders with materials and routing (offset + flexo)
4. **Production** - Record machine-level output (produced, rejected, OK qty) against routing steps with real-time tracking
5. **Packing & Dispatch** - Track packed quantities, dispatch readiness, and shipment details per SO line
6. **Invoicing** - Generate invoices and delivery challans with GST breakup, bill-to/ship-to parties, and transport details
7. **Inventory** - Manage raw materials with lot tracking, purchase requests, issue/receipt, and stock analytics
8. **Purchasing** - Vendor management, purchase orders, receipts, and artwork plate/die procurement
9. **Item Master** - Product catalog with BOM (Bill of Materials), revision control, and routing templates
10. **Costing** - Product cost estimation with raw material + process breakup, master rate revisions
11. **FG Stock** - Finished goods stock tracking, opening balances, adjustments, and dispatch
12. **Reports & Planning** - Dashboard with delivery performance, production bottleneck, traceability, and planning views

## Architecture at a Glance

```
Google Sheets Web App         Google Apps Script           Supabase (Backend)
+-------------------+        +-------------------+        +------------------+
| HTML Pages        | -----> | Code.gs           | -----> | PostgreSQL DB    |
| (served by doGet) |        | (~20,500 lines)   |  REST  | 43+ Tables       |
| Module-based UI   | <----- | Supabase helpers  | <----- | 30+ Views        |
| Auth-gated pages  |        | Session/RBAC mgmt |  API   | Triggers/Funcs   |
+-------------------+        +-------------------+        +------------------+
```

- **Frontend**: Google Sheets workbook deployed as a web app via `doGet()`. Each module (order entry, artwork, production, etc.) is a separate page served by Apps Script.
- **Auth**: Custom session-based authentication. Users log in with credentials stored in `users` table. Sessions tracked in `erp_sessions`. Access controlled by role-based permissions (`roles` + `role_permissions`).
- **Integration**: Apps Script makes REST calls to Supabase PostgREST API using service role key stored in Script Properties.
- **Backend**: Supabase project providing PostgreSQL database, REST API, triggers, functions, and materialized views.

## Core Data Model

```
clients ──> client_parties (bill-to/ship-to)
  |
  v
sales_orders ──> sales_order_lines ──> sales_order_rollup_cache
  |                    |
  v                    v
artworks          packing_records ──> dispatch_records
  |                                        |
  v                                        v
work_orders ──> work_order_jobs       fg_stock_adjustments
  |
  ├──> work_order_materials ──> inv_ledger (issue)
  |
  └──> work_order_routing
            |
            ├──> production_entries
            └──> production_live_entries

invoices ──> invoice_lines ──> (links to sales_orders + sales_order_lines)

items ──> item_bom_revisions ──> item_bom_materials
                              └──> item_bom_routing

inv_items ──> inv_ledger ──> inv_lots ──> inv_lot_allocations
              inv_purchase_requests

purchase_vendors ──> purchase_orders ──> purchase_order_lines
                                     └──> purchase_po_receipts

costing_master_revisions ──> costing_records ──> costing_line_items
                                              └──> costing_audit_log
```

### Key Tables

| Table | Purpose |
|-------|---------|
| **Order Flow** | |
| `clients` | Customer master - code, name, state, GSTIN, PAN, credit days |
| `client_parties` | Multiple bill-to/ship-to addresses per client |
| `sales_orders` | Order header - SO number, client, date, PO reference, transport |
| `sales_order_lines` | Line items - product, qty, rate, GST, accounts/business approval |
| `sales_order_rollup_cache` | Cached approval & WO status rollup for fast listing |
| **Artwork** | |
| `artworks` | Artwork specs per SO line - plate/die details, sheet layout, UPS |
| `artwork_sequences` | Auto-incrementing artwork numbers by prefix |
| **Work Orders** | |
| `work_orders` | Production batch header - WO number, date, status, snapshot JSON |
| `work_order_jobs` | SO lines pulled into a work order with production-relevant fields |
| `work_order_materials` | Raw materials required per WO (paper GSM, deckle, cut size) |
| `work_order_routing` | Process steps (sequence, department, machine, planned vs completed qty) |
| **Production** | |
| `production_entries` | Machine-level production logs (operator, qty produced/rejected, downtime) |
| `production_live_entries` | Real-time production tracking (RUNNING/COMPLETED/STOPPED/HOLD) |
| **Packing & Dispatch** | |
| `packing_records` | Packing status per SO line - packed qty, dispatch readiness |
| `dispatch_records` | Dispatch records - qty, transporter, vehicle, LR number |
| `fg_opening_stock` | Finished goods opening balances |
| `fg_stock_adjustments` | FG stock adjustments |
| **Invoicing** | |
| `invoices` | Invoice/challan header - bill-to/ship-to, transport, GST totals |
| `invoice_lines` | Invoice line items linked to SO lines with billing snapshots |
| **Item Master** | |
| `items` | Product catalog - item code, category, HSN, GST, manufacturing flag |
| `item_bom_revisions` | BOM revisions (DRAFT/ACTIVE/ARCHIVED) |
| `item_bom_materials` | BOM materials per revision |
| `item_bom_routing` | BOM routing steps per revision |
| **Inventory** | |
| `inv_items` | Raw material items (department-wise) |
| `inv_ledger` | Inventory movement ledger (single-direction: in or out) |
| `inv_lots` | Lot/batch tracking (FIFO) |
| `inv_purchase_requests` | Inventory purchase requests |
| **Purchasing** | |
| `purchase_vendors` | Vendor master |
| `purchase_orders` / `purchase_order_lines` | PO headers and line items |
| `purchase_po_receipts` | PO receipt entries |
| `purchase_artwork_procurement` | Artwork plate/die procurement |
| **Costing** | |
| `costing_records` | Product costing (sticker costing) |
| `costing_line_items` | Costing line items (raw material + process) |
| `costing_master_revisions` | Versioned costing master data |
| **Auth** | |
| `users` | User accounts with password hash |
| `roles` / `role_permissions` | RBAC role and permission definitions |
| `erp_sessions` | Session tokens |

### Key Views

| View | Purpose |
|------|---------|
| `v_artwork_jobs` | Artwork department working screen (joins artworks + SO + client) |
| `v_workorder_candidates` | Approved SO lines eligible for WO creation (with remaining qty) |
| `v_sales_orders_list_fast` | Fast SO listing with rollup cache integration |
| `v_production_stage_queue_fast` | Production queue with planned/produced/balance per routing step |
| `v_production_stage_rows_fast` | Combined sheet flow + job-level split production rows |
| `v_packing_queue_fast` | Packing queue with production totals |
| `v_dispatch_queue_fast` | Dispatch queue for ready-to-dispatch items |
| `v_billing_line_read_model` | Billing read model (order/packed/dispatched/billed quantities) |
| `v_billing_document_register` | Invoice and challan register |
| `v_report_planning_lines` | Full lifecycle planning view |
| `v_report_order_line_traceability` | End-to-end traceability per SO line |
| `v_report_delivery_performance` | On-time vs delayed delivery analysis |
| `v_report_production_bottleneck` | Production bottleneck identification |
| `inv_stock_mv` | Materialized view: current stock balances |
| `inv_stock_analytics_mv` | Materialized view: stock analytics and reorder levels |

## Order Lifecycle

```
SO Created ─> Lines Added ─> Artwork Prepared ─> Accounts Approved
                                                        |
                                                  Business Approved
                                                        |
                                              WO Created (snapshot taken)
                                                        |
                                              Materials Issued (from Inventory)
                                                        |
                                              Production Logged (per routing step)
                                                        |
                                              Packing Recorded
                                                        |
                                              Dispatch Recorded
                                                        |
                                              Invoice Generated ─> Posted
```

**Key gate**: A sales order line can only become a work order candidate when:
- Artwork status = `APPROVED`
- Accounts status = `APPROVED`
- Business status = `APPROVED`
- SO number starts with `SL` (trading orders with `M` prefix bypass artwork/WO flow)
- Product is not a service-only item (Flexo Plate, Offset Plate, Die)

**Work Order types**:
- **Offset/Digital WO** (`WOW` module) - Sheet-based production with paper calculations
- **Flexo WO** (`FLEXOWO` module) - Roll-based production with cylinder/teeth calculations

## Business Rules Enforced in Database

| Rule | Mechanism |
|------|-----------|
| Auto-set `updated_at` on artwork changes | Trigger: `trg_artworks_updated` |
| Auto-maintain SO rollup cache | Triggers on `sales_orders`, `sales_order_lines`, `work_order_jobs` |
| Prevent editing/deleting posted invoice lines | Trigger: `trg_lock_invoice_lines` |
| Invoice status restricted to DRAFT/POSTED/CANCELLED | Check constraint: `invoice_status_chk` |
| One packing record per SO line | Unique index: `uq_packing_records_so_line_id` |
| One invoice line per SO line per invoice | Unique index: `ux_invoice_so_line` |
| One material entry per material key per WO | Unique index: `uq_wom_material` |
| Only one default BILL_TO per client | Partial unique index: `uq_client_parties_one_default_bill_to` |
| Only one default SHIP_TO per client | Partial unique index: `uq_client_parties_one_default_ship_to` |
| Inventory ledger: single-direction entries | Check constraint: `chk_single_direction` |
| Inventory ledger: non-negative quantities | Check constraint: `qty_positive_check` |
| Costing order qty must be positive | Check constraint: `costing_records_order_qty_chk` |
| Production live entries: non-negative quantities | Check constraint: `production_live_entries_qty_chk` |
| BOM materials must have qty > 0 | Check constraint: `item_bom_materials_qty_chk` |
| Items can only be Flat/Corrugated/Flexo | Check constraint: `items_product_category_chk` |

## Documentation Map

### Architecture
| Document | What You'll Find |
|----------|-----------------|
| [System Overview](architecture/overview.md) | Three-tier architecture, auth, RBAC, API layer |
| [Data Flow](architecture/data-flow.md) | SO creation flow, caching, rollup cache, materialized views |
| [ERP Lifecycle](architecture/erp-lifecycle.md) | Complete order-to-invoice lifecycle |

### Database
| Document | What You'll Find |
|----------|-----------------|
| [Schema Overview](database/schema-overview.md) | All 43+ tables with columns, types, constraints |
| [Business Rules](database/business-rules.md) | Triggers, constraints, validation rules |
| [Views](database/views.md) | All 30+ views and materialized views |

### Modules
| Document | What You'll Find |
|----------|-----------------|
| [Sales Orders](modules/sales-orders.md) | SO creation, approval workflow, listing, lifecycle |
| [Artwork Management](modules/artwork-management.md) | Artwork workbench, approval, plate/die tracking |
| [Work Orders](modules/work-orders.md) | Offset + Flexo WO creation, materials, routing |
| [Production](modules/production.md) | Stage queue, production entry, combined/job rows |
| [Packing & Dispatch](modules/packing-dispatch.md) | Packing, dispatch, FG stock management |
| [Invoicing](modules/invoicing.md) | Invoice/challan creation, GST, posting, locking |
| [Clients](modules/clients.md) | Client master, multi-party addresses |
| [Inventory](modules/inventory.md) | Ledger, lots, FIFO, issue/receipt, purchase requests |
| [Purchasing](modules/purchasing.md) | Vendors, POs, receipts, artwork procurement |
| [Item Master](modules/item-master.md) | Product catalog, BOM revisions, item merge |
| [Costing](modules/costing.md) | Product cost estimation, master revisions |
| [Auth & RBAC](modules/auth-rbac.md) | Authentication, sessions, roles, permissions |

### Operations
| Document | What You'll Find |
|----------|-----------------|
| [Web App Page Map](sheets/workbook-map.md) | Page routing, module map, master data, constants |
| [Adding a Client](runbooks/adding-a-new-client.md) | Step-by-step client creation guide |
| [Creating a Work Order](runbooks/creating-a-work-order.md) | WO creation guide (offset + flexo) |
| [Handling Billing Errors](runbooks/handling-a-billing-error.md) | Draft/posted invoice error resolution |

### Decisions
| Document | What You'll Find |
|----------|-----------------|
| [ADR-001: Sheets as Frontend](decisions/adr-001-sheets-as-frontend.md) | Why Google Sheets was chosen as the UI |
| [ADR-002: Snapshot JSON in WO](decisions/adr-002-snapshot-json-in-wo.md) | Why work orders store immutable JSON snapshots |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| User Interface | Google Sheets (deployed as web app via `doGet()`) |
| Scripting | Google Apps Script (`Code.gs`) |
| Database | PostgreSQL (via Supabase) |
| API | Supabase REST API (PostgREST) |
| Auth | Custom session-based auth + RBAC (roles/permissions) |
| Hosting | Supabase cloud + Google Apps Script |
| Caching | Google Apps Script `CacheService` (600s TTL) |
