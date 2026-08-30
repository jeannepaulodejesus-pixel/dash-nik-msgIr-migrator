# CXP-09 Stable Aggregation and Domain Model — Implementation Plan

**Status:** Implementation landed for catalog, reference model, checkpointed installer, local tests, and `CXP09UatStep00`–`CXP09UatStep08` helpers. Hosted UAT evidence remains a promotion gate.

**Hosted UAT sequence:** [`docs/cxp09-uat-runbook.md`](../cxp09-uat-runbook.md) (`CXP09UatStep00` … `CXP09UatStep08`). Harness: [`docs/cxp09-uat-harness.md`](../cxp09-uat-harness.md). Results log: [`docs/cxp09-hosted-uat-results-2026-08-28.md`](../cxp09-hosted-uat-results-2026-08-28.md).

**Goal:** Replace fragile PivotTable/GETPIVOTDATA coordinate dependencies with stable `_AGG_*` aggregation tables that expose the business grain required by CXP-10 reporting.

**Dependencies:** CXP-01 (metric lineage), CXP-02 (skeleton sheets), CXP-07 and CXP-08 **COMPLETE** on the same target; CXP-06 raw repositories preferred for peak evidence.

**Tech stack:** Apps Script–compatible JavaScript, bounded `QUERY` spills reading `_CALC_*`, Node test runner for local contract tests.

## Prerequisites (run before Step 00)

Complete these **in order** on a disposable **DEV** target. Never use PROD for first execution.

| # | Prerequisite | How to verify | Required state |
|---|---|---|---|
| 1 | **Clasp auth + push** | `npm run clasp:configure` (local `CXP_CLASP_SCRIPT_ID`); `npm run clasp:push` | `src/` deployed to non-production Apps Script project |
| 2 | **Script Properties** | Apps Script → Project Settings → Script Properties | `CXP_ENV=DEV`; `CXP_DEV_TARGET_SPREADSHEET_ID`; `CXP_DEV_CONTROL_SPREADSHEET_ID` (distinct IDs; never commit to repo) |
| 3 | **DEV workbook pair** | Run `bootstrapCxpDevWorkbooksForceReplace()` or `registerCxpDevWorkbooksFromFolderAndSeed()` | Target title `DEV_TARGET_WORKBOOK`; control `DEV_SYSTEM_CONTROL_WORKBOOK` |
| 4 | **CXP-02 skeleton** | `initializeCxp02Workbooks()` | All `_STG_*`, `_RAW_*`, `_CALC_*`, `_AGG_*`, report sheets present |
| 5 | **CXP-07 install** | `initializeCxp07HandledOfferedTransformations()` → `COMPLETE` (`27/27`) | `_CALC_HANDLED`, `_CALC_OFFERED` formula topology installed |
| 6 | **CXP-08 install** | `initializeCxp08AhtAuxesStaffTransformations()` → `COMPLETE` (`74/74`) | `_CALC_AHT`, `_CALC_AUXES`, `_CALC_STAFF` formula topology installed |
| 7 | **Local tests** | `npm run test:cxp09` | 7/7 pass before hosted run |
| 8 | **Optional peak path** | CXP-06 Case 1 peak ingest on same target | ~5k Handled/Offered, ~7k AHT, ~3k Auxes, ~300 Staff for Step 05 |

**Automated prerequisite gate:** `CXP09UatStep00VerifyPrerequisites()` throws unless CXP-07 and CXP-08 install state is `COMPLETE` on the configured target.

**Upstream evidence:** Reuse the same DEV Script Properties and workbook pair from [`docs/cxp08-hosted-uat-results-2026-08-28.md`](../cxp08-hosted-uat-results-2026-08-28.md) (functional target A) and [`docs/cxp08-hosted-uat-results-peak-2026-08-28.md`](../cxp08-hosted-uat-results-peak-2026-08-28.md) (peak target B). CXP-07 sign-off: [`docs/cxp07-hosted-uat-results-2026-08-26.md`](../cxp07-hosted-uat-results-2026-08-26.md). Step 03 loads CXP-08 auxes/staff parity rows alongside the CXP-09 handled/offered/aht bundle.

## Non-goals

- Do not create Interval View or MOM layouts (CXP-10).
- Do not modify CXP-07/CXP-08 calc installers or public contracts.
- Do not use `GETPIVOTDATA` or legacy pivot cell addresses at runtime.

## Architecture

