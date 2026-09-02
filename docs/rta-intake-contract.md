# CXP-13 RTA Intake Contract

## Boundary

CXP-13 is a standalone Apps Script web app. It reads only the configured `CXP_<ENV>_DRIVE_INBOX_FOLDER_ID`, resolves the CXP-12 ACTIVE workbook, queues CXP-06-compatible transactional ingestion, and projects sanitized status. HTML never reads Drive or spreadsheet services directly.

The deployment executes as the accessing user and is restricted to the deployment domain. The signed-in email domain must exactly match `CXP_<ENV>_RTA_ALLOWED_DOMAIN`; the email itself is discarded after authorization.

## Delivery names

The UTC batch token is `YYYYMMDDTHHmmssZ`.

- Multi-sheet: `<token>__bundle.xlsx`.
- Five-file: `<token>__handled.(xls|xlsx)`, `offered`, `aht`, `auxes`, and `staff`.

The newest token is authoritative. It must contain exactly one complete packaging form. A newer incomplete token blocks an older complete token. Mixed packaging, duplicate members, more than 200 inbox files, and selection changes fail closed.

## Execution and status

`cxp13StartLatestBundle(token)` queues work and returns. `continueCxp13Ingestion()` performs preparation, dataset-scoped backup/commit, and finalization through durable checkpoints. The cooperative boundary is 270,000 ms with a 60,000 ms minimum next-step reserve and 15,000 ms handoff margin. Exactly one successor trigger remains; the 420,000 ms trigger is recovery-only.

Public statuses are `IDLE`, `READY`, `QUEUED`, `PROCESSING`, `SUCCESS`, `DUPLICATE`, `VALIDATION_FAILED`, and `PROCESSING_ERROR`. Terminal results come from the matching `RUN_LOG` row. Public payloads omit identities and resource/file details.

