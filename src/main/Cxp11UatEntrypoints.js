/**
 * CXP-11 hosted UAT helpers for docs/cxp11-uat-runbook.md.
 *
 * Editor entrypoints (parameterless):
 *   CXP11UatStep00VerifyPrerequisites
 *   CXP11UatStep01Install
 *   CXP11UatStep02InspectControlContracts
 *   CXP11UatStep03LoadSyntheticParityBundle
 *   CXP11UatStep04RunParity
 *   CXP11UatStep05ValidateExpectedVarianceAndErrors
 *   CXP11UatStep06ResumeAndSecondBundle
 *   CXP11UatStep07ReinstallAndRerun
 *   CXP11UatStep08PromotionGate
 */
var Cxp11ParityUat = (function () {
  'use strict';

  // Mirror of tests/fixtures/cxp11/synthetic-parity-bundle.json (embedded for
  // Apps Script, which cannot require JSON at runtime).
  var FIXTURE = Object.freeze({
    acquisitionTimestampUtc: '2026-08-18T18:30:00Z',
    businessDate: '2026-08-18',
    datasets: Object.freeze({
      'AHT - Raw': Object.freeze([
        Object.freeze({
          'Agent Work ID': 'AW-2001',
          'Athlete Site': 'PH',
          'Work Item: Name': 'MS-1001',
        }),
        Object.freeze({
          'Agent Work ID': 'AW-2002',
          'Athlete Site': 'LAS',
          'Work Item: Name': 'MS-1002',
        }),
      ]),
      'Auxes - Raw': Object.freeze([
        Object.freeze({
          'Athlete Site': 'PH',
          Name: 'Athlete One',
          'User Presence ID': 'UP-3001',
        }),
        Object.freeze({
          'Athlete Site': 'LAS',
          Name: 'Athlete Two',
          'User Presence ID': 'UP-3002',
        }),
      ]),
      Handled: Object.freeze([
        Object.freeze({
          'Case: Case Number': 'C-1001',
          'Initial Athlete Site': 'PH',
          'Initial Queue': 'INT Messaging',
          'Messaging Session Name': 'MS-1001',
        }),
        Object.freeze({
          'Case: Case Number': 'C-1002',
          'Initial Athlete Site': 'LAS',
          'Initial Queue': 'INT Messaging',
          'Messaging Session Name': 'MS-1002',
        }),
      ]),
      Offered: Object.freeze([
        Object.freeze({
          'Case: Case Number': 'C-1001',
          'Initial Athlete BPO': 'INT',
          'Initial Athlete Site': 'PH',
          'Messaging Session Name': 'MS-1001',
        }),
        Object.freeze({
          'Case: Case Number': 'C-1002',
          'Initial Athlete BPO': 'CNX',
          'Initial Athlete Site': 'LAS',
          'Messaging Session Name': 'MS-1002',
        }),
      ]),
      Staff: Object.freeze([
        Object.freeze({
          'Athlete Display Name': 'Athlete One',
          'Athlete Profile': 'Messaging',
          'Athlete Site': 'PH',
          'Status End Date': '2026-08-18 10:00:00',
          'Status Start Date': '2026-08-18 02:00:00',
        }),
        Object.freeze({
          'Athlete Display Name': 'Athlete Two',
          'Athlete Profile': 'Messaging',
          'Athlete Site': 'LAS',
          'Status End Date': '2026-08-18 11:00:00',
          'Status Start Date': '2026-08-18 03:00:00',
        }),
      ]),
    }),
    legacyErrors: Object.freeze([
      Object.freeze({
        cellOrRange: 'G2:G5717',
        errorToken: '#N/A',
        formulaFamily: 'VLOOKUP(Offered[[#This Row],[Case: Case Number]],Handled!D:T,17,0)',
        observedCount: 919,
        worksheet: 'Offered',
      }),
      Object.freeze({
        cellOrRange: 'F2:F5717',
        errorToken: '#N/A',
        formulaFamily: 'IF(Offered[[#This Row],[Handled ASA]]<91,1,0)',
        observedCount: 919,
        worksheet: 'Offered',
      }),
      Object.freeze({
        cellOrRange: 'WORKSHEET',
        errorToken: '#REF!',
        formulaFamily: 'teams_update_broken_reference',
        observedCount: 13,
        worksheet: 'Teams Update',
      }),
      Object.freeze({
        cellOrRange: 'WORKSHEET',
        errorToken: '#REF!',
        formulaFamily: 'broken_defined_name_lob_sst',
        observedCount: 8,
        worksheet: 'Interval View',
      }),
      Object.freeze({
        cellOrRange: 'WORKSHEET',
        errorToken: '#DIV/0!',
        formulaFamily: 'allocation_pullout_zero_denominator',
        observedCount: 20,
        worksheet: 'pull outs for alloc',
      }),
      Object.freeze({
        cellOrRange: 'WORKSHEET',
        errorToken: '#DIV/0!',
        formulaFamily: 'allocation_ratio_zero_denominator',
        observedCount: 6,
        worksheet: 'Drivers and Allocation',
      }),
    ]),
    sourceBundleFingerprint:
      'sha256:cxp11syntheticbundle0000000000000000000000000000000000000000000',
  });
  var SYNTHETIC_LEDGER_RUN_ID = 'CXP11-UAT-SYNTHETIC-BUNDLE';

  function resolveContracts() {
    if (typeof ParityContracts !== 'undefined') {
      return ParityContracts;
    }
    return require('../parity/ParityContracts.js');
  }

  function resolveDigest() {
    if (typeof ParityDigest !== 'undefined') {
      return ParityDigest;
    }
    return require('../parity/ParityDigest.js');
  }

  function resolveComparator() {
    if (typeof ParityComparator !== 'undefined') {
      return ParityComparator;
    }
    return require('../parity/ParityComparator.js');
  }

  function resolveBaseline() {
    if (typeof SourceErrorBaseline !== 'undefined') {
      return SourceErrorBaseline;
    }
    return require('../parity/SourceErrorBaseline.js');
  }

  function resolveParityRun() {
    if (typeof Cxp11ParityRun !== 'undefined') {
      return Cxp11ParityRun;
    }
    return require('./Cxp11ParityRun.js');
  }

  function resolveDatasetSheets() {
    if (typeof DatasetSheets !== 'undefined') {
      return DatasetSheets;
    }
    return require('../config/DatasetSheets.js');
  }

  function resolveFileLedgerRepository() {
    if (typeof FileLedgerRepository !== 'undefined') {
      return FileLedgerRepository;
    }
    return require('../repository/FileLedgerRepository.js');
  }

  function resolveDuplicateService() {
    if (typeof DuplicateService !== 'undefined') {
      return DuplicateService;
    }
    return require('../services/DuplicateService.js');
  }

  function resolveSchemaRegistry() {
    if (typeof SchemaRegistry !== 'undefined') {
      return SchemaRegistry;
    }
    return require('../ingestion/SchemaRegistry.js');
  }

  function uatLog(tag, payload) {
    var line = 'CXP11_UAT ' + tag + ' ' + JSON.stringify(payload || {});
    if (typeof console !== 'undefined' && typeof console.log === 'function') {
      console.log(line);
    }
    if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') {
      Logger.log(line);
    }
  }

  function csvCell(value) {
    var text = value === null || value === undefined ? '' : String(value);
    if (/[",\r\n]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  function toCsv(headers, rows) {
    var lines = [headers.map(csvCell).join(',')];
    rows.forEach(function (row) {
      lines.push(headers.map(function (header) {
        return csvCell(row[header]);
      }).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }

  /**
   * Builds the versioned export bundle (manifest plus seven CSVs) from synthetic
   * records. Pure: digests are computed from the produced file text.
   */
  function buildBundleFiles(input) {
    var contracts = resolveContracts();
    var digest = resolveDigest();
    var request = input || {};
    var datasets = request.datasets || FIXTURE.datasets;
    var legacyMetrics = request.legacyMetrics || [];
    var legacyErrors = request.legacyErrors || FIXTURE.legacyErrors;
    var files = {};
    var declared = [];

    contracts.DATASET_FILES.forEach(function (entry) {
      var headers = contracts.datasetHeaders(entry.datasetName);
      var records = datasets[entry.datasetName] || [];
      var text = toCsv(headers, records);
      files[entry.fileName] = text;
      declared.push({
        datasetName: entry.datasetName,
        kind: contracts.FILE_KINDS.sourceTable,
        name: entry.fileName,
        rowCount: records.length,
        sha256: digest.sha256Hex(text),
      });
    });

    var metricRows = legacyMetrics.map(function (record) {
      return {
        'Aggregation Identity': record.aggregationIdentity,
        'Business Date': record.businessDate,
        'Interval Start': record.intervalStart,
        Metric: record.metric,
        'Queue Or LOB': record.queueOrLob,
        Site: record.site,
        Value: record.value,
      };
    });
    var metricText = toCsv(contracts.METRIC_CSV_HEADERS.slice(), metricRows);
    files[contracts.METRIC_FILE_NAME] = metricText;
    declared.push({
      kind: contracts.FILE_KINDS.metric,
      name: contracts.METRIC_FILE_NAME,
      rowCount: metricRows.length,
      sha256: digest.sha256Hex(metricText),
    });

    var errorRows = legacyErrors.map(function (record) {
      return {
        'Cell Or Range': record.cellOrRange,
        'Error Token': record.errorToken,
        'Formula Family': record.formulaFamily,
        'Observed Count': record.observedCount,
        Worksheet: record.worksheet,
      };
    });
    var errorText = toCsv(contracts.LEGACY_ERROR_CSV_HEADERS.slice(), errorRows);
    files[contracts.LEGACY_ERROR_FILE_NAME] = errorText;
    declared.push({
      kind: contracts.FILE_KINDS.legacyError,
      name: contracts.LEGACY_ERROR_FILE_NAME,
      rowCount: errorRows.length,
      sha256: digest.sha256Hex(errorText),
    });

    var manifest = {
      acquisitionTimestampUtc: request.acquisitionTimestampUtc ||
        FIXTURE.acquisitionTimestampUtc,
      baselineVersion: contracts.BASELINE_VERSION,
      contractVersion: contracts.CONTRACT_VERSION,
      controlWorkbookSha256: contracts.CONTROL_WORKBOOK_SHA256,
      files: declared,
      sourceBundleFingerprint: request.sourceBundleFingerprint ||
        FIXTURE.sourceBundleFingerprint,
    };
    return Object.freeze({
      files: files,
      manifestText: JSON.stringify(manifest, null, 2),
    });
  }

  /** In-memory export reader; keeps synthetic runs off Drive when desired. */
  function createFixtureExportReader(bundle) {
    var built = bundle && bundle.manifestText ? bundle : buildBundleFiles(bundle);
    return Object.freeze({
      read: function () {
        return { files: Object.assign({}, built.files), manifestText: built.manifestText };
      },
    });
  }

  function openTarget(spreadsheetId) {
    var id = spreadsheetId;
    if (!id || typeof id !== 'string') {
      id = Config.load().targetSpreadsheetId;
    }
    if (!id) {
      throw new Error('A configured CXP-11 target spreadsheet ID is required.');
    }
    return SpreadsheetApp.openById(id);
  }

  function openControl(spreadsheetId) {
    var id = spreadsheetId;
    if (!id || typeof id !== 'string') {
      id = Config.load().controlSpreadsheetId;
    }
    if (!id) {
      throw new Error('A configured CXP-11 control spreadsheet ID is required.');
    }
    return SpreadsheetApp.openById(id);
  }

  /**
   * Step 03 writes a placeholder sourceBundleFingerprint. DEC-055 still
   * requires a successful FILE_LEDGER match, so the UAT helper seeds one
   * SUCCESS row for that synthetic identity. A real weekly run must ingest
   * the same five-file bundle instead of using this seed.
   */
  function seedSyntheticLedgerEntry(spreadsheet) {
    var control = spreadsheet || openControl();
    var ledger = resolveFileLedgerRepository().create(control);
    var fingerprint = FIXTURE.sourceBundleFingerprint;
    var existing = ledger.findSuccessfulByFingerprint(fingerprint);
    if (existing) {
      return Object.freeze({
        fingerprint: fingerprint,
        ingestionRunId: existing.runId,
        seeded: false,
      });
    }
    var datasetFiles = resolveContracts().DATASET_FILES;
    resolveDuplicateService().recordSuccessful({
      checkedAtUtc: new Date().toISOString(),
      datasetNames: datasetFiles.map(function (entry) {
        return entry.datasetName;
      }),
      fingerprint: fingerprint,
      runId: SYNTHETIC_LEDGER_RUN_ID,
      schemaVersion: resolveSchemaRegistry().ACTIVE_SCHEMA_VERSION,
      sourceFiles: datasetFiles.map(function (entry) {
        return {
          fileId: 'uat-synthetic:' + entry.fileName,
          fileName: entry.fileName,
        };
      }),
    }, ledger);
    return Object.freeze({
      fingerprint: fingerprint,
      ingestionRunId: SYNTHETIC_LEDGER_RUN_ID,
      seeded: true,
    });
  }

  function resolveExportFolderId(folderId) {
    var id = folderId;
    if (!id || typeof id !== 'string') {
      id = Config.load().legacyParityExportFolderId;
    }
    if (!id) {
      throw new Error(
        'CXP_<ENV>_LEGACY_PARITY_EXPORT_FOLDER_ID or an explicit folder ID is required.',
      );
    }
    return id;
  }

  /** Writes bundle files into the export folder, replacing same-named files. */
  function writeBundleToFolder(folderId, bundle) {
    var contracts = resolveContracts();
    var folder = DriveApp.getFolderById(folderId);
    var payload = {};
    payload[contracts.MANIFEST_FILE_NAME] = bundle.manifestText;
    Object.keys(bundle.files).forEach(function (name) {
      payload[name] = bundle.files[name];
    });
    var written = [];
    Object.keys(payload).forEach(function (name) {
      var existing = folder.getFilesByName(name);
      while (existing.hasNext()) {
        existing.next().setTrashed(true);
      }
      folder.createFile(
        Utilities.newBlob(payload[name], 'text/plain', name).setName(name),
      );
      written.push(name);
    });
    return Object.freeze({ fileCount: written.length, fileNames: Object.freeze(written) });
  }

  /** Writes the synthetic source rows into the migrated `_RAW_*` tables. */
  function writeRawFixtureRows(spreadsheetId, datasets) {
    var contracts = resolveContracts();
    var records = datasets || FIXTURE.datasets;
    var spreadsheet = openTarget(spreadsheetId);
    var written = {};
    contracts.DATASET_FILES.forEach(function (entry) {
      var headers = contracts.datasetHeaders(entry.datasetName);
      var binding = resolveDatasetSheets().getByDatasetName(entry.datasetName);
      var sheet = spreadsheet.getSheetByName(binding.rawSheetName);
      if (!sheet) {
        throw new Error('A required raw sheet is unavailable: ' + binding.rawSheetName);
      }
      var rows = (records[entry.datasetName] || []).map(function (record) {
        return headers.map(function (header) {
          return record[header] === undefined ? '' : record[header];
        });
      });
      sheet.getDataRange().clearContent();
      var schema = resolveSchemaRegistry().getSchema(entry.datasetName);
      var writeRowCount = rows.length + 1;
      if (schema && Array.isArray(schema.columns)) {
        schema.columns.forEach(function (column, columnIndex) {
          if (column.type !== 'date' && column.type !== 'date_time') {
            return;
          }
          var columnRange = sheet.getRange(1, columnIndex + 1, writeRowCount, 1);
          if (columnRange && typeof columnRange.setNumberFormat === 'function') {
            columnRange.setNumberFormat('@');
          }
        });
      }
      sheet.getRange(1, 1, 1, headers.length).setValues([headers.slice()]);
      if (rows.length > 0) {
        sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
      }
      written[entry.datasetName] = rows.length;
    });
    return Object.freeze(written);
  }

  /**
   * Derives the legacy metric CSV records from the live Interval View by shifting
   * each fixed-PST key forward by 480 minutes, reproducing the unconverted UTC
   * keys a fresh legacy Excel control emits (DEC-025).
   */
  function deriveLegacyMetricsFromTarget(spreadsheetId) {
    var contracts = resolveContracts();
    var comparator = resolveComparator().create({ contracts: contracts });
    var reader = resolveParityRun().createTargetReader(openTarget(spreadsheetId));
    return reader.readMetrics().map(function (record) {
      var shifted = comparator.alignLegacyGrain({
        businessDate: record.businessDate,
        intervalStart: record.intervalStart,
        queueOrLob: record.queueOrLob,
        site: record.site,
      });
      // alignLegacyGrain subtracts 480; apply it twice in reverse to move forward.
      var forward = comparator.alignLegacyGrain({
        businessDate: record.businessDate,
        intervalStart: record.intervalStart,
        queueOrLob: record.queueOrLob,
        site: record.site,
      });
      return {
        aggregationIdentity: record.aggregationIdentity,
        businessDate: forward.businessDate === shifted.businessDate
          ? shiftForward(record).businessDate
          : shiftForward(record).businessDate,
        intervalStart: shiftForward(record).intervalStart,
        metric: record.metric,
        queueOrLob: record.queueOrLob,
        site: record.site,
        value: record.value,
      };
    });
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  /** +480 minutes: fixed PST back to the raw UTC key a legacy export emits. */
  function shiftForward(record) {
    var parts = String(record.businessDate).split('-').map(Number);
    var time = String(record.intervalStart).split(':').map(Number);
    var utc = Date.UTC(parts[0], parts[1] - 1, parts[2], time[0], time[1]) + 480 * 60000;
    var date = new Date(utc);
    return {
      businessDate: date.getUTCFullYear() +
        '-' + pad2(date.getUTCMonth() + 1) +
        '-' + pad2(date.getUTCDate()),
      intervalStart: pad2(date.getUTCHours()) + ':' + pad2(date.getUTCMinutes()),
    };
  }

  function verifyPrerequisites() {
    var report = {
      cxp07: null,
      cxp08: null,
      cxp09: null,
      cxp10: null,
    };
    var statusReaders = [
      { key: 'cxp07', read: typeof getCxp07HandledOfferedTransformationStatus === 'function'
        ? getCxp07HandledOfferedTransformationStatus
        : null },
      { key: 'cxp08', read: typeof getCxp08AhtAuxesStaffTransformationStatus === 'function'
        ? getCxp08AhtAuxesStaffTransformationStatus
        : null },
      { key: 'cxp09', read: typeof getCxp09StableAggregationStatus === 'function'
        ? getCxp09StableAggregationStatus
        : null },
      { key: 'cxp10', read: typeof getCxp10ReportingSurfaceStatus === 'function'
        ? getCxp10ReportingSurfaceStatus
        : null },
    ];
    statusReaders.forEach(function (entry) {
      if (!entry.read) {
        report[entry.key] = { available: false, status: null };
        return;
      }
      try {
        var status = entry.read();
        report[entry.key] = {
          available: true,
          complete: status.status === 'COMPLETE' && status.nextStep === status.stepCount,
          status: status.status,
        };
      } catch (error) {
        report[entry.key] = {
          available: true,
          complete: false,
          error: error && error.message ? String(error.message) : String(error),
        };
      }
    });
    var configuration = Config.load();
    var result = Object.freeze({
      controlConfigured: Boolean(configuration.controlSpreadsheetId),
      environment: configuration.environment,
      exportFolderConfigured: Boolean(configuration.legacyParityExportFolderId),
      prerequisites: Object.freeze(report),
      ready: ['cxp07', 'cxp08', 'cxp09', 'cxp10'].every(function (key) {
        return report[key] && report[key].complete === true;
      }) && Boolean(configuration.controlSpreadsheetId) &&
        Boolean(configuration.targetSpreadsheetId),
      targetConfigured: Boolean(configuration.targetSpreadsheetId),
    });
    uatLog('CXP11UatStep00.result', result);
    return result;
  }

  function install() {
    uatLog('CXP11UatStep01.start', {});
    if (typeof initializeCxp11ParityValidation !== 'function') {
      throw new Error('initializeCxp11ParityValidation is not available.');
    }
    var result = initializeCxp11ParityValidation();
    uatLog('CXP11UatStep01.done', {
      nextStep: result.nextStep,
      status: result.status,
      stepCount: result.stepCount,
    });
    return result;
  }

  function inspectControlContracts(spreadsheetId) {
    if (typeof diagnoseCxp11RunbookChecks !== 'function') {
      throw new Error('diagnoseCxp11RunbookChecks is not available.');
    }
    var report = diagnoseCxp11RunbookChecks(spreadsheetId);
    uatLog('CXP11UatStep02.result', {
      baselineTotalsOk: report.controls.sourceErrorBaseline.totalsOk === true,
      parityResultsSchemaOk: report.controls.parityResults.schemaOk === true,
      setupStatus: report.setupStatus ? report.setupStatus.status : null,
    });
    return report;
  }

  function loadSyntheticParityBundle(folderId, spreadsheetId) {
    var exportFolderId = resolveExportFolderId(folderId);
    var rawCounts = writeRawFixtureRows(spreadsheetId, FIXTURE.datasets);
    SpreadsheetApp.flush();
    var bundle = buildBundleFiles({
      datasets: FIXTURE.datasets,
      legacyErrors: FIXTURE.legacyErrors,
      legacyMetrics: deriveLegacyMetricsFromTarget(spreadsheetId),
    });
    var write = writeBundleToFolder(exportFolderId, bundle);
    var ledger = seedSyntheticLedgerEntry();
    var result = Object.freeze({
      fileCount: write.fileCount,
      fileNames: write.fileNames,
      ledger: ledger,
      rawRowCounts: rawCounts,
    });
    uatLog('CXP11UatStep03.done', result);
    return result;
  }

  function runParity(folderId, options) {
    var run = resolveParityRun();
    var request = options || {};
    var maxContinuations = request.maxContinuations || 20;
    var status = run.start(folderId ? resolveExportFolderId(folderId) : undefined, request);
    var continuations = 0;
    while (
      status.runState !== resolveContracts().RUN_STATES.complete &&
      status.runState !== resolveContracts().RUN_STATES.failed &&
      continuations < maxContinuations
    ) {
      status = run.continueRun(request);
      continuations += 1;
    }
    var result = Object.freeze({
      continuations: continuations,
      pass: Boolean(status.summary && status.summary.pass),
      status: status,
    });
    uatLog('CXP11UatStep04.result', {
      continuations: continuations,
      counters: status.counters,
      pass: result.pass,
      runState: status.runState,
      summary: status.summary,
    });
    return result;
  }

  /**
   * Confirms the DEC-025 alignment and the WB0817 error baseline are classified
   * as approved variance / expected source error rather than migration defects.
   */
  function validateExpectedVarianceAndErrors(request) {
    var contracts = resolveContracts();
    var comparator = resolveComparator().create({ contracts: contracts });
    var input = request || {};
    var legacyMetrics = input.legacyMetrics || [];
    var migratedMetrics = input.migratedMetrics || [];
    var metricChunk = comparator.compareMetricChunk({
      acquisitionTimestampUtc: input.acquisitionTimestampUtc ||
        FIXTURE.acquisitionTimestampUtc,
      legacyMetrics: legacyMetrics,
      metricIndex: 0,
      metricNames: contracts.listMetrics(),
      migratedMetrics: migratedMetrics,
      runId: input.runId || 'CXP11-UAT-STEP05',
    });
    var errorChunk = comparator.classifyLegacyErrors({
      baselineRecords: input.baselineRecords || resolveBaseline().listRecords(),
      legacyErrors: input.legacyErrors || FIXTURE.legacyErrors,
      runId: input.runId || 'CXP11-UAT-STEP05',
    });
    var counters = comparator.accumulate(
      comparator.accumulate(comparator.emptyCounters(), metricChunk.comparisons),
      errorChunk.comparisons,
    );
    var summary = comparator.summarize(counters);
    var result = Object.freeze({
      approvedVarianceCount: counters[contracts.CLASSIFICATIONS.approvedExpectedVariance],
      baselineExpectedTotal: errorChunk.expectedTotal,
      baselineObservedTotal: errorChunk.observedTotal,
      defectCount: summary.defectCount,
      expectedSourceErrorCount: counters[contracts.CLASSIFICATIONS.expectedSourceError],
      migrationDefectCount: counters[contracts.CLASSIFICATIONS.migrationDefect],
      pass: summary.defectCount === 0 &&
        errorChunk.observedTotal === errorChunk.expectedTotal,
    });
    uatLog('CXP11UatStep05.result', result);
    return result;
  }

  /**
   * Forces a mid-phase yield (zero budget), resumes to completion, then reruns a
   * second weekly bundle with no code or comparison-logic change.
   */
  function resumeAndSecondBundle(folderId, options) {
    var request = options || {};
    var run = resolveParityRun();
    var resolvedFolder = folderId ? resolveExportFolderId(folderId) : undefined;
    run.reset(Object.assign({ force: true }, request));
    var forced = run.start(resolvedFolder, Object.assign({}, request, { maxRuntimeMs: 0 }));
    var yielded = forced.runState !== resolveContracts().RUN_STATES.complete;
    var resumed = runParity(folderId, request);
    run.reset(Object.assign({ force: true }, request));
    var second = runParity(folderId, request);
    var result = Object.freeze({
      firstRunId: forced.runId,
      pass: yielded && resumed.pass === true && second.pass === true,
      resumeContinuations: resumed.continuations,
      secondBundlePass: second.pass,
      secondRunId: second.status.runId,
      yielded: yielded,
    });
    uatLog('CXP11UatStep06.result', result);
    return result;
  }

  function reinstallAndRerun(folderId, options) {
    var installResult = install();
    var rerun = runParity(folderId, Object.assign({ force: true }, options || {}));
    var result = Object.freeze({
      installStatus: installResult.status,
      pass: installResult.status === 'COMPLETE' && rerun.pass === true,
      rerunPass: rerun.pass,
    });
    uatLog('CXP11UatStep07.result', result);
    return result;
  }

  function promotionGate(spreadsheetId) {
    var contracts = resolveContracts();
    var setupStatus = typeof getCxp11ParityValidationSetupStatus === 'function'
      ? getCxp11ParityValidationSetupStatus()
      : null;
    var runStatus = resolveParityRun().getStatus();
    var diagnostic;
    try {
      diagnostic = inspectControlContracts(spreadsheetId);
    } catch (error) {
      diagnostic = { controls: { parityResults: {}, sourceErrorBaseline: {} } };
    }
    var setupComplete = Boolean(
      setupStatus &&
      setupStatus.status === contracts.SETUP_STATES.complete &&
      setupStatus.nextStep === setupStatus.stepCount,
    );
    var schemasReady = diagnostic.controls.parityResults.schemaOk === true &&
      diagnostic.controls.sourceErrorBaseline.schemaOk === true &&
      diagnostic.controls.sourceErrorBaseline.totalsOk === true;
    var sourceIdentityVerified = Boolean(
      runStatus.runId &&
      runStatus.baselineObservedTotal === runStatus.baselineExpectedTotal,
    );
    var parityComplete = runStatus.runState === contracts.RUN_STATES.complete;
    var summary = runStatus.summary;
    var result = Object.freeze({
      parityComplete: parityComplete,
      promotionReady: setupComplete && schemasReady && parityComplete &&
        sourceIdentityVerified && Boolean(summary && summary.pass) &&
        summary.datasetCount === contracts.DATASET_FILES.length &&
        summary.metricCount === contracts.listMetrics().length,
      runStatus: runStatus,
      schemasReady: schemasReady,
      setupComplete: setupComplete,
      sourceIdentityVerified: sourceIdentityVerified,
      summary: summary,
    });
    uatLog('CXP11UatStep08.result', {
      parityComplete: result.parityComplete,
      promotionReady: result.promotionReady,
      schemasReady: result.schemasReady,
      setupComplete: result.setupComplete,
      summary: result.summary,
    });
    return result;
  }

  return Object.freeze({
    FIXTURE: FIXTURE,
    SYNTHETIC_LEDGER_RUN_ID: SYNTHETIC_LEDGER_RUN_ID,
    buildBundleFiles: buildBundleFiles,
    createFixtureExportReader: createFixtureExportReader,
    deriveLegacyMetricsFromTarget: deriveLegacyMetricsFromTarget,
    inspectControlContracts: inspectControlContracts,
    install: install,
    loadSyntheticParityBundle: loadSyntheticParityBundle,
    promotionGate: promotionGate,
    reinstallAndRerun: reinstallAndRerun,
    resumeAndSecondBundle: resumeAndSecondBundle,
    runParity: runParity,
    seedSyntheticLedgerEntry: seedSyntheticLedgerEntry,
    shiftToLegacyUtcGrain: shiftForward,
    validateExpectedVarianceAndErrors: validateExpectedVarianceAndErrors,
    verifyPrerequisites: verifyPrerequisites,
    writeBundleToFolder: writeBundleToFolder,
    writeRawFixtureRows: writeRawFixtureRows,
  });
})();

function CXP11UatStep00VerifyPrerequisites() {
  return Cxp11ParityUat.verifyPrerequisites();
}

function CXP11UatStep01Install() {
  return Cxp11ParityUat.install();
}

function CXP11UatStep02InspectControlContracts() {
  return Cxp11ParityUat.inspectControlContracts();
}

function CXP11UatStep03LoadSyntheticParityBundle() {
  return Cxp11ParityUat.loadSyntheticParityBundle();
}

function CXP11UatStep04RunParity() {
  return Cxp11ParityUat.runParity();
}

function CXP11UatStep05ValidateExpectedVarianceAndErrors() {
  return Cxp11ParityUat.validateExpectedVarianceAndErrors();
}

function CXP11UatStep06ResumeAndSecondBundle() {
  return Cxp11ParityUat.resumeAndSecondBundle();
}

function CXP11UatStep07ReinstallAndRerun() {
  return Cxp11ParityUat.reinstallAndRerun();
}

function CXP11UatStep08PromotionGate() {
  return Cxp11ParityUat.promotionGate();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Cxp11ParityUat;
}
