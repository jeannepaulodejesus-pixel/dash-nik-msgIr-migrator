# Legacy Workbook Inventory

## Evidence boundary

This inventory is verified against the read-only WB0817 XLSX package identified below. The workbook was not opened and saved through Excel, and no cached cell values or author/refresh identities are copied into the repository. Exact machine-readable object definitions live in `config/workbook-object-catalog.json`.

| Property | Verified value |
|---|---|
| File | `MSG Intraday EOD 0817.xlsx` |
| Size | 6,975,923 bytes |
| SHA-256 | `CD8F8EC6F68FBEC85841CD64C251616FCECD0AD67DE4714EFB244F648548E65A` |
| Modified time | 2026-08-21 17:16:33 UTC |
| Validation authority | WB0817, selected by the user on 2026-08-22 |
| Format | XLSX, no VBA project |
| Date system | 1900 (`date1904=0`) |
| Calculation metadata | `calcId=191029`; no explicit `calcMode` stored |
| Connections / external links / data model | None present in the package |
| Workbook structure protection | None present |

WB0817 supersedes WB0809 as the validation-control authority. The meeting-note WB0816 screenshot and the prior WB0809 binary remain historical comparison evidence only.

## Worksheets

| # | Sheet | State | Used range | Formula cells | Cached errors | Verified role |
|---:|---|---|---|---:|---|---|
| 1 | Teams Update | Visible | `B1:U31` | 77 | 13 `#REF!` | Operations update output dependent on Interval View, Data, Drivers and Allocation, and AHT Handled Offered |
| 2 | Interval View | Visible | `B2:AD162` | 2,859 | 8 `#REF!` | Primary operational report; all 25 registry metrics are in `C112:AB151` |
| 3 | AHT Handled Offered | Visible | `B11:BM148` | 0 | None | Five-pivot aggregation hub for volume, service level, AHT, ACW, ASA, and concurrency |
| 4 | Drivers and Allocation | Visible | `A1:AH172` | 51 | 6 `#DIV/0!` | Seven-pivot driver/allocation hub and interval share calculations |
| 5 | Data | Visible | `A1:Z43` | 582 | None | Forecast, staffing, required, actual, and AHT consolidation layer |
| 6 | Handled | Visible | `A1:AD7274` | 18,162 | None | Handled input table and three calculated enrichment columns |
| 7 | Offered | Visible | `A1:AP5717` | 85,740 | 1,838 `#N/A` | Offered input table and 15 calculated service-level/session columns |
| 8 | AHT - Raw | Visible | `A1:AH9280` | 55,027 | None | AHT input table and seven calculated interval/service columns |
| 9 | Auxes - Raw | Visible | `A1:AD3399` | 13,592 | None | Presence/aux input table and four calculated interval/hour columns |
| 10 | Backlogs | Hidden | `A12:AN52` | 0 | None | Backlog PivotTable sourced from AHT_Raw; one Interval slicer |
| 11 | pull outs for alloc | Hidden | `A1:AG40` | 571 | 20 `#DIV/0!` | Allocation-export support dependent on Interval View, Data, and Teams Update |
| 12 | Staff | Visible | `A1:BF1877` | 90,098 | None | Staffing input, 48 half-hour table calculations, and BE:BF staffing summary formulas |
| 13 | Detail1 | Hidden | `A1:F4` | 0 | None | One-row six-column forecast/required table; no formula or pivot consumer was found |
| 14 | Forecast and Allocation Pivot | Visible | `A2:AZ80` | 0 | None | Two-pivot forecast/required and allocation aggregation surface |
| 15 | SEF | Visible | `B1:Z1598` | 4,881 | None | Weekly forecast/required and allocation staging; three table slicers |
| 16 | MOM | Visible | `A1:BA52` | 36 | None | Weekly manual input calendar for required FTE, forecast volume, and forecast AHT |
| 17 | Data Source | Visible | `A2:B19` | 0 | None | Source-label/reference surface |

The three hidden sheets are exactly Backlogs, pull outs for alloc, and Detail1. Interval View, Data, and AHT - Raw contain sheet-protection elements with formatting/filter/pivot permissions but no password hash; the raw protection attributes are retained in the object catalog.

The inflated Handled and AHT - Raw used-range row endpoints contain no populated cells below their Excel Tables. Auxes - Raw AC:AD are also unpopulated. Staff BE:BF contains 96 SUMIFS formulas and 100 supporting constants outside `ActualStaffAH`; these form a staffing summary matrix and are included in the formula/dependency catalogs.

## Excel Tables and representative-source coverage

