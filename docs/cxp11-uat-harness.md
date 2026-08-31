# CXP-11 Apps Script Hosted DEV/UAT Harness

## Purpose

Parameterless Apps Script editor helpers for executing [`docs/cxp11-uat-runbook.md`](cxp11-uat-runbook.md). Setup/resume entrypoints live in `src/main/Cxp11Setup.js`, parity-run entrypoints in `src/main/Cxp11ParityRun.js`, and succession helpers in `src/main/Cxp11UatEntrypoints.js`. Contract authority: [`docs/parity-validation-contract.md`](parity-validation-contract.md).

## Safety and Script Properties

- `CXP_ENV` must be `DEV` or `UAT` (never `PROD` for UAT).
- `CXP_<ENV>_TARGET_SPREADSHEET_ID` must point at the disposable **target** workbook.
- `CXP_<ENV>_CONTROL_SPREADSHEET_ID` must point at the **control** workbook; CXP-11 writes only there.
- `CXP_<ENV>_LEGACY_PARITY_EXPORT_FOLDER_ID` is optional. `startCxp11ParityRun(folderId)` accepts an override; without either, the run fails closed with `PARITY_EXPORT_FOLDER_NOT_CONFIGURED`.
- CXP-07 through CXP-10 must be `COMPLETE` on the same target before CXP-11 install.

Persisted state keys (delete to reset):

| Script Property | Cleared by |
|---|---|
| `CXP11_PARITY_SETUP_STATE_V1` | `resetCxp11ParityValidationSetupState` or manual delete |
| `CXP11_PARITY_RUN_STATE_V1` | `resetCxp11ParityRunState` or manual delete |

## Setup / resume entrypoints (`Cxp11Setup.js`)

| Entrypoint | Purpose |
|---|---|
| `initializeCxp11ParityValidation` | Start or resume the control-contract install (6 steps) |
| `continueCxp11ParityValidationSetup` | Time-driven or manual continuation |
| `getCxp11ParityValidationSetupStatus` | Sanitized `IDLE` / `RUNNING` / `COMPLETE` / `FAILED` status |
| `resetCxp11ParityValidationSetupState` | Clear stuck or wrong-target state (refused while `RUNNING`) |
| `diagnoseCxp11RunbookChecks` | Schema, baseline-total, protection, and state diagnostic |

Install steps, in order: `INSTALL_PARITY_RESULTS_SCHEMA`, `INSTALL_SOURCE_ERROR_BASELINE_SCHEMA`, `SEED_WB0817_SOURCE_ERROR_BASELINE`, `VERIFY_WB0817_BASELINE_TOTALS`, `PROTECT_PARITY_RESULTS`, `PROTECT_SOURCE_ERROR_BASELINE`.

## Parity-run entrypoints (`Cxp11ParityRun.js`)

| Entrypoint | Purpose |
|---|---|
| `startCxp11ParityRun(exportFolderId?)` | Start a run; refused while another run is active |
| `continueCxp11ParityRun` | Time-driven or manual continuation from the persisted cursor |
| `getCxp11ParityRunStatus` | Sanitized run state, cursor, counters, and summary |
| `resetCxp11ParityRunState` | Clear a terminal run; refused while active without force |

## UAT succession helpers (`Cxp11UatEntrypoints.js`)

| Helper | Runbook step |
|---|---|
| `CXP11UatStep00VerifyPrerequisites` | CXP-07 through CXP-10 status plus configuration readiness |
| `CXP11UatStep01Install` | Install final headers and the WB0817 baseline |
| `CXP11UatStep02InspectControlContracts` | Schemas, protections, state, and baseline count |
| `CXP11UatStep03LoadSyntheticParityBundle` | Seed `_RAW_*` fixture rows, write the export bundle to Drive, and seed a `SUCCESS` `FILE_LEDGER` row for the synthetic fingerprint |
| `CXP11UatStep04RunParity` | Start and drive continuations to a terminal run state |
| `CXP11UatStep05ValidateExpectedVarianceAndErrors` | DEC-025 variance and WB0817 error classification |
| `CXP11UatStep06ResumeAndSecondBundle` | Forced yield, retry-safe chunking, and weekly rerun |
| `CXP11UatStep07ReinstallAndRerun` | Setup and comparison idempotence |
| `CXP11UatStep08PromotionGate` | Aggregate promotion checklist |

## Pure surfaces used by tests

`Cxp11ParityUat.buildBundleFiles`, `Cxp11ParityUat.createFixtureExportReader`, `Cxp11ParityUat.seedSyntheticLedgerEntry`, and `Cxp11ParityUat.shiftToLegacyUtcGrain` build and replay a contracted bundle without Drive. `ParityRunEngine.create(ports)` accepts injected export/target/results/baseline/ledger/lock/trigger ports, so the whole state machine is exercised in Node.

## Evidence

Record sanitized counts, classification tallies, timings, chunk IDs, and run state only. Never attach source rows, spreadsheet or folder IDs, user emails, or raw metric values that carry business data.

DEV promotion evidence: [`docs/cxp11-hosted-uat-results-2026-09-01.md`](cxp11-hosted-uat-results-2026-09-01.md).
