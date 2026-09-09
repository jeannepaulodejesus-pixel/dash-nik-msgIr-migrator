# CXP-14 Performance Hardening, UAT, Cutover, and Production Runbook Plan

**Status:** Revised latency, verification, and reliability implementation completed locally on 2026-09-09. Hosted UAT, final parity, production authorization, cutover, and observation remain open; this plan does not authorize a PROD push or PROD Script Property changes.

**Dependencies:** CXP-00 through CXP-13 are complete. CXP-13 is accepted as `CXP-13-v1`; its separate hosted UAT rehearsal was intentionally deferred to this packet.

**Authorities:** [`CODEX_HANDOFF.md`](../../CODEX_HANDOFF.md) · [`docs/packet-status.md`](../packet-status.md) · [`docs/cxp13-hosted-uat-results-2026-09-06.md`](../cxp13-hosted-uat-results-2026-09-06.md) · [`docs/cxp13-uat-runbook.md`](../cxp13-uat-runbook.md)

## Goal

Prove the completed migration is operationally safe at expected and declared-maximum volumes, execute the missing separate UAT rehearsal, complete final parity and business validation, and hand over an approval-bound production deployment with tested rollback and support procedures.

CXP-14 is a release-hardening packet. It must not introduce new reporting features or change metric definitions to make validation pass.

## Release decision

Execute CXP-14 as one non-parallel packet with four ordered gates:

1. **Instrument and baseline** the existing critical path without changing its business behavior.
2. **Prove performance and recovery in hosted UAT** using the production path and bounded evidence.
3. **Rehearse cutover and rollback** against UAT configuration and a disposable weekly workbook.
4. **Promote only an immutable, signed-off release candidate** and observe the first production cycles before closing the packet.

Any failure returns the packet to the owning gate. Performance changes require focused regression and a repeat of every affected hosted scenario; metric or scope changes require a separate decision and are not absorbed into CXP-14.

## Non-negotiable execution boundary

All long-running setup, benchmark, parity, recovery, and cutover checks must preserve the boundary already used by CXP-06 and CXP-13:

- 270,000 ms cooperative invocation budget.
- 60,000 ms minimum next-step reserve.
- 15,000 ms handoff margin.
- Durable checkpoint and bounded cursor before every handoff.
- At most one successor trigger per handler; create the successor before deleting older duplicates.
- 420,000 ms recovery-only watchdog for long phases.
- 90,000 ms contention backoff without converting a resumable run into a terminal failure.
- Script lock held across production writes, recalculation, health readback, and flush as required by the existing transaction contract.
- Terminal completion removes continuation and watchdog triggers.
- A replayed continuation adopts already-durable work and never duplicates raw replacement, audit rows, evidence rows, or parity chunks.

The hard gate remains `maxInvocationMs < 270000` with zero Apps Script timeouts or quota failures. CXP-14 should target `maxInvocationMs < 240000` to retain 30 seconds of operational headroom, but the controller must continue to hand off at the established 270-second boundary rather than bypass it.

Report individual invocation duration separately from scheduler-inclusive end-to-end duration. A fast `SpreadsheetApp.flush()` on a warm workbook is not evidence that the complete hourly workflow meets its window.

## Preserve predecessor setup and entrypoint practice

Add a versioned, resumable release-readiness setup surface that follows CXP-11 through CXP-13:

- `initializeCxp14ReleaseReadiness()`
- `continueCxp14ReleaseReadinessSetup()`
- `getCxp14ReleaseReadinessSetupStatus()`
- `resetCxp14ReleaseReadinessSetupState()`
- `diagnoseCxp14RunbookChecks()`

Use `CXP14_RELEASE_SETUP_STATE_V1` with `IDLE`, `RUNNING`, `COMPLETE`, and `FAILED`. Persist the contract version, next step, step count, bounded timestamps, and sanitized error code. Refuse reset while `RUNNING`; fail closed on an unknown version or malformed cursor. Setup is idempotent and must not clear live workbook data, rewrite formulas, retarget an environment, or alter permissions.

Add parameterless, zero-padded hosted helpers in `src/main/Cxp14UatEntrypoints.js`:

