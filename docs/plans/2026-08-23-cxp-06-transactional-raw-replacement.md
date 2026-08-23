# CXP-06 Transactional Raw Replacement Implementation Plan
> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver recoverable, values-only replacement of all five raw datasets through staging, validation, same-workbook backups, rollback, stale-backup recovery, and post-commit health verification.

**Architecture:** Keep CXP-04's `RunService` as the sole run/lock orchestrator. Add a repository-coordinated transaction layer whose five phase callbacks compose with `InputAdapter.createOperations`; staging and stage validation execute before the production lock, while duplicate recheck, backup, raw replacement, recalculation, health checks, success-ledger confirmation, and cleanup execute under that lock. Hidden, protected, run-scoped backup sheets provide rollback and next-run recovery without relying on process memory.

**Tech Stack:** Google Apps Script V8 JavaScript, Google Sheets service, Node.js 22 built-in test runner, repository JavaScript checks, and the existing CXP-03 through CXP-05 contracts.

## Global Constraints

- Preserve the user's existing uncommitted CXP-03, CXP-04, and CXP-05 work. Do not reset, discard, rewrite, or stage unrelated files.
- Do not commit unless the user explicitly authorizes a commit. Every commit step below is conditional; otherwise leave a verified working tree.
- Do not deploy, push with `clasp`, or mutate a live spreadsheet during local implementation.
- Keep `RunService.runOperation` as the only lock owner. CXP-06 callbacks must not acquire a second lock.
- Keep the existing phase boundary: `stage` and `validateStage` outside the lock; `commit`, `recalculate`, and `healthCheck` inside the lock.
- Treat the five datasets as one logical transaction in this fixed order: `handled`, `offered`, `aht`, `auxes`, `staff`.
- Preserve the CXP-03 canonical header order, schema version, null policy, type rules, and key fields.
- Recheck duplicate state under the production lock before creating backups or mutating raw sheets.
- Create and verify a complete five-sheet backup group before the first raw clear/write.
- Write raw and staging sheets with bulk `setValues`; raw sheets must contain values only and no formulas.
- A healthy commit becomes authoritative only after its SUCCESS ledger row is written and read back while the lock is still held.
- Backup cleanup after confirmed success is best-effort. Cleanup failure is recovery debt, not a reason to roll back healthy raw data.
- Local tests must use synthetic fakes only. Peak-volume Apps Script UAT remains a promotion gate because local tests cannot prove hosted quotas or reader-visible atomicity.
- Implementation source files use Apps Script-compatible globals and CommonJS exports only where the existing test harness already supports them.

## Approved Public Interfaces

### Dataset sheet bindings

`src/config/DatasetSheets.js` exports:

```js
DatasetSheets.listBindings()
DatasetSheets.getByDatasetName(datasetName)
```

Each immutable binding contains `{ datasetName, stagingSheetName, rawSheetName }` and follows the fixed transaction order.

### Sheet value codec

`src/services/SheetValueCodec.js` exports:

```js
SheetValueCodec.encodePayload(payload)
SheetValueCodec.decodeMatrix(datasetName, values)
SheetValueCodec.matricesEqual(left, right)
```

`encodePayload` returns one header-plus-record matrix. It converts normalized `null` to an empty cell and otherwise preserves strings, numbers, and booleans. `decodeMatrix` converts empty controlled cells back to `null` and returns `{ datasetName, headers, records }`. `matricesEqual` performs strict rectangular cell comparison after controlled decoding.

### Repositories and validators

```js
StagingRepository.create(spreadsheet).writeAll(payloads)
StagingRepository.create(spreadsheet).readAll()

StageValidator.validate(payloads, snapshots)

RawDataRepository.create(spreadsheet).preflight()
RawDataRepository.create(spreadsheet).replaceAll(payloads)
RawDataRepository.create(spreadsheet).restoreAll(backupSnapshots)
RawDataRepository.create(spreadsheet).readAll()

BackupRepository.create(spreadsheet, services).createGroup(runId)
BackupRepository.create(spreadsheet, services).discoverGroups()
BackupRepository.create(spreadsheet, services).readGroup(group)
BackupRepository.create(spreadsheet, services).deleteGroup(group)
```

Snapshots use `{ datasetName, sheetName, values, formulas }`. Backup groups use `{ runId, token, complete, sheetsByDataset }`; `sheetsByDataset` maps all present dataset names to backup sheet objects. Backup names follow `_CXP06_BAK_<TOKEN>_<runId>` with a bounded, sheet-safe token that identifies the dataset.

