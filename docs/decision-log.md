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

### DEC-037 — Start CXP-06 commit in a fresh resumable invocation

- **Date:** 2026-08-25
- **Packet:** CXP-06
- **Status:** Accepted
- **Decision:** Preserve synchronous `RunService.execute()` for bounded callers, but route hosted CXP-06 scenarios through preparation and continuation phases. Persist only request/state/fingerprint/source metadata; keep normalized records in protected staging. Reconstruct and revalidate staging before the continuation enters the existing transaction lock.
- **Rationale:** A declared-volume hosted run reached `commit` after 111.6 seconds and exhausted the six-minute limit before commit completed. Starting the locked tail in a fresh invocation gives recovery, backup, raw replacement, flush, and health verification their own runtime allowance without weakening transaction boundaries.
- **Consequences:** Hosted entrypoints return `COMMIT_PENDING`, then `continueCxp06UatPipeline()` completes the logical run. Script Properties, deduplicated one-shot triggers, and a delayed watchdog preserve progress. The design intentionally does not checkpoint mid-replacement; an individual commit invocation that still exceeds the platform limit remains a hosted blocker requiring a durable per-dataset journal.

### DEC-038 — Journal CXP-06 backups one dataset per invocation

- **Date:** 2026-08-25
- **Packet:** CXP-06
- **Status:** Accepted; supersedes DEC-037's monolithic hosted backup boundary
- **Decision:** Preserve the synchronous five-backup transaction for bounded callers, but make hosted CXP-06 create and verify at most one missing run-scoped backup dataset per locked continuation. Treat the named backup sheets as the durable journal. Schedule final raw replacement only after all five copies are complete, then adopt and revalidate that exact group instead of copying it again.
- **Rationale:** The fresh hosted commit still reached Apps Script's six-minute limit after entering `commit` with about 323 seconds remaining. Five full-sheet copy/protection/verification operations remained coupled to raw replacement and finalization, so merely moving commit to a fresh invocation did not bound runtime.
- **Consequences:** Hosted status progresses through `BACKUP_PENDING`, `BACKING_UP`, `COMMIT_PENDING`, `COMMITTING`, and `COMPLETE`. A timeout during backup discovery resumes from run-scoped sheets without raw mutation or SUCCESS. Final raw replacement remains one recoverable logical tail and must still pass hosted timing evidence.

### DEC-039 — Flush validated staging before checkpoint publication

- **Date:** 2026-08-25
- **Packet:** CXP-06
- **Status:** Accepted
- **Decision:** Require resumable `RunService.prepare()` callers to supply a flush service. After `validateStage` succeeds, apply pending spreadsheet writes and emit `flushStage` completion telemetry before constructing or publishing the cross-invocation checkpoint.
- **Rationale:** Hosted preparation could validate staging from the current execution context while the next backup invocation reread a header-only dataset and failed with `row_count_mismatch`. A checkpoint cannot claim a durable stage boundary until pending writes are explicitly applied.
- **Consequences:** Flush failure is audited from `VALIDATING_STAGE` and no checkpoint is returned. Hosted operators must see `flushStage COMPLETED` before treating `BACKUP_PENDING` as resumable evidence.

### DEC-040 — Schedule CXP-06 safety continuation at 4 minutes 30 seconds

- **Date:** 2026-08-25
- **Packet:** CXP-06
- **Status:** Accepted; authoritative owner decision
- **Decision:** Before every hosted preparation, backup, and commit phase, create a one-time `continueCxp06UatPipeline()` trigger with a 270,000 ms delay. Remove or replace it when the phase reaches a durable checkpoint or terminal state. If the safety invocation observes that the original phase is still within its known six-minute execution window, defer re-entry until 6 minutes 15 seconds after the phase began.
- **Rationale:** The previous seven-minute watchdog could only run after Apps Script had already terminated a six-minute invocation. The 4-minute-30-second boundary guarantees that continuation recovery is queued before the hard timeout, while the settle guard prevents the earlier trigger from executing the same phase concurrently.
- **Consequences:** A hard timeout leaves durable state and a queued one-time recovery path. The pipeline still does not raise or disable the Apps Script quota, and hosted evidence must confirm trigger authorization, continuation delivery, and idempotent recovery.

### DEC-041 — Self-resume CXP-06 raw replacement from a durable dataset cursor

- **Date:** 2026-08-25
- **Packet:** CXP-06
- **Status:** Accepted; authoritative owner decision
- **Decision:** Extend DEC-040 with cooperative yielding. Process raw replacements in registered dataset order, one bulk dataset write per cursor step. Persist `commitProgress` after every successful step. Once the current invocation reaches 270,000 ms, deduplicate `continueCxp06UatPipeline` triggers, create one time-driven continuation for 60,000 ms later, and return normally. Run recalculation, health validation, SUCCESS confirmation, and cleanup in a fresh invocation only after all five raw steps are durable.
- **Rationale:** A pre-scheduled watchdog provides recovery after termination but does not stop a monolithic commit from consuming the six-minute quota. A durable cursor and elapsed-time gate let the running invocation exit before the limit and retry only the last unconfirmed dataset after an abrupt interruption.
- **Consequences:** Script Properties contain bounded metadata only; row data remains in protected staging and backup sheets. Trigger cleanup keeps at most one CXP-06 continuation installed. Each dataset still uses bulk range operations, and rollback retains the complete pre-commit backup group across invocations. Hosted UAT must prove multi-invocation completion and rollback from an interrupted cursor.

