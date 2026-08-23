# Decision Log

## Convention

Append decisions; do not rewrite accepted history. Each entry records an ID, date, packet, status (`Proposed`, `Accepted`, `Superseded`, or `Rejected`), decision, rationale, and consequences. Architecture changes reference the affected ADR from `architecture-decisions.md`.

## CXP-00 decisions

### DEC-001 — Clasp source boundary

- **Date:** 2026-08-21
- **Packet:** CXP-00
- **Status:** Accepted
- **Decision:** Store deployable Apps Script content under `src/` and keep Node tooling/tests outside clasp's `rootDir`.
- **Rationale:** This makes the remote content set explicit while retaining local engineering tooling.
- **Consequences:** `.clasp.json` must use `"rootDir": "src"`; later packets add runtime files only under the documented source areas.

### DEC-002 — Runtime configuration adapter

- **Date:** 2026-08-21
- **Packet:** CXP-00
- **Status:** Accepted
- **Decision:** `Config.load()` consumes a PropertiesService-compatible `getProperty()` adapter and falls back to Apps Script Script Properties.
- **Rationale:** One interface works in Apps Script and deterministic local tests without Google API mocks.
- **Consequences:** Environment-specific values use `CXP_<ENV>_*` keys and remain absent from source.

### DEC-003 — Local clasp target generation

- **Date:** 2026-08-21
- **Packet:** CXP-00
- **Status:** Accepted
- **Decision:** Generate ignored `.clasp.json` from `CXP_CLASP_SCRIPT_ID` and refuse automatic overwrite.
- **Rationale:** Current clasp requires `scriptId`; committing a placeholder invites replacement with a real target ID.
- **Consequences:** Developers and CI reconstruct the target locally; repository verification blocks tracked clasp credential/target files.

### DEC-004 — Dependency-light local testing

- **Date:** 2026-08-21
- **Packet:** CXP-00
- **Status:** Accepted
- **Decision:** Use Node's built-in test runner and syntax checker; pin only clasp as a development dependency.
- **Rationale:** The bootstrap needs pure helper tests without a bundler or unnecessary test framework.
- **Consequences:** The project standard is Node 22+; later packets may propose additional tooling with evidence.

### DEC-005 — Bootstrap timezone

- **Date:** 2026-08-21
- **Packet:** CXP-00
- **Status:** Accepted for bootstrap; review in CXP-01
- **Decision:** Use `Etc/UTC` in the skeleton manifest.
- **Rationale:** The source record does not yet establish workbook timezone semantics; UTC is deterministic and does not invent a business locale.
- **Consequences:** CXP-01 must resolve operational date/interval timezone behavior before date-sensitive runtime logic is implemented.

## CXP-01 decisions

### DEC-006 — Evidence classification and no-inference gate

- **Date:** 2026-08-21
- **Packet:** CXP-01
- **Status:** Accepted
- **Decision:** Every workbook-contract field is classified as a project-record fact, inference, or unresolved workbook/source evidence. Project-record aggregate counts are not promoted to workbook-binary verification, and missing formula/header/lineage fields remain explicitly unresolved.
- **Rationale:** The exact legacy workbook is unavailable, while CXP-01 explicitly prohibits inventing formulas or metric semantics from names and summaries.
- **Consequences:** `config/workbook-contract.json` and `config/source-schema-draft.json` are blocked drafts. Later packets must not consume unresolved fields as implementation authority; CXP-01 reopens when the exact workbook and source samples are supplied.

### DEC-007 — Physical source packaging remains open

- **Date:** 2026-08-21
- **Packet:** CXP-01
- **Status:** Accepted as unresolved boundary
- **Decision:** Treat Handled, Offered, AHT - Raw, Auxes - Raw, and Staff as five confirmed logical datasets without selecting a physical file-bundle model.
- **Rationale:** The level-setting record names five source files/datasets and separately states “1 file per day”; meeting notes also describe different extract formats.
- **Consequences:** Adapter and schema work must support a packaging boundary. No later packet may assume five physical files, one workbook with five sheets, or one combined file until source evidence resolves the conflict.