### Rollback and commit services

```js
RollbackService.create(services).rollback(group, cause)
RollbackService.create(services).reconcile()

CommitService.createOperations(services)
```

`RollbackService` receives `backupRepository`, `rawRepository`, `ledgerRepository`, and `flush`. `CommitService.createOperations` receives `targetSpreadsheet`, `ledgerRepository`, `clock`, `flush`, `spreadsheetApp`, and `session`; it constructs the CXP-06 repositories/services and returns exactly `{ stage, validateStage, commit, recalculate, healthCheck }`.

The caller composes CXP-05 and CXP-06 without replacing CXP-04:

```js
const operations = Object.assign(
  InputAdapter.createOperations(adapterRequest, inputServices),
  CommitService.createOperations(commitServices)
);
RunService.runOperation(runRequest, operations, runServices);
```

## Pre-implementation Research Gate

Before production edits, use `skillquiver:research-systematically` and freeze the research contract in:

`C:\Users\djean\.codex\visualizations\2026\08\22\01a02a2c-ecc6-7bd3-9aea-4ffc29a6209b\cxp06-google-sheets-transaction-research.md`

The frozen questions are:

1. What do the current official Apps Script references guarantee for `Sheet.copyTo`, copied-sheet visibility, renaming, hiding, protection, and deletion?
2. What are the exact current semantics of `Range.clearContent`, `Range.setValues`, `Range.getValues`, `Range.getFormulas`, and `SpreadsheetApp.flush`?
3. Which parts of the approved recovery design are documented guarantees, and which are explicit engineering inferences?

Use only current official Google Apps Script documentation. Record access dates and direct URLs, separate evidence from inference, and dispatch one read-only independent verifier after the evidence and claims exist. If a documented API contradicts an approved implementation detail, stop and amend the design before coding; otherwise preserve the approved architecture.

---

## Task 1: Lock the dataset mapping, cell codec, and CXP-06 error vocabulary

**Files:**

- Create: `src/config/DatasetSheets.js`
- Create: `src/services/SheetValueCodec.js`
- Modify: `src/monitoring/ErrorCodes.js`
- Create: `tests/cxp06-transactional-raw-replacement.test.cjs`

### Steps

- [ ] Add focused failing tests that assert the exact five dataset/staging/raw bindings and order, immutable lookup results, unknown-dataset rejection, header-plus-record encoding, `null`/empty-cell round trips, strict matrix comparison, and the presence of `MIGRATION_STAGE_WRITE_FAILED`, `MIGRATION_BACKUP_FAILED`, `MIGRATION_RECOVERY_FAILED`, and `MIGRATION_ROLLBACK_FAILED`.
- [ ] Run `node --test tests/cxp06-transactional-raw-replacement.test.cjs` and confirm the red failure is caused by missing CXP-06 modules or exports, not a syntax or fixture error.
- [ ] Implement the minimum mapping, codec, and error-code changes. Source sheet names from `SheetNames`; reject unknown datasets through the existing error conventions; do not add implicit coercion for dates, date-times, identifiers, or numeric strings.
- [ ] Re-run `node --test tests/cxp06-transactional-raw-replacement.test.cjs` and confirm the Task 1 assertions pass.
- [ ] Run `node --test tests/cxp03-schema.test.cjs tests/cxp04-run-orchestration.test.cjs tests/cxp05-input-adapters.test.cjs tests/cxp06-transactional-raw-replacement.test.cjs` to catch schema, orchestration, or adapter regressions.
- [ ] Only if the user explicitly authorizes commits, commit the Task 1 files with `git commit -m "feat: add CXP-06 sheet contract foundation"`; otherwise leave them uncommitted.

## Task 2: Implement bulk staging and persisted-stage validation

**Files:**

- Create: `src/repository/StagingRepository.js`
- Create: `src/validation/StageValidator.js`
- Modify: `tests/cxp06-transactional-raw-replacement.test.cjs`

### Steps

