# CXP-05 Input Adapter Contract

## Runtime authorities

- `src/services/DriveService.js` reads a Drive file, detects its physical format from original bytes, and computes the original-content SHA-256 fingerprint.
- `src/ingestion/XlsxAdapter.js` converts XLSX bytes to a temporary Google Sheets file, reads values and formula presence separately, and rejects any formula-bearing source.
- `src/ingestion/DatasetAdapter.js` parses the constrained ISO-8859-1 HTML-table delivery and normalizes a table through the CXP-03 `DatasetPayload` contract.
- `src/ingestion/WorkbookBundleAdapter.js` maps one converted workbook to all five registered datasets.
- `src/services/DuplicateService.js` computes bundle identity, checks successful history, records duplicate attempts, and exposes the post-commit success-record function.
- `src/repository/FileLedgerRepository.js` owns the exact `FILE_LEDGER` header and batched row persistence.
- `src/services/CleanupService.js` permanently removes temporary conversion files.
- `src/ingestion/InputAdapter.js` composes these boundaries without staging or production mutation.

## Supported physical inputs

| Packaging kind | Required sources | Supported content | Dataset locator |
|---|---:|---|---|
| `single_dataset` | Exactly five Drive files | The observed `.xls`-named ISO-8859-1 single HTML table, or a one-populated-sheet XLSX | Each source request names one of `Handled`, `Offered`, `AHT - Raw`, `Auxes - Raw`, or `Staff` |
| `multi_sheet_workbook` | Exactly one Drive file | XLSX ZIP signature plus XLSX MIME type or `.xlsx` name | Sheet name defaults to the dataset name and may be overridden by `sheetMap` |

BIFF `.xls`, CSV, plain HTML with zero or multiple tables, native Google Sheets files, and arbitrary ZIP files are unsupported. Extension alone never makes HTML or non-ZIP bytes an XLSX source. The representative `.xls` files are accepted because their bytes begin with an HTML signature, not because of the extension.

## Public interface

The deep interface is `InputAdapter.read(request, services)`:

```javascript
var result = InputAdapter.read({
  packagingKind: 'multi_sheet_workbook',
  runMetadata: {
    acquiredAtUtc: '2026-08-23T01:00:00.000Z',
    runId: 'run-synthetic',
    schemaVersion: '1.0.0',
  },
  sources: [{ fileId: 'synthetic-drive-file-id' }],
  sheetMap: {
    'AHT - Raw': 'Synthetic AHT Sheet',
  },
}, services);
```

`sheetMap` is optional and applies only to multi-sheet packaging. For `single_dataset`, every source entry also supplies its canonical `datasetName`.

The successful result is immutable and contains only:

```javascript
{
  fingerprint: 'sha256:<64 lowercase hexadecimal characters>',
  fingerprintAlgorithm: 'SHA-256',
  payloads: [/* five CXP-03 DatasetPayload objects */],
  sourceFiles: [{
    contentFingerprint: 'sha256:<64 lowercase hexadecimal characters>',
    fileId: 'synthetic-drive-file-id',
    fileName: 'synthetic.xlsx',
    format: 'xlsx',
    lastUpdatedUtc: '2026-08-23T00:00:00.000Z',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeBytes: 123,
  }],
}
```

Raw blobs and byte arrays are excluded from the public result. Normalized payloads can contain sensitive operational values and must remain inside the active run boundary; source rows are never added to errors or `FILE_LEDGER`.

## CXP-04 phase integration

`InputAdapter.validateFile`, `parse`, `validateSchema`, and `checkDuplicate` are individually callable in CXP-04 order. Their direct phase-state objects contain active-run material and must not be logged or persisted.

`InputAdapter.createOperations(adapterRequest, services)` is the supported `RunService` bridge. It returns exactly those four callbacks, retains active phase state inside a closure, and returns only sanitized source metadata, a packaging summary, normalized payloads, and the final duplicate-check result. CXP-06 combines these four callbacks with `stage`, `validateStage`, `commit`, `recalculate`, and `healthCheck`; it must not call the deep `read()` routine from an arbitrary run phase.

The duplicate lookup occurs only in `CHECKING_DUPLICATE`, after source parsing and CXP-03 schema validation and before staging. Unsupported content fails during file validation before XLSX conversion or ledger access.

## Values-only and row-normalization rules

XLSX input is imported as a temporary Google Sheets file. Every sheet's used range is read with `getValues()`, while `getFormulas()` is inspected only to reject formula presence. A formula error records sheet name and one-based row/column coordinates, never formula text. Empty trailing rows and columns are trimmed, but internal blank cells remain.

The observed HTML delivery is decoded explicitly as ISO-8859-1. The parser accepts one table, decodes the constrained named/numeric entity set, converts `<br>` to a newline, rejects ragged rows, and does not retain HTML markup downstream.

