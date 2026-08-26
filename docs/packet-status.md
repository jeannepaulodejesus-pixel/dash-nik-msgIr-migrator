# Packet Status

## Status convention

Valid states are `Not started`, `In progress`, `Blocked`, and `Complete`. A packet may be marked `Complete` only after its acceptance checks run. Its completion entry records delivery version or commit, files changed, commands and results, acceptance evidence, assumptions, known limitations, blockers, and next-packet inputs.

## Packet register

| Packet | Status | Dependency gate |
|---|---|---|
| CXP-00 — Repository Bootstrap and Engineering Guardrails | Complete | Delivery `CXP-00-v1` |
| CXP-01 — Legacy Workbook Reverse Engineering and Migration Contract | Complete | Delivery `CXP-01-v3` |
| CXP-02 — Target Workbook Skeleton and System Control Workbook | Complete | Delivery `CXP-02-v1` |
| CXP-03 — Dataset Schema Registry and Normalized Input Contract | Complete | Delivery `CXP-03-v1` |
| CXP-04 — Run State Machine, Locking, Logging, and Error Taxonomy | Complete | Delivery `CXP-04-v1` |
| CXP-05 — Drive/XLSX Input Adapters and Duplicate Fingerprinting | Complete | Delivery `CXP-05-v1` |
| CXP-06 — Staging, Two-Phase Commit, Rollback, and Raw Replacement | Complete | Delivery `CXP-06-v1` |
| CXP-07 — Native Transformations: Handled and Offered | Not started | Requires CXP-01 and CXP-02 complete |
| CXP-08 — Native Transformations: AHT, Auxes, and Staff | Not started | Requires CXP-01 and CXP-02 complete |
| CXP-09 — Stable Aggregation and Domain Model | Not started | Requires CXP-01, CXP-07, and CXP-08 complete |
| CXP-10 — Interval View and MOM Reporting Surfaces | Not started | Requires CXP-01 and CXP-09 complete |
| CXP-11 — Excel-vs-Google-Sheets Parity Harness and Source-Error Ledger | Not started | Requires CXP-07 through CXP-10 complete |
| CXP-12 — Weekly Workbook Lifecycle, Scheduling, and Environment Promotion | Not started | Requires CXP-02, CXP-04, CXP-06, and CXP-10 complete |
| CXP-13 — RTA Intake Surface and Operational Status | Not started | Requires CXP-04 through CXP-06 and CXP-12 complete |
| CXP-14 — Performance Hardening, UAT, Cutover, and Production Runbook | Not started | Requires CXP-00 through CXP-13 complete |

## CXP-00 completion handoff

- **Delivery version:** `CXP-00-v1`
- **Commit:** Created with packet commit message `feat: bootstrap Apps Script migration project`; the immutable hash is reported by Git after this record is committed.
- **Scope:** Repository skeleton, minimal manifest, environment configuration contract, local clasp target generation, unit tests, syntax/secret guardrails, CI, and engineering documentation.
- **Files created:** `.github/workflows/ci.yml`, `.gitattributes`, `.gitignore`, `CONTRIBUTING.md`, `README.md`, `package.json`, `package-lock.json`, `scripts/check-js.mjs`, `scripts/check-repository.mjs`, `scripts/configure-clasp.mjs`, `src/appsscript.json`, `src/config/Config.js`, `.gitkeep` files under `src/ingestion`, `src/main`, `src/monitoring`, `src/repository`, `src/services`, `src/ui`, and `src/validation`, `tests/config.test.cjs`, `tests/tooling.test.cjs`, `docs/architecture-decisions.md`, `docs/configuration.md`, `docs/decision-log.md`, `docs/testing.md`, and `docs/plans/2026-08-21-cxp-00-repository-bootstrap.md`.
- **Setup commands:** `npm ci`; `npm exec clasp -- login`; set local `CXP_CLASP_SCRIPT_ID`; `npm run clasp:configure`; `npm run clasp:status`; `npm run verify`. Exact usage and the standalone-project creation option are in `README.md`.
- **Environment keys:** `CXP_ENV`; for each DEV/UAT/PROD environment, `CXP_<ENV>_TARGET_SPREADSHEET_ID`, `CXP_<ENV>_CONTROL_SPREADSHEET_ID`, `CXP_<ENV>_DRIVE_INBOX_FOLDER_ID`, and `CXP_<ENV>_MASTER_TEMPLATE_SPREADSHEET_ID`. `CXP_CLASP_SCRIPT_ID` is local tooling input only.
- **Tests and checks:** `npm ci --no-audit --no-fund` completed with 264 packages; the pinned clasp dependency reports version 3.3.0. `npm run verify` exited 0 with 8 tests passed, 6 JavaScript files syntax-checked, and 19 text files scanned by repository guardrails. `npm run clasp:status` exited 0 against an ephemeral non-production target and selected only `src/appsscript.json` and `src/config/Config.js` as tracked remote content. The clean install emitted one transitive `uuid@9.0.1` deprecation warning from clasp's dependency tree.
- **Acceptance results:**
  - **No committed secrets or runtime/user-specific IDs:** Pass — local target/auth files are ignored, tested guardrails reject credential files and recognizable token material, and the fresh repository scan reported zero violations.
  - **DEV/UAT/PROD resolution:** Pass — tests exercised all three environments through a PropertiesService-compatible adapter, including invalid/missing environment failures.
  - **Non-production clasp push readiness:** Pass — clasp 3.3.0 accepted the generated `rootDir: "src"` configuration and enumerated the expected deployable files. An authenticated remote push was not required or performed.
  - **Packet and decision conventions:** Pass — `docs/packet-status.md`, `docs/decision-log.md`, and `CONTRIBUTING.md` define the required fields and workflow.
  - **Pure helper tests:** Pass — 8 of 8 tests passed with zero skips.
- **Assumptions:** Apps Script project targeting and credentials are operator-owned; `Etc/UTC` remains provisional until CXP-01 resolves workbook timezone semantics. Supplied project-record artifacts retain their named validation roles but contain no runtime configuration values.
- **Known limitations:** No authenticated remote push was performed because production deployment is a non-goal and no non-production Script ID or Google authorization belongs in source. The guardrail scan recognizes common credential/token shapes but cannot prove that arbitrary prose contains no sensitive context. Clasp 3.3.0 currently introduces a transitive deprecated `uuid` package; no direct replacement is available within CXP-00's pinned dependency boundary.
- **Blockers:** None.
- **Next-packet inputs:** CXP-01 must resolve workbook timezone/date semantics and may use the documentation/configuration boundary immediately. CXP-02 owns the first target/control workbook IDs and must make its required keys fail closed when implemented.

## CXP-01 initial blocked-packet handoff (superseded)

Superseded by `CXP-01-evidence-draft-2` after the WB0809 binary was supplied. This section is retained as historical evidence of the earlier access gate.

