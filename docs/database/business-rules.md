# Database Business Rules

This document catalogs all triggers, check constraints, unique constraints, and enforced business rules in the Powerstik ERP database.

---

## Triggers

### Timestamp Auto-Update Triggers

These triggers fire BEFORE UPDATE on their respective tables, setting the `updated_at` column to the current time.

| Trigger | Table | Function |
|---------|-------|----------|
| `trg_artworks_updated` | artworks | `set_artwork_updated_at()` |
| `trg_client_parties_updated_at` | client_parties | `set_client_parties_updated_at()` |
| `trg_costing_line_items_updated_at` | costing_line_items | `set_updated_at_timestamp()` |
| `trg_costing_master_revisions_updated_at` | costing_master_revisions | `set_updated_at_timestamp()` |
| `trg_costing_records_updated_at` | costing_records | `set_updated_at_timestamp()` |
| `trg_item_bom_materials_updated_at` | item_bom_materials | `set_updated_at_timestamp()` |
| `trg_item_bom_revisions_updated_at` | item_bom_revisions | `set_updated_at_timestamp()` |
| `trg_item_bom_routing_updated_at` | item_bom_routing | `set_updated_at_timestamp()` |
| `trg_production_live_entries_updated_at` | production_live_entries | `set_production_live_entries_updated_at()` |

Note: Two generic function names are used. `set_updated_at_timestamp()` is shared across costing and BOM tables. `set_artwork_updated_at()`, `set_client_parties_updated_at()`, and `set_production_live_entries_updated_at()` are table-specific variants (the function source code is in Supabase and must be exported separately).

---

### Invoice Line Lock Trigger

| Trigger | Table | Event | Function |
|---------|-------|-------|----------|
| `trg_lock_invoice_lines` | invoice_lines | BEFORE DELETE OR UPDATE | `lock_invoice_lines()` |

**Purpose:** Prevents modification or deletion of invoice lines once the parent invoice has been POSTED. This is a critical financial integrity rule -- once an invoice is posted, its line items become immutable.

**Behavior:** The trigger function checks the status of the parent invoice. If the invoice status is `POSTED`, the trigger raises an exception and blocks the DELETE or UPDATE operation.

---

### Sales Order Rollup Triggers

These three triggers maintain the `sales_order_rollup_cache` table, which denormalizes aggregated status and quantity data from multiple source tables into a single row per sales order.

| Trigger | Table | Event | Function |
|---------|-------|-------|----------|
| `trg_sales_order_rollup_from_lines` | sales_order_lines | AFTER INSERT/DELETE/UPDATE | `sales_order_rollup_from_lines_trg()` |
| `trg_sales_order_rollup_from_sales_orders` | sales_orders | AFTER INSERT/DELETE/UPDATE | `sales_order_rollup_from_sales_orders_trg()` |
| `trg_sales_order_rollup_from_work_order_jobs` | work_order_jobs | AFTER INSERT/DELETE/UPDATE | `sales_order_rollup_from_work_order_jobs_trg()` |

**Purpose:** The rollup cache provides pre-computed values used by the fast sales order list view (`v_sales_orders_list_fast`). Fields maintained include:

- `line_count`, `total_qty` -- aggregated from sales_order_lines
- `accounts_status`, `business_status` -- derived from per-line approval statuses
- `wo_status` -- derived from work_order_jobs (PENDING if no WO jobs exist, CREATED otherwise)
- `is_approval_hold` -- true if any line is on HOLD
- `can_edit`, `can_hold`, `can_cancel` -- UI action flags based on SO status
- `hold_target`, `hold_label` -- toggle behavior for hold/reopen action
- `latest_delivery` -- max of final_delivery/expected_delivery across lines

---

## Check Constraints

### Invoice Status

| Constraint | Table | Rule |
|------------|-------|------|
| `invoice_status_chk` | invoices | status IN ('DRAFT', 'POSTED', 'CANCELLED') |

---

### Client Parties

| Constraint | Table | Rule |
|------------|-------|------|
| `client_parties_address_type_check` | client_parties | address_type IN ('BILL_TO', 'SHIP_TO') |
| `client_master_import_staging_address_type_check` | client_master_import_staging | address_type IN ('BILL_TO', 'SHIP_TO') |

---

### Sales Orders

| Constraint | Table | Rule |
|------------|-------|------|
| `sales_orders_transport_payment_chk` | sales_orders | transport_payment IS NULL OR IN ('To Pay', 'Paid') |

---

### Production Live Entries

| Constraint | Table | Rule |
|------------|-------|------|
| `production_live_entries_status_chk` | production_live_entries | status IN ('RUNNING', 'COMPLETED', 'STOPPED', 'HOLD') |
| `production_live_entries_qty_chk` | production_live_entries | produced_qty >= 0 AND rejected_qty >= 0 AND ok_qty >= 0 AND downtime_minutes >= 0 |

---

### Costing Records

