# CXP-10 Hosted UAT Runbook

**Planned contract** for operator succession; install, topology, parity, rollover, refresh, and promotion helpers are in `src/main/Cxp10UatEntrypoints.js`. Contract authority: [`CODEX_HANDOFF.md`](../CODEX_HANDOFF.md) (CXP-10), [`docs/metric-lineage.md`](metric-lineage.md), [`config/metric-lineage-contract.json`](../config/metric-lineage-contract.json). Harness: [`docs/cxp10-uat-harness.md`](cxp10-uat-harness.md). Pattern reference: [`docs/cxp09-uat-runbook.md`](cxp09-uat-runbook.md).

## Succession naming

Every successive operator process uses zero-padded **`CXP10UatStepNN(process)`** form:

- Document headings and evidence labels: `CXP10UatStep01`, `CXP10UatStep02`, …
- Editor helpers: `CXP10UatStep01Install`, `CXP10UatStep03LoadParityFixture`, …
- Ordered sub-steps inside a step: `CXP10UatStep03.1`, `CXP10UatStep03.2`, …

## Safety and prerequisites

Use a disposable DEV or UAT target initialized by CXP-02. Never point `CXP_ENV` at PROD. Configure the environment's target spreadsheet ID in Script Properties; do not record the ID in repository evidence.

Confirm CXP-09 install status is **`COMPLETE`** on the same target before starting CXP-10. The three aggregation sheets (`_AGG_INTERVAL`, `_AGG_FORECAST`, `_AGG_ALLOCATION`) must exist with CXP-09 formula topology. Interval View and MOM placeholders must exist from CXP-02.

Report surfaces:

| Sheet | Contract range | Primary role |
|---|---|---|
| `Interval View` | Band-Aid Internal View (`AA2` date, `A16:Z65` metrics) | Combined 25-metric operational report for Operations |
| `MOM` | Band-Aid calendar (`A1`/`Y1` titles, `B3` week start, `A5:A52` times) | Weekly dual-site FTE/volume/AHT input calendar |
| `_AGG_FORECAST` | `A2` bridge | Unpivots MOM calendar Required/Forecast grids into aggregation |

Fresh DEV pair (optional): set Script Property `CXP_DEV_BOOTSTRAP_FOLDER_ID`, run `bootstrapCxpDevWorkbooks()`, complete CXP-07 through CXP-09 on that target. See [`docs/configuration.md`](configuration.md).

## Install entrypoints

| Entrypoint | Purpose |
|---|---|
| `initializeCxp10ReportingSurfaces` | Start or resume checkpointed report install on the configured target |
| `continueCxp10ReportingSurfaces` | Time-driven or manual continuation from `CXP10_REPORTING_INSTALL_STATE` |
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

1. Confirm Interval View `B16:Z16` declares all 25 registry headers in contract order; `A16`=`PST`.
2. Confirm formula anchors exist at `A17` (`SEQUENCE` from `AA2+04:00`), metric columns `B17` through `Z17`, and Grand Total row `65` — no GETPIVOTDATA or legacy pivot references.
3. Confirm MOM matches Band-Aid: `A1`=`CHAT MNL`, `Y1`=`CHAT LV`, section labels on row 2, editable week-start `B3`, day-name row 4, and `SEQUENCE(48,…)` time axes at `A5`/`I5`/`Q5`/`Y5`/`AG5`/`AO5`.
4. Confirm `_AGG_FORECAST!A2` bridge references `MOM!$A$5:$A$52` (calendar unpivot), not a staging QUERY.
5. Confirm report formulas reference `_AGG_INTERVAL`, `_AGG_FORECAST`, and `_AGG_ALLOCATION` only — not `_CALC_*` or `_RAW_*`.

## CXP10UatStep03 — LoadParityFixture

**Helper:** `CXP10UatStep03LoadParityFixture`

Load aggregation inputs via the CXP-09 parity path, write fixture values into the Band-Aid MOM calendar grids, and set Interval View `AA2` / MOM `B3` anchors from the embedded report-parity fixture.

## CXP10UatStep04 — RecordParityOutputs

**Helper:** `CXP10UatStep04RecordParityOutputs`

1. Read combined-block outputs from Interval View `B17:Z54` and Grand Total row `65`.
2. Compare to fixture grains that fall on the Band-Aid axis (`04:00`–`22:30`). Midnight / prior-day `23:30` grains are off this page.
3. Confirm contract anomalies remain intentional (Handled zero/blank split, AHT Session divisor, Scheduled-to-Required summary guard).
4. Record pass or a documented CXP-01-rooted delta.

> After pulling Band-Aid Interval View layout fixes, run `CXP10UatStep07ReinstallTopology` before Step 03/04 so rows `16:65` rewrite (clears legacy `112:151`).

## CXP10UatStep05 — WeeklyRollover

**Helper:** `CXP10UatStep05WeeklyRollover`

1. Advance MOM week-start (`B3`) and Interval View View Date (`AA2`) by seven days.
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

Attach sanitized counts/timings only.
