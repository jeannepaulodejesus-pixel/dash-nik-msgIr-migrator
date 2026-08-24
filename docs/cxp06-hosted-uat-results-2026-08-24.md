# CXP-06 Hosted UAT Sign-off

## Outcome

**PASSED — Hosted DEV/UAT completed on August 24, 2026.**

The CXP-06 transactional raw-replacement workflow completed its hosted success, validation-failure, rollback, recovery-topology, cleanup-debt, and reader-visibility scenarios. The collected Google Sheets evidence supports promotion of the tested CXP-06 behavior, subject to the operational controls in the UAT runbook.

## Scope and acceptance basis

- Environment: hosted Google Apps Script DEV/UAT
- Schema version: `1.0.0`
- Peak test volume: Handled 10,000; Offered 10,000; AHT 15,000; Auxes 7,500; Staff 2,000
- Evidence systems: control-workbook `RUN_LOG`, `ERROR_LOG`, and `FILE_LEDGER`; target-workbook raw, staging, and retained-backup topology; sanitized Apps Script telemetry
- Acceptance criteria: `docs/cxp06-uat-runbook.md`

## Results

| Scenario | Result | Verified outcome | Evidence |
|---|---|---|---|
| Case 1 — Peak success | **PASS** | Peak bundle reached `SUCCESS`, recorded a correlated successful ledger entry, completed within the hosted execution limit, and retained no backup group. | [Case 1 evidence](https://drive.google.com/drive/folders/187hVcEj8_bN3KhuU7GxFVsKrYFG_xO58) |
| Case 2 — Invalid stage | **PASS** | Run `9134d2f1-5420-4442-8741-401f4b3a5352` failed in `VALIDATING_STAGE` with `MIGRATION_STAGE_VALIDATION_FAILED` and `formulas_not_allowed`; it created neither a ledger success entry nor a backup group. | [Case 2 evidence](https://drive.google.com/drive/folders/1Xaw58rF_r60cRoiM8_llj5oUQM8LkDD2) |
| Case 3 — Mid-commit failure | **PASS** | Controlled commit failure produced `MIGRATION_COMMIT_FAILED`; rollback completed with `rollbackStatus: VERIFIED`. | [Case 3 evidence](https://drive.google.com/drive/folders/1hAyvK05GDJ_meVVZPApGEFAFpAm2-uU5) |
| Case 4 — Rollback failure | **PASS** | Run `24830fd9-94aa-46a1-a5cd-08eb0faf28f8` failed during `COMMITTING` with `MIGRATION_ROLLBACK_FAILED`; the error correlated the original `MIGRATION_COMMIT_FAILED`, reported `rollbackStatus: FAILED`, and retained the complete five-sheet backup group for investigation. | [Case 4 evidence](https://drive.google.com/drive/folders/1MRjYwOa31jotB41kVV3GkutIA-MfYuld) |
| Case 5 — Incomplete backup | **PASS** | Reconciliation removed the incomplete group and allowed the replacement run to reach `SUCCESS` with no backup group remaining. | [Case 5 evidence](https://drive.google.com/drive/folders/1RbBEWx0F_TKn4xv3lVPbXt69xdUcNNT4) |
| Case 5.1 — Complete unsuccessful backup | **PASS** | Reconciliation restored, verified, and removed the complete unfinished group before the new run reached `SUCCESS`. | [Case 5.1 evidence](https://drive.google.com/drive/folders/1XkJvxz_s0nEKs-oIbq5J5raYvZdNQOW6) |
| Case 5.2 — Successful leftover backup | **PASS** | The seeded successful-leftover record was recognized, current raw data was retained, the leftover group was removed, and the new run reached `SUCCESS`. | [Case 5.2 evidence](https://drive.google.com/drive/folders/1Jd8UrOpmFZeu-iJIamKtvo4kfGY3vWQD) |
| Case 5.3 — Cleanup failure | **PASS** | The successful raw result remained active while the five-sheet backup group was retained as cleanup debt for the next controlled reconciliation. | [Case 5.3 evidence](https://drive.google.com/drive/folders/1bQMGPnrBlSQJHSGNTxoQ_b3LtjvFNcQR) |
| Case 5.4 — Two complete unsuccessful backups | **PASS** | Reconciliation failed closed with `MIGRATION_RECOVERY_FAILED` and `multiple_unfinished_groups`; both complete groups, ten backup sheets total, were preserved for investigation. | [Case 5.4 evidence](https://drive.google.com/drive/folders/1r7HlMfvAqO3QUD9ulQO5HDjJ0VzkSoWb) |
| Reader visibility | **PASS — observation completed** | A separate reader-session observation was performed against the Case 2 workbook. The observation remains informational: the protocol does not claim atomic multi-sheet reader isolation. | [Reader-visibility workbook](https://drive.google.com/drive/folders/1Xaw58rF_r60cRoiM8_llj5oUQM8LkDD2) |

## Reader-visibility companion run

The Case 2 control workbook also records successful run `c6cd3fbd-25af-427d-8ef4-89b0cdb3523d`, which completed the full commit, recalculation, and health-check path and wrote a correlated `SUCCESS` ledger entry. Google Drive reports the workbook as shared. The evidence connector did not expose the observing user's exact permission record; the separate-reader observation is therefore recorded as the authorized UAT operator's attestation.

## Non-blocking observation

The reduced source bundles used for later recovery scenarios are identified correctly in `FILE_LEDGER`, but their `RUN_LOG.inputRowCounts` values retain the peak-volume counts. This is a telemetry-accuracy defect and does not change the verified transactional outcomes above. Correcting the field remains recommended so future audit records report actual parsed input counts.

## Promotion disposition

**CXP-06 hosted functional UAT is accepted as passed.**

Promotion must continue to honor the runbook's stop-the-line rule: any production `MIGRATION_ROLLBACK_FAILED` or ambiguous recovery topology requires manual investigation and blocks another writer until an authorized operator resolves the retained evidence.

## Sign-off record

- UAT execution date: August 24, 2026
- Documentation date: August 25, 2026
- Evidence owner / operator: Jeanne Paulo De Jesus
- Status: **PASSED**

