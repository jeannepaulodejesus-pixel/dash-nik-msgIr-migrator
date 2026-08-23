# CXP-06 Transactional Raw Replacement Design

## Status and authority

This design records the CXP-06 architecture approved by the user on 2026-08-23. It is the implementation design for `CXP-06 — Staging, Two-Phase Commit, Rollback, and Raw Replacement`; `CODEX_HANDOFF.md` remains the packet authority. CXP-01 through CXP-05 contracts remain authoritative for source semantics, sheet names, run orchestration, normalized payloads, duplicate identity, and success-ledger timing.

The approved implementation shape is a repository-coordinated transaction service with hidden, protected, run-scoped backup sheets. Backups must survive abrupt Apps Script termination and be reconciled on the next locked run.

## Required outcome

CXP-06 must guarantee that schema-invalid or stage-invalid input cannot mutate active raw data, that all five logical datasets replace raw state as one recoverable transaction, and that catchable commit or health failures attempt a verified rollback instead of leaving silent partial state.

The packet is a repository change. No authenticated production deployment, business calculation layer, or reporting UI is authorized.

## Constraints preserved

- The target workbook and its `_STG_*` and `_RAW_*` sheet names come only from `SheetNames.TARGET`.
- Input is exactly five immutable CXP-03 `DatasetPayload` objects from CXP-05.
- `RunService.execute()` remains the only supported run orchestrator and retains its nine-operation state order.
- Staging and stage validation occur outside the script lock; backup creation and every raw mutation occur only after entering `COMMITTING` under the lock.
- Duplicate history is rechecked inside the lock before backup creation or raw mutation.
- Raw and staging sheets contain values only. No formula is executed, translated, copied downstream, or required from a user.
- CXP-01 null semantics remain unchanged: whitespace/blank is null, only registered key fields must be nonblank, and no defaults are synthesized.
- Service calls are bulk sheet/range operations, never row-loop calls.
- Errors and audit details never contain source cells, rows, keys, names, or formula text.
- Existing uncommitted CXP-03 through CXP-05 work must be preserved.

## Dataset-to-sheet mapping

| Dataset | Staging sheet | Raw sheet | Backup token |
|---|---|---|---|
| `Handled` | `_STG_HANDLED` | `_RAW_HANDLED` | `HANDLED` |
| `Offered` | `_STG_OFFERED` | `_RAW_OFFERED` | `OFFERED` |
| `AHT - Raw` | `_STG_AHT` | `_RAW_AHT` | `AHT` |
| `Auxes - Raw` | `_STG_AUXES` | `_RAW_AUXES` | `AUXES` |
| `Staff` | `_STG_STAFF` | `_RAW_STAFF` | `STAFF` |

The mapping is exact and closed. Missing, duplicate, or unexpected datasets fail before any sheet write.

## Components and responsibilities

### `StagingRepository`

- Resolve all five staging sheets before mutating any of them.
- Preflight the complete sheet/range service contract.
- Encode each payload as one header-plus-record matrix.
- Clear only the prior data range and write the complete new matrix with one `setValues` call per dataset.
- Read back values and formulas for stage validation.
- Return row counts, cell counts, and bulk-call metadata without returning raw values in audit-safe summaries.

### `StageValidator`

- Require exactly the five registered datasets and active schema version.
- Require canonical headers in registry order and expected row counts within registry bounds.
- Decode sheet blanks to CXP-03 nulls, then re-run the CXP-03 schema/type/key contract on persisted values.
- Require registered key fields to remain nonblank and unique.
- Validate declared date and date-time columns through the existing schema contract.
- Validate columns whose canonical names contain `Site` or `Queue` as text-or-null without adding a new nonblank rule.
- Reject any formula presence.
- Compare decoded persisted records to the normalized payload records exactly.

### `SheetValueCodec`

The sheet boundary is explicit and reversible:

- normalized `null` writes as an empty string;
- an empty string read from a controlled staging/raw cell decodes to `null`;
- numbers remain numbers;
- normalized ISO date/date-time values remain strings;
- nonblank text remains text.

