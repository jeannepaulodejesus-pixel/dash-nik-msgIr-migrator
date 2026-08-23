# Operational Metric Lineage

## Contract surface

The user-selected WB0817 binary contains the exact 25-metric registry on Interval View `D112:AB112`. Rows 113:150 hold 38 half-hour interval calculations and row 151 holds totals/summary values. Machine-readable formulas, formats, formula-family counts, and lineage steps live in `config/metric-lineage-contract.json`.

Every row below has binary-verified internal workbook lineage. Representative delivery schemas map to the five workbook input tables, and `config/source-schema-draft.json` defines the approved same-bundle intraday parity, timestamp, duplicate, null/error, and full-replacement semantics.

| Metric | Interval range | Representative interval rule | Verified upstream chain |
|---|---|---|---|
| Forecast | `D113:D150` | VLOOKUP Data Combined forecast by PST | Data G:H GETPIVOTDATA -> Forecast PivotTable1 -> SEF::Table510 -> MOM |
| Offered | `E113:E150` | Sum PH and LAS Offered blocks | All Sites pivot -> Offered `[Count]` |
| Handled | `F113:F150` | Sum PH and LAS Handled blocks; `F122:F150` returns blank for zero | All Sites pivot -> Offered `[Handled]` |
| Chats in SL | `G113:G150` | Sum PH and LAS in-SL blocks | All Sites pivot -> Offered `[SL Total]` |
| Abandoned | `H113:H150` | Offered minus Handled | Same-row Offered and Handled |
| SL % Total | `I113:I150` | Chats in SL / Offered | Same-row metrics with blank fallback |
| SL (Time To Connect) | `J113:J150` | GETPIVOTDATA SL TTC | All Sites pivot -> average Offered `[SL]` |
| % of Forecast Offered | `K113:K150` | Offered / Forecast | Same-row metrics; single-space fallback |
| % of Forecast Handled | `L113:L150` | Handled / Forecast | Same-row metrics; single-space fallback |
| Allocation | `M113:M150` | VLOOKUP Drivers `G:K`, column 3 | Allocation pivot -> Offered case counts by interval and BPO |
| Cumulative Allocation | `N113:N150` | VLOOKUP Drivers `N:S`, column 6 | PivotTable3 -> INT count / Grand Total |
| AHT (Session) | `O113:O150` | GETPIVOTDATA AHT Session / 63 | CNX Enterprise pivot -> average Offered `[AHT Session]` |
| AHT | `P113:P150` | GETPIVOTDATA AHT / 60 | CNX AHT pivot -> average AHT_Raw `[Handle Time - Total]` |
| ACW | `Q113:Q150` | GETPIVOTDATA ACW / 60 | CNX AHT pivot -> average AHT_Raw `[After Conversation Work Actual Time]` |
| ASA in Seconds | `R113:R150` | `(GETPIVOTDATA ASA Total / 60) * 60` | CNX AHT pivot -> average calculated AHT_Raw `[ASA Total]` |
| Concurrency | `S113:S150` | GETPIVOTDATA Concurrency | CNX AHT pivot -> average calculated AHT_Raw `[CC]` |
| Scheduled | `T113:T150` | VLOOKUP Data Scheduled Combined | Data O = B + F + R + X; RTA pastes Staff-derived values into Data |
| Required | `U113:U150` | VLOOKUP Data Combined Required | Data P = PH Required + LAS Required from Forecast PivotTable1 |
| Actual (SO) | `V113:V150` | VLOOKUP Data PH & LV Staffing | Data L = D + M + X; RTA pastes Staff-derived values into Data |
| Actual vs Required | `W113:W150` | Actual (SO) - Required | Same-row metrics |
| Scheduled Hours | `X113:X150` | Scheduled × 30 / 1440 | Same-row Scheduled |
| Required Hours | `Y113:Y150` | Required × 30 / 1440 | Same-row Required |
| Actual | `Z113:Z150` | Actual (SO) × 30 / 1440 | Same-row Actual (SO) |
| Actual to Required | `AA113:AA150` | Actual hours / Required hours | Same-row hour metrics with blank fallback |
| Scheduled to Required | `AB113:AB150` | Scheduled / Required | Same-row metrics; no interval-level error wrapper |

