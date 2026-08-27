# CXP-08 Apps Script Hosted DEV/UAT Harness

## Purpose

Parameterless Apps Script editor helpers for executing [`docs/cxp08-uat-runbook.md`](cxp08-uat-runbook.md). Install/resume entrypoints live in `src/main/Cxp08Setup.js`. Parity, peak, refresh, and topology helpers live in `src/main/Cxp08UatEntrypoints.js`.

## Safety and Script Properties

- `CXP_ENV` must be `DEV` or `UAT` (never `PROD` for UAT).
- `CXP_<ENV>_TARGET_SPREADSHEET_ID` must point at the disposable **target** workbook (not control).

Persisted install state key (delete to reset):

| Script Property | Cleared by |
|---|---|
| `CXP08_AHT_AUXES_STAFF_INSTALL_STATE` | `resetCxp08AhtAuxesStaffInstallationState` or manual delete |

## Install / resume entrypoints (`Cxp08Setup.js`)

| Entrypoint | Purpose |
|---|---|
| `initializeCxp08AhtAuxesStaffTransformations` | Start or resume the 74-step install |
| `continueCxp08AhtAuxesStaffTransformations` | Time-driven or manual continuation |
| `getCxp08AhtAuxesStaffTransformationStatus` | Sanitized install status |
| `resetCxp08AhtAuxesStaffInstallationState` | Clear stuck `RUNNING` state |
| `diagnoseCxp08RunbookChecks` | Raw schema + calc topology diagnostic |

## UAT succession helpers (`Cxp08UatEntrypoints.js`)

| Helper | Runbook step |
|---|---|
| `CXP08UatStep01Install` | Install / resume via initialize |
| `CXP08UatStep02InspectTopology` | Topology diagnostic |
| `CXP08UatStep03LoadParityFixture` | Write synthetic AHT/Auxes/Staff raw + business day |
| `CXP08UatStep04RecordParityOutputs` | Compare calc outputs to embedded fixture |
| `CXP08UatStep05PeakFlushTiming` | Flush timing + last-row counts |
| `CXP08UatStep06SecondBundleRefresh` | Second raw bundle without reinstall |
| `CXP08UatStep07ReinstallTopology` | Clean reinstall |
| `CXP08UatStep08PromotionGate` | Aggregate install/topology promotion checklist |

## Evidence

Record sanitized counts/timings only. Never attach source rows, spreadsheet IDs, user emails, or formula error values containing business data.
