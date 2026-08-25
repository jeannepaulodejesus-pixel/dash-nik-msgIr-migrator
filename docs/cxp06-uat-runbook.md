# CXP-06 Apps Script UAT Runbook

## Status

**REVALIDATION REQUIRED — dataset-scoped adaptive workers, August 26, 2026.** Hosted runs of the preceding design spent substantial time waiting for one-minute triggers and still reached the six-minute limit because a continuation rebuilt and revalidated all five staged datasets before each raw write. The current revision reads, validates, backs up, verifies, or replaces only the dataset at the durable cursor, then packs another dataset into the same invocation only when the measured reserve fits inside a 270,000 ms cooperative budget. Hosted UAT must be repeated against this revision before promotion; begin from Case 1 and reconcile any partially committed workbook first.

## Preconditions

- Use a dedicated DEV or UAT target workbook; never use PROD for first execution.
- Confirm CXP-02 created all five staging and raw sheets plus the control workbook's `FILE_LEDGER`, `RUN_LOG`, and `ERROR_LOG`.
- Confirm the active schema is `1.0.0` and the executing identity is an editor of both workbooks.
- Capture target/control workbook IDs outside source code through the existing environment properties.
- Prepare synthetic, non-personal payloads at these declared maximums: Handled 10,000; Offered 10,000; AHT 15,000; Auxes 7,500; Staff 2,000.
- Take a recoverable copy of the DEV/UAT workbook before the first hosted test.

## Evidence capture

For every case, record:

- Apps Script execution ID and UTC start/end timestamps;
- run ID and terminal run state;
- elapsed time and any quota/runtime warning;
- stage/raw row counts for all five datasets;
- formula counts for all stage/raw sheets;
- FILE_LEDGER result and correlated run ID;
- backup sheet names remaining after the run;
- rollback or cleanup status; and
- sanitized execution-log excerpts containing no source rows, cell values, keys, filenames, or formula text.

## Resumable execution contract

Hosted scenario entrypoints no longer run preparation, backup, and commit in the same Apps Script invocation. The first invocation validates, parses, stages, and validates the persisted stage, then returns `BACKUP_PENDING`. It stores bounded metadata in the `CXP06_UAT_PIPELINE_STATE` Script Property and schedules `continueCxp06UatPipeline()`.

Preparation validates all five inputs once and records their registered order in `checkpoint.data.datasetNames`. Each backup continuation acquires the production lock and resumes the run-scoped group without rereading staging or all five raw sheets. A backup cursor step reads and verifies only its named raw/backup pair. Commit reconstructs and validates only the named staged dataset at `commitProgress.nextDatasetIndex`, verifies only that dataset's backup, replaces only its mapped raw sheet, flushes, rereads that raw sheet, and validates the durable result. After every successful step, the controller persists the cursor, last-completed dataset, heartbeat, and maximum observed step duration before considering more work.

Backup and commit workers share a 270,000 ms cooperative invocation budget. Before starting another dataset, the controller reserves the larger of the maximum observed step duration and a 60,000 ms cold-start allowance, plus a 15,000 ms handoff margin. If the reserve fits, the next dataset is processed immediately; otherwise the controller exits normally and schedules one `continueCxp06UatPipeline()` trigger. This adaptive packing removes avoidable one-minute waits while refusing to start work that is unlikely to finish before the 4-minute-30-second boundary. Every invocation is still guaranteed to attempt at least one cursor step. When all writes are checkpointed, final `RunService.resume()` performs the full flush, health/audit/SUCCESS confirmation, and cleanup without replaying raw replacements.

Hosted worker decisions are emitted as bounded `CXP06_WORKER_STEP` JSON records with `phase`, `datasetName`, `decision`, `durationMs`, `elapsedMs`, and `nextDatasetIndex`. `PACK_NEXT` means another step can safely start, `HANDOFF` means durable progress was saved and a continuation will be scheduled, and `PHASE_COMPLETE` means the cursor reached the end of its dataset order. The records never contain cell values or source rows.

Before every long phase, the controller also creates a one-time `continueCxp06UatPipeline()` safety trigger with a 420,000 ms delay; normal checkpointing or terminal completion removes it. The delay deliberately exceeds Apps Script's six-minute limit so the watchdog cannot execute while the invocation it guards is still running. Throughout the commit loop the persisted status stays `COMMITTING` and `updatedAtUtc` remains anchored at phase entry, so any invocation arriving within 6 minutes 15 seconds of that anchor defers instead of competing for the production lock. Every nonterminal handoff creates its successor first and only then deletes older same-handler triggers, retaining the successor by unique trigger ID. This prevents a durable pending checkpoint from being stranded in a delete-before-create gap. Trigger cleanup is handler-scoped and leaves at most one CXP-06 continuation installed.

