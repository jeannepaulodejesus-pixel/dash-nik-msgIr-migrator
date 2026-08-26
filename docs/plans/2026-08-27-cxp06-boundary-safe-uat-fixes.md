# CXP-06 Boundary-Safe UAT Fixes Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make hosted CXP-06 terminal failures exactly-once auditable, make UAT fault injection reliable across trigger boundaries, and retain cleanup-debt status in the public continuation result.

**Architecture:** Add an idempotent terminal persistence seam to `RunRepository` and reuse the standard `RunService` failure record builders for hosted workers. Scope UAT faults to the operation invocation where they belong, and persist the final cleanup result in continuation state. Keep the production transaction and self-resuming trigger architecture unchanged.

**Tech Stack:** Google Apps Script-compatible JavaScript, Node.js 22 test runner, CommonJS test harnesses, clasp repository guardrails.

## Global Constraints

- Preserve the resumable pipeline and its execution-budget behavior.
- Keep all synthetic faults inside `src/uat`.
- Never replay backup or commit work while retrying a terminal audit write.
- Produce at most one terminal run row and one terminal error row per run ID while repairing partial writes.
- Preserve the original migration error when audit persistence itself fails.
- Do not delete retained backup evidence for rollback or cleanup-debt scenarios.
- Use the established `CALCULATION_HEALTH_CHECK_FAILED` contract for CASE04.
- Preserve unrelated working-tree changes.

---

### Task 1: Add idempotent terminal persistence and prepared-run failure recording

**Files:**
- Modify: `tests/cxp04-run-orchestration.test.cjs`
- Modify: `src/repository/RunRepository.js`
- Modify: `src/ingestion/RunService.js`

**Interfaces:**
- Consumes: `RunRepository.create(spreadsheet)`, `RunService.prepare(request, operations, services)`, a prepared checkpoint, and standard `RunLogger`/`ErrorLogger` records.
- Produces: `repository.persistOnce(runRecords, errorRecords)` and `RunService.recordFailure(checkpoint, error, services)`.

- [ ] **Step 1: Add the focused failing tests**

Add tests proving:

1. `persistOnce()` appends one run row and one error row on its first call, then appends neither on an identical retry.
2. If the run row exists but the error row is missing, a retry appends only the error row; the inverse case appends only the run row.
3. `recordFailure()` restores a prepared checkpoint, records `COMMITTING` as the failed operation state, produces the expected terminal failure state/code, and uses `persistOnce()`.
4. When an error already carries a run record and error record, `recordFailure()` reuses those records rather than rebuilding different timestamps or history.

- [ ] **Step 2: Verify the relevant failure**

Run: `node --test --test-name-pattern="persistOnce|recordFailure" tests/cxp04-run-orchestration.test.cjs`

Expected: non-zero exit because both public methods are absent.

- [ ] **Step 3: Implement the minimum behavior**

In `RunRepository`:

- add a helper that reads only column A below the header and returns existing run IDs;
- validate every required sheet before either append;
- filter run and error records independently by run ID;
- append only missing rows and return `{ appendedErrors, appendedRuns, existingErrors, existingRuns }`;
- expose `persistOnce` alongside `persist`.

In `RunService`:

- factor standard failure record construction from `persistFailure()` without changing existing synchronous behavior;
- add `recordFailure(checkpoint, error, services)`;
- reuse attached `runRecord`/`errorRecord` when both are present;
- otherwise restore the checkpoint state machine, advance `VALIDATING_STAGE` to `COMMITTING`, and build standard records;
- require `repository.persistOnce()` for this new boundary and rethrow the normalized operational error with its records attached.

- [ ] **Step 4: Verify the focused pass**

Run: `node --test --test-name-pattern="persistOnce|recordFailure" tests/cxp04-run-orchestration.test.cjs`

Expected: zero exit and all selected tests pass.

- [ ] **Step 5: Run the affected integration check**

Run: `node --test tests/cxp04-run-orchestration.test.cjs`

Expected: all orchestration and repository tests pass.

- [ ] **Step 6: Commit the passing deliverable**

```bash
git add src/repository/RunRepository.js src/ingestion/RunService.js tests/cxp04-run-orchestration.test.cjs
git commit -m "fix: persist hosted terminal audits once"
```

### Task 2: Make continuation failure audit retryable without replaying writes

**Files:**
- Modify: `tests/cxp06-uat-harness.test.cjs`
- Modify: `src/uat/Cxp06UatContinuation.js`

