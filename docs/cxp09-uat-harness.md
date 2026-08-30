# CXP-09 Apps Script Hosted DEV/UAT Harness

## Purpose

Parameterless Apps Script editor helpers for executing [`docs/cxp09-uat-runbook.md`](cxp09-uat-runbook.md). Install/resume entrypoints live in `src/main/Cxp09Setup.js`. Parity, peak, refresh, and topology helpers live in `src/main/Cxp09UatEntrypoints.js`.

**Prerequisites:** Inherit CXP-07/CXP-08 DEV target from [`docs/cxp07-hosted-uat-results-2026-08-26.md`](cxp07-hosted-uat-results-2026-08-26.md) and [`docs/cxp08-hosted-uat-results-2026-08-28.md`](cxp08-hosted-uat-results-2026-08-28.md). Peak Step 05 uses CXP-08 peak target B per [`docs/cxp08-hosted-uat-results-peak-2026-08-28.md`](cxp08-hosted-uat-results-peak-2026-08-28.md). Full checklist: [`docs/plans/2026-08-28-cxp09-stable-aggregation.md`](plans/2026-08-28-cxp09-stable-aggregation.md).

## Safety and Script Properties

- `CXP_ENV` must be `DEV` or `UAT` (never `PROD` for UAT).
- `CXP_<ENV>_TARGET_SPREADSHEET_ID` must point at the disposable **target** workbook (not control).

Persisted install state key (delete to reset):

| Script Property | Cleared by |
|---|---|
| `CXP09_AGGREGATION_INSTALL_STATE_V3` | `resetCxp09StableAggregationInstallationState` or manual delete |

## Install / resume entrypoints (`Cxp09Setup.js`)

| Entrypoint | Purpose |
|---|---|
| `initializeCxp09StableAggregationModel` | Start or resume the 15-step aggregation install |
| `continueCxp09StableAggregationModel` | Time-driven or manual continuation |
| `getCxp09StableAggregationStatus` | Sanitized install status |
| `resetCxp09StableAggregationInstallationState` | Clear stuck `RUNNING` state |
| `diagnoseCxp09RunbookChecks` | `_AGG_*` header and formula-anchor diagnostic |

## UAT succession helpers (`Cxp09UatEntrypoints.js`)

| Helper | Runbook step |
|---|---|
| `CXP09UatStep00VerifyPrerequisites` | Prerequisite gate (CXP-07 + CXP-08 `COMPLETE`) |
| `CXP09UatStep01Install` | Install / resume via initialize |
| `CXP09UatStep02InspectTopology` | Topology diagnostic |
| `CXP09UatStep03LoadParityFixture` | Write synthetic 5-dataset bundle (CXP-09 handled/offered/aht + **CXP-08 auxes/staff**) |
| `CXP09UatStep03RunParity` | Load + wait + compare in one invocation |
| `CXP09UatStep04RecordParityOutputs` | Compare `_AGG_INTERVAL` + `_AGG_ALLOCATION` to fixture |
| `CXP09UatStep05PeakFlushTiming` | Flush timing + agg/calc last-row counts; compares to CXP-08 peak baseline |
| `CXP09UatStep06SecondBundleRefresh` | Second raw bundle without reinstall |
| `CXP09UatStep07ReinstallTopology` | Clean reinstall |
| `CXP09UatStep08PromotionGate` | Aggregate install/topology promotion checklist |

## Evidence

Record sanitized counts/timings only. Never attach source rows, spreadsheet IDs, user emails, or formula error values containing business data.

Results log: [`docs/cxp09-hosted-uat-results-2026-08-28.md`](cxp09-hosted-uat-results-2026-08-28.md).
