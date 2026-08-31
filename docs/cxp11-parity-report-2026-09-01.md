# CXP-11 Parity Report — 2026-09-01 (DEV synthetic harness)

Human-readable summary over `PARITY_RESULTS`. `PARITY_RESULTS` remains the machine-readable authority; this report never restates a value that contradicts it.

Record sanitized counts and identifiers only. Spreadsheet IDs, folder IDs, source rows, and raw metric business values are omitted.

## Run identity

| Field | Value |
|---|---|
| Run ID | Not serialized in `CXP11UatStep08.result`; see `PARITY_RESULTS` |
| Environment | DEV |
| Export contract version | `1.0.0` |
| Baseline version | `WB0817` |
| Source-bundle fingerprint | `sha256:cxp11synthe…` (synthetic UAT placeholder) |
| Ingestion run ID from `FILE_LEDGER` | `CXP11-UAT-SYNTHETIC-BUNDLE` |
| Acquisition timestamp (UTC) | `2026-08-18T18:30:00Z` |
| Fixed-PST checkpoint | `10:30` (acquisition shifted −480 minutes; closed interval uses the right boundary) |
| Run state | `COMPLETE` |
| Started / completed (UTC) | Promotion recorded `2026-08-31T16:57:42Z` |
| Continuations | Not serialized in the promotion payload |

## Counts by classification

| Classification | Resolution status | Count |
|---|---|---|
| `MATCH` | `NOT_REQUIRED` | 335 |
| `EXPECTED_SOURCE_ERROR` | `CLOSED_EXPECTED` | 6 |
| `APPROVED_EXPECTED_VARIANCE` | `CLOSED_EXPECTED` | 0 |
| `MIGRATION_DEFECT` | `OPEN` | 0 |
| `MISSING_SOURCE` | `OPEN` | 0 |
| `MISSING_TARGET` | `OPEN` | 0 |
| `INVALID_INPUT` | `OPEN` | 0 |
| **Total comparisons** | | **341** |
| **Defect total** | | **0** |

The 335 matches are the five synthetic source tables (two records each) plus 325 metric grains (13 closed-window intervals × 25 registry metrics). The six expected-source-error rows are the five WB0817 worksheet-and-token keys plus the 1,885 baseline-total assertion.

## Counts by dataset

All five normalized datasets appear. Per-row hashed identities remain in `PARITY_RESULTS`.

| Dataset | Records compared | Matches | Defects | Chunk IDs |
|---|---|---|---|---|
| Handled | 2 | 2 | 0 | `SOURCE_TABLES:Handled:0` |
| Offered | 2 | 2 | 0 | `SOURCE_TABLES:Offered:0` |
| AHT - Raw | 2 | 2 | 0 | `SOURCE_TABLES:AHT - Raw:0` |
| Auxes - Raw | 2 | 2 | 0 | `SOURCE_TABLES:Auxes - Raw:0` |
| Staff | 2 | 2 | 0 | `SOURCE_TABLES:Staff:0` |

## Counts by metric

All 25 registry metrics were evaluated (`summary.metricCount == 25`). The promoted run reported zero metric defects and zero approved variance. Per-metric match counts remain in `PARITY_RESULTS`; the hosted promotion payload does not serialize a per-metric tally.

| Metric | Tolerance | Compared | Matches | Approved variance | Defects |
|---|---|---|---|---|---|
| All 25 `METRIC_ORDER` metrics | exact or `1e-9` per contract | 13 grains each | 13 each | 0 | 0 |

## Source-error reconciliation

Observed counts come from the synthetic `legacy-errors.csv` fixture, which reproduces the WB0817 totals. Classification was `EXPECTED_SOURCE_ERROR` for every baseline key.

| Worksheet | Error type | Expected | Observed | Classification |
|---|---|---|---|---|
| Offered | `#N/A` | 1838 | 1838 | `EXPECTED_SOURCE_ERROR` |
| Teams Update | `#REF!` | 13 | 13 | `EXPECTED_SOURCE_ERROR` |
| Interval View | `#REF!` | 8 | 8 | `EXPECTED_SOURCE_ERROR` |
| pull outs for alloc | `#DIV/0!` | 20 | 20 | `EXPECTED_SOURCE_ERROR` |
| Drivers and Allocation | `#DIV/0!` | 6 | 6 | `EXPECTED_SOURCE_ERROR` |
| **Total** | | **1885** | **1885** | `EXPECTED_SOURCE_ERROR` |

## Approved expected variance

None on this hosted exact-match run. Step 03 derives `metrics.csv` by shifting live Interval View keys forward 480 minutes, so DEC-025 alignment produces `MATCH` rather than `APPROVED_EXPECTED_VARIANCE`. The positional variance rule remains covered by local Step 05 tests.

| Metric | Grain (business date / interval) | Lineage | Note |
|---|---|---|---|
| — | — | `DEC-025` | Not observed on the promoted synthetic exact-match bundle |

## Unresolved defects

None.

| Comparison ID | Phase | Dataset / metric | Grain | Aggregation identity | Delta | Tolerance | Lineage reference | Owner | Status |
|---|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | — | — |

## Conclusion

- **Parity outcome:** Pass
- **Promotion gate:** `promotionReady: true`
- **Follow-up actions:** A real weekly run still requires an operator-recalculated Excel export whose `sourceBundleFingerprint` matches a successful ingestion of that same five-file bundle. UAT/PROD configuration promotion remains a separate environment action.
