# Database Views

This document describes all regular views and materialized views in the Powerstik ERP database.

> **Removed views** (referenced by older docs but no longer in the schema): `v_sales_orders_dashboard`, `wo_material_pending`, `v_production_board`, `v_production_summary_fast`, `v_item_bom_current`. Where the functionality moved, the replacement view is called out below.

---

## Materialized Views

### inv_stock_mv

**Purpose:** Computes current inventory stock balances per item per location.

**Key logic:**
- Aggregates `inv_ledger` to calculate net quantity (sum of qty_in minus sum of qty_out) per item/location
- Joins `inv_lots` to compute weighted average rate from lot balances when available, falling back to ledger-based weighted average rate
- Filters out zero-balance items
- Exposes item metadata (item_code, item_name, category, department, uom)

**Output columns:** item_id, item_code, item_name, category, department, uom, location, qty, avg_rate, value, last_movement_at

**Used by:** Inventory module dashboards, `inv_stock_analytics_mv`

**Refresh:** Must be manually refreshed (REFRESH MATERIALIZED VIEW) as stock changes.

---

### inv_stock_analytics_mv

**Purpose:** Extends `inv_stock_mv` with analytics: ageing, movement classification, reorder calculations.

**Key logic:**
- Joins `inv_stock_mv` with lot data to determine oldest receipt date and next batch number (FIFO)
- Computes `ageing_days` from oldest receipt
- Classifies items as FAST_MOVING (<=30 days), SLOW_MOVING (31-60 days), or NON_MOVING (>60 days)
- Calculates `avg_daily_consumption` from 30-day issue history
- Computes `avg_lead_time_days` from purchase request to first receipt
- Derives `minimum_stock_level` = lead_time x daily_consumption x 1.2 safety factor

**Output columns:** item_id, location, last_movement_at, oldest_receipt_at, ageing_days, movement_class, next_batch_no, batch_count, avg_daily_consumption, avg_lead_time_days, safety_factor, minimum_stock_level

**Used by:** Inventory analytics and reorder planning

---

## Regular Views -- Sales Module

### sales_orders_list

**Purpose:** Basic sales order listing with first line item details.

**Joins:** sales_orders + clients (LEFT) + sales_order_lines (LEFT, line_no = 1)

**Output:** SO header fields, client_name, accounts_status, business_status, wo_status, plus product_code/name/remarks from line 1 only.

**Used by:** Legacy sales order list screen

---

### v_sales_orders_list_fast

**Purpose:** Optimized sales order list view using the rollup cache.

**Joins:** sales_orders + clients (LEFT) + sales_order_rollup_cache (LEFT)

**Key logic:**
- Pulls pre-computed statuses from `sales_order_rollup_cache` with fallback to SO-level fields
- Includes UI action flags: can_edit, can_hold, can_cancel, hold_target, hold_label
- Adds client_search_text for fuzzy search

**Output:** Full SO header, client_name, all rollup fields, transport details

**Used by:** Primary sales order list in Google Sheets

---

### v_sales_order_line_details

**Purpose:** Detailed SO line view with computed fields for display.

**Joins:** sales_order_lines + sales_orders + items (LEFT, for HSN) + sales_order_rollup_cache (LEFT)

**Output:** All line fields, computed amounts, HSN group from items table, wo_status from cache, delivery_display, remarks_display

**Used by:** SO line detail screens

---

### v_sales_order_lines_for_approval

**Purpose:** Simplified view of SO lines for the approval workflow.

**Joins:** sales_order_lines + sales_orders + clients (LEFT)

**Output:** so_number, so_date, so_created_at, client_code, client_name, sales_rep, line_no, product_name, category, qty, rate, accounts_status, accounts_at, business_status, business_at

**Used by:** Accounts and business approval screens

---

### so_line_billed_qty

**Purpose:** Aggregates total billed quantity per SO line (excluding cancelled invoices).

**Joins:** invoice_lines + invoices (WHERE status != 'CANCELLED')

**Output:** so_line_id, billed_qty

**Used by:** Over-billing prevention logic

---

### v_sales_order_item_picker

