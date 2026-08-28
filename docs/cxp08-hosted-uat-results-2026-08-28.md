# CXP-08 Hosted UAT Sign-off

## Outcome

**PASSED — Hosted DEV completed on August 28, 2026** for the standard runbook path (install, parity, second-bundle refresh, reinstall topology, promotion gate).

The CXP-08 native AHT/Auxes/Staff transformation path completed local suite coverage plus hosted install, representative parity, second-bundle refresh, topology verification, and promotion gate. Collected Apps Script execution logs support promotion of the tested CXP-08 behavior for the non-peak evidence set, subject to the operational controls in the UAT runbook.

**Deferred:** Step 05 peak flush was not executed on the first standard-path target; full peak evidence was collected later on a dedicated peak-loaded target (see peak sign-off).

## Scope and acceptance basis

- Environment: hosted Google Apps Script **DEV**
- Schema version: `1.0.0`
- Target workbook title: `DEV_TARGET_WORKBOOK` (disposable DEV target; spreadsheet ID omitted from repository evidence)
- Control workbook: separate `DEV_SYSTEM_CONTROL_WORKBOOK` bootstrapped in the same Drive folder
- Evidence systems: sanitized Apps Script `CXP08_*` / `CXP08_UAT` telemetry; `diagnoseCxp08RunbookChecks` topology output
- Acceptance criteria: `docs/cxp08-uat-runbook.md`
- Operator helpers: `docs/cxp08-uat-harness.md`
- DEV bootstrap: `bootstrapCxpDevWorkbooksForceReplace()` / `registerCxpDevWorkbooksFromFolderAndSeed()` per `docs/configuration.md`

## Local test results (pre-hosted)

| Command | Result | Coverage |
|---|---|---|
| `npm run test:cxp08` | **PASS** | 9/9 — native transforms (7) + parity UAT normalization (2) |
| `npm run test:bootstrap` | **PASS** | DEV workbook bootstrap + folder registration |
| `npm run test:control-headers` | **PASS** | Control workbook header seeding |

## Hosted results

| Runbook step | Helper | Result | Verified outcome | Evidence notes |
|---|---|---|---|---|
| 01 — Install | `CXP08UatStep01Install` | **PASS** | Install reached `COMPLETE` at `74/74` steps; last step `Staff:SUMMARY_FORMULAS`. | `CXP08_INSTALL` status `COMPLETE` |
| 02 — InspectTopology | `CXP08UatStep02InspectTopology` / `diagnoseCxp08RunbookChecks` | **PASS** | `_CALC_AHT` 34 headers, 7 formula anchors A2:G2; `_CALC_AUXES` 28 headers, 5 anchors A2:E2; `_CALC_STAFF` 53 headers + BE:BF summary anchors; no fill-down. | Topology diagnostic JSON |
| 03–04 — Parity | `CXP08UatStep03LoadParityFixture` + `CXP08UatStep04RecordParityOutputs` | **PASS** | After parity-comparison fix (Sheets date/time display normalization), `pass: true`, `ahtDiffCount: 0`, `auxesDiffCount: 0`. DEC-025 boundary: UTC 07:45 → prior fixed-PST date @ 23:30; UTC 08:05 → same UTC calendar date @ 00:00. | `CXP08UAT CXP08UatStep04.result` |
| 05 — PeakFlushTiming | `CXP08UatStep05PeakFlushTiming` | **NOT RUN** | Requires ~7k/3k/300 row peak bundle (typically via CXP-06 ingest). | Deferred |
| 06 — SecondBundleRefresh | `CXP08UatStep06SecondBundleRefresh` | **PASS** | Raw replaced with second bundle (`AW-REFRESH-1` / `SESSION-REFRESH` class); `_RAW_*` each `lastRow: 2` (1 data row); calc spills refreshed without reinstall. | Post-06 topology sample rows |
| 07 — ReinstallTopology | `CXP08UatStep07ReinstallTopology` | **PASS** | Reinstall completed; topology restored at bounded row counts. | Install `COMPLETE` after Step 07 |
| 08 — PromotionGate | `CXP08UatStep08PromotionGate` | **PASS** | `pass: true`, `installComplete: true`; calc sheets present for AHT/Auxes/Staff. | `CXP08UAT CXP08UatStep08.result` |

## Non-blocking observations

- **`_STG_*` sheets remain empty** during CXP-08 UAT. Staging is populated only by the CXP-06 ingestion pipeline; CXP-08 parity and refresh write directly to `_RAW_*`.
- **Initial Step 04 failure (9 AHT + 4 Auxes diffs)** was a hosted comparison defect: raw Sheets display strings (`8/17/2026`, interval formatting) were compared literally to ISO fixture values. Fixed by normalizing dates/times in `CXP08UatStep04RecordParityOutputs` (same approach as CXP-07). Re-run passed without formula changes.
- **Step 08 promotion gate** confirms install complete + calc topology present; it does not substitute for Step 05 peak evidence.

## Promotion disposition

**CXP-08 hosted functional UAT is accepted as passed for the August 28, 2026 standard-path evidence set.**

Attach sanitized counts/timings and status enums only. Never attach source rows, spreadsheet IDs, user emails, or formula/error cell values containing business data.

Peak-scale flush (Step 05) should be recorded separately before claiming full production-volume recalculation evidence. When peak raw is already loaded via CXP-06, use the peak-loaded operator sequence in [`docs/cxp08-uat-harness.md`](cxp08-uat-harness.md) and fill [`docs/cxp08-hosted-uat-results-peak-2026-08-28.md`](cxp08-hosted-uat-results-peak-2026-08-28.md).

## Sign-off record

- UAT execution date: August 28, 2026
- Documentation date: August 28, 2026
- Status: **PASSED** (standard path; Step 05 peak recorded in [`cxp08-hosted-uat-results-peak-2026-08-28.md`](cxp08-hosted-uat-results-peak-2026-08-28.md))
