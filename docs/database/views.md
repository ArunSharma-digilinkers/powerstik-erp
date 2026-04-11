# Database Views

This document describes all regular views and materialized views in the Powerstik ERP database.

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

### v_sales_orders_dashboard

**Purpose:** Sales order dashboard with computed approval and WO statuses.

**Key logic:**
- Uses EXISTS subqueries on sales_order_lines to derive aggregate accounts_approved and business_approved statuses
- Uses EXISTS on work_order_jobs to derive wo_status
- Status logic: REJECTED if any line rejected, PENDING if any line pending, else APPROVED

**Output:** SO header fields plus computed wo_status, accounts_approved, business_approved

**Used by:** Sales dashboard module

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

## Regular Views -- Artwork Module

### v_artwork_jobs

**Purpose:** Artwork department working screen combining artwork specs with SO and client data.

**Joins:** artworks + sales_order_lines (on so_id + line_no) + sales_orders + clients (LEFT)

**Output:** Artwork fields (sheet dimensions, UPS layout, plate/die details), SO fields (so_number, so_date, sales_rep), line fields (product_code, product_name, qty), client_name, approval statuses

**Used by:** Artwork module in Google Sheets

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

### wo_material_pending

**Purpose:** Shows pending material requirements per work order.

**Key logic:**
- Compares work_order_materials.required_qty against issued qty from inv_ledger
- Issue matching: ref_type = 'ISSUE', ref_no = wo_id, remarks = material_key

**Output:** wo_id, material_key, required_qty, uom, issued_qty, pending_qty

**Used by:** Material issue screens, WO material tracking

---

## Regular Views -- Production Module

### v_production_board

**Purpose:** Simple production board showing routing stages with planned vs produced quantities.

**Key logic:**
- For sequence 1: planned qty comes from snapshot_json (coreSheets + processSheets)
- For subsequent stages: planned qty = previous stage's produced total
- Uses work_order_routing joined with production_entries aggregates

**Output:** routing_id, wo_id, wo_number, artwork_no, client_name, process_name, sequence_no, department, planned_machine, planned_qty, produced_qty

**Used by:** Basic production board

---

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

### v_production_summary_fast

**Purpose:** Aggregated production summary by date, department, process, and status.

**Source:** v_production_stage_rows_fast (aggregated)

**Output:** wo_date, department_category, process_display_name, status, total_rows, pending_qty, in_progress_rows, short_closed_rows

**Used by:** Production summary dashboard

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

## Regular Views -- Item Master Module

### v_item_bom_current

**Purpose:** Shows the current active BOM revision for each item.

**Joins:** item_bom_revisions (WHERE is_current = true) + items

**Output:** revision_id, item_code, item_name, category, item_unit, item_active, item_lifecycle_status, revision details, effective_from, approved metadata

**Used by:** BOM management screens

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
