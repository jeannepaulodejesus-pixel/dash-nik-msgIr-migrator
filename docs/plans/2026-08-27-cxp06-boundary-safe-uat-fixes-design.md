# CXP-06 Boundary-Safe UAT Fixes Design

## Objective

Unblock UAT cases 03, 04, 04.1, 05.3, and 05.4 without weakening the production transaction guarantees or reintroducing six-minute Apps Script execution risk.

The change must preserve the current resumable pipeline, keep fault injection confined to UAT, and make terminal results independently verifiable from the control workbook and continuation status.

## Confirmed Problems

1. Hosted backup and dataset-commit workers call `CommitService` directly. Their terminal failures reach `Cxp06UatContinuation.markFailed()` without passing through `RunService.persistFailure()`, so `RUN_LOG` and `ERROR_LOG` remain empty.
2. The CASE04 health mismatch is armed by raw replacement state held in a JavaScript closure. The final health check executes in a later trigger invocation with a new injector, so the fault is lost and the run can report false success.
3. The CASE04.1 rollback-write fault is active for every restore. It can therefore fault pre-run reconciliation before the intended commit failure and is then normalized as `MIGRATION_RECOVERY_FAILED`.
4. `CommitService.healthCheck()` returns `backupCleanupStatus`, but the continuation state and `publicResult()` discard it.

## Design Decisions

### 1. Idempotent terminal audit boundary

`RunRepository` will expose `persistOnce(runRecords, errorRecords)` in addition to the existing append-only `persist()` API.

`persistOnce()` will:

- validate both log schemas before writing;
- deduplicate each sheet independently by `Run ID`;
- append a missing `RUN_LOG` row even if the matching `ERROR_LOG` row already exists, and vice versa;
- perform bounded ID-column reads rather than loading full log rows;
- return counts describing rows appended and rows already present.

Independent deduplication makes a retry repair a partial prior write without duplicating the row that already succeeded. Existing callers of `persist()` retain their current behavior.

`RunService` will expose `recordFailure(checkpoint, error, services)`. It will restore the checkpoint state machine, advance from `VALIDATING_STAGE` to the production boundary `COMMITTING`, normalize the original error, build the standard run and error records, persist them through `persistOnce()`, attach both records to the normalized error, and rethrow it. If an error already carries standard run and error records, the method will reuse them and only perform the idempotent persistence step.

Hosted continuation failures are therefore recorded through the same `RunLogger`, `ErrorLogger`, and error-code mapping used by synchronous runs.

### 2. Retryable failure-audit handoff

The production continuation executor will expose `auditFailure(state, error)`. `markFailed()` will:

1. save the terminal pipeline status and bounded original error with `failureAuditStatus: PENDING`;
2. invoke `auditFailure()`;
3. mark the audit `RECORDED` and remove continuation triggers only after persistence succeeds;
4. retain one continuation trigger when audit persistence fails so the audit can be retried without rerunning backup or commit work.

When `continueConfigured()` sees `status: FAILED` plus `failureAuditStatus: PENDING`, it will retry only the audit. It must never resume production writes in that branch. Repository idempotency makes retries safe after partial writes.

The original migration error remains the terminal business error. A separate bounded audit-error field records reporting failures without replacing the original code.

### 3. Invocation-local, phase-scoped health mismatch

The fault injector will decorate the composed operation set. For `HEALTH_MISMATCH`, it will arm exactly one corrupted `rawRepository.readAll()` immediately before the `healthCheck` operation delegates to `CommitService`.

This removes dependence on replacement-time closure state and guarantees that:

- the fault fires in the same trigger invocation as the final health check;
- the first health read fails;
- the following rollback-verification read is clean;
- production code remains unchanged;
- earlier backup, commit, and reconciliation reads are not corrupted.

Replacement methods will no longer be responsible for arming the health mismatch.

### 4. Commit-scoped rollback-write fault

