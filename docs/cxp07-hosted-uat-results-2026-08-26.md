# CXP-07 Hosted UAT Sign-off

## Outcome

**PASSED — Hosted DEV/UAT completed on August 26, 2026.**

The CXP-07 native Handled/Offered transformation path completed local suite coverage plus hosted install/continuation, representative parity, peak-scale flush, second-bundle refresh, spill-error scan, and reinstall topology verification. Collected Apps Script execution logs support promotion of the tested CXP-07 behavior, subject to the operational controls in the UAT runbook.

## Scope and acceptance basis

- Environment: hosted Google Apps Script DEV/UAT
- Schema version: `1.0.0`
- Peak test volume used: Handled 10,000; Offered 10,000; AHT 15,000 (meets runbook “approximately 5,000” Handled + Offered gate)
- Evidence systems: sanitized Apps Script `CXP07_*` / `CXP_UAT_PHASE` telemetry; target calc/raw topology inspection
- Acceptance criteria: `docs/cxp07-uat-runbook.md`
- Operator helpers: `docs/cxp07-uat-harness.md`

## Results

| Runbook item | Result | Verified outcome | Evidence notes |
|---|---|---|---|
| Local `npm run test:cxp07` | **PASS** | 9/9 focused suite green before hosted runs. | Local Node |
| Install → `COMPLETE` / `27/27` | **PASS** | Checkpointed install finished on the DEV system target; status and step logs emitted. | `CXP07_INSTALL` / `CXP07_STEP` |
| Multi-invocation continuation | **PASS** | Reinstall hit `Service timed out: Spreadsheets` at Offered capacity/clear boundary; `continueCxp07HandledOfferedTransformations` resumed at `nextStep: 9` and reached `COMPLETE`. | Timeout + continue logs |
| Header / formula topology | **PASS** | `_CALC_HANDLED` 30 headers, anchors A2:D2 only; `_CALC_OFFERED` 42 headers, anchors A2:P2 only; no fill-down; within declared bounds. | `cxp07UatStep4VerifyTopology` |
| Representative parity fixture | **PASS** | SESSION-100/200 outputs matched fixture expectations; UTC 07:45 → prior fixed-PST date @ 23:30; UTC 08:05 → same UTC date @ 00:00. | `cxp07UatStep1RunParity` |
| Peak flush (~5k+) | **PASS** | Raw ≈ 10k/10k/15k; calc spill ≈ 10k/10k; anchors 4/16; `executionOutcome: SUCCESS`; no `#REF!` / parse errors on scanned columns. | `cxp07UatStep2PeakFlushTiming` |
| Spill / formula error scan | **PASS** | Handled scanned 5000 rows: 0 `#REF!` / parse; Offered scanned 5000 rows: 0 `#REF!` / parse; Offered `#N/A` retained (Handled ASA lookup miss — expected). | `step2.peak.error_scan` |
| Second-bundle refresh | **PASS** | Second fixture sessions refreshed without formula reinstall; prior sessions cleared; anchors unchanged. | `cxp07UatStep3SecondBundleRefresh` |
| Reinstall + topology restore | **PASS** | Clean reinstall on peak-loaded target; resume after Sheets timeout; post-COMPLETE verify PASS at 10k spill scale. | Step 4 reinstall + verify |

## Timing notes (sanitized)

- Peak Step 2 wall time was dominated by opening the peak-loaded workbook (~100s class); measured `SpreadsheetApp.flush()` alone was sub-second once calcs were already warm.
- Install formula-write steps after capacity/clear completed in low single-digit seconds per invocation when not hitting Sheets service timeouts.

## Non-blocking observations

- Early peak attempts against the wrong workbook (control vs target) produced false technical success before helpers were hardened. Step 2 now refuses control titles/IDs and fails closed below peak scale or when calc anchors/spills are missing.
- Offered `#N/A` counts at peak are expected when synthetic Offered rows lack matching Handled ASA keys; they are not blocking formula errors.

## Promotion disposition

**CXP-07 hosted functional UAT is accepted as passed for the August 26, 2026 evidence set.**

Promotion packets must attach sanitized counts/timings and status enums only. Never attach source rows, spreadsheet IDs, user emails, or formula/error cell values containing business data.

## Sign-off record

- UAT execution date: August 26, 2026
- Documentation date: August 26, 2026
- Status: **PASSED**
