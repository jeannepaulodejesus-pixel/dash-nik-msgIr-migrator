# CXP-13 Hosted UAT Harness

## Setup and public entrypoints

- `initializeCxp13Intake`, `getCxp13IntakeSetupStatus`, `resetCxp13IntakeSetupState`
- `doGet`, `cxp13GetIntakeStatus`, `cxp13StartLatestBundle`, `cxp13GetRunStatus`
- `continueCxp13Ingestion`
- `CXP13UatStep00VerifyPrerequisites` through `CXP13UatStep08PromotionGate`

Setup is versioned by `CXP13_INTAKE_SETUP_STATE_V1` and verifies configuration, bounded Inbox access, ACTIVE target alignment, and the hosted web runtime. It is idempotent and refuses reset while `RUNNING`.

UAT evidence is stored as bounded booleans and `maxInvocationMs` in `CXP13_UAT_EVIDENCE_V1`. Never copy IDs, emails, filenames, source rows, cells, or formulas into evidence or execution logs.

To record hosted observations from the Apps Script editor, set temporary Script Property `CXP13_UAT_PENDING_EVIDENCE_V1` to one JSON object containing exact booleans for `duplicate`, `invalid`, `concurrency`, `rollbackPreserved`, `multiInvocation`, `noTimeout`, and `permissionsVerified`, plus a positive integer `maxInvocationMs`. Then run parameterless `recordCxp13UatNegativeEvidence()`. The recorder rejects missing or invalid fields and deletes the temporary property only after a successful validated write. It does not execute or authorize the scenarios.
