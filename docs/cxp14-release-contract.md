# CXP-14 Release Readiness Contract

## Purpose

CXP-14 proves that the completed CXP-00–13 system is safe to release. It adds evidence, setup, UAT, and cutover controls; it does not add reporting features or change metric definitions.

The repository may become implementation-complete before hosted UAT or production cutover. Those external gates remain explicit and CXP-14 stays `In progress` until their evidence exists.

## Workload profiles

| Profile | Handled | Offered | AHT | Auxes | Staff | Total |
|---|---:|---:|---:|---:|---:|---:|
| `EXPECTED_PEAK` | 5,000 | 5,000 | 7,000 | 3,000 | 300 | 20,300 |
| `DECLARED_MAXIMUM` | 10,000 | 10,000 | 15,000 | 7,500 | 2,000 | 44,500 |

Expected peak is the hourly release profile. Declared maximum is a stress profile and does not expand the approved source contract.

## Timing and boundary rules

- Cooperative invocation budget: `270000` ms.
- Operational invocation objective: less than `240000` ms.
- Reserve before another step: `60000` ms.
- Handoff margin: `15000` ms.
- Expected-peak scheduler-inclusive objective: at most `1200000` ms (20 minutes), subject to owner confirmation in UAT Step 00.
- Declared-maximum scheduler-inclusive objective: at most `1800000` ms (30 minutes).
- Automated recovery objective: at most `900000` ms after the recovery worker first runs.

`269999` ms is below the hard boundary; `270000` ms is not. Individual invocation duration and scheduler-inclusive duration are separate measures. No warm flush or isolated microbenchmark can substitute for complete intake-to-terminal evidence.

Long work reuses the production continuation design: durable checkpoint/cursor, successor-first trigger replacement, one successor per handler, 420-second recovery watchdog, 90-second contention backoff, idempotent replay, and terminal trigger cleanup.

## Evidence grains

### Invocation grain

One record per Apps Script execution, keyed outside the public evidence by run plus invocation ordinal. Public evidence may contain only:

- bounded phase/dataset/status enums;
- start/end UTC and integer duration;
- row counts and bounded service-call counts;
- continuation, contention, watchdog, health, audit, and cleanup outcomes.

### Logical-run grain

One aggregate per accepted start through terminal state. It contains workload profile, run ordinal, row counts, maximum invocation duration, scheduler-inclusive duration, terminal state, continuation count, boundary results, health/audit/cleanup booleans, and last-known-good preservation.

### Promotion grain

One versioned UAT evidence object for the immutable release candidate. The first recording supplies the contract version, release version, and source-bundle digest. Later strict allowlisted patches merge observed predicates; release identity cannot change, and omitted fields are neither erased nor inferred.

## Evidence quality checks

- **Completeness:** every required field exists; all five row counts and service-call classes are present.
- **Uniqueness:** three distinct expected-peak successful runs and one declared-maximum run; duplicate ordinals do not increase the count.
- **Validity:** counts/durations are finite non-negative integers, booleans are exact, enums are allowlisted, timestamps are valid ISO UTC strings, and workload totals match the profile.
- **Consistency:** `endedAtUtc >= startedAtUtc`, elapsed fields agree, terminal success requires healthy/audited/clean cleanup, and promotion cannot pass with a failed prerequisite.
- **Integrity:** final parity fingerprint matches a successful FILE_LEDGER identity; status reconciles to one logical RUN_LOG result.
- **Timeliness:** hosted evidence is for the exact immutable release candidate and active UAT environment.
- **Volume/shape:** service calls scale by phase/dataset/chunk rather than by source row count.

Expected-peak records enforce an independent bound for every service class before any cross-run comparison. For `c` recorded chunks, the allowed count is `min(absolute ceiling, base + per-chunk × c)`:

| Class | Base | Per chunk | Absolute ceiling |
|---|---:|---:|---:|
| Drive | 30 | 3 | 1,000 |
| Flush | 10 | 1 | 250 |
| Lock | 30 | 3 | 1,000 |
| Properties | 100 | 12 | 4,000 |
| Spreadsheet | 200 | 20 | 6,000 |
| Trigger | 30 | 3 | 1,000 |

The bases generously cover preparation, five datasets, backup, commit, recalculation, health, audit, and cleanup. Per-chunk allowances cover bounded continuation work. Every absolute ceiling is categorically below the 20,300-row expected-peak profile, so consistently row-proportional behavior cannot pass merely because all three runs have equal volume. These immutable bounds are exported as `Cxp14ReleaseEvidence.EXPECTED_PEAK_CALL_BOUNDS`; changing them requires release-contract review and repeat evidence.

Reject evidence containing keys or text associated with spreadsheet/folder/file IDs, email addresses, filenames, source rows, cell values, formulas, access tokens, or secrets. Evidence records contain only statuses, bounded codes, counts, durations, digests, and safe summaries.

## Required UAT predicates

Promotion requires exact `true` for:

- `prerequisites`
- `setup`
- `criticalPaths`
- `expectedPeak`
- `declaredMaximum`
- `failureRecovery`
- `lifecycleStatus`
- `finalParity`
- `permissionsVerified`
- `rollbackRehearsed`
- `deploymentChecklistComplete`
- `prodAcknowledged`

The promotion result returns `pass`, `promotionReady`, and a frozen sorted `missing` array. Missing/invalid evidence fails closed; no predicate is inferred from another.

## Performance gates

Expected peak passes only with three distinct successful runs, each at 20,300 rows, under the accepted scheduler-inclusive window, below the 270-second hard invocation boundary, with zero timeout/quota failures, one-successor behavior, row-independent service-call shape, healthy final data, complete audit/cleanup, and last-known-good preservation.

Declared maximum passes only with one 44,500-row run under its objective and the same hard correctness/boundary controls. `maxInvocationMs >= 240000` is an objective miss that blocks Step 03/04 unless explicitly accepted by the owner; `>= 270000`, timeout, or quota failure is always blocking.

## Security and permissions

The role-to-capability matrix in [`docs/cxp14-permissions-matrix.md`](cxp14-permissions-matrix.md) is part of release evidence. Effective hosted identities must be tested. RTAs and validators cannot edit backend/control sheets, change Script Properties, deploy source, or execute rollback. UAT entrypoints refuse PROD.

## Cutover and rollback

Production requires Step 08, an immutable version, explicit authorization, a secure operator-owned backup of exact prior configuration/deployment values outside the repository, and a tested restoration check. A live canary uses only the next approved real production bundle. Synthetic data may run only against UAT or an isolated disposable target.

Immediate rollback triggers are: timeout/quota error, unexplained critical parity delta, audit gap, ACTIVE-target mismatch, permission/protection failure, duplicate continuation writer, or mutation of last-known-good data by a rejected/failed submission.

## Completion

Repository implementation alone does not complete CXP-14. Completion requires hosted UAT, real-export final parity, validation sign-off, explicit production approval, canary plus first two healthy hourly cycles, exact deployed version, rollback point, support ownership, limitations, and open risks.
