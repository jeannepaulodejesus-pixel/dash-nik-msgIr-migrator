# CXP-12 Apps Script Hosted DEV/UAT Harness

## Purpose

Parameterless Apps Script editor helpers for executing [`docs/cxp12-uat-runbook.md`](cxp12-uat-runbook.md). Modules:

| Module | Role |
|---|---|
| `src/main/Cxp12Setup.js` | Registry header install / status / reset |
| `src/services/WorkbookLifecycleService.js` | Create, activate, archive, align |
| `src/services/TriggerController.js` | Maintenance trigger inventory |
| `src/services/HealthCheck.js` | Sanitized health evaluation |
| `src/services/PromotionChecklist.js` | Environment promotion gates |
| `src/main/Cxp12UatEntrypoints.js` | `CXP12UatStep00`–`08` succession helpers |

Contract authority: [`docs/weekly-workbook-lifecycle-contract.md`](weekly-workbook-lifecycle-contract.md). Design: [`docs/specs/2026-08-31-cxp12-weekly-workbook-lifecycle-design.md`](specs/2026-08-31-cxp12-weekly-workbook-lifecycle-design.md).

## Safety and Script Properties

- `CXP_ENV` must be `DEV` or `UAT` (never `PROD` for UAT helpers).
- `CXP_<ENV>_CONTROL_SPREADSHEET_ID` — long-lived control workbook (`WEEK_REGISTRY`, `RUN_LOG`, `ERROR_LOG`).
- `CXP_<ENV>_MASTER_TEMPLATE_SPREADSHEET_ID` — master weekly template (required).
- `CXP_<ENV>_TARGET_SPREADSHEET_ID` — ACTIVE weekly instance; rewritten by create/activate/rollover.
- Optional: `CXP_<ENV>_STALE_DATA_THRESHOLD_MINUTES`.
- Upstream packets CXP-02, CXP-04, CXP-06, and CXP-10 must be available on the template/target path used for smoke checks.

Persisted state keys (planned; delete to reset):

| Script Property | Cleared by |
|---|---|
| `CXP12_LIFECYCLE_SETUP_STATE_V1` | `resetCxp12LifecycleSetupState` or manual delete |
| `CXP12_TRIGGER_INVENTORY_V1` | TriggerController reset helper |

## Setup / lifecycle entrypoints

| Entrypoint | Purpose |
|---|---|
| `initializeCxp12Lifecycle` | Install final `WEEK_REGISTRY` headers / protections |
| `continueCxp12LifecycleSetup` | Resume/re-run setup |
| `getCxp12LifecycleSetupStatus` | Sanitized `IDLE` / `RUNNING` / `COMPLETE` / `FAILED` |
| `resetCxp12LifecycleSetupState` | Clear stuck setup (refused while `RUNNING`) |
| `createOrActivateWeeklyWorkbook` | Idempotent weekly instance + ACTIVE registration |
| `getActiveWeeklyWorkbook` | ACTIVE row + property alignment summary |
| `runCxp12HealthCheck` | Sanitized health object |
| `installCxp12MaintenanceTriggers` | Install inventory by kind |
| `listCxp12MaintenanceTriggers` | Kind + enabled counts only |
| `diagnoseCxp12RunbookChecks` | Config, registry, health, trigger diagnostic |

## UAT succession helpers (`Cxp12UatEntrypoints.js`)

| Helper | Runbook step |
|---|---|
| `CXP12UatStep00VerifyPrerequisites` | Dependency and configuration readiness |
| `CXP12UatStep01InstallRegistry` | Final `WEEK_REGISTRY` headers |
| `CXP12UatStep02CreateOrActivateWeek` | Idempotent ACTIVE registration |
| `CXP12UatStep03AlignActiveTarget` | Property ↔ registry agreement |
| `CXP12UatStep04HealthCheck` | Baseline healthy + negative detections |
| `CXP12UatStep05TriggerInventory` | Maintenance triggers only |
| `CXP12UatStep06WeeklyRollover` | Next week ACTIVE; prior ARCHIVED |
| `CXP12UatStep07ReinitSafety` | Live raw data preserved on re-init |
| `CXP12UatStep08PromotionGate` | Aggregate promotion checklist |

## Pure surfaces used by tests

Lifecycle, registry, health, and trigger controllers accept injected Drive / Spreadsheet / Properties / Lock / Trigger ports so Node tests never touch live Google IDs. Fixtures use synthetic Week Keys and opaque ID tokens that tests assert by equality only inside doubles — never printed into repository evidence files.

## Evidence

Record Week Keys, statuses, health codes, timings, and trigger kinds only. Never attach spreadsheet IDs, folder IDs, user emails, source rows, or cell values.
