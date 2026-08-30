# CXP-10 Hosted UAT Runbook

Latest DEV result: **Pass**, August 31, 2026. See [`cxp10-hosted-uat-results-2026-08-31.md`](cxp10-hosted-uat-results-2026-08-31.md).

**Planned contract** for operator succession; install, topology, parity, rollover, refresh, and promotion helpers are in `src/main/Cxp10UatEntrypoints.js`. Contract authority: [`CODEX_HANDOFF.md`](../CODEX_HANDOFF.md) (CXP-10), [`docs/metric-lineage.md`](metric-lineage.md), [`config/metric-lineage-contract.json`](../config/metric-lineage-contract.json). Harness: [`docs/cxp10-uat-harness.md`](cxp10-uat-harness.md). Pattern reference: [`docs/cxp09-uat-runbook.md`](cxp09-uat-runbook.md).

## Succession naming

Every successive operator process uses zero-padded **`CXP10UatStepNN(process)`** form:

- Document headings and evidence labels: `CXP10UatStep01`, `CXP10UatStep02`, …
- Editor helpers: `CXP10UatStep01Install`, `CXP10UatStep03LoadParityFixture`, …
- Ordered sub-steps inside a step: `CXP10UatStep03.1`, `CXP10UatStep03.2`, …

## Safety and prerequisites

Use a disposable DEV or UAT target initialized by CXP-02. Never point `CXP_ENV` at PROD. Configure the environment's target spreadsheet ID in Script Properties; do not record the ID in repository evidence.

Confirm CXP-09 install status is **`COMPLETE`** on the same target before starting CXP-10. The three aggregation sheets (`_AGG_INTERVAL`, `_AGG_FORECAST`, `_AGG_ALLOCATION`) must exist with CXP-09 formula topology. Interval View and MOM placeholders must exist from CXP-02.

Business-context ownership is shared with CXP-08: `businessDay` is written to `Interval View!AA2`, its Monday `weekStart` to `MOM!B3`, and `staffDay` to `_CALC_STAFF!BE1`. Snapshot all three before rollout. Dates must be exact `YYYY-MM-DD` values; timestamps, blanks, impossible dates, and spreadsheet error tokens are rejected before any anchor write.

Report surfaces:

| Sheet | Contract range | Primary role |
|---|---|---|
| `Interval View` | Control-derived view (`AA2` date, `B97:AB151` owned block) | Combined 25-metric operational report for Operations |
| `MOM` | Band-Aid calendar (`A1`/`Y1` titles, `B3` week start, `A5:A52` times) | Weekly dual-site FTE/volume/AHT input calendar |
| `_AGG_FORECAST` | `A2` bridge | Unpivots MOM calendar Required/Forecast grids into aggregation |

Fresh DEV pair (optional): set Script Property `CXP_DEV_BOOTSTRAP_FOLDER_ID`, run `bootstrapCxpDevWorkbooks()`, complete CXP-07 through CXP-09 on that target. See [`docs/configuration.md`](configuration.md).

## Install entrypoints

| Entrypoint | Purpose |
|---|---|
| `initializeCxp10ReportingSurfaces` | Start or resume checkpointed report install on the configured target |
| `continueCxp10ReportingSurfaces` | Time-driven or manual continuation from `CXP10_REPORTING_INSTALL_STATE_V2` |
| `getCxp10ReportingSurfaceStatus` | Sanitized status (`IDLE` / `RUNNING` / `COMPLETE` / `FAILED`) |
| `resetCxp10ReportingInstallationState` | Clear stuck or wrong-target `RUNNING` state |
| `diagnoseCxp10RunbookChecks` | Interval View / MOM / forecast-bridge diagnostic |

## Evidence rules

Record sanitized counts, timings, execution outcome, and formula-error **kinds** only. Never attach source rows, spreadsheet IDs, user emails, or formula error values containing business data.

---

## CXP10UatStep01 — Install

**Helper:** `CXP10UatStep01Install`

1. Push the verified `src/` tree to the non-production Apps Script project.
2. Confirm CXP-09 status is `COMPLETE` on the configured target.
3. Run `initializeCxp10ReportingSurfaces()` once.
4. Poll `getCxp10ReportingSurfaceStatus()` until `COMPLETE`. Resume with `continueCxp10ReportingSurfaces()` on Sheets timeouts.

## CXP10UatStep02 — InspectTopology

**Helper:** `CXP10UatStep02InspectTopology`

