# CXP-06 Controlled Backup-Topology Seeder Design

## Objective

Enable the four currently blocked Case 05 hosted UAT entrypoints to create deterministic stale-backup topologies and then exercise the production reconciliation path. The seeder exists only for controlled DEV/UAT validation and must not broaden production backup-management capabilities.

## Scope

The implementation covers these scenarios:

| Scenario | Seeded state before reconciliation | Expected reconciliation behavior |
|---|---|---|
| `CASE5_INCOMPLETE_BACKUP` | One backup group containing exactly one known dataset sheet | Delete the incomplete group without restoring raw data |
| `CASE5_COMPLETE_UNSUCCESSFUL_BACKUP` | One complete five-dataset group with no confirmed SUCCESS ledger row | Restore, flush, verify, and delete the group |
| `CASE5_SUCCESSFUL_LEFTOVER_BACKUP` | One complete five-dataset group with a confirmed synthetic SUCCESS ledger row for the same run ID | Keep current raw data and delete the committed leftover group |
| `CASE5_TWO_COMPLETE_UNSUCCESSFUL_BACKUPS` | Two complete groups with no confirmed SUCCESS ledger rows | Fail closed with `MIGRATION_RECOVERY_FAILED` and retain both groups |

The existing `CASE5_CLEANUP_FAILURE` behavior is unchanged. Manual cleanup tooling, production recovery administration, and arbitrary backup editing are outside scope.

## Safety Contract

The seeder is reachable only through `Cxp06UatHarness` after the existing environment gate confirms `CXP_ENV` is `DEV` or `UAT` and `CXP_UAT_ENABLED` is exactly `true`.

Seeding occurs under the same script lock used by the production commit path, immediately before production reconciliation. Before creating anything, the seeder discovers existing CXP-06 backup groups. If any `_CXP06_BAK_*` group or sheet already exists, it fails closed without deleting, renaming, restoring, or replacing that evidence. Malformed CXP-06 backup names also fail through the existing discovery contract.

Seed run IDs use a restricted `UATSEED_<scenario-token>_<unique-token>` form compatible with Apps Script sheet-name limits. A seed ID must never be reused. The seeder does not mutate raw sheets; complete backup groups are produced through `BackupRepository.createGroup()`, which copies, hides, protects, and verifies them.

If seeding fails after creating only part of the requested topology, the seeder retains the created sheets as diagnostic evidence and reports a sanitized UAT setup failure. It does not attempt speculative cleanup because that could erase the evidence needed to distinguish a platform failure from a recovery defect.

## Architecture

Add a UAT-only `Cxp06BackupTopologySeeder` module with a narrow interface:

```text
seed(scenario, context) -> immutable seed summary
```

Its dependencies are explicit: the production backup repository, the target spreadsheet for the one-sheet reduction required by the incomplete topology, the ledger repository for the successful-leftover marker, and a unique-token provider. It accepts only the four declared Case 05 scenario constants and rejects every other value.

`Cxp06UatHarness` injects a one-shot wrapper around the production reconciliation operation. The wrapper calls the seeder once and then invokes the unchanged production `RollbackService.reconcile()`. This places topology construction after lock acquisition and before the first discovery decision without adding seeding methods to `BackupRepository` or `RollbackService`.

The successful-leftover scenario writes the smallest valid synthetic SUCCESS record through the existing ledger repository interface and reads it back through `findSuccessfulByRunId()` before allowing reconciliation to continue. The record must be clearly attributable to hosted UAT and must not contain source cell data.

For the incomplete topology, the seeder first creates and verifies a complete group, then deletes four specifically identified backup sheets, leaving one deterministic dataset backup. It never deletes by wildcard or by an unresolved name.

## Execution and Evidence Flow

1. The parameterless Case 05 entrypoint invokes the harness.
2. The harness validates the DEV/UAT safety properties and builds normal hosted dependencies.
3. Normal validation, parsing, schema validation, duplicate checking, staging, and stage validation execute.
4. `RunService` acquires the production script lock and enters `COMMITTING`.
5. The one-shot UAT wrapper verifies that no backup topology already exists and seeds the requested topology.
6. The unchanged production reconciliation algorithm discovers and acts on the topology.
7. When reconciliation permits continuation, the ordinary duplicate recheck, backup, replacement, recalculation, health check, ledger confirmation, and cleanup sequence proceeds.
8. Evidence reports the scenario, terminal state, sanitized error code, backup count/names, and recovery/cleanup status without exposing workbook contents.

For `CASE5_TWO_COMPLETE_UNSUCCESSFUL_BACKUPS`, step 6 is expected to terminate the run with `MIGRATION_RECOVERY_FAILED`; both groups remain for operator inspection. A subsequent Case 05 run must refuse to seed until those retained groups are manually investigated and removed by an authorized operator.

## Error Handling

- Dirty starting topology: fail closed with a distinct sanitized UAT setup error before creating new backups.
- Unsupported scenario or invalid seed ID: fail before mutation.
- Backup creation/protection/verification failure: preserve any created evidence and surface the normalized backup/setup failure.
- Synthetic SUCCESS append or read-confirmation failure: stop before reconciliation and preserve the complete group.
- Expected ambiguous recovery: production `MIGRATION_RECOVERY_FAILED` remains authoritative.
- No error or evidence field may include cell values, formulas, source file IDs, or spreadsheet contents.

## Testing

Use a recorded red-green-refactor cycle through the highest practical harness seam.

Tests will establish:

- all four formerly blocked entrypoints reach orchestration;
- the seeder cannot run without the existing DEV/UAT safety gate;
- any pre-existing backup group causes a no-mutation refusal;
- complete groups are created through the production backup repository contract;
- the incomplete case deletes exactly four resolved backup sheets and retains the selected one;
- the successful-leftover case appends and confirms the seed SUCCESS record;
- the two-group case creates exactly two distinct complete groups;
- seeding happens once, after lock acquisition and immediately before reconciliation;
- normal production execution does not construct or invoke the seeder;
- the four scenarios produce their documented reconciliation outcomes and sanitized evidence;
- existing CXP-06 repository, rollback, orchestration, fault-injection, and peak-volume tests remain green.

Hosted verification must run in an isolated non-production workbook. The ambiguous two-group scenario intentionally leaves recovery evidence and therefore must be the final topology-seeding test in that workbook unless an authorized operator performs and records manual cleanup.

## Acceptance Criteria

The feature is accepted when all local tests and guardrails pass, the Apps Script deployment succeeds with user approval, and hosted runs demonstrate the four topology outcomes above without raw cell data in logs. Repository completion alone does not constitute hosted UAT completion.
