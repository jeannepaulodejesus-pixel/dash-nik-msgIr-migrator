# CXP-11 Excel-to-Google-Sheets Parity Validation Implementation Plan

## Summary

Implement a repeatable, resumable parity workflow that compares a fresh legacy Excel export with the migrated Google Sheets workbook loaded from the identical five-file source bundle.

CXP-11 will:

- Compare all five normalized source tables and all 25 operational metrics.
- Separate migration defects from approved legacy errors and the DEC-025 timezone correction.
- Finalize `PARITY_RESULTS` and `SOURCE_ERROR_BASELINE`.
- Preserve the Apps Script execution boundary through checkpointed phases, locks, cursors, idempotent writes, and time-trigger continuation.
- Provide setup, status, diagnostic, reset, and `CXP11UatStep00`–`CXP11UatStep08` workflows consistent with CXP-07 through CXP-10.

The authoritative baseline is WB0817: 1,885 cached errors (`1,838 #N/A`, `26 #DIV/0!`, `21 #REF!`). The older 5,655 count is retained only as superseded WB0809/project-record history.

**Hosted DEV acceptance:** Complete on 2026-09-01. Evidence: [`docs/cxp11-hosted-uat-results-2026-09-01.md`](../cxp11-hosted-uat-results-2026-09-01.md).

## Key Implementation Changes

### 1. Define the parity contracts

- Add a versioned legacy-export contract consisting of:
  - `manifest.json` with contract version, acquisition timestamp, source-bundle SHA-256 fingerprint, WB0817 control hash, file names, row counts, and file digests.
  - Five canonical wide CSV files for Handled, Offered, AHT, Auxes, and Staff.
  - A long-form metric CSV keyed by business date, interval, site, queue/LOB, metric, and aggregation identity.
  - A legacy-error CSV containing observed worksheet/cell-or-range, error token, and formula-family evidence.
- Require the manifest fingerprint to match a successful `FILE_LEDGER` entry before comparison. Recheck it before every continuation and finalization; fail with `TARGET_SNAPSHOT_CHANGED` if ingestion replaces the target during validation.
- Add an optional `CXP_<ENV>_LEGACY_PARITY_EXPORT_FOLDER_ID` configuration key. `startCxp11ParityRun(folderId?)` accepts an explicit folder override and otherwise fails closed unless the active-environment property exists.
- Add explicit tolerance and source-error contracts:
  - Source-table values, keys, strings, blanks, error tokens, counts, and integer-formatted metrics compare exactly.
  - `0.00`, `0.00%`, and duration metrics use absolute tolerance `1e-9`.
  - Legacy interval keys are shifted by `-480` minutes before matching migrated fixed-PST keys.
  - Only intervals whose right boundary is at or before the fixed-PST acquisition checkpoint are compared.

### 2. Implement pure comparison and repository boundaries

- Build an export adapter that validates filenames, UTF-8 CSV structure, hashes, ordered headers, row counts, timestamps, authoritative keys, and duplicate policy before returning canonical records.
- Keep parsing, key construction, closed-interval selection, normalization, tolerance evaluation, classification, and summary aggregation as pure injected JavaScript without capturing `DriveApp`, `SpreadsheetApp`, or other Apps Script services at module load.
- Compare normalized exports against `_RAW_*` data using canonical row/field digests. Compare metric exports against CXP-09/CXP-10 outputs using the established metric-lineage registry.
- Finalize `PARITY_RESULTS` with deterministic comparison/chunk IDs, run ID, grain, source/target values or digests, delta, tolerance, lineage, classification, resolution status, and timestamp.
- Finalize `SOURCE_ERROR_BASELINE` with baseline version, WB0817 hash, worksheet, cell/range or formula-family reference, error type, expected count, classification, treatment, evidence, and status.
- Seed baseline rules representing exactly 1,885 WB0817 errors. Do not fabricate unavailable individual cell locations; use bounded family/range records plus counts where the repository evidence is aggregate.
- Use classifications `MATCH`, `EXPECTED_SOURCE_ERROR`, `APPROVED_EXPECTED_VARIANCE`, `MIGRATION_DEFECT`, `MISSING_SOURCE`, `MISSING_TARGET`, and `INVALID_INPUT`.
- Persist only non-sensitive metric values. For source-table comparisons, write dataset, field, and hashed record/value identifiers rather than raw PII.

### 3. Preserve the execution boundary in setup and parity runs

- Add separate versioned state machines for setup and active parity execution:
  - Setup states: `IDLE`, `RUNNING`, `COMPLETE`, `FAILED`.
  - Run states: `PREFLIGHT`, `SOURCE_TABLES`, `METRICS`, `ERROR_CLASSIFICATION`, `SUMMARIZING`, `COMPLETE`, `FAILED`.
