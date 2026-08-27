# CXP-07 Apps Script Hosted DEV/UAT Harness

## Purpose

Parameterless Apps Script editor helpers for executing `docs/cxp07-uat-runbook.md`. Install/resume entrypoints live in `src/main/Cxp07Setup.js`. Parity, peak, refresh, and topology helpers live in `src/main/Cxp07UatEntrypoints.js`.

## Safety and Script Properties

- `CXP_ENV` must be `DEV` or `UAT` (never `PROD` for UAT).
- `CXP_<ENV>_TARGET_SPREADSHEET_ID` must point at the disposable **target** workbook (not control).
- `CXP_<ENV>_CONTROL_SPREADSHEET_ID` must be a distinct control workbook.
- Peak ingest via CXP-06 Case 1 also requires the five `CXP_UAT_*_FILE_ID` properties (tracked locally in `.uat-source-file-ids.json` for operator setup; do not paste IDs into promotion evidence).

Persisted UAT/install state keys (delete to reset):

| Script Property | Cleared by |
|---|---|
| `CXP07_HANDLED_OFFERED_INSTALL_STATE` | `resetCxp07HandledOfferedInstallationState` or manual delete |
| `CXP07_UAT_STEP3_STATE` | Manual delete (or finishes as `COMPLETE` / `FAILED`) |
| `CXP06_UAT_PIPELINE_STATE` | Manual delete (CXP-06 has no reset helper) |

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
| `cxp07UatStep3SecondBundleRefresh` | Refresh §4 | Starts or advances resumable Step 3 (see below). |
| `continueCxp07UatStep3Refresh` | Refresh §4 | Time-driven / manual continuation for Step 3. |
| `getCxp07UatStep3Status` | Refresh §4 | Poll Step 3 status without advancing work. |
| `cxp07UatStep4ReinstallTopology` | Reinstall §5 | Calls `initializeConfigured()` (clean reinstall when prior status is `COMPLETE`). If still `RUNNING` / pending, returns `pending: true` and instructs the operator to wait / continue, then verify. |
| `cxp07UatStep4VerifyTopology` | Reinstall §5 | Requires install `COMPLETE` (`nextStep === stepCount`). Asserts `_CALC_HANDLED` 30 headers + A2:D2 only; `_CALC_OFFERED` 42 headers + A2:P2 only; no fill-down; within row/column bounds. |

## Step 3 — resumable second-bundle refresh

Replacing ~10k peak raw rows with the small second fixture in one Apps Script invocation often hits the six-minute limit (clear + calc spill recalc). Step 3 therefore runs as a **checkpointed pipeline**: one phase per invocation, with a time-driven continuation and a status poller.

### Entrypoints

| Entrypoint | When to run |
|---|---|
| `cxp07UatStep3SecondBundleRefresh` | Start a new Step 3 after `COMPLETE`/`FAILED`/`IDLE`, **or** manually advance while `RUNNING` (same phase as the pending continuation). |
| `continueCxp07UatStep3Refresh` | Invoked by the scheduled trigger (~30s after each handoff). Safe to run manually if the trigger is late. |
| `getCxp07UatStep3Status` | Poll only — does not write sheets. Logs `CXP_UAT_PHASE` / `step3.refresh.status`. |

### Phases (in order)

| `phase` | Work |
|---|---|
| `WRITE_HANDLED` | Clear/write `_RAW_HANDLED` with second-fixture rows |
| `WRITE_OFFERED` | Clear/write `_RAW_OFFERED` |
| `WRITE_AHT` | Clear/write `_RAW_AHT` |
| `VERIFY` | Flush, confirm calc A2 formulas unchanged, compare SESSION-300/400 outputs; prior SESSION-100/200 must be absent |

Peak-sized clears use `sheet.clearContents()` (not chunked `clearContent` + `flush`) to avoid forcing full spill recalc between chunks.

### Status shape (`getCxp07UatStep3Status`)

Typical fields:

- `status`: `IDLE` | `RUNNING` | `COMPLETE` | `FAILED`
- `phase` / `phaseIndex` / `phaseCount` (4)
- `continuationScheduled`: whether a `continueCxp07UatStep3Refresh` trigger was installed after the last handoff
- `lastError`: message when `FAILED`
- `spreadsheetId`: target used for this Step 3 run (omit from promotion packets)

While `RUNNING`, start/continue returns `pending: true` and `nextAction` text for the operator.

### Operator flow

1. Optional: delete Script Property `CXP07_UAT_STEP3_STATE` if a prior Step 3 is stuck `FAILED` or you want a clean start.
2. Confirm CXP-07 install is `COMPLETE` and calc row-2 formulas exist.
3. Run `cxp07UatStep3SecondBundleRefresh` once.
4. Poll `getCxp07UatStep3Status` until `COMPLETE` (or re-run `cxp07UatStep3SecondBundleRefresh` / `continueCxp07UatStep3Refresh` to advance).
5. Do **not** start Step 4 until Step 3 is `COMPLETE` if you need refresh evidence in the same pass.

### Step 3 log tags

| `operationName` | Meaning |
|---|---|
| `step3.refresh` | Overall start / pass / fail / complete |
| `step3.refresh.phase` | Phase start / done |
| `step3.refresh.pending` | Handoff; wait for continuation |
| `step3.refresh.status` | Status poll |
| `step3.refresh.write` / `.clear` | Per-sheet write telemetry |

### Recovery

| Situation | Action |
|---|---|
| `FAILED` mid-phase | Fix cause; delete `CXP07_UAT_STEP3_STATE`; re-run `cxp07UatStep3SecondBundleRefresh` |
| Trigger missing / stalled `RUNNING` | Re-run `cxp07UatStep3SecondBundleRefresh` or `continueCxp07UatStep3Refresh` |
| Exceeded maximum execution time on one phase | Rare after resumable design; delete state and retry, or manually clear that raw sheet then continue |

## Recommended operator sequence (peak on one target)

1. Point `TARGET` at the peak-capable DEV target; point `CONTROL` at the control workbook.
2. Finish `cxp06UatCase1PeakSuccess` → `getCxp06UatPipelineStatus` = `COMPLETE` (~10k / 10k / 15k raw).
3. `resetCxp07HandledOfferedInstallationState` if status is stale/`RUNNING` on another book; else proceed.
4. `initializeCxp07HandledOfferedTransformations` → continue until `COMPLETE` / `27/27` (Sheets timeouts are resumable).
5. `cxp07UatStep2PeakFlushTiming`.
6. `cxp07UatStep3SecondBundleRefresh` → poll `getCxp07UatStep3Status` until `COMPLETE`.
7. `cxp07UatStep4ReinstallTopology` → continue on timeout → `cxp07UatStep4VerifyTopology`.

Do **not** run Step 1 parity on the same book after peak unless you intend to overwrite peak raw and reload Case 1 afterward.

## Evidence rules

Record sanitized counts, timings, status enums, and pass/fail only. Never attach source rows, spreadsheet IDs, user emails, or formula cells containing business data in promotion packets. See `docs/cxp07-hosted-uat-results-2026-08-26.md` for the hosted sign-off template filled from the August 26, 2026 run.
