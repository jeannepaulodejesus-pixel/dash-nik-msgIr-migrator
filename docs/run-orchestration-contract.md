# CXP-04 Run Orchestration Contract

## Runtime authorities

- `src/ingestion/RunService.js` owns the audited execution template and is the only supported orchestration entrypoint.
- `src/ingestion/RunStateMachine.js` owns legal run states and transitions.
- `src/services/ScriptLock.js` owns the injected Apps Script script-lock boundary.
- `src/monitoring/ErrorCodes.js` owns stable error codes, categories, retryability, and terminal failure-state mapping.
- `src/monitoring/RunLogger.js` and `src/monitoring/ErrorLogger.js` own controlled row schemas.
- `src/repository/RunRepository.js` validates `RUN_LOG` and `ERROR_LOG` headers and writes each supplied batch with one `setValues` call.

`RunService.execute(request, operations, services)` receives CXP-03 run metadata, nine injected operations, and service adapters. It returns the successful run record and operation results. A failed attempt throws a categorized `RunError` carrying the attempted run and error records after the repository has persisted both.

## Transition table

| Current state | Successful next state | Work performed after entry |
|---|---|---|
| `RECEIVED` | `VALIDATING_FILE` | Validate source-file eligibility and packaging. |
| `VALIDATING_FILE` | `PARSING` | Parse the accepted source representation. |
| `PARSING` | `VALIDATING_SCHEMA` | Apply the active CXP-03 schema contract. |
| `VALIDATING_SCHEMA` | `CHECKING_DUPLICATE` | Check bundle/file identity and duplicate policy. |
| `CHECKING_DUPLICATE` | `STAGING` | Write only to staging surfaces. |
| `STAGING` | `VALIDATING_STAGE` | Validate staged data before any production write. |
| `VALIDATING_STAGE` | `COMMITTING` | Enter only after acquiring the script lock. |
| `COMMITTING` | `RECALCULATING` | Perform the production commit. |
| `RECALCULATING` | `HEALTH_CHECK` | Recalculate post-commit outputs. |
| `HEALTH_CHECK` | `SUCCESS` | Flush pending spreadsheet changes, release the lock, then close successfully. |
| `SUCCESS` | None | Terminal. |
| Any nonterminal state | One categorized failure state | `FAILED_SOURCE`, `FAILED_INGESTION`, `FAILED_MIGRATION_CALCULATION`, or `FAILED_REPORTING`. |
| Any failure state | None | Terminal. |

The state machine rejects skipped, repeated, unknown, and post-terminal transitions with `INGESTION_ILLEGAL_STATE_TRANSITION`. Each history event contains the state and an ISO UTC timestamp.

## Lock boundary and concurrency contract

File validation, parsing, schema validation, duplicate checking, staging, and stage validation run before lock acquisition. `ScriptLock.withLock()` then obtains the injected `LockService.getScriptLock()` result with `tryLock(timeoutMs)`. Only the lock holder may transition to `COMMITTING`; it retains the lock through commit, recalculation, health check, and the injected spreadsheet flush. Release occurs in `finally`. `SUCCESS` is recorded only after release.

The deterministic concurrency test invokes a second complete attempt from inside the first attempt's commit callback while both share one lock implementation. The first run reaches `COMMITTING` once and succeeds. The second receives `INGESTION_LOCK_TIMEOUT`, records `FAILED_INGESTION`, persists one run row and one error row, and has no `COMMITTING` event. This proves the local adapter contract. An authenticated Apps Script concurrency smoke test remains a deployment check; the repository test does not claim hosted scheduling, fairness, or timeout precision.

## Controlled log schemas

`RUN_LOG` uses the following exact header order:

1. `Run ID`
2. `Started At UTC`
3. `Ended At UTC`
4. `Source Actor`
5. `Source File Name`
6. `Source File ID`
7. `Schema Version`
8. `Input Row Counts JSON`
9. `Output Row Counts JSON`
10. `Target Workbook ID`
11. `Status`
12. `Error Code`
13. `State History JSON`

`ERROR_LOG` uses the following exact header order:

1. `Run ID`
2. `Error At UTC`
3. `State`
4. `Failure State`
5. `Category`
6. `Error Code`
7. `Message`
8. `Details JSON`

An empty log sheet receives its complete header in one write. Every required nonempty log sheet must match its controlled header exactly, and all required schemas are preflighted before either record batch is appended. Each supplied run or error batch is serialized to arrays and appended with one `setValues` call; row-by-row `appendRow` and `setValue` writes are not part of the contract.

## Error catalog

