# CXP-09 Hosted UAT Sign-off

## Outcome

**PASSED — Functional path (target A) complete on hosted DEV, August 28, 2026 (~14:02–14:25 UTC+1).**

All required Steps 00–04, 06–08 executed on the same `DEV_TARGET_WORKBOOK` used for CXP-08 functional UAT. Peak path (target B, Step 05) remains **optional / not executed** in this sign-off.

## Upstream evidence reused (do not re-prove)

| Source | Status | What CXP-09 inherits |
|---|---|---|
| [`cxp07-hosted-uat-results-2026-08-26.md`](cxp07-hosted-uat-results-2026-08-26.md) | **PASSED** | `_CALC_HANDLED` / `_CALC_OFFERED` install `27/27`; peak ~10k/10k raw; parity SESSION-100/200 |
| [`cxp08-hosted-uat-results-2026-08-28.md`](cxp08-hosted-uat-results-2026-08-28.md) | **PASSED** | `_CALC_AHT` / `_CALC_AUXES` / `_CALC_STAFF` install `74/74`; functional parity 3/2/1 rows; second-bundle refresh |
| [`cxp08-hosted-uat-results-peak-2026-08-28.md`](cxp08-hosted-uat-results-peak-2026-08-28.md) | **PASSED** | Peak target B: raw AHT **15,000** / Auxes **7,500** / Staff **1,996**; calc **15,001** / **7,501** / **1,997**; flush `elapsedMs: 67` |

**Use the same DEV Script Properties and workbook pair** from the CXP-08 functional run (target A) unless executing the peak path on target B.

## Prerequisites (complete before Step 00)

| # | Prerequisite | Operator check | Status |
|---|---|---|---|
| 1 | `npm run clasp:push` | 62 files pushed incl. `Cxp09Setup.js`, `Cxp09UatEntrypoints.js` | **PASS** (~13:40 UTC+1) |
| 2 | `CXP_ENV=DEV` + target/control Script Properties | Same project as CXP-07/CXP-08 UAT | **PASS** (inherited) |
| 3 | `DEV_TARGET_WORKBOOK` + `DEV_SYSTEM_CONTROL_WORKBOOK` | Bootstrap from CXP-08 sign-off | **PASS** (inherited) |
| 4 | CXP-02 initialized | `initializeCxp02Workbooks()` | **PASS** (inherited) |
| 5 | CXP-07 install `COMPLETE` (`27/27`) | [`cxp07-hosted-uat-results-2026-08-26.md`](cxp07-hosted-uat-results-2026-08-26.md) | **PASS** (inherited) |
| 6 | CXP-08 install `COMPLETE` (`74/74`) | [`cxp08-hosted-uat-results-2026-08-28.md`](cxp08-hosted-uat-results-2026-08-28.md) | **PASS** (inherited) |
| 7 | Local `npm run test:cxp09` | 7/7 | **PASS** |
| 8 | Step 00 gate | `CXP09UatStep00VerifyPrerequisites()` | **PASS** (~14:02 UTC+1) — `cxp07TopologyReady: true`, `cxp08StateComplete: true` |

## Scope and acceptance basis

- Environment: hosted Google Apps Script **DEV**
- Schema version: `1.0.0`
- **Target A (functional):** same disposable `DEV_TARGET_WORKBOOK` used for CXP-08 Steps 01–04, 06–08 (11:32–11:39 UTC+1)
- **Target B (peak, optional Step 05):** same peak-loaded target from CXP-08 peak sign-off (11:54–13:00 UTC+1)
- Evidence systems: `CXP09_*` / `CXP09_UAT` telemetry; `diagnoseCxp09RunbookChecks`
- Acceptance: [`docs/cxp09-uat-runbook.md`](cxp09-uat-runbook.md)
- Plan: [`docs/plans/2026-08-28-cxp09-stable-aggregation.md`](plans/2026-08-28-cxp09-stable-aggregation.md)

## Local test results (pre-hosted)

| Command | Result | Coverage |
|---|---|---|
| `npm run test:cxp09` | **PASS** | 7/7 — reference model, install, checkpoint, preflight, reinstall |
| `npm run verify` | **PASS** | Full suite before push |

## Hosted step-by-step execution log

### Functional path (target A — reuse CXP-08 DEV target)