This encoding is lossless because CXP-03 already normalizes empty/whitespace source text to null.

### `RawDataRepository`

- Resolve and preflight all five raw sheets before backup or mutation.
- Reject formula-bearing active raw state before snapshotting.
- Read raw matrices and formula presence one dataset at a time.
- Replace one raw dataset by clearing its prior data range and writing one complete values-only matrix.
- Read back raw state for health validation.
- Never rename raw sheets or use a sheet-identity swap, because downstream formulas and protections follow sheet identity.

### `BackupRepository`

- Create a server-side copy of each raw sheet in the same target workbook before any raw mutation.
- Name each backup `_CXP06_BAK_<TOKEN>_<runId>`; the generated run ID must fit Google Sheets naming constraints.
- Hide each backup and enforce a CXP-owned sheet protection without relying on the copy operation to preserve protection correctly.
- Discover and group existing backups by run ID and dataset token.
- Delete a backup group only after successful cleanup, verified rollback, or safe incomplete-group reconciliation.
- Return only names, IDs, run IDs, and dataset tokens as metadata.

### `RollbackService`

- Restore all five raw sheets from a complete backup group one dataset at a time.
- Flush once after all restore writes.
- Re-read and compare restored raw matrices with the backup matrices before deleting any backup.
- Preserve the complete backup group until every restore and verification succeeds.
- Report `rollbackStatus: SUCCESS` with the original public error code when restoration succeeds.
- Throw a distinct rollback failure carrying `rollbackStatus: FAILED` and the original public error code when restoration or verification fails.

### `CommitService`

`CommitService.createOperations(services)` returns exactly:

1. `stage(context)`
2. `validateStage(context)`
3. `commit(context)`
4. `recalculate(context)`
5. `healthCheck(context)`

Callers merge these with the four callbacks returned by `InputAdapter.createOperations()`. The resulting object satisfies all nine `RunService.REQUIRED_OPERATIONS` without adding another orchestration path.

The service retains transaction state in a closure; raw matrices and backup values are never placed in run logs or error details.

## Transaction sequence

### Phase 1 — Stage and validate outside the lock

1. `stage` obtains the five payloads from `context.operationResults.validateSchema.payloads`.
2. It preflights every required staging sheet before clearing any prior staging content.
3. It writes one complete values-only matrix per dataset with five total `setValues` calls.
4. `validateStage` reads all five stage sheets and proves the stage rules above.
5. Any stage write or validation failure terminates before `COMMITTING`; active raw and backup state remain unchanged.

### Phase 2 — Commit and health under the lock

1. `commit` first reconciles stale backup groups while the CXP-04 script lock is held.
2. It rechecks the current fingerprint against `FILE_LEDGER` inside the lock. A newly successful duplicate exits before backup creation or raw mutation.
3. It validates active raw sheets as values-only and creates all five backups.
4. Raw mutation cannot start until all five backups exist and pass backup preflight.
5. It replaces the five raw datasets one at a time with the staged values-only matrices.
6. `recalculate` calls the injected spreadsheet flush once. No business formulas are introduced by this packet.
7. `healthCheck` re-reads all raw sheets, rejects formulas, reuses stage validation rules, and compares all five matrices to their payloads.
8. After raw health passes, it writes and read-confirms the `SUCCESS` fingerprint while the lock is still held. A failed run-ID lookup gets one bounded fingerprint lookup, which confirms only a row matching the same run ID and fingerprint.
9. It attempts to delete the backup group. Cleanup failure does not roll back healthy, success-recorded raw state; it returns a `backupCleanupStatus: PENDING` result for next-run reconciliation.
10. CXP-04 performs its final injected flush and releases the lock before recording terminal run success.

## Durable recovery algorithm

Backup discovery and recovery always occur inside `COMMITTING` before a new backup group is created.

For each discovered run ID:

- **A successful `FILE_LEDGER` row exists:** current raw is the accepted committed state. Delete any complete or partial leftover backups; never restore them.
- **No success row and all five backups exist:** treat the prior commit as unfinished. Restore and verify all five raw datasets, then delete the group.
- **No success row and fewer than five backups exist:** delete the incomplete group without restoring. The invariant that raw mutation starts only after all five backups exist proves active raw was not changed by that run.
- **More than one complete, unsuccessful group exists:** fail recovery closed. This violates the serialized lifecycle invariant, so guessing restoration order is unsafe.