| Category / failure state | Stable codes |
|---|---|
| Source / `FAILED_SOURCE` | `SOURCE_FILE_NOT_FOUND`, `SOURCE_UNSUPPORTED_FORMAT`, `SOURCE_MULTIPLE_TABLES`, `SOURCE_RAGGED_ROWS`, `SOURCE_INVALID_TABLE`, `SOURCE_FORMULAS_NOT_ALLOWED`, `SOURCE_DIVERGENT_DUPLICATE_KEY`, `SOURCE_INCOMPLETE_BUNDLE`, `SOURCE_DUPLICATE_SUBMISSION`, `SOURCE_XLSX_CONVERSION_UNAVAILABLE`, `SOURCE_XLSX_CONVERSION_FAILED`, `SCHEMA_UNKNOWN_DATASET`, `SCHEMA_INVALID_HEADERS`, `SCHEMA_MISSING_REQUIRED_COLUMNS`, `SCHEMA_UNEXPECTED_COLUMNS`, `SCHEMA_DUPLICATE_COLUMNS`, `DATASET_ROW_VOLUME_OUT_OF_BOUNDS`, `DATASET_INVALID_ROW`, `DATASET_ERROR_TOKEN`, `DATASET_INVALID_TYPE`, `DATASET_MISSING_KEY` |
| Ingestion / `FAILED_INGESTION` | `SCHEMA_VERSION_MISMATCH`, `DATASET_INVALID_SOURCE`, `DATASET_INVALID_RUN_METADATA`, `DATASET_INVALID_PAYLOAD`, `INGESTION_INVALID_RUN_METADATA`, `INGESTION_INVALID_OPERATIONS`, `INGESTION_ILLEGAL_STATE_TRANSITION`, `INGESTION_LOCK_TIMEOUT`, `INGESTION_OPERATION_FAILED`, `SOURCE_TEMP_CLEANUP_FAILED`, `INGESTION_FILE_LEDGER_SCHEMA_MISMATCH`, `INGESTION_FILE_LEDGER_UNAVAILABLE`, `INGESTION_FILE_LEDGER_READ_FAILED`, `INGESTION_FILE_LEDGER_WRITE_FAILED` |
| Migration/calculation / `FAILED_MIGRATION_CALCULATION` | `MIGRATION_STAGE_VALIDATION_FAILED`, `MIGRATION_COMMIT_FAILED`, `CALCULATION_RECALCULATION_FAILED`, `CALCULATION_HEALTH_CHECK_FAILED` |
| Reporting / `FAILED_REPORTING` | `REPORTING_LOG_SCHEMA_MISMATCH`, `REPORTING_LOG_WRITE_FAILED` |

Known errors retain their original code and safe structured details. Unknown thrown values are normalized to the stage-appropriate code. Logging records contain the normalized public message and details; stacks and raw source rows are not serialized.

## Synthetic sample records

Successful run record:

```json
{
  "runId": "run-synthetic-success",
  "startedAtUtc": "2026-08-23T00:00:00.000Z",
  "endedAtUtc": "2026-08-23T00:00:10.000Z",
  "sourceActor": "synthetic-rta",
  "sourceFileName": "synthetic-source.xls",
  "sourceFileId": "synthetic-file-id",
  "schemaVersion": "1.0.0",
  "inputRowCounts": { "Handled": 2 },
  "outputRowCounts": { "Handled": 2 },
  "targetWorkbookId": "synthetic-target-id",
  "status": "SUCCESS",
  "errorCode": null,
  "stateHistory": [
    { "atUtc": "2026-08-23T00:00:00.000Z", "state": "RECEIVED" },
    { "atUtc": "2026-08-23T00:00:10.000Z", "state": "SUCCESS" }
  ]
}
```

Failed run and error records:

```json
{
  "run": {
    "runId": "run-synthetic-failure",
    "status": "FAILED_SOURCE",
    "errorCode": "SCHEMA_MISSING_REQUIRED_COLUMNS",
    "schemaVersion": "1.0.0",
    "inputRowCounts": { "Handled": 2 },
    "outputRowCounts": {},
    "stateHistory": [
      { "atUtc": "2026-08-23T00:00:00.000Z", "state": "RECEIVED" },
      { "atUtc": "2026-08-23T00:00:03.000Z", "state": "VALIDATING_SCHEMA" },
      { "atUtc": "2026-08-23T00:00:04.000Z", "state": "FAILED_SOURCE" }
    ]
  },
  "error": {
    "runId": "run-synthetic-failure",
    "atUtc": "2026-08-23T00:00:05.000Z",
    "state": "VALIDATING_SCHEMA",
    "failureState": "FAILED_SOURCE",
    "category": "SOURCE",
    "errorCode": "SCHEMA_MISSING_REQUIRED_COLUMNS",
    "message": "Required source columns are missing.",
    "details": { "missingHeaders": ["Messaging Session Name"] }
  }
}
```

The abbreviated sample histories illustrate record shape only; real `RunService` histories contain every state actually entered.

## Packet boundary

CXP-05 now supplies `validateFile`, `parse`, `validateSchema`, and `checkDuplicate` through `InputAdapter.createOperations()`. CXP-06 combines those with staging/commit callbacks through this orchestration template; neither packet may bypass the state or lock boundaries. Transaction rollback, transformations, and Excel parity remain outside CXP-04/CXP-05. If audit persistence itself fails, `REPORTING_LOG_WRITE_FAILED` carries the records that were attempted, but a failed repository cannot prove durable storage; operational monitoring must treat that exception as a reporting incident.
