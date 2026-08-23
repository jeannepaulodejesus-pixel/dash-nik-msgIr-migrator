# Formula Family Catalog

## Authority and method

`config/formula-family-catalog.json` is the complete machine-readable authority for the SHA-256-bound WB0817 workbook. It records all 271,676 formula cells in 350 normalized A1-relative families, with sheet, counts, column coverage, samples, functions, direct references, cached errors, and an analyst-classified business category.

Formula normalization preserves absolute references and structured references while replacing relative A1 coordinates with row/column offsets. Shared formulas are translated to each target cell before classification. The catalog classification describes the formula's workbook role; it does not replace business-owner validation.

## Exact profile

| Measure | Binary value | Reconciliation |
|---|---:|---|
| Formula cells | 271,676 | One fewer than WB0809/project record |
| Normalized families | 350 | One fewer than WB0809 |
| Structured-reference cells | 172,617 | 96 more than the project record |
| `#This Row` structured-reference cells | 172,521 | Exactly matches the earlier “structured reference” value |
| GETPIVOTDATA cells | 1,247 | Exact binary count; earlier record said at least 1,247 |
| Cached error cells | 1,885 | WB0817 data-state value; not a timeless project constant |

The 96-cell difference is on Staff: 96 structured-reference formulas refer to `ActualStaffAH` without `#This Row`. The project record therefore appears to have counted `#This Row`, not every structured-reference cell.

WB0817 omits the single Interval View C111 array family that existed in WB0809. The 25-metric contract block at `C112:AB151` is otherwise formula-identical between the two inspected binaries.

## Families by sheet and business category

| Sheet | Formula cells | Families | Business category |
|---|---:|---:|---|
| Staff | 90,098 | 100 | Staff interval overlap |
| Offered | 85,740 | 15 | Offered enrichment and service-level logic |
| AHT - Raw | 55,027 | 7 | AHT interval enrichment |
| Handled | 18,162 | 3 | Handled session enrichment |
| Auxes - Raw | 13,592 | 4 | Presence/aux interval enrichment |
| SEF | 4,881 | 54 | Weekly forecast and required staging |
| Interval View | 2,859 | 88 | Operational reporting |
| Data | 582 | 20 | Forecast and staffing consolidation |
| pull outs for alloc | 571 | 14 | Allocation-export support |
| Teams Update | 77 | 34 | Operations update |
| Drivers and Allocation | 51 | 10 | Allocation and driver calculation |
| MOM | 36 | 1 | Weekly forecast input calendar |

## Major calculated-column families

| Table / range | Count | Purpose | Representative formula |
|---|---:|---|---|
| Handled `[Accept Date]` | 6,054 | Resolve AHT accept date by Messaging Session Name | `IFERROR(INT(TEXT(IF(XLOOKUP(...)=0,XLOOKUP(...),XLOOKUP(...)),"mm/dd/yy")),"")` |
| Handled `[Interval]` | 6,054 | Bucket resolved accept time into 30-minute intervals | `IFNA(TIME(HOUR(...),FLOOR(MINUTE(...),30),0),"")` |
| Handled `[AHT]` | 6,054 | Sum AHT_Raw Handle Time by work item and date | `SUMIFS(AHT_Raw[Handle Time],...)` |
| Offered 15 calculated columns | 85,740 | Resolve date/site, count offered/handled, compute SL/ASA/session AHT/active time | Exact formulas in JSON catalog |
| AHT_Raw seven calculated columns | 55,027 | Date/interval buckets, count, 90-second service-level flag, ASA Total, concurrency, request interval | Exact formulas in JSON catalog |
| Auxes four calculated columns | 13,592 | Date/interval buckets and Available/Concluding hours | Exact formulas in JSON catalog |
| Staff half-hour columns | 90,000 | Overlap each status interval with 48 half-hour buckets | `MAX(0,MIN(end,day+bucketEnd)-MAX(start,day+bucketStart))` |

## GETPIVOTDATA distribution

| Sheet | Cells | Families | Role |
|---|---:|---:|---|
| Interval View | 1,008 | 46 | Operational output metrics |
| Data | 228 | 6 | Forecast, required, and AHT consolidation |
| Drivers and Allocation | 6 | 6 | Handled allocation shares |
| Teams Update | 5 | 5 | Operations update KPIs |
| **Total** | **1,247** | **63** | |

## Accepted legacy formula anomalies

- Interval View `F113:F121` returns numeric zero while `F122:F150` converts the shifted zero result to blank.
- Interval View `O113:O150` divides AHT Session by 63, while total `O151` divides by 60.
- Interval View `AB113:AB150` performs direct Scheduled/Required division without `IFERROR`; `AB151` does use `IFERROR`.
- The workbook contains broken defined names `LOB` and `sst`, 21 cached `#REF!` cells, 26 `#DIV/0!` cells, and 1,838 `#N/A` cells.
- Teams Update contains formulas with broken Interval View references, including `#REF!` operands.

The owner classifies every item above as intentional legacy behavior. Migration parity must preserve them; any unlisted error or changed formula behavior remains a migration defect unless a later approved decision supersedes this baseline.