| Step | Entrypoint | Gate |
|---|---|---|
| 00 | `CXP14UatStep00VerifyPrerequisites` | CXP-00–13 complete; immutable release candidate recorded; UAT only; validators, support owner, operational window, and rollback authority identified |
| 01 | `CXP14UatStep01InstallReleaseReadiness` | Setup reaches `COMPLETE`; evidence contracts, configuration inventory, protections, and restricted-access checks are present |
| 02 | `CXP14UatStep02InspectCriticalPaths` | Critical reads/writes are bulk and bounded; service-call counters and privacy allowlist are active; no row-dependent Spreadsheet service loop is found |
| 03 | `CXP14UatStep03BenchmarkExpectedPeak` | Three successful combined hourly UAT runs at the expected-peak profile meet boundary and operational-window gates |
| 04 | `CXP14UatStep04StressDeclaredMaximum` | One declared-maximum stress run completes without timeout, quota failure, duplicate continuation, or row/formula corruption |
| 05 | `CXP14UatStep05VerifyFailureRecovery` | Required negative, contention, interruption, rollback, audit, and cleanup scenarios reach their documented safe states |
| 06 | `CXP14UatStep06VerifyLifecycleAndStatus` | CXP-12 rollover/health and the full CXP-13 UAT intake/status path pass together on the same UAT environment |
| 07 | `CXP14UatStep07RunFinalParityAndValidation` | A real operator-recalculated weekly Excel export matches the successful source fingerprint; all five datasets and 25 metrics are reconciled; delivery and business validation are recorded |
| 08 | `CXP14UatStep08PromotionGate` | Every prior gate, deployment checklist, rollback rehearsal, permission check, and explicit PROD acknowledgment is true; `missing: []`, `promotionReady: true` |

A helper may start a long phase and return `QUEUED` or a nonterminal status. The documented continuation worker must finish that phase; the next numbered helper only reconciles terminal evidence. No editor entrypoint may spin until a hosted job finishes.

All UAT helpers must refuse `CXP_ENV=PROD`. Production cutover remains a separately approved runbook action; no UAT helper may push source, retarget PROD, or weaken protections.

## Performance evidence contract

### Workload profiles

| Profile | Handled | Offered | AHT | Auxes | Staff | Total rows | Purpose |
|---|---:|---:|---:|---:|---:|---:|---|
| Expected peak | 5,000 | 5,000 | 7,000 | 3,000 | 300 | 20,300 | Hourly operational acceptance |
| Declared maximum | 10,000 | 10,000 | 15,000 | 7,500 | 2,000 | 44,500 | Schema-envelope stress and recovery evidence |

Use synthetic, non-personal UAT sources for performance and failure injection. Final parity uses the approved real weekly export outside the repository and persists only hashes, counts, classifications, and sanitized aggregate evidence.

### Measures

Capture the following for every invocation and aggregate them by logical run:

- phase and dataset, start/end UTC, duration, cumulative active duration, and scheduler-inclusive duration;
- row counts by dataset and packaging kind;
- Spreadsheet, Drive, Properties, Lock, Trigger, and flush call counts by bounded operation class;
- preparation, backup, per-dataset commit, recalculation, health-readback, rollback, cleanup, and parity durations;
- continuation count, contention count, watchdog recovery count, and maximum observed step duration;
- terminal run state, audit state, health result, cleanup state, and parity summary;
- active Week Key alignment and last-known-good preservation boolean.

Evidence must never include IDs, emails, filenames, source rows, cell values, formulas, or direct/indirect personal identifiers. Persist only bounded enums, booleans, counts, durations, digests, and non-sensitive metric summaries already permitted by the parity contract.

### Proposed performance gates

The packet owner must accept the numeric operational window before Step 03. Use these evidence-backed defaults unless the owner records a different stricter or looser value with rationale:

