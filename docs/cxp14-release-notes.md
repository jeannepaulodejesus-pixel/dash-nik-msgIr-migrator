# CXP-14 Release Notes

**Status:** Repository implementation complete; hosted UAT, final real-export parity, production authorization, and cutover are not yet complete.

## Release scope

CXP-14 adds release-readiness evidence validation, versioned setup/status/reset entrypoints, zero-padded UAT gates, performance workload/timing contracts, least-privilege checks, and production deployment/rollback documentation. It preserves the CXP-06/CXP-13 execution boundary and does not change business metrics, workbook formulas, ingestion semantics, or the RTA workflow.

## Operator-visible changes

- New CXP-14 setup, diagnostic, evidence-recording, and UAT promotion helpers.
- Explicit expected-peak and declared-maximum workload evidence.
- Production deployment, permission, normal-operation, escalation, and rollback checklists.

## Compatibility

CXP-11 parity, CXP-12 lifecycle/health, and CXP-13 intake/status remain the production authorities. CXP-14 consumes their public state and evidence; it does not clone or replace them.

## Repository verification

- CXP-14 focused tests: 15/15 passed.
- Preserved CXP-06 boundary tests: 38/38 passed.
- Recent CXP-11 through CXP-13 setup/UAT and packet tests: 88/88 passed.
- Full repository suite: 310/310 passed.
- Syntax, repository guardrails, seven-module critical-path bulk-call guard, and `git diff --check`: passed.

The direct Node equivalents of the package scripts were used because the local global npm launcher could not locate `npm-cli.js`.

## Known limitations before release

- Hosted UAT results and exact timings require an authorized UAT deployment.
- Final parity requires an operator-recalculated weekly Excel export matching a successful source fingerprint.
- Production configuration, deployment, canary, and observation require explicit external authorization.

Update this file with the exact deployed version, hosted evidence links, accepted limits, fixes, residual risks, rollback point, and support ownership when the release closes.
