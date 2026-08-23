# Representative Source Delivery Contract

## Authority and privacy boundary

`config/source-delivery-contract.json` is the machine-readable evidence authority for the five representative 0817 deliveries. `config/source-schema-draft.json` owns the approved ingestion, time, key, and parity semantics. Each source was read without modification. The repository retains filenames, hashes, headers, aggregate profiles, date ranges, and reconciliation counts—never literal source rows or personal values.

WB0817 control SHA-256: `CD8F8EC6F68FBEC85841CD64C251616FCECD0AD67DE4714EFB244F648548E65A`.

## Physical delivery contract

All five files use a `.xls` extension but start with HTML signature `3C686561643E3C4D` (`<head><M`). Each is one ISO-8859-1 HTML table with headers in row 1 and data beginning in row 2. Ingestion detects the content signature and parses HTML; treating these files as BIFF is incorrect.

| Dataset | File | SHA-256 | Raw rows × columns | WB0817 cached rows | Authoritative key |
|---|---|---|---:|---:|---|
| AHT - Raw | `Nike Messaging - AHT.xls` | `61590C6CE8F4B3388D4A310359431D092DAA3899637BB95F2BE18454CBEECED4` | 1,969 × 27 | 6,656 | `Agent Work ID` |
| Auxes - Raw | `Nike Messaging - Aux.xls` | `5004B86A0428DB3A0EFE3021A4094D285A90F824EF969CA2F35304E484F12677` | 754 × 24 | 2,904 | `User Presence ID` |
| Handled | `Nike Messaging - Handled.xls` | `C4BB2747A36BA191E847037D412B89052FDD65D3B8E25F80A8E6CBEC6C5D25E0` | 1,614 × 27 | 5,024 | `Messaging Session Name` |
| Offered | `Nike Messaging - Offered.xls` | `78C944F41913FD4EDFAE26AF11DABE3D24BC2D5E4947E01FA6E3AB8423E293F8` | 1,652 × 27 | 4,797 | `Messaging Session Name` |
| Staff | `Nike Messaging - Staffing.xls` | `E57C24CD70AF2170B12B2CB41AD3EB089781A6DB830A7B90CAAACD3DA5D321F1` | 87 × 5 | 306 | Canonical full-row hash; no stable business key observed |

The selected system IDs are unique in the representative sample. They are now owner-delegated contract keys. Staff replacement does not require an upsert identity, so its technical key exists only for exact-row deduplication.

## Header and table mappings

| Delivery | Workbook target | Header result |
|---|---|---|
| AHT | `AHT - Raw::AHT_Raw` | 27 headers match after mapping raw `Speed to Answer` to Excel's deduplicated `Speed to Answer2`; raw also contains distinct `Speed To Answer` |
| Aux | `Auxes - Raw::Table4` | Exact ordered 24-header match |
| Handled | `Handled::Handled` | Exact ordered 27-header match |
| Offered | `Offered::Offered` | Exact ordered 27-header match |
| Staffing | `Staff::ActualStaffAH` | Exact ordered 5-header match |

Every canonical header is required. The observed order remains the canonical normalized row order, but CXP-03 accepts valid input order changes and maps them back to that order before downstream use. Calculated workbook columns are not part of the raw contract: Handled adds 3, Offered 15, AHT_Raw 7, Table4 4, and ActualStaffAH 48.

## Snapshot reconciliation

The raw files and control share the 0817 date but not the extraction cutoff. Raw operational timestamps stop around 09:57–10:14; WB0817 cached tables extend to approximately 21:54–23:18.

| Dataset | Common sample keys in WB0817 | Raw keys absent | Value-equivalent full rows on common keys | Primary observed drift |
|---|---:|---:|---:|---|
| AHT - Raw | 1,969 / 1,969 | 0 | 1,898 | Status and nine finalized timing/duration records |
| Auxes - Raw | 754 / 754 | 0 | 653 | Open presence records finalized after the raw cutoff |
| Handled | 1,611 / 1,614 | 3 | 1,246 | End time, resolution time, status, purpose/resolution, and service-level state |
| Offered | 1,651 / 1,652 | 1 | 1,437 | End time, resolution/purpose, fragment count, and service-level state |
| Staff | No stable business key | — | 67 of 87 rows match as a multiset | Status intervals changed or were added after the raw cutoff |

“Value-equivalent” ignores Excel's coercion of numeric-looking text flags/identifiers while preserving real value differences. This proves representative mappings and mutable fields but not exact WB0817 EOD parity.

## Approved ingestion and parity requirements

- Consume all five files as one hourly bundle and replace the prior full export after validation.
- Require the exact canonical header set after the AHT alias; accept reordered valid headers, normalize to registry order, and reject missing, extra, duplicate, multiple-table, or ragged deliveries.
- Collapse only rows identical in required-header order after HTML entity decoding and before type coercion. Reject divergent rows sharing an authoritative key.
- Normalize empty/whitespace cells to null without defaults. Accept no raw error token: reject any trimmed value beginning with `#`; treat `NA` as ordinary text.
- Parse `M/d/yyyy h:mm AM/PM` source datetime text strictly as GMT/UTC (`Etc/UTC`) and preserve the raw UTC timestamp. Parse date-only `M/d/yyyy` as a calendar label and never timezone-shift it.
- Convert each UTC source/acquisition datetime by −480 minutes to fixed PST (`UTC−08:00`, ZoneId `Etc/GMT+8`) before deriving the business date or interval. No DST adjustment applies.
- Bucket the converted business timestamp to `[00,30)` and `[30,60)` intervals using `TIME(HOUR(businessTimestamp),FLOOR(MINUTE(businessTimestamp),30),0)`.
- Identify parity checkpoints by the five-file bundle run ID and acquisition timestamp, not by the latest row timestamp.
- Load the identical bundle into a fresh legacy copy and the migrated system. Because WB0817 lacks a converter on its core source-to-interval paths, subtract 480 minutes from legacy interval keys before comparing all five tables and all 25 Interval View metrics with migrated fixed-PST keys.
- Preserve the owner-accepted legacy errors and formula variants as baseline behavior.
- Treat direct names/emails and record identifiers as sensitive; never log source rows.

## CXP-05 implementation binding

`DriveService` now detects the representative `.xls` deliveries as HTML from their original bytes and fingerprints those bytes before parsing. `DatasetAdapter` decodes the single ISO-8859-1 table, collapses exact canonical rows before CXP-03 coercion, and rejects divergent authoritative keys without serializing key values or rows into the error. `InputAdapter` requires all five registered datasets for `single_dataset` packaging and returns five normalized `DatasetPayload` objects.

The alternate registered `multi_sheet_workbook` packaging accepts one XLSX source, converts it to a temporary Google Sheets file, rejects any source formula, maps all five sheets, and permanently removes the conversion file on success or failure. Unsupported BIFF `.xls`, CSV, arbitrary ZIP, and native Google Sheets inputs remain fail-closed. The complete interface, fingerprint, ledger, cleanup, quota, and hosted-validation boundaries are in `docs/input-adapter-contract.md`.