### DEC-008 — Screenshot evidence is a separate verification class

- **Date:** 2026-08-21
- **Packet:** CXP-01
- **Status:** Accepted
- **Decision:** Record workbook UI facts visible in meeting-note images as screenshot-record evidence, separate from project-record summaries and workbook-binary verification.
- **Rationale:** The images expose useful tab labels, output headers, displayed filter/table captions, and one formula, but cannot establish the exact workbook identity, complete object inventory, formula fill families, or dependency graph.
- **Consequences:** Screenshot observations narrow the extraction target and may identify an output area, but they cannot close a binary-verification acceptance gate or authorize migration formulas.

### DEC-009 — SHA-bound catalogs are workbook-fact authorities

- **Date:** 2026-08-21
- **Packet:** CXP-01
- **Status:** Accepted; supersedes DEC-006's unavailable-workbook consequence
- **Decision:** Bind workbook-object, formula-family, metric-lineage, and cached-table-profile facts to the exact WB0809 SHA-256 and store each fact class in one machine-readable authority.
- **Rationale:** The supplied binary now permits complete read-only OOXML extraction. Separating objects, formulas, metrics, and source-table profiles prevents a human summary from becoming a competing authority.
- **Consequences:** Later packets may consume only the corresponding catalog for a workbook fact. Any replacement binary invalidates all four catalogs until the hash-bound extraction and tests are rerun.

### DEC-010 — Reconcile slicer and structured-reference counts by object semantics

- **Date:** 2026-08-21
- **Packet:** CXP-01
- **Status:** Accepted
- **Decision:** Record five slicer collection parts, 24 slicer controls, and 19 slicer caches as distinct counts; record 172,617 structured-reference cells, of which 172,521 use `#This Row`.
- **Rationale:** The earlier project record's values of five slicers and 172,521 structured references correspond to narrower package/formula concepts than the binary exposes.
- **Consequences:** Migration scope must reproduce required slicer behaviors rather than assuming five controls, and formula parity must include the 96 Staff structured references outside `#This Row`.

### DEC-011 — Cached workbook rows do not prove the external source contract

- **Date:** 2026-08-21
- **Packet:** CXP-01
- **Status:** Accepted
- **Decision:** Use cached table rows to verify workbook columns, calculated formulas, observed types, blanks, and error counts, while keeping physical delivery headers, packaging, keys, null/error semantics, and timezone unresolved until representative source files arrive.
- **Rationale:** Workbook tables contain historical data and pre-sized blank capacity, but the user explicitly stated that sample source files are not yet available.
- **Consequences:** `config/source-table-profile.json` is safe input for transformation design but not ingestion-adapter authority. CXP-03/CXP-05 and parity fixtures remain gated.

### DEC-012 — WB0809 and WB0816 are distinct evidence versions

- **Date:** 2026-08-21
- **Packet:** CXP-01
- **Status:** Accepted as unresolved boundary
- **Decision:** Treat all binary-derived formulas as WB0809 facts and all prior screenshots as WB0816 screenshot facts until the owner confirms the validation authority or supplies WB0816 for a diff.
- **Rationale:** The supplied filename and meeting-note title visibly identify different weekly versions, and at least one business formula may have changed between them.
- **Consequences:** Internal lineage is usable with a hash qualifier; final parity fixtures and CXP-01 completion require version confirmation.

### DEC-013 — WB0817 is the validation-control authority

- **Date:** 2026-08-22
- **Packet:** CXP-01
- **Status:** Accepted; resolves DEC-012 and rebinds DEC-009
- **Decision:** Use `MSG Intraday EOD 0817.xlsx` SHA-256 `CD8F8EC6F68FBEC85841CD64C251616FCECD0AD67DE4714EFB244F648548E65A` as the sole validation-control authority.
- **Rationale:** The user explicitly selected WB0817 because the available representative raw files are dated 0817.
- **Consequences:** Every workbook catalog is regenerated from WB0817. WB0809 and WB0816 evidence may explain version differences but cannot define target behavior.

