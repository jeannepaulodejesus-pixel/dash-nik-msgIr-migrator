# CXP-12 Hosted DEV UAT Results — 2026-08-31

Copy source: [`docs/cxp12-hosted-uat-results-template.md`](cxp12-hosted-uat-results-template.md). Runbook: [`docs/cxp12-uat-runbook.md`](cxp12-uat-runbook.md). Harness: [`docs/cxp12-uat-harness.md`](cxp12-uat-harness.md).

Record Week Keys, statuses, health codes, timings, and trigger kinds only. Never attach spreadsheet IDs, folder IDs, user emails, source rows, or cell values.

## Outcome

**Pass.** `CXP12UatStep08PromotionGate` returned `promotionReady: true` on DEV after Steps 00–08. Fixture weeks: `2026-08-17` → rollover `2026-08-24`. Setup reached `COMPLETE` (2/2). Five maintenance triggers installed; no primary ingest timer.

## Environment

| Field | Value |
|---|---|
| Date (UTC) | Operator local 2026-08-31 evening (UTC+1); promotion log ~20:31 local |
| Environment | DEV |
| Lifecycle contract version | `1.0.0` |
| Upstream packets | CXP-02 / CXP-04 / CXP-06 / CXP-10 complete on the same control plane |
| Local evidence | `npm run test:cxp12` 14/14; `npm run verify` previously 279/279 for CXP-12-v1 |

## Step results

| Step | Entrypoint | Result | Evidence |
|---|---|---|---|
| 00 — VerifyPrerequisites | `CXP12UatStep00VerifyPrerequisites` | Pass | `controlConfigured: true`, `environment: DEV`, `masterTemplateConfigured: true` (after master-template property set) |
| 01 — InstallRegistry | `CXP12UatStep01InstallRegistry` | Pass | `CXP12_SETUP` `COMPLETE` 2/2 |
| 02 — CreateOrActivateWeek | `CXP12UatStep02CreateOrActivateWeek` | Pass | Week Key `2026-08-17` `ACTIVE` (`created_from_template`) |
| 03 — AlignActiveTarget | `CXP12UatStep03AlignActiveTarget` | Pass | `registryPropertyAligned: true` |
| 04 — HealthCheck | `CXP12UatStep04HealthCheck` | Pass | `baselineHealthy: true`, `codes: []` |
| 05 — TriggerInventory | `CXP12UatStep05TriggerInventory` | Pass | `totalMaintenance: 5`, `primaryIngestDetected: false` |
| 06 — WeeklyRollover | `CXP12UatStep06WeeklyRollover` | Pass (retest) | `activeWeekKey: 2026-08-24`, `priorStatus: ARCHIVED`, `markerPreserved: true` |
| 07 — ReinitSafety | `CXP12UatStep07ReinitSafety` | Pass | `liveDataPreserved: true` |
| 08 — PromotionGate | `CXP12UatStep08PromotionGate` | Pass (retest) | `missing: []`, `promotionReady: true` |

## Acceptance criteria

| Criterion | Result | Note |
|---|---|---|
| Weekly workbook created/registered idempotently from master template | Pass | Step 02 create; later activate paths reused registry |
| Ingestion resolves registered ACTIVE workbook via configuration | Pass | Step 03 alignment |
| Stale or failed pipeline detectable via HealthCheck | Pass | Step 04 healthy baseline; fault codes covered locally |
| DEV/UAT/PROD checklist promotable without source edits | Pass | Step 08 DEV gate; PROD ack required only for PROD (local) |
| Accidental re-init does not clear live data | Pass | Step 07 |
| Maintenance triggers only (no primary ingest timer) | Pass | Five kinds; `primaryIngestDetected: false` |
| Weekly rollover archives prior week and preserves its data | Pass | Step 06 after marker-cell fix |
| Promotion gate passed | Pass | `promotionReady: true` |

## Registry / health snapshot

| Field | Value |
|---|---|
| Setup state key | `CXP12_LIFECYCLE_SETUP_STATE_V1` |
| Setup final status | `COMPLETE` (2/2) |
| Active Week Key | `2026-08-24` |
| Prior Week Key (after rollover) | `2026-08-17` |
| Prior status | `ARCHIVED` |
| Health `healthy` | `true` (Step 04 / Step 08) |
| Health codes exercised | Hosted baseline empty; fault codes covered in `tests/cxp12-weekly-lifecycle.test.cjs` |
| Trigger kinds installed | `HEALTH_CHECK`, `STALE_DATA`, `CLEANUP`, `INBOX_POLL`, `WEEKLY_ROLLOVER` |

## Findings and corrections

| Finding | Root cause | Correction | Retest result |
|---|---|---|---|
| Step 00 failed until master template configured | Script property pointed at target, not a Drive master template | Operator created DEV master via bootstrap helper; set `CXP_DEV_MASTER_TEMPLATE_SPREADSHEET_ID` | Step 00 pass |
| Step 06 `markerPreserved: false` despite archive/activate | Marker seeded only when `_RAW_HANDLED` had &lt; 2 rows; template copies already had data | Always seed/read reserved `_RAW_HANDLED!AX1` | Step 06 pass |
| Step 08 `LIFECYCLE_CONTROL_UNAVAILABLE` from TriggerController | `promotionGate` did not wire hosted `ScriptApp` / health ports | Use `resolveHostedTriggerPorts` + `evaluateHostedHealth` | Step 08 pass |
| `RUN_LOG` rows used bare `cxp12-uat-success` placeholders | Health seed wrote minimal rows outside `RunLogger` / `RunRepository` | Seed idempotent `CXP12-UAT-HEALTH-SEED` via `RunRepository.persistOnce` with actor, source file, target ID, counts, and state history | Re-run Step 04 or 08 once after clasp push |

## Sign-off

- **Packet status:** Complete
- **Delivery version:** `CXP-12-v1`
- **Known limitations:** DEV fixture Week Keys (`2026-08-17` / `2026-08-24`) are UAT constants, not a permanent business calendar. This run does not change UAT/PROD Script Properties. Extra Drive copies may exist from Step 06 retests. Hosted trigger *delivery* (timer fire) was not separately observed—inventory install only.
- **Blockers:** None for CXP-12.