- **Evidence draft:** `CXP-01-evidence-draft-1`
- **Branch:** `cxp-01-workbook-contract`
- **Status:** Blocked at the legacy-workbook access gate; not complete and not implementation authority for business formulas.
- **Files created:** `config/workbook-contract.json`, `config/source-schema-draft.json`, `docs/workbook-inventory.md`, `docs/dependency-map.md`, `docs/metric-lineage.md`, `docs/open-contract-questions.md`, `docs/decision-needed.md`, and `tests/cxp01-contracts.test.cjs`.
- **Files updated:** `docs/decision-log.md`, `docs/packet-status.md`, and `package.json`.
- **Evidence inspected:** Full text/tables from `Project_Knowledge_Base.docx`, `levelSetting.docx`, and `meeting_notes.docx`; OOXML embedded-object/media inventory; direct visual inspection of all five embedded meeting-note images; local repository file inventory; connected Drive searches for the template and walkthrough.
- **Verified project-record facts:** 17 worksheets including 3 hidden; 9 Excel Tables; 15 PivotTables; 5 slicers; 271,677 formula cells; 172,521 structured-reference formula cells; at least 1,247 GETPIVOTDATA cells; 5,655 cached errors; five logical datasets and approximate volumes; 25 operational metrics; Interval View and MOM as primary outputs; hourly freshness and weekly reporting horizon.
- **Verified screenshot-record facts:** The displayed workbook title; 13 visible tab labels; all 25 registry metrics as Interval View headers; selected cell K122 formula `=IFERROR(E122/D122," ")`; and displayed filter/table/pivot captions. These are not workbook-binary verification.
- **Deterministic check:** `npm run test:cxp01` exercises the machine contracts and fails if unsupported source headers, keys, types, or lineage are promoted, or if screenshot evidence is promoted to workbook-binary status.
- **Acceptance results:**
  - **Every operational metric has lineage or is explicitly unresolved:** Pass for the blocked draft — all 25 metrics are individually recorded and explicitly unresolved.
  - **Every backend sheet required by Interval View or MOM is accounted for:** Not met — 13 visible tab labels and 1 additional project-record area (`Teams Update`) are recorded, but the total inventory, exact object identity, and internal edges are unavailable.
  - **Hidden-sheet dependencies are not omitted:** Not met — the count of 3 is recorded, but identities and dependencies are unavailable.
  - **Structured-reference and GETPIVOTDATA use is categorized by business purpose:** Not met — aggregate categories and concentration areas are recorded, but formula families and purposes require the workbook.
  - **Facts, inference, and unresolved questions are distinguished:** Pass — evidence states are explicit in both JSON contracts and all human-readable deliverables.
- **Assumptions:** No sheet/area name proves object type; the recorded parity-comparison grain does not prove runtime metric grain; aggregate EDA counts are project-record facts only.
- **Known limitations:** No workbook hash/version, complete object inventory, source headers, formula-family inventory beyond one screenshot-visible cell, named ranges, internal dependency edges, weekly rollover cells, error locations, or exact output coordinates are available. Drive-search absence is not proof the attachment does not exist. Native DOCX rendering was unavailable because LibreOffice is not installed; structured content and all embedded screenshots were inspected through the documented fallback.
- **Blocking input:** Supply the exact `.xlsx`/`.xlsm` legacy control workbook or accessible Drive URL/file ID, plus representative source samples and the validation version/date. Full details are in `docs/decision-needed.md`.
- **Next-packet impact:** CXP-03 and CXP-07 through CXP-11 must not consume this draft as business-rule authority. CXP-02 may proceed from CXP-00 while using only already-approved naming and configuration boundaries.

## CXP-01 resumed blocked-packet handoff (superseded)

Superseded by `CXP-01-evidence-draft-3` after WB0817 was selected and the five 0817 representative deliveries were supplied. The section below remains as the WB0809 historical handoff.

- **Evidence draft:** `CXP-01-evidence-draft-2`
- **Branch:** `cxp-01-workbook-contract`
- **Status:** Workbook-internal reverse engineering is complete for the supplied WB0809 hash. The packet remains blocked on representative source files and confirmation that WB0809—not screenshot-visible WB0816—is the parity authority.
- **Workbook evidence:** `Updated - Messaging Interval - Template Intouch WB0809 (2) (1).xlsx`; 5,578,014 bytes; SHA-256 `731178B5C259432D2BA6F211D66D553BB6B021D95B574D3041E22D0DC373B41D`.
- **Machine authorities:** `config/workbook-object-catalog.json`, `config/formula-family-catalog.json`, `config/metric-lineage-contract.json`, and `config/source-table-profile.json`; `config/workbook-contract.json` owns the evidence/version gate and `config/source-schema-draft.json` owns the remaining source contract.
- **Binary inventory:** 17 worksheets, including Backlogs, pull outs for alloc, and Detail1 hidden; 9 tables; 15 PivotTables over 7 caches; 5 slicer collection parts containing 24 controls over 19 caches; 21 defined names; no VBA, connections, external links, or data model.
- **Formula inventory:** 271,677 formula cells in 351 normalized families; 172,617 structured-reference cells, including 172,521 `#This Row`; exactly 1,247 GETPIVOTDATA cells; 5,655 cached errors localized by sheet and family.
- **Metric contract:** All 25 operational metrics have exact Interval View ranges, interval formulas, summary formulas, formats, and workbook-internal source chains. External delivery-file and parity-fixture boundaries remain explicit.
- **Source-table contract:** All five logical workbook tables have exact columns, calculated-column formulas, and aggregate cached-data profiles. Cached values were not copied into the repository and are not treated as external source samples.
- **Acceptance results:**
  - **Every operational metric has lineage or is explicitly unresolved:** Pass for workbook-internal lineage — all 25 metrics trace to tables, pivots, staging areas, or same-row derivations; external source contracts remain pending.
  - **Every backend sheet required by Interval View or MOM is accounted for:** Pass — all 17 sheets, roles, used ranges, formula counts, table/pivot ownership, and formula edges are inventoried.
  - **Hidden-sheet dependencies are not omitted:** Pass — all 3 hidden sheets and their discovered incoming/outgoing edges are recorded.
  - **Structured-reference and GETPIVOTDATA use is categorized by business purpose:** Pass — all 351 families carry a business category; GETPIVOTDATA distribution is exact by sheet/family.
  - **Source schema and semantics are complete:** Not met — workbook table structure is verified, but external delivery headers/packaging, keys, null/error rules, timezone, and overwrite semantics require representative files.
  - **Facts, classification, and unresolved questions are distinguished:** Pass — binary, cached-table, project-record, screenshot, and pending-source evidence states are separate.
- **Known anomalies:** Handled changes zero behavior at row 122; Interval AHT Session divides by 63 while the total divides by 60; interval Scheduled to Required lacks the total row's error wrapper; two names resolve to `#REF!`; the workbook contains 5,655 cached legacy errors; WB0809 may differ from WB0816.
- **Tooling limitation:** The bundled spreadsheet artifact reader exceeded both 4 GB and 8 GB Node heap limits during read-only import. Direct OOXML extraction completed successfully; no workbook edit/export occurred.
- **Blocking input:** Confirm WB0809 versus WB0816 and provide representative Handled, Offered, AHT - Raw, Auxes - Raw, and Staff source files. Exact requirements are in `docs/decision-needed.md`.
- **Next-packet impact:** CXP-07 through CXP-10 may use the binary-bound internal formula/lineage authorities for design. CXP-03, CXP-05, CXP-11, and production ingestion/parity work must wait for the external source contract.

## CXP-01 WB0817 resumed blocked-packet handoff (superseded)

Superseded by `CXP-01-v1` after the owner approved the intraday parity, ingestion, manual-dependency, retirement, and legacy-behavior decisions. This section remains as historical blocked-state evidence.