**Purpose:** Item-picker dataset surfaced inside the SO entry screen — gives one row per item with the columns the picker shows (HSN, GST, last sold rate, default unit) and supports fuzzy match.

**Used by:** SO line entry / quick add.

---

### v_sales_order_advance_payment_clearance

**Purpose:** Tracks orders that need advance-payment clearance before they can move to artwork / production. Combines advance-payment fields from the SO with current accounts approval and billed-vs-paid context.

**Used by:** Accounts approval / billing dashboard.

---

## Regular Views -- Artwork Module

### v_artwork_jobs

**Purpose:** Artwork department working screen combining artwork specs with SO and client data.

**Joins:** artworks + sales_order_lines (on so_id + line_no) + sales_orders + clients (LEFT)

**Output:** Artwork fields (sheet dimensions, UPS layout, plate/die details), SO fields (so_number, so_date, sales_rep), line fields (product_code, product_name, qty), client_name, approval statuses

**Used by:** Artwork module in Google Sheets

---

### v_artwork_jobs_active

**Purpose:** Same shape as `v_artwork_jobs` but filtered to in-flight artworks (excludes cancelled / archived SO lines). Use this in screens that should not show closed history.

---

### v_artwork_workbench_active

**Purpose:** Workbench-shaped dataset used by the artwork module to drive its main grid — includes approval-group rollups, plate/die status, and the action flags that drive the inline-edit buttons.

---

### v_artwork_groups / v_artwork_groups_active

**Purpose:** Approval-group level rollup — one row per artwork approval group with member counts, plate/die roll-up status, approval timestamps. `_active` filters out closed groups.

---

### v_artwork_reference

**Purpose:** Look-up dataset used when an operator wants to copy the specs of a prior artwork onto a new SO line. Returns one row per distinct (client, product, sheet spec) combination with the latest approved artwork details.

---

## Regular Views -- Work Order Module

### v_workorder_candidates

**Purpose:** Shows approved SO lines eligible for work order creation, with remaining quantity calculations.

**Key logic:**
- Picks the latest artwork per SO line (ranked by approved_at/artwork_at)
- Calculates processed_qty from existing work_order_jobs and remaining_qty = qty - processed_qty
- Determines approval_stage text and can_create_wo boolean
- Excludes service-only items (plates, dies) via hardcoded exclusion list
- Excludes CANCELLED sales orders
- Currently excludes FLEXO department_category items (handled by separate FLEXO WO module)

**Joins:** sales_order_lines + sales_orders + clients + artworks (ranked) + work_order_jobs aggregate

**Output:** Full SO/line context, artwork details, remaining_qty, wo_list, approval_stage, can_create_wo, department_category

**Used by:** Work order creation screen

---

### v_workorder_candidates_active

**Purpose:** Same shape as `v_workorder_candidates` but filtered to actionable rows only — excludes lines already fully assigned, on hold, or cancelled.

---

### v_flexo_work_order_jobs

**Purpose:** Flexo-specific view of `work_order_jobs`. Surfaces the cylinder / teeth / repeat fields stored on the WO snapshot for use by the flexo WO creation screen and downstream production views.

---

> **Replaced view note:** `wo_material_pending` has been removed; the WO material-issue progress is now exposed by the new family below: `inv_wo_issue_requirement_v` / `_fast_v` (planned), `inv_wo_issue_status_v` / `_fast_v` (planned vs issued), and `inv_wo_issue_material_source_v` (which lots / receipts to draw from).

---

## Regular Views -- Production Module

> **Replaced view note:** `v_production_board` and `v_production_summary_fast` have been removed. Use `v_production_stage_queue_fast` and `v_production_stage_rows_fast` for stage-level data; for board-style summary the reports module now uses `v_report_wip_stage_summary` and friends (see Reports below).

### v_production_jobcard_lookup_fast

**Purpose:** Quick lookup of work order job card metadata for production screens.

**Joins:** work_order_jobs + work_orders + artworks (for department_category)

**Key logic:**
- Aggregates job details per WO (artwork_nos, product_names, so_numbers)
- Determines department_category from snapshot_json type field or artwork product_type

