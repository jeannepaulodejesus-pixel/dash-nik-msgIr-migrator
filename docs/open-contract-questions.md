# CXP-01 Contract Decisions

## Evidence decisions

- WB0817 is the validation-control authority. WB0809 and the WB0816 meeting screenshot are comparison evidence only.
- The five representative sources are separate `.xls`-named ISO-8859-1 HTML tables, not BIFF workbooks.
- Ordered source headers map to the five workbook tables; AHT requires raw `Speed to Answer` → Excel `Speed to Answer2` because Excel deduplicated the case-insensitive header collision.
- The representative sources are partial-day snapshots and are not reclassified as WB0817's exact EOD inputs.

## Resolved operating decisions

| Prior question | Approved decision |
|---|---|
| Parity cutoff | Same-bundle intraday checkpoint: fresh legacy copy and migrated system receive the identical five-file bundle; compare closed intervals only. |
| Timezone and DST | Source export timestamps are GMT/UTC. Preserve raw UTC and convert by −480 minutes to fixed Pacific Standard Time (`PST`, `UTC−08:00`) before business-date/interval bucketing; runtime workbook ZoneId remains `Etc/GMT+8` with no DST. |
| Interval boundary | Left-closed/right-open 30-minute flooring: `TIME(HOUR(timestamp),FLOOR(MINUTE(timestamp),30),0)`. |
| Replacement scope | Replace the full export on every hourly RTA cycle. |
| Keys | Handled/Offered: `Messaging Session Name`; AHT: `Agent Work ID`; Aux: `User Presence ID`; Staff: canonical full-row hash because no stable business key was observed. |
| Duplicates | Collapse exact canonical row duplicates only; reject divergent rows sharing an authoritative key. |
| Required/blank/error rules | Every ordered header is required. Empty/whitespace cells normalize to null. The eight allowlisted spreadsheet error tokens coalesce to null at ingestion; unknown `#...` tokens fail, and authoritative keys remain mandatory. `NA` is ordinary text. |
| Formula/error anomalies | AHT `/63`, Handled zero/blank, Scheduled/Required guard behavior, broken names/references, and cached errors are intentional legacy behavior. |
| Data manual inputs | RTA pastes Staff-derived values into Data B, D, F, M, R, and X; Staff BE:BF is copied into Data. |
| Aux Productive pivot | Required operational dependency even without a formula path to Interval View. |
| Backlogs and Detail1 | Approved for retirement only after a final dependency recheck; current extraction finds no path to Interval View. |

## Closure rule

Every CXP-01 evidence and operating decision is resolved. `config/workbook-contract.json` is `complete`; `config/source-schema-draft.json` owns the final ingestion and parity policy. Downstream packets must execute the same-bundle parity protocol and the pre-retirement dependency check without reopening CXP-01 unless new contradictory source evidence appears.
