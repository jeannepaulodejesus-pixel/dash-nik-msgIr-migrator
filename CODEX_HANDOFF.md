# Nike Messaging Excel -> Google Sheets Migration
## Codex Engineering Handoff and Packet Plan

**Version:** 1.0  
**Prepared:** 2026-08-21  
**Purpose:** Give Codex an implementation-ready, source-grounded sequence of bounded engineering packets that preserves the approved architecture and business goals.

## 1. Codex Prime Directive

Build a **reporting-system migration**, not an Excel converter. The runtime target is a standalone Apps Script control plane plus Google Sheets-native calculation/reporting. Excel remains the initial validation control only.

Codex must not invent metric formulas from metric names, silently change operational definitions, or reproduce Excel formula text mechanically. Business logic must be derived from the legacy workbook migration contract and validated by output parity.

## 2. Source-of-Truth Facts
- **Business objective:** Preserve RTA operational reporting while removing dependency on incompatible Excel licenses and fragile Excel-to-Google-Sheets conversion.
- **Agreed target architecture:** Hybrid: automated raw-data ingestion + Google Sheets-native calculations/reporting + legacy Excel as the initial validation control.
- **Operational cadence:** Hourly data freshness inside a weekly active reporting template.
- **Scope:** One messaging queue across two sites; preserve all operationally required dependencies.
- **Primary outputs:** Interval View and MOM; Interval View is communicated to Operations.
- **Logical inputs:** Handled (~5k rows), Offered (~5k), AHT - Raw (~7k), Auxes - Raw (~3k), Staff (~300).
- **Ingestion behavior:** Validate schema, block duplicates, replace/override active hourly data rather than append, and do not retain historical upload payloads.
- **Validation:** Run the same raw dataset through Excel and Google Sheets and compare at date + interval + site + queue/LOB + metric grain.
- **Pre-existing Excel error baseline:** 5,655 cached errors: 5,536 #N/A, 68 #VALUE!, 30 #DIV/0!, 21 #REF!. These must remain separate from migration defects.
- **Workbook complexity:** 17 worksheets (3 hidden), 9 Excel Tables, 15 PivotTables, 5 slicers, 271,677 formula cells, 172,521 structured-reference formula cells, 1,247+ GETPIVOTDATA cells.

### Known ambiguity that must remain explicit
- Five **logical** source datasets are confirmed, but the exact number/packaging of physical files per hourly cycle is not fully reconciled in the project records. Implement adapter boundaries so physical packaging can change without rewriting downstream logic.
- Identified inputs are recorded as XLSX in level-setting; meeting notes also mention CSV/XLS extracts from Salesforce/client tools. Do not claim additional formats are supported until implemented and tested.
- Acceptable visual/formatting differences from Excel are not formally finalized. Preserve business-significant formatting and output correctness; record any intentional visual differences for validation.

## 3. Approved Architecture Decisions
- **ADR-001:** Treat the work as a reporting-system migration, not a generic Excel converter.
- **ADR-002:** Use a standalone Apps Script project as the control plane; avoid weekly copies of bound production code.
- **ADR-003:** Google Sheets is the calculation/reporting plane. Apps Script orchestrates ingestion, validation, lifecycle, logging, and recovery.
- **ADR-004:** Use staging + validation + commit + rollback semantics. Invalid input must never destroy the currently valid operational dataset.
- **ADR-005:** Use LockService or equivalent script-level locking to serialize production writes.
- **ADR-006:** Extract values from XLSX inputs; do not attempt to execute or translate Excel formulas.
- **ADR-007:** Use stable aggregation tables and native Sheets logic instead of reproducing GETPIVOTDATA/pivot-cell-coordinate dependencies.
- **ADR-008:** Use vectorized/array/query logic and bulk reads/writes. Do not recreate 271k+ formulas cell-by-cell.
- **ADR-009:** Maintain a master template and create/register a weekly active workbook with hourly refresh.
- **ADR-010:** Use DEV -> UAT -> PROD environments and keep configuration/secrets outside source code.
- **ADR-011:** Abstract logical datasets from physical file packaging. The five logical inputs are confirmed; the exact physical packaging per hourly cycle is not.

## 4. Target Runtime Flow

```text
CNX / Salesforce source files
        |
        v
Standalone Apps Script control plane
  - intake / XLSX value extraction
  - schema validation
  - duplicate prevention
  - run state / logging / locking
  - staging / commit / rollback
        |
        v
Google Sheets _STG_* -> _RAW_*
        |
        v
Google Sheets-native transformations
        |
        v
Stable aggregation/domain tables
        |
        v
Interval View + MOM + required dependencies
        |
        +--> RTA / Operations
        |
        v
Excel-vs-Sheets parity validation
```

