/**
 * CXP-11 parity contracts: versioned legacy-export packaging, tolerance and
 * source-error semantics, classification vocabulary, and state-machine states.
 *
 * Pure constants and derivations only. No Apps Script service is captured here.
 */
var ParityContracts = (function () {
  'use strict';

  var CONTRACT_VERSION = '1.0.0';

  var MANIFEST_FILE_NAME = 'manifest.json';
  var METRIC_FILE_NAME = 'metrics.csv';
  var LEGACY_ERROR_FILE_NAME = 'legacy-errors.csv';

  var FILE_KINDS = Object.freeze({
    legacyError: 'LEGACY_ERROR',
    metric: 'METRIC',
    sourceTable: 'SOURCE_TABLE',
  });

  var DATASET_FILES = Object.freeze([
    Object.freeze({ datasetName: 'Handled', fileName: 'handled.csv' }),
    Object.freeze({ datasetName: 'Offered', fileName: 'offered.csv' }),
    Object.freeze({ datasetName: 'AHT - Raw', fileName: 'aht-raw.csv' }),
    Object.freeze({ datasetName: 'Auxes - Raw', fileName: 'auxes-raw.csv' }),
    Object.freeze({ datasetName: 'Staff', fileName: 'staff.csv' }),
  ]);

  var METRIC_CSV_HEADERS = Object.freeze([
    'Business Date',
    'Interval Start',
    'Site',
    'Queue Or LOB',
    'Metric',
    'Aggregation Identity',
    'Value',
  ]);

  var LEGACY_ERROR_CSV_HEADERS = Object.freeze([
    'Worksheet',
    'Cell Or Range',
    'Error Token',
    'Formula Family',
    'Observed Count',
  ]);

  var MANIFEST_REQUIRED_FIELDS = Object.freeze([
    'contractVersion',
    'acquisitionTimestampUtc',
    'sourceBundleFingerprint',
    'controlWorkbookSha256',
    'baselineVersion',
    'files',
  ]);

  // WB0817 is the sole parity authority. The 5,655 count belongs to the
  // superseded WB0809 / project-record state and must never be asserted.
  var BASELINE_VERSION = 'WB0817';
  var CONTROL_WORKBOOK_SHA256 =
    'CD8F8EC6F68FBEC85841CD64C251616FCECD0AD67DE4714EFB244F648548E65A';
  var BASELINE_TOTAL_ERRORS = 1885;
  var BASELINE_ERRORS_BY_TYPE = Object.freeze({
    '#N/A': 1838,
    '#DIV/0!': 26,
    '#REF!': 21,
  });
  var SUPERSEDED_BASELINE_TOTAL_ERRORS = 5655;

  var ERROR_TOKENS = Object.freeze([
    '#N/A',
    '#REF!',
    '#DIV/0!',
    '#VALUE!',
    '#NAME?',
    '#NUM!',
    '#NULL!',
    '#ERROR!',
  ]);

  // DEC-025: legacy interval keys are floored from raw UTC hours. Shift them
  // into fixed PST (UTC-08:00) before matching migrated keys.
  var LEGACY_INTERVAL_SHIFT_MINUTES = -480;
  var INTERVAL_MINUTES = 30;
  var ABSOLUTE_TOLERANCE = 1e-9;

  // Integer-formatted metrics and counts compare exactly; ratio, percentage,
  // and duration metrics use the absolute tolerance.
  var EXACT_METRICS = Object.freeze([
    'Forecast',
    'Offered',
    'Handled',
    'Chats in SL',
    'Abandoned',
    'Scheduled',
    'Required',
    'Actual (SO)',
    'Actual vs Required',
  ]);

  var TOLERANCE_METRICS = Object.freeze([
    'SL % Total',
    'SL (Time To Connect)',
    '% of Forecast Offered',
    '% of Forecast Handled',
    'Allocation',
    'Cumulative Allocation',
    'AHT (Session)',
    'AHT',
    'ACW',
    'ASA in Seconds',
    'Concurrency',
    'Scheduled Hours',
    'Required Hours',
    'Actual',
    'Actual to Required',
    'Scheduled to Required',
  ]);

  var CLASSIFICATIONS = Object.freeze({
    approvedExpectedVariance: 'APPROVED_EXPECTED_VARIANCE',
    expectedSourceError: 'EXPECTED_SOURCE_ERROR',
    invalidInput: 'INVALID_INPUT',
    match: 'MATCH',
    migrationDefect: 'MIGRATION_DEFECT',
    missingSource: 'MISSING_SOURCE',
    missingTarget: 'MISSING_TARGET',
  });

  var RESOLUTION_STATUSES = Object.freeze({
    closedExpected: 'CLOSED_EXPECTED',
    notRequired: 'NOT_REQUIRED',
    open: 'OPEN',
  });

  var DEFECT_CLASSIFICATIONS = Object.freeze([
    CLASSIFICATIONS.migrationDefect,
    CLASSIFICATIONS.missingSource,
    CLASSIFICATIONS.missingTarget,
    CLASSIFICATIONS.invalidInput,
  ]);

  var SETUP_STATES = Object.freeze({
    complete: 'COMPLETE',
    failed: 'FAILED',
    idle: 'IDLE',
    running: 'RUNNING',
  });

  var RUN_STATES = Object.freeze({
    complete: 'COMPLETE',
    errorClassification: 'ERROR_CLASSIFICATION',
    failed: 'FAILED',
    metrics: 'METRICS',
    preflight: 'PREFLIGHT',
    sourceTables: 'SOURCE_TABLES',
    summarizing: 'SUMMARIZING',
  });

  var RUN_STATE_ORDER = Object.freeze([
    RUN_STATES.preflight,
    RUN_STATES.sourceTables,
    RUN_STATES.metrics,
    RUN_STATES.errorClassification,
    RUN_STATES.summarizing,
    RUN_STATES.complete,
  ]);

  var LINEAGE_REFERENCES = Object.freeze({
    dec025: 'DEC-025',
    metricLineage: 'docs/metric-lineage.md',
    sourceErrorBaseline: 'SOURCE_ERROR_BASELINE',
  });

  var COOPERATIVE_BUDGET_MS = 240000;
  var SOURCE_TABLE_BATCH_ROWS = 250;
  var METRIC_BATCH_SIZE = 5;

  function resolveReportingModel() {
    if (typeof ReportingSurfaceReferenceModel !== 'undefined') {
      return ReportingSurfaceReferenceModel;
    }
    return require('../transformations/ReportingSurfaceReferenceModel.js');
  }

  function resolveSchemaRegistry() {
    if (typeof SchemaRegistry !== 'undefined') {
      return SchemaRegistry;
    }
    return require('../ingestion/SchemaRegistry.js');
  }

  function listMetrics() {
    return resolveReportingModel().METRIC_ORDER.slice();
  }

  function datasetFileFor(datasetName) {
    return DATASET_FILES.filter(function (entry) {
      return entry.datasetName === datasetName;
    })[0] || null;
  }

  function listExportFileNames() {
    return [MANIFEST_FILE_NAME]
      .concat(DATASET_FILES.map(function (entry) { return entry.fileName; }))
      .concat([METRIC_FILE_NAME, LEGACY_ERROR_FILE_NAME]);
  }

  /**
   * Ordered canonical headers for a legacy source-table CSV. The legacy export
   * mirrors the CXP-03 normalized table so comparison is header-position exact.
   */
  function datasetHeaders(datasetName) {
    var schema = resolveSchemaRegistry().getSchema(datasetName);
    if (!schema) {
      return null;
    }
    return schema.requiredHeaders.slice();
  }

  function datasetKeyFields(datasetName) {
    var schema = resolveSchemaRegistry().getSchema(datasetName);
    if (!schema) {
      return null;
    }
    return schema.keyFields.slice();
  }

  function toleranceFor(metricName) {
    if (EXACT_METRICS.indexOf(metricName) >= 0) {
      return 0;
    }
    if (TOLERANCE_METRICS.indexOf(metricName) >= 0) {
      return ABSOLUTE_TOLERANCE;
    }
    return null;
  }

  function isErrorToken(value) {
    return typeof value === 'string' &&
      ERROR_TOKENS.indexOf(value.trim().toUpperCase()) >= 0;
  }

  function resolutionFor(classification) {
    if (classification === CLASSIFICATIONS.match) {
      return RESOLUTION_STATUSES.notRequired;
    }
    if (
      classification === CLASSIFICATIONS.expectedSourceError ||
      classification === CLASSIFICATIONS.approvedExpectedVariance
    ) {
      return RESOLUTION_STATUSES.closedExpected;
    }
    return RESOLUTION_STATUSES.open;
  }

  function isDefect(classification) {
    return DEFECT_CLASSIFICATIONS.indexOf(classification) >= 0;
  }

  return Object.freeze({
    ABSOLUTE_TOLERANCE: ABSOLUTE_TOLERANCE,
    BASELINE_ERRORS_BY_TYPE: BASELINE_ERRORS_BY_TYPE,
    BASELINE_TOTAL_ERRORS: BASELINE_TOTAL_ERRORS,
    BASELINE_VERSION: BASELINE_VERSION,
    CLASSIFICATIONS: CLASSIFICATIONS,
    CONTRACT_VERSION: CONTRACT_VERSION,
    CONTROL_WORKBOOK_SHA256: CONTROL_WORKBOOK_SHA256,
    COOPERATIVE_BUDGET_MS: COOPERATIVE_BUDGET_MS,
    DATASET_FILES: DATASET_FILES,
    DEFECT_CLASSIFICATIONS: DEFECT_CLASSIFICATIONS,
    ERROR_TOKENS: ERROR_TOKENS,
    EXACT_METRICS: EXACT_METRICS,
    FILE_KINDS: FILE_KINDS,
    INTERVAL_MINUTES: INTERVAL_MINUTES,
    LEGACY_ERROR_CSV_HEADERS: LEGACY_ERROR_CSV_HEADERS,
    LEGACY_ERROR_FILE_NAME: LEGACY_ERROR_FILE_NAME,
    LEGACY_INTERVAL_SHIFT_MINUTES: LEGACY_INTERVAL_SHIFT_MINUTES,
    LINEAGE_REFERENCES: LINEAGE_REFERENCES,
    MANIFEST_FILE_NAME: MANIFEST_FILE_NAME,
    MANIFEST_REQUIRED_FIELDS: MANIFEST_REQUIRED_FIELDS,
    METRIC_BATCH_SIZE: METRIC_BATCH_SIZE,
    METRIC_CSV_HEADERS: METRIC_CSV_HEADERS,
    METRIC_FILE_NAME: METRIC_FILE_NAME,
    RESOLUTION_STATUSES: RESOLUTION_STATUSES,
    RUN_STATES: RUN_STATES,
    RUN_STATE_ORDER: RUN_STATE_ORDER,
    SETUP_STATES: SETUP_STATES,
    SOURCE_TABLE_BATCH_ROWS: SOURCE_TABLE_BATCH_ROWS,
    SUPERSEDED_BASELINE_TOTAL_ERRORS: SUPERSEDED_BASELINE_TOTAL_ERRORS,
    TOLERANCE_METRICS: TOLERANCE_METRICS,
    datasetFileFor: datasetFileFor,
    datasetHeaders: datasetHeaders,
    datasetKeyFields: datasetKeyFields,
    isDefect: isDefect,
    isErrorToken: isErrorToken,
    listExportFileNames: listExportFileNames,
    listMetrics: listMetrics,
    resolutionFor: resolutionFor,
    toleranceFor: toleranceFor,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ParityContracts;
}
