# Powerstik ERP

An in-house ERP system for a printing & packaging company, built on **Google Sheets** (user interface), **Google Apps Script** (integration layer), and **Supabase / PostgreSQL** (data layer).

## What This System Does

Manages the full order-to-invoice lifecycle for a printing and packaging operation:

1. **Sales Orders** - Capture customer orders with line-level products, pricing, GST, and delivery dates
2. **Artwork Management** - Track artwork preparation, plate/die status, and approvals (accounts + business)
3. **Work Orders** - Bundle approved SO lines into production-ready work orders with materials and routing (offset + flexo)
4. **Production** - Record machine-level output (produced, rejected, OK qty) against routing steps with audit logging
5. **Packing & Dispatch** - Track packed quantities, dispatch readiness, and shipment details per SO line, with full per-posting audit log
6. **Invoicing** - Generate invoices and delivery challans with GST breakup, bill-to/ship-to parties, and transport details
7. **Inventory** - Manage raw materials with lot tracking, purchase requests, issue/receipt, sheet conversions, rate corrections, returns to supplier, and stock analytics
8. **Purchasing** - Vendor management, purchase orders, receipts, and artwork plate/die procurement (with a dedicated tooling workbench)
9. **Item Master** - Product catalog with BOM (Bill of Materials), revision control, and routing templates
10. **Costing** - Product cost estimation with raw material + process breakup, master rate revisions
11. **FG Stock** - Finished goods stock tracking, opening balances, adjustments, and dispatch
12. **Checklist / Tasks** - Daily / periodic task management with weekly-offs, holidays, and assignment tracking
13. **Reports & Planning** - Dashboard with delivery performance, production bottleneck, traceability, planning, WIP/Pre-WIP ageing, machine load, sheet utilisation, and job profitability views

## Architecture at a Glance

```
Google Sheets Web App         Google Apps Script           Supabase (Backend)
+-------------------+        +-------------------+        +------------------+
| HTML Pages        | -----> | Code.gs           | -----> | PostgreSQL DB    |
| (served by doGet) |        | (~34,200 lines)   |  REST  | 60+ Tables       |
| Module-based UI   | <----- | Supabase helpers  | <----- | 80+ Views        |
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
  |                    └─> packing_entry_log         └─> fg_stock_adjustments
  v
work_orders ──> work_order_jobs
  |
  ├──> work_order_materials ──> inv_ledger (issue)
  |
  └──> work_order_routing
            |
            ├──> production_entries ──> production_entry_audit_log
            └──> corrugation_2ply_entry_details

invoices ──> invoice_lines ──> (links to sales_orders + sales_order_lines)

items ──> item_bom_revisions ──> item_bom_materials
                              └──> item_bom_routing

inv_items ──> inv_ledger ──> inv_lots ──> inv_lot_allocations
              inv_purchase_requests
              inv_sheet_conversions ──> inv_sheet_conversion_lines
                                    └──> inv_sheet_conversion_allocations
              inv_rts_returns
              inv_rate_corrections

purchase_vendors ──> purchase_orders ──> purchase_order_lines
                                     └──> purchase_po_receipts
                                     └──> purchase_artwork_procurement

costing_master_revisions ──> costing_records ──> costing_line_items
                                              └──> costing_audit_log

checklist_task_templates ──> checklist_task_versions ──> checklist_task_instances
                                                    └──> checklist_task_assignments
                                                    └──> checklist_task_audit_log
                                                    └──> checklist_notification_log
checklist_weekly_offs / checklist_holidays (calendar inputs)
```

### Key Tables