## Summary-row behavior

Row 151 uses sums for volumes/hours, averages for staffing counts, and report-specific ratio or PivotTable formulas. It is not a simple copy of interval formulas. Examples:

- Forecast through Abandoned are column sums.
- SL % Total is `G151/E151`.
- AHT (Session) uses GETPIVOTDATA divided by 60, unlike interval rows' divisor of 63.
- Scheduled, Required, and Actual (SO) use `SUM/COUNT` averages.
- Scheduled Hours, Required Hours, and Actual are summed.
- Actual to Required and Scheduled to Required divide the summary-hour totals with `IFERROR`.

## Source-table chain

- Handled has 27 pasted/source columns and three calculated columns: Accept Date, Interval, and AHT.
- Offered has 27 pasted/source columns and 15 calculated columns that create the volume, handled, service-level, ASA, AHT-session, and active-time pivot inputs.
- AHT_Raw has 27 pasted/source columns and seven calculated columns, including 30-minute interval, 90-second service-level flag, ASA Total, and concurrency.
- Auxes/Table4 has 24 pasted/source columns and four calculated date/interval/status-hour columns.
- Staff has five pasted/source columns and 48 calculated half-hour overlap columns. Staff BE:BF summarizes staffing, and RTA manually copies it into Data; this owner-confirmed edge is operational rather than an OOXML formula link.

The workbook table definitions and aggregate cached-data profiles are verified. The five representative deliveries verify physical packaging and ordered headers, including the AHT `Speed to Answer` → Excel-deduplicated `Speed to Answer2` alias. The approved contract requires all headers, evidence-backed system keys, exact-row-only deduplication, fail-closed divergent-key handling, GMT/UTC source timestamps preserved raw, explicit −480-minute normalization to fixed PST (`UTC−08:00`) before business-date/interval bucketing, and full-export replacement. The raw snapshots still do not equal WB0817 EOD; parity therefore loads the same bundle into a fresh legacy copy and the migrated system, then realigns legacy interval keys by −480 minutes before metric comparison.

## Contract anomalies

1. **Handled zero/blank variant — intentional legacy behavior:** `F113:F121` uses a plain `SUM` and returns zero, while `F122:F150` returns blank when the shifted sum is zero.
2. **AHT Session divisor mismatch — intentional legacy behavior:** `O113:O150` divides by 63, while `O151` divides by 60.
3. **Scheduled-to-Required guard mismatch — intentional legacy behavior:** `AB113:AB150` divides directly, while `AB151` wraps the division in `IFERROR`.
4. **Broken names/references and cached errors — intentional legacy behavior:** `LOB`/`sst` and Teams Update retain broken references; WB0817 contains 47 cached non-`#N/A` errors and 1,838 Offered `#N/A` values. These are accepted parity baseline values, not source-input tokens.
5. **Snapshot mismatch — resolved by strategy:** the partial-day files are not cell-for-cell WB0817 EOD fixtures. CXP-11 compares the fresh legacy and migrated outputs generated from the identical intraday bundle.
6. **Missing GMT-to-PST converter — approved migration defect correction:** the five core AHT/Handled/Offered/Aux interval families floor raw hours directly. The only negative constant shift is `Teams Update!F8:F16 = TEXT(MOD(E8-TIME(15,0,0),1),...)`, which is downstream report support and not a source converter. The migration must normalize UTC to fixed PST explicitly; CXP-11 treats the resulting eight-hour interval-key shift as approved expected variance.
7. **Version authority:** WB0817 is authoritative. WB0809 and the WB0816 screenshot are comparison evidence only; WB0817 removes the prior Interval View C111 array formula but preserves the 25-metric block formulas.

Any downstream behavior that “fixes” an accepted anomaly fails parity unless a separate approved change request supersedes this contract. The missing timezone converter is the explicit exception: it is classified as an approved defect correction rather than intentional legacy behavior.
