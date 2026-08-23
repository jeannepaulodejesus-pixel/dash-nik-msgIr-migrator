# Architecture Decision Index

The approved architecture is defined in `CODEX_HANDOFF.md`. This index gives later packets stable decision identifiers; changes require a new entry in `docs/decision-log.md` and explicit owner approval.

| ADR | Status | Decision |
|---|---|---|
| ADR-001 | Accepted | Build a reporting-system migration, not a generic Excel converter. |
| ADR-002 | Accepted | Use one standalone Apps Script control plane rather than bound weekly code copies. |
| ADR-003 | Accepted | Keep calculation/reporting in Google Sheets; use Apps Script for orchestration. |
| ADR-004 | Accepted | Use staging, validation, commit, and rollback semantics. |
| ADR-005 | Accepted | Serialize production writes with a script-level lock. |
| ADR-006 | Accepted | Extract XLSX values only; do not execute or translate Excel formulas. |
| ADR-007 | Accepted | Replace pivot-coordinate dependencies with stable aggregation tables. |
| ADR-008 | Accepted | Use vectorized/native formulas and bulk service calls. |
| ADR-009 | Accepted | Maintain a master template and registered weekly active workbook. |
| ADR-010 | Accepted | Separate DEV, UAT, and PROD configuration outside source code. |
| ADR-011 | Accepted | Abstract logical datasets from unresolved physical file packaging. |
| ADR-012 | Accepted | Use hidden run-scoped backup sheets for recoverable five-dataset raw replacement. |

Implementation-level decisions made by CXP-00 through CXP-06, including the later GMT-extraction clarification, are recorded in the [decision log](decision-log.md).