```text
_CALC_HANDLED / _CALC_OFFERED --\
_CALC_AHT / _CALC_AUXES / _CALC_STAFF --+--> _AGG_INTERVAL / _AGG_FORECAST / _AGG_ALLOCATION --> CXP-10 reports
```

- Separate packet-owned checkpointed installer (mirror CXP-07/CXP-08): preflight requires all five `_CALC_*` sheets, capacity/clear/header/QUERY-anchor writes, Script Property cursor, four-minute cooperative budget, safety trigger.
- Aggregation formulas read `_CALC_*` outputs only (not `_RAW_*` directly).
- DEC-025 fixed-PST bucketing is inherited from upstream calc spills.

## Sheet topology

| Sheet | Headers | Formula anchors | Row capacity |
|---|---|---:|---:|
| `_AGG_INTERVAL` | Date, Interval, Site + 9 measures | A2 (offered QUERY), I2 (AHT QUERY) | 50 |
| `_AGG_FORECAST` | Date, Interval, Site, Type, Value | Header only; CXP-10 owns the A2 MOM bridge | 50 |
| `_AGG_ALLOCATION` | Date, Interval, Site, BPO, Offered Count, Allocation Share | A2 (count QUERY), F2 (share ARRAYFORMULA) | 50 |

Install step count: **15** (`PREFLIGHT` + 3 sheets × [ENSURE_CAPACITY, CLEAR, HEADERS, formulas]).

## Installer / checkpoint contract

| Item | Value |
|---|---|
| Script Property | `CXP09_AGGREGATION_INSTALL_STATE_V3` (v3 removes the circular forecast anchor and preserves CXP-10 ownership) |
| Initialize | `initializeCxp09StableAggregationModel` |
| Continue | `continueCxp09StableAggregationModel` |
| Status | `getCxp09StableAggregationStatus` |
| Reset | `resetCxp09StableAggregationInstallationState` |
| States | `IDLE` / `RUNNING` / `COMPLETE` / `FAILED` |
| Preflight | All five `_CALC_*` sheets present; CXP-07/CXP-08 topology assumed from prerequisite gate |

## Hosted UAT step sequence

| Step | Helper | Purpose |
|---|---|---|
| 00 | `CXP09UatStep00VerifyPrerequisites` | Confirm CXP-07 + CXP-08 `COMPLETE` |
| 01 | `CXP09UatStep01Install` | Install aggregation model (`15/15`) |
| 02 | `CXP09UatStep02InspectTopology` | `_AGG_*` headers + formula anchors |
| 03 | `CXP09UatStep03LoadParityFixture` | Write synthetic 5-dataset parity raw bundle |
| 04 | `CXP09UatStep04RecordParityOutputs` | Compare `_AGG_INTERVAL` + `_AGG_ALLOCATION` to fixture |
| 05 | `CXP09UatStep05PeakFlushTiming` | Flush timing + agg row counts (after peak ingest if applicable) |
| 06 | `CXP09UatStep06SecondBundleRefresh` | Replace raw without reinstall |
| 07 | `CXP09UatStep07ReinstallTopology` | Clean reinstall |
| 08 | `CXP09UatStep08PromotionGate` | Install + topology checklist |

Combined shortcut: `CXP09UatStep03RunParity` (load + wait + compare).

## Local vs hosted verification

| Boundary | Proves |
|---|---|
| `npm run test:cxp09` | Reference model parity, formula anchors, 15-step plan, checkpoint/resume, calc-sheet preflight, idempotent reinstall |
| Hosted UAT | QUERY parse, agg spill completion, multi-invocation continuation, representative parity, peak flush timing |

Node cannot execute Google Sheets formulas; promotion requires hosted `CXP09UatStep00`–`CXP09UatStep08` evidence.

## Implementation tasks

- [x] Formula catalog + reference model for three `_AGG_*` sheets
- [x] Checkpointed installer service + Apps Script entrypoints
- [x] Synthetic parity fixture under `tests/fixtures/cxp09/`
- [x] `npm run test:cxp09` coverage
- [x] Hosted UAT helpers `CXP09UatStep00` … `CXP09UatStep08`
- [x] Implementation plan + hosted results log template
- [ ] Packet-status completion handoff after hosted UAT

## CXP-10 handoff checklist

- Consume `_AGG_INTERVAL`, `_AGG_FORECAST`, `_AGG_ALLOCATION` as sole backend sources for Interval View and MOM lookups.
- Do not re-derive measures from `_CALC_*` or `_RAW_*` in report surfaces.
- Preserve 25-metric registry column order and legacy contract anomalies intentionally.