If an invocation cannot acquire the production lock, `INGESTION_LOCK_TIMEOUT` is contention, not failure. The controller keeps the resumable pending status, records the bounded error code, and schedules one continuation 90,000 ms later. Judge a stopped run by `status`, never by the presence of `lastErrorCode`: a nonterminal status carrying `INGESTION_LOCK_TIMEOUT` with `continuationScheduled: true` is still progressing.

If status is `FAILED` with `lastErrorCode: MIGRATION_COMMIT_FAILED` and `lastErrorDetails.rollbackStatus: VERIFIED`, raw has been restored to the pre-run snapshot and the backup sheets have been deleted. After deploying a revision that includes DEC-045, rerun the same Case 1 entrypoint once. It recreates backups from the restored raw and commits all five datasets. Do not treat `originalErrorCode: MIGRATION_BACKUP_FAILED` in that record as a missing backup group from the first phase; it means a later `commitStep` compared an already-replaced raw sheet to its pre-run backup.

Run `getCxp06UatPipelineStatus()` to emit a sanitized `CXP06_STATUS` record containing the actual continuation-trigger presence, last completed backup dataset, and last completed commit dataset. Expected terminal state is `COMPLETE`; `FAILED` retains a bounded error code. If status is nonterminal but `continuationScheduled` is `false`, rerun the same main scenario entrypoint once. It preserves the checkpoint and installs one 60-second recovery trigger; it does not replay preparation. Rerunning the same scenario then resumes backup discovery, raw replacement from the saved cursor, or final verification from durable state. Do not start a different scenario while one is active.

Every hosted scenario start emits `CXP06_PIPELINE_START`; every time-driven or manual continuation emits `CXP06_PIPELINE_CONTINUE`. Both records contain the bounded returned status object. Failed status also retains an allowlisted `lastErrorDetails` object containing only operational fields such as `backupRunId`, `datasetName`, `originalErrorCode`, `reason`, and `rollbackStatus`. If `MIGRATION_ROLLBACK_FAILED` occurs, retain the backup sheets. After deploying the current revision, rerunning the same main scenario resets `commitProgress` to dataset 0 and recommits all five staged datasets against the retained original backup group. Do not delete the backup sheets manually.

If the continuation reports `MIGRATION_STAGE_VALIDATION_FAILED`, the persisted staging checkpoint is not safe to commit. After deploying the current source, rerun the same scenario entrypoint once; the controller re-runs preparation and creates a fresh checkpoint instead of retrying the rejected stage. Other checkpointed commit failures continue to resume from the existing checkpoint.

Checkpoint reconstruction canonicalizes Apps Script `Date` values back to the DatasetPayload ISO date/date-time contract and numeric-looking text cells back to strings before exact persisted-stage comparison. This preserves strict validation across invocations without treating spreadsheet-native value types as business-data changes.

Preparation calls `SpreadsheetApp.flush()` after persisted-stage validation and before publishing the checkpoint or scheduling backup work. The execution log must show `flushStage` as `STARTED` and `COMPLETED`; absence of the completed event means the checkpoint is not a durable handoff and must not be resumed.

## Case 1 — Peak successful replacement

1. Load the five maximum synthetic payloads through the supported CXP-05 adapter.
2. Run `cxp06UatCase1PeakSuccess()` once and confirm it returns `BACKUP_PENDING` with a continuation scheduled.
3. Allow time-driven continuations to progress through backup and commit. Multiple datasets may complete in one invocation. Confirm each `CXP06_WORKER_STEP` sequence follows the persisted cursor with no duplicate or skipped dataset and that every `HANDOFF` leaves exactly one successor trigger.
4. Allow the final `continueCxp06UatPipeline()` invocation to run. Confirm `getCxp06UatPipelineStatus()` reports `COMPLETE`, no continuation trigger remains, one logical SUCCESS run exists, and one SUCCESS ledger row is confirmed.
5. Confirm all five raw sheets have the canonical header plus expected record count.
6. Confirm `getFormulas()` is empty for every used raw cell.
7. Confirm no `_CXP06_BAK_` sheet remains, or record `backupCleanupStatus: PENDING` and continue with Case 5.
8. Record preparation, each backup/commit continuation, and finalization execution IDs and durations separately. The packet is not promoted if any invocation reaches 360 seconds, produces a quota failure, rereads unrelated datasets during a cursor step, or leaves a nonterminal state without a continuation. Compare invocation count and scheduler-wait time with the prior one-dataset-per-trigger evidence; both must decrease for this redesign to satisfy its hourly user-experience objective.