Before CXP-03 type coercion, exact rows are compared in canonical header order and collapsed. After normalization, Handled, Offered, AHT, and Aux reject divergent rows sharing the registered authoritative key. Staff has no stable business key, so only exact full-row duplicates collapse. Header, null, raw error-token, type, date, GMT/UTC, and row-volume behavior remains owned by CXP-03.

## Fingerprints and duplicate records

Every source file receives `sha256:` plus the lowercase SHA-256 digest of its original Drive blob bytes. File ID, filename, timestamps, imported values, and temporary Google Sheets identity do not affect that content fingerprint.

- A one-file multi-sheet workbook uses the original file content fingerprint as the bundle fingerprint.
- A five-file delivery sorts `datasetName + NUL + contentFingerprint` entries by dataset name, joins them with a newline, and SHA-256 hashes that deterministic composite.

`DuplicateService.check()` queries only a prior `SUCCESS` row for the bundle fingerprint. A match appends one `DUPLICATE` row with both the attempted run ID and the original successful run ID, then throws `SOURCE_DUPLICATE_SUBMISSION`. Renaming or re-uploading identical bytes therefore does not evade the check.

`DuplicateService.recordSuccessful()` exists for CXP-06 to call only after a successful production commit and health check. CXP-05 never writes a success row merely because parsing passed.

The pre-staging lookup blocks content that was already successful; it does not serialize two simultaneous first-time submissions before either has a success row. CXP-06 must recheck the fingerprint inside the production-write lock before mutation and record success after health checks while that same lock is still held.

`FILE_LEDGER` uses this exact header order:

1. `Fingerprint`
2. `Fingerprint Algorithm`
3. `Result`
4. `Run ID`
5. `Original Successful Run ID`
6. `Checked At UTC`
7. `Schema Version`
8. `Dataset Names JSON`
9. `Source File IDs JSON`
10. `Source File Names JSON`

An empty ledger receives one complete header write. Any nonempty header drift fails closed. The repository stores metadata only and never raw bytes, cells, or rows.

## Temporary-file lifecycle and failure precedence

XLSX conversion creates a Google Sheets file with the Drive v3 advanced service, reads it through `SpreadsheetApp`, and calls `Drive.Files.remove(fileId, {supportsAllDrives: true})` on both success and failure. A cleanup failure is retryable and surfaces as `SOURCE_TEMP_CLEANUP_FAILED`; its safe details retain the primary error code when one existed. This precedence avoids reporting a parse error while silently leaking a temporary file.

If a remote create succeeds but the request becomes indeterminate before Drive returns the file ID, the adapter has no identifier it can delete. The required DEV smoke test therefore includes temporary-artifact monitoring; this hosted distributed-systems case cannot be closed by the local seam.

The adapter creates no historical copy of the original input. Caller-owned inbox files remain outside temporary-conversion cleanup so CXP-06 can complete or roll back the active run; a later lifecycle packet owns retention or disposal of those originals after the transactional outcome.

## Error and operational boundaries

New source failures are `SOURCE_INVALID_TABLE`, `SOURCE_FORMULAS_NOT_ALLOWED`, `SOURCE_DIVERGENT_DUPLICATE_KEY`, `SOURCE_INCOMPLETE_BUNDLE`, `SOURCE_DUPLICATE_SUBMISSION`, `SOURCE_XLSX_CONVERSION_UNAVAILABLE`, and `SOURCE_XLSX_CONVERSION_FAILED`. Temporary cleanup and file-ledger availability/schema/read/write failures use ingestion-category codes. All join the CXP-04 error catalog and terminal-state mapping.

The manifest enables the Apps Script Drive advanced service at v3. The associated Google Cloud project must also have the Drive API enabled when Apps Script does not enable it automatically. XLSX support is checked at runtime through Drive `About.importFormats`; conversion therefore fails closed if the environment no longer advertises Excel-to-Google-Sheets import.

Drive blob reads, uploads, spreadsheet reads, and deletes consume Apps Script/Drive quotas and execution time. This packet performs bulk range reads but does not implement chunked conversion, retry/backoff, inbox polling, hosted concurrency validation, or production deployment. An authorized DEV smoke test with synthetic non-personal data remains a promotion check.

## External API authority

The implementation contract follows the official Google documentation for [Apps Script Drive file blobs](https://developers.google.com/apps-script/reference/drive/file), [byte-array SHA-256 digests](https://developers.google.com/apps-script/reference/utilities/utilities), [Drive advanced services](https://developers.google.com/apps-script/advanced/drive), [Drive import formats](https://developers.google.com/workspace/drive/api/guides/manage-uploads#import_to_google_docs_types), [Drive file creation](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/create), [Drive permanent deletion](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/delete), and separate [range values/formulas accessors](https://developers.google.com/apps-script/reference/spreadsheet/range).
