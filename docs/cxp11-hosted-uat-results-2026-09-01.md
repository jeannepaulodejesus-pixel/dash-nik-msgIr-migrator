# CXP-11 Hosted DEV UAT Results — 2026-09-01

Copy source: [`docs/cxp11-hosted-uat-results-template.md`](cxp11-hosted-uat-results-template.md). Runbook: [`docs/cxp11-uat-runbook.md`](cxp11-uat-runbook.md). Human-readable run summary: [`docs/cxp11-parity-report-2026-09-01.md`](cxp11-parity-report-2026-09-01.md).

Record sanitized counts, classification tallies, chunk IDs, run states, and timings only. Spreadsheet and folder IDs are omitted from this record.

## Outcome

**Pass.** `CXP11UatStep08PromotionGate` returned `promotionReady: true` on DEV after a complete parity run with zero defects. Setup was already `COMPLETE` at 6/6. The recorded summary evaluated all five datasets and all 25 metrics.

## Environment

| Field | Value |
|---|---|
| Date (UTC) | Promotion log `2026-08-31T16:57:42Z` (operator local 2026-09-01 00:57 UTC+8) |
| Environment | DEV |
| Export contract version | `1.0.0` |
| Baseline version | `WB0817` (1,885 errors) |
| Upstream packets | CXP-07 / CXP-08 / CXP-09 / CXP-10 `COMPLETE` on the same target |
| Local evidence | `npm run test:cxp11` 59/59; `npm run verify` 265/265, 116 JavaScript files syntax-checked, 218 text files scanned |

## Step results

| Step | Entrypoint | Result | Evidence |
|---|---|---|---|
| 00 — VerifyPrerequisites | `CXP11UatStep00VerifyPrerequisites` | Pass (implied) | Upstream packets complete; export folder configured (`CXP11_DIAGNOSTIC.exportFolderConfigured: true`) |
| 01 — Install | `CXP11UatStep01Install` | Pass | `CXP11_SETUP_STATUS` `COMPLETE` at 6/6, `lastCompletedStep: PROTECT_SOURCE_ERROR_BASELINE`, `completedAtUtc: 2026-08-31T16:21:45.441Z` |
| 02 — InspectControlContracts | `CXP11UatStep02InspectControlContracts` | Pass | `CXP11_UAT CXP11UatStep02.result` `baselineTotalsOk: true`, `parityResultsSchemaOk: true`, `setupStatus: COMPLETE` |
| 03 — LoadSyntheticParityBundle | `CXP11UatStep03LoadSyntheticParityBundle` | Pass | Synthetic bundle plus `FILE_LEDGER` seed; required after the fingerprint mismatch and again after the Staff datetime correction |
| 04 — RunParity | `CXP11UatStep04RunParity` | Pass | Terminal `COMPLETE` run consumed by Step 08: `datasetCount: 5`, `metricCount: 25`, `defectCount: 0`, `pass: true` |
| 05 — ValidateExpectedVarianceAndErrors | `CXP11UatStep05ValidateExpectedVarianceAndErrors` | Pass (local) | In-memory helper; `npm run test:cxp11` covers DEC-025 variance and WB0817 classification. Hosted log not attached |
| 06 — ResumeAndSecondBundle | `CXP11UatStep06ResumeAndSecondBundle` | Pass (local) | Checkpoint/resume and second-bundle tests in `tests/cxp11-parity-run-state.test.cjs`. Hosted log not attached |
| 07 — ReinstallAndRerun | `CXP11UatStep07ReinstallAndRerun` | Pass (local) | Idempotent setup/reinstall tests in `tests/cxp11-uat-entrypoints.test.cjs`. Hosted log not attached |
| 08 — PromotionGate | `CXP11UatStep08PromotionGate` | Pass | `CXP11_UAT CXP11UatStep08.result` `promotionReady: true` |

## Acceptance criteria

| Criterion | Result | Note |
|---|---|---|
| Same fingerprint in the manifest and a successful `FILE_LEDGER` entry | Pass | Synthetic placeholder seeded as `SUCCESS` `CXP11-UAT-SYNTHETIC-BUNDLE` (DEC-055) |
| All five normalized datasets evaluated | Pass | `summary.datasetCount == 5` |
| All 25 metrics evaluated | Pass | `summary.metricCount == 25` |
| No unexplained delta for critical metrics | Pass | `summary.defectCount == 0` |
| Approved timezone variance excluded from defects | Pass | Hosted exact-match run: `APPROVED_EXPECTED_VARIANCE: 0` (Step 03 shifts live Interval View keys forward so they align). Classification proven locally in Step 05 |
| Known source errors excluded from defects | Pass | `EXPECTED_SOURCE_ERROR: 6`; baseline observed total equals 1,885 |
| Every defect traceable via hashed identity and metric lineage | Pass | No `OPEN` comparisons on the promoted run |
| No invocation exceeded the cooperative execution budget | Pass | Promotion helper completed in one invocation; no timeout recorded |
| Second weekly bundle reran with no code change | Pass (local) | Engine tests; hosted Step 06 log not attached |
| Promotion gate passed | Pass | `promotionReady: true` |

## Setup state

| Field | Value |
|---|---|
| Setup state key | `CXP11_PARITY_SETUP_STATE_V1` |
| Final status | `COMPLETE` at 6/6 |
| Last completed step | `PROTECT_SOURCE_ERROR_BASELINE` |
| Continuations used | None on the recorded install (`startedAtUtc` and `completedAtUtc` six seconds apart) |

## Run state

| Field | Value |
|---|---|
| Run state key | `CXP11_PARITY_RUN_STATE_V1` |
| Run ID | Not serialized in the Step 08 payload; `PARITY_RESULTS` remains the machine-readable authority |
| Final run state | `COMPLETE` (`parityComplete: true`) |
| Chunk IDs written | Not serialized in the Step 08 payload |
| Comparison count | 341 |
| Counters by classification | `MATCH: 335`, `EXPECTED_SOURCE_ERROR: 6`, `APPROVED_EXPECTED_VARIANCE: 0`, `MIGRATION_DEFECT: 0`, `MISSING_SOURCE: 0`, `MISSING_TARGET: 0`, `INVALID_INPUT: 0` |

## Findings and corrections

| Finding | Root cause | Correction | Retest result |
|---|---|---|---|
| `PARITY_SOURCE_FINGERPRINT_MISMATCH` on first Step 04 | Step 03 wrote `sha256:cxp11syntheticbundle…` but never a `FILE_LEDGER` `SUCCESS` row | Seed an idempotent synthetic `SUCCESS` row (`CXP11-UAT-SYNTHETIC-BUNDLE`) during Step 03 | Step 04 progressed past identity |
| `promotionReady: false` with `MISSING_SOURCE: 2` and `MISSING_TARGET: 2` | Staff has no key fields. Sheets coerced `Status Start/End Date` to Date objects that did not match the CSV strings | Canonicalize date/date-time cells to CXP-03 contract strings at comparison time (DEC-059); write those fixture columns as plain text | Step 08 `MATCH: 335`, `defectCount: 0`, `promotionReady: true` |

## Sign-off

- **Packet status:** Complete
- **Delivery version:** `CXP-11-v1`
- **Known limitations:** This DEV acceptance uses the synthetic Step 03 bundle derived from the live Interval View, not an operator-recalculated weekly Excel export. It does not promote configuration to UAT or PROD. Hosted Step 06/07 logs were not attached; resume, second-bundle, and reinstall remain locally verified.
- **Blockers:** None for CXP-11.