### DEC-014 — Detect the representative XLS sources as HTML by signature

- **Date:** 2026-08-22
- **Packet:** CXP-01
- **Status:** Accepted
- **Decision:** Define the observed delivery format as one ISO-8859-1 HTML table per file, despite the `.xls` extension, and require byte-signature/content detection before parsing.
- **Rationale:** All five files start with HTML signature `3C686561643E3C4D`, not OLE/BIFF or ZIP bytes.
- **Consequences:** CXP-03/CXP-05 must implement a constrained HTML-table adapter and reject mismatched signatures, multiple tables, ragged rows, or header drift. Renaming the files does not convert their content.

### DEC-015 — Same-date partial snapshots are not EOD parity fixtures

- **Date:** 2026-08-22
- **Packet:** CXP-01
- **Status:** Accepted as blocking boundary
- **Decision:** Use the five files to verify physical packaging, headers, types, privacy classes, candidate keys, and mutable-field behavior, but not cell-for-cell WB0817 EOD parity.
- **Rationale:** Raw timestamps stop around 10:00–10:14 while WB0817 cached tables extend to about 21:54–23:18; row counts and mutable status/timing values differ.
- **Consequences:** Exact EOD exports or an approved intraday checkpoint strategy remain required before the parity criterion closes.

### DEC-016 — Source profiling excludes literal personal data

- **Date:** 2026-08-22
- **Packet:** CXP-01
- **Status:** Accepted
- **Decision:** Retain only source filenames, hashes, headers, aggregate type/null/error/date profiles, candidate-key counts, and reconciliation counts in repository artifacts.
- **Rationale:** The representative files contain direct names/emails and indirect record identifiers that are unnecessary for a durable migration contract.
- **Consequences:** Tests reject known literal-value leakage. Future ingestion logs and fixtures must use redacted or synthetic values unless separately authorized.

### DEC-017 — Use same-bundle intraday parity checkpoints

- **Date:** 2026-08-22
- **Packet:** CXP-01
- **Status:** Accepted; resolves DEC-015's blocking consequence
- **Decision:** Identify a checkpoint by one complete five-file RTA bundle, run ID, and acquisition timestamp. Load that identical normalized bundle into a fresh legacy copy and the migrated system, then compare all five tables and all 25 Interval View metrics for closed intervals.
- **Rationale:** The supplied partial-day files do not equal WB0817 EOD, but deterministic parity does not require EOD when both implementations consume the same source state.
- **Consequences:** WB0817 remains the formula/object/accepted-behavior authority rather than the row fixture. CXP-11 executes the approved checkpoint protocol and must not derive a checkpoint from per-row maximum timestamps.

### DEC-018 — Normalize time in America/Los_Angeles and floor left-edge intervals

- **Date:** 2026-08-22
- **Packet:** CXP-01
- **Status:** Accepted
- **Decision:** Parse the observed `M/d/yyyy h:mm AM/PM` and date-only formats strictly as `en-US` values in IANA zone `America/Los_Angeles`, applying tzdb DST rules. Reject both ambiguous fall-back timestamps and nonexistent spring-forward timestamps. WB0817's 2026-08-17 date uses PDT (`UTC−07:00`). Bucket timestamps to left-closed/right-open 30-minute intervals with `TIME(HOUR(timestamp),FLOOR(MINUTE(timestamp),30),0)`.
- **Rationale:** This reproduces the owner's confirmed legacy formula: minutes 00–29 map to `:00`, and 30–59 map to `:30`.
- **Consequences:** Ambiguous, nonexistent, or unrecognized timestamps fail validation; the implementation cannot treat the workbook's `PST` label as a fixed UTC−08:00 offset during daylight time.

### DEC-019 — Replace full exports with fail-closed keys, duplicates, blanks, and errors