- **Evidence draft:** `CXP-01-evidence-draft-3`
- **Branch:** `cxp-01-workbook-contract`
- **Status:** WB0817 authority, workbook reverse engineering, and representative delivery schemas are verified. The packet remains Blocked because the raw files are partial-day snapshots rather than the exact WB0817 EOD load; operational time/key/null/error/replacement semantics are not owner-confirmed; and Data/Staff manual-input plus Aux/hidden-surface retention decisions remain open.
- **Authority decision:** WB0817 selected by the user on 2026-08-22. `MSG Intraday EOD 0817.xlsx`; 6,975,923 bytes; SHA-256 `CD8F8EC6F68FBEC85841CD64C251616FCECD0AD67DE4714EFB244F648548E65A`.
- **Machine authorities:** `config/workbook-object-catalog.json`, `config/formula-family-catalog.json`, `config/metric-lineage-contract.json`, `config/source-table-profile.json`, and `config/source-delivery-contract.json`; `config/workbook-contract.json` owns evidence and gate status, while `config/source-schema-draft.json` owns unresolved ingestion semantics.
- **Binary inventory:** 17 worksheets/3 hidden, 9 tables, 15 PivotTables/7 caches, 5 slicer collection parts/24 controls/19 caches, 21 defined names, and no VBA, connections, external links, or data model.
- **Formula inventory:** 271,676 cells in 350 families; 172,617 structured-reference cells including 172,521 `#This Row`; 1,247 GETPIVOTDATA cells; 1,885 cached errors. WB0817 removes WB0809's single Interval View C111 array family while preserving the 25-metric block formulas.
- **Representative deliveries:** Five `.xls`-named ISO-8859-1 HTML tables: AHT 1,969×27, Aux 754×24, Handled 1,614×27, Offered 1,652×27, and Staff 87×5. Headers map to the five workbook tables; AHT requires one documented Excel header-deduplication alias.
- **Privacy boundary:** The source files contain direct and indirect personal identifiers. Repository artifacts retain no literal source rows or personal values.
- **Acceptance results:**
  - **Every operational metric has lineage or is explicitly unresolved:** Pass — all 25 metrics have exact WB0817 formulas/ranges and internal chains; the external cutoff boundary is explicit.
  - **Every backend and hidden-sheet dependency is accounted for:** Pass — all objects and formula/pivot/slicer edges are catalogued, including Staff BE:BF formulas outside `ActualStaffAH`.
  - **Structured-reference and GETPIVOTDATA use is categorized:** Pass — all 350 WB0817 families carry a business category.
  - **Representative source packaging and schemas are verified:** Pass — all five hashes, signatures, ordered headers, aggregate profiles, candidate keys, and table mappings are recorded without literal values.
  - **Exact same-cutoff source/output parity:** Not met — raw maxima are about 09:57–10:14; WB0817 cached maxima are about 21:54–23:18, with mutable-field and row-count differences.
  - **Operational semantics are implementation-ready:** Not met — timezone/DST, authoritative keys/duplicates, accepted null/errors, hourly replacement scope, manual Data/Staff procedures, Aux Productive-pivot use, Backlogs/Detail1 retention, and formula/error anomaly decisions remain open.
  - **Facts, classifications, and unresolved questions are distinguished:** Pass — binary, representative-source, screenshot, superseded-version, and pending-owner evidence states are separate.
- **Known anomalies:** Handled changes zero behavior at row 122; AHT Session divides by 63 for intervals and 60 for total; interval Scheduled to Required lacks the total's error wrapper; `LOB`/`sst` and Teams Update have broken references; WB0817 has 1,885 cached errors; representative raw records mutate before EOD.
- **Tooling limitation:** Direct OOXML/HTML extraction is authoritative. No workbook edit/export or live Excel recalculation occurred.
- **Blocking decision/input:** Exact EOD sources or an approved intraday parity checkpoint, plus every operating, manual-input, surface-retention, and anomaly decision in `docs/decision-needed.md` DN-002.
- **Next-packet impact:** CXP-03/CXP-05 may design signature/header validation from the representative delivery authority, but ingestion finalization and CXP-11 parity fixtures remain gated. CXP-07 through CXP-10 may use WB0817 internal formula/lineage authorities with the anomaly register.

## CXP-01 completion handoff (superseded)

Superseded by `CXP-01-v2` after RTA reconfirmed fixed PST rather than daylight-aware Pacific time. This section preserves the original `CXP-01-v1` completion evidence.

- **Delivery version:** `CXP-01-v1`
- **Branch:** `cxp-01-workbook-contract`
- **Commit:** Created with packet commit message `docs: complete CXP-01 migration contract`; the immutable hash is reported by Git after this record is committed.
- **Status:** Complete. WB0817 is the validation-control authority; workbook/source evidence is verified; every prior operating decision is approved and encoded.
- **Files updated:** `config/metric-lineage-contract.json`, `config/source-schema-draft.json`, `config/workbook-contract.json`, `docs/decision-log.md`, `docs/decision-needed.md`, `docs/dependency-map.md`, `docs/formula-family-catalog.md`, `docs/metric-lineage.md`, `docs/open-contract-questions.md`, `docs/packet-status.md`, `docs/source-delivery-contract.md`, `docs/workbook-inventory.md`, and `tests/cxp01-contracts.test.cjs`.
- **Machine authorities:** `config/workbook-object-catalog.json`, `config/formula-family-catalog.json`, `config/metric-lineage-contract.json`, `config/source-table-profile.json`, `config/source-delivery-contract.json`, `config/source-schema-draft.json`, and `config/workbook-contract.json`.
- **Control:** `MSG Intraday EOD 0817.xlsx`; 6,975,923 bytes; SHA-256 `CD8F8EC6F68FBEC85841CD64C251616FCECD0AD67DE4714EFB244F648548E65A`.
- **Source contract:** Five required, ordered, `.xls`-named HTML-table exports. Hourly processing validates and replaces the full five-file bundle. Exact canonical row duplicates collapse; divergent rows sharing a key fail.
- **Keys:** Handled/Offered `Messaging Session Name`; AHT `Agent Work ID`; Aux `User Presence ID`; Staff canonical full-row hash for technical deduplication.
- **Time contract:** Strict `en-US` source formats interpreted in `America/Los_Angeles` with IANA DST; ambiguous fall-back and nonexistent spring-forward timestamps are rejected. WB0817 is PDT (`UTC−07:00`). Intervals are left-closed/right-open 30-minute floors.
- **Parity contract:** Identify a checkpoint by five-file bundle run ID and acquisition timestamp. Load that identical bundle into a fresh legacy copy and the migrated system, compare the five normalized tables and all 25 Interval View metrics, and limit interval output comparison to closed buckets. WB0817 remains formula/object/legacy-behavior authority, not an exact row fixture for the partial-day bundle.
- **Manual dependencies:** RTA pastes Staff-derived values into Data B, D, F, M, R, and X; Staff BE:BF is copied into Data. Aux Productive remains operational. Backlogs and Detail1 are retireable after an implementation-time dependency recheck; the current graph has no path to Interval View.
- **Accepted legacy behavior:** AHT interval `/63` versus total `/60`, Handled zero/blank split, Scheduled/Required guard mismatch, broken names/references, and WB0817's 1,885 cached errors.
- **Tests and checks:** Focused completion TDD recorded the expected draft-status failure and later passed 1/1. `npm run verify` exited 0 with 16/16 tests, 7 JavaScript files syntax-checked, and 34 text files passing repository guardrails. Final staged whitespace checks and independent review are recorded in the packet evidence before commit.
- **Acceptance results:**
  - **Workbook/object/formula inventory:** Pass — exact hash-bound counts and object sets are independently reconciled.
  - **Every metric has lineage:** Pass — all 25 metrics have exact ranges, interval/total formulas, and internal chains.
  - **External source contract:** Pass — five hashes, signatures, ordered schemas, aggregate profiles, mappings, keys, null/error rules, duplicate rules, and full-replacement behavior are explicit.
  - **Parity strategy:** Pass — same-bundle legacy/migrated checkpoint protocol is approved without overstating the partial-day/EOD relationship.
  - **Manual/hidden dependencies:** Pass — Data/Staff and Aux procedures are explicit; conditional retirement has a fail-closed verification step.
  - **Facts and decisions are traceable:** Pass — binary, representative-source, screenshot, historical-version, owner-decision, and downstream-execution evidence remain distinct.
- **Privacy boundary:** No literal source rows or personal values are retained in repository artifacts. Production logs and fixtures must remain redacted or synthetic.
- **Assumptions:** An hourly parity bundle contains one complete export for each of the five datasets from a single RTA acquisition cycle. `America/Los_Angeles` is the canonical zone; the observed `M/d/yyyy` formats establish `en-US` parsing. A fresh legacy copy is available to downstream parity execution.
- **Tooling limitation:** No live Excel recalculation/render was performed during reverse engineering. Direct OOXML/HTML extraction is authoritative; same-bundle runtime parity is owned by downstream implementation and CXP-11.
- **Blockers:** None for CXP-01.
- **Next-packet inputs:** CXP-03 consumes the final ordered schemas, keys, strict timestamp/null/error rules, and format detection. CXP-05 consumes full-bundle replacement and exact-row dedupe. CXP-07 through CXP-10 consume the hash-bound formula/lineage authorities and accepted legacy behaviors. CXP-11 executes the same-bundle parity protocol.

