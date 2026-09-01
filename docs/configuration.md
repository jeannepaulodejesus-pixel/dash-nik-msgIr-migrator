# Environment Configuration Contract

Runtime configuration uses Apps Script Script Properties. `Config.load()` reads `CXP_ENV`, normalizes it to DEV, UAT, or PROD, and resolves only keys for the active environment. Missing values remain `null` at the generic loader boundary; packet entrypoints fail closed when their owned keys become mandatory.

## Keys

| Key | Purpose | First owning packet |
|---|---|---|
| `CXP_ENV` | Active environment: `DEV`, `UAT`, or `PROD`. | CXP-00 |
| `CXP_<ENV>_TARGET_SPREADSHEET_ID` | Active operational workbook target. | CXP-02/CXP-12 |
| `CXP_<ENV>_CONTROL_SPREADSHEET_ID` | Separate system-control workbook. | CXP-02 |
| `CXP_<ENV>_DRIVE_INBOX_FOLDER_ID` | Controlled Drive intake folder. | CXP-05/CXP-13 |
| `CXP_<ENV>_MASTER_TEMPLATE_SPREADSHEET_ID` | Master weekly workbook template copied into each weekly instance. | CXP-12 |
| `CXP_<ENV>_STALE_DATA_THRESHOLD_MINUTES` | Optional HealthCheck freshness threshold; default applied when absent. | CXP-12 |
| `CXP_<ENV>_LEGACY_PARITY_EXPORT_FOLDER_ID` | Optional Drive folder holding the contracted legacy Excel parity export bundle. | CXP-11 |
| `CXP_DEV_BOOTSTRAP_FOLDER_ID` | DEV-only Drive folder for `bootstrapCxpDevWorkbooks()` file automation. | Operator bootstrap |

`<ENV>` is exactly `DEV`, `UAT`, or `PROD`. Values must be set in Script Properties, not in source.

Example key names for DEV are `CXP_DEV_TARGET_SPREADSHEET_ID` and `CXP_DEV_CONTROL_SPREADSHEET_ID`; this repository intentionally supplies no values.

### Weekly lifecycle and active target (CXP-12)

`CXP_<ENV>_MASTER_TEMPLATE_SPREADSHEET_ID` is required by CXP-12 create/activate entrypoints and fails closed when missing. The master template is an operator-prepared spreadsheet skeleton; weekly instances are Drive copies and never receive bound Apps Script copies (ADR-002).

`CXP_<ENV>_TARGET_SPREADSHEET_ID` remains the runtime authority for ingestion. CXP-12 create/activate/rollover rewrites it to the ACTIVE weekly instance and cross-checks it against the control workbook `WEEK_REGISTRY`. A mismatch fails closed with `LIFECYCLE_ACTIVE_TARGET_MISMATCH`. Contract: [`docs/weekly-workbook-lifecycle-contract.md`](weekly-workbook-lifecycle-contract.md).

`initializeCxp02Workbooks()` requires both active-environment target/control IDs, rejects blank values, and rejects one ID being used for both roles before calling `SpreadsheetApp.openById`. The IDs must reference existing spreadsheets that the effective user may edit; CXP-02 does not create, publish, or store those IDs.

### DEV file automation

`bootstrapCxpDevWorkbooks(folderId?, forceReplace?)` (see `src/main/DevWorkbookBootstrap.js`) creates `DEV_TARGET_WORKBOOK` and `DEV_SYSTEM_CONTROL_WORKBOOK` in a Drive folder, writes `CXP_ENV` / `CXP_DEV_TARGET_SPREADSHEET_ID` / `CXP_DEV_CONTROL_SPREADSHEET_ID`, runs CXP-02 sheet initialization, seeds CXP-03 headers on the five `_RAW_*` sheets, and seeds control headers on all seven control tabs (including five active schema rows on `SCHEMA_REGISTRY`). Folder ID may be passed as the first argument or read from `CXP_DEV_BOOTSTRAP_FOLDER_ID`. Refuses `CXP_ENV=PROD`. Refuses overwrite of existing DEV spreadsheet IDs unless `forceReplace` is true. Use editor entrypoint `bootstrapCxpDevWorkbooksForceReplace()` when IDs are already set.

