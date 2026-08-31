# Excel-to-Google-Sheets Parity Validation Contract (CXP-11)

Machine authority: `src/parity/ParityContracts.js`. Baseline authority: `config/formula-family-catalog.json` cached-error census. Metric authority: [`docs/metric-lineage.md`](metric-lineage.md) and `config/metric-lineage-contract.json`.

CXP-11 compares a **fresh legacy Excel control** against the **migrated Google Sheets workbook**, both loaded from the identical five-file source bundle. The partial-day raw deliveries are not WB0817 EOD fixtures, so parity never compares against a stored cell snapshot.

## Version authority

WB0817 (`CD8F8EC6F68FBEC85841CD64C251616FCECD0AD67DE4714EFB244F648548E65A`) is the sole parity authority with **1,885** cached errors: 1,838 `#N/A`, 26 `#DIV/0!`, and 21 `#REF!`. The older 5,655 count belongs to superseded WB0809 / project-record history and must never be asserted by code, tests, or evidence.

## Legacy export contract

Contract version `1.0.0`. The operator recalculates the fresh legacy control and places exactly these eight files in one Drive folder. CXP-11 does not automate Excel.

| File | Kind | Content |
|---|---|---|
| `manifest.json` | — | Contract version, acquisition timestamp, source-bundle fingerprint, WB0817 hash, baseline version, and per-file name/kind/row count/SHA-256 |
| `handled.csv` | `SOURCE_TABLE` | Canonical wide Handled table |
| `offered.csv` | `SOURCE_TABLE` | Canonical wide Offered table |
| `aht-raw.csv` | `SOURCE_TABLE` | Canonical wide AHT - Raw table |
| `auxes-raw.csv` | `SOURCE_TABLE` | Canonical wide Auxes - Raw table |
| `staff.csv` | `SOURCE_TABLE` | Canonical wide Staff table |
| `metrics.csv` | `METRIC` | Long-form metrics keyed by business date, interval start, site, queue/LOB, metric, and aggregation identity |
| `legacy-errors.csv` | `LEGACY_ERROR` | Observed worksheet, cell-or-range, error token, formula family, and observed count |

Source-table headers are position-exact against the CXP-03 `SCHEMA_REGISTRY` required headers for the same dataset. `metrics.csv` uses `Business Date, Interval Start, Site, Queue Or LOB, Metric, Aggregation Identity, Value`. `legacy-errors.csv` uses `Worksheet, Cell Or Range, Error Token, Formula Family, Observed Count`.

### Validation gates

The adapter fails closed before any comparison on: non-JSON or incomplete manifests, a contract-version mismatch, a WB0817 hash mismatch, a non-ISO-UTC acquisition timestamp, missing or uncontracted files, a file digest that disagrees with the manifest, duplicate or reordered headers, ragged rows, a row count that disagrees with the manifest, a blank authoritative key, and an unknown metric name or error token.

Duplicate policy mirrors CXP-05: byte-identical duplicate rows collapse, and rows that share the authoritative key but diverge in any field fail with `PARITY_EXPORT_DUPLICATE_KEY`. Staff has no authoritative key and dedupes on the canonical full row.

### Source identity

The export's `sourceBundleFingerprint` must match a **successful** `FILE_LEDGER` entry before comparison begins. The engine stores that entry's ingestion run ID and the manifest fingerprint at preflight, then rechecks both before every continuation and again at finalization. A replaced export or a re-ingested target fails with `PARITY_TARGET_SNAPSHOT_CHANGED` rather than producing a signed-off run over mixed inputs.

## Comparison contract

### Interval alignment and window (DEC-025)

Legacy interval keys are floored from raw UTC hours. CXP-11 shifts every legacy key by **−480 minutes** into fixed PST (`UTC−08:00`, no DST) before matching migrated keys. The acquisition checkpoint is converted the same way, and only intervals whose **right boundary** is at or before the fixed-PST checkpoint are compared.

If a metric mismatches on the aligned key but matches the migrated value at the unshifted legacy key, the comparison is `APPROVED_EXPECTED_VARIANCE` with lineage `DEC-025` — the single approved variance. Everything else that differs is a defect.

### Tolerances

| Comparison class | Rule |
|---|---|
| Source-table values, keys, strings, blanks, error tokens, and counts | Exact |
| Integer-formatted metrics (Forecast, Offered, Handled, Chats in SL, Abandoned, Scheduled, Required, Actual (SO), Actual vs Required) | Exact |
| `0.00`, `0.00%`, and duration metrics (the remaining 16) | Absolute tolerance `1e-9` |

