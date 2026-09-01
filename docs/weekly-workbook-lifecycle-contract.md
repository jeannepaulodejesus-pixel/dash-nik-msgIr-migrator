# Weekly Workbook Lifecycle Contract (CXP-12)

Machine authority: `src/services/WorkbookLifecycleService.js`, `src/services/TriggerController.js`, `src/services/HealthCheck.js`, `src/services/PromotionChecklist.js`, `src/repository/WeekRegistryRepository.js`. Configuration authority: [`docs/configuration.md`](configuration.md). Skeleton authority: [`docs/workbook-skeleton.md`](workbook-skeleton.md). Design: [`docs/specs/2026-08-31-cxp12-weekly-workbook-lifecycle-design.md`](specs/2026-08-31-cxp12-weekly-workbook-lifecycle-design.md).

CXP-12 operationalizes the weekly active-template model: one master template per environment, one ACTIVE weekly target workbook, a durable `WEEK_REGISTRY`, maintenance triggers, health checks, and an approval-bound environment promotion checklist.

## Version authority

Contract version `1.0.0`. Provisional CXP-02 `WEEK_REGISTRY` headers are replaced by this write contract. Existing blank control workbooks are upgraded by the CXP-12 setup installer (rewrite row-1 headers; do not invent historical week rows).

## Week identity

| Field | Rule |
|---|---|
| Week Key | Monday ISO date `YYYY-MM-DD` for the operational week |
| Monday rule | Identical to `BusinessContextService` Monday derivation from a business day |
| Timezone | Workbook and script remain `Etc/GMT+8` (fixed PST); registry timestamps are UTC ISO strings |
| Uniqueness | One registry row per Week Key per control workbook; Status may transition |

## WEEK_REGISTRY write contract

Final headers (row 1), in order:

| Column | Name | Semantics |
|---|---|---|
| A | `Week Key` | Monday `YYYY-MM-DD` |
| B | `Target Spreadsheet ID` | Weekly instance ID (never logged in repository evidence) |
| C | `Master Template Spreadsheet ID` | Template used for the copy |
| D | `Registered At UTC` | ISO-8601 UTC timestamp of first successful registration |
| E | `Activated At UTC` | ISO-8601 UTC timestamp of last transition to `ACTIVE` |
| F | `Status` | `ACTIVE` \| `ARCHIVED` \| `FAILED` \| `SUPERSEDED` |
| G | `Notes` | Bounded operator/system note; no PII or raw cell values |

Exactly one row may hold `Status = ACTIVE`. Activating a new week archives or supersedes the previous ACTIVE row before the Script Property retarget commits.

### Status transitions

```text
(none) -> ACTIVE          createOrActivate success
(none) -> FAILED          copy/init failure after partial work
FAILED -> ACTIVE          idempotent retry for same Week Key
ACTIVE -> ARCHIVED        successful rollover to a later Week Key
ACTIVE -> SUPERSEDED      operator force-replace of the same Week Key
ARCHIVED/SUPERSEDED       terminal for normal automation
```

## Active workbook resolution

Runtime resolution order for ingestion and health:

1. Load `CXP_ENV` and `CXP_<ENV>_TARGET_SPREADSHEET_ID` through `Config.load()`.
2. Read the `ACTIVE` `WEEK_REGISTRY` row from the control workbook.
3. Require the Script Property ID and ACTIVE target ID to match.
4. On mismatch, fail closed with `LIFECYCLE_ACTIVE_TARGET_MISMATCH` and do not ingest.

Hard-coded spreadsheet IDs in source remain forbidden.

## Master template → weekly instance

1. Require `CXP_<ENV>_MASTER_TEMPLATE_SPREADSHEET_ID`.
2. Derive Week Key from the supplied business day or explicit Monday argument.
3. If an `ACTIVE` or retryable `FAILED` row already exists for that Week Key and points at a usable workbook, reuse it (idempotent).
4. Otherwise Drive-copy the master template to a new spreadsheet named with a non-sensitive week label.
5. Ensure CXP-02 sheet catalog and managed protections (ensure-only; never clear data sheets).
6. Seed week controls through `BusinessContextService` for the week's opening context.
7. Upsert `WEEK_REGISTRY`, archive prior ACTIVE if needed, and write `CXP_<ENV>_TARGET_SPREADSHEET_ID`.