## CXP-01 fixed-PST revision handoff

Superseded by `CXP-01-v3` only for source timestamp interpretation: fixed PST remains the business/report zone, while exports are now authoritative GMT/UTC. This section preserves the historical `CXP-01-v2` decision evidence.

- **Delivery version:** `CXP-01-v2`
- **Branch:** `cxp-01-workbook-contract`
- **Commit:** Created with packet commit message `docs: revise CXP-01 timezone to fixed PST`; the immutable hash is reported by Git after this record is committed.
- **Status:** Complete. RTA's reconfirmed fixed-PST rule supersedes the `CXP-01-v1` daylight-aware timezone interpretation; every other workbook, ingestion, parity, dependency, and anomaly decision remains unchanged.
- **Decision authority:** User-provided RTA reconfirmation on 2026-08-22, recorded as DEC-021.
- **Files updated:** `config/source-schema-draft.json`, `config/workbook-contract.json`, `docs/configuration.md`, `docs/decision-log.md`, `docs/decision-needed.md`, `docs/dependency-map.md`, `docs/metric-lineage.md`, `docs/open-contract-questions.md`, `docs/packet-status.md`, `docs/source-delivery-contract.md`, `src/appsscript.json`, and `tests/cxp01-contracts.test.cjs`.
- **Time contract:** Parse and bucket all RTA source timestamps as fixed Pacific Standard Time (`PST`, `UTC−08:00`) with no daylight-saving adjustment. Apps Script uses ZoneId `Etc/GMT+8`; interval flooring remains left-closed/right-open at 30-minute boundaries.
- **Parity effect:** Convert the acquisition timestamp to fixed PST before determining which interval right boundaries are closed. The identical five-file bundle still drives both the fresh legacy copy and migrated system.
- **Versioning:** `config/source-schema-draft.json` and `config/workbook-contract.json` advance to 1.0.1. Packet delivery advances to `CXP-01-v2`.
- **Tests and checks:** The focused timezone regression records a pre-change failure and a post-change pass. Final repository-wide, staged, and post-commit verification results are recorded before completion is reported.
- **Limitations:** No workbook edit/export, live Excel recalculation, or authenticated Apps Script push was performed. Google documents the manifest `timeZone` as a ZoneId and warns that script/spreadsheet timezone mismatches can cause bugs; downstream workbook creation must also set fixed PST.
- **Blockers:** None for CXP-01.
- **Next-packet inputs:** CXP-02 must set created spreadsheet timezones to fixed PST. CXP-03/CXP-05 consume fixed-PST parsing and checkpoint rules; CXP-11 verifies runtime parity at fixed UTC−08:00.

## CXP-02 completion handoff

- **Delivery version:** `CXP-02-v1`
- **Branch:** `cxp-02-workbook-initializers`
- **Commit:** Created with packet commit message `feat: initialize target and control workbooks`; the immutable hash is reported by Git after this record is committed.
- **Status:** Complete. The repository now provides a configuration-bound Apps Script entrypoint that initializes the weekly target and separate control workbook without embedding IDs, duplicating sheets, or clearing existing data.
- **Files updated:** `README.md`, `docs/architecture-decisions.md`, `docs/configuration.md`, `docs/decision-log.md`, `docs/packet-status.md`, `docs/testing.md`, `docs/workbook-skeleton.md`, `package.json`, `src/config/SheetNames.js`, `src/main/ControlWorkbookInitializer.js`, `src/main/WorkbookInitializer.js`, `src/main/WorkbookSetup.js`, `src/services/ProtectionHelpers.js`, `src/services/WorkbookSkeleton.js`, `tests/cxp02-initializers.test.cjs`; obsolete `src/main/.gitkeep` and `src/services/.gitkeep` are removed.
- **Entrypoints:** `WorkbookSetup.initializeConfiguredWorkbooks(properties, services)` is the injected/testable seam; `initializeCxp02Workbooks()` is the Apps Script editor entrypoint.
- **Target contract:** 23 required sheets — five `_STG_*`, five `_RAW_*`, five `_CALC_*`, three `_AGG_*`, plus Interval View, MOM, Teams Update, Aux Productive, and Allocation Export.
- **Control contract:** Seven separately initialized tabs — RUN_LOG, ERROR_LOG, FILE_LEDGER, WEEK_REGISTRY, SCHEMA_REGISTRY, PARITY_RESULTS, and SOURCE_ERROR_BASELINE.
- **Timezone:** Both configured spreadsheets are set to the fixed-PST business ZoneId `Etc/GMT+8`, matching the Apps Script manifest and CXP-01-v3. RTA source exports are separately interpreted as GMT/UTC and converted before business bucketing by later ingestion/transformation packets.
- **Idempotency:** Required names are ensured with `getSheetByName`; reruns insert nothing when complete and never clear, rename, delete, reorder, or write cell values. Unrelated sheets and protections remain untouched. A non-CXP sheet protection on an existing required backend/control tab is preserved and rejected before either configured workbook is mutated.
- **Protection policy:** Staging, raw, calculation, aggregation, and all control tabs receive the one reusable CXP-described sheet protection permitted by Google Sheets. Warning-only/domain access are disabled, the effective user is retained, other explicit editors and target audiences are removed, and unprotected-range exceptions are cleared. Report/support tabs receive no CXP-02 protection.
- **Configuration:** Active-environment target/control IDs are mandatory and must be distinct. Missing IDs, same IDs, missing adapters, or an effective user without an email fail before `openById` or workbook mutation.
- **TDD evidence:** Focused red/green cycles captured the absent tracer, duplicate reruns, missing/incomplete backend protections, late configuration/effective-user validation, unsafe live-global fallback from partial adapters, takeover of a pre-existing protection, and residual target-audience/unprotected-range bypasses. `npm run test:cxp02` exits 0 with 4/4 tests.
- **Repository checks:** Preliminary `npm run verify` exits 0 with 20/20 tests, 14 JavaScript syntax checks, and 42 guardrail-scanned text files; final staged and post-commit checks are rerun before completion is reported.
- **Acceptance results:**
  - **Blank DEV skeleton:** Pass at the complete injected Spreadsheet service boundary — exact 23-sheet target and 7-sheet control catalogs are created in separate fake workbooks with fixed PST. An authenticated hosted smoke run remains an operational pre-promotion check.
  - **Safe rerun:** Pass — no second insertion, no value loss, one full-sheet managed protection per protected sheet with all non-owner access channels normalized, and unrelated content/protections preserved; a protection conflict fails the cross-workbook preflight without mutation.
  - **Backend versus user-facing distinction:** Pass — underscore role prefixes and managed protections distinguish backend tabs; business-readable report/support tabs remain usable.
  - **Separate control workbook:** Pass — distinct configured IDs are required before either spreadsheet is opened.
- **Assumptions:** DEV/UAT operators create or select two spreadsheets, can edit/protect them, and expose a nonblank effective-user email during manual initialization. Existing extra tabs are preserved. Headers, formulas, formatting, record schemas, and production role groups are intentionally absent.
- **Known limitations:** No authenticated Google-hosted workbook mutation, live protection render, clasp push, production permission rollout, or spreadsheet ID was used or retained. Google-hosted smoke evidence is required before deployment promotion but does not change the deterministic repository contract.
- **Blockers:** None for the CXP-02 repository delivery.
- **Next-packet inputs:** CXP-03 owns source/control sheet headers and schema versions; CXP-04 owns run/error log row schemas and state transitions; CXP-06 consumes `_STG_*`/`_RAW_*`; CXP-07 through CXP-10 consume calculation, aggregation, and report placeholders; CXP-11 owns parity/error-baseline rows; CXP-12 owns workbook creation, weekly lifecycle, and promotion-time hosted smoke checks.

## CXP-01 GMT-extraction revision handoff

