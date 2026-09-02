# CXP-13 Hosted UAT Harness

## Setup and public entrypoints

- `initializeCxp13Intake`, `getCxp13IntakeSetupStatus`, `resetCxp13IntakeSetupState`
- `doGet`, `cxp13GetIntakeStatus`, `cxp13StartLatestBundle`, `cxp13GetRunStatus`
- `continueCxp13Ingestion`
- `CXP13UatStep00VerifyPrerequisites` through `CXP13UatStep08PromotionGate`

Setup is versioned by `CXP13_INTAKE_SETUP_STATE_V1` and verifies configuration, bounded Inbox access, ACTIVE target alignment, and the hosted web runtime. It is idempotent and refuses reset while `RUNNING`.

UAT evidence is stored as bounded booleans and `maxInvocationMs` in `CXP13_UAT_EVIDENCE_V1`. Never copy IDs, emails, filenames, source rows, cells, or formulas into evidence or execution logs.

The UAT-only `recordCxp13UatNegativeEvidence({...})` accepts the observed duplicate, invalid, concurrency, rollback-preservation, multi-invocation, and maximum-duration results after the controlled scenarios. It does not execute or authorize those scenarios.

