# Production Module

## Overview

The Production module records machine-level output against work order routing steps. It supports both batch entry (after-the-fact logging) and real-time tracking (start/stop/complete). Production views use recursive CTEs to cascade planned quantities through the routing chain.

## Tables

| Table | Purpose |
|-------|---------|
| `production_entries` | Batch production logs (produced/rejected/ok qty per routing step) |
| `production_live_entries` | Real-time production tracking (RUNNING/COMPLETED/STOPPED/HOLD) |

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

## Production Live Entry Fields

| Field | Description |
|-------|-------------|
| `job_card_no` | Unique job card identifier |
| `status` | RUNNING, COMPLETED, STOPPED, HOLD |
| `start_at` / `end_at` | Production time window |
| `downtime_minutes` | Recorded downtime |
| `remarks` | Operator notes |
| `created_by` / `completed_by` | Who started/finished |

## Key Functions (Code.gs)

| Function | Purpose |
|----------|---------|
| `saveProductionBulk(entries, token)` | Save multiple production entries at once |
| `getProductionBoardByWO(woId, token)` | Get detailed production data for a single WO |
| `prodGetStageQueue(params, token)` | Get production stage queue with filtering |
| `prodGetCategories(token)` | Get available department categories |
| `shortCloseStage(routingId, reason, token)` | Short-close a routing step (mark as done even if not fully completed) |
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
| `v_production_stage_queue_fast` | Stage queue with planned/produced/balance (recursive CTE) |
| `v_production_stage_rows_fast` | Combined + job-split rows for production screen |
| `v_production_summary_fast` | Aggregated summary by date/category/process/status |
| `v_production_board` | Legacy production board by WO |
| `v_production_jobcard_lookup_fast` | Job card lookup for quick WO search |
| `v_report_production_bottleneck` | Routing steps with pending balance > 0 |

## Integration

- **Work Orders**: Production is recorded against WO routing steps
- **Packing**: Production totals flow into packing queue (`v_packing_queue_fast`)
- **Reports**: Production data feeds bottleneck analysis and planning reports
- **Inventory**: Material issue from inventory is tracked against WO
