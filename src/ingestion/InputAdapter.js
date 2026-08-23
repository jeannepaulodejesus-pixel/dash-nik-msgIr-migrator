var InputAdapter = (function () {
  'use strict';

  function resolveDatasetAdapter() {
    if (typeof DatasetAdapter !== 'undefined') {
      return DatasetAdapter;
    }
    return require('./DatasetAdapter.js');
  }

  function resolveDriveService() {
    if (typeof DriveService !== 'undefined') {
      return DriveService;
    }
    return require('../services/DriveService.js');
  }

  function resolveDuplicateService() {
    if (typeof DuplicateService !== 'undefined') {
      return DuplicateService;
    }
    return require('../services/DuplicateService.js');
  }

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function resolveRegistry() {
    if (typeof SchemaRegistry !== 'undefined') {
      return SchemaRegistry;
    }
    return require('./SchemaRegistry.js');
  }

  function resolveWorkbookBundleAdapter() {
    if (typeof WorkbookBundleAdapter !== 'undefined') {
      return WorkbookBundleAdapter;
    }
    return require('./WorkbookBundleAdapter.js');
  }

  function resolveXlsxAdapter() {
    if (typeof XlsxAdapter !== 'undefined') {
      return XlsxAdapter;
    }
    return require('./XlsxAdapter.js');
  }

  function requireRequest(request) {
    var packaging = resolveRegistry().PACKAGING_CONTRACTS;
    var supportedKinds = [
      packaging.MULTI_SHEET_WORKBOOK.kind,
      packaging.SINGLE_DATASET.kind,
    ];
    if (
      !request ||
      supportedKinds.indexOf(request.packagingKind) === -1 ||
      !Array.isArray(request.sources) ||
      !request.runMetadata ||
      typeof request.runMetadata.runId !== 'string' ||
      !request.runMetadata.runId ||
      request.runMetadata.schemaVersion !== resolveRegistry().ACTIVE_SCHEMA_VERSION
    ) {
      throw resolveErrorCodes().create('INGESTION_INVALID_RUN_METADATA', {
        details: { boundary: 'InputAdapter.read' },
      });
    }
    if (
      request.packagingKind === packaging.MULTI_SHEET_WORKBOOK.kind &&
      request.sources.length !== 1
    ) {
      throw resolveErrorCodes().create('SOURCE_INCOMPLETE_BUNDLE', {
        details: { expectedSourceCount: 1, sourceCount: request.sources.length },
      });
    }
  }

  function copyRequest(request) {
    return Object.freeze(Object.assign({}, request, {
      runMetadata: Object.freeze(Object.assign({}, request.runMetadata)),
      sources: Object.freeze(request.sources.map(function (source) {
        return Object.freeze(Object.assign({}, source));
      })),
    }));
  }

  function expectedDatasetNames() {
    return resolveRegistry().listSchemas().map(function (schema) { return schema.name; });
  }

  function requireSingleDatasetSources(sourceRequests) {
    var expected = expectedDatasetNames();
    var supplied = sourceRequests.map(function (source) { return source.datasetName; });
    var missing = expected.filter(function (name) { return supplied.indexOf(name) === -1; });
    var unexpected = supplied.filter(function (name) { return expected.indexOf(name) === -1; });
    var duplicates = supplied.filter(function (name, index) {
      return supplied.indexOf(name) !== index;
    });
    if (missing.length || unexpected.length || duplicates.length) {
      throw resolveErrorCodes().create('SOURCE_INCOMPLETE_BUNDLE', {
        details: {
          duplicateDatasets: duplicates,
          missingDatasets: missing,
          unexpectedDatasets: unexpected,
        },
      });
    }
  }

  function requirePhase(state, fields, boundary) {
    var missing = fields.filter(function (field) {
      return !state || state[field] === undefined || state[field] === null;
    });
    if (missing.length > 0) {
      throw resolveErrorCodes().create('INGESTION_INVALID_OPERATIONS', {
        details: { boundary: boundary, missingPhaseFields: missing },
      });
    }
  }

  function checkedAtUtc(services) {
    var value = services && services.clock && typeof services.clock.now === 'function'
      ? services.clock.now()
      : new Date();
    return (value instanceof Date ? value : new Date(value)).toISOString();
  }

  function readSource(sourceRequest, services) {
    var source = resolveDriveService().readFile(sourceRequest.fileId, services);
    if (!sourceRequest.datasetName) {
      return source;
    }
    return Object.freeze(Object.assign({}, source, {
      datasetName: sourceRequest.datasetName,
    }));
  }

  function parseSingleDatasetSource(source, services) {
    var table;
    if (source.format === resolveDriveService().FORMATS.HTML_TABLE) {
      table = resolveDatasetAdapter().parseHtmlTable(source);
    } else if (source.format === resolveDriveService().FORMATS.XLSX) {
      var workbook = resolveXlsxAdapter().read(source, services);
      var populatedSheets = workbook.sheets.filter(function (sheet) {
        return sheet.values.length > 0;
      });
      if (populatedSheets.length > 1) {
        throw resolveErrorCodes().create('SOURCE_MULTIPLE_TABLES', {
          details: { sheetCount: populatedSheets.length },
        });
      }
      if (populatedSheets.length !== 1) {
        throw resolveErrorCodes().create('SOURCE_INVALID_TABLE', {
          details: { sheetCount: populatedSheets.length },
        });
      }
      table = populatedSheets[0];
    } else {
      throw resolveErrorCodes().create('SOURCE_UNSUPPORTED_FORMAT');
    }
    return table;
  }

  function singleDatasetPayload(source, table, bundleFingerprint, runMetadata) {
    return resolveDatasetAdapter().fromTable({
      datasetName: source.datasetName,
      runMetadata: runMetadata,
      source: {
        artifactId: source.fileId,
        bundleFingerprint: bundleFingerprint,
        contentFingerprint: source.contentFingerprint,
        fileName: source.fileName,
        kind: resolveRegistry().PACKAGING_CONTRACTS.SINGLE_DATASET.kind,
      },
      values: table.values,
    });
  }

  function validateFile(request, services) {
    requireRequest(request);
    var safeRequest = copyRequest(request);
    var dependencies = services || {};
    var packaging = resolveRegistry().PACKAGING_CONTRACTS;
    if (safeRequest.packagingKind === packaging.SINGLE_DATASET.kind) {
      requireSingleDatasetSources(safeRequest.sources);
    }

    var sources = safeRequest.sources.map(function (sourceRequest) {
      return readSource(sourceRequest, dependencies);
    });
    var fingerprint = resolveDuplicateService().computeFingerprint(sources, dependencies);
    return Object.freeze({
      checkedAtUtc: checkedAtUtc(dependencies),
      datasetNames: Object.freeze(expectedDatasetNames()),
      fingerprint: fingerprint,
      request: safeRequest,
      sources: Object.freeze(sources),
    });
  }

  function parse(validated, services) {
    requirePhase(validated, ['request', 'sources', 'fingerprint'], 'InputAdapter.parse');
    var packaging = resolveRegistry().PACKAGING_CONTRACTS;
    if (validated.request.packagingKind === packaging.MULTI_SHEET_WORKBOOK.kind) {
      if (validated.sources[0].format !== resolveDriveService().FORMATS.XLSX) {
        throw resolveErrorCodes().create('SOURCE_UNSUPPORTED_FORMAT', {
          details: { packagingKind: validated.request.packagingKind },
        });
      }
      return Object.freeze(Object.assign({}, validated, {
        workbook: resolveXlsxAdapter().read(validated.sources[0], services || {}),
      }));
    }
    return Object.freeze(Object.assign({}, validated, {
      tables: Object.freeze(validated.sources.map(function (source) {
        return Object.freeze({
          source: source,
          table: parseSingleDatasetSource(source, services || {}),
        });
      })),
    }));
  }

  function validateSchema(parsed) {
    requirePhase(parsed, ['request', 'sources', 'fingerprint'], 'InputAdapter.validateSchema');
    var packaging = resolveRegistry().PACKAGING_CONTRACTS;
    var payloads;
    if (parsed.request.packagingKind === packaging.MULTI_SHEET_WORKBOOK.kind) {
      requirePhase(parsed, ['workbook'], 'InputAdapter.validateSchema');
      payloads = resolveWorkbookBundleAdapter().toPayloads({
        bundleFingerprint: parsed.fingerprint,
        runMetadata: parsed.request.runMetadata,
        sheetMap: parsed.request.sheetMap,
        source: parsed.sources[0],
        workbook: parsed.workbook,
      });
    } else {
      requirePhase(parsed, ['tables'], 'InputAdapter.validateSchema');
      payloads = parsed.tables.map(function (entry) {
        return singleDatasetPayload(
          entry.source,
          entry.table,
          parsed.fingerprint,
          parsed.request.runMetadata,
        );
      });
    }
    return Object.freeze(Object.assign({}, parsed, {
      payloads: Object.freeze(payloads.slice()),
    }));
  }

  function publicResult(normalized) {
    return Object.freeze({
      fingerprint: normalized.fingerprint,
      fingerprintAlgorithm: 'SHA-256',
      payloads: Object.freeze(normalized.payloads.slice()),
      sourceFiles: Object.freeze(
        normalized.sources.map(resolveDriveService().publicMetadata),
      ),
    });
  }

  function checkDuplicate(normalized, services) {
    requirePhase(
      normalized,
      ['checkedAtUtc', 'datasetNames', 'fingerprint', 'payloads', 'request', 'sources'],
      'InputAdapter.checkDuplicate',
    );
    var dependencies = services || {};
    resolveDuplicateService().check({
      checkedAtUtc: normalized.checkedAtUtc,
      datasetNames: normalized.datasetNames,
      fingerprint: normalized.fingerprint,
      runId: normalized.request.runMetadata.runId,
      schemaVersion: normalized.request.runMetadata.schemaVersion,
      sourceFiles: normalized.sources,
    }, dependencies.ledgerRepository);
    return publicResult(normalized);
  }

  function read(request, services) {
    return checkDuplicate(
      validateSchema(parse(validateFile(request, services), services)),
      services,
    );
  }

  function createOperations(request, services) {
    var baseRequest = request || {};
    var state = null;
    function requestForContext(context) {
      var suppliedMetadata = baseRequest.runMetadata || {};
      return Object.assign({}, baseRequest, {
        runMetadata: Object.assign({}, suppliedMetadata, {
          acquiredAtUtc: suppliedMetadata.acquiredAtUtc || context.startedAtUtc,
          runId: context.runId,
          schemaVersion: context.request.schemaVersion,
        }),
      });
    }
    return Object.freeze({
      validateFile: function (context) {
        state = validateFile(requestForContext(context), services);
        return Object.freeze({
          fingerprint: state.fingerprint,
          sourceFiles: Object.freeze(
            state.sources.map(resolveDriveService().publicMetadata),
          ),
        });
      },
      parse: function () {
        state = parse(state, services);
        return Object.freeze({ packagingKind: state.request.packagingKind });
      },
      validateSchema: function () {
        state = validateSchema(state);
        return Object.freeze({ payloads: state.payloads });
      },
      checkDuplicate: function () {
        return checkDuplicate(state, services);
      },
    });
  }

  return Object.freeze({
    checkDuplicate: checkDuplicate,
    createOperations: createOperations,
    parse: parse,
    read: read,
    validateFile: validateFile,
    validateSchema: validateSchema,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = InputAdapter;
}