- **Delivery version:** `CXP-01-v3`
- **Branch:** `cxp-02-workbook-initializers`
- **Commit:** Created with packet commit message `fix: normalize GMT exports to fixed PST`; the immutable hash is reported by Git after this record is committed.
- **Status:** Complete contract revision. The later RTA clarification makes the export timestamp basis GMT/UTC while preserving fixed PST as the business/report timezone.
- **Files updated:** `config/metric-lineage-contract.json`, `config/source-schema-draft.json`, `config/workbook-contract.json`, `docs/architecture-decisions.md`, `docs/configuration.md`, `docs/decision-log.md`, `docs/decision-needed.md`, `docs/dependency-map.md`, `docs/metric-lineage.md`, `docs/open-contract-questions.md`, `docs/packet-status.md`, `docs/source-delivery-contract.md`, `docs/testing.md`, `docs/workbook-skeleton.md`, `src/config/SheetNames.js`, `src/main/ControlWorkbookInitializer.js`, `src/main/WorkbookInitializer.js`, and `tests/cxp01-contracts.test.cjs`.
- **Decision authority:** User-provided RTA clarification on 2026-08-22, attached Salesforce user-timezone screenshot, and SHA-bound WB0817 formula-family evidence; recorded as DEC-025.
- **Decision:** Parse naive source datetime values as GMT/UTC, preserve raw UTC, subtract 480 minutes before deriving the fixed-PST business date/interval, and keep the Apps Script and spreadsheet timezones at `Etc/GMT+8`. Date-only values remain unshifted calendar labels. Do not apply DST.
- **Legacy finding:** Five core AHT/Handled/Offered/Aux source-to-interval formula families floor raw hours directly and contain no GMT-to-PST shift. The only negative constant time shift is `Teams Update!F8:F16` at −15 hours; it is downstream report support and does not feed Interval View source bucketing. The missing core converter is an approved migration defect correction, not intentional legacy behavior.
- **Screenshot boundary:** The supplied screenshot shows a Salesforce personal display setting of `(GMT-07:00) Pacific Daylight Time (America/Los_Angeles)`. It is retained as contextual evidence only and does not override the later RTA statement that export timestamps are GMT.
- **Parity effect:** The same raw bundle still drives both systems. CXP-11 subtracts 480 minutes from legacy interval keys before comparing them with migrated fixed-PST keys and records the unaligned eight-hour displacement as approved expected variance. Acquisition checkpoints are converted from GMT to fixed PST before closed-interval selection.
- **Versioning:** `config/workbook-contract.json` and `config/source-schema-draft.json` advance to 1.0.2; `config/metric-lineage-contract.json` advances to 1.0.1; packet delivery advances to `CXP-01-v3`. CXP-02 remains complete with source/business timezone constants made explicit.
- **TDD evidence:** The focused GMT-conversion regression first exited 1 on contract version `1.0.1` versus expected `1.0.2`, then exited 0 after the machine/runtime authority was revised. Its date-only extension separately failed on the absent `date_time_values_only` rule before calendar-label handling was added. The existing operating-decision test failed first on absent DEC-025 and then on the stale all-intentional anomaly classification before both were corrected.
- **Repository checks:** `npm run test:cxp01` exits 0 with 9/9; `npm run test:cxp02` exits 0 with 4/4; `npm run verify` exits 0 with 21/21, 14 JavaScript syntax checks, and 42 guardrail-scanned text files. Final staged and post-commit reruns bind these results to the immutable delivery.
- **Limitations:** No legacy workbook was modified or recalculated, and no authenticated Apps Script push occurred. Direct OOXML formula-family evidence proves the absence of a converter in the discovered core paths but cannot prove an undocumented manual paste-time transformation; the explicit target conversion is therefore the authoritative migration behavior.
- **Blockers:** None. The source timezone, business timezone, conversion stage, and parity variance are explicit.
- **Next-packet inputs:** CXP-03/CXP-05 must retain raw UTC fields and strict UTC parsing; CXP-07/CXP-08 normalize event timestamps; CXP-09/CXP-10 bucket fixed-PST business timestamps; CXP-11 aligns legacy keys by −480 minutes and records the approved variance; CXP-12 keeps created workbooks on `Etc/GMT+8`.

## CXP-03 completion handoff

- **Delivery version:** `CXP-03-v1`
- **Branch:** `cxp-02-workbook-initializers`
- **Commit:** Not created in this task; the packet-specified commit message is `feat: define source dataset contracts`.
- **Status:** Complete. One pure Apps Script-compatible registry and validator now normalize every approved source into a versioned, position-independent `DatasetPayload` without Google service calls.
- **Files created:** `src/ingestion/SchemaRegistry.js`, `src/ingestion/SchemaValidator.js`, `src/ingestion/DatasetPayload.js`, `tests/cxp03-schema.test.cjs`, `tests/fixtures/cxp03/schema-fixtures.json`, and `docs/dataset-schema-contract.md`.
- **Files updated:** `package.json`, `docs/decision-log.md`, `docs/source-delivery-contract.md`, `docs/testing.md`, and `docs/packet-status.md`.
- **Runtime authority:** `src/ingestion/SchemaRegistry.js` active version `1.0.0`; `config/source-schema-draft.json` remains CXP-01 evidence rather than a competing runtime registry.
- **Schemas:** Handled 27 required/0 optional headers and 1–10,000 rows; Offered 27/0 and 1–10,000; AHT - Raw 27/0 and 1–15,000; Auxes - Raw 24/0 and 1–7,500; Staff 5/0 and 1–2,000.
- **Keys and unresolved columns:** Handled/Offered use `Messaging Session Name`, AHT uses `Agent Work ID`, Auxes uses `User Presence ID`, and Staff declares `canonical_full_row_hash` for later technical dedupe. No source column remains unresolved and no optional header is approved; AHT's explicit `Speed to Answer2` alias maps to canonical `Speed to Answer`.
- **Header contract:** Input order may vary, but names remain case-sensitive and must resolve to exactly one of every required canonical header. Missing, extra, duplicate/alias-colliding, blank, or unknown-dataset inputs fail with deterministic codes; output returns to registry order.
- **Payload contract:** Every adapter supplies dataset name, source headers/rows, a registered packaging locator, and run metadata. The factory emits immutable canonical records and stamps schema version `1.0.0` into both the payload and copied run metadata.
- **Packaging contracts:** `single_dataset` identifies one artifact per payload; `multi_sheet_workbook` identifies the source sheet per payload. CXP-03 deliberately does not choose the final packaging.
- **Value contract:** Whitespace becomes null without defaults; key nulls and raw `#...` error tokens fail; `NA` stays text; strict numbers, GMT/UTC datetimes, and unshifted date-only labels normalize to stable JavaScript/ISO values.
- **TDD evidence:** The initial direct focused command exited 1 with 0/7 while the public modules were absent; the decisive assertion reported `undefined` instead of the required registry function. Four later cases cascaded to missing-module `TypeError`, so the red evidence is claimed for the absent public contract, not as a clean per-case red for every branch. The identical command then exited 0 with 7/7 after implementation.
- **Repository checks:** `npm run test:cxp03` exited 0 with 7/7. Preliminary `npm run verify` exited 0 with 28/28 tests, 18 JavaScript files syntax-checked, and 48 text files scanned by guardrails; `git diff --check` exited 0. A fresh final gate is run after this completion record is added.
- **Acceptance results:**
  - **Missing required columns:** Pass — `SCHEMA_MISSING_REQUIRED_COLUMNS` includes the exact missing-header list.
  - **Header order changes:** Pass — reordered AHT input plus its explicit workbook alias normalizes to canonical registry order.
  - **Unexpected critical changes:** Pass — unapproved extras and duplicate canonical mappings fail rather than being guessed.
  - **One payload for all five datasets:** Pass — the same factory emits the same versioned object shape for all five schemas and both packaging contracts.
  - **No Google API dependency:** Pass — the complete boundary runs under Node with plain arrays/objects and no service doubles.
