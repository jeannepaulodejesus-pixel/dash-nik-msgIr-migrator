# CXP-09 Apps Script Hosted DEV/UAT Harness

## Purpose

Parameterless Apps Script editor helpers for executing [`docs/cxp09-uat-runbook.md`](cxp09-uat-runbook.md). Install/resume entrypoints live in `src/main/Cxp09Setup.js`. Topology and promotion helpers live in `src/main/Cxp09UatEntrypoints.js`.

## Safety and Script Properties

- `CXP_ENV` must be `DEV` or `UAT` (never `PROD` for UAT).
- `CXP_<ENV>_TARGET_SPREADSHEET_ID` must point at the disposable **target** workbook (not control).
- CXP-07 and CXP-08 install must be `COMPLETE` on the same target before CXP-09 install.

Persisted install state key (delete to reset):

| Script Property | Cleared by |
|---|---|
| `CXP09_AGGREGATION_INSTALL_STATE` | `resetCxp09StableAggregationInstallationState` or manual delete |

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
| `CXP09UatStep01Install` | Install / resume via initialize |
| `CXP09UatStep02InspectTopology` | Topology diagnostic |
| `CXP09UatStep08PromotionGate` | Aggregate install/topology promotion checklist |

Steps 03–07 (parity fixture load, parity record, peak timing, second-bundle refresh, reinstall) remain planned.

## Evidence

Record sanitized counts/timings only. Never attach source rows, spreadsheet IDs, user emails, or formula error values containing business data.
