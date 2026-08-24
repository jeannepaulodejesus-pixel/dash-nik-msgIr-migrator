# CXP-06 Controlled Backup-Topology Seeder Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the four blocked Case 05 hosted UAT entrypoints to seed deterministic backup topologies safely and exercise the unchanged production reconciliation behavior.

**Architecture:** Add a UAT-only topology-seeder module and invoke it through an optional `CommitService` pre-reconciliation hook. The hook runs inside the existing production script lock; ordinary production runs do not provide it. The seeder refuses dirty starting state, uses `BackupRepository.createGroup()` for verified copies, and performs only the minimum controlled sheet or ledger mutation required by each topology.

**Tech Stack:** Google Apps Script-compatible JavaScript, Node.js 22 test runner, `@google/clasp` deployment tooling.

## Global Constraints

- The seeder is reachable only after the existing `DEV`/`UAT` and `CXP_UAT_ENABLED=true` harness gate succeeds.
- Seeding must occur once, under the production script lock, immediately before reconciliation.
- Any existing or malformed `_CXP06_BAK_*` topology causes fail-closed refusal without mutation.
- Complete groups must be created through `BackupRepository.createGroup()`; the seeder must not duplicate backup copy, protection, or verification logic.
- Seed run IDs must use a valid, unique `UATSEED_<scenario-token>_<unique-token>` form and remain within the Google Sheets name limit.
- Partial seeding failures retain created backup evidence; no speculative cleanup is allowed.
- The seeder never mutates raw sheets or exposes cell values, formulas, file IDs, or workbook contents in errors or evidence.
- The ambiguous two-complete-group scenario intentionally retains both groups and must fail through production reconciliation with `MIGRATION_RECOVERY_FAILED`.
- Existing user changes in the dirty worktree must be preserved. No commit is authorized by the request; implementation remains uncommitted unless the user separately approves a commit.

---

### Task 1: Implement the isolated topology-seeder contract

**Files:**
- Create: `src/uat/Cxp06BackupTopologySeeder.js`
- Modify: `src/monitoring/ErrorCodes.js`
- Create: `tests/cxp06-uat-topology-seeder.test.cjs`

**Interfaces:**
- Consumes: `Cxp06BackupTopologySeeder.create({ backupRepository, ledgerRepository, targetSpreadsheet, now, uniqueToken })`
- Consumes production repository methods: `backupRepository.discoverGroups()`, `backupRepository.createGroup(runId)`, `ledgerRepository.append(records)`, and `ledgerRepository.findSuccessfulByRunId(runId)`.
- Produces: `seeder.seed(scenario) -> Object.freeze({ groupCount, runIds, scenario, sheetNames })`.
- Produces error code: `UAT_BACKUP_TOPOLOGY_SEED_FAILED`, categorized as `MIGRATION_CALCULATION`, with a generic message and sanitized reason metadata.

- [ ] **Step 1: Add the focused failing tests**

Add one test per declared topology through the public `create(...).seed(scenario)` seam:

- `CASE5_INCOMPLETE_BACKUP` calls `createGroup()` once, resolves the five returned sheet references, deletes exactly the Offered, AHT, Auxes, and Staff sheets by object reference, and leaves the Handled sheet.
- `CASE5_COMPLETE_UNSUCCESSFUL_BACKUP` calls `createGroup()` once and performs no ledger append or sheet deletion.
- `CASE5_SUCCESSFUL_LEFTOVER_BACKUP` calls `createGroup()` once, appends one minimal SUCCESS record whose `runId` matches the group, and refuses to return unless `findSuccessfulByRunId()` confirms that same run ID and `result: 'SUCCESS'`.
- `CASE5_TWO_COMPLETE_UNSUCCESSFUL_BACKUPS` calls `createGroup()` twice with distinct run IDs and performs no ledger append.
- Existing discovery results, malformed discovery, unsupported scenarios, invalid/duplicate token output, missing dependency methods, ledger readback mismatch, and partial backup creation errors all throw `UAT_BACKUP_TOPOLOGY_SEED_FAILED` without deleting existing or newly created evidence.
- Assert returned summaries contain only scenario, run IDs, group count, and generated backup sheet names—not matrices, file IDs, or ledger source metadata.

- [ ] **Step 2: Verify the relevant failure**

Run: `node --test tests/cxp06-uat-topology-seeder.test.cjs`

Expected: non-zero exit because `src/uat/Cxp06BackupTopologySeeder.js` and `UAT_BACKUP_TOPOLOGY_SEED_FAILED` do not exist; the failure must be module/contract absence rather than test syntax or fixture setup.

- [ ] **Step 3: Implement the minimum behavior**

