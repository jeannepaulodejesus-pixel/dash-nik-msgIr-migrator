# CXP-06 Resumable Pipeline Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move CXP-06 validated staging and locked commit work into separate Apps Script invocations so declared-volume runs do not consume the six-minute limit before commit completes.

**Architecture:** `RunService` will expose preparation and continuation seams while preserving its synchronous `execute()` API. The first hosted invocation completes through `VALIDATING_STAGE`, persists a bounded checkpoint, and schedules a continuation; the second reconstructs the transaction from protected staging sheets, revalidates it, and runs commit/recalculate/health under the existing lock and rollback protocol.

**Tech Stack:** Google Apps Script V8 JavaScript, Script Properties, installable time-driven triggers, Node.js built-in test runner.

## Global Constraints

- Preserve the current synchronous `RunService.execute()` contract and all CXP-06 recovery/fault behavior.
- Never checkpoint inside raw replacement without a durable per-dataset commit journal.
- Persist only bounded metadata; normalized records remain in protected staging sheets.
- Revalidate reconstructed staging data before entering the production lock.
- Use an idempotent continuation trigger plus a delayed watchdog and remove both at terminal completion or handled failure.
- Treat four minutes as the normal yield budget for hosted Apps Script work.

---

### Task 1: Preparation and resumed-run orchestration

**Files:**
- Modify: `src/ingestion/RunService.js`
- Modify: `src/ingestion/RunStateMachine.js`
- Test: `tests/cxp04-run-orchestration.test.cjs`

**Interfaces:**
- Consumes: existing request, operation map, and run services.
- Produces: `RunService.prepare(request, operations, services)` and `RunService.resume(checkpoint, operations, services)`; `execute()` remains synchronous.

- [ ] Add a focused test proving preparation stops after `validateStage`, emits no success audit record, and produces a bounded checkpoint.
- [ ] Run `node --test tests/cxp04-run-orchestration.test.cjs` and observe the missing-method assertion fail.
- [ ] Implement state-history restoration, preparation, and resumed locked completion without duplicating failure-audit logic.
- [ ] Rerun the focused test and existing CXP-04 suite to green.

### Task 2: Rehydrate the commit transaction from protected staging

**Files:**
- Modify: `src/repository/StagingRepository.js`
- Modify: `src/services/CommitService.js`
- Test: `tests/cxp06-commit.test.cjs`
- Test: `tests/cxp06-staging.test.cjs`

**Interfaces:**
- Consumes: checkpoint fingerprint/source-file metadata and persisted staging matrices.
- Produces: `commitOperations.resume(context, checkpointData)` which reconstructs normalized payloads, validates all five datasets, and restores duplicate/ledger inputs.

- [ ] Add a focused failing test proving a new CommitService instance can resume from persisted staging and commit successfully without reparsing source files.
- [ ] Run the focused CXP-06 commit/staging tests and record the missing resume seam.
- [ ] Decode persisted staging matrices into canonical payloads, validate them, and initialize transaction fingerprint/source files.
- [ ] Rerun focused and existing transaction/recovery tests.

### Task 3: Hosted checkpoint, continuation, and watchdog

**Files:**
- Create: `src/uat/Cxp06UatContinuation.js`
- Modify: `src/uat/Cxp06UatHarness.js`
- Modify: `src/main/Cxp06UatEntrypoints.js`
- Test: `tests/cxp06-uat-harness.test.cjs`

**Interfaces:**
- Consumes: Script Properties, ScriptApp, LockService, hosted CXP-06 dependencies, and RunService preparation/resume results.
- Produces: a `RUNNING` result after preparation, `continueCxp06UatPipeline()` for the fresh commit invocation, and a sanitized status entrypoint.

- [ ] Add a focused failing hosted test proving the first invocation stops before commit, persists the checkpoint, and leaves exactly one continuation trigger.
- [ ] Implement bounded checkpoint serialization, target/scenario validation, trigger deduplication, pre-work watchdog, continuation completion, and terminal cleanup.
- [ ] Add failure-path coverage proving resumable state is retained without replaying source parsing and synchronous injected tests remain unchanged.
- [ ] Run `npm run test:cxp06:uat` and the complete CXP-06 focused suite.

### Task 4: Operational contract and verification

**Files:**
- Modify: `docs/cxp06-uat-runbook.md`
- Modify: `docs/transactional-raw-replacement-contract.md`
- Modify: `docs/decision-log.md`
- Modify: `docs/packet-status.md`
- Modify: `docs/testing.md`

**Interfaces:**
- Consumes: implemented status/continuation contract and fresh test evidence.
- Produces: operator instructions and an accepted architectural decision covering execution budgeting.

- [ ] Document first-invocation `RUNNING`, continuation/status checks, checkpoint cleanup, and the remaining single-commit runtime boundary.
- [ ] Run `npm run verify` and require syntax, full tests, and guardrails to pass.
- [ ] Run `git diff --check` and review the complete diff for unrelated changes.

## Unresolved externally observable decisions

- None. Existing UAT safety gates, rollback semantics, and audit outputs remain authoritative; continuation changes execution shape only.
