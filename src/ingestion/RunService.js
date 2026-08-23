(function (root, factory) {
  var errorCodes = root.ErrorCodes;
  var runStateMachine = root.RunStateMachine;
  var scriptLock = root.ScriptLock;
  var runLogger = root.RunLogger;
  var errorLogger = root.ErrorLogger;

  if (typeof module === 'object' && module.exports) {
    errorCodes = require('../monitoring/ErrorCodes');
    runStateMachine = require('./RunStateMachine');
    scriptLock = require('../services/ScriptLock');
    runLogger = require('../monitoring/RunLogger');
    errorLogger = require('../monitoring/ErrorLogger');
  }

  var api = factory(errorCodes, runStateMachine, scriptLock, runLogger, errorLogger);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.RunService = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (
  ErrorCodes,
  RunStateMachine,
  ScriptLock,
  RunLogger,
  ErrorLogger
) {
  'use strict';

  var DEFAULT_LOCK_TIMEOUT_MS = 30000;
  var REQUIRED_OPERATIONS = Object.freeze([
    'validateFile',
    'parse',
    'validateSchema',
    'checkDuplicate',
    'stage',
    'validateStage',
    'commit',
    'recalculate',
    'healthCheck'
  ]);

  function resolveRuntimeDependencies() {
    var runtimeRoot = typeof globalThis !== 'undefined' ? globalThis : this;
    ErrorCodes = ErrorCodes || runtimeRoot.ErrorCodes;
    RunStateMachine = RunStateMachine || runtimeRoot.RunStateMachine;
    ScriptLock = ScriptLock || runtimeRoot.ScriptLock;
    RunLogger = RunLogger || runtimeRoot.RunLogger;
    ErrorLogger = ErrorLogger || runtimeRoot.ErrorLogger;

    if (!ErrorCodes || !RunStateMachine || !ScriptLock || !RunLogger || !ErrorLogger) {
      throw new Error('CXP-04 runtime dependencies are unavailable.');
    }
  }

  function defaultClock() {
    return { now: function () { return new Date(); } };
  }

  function toIso(value) {
    if (value instanceof Date) {
      return value.toISOString();
    }

    return new Date(value).toISOString();
  }

  function fallbackRunId(clock) {
    if (typeof Utilities !== 'undefined' && typeof Utilities.getUuid === 'function') {
      return Utilities.getUuid();
    }

    return 'run-' + toIso(clock.now()).replace(/[^0-9]/g, '') + '-' + Math.random().toString(36).slice(2);
  }

  function requireMetadata(request) {
    if (!request || typeof request !== 'object') {
      throw ErrorCodes.create('INGESTION_INVALID_RUN_METADATA', {
        message: 'Run metadata is required.'
      });
    }

    var missing = [];
    ['schemaVersion', 'sourceFileId', 'sourceFileName', 'targetWorkbookId'].forEach(function (field) {
      if (!request[field]) {
        missing.push(field);
      }
    });

    if (missing.length > 0) {
      throw ErrorCodes.create('INGESTION_INVALID_RUN_METADATA', {
        details: { missingFields: missing }
      });
    }
  }

  function requireOperations(operations) {
    var missing = REQUIRED_OPERATIONS.filter(function (name) {
      return !operations || typeof operations[name] !== 'function';
    });

    if (missing.length > 0) {
      throw ErrorCodes.create('INGESTION_INVALID_OPERATIONS', {
        details: { missingOperations: missing }
      });
    }
  }

  function fallbackCodeFor(state) {
    if (state === 'VALIDATING_STAGE') {
      return 'MIGRATION_STAGE_VALIDATION_FAILED';
    }
    if (state === 'COMMITTING') {
      return 'MIGRATION_COMMIT_FAILED';
    }
    if (state === 'RECALCULATING') {
      return 'CALCULATION_RECALCULATION_FAILED';
    }
    if (state === 'HEALTH_CHECK') {
      return 'CALCULATION_HEALTH_CHECK_FAILED';
    }

    return 'INGESTION_OPERATION_FAILED';
  }

  function lastHistoryTimestamp(machine) {
    var history = machine.history();
    return history.length > 0 ? history[history.length - 1].atUtc : '';
  }

  function buildRunRecord(context, request, machine, status, errorCode, endedAtUtc) {
    return RunLogger.createRecord({
      runId: context.runId,
      startedAtUtc: context.startedAtUtc,
      endedAtUtc: endedAtUtc,
      sourceActor: request.sourceActor,
      sourceFileName: request.sourceFileName,
      sourceFileId: request.sourceFileId,
      schemaVersion: request.schemaVersion,
      inputRowCounts: request.inputRowCounts,
      outputRowCounts: request.outputRowCounts,
      targetWorkbookId: request.targetWorkbookId,
      status: status,
      errorCode: errorCode === undefined ? null : errorCode,
      stateHistory: machine.history()
    });
  }

  function runOperation(machine, operations, context, state, operationName) {
    machine.transition(state);
    context.operationResults[operationName] = operations[operationName](context);
  }

  function execute(request, operations, services) {
    resolveRuntimeDependencies();
    var dependencies = services || {};
    var clock = dependencies.clock && typeof dependencies.clock.now === 'function'
      ? dependencies.clock
      : defaultClock();
    var runId = typeof dependencies.uuid === 'function'
      ? dependencies.uuid()
      : fallbackRunId(clock);
    var startedAtUtc = toIso(clock.now());
    var machine = RunStateMachine.create(clock);
    var safeRequest = request && typeof request === 'object' ? request : {};
    var context = {
      operationResults: {},
      request: safeRequest,
      runId: runId,
      startedAtUtc: startedAtUtc
    };

    try {
      requireMetadata(request);
      requireOperations(operations);

      if (!dependencies.repository || typeof dependencies.repository.persist !== 'function') {
        throw ErrorCodes.create('REPORTING_LOG_WRITE_FAILED', {
          message: 'A run repository with persist is required.'
        });
      }

      runOperation(machine, operations, context, 'VALIDATING_FILE', 'validateFile');
      runOperation(machine, operations, context, 'PARSING', 'parse');
      runOperation(machine, operations, context, 'VALIDATING_SCHEMA', 'validateSchema');
      runOperation(machine, operations, context, 'CHECKING_DUPLICATE', 'checkDuplicate');
      runOperation(machine, operations, context, 'STAGING', 'stage');
      runOperation(machine, operations, context, 'VALIDATING_STAGE', 'validateStage');

      ScriptLock.withLock(
        dependencies.lockService,
        dependencies.lockTimeoutMs === undefined ? DEFAULT_LOCK_TIMEOUT_MS : dependencies.lockTimeoutMs,
        typeof dependencies.flush === 'function' ? dependencies.flush : function () {},
        function () {
          runOperation(machine, operations, context, 'COMMITTING', 'commit');
          runOperation(machine, operations, context, 'RECALCULATING', 'recalculate');
          runOperation(machine, operations, context, 'HEALTH_CHECK', 'healthCheck');
        }
      );

      machine.transition('SUCCESS');
      var successRecord = buildRunRecord(
        context,
        safeRequest,
        machine,
        'SUCCESS',
        null,
        lastHistoryTimestamp(machine)
      );
      dependencies.repository.persist([successRecord], []);

      return Object.freeze({
        operationResults: Object.freeze(context.operationResults),
        runRecord: successRecord
      });
    } catch (error) {
      if (machine.currentState() === 'SUCCESS') {
        var reportingError = ErrorCodes.normalize(error, 'REPORTING_LOG_WRITE_FAILED');
        reportingError.runRecord = buildRunRecord(
          context,
          safeRequest,
          machine,
          'SUCCESS',
          reportingError.code,
          lastHistoryTimestamp(machine)
        );
        throw reportingError;
      }

      var failedAtState = machine.currentState();
      var normalized = ErrorCodes.normalize(error, fallbackCodeFor(failedAtState));
      var failureState = ErrorCodes.failureStateFor(normalized.code);
      machine.transition(failureState);
      var failedAtUtc = toIso(clock.now());
      var failedRunRecord = buildRunRecord(
        context,
        safeRequest,
        machine,
        failureState,
        normalized.code,
        failedAtUtc
      );
      var errorRecord = ErrorLogger.createRecord({
        atUtc: failedAtUtc,
        category: normalized.category,
        errorCode: normalized.code,
        details: normalized.details,
        failureState: failureState,
        message: normalized.message,
        runId: runId,
        state: failedAtState
      });

      normalized.runRecord = failedRunRecord;
      normalized.errorRecord = errorRecord;

      if (dependencies.repository && typeof dependencies.repository.persist === 'function') {
        try {
          dependencies.repository.persist([failedRunRecord], [errorRecord]);
        } catch (persistenceError) {
          var auditError = ErrorCodes.normalize(persistenceError, 'REPORTING_LOG_WRITE_FAILED');
          auditError.runRecord = failedRunRecord;
          auditError.errorRecord = errorRecord;
          auditError.cause = normalized;
          throw auditError;
        }
      }

      throw normalized;
    }
  }

  return Object.freeze({
    DEFAULT_LOCK_TIMEOUT_MS: DEFAULT_LOCK_TIMEOUT_MS,
    REQUIRED_OPERATIONS: REQUIRED_OPERATIONS,
    execute: execute
  });
});