If a process ends after raw writes but before success confirmation, the next locked run restores the complete group. If it ends after success confirmation but before cleanup, the next run keeps current raw and removes the orphaned group.

Backups are retained during rollback until every raw restoration and verification completes. A termination during backup deletion therefore cannot leave partially restored raw state.

## Duplicate and ledger consistency

CXP-05's pre-staging check remains useful for ordinary duplicates. CXP-06 repeats the lookup inside the production-write lock to prevent two first-time identical runs from both committing.

`FileLedgerRepository` gains a successful-run lookup by run ID for stale-backup reconciliation. Success recording follows these rules:

- no success row is written before raw health passes;
- success is written while the production lock is held;
- the service read-confirms that the successful fingerprint belongs to the current run;
- a failed or empty run-ID confirmation gets one bounded fingerprint lookup, which must match both the current run ID and fingerprint;
- if a ledger write response is indeterminate, readback decides whether success exists;
- absent success after an indeterminate write triggers rollback;
- confirmed success precedes backup cleanup so an abrupt cleanup interruption cannot cause a later restore of committed raw data.

## Failure handling and error taxonomy

The design adds only packet-specific stable errors that existing codes cannot express:

| Code | Meaning | Retryable |
|---|---|---:|
| `MIGRATION_STAGE_WRITE_FAILED` | A bulk staging write failed. | Yes |
| `MIGRATION_BACKUP_FAILED` | A complete recoverable snapshot could not be created. | Yes |
| `MIGRATION_RECOVERY_FAILED` | Stale backup reconciliation could not establish a safe starting state. | Yes |
| `MIGRATION_ROLLBACK_FAILED` | Raw restoration or rollback verification failed. | Yes |

Existing `MIGRATION_STAGE_VALIDATION_FAILED`, `MIGRATION_COMMIT_FAILED`, and `CALCULATION_HEALTH_CHECK_FAILED` retain their meanings.

Safe error details may contain dataset name, transaction phase, expected/actual counts, backup count, original error code, and rollback status. They must never contain a cell value, record, business key, formula text, source filename content, or backup payload.

An in-lock duplicate recheck occurs before a transaction starts and preserves `SOURCE_DUPLICATE_SUBMISSION`; it is not mislabeled as a commit failure.

## Failure precedence

- Stage failure: raw untouched; no rollback.
- Backup failure before all five backups exist: raw untouched; clean incomplete backups; report backup failure.
- Commit/recalculate/health failure after transaction start: attempt rollback.
- Successful rollback: throw the phase-appropriate original public code with `rollbackStatus: SUCCESS`.
- Failed rollback: throw `MIGRATION_ROLLBACK_FAILED` with `rollbackStatus: FAILED` and the original public code.
- Healthy raw plus confirmed success but incomplete backup deletion: do not roll back; return cleanup pending and let the next locked run finish deletion.

## Values-only and privacy boundaries

- Stage, raw, and backup content may contain sensitive operational values and remains inside protected workbook sheets.
- Test fixtures use synthetic values only.
- No source row, staged row, raw row, or backup row appears in repository artifacts, logs, error details, or research queries.
- Backup names contain only controlled tokens and the run ID.
- Backup cleanup is part of the active-run lifecycle; leftovers are reconciled before a later commit.

## Google Sheets atomicity limitations

Google Sheets exposes no true multi-sheet transaction. CXP-06 provides recoverability, not database atomicity:

- compliant writers are serialized by the CXP-04 script lock;
- other scripts that ignore that lock are outside the exclusion boundary;
- workbook readers can briefly observe partial raw replacement before flush/recovery;
- an abrupt termination can leave partial raw data until the next locked recovery attempt;
- a service call that succeeds remotely but fails before returning can be indeterminate and must be resolved by readback or later reconciliation.