- **Assumptions:** The round row ceilings are fail-closed safeguards above the representative and WB0817 cached volumes, not forecasts. Raising them requires new delivery evidence and a versioned registry revision.
- **Known limitations:** CXP-03 defines but does not implement HTML/XLS parsing, five-file bundle checks, fingerprint/deduplication, repository writes, control-sheet mutation, or authenticated hosted execution; those belong to CXP-04 through CXP-06. No Git commit was created.
- **Blockers:** None for the repository delivery.
- **Next-packet inputs:** CXP-04 records `runMetadata.schemaVersion` and may use the deterministic error codes. CXP-05 implements either packaging adapter against `DatasetPayload.create()`, retaining raw UTC semantics and performing bundle/fingerprint rules. CXP-06 consumes only canonical headers and records, never source column positions.

## CXP-04 completion handoff

- **Delivery version:** `CXP-04-v1`
- **Branch:** `cxp-02-workbook-initializers`
- **Commit:** Not created in this task; the packet-specified commit message is `feat: add ingestion run orchestration`.
- **Status:** Complete. One Apps Script-compatible template method now owns unique run identity, legal transitions, production-write exclusion, categorized failures, and final audit persistence.
- **Files created:** `src/ingestion/RunService.js`, `src/ingestion/RunStateMachine.js`, `src/services/ScriptLock.js`, `src/monitoring/ErrorCodes.js`, `src/monitoring/RunLogger.js`, `src/monitoring/ErrorLogger.js`, `src/repository/RunRepository.js`, `tests/cxp04-run-orchestration.test.cjs`, and `docs/run-orchestration-contract.md`.
- **Files updated:** `package.json`, `docs/architecture-decisions.md`, `docs/decision-log.md`, `docs/packet-status.md`, and `docs/testing.md`.
- **Runtime entrypoint:** `RunService.execute(request, operations, services)` creates the run and invokes `validateFile`, `parse`, `validateSchema`, `checkDuplicate`, `stage`, `validateStage`, `commit`, `recalculate`, and `healthCheck` in order.
- **State contract:** `RECEIVED → VALIDATING_FILE → PARSING → VALIDATING_SCHEMA → CHECKING_DUPLICATE → STAGING → VALIDATING_STAGE → COMMITTING → RECALCULATING → HEALTH_CHECK → SUCCESS`; category-specific failures terminate as `FAILED_SOURCE`, `FAILED_INGESTION`, `FAILED_MIGRATION_CALCULATION`, or `FAILED_REPORTING`. Illegal transitions are rejected.
- **Lock contract:** Precommit work remains outside the lock. A script lock is acquired before `COMMITTING`, held through recalculation, health check, and flush, and released in `finally`; `SUCCESS` follows release.
- **Audit contract:** Each normally completed attempt persists one immutable run record; failed attempts also persist one error record. Both carry run correlation, UTC times, source/workbook identity, schema version, status, row counts, and safe error metadata where applicable.
- **Log schemas:** `RunLogger.HEADERS` and `ErrorLogger.HEADERS` are exact authorities. Empty headers and supplied record batches use bulk `setValues`; any nonempty header drift fails with `REPORTING_LOG_SCHEMA_MISMATCH`.
- **Error taxonomy:** Stable source, ingestion, migration/calculation, and reporting categories map every catalog code to one terminal failure state. Known CXP-03 codes retain their identity; unknown thrown values normalize to a stage-appropriate public code.
- **TDD evidence:** The initial focused command exited 1 with 0/6 and six clean assertion failures for absent public functions. The first implementation run passed 2/6 and exposed callable state access plus `errorCode`/null record-shape mismatches; interface alignment produced 6/6. The source-level completion audit then added two regressions: both failed specifically on early Apps Script dependency capture and append-before-complete-schema-preflight, and both passed after the boundary fixes. The final focused command exits 0 with 8/8.
- **Concurrency evidence:** The deterministic shared-lock test starts a second complete execution from inside the first run's commit callback. Only the first history contains `COMMITTING`; the second records retryable `INGESTION_LOCK_TIMEOUT` and `FAILED_INGESTION`, and both repositories receive their expected final batches.
- **Repository checks:** Final `npm run verify` exited 0 with 36/36 tests, 26 JavaScript files syntax-checked, and 57 text files scanned by guardrails. `git diff --check` exited 0; Git emitted only the repository's expected CRLF-to-LF working-copy warnings.
- **Acceptance results:**
  - **Every attempted run is audited, including failures:** Pass for the operational contract with an available repository — success writes one run record; source/ingestion/migration-calculation/reporting failures write one run plus one error record. A repository outage is explicitly surfaced as `REPORTING_LOG_WRITE_FAILED` and cannot prove durable storage.
  - **Simultaneous writes cannot both enter `COMMITTING`:** Pass at the injected LockService boundary — the nested second attempt times out without a commit event while the first owns the shared lock.
  - **Illegal state transitions are rejected:** Pass — skipped, repeated, unknown, and post-terminal moves emit `INGESTION_ILLEGAL_STATE_TRANSITION` with current and attempted states.
  - **Logs use controlled schemas and batch writes:** Pass — every required sheet schema is preflighted before either batch is appended, and two-record run/error batches each use one range write after initialization.
- **Research evidence:** Official Google Apps Script LockService/Lock references and an independent read-only verification confirm the selected `getScriptLock`/`tryLock`/`hasLock`/`releaseLock` contract. The local seam deliberately makes no stronger distributed-runtime claims.
- **Assumptions:** CXP-05 and CXP-06 callbacks obey the operation boundary and do not perform production writes before `commit`. The configured control workbook already contains `RUN_LOG` and `ERROR_LOG` from CXP-02.
- **Known limitations:** No authenticated overlapping Apps Script executions, hosted timeout measurement, XLS/HTML/XLSX parsing, fingerprinting, transaction/rollback implementation, transformation, or parity run was performed. If the audit repository itself is unavailable, the thrown reporting error carries attempted records but cannot make them durable.
- **Blockers:** None for the repository delivery.
- **Next-packet inputs:** CXP-05 supplies validation/parsing/duplicate callbacks and preserves CXP-03 schema version metadata. CXP-06 supplies staging, stage validation, commit, recalculation, and health-check callbacks and must not bypass `RunService` or the lock boundary.

## CXP-05 completion handoff

