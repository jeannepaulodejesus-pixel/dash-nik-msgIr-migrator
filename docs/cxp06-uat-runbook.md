# CXP-06 Apps Script UAT Runbook

## Status

Not executed by the repository delivery. No authenticated non-production target workbook or authorization was supplied. Completion of this runbook is a promotion gate, not a local test claim.

## Preconditions

- Use a dedicated DEV or UAT target workbook; never use PROD for first execution.
- Confirm CXP-02 created all five staging and raw sheets plus the control workbook's `FILE_LEDGER`, `RUN_LOG`, and `ERROR_LOG`.
- Confirm the active schema is `1.0.0` and the executing identity is an editor of both workbooks.
- Capture target/control workbook IDs outside source code through the existing environment properties.
- Prepare synthetic, non-personal payloads at these declared maximums: Handled 10,000; Offered 10,000; AHT 15,000; Auxes 7,500; Staff 2,000.
- Take a recoverable copy of the DEV/UAT workbook before the first hosted test.

## Evidence capture

For every case, record:

- Apps Script execution ID and UTC start/end timestamps;
- run ID and terminal run state;
- elapsed time and any quota/runtime warning;
- stage/raw row counts for all five datasets;
- formula counts for all stage/raw sheets;
- FILE_LEDGER result and correlated run ID;
- backup sheet names remaining after the run;
- rollback or cleanup status; and
- sanitized execution-log excerpts containing no source rows, cell values, keys, filenames, or formula text.

## Case 1 — Peak successful replacement

1. Load the five maximum synthetic payloads through the supported CXP-05 adapter.
2. Execute the composed InputAdapter/CommitService operations through `RunService.execute`.
3. Confirm one logical SUCCESS run and one confirmed SUCCESS ledger row.
4. Confirm all five raw sheets have the canonical header plus expected record count.
5. Confirm `getFormulas()` is empty for every used raw cell.
6. Confirm no `_CXP06_BAK_` sheet remains, or record `backupCleanupStatus: PENDING` and continue with Case 5.
7. Record elapsed time and service/runtime evidence. The packet is not promoted if expected peak volume exceeds the Apps Script execution limit or produces quota failures.

## Case 2 — Invalid staged data

1. Inject a controlled invalid header, formula-producing leading `=` value, invalid normalized date, duplicate key, or row-count mismatch in a synthetic stage.
2. Execute through `RunService`.
3. Confirm failure occurs in `VALIDATING_STAGE` with `MIGRATION_STAGE_VALIDATION_FAILED`.
4. Confirm the production lock was not entered, raw hashes/counts remain unchanged, and no backup was created.

## Case 3 — Mid-commit failure and rollback

1. Configure a DEV-only failure hook after the second raw dataset replacement.
2. Execute one synthetic run.
3. Confirm the run records a migration failure plus `rollbackStatus: VERIFIED`.
4. Confirm all five raw sheets, not only the first two, match their pre-run backup values and contain no formulas.
5. Confirm the backup group is deleted only after full restore verification.

## Case 4 — Health failure and rollback failure

1. Inject a post-write health mismatch and confirm all five raw sheets restore before lock release.
2. Separately inject a restore write or verification failure.
3. Confirm the second run reports `MIGRATION_ROLLBACK_FAILED`, retains the complete backup group, and exposes no cell data in errors/logs.
4. Stop promotion and manually investigate any rollback failure before another writer is allowed.

## Case 5 — Interrupted-run reconciliation and cleanup debt

1. Leave an incomplete backup group without raw mutation; confirm the next locked run deletes it without restore.
2. Leave one complete group without SUCCESS; confirm the next locked run restores/verifies/deletes it before the new duplicate check and backup.
3. Leave a complete group with a confirmed SUCCESS row; confirm the next locked run keeps current raw and deletes the leftover group.
4. Create two complete groups without SUCCESS only in an isolated test copy; confirm recovery fails closed without choosing a restore order.
5. Inject post-success backup deletion failure; confirm the successful raw result remains active, cleanup reports PENDING, and the next run removes the leftover group.

## Reader-visibility observation

During a controlled slowed commit, observe the workbook from a separate reader session and record whether intermediate raw-sheet states are visible. This observation does not turn the protocol into an atomic transaction; the production contract continues to make no multi-sheet reader-isolation guarantee.

## Promotion sign-off

CXP-06 hosted UAT is complete only when all cases have evidence, peak volume completes within current quotas, every failure reaches the documented safe state, no raw formulas exist, and an authorized owner signs the DEV/UAT record. Otherwise packet implementation may remain repository-complete while deployment promotion remains blocked.