### DEC-042 — Preserve successor-trigger continuity at every nonterminal handoff

- **Date:** 2026-08-25
- **Packet:** CXP-06
- **Status:** Accepted; authoritative owner decision
- **Decision:** Replace a CXP-06 continuation trigger by creating the successor first, identifying it by `getUniqueId()`, and only then deleting older `continueCxp06UatPipeline` triggers. Never delete the last recovery path before its replacement exists. When the same main scenario is rerun against an active nonterminal checkpoint with no actual trigger, install one 60-second recovery trigger and retain the existing checkpoint.
- **Rationale:** Hosted evidence showed `BACKUP_PENDING` and a durable completed Handled backup with `continuationScheduled:false`. The prior delete-then-create ordering exposed a zero-trigger interruption window after checkpoint publication, while the active-state main entrypoint reported a continuation without verifying one existed.
- **Consequences:** Every nonterminal phase normally leaves exactly one successor trigger; an interruption during cleanup may temporarily leave more than one, which the next idempotent invocation deduplicates. Operators can repair a stranded state by rerunning the same main scenario once after deploying the revision.

### DEC-043 — Log every continuation result and restart commit safely after rollback failure

- **Date:** 2026-08-25
- **Packet:** CXP-06
- **Status:** Accepted
- **Decision:** Emit a bounded `CXP06_PIPELINE_START` or `CXP06_PIPELINE_CONTINUE` record from every hosted entrypoint invocation. Persist an allowlisted `lastErrorDetails` object with failed continuation state. When retrying `MIGRATION_ROLLBACK_FAILED`, retain the complete backup group but clear `commitProgress` and restart raw replacement from dataset index 0.
- **Rationale:** Hosted start/continue functions returned after approximately two seconds without logging their returned state, and rollback failure status discarded the original bounded diagnostic fields. Resuming at the prior cursor after a failed rollback is unsafe because one or more earlier datasets may already have been restored.
- **Consequences:** Execution logs now distinguish scheduling, progress, and completion without exposing rows or cell values. A rollback-failure retry deterministically rewrites all staged datasets while the original backup group remains available for another rollback attempt.

### DEC-044 — Reserve measured step time and keep the CXP-06 watchdog outside the execution window

- **Date:** 2026-08-26
- **Packet:** CXP-06
- **Status:** Accepted; authoritative owner decision. Supersedes DEC-040's 270,000 ms watchdog delay and DEC-041's elapsed-time yield gate; DEC-042 and DEC-043 remain unchanged.
- **Decision:**
  1. Arm every hosted preparation, backup, and commit watchdog at 420,000 ms so it cannot fire inside the six-minute window of the invocation it guards.
  2. Keep `COMMITTING` as the persisted status for the entire commit loop and anchor `updatedAtUtc` at phase entry. Publish per-dataset progress through `commitProgress`, `lastCompletedCommitDataset`, `maxCommitStepMs`, and a separate `heartbeatAtUtc` that does not move the settle window.
  3. Before entering another dataset step, require elapsed time plus the largest measured step duration plus a 45,000 ms margin to remain within a 330,000 ms commit budget. Always perform at least one step per invocation so progress is guaranteed.
  4. Treat `INGESTION_LOCK_TIMEOUT` as contention rather than failure: retain the resumable pending status and bounded details, and schedule one continuation 90,000 ms later instead of deleting triggers and recording `FAILED`.
- **Evidence:** A hosted `CASE1_PEAK_SUCCESS` run reported `status: FAILED`, `lastErrorCode: INGESTION_LOCK_TIMEOUT`, `lastErrorDetails: {"timeoutMs":30000}`, `continuationScheduled: false`, `lastCompletedBackupDataset: Staff`, and `lastCompletedCommitDataset: Handled` at 2026-08-25T16:12:23Z. The 270,000 ms watchdog fired while the commit loop was inside its second dataset; because the loop published `COMMIT_PENDING` between datasets, the settle guard did not defer, the watchdog competed for the production lock, timed out after 30,000 ms, and terminated a healthy run with one of five raw datasets replaced.
- **Rationale:** DEC-040 treated a post-termination watchdog as a defect, but the trigger is created at phase entry, so recovery is queued before the hard timeout regardless of its delay. Firing inside the window only adds a competing writer. DEC-041's gate was evaluated after a dataset finished, so a step beginning just under 270,000 ms still ran past the platform cutoff; reserving the measured step duration bounds the invocation before the work starts.
- **Consequences:** A hard timeout mid-loop is recovered by the 420,000 ms watchdog roughly one minute after termination instead of at the 6-minute-15-second settle boundary; that latency is accepted in exchange for removing the concurrent-writer path. Commit invocations complete as many datasets as their measured step cost allows rather than a fixed count. Contention is now observable as a nonterminal status carrying `lastErrorCode`, so operators must read `status`, not the presence of an error code, to judge whether a run stopped. Hosted UAT must still prove multi-invocation completion, interrupted-cursor rollback, and that no invocation exceeds the platform limit.

