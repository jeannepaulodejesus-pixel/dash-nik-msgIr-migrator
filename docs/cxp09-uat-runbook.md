# CXP-09 Hosted UAT Runbook

Latest DEV result: **Pass**, August 31, 2026. The installer completed 23/23 steps and the promotion gate returned `pass: true`. See [`cxp09-hosted-uat-results-2026-08-31.md`](cxp09-hosted-uat-results-2026-08-31.md).

**Planned contract** for operator succession; install + UAT helpers are landed for Steps 01, 02, and 08. Parity, peak, and refresh helpers remain planned. Contract authority: [`CODEX_HANDOFF.md`](../CODEX_HANDOFF.md) (CXP-09), [`docs/metric-lineage.md`](metric-lineage.md), [`config/metric-lineage-contract.json`](../config/metric-lineage-contract.json), [`docs/dependency-map.md`](dependency-map.md). Harness: [`docs/cxp09-uat-harness.md`](cxp09-uat-harness.md). Pattern reference: [`docs/cxp08-uat-runbook.md`](cxp08-uat-runbook.md).

## Succession naming

Every successive operator process uses zero-padded **`CXP09UatStepNN(process)`** form:

- Document headings and evidence labels: `CXP09UatStep01`, `CXP09UatStep02`, …
- Planned editor helpers: `CXP09UatStep01Install`, `CXP09UatStep03LoadParityFixture`, … (Step id + PascalCase process)
- Ordered sub-steps inside a step: `CXP09UatStep03.1`, `CXP09UatStep03.2`, …

Shared front matter below is not a succession step.

## Safety and prerequisites

Use a disposable DEV or UAT target initialized by CXP-02. Never point `CXP_ENV` at PROD for this run. Configure the environment's target spreadsheet ID in Script Properties; do not record the ID in repository evidence.

Confirm CXP-07 and CXP-08 are **`COMPLETE`** on the same target before starting CXP-09. The five calculation sheets (`_CALC_HANDLED`, `_CALC_OFFERED`, `_CALC_AHT`, `_CALC_AUXES`, `_CALC_STAFF`) must exist with the installed formula topology from those packets. Raw sheets must retain exact CXP-03 headers and declared row bounds.

Aggregation surfaces (CXP-02 skeleton):

| Sheet | Replaces legacy dependency | Primary grain |
|---|---|---|
| `_AGG_INTERVAL` | AHT Handled Offered pivot families (All Sites, CNX Enterprise, CNX AHT, AHT All Site) | fixed-PST date + 30-minute interval + site (+ queue/LOB where contract requires) |
| `_AGG_FORECAST` | Forecast and Allocation Pivot / SEF → Data forecast-required path | date + interval + site + type |
| `_AGG_ALLOCATION` | Drivers and Allocation allocation pivots and VLOOKUP sources | date + interval + site / BPO split |

Required measure families (25-metric Interval View registry plus supporting allocation/forecast fields) are defined in `config/metric-lineage-contract.json`. CXP-09 must expose deterministic values at the reporting grain; CXP-10 consumes these tables and must not depend on legacy pivot cell addresses.

Fresh DEV pair (optional): set Script Property `CXP_DEV_BOOTSTRAP_FOLDER_ID` to a writable Drive folder, then run `bootstrapCxpDevWorkbooks()` once. That creates `DEV_TARGET_WORKBOOK` + `DEV_SYSTEM_CONTROL_WORKBOOK`, stores both spreadsheet IDs, runs CXP-02 init, and seeds CXP-03 raw headers. Complete CXP-07 and CXP-08 install on that target before CXP-09. See [`docs/configuration.md`](configuration.md).

## Install entrypoints

| Entrypoint | Purpose |
|---|---|
| `initializeCxp09StableAggregationModel` | Start or resume checkpointed aggregation install on the configured target |
| `continueCxp09StableAggregationModel` | Time-driven or manual continuation from `CXP09_AGGREGATION_INSTALL_STATE_V3` |
| `getCxp09StableAggregationStatus` | Sanitized status (`IDLE` / `RUNNING` / `COMPLETE` / `FAILED`) |
| `resetCxp09StableAggregationInstallationState` | Clear stuck or wrong-target `RUNNING` state |
| `diagnoseCxp09RunbookChecks` | Aggregation header/grain/measure diagnostic |

## Evidence rules

