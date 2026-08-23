# Environment Configuration Contract

Runtime configuration uses Apps Script Script Properties. `Config.load()` reads `CXP_ENV`, normalizes it to DEV, UAT, or PROD, and resolves only keys for the active environment. Missing values remain `null` at the generic loader boundary; packet entrypoints fail closed when their owned keys become mandatory.

## Keys

| Key | Purpose | First owning packet |
|---|---|---|
| `CXP_ENV` | Active environment: `DEV`, `UAT`, or `PROD`. | CXP-00 |
| `CXP_<ENV>_TARGET_SPREADSHEET_ID` | Active operational workbook target. | CXP-02/CXP-12 |
| `CXP_<ENV>_CONTROL_SPREADSHEET_ID` | Separate system-control workbook. | CXP-02 |
| `CXP_<ENV>_DRIVE_INBOX_FOLDER_ID` | Controlled Drive intake folder. | CXP-05/CXP-13 |
| `CXP_<ENV>_MASTER_TEMPLATE_SPREADSHEET_ID` | Master weekly workbook template. | CXP-12 |

`<ENV>` is exactly `DEV`, `UAT`, or `PROD`. Values must be set in Script Properties, not in source.

Example key names for DEV are `CXP_DEV_TARGET_SPREADSHEET_ID` and `CXP_DEV_CONTROL_SPREADSHEET_ID`; this repository intentionally supplies no values.

`initializeCxp02Workbooks()` requires both active-environment target/control IDs, rejects blank values, and rejects one ID being used for both roles before calling `SpreadsheetApp.openById`. The IDs must reference existing spreadsheets that the effective user may edit; CXP-02 does not create, publish, or store those IDs.

## Local clasp target

`CXP_CLASP_SCRIPT_ID` is a local process variable consumed only by `npm run clasp:configure`. It is written to the ignored `.clasp.json` with `"rootDir": "src"`. The generator uses exclusive-create semantics; remove or rename an obsolete local target deliberately before configuring another one.

Clasp authentication is stored separately in `.clasprc.json`; it is also ignored and must never be copied into repository files or CI logs.

## Runtime timezone

Source-export and workbook timezones are deliberately different. RTA's later clarification makes source timestamps GMT/UTC (`Etc/UTC`); ingestion must preserve that raw value. The Apps Script manifest and both CXP-02 spreadsheets remain `Etc/GMT+8`, the ZoneId for fixed `UTC−08:00`, because Interval View and related business outputs are PST. The IANA `Etc/GMT` identifier uses the opposite sign convention from the displayed UTC offset.

Downstream ingestion must convert UTC source and acquisition datetime values by −480 minutes before deriving the fixed-PST business date or 30-minute bucket. Date-only `M/d/yyyy` values remain calendar labels and are not shifted. Ingestion must not parse datetime text as if it were already PST, and it must not use `America/Los_Angeles` DST rules. Keeping the script and spreadsheet on the business timezone ensures Google date/formula rendering agrees with the normalized business fields.

## Promotion boundary

Promotion changes Script Properties and the local/CI clasp target, not source. CXP-00 permits only DEV/UAT target validation and does not authorize a production push. Later deployment packets must add an approval-bound promotion checklist before PROD is used.
