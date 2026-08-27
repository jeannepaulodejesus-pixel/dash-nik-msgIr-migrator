# CXP-07 Hosted UAT Runbook

Operator helpers for the Apps Script editor are documented in [`docs/cxp07-uat-harness.md`](cxp07-uat-harness.md). Hosted sign-off evidence: [`docs/cxp07-hosted-uat-results-2026-08-26.md`](cxp07-hosted-uat-results-2026-08-26.md).

## Safety and prerequisites

Use a disposable DEV or UAT target initialized by CXP-02. Never point `CXP_ENV` at PROD for this run. Configure the environment's target spreadsheet ID in Script Properties; do not record the ID in repository evidence. Load the same synthetic or approved parity bundle into the three required raw sheets with exact CXP-03 headers. Preserve `_RAW_AHT` up to its 15,000-row bound and use approximately 5,000 populated rows in each Handled and Offered sheet for the peak case.

## Install and inspect

1. Push the verified `src/` tree to the non-production Apps Script project.
2. Run `initializeCxp07HandledOfferedTransformations()` once.
3. If the result is `RUNNING`, allow the time-driven continuation to proceed. Run `getCxp07HandledOfferedTransformationStatus()` until it reports `COMPLETE`, `nextStep: 27`, and `stepCount: 27`. Do not repeatedly launch parallel initializers. If install fails with `Service timed out: Spreadsheets`, run `continueCxp07HandledOfferedTransformations()` (or re-run initialize on the same target) to resume from the checkpoint. Use `resetCxp07HandledOfferedInstallationState()` only to clear a stuck or wrong-target `RUNNING` state.
4. Confirm the Apps Script Executions view contains successful continuation invocations and no remaining `continueCxp07HandledOfferedTransformations` project trigger after completion. Exact trigger start time is not guaranteed.
5. Confirm `_CALC_HANDLED` has 30 headers and `_CALC_OFFERED` has 42 headers (or run `cxp07UatStep4VerifyTopology`).
6. Confirm only row 2 contains formula anchors: A:C plus D on Handled; A:O plus P on Offered. No calculated formula should be filled down.
7. Confirm spills reach every populated raw key and do not show `#REF!`, formula parse errors, or unintended `#N/A`. A missing Handled case used by Offered Handled ASA is expected to retain lookup-error visibility.

## Parity and peak evidence

1. Load the synthetic fixture represented by `tests/fixtures/cxp07/handled-offered-parity.json`, adapting it to complete CXP-03 raw rows without changing the listed values (`cxp07UatStep1LoadParityFixture` or `cxp07UatStep1RunParity`).
2. Record the 2 Handled and 2 Offered calculated outputs and compare them with the literal expected values in the fixture (`cxp07UatStep1RecordParityOutputs` or the combined Step 1 runner). The UTC `07:45` record must land on the prior fixed-PST business date at `23:30`; the `08:05` record must land at `00:00` on the same UTC date.
3. Load the approved approximately 5k Handled + 5k Offered test bundle (for example via CXP-06 Case 1 peak ingest into the same target), call `SpreadsheetApp.flush()` via `cxp07UatStep2PeakFlushTiming`, and record elapsed time, populated spill counts, formula errors, and Apps Script execution outcome.
4. Replace the raw values with a second valid bundle without reinstalling formulas. Use the **resumable** helpers: run `cxp07UatStep3SecondBundleRefresh()` once, then poll `getCxp07UatStep3Status()` (or wait for `continueCxp07UatStep3Refresh`) until `COMPLETE`. One raw sheet is written per Apps Script invocation so peak-sized clears stay inside the execution limit. See `docs/cxp07-uat-harness.md` (Step 3 section).
5. Re-run the installer (`cxp07UatStep4ReinstallTopology`), wait for `COMPLETE` (resume with continue on Sheets timeouts), and confirm the same header/formula topology is restored without adding rows or columns beyond the declared bounds (`cxp07UatStep4VerifyTopology`).

## Promotion gate

Promotion requires successful continuation across more than one invocation when the four-minute checkpoint is reached, successful formula parsing, complete spills, representative parity or a documented CXP-01-rooted delta, and completion of every individual installation step within the current Apps Script execution limit. Attach sanitized counts/timings only. Never attach source rows, spreadsheet IDs, user emails, or formula error values containing business data.