| Step | Helper | Result | Verified outcome | Evidence notes |
|---|---|---|---|---|
| 00 — Prerequisites | `CXP09UatStep00VerifyPrerequisites` | **PASS** | `pass: true`; CXP-07 via topology (`cxp07TopologyReady: true`, state `IDLE`); CXP-08 `cxp08StateComplete: true`. Handled/Offered anchors 4/16 OK. | ~14:02 UTC+1 |
| 01 — Install | `CXP09UatStep01Install` | **PASS** | Initial `COMPLETE` `15/15`; post-formula-fix reinstall via Step 07 at **`18/18`**. | `CXP09_INSTALL` ~14:03 / ~14:25 UTC+1 |
| 02 — InspectTopology | `CXP09UatStep02InspectTopology` | **PASS** | All three `_AGG_*` sheets present; headers OK (12/5/6); interval anchors **`A2`, `I2`–`L2`**; allocation `A2`+`F2`; forecast `A2`. | Topology JSON ~14:04 / ~14:25 UTC+1 |
| 03–04 — Parity | `CXP09UatStep03RunParity` | **PASS** | `pass: true`; `intervalDiffCount: 0`; `allocationDiffCount: 0`. After formula fixes (I–L VLOOKUP anchors, ASA via T+AB, MAP share). | `CXP09UatStep04.result` ~14:22 UTC+1 |
| 06 — SecondBundleRefresh | `CXP09UatStep06SecondBundleRefresh` | **PASS** | `SESSION-REFRESH` raw swap: 1 row each to `_RAW_HANDLED`, `_RAW_OFFERED`, `_RAW_AHT`; writes completed without reinstall. | `CXP09_UAT CXP09UatStep06.*` ~14:23 UTC+1 |
| 07 — ReinstallTopology | `CXP09UatStep07ReinstallTopology` | **PASS** | `COMPLETE` **`18/18`**; last step `Allocation:FORMULA:2`; `continuationScheduled: false`. | `CXP09_INSTALL` + topology ~14:25 UTC+1 |
| 08 — PromotionGate | `CXP09UatStep08PromotionGate` | **PASS** | `pass: true`; `installComplete: true`; all `_AGG_*` topology checks pass (`formulaAnchorCountOk` on interval/forecast/allocation). | `CXP09UatStep08.result` ~14:25 UTC+1 |

Shortcut: `CXP09UatStep03RunParity` = Step 03 + 3s wait + Step 04.

### Peak path (target B — reuse CXP-08 peak target)

Run **only** on the peak-loaded workbook from [`cxp08-hosted-uat-results-peak-2026-08-28.md`](cxp08-hosted-uat-results-peak-2026-08-28.md) after CXP-09 install on that target.

| Step | Helper | Result | Verified outcome | Evidence notes |
|---|---|---|---|---|
| 01 — Install (peak target) | `CXP09UatStep01Install` | **PENDING** | `15/15` on peak target with CXP-07/08 already at peak scale. | `CXP09_INSTALL` |
| 05 — PeakFlushTiming | `CXP09UatStep05PeakFlushTiming` | **PENDING** | Compare to CXP-08 baseline: calc AHT `lastRow ≥ 15001`, Auxes `≥ 7501`, Staff `≥ 1997`; `elapsedMs` warm-flush class ~67ms (CXP-08 recorded). Helper emits `cxp08PeakBaseline` + `peakTargetMatch`. | `CXP09_UAT CXP09UatStep05.result` |

**CXP-08 peak baseline embedded in Step 05 helper:**

```json
{
  "ahtLastRow": 15001,
  "auxesLastRow": 7501,
  "staffLastRow": 1997,
  "elapsedMsClass": 67
}
```

## Recommended execution order

**Target A (functional — ~15 min after CXP-08 passed):**

1. `CXP09UatStep00VerifyPrerequisites`
2. `CXP09UatStep01Install` → poll until `COMPLETE` (`continueCxp09StableAggregationModel` if needed)
3. `CXP09UatStep02InspectTopology`
4. `CXP09UatStep03RunParity` *(or 03 then 04)*
5. `CXP09UatStep06SecondBundleRefresh`
6. `CXP09UatStep07ReinstallTopology` → `CXP09UatStep02InspectTopology`
7. `CXP09UatStep08PromotionGate`

**Target B (peak — optional):**

1. Open CXP-08 peak target (post Case 1 + CXP-08 `COMPLETE`)
2. `CXP09UatStep01Install` → `COMPLETE`
3. `CXP09UatStep05PeakFlushTiming` — confirm `peakTargetMatch: true`

## Non-blocking observations

- **Step 03 auxes/staff rows** match the CXP-08 parity fixture (`tests/fixtures/cxp08/aht-auxes-staff-parity.json`) so calc upstream state matches the already-proven CXP-08 path.
- **Handled/Offered/AHT keys** in the CXP-09 aggregation fixture use PH/LAS sites (Interval View grain); CXP-08 AHT-only parity used CNX-Que/INT-LAS — both are valid; CXP-09 Step 03 overwrites all five `_RAW_*` sheets for a coherent aggregation bundle.
- **`_AGG_FORECAST` hosted parity** remains reference-model-only until forecast manual input is separated from the QUERY spill anchor.
- **Step 05** on target B does not re-run CXP-06 ingest; it assumes CXP-08 peak evidence already populated raw/calc at ceiling.
- **Formula catalog fixes during UAT** (interval AHT metrics at `I2`–`L2`, ASA via `T+AB`, allocation share via `MAP`) increased install step count from 15 → **18**; Step 07 reinstall required after each push.

## Promotion disposition

**CXP-09 functional hosted UAT is accepted** for target A (Steps 00–04, 06–08). Safe to proceed with **CXP-10** reporting-surface work on the same DEV target.

Peak-volume sign-off (Step 05 on target B) is **optional** and was not executed in this session. Run `CXP09UatStep01Install` + `CXP09UatStep05PeakFlushTiming` on the CXP-08 peak workbook before PROD promotion if peak evidence is required.

## Sign-off record

- Upstream CXP-07/CXP-08 evidence: August 26–28, 2026 (**PASSED**)
- CXP-09 Apps Script push: August 28, 2026 (~14:21 UTC+1, final formula catalog)
- CXP-09 hosted execution (target A): August 28, 2026 (~14:02–14:25 UTC+1)
- Status: **PASSED** (functional path)