For every step, record sanitized counts, timings, execution outcome, and formula-error **kinds** only. Never attach source rows, spreadsheet IDs, user emails, or formula error values containing business data.

Record the aggregation grain key columns present on each `_AGG_*` sheet and the measure column count. Do not paste GETPIVOTDATA or legacy pivot anchor coordinates into evidence.

---

## CXP09UatStep00 — VerifyPrerequisites

**Helper:** `CXP09UatStep00VerifyPrerequisites`

Run **before** Step 01. Confirms CXP-07 (`27/27`) and CXP-08 (`74/74`) install state is `COMPLETE` on the configured target. Throws if either packet is incomplete.

---

## CXP09UatStep01 — Install

**Helper:** `CXP09UatStep01Install` (or run initialize/continue/status directly).

1. Push the verified `src/` tree to the non-production Apps Script project.
2. Confirm CXP-07 and CXP-08 install status is `COMPLETE` on the configured target.
3. Run `initializeCxp09StableAggregationModel()` once.
4. If the result is `RUNNING`, allow the time-driven continuation to proceed. Poll `getCxp09StableAggregationStatus()` until `COMPLETE`. Do not launch parallel initializers. On `Service timed out: Spreadsheets`, run `continueCxp09StableAggregationModel()` (or re-run initialize on the same target) to resume. Use `resetCxp09StableAggregationInstallationState()` only for stuck or wrong-target `RUNNING` state.
5. Confirm Executions show successful continuation invocations and no remaining continue trigger after completion.

## CXP09UatStep02 — InspectTopology

**Helper:** `CXP09UatStep02InspectTopology`

1. Confirm `_AGG_INTERVAL`, `_AGG_FORECAST`, and `_AGG_ALLOCATION` exist and are backend-protected per CXP-02.
2. Confirm each sheet declares the canonical dimension columns (at minimum fixed-PST `Date`, `Interval`, and `Site`; add `Queue`/`LOB`/`Type` only where `metric-lineage-contract.json` requires them for that measure family).
3. Confirm measure columns cover the CXP-09 registry: Forecast, Offered, Handled, Chats in SL, Abandoned, SL %, SL TTC, % of Forecast Offered, % of Forecast Handled, Allocation, Cumulative Allocation, AHT (Session), AHT, ACW, ASA, Concurrency, Scheduled, Required, Actual (SO), and the derived hour/ratio measures that Interval View computes from those bases.
4. Confirm aggregation formulas read `_CALC_*` (and approved MOM/forecast manual inputs where the contract requires them) — not `_RAW_*` directly and not `GETPIVOTDATA` against pivot anchor cells.
5. Confirm only documented formula anchors exist (row-2 spill pattern or equivalent bounded QUERY/ARRAYFORMULA blocks). No per-row fill-down down the aggregation body.
6. Confirm spills or QUERY outputs reach every populated calc key at the declared grain and do not show `#REF!`, formula parse errors, or unintended blanking of required measure columns.

## CXP09UatStep03 — LoadParityFixture

**Helper:** `CXP09UatStep03LoadParityFixture` / `CXP09UatStep03RunParity`

Load a synthetic bundle that exercises calc → aggregation for all five datasets. Planned fixture path: `tests/fixtures/cxp09/aggregation-parity.json`. Adapt partials to complete CXP-03 raw rows without changing listed control values. Overwrite prior raw content only; do not reinstall aggregation formulas after the load.

### CXP09UatStep03.1 — WriteHandledRaw

Clear/write `_RAW_HANDLED` from the fixture Handled rows.

### CXP09UatStep03.2 — WriteOfferedRaw

Clear/write `_RAW_OFFERED` from the fixture Offered rows.

### CXP09UatStep03.3 — WriteAhtRaw

Clear/write `_RAW_AHT` from the fixture AHT rows.

### CXP09UatStep03.4 — WriteAuxesRaw

Clear/write `_RAW_AUXES` from the fixture Auxes rows.

### CXP09UatStep03.5 — WriteStaffRaw

Clear/write `_RAW_STAFF` from the fixture Staff rows; set the Staff business-day anchor per fixture contract.

### CXP09UatStep03.6 — WriteForecastInputs

Write approved MOM/forecast manual inputs required by `_AGG_FORECAST` per fixture contract (if the parity scenario includes forecast-dependent measures).

## CXP09UatStep04 — RecordParityOutputs

**Helper:** `CXP09UatStep04RecordParityOutputs`