| Constraint | Table | Rule |
|------------|-------|------|
| `costing_records_status_chk` | costing_records | status IN ('DRAFT', 'REVIEWED', 'APPROVED', 'ARCHIVED') |
| `costing_records_product_type_chk` | costing_records | product_type = 'STICKER' |
| `costing_records_dimension_mode_chk` | costing_records | dimension_mode IN ('IN', 'MM') |
| `costing_records_order_qty_chk` | costing_records | order_qty > 0 |
| `costing_records_order_qty_wastage_chk` | costing_records | order_qty_with_wastage >= order_qty |
| `costing_records_printing_colors_chk` | costing_records | printing_colors >= 0 |

---

### Costing Line Items

| Constraint | Table | Rule |
|------------|-------|------|
| `costing_line_items_product_type_chk` | costing_line_items | product_type = 'STICKER' |
| `costing_line_items_group_chk` | costing_line_items | line_group IN ('RAW_MATERIAL', 'PROCESS') |
| `costing_line_items_source_chk` | costing_line_items | line_source IN ('STANDARD', 'ADDITIONAL') |

---

### Costing Master Revisions

| Constraint | Table | Rule |
|------------|-------|------|
| `costing_master_revisions_status_chk` | costing_master_revisions | status IN ('DRAFT', 'ACTIVE', 'ARCHIVED') |

---

### Costing Audit Log

| Constraint | Table | Rule |
|------------|-------|------|
| `costing_audit_log_entity_type_chk` | costing_audit_log | entity_type IN ('COSTING', 'MASTER') |

---

### Item BOM Revisions

| Constraint | Table | Rule |
|------------|-------|------|
| `item_bom_revisions_status_chk` | item_bom_revisions | status IN ('DRAFT', 'ACTIVE', 'ARCHIVED') |
| `item_bom_revisions_bom_basis_chk` | item_bom_revisions | bom_basis = 'PER_UNIT' |
| `item_bom_revisions_base_qty_chk` | item_bom_revisions | base_quantity > 0 |
| `item_bom_revisions_output_qty_chk` | item_bom_revisions | output_quantity > 0 |

---

### Item BOM Materials

| Constraint | Table | Rule |
|------------|-------|------|
| `item_bom_materials_qty_chk` | item_bom_materials | qty_per_unit > 0 |
| `item_bom_materials_wastage_chk` | item_bom_materials | wastage_pct >= 0 |

---

### Item BOM Routing

| Constraint | Table | Rule |
|------------|-------|------|
| `item_bom_routing_setup_time_chk` | item_bom_routing | setup_time_min >= 0 |
| `item_bom_routing_run_time_chk` | item_bom_routing | run_time_min >= 0 |
| `item_bom_routing_rate_chk` | item_bom_routing | standard_rate_qty_per_hour IS NULL OR > 0 |

---

### Items

| Constraint | Table | Rule |
|------------|-------|------|
| `items_bom_basis_chk` | items | bom_basis = 'PER_UNIT' |
| `items_lifecycle_status_chk` | items | item_lifecycle_status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'OBSOLETE') |
| `items_product_category_chk` | items | product_category IS NULL OR IN ('Flat', 'Corrugated', 'Flexo') |
| `items_wo_module_chk` | items | wo_module IS NULL OR IN ('WOW', 'FLEXOWO') |

---

### Inventory Ledger

| Constraint | Table | Rule |
|------------|-------|------|
| `chk_single_direction` | inv_ledger | (qty_in > 0 AND qty_out = 0) OR (qty_out > 0 AND qty_in = 0) |
| `not_both_qty_check` | inv_ledger | NOT (qty_in > 0 AND qty_out > 0) |
| `qty_positive_check` | inv_ledger | qty_in >= 0 AND qty_out >= 0 |
| `rate_non_negative` | inv_ledger | rate >= 0 |

These four constraints together enforce that every ledger entry is either an inbound (qty_in > 0, qty_out = 0) or outbound (qty_out > 0, qty_in = 0) transaction. Mixed-direction entries are rejected at the database level.

---

## Unique Indexes and Constraints

### Partial Unique Indexes (Conditional Uniqueness)

| Index | Table | Columns | Condition | Purpose |
|-------|-------|---------|-----------|---------|
| `uq_client_parties_one_default_bill_to` | client_parties | (client_id) | WHERE address_type = 'BILL_TO' AND is_default = true | One default billing address per client |
| `uq_client_parties_one_default_ship_to` | client_parties | (client_id) | WHERE address_type = 'SHIP_TO' AND is_default = true | One default shipping address per client |
| `item_bom_revisions_current_uk` | item_bom_revisions | (item_code) | WHERE is_current | One current BOM revision per item |
| `costing_master_revisions_current_uk` | costing_master_revisions | (costing_type) | WHERE is_current | One current master revision per costing type |
| `uq_packing_records_so_line_id` | packing_records | (so_line_id) | WHERE so_line_id IS NOT NULL | One packing record per SO line |
| `idx_inv_lots_batch_no` | inv_lots | (batch_no) | -- (not partial, but unique) | Batch numbers are globally unique |