## Case 2 — Invalid staged data

1. Inject a controlled invalid header, formula-producing leading `=` value, invalid normalized date, duplicate key, or row-count mismatch in a synthetic stage.
2. Execute through `RunService`.
3. Confirm failure occurs in `VALIDATING_STAGE` with `MIGRATION_STAGE_VALIDATION_FAILED`.
4. Confirm the production lock was not entered, raw hashes/counts remain unchanged, and no backup was created.

## Case 3 — Mid-commit failure and rollback

1. Configure a DEV-only failure hook after the second raw dataset replacement.
2. Execute one synthetic run.
3. Confirm the run records a migration failure plus `rollbackStatus: VERIFIED`.
4. Confirm all five raw sheets, not only the first two, match their pre-run backup values and contain no formulas.
5. Confirm the backup group is deleted only after full restore verification.

## Case 4 — Health failure and rollback failure

1. Inject a post-write health mismatch and confirm all five raw sheets restore before lock release.
2. Separately inject a restore write or verification failure.
3. Confirm the second run reports `MIGRATION_ROLLBACK_FAILED`, retains the complete backup group, and exposes no cell data in errors/logs.
4. Stop promotion and manually investigate any rollback failure before another writer is allowed.

## Case 5 — Interrupted-run reconciliation and cleanup debt

Use an isolated non-production target with no `_CXP06_BAK_*` sheets before each controlled topology run. The seeder refuses dirty starting state and preserves existing recovery evidence. Use a fresh synthetic source fingerprint, or a separately initialized control ledger, for each scenario that must proceed past the duplicate checks.

1. Run `CASE5_INCOMPLETE_BACKUP`. Confirm it seeds one incomplete group under the existing lock, production reconciliation deletes it without restore, and the run proceeds to SUCCESS with no backup left after ordinary cleanup.
2. Start again from a clean target and run `CASE5_COMPLETE_UNSUCCESSFUL_BACKUP`. Confirm production reconciliation performs restore, verify, and delete for the complete unfinished group before the new duplicate check and backup. Confirm the new run reaches SUCCESS.
3. Start again from a clean target and run `CASE5_SUCCESSFUL_LEFTOVER_BACKUP`. Confirm the seeder appends and read-confirms the bounded synthetic SUCCESS row; production reconciliation must keep current raw, delete the committed leftover, and allow the new run to reach SUCCESS.
4. Separately inject post-success backup deletion failure with `CASE5_CLEANUP_FAILURE`. Confirm the successful raw result remains active, cleanup reports `PENDING`, and the next cleanly controlled run removes the leftover group.
5. Run `CASE5_TWO_COMPLETE_UNSUCCESSFUL_BACKUPS` last in an isolated test copy. Confirm `RUN_LOG` and `ERROR_LOG` report `MIGRATION_RECOVERY_FAILED`, production reconciliation chooses no restore order, and all ten backup sheets remain. Preserve them for investigation. Do not allow another writer until an authorized operator records manual cleanup; if cleanup is performed, resolve and remove only the ten inspected seed sheets.

For every topology scenario, capture `backupSheetNames`, `backupSheetCount`, terminal state, and sanitized error code from the harness evidence. `UAT_BACKUP_TOPOLOGY_SEED_FAILED` indicates setup refusal or failure rather than the production recovery outcome.

## Reader-visibility observation

During a controlled slowed commit, observe the workbook from a separate reader session and record whether intermediate raw-sheet states are visible. This observation does not turn the protocol into an atomic transaction; the production contract continues to make no multi-sheet reader-isolation guarantee.

## Promotion sign-off

CXP-06 hosted UAT is complete only when all cases have evidence, every preparation and continuation invocation completes within current quotas, every failure reaches the documented safe state, no raw formulas exist, and an authorized owner signs the DEV/UAT record. Otherwise packet implementation may remain repository-complete while deployment promotion remains blocked.