- **Delivery version:** `CXP-05-v1`
- **Branch:** `cxp-02-workbook-initializers`
- **Commit:** Not created in this task; the packet-specified commit message is `feat: add drive and xlsx input adapters`.
- **Status:** Complete. Drive/HTML/XLSX sources now resolve to five immutable CXP-03 payloads through CXP-04-compatible phases, with original-byte duplicate identity and permanent temporary-conversion cleanup before staging.
- **Files created:** `src/services/DriveService.js`, `src/services/CleanupService.js`, `src/services/DuplicateService.js`, `src/ingestion/DatasetAdapter.js`, `src/ingestion/XlsxAdapter.js`, `src/ingestion/WorkbookBundleAdapter.js`, `src/ingestion/InputAdapter.js`, `src/repository/FileLedgerRepository.js`, `tests/cxp05-input-adapters.test.cjs`, and `docs/input-adapter-contract.md`.
- **Files updated:** `src/monitoring/ErrorCodes.js`, `src/appsscript.json`, `package.json`, `docs/architecture-decisions.md`, `docs/decision-log.md`, `docs/packet-status.md`, `docs/run-orchestration-contract.md`, `docs/source-delivery-contract.md`, and `docs/testing.md`.
- **Supported types:** `single_dataset` requires exactly the five registered dataset files and accepts the observed `.xls`-named ISO-8859-1 single HTML table or a one-populated-sheet XLSX. `multi_sheet_workbook` requires one XLSX and maps all five registered sheets. BIFF `.xls`, CSV, native Google Sheets, arbitrary ZIP, multiple-table HTML, and formula-bearing workbooks fail closed.
- **Public interface:** `InputAdapter.read(request, services)` is the deep API. `validateFile`, `parse`, `validateSchema`, and `checkDuplicate` are the individual phase APIs; `createOperations(adapterRequest, services)` returns the four CXP-04 callbacks while retaining raw active state inside a closure.
- **Fingerprint strategy:** Each file is `sha256:` plus the lowercase SHA-256 of original blob bytes. One-file packaging reuses that value. Five-file packaging hashes the sorted `datasetName + NUL + contentFingerprint` composite, so file IDs, names, timestamps, and converter output cannot change bundle identity.
- **Duplicate ledger:** `FILE_LEDGER` has one controlled ten-column schema. A prior `SUCCESS` fingerprint writes a metadata-only `DUPLICATE` record with the attempted and original successful run IDs, then throws `SOURCE_DUPLICATE_SUBMISSION`. `recordSuccessful()` is reserved for CXP-06 after commit and health check.
- **Values and privacy:** XLSX reads values and formula presence separately; any formula is rejected without logging formula text. HTML entities decode before exact-row collapse and CXP-03 coercion. Divergent authoritative keys fail without row/key values in errors. Public source metadata excludes blobs/bytes, and ledger/error records never contain source rows.
- **Temporary lifecycle:** Drive v3 imports XLSX to a temporary Google Sheets file and permanently removes it after both successful and failed reads. Cleanup failure surfaces as retryable `SOURCE_TEMP_CLEANUP_FAILED` and preserves only the earlier public error code. Caller-owned originals are not copied and remain available for the active transaction; later lifecycle work owns post-outcome retention.
- **TDD evidence:** The initial focused command exited 1 with 0/11 and eleven clean assertions that the ten public functions plus Drive v3 manifest entry were absent; implementation produced 11/11. A later integration audit added one phase-boundary regression, which failed specifically because `validateFile` was undefined while the other 11 cases passed, then passed after the four phases and bridge were exposed. The final focused command exits 0 with 12/12.
- **Repository checks:** Final `npm run verify` exited 0 with 48/48 tests, 35 JavaScript files syntax-checked, and 67 text files scanned by guardrails. `npm run test:cxp05` independently exited 0 with 12/12. `git diff --check` exited 0 with only the repository's expected CRLF-to-LF working-copy warnings.
- **Acceptance results:**
  - **Valid XLSX becomes values-only normalized input:** Pass — one converted five-sheet synthetic workbook emits five CXP-03 `DatasetPayload` objects; formula-bearing input fails without formula text.
  - **Same content under a different filename is blocked:** Pass — two Drive objects with identical original bytes produce the same fingerprint; the second attempt records and reports the original successful run.
  - **Temporary conversion cleans up on success and failure:** Pass — the final adapter call is permanent Drive removal in both paths, including a formula failure; cleanup failure has its own retryable code.
  - **Unsupported types fail before staging:** Pass — unsupported bytes reach neither conversion nor ledger lookup; the adapter contains no staging or production-write function.
  - **Downstream never requires Excel formulas:** Pass — only `DatasetPayload` values continue; source formula presence is a terminal source error.
- **Research evidence:** Official Google Apps Script/Drive primary documentation confirms Drive blob reads, byte-array SHA-256, v3 advanced-service upload/import, separate values/formulas accessors, and permanent delete. A frozen research record and independent read-only verification bind the documentation claims to the implementation and tests.
- **Assumptions:** The configured control workbook already contains the CXP-02 `FILE_LEDGER` sheet. Current Drive import formats advertise XLSX-to-Google-Sheets conversion. The caller keeps the five-file acquisition set stable for the active run.
- **Known limitations:** No authenticated Apps Script import/delete smoke test, hosted quota measurement, inbox polling, BIFF parser, chunked/retried conversion, source-original retention workflow, staging/rollback, transformation, or parity run was performed. The Apps Script advanced service and underlying Drive API must be enabled and authorized in the deployment project. An indeterminate create before a response ID cannot be cleaned by ID, and two concurrent first submissions can both pass the pre-staging history check.
- **Blockers:** None for the repository delivery.
- **Next-packet inputs:** CXP-06 combines `InputAdapter.createOperations()` with staging/commit callbacks, consumes only normalized payloads, rechecks the fingerprint inside the production-write lock before mutation, records success after health checks while that lock is still held, and owns post-outcome cleanup/retention without bypassing `RunService`.

## CXP-06 completion handoff

- **Delivery version:** `CXP-06-v1`
- **Branch:** `main`
- **Commit:** `d0e7da7` — `feat: deliver CXP-03 through CXP-06 migration pipeline`.
- **Boundary-safe corrective implementation:** Commits `879f33e`, `0513a82`, `31db81c`, and `c6b52f6` add idempotent hosted terminal auditing, audit-only retry, phase-scoped UAT health/rollback faults, and durable cleanup-debt status.
- **Repository status:** Complete and locally verified. Hosted Apps Script UAT remains the deployment-promotion gate because no authenticated non-production target was supplied.
- **Architecture:** `CommitService.createOperations()` supplies staging, validation, incremental backup, incremental raw commit, recalculation, health, and fresh-process resume callbacks. Synchronous callers retain `RunService.execute()`. Hosted CXP-06 checkpoints after validated staging, creates and verifies one missing run-scoped backup dataset per locked continuation, and advances raw replacement through a persisted dataset cursor. The controller commits at most one raw dataset per hosted invocation, which is the 4:45 budget for peak declared volumes, then schedules one deduplicated continuation 60 seconds later. Each phase watchdog is armed at 420 seconds, outside the platform execution window, and the commit loop keeps a `COMMITTING` status anchored at phase entry so a concurrent invocation defers instead of competing for the production lock. `INGESTION_LOCK_TIMEOUT` is rescheduled as contention rather than recorded as a terminal failure. A fresh final invocation runs recalculation, health validation, SUCCESS confirmation, and cleanup without replaying completed raw writes.
- **Staging:** All five stage sheets are preflighted before clearing. Each receives one canonical header-plus-record `setValues`. Persisted values/formulas are reread and checked against schema version, exact headers/order, counts/bounds, formula absence, key uniqueness, normalized types, and exact payload values.
- **Raw replacement:** All raw sheets are preflighted as values-only. Five server-side hidden/protected copies are created and verified before the first raw mutation. Raw replacement and restore use fixed-order bulk clear/write calls.
- **Rollback:** Commit, recalculation, health, and success-unconfirmed-by-both-ledger-lookups failures restore all five datasets, flush, reread, compare with backups, and delete backups only after complete verification. Restore failure reports `MIGRATION_ROLLBACK_FAILED` and retains recovery evidence.
- **Recovery:** Committed leftovers are deleted without restore; one complete unfinished group restores; incomplete groups delete without restore; multiple complete unfinished groups fail closed.
- **Controlled Case 05 backup-topology seeder:** Implemented locally behind the DEV/UAT safety gate. It runs once under the production lock immediately before reconciliation, refuses any dirty backup topology, uses verified production backup creation, and retains partial or ambiguous recovery evidence.
- **Duplicate/success contract:** The bundle fingerprint is rechecked under the production lock before backup or raw mutation. SUCCESS is appended and read-confirmed under that lock before backup cleanup; a failed run-ID lookup uses one bounded fingerprint fallback that must match the same run ID and fingerprint.
- **Cleanup debt:** Backup deletion failure after confirmed health/SUCCESS returns `backupCleanupStatus: PENDING`; healthy raw remains active and the next locked run reconciles the group.
- **Error taxonomy:** Added `MIGRATION_STAGE_WRITE_FAILED`, `MIGRATION_BACKUP_FAILED`, `MIGRATION_RECOVERY_FAILED`, and `MIGRATION_ROLLBACK_FAILED`; existing stage validation, commit, recalculation, and health codes remain authoritative at their boundaries.
- **Focused tests:** `npm run test:cxp06` and `npm run test:cxp06:uat` cover staging checkpoint normalization and flush-before-publication, one-dataset backup journaling, one-dataset commit cursors, distinct previous-cycle raw snapshots, foreign incomplete-journal reconciliation, fresh-process adoption, reserved-step-time yielding, watchdog delays outside the execution window, deferral of an invocation arriving during an active commit loop, lock-contention rescheduling, verified-rollback backup recreation, successor-first trigger replacement, whole-pipeline trigger perpetuation, stranded-state repair, bounded entrypoint logging, rollback diagnostics, rollback-failure cursor restart, safe watchdog settling, backup retry, and actual-trigger status coverage.
- **Failure evidence:** Invalid stage or missing run metadata fails before raw mutation. Mid-commit and health mismatches restore all five. Rollback failure retains a complete group. In-lock duplicates create no backup/raw mutation. A run-ID confirmation read failure falls back to a matching fingerprint record, preserves committed raw, and causes a retry to be rejected as a duplicate. Success unconfirmed by either path rolls back. Cleanup debt preserves confirmed raw.
- **Peak evidence:** Synthetic declared maxima total 44,500 records and completed locally in 1,756.73 ms with exactly 10 `setValues` and 10 `clearContent` calls: five staging plus five raw, with no per-row/per-cell writes.
- **Research evidence:** Current official Apps Script references support same-workbook copy, rename/hide/protect, bulk values/formulas access, deletion, and flush. Independent verification confirmed the design only with explicit non-atomicity and protection-normalization qualifications.
- **Hosted UAT:** August 26 revalidation remains the latest hosted evidence and is partial. Peak Case 1 completed successfully in 16m 00.749s with a longest invocation of 204.372s, eliminating the observed six-minute timeout and reducing wall time by approximately 58.5% from the prior 38m 33s evidence. Cases 02, 05, 05.1, and 05.2 passed their expected boundaries. The boundary-safe corrective implementation is locally covered for the blocked findings: continuation failures require `failureAuditStatus: RECORDED`, CASE04 now targets `CALCULATION_HEALTH_CHECK_FAILED` at the final health operation, rollback-write injection is inert until the intended commit fault, and Case 5.3 durably exposes `backupCleanupStatus: PENDING`. These local changes do not replace hosted evidence. Full findings and Drive links are recorded in `docs/cxp06-hosted-uat-revalidation-2026-08-26.md`. Promotion remains blocked pending corrective reruns of Cases 03, 04, 04.1, 05.3, and 05.4.
- **TDD note:** Tasks 1–5 and Task 7 recorded expected red states before implementation. Task 6 fault tests passed on their first run because Task 5's minimum transaction implementation already contained those guarded paths; they are reported as tests-after evidence, not a separate red/green cycle.
- **Files created:** `src/config/DatasetSheets.js`, `src/services/SheetValueCodec.js`, `src/repository/StagingRepository.js`, `src/validation/StageValidator.js`, `src/repository/RawDataRepository.js`, `src/repository/BackupRepository.js`, `src/services/RollbackService.js`, `src/services/CommitService.js`, focused CXP-06 tests/helpers, `docs/transactional-raw-replacement-contract.md`, `docs/cxp06-uat-runbook.md`, the approved design, implementation plan, research record, and execution ledger.
- **Files updated:** `src/monitoring/ErrorCodes.js`, `src/repository/FileLedgerRepository.js`, `package.json`, `docs/architecture-decisions.md`, `docs/decision-log.md`, `docs/packet-status.md`, and `docs/testing.md`.
- **Known limitation:** Formula-like text beginning with `=` is rejected during persisted-stage formula validation because Apps Script `setValues` documents formula interpretation. Backup creation and raw replacement are durably split across cursor steps, but a single Sheets bulk operation cannot be preempted while in progress. The safety trigger and idempotent cursor recovery cover an abrupt single-step timeout; hosted timing evidence remains required.
- **Blockers:** None for repository delivery. Hosted UAT evidence is required before deployment promotion.