## 5. Codex Execution Protocol
1. Execute **one packet per branch/PR**. Do not combine packets unless the dependency table explicitly allows parallel work and the repository owner chooses to merge them.
2. Before coding a packet, read this document, `docs/packet-status.md`, the latest `docs/decision-log.md`, and all completion notes from dependency packets.
3. Do not change an approved architecture decision silently. If blocked, record the issue in `docs/decision-needed.md`, implement only non-controversial work, and stop at the packet gate.
4. Do not invent workbook formulas or metric semantics. CXP-01 is the migration contract for business logic.
5. Every packet must include tests or deterministic verification evidence appropriate to its scope.
6. Every packet completion must update `docs/packet-status.md` with: files changed, tests run, acceptance criteria result, assumptions, known limitations, next-packet inputs, and exact commit hash/version.
7. Keep production IDs, secrets, folder IDs, and user-specific values out of source control. Use configuration/property boundaries.
8. Prefer bulk array reads/writes and pure functions. Prohibit row-by-row `setValue`/`getValue` loops in critical data paths.
9. Preserve the last known good operational dataset on any invalid or failed upload.
10. Validation is based on output parity at business grain, not visual resemblance or formula text equivalence.

## 6. Packet Sequence and Parallelism

| Packet | Wave | Dependency | Parallelism |
|---|---|---|---|
| CXP-00 - Repository Bootstrap and Engineering Guardrails | Foundation | None | No |
| CXP-01 - Legacy Workbook Reverse Engineering and Migration Contract | Foundation | CXP-00 + access to legacy control workbook | Can overlap with CXP-02 after naming conventions are fixed |
| CXP-02 - Target Workbook Skeleton and System Control Workbook | Foundation | CXP-00; consume CXP-01 naming when available | Yes, partial |
| CXP-03 - Dataset Schema Registry and Normalized Input Contract | Ingestion | CXP-01, CXP-02 | No |
| CXP-04 - Run State Machine, Locking, Logging, and Error Taxonomy | Ingestion | CXP-00, CXP-02, CXP-03 | Can overlap with adapter implementation after interfaces are fixed |
| CXP-05 - Drive/XLSX Input Adapters and Duplicate Fingerprinting | Ingestion | CXP-03, CXP-04 | No |
| CXP-06 - Staging, Two-Phase Commit, Rollback, and Raw Replacement | Ingestion | CXP-02, CXP-04, CXP-05 | No |
| CXP-07 - Native Transformations - Handled and Offered | Native model | CXP-01, CXP-02; raw repositories from CXP-06 preferred | Yes, with CXP-08 |
| CXP-08 - Native Transformations - AHT, Auxes, and Staff | Native model | CXP-01, CXP-02; raw repositories from CXP-06 preferred | Yes, with CXP-07 |
| CXP-09 - Stable Aggregation and Domain Model | Native model | CXP-07, CXP-08, CXP-01 | No |
| CXP-10 - Interval View and MOM Reporting Surfaces | Reporting | CXP-09, CXP-01 | No |
| CXP-11 - Excel-vs-Google-Sheets Parity Harness and Source-Error Ledger | Validation | CXP-07 through CXP-10; can begin earlier with partial metrics | Partially |
| CXP-12 - Weekly Workbook Lifecycle, Scheduling, and Environment Promotion | Operations | CXP-02, CXP-04, CXP-06, CXP-10 | Can overlap with CXP-11 |
| CXP-13 - RTA Intake Surface and Operational Status | Operations | CXP-04 through CXP-06, CXP-12 | Yes, after APIs stabilize |
| CXP-14 - Performance Hardening, UAT, Cutover, and Production Runbook | Release | CXP-00 through CXP-13 | No |

**Critical path:** CXP-00 -> CXP-01 -> CXP-03 -> CXP-04 -> CXP-05 -> CXP-06 -> (CXP-07 + CXP-08) -> CXP-09 -> CXP-10 -> CXP-11 -> CXP-14. CXP-12 and CXP-13 can proceed once their dependencies are stable.

## 7. Detailed Codex Packets

### CXP-00 - Repository Bootstrap and Engineering Guardrails
**Wave:** Foundation  
**Dependencies:** None  
**Parallelism:** No  
**Goal:** Create the Apps Script repository, deployment skeleton, conventions, configuration boundaries, and packet execution artifacts without implementing business logic.

**In scope**
- Initialize a clasp-managed standalone Apps Script project structure.
- Create src/main, ingestion, validation, repository, services, monitoring, config, and ui source areas (or equivalent local organization compatible with clasp).
- Create appsscript.json with only the minimum required services/scopes for the skeleton; do not add production IDs.
- Create Config/PropertiesService loader with DEV, UAT, PROD environment keys.
- Create README, architecture decision index, packet status file, and contribution/testing conventions.
- Add lightweight unit-testable pure JavaScript helpers and a local test approach for non-Google API logic.

**Non-goals**
- No workbook reverse engineering.
- No source ingestion.
- No business formulas.
- No production deployment.

**Required deliverables**
- Repository skeleton
- appsscript.json
- environment configuration contract
- README.md
- docs/packet-status.md
- docs/decision-log.md
- test scaffold

**Acceptance criteria**
- [ ] Repository contains no secrets, spreadsheet IDs, Drive folder IDs, tokens, or user-specific identifiers.
- [ ] Configuration can resolve DEV/UAT/PROD using PropertiesService or an equivalent injected adapter.
- [ ] The project can be pushed to a non-production Apps Script project through clasp.
- [ ] Packet status and decision-log conventions are documented.
- [ ] All pure helper tests pass.

