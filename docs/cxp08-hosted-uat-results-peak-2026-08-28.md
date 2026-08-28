# CXP-08 Hosted UAT Sign-off — Peak-Loaded Path

## Outcome

**PASSED — Hosted DEV completed on August 28, 2026** for both the functional runbook path and peak-scale flush (Step 05).

The CXP-08 native AHT/Auxes/Staff transformation path completed hosted install, representative parity, second-bundle refresh, reinstall, promotion gate, and **full three-dataset peak flush** on dedicated DEV targets. Collected Apps Script execution logs support promotion of the tested CXP-08 behavior including production-volume recalculation evidence, subject to the operational controls in the UAT runbook.

## Scope and acceptance basis

- Environment: hosted Google Apps Script **DEV**
- Schema version: `1.0.0`
- **Peak evidence (Step 05 target, 13:00 UTC+1):** raw AHT **15,000**; Auxes **7,500**; Staff **1,996**; calc spills **15,001** / **7,501** / **1,997**
- **Functional evidence (earlier target, 11:32–11:39 UTC+1):** parity fixture 3 / 2 / 1 rows; reinstall + promotion gate
- Evidence systems: sanitized Apps Script `CXP08_*` / `CXP08_UAT` telemetry; topology diagnostic output
- Acceptance criteria: `docs/cxp08-uat-runbook.md`
- Operator helpers: `docs/cxp08-uat-harness.md`
- Related sign-off: `docs/cxp08-hosted-uat-results-2026-08-28.md` (standard-path summary)

## Local test results (pre-hosted)

| Command | Result | Coverage |
|---|---|---|
| `npm run test:cxp08` | **PASS** | 9/9 — native transforms (7) + parity UAT normalization (2) |

## Hosted results

### Functional path (target A — 11:32–11:39 UTC+1)

| Runbook item | Helper | Result | Verified outcome | Evidence notes |
|---|---|---|---|---|
| Install → `COMPLETE` / `74/74` | `initializeCxp08AhtAuxesStaffTransformations` | **PASS** | `74/74`; `Staff:SUMMARY_FORMULAS`. | `CXP08_INSTALL` |
| Header / formula topology | `CXP08UatStep02InspectTopology` | **PASS** | Calc topology OK at mixed ingest scale (AHT not peak on this target). | 11:33 UTC+1 |
| Representative parity | Steps 03 + 04 | **PASS** | `pass: true`, `ahtDiffCount: 0`, `auxesDiffCount: 0`. | 11:37 UTC+1 |
| Second-bundle refresh | `CXP08UatStep06SecondBundleRefresh` | **PASS** | 1 row each written to `_RAW_*`. | 11:35 UTC+1 |
| Reinstall + topology | Step 07 + verify | **PASS** | Reinstall `COMPLETE` `74/74`. | 11:38–11:39 UTC+1 |
| Promotion gate | `CXP08UatStep08PromotionGate` | **PASS** | `pass: true`, `installComplete: true`. | 11:39 UTC+1 |

### Peak path (target B — 11:54–13:00 UTC+1)

| Runbook item | Helper | Result | Verified outcome | Evidence notes |
|---|---|---|---|---|
| CXP-06 peak ingest + install | Case 1 + `initializeCxp08…` | **PASS** | Raw **15k / 7.5k / ~2k**; install `COMPLETE` `74/74`; synthetic agent IDs (`0BzSYN…`), not `AW-REFRESH-*`. | Step 02 (11:59 UTC+1) |
| Peak flush timing | `CXP08UatStep05PeakFlushTiming` | **PASS** | `elapsedMs: 67`; `ahtLastRow: 15001`; `auxesLastRow: 7501`; `staffLastRow: 1997`; `executionOutcome: SUCCESS`. | `CXP08UatStep05.result` (13:00 UTC+1) |
| Spill / formula error scan | Peak calc scan | **NOT RUN** | Manual `#REF!` / parse scan not recorded at full spill depth. | Optional follow-up |

## Timing notes (sanitized)

- Step 05 peak flush (target B): `elapsedMs: 67` with calcs warm; spills at Case 1 ceilings (15k / 7.5k / ~2k).
- Step 05 partial attempt (earlier target): `elapsedMs: 77`; AHT spill **3** only — wrong/missing AHT source before file IDs corrected.
- Functional-path reinstall: ~9s wall time.

## Non-blocking observations

- Early peak attempts failed when `CXP_UAT_AHT_FILE_ID` did not match the operator’s Drive bundle; Auxes/Staff ingested while AHT stayed at 2 `AW-REFRESH-*` fixture rows.
- First functional pass ran Step **06 before 05**; peak evidence collected separately on a dedicated target with correct order (CXP-06 → install → Step 02 → **05**).
- Duplicate log lines per event are Logger + console dual emit (harmless).
- Step 05 helper records flush timing and spill row counts only; it does not scan formula errors (unlike CXP-07 Step 2).

## Promotion disposition

**CXP-08 hosted functional UAT is accepted as passed for the August 28, 2026 evidence set, including full Step 05 peak flush on a dedicated peak-loaded target.**

Promotion packets must attach sanitized counts/timings and status enums only. Never attach source rows, spreadsheet IDs, user emails, or formula/error cell values containing business data.

## Sign-off record

- UAT execution date: August 28, 2026
- Documentation date: August 28, 2026
- Status: **PASSED** (functional + peak Step 05)