### DEC-045 — Verify only unreplaced datasets during incremental commit

- **Date:** 2026-08-26
- **Packet:** CXP-06
- **Status:** Accepted
- **Decision:** `BackupRepository.verifyGroup(group, { compareDatasetNames })` still requires a complete readable five-sheet group. Incremental `commitStep` compares only datasets at or after `nextDatasetIndex` against current raw. After all five replacements, final `commit` confirms group completeness without comparing any backup to current raw. A FAILED retry whose `lastErrorDetails.rollbackStatus` is `VERIFIED` clears `backupRunId` and `commitProgress` and recreates backups, because verified rollback deletes the group after restoring pre-run raw.
- **Evidence:** Hosted `CASE1_PEAK_SUCCESS` at 2026-08-25T17:29:16Z reported `MIGRATION_COMMIT_FAILED` wrapping `MIGRATION_BACKUP_FAILED` with `rollbackStatus: VERIFIED` after `lastCompletedCommitDataset: Handled`. `commitStep` had called full `verifyGroup`, so the Handled backup no longer matched the newly written raw Handled sheet.
- **Rationale:** Local cursor tests seeded raw with the same payload being committed, so a full compare still passed after the first replacement. Hosted previous-cycle data diverges on the first write. Backups must remain a pre-run snapshot for rollback, not a mirror of in-progress raw.
- **Consequences:** Partial raw replacement is a valid in-flight state. Operators judging FAILED + VERIFIED must expect last-known-good raw and no `_CXP06_BAK_*` sheets. After deploying this revision, rerun the same Case 1 entrypoint once; it recreates backups from restored raw and commits all five datasets.

### DEC-046 — One commit dataset per hosted invocation at a 4:45 budget

- **Date:** 2026-08-26
- **Packet:** CXP-06
- **Status:** Accepted; authoritative owner decision. Supersedes DEC-044's 330,000 ms packing loop and DEC-041's elapsed-time gate for hosted commit.
- **Decision:** Each hosted commit invocation performs at most one `commitStep` (or the final health/SUCCESS tail), persists the cursor, and schedules `continueCxp06UatPipeline()` 60,000 ms later. The intended wall-clock budget per invocation is 285,000 ms (4 minutes 45 seconds), leaving more than a minute before Apps Script's six-minute limit. If a timeout still writes a dataset without persisting the cursor, the next `commitStep` adopts that dataset when current raw already matches the staged payload and only backup-compares datasets that have not yet been replaced.
- **Evidence:** A hosted continuation at 2026-08-25T17:59:47Z ran 360.304 seconds and timed out. A overlapping continuation at 2026-08-25T18:03:56Z then failed with `MIGRATION_COMMIT_FAILED` wrapping `MIGRATION_BACKUP_FAILED` after `lastCompletedCommitDataset: Offered`. Completed sibling invocations of 243s, 80s, and 29s show dataset writes are not uniform; packing a later peak-sized write after faster datasets exhausts the six-minute limit. The 4:09 overlap matches a 270-second watchdog firing into a still-running commit.
- **Rationale:** Peak declared volumes take about four minutes per raw replacement. A 4:45 packing loop that uses the previous step's duration as the next-step estimate will start AHT after faster Handled/Offered writes and then hit the platform cutoff. One dataset per invocation keeps each run inside 4:45 for the observed peak cost and releases the production lock before the next continuation.
- **Consequences:** Case 1 commit takes five continuations plus one finalization. Operators should see `lastCompletedCommitDataset` advance by one name per `CXP06_PIPELINE_CONTINUE`. A FAILED + VERIFIED record after this revision still means raw was restored and backups were deleted; rerun the same Case 1 entrypoint once after clasp push.

### DEC-047 — Dataset-scoped adaptive CXP-06 workers

