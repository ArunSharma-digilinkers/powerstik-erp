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

Note: `set_updated_at_timestamp()` is shared across the costing, BOM, and checklist tables. `set_artwork_updated_at()` and `set_client_parties_updated_at()` are table-specific variants (function source is in Supabase and must be exported separately).

> The `set_production_live_entries_updated_at()` function still exists in the schema dump but its table (`production_live_entries`) has been dropped; the function is currently dangling and should be removed in a follow-up migration.

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

### Sales Order Line Status Cascade Triggers

Independent of the rollup cache, the per-line `sales_order_lines.status` column (OPEN / PARTIAL_DISPATCHED / CLOSED / CANCELLED / HOLD) is auto-recomputed by a family of five cascading triggers. These keep the line status in sync with downstream events (dispatch, invoice, parent SO status) without requiring application code to update it.

| Trigger | Table | Event | Function |
|---------|-------|-------|----------|
| `trg_sales_order_line_status_from_line` | sales_order_lines | AFTER INSERT OR UPDATE OF qty, so_id | `sales_order_line_status_from_line_trg()` |
| `trg_sales_order_line_status_from_order` | sales_orders | AFTER INSERT OR UPDATE OF status | `sales_order_line_status_from_order_trg()` |
| `trg_sales_order_line_status_from_dispatch` | dispatch_records | AFTER INSERT/DELETE/UPDATE | `sales_order_line_status_from_dispatch_trg()` |
| `trg_sales_order_line_status_from_invoice_line` | invoice_lines | AFTER INSERT/DELETE/UPDATE | `sales_order_line_status_from_invoice_line_trg()` |
| `trg_sales_order_line_status_from_invoice` | invoices | AFTER DELETE OR UPDATE OF status, document_type, invoice_no, posted_at | `sales_order_line_status_from_invoice_trg()` |

**Behavior:** The function reads dispatched qty and billed qty for the line and decides:

- `OPEN` -- nothing dispatched yet and parent SO is OPEN
- `PARTIAL_DISPATCHED` -- some qty dispatched but not fully invoiced
- `CLOSED` -- order qty fully dispatched and invoiced
- `HOLD` / `CANCELLED` -- propagated from the parent SO

The status column is constrained by `sales_order_lines_status_chk`.

---

### Artwork Auto-Creation Trigger

| Trigger | Table | Event | Function |
|---------|-------|-------|----------|
| `trg_sales_order_lines_ensure_artwork` | sales_order_lines | AFTER INSERT OR UPDATE OF so_id, line_no, product_code, product_name, category, hsn_group, status | `ensure_artwork_row_for_sales_order_line_trg()` |

**Purpose:** When a new sales-order line is inserted (or its identifying fields change), the trigger guarantees a matching row exists in `artworks` for that (so_id, line_no). It seeds the artwork row with the product / category / HSN snapshot so that the artwork module sees a row immediately without any application code involvement. The trigger is a no-op if a row already exists.

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

---

### Sales Orders

| Constraint | Table | Rule |
|------------|-------|------|
| `sales_orders_transport_payment_chk` | sales_orders | transport_payment IS NULL OR IN ('To Pay', 'Paid') |
| `sales_order_lines_status_chk` | sales_order_lines | `upper(status) IN ('OPEN','PARTIAL_DISPATCHED','CLOSED','CANCELLED','HOLD')` |

---

### Checklist Module

| Constraint | Table | Rule |
|------------|-------|------|
| `checklist_task_templates_priority_chk` | checklist_task_templates | priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL') |
| `checklist_task_versions_frequency_chk` | checklist_task_versions | frequency_type IN ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM') |
| `checklist_task_versions_effective_chk` | checklist_task_versions | effective_to IS NULL OR effective_to >= effective_from |
| `checklist_task_assignments_date_chk` | checklist_task_assignments | end_date IS NULL OR end_date >= start_date |
| `checklist_task_instances_status_chk` | checklist_task_instances | status IN ('PENDING', 'DONE', 'OVERDUE', 'SKIPPED', 'CANCELLED') |
| `checklist_weekly_offs_day_chk` | checklist_weekly_offs | day_of_week BETWEEN 0 AND 6 |

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

### Production Entry Audit

`production_entry_audit_log` and `packing_entry_audit_log` capture before/after JSON for every edit / reverse on the relevant entry, with the `changed_by` user and a free-text reason. The application layer (`saveProductionBulk()` / `savePackingBulk()`) is responsible for writing these — they are not maintained by a trigger.

### Sheet Conversion Posting

`invPostSheetConversion()` posts one row to `inv_sheet_conversions` plus N output rows in `inv_sheet_conversion_lines` and the corresponding `inv_sheet_conversion_allocations`. It also writes paired `inv_ledger` rows (`qty_out` for the source sheet, `qty_in` per output) and `inv_lots` rows for each non-waste output. Reversal updates the header `status` to `REVERSED` and writes the inverse ledger rows; the line and allocation rows are kept for audit.

### Rate Correction Posting

`invApplyRateCorrection()` rewrites the source receipt's `inv_ledger.rate` and the corresponding `inv_lots.rate` for any remaining qty, then writes compensating `inv_ledger` rows for the already-issued portion so the total stock value stays consistent. The full delta and the list of affected ledger rows are recorded in `inv_rate_corrections`.

### Checklist Instance Generation

`checklistGenerateInstances()` produces `checklist_task_instances` rows for each `(template, version, assignment)` triple in effect on the target date, **skipping**:

- days that match an active `checklist_weekly_offs.day_of_week`
- days that match an active `checklist_holidays.holiday_date`
- assignments whose start_date is after the target date or end_date is before it
- versions whose effective_from / effective_to don't include the target date

`due_at` is calculated as `target_date + due_time + grace_minutes`. Instances move from `PENDING` → `DONE` (via `checklistMarkDone()`) or → `OVERDUE` (by the periodic sweep that runs after `due_at`).