**Packet completion handoff:** Record exact file tree, setup commands, environment keys required later, tests executed, and blockers. Commit message: feat: bootstrap Apps Script migration project.

### CXP-01 - Legacy Workbook Reverse Engineering and Migration Contract
**Wave:** Foundation  
**Dependencies:** CXP-00 + access to legacy control workbook  
**Parallelism:** Can overlap with CXP-02 after naming conventions are fixed  
**Goal:** Convert the legacy Excel workbook from an opaque implementation into an explicit migration contract that all later packets can code against.

**In scope**
- Inventory all 17 worksheets including 3 hidden sheets.
- Inventory 9 Excel Tables, 15 PivotTables, 5 slicers, named ranges, formula families, and 1,247+ GETPIVOTDATA dependencies that feed operational outputs.
- Trace upstream/downstream dependencies for Handled, Offered, AHT - Raw, Auxes - Raw, Staff, Drivers and Allocation, AHT Handled Offered, Forecast and Allocation Pivot, Teams Update, Interval View, and MOM.
- Extract logical source schemas and column semantics for the five confirmed inputs.
- Build metric lineage for every operational metric from source -> transformation -> aggregation -> final output.
- Document weekly date rollover behavior, especially MOM forecast date maintenance.
- Separate known source workbook errors from valid business behavior.

**Non-goals**
- Do not modify the control workbook.
- Do not translate formulas into Google Sheets yet.
- Do not assume unverified physical upload packaging.

**Required deliverables**
- docs/workbook-inventory.md
- docs/dependency-map.md
- docs/metric-lineage.md
- config/workbook-contract.json
- config/source-schema-draft.json
- docs/open-contract-questions.md

**Acceptance criteria**
- [ ] Every operational metric in the project record has a documented source and transformation lineage or is explicitly marked unresolved.
- [ ] Every backend sheet required by Interval View or MOM is accounted for.
- [ ] Hidden-sheet dependencies are not omitted.
- [ ] Structured-reference and GETPIVOTDATA usage is categorized by business purpose rather than copied as formula text.
- [ ] The contract distinguishes source facts, inferred behavior, and unresolved implementation questions.

**Packet completion handoff:** Provide a concise dependency summary, unresolved items that block coding, and machine-readable contracts for the next packets. Commit message: docs: map legacy workbook migration contract.

### CXP-02 - Target Workbook Skeleton and System Control Workbook
**Wave:** Foundation  
**Dependencies:** CXP-00; consume CXP-01 naming when available  
**Parallelism:** Yes, partial  
**Goal:** Create idempotent initialization for the target Google Sheets structure and the separate system-control workbook.

**In scope**
- Create/initialize staging tabs: _STG_HANDLED, _STG_OFFERED, _STG_AHT, _STG_AUXES, _STG_STAFF.
- Create/initialize raw tabs: _RAW_HANDLED, _RAW_OFFERED, _RAW_AHT, _RAW_AUXES, _RAW_STAFF.
- Create placeholders for calculation, aggregation, Interval View, MOM, and required supporting outputs.
- Create system-control tabs: RUN_LOG, ERROR_LOG, FILE_LEDGER, WEEK_REGISTRY, SCHEMA_REGISTRY, PARITY_RESULTS, SOURCE_ERROR_BASELINE.
- Protect backend/system tabs from normal RTA editing while keeping report surfaces usable.
- Make initialization idempotent: rerunning must not duplicate tabs or destroy existing operational data.

**Non-goals**
- No finalized formulas.
- No ingestion pipeline.
- No production permissions rollout.

**Required deliverables**
- WorkbookInitializer.gs
- ControlWorkbookInitializer.gs
- sheet naming constants
- protection helpers
- initialization tests/verification notes

**Acceptance criteria**
- [ ] A blank DEV spreadsheet can be initialized into the full required skeleton.
- [ ] Initialization is safe to rerun.
- [ ] Backend tabs are clearly distinguishable from user-facing tabs.
- [ ] The control workbook can be initialized separately from the weekly operational workbook.

**Packet completion handoff:** Record created sheet contracts, protections, IDs/config keys expected, and any deviations from the approved architecture. Commit message: feat: initialize target and control workbooks.

### CXP-03 - Dataset Schema Registry and Normalized Input Contract
**Wave:** Ingestion  
**Dependencies:** CXP-01, CXP-02  
**Parallelism:** No  
**Goal:** Create one authoritative schema registry for the five logical datasets and isolate downstream code from source-column position and physical file packaging.

**In scope**
- Define required/optional headers, aliases, data types, key fields, empty-value policy, and reasonable row-volume bounds for Handled, Offered, AHT - Raw, Auxes - Raw, and Staff.
- Normalize header matching without silently accepting materially changed schemas.
- Define a normalized DatasetPayload interface/object shape used by all adapters and repositories.
- Implement schema versioning and record active schema version in run metadata.
- Create adapter contracts for multi-sheet workbook packaging and single-dataset packaging without assuming which one is final.

