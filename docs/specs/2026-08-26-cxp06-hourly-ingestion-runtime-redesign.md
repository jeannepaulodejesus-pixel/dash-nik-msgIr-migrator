# CXP-06 Hourly Ingestion Runtime Redesign

## Context

At the declared 44,500-row UAT volume, the hosted CXP-06 run spans many time-driven invocations, repeats complete staging/raw/backup scans on each wake, reaches Apps Script's six-minute execution limit, and spends material wall time waiting for trigger delivery. The current checkpoint proves logical progress but does not make resumed work dataset-scoped.

## Goals

- Keep every hosted invocation below a 270,000 ms hard cooperative runtime budget.
- Stop accepting a new work unit when the measured worst step cannot fit before that budget.
- Reconstruct only the dataset required by the next backup or commit step.
- Pack multiple safe dataset steps into one invocation to reduce trigger handoffs.
- Persist progress after every dataset so a timeout or duplicate trigger can resume idempotently.
- Preserve complete backups, duplicate detection, raw formula rejection, rollback, health verification, audit records, and DEV/UAT gates.
- Return bounded status metadata; never persist or log cell values.

## Non-goals

- Moving the worker to Cloud Run or changing the source-file contract.
- Changing raw/staging sheet names or the five-dataset transaction order.
- Removing synchronous `RunService.execute()` behavior used by non-hosted tests.
- Promising exact trigger delivery time; Apps Script time triggers remain eventual schedulers.

## Architecture

The existing controller remains the durable state owner. Preparation still parses, validates, stages, and records an immutable checkpoint. Backup and commit continuations become budget-aware worker loops. Each loop executes one dataset-scoped step, persists the cursor and measured duration, and starts another step only when the current invocation has enough reserved time. Otherwise it exits after installing exactly one successor.

Backup resume reconstructs only the fingerprint, source-file metadata, transaction dataset names, and discovered backup group. It never rereads staging. A backup step copies and verifies the next missing raw dataset and records that dataset name.

Commit resume loads and validates only the next staging dataset. A commit step reads only that raw dataset, accepts an already-matching payload as an idempotent replay, otherwise verifies the same dataset's backup, checks the duplicate fingerprint, rejects raw formulas, writes and flushes the one dataset, rereads it, and validates the persisted result before advancing the cursor.

The existing final `RunService.resume()` remains the transaction tail. It performs complete recalculation, health validation, audit success, and backup cleanup after all five dataset steps are durably verified. This preserves the current success contract while removing repeated complete scans from intermediate continuations.

## Runtime Budget

- `INVOCATION_BUDGET_MS`: 270,000 ms absolute cooperative exit threshold.
- `DEFAULT_STEP_RESERVE_MS`: 60,000 ms before any hosted measurement exists.
- `MAX_STEP_RESERVE_MS`: the maximum observed duration for the relevant phase, persisted in Script Properties state.
- `HANDOFF_MARGIN_MS`: 15,000 ms reserved for checkpoint persistence and trigger replacement.
- A worker starts another step only when `elapsed + max(observedStepMs, defaultReserve) + handoffMargin < invocationBudget`.
- A watchdog trigger is recovery-only. It does not represent or enforce the runtime deadline.

## State and Interfaces

The checkpoint data adds bounded `datasetNames`, while continuation state records `maxBackupStepMs`, `maxCommitStepMs`, `heartbeatAtUtc`, and existing backup/commit cursors.

New repository/service seams:

- `StagingRepository.readDatasetCheckpoint(runMetadata, datasetName)` returns one normalized payload and one persisted snapshot.
- `StageValidator.validateDatasetCheckpoint(payload, snapshot)` validates one exact formula-free dataset.
- `RawDataRepository.readOne(datasetName)`, `preflightOne(datasetName)`, and `replacePayload(payload, options)` operate on one registered raw sheet.
- `BackupRepository.readDataset(group, datasetName)` and `verifyDataset(group, datasetName)` operate on one registered backup/raw pair.
- `CommitService.resumeBackup(context, checkpointData)` restores transaction metadata without staging reads.
- `CommitService.resumeDataset(context, checkpointData, datasetName)` restores and validates one staged dataset.
- `CommitService.commitDatasetStep(context, progress)` advances exactly one dataset cursor and verifies the persisted write.

Existing `resume`, `commitStep`, `commit`, and synchronous paths remain available for compatibility.

## Failure and Recovery

- Duplicate or late invocations use the persisted cursor and dataset equality check; an already-written dataset is adopted without another write.
- Lock contention remains retryable and leaves the same cursor.
- A dataset-scoped verification or write failure uses the existing complete-group rollback contract.
- A verified rollback clears backup and commit cursors before retry, as already required by the continuation controller.
- A continuation never marks `COMPLETE` until final health, ledger confirmation, and cleanup processing finish.

## Observability

Every worker result logs bounded phase metadata: operation, dataset name, step duration, invocation elapsed time, next cursor, and whether another step was packed or a continuation was scheduled. Status continues to expose the last completed backup/commit dataset without cell values.

## Acceptance Criteria

- Functional CXP-06 and UAT suites pass without weakened assertions.
- A regression proves backup continuation does not call complete staging reconstruction.
- A regression proves commit continuation reads and validates only the cursor dataset.
- A regression proves short steps are packed and a step is not started when its measured reserve would cross 270,000 ms.
- A regression proves already-matching raw data advances the cursor without rewriting.
- Hosted UAT shows no execution at or above 360 seconds and fewer continuation invocations than the current five-backup/five-commit sequence.

## Externally Observable Decisions

- The existing parameterless Apps Script entrypoints and statuses are preserved.
- Time-driven handoff remains eventual; the implementation reduces the number of handoffs rather than promising exact wake times.
- Cloud Run migration remains an escalation path only if hosted P95 latency is still unsuitable after dataset-scoped work is deployed and measured.
