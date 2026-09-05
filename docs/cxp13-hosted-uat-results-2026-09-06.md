# CXP-13 Hosted DEV UAT Results — 2026-09-06

Runbook: [`docs/cxp13-uat-runbook.md`](cxp13-uat-runbook.md). Harness: [`docs/cxp13-uat-harness.md`](cxp13-uat-harness.md). Contract: [`docs/rta-intake-contract.md`](rta-intake-contract.md).

This record contains sanitized statuses, error codes, timing-boundary results, and gate outcomes only. Spreadsheet IDs, folder IDs, file IDs, filenames, user emails, source rows, cell values, and formulas are omitted.

## Outcome

**PASSED — Hosted DEV promotion gate completed on September 6, 2026.**

At operator local time 00:49:41 (Asia/Manila, UTC+8), `CXP13UatStep08PromotionGate` returned:

```text
pass: true
missing: []
promotionReady: true
```

The Step 08 result proves that the persisted CXP-13 DEV evidence contained every required Step 00–07 gate plus the validated permission observation. On September 6, 2026, the packet owner authoritatively accepted this evidence as sufficient for CXP-13 completion. This does not claim that a separate UAT deployment was executed. PROD deployment and cutover remain owned by CXP-14.

## Scope and acceptance basis

| Field | Value |
|---|---|
| Environment | Hosted Google Apps Script DEV |
| Execution date | 2026-09-06 local / 2026-09-05 UTC |
| Delivery | `CXP-13-v1`, complete |
| Setup state | `CXP13_INTAKE_SETUP_STATE_V1` |
| Pipeline state | `CXP13_INGESTION_PIPELINE_STATE_V1` |
| Evidence state | `CXP13_UAT_EVIDENCE_V1` |
| Upstream baseline | CXP-04, CXP-05, CXP-06, and CXP-12 |
| Authoritative terminal evidence | Matching `RUN_LOG` records |

## Local verification

The final harness corrective pass was verified locally before the passing hosted gate.

| Verification | Result |
|---|---|
| CXP-13 focused tests | **PASS — 14/14** |
| Full repository tests | **PASS — 294/294** |
| JavaScript syntax check | **PASS — 131 files** |
| Repository guardrails | **PASS — 229 text files** |
| `git diff --check` | **PASS** |

The direct Node commands were used because the workstation's global npm launcher referenced a missing npm installation. This was a local tooling issue; the repository test runner and test code completed successfully.

## Hosted step results

Only Step 08's final execution log was supplied directly. Steps 00–07 are marked **gate-confirmed** where their persisted booleans were necessarily true for Step 08 to return `missing: []`. Separate `RUN_LOG` inspection independently reconciled the success, duplicate, and invalid-header terminal outcomes.

| Step | Entrypoint | Result | Evidence basis |
|---|---|---|---|
| 00 — Verify prerequisites | `CXP13UatStep00VerifyPrerequisites` | **PASS — gate-confirmed** | Persisted `prerequisites: true`; DEV configuration, CXP-12 completion, and ACTIVE-target alignment were required |
| 01 — Install intake | `CXP13UatStep01InstallIntake` | **PASS — gate-confirmed** | Persisted `setup: true`; real CXP-13 setup completed |
| 02 — Web/status entrypoints | `CXP13UatStep02WebStatus` | **PASS — gate-confirmed** | Persisted `webStatus: true`; authorized parameterless server status call succeeded |
| 03 — Discover latest bundle | `CXP13UatStep03DiscoverLatestBundle` | **PASS — gate-confirmed** | Persisted `discovery: true`; complete five-dataset coverage and a valid filename token were required |
| 04 — Start ingestion | `CXP13UatStep04StartIngestion` | **PASS — gate-confirmed** | Persisted `start: true`; run entered `QUEUED` with a continuation |
| 05 — Reconcile success | `CXP13UatStep05ReconcileSuccess` | **PASS — gate-confirmed and reconciled** | Persisted `success: true`; `RUN_LOG` contains one `SUCCESS` record |
| 06 — Duplicate submission | `CXP13UatStep06QueueDuplicate` | **PASS — gate-confirmed and reconciled** | Persisted `duplicateQueued: true`; `RUN_LOG` contains `SOURCE_DUPLICATE_SUBMISSION` |
| 07 — Negative and timing gate | `CXP13UatStep07VerifyNegativeAndTiming` | **PASS — gate-confirmed** | Persisted `negativeAndTiming: true`; all negative/timing predicates were required |
| 08 — Promotion gate | `CXP13UatStep08PromotionGate` | **PASS — direct log** | `pass: true`, `missing: []`, `promotionReady: true` |

## Sanitized terminal reconciliation

A read-only export of the DEV control workbook was inspected without retaining or publishing identifiers or source content.

| Terminal evidence | Count | Result |
|---|---:|---|
| Successful ingestion | 1 | `SUCCESS` |
| Duplicate submission | 1 | `FAILED_SOURCE` / `SOURCE_DUPLICATE_SUBMISSION` |
| Invalid-header submission | 1 | `FAILED_SOURCE` / `SCHEMA_MISSING_REQUIRED_COLUMNS` |

