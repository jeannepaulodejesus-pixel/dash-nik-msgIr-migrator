# CXP-10 Interval View and MOM Reporting Surfaces — Implementation Plan

**Status:** Implementation landed for catalog, reference model, checkpointed installer, local tests, and `CXP10UatStep01`–`CXP10UatStep08` helpers. Hosted UAT evidence remains a promotion gate.

**Hosted UAT sequence:** [`docs/cxp10-uat-runbook.md`](../cxp10-uat-runbook.md) (`CXP10UatStep01` … `CXP10UatStep08`). Harness: [`docs/cxp10-uat-harness.md`](../cxp10-uat-harness.md). Logic: [`docs/interval-view-mom-reporting-surfaces.md`](../interval-view-mom-reporting-surfaces.md).

**Goal:** Recreate Interval View and MOM as Google Sheets-native reporting surfaces that consume CXP-09 aggregation tables only — no legacy pivot coordinates or GETPIVOTDATA.

**Dependencies:** CXP-01 (25-metric registry, contract anomalies), CXP-02 (Interval View + MOM sheet placeholders), CXP-09 (`_AGG_INTERVAL`, `_AGG_FORECAST`, `_AGG_ALLOCATION` complete on target).

**Tech stack:** Apps Script–compatible JavaScript, bounded `ARRAYFORMULA` / `SUMIFS` / `QUERY` lookups, Node test runner for local contract tests.

## Non-goals

- Do not read `_CALC_*` or `_RAW_*` directly from report formulas.
- Do not recreate Excel PH/LAS sub-blocks as separate pivot hubs; combined block at `C112:AB151` is the contract surface.
- Do not automate the RTA Staff → Data paste edge; Scheduled/Required/Actual (SO) flow through `_AGG_FORECAST` Type rows and MOM manual inputs.
- Do not pursue pixel-perfect Excel layout when it conflicts with native stability.
- Do not modify CXP-07/CXP-08 calculation topology.

## Architecture

```text
_AGG_INTERVAL ----\
_AGG_FORECAST -----+--> Interval View (C112:AB151 combined block)
_AGG_ALLOCATION --/

MOM manual inputs --> MOM staging (A13:E50) --> _AGG_FORECAST bridge (A2 QUERY)
```

- Separate packet-owned checkpointed installer (mirror CXP-09): aggregation preflight, bounded report-range writes, Script Property cursor, four-minute cooperative budget, safety trigger, constant anchor write shape.
- Interval View formulas use `SUMIFS` / same-row derivations keyed by Date + Interval columns `A113:B150`.
- MOM provides the RTA weekly forecast calendar; a bridge QUERY on `_AGG_FORECAST` replaces the CXP-09 self-referential forecast passthrough.
- Preserve CXP-01 contract anomalies in derived formulas (Handled zero/blank split, AHT Session divisor 63 vs 60, Scheduled-to-Required IFERROR guard on total row only).

## Sheet topology

| Surface | Range | Role |
|---|---|---|
| `Interval View` | `A1` | Business-day anchor (RTA-editable) |
| `Interval View` | `A112:B112` | Date / Interval axis headers |
| `Interval View` | `D112:AB112` | 25-metric registry headers |
| `Interval View` | `A113:B150` | 38 half-hour axis keys |
| `Interval View` | `D113:AB150` | Combined-block metric spills |
| `Interval View` | `D151:AB151` | Summary row |
| `MOM` | `A1` | Week-start date (rollover anchor) |
| `MOM` | `B4:H4` | Seven-day date header row |
| `MOM` | `A12:E12` | Staging column headers |
| `MOM` | `A13:E50` | Manual forecast/required/staffing inputs |
| `_AGG_FORECAST` | `A2` | Bridge QUERY reading MOM staging |

## Verification boundary

`npm run test:cxp10` proves fixture outputs, formula anchors, constant write shape, retry-safe install steps, checkpoint/resume, preflight rejection when aggregation sheets are missing, and repeat installation. Node cannot execute Google Sheets formulas or prove hosted trigger timing. Follow `docs/cxp10-uat-runbook.md` for hosted promotion evidence.