- [ ] Add focused failing tests for all-sheet preflight, clearing prior data extents, exactly one header-plus-record `setValues` call per dataset, controlled blank decoding, and captured values/formulas. Add validator cases for missing or extra datasets, schema-version mismatch, noncanonical headers/order, row-count mismatch or row-volume overflow, formulas, blank/duplicate keys, invalid declared dates/date-times, invalid site/queue cell types, and persisted matrix mismatch. Assert every validation failure occurs without any raw-sheet call.
- [ ] Run `node --test --test-name-pattern="staging|stage validation" tests/cxp06-transactional-raw-replacement.test.cjs` and confirm the failures identify the absent repository/validator behavior.
- [ ] Implement `StagingRepository.create(spreadsheet)` so it resolves all five stage sheets before clearing or writing any, clears the existing used data range for each, writes each complete matrix in one `setValues`, and returns safe summaries. Implement `StageValidator.validate(payloads, snapshots)` against `SchemaRegistry.getSchema`, `DatasetPayload` invariants, persisted values, and persisted formulas; throw the existing stage-validation migration code on any mismatch.
- [ ] Re-run `node --test --test-name-pattern="staging|stage validation" tests/cxp06-transactional-raw-replacement.test.cjs` and confirm all focused cases pass.
- [ ] Run `node --test tests/cxp03-schema.test.cjs tests/cxp05-input-adapters.test.cjs tests/cxp06-transactional-raw-replacement.test.cjs` and confirm normalized-input behavior remains compatible.
- [ ] Only if the user explicitly authorizes commits, commit the Task 2 files with `git commit -m "feat: add validated CXP-06 staging"`; otherwise leave them uncommitted.

## Task 3: Implement values-only raw replacement and durable backup groups

**Files:**

- Create: `src/repository/RawDataRepository.js`
- Create: `src/repository/BackupRepository.js`
- Modify: `tests/cxp06-transactional-raw-replacement.test.cjs`

### Steps

- [ ] Add focused failing tests for preflighting all five raw sheets before mutation, rejecting any raw formula, bulk clear/write of exact matrices, exact readback snapshots, and all-dataset restoration. Add backup tests for server-side same-workbook copies, bounded deterministic dataset tokens, run-id grouping, explicit hidden state, explicit managed protection, complete/incomplete group discovery, safe reads, and deletion of only the named group.
- [ ] Run `node --test --test-name-pattern="raw repository|backup repository" tests/cxp06-transactional-raw-replacement.test.cjs` and confirm the expected repository gaps are red.
- [ ] Implement `RawDataRepository` with full preflight before the first clear/write, formula rejection, values-only bulk replacement, restoration, and readback. Implement `BackupRepository` with `Sheet.copyTo`, CXP-06-owned names/descriptions, explicit hide/protect normalization after copy, group discovery by parsed metadata, and narrowly targeted deletion. Never assume copied protections are preserved.
- [ ] Re-run `node --test --test-name-pattern="raw repository|backup repository" tests/cxp06-transactional-raw-replacement.test.cjs` and confirm the focused cases pass.
- [ ] Run `node --test tests/cxp02-initializers.test.cjs tests/cxp06-transactional-raw-replacement.test.cjs` to verify backup protection work does not alter CXP-02 managed-sheet behavior.
- [ ] Only if the user explicitly authorizes commits, commit the Task 3 files with `git commit -m "feat: add raw and backup repositories"`; otherwise leave them uncommitted.

## Task 4: Implement rollback, stale-backup recovery, and run-id ledger lookup

**Files:**

- Create: `src/services/RollbackService.js`
- Modify: `src/repository/FileLedgerRepository.js`
- Modify: `tests/cxp06-transactional-raw-replacement.test.cjs`
- Modify: `tests/cxp05-input-adapters.test.cjs`

### Steps

