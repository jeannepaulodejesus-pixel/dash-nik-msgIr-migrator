# CXP-14 Performance Report — Template

## Scope and evidence quality

State the immutable release version, hosted UAT date, accepted operational window, fixture provenance, and whether each result is expected-peak or declared-maximum. Confirm evidence completeness, distinct run identity, valid workload totals, terminal/audit consistency, and safe redaction.

## Run summary

| Profile | Run | Total rows | End-to-end ms | Active ms | Max invocation ms | Continuations | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| EXPECTED_PEAK | 1 | 20,300 | | | | | |
| EXPECTED_PEAK | 2 | 20,300 | | | | | |
| EXPECTED_PEAK | 3 | 20,300 | | | | | |
| DECLARED_MAXIMUM | 1 | 44,500 | | | | | |

## Phase and service-call evidence

| Run | Phase/dataset | Duration ms | Spreadsheet | Drive | Properties | Lock | Trigger | Flush | Decision |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| | | | | | | | | | |

Compare call counts between expected peak and declared maximum. Explain any growth by bounded chunk/phase count; per-row remote-call growth is blocking.

## Gate results

| Gate | Threshold | Result |
|---|---|---|
| Expected peak | 3 successes; each within accepted window | |
| Invocation objective | `< 240000 ms` | |
| Hard invocation boundary | `< 270000 ms`; no timeout/quota error | |
| Declared maximum | Complete within 30 minutes | |
| Recovery | Safe terminal within 15 minutes after recovery worker starts | |
| Last-known-good preservation | True for every rejected/failed attempt | |
| Audit/cleanup/health | Complete and healthy | |

## Findings

For each material finding record evidence, impact, severity, confidence, likely cause, remediation, and retest. Do not include raw profiling dumps or sensitive values.

## Decision

- performance gate: Pass / Fail
- accepted exceptions:
- residual risk:
- required reruns:

