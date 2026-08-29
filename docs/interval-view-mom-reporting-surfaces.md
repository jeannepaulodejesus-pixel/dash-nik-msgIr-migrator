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

MOM is the RTA-facing weekly input calendar matching the Band-Aid Step 1 skeleton: `CHAT MNL` (`A:X`) and `CHAT LV` (`Y:AV`), with Required FTE / Forecasted Volume / Forecast AHT section grids, editable week-start at `B3`, day headers `B3:H3` (+ mirrors), and 48 half-hour rows via `SEQUENCE` at `A5` (`00:00`–`23:30`). Manual Required/Forecast values unpivot into `_AGG_FORECAST` through a spill bridge at `A2` (PH←MNL, LAS←LV). Forecast AHT grids stay RTA-visible only and are not bridged.

## Combined block layout

The contract surface is Band-Aid Internal View layout on the `Interval View` sheet (`A16:Z65`):

- `AA2` — View Date anchor (RTA-editable); `C2` mirrors `=$AA$2`
- `A16` — `PST`; `B16:Z16` — exact 25-metric registry from `config/metric-lineage-contract.json`
- `A17:A54` — `SEQUENCE` of 38 half-hours from `AA2+04:00` through `22:30`
- `B17:Z54` — combined PH+LAS metrics keyed by `INT(A)` date + `MOD(A,1)` interval against `_AGG_*`
- Row `65` — Grand Total summary

(Sheet name stays `Interval View` per CXP-02; Band-Aid Excel names the same surface Internal View.)

Columns `A` and `B` hold the lookup keys; column `C` remains available for legacy-compatible interval labels.

## Contract anomalies preserved

1. **Handled zero/blank:** rows 17–25 return numeric zero; rows 26–54 return blank when PH+LAS handled sum is zero.
2. **AHT (Session) divisor:** interval rows divide aggregated session AHT by 63; summary row `M65` divides by 60.
3. **Scheduled-to-Required:** interval rows divide directly; summary `Z65` wraps in `IFERROR`.

## Business-day and weekly rollover

- Interval View `AA2` is the View Date anchor. Axis keys are `$AA$2 + 04:00 + n×30 minutes` for 38 slots (`04:00`–`22:30`).
- MOM `B3` is the editable week-start anchor; `C3:H3` advance as `=B3+1`… and volume/AHT/LV date rows mirror `=$B$3`…`=$H$3`.
- RTAs update Interval View `AA2` and MOM `B3` at weekly rollover; report formulas refresh from aggregation dependency alone.
- Hosted parity compares fixture grains on the `04:00`–`22:30` axis when present; otherwise requires a full 38-row axis page.

## Verification boundary

`npm run test:cxp10` proves reference-model parity against `tests/fixtures/cxp10/report-parity.json`, install topology, checkpoint/resume, and aggregation preflight. Hosted UAT per `docs/cxp10-uat-runbook.md` is required before promotion.
