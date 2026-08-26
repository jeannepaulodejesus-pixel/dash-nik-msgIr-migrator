# CXP-07 Apps Script Hosted DEV/UAT Harness

## Purpose

Parameterless Apps Script editor helpers for executing `docs/cxp07-uat-runbook.md`. Install/resume entrypoints live in `src/main/Cxp07Setup.js`. Parity, peak, refresh, and topology helpers live in `src/main/Cxp07UatEntrypoints.js`.

## Safety and Script Properties

- `CXP_ENV` must be `DEV` or `UAT` (never `PROD` for UAT).
- `CXP_<ENV>_TARGET_SPREADSHEET_ID` must point at the disposable **target** workbook (not control).
- `CXP_<ENV>_CONTROL_SPREADSHEET_ID` must be a distinct control workbook.
- Peak ingest via CXP-06 Case 1 also requires the five `CXP_UAT_*_FILE_ID` properties (tracked locally in `.uat-source-file-ids.json` for operator setup; do not paste IDs into promotion evidence).

## Install / resume entrypoints (`Cxp07Setup.js`)

| Entrypoint | Purpose |
|---|---|
| `initializeCxp07HandledOfferedTransformations` | Start or resume the 27-step Handled/Offered install on the configured target. Re-running after `COMPLETE` starts a clean reinstall on the **same** target. After `COMPLETE`/`FAILED` on a **different** target, starts clean on the new target. Refuses to retarget while `RUNNING`. |
| `continueCxp07HandledOfferedTransformations` | Time-driven or manual continuation from the persisted checkpoint. |
| `getCxp07HandledOfferedTransformationStatus` | Returns and logs sanitized install status (`IDLE` / `RUNNING` / `COMPLETE` / `FAILED`), including `nextStep`, `stepCount`, `lastCompletedStep`, and `targetSpreadsheetId`. |
| `resetCxp07HandledOfferedInstallationState` | Clears `CXP07_HANDLED_OFFERED_INSTALL_STATE`, removes continuation triggers, returns `IDLE`. Use when retargeting a stuck `RUNNING` install or after an intentional abort. |
| `diagnoseCxp07RunbookChecks` | Optional diagnostic: raw CXP-03 header match, calc header/anchor/fill-down sample for the configured (or passed) spreadsheet. |

### Install log tags

All install entrypoints emit `console` + `Logger` lines:

| Tag | Meaning |
|---|---|
| `CXP07_INSTALL` | `START` / `INITIALIZE` / `CONTINUE` / `CHECKPOINT` / `RUNNING` / `COMPLETE` / `FAILED` / `RETURN` / `ERROR` / `reset` |
| `CXP07_STEP` | One completed install step (`stepIndex`, `label`, `nextStep`, `elapsedMs`) |
| `CXP07_STATUS` | Status poll payload |

## Parity / peak / topology entrypoints (`Cxp07UatEntrypoints.js`)

Telemetry uses `CXP_UAT_PHASE` lines with `operationName`, `status` (`STARTED` / `COMPLETED` / `FAILED` / `INFO`), and `elapsedMs`.

| Entrypoint | Runbook item | Purpose |
|---|---|---|
| `cxp07UatStep1LoadParityFixture` | Parity §1 | Writes synthetic fixture rows into `_RAW_HANDLED`, `_RAW_OFFERED`, `_RAW_AHT` (complete CXP-03 headers). Overwrites prior raw content. |
| `cxp07UatStep1RecordParityOutputs` | Parity §2 | Flushes, reads calc outputs for fixture sessions, compares to embedded expected values (including UTC→fixed-PST Accept Date buckets). |
| `cxp07UatStep1RunParity` | Parity §1–2 | Load + record/compare in one invocation. |
| `cxp07UatStep2PeakFlushTiming` | Peak §3 | Opens configured target; refuses control workbook; requires ≥4500 Handled and Offered raw data rows; requires calc row-2 anchors (4 / 16) and spilled calc rows; flushes; scans Handled A:C and Offered A:O for `#REF!` / parse errors (caps 5000 rows). `#N/A` is allowed (e.g. missing Handled ASA lookup). |
| `cxp07UatStep3SecondBundleRefresh` | Refresh §4 | Loads a second fixture bundle without reinstalling formulas; asserts prior sessions cleared and new sessions refresh; confirms formula anchors unchanged. |
| `cxp07UatStep4ReinstallTopology` | Reinstall §5 | Calls `initializeConfigured()` (clean reinstall when prior status is `COMPLETE`). If still `RUNNING` / pending, returns `pending: true` and instructs the operator to wait / continue, then verify. |
| `cxp07UatStep4VerifyTopology` | Reinstall §5 | Requires install `COMPLETE` (`nextStep === stepCount`). Asserts `_CALC_HANDLED` 30 headers + A2:D2 only; `_CALC_OFFERED` 42 headers + A2:P2 only; no fill-down; within row/column bounds. |

## Recommended operator sequence (peak on one target)

1. Point `TARGET` at the peak-capable DEV target; point `CONTROL` at the control workbook.
2. Finish `cxp06UatCase1PeakSuccess` → `getCxp06UatPipelineStatus` = `COMPLETE` (~10k / 10k / 15k raw).
3. `resetCxp07HandledOfferedInstallationState` if status is stale/`RUNNING` on another book; else proceed.
4. `initializeCxp07HandledOfferedTransformations` → continue until `COMPLETE` / `27/27` (Sheets timeouts are resumable).
5. `cxp07UatStep2PeakFlushTiming`.
6. Optional: `cxp07UatStep4ReinstallTopology` → continue on timeout → `cxp07UatStep4VerifyTopology`.

Do **not** run Step 1 parity on the same book after peak unless you intend to overwrite peak raw and reload Case 1 afterward.

## Evidence rules

Record sanitized counts, timings, status enums, and pass/fail only. Never attach source rows, spreadsheet IDs, user emails, or formula cells containing business data in promotion packets. See `docs/cxp07-hosted-uat-results-2026-08-26.md` for the hosted sign-off template filled from the August 26, 2026 run.
