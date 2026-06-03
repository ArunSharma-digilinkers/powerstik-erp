# Reports Module

## Overview

The Reports module is the read-only analytics layer of the ERP. Each report is one entry-point function in `Code.gs` that calls one or more reporting views and returns a JSON dataset shaped for the Sheets-side grid.

> The Reports & Dashboard section starts at roughly line 29191 in `Code.gs` (`reportsGetDashboardData`). The dedicated Planning module starts at line 34101 (`planningGetSectionData`).

> Pages: `reports` → module `REPORTS`, `planning` → module `PLANNING`.

## Sections

The reports dashboard is built from independently-shipping sections. Each section has:
- A view (or family of views) in Supabase.
- A `_reportsSectionXxx_()` function in `Code.gs` that loads it.
- A tab on the reports page.

| Section | View family | Apps Script entry |
|---------|------------|-------------------|
| Dashboard tiles | `v_purchase_dashboard_core_metrics`, plus rollups | `reportsGetDashboardData()` |
| Delivery performance | `v_report_delivery_performance` | `_reportsSectionDeliveryPerformance_()` |
| Production bottleneck | `v_report_production_bottleneck` | `_reportsSectionProductionBottleneck_()` |
| Unbilled dispatch | `v_report_unbilled_dispatch` | `_reportsSectionUnbilledDispatch_()` |
| Order traceability | `v_report_order_line_traceability` | `_reportsSectionTraceability_()` |
| Pre-WIP ageing | `v_report_pre_wip_ageing_lines` / `_summary` | `_reportsSectionPreWipAgeing_()` |
| WIP ageing | `v_report_wip_ageing_lines` / `_summary` / `_all_lines` | `_reportsSectionWipAgeing_()` |
| WIP stage | `v_report_wip_stage_lines` / `_summary` / `_reconciliation` | `_reportsSectionWipStage_()` |
| Machine load | `v_report_machine_load_lines` / `_machine_cleanup` / `_missing_targets` | `_reportsSectionMachineLoad_()` |
| Sheet utilisation | `v_report_sheet_utilization` / `_lines` | `_reportsSectionSheetUtilization_()` |
| Net output per machine (NOP) | `v_report_production_nop_daily` / `_machine_cleanup` | `_reportsSectionProductionNOP_()` |
| Job profitability | `v_report_job_profitability_phase1`, `v_report_job_profitability_production_stages` | `_reportsSectionJobProfitability_()` |
| Billing register | `v_report_billing_register`, `v_billing_document_register` | `_reportsSectionBillingRegister_()` |
| Dispatch register | `v_report_dispatch_register`, `v_report_dispatch_discrepancy_lines` | `_reportsSectionDispatchRegister_()` |
| Department GRN | `v_report_department_purchase_grn` | `_reportsSectionDepartmentGRN_()` |
| Planning | `v_report_planning_lines` / `_enriched`, `v_report_planning_material_status`, `v_report_planning_tooling_status` | `planningGetSectionData()` |

## Pre-WIP vs WIP vs WIP-Stage

The three ageing reports answer different questions:

- **Pre-WIP** (`v_report_pre_wip_ageing_*`) — Sales-order lines that are *approved* but have not yet been pulled onto a work order. Age is measured from the approval date. Bucketed 0–7 / 7–15 / 15–30 / 30+ days. Used to chase down approvals that are stuck before production starts.
- **WIP** (`v_report_wip_ageing_*`) — Work-order jobs that *have* started production but are not yet packed. Age is measured from WO creation. Used by production planning.
- **WIP-Stage** (`v_report_wip_stage_*`) — Same WIP, but at the production-stage level (one row per WO routing step in flight). The `_reconciliation` variant cross-checks the WIP qty against `v_production_stage_queue_fast` and flags missing production entries.

## Machine Load & Sheet Utilisation

- **Machine load** sums the planned hours / qty queued on each machine over the next N days from the WO routing and the per-machine standard rates. `_missing_targets` flags rows where the routing has no standard rate (so the report is incomplete).
- **Sheet utilisation** compares sheets planned vs sheets produced vs scrap per WO, including UPS and material breakdown.

## Production NOP

Net output per machine (per day, per shift) — produced qty vs target. Used by the production manager to see who hit / missed targets. `_machine_cleanup` is a name-normalisation helper.

## Job Profitability

Per SO line: revenue vs material cost vs process cost vs estimated overhead. Phase 1 uses point-in-time receipt rates (i.e. assumes the material rate at the time of issue is representative). A phase 2 variant that uses actual lot allocations is planned but not yet built. The `_production_stages` view breaks the process cost down by routing step so the planner can see where hours were consumed.

## Billing & Dispatch Registers

Date-ranged exports backing accounting reconciliation:
- `v_report_billing_register` — every invoice / challan with status, totals.
- `v_report_dispatch_register` — every dispatch_records row with SO + client + invoice context.
- `v_report_dispatch_discrepancy_lines` — short / excess dispatch vs SO ordered qty.

## Planning

The Planning module (`planningGetSectionData()`) is a "single pane of glass" over the lifecycle:

- Base view `v_report_planning_lines` returns every SO line with artwork status, WO numbers, current production stage, packing qty, dispatch qty, billing qty.
- `v_report_planning_lines_enriched` adds the pre-computed material / tooling status badges.
- `v_report_planning_material_status` answers "are this line's WO materials all issued?".
- `v_report_planning_tooling_status` answers "is the plate/die procurement done?".

## Integration

- The reports module is **read-only** — no writes happen here.
- It joins data from every other module: sales orders, work orders, production, packing, dispatch, invoicing, inventory, purchasing.
- Most reports are date-ranged; the entry-point functions accept `fromDate` / `toDate` (`YYYY-MM-DD`) and pass them down as Postgres params.