**Output:** wo_id, wo_number, wo_date, artwork_nos, client_name, product_names, so_numbers, department_category

**Used by:** Job card lookup in production module

---

### v_production_stage_queue_fast

**Purpose:** Core production stage queue with recursive planned quantity calculation. This is one of the most complex views in the system.

**Key logic:**
- Uses a **recursive CTE** (`stage_calc`) to propagate quantities through routing stages
- Stage 1 planned qty comes from snapshot_json paper/wastage data
- Subsequent stages: planned qty = previous stage's OK produced qty
- Special UPS multiplication rules for transitions between sheet-based and unit-based processes (e.g., after die cutting)
- Computes status per stage: PENDING, IN_PROGRESS, COMPLETED, SHORT_CLOSED, HOLD
- Excludes non-production processes (PACKING, DISPATCH, CUTTING PRE/POST, QC)
- Determines department_category from artwork product_type or snapshot data

**Output:** routing_id, wo_id, wo_number, wo_date, so_numbers, line_nos, artwork_nos, client_name, product_names, department_category, process_name, department, planned_machine, sequence_no, expected_delivery, job_priority, planned_qty, produced_qty, balance_qty, status

**Used by:** Production stage queue, referenced by many other production views

---

### v_production_stage_rows_fast

**Purpose:** Extends `v_production_stage_queue_fast` with per-job row splitting after die cutting.

**Key logic:**
- Uses a **recursive CTE** (`job_stage_calc`) for post-split job tracking
- Identifies the "split point" (die cutting stage) where combined sheet flow separates into individual jobs
- Before split: emits COMBINED rows (sheet-level tracking)
- After split: emits JOB rows (per SO line / job reference tracking)
- Maps process names to display-friendly names (e.g., "Flexo Printing", "Sheet Pasting")

**Output:** row_key, row_sort, row_kind (COMBINED/JOB), plan_unit (SHEETS/UNITS/RM), all routing and job fields, process_display_name, planned_qty, produced_qty, balance_qty, status

**Used by:** Production stage detail screen in Google Sheets

---

## Regular Views -- Packing and Dispatch Module

### v_packing_board

**Purpose:** Shows items ready for packing (produced > packed).

**Key logic:**
- Takes latest production entry per WO for produced_qty
- Joins with packing_records aggregate for packed_qty
- Filters where produced > packed

**Output:** wo_id, so_number, line_no, product_name, client_name, artwork_no, order_qty, produced_qty, packed_qty, balance_qty

**Used by:** Packing board

---

### v_packing_queue_fast

**Purpose:** Comprehensive packing queue with production totals and dispatch readiness.

**Key logic:**
- Groups work_order_jobs by SO number + line to get job base
- Finds the final production routing stage (excluding PACKING/DISPATCH/QC etc.)
- Sums production entries for that final stage
- Joins with packing_records for packed totals
- Only shows items where produced_qty > 0
- Pulls transport mode from WO snapshot_json

**Output:** pack_id, so_id, so_line_id, so_number, line_no, product fields, client_name, category, department_category, order_qty, produced_qty, packed_qty, ready_to_dispatch, delivery dates, artwork_no, wo_number, wo_date, transport_mode

**Used by:** Packing queue in Google Sheets, also used as base for dispatch queue

---

### v_dispatch_board

**Purpose:** Simple dispatch board showing packed items ready for dispatch.

**Joins:** packing_records + dispatch_records (aggregated by so_line_id)

**Filter:** ready_to_dispatch = true

**Output:** pack_id, SO fields, product fields, packed_qty, dispatched_qty, balance_qty

**Used by:** Dispatch board

---

### v_dispatch_queue_fast

**Purpose:** Optimized dispatch queue built on top of packing queue.

**Source:** v_packing_queue_fast (WHERE ready_to_dispatch = true) + dispatch_records aggregate

**Output:** All packing queue fields plus dispatched_qty

**Used by:** Dispatch queue in Google Sheets

---

### v_fg_stock_available

**Purpose:** Available finished-goods stock per client + product (or per SO line, depending on the source mode). Combines opening stock, FG adjustments, packed-not-yet-dispatched, and dispatch history to arrive at the qty that is currently dispatchable from FG.

