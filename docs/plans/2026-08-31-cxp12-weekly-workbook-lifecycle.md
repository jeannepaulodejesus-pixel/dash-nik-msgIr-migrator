# CXP-12 Weekly Workbook Lifecycle Implementation Plan

**Status:** Implementation landed for registry, lifecycle, health, triggers, promotion checklist, local tests, and `CXP12UatStep00`–`CXP12UatStep08` helpers. Hosted UAT evidence remains a promotion gate.

**Design:** [`docs/specs/2026-08-31-cxp12-weekly-workbook-lifecycle-design.md`](../specs/2026-08-31-cxp12-weekly-workbook-lifecycle-design.md)  
**Contract:** [`docs/weekly-workbook-lifecycle-contract.md`](../weekly-workbook-lifecycle-contract.md)  
**Hosted UAT:** [`docs/cxp12-uat-runbook.md`](../cxp12-uat-runbook.md) · [`docs/cxp12-uat-harness.md`](../cxp12-uat-harness.md)

## Summary

Operationalize the weekly active-template model, maintenance scheduling, health checks, and DEV/UAT/PROD promotion checklist.

CXP-12 will:

- Finalize `WEEK_REGISTRY` and implement `WeekRegistryRepository`.
- Implement `WorkbookLifecycleService` for master-template → weekly-instance create/activate/archive.
- Keep active-workbook resolution configuration-driven and cross-checked against the registry.
- Implement `TriggerController` for maintenance-only time-driven triggers.
- Implement `HealthCheck` for stale data, missing sheets, failed last run, and recalc readiness.
- Provide `CXP12UatStep00`–`CXP12UatStep08` helpers consistent with CXP-07 through CXP-11.
- Document environment keys and an approval-bound promotion checklist.

**Dependencies (all complete):** CXP-02, CXP-04, CXP-06, CXP-10. May consume CXP-11 control-workbook conventions but does not require a live parity run.

## Key Implementation Changes

### 1. Finalize WEEK_REGISTRY and configuration seams

- Replace provisional headers with the contract columns, including `Activated At UTC`.
- Add `WeekRegistryRepository` with ACTIVE lookup, upsert, archive, and mismatch detection.
- Require `CXP_<ENV>_MASTER_TEMPLATE_SPREADSHEET_ID` in lifecycle entrypoints (fail closed).
- Optional `CXP_<ENV>_STALE_DATA_THRESHOLD_MINUTES` with documented default.
- Keep `CXP_<ENV>_TARGET_SPREADSHEET_ID` as the runtime ingestion pointer; registry is durable history.

### 2. Implement WorkbookLifecycleService

- Drive-copy master template; never clone Apps Script projects into the weekly file (ADR-002).
- Ensure CXP-02 skeleton/protections with ensure-only semantics (DEC-023).
- Seed week anchors through `BusinessContextService` without clearing raw/calc/agg/report bodies.
- Idempotent `createOrActivateWeeklyWorkbook` for the same Week Key.
- Archive previous ACTIVE before retargeting Script Properties.
- Refuse rollover while CXP-04 lock / non-terminal run is held.

### 3. Implement TriggerController and HealthCheck

- Install/list/remove maintenance triggers by kind: `HEALTH_CHECK`, `STALE_DATA`, `CLEANUP`, `INBOX_POLL`, `WEEKLY_ROLLOVER`.
- Do not schedule primary ingestion on a timer.
- HealthCheck evaluates sheet catalog, last-run state/age, stale threshold, recalc readiness, and registry/property alignment.
- Persist only sanitized codes and timings.

### 4. Environment promotion checklist

- Pure checklist builder comparing required destination keys and smoke-gate inputs.
- DEV and UAT may be exercised by UAT helpers; PROD requires explicit acknowledgment.
- Update [`docs/configuration.md`](../configuration.md) with ownership and promotion steps.

### 5. UAT succession helpers and documentation

| Step | Entrypoint | Gate |
|---|---|---|
| 00 | `CXP12UatStep00VerifyPrerequisites` | CXP-02/04/06/10 complete; template + control configured |
| 01 | `CXP12UatStep01InstallRegistry` | Final `WEEK_REGISTRY` headers installed |
| 02 | `CXP12UatStep02CreateOrActivateWeek` | Idempotent weekly instance registered ACTIVE |
| 03 | `CXP12UatStep03AlignActiveTarget` | Script Property matches ACTIVE registry row |
| 04 | `CXP12UatStep04HealthCheck` | Healthy baseline; injected missing-sheet/stale/failed-run detectable |
| 05 | `CXP12UatStep05TriggerInventory` | Maintenance triggers installed; no primary-ingest trigger |
| 06 | `CXP12UatStep06WeeklyRollover` | Next Week Key activates; prior week ARCHIVED; live data preserved on old book |
| 07 | `CXP12UatStep07ReinitSafety` | Accidental re-init does not clear live raw data |
| 08 | `CXP12UatStep08PromotionGate` | Checklist complete; `promotionReady: true` |

## Test Plan and Acceptance Criteria

- Add `npm run test:cxp12` covering Week Key validation, idempotent activate, archive transitions, ACTIVE mismatch fail-closed, ensure-only reinit, health codes, trigger inventory kinds, promotion checklist completeness, and lock refusal during rollover.
- Use injected Drive/Spreadsheet/Properties/Lock/Trigger doubles; no live IDs in fixtures.
- Run `npm run test:cxp12` and full `npm run verify`.
- Hosted DEV/UAT acceptance requires the Step 00–08 gates above with sanitized evidence only.

### Packet acceptance (from handoff)

- [ ] A new weekly workbook can be created/registered idempotently from the master template.
- [ ] Hourly ingestion targets the registered active workbook.
- [ ] Stale or failed pipeline state is detectable without inspecting code.
- [ ] DEV/UAT/PROD configuration can be promoted without source edits.

## Assumptions and Non-Goals

- Master template is an operator-prepared spreadsheet containing the approved sheet skeleton (and optionally installed CXP-07–CXP-10 topology); CXP-12 copies data structure, not bound code.
- Intra-week date advancement remains CXP-10 `BusinessContextService`; CXP-12 owns week-boundary file rollover only.
- Inbox polling signals availability only; CXP-13 owns RTA intake UX.
- Exact trigger wall-clock delivery is not guaranteed.
- No daily files; no upload-history retention for scheduling.

## Implementation task checklist

- [x] Task 1: Contract modules — `WeekRegistryRepository`, header finalization, config keys, focused red tests
- [x] Task 2: `WorkbookLifecycleService` create/activate/archive/align with Drive/Spreadsheet doubles
- [x] Task 3: `HealthCheck` + `TriggerController` inventory and handlers
- [x] Task 4: Setup/UAT entrypoints `CXP12UatStep00`–`08`
- [x] Task 5: Docs already drafted; update packet-status/decision-log on code completion
- [ ] Task 6: Hosted DEV/UAT acceptance and promotion gate

## Packet completion handoff (required on code complete)

Document trigger inventory, environment keys, weekly rollover sequence, failure recovery, and manual override procedures. Commit message: `feat: operationalize weekly workbook lifecycle`.
