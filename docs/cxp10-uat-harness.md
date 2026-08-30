# CXP-10 Apps Script Hosted DEV/UAT Harness

## Purpose

Parameterless Apps Script editor helpers for executing [`docs/cxp10-uat-runbook.md`](cxp10-uat-runbook.md). Install/resume entrypoints live in `src/main/Cxp10Setup.js`. Topology and promotion helpers live in `src/main/Cxp10UatEntrypoints.js`.

## Safety and Script Properties

- `CXP_ENV` must be `DEV` or `UAT` (never `PROD` for UAT).
- `CXP_<ENV>_TARGET_SPREADSHEET_ID` must point at the disposable **target** workbook (not control).
- CXP-09 install must be `COMPLETE` on the same target before CXP-10 install.

Persisted install state key (delete to reset):

| Script Property | Cleared by |
|---|---|
| `CXP10_REPORTING_INSTALL_STATE_V2` | `resetCxp10ReportingInstallationState` or manual delete |

## Install / resume entrypoints (`Cxp10Setup.js`)

| Entrypoint | Purpose |
|---|---|
| `initializeCxp10ReportingSurfaces` | Start or resume the report-surface install |
| `continueCxp10ReportingSurfaces` | Time-driven or manual continuation |
| `getCxp10ReportingSurfaceStatus` | Sanitized install status |
| `resetCxp10ReportingInstallationState` | Clear stuck `RUNNING` state |
| `diagnoseCxp10RunbookChecks` | Interval View / MOM / forecast-bridge diagnostic |

## UAT succession helpers (`Cxp10UatEntrypoints.js`)

| Helper | Runbook step |
|---|---|
| `CXP10UatStep01Install` | Install / resume via initialize |
| `CXP10UatStep02InspectTopology` | Topology diagnostic |
| `CXP10UatStep03LoadParityFixture` | Seed aggregation + MOM calendar inputs + anchors |
| `CXP10UatStep03RunParity` | Load fixture, flush, compare Interval View |
| `CXP10UatStep04RecordParityOutputs` | Compare Interval View to embedded fixture |
| `CXP10UatStep05WeeklyRollover` | Advance Interval View `AA2` and MOM `B3` by seven days |
| `CXP10UatStep06SecondBundleRefresh` | Refresh raw bundle via CXP-09 helper |
| `CXP10UatStep07ReinstallTopology` | Re-run report-surface installer |
| `CXP10UatStep08PromotionGate` | Aggregate install/topology promotion checklist |

## Evidence

Record sanitized counts/timings only. Never attach source rows, spreadsheet IDs, user emails, or formula error values containing business data.