**Used by:** Dispatch screen, FG stock dashboard.

---

## Regular Views -- Billing Module

### v_billing_packing_summary

**Purpose:** Aggregates packed quantities per SO line.

**Source:** packing_records (WHERE so_line_id IS NOT NULL)

**Output:** so_line_id, packed_qty, latest_packed_at

---

### v_billing_dispatch_summary

**Purpose:** Aggregates dispatched quantities per SO line with latest dispatch details.

**Key logic:**
- dispatch_totals CTE: sums dispatch_qty per so_line_id
- dispatch_latest CTE: picks latest dispatch record per so_line_id (by date, then created_at)

**Output:** so_line_id, dispatched_qty, latest_dispatch_no, latest_dispatch_date, transporter, vehicle_no, lr_no

---

### v_billing_invoice_usage_summary

**Purpose:** Summarizes invoice usage per SO line -- how much has been billed, posted, and in draft.

**Key logic:**
- Splits billed_qty into posted_qty (POSTED invoices) and draft_qty (non-POSTED)
- Builds invoice_refs string with status tags

**Output:** so_line_id, billed_qty, posted_qty, draft_qty, invoice_refs

---

### v_billing_line_read_model

**Purpose:** The main billing read model -- comprehensive view of each SO line with all billing-relevant quantities.

**Key logic:**
- Joins SO lines with packing, dispatch, invoice usage, and FG adjustment summaries
- Computes three billable quantity modes:
  - `dispatch_billable_qty` = dispatched_qty - billed_qty
  - `fg_billable_qty` = packed_qty - billed_qty - fg_adjusted_qty
  - `direct_billable_qty` = order_qty - billed_qty
- Includes match_text for full-text search
- Excludes CANCELLED sales orders

**Joins:** sales_order_lines + sales_orders + clients + v_billing_dispatch_summary + v_billing_packing_summary + fg_stock_adjustments + v_billing_invoice_usage_summary

**Output:** Full SO/line context, client details, all quantity breakdowns, dispatch details, invoice_refs, match_text

**Used by:** Billing/invoice creation screen in Google Sheets

---

### v_billing_document_register

**Purpose:** Invoice register view for listing all invoices with summary metadata.

**Key logic:**
- Determines document_type (INVOICE or CHALLAN) from document_type field or invoice_no prefix
- Aggregates line_count, total_qty, and derived_billing_mode from invoice_lines
- Builds product_preview from first 2 distinct product names
- Computes tax_total with fallback calculation

**Output:** id, invoice_no, invoice_date, document_type, client_code, client_name, status, billing_mode, total_qty, line_count, product_preview, remarks, subtotal, tax_total, grand_total, created_at, posted_at, sort_ts

**Used by:** Billing document register screen

---

### v_billed_order_closure

**Purpose:** Lists sales orders whose lines are fully billed (and therefore eligible to be marked closed). Used by the closure routine to decide which SOs to flip to `CLOSED` and to drive the "billed but not closed" warning.

---

### v_billing_division_needs_fix

**Purpose:** Identifies posted invoice lines whose division doesn't match the SO line's division — input to the `billing_division_bulk_fix` correction job.

---

## Regular Views -- Client Master

### v_client_master_register

**Purpose:** Flat register of clients + their default bill-to / ship-to addresses, GSTIN, PAN, and credit terms. Used by masters listing and the export-to-Excel feature.

---

## Regular Views -- Checklist / Task Module

### v_checklist_task_instances_ui

**Purpose:** UI-shaped view of `checklist_task_instances` — joins template / version / assignment, exposes display columns (badge color from priority, due-by relative text, etc.) and the action flags used by the checklist screen.

---

### v_checklist_user_summary

**Purpose:** Per-user task summary: today's open / overdue / done counts, this week's totals, and the next due task. Drives the dashboard tile and the menu badge.

---

## Regular Views -- Item Master Module

> **Replaced view note:** `v_item_bom_current` has been removed. The current revision is now read directly from `item_bom_revisions WHERE is_current = true` (a partial unique index enforces one current revision per item) — see `itemMasterActivateRevision()` in Code.gs.