| Table | Purpose |
|-------|---------|
| **Order Flow** | |
| `clients` | Customer master - code, name, state, GSTIN, PAN, credit days |
| `client_parties` | Multiple bill-to/ship-to addresses per client |
| `sales_orders` | Order header - SO number, client, date, PO reference, transport |
| `sales_order_lines` | Line items - product, qty, rate, GST, accounts/business approval, line status |
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
| `production_entry_audit_log` | Audit trail for production entry edits |
| `corrugation_2ply_entry_details` | 2-ply corrugation specs (liner item, fluting item, flute type, set numbers) |
| **Packing & Dispatch** | |
| `packing_records` | Packing status per SO line - packed qty, dispatch readiness |
| `packing_entry_log` | Per-posting packing transaction log |
| `packing_entry_audit_log` | Audit trail for packing edits |
| `dispatch_records` | Dispatch records - qty, transporter, vehicle, LR number |
| `fg_opening_stock` | Finished goods opening balances |
| `fg_stock_adjustments` | FG stock adjustments |
| **Invoicing** | |
| `invoices` | Invoice/challan header - bill-to/ship-to, transport, GST totals |
| `invoice_lines` | Invoice line items linked to SO lines with billing snapshots |
| `billing_division_bulk_fix` | Staging table for bulk billing-division corrections |
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
| `inv_sheet_conversions` (+ `_lines`, `_allocations`) | Sheet conversion postings (raw sheet → cut sizes) |
| `inv_rts_returns` | Returns to supplier |
| `inv_rate_corrections` | Post-hoc rate adjustments with audit |
| **Purchasing** | |
| `purchase_vendors` | Vendor master |
| `purchase_orders` / `purchase_order_lines` | PO headers and line items |
| `purchase_po_receipts` | PO receipt entries |
| `purchase_artwork_procurement` | Artwork plate/die procurement |
| **Costing** | |
| `costing_records` | Product costing (sticker costing) |
| `costing_line_items` | Costing line items (raw material + process) |
| `costing_master_revisions` | Versioned costing master data |
| **Checklist** | |
| `checklist_task_templates` / `checklist_task_versions` | Task definitions & versioning |
| `checklist_task_instances` / `checklist_task_assignments` | Day-level instances and assignments |
| `checklist_weekly_offs` / `checklist_holidays` | Calendar inputs that skip instance creation |
| `checklist_task_audit_log` / `checklist_notification_log` | Audit and notification trail |
| **Auth** | |
| `users` | User accounts with password hash |
| `roles` / `role_permissions` | RBAC role and permission definitions |
| `erp_sessions` | Session tokens |

### Key Views

Operational / workflow:

| View | Purpose |
|------|---------|
| `v_artwork_jobs` / `_active` | Artwork department working screen |
| `v_artwork_groups` / `_active` | Artwork approval-group rollup |
| `v_artwork_workbench_active` | Workbench dataset used by the artwork module |
| `v_artwork_reference` | Reference lookup for prior artwork specs |
| `v_workorder_candidates` / `_active` | Approved SO lines eligible for WO creation |
| `v_flexo_work_order_jobs` | Flexo-specific WO job details |
| `v_sales_orders_list_fast` | Fast SO listing with rollup cache |
| `v_sales_order_line_details` | SO line details with computed fields |
| `v_sales_order_lines_for_approval` | Lines pending accounts/business approval |
| `v_sales_order_item_picker` | SO entry item picker |
| `v_sales_order_advance_payment_clearance` | Advance-payment clearance tracking |
| `v_production_stage_queue_fast` | Production queue with planned/produced/balance |
| `v_production_stage_rows_fast` | Combined + job-level production rows |
| `v_production_jobcard_lookup_fast` | Production job-card lookup |
| `v_packing_queue_fast` / `v_packing_board` | Packing queue / board |
| `v_dispatch_queue_fast` / `v_dispatch_board` | Dispatch queue / board |
| `v_fg_stock_available` | FG stock available for dispatch |
| `v_billed_order_closure` | Orders fully billed |
| `v_billing_line_read_model` | Billing read model (order/packed/dispatched/billed) |
| `v_billing_document_register` | Invoice / challan register |
| `v_billing_packing_summary` / `v_billing_dispatch_summary` | Inputs to the billing screen |
| `v_billing_invoice_usage_summary` | Invoice number usage by FY / prefix |
| `v_billing_division_needs_fix` | Invoices with division discrepancies |
| `v_client_master_register` | Client master register |
| `v_checklist_task_instances_ui` / `v_checklist_user_summary` | Checklist UI + user summary |

Inventory / purchase:

