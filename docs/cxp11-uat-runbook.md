# CXP-11 Hosted UAT Runbook

**Planned contract** for operator succession; setup, run, and promotion helpers are in `src/main/Cxp11Setup.js`, `src/main/Cxp11ParityRun.js`, and `src/main/Cxp11UatEntrypoints.js`. Contract authority: [`docs/parity-validation-contract.md`](parity-validation-contract.md), [`docs/metric-lineage.md`](metric-lineage.md), `config/formula-family-catalog.json`. Harness: [`docs/cxp11-uat-harness.md`](cxp11-uat-harness.md). Pattern reference: [`docs/cxp10-uat-runbook.md`](cxp10-uat-runbook.md).

## Succession naming

Every successive operator process uses zero-padded **`CXP11UatStepNN(process)`** form:

- Document headings and evidence labels: `CXP11UatStep00`, `CXP11UatStep01`, …
- Editor helpers: `CXP11UatStep01Install`, `CXP11UatStep04RunParity`, …
- Ordered sub-steps inside a step: `CXP11UatStep03.1`, `CXP11UatStep03.2`, …

## Safety and prerequisites

Use a disposable DEV or UAT pair initialized by CXP-02. Never point `CXP_ENV` at PROD. Configure the environment's target and control spreadsheet IDs in Script Properties; do not record any ID in repository evidence.

CXP-11 writes only to the **control** workbook (`PARITY_RESULTS`, `SOURCE_ERROR_BASELINE`) plus, during Step 03 only, the target's `_RAW_*` fixture rows. It never changes CXP-07 through CXP-10 formulas.

Confirm CXP-07, CXP-08, CXP-09, and CXP-10 install status is **`COMPLETE`** on the same target before starting.

Set `CXP_<ENV>_LEGACY_PARITY_EXPORT_FOLDER_ID` to a Drive folder that holds nothing but the contracted export bundle, or pass the folder ID explicitly to `startCxp11ParityRun`. Uncontracted files in that folder fail the run closed. See [`docs/configuration.md`](configuration.md).

## Operator responsibility

The operator recalculates the fresh legacy Excel control from the same five-file bundle that ingestion loaded, then exports the contracted bundle into the Drive folder. CXP-11 does not automate Excel. The export's `sourceBundleFingerprint` must match a successful `FILE_LEDGER` entry, or the run fails with `PARITY_SOURCE_FINGERPRINT_MISMATCH`.

## Evidence rules

Record sanitized counts, classification tallies, chunk IDs, run states, and timings only. Never attach source rows, spreadsheet or folder IDs, user emails, or raw metric values carrying business data.

---

## CXP11UatStep00 — VerifyPrerequisites

**Helper:** `CXP11UatStep00VerifyPrerequisites`

**Gate:** CXP-07 through CXP-10 complete on the configured target.

1. Push the verified `src/` tree to the non-production Apps Script project.
2. Run the helper and confirm each of `cxp07`, `cxp08`, `cxp09`, `cxp10` reports `complete: true`.
3. Confirm `targetConfigured` and `controlConfigured` are `true`. `exportFolderConfigured` may be `false` if you intend to pass the folder ID explicitly.

## CXP11UatStep01 — Install

**Helper:** `CXP11UatStep01Install`

**Gate:** Final headers and WB0817 baseline installed.

1. Run `initializeCxp11ParityValidation()` once.
2. Poll `getCxp11ParityValidationSetupStatus()` until `COMPLETE` at 6/6. Resume with `continueCxp11ParityValidationSetup()` on Sheets timeouts.
3. Reinstall is safe: it rewrites the same headers and rewrites — never appends — the baseline rows.

## CXP11UatStep02 — InspectControlContracts

**Helper:** `CXP11UatStep02InspectControlContracts`

**Gate:** Schemas, protections, state, and baseline count valid.

1. Confirm `controls.parityResults.schemaOk` and `controls.sourceErrorBaseline.schemaOk` are `true`.
2. Confirm `controls.sourceErrorBaseline.actualTotal` is **1885** and `totalsOk` is `true`. Confirm the per-type split is 1,838 `#N/A`, 26 `#DIV/0!`, 21 `#REF!`.
3. Confirm `protectionOk` is `true` on both control tabs.
4. Confirm `setupStatus.status` is `COMPLETE` and `runStatus` is `IDLE` (or a terminal prior run).

## CXP11UatStep03 — LoadSyntheticParityBundle

**Helper:** `CXP11UatStep03LoadSyntheticParityBundle`

**Gate:** Synthetic export folder and matching target fixture prepared.

1. The helper writes the synthetic source rows into the five `_RAW_*` tables and flushes.
2. It then reads the live Interval View metric outputs, shifts each fixed-PST key **forward** by 480 minutes to reproduce the unconverted UTC keys a legacy control emits, and builds the contracted bundle.
3. It replaces same-named files in the export folder and reports `fileCount: 8` plus per-dataset raw row counts.

> The synthetic legacy metric CSV is derived from the live workbook on purpose. Step 03 and Step 04 prove the harness mechanics — packaging, digests, source identity, alignment, chunking, and idempotence — on an internally consistent bundle. Step 05 is where injected variance and error cases prove classification. A real weekly run replaces Step 03 with the operator's own recalculated legacy export.