---

## Regular Views -- Purchasing Module

### v_purchase_plate_die_jobs

**Purpose:** Lists artwork jobs that need plate or die procurement (status = NEW).

**Joins:** artworks + sales_orders

**Filter:** plate_status = 'NEW' OR die_status = 'NEW'

**Output:** so_id, so_number, so_date, client_code, line_no, artwork_no, plate_status, die_status

**Used by:** Purchasing module -- plate/die procurement queue

---

### v_purchase_requests_open

**Purpose:** Shows open inventory purchase requests with pending quantities.

**Source:** inv_purchase_requests

**Key logic:** Computes pending_qty = requested_qty - received_qty, filters where pending_qty > 0

**Output:** pr_no, created_at, item fields, requested_qty, received_qty, department, job_ref, remarks, status, pending_qty

**Used by:** Purchase order creation screen

---

### v_pr_po_receipt_cycle

**Purpose:** Lifecycle view that walks every PR through its PO and each receipt event, so the purchase screen can show "raised → ordered → received" timing for each request.

---

### v_purchase_dashboard_core_metrics

**Purpose:** KPI tiles for the purchase dashboard — open PR count, open PO count, value receivable this week, overdue receipts. One row.

---

### v_purchase_lead_time_items

**Purpose:** Vendor / item lead-time analytics — average days between PO date and first receipt per (vendor, item), with sample counts.

---

### v_purchase_order_summary

**Purpose:** PO listing with derived totals (line count, total qty, total value, receipt status). Backs the PO list grid.

---

### v_purchase_orders_read_model

**Purpose:** Read-model variant of `v_purchase_order_summary` used by the new purchase workbench (extra context fields, more aggressive denormalization, fewer joins on the client side).

---

### v_purchase_po_print_lines

**Purpose:** Per-line dataset formatted for PO printing (sl no, description, qty + uom, rate, tax %, line total, etc.).

---

### v_purchase_tooling_workbench

**Purpose:** Plate / die procurement workbench: combines `purchase_artwork_procurement`, the originating `artworks` row and the source SO line, with the action flags driving the tooling-procurement screen.

---

### v_purchase_tooling_pending_summary

**Purpose:** Aggregate (department, vendor, type) of plate / die procurement entries still pending — used by the dashboard tile and the daily pending email.

---

### v_purchase_tooling_register_search

**Purpose:** Searchable register of every plate / die procurement event with concatenated search text and prepared display columns (artwork_no, type, vendor, status, ordered / received dates).

---

## Regular Views -- Inventory Registers

### inv_stock_reconciled_v

**Purpose:** Stock view that reconciles `inv_lots` qty-available against the ledger net qty per (item, location) and flags discrepancies. Used during stock audit.

---

### inv_issue_register_v

**Purpose:** Material-issue register — one row per issue (`inv_ledger` rows where `ref_type = 'ISSUE'`) with item, batch, WO, department, value, and the consuming material_key.

---

### inv_receipt_register_v

**Purpose:** Receipt register — one row per receipt (`PR-RECEIPT` / `PO-RECEIPT` ledger rows) with PO / PR linkage, lot info, rate, value, and the corresponding `purchase_po_receipts` row when present.

---

### inv_adjustment_register_v

**Purpose:** Stock-adjustment register — `inv_ledger` rows where `ref_type = 'ADJUSTMENT'` with reason text and the lot adjusted.

---

### inv_rfp_register_v

**Purpose:** Inventory purchase-request (RFP) register — every PR with its current status, pending qty, and the PO line(s) it has been pulled into.

---

### inv_rts_register_v

**Purpose:** Return-to-supplier register — every `inv_rts_returns` row joined with its `inv_ledger` reversal and vendor / debit-note context.

---

### v_inventory_transaction_register

**Purpose:** Combined inventory transaction register — every ledger movement (receipt, issue, adjustment, conversion, RTS) in one timeline, used by the inventory screen and the daily transaction email.

---

### inv_wo_issue_requirement_v / inv_wo_issue_requirement_fast_v

