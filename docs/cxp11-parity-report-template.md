# CXP-11 Parity Report — Template

Human-readable summary over `PARITY_RESULTS`. `PARITY_RESULTS` remains the machine-readable authority; this report never restates a value that contradicts it. Copy this file per run as `docs/cxp11-parity-report-<YYYY-MM-DD>.md`.

Record sanitized counts and identifiers only. Never paste source rows, spreadsheet or folder IDs, user emails, or raw metric values carrying business data.

## Run identity

| Field | Value |
|---|---|
| Run ID | `CXP11-…` |
| Environment | DEV / UAT |
| Export contract version | `1.0.0` |
| Baseline version | `WB0817` |
| Source-bundle fingerprint | `sha256:…` (first 12 characters) |
| Ingestion run ID from `FILE_LEDGER` | |
| Acquisition timestamp (UTC) | |
| Fixed-PST checkpoint | |
| Run state | `COMPLETE` / `FAILED` |
| Started / completed (UTC) | |
| Continuations | |

## Counts by classification

| Classification | Resolution status | Count |
|---|---|---|
| `MATCH` | `NOT_REQUIRED` | |
| `EXPECTED_SOURCE_ERROR` | `CLOSED_EXPECTED` | |
| `APPROVED_EXPECTED_VARIANCE` | `CLOSED_EXPECTED` | |
| `MIGRATION_DEFECT` | `OPEN` | |
| `MISSING_SOURCE` | `OPEN` | |
| `MISSING_TARGET` | `OPEN` | |
| `INVALID_INPUT` | `OPEN` | |
| **Total comparisons** | | |
| **Defect total** | | |

## Counts by dataset

All five normalized datasets must appear.

| Dataset | Records compared | Matches | Defects | Chunk IDs |
|---|---|---|---|---|
| Handled | | | | |
| Offered | | | | |
| AHT - Raw | | | | |
| Auxes - Raw | | | | |
| Staff | | | | |

## Counts by metric

All 25 registry metrics must appear, in `docs/metric-lineage.md` order.

| Metric | Tolerance | Compared | Matches | Approved variance | Defects |
|---|---|---|---|---|---|
| Forecast | exact | | | | |
| Offered | exact | | | | |
| Handled | exact | | | | |
| Chats in SL | exact | | | | |
| Abandoned | exact | | | | |
| SL % Total | `1e-9` | | | | |
| SL (Time To Connect) | `1e-9` | | | | |
| % of Forecast Offered | `1e-9` | | | | |
| % of Forecast Handled | `1e-9` | | | | |
| Allocation | `1e-9` | | | | |
| Cumulative Allocation | `1e-9` | | | | |
| AHT (Session) | `1e-9` | | | | |
| AHT | `1e-9` | | | | |
| ACW | `1e-9` | | | | |
| ASA in Seconds | `1e-9` | | | | |
| Concurrency | `1e-9` | | | | |
| Scheduled | exact | | | | |
| Required | exact | | | | |
| Actual (SO) | exact | | | | |
| Actual vs Required | exact | | | | |
| Scheduled Hours | `1e-9` | | | | |
| Required Hours | `1e-9` | | | | |
| Actual | `1e-9` | | | | |
| Actual to Required | `1e-9` | | | | |
| Scheduled to Required | `1e-9` | | | | |

## Source-error reconciliation

| Worksheet | Error type | Expected | Observed | Classification |
|---|---|---|---|---|
| Offered | `#N/A` | 1838 | | |
| Teams Update | `#REF!` | 13 | | |
| Interval View | `#REF!` | 8 | | |
| pull outs for alloc | `#DIV/0!` | 20 | | |
| Drivers and Allocation | `#DIV/0!` | 6 | | |
| **Total** | | **1885** | | |

## Approved expected variance

| Metric | Grain (business date / interval) | Lineage | Note |
|---|---|---|---|
| | | `DEC-025` | Legacy interval key was not shifted by −480 minutes |

## Unresolved defects

One row per `OPEN` comparison. Reference the hashed record or aggregation identity, never the raw record.

| Comparison ID | Phase | Dataset / metric | Grain | Aggregation identity | Delta | Tolerance | Lineage reference | Owner | Status |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | |

## Conclusion

- **Parity outcome:** Pass / Fail
- **Promotion gate:** `promotionReady: true` / `false` with the failing input named
- **Follow-up actions:**
