/**
 * CXP-11 legacy-export adapter.
 *
 * Validates the versioned Excel export bundle (manifest plus five wide source
 * CSVs, one long-form metric CSV, and one legacy-error CSV) before any
 * comparison runs. Parsing and validation are pure; Drive reads are injected by
 * the caller so no Apps Script service is captured at module load.
 */
var LegacyExportAdapter = (function () {
  'use strict';

  function resolveContracts() {
    if (typeof ParityContracts !== 'undefined') {
      return ParityContracts;
    }
    return require('./ParityContracts.js');
  }

  function resolveDigest() {
    if (typeof ParityDigest !== 'undefined') {
      return ParityDigest;
    }
    return require('./ParityDigest.js');
  }

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function fail(code, details) {
    throw resolveErrorCodes().create(code, { details: details || {} });
  }

  function stripBom(text) {
    return typeof text === 'string' ? text.replace(/^\uFEFF/, '') : '';
  }


  /** RFC 4180 subset: quoted fields, escaped quotes, CRLF or LF row breaks. */
  function parseCsv(text, fileName) {
    var body = stripBom(text);
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var index = 0;
    var hasContent = false;

    function endField() {
      row.push(field);
      field = '';
    }

    function endRow() {
      endField();
      rows.push(row);
      row = [];
    }

    while (index < body.length) {
      var character = body.charAt(index);
      if (inQuotes) {
        if (character === '"') {
          if (body.charAt(index + 1) === '"') {
            field += '"';
            index += 2;
            continue;
          }
          inQuotes = false;
          index += 1;
          continue;
        }
        field += character;
        index += 1;
        continue;
      }
      if (character === '"') {
        if (field !== '') {
          fail('PARITY_EXPORT_SCHEMA_DRIFT', {
            fileName: fileName,
            reason: 'quote_inside_unquoted_field',
            rowNumber: rows.length + 1,
          });
        }
        inQuotes = true;
        hasContent = true;
        index += 1;
        continue;
      }
      if (character === ',') {
        endField();
        hasContent = true;
        index += 1;
        continue;
      }
      if (character === '\r') {
        if (body.charAt(index + 1) === '\n') {
          index += 1;
        }
        endRow();
        index += 1;
        continue;
      }
      if (character === '\n') {
        endRow();
        index += 1;
        continue;
      }
      field += character;
      hasContent = true;
      index += 1;
    }

    if (inQuotes) {
      fail('PARITY_EXPORT_SCHEMA_DRIFT', {
        fileName: fileName,
        reason: 'unterminated_quoted_field',
      });
    }
    if (field !== '' || row.length > 0) {
      endRow();
    }
    if (!hasContent && rows.length === 0) {
      fail('PARITY_EXPORT_SCHEMA_DRIFT', { fileName: fileName, reason: 'empty_file' });
    }
    return rows;
  }

  function assertOrderedHeaders(actual, expected, fileName) {
    var seen = Object.create(null);
    actual.forEach(function (header) {
      if (seen[header]) {
        fail('PARITY_EXPORT_SCHEMA_DRIFT', {
          fileName: fileName,
          reason: 'duplicate_header',
        });
      }
      seen[header] = true;
    });
    if (actual.length !== expected.length) {
      fail('PARITY_EXPORT_SCHEMA_DRIFT', {
        actualColumnCount: actual.length,
        expectedColumnCount: expected.length,
        fileName: fileName,
        reason: 'header_count',
      });
    }
    var index;
    for (index = 0; index < expected.length; index += 1) {
      if (actual[index] !== expected[index]) {
        fail('PARITY_EXPORT_SCHEMA_DRIFT', {
          columnIndex: index,
          fileName: fileName,
          reason: 'header_order',
        });
      }
    }
  }

  function toRecords(rows, headers, fileName) {
    var records = [];
    var rowIndex;
    for (rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      var cells = rows[rowIndex];
      if (cells.length === 1 && cells[0] === '') {
        continue;
      }
      if (cells.length !== headers.length) {
        fail('PARITY_EXPORT_SCHEMA_DRIFT', {
          actualColumnCount: cells.length,
          expectedColumnCount: headers.length,
          fileName: fileName,
          reason: 'ragged_row',
          rowNumber: rowIndex + 1,
        });
      }
      var record = Object.create(null);
      headers.forEach(function (header, columnIndex) {
        record[header] = String(cells[columnIndex]).trim();
      });
      records.push(record);
    }
    return records;
  }

  function isIsoUtcTimestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z$/.test(value)) {
      return false;
    }
    return !Number.isNaN(new Date(value).getTime());
  }

  function manifestFileEntries(manifest) {
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
      fail('PARITY_EXPORT_MANIFEST_INVALID', { reason: 'files_missing' });
    }
    var byName = Object.create(null);
    manifest.files.forEach(function (entry) {
      if (!entry || typeof entry.name !== 'string' || !entry.name) {
        fail('PARITY_EXPORT_MANIFEST_INVALID', { reason: 'file_name_missing' });
      }
      if (byName[entry.name]) {
        fail('PARITY_EXPORT_MANIFEST_INVALID', {
          fileName: entry.name,
          reason: 'duplicate_file_entry',
        });
      }
      if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
        fail('PARITY_EXPORT_MANIFEST_INVALID', {
          fileName: entry.name,
          reason: 'file_digest_missing',
        });
      }
      if (!Number.isInteger(entry.rowCount) || entry.rowCount < 0) {
        fail('PARITY_EXPORT_MANIFEST_INVALID', {
          fileName: entry.name,
          reason: 'file_row_count_invalid',
        });
      }
      byName[entry.name] = entry;
    });
    return byName;
  }

  function validateManifest(manifestText, contracts) {
    var manifest;
    try {
      manifest = JSON.parse(stripBom(manifestText));
    } catch (error) {
      throw resolveErrorCodes().create('PARITY_EXPORT_MANIFEST_INVALID', {
        cause: error,
        details: { reason: 'not_json' },
      });
    }
    if (!manifest || typeof manifest !== 'object') {
      fail('PARITY_EXPORT_MANIFEST_INVALID', { reason: 'not_object' });
    }
    contracts.MANIFEST_REQUIRED_FIELDS.forEach(function (field) {
      if (manifest[field] === undefined || manifest[field] === null || manifest[field] === '') {
        fail('PARITY_EXPORT_MANIFEST_INVALID', { field: field, reason: 'field_missing' });
      }
    });
    if (manifest.contractVersion !== contracts.CONTRACT_VERSION) {
      fail('PARITY_EXPORT_CONTRACT_VERSION_MISMATCH', {
        actual: String(manifest.contractVersion),
        expected: contracts.CONTRACT_VERSION,
      });
    }
    if (!isIsoUtcTimestamp(manifest.acquisitionTimestampUtc)) {
      fail('PARITY_EXPORT_INVALID_TIMESTAMP', { field: 'acquisitionTimestampUtc' });
    }
    if (manifest.baselineVersion !== contracts.BASELINE_VERSION) {
      fail('PARITY_EXPORT_MANIFEST_INVALID', {
        actual: String(manifest.baselineVersion),
        expected: contracts.BASELINE_VERSION,
        reason: 'baseline_version',
      });
    }
    if (
      String(manifest.controlWorkbookSha256).toUpperCase() !==
      contracts.CONTROL_WORKBOOK_SHA256
    ) {
      fail('PARITY_EXPORT_MANIFEST_INVALID', { reason: 'control_workbook_hash' });
    }
    return manifest;
  }

  function assertFileSetMatchesContract(byName, files, contracts) {
    var expectedNames = contracts.listExportFileNames().filter(function (name) {
      return name !== contracts.MANIFEST_FILE_NAME;
    });
    expectedNames.forEach(function (name) {
      if (!byName[name]) {
        fail('PARITY_EXPORT_MANIFEST_INVALID', { fileName: name, reason: 'not_declared' });
      }
      if (typeof files[name] !== 'string') {
        fail('PARITY_EXPORT_FILE_MISSING', { fileName: name });
      }
    });
    Object.keys(byName).forEach(function (name) {
      if (expectedNames.indexOf(name) === -1) {
        fail('PARITY_EXPORT_FILE_UNEXPECTED', { fileName: name });
      }
    });
    Object.keys(files).forEach(function (name) {
      if (name !== contracts.MANIFEST_FILE_NAME && expectedNames.indexOf(name) === -1) {
        fail('PARITY_EXPORT_FILE_UNEXPECTED', { fileName: name });
      }
    });
  }

  function keyOf(record, keyFields) {
    return keyFields.map(function (field) {
      return String(record[field] === undefined ? '' : record[field]);
    }).join('\u001d');
  }

  function canonicalRowText(record, headers) {
    return headers.map(function (header) {
      return String(record[header] === undefined ? '' : record[header]);
    }).join('\u001d');
  }

  /**
   * Exact-duplicate rows collapse; divergent rows that share the authoritative
   * key fail closed. Mirrors the CXP-05 source duplicate policy.
   */
  function applyDuplicatePolicy(records, headers, keyFields, fileName) {
    if (keyFields.length === 0) {
      var seenRows = Object.create(null);
      var deduped = [];
      records.forEach(function (record) {
        var rowText = canonicalRowText(record, headers);
        if (seenRows[rowText]) {
          return;
        }
        seenRows[rowText] = true;
        deduped.push(record);
      });
      return deduped;
    }
    var byKey = Object.create(null);
    var ordered = [];
    records.forEach(function (record) {
      var key = keyOf(record, keyFields);
      if (key.split('\u001d').some(function (part) { return part === ''; })) {
        fail('PARITY_EXPORT_MISSING_KEY', { fileName: fileName });
      }
      var rowText = canonicalRowText(record, headers);
      if (!byKey[key]) {
        byKey[key] = rowText;
        ordered.push(record);
        return;
      }
      if (byKey[key] !== rowText) {
        fail('PARITY_EXPORT_DUPLICATE_KEY', {
          fileName: fileName,
          keyDigest: resolveDigest().shortHash(key),
          reason: 'divergent_duplicate',
        });
      }
    });
    return ordered;
  }

  function validateMetricRecords(records, contracts) {
    var metrics = contracts.listMetrics();
    var seen = Object.create(null);
    return records.map(function (record) {
      if (metrics.indexOf(record.Metric) === -1) {
        fail('PARITY_EXPORT_SCHEMA_DRIFT', {
          fileName: contracts.METRIC_FILE_NAME,
          metricName: record.Metric,
          reason: 'unknown_metric',
        });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(record['Business Date'])) {
        fail('PARITY_EXPORT_SCHEMA_DRIFT', {
          fileName: contracts.METRIC_FILE_NAME,
          reason: 'business_date_format',
        });
      }
      if (!/^\d{2}:\d{2}$/.test(record['Interval Start'])) {
        fail('PARITY_EXPORT_SCHEMA_DRIFT', {
          fileName: contracts.METRIC_FILE_NAME,
          reason: 'interval_start_format',
        });
      }
      var identity = [
        record['Business Date'],
        record['Interval Start'],
        record.Site,
        record['Queue Or LOB'],
        record.Metric,
        record['Aggregation Identity'],
      ].join('\u001d');
      if (seen[identity]) {
        fail('PARITY_EXPORT_DUPLICATE_KEY', {
          fileName: contracts.METRIC_FILE_NAME,
          keyDigest: resolveDigest().shortHash(identity),
        });
      }
      seen[identity] = true;
      return Object.freeze({
        aggregationIdentity: record['Aggregation Identity'],
        businessDate: record['Business Date'],
        intervalStart: record['Interval Start'],
        metric: record.Metric,
        queueOrLob: record['Queue Or LOB'],
        site: record.Site,
        value: record.Value,
      });
    });
  }

  function validateLegacyErrorRecords(records, contracts) {
    return records.map(function (record) {
      var count = Number(record['Observed Count']);
      if (!Number.isInteger(count) || count < 0) {
        fail('PARITY_EXPORT_SCHEMA_DRIFT', {
          fileName: contracts.LEGACY_ERROR_FILE_NAME,
          reason: 'observed_count_invalid',
        });
      }
      if (!contracts.isErrorToken(record['Error Token'])) {
        fail('PARITY_EXPORT_SCHEMA_DRIFT', {
          fileName: contracts.LEGACY_ERROR_FILE_NAME,
          reason: 'unknown_error_token',
        });
      }
      return Object.freeze({
        cellOrRange: record['Cell Or Range'],
        errorToken: record['Error Token'].toUpperCase(),
        formulaFamily: record['Formula Family'],
        observedCount: count,
        worksheet: record.Worksheet,
      });
    });
  }

  function create(services) {
    var dependencies = services || {};
    var contracts = dependencies.contracts || resolveContracts();
    var digest = dependencies.digest || resolveDigest();

    function assertDigest(fileName, text, expected) {
      var actual = digest.sha256Hex(stripBom(text));
      if (actual !== expected) {
        fail('PARITY_EXPORT_DIGEST_MISMATCH', { fileName: fileName });
      }
      return actual;
    }

    function parseFile(fileName, text, expectedHeaders, declaredRowCount) {
      var rows = parseCsv(text, fileName);
      assertOrderedHeaders(rows[0] || [], expectedHeaders, fileName);
      var records = toRecords(rows, expectedHeaders, fileName);
      if (records.length !== declaredRowCount) {
        fail('PARITY_EXPORT_ROW_COUNT_MISMATCH', {
          actualRowCount: records.length,
          declaredRowCount: declaredRowCount,
          fileName: fileName,
        });
      }
      return records;
    }

    /**
     * @param {{manifestText: string, files: Object<string,string>}} bundle
     * @returns {Object} frozen canonical export with a manifest fingerprint.
     */
    function validate(bundle) {
      if (!bundle || typeof bundle.manifestText !== 'string' || !bundle.files) {
        fail('PARITY_EXPORT_MANIFEST_INVALID', { reason: 'bundle_incomplete' });
      }
      var manifest = validateManifest(bundle.manifestText, contracts);
      var declaredByName = manifestFileEntries(manifest);
      assertFileSetMatchesContract(declaredByName, bundle.files, contracts);

      var datasets = contracts.DATASET_FILES.map(function (entry) {
        var declared = declaredByName[entry.fileName];
        var headers = contracts.datasetHeaders(entry.datasetName);
        if (!headers) {
          fail('PARITY_EXPORT_SCHEMA_DRIFT', {
            datasetName: entry.datasetName,
            reason: 'unregistered_dataset',
          });
        }
        if (declared.kind !== contracts.FILE_KINDS.sourceTable) {
          fail('PARITY_EXPORT_MANIFEST_INVALID', {
            fileName: entry.fileName,
            reason: 'file_kind',
          });
        }
        var text = bundle.files[entry.fileName];
        var fileDigest = assertDigest(entry.fileName, text, declared.sha256);
        var records = parseFile(entry.fileName, text, headers, declared.rowCount);
        var keyFields = contracts.datasetKeyFields(entry.datasetName);
        var canonical = applyDuplicatePolicy(records, headers, keyFields, entry.fileName);
        return Object.freeze({
          datasetName: entry.datasetName,
          digest: fileDigest,
          fileName: entry.fileName,
          headers: Object.freeze(headers.slice()),
          keyFields: Object.freeze(keyFields.slice()),
          rowCount: canonical.length,
          rows: Object.freeze(canonical),
        });
      });

      var metricDeclared = declaredByName[contracts.METRIC_FILE_NAME];
      if (metricDeclared.kind !== contracts.FILE_KINDS.metric) {
        fail('PARITY_EXPORT_MANIFEST_INVALID', {
          fileName: contracts.METRIC_FILE_NAME,
          reason: 'file_kind',
        });
      }
      var metricDigest = assertDigest(
        contracts.METRIC_FILE_NAME,
        bundle.files[contracts.METRIC_FILE_NAME],
        metricDeclared.sha256,
      );
      var metrics = validateMetricRecords(
        parseFile(
          contracts.METRIC_FILE_NAME,
          bundle.files[contracts.METRIC_FILE_NAME],
          contracts.METRIC_CSV_HEADERS.slice(),
          metricDeclared.rowCount,
        ),
        contracts,
      );

      var errorDeclared = declaredByName[contracts.LEGACY_ERROR_FILE_NAME];
      if (errorDeclared.kind !== contracts.FILE_KINDS.legacyError) {
        fail('PARITY_EXPORT_MANIFEST_INVALID', {
          fileName: contracts.LEGACY_ERROR_FILE_NAME,
          reason: 'file_kind',
        });
      }
      var errorDigest = assertDigest(
        contracts.LEGACY_ERROR_FILE_NAME,
        bundle.files[contracts.LEGACY_ERROR_FILE_NAME],
        errorDeclared.sha256,
      );
      var legacyErrors = validateLegacyErrorRecords(
        parseFile(
          contracts.LEGACY_ERROR_FILE_NAME,
          bundle.files[contracts.LEGACY_ERROR_FILE_NAME],
          contracts.LEGACY_ERROR_CSV_HEADERS.slice(),
          errorDeclared.rowCount,
        ),
        contracts,
      );

      return Object.freeze({
        acquisitionTimestampUtc: manifest.acquisitionTimestampUtc,
        contractVersion: manifest.contractVersion,
        datasets: Object.freeze(datasets),
        legacyErrors: Object.freeze(legacyErrors),
        legacyErrorsDigest: errorDigest,
        manifestFingerprint: digest.sha256Hex(stripBom(bundle.manifestText)),
        metrics: Object.freeze(metrics),
        metricsDigest: metricDigest,
        sourceBundleFingerprint: manifest.sourceBundleFingerprint,
      });
    }

    /**
     * The manifest fingerprint must match a successful FILE_LEDGER entry for the
     * same source bundle. Fail closed when ingestion never recorded it.
     */
    function assertLedgerIdentity(export_, ledgerEntry) {
      if (!ledgerEntry) {
        fail('PARITY_SOURCE_FINGERPRINT_MISMATCH', {
          reason: 'no_successful_ledger_entry',
        });
      }
      if (ledgerEntry.fingerprint !== export_.sourceBundleFingerprint) {
        fail('PARITY_SOURCE_FINGERPRINT_MISMATCH', { reason: 'fingerprint_mismatch' });
      }
      return Object.freeze({
        ingestionRunId: ledgerEntry.runId,
        sourceBundleFingerprint: ledgerEntry.fingerprint,
      });
    }

    return Object.freeze({
      assertLedgerIdentity: assertLedgerIdentity,
      validate: validate,
    });
  }

  return Object.freeze({
    create: create,
    parseCsv: parseCsv,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LegacyExportAdapter;
}