- **Date:** 2026-08-26
- **Packet:** CXP-06
- **Status:** Accepted. Supersedes DEC-046's fixed one-dataset-per-invocation rule and DEC-044's 330,000 ms packing budget; their recovery and rollback findings remain applicable.
- **Decision:** Preparation records the registered dataset order once. Backup resume reconstructs only backup metadata; each backup cursor step reads and verifies one named raw/backup pair. Each commit cursor step reconstructs and validates one named staged dataset, verifies its named backup, replaces and rereads only its mapped raw sheet, and persists progress. Backup and commit may pack another step only when elapsed time plus the larger of the measured maximum step and a 60,000 ms cold-start reserve, plus a 15,000 ms handoff margin, remains within a 270,000 ms cooperative budget. Otherwise they schedule one continuation and exit normally. Final full health/audit/SUCCESS processing remains a separate `RunService.resume()` tail after all dataset writes are durable.
- **Evidence:** The prior hosted execution set contained two 360-second timeouts and a later 212-second failed continuation. The observed run window totaled approximately 38 minutes 33 seconds, of which about 13 minutes 49 seconds was scheduler wait. Code review found that each commit continuation rebuilt and validated all five staging datasets and that the fixed one-dataset rule imposed a one-minute wait even when substantial execution budget remained.
- **Rationale:** A continuation mechanism prevents total loss of progress but does not itself provide acceptable hourly latency. Removing unrelated workbook reads lowers each step's service-call cost; measured packing consumes safe headroom without assuming that different dataset sizes have equal duration. The 4-minute-30-second cooperative boundary leaves 90 seconds for checkpointing, trigger handoff, and platform variance.
- **Consequences:** Hosted continuation count is workload-dependent rather than fixed at eleven or more invocations. Operators use bounded `CXP06_WORKER_STEP` records to distinguish `PACK_NEXT`, `HANDOFF`, and `PHASE_COMPLETE`. The 420,000 ms trigger remains recovery-only and is not an execution deadline. Existing rollback semantics are preserved. Local tests prove access scope and scheduling decisions, but DEV/UAT must still prove that no invocation reaches 360 seconds and that scheduler wait and end-to-end latency improve at peak volume.

### DEC-048 — Version and render the CXP-10 control-derived report surface

- **Date:** 2026-08-30
- **Packet:** CXP-10
- **Status:** Accepted for implementation; hosted UAT pending
- **Decision:** Bind Interval View v2 to `MSG Intraday EOD 0817.xlsx` SHA-256 `CD8F8EC6F68FBEC85841CD64C251616FCECD0AD67DE4714EFB244F648548E65A`. Separate the 25-metric formula catalog from a declarative presentation renderer, own only `B97:AB151`, preserve `AA2` and MOM manual inputs, and store installation progress under `CXP10_REPORTING_INSTALL_STATE_V2`.
- **Evidence:** The control uses headers at `B112:AB112`, 38 half-hours at `C113:C150` from 04:00 through 22:30, totals at row 151, verified merged title/legend/section blocks, hidden Remarks column, report number formats, and conditional formats. The former implementation intentionally rendered `A16:Z65`, used a midnight axis and visible helper columns, omitted report chrome and many totals, and its tests asserted only self-authored formulas/values.
- **Rationale:** Reverse engineering must yield an explicit, testable surface contract; metric correctness alone cannot establish operational report fidelity. A versioned renderer permits layout changes without coupling them to aggregation logic or replaying an old checkpoint into new coordinates.
- **Consequences:** CXP-09 now exposes per-metric counts as additive sufficient statistics and CXP-10 calculates weighted all-site timing values. Local acceptance includes an independent JSON oracle, exact-axis and formula-error diagnostics, complete totals, and on-axis parity. Promotion remains blocked until the hosted v2 CXP-09/CXP-10 install, recalculation, parity gate, and visual comparison pass.

### DEC-049 — Coalesce allowlisted spreadsheet error tokens at ingestion

- **Date:** 2026-08-30
- **Packet:** CXP-05 / ingestion
- **Status:** Accepted; supersedes DEC-018 only for the eight recognized spreadsheet error tokens
- **Decision:** Before exact-row deduplication and schema type coercion, convert case-insensitive exact matches for `#N/A`, `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, `#NUM!`, `#NULL!`, and `#ERROR!` to `null`. Preserve fail-closed behavior for unknown `#...` strings and for direct callers that bypass the ingestion adapter. A token in an authoritative key becomes null and fails `DATASET_MISSING_KEY`. Attach only an aggregate `errorTokensCoalesced` count to payload source metadata.
- **Rationale:** Formula/export artifacts in optional source cells should not reject an otherwise usable full bundle, but silently inventing typed defaults or weakening record keys would corrupt data integrity. Applying the fallback before deduplication makes token-versus-blank duplicates deterministic.
- **Consequences:** Both single-dataset and multi-sheet workbook paths share one fallback layer. Downstream raw sheets receive blanks through the existing null codec. Operators can observe fallback volume without exposing token locations or source values. Rollback is a code revert; no stored-data migration is required.

### DEC-050 — Assign the forecast aggregation spill to one phase