Define the new catalog entry and implement an Apps Script-compatible IIFE/module following existing repository conventions. Validate only the declared dependency methods and four exact scenario constants. Normalize the injected unique token to `[A-Za-z0-9_-]`, reject an empty/overlong token, prefix it with the short scenario token (`INC`, `UNFIN`, `SUCCESS`, or `AMBIG`), and verify no generated run ID already exists.

At the start of `seed`, call `discoverGroups()` exactly once and reject any non-empty result before calling `createGroup`, `append`, or `deleteSheet`. For incomplete topology, use the returned group references to resolve and delete the four exact non-Handled sheets; never search or delete with a wildcard. For successful-leftover topology, append a synthetic ledger record with `fingerprintAlgorithm: 'UAT-SEED'`, empty source arrays, schema `1.0.0`, and injected UTC time, then confirm it by run ID. Normalize every setup failure to the new generic code with allowlisted reasons only.

- [ ] **Step 4: Verify the focused pass**

Run: `node --test tests/cxp06-uat-topology-seeder.test.cjs`

Expected: zero exit; all topology, refusal, partial-failure, and sanitization tests pass.

- [ ] **Step 5: Run the affected integration check**

Run: `node --test tests/cxp06-raw-backup.test.cjs tests/cxp06-rollback.test.cjs tests/cxp06-uat-topology-seeder.test.cjs`

Expected: zero exit with existing backup/recovery behavior unchanged and all seeder tests passing.

### Task 2: Add the locked pre-reconciliation extension seam

**Files:**
- Modify: `src/services/CommitService.js`
- Modify: `tests/cxp06-commit.test.cjs`
- Modify: `tests/cxp04-run-orchestration.test.cjs`

**Interfaces:**
- Consumes optional service callback: `beforeReconcile({ backupRepository, ledgerRepository, targetSpreadsheet })`.
- Preserves: `CommitService.createOperations(services)` and the returned five operation callbacks.
- Produces no new production callback when `beforeReconcile` is absent.

- [ ] **Step 1: Add the focused failing tests**

Add a commit test asserting an injected `beforeReconcile` callback runs exactly once before `rollbackService.reconcile()` and receives the actual internal backup repository plus the configured ledger repository and target spreadsheet. Add a no-hook test proving the ordinary commit sequence is unchanged. Extend the real `RunService` composition test to record `LOCK_ACQUIRED -> BEFORE_RECONCILE -> RECONCILE`, demonstrating that the seam executes under the held script lock.

- [ ] **Step 2: Verify the relevant failure**

Run: `node --test --test-name-pattern="beforeReconcile|pre-reconciliation" tests/cxp06-commit.test.cjs tests/cxp04-run-orchestration.test.cjs`

Expected: non-zero exit because the callback is not invoked; existing commit/reconcile behavior otherwise reaches its normal assertions.

- [ ] **Step 3: Implement the minimum behavior**

In `CommitService.commit(context)`, after `requireTransaction()` and immediately before `rollbackService.reconcile()`, call `dependencies.beforeReconcile(...)` only when it is a function. Pass an immutable context containing the internal backup repository, configured ledger repository, and target spreadsheet. Do not catch or reinterpret the callback error in `CommitService`; `RunService` must record it through the existing `COMMITTING` failure path.

- [ ] **Step 4: Verify the focused pass**

Run: `node --test --test-name-pattern="beforeReconcile|pre-reconciliation" tests/cxp06-commit.test.cjs tests/cxp04-run-orchestration.test.cjs`

Expected: zero exit; hook ordering and no-hook behavior pass.

- [ ] **Step 5: Run the affected integration check**

Run: `node --test tests/cxp06-commit.test.cjs tests/cxp04-run-orchestration.test.cjs tests/cxp06-failures.test.cjs`

Expected: zero exit with rollback, error taxonomy, and existing commit ordering unchanged.

### Task 3: Wire Case 05 scenarios through the hosted UAT harness

**Files:**
- Modify: `src/uat/Cxp06UatHarness.js`
- Modify: `tests/cxp06-uat-harness.test.cjs`
- Test: `tests/cxp06-uat-topology-seeder.test.cjs`

**Interfaces:**
- Consumes: `Cxp06BackupTopologySeeder.create(dependencies).seed(scenario)` from Task 1.
- Consumes: optional `commitServices.beforeReconcile(context)` from Task 2.
- Produces executable behavior for the four existing parameterless Case 05 entrypoints; their exported names remain unchanged.

- [ ] **Step 1: Add the focused failing tests**

Replace the current “unimplemented recovery-seeding scenarios fail closed” test with assertions that all four scenario names pass executable-scenario validation and reach orchestration only after the safety gate. Add tests showing:

