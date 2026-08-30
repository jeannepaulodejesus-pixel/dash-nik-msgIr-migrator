# CXP-10 Hosted DEV UAT Results — 2026-08-31

## Outcome

**Pass.** CXP-10 completed all 139 installation steps on `DEV_TARGET_WORKBOOK`, the hosted topology diagnostic reported zero formula errors, the complete business context was valid, and the final on-axis parity comparison passed with zero differences.

- **Target:** `DEV_TARGET_WORKBOOK` (`1loVw2V1H_WDhPa9dhgIsTKDFGkch9xLrR3XMvoc6mMg`)
- **Environment:** `DEV`
- **Installer state:** `COMPLETE`, `nextStep: 139`, `stepCount: 139`
- **Completed UTC:** `2026-08-30T19:23:04.856Z`
- **Hosted parity:** `pass: true`, `diffCount: 0`, `expectedOnAxisCount: 1`, `rowsRead: 38`
- **Repository verification:** `npm run verify` — 197 tests passed, 0 failed; syntax and repository guardrails passed

## Final promotion evidence

The final execution at 03:26 Manila time reported:

- Interval View present with all 25 metric anchors and all 25 total formulas.
- Exact 38-row control axis from 04:00 through 22:30.
- Header, layout, PST, Remarks, hidden-column, and legacy-reference checks passed.
- Formula-error scan completed with `formulaErrorCount: 0` and was not skipped.
- MOM title, section labels, time axis, 41 week-date formulas, and 42 day-name formulas passed.
- Forecast bridge was present, formula-backed, and referenced MOM.
- Business context passed with `businessDay: 2026-08-18`, `weekStart: 2026-08-17`, and `staffDay: 2026-08-18`.
- `CXP10UatStep04` passed with zero differences across the representative on-axis fixture grain.

`CXP10UatStep08PromotionGate` derives `promotionReady: true` from these recorded conditions: installation complete, Interval View ready, MOM ready, Forecast Bridge ready, and parity passed.

## RCA and corrective sequence

Three hosted iterations isolated and corrected independent defects:

1. Weekly rollover left valid anchors on `2026-08-25` while the date-bound fixture remained on `2026-08-18`. Promotion now returns one bounded `FIXTURE_CONTEXT_MISMATCH` result, and the runbook requires Step 03 after rollover.
2. Sheets returned duration-formatted values such as `2:30:00`; parity now normalizes them to the numeric day fraction used by the fixture.
3. Aggregation times contained floating-point drift (`0.16666666666787933` for 04:00). CXP-10 now matches bounded integer minute buckets instead of exact time fractions. The shared CXP-09 allocation fixture uses the contracted `INT` BPO, and legitimate zero values remain zero rather than being converted to blanks.

## Acceptance and limitations

CXP-10 DEV promotion acceptance is complete. The evidence proves the hosted formula topology, structural control-layout contract, validated anchors, zero formula errors, and representative output parity. It does not promote configuration to UAT or PROD and does not replace CXP-08 V2 or the dedicated CXP-09 hosted promotion gates.
