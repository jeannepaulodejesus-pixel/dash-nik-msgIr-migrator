# CXP-14 Production Runbook

## Normal hourly refresh

1. RTA places the complete approved bundle in the controlled Inbox.
2. RTA opens the domain-restricted CXP-13 surface, confirms `READY`, and starts the exact displayed batch token.
3. The controller validates, stages, checkpoints, backs up, commits, recalculates, health-checks, audits, and cleans up across bounded continuations.
4. RTA waits for terminal `SUCCESS`, `DUPLICATE`, `VALIDATION_FAILED`, or `PROCESSING_ERROR`; a queued/processing state is not failure when a successor exists.
5. For success, confirm the active-data timestamp/Week Key and use Interval View/MOM. For any other state, follow the matching recovery path and keep the prior dataset active.

## Common outcomes

| Outcome | Action |
|---|---|
| `DUPLICATE` | Do not retry unchanged content; confirm the intended hourly bundle |
| `VALIDATION_FAILED` | Correct the named dataset/header/domain issue outside the workbook and submit a complete new bundle |
| Active nonterminal with successor | Monitor bounded status; do not start a competing run |
| Lock contention | Allow the 90-second backoff; escalate only if the successor disappears or the run stalls |
| `PROCESSING_ERROR` with verified rollback | Confirm last-known-good health, correct cause, then submit a new run |
| Rollback failed/ambiguous backups | Hold intake, preserve backups/evidence, invoke rollback operator |
| Stale data | Confirm last terminal run and Inbox/source availability; do not bypass validation |

## Weekly rollover

Use the CXP-12 lifecycle procedure. Refuse rollover while a run is active. Create/activate the new weekly instance idempotently, archive the prior week, align the target property to the one ACTIVE registry row, run HealthCheck, confirm maintenance trigger kinds, and verify RTA status before accepting the next bundle. Re-init must not clear live data.

## Monitoring and escalation

Monitor active Week Key, last terminal state/time, continuation presence, stale/health codes, cleanup debt, and permission/protection drift. Escalate immediately for any rollback trigger in [`docs/cxp14-rollback-checklist.md`](cxp14-rollback-checklist.md). Do not diagnose from source rows or expose environment identifiers in tickets/evidence.

## Production deployment

Follow [`docs/cxp14-deployment-checklist.md`](cxp14-deployment-checklist.md). Promotion changes configuration and clasp target, never source. The canary is the next approved real production bundle; synthetic fixtures run only in UAT or an isolated disposable target.

## Rollback

Follow [`docs/cxp14-rollback-checklist.md`](cxp14-rollback-checklist.md). Restore the prior immutable version and exact prior configuration from the secure operator-owned location, preserve forensic backup/audit evidence, and require health plus parity smoke checks before reopening.

## Evidence and privacy

Operational records may contain bounded statuses, error codes, counts, durations, digests, trigger kinds, and non-sensitive summaries. Never attach source rows, values, formulas, emails, filenames, spreadsheet/folder/file IDs, Script Property values, or secrets.