**Interfaces:**
- Consumes: `RunService.recordFailure(checkpoint, error, services)` and `RunRepository.persistOnce(runRecords, errorRecords)` from Task 1.
- Produces: production executor `auditFailure(state, error)` and persisted `failureAuditStatus`/`lastAuditErrorCode` continuation fields.

- [ ] **Step 1: Add the focused failing tests**

Add tests proving:

1. A direct hosted worker failure persists `status: FAILED`, calls `auditFailure()` once, records `failureAuditStatus: RECORDED`, and removes its trigger.
2. An audit persistence failure leaves the original migration error code in state, sets `failureAuditStatus: PENDING`, stores a bounded audit error code, and retains exactly one continuation trigger.
3. The next `continueConfigured()` call retries only `auditFailure()`, never invokes backup or commit, and clears the trigger after success.
4. Repeated audit-only retries cannot create duplicate rows through the production executor and `persistOnce()` path.

- [ ] **Step 2: Verify the relevant failure**

Run: `node --test --test-name-pattern="failure audit|audit-only" tests/cxp06-uat-harness.test.cjs`

Expected: non-zero exit because `auditFailure` and audit-pending continuation behavior do not exist.

- [ ] **Step 3: Implement the minimum behavior**

- add a bounded serializable terminal-error envelope to the continuation state;
- make the production executor call `RunService.recordFailure()` with hosted run services;
- update `markFailed()` to save the original terminal error before attempting audit persistence;
- on audit success, set `RECORDED`, clear audit error data, remove triggers, and rethrow the original failure;
- on audit failure, keep `PENDING`, retain one short-delay continuation, and preserve the original terminal error code;
- route `FAILED + PENDING` through an audit-only retry branch before the existing terminal-state return;
- expose audit status fields in `publicResult()` and idle defaults.

- [ ] **Step 4: Verify the focused pass**

Run: `node --test --test-name-pattern="failure audit|audit-only" tests/cxp06-uat-harness.test.cjs`

Expected: zero exit and all selected audit tests pass.

- [ ] **Step 5: Run the affected integration check**

Run: `node --test tests/cxp06-uat-harness.test.cjs`

Expected: all continuation and UAT harness tests pass.

- [ ] **Step 6: Commit the passing deliverable**

```bash
git add src/uat/Cxp06UatContinuation.js tests/cxp06-uat-harness.test.cjs
git commit -m "fix: retry hosted failure audits safely"
```

### Task 3: Scope health and rollback faults to their intended operation boundary

**Files:**
- Modify: `tests/cxp06-uat-harness.test.cjs`
- Modify: `src/uat/Cxp06FaultInjector.js`
- Modify: `src/uat/Cxp06UatHarness.js`

**Interfaces:**
- Consumes: the composed operation object returned by `Cxp06UatHarness.composeOperations()` and decorated raw repository/observer seams.
- Produces: `faultInjector.wrapOperations(operations)` plus commit-scoped rollback arming.

- [ ] **Step 1: Add the focused failing tests**

Add tests proving:

1. A fresh `HEALTH_MISMATCH` injector corrupts exactly the first full raw read made inside `healthCheck`, even when no replacement occurred in that injector instance.
2. The next full raw read remains clean, allowing rollback verification.
3. Replacement calls alone do not corrupt unrelated full reads before `healthCheck`.
4. `ROLLBACK_WRITE_FAILURE.afterRestoreWrite()` does not throw before its synthetic second-replacement commit fault.
5. After the intended replacement fault, the following restore write throws `UAT_ROLLBACK_WRITE_FAILURE`.
6. Harness execution decorates the operation set, so CASE04 cannot return a success result without executing the mismatch boundary.

- [ ] **Step 2: Verify the relevant failure**

Run: `node --test --test-name-pattern="phase-scoped health|commit-scoped rollback|CASE04" tests/cxp06-uat-harness.test.cjs`

Expected: non-zero exit because health arming is replacement-local and rollback-write failure is always armed.

- [ ] **Step 3: Implement the minimum behavior**

- add `wrapOperations()` to arm one health corruption immediately before delegated `healthCheck()`;
- remove health arming from `replaceAll()` and `replaceOne()`;
- consume the health corruption on one `readAll()` only;
- add `rollbackWriteArmed`, set it immediately before raising the intended replacement fault, and require it in `afterRestoreWrite()`;
- apply `wrapOperations()` after composing input and commit operations in the UAT harness.

- [ ] **Step 4: Verify the focused pass**

Run: `node --test --test-name-pattern="phase-scoped health|commit-scoped rollback|CASE04" tests/cxp06-uat-harness.test.cjs`

Expected: zero exit and all selected fault-boundary tests pass.