- **Expected peak:** three consecutive successful UAT runs, each `<= 10 minutes` scheduler-inclusive from accepted start to terminal `SUCCESS`. The earlier 20-minute window remains an absolute failure ceiling, not a passing Step 03 objective.
- **Invocation objective:** every invocation `< 240000 ms`; **hard failure** at `>= 270000 ms`, timeout, or quota error.
- **Declared maximum:** one 44,500-row stress run completes `<= 30 minutes` with the same correctness, recovery, and boundary invariants. This is a stress objective, not permission to exceed the agreed hourly source volume.
- **Recalculation:** health becomes ready within the accepted total run window and no bounded report/calc error scan regresses.
- **Service calls:** counts remain a function of phase/dataset/chunk count, not source row count. Expected-peak and declared-maximum runs must not show per-row call growth.
- **Automated recovery:** a recoverable interruption resumes to a terminal safe state within 15 minutes after the recovery worker first runs; otherwise the runbook escalates to manual hold/rollback.

The prior 44,500-row CXP-06 evidence (16m 00.749s end-to-end; 204.372s longest invocation) is a baseline, not an automatic CXP-14 pass. CXP-14 must measure the complete CXP-13 intake-to-report path in UAT.

## Implementation workstreams

### 1. Freeze the release contract and evidence model

- Add `docs/cxp14-release-contract.md` defining profiles, timing semantics, service-call classes, gates, redaction, approval roles, go/no-go rules, and release version identity.
- Add pure evidence builders/validators under `src/release/`; reject incomplete, non-integer, negative, unbounded, or privacy-unsafe records.
- Add distinct versioned state for setup, active performance run, UAT evidence, and cutover status so a stale predecessor cursor cannot resume CXP-14 work.
- Record the release commit/version and source-bundle digest, never credentials or environment IDs.

### 2. Instrument without changing business behavior

- Count boundary calls through existing injected service/repository seams; do not add a second ingestion path.
- Emit one bounded record per meaningful phase/dataset decision rather than per row.
- Add deterministic tests proving call counts remain constant or chunk-bounded as row counts increase.
- Add a repository guard that flags direct `getValue`/`setValue` or row-wise `getRange` loops in the named critical-path modules. Allow exceptions only with an evidence-backed decision.

### 3. Build CXP-14 setup and UAT orchestration

- Implement the setup/status/continue/reset/diagnostic surfaces listed above.
- Implement `CXP14UatStep00`–`08` as thin orchestration and reconciliation entrypoints over production services.
- Reuse CXP-06 failure seams, CXP-11 parity state, CXP-12 lifecycle/health checks, and CXP-13 intake/status controller instead of cloning their logic.
- Persist `CXP14_UAT_EVIDENCE_V1` through a strict allowlisted recorder; a promotion predicate must name every missing or failed gate safely.

### 4. Execute performance and boundary verification

- Run expected-peak cold/warm/repeat success cycles as three independent source bundles.
- Run one declared-maximum combined ingestion.
- Exercise exact boundary decisions locally at 269,999 ms and 270,000 ms and hosted handoff behavior under slow/cold operations.
- Prove one successor, resumable cursor adoption, audit idempotency, terminal trigger cleanup, ACTIVE-target revalidation, and no finalization replay.
- Diagnose first, then optimize only measured bottlenecks. Keep bulk reads/writes, formula anchors, and metric semantics unchanged.

### 5. Execute the complete failure and recovery matrix

At minimum, cover:

- duplicate content under the same and a different filename;
- missing dataset, missing header, reordered valid headers, and unexpected critical header change;
- empty dataset and invalid date, interval, site, or queue value;
- concurrent refresh, lock contention, mid-staging interruption, mid-commit failure, health failure, verified rollback, and rollback failure retention;
- stale-data alert, weekly rollover, re-initialization safety, orphan continuation cleanup, temporary-file cleanup on success/failure, and ambiguous backup topology;
- web authorization/domain rejection, restricted-sharing verification, public status redaction, and RUN_LOG/status reconciliation.

Every invalid or failed submission must prove that the last known good operational dataset remains usable. Every terminal attempt must have exactly one logical RUN_LOG record and the appropriate idempotent ERROR_LOG/FILE_LEDGER evidence.

### 6. Complete hosted UAT, parity, and validation

