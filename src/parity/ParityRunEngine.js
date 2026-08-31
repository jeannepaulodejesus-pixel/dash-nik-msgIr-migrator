/**
 * CXP-11 parity run state machine.
 *
 * Owns PREFLIGHT -> SOURCE_TABLES -> METRICS -> ERROR_CLASSIFICATION ->
 * SUMMARIZING -> COMPLETE (or FAILED) across Apps Script invocations. Every
 * boundary is injected: Drive reads, target reads, control-sheet writes, the
 * script lock, triggers, and Script Properties. The engine itself only decides
 * what to compare next, persists a checkpointed cursor, and stays retry-safe by
 * letting the results repository reject a replayed chunk ID.
 */
var ParityRunEngine = (function () {
  'use strict';

  var STATE_KEY = 'CXP11_PARITY_RUN_STATE_V1';
  var STATE_VERSION = 1;
  var CONTINUATION_HANDLER = 'continueCxp11ParityRun';
  var CONTINUATION_DELAY_MS = 1000;
  var WATCHDOG_DELAY_MS = 420000;
  var LOCK_TIMEOUT_MS = 5000;

  function resolveContracts() {
    if (typeof ParityContracts !== 'undefined') {
      return ParityContracts;
    }
    return require('./ParityContracts.js');
  }

  function resolveComparator() {
    if (typeof ParityComparator !== 'undefined') {
      return ParityComparator;
    }
    return require('./ParityComparator.js');
  }

  function resolveAdapter() {
    if (typeof LegacyExportAdapter !== 'undefined') {
      return LegacyExportAdapter;
    }
    return require('./LegacyExportAdapter.js');
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

  function create(ports) {
    var dependencies = ports || {};
    var contracts = dependencies.contracts || resolveContracts();
    var digest = dependencies.digest || resolveDigest();
    var comparator = dependencies.comparator ||
      resolveComparator().create({ clock: dependencies.clock, contracts: contracts, digest: digest });
    var adapter = dependencies.adapter ||
      resolveAdapter().create({ contracts: contracts, digest: digest });
    var properties = dependencies.properties;
    var maxRuntimeMs = Number.isFinite(dependencies.maxRuntimeMs)
      ? dependencies.maxRuntimeMs
      : contracts.COOPERATIVE_BUDGET_MS;
    var batchSize = dependencies.batchSize || contracts.SOURCE_TABLE_BATCH_ROWS;
    var metricBatchSize = dependencies.metricBatchSize || contracts.METRIC_BATCH_SIZE;

    if (!properties || typeof properties.getProperty !== 'function') {
      throw new Error('Script Properties are required for the CXP-11 parity run.');
    }

    function now() {
      var value = dependencies.clock && typeof dependencies.clock.now === 'function'
        ? dependencies.clock.now()
        : new Date();
      var date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) {
        throw new Error('The CXP-11 runtime clock returned an invalid value.');
      }
      return date;
    }

    function emitLog(tag, payload) {
      var line = tag + ' ' + JSON.stringify(payload || {});
      if (typeof console !== 'undefined' && typeof console.log === 'function') {
        console.log(line);
      }
      if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') {
        Logger.log(line);
      }
    }

    function loadState() {
      var raw = properties.getProperty(STATE_KEY);
      if (!raw) {
        return null;
      }
      var state;
      try {
        state = JSON.parse(raw);
      } catch (error) {
        fail('PARITY_RUN_STATE_INVALID', { reason: 'not_json' });
      }
      if (!state || state.version !== STATE_VERSION) {
        fail('PARITY_RUN_STATE_INVALID', { reason: 'unsupported_version' });
      }
      if (contracts.RUN_STATE_ORDER.indexOf(state.runState) === -1 &&
        state.runState !== contracts.RUN_STATES.failed) {
        fail('PARITY_RUN_STATE_INVALID', { reason: 'unknown_run_state' });
      }
      if (!Number.isInteger(state.datasetIndex) || state.datasetIndex < 0 ||
        !Number.isInteger(state.rowOffset) || state.rowOffset < 0 ||
        !Number.isInteger(state.metricIndex) || state.metricIndex < 0) {
        fail('PARITY_RUN_STATE_INVALID', { reason: 'cursor_corrupt' });
      }
      return state;
    }

    function saveState(state) {
      state.updatedAtUtc = now().toISOString();
      properties.setProperty(STATE_KEY, JSON.stringify(state));
    }

    function clearState() {
      if (typeof properties.deleteProperty === 'function') {
        properties.deleteProperty(STATE_KEY);
        return;
      }
      properties.setProperty(STATE_KEY, '');
    }

    function removeContinuationTriggers() {
      var scriptApp = dependencies.scriptApp;
      if (!scriptApp || typeof scriptApp.getProjectTriggers !== 'function') {
        return;
      }
      scriptApp.getProjectTriggers().forEach(function (trigger) {
        if (
          trigger &&
          typeof trigger.getHandlerFunction === 'function' &&
          trigger.getHandlerFunction() === CONTINUATION_HANDLER
        ) {
          scriptApp.deleteTrigger(trigger);
        }
      });
    }

    function scheduleContinuation(delayMs) {
      var scriptApp = dependencies.scriptApp;
      if (!scriptApp || typeof scriptApp.newTrigger !== 'function') {
        return false;
      }
      scriptApp.newTrigger(CONTINUATION_HANDLER).timeBased().after(delayMs).create();
      return true;
    }

    function withLock(work) {
      var lockService = dependencies.lockService;
      if (!lockService || typeof lockService.getScriptLock !== 'function') {
        return work();
      }
      var lock = lockService.getScriptLock();
      if (
        !lock ||
        typeof lock.tryLock !== 'function' ||
        typeof lock.releaseLock !== 'function' ||
        !lock.tryLock(LOCK_TIMEOUT_MS)
      ) {
        fail('PARITY_LOCK_TIMEOUT', { timeoutMs: LOCK_TIMEOUT_MS });
      }
      try {
        return work();
      } finally {
        lock.releaseLock();
      }
    }

    function isTerminal(state) {
      return state.runState === contracts.RUN_STATES.complete ||
        state.runState === contracts.RUN_STATES.failed;
    }

    function resolveExportFolderId(explicitFolderId) {
      var candidate = typeof explicitFolderId === 'string' ? explicitFolderId.trim() : '';
      if (candidate) {
        return candidate;
      }
      var configured = typeof dependencies.exportFolderId === 'string'
        ? dependencies.exportFolderId.trim()
        : '';
      if (configured) {
        return configured;
      }
      fail('PARITY_EXPORT_FOLDER_NOT_CONFIGURED', {
        environment: dependencies.environment || null,
      });
      return '';
    }

    function newRunId() {
      var stamp = now().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
      return 'CXP11-' + stamp + '-' + digest.shortHash(stamp + String(Math.random())).slice(0, 8);
    }

    function newState(runId, exportFolderId) {
      var timestamp = now().toISOString();
      return {
        acquisitionTimestampUtc: null,
        baselineExpectedTotal: null,
        baselineObservedTotal: null,
        completedAtUtc: null,
        controlSpreadsheetId: dependencies.controlSpreadsheetId || null,
        counters: comparator.emptyCounters(),
        datasetIndex: 0,
        environment: dependencies.environment || null,
        evaluatedDatasets: [],
        evaluatedMetrics: [],
        exportFolderId: exportFolderId,
        failureCode: null,
        ingestionRunId: null,
        manifestFingerprint: null,
        metricIndex: 0,
        rowOffset: 0,
        runId: runId,
        runState: contracts.RUN_STATES.preflight,
        sourceBundleFingerprint: null,
        startedAtUtc: timestamp,
        summary: null,
        targetSpreadsheetId: dependencies.targetSpreadsheetId || null,
        updatedAtUtc: timestamp,
        version: STATE_VERSION,
      };
    }

    function requirePort(name) {
      if (!dependencies[name]) {
        throw new Error('The CXP-11 parity run requires the ' + name + ' port.');
      }
      return dependencies[name];
    }

    function loadBundle(state) {
      var reader = requirePort('exportReader');
      var raw = reader.read(state.exportFolderId);
      var validated = adapter.validate(raw);
      var ledgerEntry = requirePort('ledger')
        .findSuccessfulByFingerprint(validated.sourceBundleFingerprint);
      var identity = adapter.assertLedgerIdentity(validated, ledgerEntry);

      if (
        state.manifestFingerprint &&
        state.manifestFingerprint !== validated.manifestFingerprint
      ) {
        fail('PARITY_TARGET_SNAPSHOT_CHANGED', { reason: 'export_manifest_replaced' });
      }
      if (state.ingestionRunId && state.ingestionRunId !== identity.ingestionRunId) {
        fail('PARITY_TARGET_SNAPSHOT_CHANGED', { reason: 'target_reingested' });
      }
      return { export_: validated, identity: identity };
    }

    function persistChunk(state, chunkId, comparisons) {
      var write = requirePort('results').appendChunk(state.runId, chunkId, comparisons);
      state.counters = comparator.accumulate(state.counters, comparisons);
      return write;
    }

    function runPreflight(state, bundle) {
      requirePort('baseline').verifyInstalled();
      state.acquisitionTimestampUtc = bundle.export_.acquisitionTimestampUtc;
      state.ingestionRunId = bundle.identity.ingestionRunId;
      state.manifestFingerprint = bundle.export_.manifestFingerprint;
      state.sourceBundleFingerprint = bundle.export_.sourceBundleFingerprint;
      state.runState = contracts.RUN_STATES.sourceTables;
      state.datasetIndex = 0;
      state.rowOffset = 0;
      return { chunkId: null, label: 'PREFLIGHT' };
    }

    function runSourceTableBatch(state, bundle) {
      var dataset = bundle.export_.datasets[state.datasetIndex];
      if (!dataset) {
        state.runState = contracts.RUN_STATES.metrics;
        state.metricIndex = 0;
        return { chunkId: null, label: 'SOURCE_TABLES_DONE' };
      }
      var migrated = requirePort('targetReader').readDataset(dataset.datasetName);
      var chunk = comparator.compareSourceTableChunk({
        batchSize: batchSize,
        legacy: dataset,
        migrated: migrated,
        offset: state.rowOffset,
        runId: state.runId,
      });
      persistChunk(state, chunk.chunkId, chunk.comparisons);
      if (chunk.done) {
        if (state.evaluatedDatasets.indexOf(dataset.datasetName) === -1) {
          state.evaluatedDatasets.push(dataset.datasetName);
        }
        state.datasetIndex += 1;
        state.rowOffset = 0;
        if (state.datasetIndex >= bundle.export_.datasets.length) {
          state.runState = contracts.RUN_STATES.metrics;
          state.metricIndex = 0;
        }
      } else {
        state.rowOffset = chunk.nextOffset;
      }
      return { chunkId: chunk.chunkId, label: 'SOURCE_TABLE_BATCH' };
    }

    function runMetricBatch(state, bundle) {
      var allMetrics = contracts.listMetrics();
      var metricNames = allMetrics.slice(state.metricIndex, state.metricIndex + metricBatchSize);
      if (metricNames.length === 0) {
        state.runState = contracts.RUN_STATES.errorClassification;
        return { chunkId: null, label: 'METRICS_DONE' };
      }
      var chunk = comparator.compareMetricChunk({
        acquisitionTimestampUtc: state.acquisitionTimestampUtc,
        legacyMetrics: bundle.export_.metrics,
        metricIndex: state.metricIndex,
        metricNames: metricNames,
        migratedMetrics: requirePort('targetReader').readMetrics(),
        runId: state.runId,
      });
      persistChunk(state, chunk.chunkId, chunk.comparisons);
      metricNames.forEach(function (metricName) {
        if (state.evaluatedMetrics.indexOf(metricName) === -1) {
          state.evaluatedMetrics.push(metricName);
        }
      });
      state.metricIndex += metricNames.length;
      if (state.metricIndex >= allMetrics.length) {
        state.runState = contracts.RUN_STATES.errorClassification;
      }
      return { chunkId: chunk.chunkId, label: 'METRIC_BATCH' };
    }

    function runErrorClassification(state, bundle) {
      var chunk = comparator.classifyLegacyErrors({
        baselineRecords: requirePort('baseline').read(),
        legacyErrors: bundle.export_.legacyErrors,
        runId: state.runId,
      });
      persistChunk(state, chunk.chunkId, chunk.comparisons);
      state.baselineExpectedTotal = chunk.expectedTotal;
      state.baselineObservedTotal = chunk.observedTotal;
      state.runState = contracts.RUN_STATES.summarizing;
      return { chunkId: chunk.chunkId, label: 'ERROR_CLASSIFICATION' };
    }

    function runSummarizing(state, bundle) {
      // Re-assert source identity at finalization so a late re-ingestion cannot
      // be signed off as a passing run.
      if (state.manifestFingerprint !== bundle.export_.manifestFingerprint) {
        fail('PARITY_TARGET_SNAPSHOT_CHANGED', { reason: 'export_manifest_replaced' });
      }
      var summary = comparator.summarize(state.counters);
      state.summary = {
        byClassification: summary.byClassification,
        comparisonCount: summary.comparisonCount,
        datasetCount: state.evaluatedDatasets.length,
        defectCount: summary.defectCount,
        metricCount: state.evaluatedMetrics.length,
        pass: summary.pass &&
          state.evaluatedDatasets.length === contracts.DATASET_FILES.length &&
          state.evaluatedMetrics.length === contracts.listMetrics().length &&
          state.baselineObservedTotal === state.baselineExpectedTotal,
      };
      state.runState = contracts.RUN_STATES.complete;
      state.completedAtUtc = now().toISOString();
      return { chunkId: null, label: 'SUMMARIZING' };
    }

    function advance(state, bundle) {
      if (state.runState === contracts.RUN_STATES.preflight) {
        return runPreflight(state, bundle);
      }
      if (state.runState === contracts.RUN_STATES.sourceTables) {
        return runSourceTableBatch(state, bundle);
      }
      if (state.runState === contracts.RUN_STATES.metrics) {
        return runMetricBatch(state, bundle);
      }
      if (state.runState === contracts.RUN_STATES.errorClassification) {
        return runErrorClassification(state, bundle);
      }
      if (state.runState === contracts.RUN_STATES.summarizing) {
        return runSummarizing(state, bundle);
      }
      fail('PARITY_RUN_STATE_INVALID', { reason: 'unreachable_state' });
      return null;
    }

    function publicStatus(state, continuationScheduled) {
      if (!state) {
        return Object.freeze({
          continuationScheduled: false,
          datasetIndex: 0,
          evaluatedDatasetCount: 0,
          evaluatedMetricCount: 0,
          failureCode: null,
          metricIndex: 0,
          runId: null,
          runState: null,
          rowOffset: 0,
          status: 'IDLE',
          summary: null,
        });
      }
      return Object.freeze({
        acquisitionTimestampUtc: state.acquisitionTimestampUtc,
        baselineExpectedTotal: state.baselineExpectedTotal,
        baselineObservedTotal: state.baselineObservedTotal,
        completedAtUtc: state.completedAtUtc,
        continuationScheduled: continuationScheduled === true,
        counters: Object.freeze(Object.assign({}, state.counters)),
        datasetIndex: state.datasetIndex,
        environment: state.environment,
        evaluatedDatasetCount: state.evaluatedDatasets.length,
        evaluatedMetricCount: state.evaluatedMetrics.length,
        failureCode: state.failureCode,
        metricIndex: state.metricIndex,
        rowOffset: state.rowOffset,
        runId: state.runId,
        runState: state.runState,
        startedAtUtc: state.startedAtUtc,
        status: state.runState,
        summary: state.summary ? Object.freeze(Object.assign({}, state.summary)) : null,
        updatedAtUtc: state.updatedAtUtc,
      });
    }

    function execute(state) {
      removeContinuationTriggers();
      scheduleContinuation(WATCHDOG_DELAY_MS);
      var startedMs = now().getTime();
      var bundle;
      try {
        bundle = loadBundle(state);
        while (state.runState !== contracts.RUN_STATES.complete) {
          var step = advance(state, bundle);
          saveState(state);
          emitLog('CXP11_RUN_STEP', {
            chunkId: step.chunkId,
            datasetIndex: state.datasetIndex,
            elapsedMs: now().getTime() - startedMs,
            label: step.label,
            metricIndex: state.metricIndex,
            rowOffset: state.rowOffset,
            runState: state.runState,
          });
          if (
            state.runState !== contracts.RUN_STATES.complete &&
            now().getTime() - startedMs >= maxRuntimeMs
          ) {
            removeContinuationTriggers();
            var scheduled = scheduleContinuation(CONTINUATION_DELAY_MS);
            saveState(state);
            emitLog('CXP11_RUN', {
              continuationScheduled: scheduled,
              event: 'CHECKPOINT',
              runState: state.runState,
            });
            return publicStatus(state, scheduled);
          }
        }
      } catch (error) {
        removeContinuationTriggers();
        state.runState = contracts.RUN_STATES.failed;
        state.failureCode = error && error.code ? String(error.code) : 'PARITY_RUN_FAILED';
        saveState(state);
        emitLog('CXP11_RUN', {
          event: 'FAILED',
          failureCode: state.failureCode,
        });
        throw error;
      }

      removeContinuationTriggers();
      saveState(state);
      emitLog('CXP11_RUN', {
        comparisonCount: state.summary ? state.summary.comparisonCount : 0,
        defectCount: state.summary ? state.summary.defectCount : null,
        event: 'COMPLETE',
        pass: state.summary ? state.summary.pass : false,
      });
      return publicStatus(state, false);
    }

    function start(options) {
      var request = options || {};
      return withLock(function () {
        var existing = loadState();
        if (existing && !isTerminal(existing)) {
          fail('PARITY_RUN_ALREADY_ACTIVE', { runState: existing.runState });
        }
        var state = newState(
          request.runId || newRunId(),
          resolveExportFolderId(request.exportFolderId),
        );
        saveState(state);
        emitLog('CXP11_RUN', { event: 'START', runId: state.runId });
        return execute(state);
      });
    }

    function continueRun() {
      return withLock(function () {
        var state = loadState();
        if (!state) {
          return publicStatus(null, false);
        }
        if (isTerminal(state)) {
          removeContinuationTriggers();
          return publicStatus(state, false);
        }
        return execute(state);
      });
    }

    function status() {
      return publicStatus(loadState(), false);
    }

    function reset(options) {
      var request = options || {};
      return withLock(function () {
        var state = loadState();
        if (state && !isTerminal(state) && request.force !== true) {
          fail('PARITY_RUN_ALREADY_ACTIVE', { runState: state.runState });
        }
        removeContinuationTriggers();
        clearState();
        return Object.freeze({
          cleared: true,
          stateKey: STATE_KEY,
          status: 'IDLE',
        });
      });
    }

    return Object.freeze({
      continueRun: continueRun,
      reset: reset,
      start: start,
      status: status,
    });
  }

  return Object.freeze({
    CONTINUATION_HANDLER: CONTINUATION_HANDLER,
    STATE_KEY: STATE_KEY,
    create: create,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ParityRunEngine;
}
