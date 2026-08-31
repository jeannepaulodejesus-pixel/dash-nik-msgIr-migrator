# CXP-11 Hosted UAT Results — Template

Copy this file per hosted run as `docs/cxp11-hosted-uat-results-<YYYY-MM-DD>.md`. Runbook: [`docs/cxp11-uat-runbook.md`](cxp11-uat-runbook.md). Harness: [`docs/cxp11-uat-harness.md`](cxp11-uat-harness.md).

Record sanitized counts, classification tallies, chunk IDs, run states, and timings only. Never attach source rows, spreadsheet or folder IDs, user emails, or raw metric values carrying business data.

## Environment

| Field | Value |
|---|---|
| Date (UTC) | |
| Environment | DEV / UAT |
| Export contract version | `1.0.0` |
| Baseline version | `WB0817` (1,885 errors) |
| Upstream packets | CXP-07 / CXP-08 / CXP-09 / CXP-10 status |
| Local evidence | `npm run test:cxp11` and `npm run verify` results |

## Step results

| Step | Entrypoint | Result | Evidence |
|---|---|---|---|
| 00 — VerifyPrerequisites | `CXP11UatStep00VerifyPrerequisites` | Pass / Fail | `CXP11_UAT CXP11UatStep00.result` |
| 01 — Install | `CXP11UatStep01Install` | Pass / Fail | `CXP11_SETUP` step and `COMPLETE` events |
| 02 — InspectControlContracts | `CXP11UatStep02InspectControlContracts` | Pass / Fail | `CXP11_UAT CXP11UatStep02.result` |
| 03 — LoadSyntheticParityBundle | `CXP11UatStep03LoadSyntheticParityBundle` | Pass / Fail | `CXP11_UAT CXP11UatStep03.done` |
| 04 — RunParity | `CXP11UatStep04RunParity` | Pass / Fail | `CXP11_UAT CXP11UatStep04.result` |
| 05 — ValidateExpectedVarianceAndErrors | `CXP11UatStep05ValidateExpectedVarianceAndErrors` | Pass / Fail | `CXP11_UAT CXP11UatStep05.result` |
| 06 — ResumeAndSecondBundle | `CXP11UatStep06ResumeAndSecondBundle` | Pass / Fail | `CXP11_UAT CXP11UatStep06.result` |
| 07 — ReinstallAndRerun | `CXP11UatStep07ReinstallAndRerun` | Pass / Fail | `CXP11_UAT CXP11UatStep07.result` |
| 08 — PromotionGate | `CXP11UatStep08PromotionGate` | Pass / Fail | `CXP11_UAT CXP11UatStep08.result` |

## Acceptance criteria

| Criterion | Result | Note |
|---|---|---|
| Same fingerprint in the manifest and a successful `FILE_LEDGER` entry | | |
| All five normalized datasets evaluated | | `summary.datasetCount == 5` |
| All 25 metrics evaluated | | `summary.metricCount == 25` |
| No unexplained delta for critical metrics | | `summary.defectCount == 0` |
| Approved timezone variance excluded from defects | | `APPROVED_EXPECTED_VARIANCE` count |
| Known source errors excluded from defects | | Observed total `== 1885` |
| Every defect traceable via hashed identity and metric lineage | | |
| No invocation exceeded the cooperative execution budget | | Longest invocation ms |
| Second weekly bundle reran with no code change | | |
| Promotion gate passed | | `promotionReady` |

## Setup state

| Field | Value |
|---|---|
| Setup state key | `CXP11_PARITY_SETUP_STATE_V1` |
| Final status | `COMPLETE` at n/6 |
| Last completed step | |
| Continuations used | |

## Run state

| Field | Value |
|---|---|
| Run state key | `CXP11_PARITY_RUN_STATE_V1` |
| Run ID | |
| Final run state | |
| Chunk IDs written | |
| Comparison count | |
| Counters by classification | |

## Findings and corrections

| Finding | Root cause | Correction | Retest result |
|---|---|---|---|
| | | | |

## Sign-off

- **Packet status:** Complete / Blocked
- **Delivery version:** `CXP-11-v1`
- **Known limitations:**
- **Blockers:**