These limitations are documented rather than hidden behind an “atomic” claim.

## Performance design

- Five staging writes, five raw writes, and at most five restore writes use one matrix `setValues` call per dataset.
- Backup creation is server-side and one call per raw sheet.
- Reads and restores process one dataset at a time to avoid retaining all old raw matrices simultaneously.
- No `appendRow`, per-cell `setValue`, or row-loop service call is permitted.
- Flush points are limited to post-commit/recalculate, rollback verification, and CXP-04's final pre-release flush.
- Local tests measure peak-schema matrix cell counts, service-call counts, and elapsed fake-runtime time.
- Hosted Apps Script execution duration, quotas, server-side copy behavior, and memory use require a synthetic UAT timing run. Without an authorized UAT target, the repository handoff must mark that acceptance item as a promotion gate rather than claim it passed.

## Test strategy and red-green order

The public seam is the five operations returned by `CommitService.createOperations()` combined with existing `InputAdapter` operations and executed through `RunService` where the state/lock boundary is material.

Behavioral tests are added before production implementation in this order:

1. Valid five-payload staging uses five bulk writes and produces exact encoded matrices.
2. Invalid/missing/mismatched stage data fails before raw mutation.
3. A successful run creates backups, commits all five values-only raw datasets, confirms health/success, and removes backups.
4. A deliberately injected intermediate raw write failure restores and verifies all five prior raw datasets and records successful rollback metadata.
5. A health-check mismatch restores all five datasets.
6. A rollback failure produces the distinct rollback failure with the original code and no raw values in details.
7. Complete unfinished backups restore on the next locked run; successful and incomplete groups clean safely; multiple unsuccessful complete groups fail closed.
8. A concurrent first-time duplicate that passed pre-staging is rejected by the in-lock recheck before backup or raw mutation.
9. Backup cleanup failure after confirmed success leaves healthy raw and is removed by next-run reconciliation.
10. Peak registry volumes preserve bounded bulk-call counts; the benchmark records elapsed local time without treating it as hosted timing proof.

Every new behavior must be observed red for the expected missing contract, then green under the identical focused command. CXP-03, CXP-04, CXP-05, and the full repository suite remain regression gates.

## External API research plan boundary

Before implementation relies on hosted behavior, current official Google documentation must confirm:

- `Sheet.copyTo(spreadsheet)` and returned-sheet behavior;
- sheet hiding, naming, protection, deletion, data-range clear/write/read, and formulas access;
- `SpreadsheetApp.flush()` semantics;
- Apps Script lock behavior already fixed by CXP-04 remains unchanged.

Documentation verifies call contracts only. Injected behavioral tests verify local orchestration; an authenticated synthetic UAT run verifies hosted performance and permissions.

## Acceptance mapping

| Packet criterion | Design evidence |
|---|---|
| Invalid input leaves raw unchanged | Full stage preflight/readback validation occurs before the lock or backup/raw mutation. |
| Injected mid-commit failure records rollback | Commit callbacks catch post-backup failures, restore all five, verify, and attach rollback status to the audited error. |
| All five datasets commit as one logical run | Closed five-dataset mapping, all-backups-before-mutation invariant, one run ID, one health gate, and one success ledger confirmation. |
| Raw contains values only | Sheet codec, formula preflight/health rejection, and bulk `setValues` matrices only. |
| Peak volumes acceptable in UAT | Bounded call-shape benchmark plus an explicit synthetic hosted UAT timing gate; no unsupported hosted claim. |

## Explicit non-goals

- Business transformations, formulas, pivots, aggregations, and reporting surfaces.
- Inbox polling, scheduling, workbook lifecycle, or production promotion.
- A guarantee of atomic reader visibility across Google Sheets tabs.
- Recovery from malicious manual deletion or modification of protected backup sheets by an owner.
- Retention of historical raw payloads after transaction cleanup.

## Written-spec review state

The architecture, transaction/recovery sequence, and validation/error/testing sections were approved conversationally. This written spec has been self-reviewed for placeholders, internal contradictions, scope creep, and ambiguous recovery ordering. Implementation planning begins only after the user approves this written file.