- **Date:** 2026-08-22
- **Packet:** CXP-01
- **Status:** Accepted
- **Decision:** Require every ordered header and replace the complete five-file export on each hourly run. Use `Messaging Session Name` for Handled/Offered, `Agent Work ID` for AHT, and `User Presence ID` for Aux; Staff uses a canonical full-row hash because no stable business key was observed. Collapse exact row duplicates only; reject divergent rows sharing a key. Empty/whitespace cells normalize to null, key cells must be nonblank, no raw error token is accepted (any trimmed value beginning with `#` is rejected), and `NA` remains ordinary text.
- **Rationale:** The owner confirmed full-export copy/paste and delegated key/error-token policy. The chosen IDs are unique in the representative sources; Staff needs no upsert identity under full replacement.
- **Consequences:** CXP-03 owns the schema registry and CXP-05/CXP-06 must validate the complete bundle before atomically replacing prior raw state.

### DEC-020 — Preserve manual dependencies and intentional legacy behavior

- **Date:** 2026-08-22
- **Packet:** CXP-01
- **Status:** Accepted
- **Decision:** Treat Data B, D, F, M, R, and X as Staff-derived RTA paste inputs; treat Staff BE:BF as copied into Data; preserve the Aux Productive pivot as operational; classify the AHT divisor, Handled zero/blank split, Scheduled/Required error guard, broken names/references, and cached errors as intentional legacy behavior. Backlogs and Detail1 may be retired after a final automated dependency recheck because the current graph has no path to Interval View.
- **Rationale:** These owner decisions resolve the last manual, retention, and anomaly classifications without rewriting the verified legacy baseline.
- **Consequences:** Downstream transformations preserve the accepted anomalies until a separate change request authorizes correction. Retirement fails closed if any formula, pivot, slicer, name, manual process, or parity dependency is discovered.

### DEC-021 — Fixed PST replaces daylight-aware Pacific time

- **Date:** 2026-08-22
- **Packet:** CXP-01
- **Status:** Accepted; supersedes DEC-018's timezone semantics and resolves DEC-005's manifest review
- **Decision:** Interpret every RTA source and parity-checkpoint timestamp as fixed Pacific Standard Time (`PST`, `UTC−08:00`) with no daylight-saving adjustment. Use IANA/Java ZoneId `Etc/GMT+8` in the Apps Script manifest and runtime formatting. Preserve the existing strict `en-US` timestamp formats and left-closed/right-open 30-minute flooring rule.
- **Rationale:** RTA reconfirmed that its operational extracts use PST. A daylight-aware `America/Los_Angeles` interpretation would shift timestamps by one hour during daylight-saving months and contradict the source procedure.
- **Consequences:** Ambiguous fall-back and nonexistent spring-forward cases do not exist under the fixed offset. CXP-01 contract version advances to 1.0.1 / delivery `CXP-01-v2`; parity converts acquisition timestamps to fixed UTC−08:00 before determining closed intervals, and the script manifest changes from provisional UTC to `Etc/GMT+8`.

### DEC-022 — One target sheet catalog separates backend and report surfaces

- **Date:** 2026-08-22
- **Packet:** CXP-02
- **Status:** Accepted
- **Decision:** Make `src/config/SheetNames.js` the runtime authority for five staging, five raw, five calculation, three aggregation, and five user-facing target sheets plus seven control sheets. Backend names use `_STG_`, `_RAW_`, `_CALC_`, and `_AGG_` prefixes; report/support surfaces retain business-readable names.
- **Rationale:** A grouped authority prevents initializer drift and makes backend/report roles apparent without reproducing the legacy workbook's formula/pivot implementation.
- **Consequences:** Interval View, MOM, Teams Update, Aux Productive, and Allocation Export are created as user-facing placeholders. Backlogs and Detail1 remain retired; formulas, headers, and output formatting belong to later packets.

### DEC-023 — Initialization is ensure-only and non-destructive