**Non-goals**
- No XLSX conversion implementation.
- No live raw writes.
- No business metric calculations.

**Required deliverables**
- SchemaRegistry.gs
- SchemaValidator.gs
- DatasetPayload contract
- schema fixtures
- schema tests

**Acceptance criteria**
- [ ] Missing required columns fail deterministically with a specific error code.
- [ ] Header order changes do not break valid files.
- [ ] Unexpected critical column changes do not pass silently.
- [ ] All five logical datasets can be represented through the same normalized payload contract.
- [ ] Schema validation is testable without Google Sheets API calls.

**Packet completion handoff:** List schema versions, key fields, unresolved source columns, and fixture coverage. Commit message: feat: define source dataset contracts.

### CXP-04 - Run State Machine, Locking, Logging, and Error Taxonomy
**Wave:** Ingestion  
**Dependencies:** CXP-00, CXP-02, CXP-03  
**Parallelism:** Can overlap with adapter implementation after interfaces are fixed  
**Goal:** Build the orchestration backbone for observable, serialized ingestion runs.

**In scope**
- Generate unique run IDs and persist start/end timestamps, uploader/source actor where available, filename/file ID, schema version, row counts, target workbook, status, and error code.
- Implement explicit states: RECEIVED, VALIDATING_FILE, PARSING, VALIDATING_SCHEMA, CHECKING_DUPLICATE, STAGING, VALIDATING_STAGE, COMMITTING, RECALCULATING, HEALTH_CHECK, SUCCESS plus failure states.
- Use script-level locking to prevent concurrent production writes.
- Define error classes/codes for source errors, ingestion errors, migration/calculation errors, and reporting errors.
- Write run/error records in batch rather than cell-by-cell.

**Non-goals**
- No XLSX parsing.
- No transaction commit yet.
- No parity comparison.

**Required deliverables**
- RunService.gs
- RunRepository.gs
- RunLogger.gs
- ErrorLogger.gs
- ErrorCodes.gs
- Locking helper
- tests

**Acceptance criteria**
- [ ] Every attempted run creates an auditable record, including failures.
- [ ] Two simultaneous write attempts cannot both enter COMMITTING.
- [ ] State transitions reject illegal transitions.
- [ ] Log writing is bulk-oriented and does not depend on fragile cell coordinates beyond the controlled schema.

**Packet completion handoff:** Provide the state transition table, error-code catalog, sample run records, and concurrency test evidence. Commit message: feat: add ingestion run orchestration.

### CXP-05 - Drive/XLSX Input Adapters and Duplicate Fingerprinting
**Wave:** Ingestion  
**Dependencies:** CXP-03, CXP-04  
**Parallelism:** No  
**Goal:** Read supported source files into normalized value-only dataset payloads and block duplicate submissions before production data changes.

**In scope**
- Implement Drive-based file intake as the canonical source interface.
- For XLSX, convert/read through a temporary Google Sheets representation or other supported Google API path, extract values only, then clean up temporary conversion artifacts.
- Do not execute, port, or rely on Excel formulas from uploaded files.
- Compute a content-based fingerprint/checksum where technically available; otherwise use a documented deterministic composite fingerprint.
- Check FILE_LEDGER before staging and reject a previously successful duplicate.
- Record duplicate result and original successful run reference.
- Do not retain historical raw upload payloads beyond what is necessary for the active run/cleanup window.

**Non-goals**
- No user-facing upload UI yet.
- No raw commit.
- No formula migration.

**Required deliverables**
- DriveService.gs
- InputAdapter.gs
- XlsxAdapter.gs
- WorkbookBundleAdapter.gs
- DatasetAdapter.gs
- DuplicateService.gs
- CleanupService.gs
- tests/fixtures

**Acceptance criteria**
- [ ] A valid XLSX source can be normalized into values-only payloads.
- [ ] The same content uploaded under a different filename is blocked when fingerprinting supports it.
- [ ] Temporary conversion files are cleaned up after success and failure.
- [ ] Unsupported file types fail before staging.
- [ ] No source formula text is required by downstream transformation logic.

**Packet completion handoff:** Document supported source types, fingerprint strategy, temp-file lifecycle, limitations, and quota considerations. Commit message: feat: ingest and fingerprint source files.

### CXP-06 - Staging, Two-Phase Commit, Rollback, and Raw Replacement
**Wave:** Ingestion  
**Dependencies:** CXP-02, CXP-04, CXP-05  
**Parallelism:** No  
**Goal:** Guarantee that bad or partially processed uploads cannot corrupt the currently valid operational dataset.

**In scope**
- Write all normalized datasets to _STG_* tabs using bulk setValues operations.
- Validate staged row counts, required datasets, key fields, dates/sites/queue values, and schema version before commit.
- Capture a recoverable snapshot/backup strategy for the current _RAW_* data before replacement.
- Replace raw datasets only after the entire staged package passes validation.
- If commit or post-commit health check fails, restore the prior valid raw state where technically feasible and mark rollback status.
- Flush/recalculate at controlled points; avoid repeated SpreadsheetApp calls inside row loops.