---

### Regular Unique Constraints

| Index / Constraint | Table | Columns | Purpose |
|--------------------|-------|---------|---------|
| `ux_invoice_so_line` | invoice_lines | (invoice_id, so_line_id) | One invoice line per SO line per invoice |
| `uq_wom_material` | work_order_materials | (wo_id, material_key) | One material entry per material key per WO |
| `uq_purchase_order_lines_po_line` | purchase_order_lines | (po_id, line_no) | Unique line numbers within a PO |
| `item_bom_materials_revision_line_uk` | item_bom_materials | (revision_id, line_no) | Unique material lines within a BOM revision |
| `item_bom_routing_revision_seq_uk` | item_bom_routing | (revision_id, sequence_no) | Unique sequence numbers within a BOM routing |
| `item_bom_revisions_item_revision_uk` | item_bom_revisions | (item_code, revision_no) | Unique revision numbers per item |
| `costing_master_revisions_type_revision_uk` | costing_master_revisions | (costing_type, revision_no) | Unique revision numbers per costing type |
| `idx_purchase_artwork_procurement_key` | purchase_artwork_procurement | (artwork_key, type) | One procurement record per artwork key and type |

---

## Foreign Key Cascade Rules

### CASCADE on DELETE

These foreign keys will automatically delete child records when the parent is deleted:

| Child Table | Parent Table | FK Column |
|-------------|-------------|-----------|
| client_parties | clients | client_id |
| sales_order_lines | sales_orders | so_id |
| invoice_lines | invoices | invoice_id |
| work_order_jobs | work_orders | wo_id |
| work_order_routing | work_orders | wo_id |
| production_entries | work_orders | wo_id |
| production_entries | work_order_routing | routing_id |
| purchase_order_lines | purchase_orders | po_id |
| item_bom_materials | item_bom_revisions | revision_id |
| item_bom_routing | item_bom_revisions | revision_id |
| role_permissions | roles | role_id |
| costing_line_items | costing_records | costing_id |
| costing_audit_log | costing_records | costing_id |
| costing_audit_log | costing_master_revisions | master_revision_id |
| fg_opening_dispatch_entries | fg_opening_stock | opening_id |

### RESTRICT on DELETE

| Child Table | Parent Table | FK Column | Reason |
|-------------|-------------|-----------|--------|
| costing_records | costing_master_revisions | master_revision_id | Prevent deleting master data referenced by cost estimates |
| item_bom_revisions | items | item_code | Prevent deleting items with BOM history |

### SET NULL on DELETE

| Child Table | Parent Table | FK Column |
|-------------|-------------|-----------|
| item_bom_revisions | item_bom_revisions | source_revision_id |

---

## Business Rules (Application-Level, Enforced via Views/Logic)

### Order Approval Gate

An SO line must have all three approvals before it can be included in a work order:

1. Artwork status must be APPROVED (checked via artworks table)
2. Accounts status must be APPROVED (sales_order_lines.accounts_status)
3. Business status must be APPROVED (sales_order_lines.business_status)

This rule is enforced by the `v_workorder_candidates` view, which computes `can_create_wo` as true only when all three conditions are met.

### SO Number Prefix Rule

The `v_workorder_candidates` view filters for active (non-cancelled) sales orders. SO numbers typically start with `SL` for standard orders.

### Service-Only Items Exclusion

Certain items (FLEXO PRINTING PLATE, OFFSET PRINTING PLATE, DIE) are excluded from work order candidates. These are service/procurement items, not manufactured products.

### Snapshot Immutability

When a work order is created, `work_orders.snapshot_json` captures the complete state of the sales order, jobs, papers, and wastage calculations at that point in time. This snapshot is the source of truth for production -- changes to the original SO do not retroactively affect existing work orders.

### Over-Billing Prevention

The billing views (`v_billing_line_read_model`, `v_billing_invoice_usage_summary`) compute billable quantities by subtracting already-billed amounts from dispatched/packed/ordered quantities. The available billing modes are:

- **dispatch_billable_qty** = dispatched_qty - billed_qty (for dispatch-based billing)
- **fg_billable_qty** = packed_qty - billed_qty - fg_adjusted_qty (for FG-based billing)
- **direct_billable_qty** = order_qty - billed_qty (for direct billing)

### Inventory Single-Direction Constraint

Every inventory ledger entry must be either an inbound (receipt) or outbound (issue) transaction, never both. This is enforced at the database level via `chk_single_direction`, `not_both_qty_check`, and `qty_positive_check` constraints on `inv_ledger`.

### Production Stage Planning

Production stages use a recursive calculation where each stage's planned quantity is derived from the previous stage's OK (good) output. The `v_production_stage_queue_fast` view implements this via a recursive CTE, with special handling for UPS multiplication at die-cutting boundaries.
