# Testing and Verification

The repository uses Node's built-in test runner so pure JavaScript can be tested without Google credentials or Apps Script services.

## Local commands

```powershell
npm ci
npm test
npm run lint
npm run guardrails
npm run test:cxp03
npm run test:cxp04
npm run test:cxp05
npm run test:cxp06
npm run test:cxp07
npm run test:cxp08
npm run verify
git diff --check
```

- `tests/config.test.cjs` exercises the same `getProperty()` adapter shape used by Apps Script PropertiesService.
- `tests/tooling.test.cjs` verifies local clasp configuration and repository secret/credential safeguards in temporary directories.
- `tests/cxp01-contracts.test.cjs` proves GMT/UTC source semantics, the explicit −480-minute fixed-PST conversion, WB0817's missing core converter, and the parity alignment rule from the binary formula catalog and machine contracts.
- `tests/cxp02-initializers.test.cjs` exercises the configured two-workbook entrypoint through in-memory Spreadsheet/Sheet/Protection adapters, including exact sheet catalogs, fixed-PST business timezone, idempotent reruns, data preservation, Google's single sheet-protection model, explicit-editor/domain/target-audience/unprotected-range normalization, conflict preservation, and fail-closed service/configuration preflights.
- `tests/cxp03-schema.test.cjs` exercises all five active schemas through pure header, row, type, key, volume, packaging, version-stamping, and normalized-payload boundaries without Google services.
- `tests/cxp04-run-orchestration.test.cjs` exercises the complete state path, illegal transitions, categorized terminal failures, audited success/failure records, script-lock exclusion at `COMMITTING`, controlled log headers, and bulk log writes through injected service doubles.
- `tests/cxp05-input-adapters.test.cjs` exercises original-byte fingerprints, signature detection, constrained ISO-8859-1 HTML-table parsing, exact-row collapse, divergent-key rejection, values-only XLSX conversion, formula rejection, temporary-file cleanup, five-dataset bundling, controlled duplicate records, and CXP-04-compatible phase boundaries through synthetic service doubles.
- The CXP-06 test set covers sheet mapping/cell transport, five-sheet staging and validation, dataset-scoped staging/raw/backup access, fresh-process staged-payload reconstruction, preparation/resume state history, hosted continuation/watchdog/status behavior, bounded entrypoint and worker-decision logging, 4-minute-30-second cooperative yielding, adaptive multi-dataset packing, successor-first trigger replacement, consumed-trigger perpetuation through terminal completion, stranded-state repair, rollback-failure cursor restart, persisted raw-dataset commit cursors, values-only bulk replacement, hidden/protected backup groups, rollback/recovery decisions, run-ID ledger lookup, real CXP-04 lock composition, fault injection, cleanup debt, and declared peak-volume bulk-call shape.
- `tests/cxp07-native-transformations.test.cjs` covers the fixed-PST Excel-control fixture, the exact two-table calculated-header contract, bounded native spill installation, constant formula-write count, the 27-step retry-safe install plan, hosted checkpoint/resume and safety-trigger behavior, progress status, configured target-only setup, fail-closed raw-header drift, and idempotent reinstall behavior.
- `tests/cxp08-native-transformations.test.cjs` and `tests/cxp08-parity-uat.test.cjs` cover the AHT/Auxes/Staff reference fixture, bounded 74-step install plan (synthetic double), checkpoint/resume, schema drift rejection, idempotent reinstall, and hosted parity display normalization (Sheets date/time formats).
- `tests/cxp-dev-workbook-bootstrap.test.cjs` and `tests/cxp-control-workbook-headers.test.cjs` cover DEV target/control creation, Script Property registration, folder discovery, and control-tab header seeding.
- `npm run lint` performs syntax checks; it is not a behavioral test or style formatter.
- `npm run guardrails` scans first-party text files visible to Git (and the working tree before Git is initialized). It is a safety net, not a replacement for credential review or secret rotation.
- CI installs from `package-lock.json` and runs `npm run verify` on pushes to `main` and on pull requests.

Google-hosted calls remain behind injected adapters so they can be tested without IDs or credentials. CXP-02 verifies the complete service-call contract locally; an authorized operator must separately run `initializeCxp02Workbooks()` against configured blank DEV spreadsheets before deployment promotion.

CXP-04 verifies the LockService adapter contract with a deterministic shared-lock double. An authorized operator must separately run overlapping DEV executions to confirm hosted Apps Script behavior before deployment promotion; the local test does not claim scheduler fairness or exact timeout timing.

CXP-05 verifies the Drive/Utilities/Spreadsheet/advanced-Drive call shapes with deterministic doubles and keeps synthetic fixture values non-personal. An authorized operator must separately run a DEV-only XLSX import/delete smoke test with synthetic data to confirm current Drive import formats, API enablement, permissions, quotas, and hosted cleanup behavior before promotion.

CXP-06 verifies the recovery protocol with deterministic Spreadsheet/Sheet/Range/Protection/ledger/lock/trigger doubles. The local declared-maximum test covers 44,500 records with constant five staging and five raw bulk writes. Cursor tests prove a worker reads, validates, verifies, and writes only the named dataset; backup resume does not reread staging; adaptive workers pack multiple measured-safe steps inside a 270,000 ms budget and hand off before the next reserved step; an already-written dataset is adopted when current raw matches the staged payload; every recovery watchdog is armed beyond the six-minute execution limit; lock contention reschedules instead of terminating the run; only one continuation remains installed; and finalization does not replay raw writes. Deterministic clocks prove decisions, not Google-hosted wall time. An authorized operator must separately execute `docs/cxp06-uat-runbook.md` in DEV/UAT to measure hosted quotas, invocation count, scheduler wait, and elapsed time, inject commit/health/rollback failures, reconcile interrupted cursors/backups, and observe reader visibility before promotion.

CXP-07 verifies formula topology, representative rule parity, and deterministic continuation contracts locally without a spreadsheet ID. An authorized operator must separately execute `docs/cxp07-uat-runbook.md` in DEV/UAT to prove Google-hosted trigger continuation, formula parsing, spill completion, error behavior, and recalculation time at approximately 5,000 Handled plus 5,000 Offered rows before promotion. Hosted editor helpers are documented in `docs/cxp07-uat-harness.md`; August 26, 2026 sign-off evidence is in `docs/cxp07-hosted-uat-results-2026-08-26.md`.

CXP-08 verifies AHT/Auxes/Staff formula topology, representative rule parity, parity display normalization, and deterministic continuation contracts locally without a spreadsheet ID. An authorized operator must separately execute `docs/cxp08-uat-runbook.md` in DEV/UAT to prove Google-hosted install, parity, second-bundle refresh, and reinstall topology. Hosted editor helpers are documented in `docs/cxp08-uat-harness.md`; August 28, 2026 sign-off evidence is in `docs/cxp08-hosted-uat-results-2026-08-28.md`. Step 05 peak flush remains optional follow-up evidence.
