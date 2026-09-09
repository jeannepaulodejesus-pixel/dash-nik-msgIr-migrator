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

`cxp13StartLatestBundle(token)` queues work and returns. `continueCxp13Ingestion()` performs preparation, chunked backup/commit/health, and bounded rollback through durable cursors. Pipeline state version 2 adds a generation/lease so stale workers cannot recreate triggers. The cooperative boundary is 270,000 ms with a 60,000 ms minimum next-step reserve and 15,000 ms handoff margin (admission at `elapsed + max(60000, measured) + 15000 < 270000`). Normal staging and commit work units are fixed at no more than 5,000 rows and 200,000 cells; rollback retains its smaller recovery windows. Five-file identity and duplicate status are checked once, and a resumed staging dataset reacquires, converts, parses, and validates only its own source. Exactly one successor trigger remains; the 420,000 ms trigger is recovery-only; a live phase older than 375,000 ms is watchdog-adopted.

Public statuses are `IDLE`, `READY`, `QUEUED`, `PROCESSING`, `SUCCESS`, `DUPLICATE`, `VALIDATION_FAILED`, and `PROCESSING_ERROR`. Bounded responses also include `failureAuditStatus`, `lastAuditErrorCode`, `auditActionRequired`, current phase/dataset row progress, elapsed and estimated remaining duration, scheduler lag, recovery state, and the last verified chunk. Raw read-back comparison is schema-semantic: Sheets `Date` values may match canonical ISO date/date-time strings, and numeric spreadsheet values may match schema-defined text, while changed timestamps, numeric fields stored as text, booleans, formulas, and unrelated scalar coercions still fail closed. Mismatch diagnostics expose only bounded row/column coordinates and JavaScript/schema types, never values. Terminal results come from the matching `RUN_LOG` row. `RunService.recordFailure()` writing `runRecord` and `errorRecord` counts as a successful audit even when it rethrows; that path is `FAILED`/`RECORDED` with every `continueCxp13Ingestion` trigger removed and no automatic retry. A genuine audit persistence failure stays `FAILED`/`PENDING` with zero triggers until the operator runs parameterless `retryCxp13FailureAudit()` after repair. Public payloads omit identities and resource/file details.