- **Date:** 2026-08-22
- **Packet:** CXP-02
- **Status:** Accepted
- **Decision:** Set fixed PST, look up each required sheet by name, insert only missing sheets, and never clear, delete, rename, reorder, or write cell data during initialization. Preserve unrelated sheets and protections.
- **Rationale:** Rerunning initialization must be safe against an active weekly workbook and cannot assume that every pre-existing tab was created by this code.
- **Consequences:** CXP-02 can repair a partially initialized skeleton without destroying operational data. Schema/header initialization and raw replacement remain owned by later transactional packets.

### DEC-024 — CXP-owned protections restrict backend/control editing

- **Date:** 2026-08-22
- **Packet:** CXP-02
- **Status:** Accepted
- **Decision:** Reuse the single sheet-level protection when it carries the exact `CXP-02 managed protection: <sheet>` description; create it when absent, disable warning-only/domain editing, retain the effective user, remove other explicit editors and target audiences, and clear unprotected-range exceptions. Do not create CXP protections on report surfaces. If an existing required backend/control tab has a non-CXP sheet protection, preserve it and fail the two-workbook preflight before mutation rather than taking it over.
- **Rationale:** RTA report use must remain available while staging, raw, calculation, aggregation, and system records are guarded from ordinary edits.
- **Consequences:** An effective user with an email is a preflight requirement. Google permits one sheet-level protection, so an operator must resolve any non-CXP protection conflict before rerunning initialization. Production role/group rollout remains a later operational decision; owners retain Google-defined edit authority.

### DEC-025 — GMT exports require explicit fixed-PST normalization

- **Date:** 2026-08-22
- **Packet:** CXP-01 revision with CXP-02 runtime clarification
- **Status:** Accepted; supersedes DEC-021 only where DEC-021 interpreted source text as already fixed PST
- **Decision:** Interpret naive datetime values in the RTA export files as GMT/UTC (`Etc/UTC`) and preserve the raw UTC value. Convert source and acquisition datetimes by −480 minutes to the fixed-PST business zone (`Etc/GMT+8`) before deriving the business date or 30-minute interval. Preserve date-only `M/d/yyyy` values as calendar labels without timezone conversion. Keep the Apps Script manifest and target/control spreadsheets on fixed PST. Do not apply `America/Los_Angeles` DST rules.
- **Evidence:** The later RTA clarification states that extraction uses GMT. The attached Salesforce user-profile screenshot (SHA-256 `7258F584DB24D8B5F484DBE5AC00F2ED8445AB70ADBE9D5FF960703EA9DD7BD1`) shows `(GMT-07:00) Pacific Daylight Time (America/Los_Angeles)`, but that is a personal display setting and is not treated as export timestamp authority. Binary formula review finds five core source-to-interval families that floor raw hours without a timezone offset. `Teams Update!F8:F16` subtracts 15 hours, but that downstream report-support formula is not a GMT-to-PST converter feeding Interval View.
- **Rationale:** Treating GMT source text as already PST would place records and checkpoint boundaries eight hours late under the workbook's PST labels. The legacy control contains no verified core conversion, so repeating it would preserve a silent timestamp defect rather than the approved business semantics.
- **Consequences:** The migration classifies the missing converter as an approved defect correction. CXP-03/CXP-05 preserve UTC source values; CXP-07 through CXP-10 derive and bucket fixed-PST business timestamps; CXP-11 subtracts 480 minutes from legacy interval keys before parity comparison and records the unaligned eight-hour shift as approved expected variance. Contract version advances to 1.0.2 / delivery `CXP-01-v3`; CXP-02 workbook initialization remains on `Etc/GMT+8`.

## CXP-03 decisions

### DEC-026 — Canonical schemas are independent of input column position

