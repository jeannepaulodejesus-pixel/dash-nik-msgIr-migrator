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
- The CXP-06 test set covers sheet mapping/cell transport, five-sheet staging and validation, values-only raw replacement, hidden/protected backup groups, rollback/recovery decisions, run-ID ledger lookup, real CXP-04 lock composition, fault injection, cleanup debt, and declared peak-volume bulk-call shape.
- `npm run lint` performs syntax checks; it is not a behavioral test or style formatter.
- `npm run guardrails` scans first-party text files visible to Git (and the working tree before Git is initialized). It is a safety net, not a replacement for credential review or secret rotation.
- CI installs from `package-lock.json` and runs `npm run verify` on pushes to `main` and on pull requests.

Google-hosted calls remain behind injected adapters so they can be tested without IDs or credentials. CXP-02 verifies the complete service-call contract locally; an authorized operator must separately run `initializeCxp02Workbooks()` against configured blank DEV spreadsheets before deployment promotion.

CXP-04 verifies the LockService adapter contract with a deterministic shared-lock double. An authorized operator must separately run overlapping DEV executions to confirm hosted Apps Script behavior before deployment promotion; the local test does not claim scheduler fairness or exact timeout timing.

CXP-05 verifies the Drive/Utilities/Spreadsheet/advanced-Drive call shapes with deterministic doubles and keeps synthetic fixture values non-personal. An authorized operator must separately run a DEV-only XLSX import/delete smoke test with synthetic data to confirm current Drive import formats, API enablement, permissions, quotas, and hosted cleanup behavior before promotion.

CXP-06 verifies the recovery protocol with deterministic Spreadsheet/Sheet/Range/Protection/ledger/lock doubles. The local declared-maximum test covers 44,500 records with constant five staging and five raw bulk writes. An authorized operator must separately execute `docs/cxp06-uat-runbook.md` in DEV/UAT to measure hosted quotas and elapsed time, inject commit/health/rollback failures, reconcile interrupted backups, and observe reader visibility before promotion.