| Sheet | Table | Range | Capacity rows | Columns | Calculated | WB0817 populated source rows | Representative rows |
|---|---|---|---:|---:|---:|---:|---:|
| Teams Update | Table6 | `E27:E31` | 4 | 1 | 1 | — | — |
| Handled | Handled | `A1:AD6055` | 6,054 | 30 | 3 | 5,024 | 1,614 |
| Offered | Offered | `A1:AP5717` | 5,716 | 42 | 15 | 4,797 | 1,652 |
| AHT - Raw | AHT_Raw | `A1:AH7862` | 7,861 | 34 | 7 | 6,656 | 1,969 |
| Auxes - Raw | Table4 | `A1:AB3399` | 3,398 | 28 | 4 | 2,904 | 754 |
| Staff | ActualStaffAH | `A2:BA1877` | 1,875 | 53 | 48 | 306 | 87 |
| Detail1 | Table8 | `A3:F4` | 1 | 6 | 0 | — | — |
| SEF | Table510 | `B2:G1598` | 1,596 | 6 | 1 | — | — |
| SEF | Table5 | `W2:Z95` | 93 | 4 | 0 | — | — |

Table capacity is not a delivery row requirement. The representative files are partial-day snapshots, while WB0817 is an EOD control; their exact cutoff mismatch is documented in `config/source-delivery-contract.json`.

## PivotTables and caches

Fifteen PivotTables use seven caches. Exact field arrays, cache fields, filters, and refresh metadata are in the machine catalog.

| Sheet | PivotTable | WB0817 output | Source | Main dimensions and values |
|---|---|---|---|---|
| AHT Handled Offered | PivotTable9 | `AE14:AK54` | Offered | Interval View; page Athlete Site; Offered, Handled, In SL, SL %, SL TTC, AHT Session |
| Drivers and Allocation | CNX Split | `X20:AE24` | Offered | Accept Date × Initial Athlete Site; case-count allocation |
| Drivers and Allocation | Drivers | `A20:D45` | Handled | Purpose and Resolution; case count, volume share, average AHT |
| Drivers and Allocation | PivotTable2 | `AG4:AH45` | Table4 | Interval; pages Athlete Site and Date; Productive sum |
| Backlogs | PivotTable1 | `A12:AN52` | AHT_Raw | Request Interval × Interval; work-item count |
| Forecast and Allocation Pivot | PivotTable3 | `A47:D80` | Table5 | Date × Site; Allocation sum |
| Forecast and Allocation Pivot | PivotTable1 | `A2:AZ44` | Table510 | Time × Site × Type × Date; Required sum |
| AHT Handled Offered | CNX AHT | `B12:N53` | AHT_Raw | Interval × Athlete Site; Handle Time, Active Time, ACW, AHT, ASA Total, Concurrency |
| AHT Handled Offered | CNX Enterprise | `B106:P147` | Offered | Interval View × Athlete Site; volume/SL/AHT-session measures |
| AHT Handled Offered | All Sites | `B58:AY100` | Offered | Interval View × Athlete Site; volume/SL/AHT-session measures |
| AHT Handled Offered | AHT All Site | `Y14:AC53` | AHT_Raw | Interval; Handle Time, ACW, AHT, ASA Total |
| Drivers and Allocation | Allocation | `G14:K54` | Offered | Interval View × Initial Athlete BPO; case-count allocation |
| Drivers and Allocation | PivotTable3 | `N14:R54` | Offered `A1:AP1048576` | Interval View × Initial Athlete BPO; BPO count |
| Drivers and Allocation | PivotTable4 | `X9:AA17` | Offered | Athlete Site × Accept Date; case-count allocation |
| Drivers and Allocation | PivotTable6 | `X27:AE31` | Offered | Accept Date × Athlete Site; Handled sum |

## Slicers, names, and package features

The workbook has five slicer collection parts containing 24 controls backed by 19 caches. Interval View owns 3, AHT Handled Offered 7, Drivers and Allocation 10, Backlogs 1, and SEF 3. SEF's Type, Site, and Day caches are table slicers and therefore have no PivotTable connection.

There are 21 workbook-defined names. `LOB` and `sst` resolve to `#REF!`; the other 19 are slicer names whose stored formulas resolve to `#N/A`. There are no workbook connections, external-link parts, VBA project, or data-model parts.

## Cached error baseline

| Sheet | `#N/A` | `#DIV/0!` | `#REF!` | Total |
|---|---:|---:|---:|---:|
| Offered | 1,838 | 0 | 0 | 1,838 |
| Drivers and Allocation | 0 | 6 | 0 | 6 |
| pull outs for alloc | 0 | 20 | 0 | 20 |
| Interval View | 0 | 0 | 8 | 8 |
| Teams Update | 0 | 0 | 13 | 13 |
| **Total** | **1,838** | **26** | **21** | **1,885** |

Cached errors are version/data-state evidence, not a timeless project constant. The owner accepts WB0817's exact error baseline as intentional legacy behavior for parity.

## Closure and retirement boundary

The WB0817 object inventory and CXP-01 operating decisions are complete. Same-bundle intraday parity replaces the unavailable exact-EOD fixture requirement without asserting that the representative rows equal WB0817 EOD. Backlogs and Detail1 have no discovered path to Interval View and may be retired only after an implementation-time dependency recheck confirms the same result; Aux Productive remains operational by owner decision.
