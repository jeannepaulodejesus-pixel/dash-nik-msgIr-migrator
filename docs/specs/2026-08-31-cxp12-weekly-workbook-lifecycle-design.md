# CXP-12 Weekly Workbook Lifecycle, Scheduling, and Environment Promotion — Design

## Context

CXP-02 through CXP-10 deliver a usable weekly target workbook and a separate control workbook. Runtime still resolves the active operational spreadsheet from `CXP_<ENV>_TARGET_SPREADSHEET_ID`, and `WEEK_REGISTRY` remains a provisional header shell. Operators have no idempotent master-template → weekly-instance path, no durable active-week registry, no maintenance trigger inventory, and no approval-bound DEV → UAT → PROD promotion checklist.

CXP-11 finalized control-workbook write contracts and the separate setup/run state-machine convention. CXP-12 consumes those patterns for lifecycle operations without changing ingestion, transformation, reporting, or parity logic.

Authority: [`CODEX_HANDOFF.md`](../../CODEX_HANDOFF.md) §CXP-12, ADR-002 / ADR-009 / ADR-010, [`docs/configuration.md`](../configuration.md), [`docs/workbook-skeleton.md`](../workbook-skeleton.md), [`docs/weekly-workbook-lifecycle-contract.md`](../weekly-workbook-lifecycle-contract.md).

## Goals

- Create a weekly operational workbook from a master template and register it in `WEEK_REGISTRY`.
- Keep the active workbook discoverable through configuration and registry lookup, never hard-coded IDs in source.
- Initialize week/date controls without destroying live raw, calculation, aggregation, or report data on accidental rerun.
- Keep user-triggered / source-triggered ingestion as the primary refresh path.
- Use time-driven triggers only for maintenance, stale-data checks, optional inbox polling, temporary-file cleanup, and weekly workbook rollover.
- Expose health checks for stale data, missing expected sheets, failed last run, and recalculation readiness.
- Define DEV/UAT/PROD PropertiesService keys and an approval-bound promotion checklist that changes configuration, not source.

## Non-goals

- Do not create daily operational files or retain hourly upload history solely to support scheduling.
- Do not bind Apps Script code into weekly workbook copies (ADR-002).
- Do not change CXP-06 commit/rollback semantics, CXP-07–CXP-10 formulas, or CXP-11 parity contracts.
- Do not build the RTA intake UI (CXP-13) or the production cutover package (CXP-14).
- Do not promise exact Apps Script trigger delivery times.

## Architecture

```text
Master template (CXP_<ENV>_MASTER_TEMPLATE_SPREADSHEET_ID)
        |
        v
WorkbookLifecycleService
  - copy template (Drive)
  - ensure CXP-02 skeleton / protections
  - seed week business context (BusinessContextService)
  - register / activate WEEK_REGISTRY row
  - point CXP_<ENV>_TARGET_SPREADSHEET_ID at ACTIVE week
        |
        +--> hourly ingestion (existing CXP-04/CXP-06 path) targets ACTIVE workbook
        |
TriggerController (time-driven only)
  - health / stale-data check
  - optional inbox poll signal
  - temporary-file cleanup
  - weekly rollover window
        |
HealthCheck
  - sheet catalog, last-run outcome, data freshness, recalc readiness
        |
Control workbook WEEK_REGISTRY + RUN_LOG / ERROR_LOG
```

Standalone Apps Script remains the single control plane. Weekly instances are data/report workbooks only. The control workbook is long-lived across weeks; the target workbook rotates weekly.

### Relationship to CXP-10 date rollover

| Concern | Owner | Behavior |
|---|---|---|
| Intra-week business day / MOM week-start anchors | CXP-10 `BusinessContextService` | Advance `Interval View!AA2`, `MOM!B3`, `_CALC_STAFF!BE1` without creating a new file |
| Week-boundary workbook instance | CXP-12 `WorkbookLifecycleService` | Copy master template, register new `ACTIVE` week, archive prior week, retarget Script Property |

CXP-12 may call `BusinessContextService` to seed the new week's Monday `weekStart` and opening `businessDay`. It must not clear raw or formula sheets while doing so.

## Components

### WorkbookLifecycleService

Public seams (Apps Script–compatible modules under `src/services/` / `src/main/`):

| Function | Responsibility |
|---|---|
| `createOrActivateWeeklyWorkbook(weekKey?, options?)` | Idempotent template copy + registry + active-target retarget |
| `getActiveWeeklyWorkbook()` | Resolve ACTIVE row and verify Script Property agreement |
| `archiveWeeklyWorkbook(weekKey)` | Mark prior ACTIVE as `ARCHIVED`; refuse if still the configured target |
| `initializeWeekControls(spreadsheetId, context)` | Ensure-only week anchors; never overwrite live raw/calc/agg values |
| `promoteEnvironmentChecklist(fromEnv, toEnv)` | Return a sanitized checklist; never write PROD without explicit operator confirmation helper |