**Non-goals**
- No final business calculations.
- No reporting UI.

**Required deliverables**
- StagingRepository.gs
- RawDataRepository.gs
- CommitService.gs
- RollbackService.gs
- stage validation rules
- failure-injection tests

**Acceptance criteria**
- [ ] Invalid input leaves active raw data unchanged.
- [ ] A deliberately injected mid-commit failure results in a recorded rollback path rather than silent partial success.
- [ ] All five logical datasets commit as one logical run.
- [ ] Raw tabs contain values only and no manual user edits are required.
- [ ] Peak expected dataset volumes can be written within acceptable Apps Script execution limits in UAT.

**Packet completion handoff:** Provide transaction sequence, backup/rollback mechanism, failure-injection results, and any atomicity limitations of Google Sheets. Commit message: feat: add staged transactional raw replacement.

### CXP-07 - Native Transformations - Handled and Offered
**Wave:** Native model  
**Dependencies:** CXP-01, CXP-02; raw repositories from CXP-06 preferred  
**Parallelism:** Yes, with CXP-08  
**Goal:** Rebuild the business logic currently embodied in Excel structured references for Handled and Offered using Google Sheets-native, vectorized patterns.

**In scope**
- Use the CXP-01 metric lineage and workbook contract as the only source of business-rule truth.
- Implement normalized calculated tables/helpers required downstream for handled/offered, service-level, abandonment, forecast comparisons, and allocation logic that originates from these datasets.
- Prefer ARRAYFORMULA, QUERY, FILTER, SUMIFS/COUNTIFS, lookup tables, bounded ranges, or equivalent stable native constructs.
- Do not reproduce #This Row formulas one cell at a time.
- Create deterministic test fixtures comparing representative outputs to the Excel control.

**Non-goals**
- Do not invent business formulas from metric names.
- Do not rebuild unrelated AHT/Auxes/Staff logic.
- Do not optimize visual formatting.

**Required deliverables**
- Handled transformation layer
- Offered transformation layer
- formula/logic documentation
- test fixtures and expected outputs

**Acceptance criteria**
- [ ] All implemented calculations trace back to CXP-01 lineage.
- [ ] No per-row formula fill-down architecture is introduced unless explicitly justified.
- [ ] Representative parity checks against Excel pass or deltas are documented with root cause.
- [ ] Recalculation remains stable at approximately 5k Handled + 5k Offered rows.

**Packet completion handoff:** List each implemented business rule, its Excel lineage, Sheets implementation pattern, and parity status. Commit message: feat: rebuild handled and offered transformations.

### CXP-08 - Native Transformations - AHT, Auxes, and Staff
**Wave:** Native model  
**Dependencies:** CXP-01, CXP-02; raw repositories from CXP-06 preferred  
**Parallelism:** Yes, with CXP-07  
**Goal:** Rebuild AHT/session, auxiliary, staffing, scheduled/required/actual calculations using native Google Sheets logic.

**In scope**
- Implement AHT - Raw transformation rules and session/AHT/ACW/ASA dependencies from the workbook contract.
- Implement Auxes - Raw transformations required by staffing/auxiliary metrics.
- Implement Staff transformations supporting Scheduled, Required, Actual (SO), Actual vs Required, Scheduled Hours, Required Hours, Actual, Actual to Required, and Scheduled to Required.
- Use bounded/vectorized native Sheets constructs and stable lookup/helper tables.
- Build representative parity fixtures at expected ~7k AHT, ~3k Auxes, ~300 Staff rows.

**Non-goals**
- Do not infer formulas absent from the workbook contract.
- Do not create final Interval View/MOM layouts.

**Required deliverables**
- AHT transformation layer
- Auxes transformation layer
- Staff transformation layer
- logic documentation
- parity fixtures

**Acceptance criteria**
- [ ] All transformations trace to the control workbook contract.
- [ ] Expected operational metrics are generated at the required grain or feed a documented aggregation step.
- [ ] No Excel structured-reference dependency remains in runtime logic.
- [ ] Representative parity checks pass or have documented, classified deltas.

**Packet completion handoff:** List calculation lineage, implementation patterns, row-volume performance, and unresolved parity gaps. Commit message: feat: rebuild aht auxes and staff transformations.

### CXP-09 - Stable Aggregation and Domain Model
**Wave:** Native model  
**Dependencies:** CXP-07, CXP-08, CXP-01  
**Parallelism:** No  
**Goal:** Replace fragile PivotTable/GETPIVOTDATA coordinate dependencies with stable aggregation tables that expose the business grain required by reporting.

**In scope**
- Define canonical dimensions: date, interval, site, queue/LOB, plus any workbook-contract dimensions actually required.
- Define stable measures for Forecast, Offered, Handled, Chats in SL, Abandoned, SL %, Time To Connect, % of Forecast Offered, % of Forecast Handled, Allocation, Cumulative Allocation, AHT (Session), AHT, ACW, ASA, Concurrency, Scheduled, Required, Actual and hour/ratio measures.
- Rebuild Drivers and Allocation, AHT Handled Offered, Staff, Forecast and Allocation dependencies as stable tables/views.
- Use native PivotTables only where interactive behavior is operationally required; otherwise prefer deterministic aggregation tables.
- Document exact field definitions and grain for each aggregate.

