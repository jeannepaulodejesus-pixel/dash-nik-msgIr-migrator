# CXP-08 Hosted UAT Runbook

**Planned contract** for operator succession; implementation is landed for install + UAT helpers. Installer, formula catalogs, fixtures, and Apps Script helpers: see [`docs/aht-auxes-staff-native-transformations.md`](aht-auxes-staff-native-transformations.md) and [`docs/cxp08-uat-harness.md`](cxp08-uat-harness.md).

Packet plan: [`docs/plans/2026-08-27-cxp08-aht-auxes-staff-native-transformations.md`](plans/2026-08-27-cxp08-aht-auxes-staff-native-transformations.md). Pattern reference: [`docs/cxp07-uat-runbook.md`](cxp07-uat-runbook.md).

## Succession naming

Every successive operator process uses zero-padded **`CXP08UatStepNN(process)`** form:

- Document headings and evidence labels: `CXP08UatStep01`, `CXP08UatStep02`, …
- Planned editor helpers: `CXP08UatStep01Install`, `CXP08UatStep03LoadParityFixture`, … (Step id + PascalCase process)
- Ordered sub-steps inside a step: `CXP08UatStep03.1`, `CXP08UatStep03.2`, …

Shared front matter below is not a succession step.

## Safety and prerequisites

Use a disposable DEV or UAT target initialized by CXP-02. Never point `CXP_ENV` at PROD for this run. Configure the environment's target spreadsheet ID in Script Properties; do not record the ID in repository evidence.

Confirm `_RAW_AHT`, `_RAW_AUXES`, `_RAW_STAFF`, `_CALC_AHT`, `_CALC_AUXES`, and `_CALC_STAFF` exist. Load raw sheets with exact CXP-03 headers. Preserve AHT within its 15,000-row bound, Auxes within 7,500, and Staff within 2,000. Representative peak evidence uses approximately 7,000 AHT, 3,000 Auxes, and 300 Staff rows.

Fresh DEV pair (optional): set Script Property `CXP_DEV_BOOTSTRAP_FOLDER_ID` to a writable Drive folder, then run `bootstrapCxpDevWorkbooks()` once. That creates `DEV_TARGET_WORKBOOK` + `DEV_SYSTEM_CONTROL_WORKBOOK`, stores both spreadsheet IDs, runs CXP-02 init, and seeds CXP-03 raw headers. See [`docs/configuration.md`](configuration.md).

## Planned install entrypoints

| Entrypoint | Purpose |
|---|---|
| `initializeCxp08AhtAuxesStaffTransformations` | Start or resume checkpointed AHT/Auxes/Staff install on the configured target |
| `continueCxp08AhtAuxesStaffTransformations` | Time-driven or manual continuation from `CXP08_AHT_AUXES_STAFF_INSTALL_STATE` |
| `getCxp08AhtAuxesStaffTransformationStatus` | Sanitized status (`IDLE` / `RUNNING` / `COMPLETE` / `FAILED`) |
| `resetCxp08AhtAuxesStaffInstallationState` | Clear stuck or wrong-target `RUNNING` state |

## Evidence rules

For every step, record sanitized counts, timings, execution outcome, and formula-error **kinds** only. Never attach source rows, spreadsheet IDs, user emails, or formula error values containing business data.

---

## CXP08UatStep01 — Install

**Helper (planned):** `CXP08UatStep01Install` (or run initialize/continue/status directly).

1. Push the verified `src/` tree to the non-production Apps Script project.
2. Run `initializeCxp08AhtAuxesStaffTransformations()` once.
3. If the result is `RUNNING`, allow the time-driven continuation to proceed. Poll `getCxp08AhtAuxesStaffTransformationStatus()` until `COMPLETE`. Do not launch parallel initializers. On `Service timed out: Spreadsheets`, run `continueCxp08AhtAuxesStaffTransformations()` (or re-run initialize on the same target) to resume. Use `resetCxp08AhtAuxesStaffInstallationState()` only for stuck or wrong-target `RUNNING` state.
4. Confirm Executions show successful continuation invocations and no remaining continue trigger after completion.

## CXP08UatStep02 — InspectTopology

**Helper (planned):** `CXP08UatStep02InspectTopology`