- **Date:** 2026-08-30
- **Packet:** CXP-09 / CXP-10
- **Status:** Accepted and implemented
- **Decision:** CXP-10 exclusively owns `_AGG_FORECAST!A2` and its MOM unpivot spill. CXP-09 owns the header schema and may clear A2 only when it exactly matches the retired self-query. CXP-09 preserves any CXP-10 bridge or operator data and uses `CXP09_AGGREGATION_INSTALL_STATE_V3`.
- **Evidence:** The retired formula `=QUERY(A2:E51,...)` was written at A2, placing its anchor inside its own source and producing `#REF! Circular dependency detected`. CXP-10 already installs the independent MOM-based bridge at the same anchor.
- **Rationale:** A spill anchor cannot also be its source, and phase installers must not compete for the same cell. Exact-match cleanup migrates affected workbooks without allowing a later CXP-09 reinstall to erase the valid CXP-10 bridge.
- **Consequences:** CXP-09 installs 13 aggregation formula anchors in 23 bounded steps. An empty MOM calendar yields a blank forecast bridge through `IFNA`, not a visible `#N/A`. Rollback is to restore the prior catalog and V2 state key; affected sheets would then require manual replacement of the circular formula.

### DEC-051 — Validate and own workbook business context at one boundary

- **Date:** 2026-08-31
- **Packet:** CXP-08 / CXP-10
- **Status:** Accepted and implemented
- **Decision:** Treat `businessDay` as the canonical date input, derive its Monday `weekStart`, and default `staffDay` to `businessDay` with an explicit validated override. `BusinessContextService` validates the complete context before writing `Interval View!AA2`, `MOM!B3`, and `_CALC_STAFF!BE1`, and restores prior values best-effort after a partial write failure. Preserve the control routing contract through a versioned configuration: `CNX-Que`/`CNX-CR1` for buckets 00:00–03:30 and `INT-Que`/`INT-LAS` for 04:00–23:30.
- **Rationale:** Independent, unvalidated anchor writes allowed invalid dates to become `#NUM!` and cascade through hundreds of report cells. Hardcoded Staff routing also let fixtures exercise a site outside the rule selected for its interval without testing the zero summaries that resulted.
- **Rejected alternatives:** Do not infer dates from partial raw timestamps, keep independent manual anchor writers, or add environment-specific routing profiles. Those options introduce ambiguous cross-midnight behavior or unnecessary operational variance.
- **Consequences:** CXP-08 uses installer state V2 and bounded clears that preserve `BE1`. CXP-08 parity now covers row overlaps and early/late Staff summaries. CXP-10 promotion validates anchors first, returns one `BUSINESS_CONTEXT_ANCHOR_INVALID` root error, and skips parity/formula-error enumeration when context is invalid. Rollback is a code revert plus restoration of the three snapshotted anchors; no raw-data migration is required.

### DEC-052 — Match report intervals by canonical minute bucket and preserve observed zeros

- **Date:** 2026-08-31
- **Packet:** CXP-09 / CXP-10
- **Status:** Accepted, implemented, and hosted-verified
- **Decision:** Compare aggregation and report intervals by rounded integer minute-of-day inside bounded ranges rather than exact spreadsheet time-fraction equality. Preserve a numeric zero when an aggregation row and denominator exist; return blank only when the grain is absent. Keep the allocation numerator contracted to BPO `INT` and align the shared hosted fixture accordingly.
- **Evidence:** The hosted `_AGG_INTERVAL` 04:00 value was `0.16666666666787933`, while the report formula derived `0.16666666666666666`; exact `SUMIFS` equality returned blanks despite a present LAS row. After minute-bucket matching, only `Chats in SL` and `SL (Time To Connect)` differed because legitimate zeros were blanked. The final August 31 DEV execution completed 139/139 steps, reported zero formula errors, and passed on-axis parity with zero differences across 38 rows.
- **Rationale:** Spreadsheet date/time serials are floating-point values and equivalent half-hour labels are not guaranteed to have bit-identical fractions after QUERY and timezone arithmetic. Row presence and numeric zero have different reporting meaning and must not be conflated.
- **Consequences:** CXP-10 uses bounded `SUMPRODUCT` minute comparisons for interval, weighted, and allocation metrics. Hosted parity normalizes duration displays and reports fixture-context drift as one bounded skipped result. CXP-10-v2 is complete in DEV; CXP-08 V2 and the dedicated CXP-09 promotion gate remain separate packet requirements.

### DEC-053 — Evaluate Staff overlaps row by row and close CXP-08 V2

- **Date:** 2026-08-31
- **Packet:** CXP-08
- **Status:** Accepted, implemented, and hosted-verified
- **Decision:** Clip each Staff record independently to each half-hour bucket with element-wise comparisons. Do not use scalar `MIN()` or `MAX()` reductions inside an `ARRAYFORMULA`. Before promotion parity, reject raw row counts that identify the Step 06 refresh bundle with one bounded `FIXTURE_STATE_MISMATCH` result.
- **Evidence:** With the correct 3/2/2 parity fixture loaded, AHT and Auxes passed while both Staff rows and all four routed summaries remained zero. The installed formula used `MIN(end,bucketEnd)-MAX(start,bucketStart)`, which Google Sheets reduced across the input arrays. After element-wise clipping and reinstall, the hosted 74/74 run reported zero AHT, Auxes, Staff, and Staff-summary differences and `CXP08UatStep08 pass: true`.
- **Rationale:** Staff overlap is a row-grain calculation. Aggregate extrema silently mix independent Staff records and destroy both overlap and routing evidence. Fixture lifecycle drift is a root-state error, not dozens of metric discrepancies.
- **Consequences:** CXP-08-v2 is complete in DEV. `_CALC_STAFF!BE1` remains reinstall-safe, early CNX and late INT routing are hosted-verified, and CXP-11 is now gated only by completion of CXP-09.