## CXP-07 completion handoff

- **Delivery version:** `CXP-07-v1`
- **Branch:** `main`
- **Commit:** Not created in this task; the packet-specified commit message is `feat: rebuild handled and offered transformations`.
- **Repository status:** Complete and locally verified. Hosted Google Sheets parity/performance UAT remains the deployment-promotion gate because no authenticated non-production target was supplied.
- **Architecture:** `initializeCxp07HandledOfferedTransformations()` opens only the configured target workbook and executes a checkpointed 27-step install plan. Script Properties persist the cursor, a script lock excludes overlap, a four-minute soft budget yields to a time-driven continuation, and a pre-work safety trigger prevents a hard timeout from stranding progress. `getCxp07HandledOfferedTransformationStatus()` reports persisted progress without opening the workbook.
- **Handled layer:** Three calculated fields—Accept Date, Interval, and AHT—plus all 27 canonical raw fields. Accept time is first-match AHT data shifted from UTC to fixed PST before date/interval derivation; AHT is query-aggregated by session and fixed-PST business date.
- **Offered layer:** Fifteen calculated fields—date, interval, site, SL/ASA, handled SL/ASA/count/fragments, response, session SL, session AHT, and active time—plus all 27 canonical raw fields. English/`NA`, blank-fragment, 91-second, first-match, and missing-case behaviors trace directly to CXP-01.
- **Vectorization:** Twenty spill anchors populate both sheets. Direct installation makes two header writes and four grouped formula writes; the hosted retry-safe path writes the same 20 anchors individually. Both call shapes are constant independent of row count, with no per-row formula loop or fill-down architecture. Bounds are 10,000 Handled/Offered and 15,000 AHT source rows.
- **Parity fixture:** `tests/fixtures/cxp07/handled-offered-parity.json` is synthetic and literal. It covers a UTC-to-prior-PST-date boundary, two 30-minute buckets, multi-row session aggregation, English/`NA` handled counting, blank fragment default, service-level thresholds, AHT Session, and Active Time.
- **Formula/logic documentation:** `docs/handled-offered-native-transformations.md` lists every rule, Excel lineage, Sheets implementation pattern, and parity state. DEC-035 records the architecture choice; DEC-025 remains the approved timezone correction.
- **TDD evidence:** In addition to the original five behavioral cycles, runtime remediation recorded clean red states for missing checkpoint/resume output, missing 27-step service exposure, absent pre-work safety trigger, and missing progress-status API. Each identical focused command returned green after implementation. The initial Handled/Offered schema-drift and repeat-install checks remain tests-after evidence.
- **Focused tests:** `npm run test:cxp07` covers 9 cases: fixture parity, bounded constant-write installation, the retry-safe 27-step plan, configured target-only setup, checkpoint/resume without replay plus safety-trigger and progress behavior, fail-closed Handled/Offered and AHT schema drift before mutation, exact preservation of the Handled interval lookup modes, and idempotent reinstall.
- **Acceptance results:** CXP-01 lineage is explicit for all 18 calculated fields; no per-row formula fill-down exists; the representative local fixture passes exactly; the formula topology is bounded above the approximately 5k target. Google-hosted formula parsing, output parity, and recalculation timing remain unverified locally and must pass `docs/cxp07-uat-runbook.md` before promotion.
- **Files created:** `src/transformations/HandledOfferedFormulaCatalog.js`, `src/transformations/HandledOfferedReferenceModel.js`, `src/services/HandledOfferedTransformationService.js`, `src/main/Cxp07Setup.js`, `tests/cxp07-native-transformations.test.cjs`, the CXP-07 fixture, formula contract, formula research record, and UAT runbook.
- **Files updated:** `package.json`, `README.md`, `docs/testing.md`, `docs/decision-log.md`, and `docs/packet-status.md`.
- **Known limitations:** Node does not execute Google Sheets formulas or prove hosted trigger timing. The runner works within rather than disables Apps Script's execution limit, so each individual spreadsheet operation must still finish inside one execution. The installer intentionally does not change visual formatting. A hosted approximately 5k+5k run is required before deployment promotion, and missing Handled cases used by Offered Handled ASA intentionally retain lookup-error visibility from the legacy baseline.
- **Blockers:** None for repository delivery. Hosted DEV/UAT evidence is the promotion gate.
- **Next-packet inputs:** CXP-08 may consume the canonical copied raw fields and use a separate native installer for AHT/Auxes/Staff. CXP-09 should aggregate `_CALC_HANDLED` and `_CALC_OFFERED` rather than recreating their row rules. CXP-11 should compare identical source bundles and classify only the DEC-025 eight-hour alignment as the approved expected variance.