`ROLLBACK_WRITE_FAILURE` will begin unarmed. Its `afterReplacement` observer will arm the rollback-write fault only when the intended synthetic commit failure is raised. `afterRestoreWrite` will throw only while armed.

Consequences:

- the intended commit failure followed by rollback failure reports `MIGRATION_ROLLBACK_FAILED`;
- reconciliation of an older unfinished backup is not poisoned by the new scenario fault;
- the retained complete backup group remains available for evidence when rollback fails.

No change is required to production `RollbackService.reconcile()` error normalization.

### 5. Durable cleanup-status observability

On successful finalization, the continuation will copy `operationResults.healthCheck.backupCleanupStatus` into durable state before returning. `publicResult()`, `getStatus()`, and idle/default results will expose `backupCleanupStatus`, with `null` before finalization and `DELETED` or `PENDING` afterward.

CASE05.3 can then prove cleanup debt using both the five retained hidden backup sheets and a durable `backupCleanupStatus: PENDING` result.

## State and Interface Changes

The persisted continuation state gains:

- `backupCleanupStatus: null | "DELETED" | "PENDING"`
- `failureAuditStatus: null | "PENDING" | "RECORDED"`
- `lastAuditErrorCode: string | null`
- a bounded terminal error envelope sufficient to retry audit persistence

New interfaces:

- `RunRepository.persistOnce(runRecords, errorRecords)`
- `RunService.recordFailure(checkpoint, error, services)`
- production continuation executor `auditFailure(state, error)`
- fault injector operation decorator for phase-scoped health faults

All new repository and executor calls will retain compatibility fallbacks for existing test doubles while production uses the idempotent path.

## UAT Outcome Mapping

| Case | Required result after fix |
| --- | --- |
| 03 | `MIGRATION_COMMIT_FAILED`, `rollbackStatus: VERIFIED`, no backup sheets, and one matching row in each audit log |
| 04 | `CALCULATION_HEALTH_CHECK_FAILED`, verified rollback, no success ledger entry for the run, and terminal audit rows |
| 04.1 | `MIGRATION_ROLLBACK_FAILED`, `rollbackStatus: FAILED`, one retained complete backup group, and terminal audit rows |
| 05.3 | `SUCCESS`, five retained backup sheets, and durable `backupCleanupStatus: PENDING` |
| 05.4 | `MIGRATION_RECOVERY_FAILED` with `multiple_unfinished_groups`, ten retained sheets, and terminal audit rows |

## Test Strategy

Implementation will use red-green-refactor tests covering:

1. `persistOnce()` exact-once behavior and repair of partial prior writes.
2. `RunService.recordFailure()` state history, error record state, and standard error normalization.
3. Continuation failure auditing, audit-only retry, and prevention of production-work replay.
4. CASE04 health mismatch across a fresh continuation invocation and clean rollback verification.
5. CASE04.1 rollback-write fault arming and non-interference with reconciliation.
6. CASE05.3 propagation and persistence of `backupCleanupStatus: PENDING`.
7. Existing UAT scenarios, Apps Script syntax checks, manifest/guardrail tests, and the full repository test suite.

## Non-Goals

- Replacing the current self-resuming trigger architecture.
- Changing production health-check or rollback algorithms.
- Automatically deleting retained backup evidence from failed or cleanup-debt scenarios.
- Treating a UAT fault-injection result as production proof without hosted revalidation.

The earlier revalidation note names the expected CASE04 code as `MIGRATION_HEALTH_CHECK_FAILED`. That code does not exist in `ErrorCodes`; the established orchestration and transactional contracts use `CALCULATION_HEALTH_CHECK_FAILED`. The evidence documentation will be corrected to the existing contract rather than introducing a duplicate error code.

## Hosted Revalidation

After the local suite passes and the updated Apps Script is deployed, cases 03, 04, 04.1, 05.3, and 05.4 must be rerun against a clean, scenario-appropriate workbook topology. Promotion remains blocked until the required status, audit rows, ledger state, and retained/deleted backup topology are captured for each case.
