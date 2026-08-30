# CXP-08 Apps Script Hosted DEV/UAT Harness

## Purpose

Parameterless Apps Script editor helpers for executing [`docs/cxp08-uat-runbook.md`](cxp08-uat-runbook.md). Install/resume entrypoints live in `src/main/Cxp08Setup.js`. Parity, peak, refresh, and topology helpers live in `src/main/Cxp08UatEntrypoints.js`.

**Dataset rule:** never manually preload sheets. Small parity/refresh data comes from embedded fixtures; peak data comes from backend-configured source files via CXP-06 ingest (see runbook **Dataset policy**).

## Safety and Script Properties

- `CXP_ENV` must be `DEV` or `UAT` (never `PROD` for UAT).
- `CXP_<ENV>_TARGET_SPREADSHEET_ID` must point at the disposable **target** workbook (not control).

Persisted install state key (delete to reset):

| Script Property | Cleared by |
|---|---|
| `CXP08_AHT_AUXES_STAFF_INSTALL_STATE_V2` | `resetCxp08AhtAuxesStaffInstallationState` or manual delete |

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
| `CXP08UatStep03RunParity` | Load fixture, wait for recalc, compare (Steps 03+04) |
| `CXP08UatStep04RecordParityOutputs` | Compare calc outputs to embedded fixture (normalizes Sheets display formats) |
| `CXP08UatStep05PeakFlushTiming` | Flush timing + last-row counts |
| `CXP08UatStep06SecondBundleRefresh` | Second raw bundle without reinstall |
| `CXP08UatStep07ReinstallTopology` | Clean reinstall |
| `CXP08UatStep08PromotionGate` | Aggregate install/topology promotion checklist |

## DEV workbook bootstrap (optional)

See [`docs/configuration.md`](configuration.md). Common entrypoints:

| Entrypoint | Purpose |
|---|---|
| `bootstrapCxpDevWorkbooksForceReplace()` | Create new target + control in `CXP_DEV_BOOTSTRAP_FOLDER_ID` |
| `registerCxpDevWorkbooksFromFolderAndSeed()` | Discover existing workbooks by folder name + set Script Properties + seed headers |

`_STG_*` sheets stay empty during CXP-08 UAT; parity and refresh write directly to `_RAW_*`.

## Recommended operator sequence (peak-loaded target)

Use this when CXP-06 Case 1 peak ingest is **already complete** on the DEV target (`getCxp06UatPipelineStatus()` → `status: COMPLETE`). Do **not** run parity (Steps 03–04) or second-bundle refresh (Step 06) until **after** Step 05 — those helpers overwrite peak raw.

### Prerequisites

1. `CXP_ENV` = `DEV` (or `UAT`); `CXP_DEV_TARGET_SPREADSHEET_ID` points at the **target** workbook (not control).
2. CXP-06 ingest finished: `getCxp06UatPipelineStatus()` → `COMPLETE`, `continuationScheduled: false`.
3. Optional cleanup after ingest: set `CXP_UAT_ENABLED` = `false`, delete any leftover `continueCxp06UatPipeline` triggers, delete `CXP06_UAT_PIPELINE_STATE` if you will not resume CXP-06.
4. Push latest `src/` via `clasp push`.

### Step-by-step (record each helper result in the peak sign-off doc)

| # | Run in Apps Script editor | Poll / confirm | Record |
|---|---|---|---|
| 0 | `getCxp06UatPipelineStatus()` | `status: COMPLETE` | Peak ingest complete |
| 1 | `getCxp08AhtAuxesStaffTransformationStatus()` | If not `COMPLETE`, run `initializeCxp08AhtAuxesStaffTransformations()` → continue until `74/74` | `CXP08_INSTALL` logs |
| 2 | `CXP08UatStep02InspectTopology()` | JSON shows 34 / 28 / 53 calc headers; anchors row 2 only; spills reach raw row counts | Topology diagnostic |
| 3 | `CXP08UatStep05PeakFlushTiming()` | `elapsedMs`, `ahtLastRow`, `auxesLastRow`, `staffLastRow`; scan calc sheets for `#REF!` / parse errors | `CXP08UAT CXP08UatStep05.result` |
| 4 | `CXP08UatStep03RunParity()` **or** `CXP08UatStep03LoadParityFixture()` then `CXP08UatStep04RecordParityOutputs()` | `pass: true`, `ahtDiffCount: 0`, `auxesDiffCount: 0` | `CXP08UatStep04.result` |
| 5 | `CXP08UatStep06SecondBundleRefresh()` | Raw each `lastRow: 2`; calc refreshed without reinstall | Step 06 logs |
| 6 | `CXP08UatStep07ReinstallTopology()` | Install `COMPLETE` after reinstall; re-run Step 02 checks | Install + topology |
| 7 | `CXP08UatStep08PromotionGate()` | `pass: true`, `installComplete: true` | `CXP08UatStep08.result` |

### Order rules

- **Step 05 before Steps 03–04** — parity loads the small fixture and replaces peak raw.
- **Do not** run `CXP08UatStep03LoadParityFixture` on a book you still need for peak flush unless you will re-run CXP-06 Case 1 afterward.
- After Step 05, Steps 03–06 use embedded small fixtures only; no second CXP-06 run is required for parity/refresh evidence.

### Expected peak scale (representative)

Runbook gate: approximately **7,000 AHT**, **3,000 Auxes**, **300 Staff** populated raw rows. CXP-06 Case 1 may load higher ceilings (e.g. 15k AHT); Step 05 records actual `*LastRow` from calc spills.

### Log tags

| Tag | Meaning |
|---|---|
| `CXP08_INSTALL` | Install start / checkpoint / complete / failed |
| `CXP08UAT` | UAT helper telemetry (`CXP08UatStepNN.*`) |
| `CXP06_STATUS` | CXP-06 pipeline status poll |

## Hosted sign-off

- Standard path (small fixture, Step 05 deferred): [`docs/cxp08-hosted-uat-results-2026-08-28.md`](cxp08-hosted-uat-results-2026-08-28.md)
- Peak-loaded path (fill as you run): [`docs/cxp08-hosted-uat-results-peak-2026-08-28.md`](cxp08-hosted-uat-results-peak-2026-08-28.md)

Record sanitized counts/timings only. Never attach source rows, spreadsheet IDs, user emails, or formula error values containing business data.