Copy uses Drive file duplication of the master template spreadsheet. After copy:

1. Set spreadsheet timezone to `Etc/GMT+8`.
2. Run ensure-only CXP-02 sheet/protection initialization.
3. Seed business-context anchors for the week.
4. Append or upsert the `WEEK_REGISTRY` row.
5. Write `CXP_<ENV>_TARGET_SPREADSHEET_ID` to the new spreadsheet ID.
6. Archive the previous ACTIVE row when present and distinct.

### WEEK_REGISTRY

Final write contract replaces the provisional headers. Status values: `ACTIVE`, `ARCHIVED`, `FAILED`, `SUPERSEDED`. Exactly one `ACTIVE` row per environment control workbook. Week Key is the Monday ISO date (`YYYY-MM-DD`) derived by the same Monday rule as `BusinessContextService`.

### TriggerController

Installs and inventories time-driven triggers only. Primary ingestion remains menu/source/RTA-driven (CXP-13 later). Trigger kinds:

| Kind | Cadence intent | Handler |
|---|---|---|
| `HEALTH_CHECK` | Hourly-ish maintenance | `HealthCheck.runScheduled()` |
| `STALE_DATA` | Same or shared with health | Marks stale when last SUCCESS older than threshold |
| `CLEANUP` | Periodic | Temporary import / orphan cleanup already owned by CXP-05/CXP-06 seams |
| `INBOX_POLL` | Optional | Signals availability only; does not commit |
| `WEEKLY_ROLLOVER` | Weekly window | Invokes lifecycle create/activate for the next Week Key |

Every trigger handler must acquire the existing script-lock convention before mutating registry or target properties, emit bounded audit metadata, and exit within the cooperative budget used by prior packets.

### HealthCheck

Returns a sanitized status object (and optionally appends a bounded control-row or Script Property snapshot) covering:

- missing required sheets from `SheetNames` catalogs;
- last `RUN_LOG` terminal state and age;
- stale-data threshold breach;
- recalculation readiness (flush/health seam already used by CXP-06);
- ACTIVE registry vs `TARGET_SPREADSHEET_ID` agreement.

No cell values, source rows, or spreadsheet IDs appear in repository evidence or UAT logs.

## Environment promotion

Promotion changes Script Properties and the local/CI clasp target, not source (ADR-010). Required keys per environment:

- `CXP_ENV`
- `CXP_<ENV>_TARGET_SPREADSHEET_ID`
- `CXP_<ENV>_CONTROL_SPREADSHEET_ID`
- `CXP_<ENV>_MASTER_TEMPLATE_SPREADSHEET_ID`
- `CXP_<ENV>_DRIVE_INBOX_FOLDER_ID` (owned with CXP-05/CXP-13; validated present for promotion)

PROD promotion requires an explicit operator acknowledgment helper and recorded checklist evidence. CXP-00's non-production clasp boundary remains in force until CXP-14 cutover.

## Failure and recovery

| Failure | Safe state | Recovery |
|---|---|---|
| Template missing / unreadable | No registry write; target property unchanged | Fix `MASTER_TEMPLATE` property |
| Copy succeeds, registry write fails | Orphan spreadsheet may exist; status `FAILED` if partial row written | Retry create/activate; idempotent Week Key reuses or supersedes `FAILED` |
| Registry ACTIVE but property not updated | HealthCheck reports mismatch; ingestion must fail closed | `repairActiveTargetPointer()` or rerun activate |
| Accidental re-init on live week | Ensure-only path; raw data preserved | No recovery needed |
| Rollover during COMMITTING | Lock timeout / refuse rollover | Wait for ingestion terminal state |
| Stale or failed last run | HealthCheck `unhealthy` | Operator inspects `RUN_LOG` / `ERROR_LOG`; no automatic destructive reset |

## Observability

Lifecycle and trigger actions log bounded fields only: Week Key, status transitions, trigger kind, duration, health codes. Spreadsheet IDs, folder IDs, and user emails never enter repository evidence.

## Acceptance Criteria

- A new weekly workbook can be created and registered idempotently from the master template.
- Hourly ingestion resolves the registered ACTIVE workbook through configuration.
- Stale or failed pipeline state is detectable via HealthCheck without reading source code.
- DEV/UAT/PROD configuration can be promoted without source edits.
- Accidental week-control rerun does not clear live operational data.
- Time-driven triggers do not replace user/source-triggered ingestion as the primary refresh path.

## Externally Observable Decisions

- Provisional `WEEK_REGISTRY` headers become the final CXP-12 contract (see lifecycle contract).
- `TARGET_SPREADSHEET_ID` remains the runtime authority for ingestion; registry is the durable history and health cross-check.
- Weekly file rollover and intra-week date rollover stay separate concerns (CXP-12 vs CXP-10).
- Trigger delivery remains eventual; handlers are idempotent.
