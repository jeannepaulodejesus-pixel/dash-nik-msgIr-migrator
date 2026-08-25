# CXP-06 Incremental Commit Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every hosted CXP-06 invocation below Apps Script's six-minute limit by creating and verifying one raw backup dataset per continuation before a fresh final commit.

**Architecture:** Backup sheet existence is the durable journal: each continuation discovers the run-scoped group, creates at most one missing dataset backup, verifies it against its raw source, and schedules the next continuation. Once all five backups exist, the final invocation reconstructs staging, adopts and revalidates the complete backup group under the production lock, replaces raw, flushes, health-checks, confirms SUCCESS, and cleans the group through the existing transaction tail.

**Tech Stack:** Google Apps Script JavaScript, Script Properties, time-driven triggers, Node.js `node:test` fakes.

## Global Constraints

- Never attempt to raise or bypass the platform quota; checkpoint and resume instead.
- PROD remains blocked from UAT entrypoints.
- No raw sheet may be mutated until all five run-scoped backups are complete and verified.
- A timeout after a backup copy must be retry-safe through backup-sheet discovery.
- SUCCESS is recorded only after all five raw datasets, flush, health validation, and ledger confirmation complete.
- Existing synchronous `RunService.execute()` behavior and fault/rollback cases remain supported.

---

### Task 1: Incremental verified backup repository

**Files:**
- Modify: `src/repository/BackupRepository.js`
- Test: `tests/cxp06-backup.test.cjs`

**Interfaces:**
- Consumes: `create(spreadsheet, services)`, run ID, existing run-scoped backup sheets.
- Produces: `createGroupStep(runId)` returning `{complete, createdDatasetName, group}` and `verifyGroup(group)` returning the verified complete group.

- [ ] Add a failing test proving each call creates at most one missing backup, resumes from discovered sheets, and the fifth call returns a complete group.
- [ ] Run `node --test tests/cxp06-backup.test.cjs` and observe the missing-interface failure.
- [ ] Refactor existing copy/protect/compare logic into one-dataset creation and complete-group verification without weakening formulas/protection checks.
- [ ] Re-run the focused test and affected rollback tests.

### Task 2: Commit operations adopt a prepared backup group

**Files:**
- Modify: `src/services/CommitService.js`
- Test: `tests/cxp06-commit.test.cjs`

**Interfaces:**
- Consumes: checkpoint data `{fingerprint, sourceFiles, backupRunId?}`.
- Produces: `backupStep(context)` and resume/commit behavior that adopts the exact complete group and skips duplicate backup creation.

- [ ] Add a failing test proving repeated fresh operation instances create one backup per call and final commit creates no sixth backup.
- [ ] Run the focused test and observe `backupStep` missing.
- [ ] Implement first-step reconciliation, per-step duplicate/raw preflight, complete-group adoption, and final in-lock verification.
- [ ] Re-run commit, rollback, and recovery suites.

### Task 3: Hosted controller schedules one backup step per invocation

**Files:**
- Modify: `src/uat/Cxp06UatContinuation.js`
- Modify: `src/uat/Cxp06UatHarness.js`
- Test: `tests/cxp06-uat-harness.test.cjs`

**Interfaces:**
- Consumes: executor `backup(state)` result `{complete, createdDatasetName}`.
- Produces: public status `BACKING_UP`, five resumable backup continuations, then `COMMIT_PENDING` and a separate final commit continuation.

- [ ] Add a failing hosted test asserting no invocation performs more than one backup step and commit occurs only on the seventh continuation (five backup steps plus final commit scheduling boundary).
- [ ] Implement controller state transitions, trigger replacement, checkpoint `backupRunId`, and timeout-safe rediscovery.
- [ ] Preserve FAILED/COMPLETE cleanup and same-scenario retry behavior.
- [ ] Run `npm run test:cxp06:uat`.

### Task 4: Operator contract and complete verification

**Files:**
- Modify: `docs/cxp06-uat-runbook.md`
- Modify: `docs/decision-log.md`
- Modify: `docs/transactional-raw-replacement-contract.md`

**Interfaces:**
- Consumes: controller statuses and hosted entrypoints.
- Produces: exact deployment/rerun/status evidence procedure.

- [ ] Document `BACKING_UP`, one-dataset progress, final commit, retry semantics, and no-SUCCESS partial state.
- [ ] Run `npm run lint`, `npm test`, `npm run guardrails`, and `git diff --check`; require zero failures.

## Externally Observable Decisions

- Backup progress is exposed only as bounded dataset/status metadata; no cell values enter Script Properties or logs.
- A partial backup group is retained across timeouts and belongs exclusively to its run ID.
- Hosted verification remains required because local fakes cannot measure Google server-side copy latency.

