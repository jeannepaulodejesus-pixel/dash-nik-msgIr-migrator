# CXP-14 Hosted UAT Runbook

## Preconditions

1. Use a distinct hosted **UAT** deployment. Never run CXP-14 UAT helpers in DEV or PROD.
2. Freeze the release candidate commit/version; any source change invalidates later evidence.
3. Configure UAT target, control, Inbox, master template, parity export folder, and allowed domain through Script Properties. Set `CXP14_RELEASE_VERSION` once. Set `CXP14_SOURCE_BUNDLE_DIGEST` only when FILE_LEDGER has no SUCCESS fingerprint yet.
4. Confirm the target property matches the one ACTIVE `WEEK_REGISTRY` row.
5. Confirm delivery validator, business validator, UAT operator, support owner, rollback operator, stop authority, and accepted operational window. Step 00 reports named gaps (`rtaAllowedDomain`, `cxp11Setup`, `cxp12ActiveWeek`) instead of a blank `prerequisites` miss; re-run the same step after CXP-11 setup continuations.
6. Prepare three distinct synthetic expected-peak bundles, one synthetic declared-maximum bundle, negative fixtures, and an operator-recalculated real parity export whose fingerprint matches an accepted source bundle. Generate the local synthetic set with `npm run generate:cxp14-fixtures` ([`tests/fixtures/cxp14/README.md`](../tests/fixtures/cxp14/README.md)). Place each generated subdirectory in its own Drive Inbox folder and run `configureCxp14UatFixtureFolders()` once. CXP-14 retargets `CXP_UAT_DRIVE_INBOX_FOLDER_ID` (and `CXP_UAT_LEGACY_PARITY_EXPORT_FOLDER_ID` for Step 07) per slot; do not mix fixtures in one folder. After `parity/source` reaches `SUCCESS`, Step 07 starts CXP-11 against the `parity/export` folder so `sourceBundleFingerprint` matches that FILE_LEDGER identity. A hosted real weekly Excel recalculation stays outside the repository: ingest that approved bundle first and copy its successful fingerprint into the live manifest; never use the CXP-11 placeholder fingerprint.
7. Restricted-sharing evidence is collected from hosted protection/domain/deny checks. The editor identity cannot impersonate RTA or validator users; see DEC-068.

## Operator flow

Run `CXP14UatStepNN`. The step calls the CXP-11/12/13 helpers it needs, builds allowlisted evidence from hosted state, and records it. If the result is `QUEUED` or `RUNNING`, wait for continuations and **re-run the same CXP-14 step**. Do not paste pending JSON on the happy path. Do not call `continueCxp13Ingestion` or `continueCxp11ParityRun` in a spin loop from the CXP-14 helper.

Remaining operator actions:

- Configure UAT Script Properties once, including `CXP14_RELEASE_VERSION`.
- Run `configureCxp14UatFixtureFolders()` once so each step can retarget the UAT Inbox (and the CXP-11 export folder) from `CXP14_UAT_FIXTURE_FOLDERS_V1`.
- Re-run the same CXP-14 step after continuations finish.
- For Step 08 only: run `acknowledgeCxp14Production()` when production authorization is real.

`recordCxp14UatEvidence()` and `recordCxp14ExpectedPeakRun()` remain fail-closed overrides, not the happy path.

## Boundary observation

CXP-13 writes privacy-bounded invocation, call-count, chunk, phase, and timeout telemetry. CXP-14 harvests that bag into the exact performance submission. A run whose invocation reaches 270,000 ms, times out, or fails quota is refused and does not count. Scheduler-inclusive start-to-terminal time remains a separate window: 20 minutes at expected peak and 30 minutes at declared maximum.

## Ordered execution

### Step 00 — Prerequisites