**Non-goals**
- No final report formatting.
- Do not preserve pivot cell addresses for their own sake.

**Required deliverables**
- aggregation tables/sheets
- metric registry
- dimension/measure definitions
- aggregation tests

**Acceptance criteria**
- [ ] All primary operational metrics are available at the required reporting grain.
- [ ] Reporting logic no longer depends on legacy Excel PivotTable coordinates.
- [ ] Required supporting dependencies identified in project records remain available.
- [ ] Aggregations are deterministic for the same raw input.

**Packet completion handoff:** Provide data dictionary, grain definitions, formulas/queries, and dependency map from transforms to reports. Commit message: feat: build stable operational aggregation model.

### CXP-10 - Interval View and MOM Reporting Surfaces
**Wave:** Reporting  
**Dependencies:** CXP-09, CXP-01  
**Parallelism:** No  
**Goal:** Recreate the two primary RTA outputs on top of the native model while preserving business meaning, required filters, and weekly operating behavior.

**In scope**
- Recreate Interval View as the primary operational report communicated to Operations.
- Recreate MOM as a primary RTA output, including confirmed weekly forecast/date rollover logic from the workbook contract.
- Preserve business-significant conditional formatting, labels, filters, and slicer-equivalent interaction where required.
- Keep backend calculation sheets hidden/protected where appropriate; do not force RTAs to manipulate backend tabs.
- Ensure all operationally required dependencies remain available even if their physical layout differs from Excel.

**Non-goals**
- Do not pursue pixel-perfect Excel recreation when it conflicts with native Sheets stability.
- Do not silently remove a report dependency because RTAs do not directly touch it.

**Required deliverables**
- Interval View
- MOM
- report configuration/formatting helpers
- report smoke tests
- RTA usage notes

**Acceptance criteria**
- [ ] Interval View and MOM render the required metrics from the native model without Excel runtime dependencies.
- [ ] Weekly date logic updates correctly in UAT.
- [ ] Critical conditional formatting/business cues are preserved or explicitly documented as an accepted difference.
- [ ] The RTA workflow is simpler than manual five-tab paste + pivot refresh.

**Packet completion handoff:** Document report controls, required manual inputs if any, formatting differences, weekly rollover behavior, and smoke-test results. Commit message: feat: rebuild interval view and mom reports.

### CXP-11 - Excel-vs-Google-Sheets Parity Harness and Source-Error Ledger
**Wave:** Validation  
**Dependencies:** CXP-07 through CXP-10; can begin earlier with partial metrics  
**Parallelism:** Partially  
**Goal:** Create repeatable output-parity validation that distinguishes migration defects from the legacy workbook’s known error baseline.

**In scope**
- Load/export comparable Excel-control outputs and Google Sheets target outputs for the exact same raw dataset.
- Compare at date + interval + site + queue/LOB + metric grain.
- Prioritize service level, AHT/handle time, abandonment, offered/handled, staffing percentages, then the full operational metric registry.
- Create SOURCE_ERROR_BASELINE with the known cached Excel errors and classification rules. The 5,655 figure in this handoff is superseded WB0809/project-record history; the WB0817 binary authority is 1,885 errors (1,838 `#N/A`, 26 `#DIV/0!`, 21 `#REF!`) per `config/formula-family-catalog.json` and `docs/parity-validation-contract.md`.
- Log source value, target value, delta, tolerance if applicable, calculation lineage, classification, and resolution status.
- Produce a machine-readable and human-readable parity summary.

**Non-goals**
- Do not automatically treat every Excel error as expected target behavior.
- Do not validate appearance as a substitute for output parity.

**Required deliverables** (delivered as `CXP-11-v1`)
- Validation utilities: `src/parity/` (contracts, digest, export adapter, comparator, baseline, run engine) plus `src/main/Cxp11Setup.js`, `src/main/Cxp11ParityRun.js`, and `src/main/Cxp11UatEntrypoints.js`
- PARITY_RESULTS schema: `src/repository/ParityResultsRepository.js`
- SOURCE_ERROR_BASELINE initialization: `src/parity/SourceErrorBaseline.js` and `src/repository/SourceErrorBaselineRepository.js`
- Validation fixtures: `tests/fixtures/cxp11/synthetic-parity-bundle.json`
- Contract and templates: `docs/parity-validation-contract.md`, `docs/cxp11-uat-runbook.md`, `docs/cxp11-uat-harness.md`, `docs/cxp11-parity-report-template.md`, `docs/cxp11-hosted-uat-results-template.md`

**Acceptance criteria**
- [ ] Known source errors are not counted as migration defects unless the migration intentionally changes behavior and the change is documented.
- [ ] Critical metrics have zero unexplained deltas before cutover.
- [ ] Every delta can be traced to a source row/aggregation and metric lineage.
- [ ] Validation can be rerun on a new weekly dataset without rewriting comparison logic.

