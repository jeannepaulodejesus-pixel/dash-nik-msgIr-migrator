var WorkbookBundleAdapter = (function () {
  'use strict';

  function resolveDatasetAdapter() {
    if (typeof DatasetAdapter !== 'undefined') {
      return DatasetAdapter;
    }
    return require('./DatasetAdapter.js');
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

  function toPayloads(options) {
    var input = options || {};
    if (!input.workbook || !Array.isArray(input.workbook.sheets)) {
      throw resolveErrorCodes().create('SOURCE_INVALID_TABLE', {
        details: { reason: 'invalid_workbook' },
      });
    }
    var sheetByName = Object.create(null);
    input.workbook.sheets.forEach(function (sheet) {
      if (sheet && typeof sheet.name === 'string') {
        sheetByName[sheet.name] = sheet;
      }
    });
    var mapping = input.sheetMap || {};
    var missing = [];
    var payloads = resolveRegistry().listSchemas().map(function (schema) {
      var sheetName = mapping[schema.name] || schema.name;
      var sheet = sheetByName[sheetName];
      if (!sheet) {
        missing.push(Object.freeze({ datasetName: schema.name, sheetName: sheetName }));
        return null;
      }
      return resolveDatasetAdapter().fromTable({
        datasetName: schema.name,
        runMetadata: input.runMetadata,
        source: {
          artifactId: input.source.fileId,
          bundleFingerprint: input.bundleFingerprint,
          contentFingerprint: input.source.contentFingerprint,
          fileName: input.source.fileName,
          kind: resolveRegistry().PACKAGING_CONTRACTS.MULTI_SHEET_WORKBOOK.kind,
          sheetName: sheetName,
        },
        values: sheet.values,
      });
    });
    if (missing.length > 0) {
      throw resolveErrorCodes().create('SOURCE_INCOMPLETE_BUNDLE', {
        details: { missingDatasetSheets: Object.freeze(missing) },
      });
    }
    return Object.freeze(payloads);
  }

  return Object.freeze({ toPayloads: toPayloads });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WorkbookBundleAdapter;
}