Blank, single-space (the legacy `% of Forecast` fallback), zero, and error tokens are distinct sentinels; none of them ever compare equal to another.

### Classifications and resolution

| Classification | Resolution status |
|---|---|
| `MATCH` | `NOT_REQUIRED` |
| `EXPECTED_SOURCE_ERROR` | `CLOSED_EXPECTED` |
| `APPROVED_EXPECTED_VARIANCE` | `CLOSED_EXPECTED` |
| `MIGRATION_DEFECT` | `OPEN` |
| `MISSING_SOURCE` | `OPEN` |
| `MISSING_TARGET` | `OPEN` |
| `INVALID_INPUT` | `OPEN` |

Only the four `OPEN` classifications count toward the defect total that blocks promotion.

## Privacy

Metric values are non-sensitive and are persisted as-is. Source-table comparisons persist only dataset, field name, a hashed record identity, and hashed value digests — never raw source cells. Export files and source rows stay outside the repository; only synthetic fixtures are committed.

## Control-workbook write contracts

`PARITY_RESULTS` (19 columns): `Run ID`, `Comparison ID`, `Chunk ID`, `Phase`, `Dataset`, `Metric Name`, `Business Date`, `Interval Start`, `Site`, `Queue Or LOB`, `Aggregation Identity`, `Source Value`, `Target Value`, `Delta`, `Tolerance`, `Lineage JSON`, `Classification`, `Resolution Status`, `Compared At UTC`.

`SOURCE_ERROR_BASELINE` (12 columns): `Baseline Version`, `Control Workbook SHA-256`, `Worksheet Name`, `Reference Kind`, `Cell Or Range`, `Formula Family`, `Error Type`, `Expected Count`, `Classification`, `Treatment`, `Evidence`, `Resolution Status`.

`PARITY_RESULTS` is the machine-readable authority. The human-readable report ([`docs/cxp11-parity-report-template.md`](cxp11-parity-report-template.md)) is a summary view over it.

### Seeded WB0817 baseline

Six evidence-backed rules totalling exactly 1,885. Where the repository evidence is per-sheet rather than per-cell, the record stays a bounded worksheet-scope count; individual cell locations are never fabricated.

| Worksheet | Reference kind | Reference | Error | Count |
|---|---|---|---|---|
| Offered | `FORMULA_FAMILY_RANGE` | `G2:G5717` — handled-case `VLOOKUP` | `#N/A` | 919 |
| Offered | `FORMULA_FAMILY_RANGE` | `F2:F5717` — `Handled ASA < 91` flag | `#N/A` | 919 |
| Teams Update | `WORKSHEET_SCOPE` | Broken Teams Update references | `#REF!` | 13 |
| Interval View | `WORKSHEET_SCOPE` | Broken `LOB` / `sst` defined names | `#REF!` | 8 |
| pull outs for alloc | `WORKSHEET_SCOPE` | Zero-denominator allocation pull-outs | `#DIV/0!` | 20 |
| Drivers and Allocation | `WORKSHEET_SCOPE` | Zero-denominator allocation ratios | `#DIV/0!` | 6 |

Observed legacy errors are reconciled per worksheet-and-token key. An observed count that has no baseline key, disagrees with its baseline count, or leaves a baseline key unobserved becomes a defect, and the run also asserts the 1,885 total.

## Execution boundary

Two independent, versioned state machines share the script lock but never the cursor.

- **Setup** (`CXP11_PARITY_SETUP_STATE_V1`): `IDLE`, `RUNNING`, `COMPLETE`, `FAILED` across six ordered install steps.
- **Run** (`CXP11_PARITY_RUN_STATE_V1`): `PREFLIGHT`, `SOURCE_TABLES`, `METRICS`, `ERROR_CLASSIFICATION`, `SUMMARIZING`, `COMPLETE`, `FAILED`.

Each invocation holds a four-minute cooperative budget, processes one bounded batch (250 source rows or 5 metrics), persists that result chunk, checkpoints the cursor, and schedules exactly one continuation before the Apps Script limit. Chunk IDs are deterministic (`SOURCE_TABLES:<dataset>:<offset>`, `METRICS:<index>`, `ERROR_CLASSIFICATION:0`), so a chunk written just before an interrupted cursor update is detected on retry and never appended twice. Completion and reset remove continuation triggers; retargeting or resetting an active run is refused unless the operator forces it.
