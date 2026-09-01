# CXP-12 Hosted UAT Runbook

**Planned contract** for operator succession. Helpers will live in `src/main/Cxp12Setup.js`, `src/main/Cxp12UatEntrypoints.js`, and lifecycle services under `src/services/`. Contract authority: [`docs/weekly-workbook-lifecycle-contract.md`](weekly-workbook-lifecycle-contract.md). Design: [`docs/specs/2026-08-31-cxp12-weekly-workbook-lifecycle-design.md`](specs/2026-08-31-cxp12-weekly-workbook-lifecycle-design.md). Harness: [`docs/cxp12-uat-harness.md`](cxp12-uat-harness.md). Pattern reference: [`docs/cxp11-uat-runbook.md`](cxp11-uat-runbook.md).

## Succession naming

Every successive operator process uses zero-padded **`CXP12UatStepNN(process)`** form:

- Document headings and evidence labels: `CXP12UatStep00`, `CXP12UatStep01`, …
- Editor helpers: `CXP12UatStep01InstallRegistry`, `CXP12UatStep06WeeklyRollover`, …
- Ordered sub-steps inside a step: `CXP12UatStep04.1`, `CXP12UatStep04.2`, …

## Safety and prerequisites

Use disposable DEV or UAT properties. Never point `CXP_ENV` at PROD for these helpers. Configure control, master-template, and (after activate) target spreadsheet IDs in Script Properties; do not record any ID in repository evidence.

Confirm:

- CXP-02 skeleton conventions are available.
- CXP-04 run/lock surfaces are present on the control workbook.
- CXP-06 ingestion can target the ACTIVE workbook after alignment.
- CXP-10 `BusinessContextService` is available for week-control seeding.
- `CXP_<ENV>_MASTER_TEMPLATE_SPREADSHEET_ID` points at an operator-prepared master template.

CXP-12 may rewrite `CXP_<ENV>_TARGET_SPREADSHEET_ID` during create/activate/rollover. Snapshot the prior target ID outside the repo if you need to restore a disposable book.

## Evidence rules

Record Week Keys, registry statuses, health codes, timings, and trigger kinds only. Never attach spreadsheet IDs, folder IDs, user emails, source rows, or cell values.

---

## CXP12UatStep00 — VerifyPrerequisites

**Helper:** `CXP12UatStep00VerifyPrerequisites`

**Gate:** Dependencies and configuration ready.

1. Push the verified `src/` tree to the non-production Apps Script project.
2. Confirm `controlConfigured` and `masterTemplateConfigured` are `true`.
3. Confirm upstream readiness flags for CXP-02 / CXP-04 / CXP-06 / CXP-10 as exposed by the helper.
4. Confirm `CXP_ENV` is `DEV` or `UAT`.

## CXP12UatStep01 — InstallRegistry

**Helper:** `CXP12UatStep01InstallRegistry`

**Gate:** Final `WEEK_REGISTRY` headers installed.

1. Run `initializeCxp12Lifecycle()` once.
2. Poll setup status until `COMPLETE`. Resume on Sheets timeouts.
3. Confirm row-1 headers match the lifecycle contract, including `Activated At UTC`.
4. Reinstall is safe: headers rewrite; existing week rows are preserved unless a documented repair path says otherwise.

## CXP12UatStep02 — CreateOrActivateWeek

**Helper:** `CXP12UatStep02CreateOrActivateWeek`

**Gate:** Idempotent weekly instance registered `ACTIVE`.

1. Choose a disposable Week Key (Monday `YYYY-MM-DD`) for the hosted run.
2. Run create/activate once; confirm Status `ACTIVE` and `Registered At UTC` / `Activated At UTC` populated.
3. Run create/activate again for the same Week Key; confirm idempotent reuse (`LIFECYCLE_ALREADY_ACTIVE` or equivalent no-op) with no second ACTIVE row.

## CXP12UatStep03 — AlignActiveTarget

**Helper:** `CXP12UatStep03AlignActiveTarget`

**Gate:** Script Property matches ACTIVE registry row.

1. Confirm `registryPropertyAligned: true` from `getActiveWeeklyWorkbook` / health.
2. Negative control (disposable only): break alignment deliberately in the helper's sandbox path and confirm `LIFECYCLE_ACTIVE_TARGET_MISMATCH`, then repair.

## CXP12UatStep04 — HealthCheck

**Helper:** `CXP12UatStep04HealthCheck`

**Gate:** Healthy baseline; injected faults detectable without reading code.

1. Run health on the aligned ACTIVE week; confirm `healthy: true`.
2. Sub-step 04.1 — missing sheet detection returns `HEALTH_MISSING_SHEETS`.
3. Sub-step 04.2 — failed last-run fixture returns `HEALTH_LAST_RUN_FAILED`.
4. Sub-step 04.3 — stale threshold fixture returns `HEALTH_STALE_DATA`.
5. Restore baseline health before continuing.