1. Confirm Interval View `D112:AB112` declares all 25 registry headers in contract order; `B112`=`Remarks`, `C112`=`PST`.
2. Confirm formula anchors exist at `A17` (`SEQUENCE` from `AA2` midnight), helper keys `AB17`/`AC17`, metric columns `B17` through `Z17`, and Grand Total row `65` — no GETPIVOTDATA or legacy pivot references.
3. Confirm MOM matches Band-Aid: `A1`=`CHAT MNL`, `Y1`=`CHAT LV`, section labels on row 2, editable week-start `B3`, day-name row 4, and `SEQUENCE(48,…)` time axes at `A5`/`I5`/`Q5`/`Y5`/`AG5`/`AO5`.
4. Confirm `_AGG_FORECAST!A2` bridge references `MOM!$A$5:$A$52` (calendar unpivot), not a staging QUERY.
5. Confirm report formulas reference `_AGG_INTERVAL`, `_AGG_FORECAST`, and `_AGG_ALLOCATION` only — not `_CALC_*` or `_RAW_*`.

## CXP10UatStep03 — LoadParityFixture

**Helper:** `CXP10UatStep03LoadParityFixture`

Load aggregation inputs via the CXP-09 parity path, write fixture values into the Band-Aid MOM calendar grids, and apply all three business-context anchors from the embedded report-parity fixture. `weekStart` is derived as Monday and `staffDay` defaults to `businessDay`.

## CXP10UatStep04 — RecordParityOutputs

**Helper:** `CXP10UatStep04RecordParityOutputs`

1. Read combined-block outputs from Interval View `D113:AB150` and Grand Total row `151`.
2. Compare to fixture grains that fall on the exact control axis (`04:00`–`22:30`). Prior-day `23:30` grains are off this page.
3. Confirm contract anomalies remain intentional (Handled zero/blank split, AHT Session divisor, Scheduled-to-Required summary guard).
4. Record pass or a documented CXP-01-rooted delta.

> After deploying the v2 layout, reset the old installer state once and run `CXP10UatStep07ReinstallTopology` before Step 03/04. Reinstall rewrites only `B97:AB151` and preserves `AA2` and MOM manual inputs.

## CXP10UatStep05 — WeeklyRollover

**Helper:** `CXP10UatStep05WeeklyRollover`

1. Advance the validated business context by seven days: Interval View `AA2`, MOM `B3`, and Staff `BE1`.
2. Confirm MOM date mirrors (`C3:H3` and LV blocks) roll forward from `B3`.
3. Confirm Interval View axis and metric lookups refresh without reinstall.

## CXP10UatStep06 — SecondBundleRefresh

**Helper:** `CXP10UatStep06SecondBundleRefresh`

Replace underlying raw/aggregation data without reinstalling report formulas. Confirm Interval View refreshes from aggregation dependency alone.

## CXP10UatStep07 — ReinstallTopology

**Helper:** `CXP10UatStep07ReinstallTopology`

Re-run the installer after `COMPLETE`. Confirm headers, anchors, and bounds restore.

## CXP10UatStep08 — PromotionGate

**Helper:** `CXP10UatStep08PromotionGate`

Promotion requires:

1. CXP-09 remains `COMPLETE` on the same target.
2. Successful continuation when checkpoint budget is reached (`CXP10UatStep01`).
3. 25-metric headers, aggregation-only references, and complete report outputs (`CXP10UatStep02`).
4. Representative parity or documented CXP-01-rooted delta (`CXP10UatStep04`).
5. Weekly rollover behavior (`CXP10UatStep05`).
6. Second-bundle refresh without reinstall (`CXP10UatStep06`).
7. Clean reinstall topology (`CXP10UatStep07`).
8. Zero formula errors, exact axis/layout/totals, and passing on-axis parity in the promotion gate.

The gate validates business context before output evaluation. Invalid anchors return one `BUSINESS_CONTEXT_ANCHOR_INVALID` root result, set parity to `skipped: true` with reason `INVALID_BUSINESS_CONTEXT`, and skip the downstream formula-error scan. Reapply the approved context through Step 03, then rerun Steps 04 and 08; never repair only one anchor independently. Rollback restores the snapshotted `AA2`, `B3`, and `BE1` values after reverting code.

Step 05 intentionally leaves the context advanced by seven days. Before Step 08, rerun Step 03 so the complete context and the date-bound CXP09 interaction fixture both return to `2026-08-18`. If the anchors are individually valid but do not match the parity fixture, the gate returns one skipped parity result with reason `FIXTURE_CONTEXT_MISMATCH` instead of listing propagated metric differences.

Attach sanitized counts/timings only.