| View | Purpose |
|------|---------|
| `inv_stock_reconciled_v` | Reconciled stock balances |
| `inv_issue_register_v` / `inv_receipt_register_v` | Issue / receipt registers |
| `inv_adjustment_register_v` | Stock-adjustment register |
| `inv_rfp_register_v` | Inventory PR register |
| `inv_rts_register_v` | Return-to-supplier register |
| `v_inventory_transaction_register` | Combined inventory transaction register |
| `inv_wo_issue_requirement_v` / `_fast_v` | WO material requirement |
| `inv_wo_issue_status_v` / `_fast_v` | WO issue status |
| `inv_wo_issue_material_source_v` | Material source (lots) for WO issue |
| `v_purchase_plate_die_jobs` | Artworks needing plate/die procurement |
| `v_purchase_requests_open` | Open inventory PRs |
| `v_pr_po_receipt_cycle` | PR → PO → Receipt lifecycle |
| `v_purchase_dashboard_core_metrics` | Purchase dashboard KPIs |
| `v_purchase_lead_time_items` | Vendor lead-time analysis |
| `v_purchase_order_summary` | PO summary |
| `v_purchase_orders_read_model` | Optimised PO read model |
| `v_purchase_po_print_lines` | PO print formatting |
| `v_purchase_tooling_workbench` | Plate/die procurement workbench |
| `v_purchase_tooling_pending_summary` | Pending tooling summary |
| `v_purchase_tooling_register_search` | Tooling register search |

Reports & analytics:

| View | Purpose |
|------|---------|
| `v_report_planning_lines` / `_enriched` | Planning report (full lifecycle) |
| `v_report_planning_material_status` | Material readiness per planning line |
| `v_report_planning_tooling_status` | Tooling readiness per planning line |
| `v_report_order_line_traceability` | End-to-end traceability per SO line |
| `v_report_delivery_performance` | On-time vs delayed delivery |
| `v_report_production_bottleneck` | Production bottleneck analysis |
| `v_report_unbilled_dispatch` | Unbilled dispatched items |
| `v_report_billing_register` / `v_report_dispatch_register` | Billing / dispatch transaction registers |
| `v_report_dispatch_discrepancy_lines` | Short / excess dispatch vs SO |
| `v_report_pre_wip_ageing_lines` / `_summary` | Pre-WIP ageing |
| `v_report_wip_ageing_lines` / `_summary` / `_all_lines` | WIP ageing reports |
| `v_report_wip_stage_lines` / `_summary` / `_reconciliation` | WIP by production stage |
| `v_report_machine_load_lines` / `_machine_cleanup` / `_missing_targets` | Machine load analysis |
| `v_report_sheet_utilization` / `_lines` | Sheet utilisation reports |
| `v_report_production_nop_daily` / `_machine_cleanup` | Net output per machine (daily) |
| `v_report_job_profitability_phase1` / `_production_stages` | Job-level margin / cost analysis |
| `v_report_department_purchase_grn` | Department-wise purchase / GRN |
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
| Auto-create the artwork row for every new SO line | Trigger: `trg_sales_order_lines_ensure_artwork` |
| Auto-maintain SO rollup cache | Triggers on `sales_orders`, `sales_order_lines`, `work_order_jobs` |
| Auto-maintain `sales_order_lines.status` | Five triggers: `trg_sales_order_line_status_from_line` / `_from_order` / `_from_dispatch` / `_from_invoice_line` / `_from_invoice` |
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
| [Schema Overview](database/schema-overview.md) | All 60+ tables with columns, types, constraints |
| [Business Rules](database/business-rules.md) | Triggers, constraints, validation rules |
| [Views](database/views.md) | All 80+ views and materialized views |

### Modules
| Document | What You'll Find |
|----------|-----------------|
| [Sales Orders](modules/sales-orders.md) | SO creation, approval workflow, listing, lifecycle |
| [Artwork Management](modules/artwork-management.md) | Artwork workbench, approval, plate/die tracking |
| [Work Orders](modules/work-orders.md) | Offset + Flexo WO creation, materials, routing |
| [Production](modules/production.md) | Stage queue, production entry, audit trail |
| [Packing & Dispatch](modules/packing-dispatch.md) | Packing, dispatch, FG stock, entry audit log |
| [Invoicing](modules/invoicing.md) | Invoice/challan creation, GST, posting, locking |
| [Clients](modules/clients.md) | Client master, multi-party addresses |
| [Inventory](modules/inventory.md) | Ledger, lots, FIFO, issue/receipt, PRs, RTS, rate corrections |
| [Sheet Conversion](modules/sheet-conversion.md) | Sheet-to-sheet conversion with lot allocation |
| [Purchasing](modules/purchasing.md) | Vendors, POs, receipts, artwork & tooling procurement |
| [Item Master](modules/item-master.md) | Product catalog, BOM revisions, item merge |
| [Costing](modules/costing.md) | Product cost estimation, master revisions |
| [Checklist / Tasks](modules/checklist.md) | Task templates, daily instances, audit, calendar |
| [Reports](modules/reports.md) | Dashboard, planning, WIP/Pre-WIP, machine load, profitability |
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
