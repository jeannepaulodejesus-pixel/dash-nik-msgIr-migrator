# CXP-10 Hosted UAT Runbook

**Planned contract** for operator succession; install + UAT helpers are landed for Steps 01, 02, and 08. Parity and refresh helpers remain planned. Contract authority: [`CODEX_HANDOFF.md`](../CODEX_HANDOFF.md) (CXP-10), [`docs/metric-lineage.md`](metric-lineage.md), [`config/metric-lineage-contract.json`](../config/metric-lineage-contract.json). Harness: [`docs/cxp10-uat-harness.md`](cxp10-uat-harness.md). Pattern reference: [`docs/cxp09-uat-runbook.md`](cxp09-uat-runbook.md).

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
| `Interval View` | `C112:AB151` | Combined 25-metric operational report for Operations |
| `MOM` | `A1`, `B4:H4`, `A13:E50` | Weekly manual forecast/required/staffing input calendar |
| `_AGG_FORECAST` | `A2` bridge | Reads MOM staging into aggregation |

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

1. Confirm Interval View `D112:AB112` declares all 25 registry headers in contract order.
2. Confirm formula anchors exist at `A113`, metric columns `D113` through `AB113`, and summary row `151` — no GETPIVOTDATA or legacy pivot references.
3. Confirm MOM week-start (`A1`), seven-day header row (`B4:H4`), and staging headers `A12:E12` exist.
4. Confirm `_AGG_FORECAST!A2` bridge QUERY references `MOM!A13:E50`.
5. Confirm report formulas reference `_AGG_INTERVAL`, `_AGG_FORECAST`, and `_AGG_ALLOCATION` only — not `_CALC_*` or `_RAW_*`.

## CXP10UatStep03 — LoadParityFixture

**Helper (planned):** `CXP10UatStep03LoadParityFixture`

Load synthetic aggregation outputs via the CXP-09 parity path (`tests/fixtures/cxp10/report-parity.json` builds on `tests/fixtures/cxp09/aggregation-parity.json`). Set Interval View business-day anchor and MOM week-start per fixture contract.

## CXP10UatStep04 — RecordParityOutputs

**Helper (planned):** `CXP10UatStep04RecordParityOutputs`

1. Read combined-block outputs from Interval View `D113:AB150` and summary row `151`.
2. Compare to literal expected values in the fixture at date + interval grain.
3. Confirm contract anomalies remain intentional (Handled zero/blank split, AHT Session divisor, Scheduled-to-Required summary guard).
4. Record pass or a documented CXP-01-rooted delta.

## CXP10UatStep05 — WeeklyRollover

**Helper (planned):** `CXP10UatStep05WeeklyRollover`

1. Advance MOM week-start and Interval View business-day anchor by seven days.
2. Confirm MOM `B4:H4` date headers roll forward.
3. Confirm Interval View axis and metric lookups refresh without reinstall.

## CXP10UatStep06 — SecondBundleRefresh

**Helper (planned):** `CXP10UatStep06SecondBundleRefresh`

Replace underlying raw/aggregation data without reinstalling report formulas. Confirm Interval View refreshes from aggregation dependency alone.

## CXP10UatStep07 — ReinstallTopology

**Helper (planned):** `CXP10UatStep07ReinstallTopology`

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
