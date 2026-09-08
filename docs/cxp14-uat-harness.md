# CXP-14 Hosted UAT Harness

## Purpose

Parameterless Apps Script editor helpers for the CXP-14 release-readiness sequence. Contract: [`docs/cxp14-release-contract.md`](cxp14-release-contract.md). Runbook: [`docs/cxp14-uat-runbook.md`](cxp14-uat-runbook.md).

Each numbered step calls the predecessor CXP-11/12/13 work it needs, builds allowlisted evidence internally, and records it. Long jobs return `QUEUED` with `nextAction: "re-run this CXP-14 step"`. Helpers never poll `continueCxp13Ingestion` or `continueCxp11ParityRun`.

## Setup and state

| Script Property | Purpose |
|---|---|
| `CXP14_RELEASE_VERSION` | One-time UAT release identity (required before Step 00) |
| `CXP14_SOURCE_BUNDLE_DIGEST` | Fallback 64-hex digest when FILE_LEDGER has no SUCCESS fingerprint |
| `CXP14_RELEASE_SETUP_STATE_V1` | Versioned setup cursor and terminal state |
| `CXP14_UAT_EVIDENCE_V1` | Validated bounded promotion predicates/evidence |
| `CXP14_EXPECTED_PEAK_RUNS_V1` | Three release-bound, validated expected-peak run records |
| `CXP14_DECLARED_MAXIMUM_RUNS_V1` | One release-bound declared-maximum run record |
| `CXP13_INGESTION_TELEMETRY_V1` | Privacy-bounded CXP-13 invocation/call/phase telemetry |
| `CXP14_UAT_PENDING_EVIDENCE_V1` | Fail-closed override only; not used on the happy path |
| `CXP14_EXPECTED_PEAK_PENDING_RUN_V1` | Fail-closed override only; not used on the happy path |
| `CXP14_UAT_FIXTURE_FOLDERS_V1` | Named Drive Inbox/export catalog for automated intake; IDs never copied into evidence |
| `CXP14_UAT_NEGATIVE_PROGRESS_V1` | Step 05 slot-name cursor |
| `CXP14_UAT_PARITY_PHASE_V1` | Step 07 `SOURCE` / `EXPORT` / `COMPLETE` |

Setup/status surfaces:

- `initializeCxp14ReleaseReadiness`
- `continueCxp14ReleaseReadinessSetup`
- `getCxp14ReleaseReadinessSetupStatus`
- `resetCxp14ReleaseReadinessSetupState`
- `diagnoseCxp14RunbookChecks`
- `configureCxp14UatFixtureFolders`
- `acknowledgeCxp14Production`

Setup uses `IDLE`, `RUNNING`, `COMPLETE`, and `FAILED`; it is idempotent and refuses reset while `RUNNING`. It validates release prerequisites without clearing workbooks, changing formulas, retargeting environments, altering permissions, or deploying source.

## UAT succession

| Step | Helper | Required observation |
|---|---|---|
| 00 | `CXP14UatStep00VerifyPrerequisites` | Records identity from `CXP14_RELEASE_VERSION` plus FILE_LEDGER SUCCESS digest (or `CXP14_SOURCE_BUNDLE_DIGEST`); `prerequisites` only when UAT, config, and predecessors are ready |
| 01 | `CXP14UatStep01InstallReleaseReadiness` | Setup complete and evidence contract installed |
| 02 | `CXP14UatStep02InspectCriticalPaths` | Deployed critical-path stamp, allowlist, and hosted protections pass |
| 03 | `CXP14UatStep03BenchmarkExpectedPeak` | Three distinct harvested 20,300-row SUCCESS runs pass |
| 04 | `CXP14UatStep04StressDeclaredMaximum` | One harvested 44,500-row SUCCESS run passes |
| 05 | `CXP14UatStep05VerifyFailureRecovery` | Observed terminal codes plus last-known-good preservation |
| 06 | `CXP14UatStep06VerifyLifecycleAndStatus` | CXP-12 health plus CXP-13 promotion pass |
| 07 | `CXP14UatStep07RunFinalParityAndValidation` | CXP-11 `COMPLETE` with `summary.pass` |
| 08 | `CXP14UatStep08PromotionGate` | All predicates except `prodAcknowledged`; then `acknowledgeCxp14Production()` |

Drop one Inbox bundle, run the CXP-14 step, and re-run that same step after continuations. After `configureCxp14UatFixtureFolders()`, Steps 03–05 and 07 retarget the UAT Inbox (and the CXP-11 export folder) from the catalog instead of requiring a manual drop each time. Peak-run `record.sourceBundleDigest` is the Inbox bundle digest and must differ across the three expected-peak runs. Repository identity remains the Step 00 release digest.

Step 03 harvests `CXP13_INGESTION_TELEMETRY_V1` plus health and FILE_LEDGER fingerprint into the exact five-field submission. Timeout, quota failure, missing fields, or unbounded call counts fail closed and do not increment `recordedRunCount`.

## Fail-closed overrides

`recordCxp14UatEvidence()` and `recordCxp14ExpectedPeakRun()` still consume pending JSON properties after validation. Use them only when an operator must correct a refused record. Happy-path steps do not require those properties.

Never record IDs, emails, filenames, rows, cell values, formulas, tokens, or secrets. Use counts, durations, safe status/error codes, booleans, and digests only.

## Safety

- `CXP_ENV` must be `UAT`; CXP-14 helpers refuse DEV as release evidence and always refuse PROD.
- Use synthetic non-personal fixtures for workload and failure tests. Generate them with `npm run generate:cxp14-fixtures`.
- Use a real operator-recalculated export only for final parity; raw content remains outside the repository and evidence.
- `permissionsVerified` is hosted protection/domain/deny evidence, not a multi-role impersonation matrix (DEC-068).
- External secure backup/restore stays outside CXP-14 evidence (DEC-067).
- Do not run a synthetic canary against the live production ACTIVE workbook.