**Purpose:** Per-WO material requirement: rolls up `work_order_materials` to (wo, material_key, item) with planned qty and uom. The `_fast_v` variant pre-aggregates for the issue screen.

---

### inv_wo_issue_status_v / inv_wo_issue_status_fast_v

**Purpose:** Per-WO material issue status — planned qty (from the requirement view) vs already-issued qty (from `inv_ledger`) with pending qty and last issue timestamp. Replaces the old `wo_material_pending` view.

---

### inv_wo_issue_material_source_v

**Purpose:** For each pending WO material requirement, the candidate `inv_lots` / receipts that could satisfy it (FIFO order, with qty available and rate). Drives the "issue from" picker.

---

## Regular Views -- Reports

### v_report_delivery_performance

**Purpose:** Delivery performance analysis per SO line.

**Key logic:**
- Compares last_dispatch_date against delivery date (final_delivery or expected_delivery)
- Computes delivery_status: ON_TIME, DELAYED, PENDING, DISPATCHED
- Calculates delay_days

**Joins:** sales_orders + sales_order_lines + clients + dispatch_records (aggregated)

**Output:** so_number, line_no, client_name, product_name, delivery_date, last_dispatch_date, order_qty, dispatched_qty, delivery_status, delay_days

**Used by:** Delivery performance report

---

### v_report_order_line_traceability

**Purpose:** End-to-end traceability for each SO line across the full lifecycle.

**Joins:** sales_orders + sales_order_lines + clients + artworks (aggregated) + work_order_jobs (aggregated) + packing_records (aggregated) + dispatch_records (aggregated) + invoice_lines (aggregated)

**Output:** SO/line details, approval statuses, artwork_no/status/plate_status/die_status, wo_count, wo_numbers, packed_qty, dispatched_qty, last_dispatch_date, billed_qty

**Used by:** Order traceability report

---

### v_report_planning_lines

**Purpose:** Comprehensive planning view showing each SO line's progress through every lifecycle stage. The most detailed reporting view.

**Key logic:**
- Ranks artworks to pick latest per SO line
- Aggregates WO data (count, numbers, dates)
- Aggregates routing metadata and routing steps as pipe-delimited string
- Pulls current production stage status from `v_production_stage_queue_fast`
- Builds stage_summary with produced/planned quantities per stage
- Determines current_stage (first non-completed stage, prioritizing IN_PROGRESS)
- Aggregates invoice data (count, numbers, dates, billed_qty)
- Computes billing_status (CLOSED when fully billed, else PENDING)
- Computes sales_approval_status and sales_approval_at

**Joins:** sales_orders + sales_order_lines + clients + artworks (ranked) + work_order_jobs + work_order_routing + v_production_stage_queue_fast + production_entries + invoice_lines + invoices

**Output:** Full SO/line context, artwork details, WO details, routing_steps, current_stage, stage_summary, billing details, computed statuses

**Used by:** Planning/tracking report -- the "single pane of glass" for order progress

---

### v_report_production_bottleneck

**Purpose:** Identifies production bottlenecks -- routing stages that are not completed and have remaining balance.

**Source:** v_production_stage_queue_fast (WHERE status != 'COMPLETED' AND balance_qty > 0)

**Output:** routing_id, wo_id, wo_number, wo_date, so_numbers, line_nos, artwork_nos, client_name, product_names, process_name, department, planned_machine, expected_delivery, planned_qty, produced_qty, balance_qty, status

**Used by:** Production bottleneck report

---

### v_report_unbilled_dispatch

**Purpose:** Identifies dispatched quantities that have not yet been billed.

**Key logic:** Computes unbilled_qty = dispatched_qty - billed_qty, filters where unbilled_qty > 0

**Joins:** dispatch_records (aggregated) + invoice_lines (aggregated)

**Output:** so_line_id, so_number, line_no, product_name, dispatch_date, dispatched_qty, billed_qty, unbilled_qty

**Used by:** Unbilled dispatch report -- helps ensure all dispatches are invoiced

---

### v_report_planning_lines_enriched

