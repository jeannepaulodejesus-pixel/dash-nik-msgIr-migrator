# CXP-06 Apps Script Hosted DEV/UAT Harness

## Purpose

The CXP-06 Hosted DEV/UAT Harness provides parameterless Apps Script editor entrypoints, safe environment gating, fault injection hooks, and sanitized evidence generation for executing the CXP-06 UAT Runbook (`docs/cxp06-uat-runbook.md`).

## Safety Gate & Preconditions

Every UAT entrypoint enforces `Cxp06UatHarness.requireSafetyGate` before reading source files, opening target/control workbooks, or performing mutations:

- `CXP_ENV` must be set to `DEV` or `UAT`. Any attempt to run in `PROD` or an unknown environment fails immediately.
- `CXP_UAT_ENABLED` must be set to `'true'`.

### Script Properties Requirements

The harness reads the five synthetic source file IDs from Apps Script Script Properties:

- `CXP_UAT_HANDLED_FILE_ID`
- `CXP_UAT_OFFERED_FILE_ID`
- `CXP_UAT_AHT_FILE_ID`
- `CXP_UAT_AUXES_FILE_ID`
- `CXP_UAT_STAFF_FILE_ID`

## Parameterless Editor Entrypoints

The harness exposes 12 parameterless entrypoint functions in `src/main/Cxp06UatEntrypoints.js` for manual or automated Apps Script execution:

| Entrypoint | Scenario / Case | Purpose |
|---|---|---|
| `cxp06UatPreflight` | `PREFLIGHT` | Validates environment, safety gates, script properties, and workbook access without mutation. |
| `cxp06UatCase1PeakSuccess` | `CASE1_PEAK_SUCCESS` | Executes full peak payload replacement through `RunService.execute()`. |
| `cxp06UatCase2InvalidStage` | `CASE2_INVALID_STAGE` | Injects corrupt staging data after staging to verify `MIGRATION_STAGE_VALIDATION_FAILED`. |
| `cxp06UatCase3MidCommitFailure` | `CASE3_MID_COMMIT_FAILURE` | Injects mid-commit failure after 2 raw dataset replacements to test rollback. |
| `cxp06UatCase4HealthMismatch` | `CASE4_HEALTH_MISMATCH` | Forces raw mismatch during health check to trigger rollback. |
| `cxp06UatCase4RollbackFailure` | `CASE4_ROLLBACK_FAILURE` | Injects restore or verification failure during rollback to verify `MIGRATION_ROLLBACK_FAILED`. |
| `cxp06UatCase5IncompleteBackup` | `CASE5_INCOMPLETE_BACKUP` | Seeds one incomplete group and verifies deletion without restore. |
| `cxp06UatCase5CompleteUnsuccessfulBackup` | `CASE5_COMPLETE_UNSUCCESSFUL_BACKUP` | Seeds one complete unfinished group and verifies restore, verification, and deletion. |
| `cxp06UatCase5SuccessfulLeftoverBackup` | `CASE5_SUCCESSFUL_LEFTOVER_BACKUP` | Seeds one complete group with a confirmed synthetic SUCCESS row and verifies deletion without restore. |
| `cxp06UatCase5TwoCompleteUnsuccessfulBackups` | `CASE5_TWO_COMPLETE_UNSUCCESSFUL_BACKUPS` | Seeds two complete unfinished groups and verifies fail-closed ambiguous recovery. |
| `cxp06UatCase5CleanupFailure` | `CASE5_CLEANUP_FAILURE` | Injects backup deletion failure after SUCCESS confirmation to test `PENDING` cleanup status. |
| `cxp06UatReaderVisibility` | `READER_VISIBILITY` | Introduces a delay after raw replacement during `COMMITTING` to observe reader isolation. |

## Fault Semantics & Architecture

- **Operation Composition:** `Cxp06UatHarness.composeOperations` merges `InputAdapter.createOperations()` (4 phases: `validateFile`, `parse`, `validateSchema`, `checkDuplicate`) and `CommitService.createOperations()` (5 phases: `stage`, `validateStage`, `commit`, `recalculate`, `healthCheck`) into the 9-phase object supplied to `RunService.execute()`.
- **No Secondary Orchestrator:** All executions pass through the production `RunService` and script lock boundary.
- **Fault Injection:** Controlled via `Cxp06FaultInjector.create(faultKind)` decorators supplied before `CommitService` constructs the production staging, raw, and backup repositories. Raw replacement/restore observers fire only after each persisted dataset write.
- **Backup Topology Seeding:** `Cxp06BackupTopologySeeder` uses `BackupRepository.createGroup()` and the standard `_CXP06_BAK_<TOKEN>_<runId>` naming convention. `CommitService` invokes it under the existing script lock immediately before production reconciliation; ordinary runs do not install the hook.
- **Clean-start refusal:** The controlled seeder refuses to seed when any `_CXP06_BAK_*` sheet already exists. It never deletes or replaces prior recovery evidence. Operators must investigate a dirty workbook before another writer is allowed.
- **Bounded mutations:** The incomplete case creates a verified group and deletes four exact resolved sheet objects, leaving Handled. The successful-leftover case appends and read-confirms one bounded `UAT-SEED` SUCCESS record. The ambiguous case creates two distinct complete groups and retains them when reconciliation fails closed.
- **Partial setup failure:** Any group created before a setup error remains in the workbook as diagnostic evidence. The sanitized code is `UAT_BACKUP_TOPOLOGY_SEED_FAILED`; dependency messages and cell contents are excluded.

## Evidence Sanitization

All evidence outputs pass through `Cxp06UatEvidence.sanitize(rawRecord)` which strictly enforces an allowlist (`ALLOWED_FIELDS`):

`scenario`, `environment`, `startedAtUtc`, `endedAtUtc`, `elapsedMs`, `runId`, `terminalState`, `stageRowCounts`, `rawRowCounts`, `stageFormulaCount`, `rawFormulaCount`, `fileLedgerResult`, `backupSheetNames`, `backupSheetCount`, `rollbackStatus`, `backupCleanupStatus`, `sanitizedErrorCode`, `sanitizedWarningCode`, `runtimeIndicator`.

> [!IMPORTANT]
> The evidence output never exposes raw cell values, rows, keys, filenames, file IDs, formulas, or PII.