## CXP11UatStep04 — RunParity

**Helper:** `CXP11UatStep04RunParity`

**Gate:** Exact-match parity completes across continuations.

1. The helper calls `startCxp11ParityRun()` and then drives `continueCxp11ParityRun()` until the run state is `COMPLETE` or `FAILED`.
2. Confirm the run visits `PREFLIGHT`, `SOURCE_TABLES`, `METRICS`, `ERROR_CLASSIFICATION`, and `SUMMARIZING` in order.
3. Confirm `summary.datasetCount` is 5 and `summary.metricCount` is 25.
4. Confirm `summary.defectCount` is 0 and `summary.pass` is `true`.
5. Confirm no single invocation exceeded the four-minute cooperative budget.

## CXP11UatStep05 — ValidateExpectedVarianceAndErrors

**Helper:** `CXP11UatStep05ValidateExpectedVarianceAndErrors`

**Gate:** DEC-025 and known errors classified without defects.

1. Pass a legacy metric record whose key is unshifted and whose value matches the migrated value at that unshifted key. Confirm one `APPROVED_EXPECTED_VARIANCE` with lineage `DEC-025`, not a defect.
2. Confirm the six WB0817 baseline keys classify as `EXPECTED_SOURCE_ERROR` and that `baselineObservedTotal` equals `baselineExpectedTotal` at **1885**.
3. Confirm `migrationDefectCount` is 0 and `pass` is `true`.
4. Negative control: add an observed error token that is not in the baseline and confirm `pass` becomes `false`.

## CXP11UatStep06 — ResumeAndSecondBundle

**Helper:** `CXP11UatStep06ResumeAndSecondBundle`

**Gate:** Forced yield, retry-safe chunking, and weekly rerun verified.

1. The helper forces a mid-phase yield with a zero budget and confirms a continuation was scheduled.
2. It resumes to `COMPLETE` and confirms the comparison count is unchanged — replayed chunk IDs are not appended twice.
3. It resets and reruns a second weekly bundle. Confirm the rerun passes with no code or comparison-logic change.

## CXP11UatStep07 — ReinstallAndRerun

**Helper:** `CXP11UatStep07ReinstallAndRerun`

**Gate:** Setup and comparison are idempotent.

1. Re-run the installer after `COMPLETE`. Confirm headers restore, the baseline stays at 6 rows and 1,885 errors, and status returns to `COMPLETE`.
2. Re-run parity and confirm the same summary.

## CXP11UatStep08 — PromotionGate

**Helper:** `CXP11UatStep08PromotionGate`

**Gate:** Zero unexplained critical deltas and complete audit evidence.

Promotion requires all of:

1. Setup `COMPLETE` at 6/6 (`CXP11UatStep01`).
2. Both control schemas valid and the baseline total at 1,885 (`CXP11UatStep02`).
3. Source identity verified — the export fingerprint matched a successful `FILE_LEDGER` entry and the baseline observed total equals the expected total.
4. Parity run `COMPLETE` with all five datasets and all 25 metrics evaluated (`CXP11UatStep04`).
5. Approved timezone variance and known source errors excluded from the defect count (`CXP11UatStep05`).
6. Checkpoint/resume and second-bundle rerun verified (`CXP11UatStep06`).
7. Idempotent reinstall and rerun (`CXP11UatStep07`).
8. `summary.pass: true` with `summary.defectCount: 0`.

The gate returns `promotionReady: false` with the specific failing input rather than a single opaque failure. `PARITY_RESULTS` remains the machine-readable authority; record the human-readable summary using [`docs/cxp11-parity-report-template.md`](cxp11-parity-report-template.md) and the hosted result record using [`docs/cxp11-hosted-uat-results-template.md`](cxp11-hosted-uat-results-template.md).

## Failure triage

| Code | Meaning | Operator action |
|---|---|---|
| `PARITY_EXPORT_FOLDER_NOT_CONFIGURED` | No folder property and no argument | Set the property or pass the folder ID |
| `PARITY_EXPORT_CONTRACT_VERSION_MISMATCH` | Export built against another contract | Rebuild the export at contract `1.0.0` |
| `PARITY_EXPORT_DIGEST_MISMATCH` | A file changed after the manifest was written | Regenerate the manifest and files together |
| `PARITY_EXPORT_SCHEMA_DRIFT` | Header order, ragged row, or unknown token | Re-export against the canonical schemas |
| `PARITY_EXPORT_DUPLICATE_KEY` | Divergent rows share one authoritative key | Fix the legacy export; do not deduplicate by hand |
| `PARITY_SOURCE_FINGERPRINT_MISMATCH` | No successful `FILE_LEDGER` entry for the bundle | Re-run ingestion for the same bundle first |
| `PARITY_TARGET_SNAPSHOT_CHANGED` | Export or target replaced mid-run | Reset the run and restart on a stable snapshot |
| `PARITY_BASELINE_NOT_INSTALLED` / `PARITY_BASELINE_COUNT_MISMATCH` | Baseline absent or drifted | Re-run `CXP11UatStep01Install` |
| `PARITY_RUN_ALREADY_ACTIVE` | Another run holds the cursor | Continue it, or reset with force after it stops |
| `PARITY_LOCK_TIMEOUT` | Concurrent setup/run/reset | Retry once the other invocation releases the lock |
