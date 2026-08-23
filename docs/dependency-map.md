# Legacy Workbook Dependency Map

## Evidence boundary

This map is verified against WB0817 hash `CD8F8EC6F68FBEC85841CD64C251616FCECD0AD67DE4714EFB244F648548E65A`. Edges come from formulas, table calculated columns, PivotTable cache sources, slicer-cache connections, workbook relationships, the five SHA-bound representative HTML-table deliveries, and owner-confirmed manual procedures. The same-bundle intraday parity and full-export replacement semantics are final in `config/source-schema-draft.json`.

## Primary calculation graph

```text
MOM manual weekly inputs
        |
        v
SEF::Table510 ----> Forecast and Allocation Pivot::PivotTable1
        |                              |
        |                              v
        +---------------------------> Data -------------------+
                                                               |
AHT_Raw --> Handled --> Offered --> volume/SL/AHT pivots ------+--> Interval View
    |          |          |                                    |       |
    |          |          +--> allocation pivots --> Drivers --+       +--> Teams Update
    |          |                                                        +--> pull outs for alloc
    |          +--> Drivers purpose/AHT pivot
    +--> AHT/ASA/concurrency pivots
    +--> Backlogs (hidden)

Auxes/Table4 --> Productive pivot on Drivers and Allocation (operational)
Staff/ActualStaffAH --> Staff BE:BF half-hour staffing summaries --manual paste--> Data
Detail1/Table8 (hidden) --> no formula or PivotTable consumer found; retire after final recheck
```

## Verified source and transformation edges

| From | To | Edge evidence | Purpose |
|---|---|---|---|
| Representative AHT HTML table | AHT_Raw source columns | 27 ordered headers after `Speed to Answer` → Excel-deduplicated `Speed to Answer2` alias; all 1,969 Agent Work IDs occur in WB0817 | Populate AHT/session raw facts; exact values drift on 71 records as the control advances beyond the source cutoff |
| Representative Handled HTML table | Handled source columns | 27 ordered headers; 1,611 of 1,614 Messaging Session Names occur in WB0817 | Populate handled-session source fields |
| Representative Offered HTML table | Offered source columns | 27 ordered headers; 1,651 of 1,652 Messaging Session Names occur in WB0817 | Populate offered-session source fields |
| Representative Aux HTML table | Table4 source columns | 24 ordered headers; all 754 `User Presence ID` values occur in WB0817 | Populate presence/aux status facts |
| Representative Staffing HTML table | ActualStaffAH source columns | 5 ordered headers; 67 of 87 complete sample rows occur unchanged in WB0817 | Populate staffing status intervals |
| AHT_Raw | Handled calculated columns | Structured references, XLOOKUP, and SUMIFS | Resolve handled accept date, interval, and AHT |
| AHT_Raw + Handled | Offered calculated columns | XLOOKUP/VLOOKUP/COUNTIFS/SUMIFS structured-reference families | Resolve offered date/site, handled state, SL, ASA, AHT Session, and Active Time |
| Offered | All Sites, CNX Enterprise, PivotTable9 | Pivot caches sourced from table Offered | Volume, handled, in-SL, SL %, SL TTC, AHT Session, Active Time |
| AHT_Raw | CNX AHT and AHT All Site | Pivot caches sourced from table AHT_Raw | AHT, ACW, ASA Total, Active Time, Concurrency |
| Offered | Allocation, PivotTable3, CNX Split, PivotTable4, PivotTable6 | Pivot caches and one full-column source | Allocation, BPO split, and handled shares |
| Handled | Drivers | Pivot cache sourced from table Handled | Purpose/resolution case count, share, and AHT |
| Table4 | PivotTable2 | Pivot cache sourced from Auxes table | Productive time by interval/site/date |
| ActualStaffAH | Staff BE:BF | 96 SUMIFS formulas outside the table | Summarize half-hour staffing for CNX/INT site variants |
| Staff BE:BF | Data B, D, F, M, R, X | Owner-confirmed RTA copy/paste procedure; no OOXML formula edge exists | Supply scheduled, actual, and support staffing inputs |
| MOM | SEF::Table510 | SEF formulas reference MOM weekly date columns and row 12 inputs | Stage required FTE, forecast volume, and AHT by day/time/site/type |
| SEF::Table510 | Forecast PivotTable1 | Pivot cache sourced from Table510 | Aggregate Required values by Time, Site, Type, Date |
| SEF::Table5 | Forecast PivotTable3 | Pivot cache sourced from Table5 | Aggregate Allocation by Date and Site |
| Forecast PivotTable1 | Data | 228 GETPIVOTDATA cells | Pull forecast, required, and AHT for PH/LAS |
| Data | Interval View | VLOOKUP and direct consolidation formulas | Supply forecast and staffing inputs to the combined 25-metric block |
| AHT/volume pivots | Interval View | 1,008 GETPIVOTDATA cells | Supply volume, service-level, AHT, ACW, ASA, and concurrency metrics |
| Drivers and Allocation | Interval View | VLOOKUP from `G:K` and `N:S` | Supply Allocation and Cumulative Allocation |
| Interval View | Teams Update | Direct references, VLOOKUP/XLOOKUP, and GETPIVOTDATA | Operations update KPIs and staffing windows |
| Interval View + Data + Teams Update | pull outs for alloc | Direct formulas | Allocation-export support calculations |