## CXP12UatStep05 — TriggerInventory

**Helper:** `CXP12UatStep05TriggerInventory`

**Gate:** Maintenance triggers installed; primary ingestion is not timer-driven.

1. Install the maintenance inventory.
2. List kinds only: expect `HEALTH_CHECK`, `STALE_DATA`, `CLEANUP`, optional `INBOX_POLL`, and `WEEKLY_ROLLOVER`.
3. Confirm no trigger handler performs CXP-06 commit as its primary path.
4. Confirm handlers are idempotent when invoked twice in succession (bounded log evidence).

## CXP12UatStep06 — WeeklyRollover

**Helper:** `CXP12UatStep06WeeklyRollover`

**Gate:** Next Week Key activates; prior week `ARCHIVED`; prior book data preserved.

1. Seed a marker value on a disposable raw cell of the current ACTIVE week (UAT-only fixture).
2. Activate the next Monday Week Key.
3. Confirm prior row is `ARCHIVED`, new row is `ACTIVE`, and the Script Property points at the new book.
4. Re-open the archived workbook marker and confirm it still exists (no destructive wipe).
5. Confirm rollover refuses when a non-terminal ingestion lock is held (`LIFECYCLE_ROLLOVER_LOCKED`).

## CXP12UatStep07 — ReinitSafety

**Helper:** `CXP12UatStep07ReinitSafety`

**Gate:** Accidental re-init does not clear live raw data.

1. On the ACTIVE week, ensure a known raw fixture row exists.
2. Re-run week-control initialization / ensure-only skeleton path.
3. Confirm the raw fixture row remains and `LIFECYCLE_INIT_REFUSED_LIVE_DATA` (or ensure-only no-op) is observed rather than a destructive clear.

## CXP12UatStep08 — PromotionGate

**Helper:** `CXP12UatStep08PromotionGate`

**Gate:** Checklist complete; `promotionReady: true`.

Promotion requires all of:

1. Prerequisites verified (`CXP12UatStep00`).
2. `WEEK_REGISTRY` final headers installed (`CXP12UatStep01`).
3. Idempotent ACTIVE registration (`CXP12UatStep02`).
4. Registry/property alignment (`CXP12UatStep03`).
5. Health baseline plus detectable fault codes (`CXP12UatStep04`).
6. Maintenance-only trigger inventory (`CXP12UatStep05`).
7. Weekly rollover with archived-week data preserved (`CXP12UatStep06`).
8. Re-init safety (`CXP12UatStep07`).
9. Destination environment key checklist complete without source edits.

The gate returns `promotionReady: false` with the specific failing input. Record hosted results with [`docs/cxp12-hosted-uat-results-template.md`](cxp12-hosted-uat-results-template.md).

## Failure triage

| Code | Meaning | Operator action |
|---|---|---|
| `LIFECYCLE_TEMPLATE_NOT_CONFIGURED` | Missing master template property | Set `CXP_<ENV>_MASTER_TEMPLATE_SPREADSHEET_ID` |
| `LIFECYCLE_TEMPLATE_UNREADABLE` | Template cannot be opened/copied | Fix sharing / ID |
| `LIFECYCLE_WEEK_KEY_INVALID` | Not a Monday ISO date | Pass Monday `YYYY-MM-DD` |
| `LIFECYCLE_ACTIVE_TARGET_MISMATCH` | ACTIVE ≠ Script Property | Run align/repair helper |
| `LIFECYCLE_ROLLOVER_LOCKED` | Ingestion not terminal | Wait for run completion |
| `LIFECYCLE_INIT_REFUSED_LIVE_DATA` | Destructive path blocked | Expected on live week; use ensure-only |
| `HEALTH_MISSING_SHEETS` | Catalog gap | Re-run CXP-02 ensure on that book |
| `HEALTH_LAST_RUN_FAILED` | Latest terminal run failed | Inspect `RUN_LOG` / `ERROR_LOG` |
| `HEALTH_STALE_DATA` | Freshness breach | Run supported ingestion path |
| `HEALTH_RECALC_NOT_READY` | Post-commit health not ready | Retry after flush/health seam |
| `PROMOTION_CHECKLIST_INCOMPLETE` | Destination gates missing | Complete checklist items |

## Manual override procedures

| Situation | Override |
|---|---|
| Wrong ACTIVE week | Archive current ACTIVE, activate the intended Week Key, confirm alignment |
| Orphan copy after failed register | Mark/create `FAILED` row notes; retry create/activate for same Week Key |
| Need prior week read-only | Leave `ARCHIVED`; do not retarget PROD property without checklist |
| Disable timers | Remove maintenance triggers via TriggerController; ingestion remains manually available |
| PROD promotion | Complete checklist + explicit acknowledgment; CXP-14 owns cutover push |
