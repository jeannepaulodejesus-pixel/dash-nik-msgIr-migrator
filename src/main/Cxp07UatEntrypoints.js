/**
 * CXP-07 hosted UAT helpers for runbook "Parity and peak evidence".
 *
 * Editor entrypoints (parameterless):
 *   cxp07UatStep1LoadParityFixture
 *   cxp07UatStep1RecordParityOutputs
 *   cxp07UatStep1RunParity
 *   cxp07UatStep2PeakFlushTiming
 *   cxp07UatStep3SecondBundleRefresh
 *   continueCxp07UatStep3Refresh
 *   getCxp07UatStep3Status
 *   cxp07UatStep4ReinstallTopology
 *   cxp07UatStep4VerifyTopology
 */

var Cxp07ParityUat = (function () {
  'use strict';

  // Mirror of tests/fixtures/cxp07/handled-offered-parity.json (embedded for Apps Script).
  var FIXTURE = Object.freeze({
    inputs: Object.freeze({
      handledRows: Object.freeze([
        Object.freeze({
          'Case: Case Number': 'C-100',
          'Messaging Session Name': 'SESSION-100',
          'Initial Athlete CS Owner': 'NA',
          'Speed to Answer': 42,
          'Initial Athlete Site': 'PH',
          Language: 'English',
        }),
        Object.freeze({
          'Case: Case Number': 'C-200',
          'Messaging Session Name': 'SESSION-200',
          'Initial Athlete CS Owner': 'NA',
          'Speed to Answer': 95,
          'Initial Athlete Site': 'LAS',
          Language: 'Spanish',
        }),
      ]),
      offeredRows: Object.freeze([
        Object.freeze({
          'Case: Case Number': 'C-100',
          'Messaging Session Name': 'SESSION-100',
          Language: 'English',
          'Initial Athlete CS Owner': 'NA',
          'Contact Fragment Count': null,
        }),
        Object.freeze({
          'Case: Case Number': 'C-200',
          'Messaging Session Name': 'SESSION-200',
          Language: 'English',
          'Initial Athlete CS Owner': 'NA',
          'Contact Fragment Count': 2,
        }),
      ]),
      ahtRows: Object.freeze([
        Object.freeze({
          'Work Item: Name': 'SESSION-100',
          'Accept Date': '2026-08-18T07:45:00.000Z',
          'Handle Time': 120,
          'Active Time': 100,
          'Speed To Answer': 50,
          'Time To First Response': 20,
        }),
        Object.freeze({
          'Work Item: Name': 'SESSION-100',
          'Accept Date': '2026-08-18T07:50:00.000Z',
          'Handle Time': 180,
          'Active Time': 140,
          'Speed To Answer': 55,
          'Time To First Response': 25,
        }),
        Object.freeze({
          'Work Item: Name': 'SESSION-200',
          'Accept Date': '2026-08-18T08:05:00.000Z',
          'Handle Time': 90,
          'Active Time': 60,
          'Speed To Answer': 100,
          'Time To First Response': 5,
        }),
      ]),
    }),
    expected: Object.freeze({
      handled: Object.freeze([
        Object.freeze({
          'Accept Date': '2026-08-17',
          Interval: '23:30',
          AHT: 300,
        }),
        Object.freeze({
          'Accept Date': '2026-08-18',
          Interval: '00:00',
          AHT: 90,
        }),
      ]),
      offered: Object.freeze([
        Object.freeze({
          'Accept Date': '2026-08-17',
          'Interval View': '23:30',
          'Athlete Site': 'PH',
          SL: 1,
          ASA: 50,
          'Handled SL': 1,
          'Handled ASA': 42,
          Count: 1,
          Handled: 1,
          'Handled Fragments': 1,
          Response: 20,
          'SL Total': 1,
          'SL Total (Session)': 1,
          'AHT Session': 300,
          'Active Time': 240,
        }),
        Object.freeze({
          'Accept Date': '2026-08-18',
          'Interval View': '00:00',
          'Athlete Site': 'LAS',
          SL: 0,
          ASA: 100,
          'Handled SL': 0,
          'Handled ASA': 95,
          Count: 1,
          Handled: 0,
          'Handled Fragments': 2,
          Response: 5,
          'SL Total': 0,
          'SL Total (Session)': 0,
          'AHT Session': 90,
          'Active Time': 60,
        }),
      ]),
    }),
  });

  // Second valid bundle for runbook step 3 (different sessions/values; no formula reinstall).
  var SECOND_FIXTURE = Object.freeze({
    inputs: Object.freeze({
      handledRows: Object.freeze([
        Object.freeze({
          'Case: Case Number': 'C-300',
          'Messaging Session Name': 'SESSION-300',
          'Initial Athlete CS Owner': 'NA',
          'Speed to Answer': 30,
          'Initial Athlete Site': 'PH',
          Language: 'English',
        }),
        Object.freeze({
          'Case: Case Number': 'C-400',
          'Messaging Session Name': 'SESSION-400',
          'Initial Athlete CS Owner': 'NA',
          'Speed to Answer': 100,
          'Initial Athlete Site': 'LAS',
          Language: 'Spanish',
        }),
      ]),
      offeredRows: Object.freeze([
        Object.freeze({
          'Case: Case Number': 'C-300',
          'Messaging Session Name': 'SESSION-300',
          Language: 'English',
          'Initial Athlete CS Owner': 'NA',
          'Contact Fragment Count': null,
        }),
        Object.freeze({
          'Case: Case Number': 'C-400',
          'Messaging Session Name': 'SESSION-400',
          Language: 'English',
          'Initial Athlete CS Owner': 'NA',
          'Contact Fragment Count': 3,
        }),
      ]),
      ahtRows: Object.freeze([
        Object.freeze({
          'Work Item: Name': 'SESSION-300',
          'Accept Date': '2026-08-20T07:45:00.000Z',
          'Handle Time': 50,
          'Active Time': 40,
          'Speed To Answer': 25,
          'Time To First Response': 10,
        }),
        Object.freeze({
          'Work Item: Name': 'SESSION-400',
          'Accept Date': '2026-08-20T08:05:00.000Z',
          'Handle Time': 70,
          'Active Time': 55,
          'Speed To Answer': 110,
          'Time To First Response': 8,
        }),
      ]),
    }),
    expected: Object.freeze({
      handled: Object.freeze([
        Object.freeze({
          'Accept Date': '2026-08-19',
          Interval: '23:30',
          AHT: 50,
        }),
        Object.freeze({
          'Accept Date': '2026-08-20',
          Interval: '00:00',
          AHT: 70,
        }),
      ]),
      offered: Object.freeze([
        Object.freeze({
          'Accept Date': '2026-08-19',
          'Interval View': '23:30',
          'Athlete Site': 'PH',
          SL: 1,
          ASA: 25,
          'Handled SL': 1,
          'Handled ASA': 30,
          Count: 1,
          Handled: 1,
          'Handled Fragments': 1,
          Response: 10,
          'SL Total': 1,
          'SL Total (Session)': 1,
          'AHT Session': 50,
          'Active Time': 40,
        }),
        Object.freeze({
          'Accept Date': '2026-08-20',
          'Interval View': '00:00',
          'Athlete Site': 'LAS',
          SL: 0,
          ASA: 110,
          'Handled SL': 0,
          'Handled ASA': 100,
          Count: 1,
          Handled: 0,
          'Handled Fragments': 3,
          Response: 8,
          'SL Total': 0,
          'SL Total (Session)': 0,
          'AHT Session': 70,
          'Active Time': 55,
        }),
      ]),
    }),
  });

  var HANDLED_CALC_HEADERS = Object.freeze(['Accept Date', 'Interval', 'AHT']);
  var OFFERED_CALC_HEADERS = Object.freeze([
    'Accept Date',
    'Interval View',
    'Athlete Site',
    'SL',
    'ASA',
    'Handled SL',
    'Handled ASA',
    'Count',
    'Handled',
    'Handled Fragments',
    'Response',
    'SL Total',
    'SL Total (Session)',
    'AHT Session',
    'Active Time',
  ]);

  var telemetryStartedAtMs = Date.now();

  function resetTelemetryClock() {
    telemetryStartedAtMs = Date.now();
  }

  function resolvePhaseStatus(step) {
    if (/\.start$/.test(step)) {
      return { operationName: step.replace(/\.start$/, ''), status: 'STARTED' };
    }
    if (/\.fail$/.test(step)) {
      return { operationName: step.replace(/\.fail$/, ''), status: 'FAILED' };
    }
    if (/\.(done|complete|pass)$/.test(step)) {
      return {
        operationName: step.replace(/\.(done|complete|pass)$/, ''),
        status: 'COMPLETED',
      };
    }
    return { operationName: step, status: 'INFO' };
  }

  /**
   * Match CXP-06 hosted telemetry:
   *   CXP_UAT_PHASE {"operationName":"...","status":"STARTED|COMPLETED|FAILED","elapsedMs":N,...}
   */
  function uatLog(step, details) {
    var phase = resolvePhaseStatus(step);
    var event = {
      operationName: phase.operationName,
      status: phase.status,
      elapsedMs: Date.now() - telemetryStartedAtMs,
    };
    if (details && typeof details === 'object') {
      Object.keys(details).forEach(function (key) {
        if (key === 'operationName' || key === 'status' || key === 'elapsedMs') {
          return;
        }
        event[key] = details[key];
      });
    }
    var line = 'CXP_UAT_PHASE ' + JSON.stringify(event);
    if (typeof console !== 'undefined' && typeof console.log === 'function') {
      console.log(line);
    }
    if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') {
      Logger.log(line);
    }
  }

  function countFormulaErrors(sheet, startCol, colCount, maxScanRows) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return {
        scannedRows: 0,
        refError: 0,
        parseOrOtherError: 0,
        naCount: 0,
      };
    }
    var endRow = Math.min(lastRow, 1 + maxScanRows);
    var values = sheet.getRange(2, startCol, endRow, colCount).getDisplayValues();
    var refError = 0;
    var parseOrOtherError = 0;
    var naCount = 0;
    values.forEach(function (row) {
      row.forEach(function (cell) {
        var text = String(cell || '');
        if (text === '#N/A') {
          naCount += 1;
        } else if (text === '#REF!') {
          refError += 1;
        } else if (
          text.indexOf('#ERROR!') === 0 ||
          text.indexOf('#NAME?') === 0 ||
          text.indexOf('#VALUE!') === 0 ||
          text.indexOf('#NUM!') === 0 ||
          text.indexOf('#DIV/0!') === 0
        ) {
          parseOrOtherError += 1;
        }
      });
    });
    return {
      scannedRows: endRow - 1,
      refError: refError,
      parseOrOtherError: parseOrOtherError,
      naCount: naCount,
    };
  }

  function sheetRowStats(ss, sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return { present: false, sheetName: sheetName };
    }
    var lastRow = sheet.getLastRow();
    return {
      present: true,
      sheetName: sheetName,
      lastRow: lastRow,
      dataRowsApprox: Math.max(0, lastRow - 1),
      lastColumn: sheet.getLastColumn(),
    };
  }

  // Runbook asks for approximately 5,000 Handled + Offered rows for peak evidence.
  var PEAK_MIN_DATA_ROWS = 4500;

  function assertPeakTarget(ss) {
    var configuration = resolveConfig().load();
    var targetId = ss.getId();
    var controlId = configuration.controlSpreadsheetId;
    if (controlId && targetId === controlId) {
      throw new Error(
        'CXP-07 step 2 refused control workbook. ' +
          'CXP_' + configuration.environment + '_TARGET_SPREADSHEET_ID must be the ' +
          'DEV/UAT target (not CONTROL). Current title=' + ss.getName(),
      );
    }
    var title = String(ss.getName() || '');
    if (/CONTROL/i.test(title) && !/TARGET/i.test(title)) {
      throw new Error(
        'CXP-07 step 2 refused workbook titled like a control book: ' + title +
          '. Point TARGET_SPREADSHEET_ID at DEV_TARGET_WORKBOOK.',
      );
    }
  }

  function runStep2PeakFlushTiming(spreadsheetId) {
    resetTelemetryClock();
    uatLog('step2.peak.start', {});
    var ss = openTarget(spreadsheetId);
    uatLog('step2.peak.target_opened', {
      spreadsheetId: ss.getId(),
      title: ss.getName(),
    });
    assertPeakTarget(ss);

    var rawBefore = {
      handled: sheetRowStats(ss, '_RAW_HANDLED'),
      offered: sheetRowStats(ss, '_RAW_OFFERED'),
      aht: sheetRowStats(ss, '_RAW_AHT'),
    };
    uatLog('step2.peak.raw_counts', rawBefore);

    var handledRows = rawBefore.handled.dataRowsApprox || 0;
    var offeredRows = rawBefore.offered.dataRowsApprox || 0;
    if (handledRows < PEAK_MIN_DATA_ROWS || offeredRows < PEAK_MIN_DATA_ROWS) {
      var scaleFail = {
        pass: false,
        executionOutcome: 'FAIL_BELOW_PEAK_SCALE',
        minRequiredDataRows: PEAK_MIN_DATA_ROWS,
        handledDataRows: handledRows,
        offeredDataRows: offeredRows,
        raw: rawBefore,
        note:
          'Peak evidence requires ~5k Handled + ~5k Offered on the TARGET workbook. ' +
          'Load via cxp06UatCase1PeakSuccess against the correct TARGET, then re-run.',
      };
      uatLog('step2.peak.fail', scaleFail);
      throw new Error(
        'CXP-07 step 2 below peak scale: Handled=' + handledRows +
          ' Offered=' + offeredRows + ' (need >=' + PEAK_MIN_DATA_ROWS + ' each).',
      );
    }

    var calcHandled = requireSheet(ss, '_CALC_HANDLED');
    var calcOffered = requireSheet(ss, '_CALC_OFFERED');
    uatLog('step2.peak.flush.start', {});
    var t0 = Date.now();
    SpreadsheetApp.flush();
    var elapsedMs = Date.now() - t0;
    uatLog('step2.peak.flush.done', { elapsedMs: elapsedMs });

    var calcAfter = {
      handled: sheetRowStats(ss, '_CALC_HANDLED'),
      offered: sheetRowStats(ss, '_CALC_OFFERED'),
    };
    uatLog('step2.peak.calc_counts', calcAfter);

    var handledAnchorFormulas = calcHandled.getRange(2, 1, 2, 4).getFormulas()[0];
    var offeredAnchorFormulas = calcOffered.getRange(2, 1, 2, 16).getFormulas()[0];
    var handledAnchors = handledAnchorFormulas.filter(Boolean).length;
    var offeredAnchors = offeredAnchorFormulas.filter(Boolean).length;
    var calcInstalled =
      handledAnchors === 4 &&
      offeredAnchors === 16 &&
      (calcAfter.handled.dataRowsApprox || 0) >= PEAK_MIN_DATA_ROWS &&
      (calcAfter.offered.dataRowsApprox || 0) >= PEAK_MIN_DATA_ROWS;
    uatLog('step2.peak.calc_install_check', {
      handledAnchors: handledAnchors,
      offeredAnchors: offeredAnchors,
      handledCalcRows: calcAfter.handled.dataRowsApprox || 0,
      offeredCalcRows: calcAfter.offered.dataRowsApprox || 0,
      calcInstalled: calcInstalled,
    });
    if (!calcInstalled) {
      var installFail = {
        pass: false,
        executionOutcome: 'FAIL_CALC_NOT_INSTALLED',
        calc: calcAfter,
        handledAnchors: handledAnchors,
        offeredAnchors: offeredAnchors,
        note:
          'Peak raw is present but _CALC_* lacks row-2 anchors and/or spilled rows. ' +
          'Run initializeCxp07HandledOfferedTransformations on this TARGET, wait for COMPLETE, then re-run step 2.',
      };
      uatLog('step2.peak.fail', installFail);
      throw new Error(
        'CXP-07 step 2: calc sheets not installed/spilled on this target ' +
          '(Handled anchors=' + handledAnchors + '/4, Offered=' + offeredAnchors +
          '/16, calc rows H/O=' +
          (calcAfter.handled.dataRowsApprox || 0) + '/' +
          (calcAfter.offered.dataRowsApprox || 0) + ').',
      );
    }

    // Scan calculated columns only (Handled A:C, Offered A:O). Cap rows for runtime.
    var handledErrors = countFormulaErrors(calcHandled, 1, 3, 5000);
    var offeredErrors = countFormulaErrors(calcOffered, 1, 15, 5000);
    uatLog('step2.peak.error_scan', {
      handled: handledErrors,
      offered: offeredErrors,
      note: '#N/A may be intentional for missing Handled ASA cases',
    });

    var hasBlockingErrors =
      handledErrors.refError > 0 ||
      handledErrors.parseOrOtherError > 0 ||
      offeredErrors.refError > 0 ||
      offeredErrors.parseOrOtherError > 0;

    var report = {
      spreadsheetId: ss.getId(),
      title: ss.getName(),
      elapsedMs: elapsedMs,
      raw: rawBefore,
      calc: calcAfter,
      errors: {
        handled: handledErrors,
        offered: offeredErrors,
      },
      executionOutcome: hasBlockingErrors ? 'FAIL_FORMULA_ERRORS' : 'SUCCESS',
      pass: !hasBlockingErrors,
    };
    uatLog(report.pass ? 'step2.peak.pass' : 'step2.peak.fail', {
      pass: report.pass,
      elapsedMs: elapsedMs,
      executionOutcome: report.executionOutcome,
    });
    uatLog('step2.peak.complete', report);
    if (!report.pass) {
      throw new Error(
        'CXP-07 step 2 peak flush found blocking formula errors (#REF!/parse). See Logger.',
      );
    }
    return report;
  }

  function resolveSchemaRegistry() {
    if (typeof SchemaRegistry !== 'undefined') {
      return SchemaRegistry;
    }
    return require('../ingestion/SchemaRegistry.js');
  }

  function resolveConfig() {
    if (typeof Config !== 'undefined') {
      return Config;
    }
    return require('../config/Config.js');
  }

  function openTarget(spreadsheetId) {
    var id = spreadsheetId;
    if (!id || typeof id !== 'string') {
      id = resolveConfig().load().targetSpreadsheetId;
    }
    if (!id) {
      throw new Error('A target spreadsheet ID is required for CXP-07 parity UAT.');
    }
    return SpreadsheetApp.openById(id);
  }

  function requireSheet(ss, name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      throw new Error('Required sheet is missing: ' + name);
    }
    return sheet;
  }

  function blankForHeader(header, schema) {
    var column = schema.columns.filter(function (c) {
      return c.name === header;
    })[0];
    if (!column) {
      return '';
    }
    if (column.type === 'number') {
      return 0;
    }
    return '';
  }

  function completeRow(headers, schema, overrides, extras) {
    var row = headers.map(function (header) {
      if (Object.prototype.hasOwnProperty.call(overrides, header)) {
        var value = overrides[header];
        return value === null || value === undefined ? '' : value;
      }
      if (extras && Object.prototype.hasOwnProperty.call(extras, header)) {
        return extras[header];
      }
      return blankForHeader(header, schema);
    });
    return row;
  }

  function clearSheetContent(sheet, clearRows, clearCols) {
    var rows = Math.max(1, clearRows || 1);
    var cols = Math.max(1, clearCols || 1);
    // Prefer whole-sheet clearContents for peak-sized sheets. Chunked
    // clearContent + flush forces calc spills to recalc and can exceed the
    // 6-minute Apps Script limit when _CALC_* already span ~10k rows.
    if (rows >= 500 || (typeof sheet.getLastRow === 'function' && sheet.getLastRow() >= 500)) {
      if (typeof sheet.clearContents === 'function') {
        sheet.clearContents();
        return;
      }
      if (typeof sheet.clear === 'function') {
        sheet.clear();
        return;
      }
    }
    sheet.getRange(1, 1, rows, cols).clearContent();
  }

  function writeDataset(sheet, headers, rows, logPrefix) {
    var prefix = logPrefix || 'step1.parity';
    var sheetName = typeof sheet.getName === 'function' ? sheet.getName() : 'unknown';
    uatLog(prefix + '.write.start', {
      sheetName: sheetName,
      headerCount: headers.length,
      dataRows: rows.length,
    });
    var lastRow = typeof sheet.getLastRow === 'function' ? sheet.getLastRow() : 0;
    var lastColumn = typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : 0;
    var clearRows = Math.max(lastRow, rows.length + 1, 1);
    var clearCols = Math.max(lastColumn, headers.length, 1);
    uatLog(prefix + '.write.clear.start', {
      sheetName: sheetName,
      clearRows: clearRows,
      clearCols: clearCols,
    });
    clearSheetContent(sheet, clearRows, clearCols);
    uatLog(prefix + '.write.clear.done', { sheetName: sheetName });

    var matrix = [headers].concat(rows);
    var range = sheet.getRange(1, 1, matrix.length, headers.length);
    range.setNumberFormat('@');
    range.setValues(matrix);
    uatLog(prefix + '.write.done', {
      sheetName: sheetName,
      writtenRowsIncludingHeader: matrix.length,
    });
  }

  function buildHandledMatrix(fixture, logPrefix) {
    var prefix = logPrefix || 'step1.parity';
    var source = fixture || FIXTURE;
    uatLog(prefix + '.build.handled.start', {});
    var schema = resolveSchemaRegistry().getSchema('Handled');
    var headers = schema.requiredHeaders.slice();
    var rows = source.inputs.handledRows.map(function (partial) {
      return completeRow(headers, schema, partial, {
        'Case Language': partial.Language || '',
      });
    });
    uatLog(prefix + '.build.handled.done', {
      headerCount: headers.length,
      dataRows: rows.length,
      sessions: source.inputs.handledRows.map(function (row) {
        return row['Messaging Session Name'];
      }),
    });
    return { headers: headers, rows: rows };
  }

  function buildOfferedMatrix(fixture, logPrefix) {
    var prefix = logPrefix || 'step1.parity';
    var source = fixture || FIXTURE;
    uatLog(prefix + '.build.offered.start', {});
    var schema = resolveSchemaRegistry().getSchema('Offered');
    var headers = schema.requiredHeaders.slice();
    var rows = source.inputs.offeredRows.map(function (partial) {
      return completeRow(headers, schema, partial);
    });
    uatLog(prefix + '.build.offered.done', {
      headerCount: headers.length,
      dataRows: rows.length,
      sessions: source.inputs.offeredRows.map(function (row) {
        return row['Messaging Session Name'];
      }),
    });
    return { headers: headers, rows: rows };
  }

  function buildAhtMatrix(fixture, logPrefix, agentPrefix) {
    var prefix = logPrefix || 'step1.parity';
    var source = fixture || FIXTURE;
    var idPrefix = agentPrefix || 'AW-PARITY-';
    uatLog(prefix + '.build.aht.start', {});
    var schema = resolveSchemaRegistry().getSchema('AHT - Raw');
    var headers = schema.requiredHeaders.slice();
    var rows = source.inputs.ahtRows.map(function (partial, index) {
      return completeRow(headers, schema, partial, {
        'Agent Work ID': idPrefix + (index + 1),
        'Speed to Answer': partial['Speed To Answer'],
      });
    });
    uatLog(prefix + '.build.aht.done', {
      headerCount: headers.length,
      dataRows: rows.length,
      acceptDates: source.inputs.ahtRows.map(function (row) {
        return row['Accept Date'];
      }),
    });
    return { headers: headers, rows: rows };
  }

  function loadFixtureBundle(spreadsheetId, options) {
    var opts = options || {};
    var fixture = opts.fixture || FIXTURE;
    var prefix = opts.logPrefix || 'step1.parity';
    var agentPrefix = opts.agentPrefix || 'AW-PARITY-';
    var skipFlush = opts.skipFlush === true;
    uatLog(prefix + '.load.start', {});
    var ss = openTarget(spreadsheetId);
    uatLog(prefix + '.load.target_opened', {
      spreadsheetId: ss.getId(),
      title: ss.getName(),
    });
    var handled = buildHandledMatrix(fixture, prefix);
    var offered = buildOfferedMatrix(fixture, prefix);
    var aht = buildAhtMatrix(fixture, prefix, agentPrefix);

    writeDataset(requireSheet(ss, '_RAW_HANDLED'), handled.headers, handled.rows, prefix);
    writeDataset(requireSheet(ss, '_RAW_OFFERED'), offered.headers, offered.rows, prefix);
    writeDataset(requireSheet(ss, '_RAW_AHT'), aht.headers, aht.rows, prefix);

    if (skipFlush) {
      uatLog(prefix + '.load.flush.skipped', {
        note: 'Deferred flush to avoid peak calc recalc during multi-sheet clear/write',
      });
    } else {
      uatLog(prefix + '.load.flush.start', {});
      SpreadsheetApp.flush();
      uatLog(prefix + '.load.flush.done', {});
    }

    var report = {
      spreadsheetId: ss.getId(),
      title: ss.getName(),
      loaded: {
        handledRows: handled.rows.length,
        offeredRows: offered.rows.length,
        ahtRows: aht.rows.length,
      },
      flushed: !skipFlush,
    };
    uatLog(prefix + '.load.complete', report);
    return report;
  }

  var STEP3_STATE_KEY = 'CXP07_UAT_STEP3_STATE';
  var STEP3_CONTINUE_HANDLER = 'continueCxp07UatStep3Refresh';
  var STEP3_PHASES = Object.freeze([
    'WRITE_HANDLED',
    'WRITE_OFFERED',
    'WRITE_AHT',
    'VERIFY',
  ]);

  function resolveStep3Properties() {
    if (
      typeof PropertiesService !== 'undefined' &&
      PropertiesService &&
      typeof PropertiesService.getScriptProperties === 'function'
    ) {
      return PropertiesService.getScriptProperties();
    }
    throw new Error('Script Properties are required for resumable CXP-07 step 3.');
  }

  function loadStep3State(properties) {
    var raw = properties.getProperty(STEP3_STATE_KEY);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error('The persisted CXP-07 step 3 state is invalid.');
    }
  }

  function saveStep3State(properties, state) {
    properties.setProperty(STEP3_STATE_KEY, JSON.stringify(state));
  }

  function clearStep3State(properties) {
    if (typeof properties.deleteProperty === 'function') {
      properties.deleteProperty(STEP3_STATE_KEY);
      return;
    }
    properties.setProperty(STEP3_STATE_KEY, '');
  }

  function removeStep3Triggers(scriptApp) {
    if (!scriptApp || typeof scriptApp.getProjectTriggers !== 'function') {
      return;
    }
    scriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger.getHandlerFunction() === STEP3_CONTINUE_HANDLER) {
        scriptApp.deleteTrigger(trigger);
      }
    });
  }

  function scheduleStep3Continuation(scriptApp, delayMs) {
    if (!scriptApp || typeof scriptApp.newTrigger !== 'function') {
      return false;
    }
    removeStep3Triggers(scriptApp);
    scriptApp.newTrigger(STEP3_CONTINUE_HANDLER).timeBased().after(delayMs || 30000).create();
    return true;
  }

  function publicStep3Status(state, continuationScheduled) {
    return Object.freeze({
      continuationScheduled: continuationScheduled === true,
      lastError: state && state.lastError ? state.lastError : null,
      phase: state && state.phase ? state.phase : null,
      phaseIndex: state && Number.isFinite(state.phaseIndex) ? state.phaseIndex : 0,
      phaseCount: STEP3_PHASES.length,
      spreadsheetId: state && state.spreadsheetId ? state.spreadsheetId : null,
      status: state && state.status ? state.status : 'IDLE',
      updatedAtUtc: state && state.updatedAtUtc ? state.updatedAtUtc : null,
    });
  }

  function getStep3Status() {
    var state = loadStep3State(resolveStep3Properties());
    var status = publicStep3Status(state, false);
    uatLog('step3.refresh.status', status);
    return status;
  }

  function runStep3Verify(ss, state) {
    var prefix = 'step3.refresh';
    var handledSheet = requireSheet(ss, '_CALC_HANDLED');
    var offeredSheet = requireSheet(ss, '_CALC_OFFERED');
    uatLog(prefix + '.recalc_wait.start', { sleepMs: 1500 });
    Utilities.sleep(1500);
    SpreadsheetApp.flush();
    uatLog(prefix + '.recalc_wait.done', {});

    var handledFormulaAfter = handledSheet.getRange(2, 1).getFormula();
    var offeredFormulaAfter = offeredSheet.getRange(2, 1).getFormula();
    var formulasUnchanged =
      handledFormulaAfter === state.handledFormulaBefore &&
      offeredFormulaAfter === state.offeredFormulaBefore;
    uatLog(prefix + '.formulas_after', {
      formulasUnchanged: formulasUnchanged,
    });
    if (!formulasUnchanged) {
      throw new Error(
        'CXP-07 step 3 failed: calc formula anchors changed (reinstall detected).',
      );
    }

    var compare = recordFixtureOutputs(ss.getId(), {
      fixture: SECOND_FIXTURE,
      logPrefix: prefix,
      priorSessionsMustBeAbsent: ['SESSION-100', 'SESSION-200'],
      sessions: ['SESSION-300', 'SESSION-400'],
      timezoneCheck: {
        session300: 'UTC 07:45 -> prior fixed-PST date 2026-08-19 @ 23:30',
        session400: 'UTC 08:05 -> same UTC date 2026-08-20 @ 00:00',
      },
    });
    if (!compare.pass) {
      throw new Error(
        'CXP-07 step 3 second-bundle refresh failed. See Logger for diffs.',
      );
    }
    return {
      formulasUnchanged: formulasUnchanged,
      compare: compare,
      pass: true,
    };
  }

  function runStep3Phase(ss, state) {
    var phase = state.phase;
    var prefix = 'step3.refresh';
    if (phase === 'WRITE_HANDLED') {
      var handled = buildHandledMatrix(SECOND_FIXTURE, prefix);
      writeDataset(
        requireSheet(ss, '_RAW_HANDLED'),
        handled.headers,
        handled.rows,
        prefix,
      );
      return { wrote: 'Handled', rows: handled.rows.length };
    }
    if (phase === 'WRITE_OFFERED') {
      var offered = buildOfferedMatrix(SECOND_FIXTURE, prefix);
      writeDataset(
        requireSheet(ss, '_RAW_OFFERED'),
        offered.headers,
        offered.rows,
        prefix,
      );
      return { wrote: 'Offered', rows: offered.rows.length };
    }
    if (phase === 'WRITE_AHT') {
      var aht = buildAhtMatrix(SECOND_FIXTURE, prefix, 'AW-REFRESH-');
      writeDataset(requireSheet(ss, '_RAW_AHT'), aht.headers, aht.rows, prefix);
      return { wrote: 'AHT', rows: aht.rows.length };
    }
    if (phase === 'VERIFY') {
      return runStep3Verify(ss, state);
    }
    throw new Error('Unknown CXP-07 step 3 phase: ' + phase);
  }

  function advanceStep3(continueOnly) {
    resetTelemetryClock();
    var properties = resolveStep3Properties();
    var scriptApp = typeof ScriptApp !== 'undefined' ? ScriptApp : null;
    var state = loadStep3State(properties);

    if (continueOnly && (!state || state.status === 'COMPLETE' || state.status === 'FAILED')) {
      return publicStep3Status(state, false);
    }

    if (!state || state.status === 'COMPLETE' || state.status === 'FAILED') {
      var ssInit = openTarget();
      var handledSheet = requireSheet(ssInit, '_CALC_HANDLED');
      var offeredSheet = requireSheet(ssInit, '_CALC_OFFERED');
      var handledFormulaBefore = handledSheet.getRange(2, 1).getFormula();
      var offeredFormulaBefore = offeredSheet.getRange(2, 1).getFormula();
      if (!handledFormulaBefore || !offeredFormulaBefore) {
        throw new Error(
          'CXP-07 step 3 requires installed calc formulas. Run initializeCxp07 first.',
        );
      }
      removeStep3Triggers(scriptApp);
      state = {
        handledFormulaBefore: handledFormulaBefore,
        offeredFormulaBefore: offeredFormulaBefore,
        lastError: null,
        phase: STEP3_PHASES[0],
        phaseIndex: 0,
        spreadsheetId: ssInit.getId(),
        startedAtUtc: new Date().toISOString(),
        status: 'RUNNING',
        updatedAtUtc: new Date().toISOString(),
      };
      saveStep3State(properties, state);
      uatLog('step3.refresh.start', {
        note: 'Resumable second-bundle refresh (one raw sheet per invocation)',
        spreadsheetId: state.spreadsheetId,
      });
    }

    uatLog('step3.refresh.phase.start', {
      phase: state.phase,
      phaseIndex: state.phaseIndex,
      phaseCount: STEP3_PHASES.length,
    });

    try {
      var ss = SpreadsheetApp.openById(state.spreadsheetId);
      var phaseResult = runStep3Phase(ss, state);
      uatLog('step3.refresh.phase.done', {
        phase: state.phase,
        result: phaseResult,
      });

      if (state.phaseIndex >= STEP3_PHASES.length - 1) {
        removeStep3Triggers(scriptApp);
        state.status = 'COMPLETE';
        state.lastError = null;
        state.updatedAtUtc = new Date().toISOString();
        saveStep3State(properties, state);
        var complete = publicStep3Status(state, false);
        uatLog('step3.refresh.pass', { pass: true, status: complete });
        uatLog('step3.refresh.complete', complete);
        return Object.assign({}, complete, { pass: true, phaseResult: phaseResult });
      }

      state.phaseIndex += 1;
      state.phase = STEP3_PHASES[state.phaseIndex];
      state.updatedAtUtc = new Date().toISOString();
      saveStep3State(properties, state);
      var scheduled = scheduleStep3Continuation(scriptApp, 30000);
      var pending = publicStep3Status(state, scheduled);
      uatLog('step3.refresh.pending', pending);
      return Object.assign({}, pending, {
        pass: false,
        pending: true,
        nextAction: scheduled
          ? 'Wait for continueCxp07UatStep3Refresh, or poll getCxp07UatStep3Status / re-run cxp07UatStep3SecondBundleRefresh'
          : 'Re-run cxp07UatStep3SecondBundleRefresh to advance the next phase',
      });
    } catch (error) {
      removeStep3Triggers(scriptApp);
      state.status = 'FAILED';
      state.lastError = error && error.message ? String(error.message) : String(error);
      state.updatedAtUtc = new Date().toISOString();
      saveStep3State(properties, state);
      uatLog('step3.refresh.fail', publicStep3Status(state, false));
      throw error;
    }
  }

  function runStep3SecondBundleRefresh(spreadsheetId) {
    // spreadsheetId reserved for API symmetry; configured target is always used.
    return advanceStep3(false);
  }

  function continueStep3SecondBundleRefresh() {
    return advanceStep3(true);
  }

  function loadParityFixture(spreadsheetId) {
    return loadFixtureBundle(spreadsheetId, {
      agentPrefix: 'AW-PARITY-',
      fixture: FIXTURE,
      logPrefix: 'step1.parity',
    });
  }

  function isDateObject(value) {
    return Object.prototype.toString.call(value) === '[object Date]' &&
      !Number.isNaN(value.getTime());
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function sheetsSerialToDateParts(serial) {
    if (typeof serial !== 'number' || !Number.isFinite(serial)) {
      return null;
    }
    // Google Sheets / Excel day serial: 0 = 1899-12-30.
    var utcMs = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
    var date = new Date(utcMs);
    return {
      yyyyMmDd:
        date.getUTCFullYear() +
        '-' + pad2(date.getUTCMonth() + 1) +
        '-' + pad2(date.getUTCDate()),
      hhMm: pad2(date.getUTCHours()) + ':' + pad2(date.getUTCMinutes()),
    };
  }

  function normalizeField(header, rawValue, displayValue) {
    if (header === 'Accept Date') {
      if (isDateObject(rawValue) && typeof Utilities !== 'undefined') {
        return Utilities.formatDate(rawValue, 'Etc/GMT+8', 'yyyy-MM-dd');
      }
      if (isDateObject(rawValue)) {
        return (
          rawValue.getFullYear() +
          '-' + pad2(rawValue.getMonth() + 1) +
          '-' + pad2(rawValue.getDate())
        );
      }
      if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
        var fromSerial = sheetsSerialToDateParts(rawValue);
        if (fromSerial) {
          return fromSerial.yyyyMmDd;
        }
      }
      var text = String(displayValue || rawValue || '').trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
        return text.slice(0, 10);
      }
      var mdy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (mdy) {
        return mdy[3] + '-' + pad2(mdy[1]) + '-' + pad2(mdy[2]);
      }
      // Display sometimes shows the raw Sheets serial as text.
      if (/^\d{5}(\.\d+)?$/.test(text)) {
        var serialParts = sheetsSerialToDateParts(Number(text));
        if (serialParts) {
          return serialParts.yyyyMmDd;
        }
      }
      return text;
    }

    if (header === 'Interval' || header === 'Interval View') {
      if (isDateObject(rawValue) && typeof Utilities !== 'undefined') {
        return Utilities.formatDate(rawValue, 'Etc/GMT+8', 'HH:mm');
      }
      if (isDateObject(rawValue)) {
        return pad2(rawValue.getHours()) + ':' + pad2(rawValue.getMinutes());
      }
      if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
        var minutes = Math.round(((rawValue % 1) + 1) % 1 * 24 * 60);
        return pad2(Math.floor(minutes / 60) % 24) + ':' + pad2(minutes % 60);
      }
      var display = String(displayValue || '').trim();
      var timeMatch = display.match(/(\d{1,2}):(\d{2})/);
      if (timeMatch) {
        return pad2(timeMatch[1]) + ':' + timeMatch[2];
      }
      return display;
    }

    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return rawValue;
    }
    var asText = String(displayValue === undefined || displayValue === null
      ? (rawValue || '')
      : displayValue).trim();
    if (asText !== '' && /^-?\d+(\.\d+)?$/.test(asText)) {
      return Number(asText);
    }
    return asText;
  }

  function readCalcRows(sheet, calcHeaders, sessionColumnIndex) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return [];
    }
    var width = Math.max(calcHeaders.length, sessionColumnIndex + 1);
    var range = sheet.getRange(2, 1, lastRow, width);
    var displayValues = range.getDisplayValues();
    var rawValues = range.getValues();
    return displayValues
      .map(function (row, rowIndex) {
        var session = row[sessionColumnIndex];
        if (!session) {
          return null;
        }
        var out = { session: String(session) };
        calcHeaders.forEach(function (header, index) {
          out[header] = normalizeField(
            header,
            rawValues[rowIndex][index],
            row[index],
          );
        });
        return out;
      })
      .filter(function (row) {
        return row;
      });
  }

  function compareExpected(actualRows, expectedRows, sessions, calcHeaders, logPrefix) {
    var prefix = logPrefix || 'step1.parity';
    return expectedRows.map(function (expected, index) {
      var session = sessions[index];
      var actual = actualRows.filter(function (row) {
        return row.session === session;
      })[0] || null;
      var fieldDiffs = [];
      calcHeaders.forEach(function (header) {
        var want = expected[header];
        var got = actual ? actual[header] : '<missing row>';
        if (want !== got) {
          fieldDiffs.push({ field: header, expected: want, actual: got });
        }
      });
      var result = {
        session: session,
        pass: fieldDiffs.length === 0,
        diffs: fieldDiffs,
        actual: actual,
        expected: expected,
      };
      uatLog(result.pass ? prefix + '.compare.session.pass' : prefix + '.compare.session.fail', {
        session: session,
        diffCount: fieldDiffs.length,
        diffs: fieldDiffs,
        actual: actual,
        expected: expected,
      });
      return result;
    });
  }

  function recordFixtureOutputs(spreadsheetId, options) {
    var opts = options || {};
    var fixture = opts.fixture || FIXTURE;
    var prefix = opts.logPrefix || 'step1.parity';
    var sessions = opts.sessions || ['SESSION-100', 'SESSION-200'];
    var priorSessionsMustBeAbsent = opts.priorSessionsMustBeAbsent || [];
    var timezoneCheck = opts.timezoneCheck || {
      session100: 'UTC 07:45 -> prior fixed-PST date 2026-08-17 @ 23:30',
      session200: 'UTC 08:05 -> same UTC date 2026-08-18 @ 00:00',
    };

    uatLog(prefix + '.record.start', {});
    var ss = openTarget(spreadsheetId);
    uatLog(prefix + '.record.flush.start', {});
    SpreadsheetApp.flush();
    uatLog(prefix + '.record.flush.done', {});

    var handledSheet = requireSheet(ss, '_CALC_HANDLED');
    var offeredSheet = requireSheet(ss, '_CALC_OFFERED');
    uatLog(prefix + '.record.read_calc.start', {
      handledLastRow: handledSheet.getLastRow(),
      offeredLastRow: offeredSheet.getLastRow(),
    });
    var handledActual = readCalcRows(handledSheet, HANDLED_CALC_HEADERS, 4);
    var offeredActual = readCalcRows(offeredSheet, OFFERED_CALC_HEADERS, 16);
    var handledSessionsFound = handledActual.map(function (row) { return row.session; });
    var offeredSessionsFound = offeredActual.map(function (row) { return row.session; });
    uatLog(prefix + '.record.read_calc.done', {
      handledSessionsFound: handledSessionsFound,
      offeredSessionsFound: offeredSessionsFound,
    });

    var staleHandled = priorSessionsMustBeAbsent.filter(function (session) {
      return handledSessionsFound.indexOf(session) !== -1;
    });
    var staleOffered = priorSessionsMustBeAbsent.filter(function (session) {
      return offeredSessionsFound.indexOf(session) !== -1;
    });
    uatLog(prefix + '.record.stale_session_check', {
      priorSessionsMustBeAbsent: priorSessionsMustBeAbsent,
      staleHandled: staleHandled,
      staleOffered: staleOffered,
    });

    uatLog(prefix + '.compare.handled.start', { timezoneCheck: timezoneCheck });
    var handledCompare = compareExpected(
      handledActual,
      fixture.expected.handled,
      sessions,
      HANDLED_CALC_HEADERS,
      prefix,
    );
    uatLog(prefix + '.compare.offered.start', {});
    var offeredCompare = compareExpected(
      offeredActual,
      fixture.expected.offered,
      sessions,
      OFFERED_CALC_HEADERS,
      prefix,
    );

    var report = {
      spreadsheetId: ss.getId(),
      title: ss.getName(),
      timezoneCheck: timezoneCheck,
      handled: handledCompare,
      offered: offeredCompare,
      staleSessionsCleared: staleHandled.length === 0 && staleOffered.length === 0,
      pass:
        handledCompare.every(function (row) { return row.pass; }) &&
        offeredCompare.every(function (row) { return row.pass; }) &&
        staleHandled.length === 0 &&
        staleOffered.length === 0,
    };
    uatLog(report.pass ? prefix + '.record.pass' : prefix + '.record.fail', {
      pass: report.pass,
      handledPass: handledCompare.every(function (row) { return row.pass; }),
      offeredPass: offeredCompare.every(function (row) { return row.pass; }),
      staleSessionsCleared: report.staleSessionsCleared,
    });
    uatLog(prefix + '.record.complete', report);
    return report;
  }

  function recordParityOutputs(spreadsheetId) {
    return recordFixtureOutputs(spreadsheetId, {
      fixture: FIXTURE,
      logPrefix: 'step1.parity',
      sessions: ['SESSION-100', 'SESSION-200'],
      timezoneCheck: {
        session100: 'UTC 07:45 -> prior fixed-PST date 2026-08-17 @ 23:30',
        session200: 'UTC 08:05 -> same UTC date 2026-08-18 @ 00:00',
      },
    });
  }

  function runParityStep(spreadsheetId) {
    resetTelemetryClock();
    uatLog('step1.parity.step.start', {});
    var load = loadParityFixture(spreadsheetId);
    uatLog('step1.parity.step.recalc_wait.start', { sleepMs: 2000 });
    // Give Sheets a moment for spill recalculation after flush.
    Utilities.sleep(2000);
    uatLog('step1.parity.step.recalc_wait.done', {});
    SpreadsheetApp.flush();
    var compare = recordParityOutputs(spreadsheetId);
    var report = {
      load: load,
      compare: compare,
      pass: compare.pass,
    };
    uatLog(compare.pass ? 'step1.parity.step.pass' : 'step1.parity.step.fail', {
      pass: compare.pass,
    });
    if (!compare.pass) {
      throw new Error(
        'CXP-07 parity step failed. See Logger for field diffs (SESSION-100/200).',
      );
    }
    uatLog('step1.parity.step.complete', { pass: true });
    return report;
  }

  function resolveCxp07Setup() {
    if (typeof Cxp07Setup !== 'undefined') {
      return Cxp07Setup;
    }
    return require('./Cxp07Setup.js');
  }

  function resolveFormulaCatalog() {
    if (typeof HandledOfferedFormulaCatalog !== 'undefined') {
      return HandledOfferedFormulaCatalog;
    }
    return require('../transformations/HandledOfferedFormulaCatalog.js');
  }

  function inspectCalcTopology(sheet, expectedHeaderCount, formulaColumnCount, maxRows, maxCols) {
    var sheetName = sheet.getName();
    uatLog('step4.verify.sheet.start', { sheetName: sheetName });
    var headers = sheet.getRange(1, 1, 1, expectedHeaderCount).getDisplayValues()[0];
    while (headers.length && headers[headers.length - 1] === '') {
      headers.pop();
    }
    var formulas = sheet.getRange(2, 1, 2, formulaColumnCount).getFormulas()[0];
    var formulaPresent = [];
    var formulaMissing = [];
    var i;
    for (i = 0; i < formulaColumnCount; i += 1) {
      var colLetter = columnIndexToLetter(i + 1);
      if (formulas[i]) {
        formulaPresent.push(colLetter + '2');
      } else {
        formulaMissing.push(colLetter + '2');
      }
    }

    var fillDownSample = [];
    var lastRow = sheet.getLastRow();
    var lastColumn = sheet.getLastColumn();
    if (lastRow > 2) {
      var below = sheet.getRange(
        3,
        1,
        Math.min(lastRow, 12),
        formulaColumnCount,
      ).getFormulas();
      for (var r = 0; r < below.length; r += 1) {
        for (var c = 0; c < below[r].length; c += 1) {
          if (below[r][c]) {
            fillDownSample.push(columnIndexToLetter(c + 1) + String(r + 3));
            if (fillDownSample.length >= 10) {
              break;
            }
          }
        }
        if (fillDownSample.length >= 10) {
          break;
        }
      }
    }

    var result = {
      sheetName: sheetName,
      headerCount: headers.length,
      headerCountOk: headers.length === expectedHeaderCount,
      headers: headers,
      formulaAnchorsPresent: formulaPresent,
      formulaAnchorsMissing: formulaMissing,
      formulaAnchorCountOk: formulaMissing.length === 0,
      noFillDown: fillDownSample.length === 0,
      fillDownSample: fillDownSample,
      lastRow: lastRow,
      lastColumn: lastColumn,
      withinRowBound: lastRow <= maxRows,
      withinColumnBound: lastColumn <= maxCols,
      pass: false,
    };
    result.pass =
      result.headerCountOk &&
      result.formulaAnchorCountOk &&
      result.noFillDown &&
      result.withinRowBound &&
      result.withinColumnBound;
    uatLog(result.pass ? 'step4.verify.sheet.pass' : 'step4.verify.sheet.fail', result);
    return result;
  }

  function columnIndexToLetter(index) {
    var n = index;
    var letters = '';
    while (n > 0) {
      var rem = (n - 1) % 26;
      letters = String.fromCharCode(65 + rem) + letters;
      n = Math.floor((n - 1) / 26);
    }
    return letters;
  }

  function runStep4VerifyTopology(spreadsheetId) {
    resetTelemetryClock();
    uatLog('step4.verify.start', {});
    var setup = resolveCxp07Setup();
    var status = setup.getStatus();
    uatLog('step4.verify.status', {
      status: status.status,
      nextStep: status.nextStep,
      stepCount: status.stepCount,
      lastCompletedStep: status.lastCompletedStep || null,
    });
    if (status.status !== 'COMPLETE' || status.nextStep !== status.stepCount) {
      throw new Error(
        'CXP-07 step 4 verify requires install COMPLETE (nextStep === stepCount). ' +
          'Current status=' + status.status + ' nextStep=' + status.nextStep +
          '. Wait for continuation, then re-run cxp07UatStep4VerifyTopology.',
      );
    }

    var catalog = resolveFormulaCatalog();
    var maxRows = catalog.ROW_CAPACITY + 1;
    var ss = openTarget(spreadsheetId);
    var handled = inspectCalcTopology(
      requireSheet(ss, '_CALC_HANDLED'),
      30,
      4,
      maxRows,
      30,
    );
    var offered = inspectCalcTopology(
      requireSheet(ss, '_CALC_OFFERED'),
      42,
      16,
      maxRows,
      42,
    );

    var report = {
      spreadsheetId: ss.getId(),
      title: ss.getName(),
      status: status,
      handled: handled,
      offered: offered,
      pass: handled.pass && offered.pass,
    };
    uatLog(report.pass ? 'step4.verify.pass' : 'step4.verify.fail', {
      pass: report.pass,
    });
    uatLog('step4.verify.complete', report);
    if (!report.pass) {
      throw new Error(
        'CXP-07 step 4 topology verify failed. See Logger for sheet diffs.',
      );
    }
    return report;
  }

  function runStep4ReinstallTopology(spreadsheetId) {
    resetTelemetryClock();
    uatLog('step4.reinstall.start', {
      note: 'Re-run installer; verify topology when COMPLETE',
    });
    var setup = resolveCxp07Setup();
    var initResult = setup.initializeConfigured();
    uatLog('step4.reinstall.initialize.done', {
      status: initResult.status,
      nextStep: initResult.nextStep,
      stepCount: initResult.stepCount,
      continuationScheduled: initResult.continuationScheduled,
      lastCompletedStep: initResult.lastCompletedStep || null,
    });

    if (initResult.status === 'COMPLETE' && initResult.nextStep === initResult.stepCount) {
      uatLog('step4.reinstall.completed_in_session', {});
      return runStep4VerifyTopology(spreadsheetId);
    }

    var pending = {
      pass: false,
      pending: true,
      status: initResult,
      nextAction: 'cxp07UatStep4VerifyTopology',
      note:
        'Installer still RUNNING or continuation scheduled. ' +
        'Wait until getCxp07HandledOfferedTransformationStatus is COMPLETE, ' +
        'then run cxp07UatStep4VerifyTopology.',
    };
    uatLog('step4.reinstall.pending', pending);
    return pending;
  }

  return Object.freeze({
    FIXTURE: FIXTURE,
    SECOND_FIXTURE: SECOND_FIXTURE,
    continueStep3SecondBundleRefresh: continueStep3SecondBundleRefresh,
    getStep3Status: getStep3Status,
    loadParityFixture: loadParityFixture,
    recordParityOutputs: recordParityOutputs,
    resetTelemetryClock: resetTelemetryClock,
    runParityStep: runParityStep,
    runStep2PeakFlushTiming: runStep2PeakFlushTiming,
    runStep3SecondBundleRefresh: runStep3SecondBundleRefresh,
    runStep4ReinstallTopology: runStep4ReinstallTopology,
    runStep4VerifyTopology: runStep4VerifyTopology,
  });
})();

function cxp07UatStep1LoadParityFixture() {
  Cxp07ParityUat.resetTelemetryClock();
  return Cxp07ParityUat.loadParityFixture();
}

function cxp07UatStep1RecordParityOutputs() {
  Cxp07ParityUat.resetTelemetryClock();
  return Cxp07ParityUat.recordParityOutputs();
}

function cxp07UatStep1RunParity() {
  return Cxp07ParityUat.runParityStep();
}

function cxp07UatStep2PeakFlushTiming() {
  return Cxp07ParityUat.runStep2PeakFlushTiming();
}

function cxp07UatStep3SecondBundleRefresh() {
  return Cxp07ParityUat.runStep3SecondBundleRefresh();
}

function continueCxp07UatStep3Refresh() {
  return Cxp07ParityUat.continueStep3SecondBundleRefresh();
}

function getCxp07UatStep3Status() {
  Cxp07ParityUat.resetTelemetryClock();
  return Cxp07ParityUat.getStep3Status();
}

function cxp07UatStep4ReinstallTopology() {
  return Cxp07ParityUat.runStep4ReinstallTopology();
}

function cxp07UatStep4VerifyTopology() {
  return Cxp07ParityUat.runStep4VerifyTopology();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Cxp07ParityUat;
}