Run `CXP14UatStep00VerifyPrerequisites()`. The step records the immutable identity (`contractVersion`, `CXP14_RELEASE_VERSION`, FILE_LEDGER SUCCESS digest or `CXP14_SOURCE_BUNDLE_DIGEST`), initializes CXP-11 if it is not `COMPLETE`, and drives one CXP-12 create/activate/align wave if the ACTIVE week is not aligned. If CXP-11 setup is still `RUNNING`, the result is `QUEUED` — re-run this same step. `prerequisites` is recorded only when UAT, `CXP_UAT_*` IDs plus `CXP_UAT_RTA_ALLOWED_DOMAIN`, CXP-11 setup, and an aligned ACTIVE week are actually ready. Failures name those gaps instead of a blank `prerequisites` miss.

### Step 01 — Release setup

Run `CXP14UatStep01InstallReleaseReadiness()`. If nonterminal, re-run the same CXP-14 step (or use `continueCxp14ReleaseReadinessSetup()` until setup is `COMPLETE`). Re-running after completion must be safe and must not mutate workbook content or environment configuration.

### Step 02 — Critical paths and evidence quality

Run `CXP14UatStep02InspectCriticalPaths()`. Require the deployed critical-path stamp, evidence allowlist, and hosted protection inventory. `npm run verify` / `npm run clasp:push` fail when the stamp is stale.

### Step 03 — Expected peak

Run `CXP14UatStep03BenchmarkExpectedPeak()`. The step points the UAT Inbox at expected-peak folder 1, 2, or 3 from the fixture catalog (the next unused slot), then discovers/starts/reconciles through CXP-13, yields `QUEUED` while continuations run, and on `SUCCESS` records a harvested performance submission internally. Re-run the same step until three distinct bounded SUCCESS runs pass cross-run scaling. A timed-out run does not count. The Inbox is not retargeted while a run is still queued.

Release identity (Step 00 digest) is not the per-run Inbox digest. The three peak `record.sourceBundleDigest` values must differ.

### Step 04 — Declared maximum

Run `CXP14UatStep04StressDeclaredMaximum()`. The step points the UAT Inbox at the declared-maximum folder and records one `DECLARED_MAXIMUM` SUCCESS run.

### Step 05 — Failure and recovery

Run `CXP14UatStep05VerifyFailureRecovery()`. Each invocation points the UAT Inbox at the next negative fixture folder, drives one CXP-13 wave, and records a matching observation (`VALIDATION_FAILED`, `DUPLICATE`, `SUCCESS`, or a discovery refusal). Re-run until every catalog slot is observed. `failureRecovery` is recorded only when those observations and last-known-good preservation are true. Hosted rollback rehearsal uses CXP-06/13 recovery on the control workbook, not an external Drive restore. The secure external backup required by DEC-067 stays outside CXP-14 evidence.

### Step 06 — Lifecycle and full CXP-13 UAT

Run `CXP14UatStep06VerifyLifecycleAndStatus()`. The step drives CXP-12 health and CXP-13 promotion (or CXP-13 00–05 as needed) and records `lifecycleStatus` only when both pass.

### Step 07 — Final parity and validation

Run `CXP14UatStep07RunFinalParityAndValidation()`. It first ingests the parity-source Inbox folder (`SUCCESS` or `DUPLICATE` is enough for FILE_LEDGER identity), then starts CXP-11 against the parity-export folder. It returns `QUEUED` until the run is `COMPLETE` with `summary.pass`. It does not poll `continueCxp11ParityRun` in the editor helper.

### Step 08 — Promotion gate

Run `CXP14UatStep08PromotionGate()`. Hosted permission, protection, domain, trigger-inventory, expected-peak completeness, and the observable deployment-checklist subset are recorded automatically. Organizational items (comms, canary against live PROD) stay out of `deploymentChecklistComplete`. `permissionsVerified` means those hosted checks passed, not a second-account matrix walk.

When production authorization is real, run `acknowledgeCxp14Production()`. Proceed only with `pass: true`, `missing: []`, and `promotionReady: true`.

## Rework rule

After any code, configuration, permission, workload, or release-version change, repeat the affected step and every downstream step. Do not copy a prior pass to a new candidate.
