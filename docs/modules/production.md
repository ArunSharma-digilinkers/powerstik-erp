# Production Module

## Overview

The Production module records machine-level output against work order routing steps. Every entry is auditable (before/after JSON) and corrugation entries carry per-set material composition. Production views use recursive CTEs to cascade planned quantities through the routing chain.

> The Production section starts at roughly line 27887 in `Code.gs` (`saveProductionBulk`).

## Tables

| Table | Purpose |
|-------|---------|
| `production_entries` | Production logs (produced / rejected / OK qty per routing step) |
| `production_entry_audit_log` | Audit trail — before/after JSON for every edit, delete, reversal |
| `corrugation_2ply_entry_details` | Per-set material composition for 2-ply corrugation entries (liner + fluting reels, gsm, kg consumed) |

> The old `production_live_entries` table has been removed; real-time start/stop tracking is no longer in scope and the corresponding `set_production_live_entries_updated_at()` function is dangling.

## Production Entry Fields

| Field | Description |
|-------|-------------|
| `wo_id` / `routing_id` | Links to work order and routing step |
| `entry_datetime` | When production occurred |
| `machine` | Machine used |
| `operator_name` | Operator who ran the machine |
| `produced_qty` | Total pieces produced |
| `rejected_qty` | Pieces rejected (quality issues) |
| `ok_qty` | Good pieces (produced - rejected) |
| `downtime_reason` | Reason for any downtime |
| `so_number` / `line_no` / `job_reference` | Job-level tracking (used for post-die-cut split) |

## Corrugation 2-Ply Composition

For 2-ply corrugation entries, `corrugation_2ply_entry_details` captures the actual material set used (which can differ from the WO snapshot). Each set group records:

- WO-snapshot liner / fluting (`liner_item_code`, `liner_wo_gsm`, `fluting_item_code`, `fluting_wo_gsm`)
- Actual liner / fluting used (`liner_actual_item_code`, `liner_actual_gsm`, `fluting_actual_*`)
- Reel numbers and widths (`liner_reel_no`, `liner_reel_width_mm`, `fluting_*`)
- Output sheets (`produced_sheets`, `rejected_sheets`) and consumed kg per side (`liner_consumed_kg`, `fluting_consumed_kg`, `total_consumed_kg`)
- `flute`, `deckle_mm`, `cut_size_mm`, `set_numbers`

`saveProductionBulk()` writes the parent `production_entries` row and these detail rows together.

## Key Functions (Code.gs)

| Function | Purpose |
|----------|---------|
| `saveProductionBulk(entries, token)` | Save multiple production entries at once (writes audit log, writes corrugation details when applicable) |
| `getProductionBoardByWO(woId, token)` | Get detailed production data for a single WO |
| `prodGetStageQueue(params, token)` | Get production stage queue with filtering |
| `prodGetCategories(token)` | Get available department categories |
| `shortCloseStage(routingId, reason, token)` | Short-close a routing step (mark as done even if not fully completed) — writes an audit row |
| `searchWorkOrders(query, token)` | Search WOs by number, artwork, client, product |

## Production Stage Queue

The production stage queue is the primary working screen. It shows every routing step across all active WOs with:

- **Planned qty**: Derived from WO snapshot (stage 1) or previous stage output (stage 2+)
- **Produced qty**: Sum of production entries for that routing step
- **Balance qty**: Planned minus produced
- **Status**: PENDING, IN_PROGRESS, COMPLETED, SHORT_CLOSED, HOLD

### Combined vs Job-Level Rows

The `v_production_stage_rows_fast` view provides two types of rows:

1. **Combined rows** (`row_kind = 'COMBINED'`): Sheet-level tracking for pre-die-cut stages (Printing, Lamination, Coating). The unit is sheets.

2. **Job rows** (`row_kind = 'JOB'`): Piece-level tracking for post-die-cut stages. After die cutting, one sheet becomes multiple pieces (based on UPS), so tracking switches from sheets to units per job.

The split happens at the first die-cut stage in the routing sequence.

### Stage Planning Logic

The `v_production_stage_queue_fast` view uses a recursive CTE:

1. **Stage 1 (seed)**: Planned qty comes from WO snapshot (`paper_sheets_with_waste` or `flexo_running_meter`)
2. **Stage 2+**: Planned qty = OK produced qty from previous stage, adjusted for UPS factor when transitioning between sheet-based and unit-based stages

## Department Categories

Production is organized by department category:
- **OFFSET** - Traditional offset printing
- **DIGITAL** - Digital printing (Canon)
- **FLEXO** - Flexo label printing
- **CORRUGATION** - Corrugated box production

Category is derived from artwork `product_type` or WO snapshot `jobDetails.type`.

## Views

| View | Purpose |
|------|---------|
| `v_production_stage_queue_fast` | Stage queue with planned / produced / balance (recursive CTE) |
| `v_production_stage_rows_fast` | Combined + job-split rows for the production screen |
| `v_production_jobcard_lookup_fast` | Job card lookup for quick WO search |
| `v_report_production_bottleneck` | Routing steps with pending balance > 0 |
| `v_report_production_nop_daily` | Net output per machine, daily |
| `v_report_machine_load_lines` | Machine load / capacity analysis |
| `v_report_sheet_utilization` / `_lines` | Sheet utilisation per WO |
| `v_report_wip_ageing_lines` / `_summary` / `_all_lines` | WIP ageing across active production |
| `v_report_wip_stage_lines` / `_summary` / `_reconciliation` | WIP by stage; reconciliation flags missing entries |
| `v_report_pre_wip_ageing_lines` / `_summary` | Pre-WIP ageing (approved but not yet on a WO) |

> The legacy `v_production_board` and `v_production_summary_fast` views have been removed; the reports above replace them.

## Integration

- **Work Orders**: Production is recorded against WO routing steps.
- **Packing**: Production totals flow into the packing queue (`v_packing_queue_fast`).
- **Reports**: Production data feeds bottleneck, WIP, machine load, sheet utilisation, NOP, and job profitability reports.
- **Inventory**: Material issued from inventory is tracked against the WO via `inv_wo_issue_status_v` / `_fast_v`.
- **Audit**: Every edit / delete / reversal writes to `production_entry_audit_log`.