## CXP-11 decisions

### DEC-054 — Compare a contracted legacy export bundle, not the live Excel workbook

- **Date:** 2026-08-31
- **Packet:** CXP-11
- **Status:** Accepted, implemented, and hosted-verified
- **Decision:** Define a versioned legacy-export contract (`manifest.json`, five canonical wide source CSVs, one long-form metric CSV, one legacy-error CSV) that the operator produces from a freshly recalculated legacy control, and validate it — contract version, WB0817 hash, ISO UTC acquisition timestamp, per-file SHA-256, ordered headers, row counts, authoritative keys, and duplicate policy — before any comparison runs. CXP-11 does not automate Excel.
- **Rationale:** The partial-day raw deliveries are not WB0817 EOD fixtures, and no Apps Script boundary can drive Excel recalculation. A hash-bound file contract makes the legacy side reproducible, auditable, and comparable without an Excel dependency, and it lets the entire comparison core stay pure and injected.
- **Consequences:** Every parity run requires an operator-supplied bundle whose `sourceBundleFingerprint` matches a successful `FILE_LEDGER` entry. Export files and source rows stay outside the repository; only synthetic fixtures are committed. `CXP_<ENV>_LEGACY_PARITY_EXPORT_FOLDER_ID` becomes an optional configuration key that fails closed rather than scanning Drive.

### DEC-055 — Bind source identity for the whole run and fail closed on re-ingestion

- **Date:** 2026-08-31
- **Packet:** CXP-11
- **Status:** Accepted, implemented, and hosted-verified
- **Decision:** At preflight, record both the export manifest fingerprint and the `FILE_LEDGER` ingestion run ID for the matched source-bundle fingerprint. Recheck both before every continuation and again at finalization, and fail with `PARITY_TARGET_SNAPSHOT_CHANGED` if either changes.
- **Rationale:** A parity run spans multiple Apps Script executions. Without a bound identity, an ingestion that replaces the target mid-run — or a regenerated export — would produce a signed-off result over mixed inputs, which is worse than no result.
- **Consequences:** Long runs are safe to resume but cannot outlive their inputs. A replaced snapshot requires a deliberate reset and restart rather than a silent continuation.

### DEC-056 — Classify only the DEC-025 key shift as approved variance

- **Date:** 2026-08-31
- **Packet:** CXP-11
- **Status:** Accepted, implemented, and hosted-verified
- **Decision:** Shift every legacy interval key by −480 minutes into fixed PST before matching migrated keys, compare only intervals whose right boundary is at or before the fixed-PST acquisition checkpoint, and classify a mismatch as `APPROVED_EXPECTED_VARIANCE` **only** when the same legacy value matches the migrated value at the unshifted key. Every other difference is a defect.
- **Rationale:** DEC-025 is the sole approved rule correction against legacy hour flooring. Encoding the variance as a positional test — rather than a per-metric allowance — keeps the exception narrow and machine-checkable, so no real defect can hide behind the timezone story.
- **Consequences:** Approved variance is auditable per comparison through its `DEC-025` lineage reference. Blank, single-space, zero, and error tokens remain distinct sentinels, so blank-versus-zero and blank-versus-error can never be absorbed as variance.

### DEC-057 — Seed the WB0817 baseline as bounded evidence-backed rules

- **Date:** 2026-08-31
- **Packet:** CXP-11
- **Status:** Accepted, implemented, and hosted-verified
- **Decision:** Seed `SOURCE_ERROR_BASELINE` with six rules totalling exactly 1,885 WB0817 cached errors — two Offered formula-family ranges at 919 `#N/A` each, plus worksheet-scope counts of 13 and 8 `#REF!` and 20 and 6 `#DIV/0!`. Where the repository evidence is per-sheet rather than per-cell, keep the record a bounded worksheet-scope count and never fabricate cell locations. Reconcile observed legacy errors per worksheet-and-token key and assert the 1,885 total.
- **Rationale:** `config/formula-family-catalog.json` provides per-sheet and, for Offered, per-family cached-error evidence. Inventing 47 individual non-`#N/A` cell references to reach a tidier schema would create unverifiable audit records.
- **Consequences:** Baseline drift is detected by both total and error type. The superseded WB0809 count of 5,655 is asserted nowhere in code, tests, or evidence, and a `#N/A` observed in a source-table comparison classifies as `EXPECTED_SOURCE_ERROR` against the baseline rather than as a migration defect.

### DEC-058 — Separate the setup and run state machines and make chunk writes retry-safe

