# Transactional Raw Replacement Contract

## Purpose

CXP-06 replaces the five active raw datasets as one recoverable logical run. It prevents invalid staged data from touching raw sheets, creates durable same-workbook backups before mutation, restores every raw dataset after commit or health failure, and reconciles interrupted prior runs under the existing CXP-04 script lock.

This is an application-level recovery protocol. Google Sheets does not provide or document atomic multi-sheet transactions or isolation from concurrent readers.

## Dataset bindings

| Dataset | Stage | Raw | Backup token |
|---|---|---|---|
| `Handled` | `_STG_HANDLED` | `_RAW_HANDLED` | `HANDLED` |
| `Offered` | `_STG_OFFERED` | `_RAW_OFFERED` | `OFFERED` |
| `AHT - Raw` | `_STG_AHT` | `_RAW_AHT` | `AHT` |
| `Auxes - Raw` | `_STG_AUXES` | `_RAW_AUXES` | `AUXES` |
| `Staff` | `_STG_STAFF` | `_RAW_STAFF` | `STAFF` |

`DatasetSheets` is the exact runtime authority for dataset/staging/raw order. Missing, duplicate, or unexpected datasets fail before a sheet write.

## Composition contract

`InputAdapter.createOperations()` supplies:

- `validateFile`
- `parse`
- `validateSchema`
- `checkDuplicate`

`CommitService.createOperations()` supplies:

- `stage`
- `validateStage`
- `commit`
- `recalculate`
- `healthCheck`

The two objects are merged and passed to `RunService.execute`. CXP-06 never acquires a second lock and never changes the CXP-04 state machine.

## Phase boundaries

### Outside the production lock

1. `stage` resolves all five stage sheets before mutation, clears their prior used ranges, and writes one complete header-plus-record matrix per dataset.
2. `validateStage` rereads values and formulas and checks the entire persisted stage against the active normalized payloads.
3. Any stage write or validation failure terminates before `COMMITTING`; raw sheets and backup state remain unchanged.

### Inside the production lock

1. Reconcile stale CXP-06 backup groups.
2. Recheck the bundle fingerprint in `FILE_LEDGER` to close the pre-lock duplicate race.
3. Preflight all raw sheets and reject formulas.
4. Copy, name, hide, protect, and verify all five raw backups.
5. Replace all five raw matrices in fixed dataset order.
6. Flush pending spreadsheet changes during `recalculate`.
7. Reread and health-validate every raw matrix.
8. Append one SUCCESS ledger row and read-confirm it by run ID; if that lookup fails or is empty, perform one bounded fingerprint lookup and accept it only when both run ID and fingerprint match the current run.
9. Delete the backup group. Cleanup failure returns `backupCleanupStatus: PENDING` without rolling healthy raw data back.
10. CXP-04 flushes once more and releases the lock in `finally`.

## Stage and health validation

`StageValidator.validate(payloads, snapshots)` requires:

- exactly the five registered datasets;
- active schema version `1.0.0` in each payload and its run metadata;
- exact canonical headers and order;
- rectangular values/formula matrices with matching dimensions;
- no persisted formulas;
- row counts equal to payload counts and within registered bounds;
- text or `null` for text fields, including site and queue fields;
- finite numbers or `null` for numeric fields;
- normalized `YYYY-MM-DD` dates or `null`;
- normalized millisecond UTC date-times or `null`;
- nonblank and unique registered business keys;
- unique canonical full rows for the Staff technical dedupe contract; and
- exact persisted values compared with the normalized payload matrix.

Normalized `null` is transported as an empty cell and decoded back to `null`. Other scalar types are not coerced. Apps Script documents that `setValues` interprets leading `=` strings as formulas; the stage formula scan therefore rejects such input before raw mutation rather than claiming an undocumented literal-escaping guarantee.

## Backup contract

Each backup is named `_CXP06_BAK_<TOKEN>_<runId>` and is copied server-side into the target workbook. Run IDs must contain only letters, digits, underscore, or hyphen and must fit the 100-character sheet-name limit.

After every copy, CXP-06:

- applies the controlled name;
- hides the sheet;
- removes editable copied sheet protections;
- creates one CXP-06-owned sheet protection;
- adds the effective user;
- removes other explicit editors, target audiences, domain edit, warning-only mode, and unprotected ranges; and
- compares copied values and formula matrices with the source raw sheet.

Backup discovery exposes only run IDs, dataset tokens, sheet names, and sheet IDs. Cell values stay inside repository calls and are never placed in logs or public errors.

## Rollback and recovery

Rollback reads the complete five-sheet group, restores every raw matrix, flushes, rereads all five raw sheets, compares values and formulas with the backups, and deletes the group only after the whole restore verifies.

Next-run reconciliation applies this decision table under the production lock:

| Backup state | SUCCESS ledger row | Action |
|---|---|---|
| Complete or incomplete | Present for run ID | Keep current raw; delete leftover backups |
| Exactly one complete group | Absent | Restore, flush, verify, then delete |
| Incomplete group | Absent | Delete without restoring; raw mutation could not have started before group completion |
| More than one complete unfinished group | Absent | Fail closed with `MIGRATION_RECOVERY_FAILED` |

If rollback cannot establish and verify a safe state, it throws `MIGRATION_ROLLBACK_FAILED` and retains the backup group.

## Error taxonomy

| Code | Boundary |
|---|---|
| `MIGRATION_STAGE_WRITE_FAILED` | Stage preflight, clear, write, or read failure |
| `MIGRATION_STAGE_VALIDATION_FAILED` | Persisted stage or raw health contract mismatch |
| `MIGRATION_BACKUP_FAILED` | Complete verified backup group could not be created |
| `MIGRATION_COMMIT_FAILED` | Raw replacement failed; verified rollback metadata is attached when applicable |
| `CALCULATION_RECALCULATION_FAILED` | Controlled flush failed; rollback is attempted |
| `CALCULATION_HEALTH_CHECK_FAILED` | Raw validation or SUCCESS confirmation failed; rollback is attempted |
| `MIGRATION_RECOVERY_FAILED` | Stale backup reconciliation cannot choose a safe action |
| `MIGRATION_ROLLBACK_FAILED` | Restore or restore verification failed |

Safe details may include dataset name, phase/reason, counts, run ID, original public code, and rollback status. They never include cell values, records, business keys, filenames, formula text, or backup payloads.

## Local evidence and hosted limit

The synthetic Node test exercises every schema at its declared maximum: 44,500 total records. The recorded run used five staging writes and five raw writes, with no row/cell calls. This validates repository call shape and local algorithm behavior, not Apps Script quotas, network latency, spreadsheet recalculation cost, abrupt hosted termination, or reader-visible atomicity.

Promotion requires the separate [CXP-06 UAT runbook](cxp06-uat-runbook.md) against a configured non-production workbook.