Accidental rerun of step 5–6 on an already-active week must not overwrite `_RAW_*`, `_CALC_*`, `_AGG_*`, or report metric bodies. Only missing sheets/protections and explicitly requested anchor repairs are allowed.

## Trigger inventory

Time-driven triggers are maintenance-only. Primary hourly freshness remains user-triggered or source-triggered ingestion (CXP-06 / later CXP-13).

| Trigger kind | Purpose | Mutates production data? |
|---|---|---|
| `HEALTH_CHECK` | Sheet presence, last-run, freshness, recalc readiness | No (status only) |
| `STALE_DATA` | Threshold breach signal when last SUCCESS is too old | No |
| `CLEANUP` | Temporary/orphan artifact cleanup via existing seams | Temp artifacts only |
| `INBOX_POLL` | Optional inbox presence signal | No commit |
| `WEEKLY_ROLLOVER` | Create/activate next Week Key during the approved window | Yes — registry + target property |

Handlers are idempotent, lock-guarded, and budget-bounded. Exact wake time is not guaranteed.

## Health check contract

`HealthCheck.evaluate(options?)` returns a sanitized object:

| Field | Meaning |
|---|---|
| `healthy` | Aggregate boolean |
| `activeWeekKey` | ACTIVE Week Key or `null` |
| `registryPropertyAligned` | ACTIVE ID matches Script Property |
| `missingSheets` | Ordered list of missing required sheet names |
| `lastRunState` | Last terminal `RUN_LOG` state or `NONE` |
| `lastSuccessAgeMinutes` | Minutes since last SUCCESS, or `null` |
| `stale` | `true` when age exceeds configured threshold |
| `recalcReady` | Post-commit health/flush readiness signal |
| `codes` | Stable reason codes for failures |

Default stale threshold is proposed as 90 minutes after the expected hourly refresh window; the exact Script Property key is `CXP_<ENV>_STALE_DATA_THRESHOLD_MINUTES` (optional; default applied when absent).

## Environment promotion checklist

Promotion changes Script Properties and clasp target only. Required evidence before UAT or PROD:

1. Source tree verified (`npm run verify` / packet tests) on the releasing commit.
2. All required environment keys present for the destination environment.
3. Master template ID set and openable by the effective deployment identity.
4. Control workbook contains final `WEEK_REGISTRY` headers and at most one ACTIVE row after smoke create/activate.
5. HealthCheck returns `healthy: true` on the destination after smoke ingestion or fixture path.
6. Trigger inventory installed and listed (kinds only; no IDs in evidence).
7. PROD additionally requires explicit operator acknowledgment recorded in the hosted results file.

CXP-12 does not authorize unattended PROD clasp push; CXP-14 owns cutover.

## Error taxonomy (packet-owned)

| Code | Meaning |
|---|---|
| `LIFECYCLE_TEMPLATE_NOT_CONFIGURED` | Missing master template property |
| `LIFECYCLE_TEMPLATE_UNREADABLE` | Template cannot be opened/copied |
| `LIFECYCLE_WEEK_KEY_INVALID` | Week Key failed Monday/ISO validation |
| `LIFECYCLE_ACTIVE_TARGET_MISMATCH` | Registry ACTIVE ≠ Script Property target |
| `LIFECYCLE_ROLLOVER_LOCKED` | Ingestion lock held / run not terminal |
| `LIFECYCLE_ALREADY_ACTIVE` | Idempotent no-op for same Week Key (informational) |
| `LIFECYCLE_INIT_REFUSED_LIVE_DATA` | Destructive init path refused |
| `HEALTH_MISSING_SHEETS` | Required catalog sheets absent |
| `HEALTH_LAST_RUN_FAILED` | Latest terminal run is a failure state |
| `HEALTH_STALE_DATA` | Freshness threshold breached |
| `HEALTH_RECALC_NOT_READY` | Recalculation/health seam not ready |
| `PROMOTION_CHECKLIST_INCOMPLETE` | Destination env missing required gates |

## Privacy and evidence

Never commit or attach spreadsheet IDs, folder IDs, user emails, source rows, or cell values. Hosted evidence records Week Keys, statuses, health codes, timings, and trigger kinds only.

## Non-goals

- Daily workbook files.
- Retaining hourly upload payloads for scheduler history.
- Bound script copies inside weekly spreadsheets.
- RTA sidebar/UI (CXP-13) and production cutover runbook (CXP-14).