**Packet completion handoff:** Provide parity matrix, unresolved deltas, tolerance rules, source-error treatment, and sign-off-ready report. Commit message: feat: add Excel to Sheets parity validation.

### CXP-12 - Weekly Workbook Lifecycle, Scheduling, and Environment Promotion
**Wave:** Operations  
**Dependencies:** CXP-02, CXP-04, CXP-06, CXP-10  
**Parallelism:** Can overlap with CXP-11  
**Goal:** Operationalize the weekly active-template model, hourly freshness, environment separation, cleanup, and health checks.

**In scope**
- Create a master-template -> weekly-instance workflow and register the active workbook in WEEK_REGISTRY.
- Initialize week/date controls without overwriting live data on accidental rerun.
- Keep user-triggered/source-triggered ingestion as the primary refresh path; use time-driven triggers for maintenance, stale-data checks, optional inbox polling, cleanup, and weekly rollover.
- Implement active-workbook lookup through configuration rather than hard-coded IDs.
- Define DEV/UAT/PROD PropertiesService keys and promotion checklist.
- Implement health checks for stale data, missing expected sheets, failed last run, and recalculation readiness.

**Non-goals**
- Do not create daily operational files.
- Do not retain hourly upload history just to support scheduling.

**Required deliverables**
- WorkbookLifecycleService.gs
- TriggerController.gs
- HealthCheck.gs
- WEEK_REGISTRY logic
- environment deployment notes

**Acceptance criteria**
- [ ] A new weekly workbook can be created/registered idempotently from the master template.
- [ ] Hourly ingestion targets the registered active workbook.
- [ ] Stale or failed pipeline state is detectable without inspecting code.
- [ ] DEV/UAT/PROD configuration can be promoted without source edits.

**Packet completion handoff:** Document trigger inventory, environment keys, weekly rollover sequence, failure recovery, and manual override procedures. Commit message: feat: operationalize weekly workbook lifecycle.

### CXP-13 - RTA Intake Surface and Operational Status
**Wave:** Operations  
**Dependencies:** CXP-04 through CXP-06, CXP-12  
**Parallelism:** Yes, after APIs stabilize  
**Goal:** Expose a low-friction RTA workflow for submitting or selecting source input and seeing deterministic run status without exposing backend sheets.

**In scope**
- Use a controlled Drive Inbox as the canonical production input boundary unless verified file-size/UX constraints justify direct web upload.
- Provide an Apps Script menu/sidebar or web surface for selecting/processing the latest source, showing SUCCESS, DUPLICATE, VALIDATION_FAILED, PROCESSING_ERROR, and current active-data timestamp.
- Prevent users from triggering concurrent commits.
- Expose concise validation errors that identify the failed dataset/header without leaking implementation internals.
- Minimize RTA steps versus the current five manual paste actions plus pivot refresh.

**Non-goals**
- No business logic in HTML/UI code.
- No direct editing of raw/staging sheets by RTAs.

**Required deliverables**
- UI/controller code
- status model
- RTA quick-use runbook
- permission notes

**Acceptance criteria**
- [ ] An RTA can initiate the supported refresh path without touching backend tabs.
- [ ] Duplicate and invalid submissions give distinct, actionable outcomes.
- [ ] The UI/status surface reflects the same run state stored in RUN_LOG.
- [ ] The previous valid operational dataset remains usable after a failed submission.

**Packet completion handoff:** Document exact RTA steps, intake constraints, permission model, and screenshots/manual test evidence. Commit message: feat: add RTA ingestion status surface.

### CXP-14 - Performance Hardening, UAT, Cutover, and Production Runbook
**Wave:** Release  
**Dependencies:** CXP-00 through CXP-13  
**Parallelism:** No  
**Goal:** Prove the system is operationally safe at expected volumes, complete validation, and hand over a supportable production deployment.

**In scope**
- Test expected peak volumes: Handled ~5k, Offered ~5k, AHT ~7k, Auxes ~3k, Staff ~300, including combined hourly ingestion.
- Measure Apps Script execution duration, Sheets recalculation latency, number of service calls, and failure recovery time.
- Verify no row-by-row SpreadsheetApp write loops in critical paths.
- Test duplicate upload, wrong schema, missing dataset, empty source, invalid dates/site/queue, concurrent upload, mid-commit failure, rollback, stale-data alert, weekly rollover, and temporary-file cleanup.
- Lock down production configuration/protections and document least-privilege permissions.
- Run final Excel-vs-Sheets parity suite and prepare delivery validation/business validation package.
- Create production runbook with normal refresh, failure recovery, rollback, weekly rollover, and escalation steps.

**Non-goals**
- Do not introduce new features during cutover hardening.
- Do not change metric definitions to make parity tests pass.

**Required deliverables**
- UAT test report
- performance report
- production runbook
- deployment checklist
- rollback checklist
- final parity report
- release notes

**Acceptance criteria**
- [ ] Critical metric parity has zero unexplained deltas.
- [ ] Failure tests prove the last known good operational dataset survives bad submissions.
- [ ] Hourly refresh completes within the agreed operational window at expected volumes.
- [ ] Weekly rollover is proven in UAT.
- [ ] Delivery validation and business validation evidence is ready for the identified validators before production cutover.

