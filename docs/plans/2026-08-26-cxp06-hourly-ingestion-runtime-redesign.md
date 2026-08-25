# CXP-06 Hourly Ingestion Runtime Redesign Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make hosted CXP-06 backup and commit continuations dataset-scoped and cooperatively budgeted so hourly ingestion avoids six-minute timeouts and unnecessary trigger waits.

**Architecture:** Preserve the current checkpoint controller and synchronous transaction APIs while adding one-dataset repository/service seams for hosted continuations. Backup and commit workers pack safe steps until a 270-second deadline calculation says to persist and yield; the existing final resume performs transaction-wide health and audit completion.

**Tech Stack:** Google Apps Script V8 JavaScript, Script Properties, installable time-driven triggers, Node.js built-in test runner, clasp.

## Global Constraints

- Preserve the five-dataset order and exact staging/raw sheet bindings.
- Never persist or log cell values.
- Preserve duplicate protection, complete backup ownership, formula rejection, rollback, final health validation, audit success, and DEV/UAT gates.
- Start no new work unit when its measured reserve plus handoff margin cannot fit within 270,000 ms.
- Keep existing synchronous `RunService.execute()` and compatibility methods green.
- Do not overwrite or revert unrelated dirty-worktree changes.

---

### Task 1: Dataset-scoped persisted data seams

**Files:**
- Modify: `src/repository/StagingRepository.js`
- Modify: `src/repository/RawDataRepository.js`
- Modify: `src/repository/BackupRepository.js`
- Modify: `src/validation/StageValidator.js`
- Test: `tests/cxp06-staging.test.cjs`
- Test: `tests/cxp06-raw-backup.test.cjs`

**Interfaces:**
- Consumes: registered dataset name, run metadata, run-scoped complete backup group, normalized payload.
- Produces: `readDatasetCheckpoint`, `validateDatasetCheckpoint`, `readOne`, `preflightOne`, `replacePayload`, `readDataset`, and `verifyDataset`.

- [ ] Add focused tests proving only the named staging/raw/backup sheet is read or written, unknown datasets fail closed, formulas are rejected, and a persisted one-dataset write validates exactly.
- [ ] Run `node --test tests/cxp06-staging.test.cjs tests/cxp06-raw-backup.test.cjs`; expect missing-method failures.
- [ ] Implement the minimum one-dataset seams by reusing existing codec, registry, bindings, and normalized error codes.
- [ ] Rerun the identical command; expect all focused tests to pass.
- [ ] Run `npm run test:cxp06`; expect all CXP-06 tests to pass.

### Task 2: Dataset-scoped hosted transaction resume and commit

**Files:**
- Modify: `src/services/CommitService.js`
- Modify: `src/uat/Cxp06UatHarness.js`
- Modify: `src/uat/Cxp06UatContinuation.js`
- Test: `tests/cxp06-commit.test.cjs`
- Test: `tests/cxp06-uat-harness.test.cjs`

**Interfaces:**
- Consumes: checkpoint `{fingerprint, sourceFiles, datasetNames, backupRunId, commitProgress}`, next registered dataset name, one persisted staging dataset.
- Produces: `resumeBackup(context, checkpointData)`, `resumeDataset(context, checkpointData, datasetName)`, and `commitDatasetStep(context, progress)`.

- [ ] Add focused tests proving backup resume performs no staging reads and commit resume reads only the cursor dataset.
- [ ] Add a focused test proving a dataset write is flushed, reread, validated, and checkpointed; an already-matching dataset advances without a write.
- [ ] Run `node --test tests/cxp06-commit.test.cjs tests/cxp06-uat-harness.test.cjs`; expect missing hosted-operation failures.
- [ ] Implement the new transaction seams and expose them through composed UAT operations without removing compatibility callbacks.
- [ ] Rerun the identical command; expect the new and existing focused tests to pass.
- [ ] Run `npm run test:cxp06 npm run test:cxp06:uat` as separate commands; expect both suites to pass.

### Task 3: Cooperative deadline and adaptive step packing

**Files:**
- Modify: `src/uat/Cxp06UatContinuation.js`
- Test: `tests/cxp06-uat-harness.test.cjs`

**Interfaces:**
- Consumes: invocation start clock, persisted maximum phase-step duration, per-step progress.
- Produces: multiple durable backup/commit steps per invocation when safe, otherwise one successor and a persisted cursor.

- [ ] Replace the current mock-only budget test with assertions that two short steps pack into one invocation and a later step is not entered when `elapsed + reserve + margin` reaches 270,000 ms.
- [ ] Run `node --test tests/cxp06-uat-harness.test.cjs`; expect excess/missing executor-call failures.
- [ ] Implement a pure `canStartAnotherStep` decision, update measured phase maxima after each step, persist after every step, and yield only at the budget boundary or phase completion.
- [ ] Keep the recovery watchdog semantically separate from the cooperative deadline and retain successor-first trigger replacement.
- [ ] Rerun `npm run test:cxp06:uat`; expect all continuation lifecycle tests to pass.

### Task 4: Operational evidence, full verification, and deployment

**Files:**
- Modify: `src/uat/Cxp06UatContinuation.js`
- Modify: `docs/cxp06-uat-runbook.md`
- Modify: `docs/decision-log.md`
- Modify: `docs/testing.md`
- Test: `tests/cxp06-uat-harness.test.cjs`

**Interfaces:**
- Consumes: dataset step result and invocation clock.
- Produces: bounded runtime progress logs and updated operator acceptance procedure.

- [ ] Add bounded step-result fields for phase, dataset, duration, elapsed time, next index, and handoff decision; assert serialized logs contain no payload values.
- [ ] Document the 270-second cooperative budget, adaptive packing, dataset-scoped resume, hosted timing evidence, retry/status procedure, and deployment rollback steps.
- [ ] Run `npm run lint`, `npm test`, `npm run guardrails`, and `git diff --check`; expect zero failures.
- [ ] Run `npm run clasp:status`; review the configured project delta and ensure no generated or secret files are included.
- [ ] Run `npm run clasp:push`; expect clasp to report a successful push to the configured Apps Script project.

## Externally Observable Decisions

- The hosted entrypoint names, status names, and existing one-time continuation handler remain unchanged.
- A run may still require a trigger handoff when a measured dataset step cannot safely fit; exact scheduler latency remains outside the application's guarantee.
- Hosted latency acceptance is based on the next controlled UAT run; local fake-service timing is not treated as proof of Apps Script performance.
