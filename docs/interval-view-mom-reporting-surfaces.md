# CXP-10 Interval View and MOM Reporting Surfaces

## Runtime contract

`initializeCxp10ReportingSurfaces()` opens only the configured target spreadsheet and starts or resumes a checkpointed installation. Run CXP-02 and CXP-09 first so backend aggregation sheets and user-facing report placeholders exist. CXP-10 validates `_AGG_INTERVAL`, `_AGG_FORECAST`, and `_AGG_ALLOCATION` before mutating report ranges.

The hosted runner divides installation into retry-safe steps: one aggregation preflight, then bounded writes for Interval View headers, interval axis, metric formula anchors, summary row, MOM weekly layout, and the `_AGG_FORECAST` MOM bridge. Progress persists in `CXP10_REPORTING_INSTALL_STATE`. A four-minute cooperative budget, one-second continuation trigger, and seven-minute safety trigger mirror CXP-07 through CXP-09.

`getCxp10ReportingSurfaceStatus()` reads persisted progress without opening the spreadsheet. Re-running the initializer after `COMPLETE` starts a clean reinstall.

## Data sources

Interval View reads **only** CXP-09 aggregation tables:

| Metric family | Backend source | Lookup pattern |
|---|---|---|
| Offered, Handled, Chats in SL, SL TTC, AHT (Session), AHT, ACW, ASA, Concurrency | `_AGG_INTERVAL` | `SUMIFS` across PH + LAS at Date + Interval grain |
| Forecast, Required, Scheduled, Actual (SO) | `_AGG_FORECAST` | `SUMIFS` by Date + Interval + Type |
| Allocation, Cumulative Allocation | `_AGG_ALLOCATION` | `SUMIFS` across BPO rows at interval grain |
| Abandoned, SL %, forecast ratios, hours, variances | Same-row Interval View columns | Preserves CXP-01 formula families |

MOM is the RTA-facing weekly input calendar. Manual values in `MOM!A13:E50` (Date, Interval, Site, Type, Value) feed `_AGG_FORECAST` through a bridge QUERY installed at `A2`, replacing the CXP-09 self-referential forecast passthrough.

## Combined block layout

The contract surface is Interval View `C112:AB151`:

- `D112:AB112` — exact 25-metric registry from `config/metric-lineage-contract.json`
- `A113:B150` — fixed-PST date and 30-minute interval axis (38 rows)
- `D113:AB150` — combined PH+LAS metrics at date + interval grain
- Row `151` — summary totals/averages per metric-lineage contract

Columns `A` and `B` hold the lookup keys; column `C` remains available for legacy-compatible interval labels.

## Contract anomalies preserved

1. **Handled zero/blank:** rows 113–121 return numeric zero; rows 122–150 return blank when PH+LAS handled sum is zero.
2. **AHT (Session) divisor:** interval rows divide aggregated session AHT by 63; summary row `O151` divides by 60.
3. **Scheduled-to-Required:** interval rows divide directly; summary `AB151` wraps in `IFERROR`.

## Business-day and weekly rollover

- Interval View `A1` is the intraday business-day anchor RTAs set when opening a daily workbook.
- MOM `A1` is the week-start anchor; `B4:H4` roll seven day headers via `=$A$1+n`.
- RTAs update `A1` / MOM `A1` at weekly rollover; report formulas refresh from aggregation dependency alone.

## Verification boundary

`npm run test:cxp10` proves reference-model parity against `tests/fixtures/cxp10/report-parity.json`, install topology, checkpoint/resume, and aggregation preflight. Hosted UAT per `docs/cxp10-uat-runbook.md` is required before promotion.
