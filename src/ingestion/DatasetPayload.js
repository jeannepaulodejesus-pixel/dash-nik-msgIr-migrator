var DatasetPayload = (function () {
  'use strict';

  var CONTRACT_NAME = 'DatasetPayload';
  var CONTRACT_VERSION = '1.0.0';

  function resolveRegistry() {
    if (typeof SchemaRegistry !== 'undefined') {
      return SchemaRegistry;
    }
    return require('./SchemaRegistry.js');
  }

  function resolveValidator() {
    if (typeof SchemaValidator !== 'undefined') {
      return SchemaValidator;
    }
    return require('./SchemaValidator.js');
  }

  function fail(code, message, details) {
    var Validator = resolveValidator();
    throw new Validator.SchemaContractError(code, message, details);
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizeSource(source) {
    if (!isPlainObject(source)) {
      fail('DATASET_INVALID_SOURCE', 'DatasetPayload source must be an object.');
    }
    var Registry = resolveRegistry();
    var supportedKinds = Object.keys(Registry.PACKAGING_CONTRACTS).map(function (name) {
      return Registry.PACKAGING_CONTRACTS[name].kind;
    });
    if (supportedKinds.indexOf(source.kind) === -1) {
      fail(
        'DATASET_INVALID_SOURCE',
        'DatasetPayload source.kind must select a registered packaging contract.',
        { kind: source.kind },
      );
    }
    if (typeof source.artifactId !== 'string' || !source.artifactId.trim()) {
      fail(
        'DATASET_INVALID_SOURCE',
        'DatasetPayload source.artifactId must be a nonblank string.',
      );
    }
    if (
      source.kind === Registry.PACKAGING_CONTRACTS.MULTI_SHEET_WORKBOOK.kind &&
      (typeof source.sheetName !== 'string' || !source.sheetName.trim())
    ) {
      fail(
        'DATASET_INVALID_SOURCE',
        'Multi-sheet workbook payloads require a nonblank source.sheetName.',
      );
    }
    return Object.freeze(Object.assign({}, source));
  }

  function normalizeRunMetadata(runMetadata, activeSchemaVersion) {
    if (!isPlainObject(runMetadata)) {
      fail(
        'DATASET_INVALID_RUN_METADATA',
        'DatasetPayload runMetadata must be an object.',
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(runMetadata, 'schemaVersion') &&
      runMetadata.schemaVersion !== activeSchemaVersion
    ) {
      fail(
        'SCHEMA_VERSION_MISMATCH',
        'Run metadata schemaVersion does not match the active registry version.',
        {
          activeSchemaVersion: activeSchemaVersion,
          suppliedSchemaVersion: runMetadata.schemaVersion,
        },
      );
    }
    return Object.freeze(
      Object.assign({}, runMetadata, { schemaVersion: activeSchemaVersion }),
    );
  }

  function create(input) {
    if (!isPlainObject(input)) {
      fail('DATASET_INVALID_PAYLOAD', 'DatasetPayload input must be an object.');
    }
    var Registry = resolveRegistry();
    var normalized = resolveValidator().normalizeRows(
      input.datasetName,
      input.headers,
      input.rows,
    );

    return Object.freeze({
      contract: CONTRACT_NAME,
      contractVersion: CONTRACT_VERSION,
      datasetName: normalized.datasetName,
      headers: normalized.headers,
      records: normalized.records,
      rowCount: normalized.records.length,
      runMetadata: normalizeRunMetadata(
        input.runMetadata,
        Registry.ACTIVE_SCHEMA_VERSION,
      ),
      schemaVersion: normalized.schemaVersion,
      source: normalizeSource(input.source),
    });
  }

  return Object.freeze({
    CONTRACT_NAME: CONTRACT_NAME,
    CONTRACT_VERSION: CONTRACT_VERSION,
    create: create,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DatasetPayload;
}
