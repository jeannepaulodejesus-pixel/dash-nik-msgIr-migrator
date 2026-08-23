# CXP-02 Workbook Skeleton Contract

## Authority and entrypoint

`src/config/SheetNames.js` is the single runtime authority for sheet names, role groups, ordering, the GMT/UTC source zone, the fixed-PST business zone, and their −480-minute conversion offset. `WorkbookSetup.initializeConfiguredWorkbooks()` is the testable public seam; the Apps Script editor entrypoint is `initializeCxp02Workbooks()`.

The entrypoint loads `CXP_ENV` plus the active environment's `TARGET_SPREADSHEET_ID` and `CONTROL_SPREADSHEET_ID`, validates that both IDs are present and distinct, validates the effective user before any workbook is opened, and then initializes the two existing spreadsheets separately. No ID or user value is stored in source.

## Weekly target workbook

| Role | Required sheets | CXP-02 editing policy |
|---|---|---|
| Staging | `_STG_HANDLED`, `_STG_OFFERED`, `_STG_AHT`, `_STG_AUXES`, `_STG_STAFF` | Backend; managed sheet protection |
| Raw | `_RAW_HANDLED`, `_RAW_OFFERED`, `_RAW_AHT`, `_RAW_AUXES`, `_RAW_STAFF` | Backend; managed sheet protection |
| Calculation | `_CALC_HANDLED`, `_CALC_OFFERED`, `_CALC_AHT`, `_CALC_AUXES`, `_CALC_STAFF` | Backend; managed sheet protection |
| Aggregation | `_AGG_INTERVAL`, `_AGG_FORECAST`, `_AGG_ALLOCATION` | Backend; managed sheet protection |
| Report/support | `Interval View`, `MOM`, `Teams Update`, `Aux Productive`, `Allocation Export` | User-facing; no CXP-02 protection |

The report/support set preserves the CXP-01 operational surfaces without recreating Excel formulas: Interval View and MOM are primary outputs, Teams Update remains an operational support output, Aux Productive remains operational by owner decision, and Allocation Export replaces the legacy `pull outs for alloc` support surface. Backlogs and Detail1 are not created because CXP-01 approved conditional retirement and found no path to Interval View.

## System-control workbook

The separate control spreadsheet contains `RUN_LOG`, `ERROR_LOG`, `FILE_LEDGER`, `WEEK_REGISTRY`, `SCHEMA_REGISTRY`, `PARITY_RESULTS`, and `SOURCE_ERROR_BASELINE`. Every required control tab receives managed sheet protection. CXP-02 creates names only; headers and row schemas belong to CXP-03/CXP-04/CXP-11.

## Idempotency contract

For each configured spreadsheet the initializer:

1. validates adapters and the effective user before mutation;
2. sets the spreadsheet timezone to the fixed-PST business ZoneId `Etc/GMT+8` (source exports remain GMT/UTC and are converted by later ingestion packets);
3. checks each required name with `getSheetByName` and inserts only missing sheets;
4. never clears, renames, deletes, reorders, or writes cell values;
5. preserves all unrelated sheets and protections; and
6. creates or reuses the single sheet-level protection identified by `CXP-02 managed protection: <sheet name>`.

Google Sheets supports one sheet-level protection per sheet. Before either configured workbook is mutated, CXP-02 checks every existing required backend/control tab. An exact CXP-described protection is reusable; any other sheet-level protection is preserved unchanged and causes a clear preflight failure instead of being taken over. Managed protections are not warning-only. The effective user remains an editor; other explicit editors and target audiences are removed; domain editing is disabled when present; and unprotected-range exceptions are cleared so the whole sheet is protected. Spreadsheet ownership still governs ultimate access. CXP-02 intentionally does not implement the production permission rollout.

## Verification and hosted boundary

`npm run test:cxp02` verifies the configured two-workbook tracer, exact required names, fixed timezone, non-destructive reruns, sheet-role protections, removal of target-audience/unprotected-range bypasses, protection-conflict preservation, and preflight rejection before workbook mutation. The protection fake models Google's single sheet-level protection behavior and distinct permission channels. The tests use complete in-memory service shapes; they do not claim an authenticated Google-hosted run.

An authorized DEV operator must create or select two blank spreadsheets, set the two Script Properties IDs, push the verified `src/` project to a non-production Apps Script target, run `initializeCxp02Workbooks()`, and confirm the created tabs/protections before promotion. This operational smoke test must not place IDs or user emails in repository evidence.
