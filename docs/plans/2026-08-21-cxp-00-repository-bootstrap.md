# CXP-00 Repository Bootstrap and Engineering Guardrails Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a push-ready standalone Apps Script repository with environment configuration, local tests, CI, and safeguards, without adding migration business logic or production identifiers.

**Architecture:** Keep deployable Apps Script files under `src/` and keep local tooling, tests, and documentation outside clasp's `rootDir`. Runtime configuration is a small Apps Script-compatible module that consumes a PropertiesService-shaped adapter; local clasp targeting is generated into an ignored `.clasp.json` so real script IDs never enter source control.

**Tech Stack:** Apps Script V8 JavaScript, Node.js 22+, Node's built-in test runner, @google/clasp 3.3.0, GitHub Actions.

## Global Constraints

- Implement CXP-00 only: no workbook reverse engineering, source ingestion, business formulas, or production deployment.
- Preserve the standalone Apps Script control-plane architecture and DEV -> UAT -> PROD configuration boundary.
- Commit no secrets, spreadsheet IDs, Drive folder IDs, tokens, clasp credentials, or user-specific runtime values.
- Keep `src/appsscript.json` free of advanced services and explicit OAuth scopes until a later packet needs them.
- Use the exact packet commit message `feat: bootstrap Apps Script migration project` after fresh verification.

---

### Task 1: Test-first runtime configuration boundary

**Files:**
- Create: `tests/config.test.cjs`
- Create: `src/config/Config.js`
- Create: `src/appsscript.json`
- Create: `src/main/.gitkeep`, `src/ingestion/.gitkeep`, `src/validation/.gitkeep`, `src/repository/.gitkeep`, `src/services/.gitkeep`, `src/monitoring/.gitkeep`, `src/ui/.gitkeep`

**Interfaces:**
- Consumes: an optional object implementing `getProperty(name): string | null`; when omitted, the Apps Script global `PropertiesService.getScriptProperties()`.
- Produces: `Config.normalizeEnvironment(value)`, `Config.propertyKey(environment, suffix)`, and `Config.load(properties)` returning a frozen environment configuration for DEV, UAT, or PROD.

- [x] **Step 1: Add the focused failing test**

  Assert DEV/UAT/PROD normalization, environment-prefixed key lookup, missing/invalid environment errors, optional empty values, and use of an injected PropertiesService-shaped adapter. The production defects caught are selecting the wrong environment prefix, silently accepting an invalid environment, or accidentally requiring Google globals during local tests.

- [x] **Step 2: Verify the relevant failure**

  Run: `node --test tests/config.test.cjs`
  Expected: non-zero exit because `src/config/Config.js` does not exist.

- [x] **Step 3: Implement the minimum behavior**

  Normalize the active environment; resolve the injected or Apps Script adapter; derive the four later-packet ID keys (`TARGET_SPREADSHEET_ID`, `CONTROL_SPREADSHEET_ID`, `DRIVE_INBOX_FOLDER_ID`, `MASTER_TEMPLATE_SPREADSHEET_ID`); return values without embedding IDs. Use `Etc/UTC` in the minimal V8 manifest and omit services/scopes.

- [x] **Step 4: Verify the focused pass**

  Run: `node --test tests/config.test.cjs`
  Expected: all configuration tests pass.

- [x] **Step 5: Run the affected integration check**

  Run: `node --check src/config/Config.js`
  Expected: exit 0 with no syntax diagnostics.

### Task 2: Test-first local clasp and repository guardrails

**Files:**
- Create: `tests/tooling.test.cjs`
- Create: `scripts/configure-clasp.mjs`
- Create: `scripts/check-js.mjs`
- Create: `scripts/check-repository.mjs`
- Create: `package.json`
- Create: `package-lock.json`
- Create: `.gitattributes`
- Create: `.gitignore`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `CXP_CLASP_SCRIPT_ID` only in the developer's local process.
- Produces: `buildClaspConfig(scriptId)`, `writeClaspConfig({ scriptId, projectRoot })`, `findGuardrailViolations(files)`, and npm commands `clasp:configure`, `clasp:status`, `clasp:push`, `lint`, `test`, `guardrails`, and `verify`.

- [x] **Step 1: Add the focused failing test**

  Assert that clasp config uses `rootDir: "src"`, rejects blank IDs, refuses to overwrite a local target, flags tracked credential files/representative token material, and permits property names without values. The production defects caught are pushing the wrong tree, overwriting a developer's target, or allowing credential material into tracked sources.

- [x] **Step 2: Verify the relevant failure**

  Run: `node --test tests/tooling.test.cjs`
  Expected: non-zero exit because the tooling modules do not exist.

- [x] **Step 3: Implement the minimum behavior**

  Validate the script ID, create `.clasp.json` with exclusive-create semantics, enumerate first-party JavaScript for `node --check`, enumerate tracked files (falling back to the working tree before Git initialization), and reject credential filenames or known secret/token patterns. Pin clasp 3.3.0 and Node 22+; configure CI to run `npm ci` and `npm run verify`.

- [x] **Step 4: Verify the focused pass**

  Run: `node --test tests/tooling.test.cjs`
  Expected: all tooling tests pass.

- [x] **Step 5: Run the affected integration check**

  Run: `npm run lint && npm run guardrails`
  Expected: syntax checks and the actual repository scan both exit 0.

### Task 3: Operational documentation and packet completion record

**Files:**
- Create: `README.md`
- Create: `CONTRIBUTING.md`
- Create: `docs/architecture-decisions.md`
- Create: `docs/configuration.md`
- Create: `docs/testing.md`
- Create: `docs/decision-log.md`
- Create: `docs/packet-status.md`
- Modify: `docs/plans/2026-08-21-cxp-00-repository-bootstrap.md`

**Interfaces:**
- Consumes: verified commands and environment keys from Tasks 1 and 2.
- Produces: developer setup/deployment instructions, architecture-decision and packet-status conventions, and the CXP-00 completion handoff for CXP-01/CXP-02.

- [x] **Step 1: Document exact setup and operating contracts**

  Record the source tree, Node/npm commands, local clasp configuration flow, environment keys, ADR index, packet status fields, decision-log fields, test strategy, assumptions, and known limitations. Document that `clasp:push` replaces remote project content and must target DEV/UAT only during this packet.

- [x] **Step 2: Run full acceptance verification**

  Run: `npm ci`, then `npm run verify`, then configure Git and run `git diff --check` plus a deterministic tracked-file secret scan via `npm run guardrails`.
  Expected: dependency lock is reproducible; unit, syntax, and guardrail checks report zero failures; Git reports no whitespace errors.

- [x] **Step 3: Reconcile the acceptance checklist**

  Confirm every CXP-00 criterion against files or command output. Mark only criteria with evidence complete; record that a live clasp push remains operator-authenticated and non-production-only.

- [x] **Step 4: Commit the packet**

  Run: `git add` for the CXP-00 repository files and `git commit -m "feat: bootstrap Apps Script migration project"`.
  Expected: one CXP-00 delivery commit; source handoff artifacts remain preserved.

## Unresolved externally observable decisions

None for CXP-00. A real non-production Apps Script `scriptId`, Google authentication, and live push are intentionally operator-provided deployment inputs, not repository content.
