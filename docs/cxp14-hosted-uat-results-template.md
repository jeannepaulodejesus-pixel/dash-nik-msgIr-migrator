# CXP-14 Hosted UAT Results — Template

Copy to `docs/cxp14-hosted-uat-results-<YYYY-MM-DD>.md`. Record only safe statuses, codes, counts, durations, digests, and role names/titles when approved. Never include source rows, cell values, formulas, emails, filenames, environment IDs, tokens, or secrets.

## Release identity

| Field | Value |
|---|---|
| UAT date (UTC) | |
| Immutable release version/commit | |
| Operational window accepted by | |
| Delivery validator | |
| Business validator | |
| Support/rollback owner | |
| Local verification | `test:cxp14`, predecessor suites, `verify`, `git diff --check` |

## Step results

| Step | Result | Evidence |
|---|---|---|
| 00 Prerequisites | Pass / Fail | |
| 01 Release setup | Pass / Fail | |
| 02 Critical paths | Pass / Fail | |
| 03 Expected peak | Pass / Fail | Performance report |
| 04 Declared maximum | Pass / Fail | Performance report |
| 05 Failure/recovery | Pass / Fail | Scenario matrix |
| 06 Lifecycle/status | Pass / Fail | CXP-12/13 UAT records |
| 07 Final parity/validation | Pass / Fail | Dated parity report/sign-offs |
| 08 Promotion | Pass / Fail | `missing`, `promotionReady` |

## Failure and recovery matrix

| Scenario | Terminal state/code | Last-known-good preserved | Audit complete | Cleanup/recovery | Result |
|---|---|---|---|---|---|
| Duplicate same name | | | | | |
| Duplicate different name | | | | | |
| Missing/invalid/empty input | | | | | |
| Invalid domain values | | | | | |
| Concurrent start/lock contention | | | | | |
| Mid-stage/mid-commit/health failure | | | | | |
| Rollback and rollback failure | | | | | |
| Cleanup and ambiguous backup topology | | | | | |

## Lifecycle, permissions, and parity

| Gate | Evidence | Result |
|---|---|---|
| CXP-13 complete UAT | | |
| CXP-12 rollover/health/re-init | | |
| Restricted sharing/effective identities | | |
| Five datasets / 25 metrics | | |
| Critical unexplained deltas | | Must be zero |
| WB0817 observed error count | | Must be 1,885 |
| Delivery/business validation | | |
| Rollback rehearsal/restore verification | | |

## Outcome

- `pass`:
- `missing`:
- `promotionReady`:
- blockers:
- limitations:
- production authorization: **Not granted by this record / separately granted**