- **Date:** 2026-08-23
- **Packet:** CXP-03
- **Status:** Accepted; supersedes DEC-019 only where “ordered header” required the incoming physical order
- **Decision:** Require exactly one instance of every active canonical header after trimming and explicit alias resolution, reject missing/extra/duplicate columns, and normalize valid reordered input into registry order before producing a `DatasetPayload`. Preserve case because AHT's `Speed To Answer` and `Speed to Answer` are distinct; only `Speed to Answer2` is an approved alias for multi-sheet workbook packaging.
- **Rationale:** CXP-03 explicitly requires valid header order changes not to break ingestion and requires downstream code to be isolated from source-column position. Exact-set validation prevents position independence from becoming permissive schema guessing.
- **Consequences:** `src/ingestion/SchemaRegistry.js` version `1.0.0` is the runtime authority. The CXP-01 observed order remains canonical for normalized records and later fingerprints. CXP-04 records the active version from run metadata; CXP-05 may implement either registered packaging contract without changing repository consumers.

## CXP-04 decisions

### DEC-027 — One template method owns every run transition and audit outcome

- **Date:** 2026-08-23
- **Packet:** CXP-04
- **Status:** Accepted
- **Decision:** Make `RunService.execute(request, operations, services)` the only supported run-orchestration entrypoint. It creates the run ID and `RECEIVED` event, invokes each injected operation in the registered order, normalizes failures, selects the category's terminal failure state, and persists the final run/error batch.
- **Rationale:** A caller-driven mutable session could skip a state, omit a failed-attempt record, or release ownership before logging metadata is complete. A template method fixes the lifecycle while leaving packet-specific work injectable.
- **Consequences:** CXP-05 and CXP-06 provide operation callbacks rather than mutating run state directly. Illegal, repeated, skipped, and post-terminal transitions fail with `INGESTION_ILLEGAL_STATE_TRANSITION`.

### DEC-028 — Hold the script lock from COMMITTING through health-check flush

- **Date:** 2026-08-23
- **Packet:** CXP-04
- **Status:** Accepted; implements ADR-005
- **Decision:** Perform file validation, parsing, schema validation, duplicate checks, staging, and stage validation before lock acquisition. Acquire the Apps Script script lock before entering `COMMITTING`, retain it through recalculation and health check, flush pending spreadsheet work, and release in `finally`; record `SUCCESS` only after release.
- **Rationale:** Staging work does not need to serialize production access, while commit and every post-commit validation observe one exclusive production-write boundary. Flush-before-release prevents the next writer from entering before buffered mutations are submitted.
- **Consequences:** Lock timeout is a retryable `FAILED_INGESTION` result and never includes a `COMMITTING` event. The adapter does not claim hosted scheduling fairness, exact timeout precision, or cross-script exclusion.

### DEC-029 — Audit logs use controlled headers and batched final records

- **Date:** 2026-08-23
- **Packet:** CXP-04
- **Status:** Accepted; implements ADR-008 for audit writes
- **Decision:** Make `RunLogger` and `ErrorLogger` the exact `RUN_LOG` and `ERROR_LOG` schema authorities. Initialize an empty header in one write, reject any nonempty header drift, and append each supplied record batch with one `setValues` call.
- **Rationale:** Stable column order is a downstream contract, and row-by-row service calls are both slower and easier to leave partially applied.
- **Consequences:** Every normally completed attempt persists one run row; failed attempts also persist one categorized error row. If the logging repository itself fails, the thrown reporting error carries the attempted records, but durable audit storage cannot be claimed.

## CXP-05 decisions

### DEC-030 — Preserve audited intake phases while retaining one deep adapter API

- **Date:** 2026-08-23
- **Packet:** CXP-05
- **Status:** Accepted
- **Decision:** Expose `InputAdapter.validateFile`, `parse`, `validateSchema`, and `checkDuplicate` in the exact CXP-04 order, plus `createOperations()` as the supported `RunService` bridge and `read()` as the deep non-orchestrated API. The bridge retains active raw state inside its closure and returns only sanitized source metadata, a packaging summary, normalized payloads, and the duplicate-check result.
- **Rationale:** One opaque file routine would make the state history claim a phase that had already been crossed internally and could expose blobs/bytes through `operationResults`. Explicit callbacks preserve auditable state semantics while centralizing the adapter logic.
- **Consequences:** CXP-06 combines the four returned callbacks with its five transactional callbacks. Unsupported content fails during `VALIDATING_FILE`; conversion/parsing occurs in `PARSING`; payload creation occurs in `VALIDATING_SCHEMA`; ledger access occurs in `CHECKING_DUPLICATE` before staging.