**Packet completion handoff:** Provide final release summary, known limitations, open risks, rollback point, support ownership, and exact production deployment version. Commit message: chore: harden and release Nike Messaging migration.

## 8. Cross-Cutting Technical Requirements
- Use a standalone Apps Script project; workbook copies must not create divergent production code.
- Use PropertiesService/configuration for environment-specific IDs and settings.
- Use LockService or equivalent serialization for commits.
- Use value-only raw data tabs; protect them from normal user editing.
- Use staging before commit. Never clear live raw data before the entire new package validates.
- Use bounded ranges and bulk `getValues`/`setValues` operations.
- Do not use Excel formulas as runtime dependencies after ingestion.
- Avoid volatile/fragile patterns such as unnecessary INDIRECT/OFFSET or whole-column calculations.
- Treat backend tabs as implementation details unless RTA interaction is operationally required.
- Record enough run metadata to separate source-file problems from migration/pipeline defects.
- Clean temporary converted files after success and failure.
- Weekly active history is required; historical upload payload retention is not.

## 9. Definition of Done
- [ ] RTA can refresh the operational dataset through the supported intake path without the five manual paste actions and pivot refresh workflow.
- [ ] Valid data replaces the prior active hourly dataset; invalid/duplicate data is rejected without corrupting the last known good dataset.
- [ ] Interval View and MOM operate entirely from Google Sheets-native data/calculation/reporting layers.
- [ ] All operationally required dependencies identified by the workbook contract are preserved.
- [ ] Critical metrics match the legacy Excel control for the same input at date + interval + site + queue/LOB + metric grain, with zero unexplained critical deltas.
- [ ] The 5,655 known source-workbook errors are tracked separately from migration defects.
- [ ] System supports one messaging queue, two sites, weekly active history, and hourly freshness at expected row volumes.
- [ ] No RTA depends on a specific Microsoft 365 Excel license/version for normal runtime reporting.
- [ ] Weekly rollover is tested and does not recreate daily file/version sprawl.
- [ ] Production runbook, rollback procedure, validation evidence, and known limitations are complete.

## 10. Required Test Matrix
- [ ] Happy-path valid refresh
- [ ] duplicate source content under same filename
- [ ] duplicate source content under different filename
- [ ] missing required dataset
- [ ] missing required header
- [ ] reordered valid headers
- [ ] unexpected critical header change
- [ ] empty dataset
- [ ] invalid date/interval
- [ ] invalid site/queue value
- [ ] concurrent refresh attempts
- [ ] mid-staging failure
- [ ] mid-commit failure
- [ ] rollback path
- [ ] temporary conversion cleanup on failure
- [ ] expected peak row volumes
- [ ] recalculation latency
- [ ] weekly rollover
- [ ] stale-data health check
- [ ] Excel parity - critical metrics
- [ ] Excel parity - full operational metric registry

## 11. Source Basis and Traceability
- `Project_Knowledge_Base.docx`: consolidated source of business objective, agreed hybrid architecture, source volumes, error baseline, operational outputs, uploader requirements, validation protocol, risks, and implementation-readiness checklist.
- `levelSetting.docx`: detailed RTA workflow, five logical inputs, XLSX input record, hourly refresh, duplicate prevention, replace-not-append behavior, operational metrics, workbook EDA, and validation method.
- `meeting_notes.docx` (Aug 20, 2026): team consensus on hybrid migration, hourly override policy, Excel control validation, weekly workflow direction, one messaging queue scope, delivery/validation ownership and timeline.
- Approved architecture in the current project conversation: standalone Apps Script control plane, system-control workbook, staging/two-phase replacement, rollback/locking, stable aggregation tables, weekly workbook lifecycle, DEV/UAT/PROD, and Codex packetization.

## 12. Kickoff Prompt for Codex

```text
Read CODEX_HANDOFF.md completely before modifying the repository.
Execute exactly one packet at a time, beginning with CXP-00 unless packet-status.md shows it complete.
Treat the legacy workbook migration contract from CXP-01 as the sole authority for business formulas and metric lineage.
Do not build an Excel converter and do not reproduce Excel structured-reference formulas cell-by-cell.
Preserve the approved architecture: standalone Apps Script control plane, Google Sheets-native calculation/reporting plane, staging + validation + commit + rollback, duplicate blocking, hourly replacement, weekly active workbook, and Excel output parity validation.
Before coding, inspect dependency packet completion notes and list any blocking ambiguity. Do not invent missing business rules.
After implementation, run the packet acceptance checks, update docs/packet-status.md and docs/decision-log.md, and provide a completion handoff containing files changed, tests run, acceptance results, assumptions, known limitations, and next-packet inputs.
```

## 13. Project Record Timeline
- Project record target delivery: **2026-08-27**.
- Project record validation date: **2026-08-28**.
- Delivery/output validation role recorded for **David Paulo Truelen**; final business validation role recorded for **Jade Frances Arrisga**.