- **Date:** 2026-08-31
- **Packet:** CXP-11
- **Status:** Accepted, implemented, and hosted-verified
- **Decision:** Keep two independent versioned state machines — setup (`IDLE`/`RUNNING`/`COMPLETE`/`FAILED`) and run (`PREFLIGHT`/`SOURCE_TABLES`/`METRICS`/`ERROR_CLASSIFICATION`/`SUMMARIZING`/`COMPLETE`/`FAILED`) — sharing the script lock but never the cursor. Derive chunk IDs deterministically from phase, dataset, and offset so the results repository can reject a replayed chunk. Persist source-table comparisons as dataset, field, hashed record identity, and hashed value digests only.
- **Rationale:** Installing control schemas and running a multi-hour comparison have different failure modes and different reset semantics; one shared cursor would make a partial schema indistinguishable from an interrupted comparison. Deterministic chunk IDs remove the need for a distributed transaction between the write and the cursor update, and hashing keeps PII out of the control workbook.
- **Consequences:** Each invocation processes one bounded batch inside a four-minute budget and schedules exactly one continuation. A chunk written just before an interrupted cursor update is detected on retry and not appended twice. Resetting or retargeting an active run or setup is refused unless the operator forces it.

### DEC-059 — Canonicalize source-table dates to CXP-03 contract strings at comparison time

- **Date:** 2026-09-01
- **Packet:** CXP-11
- **Status:** Accepted, implemented, and hosted-verified
- **Decision:** Before source-table identity and field comparison, rewrite date and date-time cells on both the export CSV and the migrated `_RAW_*` sheet to the CXP-03 contract strings (`M/D/YYYY` and `M/D/YYYY h:mm AM/PM`). Accept ISO UTC, `yyyy-MM-dd HH:mm:ss`, Sheets Date objects, and serials as inputs to that rewrite. Hosted UAT Step 03 also writes those fixture columns as plain text so Sheets does not coerce them to local Date values. Ingest validation stays strict and is unchanged.
- **Rationale:** Staff has no authoritative key and dedupes on the full row. Hosted Step 04 treated two Staff fixture rows as `MISSING_SOURCE` plus `MISSING_TARGET` because `_RAW_STAFF` Date objects stringified differently from `staff.csv`. That is a transport mismatch, not a migration defect.
- **Consequences:** Synthetic and weekly exports compare on one date identity. A real weekly Excel export can keep CXP-03 AM/PM strings or ISO UTC and still match ingested `_RAW_*` Date cells. Local timezone coercion of unformatted fixture strings remains a Step 03 concern, which is why those columns are written as text.

## CXP-12 decisions

### DEC-060 — Registry history plus Script Property pointer for the active week

- **Date:** 2026-08-31
- **Packet:** CXP-12
- **Status:** Accepted; implemented; hosted DEV UAT passed 2026-08-31
- **Decision:** Persist weekly instances in control-workbook `WEEK_REGISTRY` and keep `CXP_<ENV>_TARGET_SPREADSHEET_ID` as the runtime ingestion pointer. Create/activate/rollover must keep them aligned; mismatch fails closed with `LIFECYCLE_ACTIVE_TARGET_MISMATCH`. Exactly one `ACTIVE` row is allowed.
- **Rationale:** ADR-009 requires a registered weekly active workbook; ADR-010 forbids hard-coded IDs. Ingestion already resolves the target from Script Properties; the registry supplies durable history and an operator-visible health cross-check without rewriting every caller.
- **Consequences:** `WeekRegistryRepository` becomes the write authority for `WEEK_REGISTRY`. Provisional six-column headers gain `Activated At UTC`. HealthCheck and CXP-13 status surfaces can report ACTIVE Week Key without reading source.

### DEC-061 — Separate week-boundary file rollover from intra-week date rollover

- **Date:** 2026-08-31
- **Packet:** CXP-12
- **Status:** Accepted; implemented; hosted DEV UAT passed 2026-08-31
- **Decision:** CXP-12 owns master-template copy, ACTIVE registration, prior-week archive, and target retarget at week boundaries. CXP-10 `BusinessContextService` continues to own intra-week `Interval View!AA2` / `MOM!B3` / `_CALC_STAFF!BE1` advancement inside one workbook.
- **Rationale:** Collapsing both into one API would either recreate daily file sprawl or force destructive clears when RTAs only need the next business day. The handoff forbids daily operational files and requires accidental re-init safety for live data.
- **Consequences:** WeeklyRollover UAT proves a new spreadsheet instance; CXP-10 Step 05 remains the in-workbook seven-day anchor advance. CXP-12 may seed anchors on a newly created week but must use ensure-only semantics on live books.

### DEC-062 — Time-driven triggers are maintenance-only