The invalid-header fixture used a complete five-sheet XLSX package and changed one required Handled header. Validation failed before staging or raw replacement. The prior successful operational dataset therefore remained the active-data baseline.

## Negative, timing, and permission gates

| Criterion | Result | Evidence classification |
|---|---|---|
| Identical-content resubmission reaches `DUPLICATE` | **PASS** | Independently reconciled from `RUN_LOG` |
| Invalid-header package reaches `VALIDATION_FAILED` | **PASS** | Independently reconciled from `RUN_LOG` |
| Invalid input causes no raw mutation | **PASS** | Operator-recorded gate assertion; validation occurs before commit |
| Concurrent start is refused | **PASS** | Operator-recorded gate assertion |
| Injected processing failure rolls back | **PASS** | Operator-recorded gate assertion using the existing CXP-06 rollback seam |
| Prior operational dataset remains usable after rollback | **PASS** | Operator-recorded gate assertion |
| At least one success spans multiple invocations | **PASS** | Operator-recorded gate assertion |
| No CXP-13 invocation timed out | **PASS** | Operator-recorded gate assertion |
| Maximum individual invocation is below 270,000 ms | **PASS** | Validated Step 07 predicate; exact measured value was not included in the supplied final log |
| DEV web deployment identity and permission checks | **PASS** | Operator-recorded gate assertion required by Step 08 |

The control workbook's total start-to-terminal run duration exceeded one invocation budget because scheduler delay and multiple continuations are included. Total run duration is not used as `maxInvocationMs`; only the longest individual Apps Script execution is eligible.

## Corrective findings closed during hosted DEV

| Finding | Root cause | Correction | Result |
|---|---|---|---|
| `LIFECYCLE_ACTIVE_TARGET_MISMATCH` during setup | Configured target differed from the ACTIVE `WEEK_REGISTRY` record; the prior align helper validated before it could repair drift | Changed `alignActiveTarget` to resolve the ACTIVE registry row directly, rewrite the environment target property, and then allow normal fail-closed verification | Alignment recovery covered by regression test; setup proceeded |
| `INGESTION_UNAUTHORIZED_ACTOR` during status check | Allowed-domain property contained a leading `@`, while authorization compares the extracted domain exactly | Stored the bare domain value and reran authorization | Status entrypoint proceeded |
| `INGESTION_SELECTION_CHANGED` during start | Step 04 had no matching stable latest candidate or received a different/null token | Required Step 03 `READY` evidence and a stable newest UTC filename token before start | Discovery/start gates later passed |
| Invalid-input fixture needed | An incomplete delivery is rejected during discovery and cannot create a terminal run record | Generated a complete synthetic five-sheet XLSX with one intentionally invalid required header | `SCHEMA_MISSING_REQUIRED_COLUMNS` recorded with no raw commit |
| Step 07 returned `maxInvocationMs: null` | The original argument-bearing recorder was invoked from the Apps Script editor without an argument; it silently wrote false/null evidence | Added temporary-property input, a parameterless recorder, strict field validation, safe missing-predicate output, explicit no-timeout evidence, and permission gating | Corrected Step 07 evidence satisfied Step 08 |

## Security and privacy observations

- Public CXP-13 status remains allowlisted and excludes file IDs, spreadsheet IDs, filenames, emails, source rows, values, and formulas.
- Domain authorization remains server-side; HTML contains no authorization or ingestion decisions.
- Evidence records contain booleans, bounded status/error names, and timing only.
- During an earlier read-only review before the final gate, the control workbook UI reported link-based access. The final Step 08 result includes the operator's later `permissionsVerified: true` assertion, but the final sharing dialog was not independently captured in the supplied evidence. Reconfirm restricted sharing before any later environment promotion.

## Execution-boundary disposition

The hosted DEV evidence gate recorded:

- cooperative invocation budget retained at 270,000 ms;
- 60,000 ms minimum next-step reserve;
- 15,000 ms handoff margin;
- checkpointed multi-invocation completion;
- one successor continuation at a time;
- no Apps Script timeout;
- longest individual invocation below 270,000 ms.

The exact hosted maximum invocation duration was not present in the supplied Step 08 log and is therefore not invented in this record. It remains in the validated `CXP13_UAT_EVIDENCE_V1` Script Property evidence for the DEV project.

## Promotion disposition

**CXP-13 is complete as `CXP-13-v1`.**

Completion is based on the passing September 6, 2026 DEV evidence set plus the packet owner's authoritative acceptance on the same date. A separate UAT deployment was not executed and is not claimed in this record. That unobserved environment rehearsal does not remain a CXP-13 blocker; CXP-14 may repeat the runbook as part of performance hardening, UAT, and cutover preparation. This completion does not authorize PROD deployment, Script Property changes, or cutover. CXP-14 retains PROD ownership.

## Sign-off record

- Environment: **DEV**
- Execution date: **September 6, 2026 (Asia/Manila)**
- Final gate: **PASSED**
- Promotion readiness: **true**
- Missing gates: **none**
- Delivery: **CXP-13-v1, complete**
- Completion authority: **Packet-owner acceptance on September 6, 2026**
- Remaining blocker: **None for CXP-13**
- Unobserved scope: **Separate UAT deployment execution; available to CXP-14**
- PROD status: **Not authorized; CXP-14 owns cutover**