- [ ] **Step 5: Run the affected integration check**

Run: `node --test tests/cxp06-uat-harness.test.cjs tests/cxp06-rollback.test.cjs tests/cxp06-failures.test.cjs`

Expected: all UAT fault, rollback, and failure-path tests pass.

- [ ] **Step 6: Commit the passing deliverable**

```bash
git add src/uat/Cxp06FaultInjector.js src/uat/Cxp06UatHarness.js tests/cxp06-uat-harness.test.cjs
git commit -m "fix: scope CXP06 UAT faults to worker phases"
```

### Task 4: Persist cleanup debt in continuation status and align UAT documentation

**Files:**
- Modify: `tests/cxp06-uat-harness.test.cjs`
- Modify: `src/uat/Cxp06UatContinuation.js`
- Modify: `docs/cxp06-hosted-uat-revalidation-2026-08-26.md`
- Modify: `docs/cxp06-uat-runbook.md`

**Interfaces:**
- Consumes: `result.operationResults.healthCheck.backupCleanupStatus` from `RunService.resume()`.
- Produces: public/persisted `backupCleanupStatus: null | "DELETED" | "PENDING"`.

- [ ] **Step 1: Add the focused failing tests**

Add tests proving:

1. A successful finalization returning `PENDING` saves and returns `backupCleanupStatus: PENDING`.
2. `getStatus()` returns the saved value after the final invocation has ended.
3. A normal successful cleanup returns `DELETED`, while pre-finalization and idle status return `null`.

- [ ] **Step 2: Verify the relevant failure**

Run: `node --test --test-name-pattern="backupCleanupStatus" tests/cxp06-uat-harness.test.cjs`

Expected: non-zero exit because continuation serialization currently drops the field.

- [ ] **Step 3: Implement the minimum behavior**

- initialize `backupCleanupStatus` to `null` for new and idle states;
- copy the final health-check result into state before marking the pipeline complete;
- expose the field in `publicResult()` and `getStatus()`;
- correct CASE04 documentation to `CALCULATION_HEALTH_CHECK_FAILED`;
- document `failureAuditStatus` and the CASE05.3 cleanup-status evidence requirement in the hosted runbook.

- [ ] **Step 4: Verify the focused pass**

Run: `node --test --test-name-pattern="backupCleanupStatus" tests/cxp06-uat-harness.test.cjs`

Expected: zero exit and all selected cleanup-status tests pass.

- [ ] **Step 5: Run the affected integration check**

Run: `node --test tests/cxp06-uat-harness.test.cjs tests/cxp06-packet-status.test.cjs`

Expected: all continuation-status and packet-status tests pass.

- [ ] **Step 6: Commit the passing deliverable**

```bash
git add src/uat/Cxp06UatContinuation.js tests/cxp06-uat-harness.test.cjs docs/cxp06-hosted-uat-revalidation-2026-08-26.md docs/cxp06-uat-runbook.md
git commit -m "fix: retain CXP06 cleanup debt status"
```

### Task 5: Verify the integrated boundary-safe fix

**Files:**
- Modify if required by verified output: `docs/packet-status.md`
- Modify if required by verified output: `tests/cxp06-packet-status.test.cjs`

**Interfaces:**
- Consumes: all interfaces from Tasks 1-4.
- Produces: a locally verified implementation ready for hosted revalidation.

- [ ] **Step 1: Run all focused CXP-04/CXP-06 tests**

Run: `node --test tests/cxp04-run-orchestration.test.cjs tests/cxp06-uat-harness.test.cjs tests/cxp06-rollback.test.cjs tests/cxp06-failures.test.cjs tests/cxp06-packet-status.test.cjs`

Expected: zero exit with no failed tests.

- [ ] **Step 2: Run Apps Script syntax validation**

Run: `npm run lint`

Expected: every Apps Script JavaScript file passes syntax validation.

- [ ] **Step 3: Run the complete repository verification**

Run: `npm run verify`

Expected: lint, all Node tests, and repository guardrails pass with zero failures.

- [ ] **Step 4: Check patch hygiene**

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 5: Record hosted revalidation as the remaining external gate**

Update packet status only if its assertions no longer match the verified local implementation. Keep cases 03, 04, 04.1, 05.3, and 05.4 blocked until new hosted evidence proves the required audit rows, error/status fields, ledger result, and backup topology.

- [ ] **Step 6: Commit any verification-document adjustment**

```bash
git add docs/packet-status.md tests/cxp06-packet-status.test.cjs
git commit -m "docs: align CXP06 hosted revalidation gate"
```

Skip this commit when verification requires no packet-status change.
