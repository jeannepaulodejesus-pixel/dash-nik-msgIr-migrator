# CXP-10 Control-Derived Interval View Redesign

**Status:** Approved by RCA evidence for implementation.

## Problem

The current CXP-10 implementation does not reproduce the control workbook's Interval View. It intentionally replaced the verified `C112:AB151` report and `04:00`–`22:30` interval window with an `A16:Z65` report and `00:00`–`18:30` window. It also models only labels and formulas; presentation topology, number formats, dimensions, visibility, merges, conditional formatting, and formula-error checks are absent from the runtime contract and tests.

The result is a sheet with raw date serials, default formatting, visible helper columns, a different information hierarchy, and formula errors even though local CXP-10 tests pass.

## Decision

Redesign the CXP-10 reporting-surface contract and renderer. Preserve the CXP-07/CXP-08 calculation layers, configuration boundary, resumable installer, and aggregation-only report lineage. Permit a backward-compatible CXP-09 aggregate-contract extension where CXP-10 cannot reconstruct a verified all-sites metric from the current site-level rows.

The uploaded control workbook identified by SHA-256 `CD8F8EC6F68FBEC85841CD64C251616FCECD0AD67DE4714EFB244F648548E65A` remains the visual and structural authority. `config/metric-lineage-contract.json` remains the metric/formula-lineage authority.

## Target architecture

```text
verified control workbook + metric-lineage contract
                    |
                    v
      versioned ReportSurfaceContract
          |                      |
          v                      v
 semantic formula catalog   presentation renderer
          \                      /
           \                    /
            checkpointed CXP-10 installer
                       |
                       v
          structural + value + render UAT
```

### Contract boundary

- Sheet: `Interval View`
- Visible combined report: `B102:AB151`
- Header: `C112:AB112` (`PST` plus 25 metrics)
- Interval body: `C113:AB150`
- Axis: 38 half-hour slots, `04:00` through `22:30`
- Grand Total: row `151`
- View Date input remains an explicit report input, but helper lookup mechanics must not displace or expose control columns.
- Report formulas continue to consume `_AGG_INTERVAL`, `_AGG_FORECAST`, and `_AGG_ALLOCATION`; they must not reintroduce pivot coordinates, `GETPIVOTDATA`, `_RAW_*`, or `_CALC_*` dependencies.

### Runtime responsibilities

1. `ReportingSurfaceFormulaCatalog` owns metric semantics and exact control-derived anchors.
2. A separate layout contract owns row/column dimensions, visibility, merged ranges, text, number formats, borders, fills, fonts, wrapping, alignment, and conditional-format rules.
3. `ReportingSurfaceTransformationService` applies content and presentation as retry-safe, idempotent install steps.
4. Diagnostics and promotion gates validate structure, styles, number formats, bounded formula errors, and output completeness in addition to formula-anchor presence.

## Implementation sequence

1. Add an independent, versioned control-derived Interval View contract fixture.
2. Move the formula surface back to `C112:AB151` and restore the `04:00`–`22:30` axis.
3. Remove visible helper columns by deriving date and interval keys inside row-wise formulas from the View Date input and PST axis.
4. Extend CXP-09 additively with all-sites or sufficient-statistic outputs for weighted timing metrics, and correct INT BPO allocation/cumulative-allocation semantics.
5. Add the presentation renderer and control-derived layout rules.
6. Fix row-wise array conditions that currently use scalar `OR(...)` across ranges.
7. Make totals error-safe and require a bounded formula-error scan in diagnostics/UAT.
8. Version the persisted CXP-10 install-state topology so an old cursor cannot resume into a different v2 step.
9. Preserve the current View Date, the row-97 allocation target, and MOM RTA-owned input cells; never clear the whole MOM sheet.
10. Replace self-referential topology assertions with independent contract, style, reinstall-idempotency, mixed-site weighting, INT allocation, cumulative interval, and representative parity tests.
11. Update the CXP-10 runbook, architecture decision index, and promotion gate.

## Acceptance criteria

- The installed report occupies the control-derived anchors and exposes all 25 metric headers in verified order.
- The PST axis contains exactly 38 half-hour slots from `04:00` through `22:30`.
- Date, time, duration, percentage, and numeric cells display using control-derived number formats; no date serial is user-visible.
- The bounded report surface contains no `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, or `#N/A` output.
- Required merges, dimensions, visibility, fills, fonts, borders, alignment, wrapping, and conditional formats are reproducible after clean install and reinstall.
- Formula lineage references aggregation sheets only.
- Representative fixture values and total formulas match the metric-lineage contract within exact or metric-specific tolerance.
- Local tests pass, full regression passes, and hosted DEV/UAT visual sign-off remains the promotion gate.

## Risks and controls

| Risk | Control |
|---|---|
| Google Sheets cannot reproduce an Excel-only drawing or formatting feature exactly | Preserve the operational hierarchy and encode the nearest native Sheets equivalent; record any residual visual delta in hosted UAT. |
| Reinstall destroys RTA-owned inputs | Limit clearing to the owned report surface and preserve the View Date cell. |
| Spill formulas collide with stale cells | Clear only owned spill/output ranges before writing anchors; verify bounded spill capacity. |
| Layout work exceeds Apps Script runtime | Keep formatting operations range-based and checkpoint presentation phases. |
| Tests regress to implementation-defined assertions | Keep the control-derived fixture independent from runtime catalogs and compare runtime output to it. |
| A v1 checkpoint resumes against the v2 step list | Use a versioned state key/contract version and fail closed on mismatched persisted state. |
| A report reinstall overwrites operator inputs | Snapshot/preserve View Date and bound MOM input grids; render first in disposable DEV/UAT and cut over only after parity. |

## Rollback

Revert the CXP-10 contract, catalog, renderer, diagnostics, tests, and documentation together. Any additive CXP-09 fields or `ALL` rows can remain inert; no CXP-07/08 rollback is required. Restore the captured View Date/MOM inputs and the prior report sheet snapshot if hosted cutover has occurred.