- **Date:** 2026-08-31
- **Packet:** CXP-12
- **Status:** Accepted; implemented; hosted DEV UAT passed 2026-08-31
- **Decision:** Install time-driven triggers solely for `HEALTH_CHECK`, `STALE_DATA`, `CLEANUP`, optional `INBOX_POLL`, and `WEEKLY_ROLLOVER`. Primary hourly freshness remains user-triggered or source-triggered ingestion (CXP-06 / later CXP-13). Inbox polling may signal availability but must not commit.
- **Rationale:** The packet goal keeps user/source-triggered ingestion as the primary refresh path and uses timers for maintenance, stale checks, cleanup, and rollover. Apps Script trigger delivery is eventual; making commit timer-primary would hide failures and fight LockService serialization.
- **Consequences:** `TriggerController` inventories kinds, not opaque IDs, in evidence. UAT Step 05 fails if a primary ingest commit trigger is installed. Exact wake clocks are non-goals.

### DEC-063 — Approval-bound environment promotion changes configuration only

- **Date:** 2026-08-31
- **Packet:** CXP-12
- **Status:** Accepted; implemented; hosted DEV UAT passed 2026-08-31
- **Decision:** DEV → UAT → PROD promotion updates Script Properties and clasp target only, never source. CXP-12 ships the checklist and PROD acknowledgment gate; CXP-14 retains cutover push and production runbooks. Required destination keys include target, control, master template, and inbox folder IDs plus post-smoke HealthCheck and trigger inventory.
- **Rationale:** ADR-010 and CXP-00 already forbid embedding environment IDs in source and withhold unattended PROD push. Operators need an explicit checklist before PROD keys are used.
- **Consequences:** `CXP12UatStep08PromotionGate` returns `promotionReady` from checklist inputs. Missing destination keys yield `PROMOTION_CHECKLIST_INCOMPLETE`. Optional `CXP_<ENV>_STALE_DATA_THRESHOLD_MINUTES` is documented with a default when absent.

### DEC-064 — Accept hosted DEV evidence as final CXP-13 packet evidence

- **Date:** 2026-09-06
- **Packet:** CXP-13
- **Status:** Accepted; implemented; complete as `CXP-13-v1`
- **Decision:** The packet owner authoritatively accepts the passing hosted DEV Steps 00–08 promotion gate, sanitized terminal reconciliation, negative/timing assertions, and green local verification as sufficient to complete CXP-13. A separate UAT deployment execution is not a remaining CXP-13 gate.
- **Rationale:** The supplied Step 08 result reports `pass: true`, `missing: []`, and `promotionReady: true`; the repository verification passes 294/294 tests; and the packet owner explicitly directed completion after reviewing the distinction between DEV evidence and a separate UAT run.
- **Consequences:** CXP-13 advances from `v1-rc` to `CXP-13-v1` with no packet blocker. Documentation must continue to distinguish observed DEV evidence from the unexecuted separate UAT environment. CXP-14 retains performance hardening, any additional UAT rehearsal, PROD configuration, deployment, and cutover authority.

## CXP-07 decisions

### DEC-035 — Install bounded native spill tables instead of transforming rows in Apps Script

- **Date:** 2026-08-25
- **Packet:** CXP-07
- **Status:** Accepted
- **Decision:** Build `_CALC_HANDLED` and `_CALC_OFFERED` as bounded Google Sheets formula tables with one spill anchor per calculated column and one spill anchor for each copied raw block. Install through a target-only, Script-Properties-resolved entrypoint. Validate exact CXP-03 raw headers before clearing either calculation sheet.
- **Rationale:** CXP-07 requires Sheets-native vectorization and prohibits reproducing Excel `#This Row` formulas as cell-by-cell fill-down. Query aggregation plus vector lookup removes thousands of independent SUMIFS formulas while keeping the CXP-01 rules explicit and testable.
- **Consequences:** The installed model uses 20 anchors and four formula-write calls at any supported row count. CXP-06 raw replacement triggers normal dependency recalculation and already flushes pending spreadsheet work; installation is required only after CXP-02 or an approved schema/model revision. Hosted formula parsing and approximately 5k+5k timing remain a promotion gate. CXP-08 may add a separate packet-owned installer without changing this public contract.

### DEC-036 — Resume CXP-07 installation across bounded Apps Script executions

- **Date:** 2026-08-25
- **Packet:** CXP-07
- **Status:** Accepted
- **Decision:** Keep the synchronous service API for local and composed callers, but make the hosted entrypoint execute a 27-step idempotent plan. Persist the cursor after each successful step, stop normal work after four minutes, resume through a time-driven trigger, create a delayed safety trigger before mutations, and serialize invocations with a script lock.
- **Rationale:** Apps Script enforces a six-minute execution limit. The observed hosted run ended at exactly six minutes, while the prior installer had no cursor or continuation boundary. The platform limit cannot be disabled; checkpointing and retry-safe continuation remove the monolithic execution dependency.
- **Consequences:** A hosted install can span multiple executions and reports progress through `getCxp07HandledOfferedTransformationStatus()`. Formula anchors are written individually on the hosted path, increasing constant formula-write calls from four to 20 while preserving the same bounded model. Trigger timing and an individual service call that itself exceeds the platform limit remain hosted constraints.
