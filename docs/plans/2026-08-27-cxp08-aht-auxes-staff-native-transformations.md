# CXP-08 AHT, Auxes, and Staff Native Transformations — Implementation Plan

**Status:** Implementation landed for catalog, reference model, checkpointed installer, local tests, and `CXP08UatStep01`–`CXP08UatStep08` helpers. Hosted UAT evidence remains a promotion gate.

**Hosted UAT sequence:** [`docs/cxp08-uat-runbook.md`](../cxp08-uat-runbook.md) (`CXP08UatStep01` … `CXP08UatStep08`). Harness: [`docs/cxp08-uat-harness.md`](../cxp08-uat-harness.md). Logic: [`docs/aht-auxes-staff-native-transformations.md`](../aht-auxes-staff-native-transformations.md).

**Goal:** Rebuild AHT/session, auxiliary, and staffing calculations as Google Sheets-native, vectorized transforms on `_CALC_AHT`, `_CALC_AUXES`, and `_CALC_STAFF`, tracing only to the CXP-01 workbook contract.

**Dependencies:** CXP-01, CXP-02 (sheets present); CXP-03 schemas; CXP-06 raw repositories preferred. Parallel with CXP-07 (separate installer; do not change the Handled/Offered public contract — DEC-035).

**Tech stack:** Apps Script–compatible JavaScript, bounded `ARRAYFORMULA` / `LET` / `QUERY` / `XLOOKUP` spills, Node test runner for local contract tests.

## Non-goals

- Do not invent formulas absent from the workbook contract (`config/formula-family-catalog.json`, `config/metric-lineage-contract.json`).
- Do not create Interval View, MOM, or Data consolidation layouts (CXP-09 / CXP-10).
- Do not rebuild Handled/Offered (CXP-07).
- Do not automate the RTA Staff → Data paste edge; keep it owner-owned until a later packet.
- Scheduled / Required / Actual (SO) and hour/ratio **report** metrics are aggregation/report consumers of Staff summaries — not Interval View cells in this packet.

## Architecture

```text
_RAW_AHT  --> _CALC_AHT   --\
_RAW_AUXES --> _CALC_AUXES --+--> CXP-09 aggregates --> CXP-10 reports
_RAW_STAFF --> _CALC_STAFF --/
```

- Separate packet-owned checkpointed installer (mirror CXP-07): schema preflight, capacity/clear/header/anchor writes, Script Property cursor, four-minute cooperative budget, safety trigger, constant spill-anchor write shape (no fill-down).
- Formulas read post–CXP-06 raw values; reinstall only after workbook init or approved schema/model change.
- Apply DEC-025: subtract 480 minutes (UTC → fixed PST) before AHT Accept/Request and Aux Status Start date/interval derivation.
- CC uses QUERY (or equivalent) aggregate + vector lookup, same pattern as CXP-07 Handled AHT.

## Sheet topology

| Sheet | Calculated headers (Excel names) | Raw headers | Total columns | Row capacity (incl. header) | Formula anchors (planned) |
|---|---|---:|---:|---:|---:|
| `_CALC_AHT` | Date, Interval, Count, Service Level, ASA Total, CC, Request Interval (7) | 27 | 34 | 15,001 | 7 calc spills + 1 raw-block spill |
| `_CALC_AUXES` | Date, Interval, Available Messaging in Hours, Concluding in Hours (4) | 24 | 28 | 7,501 | 4 calc spills + 1 raw-block spill |
| `_CALC_STAFF` | 48 half-hour overlap columns | 5 | 53 (table) + BE:BF summary block | 2,001 | up to 48 overlap spills + bounded BE:BF summary formulas |

Staff also owns one business-day anchor cell on `_CALC_STAFF` (Excel used `Data!E1` / Staff `A1`). Document the cell in the formula catalog; do not wire Data paste automation here.

Parity / peak volumes for hosted evidence: approximately 7k AHT, 3k Auxes, 300 Staff (schema maxima remain 15k / 7.5k / 2k).

## Lineage → Sheets pattern

### AHT (`_CALC_AHT`)

| Calc header | Excel lineage | Sheets-native pattern |
|---|---|---|
| Date | `INT(Accept Date)` when present | Bounded spill; DEC-025 shift then date truncation |
| Interval | 30-minute floor of Accept Date | Bounded TIME/FLOOR spill after DEC-025 |
| Count | `COUNT(Request Date)` per row | Vector `COUNT` / non-blank flag |
| Service Level | `Speed To Answer` &lt; 91 → 1 else 0 | Vector comparison |
| ASA Total | `Speed To Answer` + `Time To First Response` | Vector sum |
| CC | SUMIFS Handle Time ÷ Active Time by Interval + Athlete Site | QUERY aggregate + vector lookup; `IFERROR` blank on divide-by-zero |
| Request Interval | 30-minute floor of Request Date | Bounded TIME/FLOOR spill after DEC-025 |

