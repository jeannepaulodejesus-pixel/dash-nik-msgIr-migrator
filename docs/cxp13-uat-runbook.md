# CXP-13 Hosted DEV/UAT Runbook

## Preparation

1. Use DEV or UAT; never run this harness in PROD.
2. Configure target, control, Drive Inbox, master template, and `CXP_<ENV>_RTA_ALLOWED_DOMAIN` Script Properties.
3. Confirm CXP-12 setup is `COMPLETE`, ACTIVE registry alignment is healthy, and CXP-12 still inventories maintenance triggers only.
4. Deploy the web app as the accessing user and restrict access to the configured Workspace domain.
5. Put synthetic, non-personal fixtures in the Inbox using the contracted UTC-token filenames.

## Ordered run

Run Steps 00–04. Step 04 must return `QUEUED`; follow `continueCxp13Ingestion` executions or allow its triggers to run until `cxp13GetRunStatus` is terminal. Record every invocation duration and verify a multi-invocation resume. Run Step 05 only after `SUCCESS`.

Run Step 06 to queue the identical bundle and wait for `DUPLICATE`. Separately exercise:

- a newest incomplete or invalid-header bundle (`VALIDATION_FAILED`, no raw mutation);
- a second start while the first is active (`INGESTION_RUN_ALREADY_ACTIVE`);
- the existing CXP-06 UAT mid-commit failure/rollback seam against the same active workbook, proving the prior valid dataset remains usable.

Record only the resulting booleans and maximum duration with `recordCxp13UatNegativeEvidence`. Then run Steps 07–08. Promotion requires no invocation at or above 270,000 ms, no Apps Script timeout, a successful multi-invocation resume, all negative gates, and `promotionReady: true` with `missing: []`.

Repeat the complete run in hosted UAT after DEV passes. Do not deploy or retarget PROD; CXP-14 owns cutover.

