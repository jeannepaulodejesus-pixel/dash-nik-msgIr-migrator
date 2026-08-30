# CXP-10 Interval View and MOM Reporting Surfaces

## Runtime contract

`initializeCxp10ReportingSurfaces()` opens only the configured target spreadsheet and starts or resumes a checkpointed installation. CXP-02 and CXP-09 must already be installed. CXP-10 validates `_AGG_INTERVAL`, `_AGG_FORECAST`, and `_AGG_ALLOCATION` before mutating report ranges.

The hosted runner uses bounded, retry-safe steps for Interval View chrome, headers, axis, metric formulas, totals, MOM calendar formulas, and the `_AGG_FORECAST` MOM bridge. Progress persists in `CXP10_REPORTING_INSTALL_STATE_V2`; the versioned key prevents a pre-redesign cursor from resuming against the new surface contract. Reinstall preserves the RTA-owned Interval View `AA2` date and MOM manual-input grids.

## Data sources

Interval View reads only CXP-09 aggregation tables:

| Metric family | Backend source | Lookup pattern |
|---|---|---|
| Offered, Handled, Chats in SL, SL TTC | `_AGG_INTERVAL` | `SUMIFS` at Date + Interval grain |
| AHT (Session), AHT, ACW, ASA, Concurrency | `_AGG_INTERVAL` | matching-row averages at Date + Interval grain |
| Forecast, Required, Scheduled, Actual (SO) | `_AGG_FORECAST` | `SUMIFS` by Date + Interval + Type |
| Allocation, Cumulative Allocation | `_AGG_ALLOCATION` | INT-BPO offered share at interval and cumulative grain |
| Abandoned, SL %, forecast ratios, hours, variances | Same-row report columns | control-derived formulas |

MOM remains the RTA-facing weekly input calendar: `CHAT MNL` (`A:X`) and `CHAT LV` (`Y:AV`), editable week start at `B3`, and 48 half-hour rows from `00:00` through `23:30`. Manual Required/Forecast values unpivot into `_AGG_FORECAST`; Forecast AHT remains visible but is not bridged.

## Control-derived Interval View contract

The renderer is hash-bound to `MSG Intraday EOD 0817.xlsx` (SHA-256 `CD8F8EC6F68FBEC85841CD64C251616FCECD0AD67DE4714EFB244F648548E65A`):

- `AA2` — editable View Date; `C2` mirrors it for display.
- `B97:AB151` — CXP-10-owned operational block; B is the hidden Remarks column. The date-specific allocation target in `D97` is preserved across reinstall and drives the `E97:F97` ±5% band and Allocation +/- card.
- `B112` — `Remarks`; `C112` — `PST`; `D112:AB112` — exact 25-metric registry.
- `C113:C150` — exactly 38 half-hours from `04:00` through `22:30`; no visible helper columns.
- `D113:AB150` — spill formulas for all 25 metrics.
- `C151:AB151` — Grand Total with all 25 total formulas populated.
- `K102:X109`, `C103:I109`, and `C111:AB111` — title, KPI cards, legend, and merged section labels.

The presentation layer owns the verified merges, dimensions, font, borders, number formats, hidden gridlines/Remarks column, and conditional-format bands. The independent machine-readable oracle is `tests/fixtures/cxp10/interval-view-control-contract.json`.

## Formula corrections

- Row-local blank/zero guards replace scalar `OR(range...)` expressions that broadcast one result across the spill.
- AHT Session uses explicit parentheses around the combined-site numerator before division.
- Timing metrics no longer add site-level averages.
- Allocation uses INT-BPO share semantics rather than unrelated site/BPO fields.
- All 25 totals are present and error-guarded where division is involved.

## Business-day and weekly rollover

The visible PST axis is time-only. Each lookup combines `INT($AA$2)` with its row time. RTAs advance Interval View `AA2` and MOM `B3`; formulas refresh from aggregation dependencies without reinstall.

## Verification boundary

`npm run test:cxp10` proves reference parity, the independent control contract, install topology, checkpoint/resume, and aggregation preflight. The promotion gate additionally requires an exact 38-row axis, complete headers/totals/layout, zero formula errors, no legacy backend references, and at least one passing on-axis parity row. Hosted UAT and visual sign-off remain required before promotion.
