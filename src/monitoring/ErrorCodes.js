var ErrorCodes = (function () {
  'use strict';

  var CATEGORIES = Object.freeze({
    INGESTION: 'INGESTION',
    LIFECYCLE: 'LIFECYCLE',
    MIGRATION_CALCULATION: 'MIGRATION_CALCULATION',
    PARITY: 'PARITY',
    REPORTING: 'REPORTING',
    SOURCE: 'SOURCE',
  });
  var FAILURE_STATES = Object.freeze({
    INGESTION: 'FAILED_INGESTION',
    LIFECYCLE: 'FAILED_LIFECYCLE',
    MIGRATION_CALCULATION: 'FAILED_MIGRATION_CALCULATION',
    PARITY: 'FAILED_PARITY',
    REPORTING: 'FAILED_REPORTING',
    SOURCE: 'FAILED_SOURCE',
  });
  var mutableCatalog = Object.create(null);

  function define(code, category, message, retryable) {
    mutableCatalog[code] = Object.freeze({
      category: category,
      code: code,
      message: message,
      retryable: retryable === true,
    });
  }

  define('SOURCE_FILE_NOT_FOUND', CATEGORIES.SOURCE, 'The source file was not found.', true);
  define(
    'SOURCE_UNSUPPORTED_FORMAT',
    CATEGORIES.SOURCE,
    'The source content format is not supported.',
    false,
  );
  define(
    'SOURCE_MULTIPLE_TABLES',
    CATEGORIES.SOURCE,
    'The source contains more than one table.',
    false,
  );
  define('SOURCE_RAGGED_ROWS', CATEGORIES.SOURCE, 'The source contains ragged rows.', false);
  define('SOURCE_INVALID_TABLE', CATEGORIES.SOURCE, 'The source table is invalid.', false);
  define(
    'SOURCE_FORMULAS_NOT_ALLOWED',
    CATEGORIES.SOURCE,
    'Source workbooks must contain values only.',
    false,
  );
  define(
    'SOURCE_DIVERGENT_DUPLICATE_KEY',
    CATEGORIES.SOURCE,
    'The source contains conflicting rows for the same business key.',
    false,
  );
  define(
    'SOURCE_INCOMPLETE_BUNDLE',
    CATEGORIES.SOURCE,
    'The source delivery does not contain exactly the required datasets.',
    false,
  );
  define(
    'SOURCE_DUPLICATE_SUBMISSION',
    CATEGORIES.SOURCE,
    'This source content was already processed successfully.',
    false,
  );
  define(
    'SOURCE_XLSX_CONVERSION_UNAVAILABLE',
    CATEGORIES.SOURCE,
    'XLSX conversion is not available in the current environment.',
    true,
  );
  define(
    'SOURCE_XLSX_CONVERSION_FAILED',
    CATEGORIES.SOURCE,
    'The XLSX source could not be converted to a values-only workbook.',
    true,
  );
  define(
    'SOURCE_TEMP_CLEANUP_FAILED',
    CATEGORIES.INGESTION,
    'A temporary conversion file could not be removed.',
    true,
  );
  define(
    'SCHEMA_UNKNOWN_DATASET',
    CATEGORIES.SOURCE,
    'The source dataset is not registered.',
    false,
  );
  define(
    'SCHEMA_INVALID_HEADERS',
    CATEGORIES.SOURCE,
    'The source header row is invalid.',
    false,
  );
  define(
    'SCHEMA_MISSING_REQUIRED_COLUMNS',
    CATEGORIES.SOURCE,
    'Required source columns are missing.',
    false,
  );
  define(
    'SCHEMA_UNEXPECTED_COLUMNS',
    CATEGORIES.SOURCE,
    'The source contains unexpected columns.',
    false,
  );
  define(
    'SCHEMA_DUPLICATE_COLUMNS',
    CATEGORIES.SOURCE,
    'The source contains duplicate canonical columns.',
    false,
  );
  define(
    'DATASET_ROW_VOLUME_OUT_OF_BOUNDS',
    CATEGORIES.SOURCE,
    'The source row count is outside the active schema bounds.',
    false,
  );
  define('DATASET_INVALID_ROW', CATEGORIES.SOURCE, 'A source row is invalid.', false);
  define('DATASET_ERROR_TOKEN', CATEGORIES.SOURCE, 'A raw error token was found.', false);
  define('DATASET_INVALID_TYPE', CATEGORIES.SOURCE, 'A source value has an invalid type.', false);
  define('DATASET_MISSING_KEY', CATEGORIES.SOURCE, 'A source key is blank.', false);
  define(
    'SCHEMA_VERSION_MISMATCH',
    CATEGORIES.INGESTION,
    'The supplied schema version is not active.',
    false,
  );
  define(
    'DATASET_INVALID_SOURCE',
    CATEGORIES.INGESTION,
    'The dataset source metadata is invalid.',
    false,
  );
  define(
    'DATASET_INVALID_RUN_METADATA',
    CATEGORIES.INGESTION,
    'The dataset run metadata is invalid.',
    false,
  );
  define(
    'DATASET_INVALID_PAYLOAD',
    CATEGORIES.INGESTION,
    'The normalized dataset payload is invalid.',
    false,
  );
  define(
    'INGESTION_INVALID_RUN_METADATA',
    CATEGORIES.INGESTION,
    'Required ingestion run metadata is invalid.',
    false,
  );
  define(
    'INGESTION_INVALID_OPERATIONS',
    CATEGORIES.INGESTION,
    'The ingestion operation contract is incomplete.',
    false,
  );
  define(
    'INGESTION_ILLEGAL_STATE_TRANSITION',
    CATEGORIES.INGESTION,
    'The requested run-state transition is illegal.',
    false,
  );
  define(
    'INGESTION_LOCK_TIMEOUT',
    CATEGORIES.INGESTION,
    'The production-write lock could not be acquired before timeout.',
    true,
  );
  define(
    'INGESTION_OPERATION_FAILED',
    CATEGORIES.INGESTION,
    'An ingestion operation failed.',
    true,
  );
  define(
    'INGESTION_FILE_LEDGER_SCHEMA_MISMATCH',
    CATEGORIES.INGESTION,
    'The file-ledger header does not match its controlled schema.',
    false,
  );
  define(
    'INGESTION_FILE_LEDGER_UNAVAILABLE',
    CATEGORIES.INGESTION,
    'The file ledger is unavailable.',
    true,
  );
  define(
    'INGESTION_FILE_LEDGER_READ_FAILED',
    CATEGORIES.INGESTION,
    'The file ledger could not be read.',
    true,
  );
  define(
    'INGESTION_FILE_LEDGER_WRITE_FAILED',
    CATEGORIES.INGESTION,
    'The file ledger could not be written.',
    true,
  );
  define(
    'MIGRATION_STAGE_WRITE_FAILED',
    CATEGORIES.MIGRATION_CALCULATION,
    'Staged data could not be written.',
    true,
  );
  define(
    'MIGRATION_STAGE_VALIDATION_FAILED',
    CATEGORIES.MIGRATION_CALCULATION,
    'Staged data validation failed.',
    false,
  );
  define(
    'MIGRATION_BACKUP_FAILED',
    CATEGORIES.MIGRATION_CALCULATION,
    'A recoverable raw-data backup could not be created.',
    true,
  );
  define(
    'MIGRATION_COMMIT_FAILED',
    CATEGORIES.MIGRATION_CALCULATION,
    'The production commit failed.',
    true,
  );
  define(
    'CALCULATION_RECALCULATION_FAILED',
    CATEGORIES.MIGRATION_CALCULATION,
    'Post-commit recalculation failed.',
    true,
  );
  define(
    'MIGRATION_RECOVERY_FAILED',
    CATEGORIES.MIGRATION_CALCULATION,
    'A prior transactional backup could not be reconciled safely.',
    true,
  );
  define(
    'UAT_BACKUP_TOPOLOGY_SEED_FAILED',
    CATEGORIES.MIGRATION_CALCULATION,
    'The controlled UAT backup topology could not be seeded safely.',
    false,
  );
  define(
    'MIGRATION_ROLLBACK_FAILED',
    CATEGORIES.MIGRATION_CALCULATION,
    'Raw data could not be restored to a verified safe state.',
    true,
  );
  define(
    'CALCULATION_HEALTH_CHECK_FAILED',
    CATEGORIES.MIGRATION_CALCULATION,
    'The post-commit health check failed.',
    true,
  );
  define(
    'REPORTING_LOG_SCHEMA_MISMATCH',
    CATEGORIES.REPORTING,
    'A controlled log sheet header does not match its schema.',
    false,
  );
  define(
    'REPORTING_LOG_WRITE_FAILED',
    CATEGORIES.REPORTING,
    'The run audit records could not be written.',
    true,
  );
  define(
    'PARITY_EXPORT_FOLDER_NOT_CONFIGURED',
    CATEGORIES.PARITY,
    'No legacy parity export folder is configured for the active environment.',
    false,
  );
  define(
    'PARITY_EXPORT_MANIFEST_INVALID',
    CATEGORIES.PARITY,
    'The legacy export manifest is invalid.',
    false,
  );
  define(
    'PARITY_EXPORT_CONTRACT_VERSION_MISMATCH',
    CATEGORIES.PARITY,
    'The legacy export contract version is not supported.',
    false,
  );
  define(
    'PARITY_EXPORT_FILE_MISSING',
    CATEGORIES.PARITY,
    'A contracted legacy export file is missing.',
    false,
  );
  define(
    'PARITY_EXPORT_FILE_UNEXPECTED',
    CATEGORIES.PARITY,
    'The legacy export folder contains an uncontracted file.',
    false,
  );
  define(
    'PARITY_EXPORT_DIGEST_MISMATCH',
    CATEGORIES.PARITY,
    'A legacy export file digest does not match the manifest.',
    false,
  );
  define(
    'PARITY_EXPORT_SCHEMA_DRIFT',
    CATEGORIES.PARITY,
    'A legacy export file does not match its canonical schema.',
    false,
  );
  define(
    'PARITY_EXPORT_ROW_COUNT_MISMATCH',
    CATEGORIES.PARITY,
    'A legacy export file row count does not match the manifest.',
    false,
  );
  define(
    'PARITY_EXPORT_DUPLICATE_KEY',
    CATEGORIES.PARITY,
    'The legacy export contains conflicting rows for the same key.',
    false,
  );
  define(
    'PARITY_EXPORT_MISSING_KEY',
    CATEGORIES.PARITY,
    'A legacy export authoritative key is blank.',
    false,
  );
  define(
    'PARITY_EXPORT_INVALID_TIMESTAMP',
    CATEGORIES.PARITY,
    'A legacy export timestamp is not an ISO UTC value.',
    false,
  );
  define(
    'PARITY_SOURCE_FINGERPRINT_MISMATCH',
    CATEGORIES.PARITY,
    'The legacy export fingerprint has no matching successful file-ledger entry.',
    false,
  );
  define(
    'PARITY_TARGET_SNAPSHOT_CHANGED',
    CATEGORIES.PARITY,
    'Ingestion replaced the migrated target while parity validation was running.',
    false,
  );
  define(
    'PARITY_BASELINE_UNAVAILABLE',
    CATEGORIES.PARITY,
    'The source-error baseline is unavailable.',
    true,
  );
  define(
    'PARITY_BASELINE_SCHEMA_MISMATCH',
    CATEGORIES.PARITY,
    'The source-error baseline header does not match its controlled schema.',
    false,
  );
  define(
    'PARITY_BASELINE_NOT_INSTALLED',
    CATEGORIES.PARITY,
    'The WB0817 source-error baseline is not installed.',
    false,
  );
  define(
    'PARITY_BASELINE_COUNT_MISMATCH',
    CATEGORIES.PARITY,
    'The installed source-error baseline does not equal the WB0817 authority.',
    false,
  );
  define(
    'PARITY_BASELINE_READ_FAILED',
    CATEGORIES.PARITY,
    'The source-error baseline could not be read.',
    true,
  );
  define(
    'PARITY_BASELINE_WRITE_FAILED',
    CATEGORIES.PARITY,
    'The source-error baseline could not be written.',
    true,
  );
  define(
    'PARITY_RESULTS_UNAVAILABLE',
    CATEGORIES.PARITY,
    'The parity results sheet is unavailable.',
    true,
  );
  define(
    'PARITY_RESULTS_SCHEMA_MISMATCH',
    CATEGORIES.PARITY,
    'The parity results header does not match its controlled schema.',
    false,
  );
  define(
    'PARITY_RESULTS_READ_FAILED',
    CATEGORIES.PARITY,
    'The parity results could not be read.',
    true,
  );
  define(
    'PARITY_RESULTS_WRITE_FAILED',
    CATEGORIES.PARITY,
    'The parity results could not be written.',
    true,
  );
  define(
    'PARITY_RUN_ALREADY_ACTIVE',
    CATEGORIES.PARITY,
    'Another parity run is already active.',
    false,
  );
  define(
    'PARITY_RUN_STATE_INVALID',
    CATEGORIES.PARITY,
    'The persisted parity run state is invalid.',
    false,
  );
  define(
    'PARITY_LOCK_TIMEOUT',
    CATEGORIES.PARITY,
    'The parity script lock could not be acquired before timeout.',
    true,
  );
  define(
    'LIFECYCLE_TEMPLATE_NOT_CONFIGURED',
    CATEGORIES.LIFECYCLE,
    'The master template spreadsheet ID is not configured.',
    false,
  );
  define(
    'LIFECYCLE_TEMPLATE_UNREADABLE',
    CATEGORIES.LIFECYCLE,
    'The master template spreadsheet could not be opened or copied.',
    true,
  );
  define(
    'LIFECYCLE_WEEK_KEY_INVALID',
    CATEGORIES.LIFECYCLE,
    'The week key must be a Monday ISO date (YYYY-MM-DD).',
    false,
  );
  define(
    'LIFECYCLE_ACTIVE_TARGET_MISMATCH',
    CATEGORIES.LIFECYCLE,
    'The ACTIVE week registry target does not match the configured target spreadsheet ID.',
    false,
  );
  define(
    'LIFECYCLE_ROLLOVER_LOCKED',
    CATEGORIES.LIFECYCLE,
    'Weekly rollover is refused while ingestion holds the script lock or a run is not terminal.',
    true,
  );
  define(
    'LIFECYCLE_ALREADY_ACTIVE',
    CATEGORIES.LIFECYCLE,
    'The requested week key is already ACTIVE.',
    false,
  );
  define(
    'LIFECYCLE_INIT_REFUSED_LIVE_DATA',
    CATEGORIES.LIFECYCLE,
    'Destructive week initialization was refused because live operational data is present.',
    false,
  );
  define(
    'LIFECYCLE_CONTROL_UNAVAILABLE',
    CATEGORIES.LIFECYCLE,
    'The control workbook or WEEK_REGISTRY sheet is unavailable.',
    true,
  );
  define(
    'LIFECYCLE_REGISTRY_SCHEMA_MISMATCH',
    CATEGORIES.LIFECYCLE,
    'The WEEK_REGISTRY header does not match its controlled schema.',
    false,
  );
  define(
    'HEALTH_MISSING_SHEETS',
    CATEGORIES.LIFECYCLE,
    'One or more required sheets are missing from the active workbook.',
    false,
  );
  define(
    'HEALTH_LAST_RUN_FAILED',
    CATEGORIES.LIFECYCLE,
    'The latest terminal run ended in a failure state.',
    true,
  );
  define(
    'HEALTH_STALE_DATA',
    CATEGORIES.LIFECYCLE,
    'The last successful run is older than the stale-data threshold.',
    true,
  );
  define(
    'HEALTH_RECALC_NOT_READY',
    CATEGORIES.LIFECYCLE,
    'Recalculation or post-commit health readiness is not satisfied.',
    true,
  );
  define(
    'PROMOTION_CHECKLIST_INCOMPLETE',
    CATEGORIES.LIFECYCLE,
    'The destination environment promotion checklist is incomplete.',
    false,
  );
  var CATALOG = Object.freeze(mutableCatalog);

  function RunError(code, options) {
    var definition = CATALOG[code];
    var resolvedOptions = options || {};
    this.name = 'RunError';
    this.code = code;
    this.category = definition.category;
    this.message = resolvedOptions.message || definition.message;
    this.details = Object.freeze(Object.assign({}, resolvedOptions.details || {}));
    this.retryable = definition.retryable;
    if (resolvedOptions.cause) {
      Object.defineProperty(this, 'cause', {
        configurable: false,
        enumerable: false,
        value: resolvedOptions.cause,
        writable: false,
      });
    }
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RunError);
    }
  }
  RunError.prototype = Object.create(Error.prototype);
  RunError.prototype.constructor = RunError;

  function get(code) {
    return CATALOG[code] || null;
  }

  function create(code, options) {
    if (!get(code)) {
      throw new Error('Unknown CXP error code: ' + code);
    }
    return new RunError(code, options);
  }

  function normalize(error, fallbackCode) {
    if (error instanceof RunError) {
      return error;
    }
    if (error && get(error.code)) {
      return create(error.code, {
        cause: error,
        details: error.details,
      });
    }
    return create(fallbackCode || 'INGESTION_OPERATION_FAILED', {
      cause: error,
      details: {
        originalName: error && typeof error.name === 'string' ? error.name : 'Error',
      },
    });
  }

  function failureStateFor(code) {
    var definition = get(code);
    if (!definition) {
      throw new Error('Unknown CXP error code: ' + code);
    }
    return FAILURE_STATES[definition.category];
  }

  return Object.freeze({
    CATALOG: CATALOG,
    CATEGORIES: CATEGORIES,
    FAILURE_STATES: FAILURE_STATES,
    RunError: RunError,
    create: create,
    failureStateFor: failureStateFor,
    get: get,
    normalize: normalize,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ErrorCodes;
}
