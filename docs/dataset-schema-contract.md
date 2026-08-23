# Dataset Schema Registry and Normalized Input Contract

## Authority and versioning

`src/ingestion/SchemaRegistry.js` is the runtime authority for CXP-03 schema version `1.0.0`. It defines all five logical datasets, their canonical columns and types, required/optional headers, approved aliases, authoritative keys, empty-value policy, and fail-closed row-volume bounds. `config/source-schema-draft.json` remains the CXP-01 evidence/decision record; where its physical-delivery order rule conflicts with CXP-03, DEC-026 makes the position-independent runtime registry authoritative.

`DatasetPayload.create()` stamps `schemaVersion: "1.0.0"` into both the payload and its copied run metadata. A caller-supplied different version fails with `SCHEMA_VERSION_MISMATCH`; it is never silently relabeled.

## Active dataset schemas

All listed headers are required and no optional source headers are currently approved. The row maxima are round fail-closed operational ceilings above both the representative partial-day counts and WB0817 cached counts; they are validation safeguards, not forecasts. A future increase requires a versioned registry change supported by delivery evidence.

| Dataset | Required headers | Optional headers | Authoritative key | Technical dedupe key | Row bounds | Type profile |
|---|---:|---:|---|---|---:|---|
| Handled | 27 | 0 | `Messaging Session Name` | — | 1–10,000 | 20 text, 3 number, 1 date, 3 UTC datetime |
| Offered | 27 | 0 | `Messaging Session Name` | — | 1–10,000 | 20 text, 4 number, 1 date, 2 UTC datetime |
| AHT - Raw | 27 | 0 | `Agent Work ID` | — | 1–15,000 | 10 text, 11 number, 1 date, 5 UTC datetime |
| Auxes - Raw | 24 | 0 | `User Presence ID` | — | 1–7,500 | 8 text, 13 number, 1 date, 2 UTC datetime |
| Staff | 5 | 0 | — | `canonical_full_row_hash` | 1–2,000 | 3 text, 2 UTC datetime |

Complete header lists and hand-checked row bounds are mirrored in `tests/fixtures/cxp03/schema-fixtures.json`. Fixtures are synthetic schema evidence and contain no source rows or personal values.

## Header normalization

Header matching trims surrounding whitespace, preserves case, and otherwise requires an exact canonical name. Case cannot be folded because AHT contains distinct `Speed To Answer` and `Speed to Answer` columns. The explicit multi-sheet-workbook alias `Speed to Answer2` maps only to canonical `Speed to Answer`, reflecting Excel's verified duplicate-header suffix.

Input order is not semantic. The validator accepts any order containing exactly one instance of every required canonical column, then emits records in registry order. It fails closed on:

- missing required columns (`SCHEMA_MISSING_REQUIRED_COLUMNS`);
- extra/unapproved columns (`SCHEMA_UNEXPECTED_COLUMNS`);
- duplicate names or alias collisions (`SCHEMA_DUPLICATE_COLUMNS`);
- blank/non-string headers (`SCHEMA_INVALID_HEADERS`); and
- unregistered dataset names (`SCHEMA_UNKNOWN_DATASET`).

This supersedes the earlier CXP-01 instruction to reject reordered input headers. CXP-01's verified order remains the canonical row order used for normalization and later exact-row fingerprints.

## DatasetPayload contract

Every adapter emits the same plain, serializable object:

```text
{
  contract: "DatasetPayload",
  contractVersion: "1.0.0",
  datasetName: <registered dataset name>,
  schemaVersion: "1.0.0",
  headers: <canonical registry order>,
  records: <canonical header-keyed records>,
  rowCount: <records.length>,
  source: <packaging locator>,
  runMetadata: <caller metadata plus schemaVersion>
}
```

The two supported packaging locators are:

- `single_dataset`: one artifact produces exactly one named dataset payload;
- `multi_sheet_workbook`: each mapped sheet produces one dataset payload and must identify `sheetName`.

Neither contract chooses the final physical packaging. HTML/XLS signature detection and parsing belong to CXP-05; repositories consume only normalized `DatasetPayload` objects.

## Value normalization

- `null`, `undefined`, empty strings, and whitespace-only strings normalize to `null`; defaults are never synthesized.
- Any trimmed string beginning with `#` fails as `DATASET_ERROR_TOKEN`; `NA` remains ordinary text.
- Authoritative keys must be non-null after normalization or fail as `DATASET_MISSING_KEY`.
- Numbers accept finite numeric values or strict numeric strings and normalize to JavaScript numbers.
- Source datetimes accept strict `M/d/yyyy h:mm AM/PM`, interpret the value as GMT/UTC, validate the calendar/time components, and normalize to an ISO-8601 `Z` value.
- Date-only `M/d/yyyy` values normalize to `YYYY-MM-DD` without timezone conversion.
- Ragged rows, invalid types, and row counts outside the active bounds fail with deterministic codes.

The validator is pure JavaScript and performs no Google Sheets or Drive calls.

## Downstream boundary

CXP-04 may copy `runMetadata.schemaVersion` into run records. CXP-05 may produce payloads from either packaging contract and owns signature parsing, bundle validation, duplicate fingerprinting, and divergent-key handling. CXP-06 and later repositories must depend on canonical headers/records rather than source column positions.