1. Confirm `_CALC_AHT` has 34 headers (7 calculated + 27 raw), `_CALC_AUXES` has 28 (4 + 24), and `_CALC_STAFF` has the 53-column overlap table plus the documented BE:BF summary block and business-day anchor.
2. Confirm only row 2 holds formula anchors for spills (and the documented Staff summary/anchor cells). No calculated formula fill-down down the table body.
3. Confirm spills reach every populated raw key and do not show `#REF!`, formula parse errors, or unintended blanking of required calculated columns.

## CXP08UatStep03 — LoadParityFixture

**Helper (planned):** `CXP08UatStep03LoadParityFixture`

1. Load the synthetic fixture (planned path `tests/fixtures/cxp08/aht-auxes-staff-parity.json`), adapting partials to complete CXP-03 raw rows without changing listed control values.
2. Write into `_RAW_AHT`, `_RAW_AUXES`, and `_RAW_STAFF` only. Overwrite prior raw content for those three sheets.
3. Do not reinstall formulas after the load.

### CXP08UatStep03.1 — WriteAhtRaw

Clear/write `_RAW_AHT` from the fixture AHT rows.

### CXP08UatStep03.2 — WriteAuxesRaw

Clear/write `_RAW_AUXES` from the fixture Auxes rows.

### CXP08UatStep03.3 — WriteStaffRaw

Clear/write `_RAW_STAFF` from the fixture Staff rows; set the Staff business-day anchor per fixture contract.

## CXP08UatStep04 — RecordParityOutputs

**Helper (planned):** `CXP08UatStep04RecordParityOutputs`

1. Read calculated outputs from `_CALC_AHT`, `_CALC_AUXES`, and `_CALC_STAFF` for the fixture keys.
2. Compare to literal expected values in the fixture.
3. Confirm DEC-025: UTC timestamps that cross the fixed-PST day boundary land on the prior business date / correct 30-minute bucket (same rule family as CXP-07).
4. Record pass or a documented CXP-01-rooted delta (no invented formula changes).

## CXP08UatStep05 — PeakFlushTiming

**Helper (planned):** `CXP08UatStep05PeakFlushTiming`

1. Load an approved approximately 7k AHT + 3k Auxes + 300 Staff bundle (for example via CXP-06 peak ingest into the same target, or a dedicated peak writer).
2. Call `SpreadsheetApp.flush()` via the helper and record elapsed time, populated spill counts, formula-error kinds, and Apps Script execution outcome.
3. Fail promotion if any required spill is incomplete, parse errors appear, or the invocation hits the Apps Script hard limit without a durable checkpoint path.

## CXP08UatStep06 — SecondBundleRefresh

**Helper (planned):** `CXP08UatStep06SecondBundleRefresh` (+ status/continue if resumable)

1. Replace raw AHT/Auxes/Staff values with a second valid bundle **without** reinstalling formulas.
2. Prefer one raw sheet (or one bounded write) per Apps Script invocation so peak-sized clears stay inside the execution limit; poll status until `COMPLETE`.
3. Confirm calculated spills refresh from dependency recalculation alone.

## CXP08UatStep07 — ReinstallTopology

**Helper (planned):** `CXP08UatStep07ReinstallTopology`

1. Re-run the installer (`initializeCxp08AhtAuxesStaffTransformations` after `COMPLETE` starts a clean reinstall).
2. Wait for `COMPLETE` (resume with continue on Sheets timeouts).
3. Re-run topology checks from `CXP08UatStep02` and confirm headers/anchors/bounds restore without adding rows or columns beyond declared capacities.

## CXP08UatStep08 — PromotionGate

**Helper (planned):** `CXP08UatStep08PromotionGate` (summary/status aggregator) or manual checklist against prior step evidence.

Promotion requires all of the following:

1. Successful continuation across more than one invocation when the four-minute checkpoint is reached (`CXP08UatStep01`).
2. Successful formula parsing and complete spills (`CXP08UatStep02`, `CXP08UatStep05`).
3. Representative parity or a documented CXP-01-rooted delta (`CXP08UatStep04`).
4. Second-bundle refresh without reinstall (`CXP08UatStep06`).
5. Clean reinstall topology (`CXP08UatStep07`).
6. Every individual installation step within the current Apps Script execution limit.

Attach sanitized counts/timings only. Never attach source rows, spreadsheet IDs, user emails, or formula error values containing business data.