Plus canonical copy of all 27 CXP-03 AHT raw headers.

### Auxes (`_CALC_AUXES`)

| Calc header | Excel lineage | Sheets-native pattern |
|---|---|---|
| Date | `INT(Status Start Date)` when present | Bounded spill; DEC-025 then date truncation |
| Interval | 30-minute floor of Status Start Date | Bounded TIME/FLOOR spill after DEC-025 |
| Available Messaging in Hours | Status = `Available - Messaging` → Sign On Time (hours), else 0 | Vector `IF` |
| Concluding in Hours | Status = `Concluding` → Sign On Time (hours), else 0 | Vector `IF` |

Plus canonical copy of all 24 CXP-03 Auxes raw headers.

### Staff (`_CALC_STAFF`)

| Surface | Excel lineage | Sheets-native pattern |
|---|---|---|
| 48 half-hour columns | `MAX(0, MIN(end, day+bucketEnd) - MAX(start, day+bucketStart))` | One row-2 spill anchor per bucket (O(1) vs row count) |
| BE:BF summary matrix | `SUMIFS(ActualStaffAH[<bucket>], Athlete Site, "<site>")*(1440/30)` for CNX/INT site variants | Bounded summary block on `_CALC_STAFF` (96 SUMIFS-class formulas in Excel) |

## Installer / checkpoint contract (planned)

| Item | Value |
|---|---|
| Script Property | `CXP08_AHT_AUXES_STAFF_INSTALL_STATE` |
| Initialize | `initializeCxp08AhtAuxesStaffTransformations` |
| Continue | `continueCxp08AhtAuxesStaffTransformations` |
| Status | `getCxp08AhtAuxesStaffTransformationStatus` |
| Reset | `resetCxp08AhtAuxesStaffInstallationState` |
| States | `IDLE` / `RUNNING` / `COMPLETE` / `FAILED` |
| Preflight | Exact CXP-03 headers on `_RAW_AHT`, `_RAW_AUXES`, `_RAW_STAFF` before any calc clear |

UAT harness helpers that map 1:1 to a successive process use the `CXP08UatStepNN(process)` form (for example `CXP08UatStep03LoadParityFixture`). See the runbook for the full succession.

## Local vs hosted verification

| Boundary | Proves |
|---|---|
| `npm run test:cxp08` (planned) | Fixture parity against a reference model, formula anchors/bounds, constant write shape, checkpoint/resume plan, schema-drift rejection, idempotent reinstall |
| Hosted UAT ([`docs/cxp08-uat-runbook.md`](../cxp08-uat-runbook.md)) | Formula parse, spill completion, multi-invocation continuation, ~7k/~3k/~300 timing, representative parity or CXP-01-rooted delta |

Node cannot execute Google Sheets formulas; promotion requires hosted `CXP08UatStep01`–`CXP08UatStep08` evidence.

## Implementation tasks

- [x] Formula catalog + reference model for AHT / Auxes / Staff
- [x] Checkpointed installer service + Apps Script entrypoints
- [x] Synthetic parity fixture under `tests/fixtures/cxp08/`
- [x] `npm run test:cxp08` coverage
- [x] Hosted UAT helpers named `CXP08UatStep01` … `CXP08UatStep08` (+ harness doc)
- [x] Logic doc (peer of `docs/handled-offered-native-transformations.md`)
- [ ] Packet-status completion handoff after hosted UAT

## CXP-09 handoff checklist

- Expose `_CALC_AHT` measures needed for AHT / ACW / ASA / Concurrency aggregates (including Service Level, ASA Total, CC, Interval, Date, Handle Time fields).
- Expose `_CALC_AUXES` Available / Concluding hours at interval/site grain for Aux Productive / productive-time aggregates.
- Expose `_CALC_STAFF` half-hour overlaps and BE:BF site summaries as inputs to Scheduled / Actual (SO) style measures; do not recreate Interval View ratios here.
- Preserve DEC-025 fixed-PST business dates/intervals; do not re-floor UTC raw hours.
- Do not depend on Excel structured references or `#This Row` fill-down at runtime.
