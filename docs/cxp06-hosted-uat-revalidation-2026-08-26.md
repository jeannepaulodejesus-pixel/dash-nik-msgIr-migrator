# CXP-06 Hosted UAT Revalidation — August 26, 2026

## Verdict

**Conditional revalidation only; deployment promotion remains blocked.** The dataset-scoped adaptive-worker redesign resolved the observed six-minute execution-time failure in the peak-success path and materially reduced Case 1 latency. The evidence also exposed two release-blocking regressions in the fault/recovery harness: the hosted health-mismatch fault no longer reaches the dataset-scoped write path, and failures raised during continuation-owned commit/recovery paths are not durably appended to `RUN_LOG` and `ERROR_LOG`.

The Drive workbooks and supplied Apps Script execution screenshots are treated as the authoritative August 26 evidence set. A red Apps Script execution is not automatically a failed UAT case: Cases 3, 4.1, and 5.4 intentionally exercise failure paths. Their verdict depends on the resulting rollback, recovery, backup-retention, and audit state.

## Evidence index

| Case | Scenario | Evidence folder |
| --- | --- | --- |
| 01 | Peak successful replacement | [CASE01](https://drive.google.com/drive/folders/187hVcEj8_bN3KhuU7GxFVsKrYFG_xO58) |
| 02 | Invalid staged data | [CASE02](https://drive.google.com/drive/folders/1Xaw58rF_r60cRoiM8_llj5oUQM8LkDD2) |
| 03 | Mid-commit failure and rollback | [CASE03](https://drive.google.com/drive/folders/1hAyvK05GDJ_meVVZPApGEFAFpAm2-uU5) |
| 04 | Post-write health mismatch | [CASE04](https://drive.google.com/drive/folders/1MRjYwOa31jotB41kVV3GkutIA-MfYuld) |
| 04.1 | Rollback failure | [CASE04.1](https://drive.google.com/drive/folders/1YLjcKl0yow_V2UzTy1NktYMVjv_GvBKA) |
| 05 | Incomplete backup reconciliation | [CASE05](https://drive.google.com/drive/folders/1RbBEWx0F_TKn4xv3lVPbXt69xdUcNNT4) |
| 05.1 | Complete unsuccessful backup reconciliation | [CASE05.1](https://drive.google.com/drive/folders/1XkJvxz_s0nEKs-oIbq5J5raYvZdNQOW6) |
| 05.2 | Successful leftover backup reconciliation | [CASE05.2](https://drive.google.com/drive/folders/1Jd8UrOpmFZeu-iJIamKtvo4kfGY3vWQD) |
| 05.3 | Post-success cleanup failure | [CASE05.3](https://drive.google.com/drive/folders/1bQMGPnrBlSQJHSGNTxoQ_b3LtjvFNcQR) |
| 05.4 | `CASE5_TWO_COMPLETE_UNSUCCESSFUL_BACKUPS` | [CASE05.4](https://drive.google.com/drive/folders/1r7HlMfvAqO3QUD9ulQO5HDjJ0VzkSoWb) |

Each folder contains a dedicated DEV target workbook and control workbook. The review read the exact `RUN_LOG`, `ERROR_LOG`, and `FILE_LEDGER` ranges and inspected target workbook sheet topology, including retained `_CXP06_BAK_*` sheets.

## Case results

| Case | Verdict | Authoritative evidence |
| --- | --- | --- |
| 01 | **Pass** | Run `ff857228-d2b6-40e1-aab3-b6229f1acbf9` ended `SUCCESS`; one matching `FILE_LEDGER` SUCCESS exists; `ERROR_LOG` is empty; all five declared input counts are present; no backup sheets remain. Relevant wall time was 16m 00.749s and the longest invocation was 204.372s, below both the 270s cooperative boundary and 360s Apps Script limit. |
| 02 | **Pass** | Run `031ac17c-df6a-4f6c-aa9d-baa92e0e4ad1` failed in `VALIDATING_STAGE` with `MIGRATION_STAGE_VALIDATION_FAILED`; `ERROR_LOG` records `Handled / formulas_not_allowed`; no success-ledger row exists. |
| 03 | **Partial / blocked** | The execution fault fired after Handled, and the terminal status reports `MIGRATION_COMMIT_FAILED` with `rollbackStatus: VERIFIED`. No backup sheets remain, consistent with verified rollback. However, both control `RUN_LOG` and `ERROR_LOG` contain headers only, so the required durable failure audit is absent. |
| 04 | **Fail** | Run `2e98e1dd-dfbc-4324-86c8-2b2329a1130a` ended `SUCCESS` and wrote a SUCCESS ledger record. The expected `CALCULATION_HEALTH_CHECK_FAILED` plus verified rollback never occurred. This is a false-positive UAT result, not a successful health-mismatch test. |
| 04.1 | **Fail / inconclusive recovery evidence** | Status reports `MIGRATION_RECOVERY_FAILED` with `reason: reconciliation_failed`, not the expected `MIGRATION_ROLLBACK_FAILED`. `RUN_LOG`, `ERROR_LOG`, and `FILE_LEDGER` contain headers only, and the supplied evidence does not establish the required retained complete backup group. |
| 05 | **Pass** | Run `1c045f6e-2020-4945-a776-2404d6d10c0b` ended `SUCCESS`; one ledger SUCCESS exists; no backup sheets remain. The seeded incomplete group was reconciled without blocking the new run. |
| 05.1 | **Pass** | Run `c81fe37a-4c7e-451a-a90a-f873f195f833` ended `SUCCESS`; one ledger SUCCESS exists; no backup sheets remain. The complete unsuccessful group was restored/reconciled before the new successful run. |
| 05.2 | **Pass** | The ledger contains the bounded `UAT-SEED` SUCCESS row plus run `791db5e7-799c-493f-a2cb-283253f3690f` SUCCESS; no backup sheets remain. The committed leftover was removed without preventing the new run. |
| 05.3 | **Conditional pass** | Run `c0491776-19b7-4bca-b67e-d0e3ca0943b0` ended `SUCCESS`; exactly five hidden backup sheets for that run remain, which is the expected cleanup-debt topology. The evidence does not independently retain the returned `backupCleanupStatus: PENDING` field, so that assertion remains unproven. |
| 05.4 | **Partial / blocked** | Terminal status correctly fails closed with `MIGRATION_RECOVERY_FAILED`, `reason: multiple_unfinished_groups`; exactly ten hidden backup sheets across two complete groups remain. The required `RUN_LOG` and `ERROR_LOG` audit rows are absent. |

## Runtime comparison

Case 1 is the comparable peak-volume measure:

| Measure | Prior evidence | August 26 redesign | Change |
| --- | ---: | ---: | ---: |
| End-to-end wall time | 38m 33s | 16m 00.749s | 58.5% lower |
| Active execution time | 24m 44s | approximately 12m 24s | 49.8% lower |
| Scheduler wait | 13m 49s | approximately 3m 36s | 73.9% lower |
| Longest invocation | at least 360s timeout | 204.372s | no timeout |

The redesign therefore meets the runtime-bypass objective for the supplied Case 1 run and leaves substantial room before the next hourly intake. This performance result does not override the fault/recovery blockers.

## Release blockers discovered

### UAT06-RV-01 — Health mismatch injection bypassed by the dataset-scoped write seam

`Cxp06FaultInjector.wrapRawRepository()` marks the synthetic health corruption after `replaceAll()` or `replaceOne()`. The redesigned hosted commit calls `replacePayload()`, which the wrapper does not override. As a result, Case 4 performs an ordinary healthy commit and incorrectly ends `SUCCESS`.

**Required correction:** arm the synthetic mismatch immediately before the final `healthCheck()` operation and add a regression proving the hosted dataset-scoped path reaches `CALCULATION_HEALTH_CHECK_FAILED`, restores all five datasets, and deletes the backup only after verified rollback. The earlier `MIGRATION_HEALTH_CHECK_FAILED` label was not a registered error code and is corrected here to the established orchestration contract.

### UAT06-RV-02 — Continuation-owned failures are not durably audited

`Cxp06UatContinuation.markFailed()` persists bounded Script Properties and rethrows, but it does not append terminal run/error records. Case 3 and Case 5.4 demonstrate the gap: execution/status evidence exists while both control audit tables remain header-only.

**Required correction:** route continuation-terminal failure through one idempotent audit seam keyed by run ID. Repeated trigger delivery must not duplicate audit rows. Add hosted-path tests for mid-commit failure, rollback failure, and ambiguous recovery.

### UAT06-RV-03 — Rollback-failure case did not reach the expected failure boundary

Case 4.1 produced `MIGRATION_RECOVERY_FAILED / reconciliation_failed`, not `MIGRATION_ROLLBACK_FAILED`, and did not provide durable audit or backup-retention proof.

**Required correction:** after UAT06-RV-01 and UAT06-RV-02, rerun Case 4.1 from a clean target/control pair and prove the original commit failure, rollback write failure, retained complete group, terminal error code, and audit records all refer to the same run ID.

## Promotion decision

CXP-06 remains repository-complete but **not UAT-promoted**. Fix UAT06-RV-01 and UAT06-RV-02, rerun Cases 03, 04, 04.1, 05.3, and 05.4, and attach a bounded status result for cleanup debt. Case 1 runtime and Cases 02, 05, 05.1, and 05.2 do not need repetition unless the corrective patch changes their production paths.
