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

After observing every scenario, set temporary Script Property `CXP13_UAT_PENDING_EVIDENCE_V1` to:

```json
{"duplicate":true,"invalid":true,"concurrency":true,"rollbackPreserved":true,"multiInvocation":true,"noTimeout":true,"permissionsVerified":true,"maxInvocationMs":123456}
```

Replace `123456` with the largest measured Apps Script invocation duration in milliseconds. Do not use total end-to-end run duration. Run parameterless `recordCxp13UatNegativeEvidence()`; it validates the object and consumes the temporary property. Then run Steps 07–08. Promotion requires no invocation at or above 270,000 ms, no Apps Script timeout, separately verified DEV/UAT web deployment identity and permissions, a successful multi-invocation resume, all negative gates, and `promotionReady: true` with `missing: []`.

Repeat the complete run in hosted UAT after DEV passes. Do not deploy or retarget PROD; CXP-14 owns cutover.