To point Script Properties at workbooks you already created (spreadsheet IDs or Google Sheets URLs), run `registerCxpDevWorkbookIds(targetSpreadsheetId, controlSpreadsheetId, initializeAndSeed?)`. Pass `true` as the third argument to also run CXP-02 init and seed target/control headers without creating new files.

If bootstrap already created `DEV_TARGET_WORKBOOK` and `DEV_SYSTEM_CONTROL_WORKBOOK` in a Drive folder, run `registerCxpDevWorkbooksFromFolder(folderId?, initializeAndSeed?)` (or editor wrapper `registerCxpDevWorkbooksFromFolderAndSeed()` when `CXP_DEV_BOOTSTRAP_FOLDER_ID` is set) to discover those files by name and write Script Properties automatically. To seed headers only, run `seedCxpControlWorkbookHeaders()` (optional second argument `true` overwrites row 1). Logs never include spreadsheet IDs.

### Legacy parity export folder (CXP-11)

`CXP_<ENV>_LEGACY_PARITY_EXPORT_FOLDER_ID` is optional and read only by the CXP-11 parity run. `startCxp11ParityRun(folderId?)` accepts an explicit folder override; with neither the argument nor the active-environment property, the run fails closed with `PARITY_EXPORT_FOLDER_NOT_CONFIGURED` rather than scanning Drive.

The folder must contain exactly the eight contracted files (`manifest.json` plus five source-table CSVs, `metrics.csv`, and `legacy-errors.csv`) described in [`docs/parity-validation-contract.md`](parity-validation-contract.md). Uncontracted files fail the run closed. CXP-11 writes results only to the control workbook's `PARITY_RESULTS` and `SOURCE_ERROR_BASELINE` tabs; export files and source rows stay outside the repository.

UAT source diagnostics (also in `DevWorkbookBootstrap.js`): `listCxpUatSourceFiles()` / `listCxpUatFilesIfFound()` verifies all five `CXP_UAT_*_FILE_ID` properties; `scanCxpUatSourceFileValidation()` reports invalid types per dataset before CXP-06 Case 1. Read-only; does not require `CXP_UAT_ENABLED`.

## Local clasp target

`CXP_CLASP_SCRIPT_ID` is a local process variable consumed only by `npm run clasp:configure`. It is written to the ignored `.clasp.json` with `"rootDir": "src"`. The generator uses exclusive-create semantics; remove or rename an obsolete local target deliberately before configuring another one.

Clasp authentication is stored separately in `.clasprc.json`; it is also ignored and must never be copied into repository files or CI logs.

## Runtime timezone

Source-export and workbook timezones are deliberately different. RTA's later clarification makes source timestamps GMT/UTC (`Etc/UTC`); ingestion must preserve that raw value. The Apps Script manifest and both CXP-02 spreadsheets remain `Etc/GMT+8`, the ZoneId for fixed `UTC−08:00`, because Interval View and related business outputs are PST. The IANA `Etc/GMT` identifier uses the opposite sign convention from the displayed UTC offset.

Downstream ingestion must convert UTC source and acquisition datetime values by −480 minutes before deriving the fixed-PST business date or 30-minute bucket. Date-only `M/d/yyyy` values remain calendar labels and are not shifted. Ingestion must not parse datetime text as if it were already PST, and it must not use `America/Los_Angeles` DST rules. Keeping the script and spreadsheet on the business timezone ensures Google date/formula rendering agrees with the normalized business fields.

## Promotion boundary

Promotion changes Script Properties and the local/CI clasp target, not source. CXP-00 permits only DEV/UAT target validation and does not authorize a production push. CXP-12 owns the approval-bound DEV → UAT → PROD checklist (required destination keys, master template, ACTIVE registry alignment, HealthCheck, maintenance trigger inventory). PROD still requires explicit operator acknowledgment; CXP-14 owns cutover push and production runbooks. See [`docs/cxp12-uat-runbook.md`](cxp12-uat-runbook.md) Step 08 and [`docs/weekly-workbook-lifecycle-contract.md`](weekly-workbook-lifecycle-contract.md).