- [ ] Add focused failing tests for `FileLedgerRepository.findSuccessfulByRunId(runId)` and for rollback restoring all five datasets, flushing, comparing every restored raw snapshot to its backup, retaining backups until the whole restore verifies, and returning only safe metadata. Add reconciliation cases: a prior SUCCESS row deletes leftovers without restoring; one complete unsuccessful group restores/verifies/deletes; an incomplete unsuccessful group deletes without restoring; multiple complete unsuccessful groups fail closed; restore mismatch throws `MIGRATION_ROLLBACK_FAILED`; discovery/recovery faults throw `MIGRATION_RECOVERY_FAILED` without leaking spreadsheet data.
- [ ] Run `node --test --test-name-pattern="ledger|rollback|recovery" tests/cxp05-input-adapters.test.cjs tests/cxp06-transactional-raw-replacement.test.cjs` and confirm the failures correspond to the missing lookup/service behavior.
- [ ] Extend the existing ledger repository without changing its current append or fingerprint lookup contracts. Implement `RollbackService.create` so cleanup follows verification, cause details are sanitized, and recovery rules exactly match the approved design. Flush after restore and before the verification read.
- [ ] Re-run `node --test --test-name-pattern="ledger|rollback|recovery" tests/cxp05-input-adapters.test.cjs tests/cxp06-transactional-raw-replacement.test.cjs` and confirm the focused cases pass.
- [ ] Run `node --test tests/cxp04-run-orchestration.test.cjs tests/cxp05-input-adapters.test.cjs tests/cxp06-transactional-raw-replacement.test.cjs` to verify ledger and failure-envelope compatibility.
- [ ] Only if the user explicitly authorizes commits, commit the Task 4 files with `git commit -m "feat: add CXP-06 rollback and recovery"`; otherwise leave them uncommitted.

## Task 5: Compose the two-phase transaction into the existing run state machine

**Files:**

- Create: `src/services/CommitService.js`
- Modify: `tests/cxp06-transactional-raw-replacement.test.cjs`

### Steps

- [ ] Add focused failing integration tests that merge `InputAdapter.createOperations` and `CommitService.createOperations` and then run them through `RunService.runOperation`. Cover the happy path and assert: stage/validate precede lock acquisition; recovery and duplicate recheck occur after acquisition; all five backups precede the first raw mutation; five raw datasets replace in fixed order; recalculate flush precedes health readback; health validation checks schema, counts, formulas, keys, types, and exact persisted matrices; SUCCESS is appended and read-confirmed before lock release; cleanup occurs only afterward but still while locked; public results contain summaries, never cell contents.
- [ ] Run `node --test --test-name-pattern="commit service|two-phase|happy path" tests/cxp06-transactional-raw-replacement.test.cjs` and confirm the missing transaction composition is red.
- [ ] Implement `CommitService.createOperations(services)` with exactly five callbacks. `stage` consumes the schema-validated payloads from prior operation results and persists them. `validateStage` rereads/validates stage. `commit` first reconciles stale groups, rechecks the current fingerprint with `ledgerRepository.findSuccessfulByFingerprint`, preflights raw, creates a complete group, replaces raw, and returns private transaction state for later phases. `recalculate` performs the controlled flush. `healthCheck` rereads and validates raw, records SUCCESS via the existing duplicate service/ledger contract, confirms it by run ID with a bounded fingerprint-lookup fallback that must match the same run ID and fingerprint, and attempts best-effort backup cleanup without invalidating success.
- [ ] Re-run `node --test --test-name-pattern="commit service|two-phase|happy path" tests/cxp06-transactional-raw-replacement.test.cjs` and confirm the focused integration passes.
- [ ] Run `node --test tests/cxp04-run-orchestration.test.cjs tests/cxp05-input-adapters.test.cjs tests/cxp06-transactional-raw-replacement.test.cjs` and confirm the existing state-machine and adapter contracts remain green.
- [ ] Only if the user explicitly authorizes commits, commit the Task 5 files with `git commit -m "feat: add CXP-06 two-phase commit service"`; otherwise leave them uncommitted.

## Task 6: Prove failure behavior and safe terminal states

**Files:**

- Modify: `src/services/CommitService.js`
- Modify: `src/services/RollbackService.js`
- Modify: `tests/cxp06-transactional-raw-replacement.test.cjs`

### Steps

