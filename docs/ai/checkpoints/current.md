# Current Context Checkpoint

**Updated UTC:** 2026-09-09T17:37:10Z
**HEAD:** `bb152262576b0e12365bdfe62a843e8395f213d2`

## Goal

Implement the revised CXP-14 ingestion latency, verification, and reliability plan while retaining predecessor setup/entrypoint practice and every established execution boundary.

## Scope and non-goals

- Scope: CXP-13 runtime/controller, chunked staging/backup/commit/health/rollback, schema-aware readback, generation fencing, public status UX, CXP-14 timing evidence, regression coverage, critical-path stamp, and runbook/status records.
- Non-goals: no hosted deployment, Drive/Sheet mutation, Script Property edit, production authorization, cutover, or claim of hosted timing evidence.

## Authorization

Repository implementation and local verification are authorized. Hosted UAT and production actions require an operator; PROD remains unauthorized.

## Plan state

1. Revised CXP-14 surgical single-dataset implementation: complete locally.
2. Local regression, syntax, guardrail, critical-path, and context verification: complete.
3. Deploy the immutable patch to UAT and repeat the predecessor/CXP-14 runbook sequence: pending operator.
4. Record three distinct expected-peak successes, declared-maximum, recovery, parity, and approvals: pending hosted evidence.
5. PROD authorization/cutover: pending.

## Source-anchored decisions

- [DEC-070](../../decision-log.md#dec-070--treat-persisted-terminal-records-as-successful-cxp-13-audit-completion-and-chunk-work-under-generation-fencing): terminal audit, fencing, durable work.
- [DEC-071](../../decision-log.md#dec-071--compare-persisted-raw-chunks-by-schema-semantics-and-tighten-the-expected-peak-objective): semantic readback and timing objective.
- [DEC-072](../../decision-log.md#dec-072--bind-cxp-14-row-count-evidence-to-the-same-successful-cxp-13-run): same-run row-count evidence.
- [DEC-073](../../decision-log.md#dec-073--preserve-terminal-auditability-for-preparation-failures): preparation-failure audit.
- [DEC-074](../../decision-log.md#dec-074--simplify-the-cxp-14-five-file-normal-ingestion-path-without-weakening-recovery): surgical five-file hot path.
- [DEC-075](../../decision-log.md#dec-075--make-terminal-audit-the-durable-commit-point-for-cxp-14-cleanup): terminal audit and cleanup ordering fixes.
- [CXP-14 release contract](../../cxp14-release-contract.md#timing-and-boundary-rules): 195,000 ms admission, 240,000 ms invocation objective, 270,000 ms hard boundary, and scheduler-inclusive evidence.

## Implemented behavior

- Normal staging/commit work units are fixed at no more than 5,000 rows and 200,000 cells; the predecessor two-argument chunk helper and smaller rollback windows remain compatible.
- Complete five-file identity/duplicate validation occurs once before XLSX conversion. A resumed preparation reacquires/converts/parses/validates only the current dataset and reuses its payload/encoded matrix within the invocation.
- Staging has no destination pre-read or final five-sheet scan. Backup uses one server-side `copyTo` plus flush/semantic verification per dataset. Commit verifies each written unit once; terminal health checks bounds, formula absence, row counts, ledger, cleanup, and audit.
- Admission sizing uses measured write/flush/readback time when available; safe service counters and subphase durations merge once at handoff/completion.
- Rollback remains locked and uses durable restore/trim/verify cursors, including surplus-row cleanup.
- The CXP-14 native commit path transfers staged ranges with same-workbook `copyTo({contentsOnly:true})`, without a destination preflight scan; legacy/combined payload paths remain available for compatibility.
- Missing control/target workbook access fails before Drive source acquisition with a terminal lifecycle error; backup discovery refreshes after topology changes or partial named-sheet creation so retries remain discoverable.
- Generation fencing, zero-trigger terminal audit, metadata-only preparation audit, bounded public status, and same-run authoritative row-count evidence remain intact.
- Terminal audit now precedes protected-backup cleanup; ledger retries are idempotent. Preflight audit status is truthful, lock contention retains one successor, and native verification uses `commitVerify` telemetry.

## Evidence and tests

2026-09-10 local: full suite `384/384`; focused regressions `58/58`; syntax `149` files; guardrails `263` files; critical paths `7` modules; diff check clean except the existing HTML line-ending warning. Hosted timing is unproven.

## Dirty inventory and fingerprint

Task-owned status fingerprint SHA-256 `6225a2482ec64037b13947b68fb36cdb34615f564e7af7b5fe1e069533182956` (UTF-8 status output). Dirty paths are the CXP-14 records, CXP-13 runtime/repos/services/web/telemetry/entrypoints, release evidence/orchestrator/stamp, fakes, and focused tests shown by `git status --short`. User-owned paths: none known outside this task inventory; no unrelated paths were changed.

## Blockers and risks

- Hosted timing, scheduler latency, Sheets coercion, trigger cleanup, and effective permissions remain unproven until a distinct UAT deployment runs this exact release candidate.
- A surviving pre-patch `continueCxp13Ingestion` trigger must be removed before deploying and starting the UAT sequence.
- Existing CXP-14 evidence is immutable to its prior release identity; the patched candidate needs matching release version/digest evidence rather than reusing stale results.

## Next safe action

Freeze the patched release identity, remove every surviving `continueCxp13Ingestion` trigger, deploy this exact candidate to UAT, initialize matching CXP-14 evidence, and execute [`docs/cxp14-uat-runbook.md`](../../cxp14-uat-runbook.md) from Step 00. Step 03 may recover counts from the same successful current run only when its run token and digest bind; it still counts only three distinct successful 20,300-row bundles with every invocation `<240000` ms, none `>=270000` ms, scheduler-inclusive time `<=600000` ms, bounded service calls, and zero terminal continuation triggers.
