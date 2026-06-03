# Checklist / Task Management Module

## Overview

The Checklist module is a self-contained daily / periodic task system for operational tasks (EOD reports, hygiene rounds, machine checks, signoffs). It is *not* tied to the order lifecycle — checklists are about people and calendars, not orders.

The model:
- **Templates** define WHAT a task is (title, priority, mandatory flag).
- **Versions** define WHEN it should run (frequency, due time, grace minutes).
- **Assignments** define WHO owns it in a given window.
- **Instances** are the day-level rows the user actually completes.
- **Weekly offs** + **holidays** skip instance generation.

> The Checklist section starts at roughly line 9796 in `Code.gs` (search for `checklistGenerateInstances`).
> Page key `checklist` → module `CHECKLIST` in `PAGE_MODULE_MAP`.

## Tables

| Table | Purpose |
|-------|---------|
| `checklist_task_templates` | The canonical task — task_code, title, priority, mandatory |
| `checklist_task_versions` | Frequency / due-time / grace per effective window |
| `checklist_task_assignments` | User assignment per effective window |
| `checklist_task_instances` | Day-level row the user completes |
| `checklist_weekly_offs` | Days of week to skip |
| `checklist_holidays` | Specific dates to skip |
| `checklist_task_audit_log` | Audit trail of instance / template changes |
| `checklist_notification_log` | Notification dispatch log |

See [schema-overview.md](../database/schema-overview.md#checklist--task-management) for column-level details.

## Key Functions (Code.gs)

| Function | Purpose |
|----------|---------|
| `checklistGenerateInstances(targetDate, token)` | Generate `checklist_task_instances` for the given date for every active (template, version, assignment). Honors weekly-offs and holidays. |
| `checklistGetMyTasks(params, token)` | Return today's tasks for the current user (status PENDING / OVERDUE first). |
| `checklistMarkDone(instanceId, note, token)` | Mark an instance DONE, set `completed_at` / `completed_by`, write audit log. |
| `checklistGetDashboardData(params, token)` | Per-user summary (open / overdue / done today / this week). |
| `checklistSaveTemplate(payload, token)` | Create / update a template (admin). |
| `checklistSaveVersion(payload, token)` | Create / update a version (admin). |
| `checklistSaveAssignment(payload, token)` | Create / update an assignment (admin). |
| `checklistSaveHolidays(payload, token)` | Bulk-update the holiday calendar (admin). |
| `checklistSaveWeeklyOffs(payload, token)` | Bulk-update weekly offs (admin). |
| `checklistRecalculateOverdue(token)` | Sweep that moves instances past their `due_at` from PENDING → OVERDUE. Typically run on a timer. |

## Instance Generation Rules

`checklistGenerateInstances()` for date `D` and user `U`:

1. Pick every `checklist_task_assignments` where `active = true` AND `start_date <= D` AND (`end_date IS NULL OR end_date >= D`) AND `assigned_user_id = U`.
2. For each, pick the matching `checklist_task_versions` whose `effective_from <= D` AND (`effective_to IS NULL OR effective_to >= D`) AND `active = true`.
3. Evaluate `frequency_type` + `frequency_config`:
   - `DAILY` — every day, always matches.
   - `WEEKLY` — match if `frequency_config.weekdays` contains the weekday of D (or default Monday).
   - `MONTHLY` — match if `frequency_config.day_of_month == D.day` (or last-day rule).
   - `QUARTERLY` / `YEARLY` — explicit anchor dates.
   - `CUSTOM` — `frequency_config.dates` enumerates allowed dates.
4. Skip if D matches an active `checklist_weekly_offs` `day_of_week` or an active `checklist_holidays.holiday_date`.
5. Compute `due_at = D + due_time + grace_minutes`.
6. Insert a `checklist_task_instances` row with snapshotted title / description / category / priority / instructions.

The function is idempotent — running it twice for the same date does not create duplicate instances.

## Status Lifecycle

```
PENDING ──> DONE   (user completes via checklistMarkDone)
   |
   ├──> OVERDUE   (sweep, once now() > due_at and still PENDING)
   ├──> SKIPPED   (admin opts-out a specific instance)
   └──> CANCELLED (template / assignment cancelled mid-day)
```

`completed_at`, `completed_by`, `completion_note` are set only on the DONE transition.

## Views

| View | Purpose |
|------|---------|
| `v_checklist_task_instances_ui` | UI-shaped instance view (joins template, version, assignment, priority badge, due-by relative text). |
| `v_checklist_user_summary` | Per-user dashboard summary (open / overdue / done counts). |

## Constraints

Defined in [business-rules.md](../database/business-rules.md#checklist-module):

- Priority must be one of LOW / NORMAL / HIGH / CRITICAL.
- Frequency must be one of DAILY / WEEKLY / MONTHLY / QUARTERLY / YEARLY / CUSTOM.
- Effective / assignment date windows enforce `end >= start`.
- Instance status must be one of PENDING / DONE / OVERDUE / SKIPPED / CANCELLED.
- `day_of_week` must be in `[0, 6]`.

## Integration

- **Auth / RBAC**: Tasks are assigned per `assigned_user_id` (Apps Script user_id, not Supabase auth). The Checklist module respects the RBAC `CHECKLIST` module permissions (`can_view` / `can_create` / `can_edit` / `can_delete`).
- **Menu**: The dashboard tile and the menu badge use `v_checklist_user_summary` to surface overdue counts.
- **Notifications**: `checklist_notification_log` records dispatches; the actual delivery channel is set up outside the schema (email / Slack / webhook).
