# CXP-14 Least-Privilege Permissions Matrix

Confirm actual Workspace groups/people and effective hosted identities during UAT. Do not record emails, IDs, or credentials in repository evidence.

| Capability | RTA | UAT operator | Release operator | Support owner | Delivery validator | Business validator | Rollback operator |
|---|---|---|---|---|---|---|---|
| View user-facing reports/status | Allow | Allow | Allow | Allow | Allow | Allow | Allow |
| Start supported intake | Allow in assigned environment | Allow UAT | Allow controlled PROD canary | Diagnostic only | No | No | Emergency only |
| Edit approved RTA input cells | Allow | Allow UAT | No routine use | No | No | Validation only if approved | No |
| Edit backend/control sheets | Deny | Deny except approved UAT seeding | Deny manual edits | Read-only diagnostics | Deny | Deny | Only documented recovery |
| Read sanitized logs/evidence | Own/status surface | Allow | Allow | Allow | Allow | Allow summaries | Allow |
| Change Script Properties | Deny | UAT only when assigned | PROD only with approval | Deny | Deny | Deny | Restore only |
| Deploy Apps Script | Deny | Deny | Exact approved candidate | Deny | Deny | Deny | Prior approved version only |
| Change sharing/protections | Deny | UAT verification only | Approved PROD change | Deny | Deny | Deny | Restore only |
| Execute rollback | Deny | Rehearsal only | Stop/coordinate | Coordinate | Advise | Advise | Allow with stop authority |

## Verification

- Test the deployed web app as each relevant role, not by configuration inspection alone.
- Confirm unauthorized domain and signed-out access fail closed.
- Confirm RTA/validator identities cannot expose or edit `_STG_*`, `_RAW_*`, `_CALC_*`, `_AGG_*`, RUN_LOG, ERROR_LOG, FILE_LEDGER, WEEK_REGISTRY, PARITY_RESULTS, or SOURCE_ERROR_BASELINE.
- Confirm only the release/rollback operator boundary can change configuration or deployment.
- Confirm evidence contains role/result only, never identity values.
- Any broader effective access blocks promotion until removed or explicitly approved with rationale.

