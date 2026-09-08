# CXP-14 Production Rollback Checklist

## Trigger

Rollback immediately for a timeout/quota error, unexplained critical parity delta, missing/duplicate audit, ACTIVE-target mismatch, permission/protection failure, competing continuation writer, or rejected/failed input changing the last-known-good dataset.

## Stabilize

- [ ] Stop new intake and record the safe bounded reason/time.
- [ ] Determine whether a run is active; do not retarget or delete triggers mid-commit.
- [ ] Allow documented recovery to settle or invoke the approved stop procedure.
- [ ] Preserve RUN_LOG, ERROR_LOG, FILE_LEDGER, pipeline state, and unresolved complete backup groups.
- [ ] Notify stop authority, support, release operator, and validators.

## Restore

- [ ] Resolve the exact prior immutable deployment version.
- [ ] Read exact prior configuration values from the secure operator-owned location outside the repository.
- [ ] Restore the prior source version and configuration through the approved operator boundary.
- [ ] Verify restored values without copying them into logs or repository files.
- [ ] Reconcile retained CXP-06 backups; never guess restore order for ambiguous complete groups.
- [ ] Remove only handler-scoped orphan continuations after confirming no active writer.

## Verify before reopen

- [ ] Target property matches the ACTIVE registry row.
- [ ] HealthCheck passes and stale-data state is understood.
- [ ] Maintenance trigger inventory is correct; no duplicate continuation remains.
- [ ] RUN_LOG/ERROR_LOG/FILE_LEDGER reconcile to one logical outcome per attempt.
- [ ] Last-known-good report remains usable and bounded formula/error scan passes.
- [ ] Parity smoke check has zero unexplained critical delta.
- [ ] Rollback operator and stop authority approve reopening.

Record elapsed recovery time, restored version, safe statuses, remaining backup/cleanup debt, impact, and follow-up. Never record IDs, source data, formulas, emails, or exact configuration values.