- Store target/control IDs, export manifest fingerprint, phase, dataset/file cursor, row offset, chunk ID, counters, timestamps, and sanitized failure code in Script Properties.
- Use the existing script-lock convention to prevent concurrent setup, result writes, continuation handling, or reset of an active run.
- Apply a four-minute cooperative budget. Process one bounded batch at a time, persist its result chunk, checkpoint the cursor, and schedule one continuation before approaching the Apps Script limit.
- Make chunk persistence retry-safe: if execution stops after a write but before cursor advancement, the repeated chunk ID is detected and not appended twice.
- Remove continuation triggers on completion/reset. Refuse retargeting or reset while state is `RUNNING`.
- Public setup interfaces:
  - `initializeCxp11ParityValidation()`
  - `continueCxp11ParityValidationSetup()`
  - `getCxp11ParityValidationSetupStatus()`
  - `resetCxp11ParityValidationSetupState()`
  - `diagnoseCxp11RunbookChecks(spreadsheetId?)`
- Public parity interfaces:
  - `startCxp11ParityRun(exportFolderId?)`
  - `continueCxp11ParityRun()`
  - `getCxp11ParityRunStatus()`
  - `resetCxp11ParityRunState()`

### 4. Add prior-packet-style UAT and documentation workflows

Implement parameterless hosted helpers:

| Step | Entrypoint | Gate |
|---|---|---|
| 00 | `CXP11UatStep00VerifyPrerequisites` | CXP-07 through CXP-10 complete on the configured target |
| 01 | `CXP11UatStep01Install` | Final headers and WB0817 baseline installed |
| 02 | `CXP11UatStep02InspectControlContracts` | Schemas, protections, state, and baseline count valid |
| 03 | `CXP11UatStep03LoadSyntheticParityBundle` | Synthetic export folder and matching target fixture prepared |
| 04 | `CXP11UatStep04RunParity` | Exact-match parity completes across continuations |
| 05 | `CXP11UatStep05ValidateExpectedVarianceAndErrors` | DEC-025 and known errors classified without defects |
| 06 | `CXP11UatStep06ResumeAndSecondBundle` | Forced yield, retry-safe chunking, and weekly rerun verified |
| 07 | `CXP11UatStep07ReinstallAndRerun` | Setup and comparison are idempotent |
| 08 | `CXP11UatStep08PromotionGate` | Zero unexplained critical deltas and complete audit evidence |

- Add a CXP-11 implementation plan, harness guide, hosted runbook, results template, parity report template, configuration documentation, and packet-status/decision-log updates.
- The human-readable report summarizes counts by metric, dataset, classification, and resolution, with unresolved defects and lineage references. `PARITY_RESULTS` remains the machine-readable authority.

## Test Plan and Acceptance Criteria

- Add `npm run test:cxp11` covering export validation, manifest/file digest failures, schema drift, duplicate keys, closed-interval selection, `-480` alignment, exact blank/error semantics, tolerance boundaries, missing records, lineage, classification, and redaction.
- Test setup and run state machines for checkpoint/resume, lock contention, stale target fingerprint, cursor corruption, duplicate chunk replay, trigger cleanup, reset restrictions, idempotent reinstall, and failure recovery.
- Assert baseline totals and types equal the WB0817 authority and that no test expects the superseded 5,655 count.
- Run `npm run test:cxp11` and full `npm run verify`.
- Hosted DEV/UAT acceptance requires:
  - Same export fingerprint recorded in the manifest and successful `FILE_LEDGER` entry.
  - All five normalized datasets and all 25 metrics evaluated.
  - No unexplained delta for critical metrics.
  - Approved timezone variance and known source errors excluded from migration-defect counts.
  - Every defect traceable through hashed record/aggregation identity and metric lineage.
  - No invocation exceeds the cooperative execution budget.
  - Rerunning a second weekly bundle requires no code or comparison-logic changes.
  - Promotion gate passes only when setup, source identity, parity completion, privacy controls, and report generation all pass.

## Assumptions and Non-Goals

- The operator recalculates the fresh legacy Excel control and places the contracted export bundle in Drive; CXP-11 does not automate Excel.
- The same source-bundle fingerprint is used for legacy export and migrated ingestion.
- CXP-11 does not change CXP-07 through CXP-10 calculations, automate weekly lifecycle/scheduling owned by CXP-12, or promote configuration to PROD.
- Export files and source rows remain outside the repository. Only synthetic fixtures are committed.
- Appearance and pixel-level formatting are outside CXP-11 parity; output values, semantic blanks/errors, source identity, and lineage are authoritative.