### DEC-031 — Fingerprint original bytes and make XLSX conversion ephemeral

- **Date:** 2026-08-23
- **Packet:** CXP-05
- **Status:** Accepted; implements ADR-006
- **Decision:** SHA-256 hash each original Drive blob before parsing or conversion. Use that hash directly for a one-file workbook and hash the dataset-name-sorted content-hash composite for five-file packaging. Convert XLSX to a temporary Google Sheets file, reject all formulas after separate values/formulas reads, and permanently remove the temporary file on every success/failure path.
- **Rationale:** Original-byte identity blocks renamed re-uploads without coupling duplicate behavior to converter output. Ephemeral conversion supports values-only ingestion without retaining a historical raw copy or allowing formula text downstream.
- **Consequences:** A prior successful fingerprint produces a metadata-only `DUPLICATE` ledger row correlated to the original successful run. A `SUCCESS` ledger row belongs only after CXP-06 commit/health check. Cleanup failure is retryable and takes precedence over an earlier conversion error so leaked temporary artifacts cannot be hidden.

## CXP-06 decisions

### DEC-032 — Use hidden run-scoped same-workbook backups

- **Date:** 2026-08-23
- **Packet:** CXP-06
- **Status:** Accepted; elaborates ADR-004 and ADR-012
- **Decision:** Copy each of the five values-only raw sheets to a controlled `_CXP06_BAK_<TOKEN>_<runId>` sheet before any raw mutation. Explicitly rename, hide, protect, and compare each copy; do not rely on copied protection behavior.
- **Rationale:** Backups stored only in memory cannot survive abrupt Apps Script termination. Same-workbook copies remain discoverable by the next locked run and avoid downloading source rows into logs or repository artifacts.
- **Consequences:** Incomplete groups are safe to delete because raw mutation begins only after all five verified copies exist. Complete unfinished groups restore all five raw sheets; groups correlated to a SUCCESS ledger row are cleanup debt and never overwrite committed raw.

### DEC-033 — Keep CXP-04 as the sole transaction orchestrator and lock owner

- **Date:** 2026-08-23
- **Packet:** CXP-06
- **Status:** Accepted; elaborates ADR-005
- **Decision:** Compose the four CXP-05 callbacks with the five callbacks returned by `CommitService.createOperations`. Stage and validate outside the lock; perform recovery, duplicate recheck, backup, replacement, flush, health validation, SUCCESS confirmation, and cleanup inside the existing CXP-04 lock.
- **Rationale:** A second state machine or nested lock would create competing lifecycle authority. Repository-coordinated callbacks preserve the audited run history and make the in-lock duplicate check and rollback boundary observable.
- **Consequences:** CXP-06 never calls LockService directly. A healthy commit is authoritative only after the SUCCESS ledger row is written and read-confirmed. A failed or empty run-ID confirmation gets one bounded fingerprint lookup and is accepted only when both identifiers match the current run. Cleanup failure after confirmation returns PENDING without rolling healthy data back.

### DEC-034 — Treat two-phase replacement as recoverable, not atomic

- **Date:** 2026-08-23
- **Packet:** CXP-06
- **Status:** Accepted
- **Decision:** Describe flush, backup, health readback, and rollback as an application recovery protocol. Do not claim atomic multi-sheet reader visibility, a platform transaction, or durability beyond documented Google Sheets behavior.
- **Rationale:** Official Apps Script references document copying, values/formula access, protection, deletion, and applying pending changes, but not multi-sheet transaction isolation or rollback.
- **Consequences:** Local peak tests prove constant bulk-call shape only. Hosted DEV/UAT peak execution, fault injection, quota timing, abrupt-run recovery, and reader observation remain a promotion gate.