## Output graph for the 25-metric block

Interval View uses three report blocks. The combined block at `C112:AB151` is the contract surface because it contains PST plus the exact 25-metric registry. Rows 113:150 are 38 half-hour intervals; row 151 is the total/summary row.

- Forecast and Required trace through Data to Forecast PivotTable1, SEF::Table510, and MOM.
- Offered, Handled, Chats in SL, SL %, SL TTC, and AHT Session trace through Offered pivots.
- AHT, ACW, ASA in Seconds, and Concurrency trace through AHT_Raw pivots.
- Allocation and Cumulative Allocation trace through allocation pivots on Offered.
- Scheduled and Actual (SO) trace through Data consolidation columns containing Staff-derived values. RTA manually copies Staff BE:BF into Data B, D, F, M, R, and X; this is an approved manual edge rather than an OOXML formula edge.
- Derived ratios, variances, and hours trace directly to other cells in the same Interval View row.

Exact per-metric formulas and stepwise lineage are in `config/metric-lineage-contract.json` and summarized in `docs/metric-lineage.md`.

## Hidden-sheet dependencies

| Hidden sheet | Verified incoming edges | Verified outgoing edges | Migration decision |
|---|---|---|---|
| Backlogs | PivotTable1 reads AHT_Raw; Interval slicer connects to this pivot | No formula consumer or path to Interval View found | Approved for retirement after one final dependency recheck |
| pull outs for alloc | Reads Interval View, Data, and Teams Update; also self-references allocation helper cells | No downstream workbook formula consumer found | Treat as allocation export/report support, not dead code |
| Detail1 | Contains Table8 | No formula, pivot-cache, slicer consumer, or path to Interval View found | Approved for retirement after one final dependency recheck |

## Slicer-to-pivot dependencies

Nineteen slicer caches expose 37 cache-to-PivotTable connections across Drivers, AHT/volume pivots, the Backlogs pivot, and Forecast PivotTable1. Three SEF table slicers—Type, Site, and Day—have no PivotTable connection. Exact instance, cache, source-field, and connection lists are in `config/workbook-object-catalog.json`.

## Approved operational edges

No package-level external links, connections, or data model exist. Five separate `.xls`-named HTML tables map deterministically to the five logical workbook tables. Owner decisions resolve the non-OOXML edges:

- parity compares a fresh legacy copy and migrated system loaded from the identical five-file intraday bundle, not the partial-day files against WB0817 EOD rows;
- each hourly cycle validates and replaces the full export; exact rows alone are deduplicated;
- source export time is GMT/UTC; migration preserves raw UTC, subtracts 480 minutes to fixed PST (`UTC−08:00`, ZoneId `Etc/GMT+8`), and only then applies 30-minute left-edge flooring. WB0817's core source-to-interval formulas omit this conversion;
- RTA copies Staff BE:BF into Data B, D, F, M, R, and X;
- Aux Productive remains operational even though it has no formula path to Interval View;
- Backlogs and Detail1 are retireable because the current graph has no path to Interval View, but removal fails closed if a final automated/manual dependency recheck finds one.