- Repeat the complete CXP-13 runbook in a distinct UAT deployment and capture the final restricted-sharing/domain configuration independently.
- Run CXP-12 weekly rollover and post-rollover health on the same UAT release candidate.
- Run CXP-11 using an operator-recalculated weekly Excel export whose source fingerprint matches a successful ingestion.
- Require all five datasets and all 25 operational metrics, zero open/unexplained critical deltas, the current WB0817 1,885-error baseline, and no migration-defect suppression.
- Produce separate delivery/output validation and final business validation records using the validator roles named in the project handoff; reconfirm the current people at Step 00 rather than silently assuming the 2026-08-21 assignments are unchanged.

### 7. Rehearse cutover and rollback in UAT

- Freeze the release candidate and export a sanitized inventory of environment-key names, trigger kinds, protection roles, deployment identity, and active Week Key.
- Define and test a least-privilege role-to-capability matrix covering RTA intake/status, deployment/configuration, support diagnostics, delivery validation, business validation, and emergency rollback. Verify the effective hosted identity for every role; normal RTAs and validators must not edit backend/control data or change deployment/configuration.
- Rehearse configuration-only promotion with no source edit and no committed IDs.
- Create a secure, operator-owned, out-of-repository backup of the exact prior configuration values and deployed version. Rehearse disabling new starts, waiting for or safely resolving an active run, restoring that version/configuration pointer, verifying the restored values, reconciling retained backups, and rerunning health/parity smoke checks.
- Measure rollback/recovery time and identify the operator, approver, support owner, escalation channel, and stop authority.

### 8. Perform approval-bound production cutover

The production runbook must make the sequence explicit:

1. Confirm Step 08 `promotionReady: true`, immutable release version, approvals, backup/rollback point, restricted sharing, and support coverage.
2. Hold new intake and verify no active nonterminal run.
3. Snapshot sanitized configuration names/status, active registry alignment, trigger kinds, and protections for the release record; separately store the exact prior configuration values and deployed version in the approved operator-controlled location outside the repository, then verify that backup is readable by the rollback operator.
4. Set PROD Script Properties through the approved operator boundary and configure the local clasp target without committing IDs.
5. Push the exact release candidate only after explicit approval.
6. Run read-only prerequisites, setup/health/protection/effective-identity checks, then process the next approved real production hourly bundle as the canary. Never load a synthetic canary into the live ACTIVE workbook. If a real production canary is not authorized, prove the deployment first against an isolated disposable target, restore and verify the live configuration pointer, and keep live cutover blocked.
7. Reconcile RUN_LOG, FILE_LEDGER, status UI, recalculation health, and bounded parity smoke evidence.
8. Reopen intake and observe the first two operational hourly cycles; keep rollback authority and heightened monitoring for 24 hours.
9. Close only after delivery and business validators sign off and no rollback trigger is active.

Immediate rollback triggers include any timeout/quota error, unexplained critical parity delta, audit gap, ACTIVE-target mismatch, permission/protection failure, duplicate continuation writer, or evidence that a bad submission changed the last-known-good dataset.

## Required deliverables

- `docs/cxp14-release-contract.md`
- `docs/cxp14-uat-harness.md`
- `docs/cxp14-uat-runbook.md`
- `docs/cxp14-hosted-uat-results-template.md` and dated UAT result
- `docs/cxp14-performance-report-template.md` and final performance report
- `docs/cxp14-production-runbook.md`
- `docs/cxp14-permissions-matrix.md`
- `docs/cxp14-deployment-checklist.md`
- `docs/cxp14-rollback-checklist.md`
- dated final CXP-11 parity report for the release candidate
- `docs/cxp14-release-notes.md`
- `src/main/Cxp14Setup.js`, `src/main/Cxp14UatEntrypoints.js`, focused release/evidence modules, and `tests/cxp14-release-readiness.test.cjs`
- `package.json` script `test:cxp14`
- final `docs/packet-status.md`, `docs/decision-log.md`, configuration/testing documentation, and completion handoff updates

## Verification sequence

1. Add focused failing tests for each CXP-14 contract before implementation.
2. Run `npm run test:cxp14` after every release-readiness change.
3. Run affected predecessor suites: `test:cxp06`, `test:cxp11`, `test:cxp12`, and `test:cxp13`.
4. Run `npm run verify` and `git diff --check` before the release candidate is frozen.
5. Execute hosted UAT Steps 00–08 in order and attach sanitized evidence.
6. Repeat affected hosted gates after any performance fix, boundary change, permission change, or release-candidate commit change.
7. Do not mark CXP-14 complete until production observation, validation sign-off, exact deployed version, rollback point, ownership, limitations, and open risks are recorded.