1. Allow `_CALC_*` spills to settle, then read aggregation outputs from `_AGG_INTERVAL`, `_AGG_FORECAST`, and `_AGG_ALLOCATION` for the fixture keys.
2. Compare to literal expected values in the fixture at **date + interval + site** grain (add queue/LOB/type only where the contract requires).
3. Confirm DEC-025: UTC timestamps that cross the fixed-PST day boundary land on the prior business date and correct 30-minute bucket in aggregation keys (same rule family as CXP-07/CXP-08).
4. Confirm legacy contract anomalies remain intentional where applicable:
   - Handled zero vs blank interval behavior (`F122:F150` blank-on-zero family).
   - AHT (Session) interval divisor 63 vs summary divisor 60.
   - Scheduled-to-Required interval vs summary `IFERROR` guard mismatch.
5. Record pass or a documented CXP-01-rooted delta (no invented formula changes). Do not “fix” accepted legacy anomalies unless a superseding decision is recorded.

## CXP09UatStep05 — PeakFlushTiming

**Helper:** `CXP09UatStep05PeakFlushTiming`

1. Load an approved peak bundle into all five raw sheets (for example via CXP-06 peak ingest into the same target, or a dedicated peak writer): approximately 5,000 Handled, 5,000 Offered, 7,000 AHT, 3,000 Auxes, and 300 Staff rows within declared bounds.
2. Call `SpreadsheetApp.flush()` via the helper and record elapsed time, populated aggregation row counts per `_AGG_*` sheet, formula-error kinds, and Apps Script execution outcome.
3. Fail promotion if any required aggregation output is incomplete, parse errors appear, or the invocation hits the Apps Script hard limit without a durable checkpoint path.

## CXP09UatStep06 — SecondBundleRefresh

**Helper:** `CXP09UatStep06SecondBundleRefresh`

1. Replace raw values (and forecast manual inputs if applicable) with a second valid bundle **without** reinstalling aggregation formulas.
2. Prefer one raw sheet (or one bounded write) per Apps Script invocation so peak-sized clears stay inside the execution limit; poll status until `COMPLETE`.
3. Confirm `_CALC_*` spills refresh, then confirm `_AGG_*` tables refresh from calc dependency alone.

## CXP09UatStep07 — ReinstallTopology

**Helper:** `CXP09UatStep07ReinstallTopology`

1. Re-run the installer (`initializeCxp09StableAggregationModel` after `COMPLETE` starts a clean reinstall).
2. Wait for `COMPLETE` (resume with continue on Sheets timeouts).
3. Re-run topology checks from `CXP09UatStep02` and confirm headers, grain columns, anchors, and bounds restore without adding rows or columns beyond declared capacities.

## CXP09UatStep08 — PromotionGate

**Helper:** `CXP09UatStep08PromotionGate`

Promotion requires all of the following:

1. CXP-07 and CXP-08 remain `COMPLETE` on the same target used for CXP-09 evidence.
2. Successful continuation across more than one invocation when the checkpoint budget is reached (`CXP09UatStep01`).
3. Successful formula parsing, declared grain columns, and complete aggregation outputs (`CXP09UatStep02`, `CXP09UatStep05`).
4. Representative parity or a documented CXP-01-rooted delta at date + interval + site grain (`CXP09UatStep04`).
5. Second-bundle refresh without reinstall (`CXP09UatStep06`).
6. Clean reinstall topology (`CXP09UatStep07`).
7. No runtime dependency on legacy Excel pivot cell addresses or `GETPIVOTDATA` coordinates.
8. Deterministic outputs: repeating the same fixture load yields identical aggregation keys and measures.
9. Every individual installation step within the current Apps Script execution limit.

Attach sanitized counts/timings only. Never attach source rows, spreadsheet IDs, user emails, or formula error values containing business data.

## CXP-10 handoff checklist

- Consume `_AGG_INTERVAL`, `_AGG_FORECAST`, and `_AGG_ALLOCATION` as the sole backend sources for Interval View and MOM metric lookups.
- Preserve Interval View's three-block layout and the 25-metric registry column order without re-deriving measures from `_CALC_*` or `_RAW_*`.
- Keep backend aggregation sheets hidden/protected; RTAs interact only with report/support surfaces.
- Document any report-formatting differences separately in CXP-10; do not alter aggregation grain or measure definitions here.
