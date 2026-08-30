# CXP-08 AHT, Auxes, and Staff Native Transformations

## Runtime contract

`initializeCxp08AhtAuxesStaffTransformations()` opens only the configured target spreadsheet and starts or resumes a checkpointed installation. Run CXP-02 first so `_RAW_AHT`, `_RAW_AUXES`, `_RAW_STAFF`, `_CALC_AHT`, `_CALC_AUXES`, and `_CALC_STAFF` exist. CXP-08 validates the exact active CXP-03 AHT, Auxes, and Staff raw headers before any calculation sheet is cleared.

The hosted runner divides installation into 74 retry-safe steps: one schema preflight, then capacity, bounded clear, header, formula-anchor, and raw-copy operations for each calculation sheet, plus Staff summary headers/formulas. It preserves the service-owned `_CALC_STAFF!BE1` anchor and saves the next step in the `CXP08_AHT_AUXES_STAFF_INSTALL_STATE_V2` Script Property after every successful operation. It stops normal work after four minutes; a one-second time-driven continuation resumes the saved cursor, a seven-minute safety trigger guards hard cutoffs, and a script lock prevents overlapping runners.

`getCxp08AhtAuxesStaffTransformationStatus()` reads persisted progress without opening the spreadsheet. Expected states are `IDLE`, `RUNNING`, `COMPLETE`, and `FAILED`. Re-running initialize while `RUNNING` or `FAILED` resumes; after `COMPLETE` it starts a clean reinstall.

Calculation bounds: `_CALC_AHT` 15,001×34; `_CALC_AUXES` 7,501×28; `_CALC_STAFF` 2,001×53 table plus BE:BF-equivalent Que/LAS summary block and Business Day cell `$BE$1`. Spill anchors live on row 2 (plus Staff summary rows 3–50). No fill-down architecture.

Formulas read raw values after CXP-06 replacement. Re-run the installer only after workbook initialization or an approved model/schema change.

## Business-rule lineage

WB0817 formula families and metric chains are the only business-rule authority. `tests/fixtures/cxp08/aht-auxes-staff-parity.json` is the synthetic control fixture; `AhtAuxesStaffReferenceModel` evaluates the same rules without Google services.

| Output | Excel lineage | Sheets-native pattern |
|---|---|---|
| AHT Date / Interval / Request Interval | INT / TIME+FLOOR Accept or Request | Bounded `ARRAYFORMULA` + `LET`; DEC-025 −8/24 before date/interval |
| AHT Count | COUNT(Request Date) | Non-blank flag on Request Date |
| AHT Service Level | Speed To Answer &lt; 91 | Vector comparison |
| AHT ASA Total | Speed To Answer + Time To First Response | Vector sum |
| AHT CC | SUMIFS Handle ÷ Active by Interval+Site | QUERY aggregate + VLOOKUP |
| Auxes Date / Interval | Status Start Date | DEC-025 then INT / 30-minute floor |
| Auxes Available / Concluding hours | Status name gates on Sign On Time (hours) | Vector `IF` |
| Staff half-hour overlaps | MAX/MIN interval overlap vs day+bucket | 48 row-2 spills keyed to `$BE$1` |
| Staff Que/LAS summary | BE:BF SUMIFS × (1440/30) | Bounded summary block (CNX early buckets, INT late buckets) |

The sole approved rule correction versus legacy Excel hour flooring is DEC-025.

## Verification boundary

`npm run test:cxp08` proves fixture parity, bounded installation, the 74-step plan, configured target-only setup, checkpoint/resume, schema-drift rejection, and idempotent reinstall. Node cannot execute Google Sheets formulas. Follow [`docs/cxp08-uat-runbook.md`](cxp08-uat-runbook.md) (`CXP08UatStep01` … `CXP08UatStep08`) before promotion.