**Purpose:** Same per-line shape as `v_report_planning_lines` but adds material readiness, tooling readiness, and pre-WIP / WIP stage badges in one shot — fewer round trips for the planning screen.

---

### v_report_planning_material_status

**Purpose:** Per planning line, "is the WO's material requirement covered?" — combines `inv_wo_issue_status_v` totals to give a single material-status badge (READY / SHORT / ISSUED).

---

### v_report_planning_tooling_status

**Purpose:** Per planning line, "is the plate / die procurement done?" — combines artwork + `purchase_artwork_procurement` to give one tooling-status badge.

---

## Regular Views -- WIP / Pre-WIP Reports

These views back the new WIP module and replace the older ad-hoc dashboards.

### v_report_pre_wip_ageing_lines

**Purpose:** Pre-WIP ageing at the line level — sales-order lines that are approved but not yet on a work order, with the age in days from approval (bucketed: 0–7, 7–15, 15–30, 30+).

### v_report_pre_wip_ageing_summary

**Purpose:** Bucketed counts and totals of the lines view, grouped by client / product / category — the summary tile and CSV export.

### v_report_wip_ageing_lines / _summary / _all_lines

**Purpose:** WIP ageing — work-order jobs that have started production but are not yet packed.
- `_lines` is per WO job with age bucket and current stage.
- `_summary` aggregates by bucket / department / process.
- `_all_lines` is the unfiltered superset including jobs not yet started (used by the global "all WIP" view).

### v_report_wip_stage_lines / _summary / _reconciliation

**Purpose:** WIP at the production-stage level.
- `_lines` is one row per (WO, routing step) currently in WIP.
- `_summary` aggregates by stage / department.
- `_reconciliation` cross-checks WIP qty against `v_production_stage_queue_fast` balance to flag mismatches that indicate missing production entries.

---

## Regular Views -- Machine Load / Capacity

### v_report_machine_load_lines

**Purpose:** Per-machine load — the planned hours / qty queued on each machine across the next N days, derived from work orders + routing standards.

### v_report_machine_load_machine_cleanup

**Purpose:** Helper for the machine load report that normalises machine names across legacy spellings — read-only mapping.

### v_report_machine_load_missing_targets

**Purpose:** Lists routing rows that don't have a per-machine standard qty/hour, so the report can warn when planning is unreliable.

---

## Regular Views -- Sheet Utilisation

### v_report_sheet_utilization

**Purpose:** Per-WO sheet utilisation summary — sheets planned vs sheets produced vs scrap, including UPS and material breakdown.

### v_report_sheet_utilization_lines

**Purpose:** Per-line drilldown for the same report.

---

## Regular Views -- Net Output Per Machine (NOP)

### v_report_production_nop_daily

**Purpose:** Daily net-output-per-machine — produced qty vs target qty per (date, machine, shift). Drives the production NOP dashboard.

### v_report_production_nop_machine_cleanup

**Purpose:** Machine-name normalisation helper for the NOP report (same idea as the machine-load cleanup view).

---

## Regular Views -- Job Profitability

### v_report_job_profitability_phase1

**Purpose:** Per SO line — revenue vs material cost vs process cost vs estimated overhead, with the resulting gross margin. "Phase 1" because it uses point-in-time receipt rates; a phase-2 view that uses actual lot allocations is planned.

### v_report_job_profitability_production_stages

**Purpose:** Per-line breakdown of process cost by routing stage — drills the phase-1 margin into where production hours were consumed.

---

## Regular Views -- Billing & Dispatch Registers

### v_report_billing_register

**Purpose:** Date-ranged register of invoices / challans (subtotal, tax, total, status, posted-at) used by accounting exports.

### v_report_dispatch_register

**Purpose:** Date-ranged register of dispatch_records joined with SO + client + invoice info — the dispatch ledger.

### v_report_dispatch_discrepancy_lines

**Purpose:** Lines where the dispatched qty doesn't match the SO ordered qty (short or excess), used by the discrepancy report.

---

## Regular Views -- Department Purchase / GRN

### v_report_department_purchase_grn

**Purpose:** Department-wise purchase summary — POs raised, receipts taken, value purchased per department over a date range. Used by department spend reviews.
