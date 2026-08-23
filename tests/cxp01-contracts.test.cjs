const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const workbookHash = 'CD8F8EC6F68FBEC85841CD64C251616FCECD0AD67DE4714EFB244F648548E65A';

function readJsonIfPresent(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

const expectedMetrics = [
  '% of Forecast Handled',
  '% of Forecast Offered',
  'ACW',
  'AHT',
  'AHT (Session)',
  'ASA in Seconds',
  'Abandoned',
  'Actual',
  'Actual (SO)',
  'Actual to Required',
  'Actual vs Required',
  'Allocation',
  'Chats in SL',
  'Concurrency',
  'Cumulative Allocation',
  'Forecast',
  'Handled',
  'Offered',
  'Required',
  'Required Hours',
  'SL % Total',
  'SL (Time To Connect)',
  'Scheduled',
  'Scheduled Hours',
  'Scheduled to Required',
].sort();

const expectedSheets = [
  ['Teams Update', 'visible'],
  ['Interval View', 'visible'],
  ['AHT Handled Offered', 'visible'],
  ['Drivers and Allocation', 'visible'],
  ['Data', 'visible'],
  ['Handled', 'visible'],
  ['Offered', 'visible'],
  ['AHT - Raw', 'visible'],
  ['Auxes - Raw', 'visible'],
  ['Backlogs', 'hidden'],
  ['pull outs for alloc', 'hidden'],
  ['Staff', 'visible'],
  ['Detail1', 'hidden'],
  ['Forecast and Allocation Pivot', 'visible'],
  ['SEF', 'visible'],
  ['MOM', 'visible'],
  ['Data Source', 'visible'],
];

const expectedTables = [
  ['Teams Update', 'Table6', 'E27:E31'],
  ['Handled', 'Handled', 'A1:AD6055'],
  ['Offered', 'Offered', 'A1:AP5717'],
  ['AHT - Raw', 'AHT_Raw', 'A1:AH7862'],
  ['Auxes - Raw', 'Table4', 'A1:AB3399'],
  ['Staff', 'ActualStaffAH', 'A2:BA1877'],
  ['Detail1', 'Table8', 'A3:F4'],
  ['SEF', 'Table510', 'B2:G1598'],
  ['SEF', 'Table5', 'W2:Z95'],
];

// Defect caught: promoting a similarly named or later screenshot version as the inspected binary.
test('binary object catalog is bound to the exact WB0817 workbook and inventories every object class', () => {
  const catalog = readJsonIfPresent('config/workbook-object-catalog.json');
  assert.ok(catalog, 'config/workbook-object-catalog.json must exist');

  assert.equal(catalog.evidenceStatus, 'verified_workbook_binary');
  assert.equal(catalog.source.sha256, workbookHash);
  assert.equal(catalog.source.fileName, 'MSG Intraday EOD 0817.xlsx');
  assert.equal(catalog.source.sizeBytes, 6975923);
  assert.deepEqual(catalog.sheets.map((sheet) => [sheet.name, sheet.state]), expectedSheets);
  assert.deepEqual(catalog.tables.map((table) => [table.sheet, table.name, table.ref]), expectedTables);
  assert.equal(catalog.pivotTables.length, 15);
  assert.equal(catalog.pivotCaches.length, 7);
  assert.ok(catalog.privacyBoundary.includes('refresh-actor metadata is excluded'));
  assert.ok(catalog.pivotCaches.every((cache) => !('refreshedBy' in cache)));
  assert.equal(catalog.slicers.collectionParts.length, 5);
  assert.equal(catalog.slicers.instances.length, 24);
  assert.equal(catalog.slicers.caches.length, 19);
  assert.equal(catalog.definedNames.length, 21);
  assert.equal(catalog.package.hasVbaProject, false);
  assert.equal(catalog.package.hasConnections, false);
  assert.deepEqual(catalog.package.externalLinkParts, []);
  assert.equal(catalog.package.hasDataModel, false);
  assert.doesNotMatch(JSON.stringify(catalog), /@[a-z0-9.-]+\.[a-z]{2,}/i);
});

// Defect caught: retaining aggregate EDA counts after the binary exposes exact formula families and a count discrepancy.
test('formula catalog preserves every formula cell, normalized family, and cached error', () => {
  const catalog = readJsonIfPresent('config/formula-family-catalog.json');
  assert.ok(catalog, 'config/formula-family-catalog.json must exist');

  assert.equal(catalog.sourceSha256, workbookHash);
  assert.equal(catalog.summary.totalFormulaCells, 271676);
  assert.equal(catalog.summary.normalizedFormulaFamilies, 350);
  assert.equal(catalog.summary.structuredReferenceFormulaCells, 172617);
  assert.equal(catalog.summary.thisRowStructuredReferenceCells, 172521);
  assert.equal(catalog.summary.getPivotDataFormulaCells, 1247);
  assert.equal(catalog.summary.cachedErrorCells, 1885);
  assert.equal(catalog.families.length, 350);
  assert.equal(catalog.families.reduce((sum, family) => sum + family.count, 0), 271676);
  assert.ok(catalog.families.every((family) => family.businessCategory));
  assert.ok(catalog.families.every((family) => family.coverageByColumn.length > 0));
  assert.deepEqual(catalog.cachedErrors.byType, {
    '#N/A': 1838,
    '#DIV/0!': 26,
    '#REF!': 21,
  });
});

// Defect caught: treating screenshot headers as lineage while leaving formulas, ranges, or source chains blank.
test('all 25 Interval View metrics have binary-verified formulas and an approved external-source parity boundary', () => {
  const contract = readJsonIfPresent('config/metric-lineage-contract.json');
  assert.ok(contract, 'config/metric-lineage-contract.json must exist');

  assert.equal(contract.sourceSha256, workbookHash);
  assert.equal(contract.output.sheet, 'Interval View');
  assert.equal(contract.output.headerRange, 'C112:AB112');
  assert.equal(contract.output.intervalRows, '113:150');
  assert.equal(contract.output.totalRow, 151);
  assert.deepEqual(contract.metrics.map((metric) => metric.name).sort(), expectedMetrics);
  for (const metric of contract.metrics) {
    assert.equal(metric.lineageStatus, 'verified_workbook_internal_lineage_source_schema_and_approved_intraday_parity_protocol');
    assert.equal(metric.outputLocation.sheet, 'Interval View');
    assert.ok(metric.outputLocation.intervalRange);
    assert.ok(metric.sampleFormula);
    assert.ok(metric.totalFormula);
    assert.ok(metric.formulaFamilies.length > 0);
    assert.equal(metric.formulaFamilies.reduce((sum, family) => sum + family.count, 0), 38);
    assert.ok(metric.formulaFamilies.every((family) => family.ranges.length > 0));
    assert.ok(metric.formulaFamilies.every((family) => family.sampleCell));
    assert.ok(metric.internalLineage.length > 0);
  }

  const byName = Object.fromEntries(contract.metrics.map((metric) => [metric.name, metric]));
  assert.equal(byName.Forecast.sampleFormula, 'IF(E113="",0,VLOOKUP(C113,Data!A3:I42,9,0))');
  assert.equal(byName.Allocation.sampleFormula, 'IFERROR(VLOOKUP(C113,\'Drivers and Allocation\'!G:K,3,0),"")');
  assert.equal(byName['AHT (Session)'].sampleFormula, 'IFERROR(GETPIVOTDATA("AHT Session",\'AHT Handled Offered\'!$B$106,"Interval View",$C113)/63,"")');
  assert.equal(byName['AHT (Session)'].totalFormula, 'GETPIVOTDATA("AHT Session ",\'AHT Handled Offered\'!$B$106)/60');
  assert.equal(byName['Actual (SO)'].sampleFormula, 'IF(E113="","",VLOOKUP(C113,Data!A:L,12,0))');
  assert.deepEqual(
    byName.Handled.formulaFamilies.map((family) => [family.count, family.ranges]),
    [
      [29, ['F122:F150']],
      [9, ['F113:F121']],
    ],
  );
  assert.ok(contract.anomalies.some((item) => item.id === 'METRIC-AHT-SESSION-DIVISOR-MISMATCH'));
  assert.ok(contract.anomalies.some((item) => item.id === 'METRIC-HANDLED-ZERO-BLANK-VARIANT'));
});

// Defect caught: confusing workbook-cached table rows with delivery-format source samples.
test('source table profile records exact workbook schemas and binds approved delivery semantics separately', () => {
  const profile = readJsonIfPresent('config/source-table-profile.json');
  const schema = readJsonIfPresent('config/source-schema-draft.json');
  assert.ok(profile, 'config/source-table-profile.json must exist');
  assert.ok(schema, 'config/source-schema-draft.json must exist');

  assert.equal(profile.sourceSha256, workbookHash);
  assert.equal(profile.externalSourceSamplesAvailable, true);
  assert.equal(profile.externalSourceAuthority, 'config/source-delivery-contract.json');
  assert.deepEqual(
    profile.datasets.map((dataset) => [
      dataset.name,
      dataset.workbookTable,
      dataset.rowCount,
      dataset.columns.filter((column) => column.role === 'calculated').length,
      dataset.columns.filter((column) => column.role === 'source_or_pasted').length,
    ]),
    [
      ['Handled', 'Handled', 6054, 3, 27],
      ['Offered', 'Offered', 5716, 15, 27],
      ['AHT - Raw', 'AHT_Raw', 7861, 7, 27],
      ['Auxes - Raw', 'Table4', 3398, 4, 24],
      ['Staff', 'ActualStaffAH', 1875, 48, 5],
    ],
  );
  assert.ok(profile.datasets.every((dataset) => dataset.columns.every((column) => !('sampleValues' in column))));
  assert.equal(profile.datasets.find((dataset) => dataset.name === 'Handled').rangeBoundaryProfile.overflowRows.populatedRowCount, 0);
  assert.equal(profile.datasets.find((dataset) => dataset.name === 'Staff').rangeBoundaryProfile.overflowColumns.populatedCellCount, 196);
  assert.equal(schema.status, 'approved_for_implementation');
  assert.equal(schema.schemaEvidenceAvailable, true);
  assert.equal(schema.externalSourceSamplesAvailable, true);
});

// Defect caught: claiming the partial-day files equal WB0817 EOD or leaving resolved owner decisions blocked.
test('migration contract distinguishes selected authority, screenshot history, and resolved parity semantics', () => {
  const contract = readJsonIfPresent('config/workbook-contract.json');
  assert.ok(contract, 'config/workbook-contract.json must exist');

  assert.equal(contract.status, 'complete');
  assert.equal(contract.authorities.workbookObjects, 'config/workbook-object-catalog.json');
  assert.equal(contract.authorities.formulaFamilies, 'config/formula-family-catalog.json');
  assert.equal(contract.authorities.metricLineage, 'config/metric-lineage-contract.json');
  assert.equal(contract.authorities.sourceTables, 'config/source-table-profile.json');
  assert.equal(contract.authorities.sourceDeliveries, 'config/source-delivery-contract.json');
  assert.equal(contract.versionComparison.inspectedWorkbook, 'WB0817');
  assert.equal(contract.versionComparison.screenshotWorkbook, 'WB0816');
  assert.equal(contract.versionComparison.status, 'resolved_user_selected_wb0817');
  assert.equal(contract.remainingGate.externalSourceSamples, 'verified');
  assert.equal(contract.remainingGate.validationVersionConfirmation, 'verified_wb0817');
  assert.equal(contract.remainingGate.sourceSnapshotParity, 'resolved_intraday_same_bundle_strategy');
  assert.equal(contract.remainingGate.manualInputAndSurfaceRetentionSemantics, 'resolved');
});

// Defect caught: treating WB0809 as authoritative or claiming EOD row parity from partial-day HTML exports.
test('WB0817 authority binds all five representative deliveries without overstating snapshot parity', () => {
  const objects = readJsonIfPresent('config/workbook-object-catalog.json');
  const formulas = readJsonIfPresent('config/formula-family-catalog.json');
  const metrics = readJsonIfPresent('config/metric-lineage-contract.json');
  const tables = readJsonIfPresent('config/source-table-profile.json');
  const deliveries = readJsonIfPresent('config/source-delivery-contract.json');
  const workbook = readJsonIfPresent('config/workbook-contract.json');

  assert.ok(deliveries, 'config/source-delivery-contract.json must exist');
  assert.equal(objects.source.sha256, workbookHash);
  assert.equal(objects.source.fileName, 'MSG Intraday EOD 0817.xlsx');
  assert.equal(objects.source.sizeBytes, 6975923);
  assert.equal(formulas.sourceSha256, workbookHash);
  assert.equal(formulas.summary.totalFormulaCells, 271676);
  assert.equal(formulas.summary.normalizedFormulaFamilies, 350);
  assert.equal(formulas.summary.cachedErrorCells, 1885);
  assert.equal(metrics.sourceSha256, workbookHash);
  assert.equal(tables.sourceSha256, workbookHash);
  assert.equal(tables.externalSourceSamplesAvailable, true);

  assert.equal(deliveries.validationAuthority.decision, 'WB0817');
  assert.equal(deliveries.validationAuthority.controlSha256, workbookHash);
  assert.equal(deliveries.sourceFileCount, 5);
  assert.deepEqual(
    deliveries.datasets.map((dataset) => [
      dataset.dataset,
      dataset.sourceFile.sha256,
      dataset.sourceFile.sizeBytes,
      dataset.physicalLayout.rowCount,
      dataset.physicalLayout.columnCount,
      dataset.workbookTarget.cachedPopulatedRows,
    ]),
    [
      ['AHT - Raw', '61590C6CE8F4B3388D4A310359431D092DAA3899637BB95F2BE18454CBEECED4', 2004591, 1969, 27, 6656],
      ['Auxes - Raw', '5004B86A0428DB3A0EFE3021A4094D285A90F824EF969CA2F35304E484F12677', 639885, 754, 24, 2904],
      ['Handled', 'C4BB2747A36BA191E847037D412B89052FDD65D3B8E25F80A8E6CBEC6C5D25E0', 2078037, 1614, 27, 5024],
      ['Offered', '78C944F41913FD4EDFAE26AF11DABE3D24BC2D5E4947E01FA6E3AB8423E293F8', 2068657, 1652, 27, 4797],
      ['Staff', 'E57C24CD70AF2170B12B2CB41AD3EB089781A6DB830A7B90CAAACD3DA5D321F1', 22255, 87, 5, 306],
    ],
  );
  assert.ok(deliveries.datasets.every((dataset) => dataset.sourceFile.detectedContentType === 'text/html'));
  assert.ok(deliveries.datasets.every((dataset) => dataset.sourceFile.declaredExtension === '.xls'));
  assert.ok(deliveries.datasets.every((dataset) => dataset.reconciliation.orderedHeadersMatchAfterAliases));
  assert.ok(deliveries.datasets.every((dataset) => dataset.reconciliation.rowCountsMatch === false));
  assert.ok(deliveries.datasets.every((dataset) => dataset.privacyBoundary.literalValuesRetained === false));
  assert.doesNotMatch(JSON.stringify(deliveries), /@[a-z0-9.-]+\.[a-z]{2,}/i);

  const aht = deliveries.datasets.find((dataset) => dataset.dataset === 'AHT - Raw');
  assert.deepEqual(aht.reconciliation.headerAliasMappings, [
    { rawHeader: 'Speed to Answer', workbookHeader: 'Speed to Answer2' },
  ]);
  assert.equal(aht.reconciliation.keyReconciliation.commonKeyCount, 1969);
  assert.equal(aht.reconciliation.keyReconciliation.valueEquivalentRowMatchCountOnCommonKeys, 1898);

  assert.equal(workbook.status, 'complete');
  assert.equal(workbook.versionComparison.status, 'resolved_user_selected_wb0817');
  assert.equal(workbook.remainingGate.externalSourceSamples, 'verified');
  assert.equal(workbook.remainingGate.sourceSnapshotParity, 'resolved_intraday_same_bundle_strategy');
  assert.equal(workbook.remainingGate.timezoneAndReplacementSemantics, 'resolved');
});

test('CXP-01 traceability and resolved-decision documents are present', () => {
  const requiredFiles = [
    'docs/workbook-inventory.md',
    'docs/dependency-map.md',
    'docs/metric-lineage.md',
    'docs/formula-family-catalog.md',
    'docs/source-delivery-contract.md',
    'docs/open-contract-questions.md',
    'docs/decision-needed.md',
  ];

  for (const relativePath of requiredFiles) {
    assert.equal(
      fs.existsSync(path.join(projectRoot, relativePath)),
      true,
      `${relativePath} must exist`,
    );
  }

  const decisionNeeded = fs.readFileSync(path.join(projectRoot, 'docs/decision-needed.md'), 'utf8');
  const packetStatus = fs.readFileSync(path.join(projectRoot, 'docs/packet-status.md'), 'utf8');
  for (const requiredDecision of [
    'Data columns B, D, F, M, R, and X',
    'Staff BE:BF',
    'Aux Productive pivot',
    'Backlogs and Detail1',
  ]) {
    assert.ok(decisionNeeded.includes(requiredDecision), `DN-002 must carry ${requiredDecision}`);
  }
  assert.match(packetStatus, /\| CXP-01 — Legacy Workbook Reverse Engineering and Migration Contract \| Complete \|/);
  assert.ok(packetStatus.includes('**Blockers:** None for CXP-01.'));
});

// Defect caught: treating GMT export text as if it were already PST or claiming the legacy core formulas convert it.
test('GMT exports are converted to fixed PST before business-date and interval bucketing', () => {
  const workbook = readJsonIfPresent('config/workbook-contract.json');
  const schema = readJsonIfPresent('config/source-schema-draft.json');
  const formulas = readJsonIfPresent('config/formula-family-catalog.json');
  const metrics = readJsonIfPresent('config/metric-lineage-contract.json');
  const SheetNames = require('../src/config/SheetNames.js');

  assert.equal(workbook.contractVersion, '1.0.2');
  assert.deepEqual(workbook.timezoneRevision.current, {
    source: {
      timeZoneLabel: 'GMT',
      timeZoneId: 'Etc/UTC',
      fixedUtcOffset: '+00:00',
      dstPolicy: 'fixed_offset_no_dst',
    },
    business: {
      timeZoneLabel: 'PST',
      timeZoneId: 'Etc/GMT+8',
      fixedUtcOffset: '-08:00',
      dstPolicy: 'fixed_offset_no_dst',
    },
    conversion: {
      required: true,
      offsetMinutes: -480,
      appliesTo: 'date_time_values_only',
      applyBefore: 'business_date_and_30_minute_bucket',
      legacyCorePath: 'not_found',
      disposition: 'approved_migration_defect_correction',
    },
  });
  assert.equal(
    workbook.timezoneRevision.evidence.operatorUiScreenshot.sha256,
    '7258F584DB24D8B5F484DBE5AC00F2ED8445AB70ADBE9D5FF960703EA9DD7BD1',
  );
  assert.equal(
    workbook.timezoneRevision.evidence.operatorUiScreenshot.classification,
    'user_display_setting_not_export_timezone_authority',
  );
  assert.equal(
    workbook.timezoneRevision.evidence.legacyFormulaReview.converterStatus,
    'not_found_on_core_source_to_interval_paths',
  );

  assert.equal(schema.contractVersion, '1.0.2');
  assert.deepEqual(schema.timeSemantics.sourceTimeZone, {
    timeZoneLabel: 'GMT',
    timeZoneId: 'Etc/UTC',
    fixedUtcOffset: '+00:00',
    dstPolicy: 'fixed_offset_no_dst',
    naiveTimestampInterpretation: 'interpret_as_UTC',
  });
  assert.deepEqual(schema.timeSemantics.businessTimeZone, {
    timeZoneLabel: 'PST',
    timeZoneId: 'Etc/GMT+8',
    fixedUtcOffset: '-08:00',
    dstPolicy: 'fixed_offset_no_dst',
  });
  assert.deepEqual(schema.timeSemantics.conversion, {
    required: true,
    offsetMinutes: -480,
    appliesTo: 'date_time_values_only',
    applyBefore: 'business_date_and_30_minute_bucket',
    preserveRawUtcTimestamp: true,
    legacyDisposition: 'approved_migration_defect_correction',
  });
  assert.equal(
    schema.parityStrategy.legacyIntervalAlignmentRule,
    'Subtract 480 minutes from each legacy GMT-bucket interval key before comparing it with the migrated fixed-PST interval key.',
  );
  assert.equal(
    schema.parityStrategy.timezoneVarianceDisposition,
    'approved_expected_variance_from_legacy_missing_conversion',
  );

  const coreSheets = new Set(['AHT - Raw', 'Handled', 'Offered', 'Auxes - Raw']);
  const coreIntervalFamilies = formulas.families.filter(
    (family) =>
      coreSheets.has(family.sheet) &&
      /TIME\(HOUR\(/.test(family.normalizedFormula) &&
      /FLOOR\(MINUTE\(/.test(family.normalizedFormula),
  );
  assert.equal(coreIntervalFamilies.length, 5);
  for (const family of coreIntervalFamilies) {
    assert.doesNotMatch(family.normalizedFormula, /[+-]\s*TIME\(/);
    assert.doesNotMatch(family.normalizedFormula, /MOD\(/);
  }
  const negativeTimeShiftFamilies = formulas.families.filter((family) =>
    /-\s*TIME\(/.test(family.normalizedFormula),
  );
  assert.deepEqual(
    negativeTimeShiftFamilies.map((family) => [family.sheet, family.normalizedFormula]),
    [['Teams Update', 'TEXT(MOD(R[0]C[-1] - TIME(15,0,0), 1), "h:mm AM/PM")']],
  );

  const timezoneAnomaly = metrics.anomalies.find(
    (item) => item.id === 'WORKBOOK-MISSING-GMT-TO-PST-CONVERTER',
  );
  assert.equal(timezoneAnomaly.disposition, 'approved_migration_defect_correction');
  assert.equal(SheetNames.SOURCE_TIME_ZONE, 'Etc/UTC');
  assert.equal(SheetNames.BUSINESS_TIME_ZONE, 'Etc/GMT+8');
  assert.equal(SheetNames.SOURCE_TO_BUSINESS_OFFSET_MINUTES, -480);
});

// Defect caught: changing the source timezone must not make the report workbook daylight-aware or UTC.
test('approved operating decisions close CXP-01 with an explicit intraday parity and ingestion contract', () => {
  const workbook = readJsonIfPresent('config/workbook-contract.json');
  const schema = readJsonIfPresent('config/source-schema-draft.json');
  const metrics = readJsonIfPresent('config/metric-lineage-contract.json');
  const manifest = readJsonIfPresent('src/appsscript.json');
  const packetStatus = fs.readFileSync(path.join(projectRoot, 'docs/packet-status.md'), 'utf8');
  const decisionNeeded = fs.readFileSync(path.join(projectRoot, 'docs/decision-needed.md'), 'utf8');
  const decisionLog = fs.readFileSync(path.join(projectRoot, 'docs/decision-log.md'), 'utf8');

  assert.equal(workbook.contractVersion, '1.0.2');
  assert.equal(workbook.status, 'complete');
  assert.equal(workbook.remainingGate.sourceSnapshotParity, 'resolved_intraday_same_bundle_strategy');
  assert.equal(workbook.remainingGate.timezoneAndReplacementSemantics, 'resolved');
  assert.equal(workbook.remainingGate.manualInputAndSurfaceRetentionSemantics, 'resolved');
  assert.equal(
    workbook.remainingGate.formulaAndErrorAnomalyClassification,
    'resolved_mixed_intentional_and_approved_timezone_correction',
  );
  assert.equal(workbook.timezoneRevision.current.source.timeZoneId, 'Etc/UTC');
  assert.equal(workbook.timezoneRevision.current.business.timeZoneId, 'Etc/GMT+8');
  assert.equal(workbook.timezoneRevision.current.conversion.offsetMinutes, -480);

  assert.equal(schema.contractVersion, '1.0.2');
  assert.equal(schema.status, 'approved_for_implementation');
  assert.deepEqual(schema.requiredEvidenceToResolve, []);
  assert.deepEqual(schema.timeSemantics, {
    sourceTimeZone: {
      timeZoneLabel: 'GMT',
      timeZoneId: 'Etc/UTC',
      fixedUtcOffset: '+00:00',
      dstPolicy: 'fixed_offset_no_dst',
      naiveTimestampInterpretation: 'interpret_as_UTC',
    },
    businessTimeZone: {
      timeZoneLabel: 'PST',
      timeZoneId: 'Etc/GMT+8',
      fixedUtcOffset: '-08:00',
      dstPolicy: 'fixed_offset_no_dst',
    },
    conversion: {
      required: true,
      offsetMinutes: -480,
      appliesTo: 'date_time_values_only',
      applyBefore: 'business_date_and_30_minute_bucket',
      preserveRawUtcTimestamp: true,
      legacyDisposition: 'approved_migration_defect_correction',
    },
    sourceLocale: 'en-US',
    acceptedDateTimeFormats: ['M/d/yyyy h:mm AM/PM'],
    acceptedDateFormats: ['M/d/yyyy'],
    dateOnlyPolicy: 'preserve_calendar_date_without_timezone_conversion',
    ambiguousTimestampPolicy: 'not_applicable_fixed_offset',
    nonexistentTimestampPolicy: 'not_applicable_fixed_offset',
    bucketMinutes: 30,
    bucketBoundary: 'left_closed_right_open',
    bucketFormula: 'TIME(HOUR(businessTimestamp),FLOOR(MINUTE(businessTimestamp),30),0)',
  });
  assert.equal(schema.parityStrategy.status, 'approved');
  assert.equal(schema.parityStrategy.checkpointIdentity, 'five_file_bundle_run_id_and_acquisition_timestamp');
  assert.equal(schema.parityStrategy.legacyControl, 'fresh_legacy_copy_loaded_from_the_same_five_file_bundle');
  assert.equal(schema.parityStrategy.compareOnlyClosedIntervals, true);
  assert.equal(
    schema.parityStrategy.closedIntervalRule,
    'Convert the GMT acquisition timestamp to fixed PST, then compare buckets whose fixed-PST right boundary is at or before that checkpoint.',
  );
  assert.equal(manifest.timeZone, 'Etc/GMT+8');
  for (const [utcSample, expectedMonth] of [
    ['2026-01-17T08:00:00Z', '01'],
    ['2026-08-17T08:00:00Z', '08'],
  ]) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: manifest.timeZone,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(new Date(utcSample)).map(({ type, value }) => [type, value]),
    );
    assert.deepEqual(
      { month: parts.month, day: parts.day, hour: parts.hour },
      { month: expectedMonth, day: '17', hour: '00' },
      'Etc/GMT+8 must remain UTC-08:00 in both winter and summer',
    );
  }
  assert.equal(schema.ingestionSemantics.replacementMode, 'replace_full_export');
  assert.equal(schema.ingestionSemantics.allHeadersRequired, true);
  assert.equal(schema.ingestionSemantics.headerOrderRequired, true);
  assert.equal(schema.ingestionSemantics.duplicatePolicy, 'collapse_exact_canonical_row_duplicates_only');
  assert.equal(schema.ingestionSemantics.divergentDuplicateKeyPolicy, 'fail_validation');
  assert.equal(
    schema.ingestionSemantics.canonicalRowDefinition,
    'required_header_order_after_HTML_entity_decode_before_type_coercion',
  );
  assert.deepEqual(schema.ingestionSemantics.blankAndErrorPolicy.acceptedBlankTokens, ['', 'whitespace_only']);
  assert.equal(
    schema.ingestionSemantics.blankAndErrorPolicy.blankNormalization,
    'trim_then_null; never synthesize a default; authoritative key cells must be nonblank',
  );
  assert.deepEqual(schema.ingestionSemantics.blankAndErrorPolicy.acceptedErrorTokens, []);
  assert.equal(schema.ingestionSemantics.blankAndErrorPolicy.rejectedErrorTokenPattern, '^#');
  assert.deepEqual(schema.ingestionSemantics.blankAndErrorPolicy.rejectedErrorTokens, [
    '#N/A',
    '#REF!',
    '#DIV/0!',
    '#VALUE!',
    '#NAME?',
    '#NUM!',
    '#NULL!',
    '#ERROR!',
  ]);
  assert.equal(schema.ingestionSemantics.blankAndErrorPolicy.errorTokenComparison, 'case_insensitive_exact_token');
  assert.equal(schema.ingestionSemantics.blankAndErrorPolicy.naTextPolicy, 'NA is ordinary text, not a null token');

  assert.deepEqual(
    schema.logicalDatasets.map((dataset) => [dataset.name, dataset.authoritativeKey, dataset.dedupeKey]),
    [
      ['Handled', ['Messaging Session Name'], null],
      ['Offered', ['Messaging Session Name'], null],
      ['AHT - Raw', ['Agent Work ID'], null],
      ['Auxes - Raw', ['User Presence ID'], null],
      ['Staff', null, 'canonical_full_row_hash'],
    ],
  );
  assert.ok(schema.logicalDatasets.every((dataset) => dataset.allHeadersRequired === true));
  assert.ok(
    schema.logicalDatasets.every(
      (dataset) => dataset.duplicatePolicy === 'collapse_exact_canonical_row_duplicates_only',
    ),
  );
  assert.equal(schema.manualDependencies.dataColumnsSource, 'RTA_pastes_from_Staff');
  assert.equal(schema.manualDependencies.staffSummaryMatrix, 'Staff_BE_BF_copied_into_Data');
  assert.equal(schema.manualDependencies.auxProductivePivot, 'required_operational_dependency');
  assert.equal(schema.manualDependencies.backlogsAndDetail1, 'retire_if_no_direct_Interval_View_dependency');

  const anomalyById = Object.fromEntries(metrics.anomalies.map((item) => [item.id, item]));
  for (const anomalyId of [
    'METRIC-AHT-SESSION-DIVISOR-MISMATCH',
    'METRIC-SCHEDULED-TO-REQUIRED-NO-ERROR-GUARD',
    'METRIC-HANDLED-ZERO-BLANK-VARIANT',
    'WORKBOOK-CACHED-ERRORS',
    'WORKBOOK-BROKEN-NAMES-AND-REFERENCES',
  ]) {
    assert.equal(anomalyById[anomalyId].disposition, 'intentional_legacy_behavior');
  }
  assert.equal(anomalyById['SOURCE-SNAPSHOT-CUTOFF-MISMATCH'].disposition, 'resolved_by_intraday_same_bundle_strategy');

  assert.match(packetStatus, /\| CXP-01 — Legacy Workbook Reverse Engineering and Migration Contract \| Complete \|/);
  assert.ok(packetStatus.includes('CXP-01-v3'));
  assert.ok(decisionNeeded.includes('Status:** Resolved on 2026-08-22'));
  assert.ok(decisionNeeded.includes('interpret source datetime values as GMT/UTC'));
  assert.ok(decisionNeeded.includes('legacy interval keys by minus 480 minutes'));
  assert.ok(decisionLog.includes('DEC-021 — Fixed PST replaces daylight-aware Pacific time'));
  assert.ok(decisionLog.includes('DEC-025 — GMT exports require explicit fixed-PST normalization'));
});
