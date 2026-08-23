# Decisions and Inputs Needed

## DN-001 — Validation version and representative files

- **Packet:** CXP-01
- **Status:** Resolved on 2026-08-22
- **Decision owner:** Repository owner / project delivery owner
- **Decision:** WB0817 is the validation-control authority because the retrievable raw source files are dated 0817.
- **Control:** `MSG Intraday EOD 0817.xlsx`, SHA-256 `CD8F8EC6F68FBEC85841CD64C251616FCECD0AD67DE4714EFB244F648548E65A`.
- **Inputs received:** Representative AHT, Aux, Handled, Offered, and Staffing files. All five are `.xls`-named ISO-8859-1 HTML tables and are fingerprinted in `config/source-delivery-contract.json`.
- **Consequence:** WB0809 and the WB0816 screenshot are superseded as validation authorities. They remain comparison evidence only.

## DN-002 — Intraday parity and operating semantics

- **Packet:** CXP-01
- **Status:** Resolved on 2026-08-22
- **Decision owner:** Repository owner / operations data owner
- **Evidence boundary:** The representative exports stop around 09:57–10:14 while WB0817 continues to approximately 21:54–23:18. They remain representative inputs, not the exact WB0817 EOD load.
- **Approved decisions:**
  1. Validate parity at an intraday checkpoint by loading the same five-file RTA bundle into a fresh legacy copy and the migrated system. Identify the checkpoint by run ID and acquisition timestamp, and compare only closed intervals.
  2. Per the later RTA clarification, interpret source datetime values as GMT/UTC (`Etc/UTC`). Preserve the raw UTC value, convert it to fixed Pacific Standard Time (`PST`, `UTC−08:00`, ZoneId `Etc/GMT+8`) before deriving the business date, and then bucket to left-closed/right-open 30-minute intervals using `TIME(HOUR(businessTimestamp),FLOOR(MINUTE(businessTimestamp),30),0)`. Preserve date-only `M/d/yyyy` calendar labels without timezone conversion. WB0817 has no GMT-to-PST converter on the five core source-to-interval formula paths, so the migration corrects that legacy defect explicitly.
  3. Require every ordered source header. Use `Messaging Session Name` for Handled/Offered, `Agent Work ID` for AHT, and `User Presence ID` for Aux. Staff has no stable business key and uses a canonical full-row hash.
  4. Collapse exact canonical row duplicates only. A duplicate authoritative key with different row content fails validation rather than silently selecting a record.
  5. Normalize empty/whitespace-only cells to null without defaults; key fields may not be blank. Accept no raw error token: reject any trimmed value beginning with `#`. `NA` remains ordinary text, not a null sentinel.
  6. Each hourly RTA cycle replaces the full five-file export after validation; it is not a partial upsert or current-day merge.
  7. Preserve the AHT divisor, Handled zero/blank split, Scheduled/Required error behavior, broken names/references, and cached errors as intentional legacy behavior for parity.
  8. RTA pastes the Staff-derived values into Data columns B, D, F, M, R, and X; the Staff BE:BF summary is copied into Data.
  9. Preserve the Aux Productive pivot as an operational dependency. Backlogs and Detail1 may be retired because the verified graph has no path from either surface to Interval View; rerun dependency extraction immediately before removal.
- **Machine authority:** `config/source-schema-draft.json` owns the approved source/time/parity/manual-dependency semantics; the filename is retained for compatibility, but its contract version and status are final.
- **Consequence:** No CXP-01 decision or input remains open. Same-bundle parity execution and retirement checks are downstream implementation/validation work, not CXP-01 blockers.

## Downstream execution protocol

1. Capture one complete hourly five-file bundle with a run ID and acquisition timestamp.
2. Validate signatures, ordered headers, required keys, types, rejected error tokens, exact-row deduplication, and strict GMT/UTC timestamp parsing before replacement.
3. Load the same raw bundle into a fresh legacy copy and the migrated implementation; preserve the source UTC timestamp and create the migrated fixed-PST business timestamp before date/interval bucketing.
4. Recalculate all five normalized tables plus all 25 Interval View metrics. For parity, align legacy interval keys by minus 480 minutes before comparing them with migrated fixed-PST keys; do not treat the approved eight-hour correction as a migration failure.
5. Preserve accepted legacy errors and zero/blank variants in the baseline; record the missing legacy timezone conversion as an approved expected variance and report any other difference as a migration defect.
6. Before retiring Backlogs or Detail1, rerun formula, PivotTable, slicer, defined-name, and documented manual-dependency extraction.