- unsafe properties fail before the seeder is constructed;
- ordinary Case 01–04, cleanup-failure, preflight, and reader-visibility scenarios never construct or invoke the seeder;
- each topology scenario installs one `beforeReconcile` callback using the hosted target spreadsheet, ledger repository, and injected unique-token provider;
- invoking the callback twice seeds only once or fails before a second mutation;
- a seeder error becomes the run's `COMMITTING` failure and the sanitized evidence exposes only `UAT_BACKUP_TOPOLOGY_SEED_FAILED`;
- the two-complete-group integration double reaches production reconciliation and returns `MIGRATION_RECOVERY_FAILED`, retaining two groups;
- the other three topology doubles allow their documented reconciliation action before the new run continues.

- [ ] **Step 2: Verify the relevant failure**

Run: `node --test --test-name-pattern="topology|CASE5_(INCOMPLETE|COMPLETE|SUCCESSFUL|TWO)" tests/cxp06-uat-harness.test.cjs tests/cxp06-uat-topology-seeder.test.cjs`

Expected: non-zero exit because the harness still rejects the four scenarios as unimplemented and does not install the callback.

- [ ] **Step 3: Implement the minimum behavior**

Add a resolver for `Cxp06BackupTopologySeeder`, move the four names into the executable scenario allowlist, and identify topology scenarios with one exact helper. After the safety gate and hosted dependency construction, install `commitServices.beforeReconcile` only for those scenarios. The callback constructs the seeder from the hook context, target spreadsheet, hosted/injected clock, and hosted/injected UUID provider, then calls `seed(scenario)` exactly once. Preserve all existing fault decorators when composing `commitServices`.

Use `Utilities.getUuid()` for hosted uniqueness, stripping unsupported characters; require an injected `uniqueToken` in deterministic tests. Do not seed in `PREFLIGHT`, before staging, or outside `CommitService.commit()`.

- [ ] **Step 4: Verify the focused pass**

Run: `node --test --test-name-pattern="topology|CASE5_(INCOMPLETE|COMPLETE|SUCCESSFUL|TWO)" tests/cxp06-uat-harness.test.cjs tests/cxp06-uat-topology-seeder.test.cjs`

Expected: zero exit; all four scenarios are executable, gated, one-shot, and correctly mapped.

- [ ] **Step 5: Run the affected integration check**

Run: `npm run test:cxp06:uat && node --test tests/cxp06-commit.test.cjs tests/cxp06-rollback.test.cjs`

Expected: zero exit with all UAT entrypoints exported and existing fault-injection scenarios preserved.

### Task 4: Document, verify, and prepare the hosted handoff

**Files:**
- Modify: `docs/cxp06-uat-harness.md`
- Modify: `docs/cxp06-uat-runbook.md`
- Modify: `docs/packet-status.md`
- Modify: `tests/cxp06-packet-status.test.cjs`

**Interfaces:**
- Documents the unchanged parameterless entrypoints in `src/main/Cxp06UatEntrypoints.js`.
- Documents operational ordering, dirty-workbook refusal, expected retained evidence, and hosted execution order.

- [ ] **Step 1: Add the focused failing documentation test**

Update the packet-status test to require the controlled seeder, the four topology outcomes, the clean-start refusal, and the instruction that `CASE5_TWO_COMPLETE_UNSUCCESSFUL_BACKUPS` runs last or requires authorized manual cleanup afterward.

- [ ] **Step 2: Verify the relevant failure**

Run: `node --test tests/cxp06-packet-status.test.cjs`

Expected: non-zero exit because current documentation still says topology seeding is blocked.

- [ ] **Step 3: Update operational documentation**

Replace “blocked/unimplemented” language in the harness guide with the controlled-seeder contract. In the runbook, require a clean isolated target before each topology case, record expected `RUN_LOG`/`ERROR_LOG` outcomes, and place the ambiguous two-group scenario last. State explicitly that retained groups are recovery evidence and must not be deleted until investigated. Update packet status to distinguish locally implemented seeding from still-pending hosted evidence.

- [ ] **Step 4: Verify the focused pass**

Run: `node --test tests/cxp06-packet-status.test.cjs`

Expected: zero exit with the operational contract represented in durable documentation.

- [ ] **Step 5: Run complete verification**

Run: `npm run verify`

Expected: syntax checks, the complete Node test suite, and repository guardrails all exit zero without hidden skips or warnings. Then run `git diff --check`; expected: zero exit and no whitespace errors.

- [ ] **Step 6: Prepare deployment without performing it**

Run: `npm run clasp:status`

Expected: the new seeder and modified Apps Script files appear in the configured deployment set. Do not run `npm run clasp:push` until the user explicitly approves that external write after reviewing verification results.

## Unresolved Product Decisions

None. The approved design fixes the overwrite policy (refuse dirty workbooks), partial-failure semantics (retain evidence), output channel (existing run/error logs plus sanitized harness evidence), and ambiguous-recovery behavior (fail closed and retain both groups).