## Packet acceptance

- [x] CXP-14 setup is versioned, idempotent, resumable, status-readable, and refuses unsafe reset.
- [x] Step00–08 entrypoints are parameterless, UAT-only, boundary-safe, and promotion fails closed with explicit missing gates.
- [ ] Three expected-peak runs and one declared-maximum run meet the accepted timing, call-count, correctness, and continuation gates.
- [x] Repository guards and deterministic scaling tests reject critical-path Spreadsheet/Drive operations that scale one remote call per source row; hosted call-count evidence remains part of the performance gates above.
- [ ] Every required failure scenario preserves or restores the last known good dataset and records one logical terminal audit result.
- [ ] The complete CXP-13 workflow passes in a separate UAT deployment with independently captured restricted-sharing evidence.
- [ ] Weekly rollover, stale-data detection, trigger cleanup, and re-initialization safety pass in UAT.
- [ ] Final real-export parity covers five datasets and 25 metrics with zero unexplained critical deltas.
- [ ] Delivery validation and business validation are signed for the immutable release candidate.
- [ ] Deployment and rollback rehearsals identify exact operator actions, stop conditions, recovery point, and support ownership.
- [ ] Least-privilege roles and effective hosted identities are tested; RTAs and validators cannot edit backend/control data or change deployment/configuration.
- [ ] The rollback operator can restore and verify the exact prior configuration and deployed version from the approved secure out-of-repository backup.
- [ ] PROD cutover is explicitly approved, the canary and first two hourly cycles are healthy, and the exact deployed version is recorded.

## Risks and controls

| Risk | Control |
|---|---|
| Hosted expected-peak timing has not yet been re-proven after the reliability patch | Step 03 requires three distinct successes within the accepted 10-minute objective; 20 minutes remains the absolute ceiling |
| CXP-13 DEV evidence omitted its exact maximum invocation duration | CXP-14 records every UAT invocation and rejects missing duration evidence |
| Separate UAT deployment and final restricted-sharing capture were not observed in CXP-13 | Make both blocking Step 00/01/06 evidence in CXP-14 |
| Optimization changes formulas, transaction semantics, or error classification | Freeze behavior first; require predecessor regression, hosted rerun, and separate approval for any metric change |
| Scheduler delay makes warm microbenchmarks misleading | Gate scheduler-inclusive end-to-end duration and retain per-phase active time for diagnosis |
| Production configuration points to the wrong workbook or domain | Compare Script Properties to ACTIVE registry and deployment identity before start, canary, and reopen |
| A synthetic or unapproved canary replaces live production raw data | Use the next approved real hourly bundle on the live ACTIVE workbook; otherwise keep live cutover blocked and test only on an isolated disposable target |
| Sanitized release evidence cannot restore exact configuration | Keep exact prior values and deployment version in an approved operator-controlled location outside the repository and verify restoration during rehearsal |
| Rollback destroys forensic evidence | Preserve unresolved complete backup groups and audit records; never delete them before authorized reconciliation |
| Release evidence leaks source or environment data | Enforce the same bounded allowlist as CXP-06/CXP-13 and repository guardrails |

## Rollback point and stop condition

The rollback point is the previously deployed immutable clasp version plus the exact pre-cutover PROD configuration values stored in the approved secure operator-controlled location, the sanitized protection/trigger inventory, and the last-known-good ACTIVE weekly workbook. Rollback pauses intake, restores and verifies that version and configuration pointer, preserves unresolved CXP-06 backup groups, runs HealthCheck and trigger inventory, reconciles RUN_LOG/FILE_LEDGER, and requires a parity smoke check before reopening.

Stop the packet when all acceptance gates have evidence and the completion handoff is recorded, or when a failed gate requires owner input, external validation, or production authorization. Do not loop through unbounded tuning or silently reduce the workload, validation scope, or safety margin.