- [ ] Add failing fault-injection tests for an invalid stage, failure after the second raw replacement, health mismatch after all replacements, rollback write failure, concurrent duplicate appearing between pre-lock and in-lock checks, SUCCESS read-confirmation failure, and post-success backup cleanup failure. Assert: invalid stage leaves raw untouched; commit/health failures attempt rollback of all five; verified rollback reports the original safe migration failure with rollback metadata; rollback failure reports `MIGRATION_ROLLBACK_FAILED` and retains backups; the in-lock duplicate makes no backup/raw mutation; a failed run-ID confirmation uses one bounded fingerprint lookup and preserves success only when the record matches the same run ID and fingerprint; success unconfirmed by either path rolls back; cleanup debt preserves healthy success and leaves a discoverable group for next-run reconciliation.
- [ ] Run `node --test --test-name-pattern="failure|rollback|duplicate race|cleanup" tests/cxp06-transactional-raw-replacement.test.cjs` and confirm each injected scenario is red for the intended missing behavior.
- [ ] Add the minimum guarded error handling around the transaction phases. Preserve the original categorized failure when rollback fully succeeds; replace it with the rollback taxonomy only when rollback itself cannot reach a verified safe state. Ensure every public error/log detail is safe and bounded, and never delete a backup group whose restore has not fully verified.
- [ ] Re-run `node --test --test-name-pattern="failure|rollback|duplicate race|cleanup" tests/cxp06-transactional-raw-replacement.test.cjs` and confirm all failure invariants pass.
- [ ] Run `node --test tests/cxp04-run-orchestration.test.cjs tests/cxp05-input-adapters.test.cjs tests/cxp06-transactional-raw-replacement.test.cjs` and inspect the event-order assertions to verify the lock covers duplicate recheck through success confirmation/cleanup.
- [ ] Only if the user explicitly authorizes commits, commit the Task 6 files with `git commit -m "test: prove CXP-06 rollback guarantees"`; otherwise leave them uncommitted.

## Task 7: Add peak-volume evidence, operator documentation, and final verification

**Files:**

- Modify: `tests/cxp06-transactional-raw-replacement.test.cjs`
- Modify: `package.json`
- Create: `docs/transactional-raw-replacement-contract.md`
- Create: `docs/cxp06-uat-runbook.md`
- Modify: `docs/architecture-decisions.md`
- Modify: `docs/decision-log.md`
- Modify: `docs/packet-status.md`
- Modify: `docs/testing.md`
- Modify only if composition wording needs clarification: `docs/input-adapter-contract.md`
- Modify only if phase wording needs clarification: `docs/run-orchestration-contract.md`

### Steps

- [ ] Add a failing peak-volume synthetic test using each schema's declared upper row bound. Record exact Sheets-service call counts and elapsed local time; assert constant per-dataset bulk writes, no per-cell calls, all five datasets, values-only persisted output, and bounded safe result/log objects. Add `test:cxp06` to `package.json`.
- [ ] Run `npm run test:cxp06` and confirm the peak test initially fails because its performance/call-count evidence or package script is absent.
- [ ] Make only the changes needed to satisfy the peak test, then document the transaction contract, error/recovery semantics, explicit no-atomic-reader-visibility limitation, cleanup-debt behavior, and an Apps Script UAT procedure. The UAT runbook must require a configured non-production target, expected peak matrices, elapsed time, execution-log capture, raw formula checks, and rollback fault injection; it must not claim hosted acceptance without those results. Update packet status to distinguish local completion from the pending hosted promotion gate.
- [ ] Run `npm run test:cxp06` and confirm all CXP-06 focused and peak-volume tests pass. Record test count, duration, and exact synthetic call counts in the delivery evidence.
- [ ] Run `npm run verify`, then `git -c safe.directory=D:/git_projects/dash-nik-msgIr-migrator diff --check`, and inspect `git -c safe.directory=D:/git_projects/dash-nik-msgIr-migrator status --short`. Confirm all suites, lint, guardrails, whitespace checks, and expected file ownership pass. Run the `skillquiver:verification-before-completion` checklist against fresh output before stating completion.
- [ ] Only if the user explicitly authorizes a commit, stage only CXP-06-owned files and commit with the packet message `git commit -m "feat: add staged transactional raw-data commit"`; otherwise report the verified uncommitted handoff and exact changed files.

## Completion Evidence Required

- Research record with official sources, evidence/inference separation, and independent verifier result.
- Focused CXP-06 test command and passing test count.
- Full `npm run verify` output with lint, all tests, and guardrails passing.
- `git diff --check` exit code zero.
- Event-order evidence showing the production lock spans in-lock duplicate recheck through ledger confirmation and cleanup attempt.
- Fault-injection evidence for mid-commit rollback, health-failure rollback, rollback failure, duplicate race, stale recovery, and cleanup debt.
- Local peak-volume matrices, exact call counts, and elapsed time.
- Explicit statement that hosted Apps Script UAT is complete only if a target was supplied and the runbook evidence was actually captured; otherwise it remains the promotion gate.

## Unresolved Product Decisions

None. The user approved hidden run-scoped backup sheets and the repository-coordinated transaction service. The remaining hosted UAT is evidence collection, not a design choice.
