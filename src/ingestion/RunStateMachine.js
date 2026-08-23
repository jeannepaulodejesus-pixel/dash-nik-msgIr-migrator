var RunStateMachine = (function () {
  'use strict';

  var SUCCESS_PATH = Object.freeze([
    'RECEIVED',
    'VALIDATING_FILE',
    'PARSING',
    'VALIDATING_SCHEMA',
    'CHECKING_DUPLICATE',
    'STAGING',
    'VALIDATING_STAGE',
    'COMMITTING',
    'RECALCULATING',
    'HEALTH_CHECK',
    'SUCCESS',
  ]);
  var FAILURE_STATES = Object.freeze([
    'FAILED_SOURCE',
    'FAILED_INGESTION',
    'FAILED_MIGRATION_CALCULATION',
    'FAILED_REPORTING',
  ]);
  var TERMINAL_STATES = Object.freeze(['SUCCESS'].concat(FAILURE_STATES));
  var nextSuccessState = Object.create(null);
  SUCCESS_PATH.slice(0, -1).forEach(function (state, index) {
    nextSuccessState[state] = SUCCESS_PATH[index + 1];
  });

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function toIso(value) {
    var date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw resolveErrorCodes().create('INGESTION_INVALID_RUN_METADATA', {
        details: { field: 'clock.now' },
      });
    }
    return date.toISOString();
  }

  function create(clock) {
    if (!clock || typeof clock.now !== 'function') {
      throw resolveErrorCodes().create('INGESTION_INVALID_RUN_METADATA', {
        details: { field: 'clock' },
      });
    }
    var current = 'RECEIVED';
    var events = [Object.freeze({ atUtc: toIso(clock.now()), state: current })];

    function isLegal(nextState) {
      if (TERMINAL_STATES.indexOf(current) !== -1) {
        return false;
      }
      if (nextSuccessState[current] === nextState) {
        return true;
      }
      return FAILURE_STATES.indexOf(nextState) !== -1;
    }

    function transition(nextState) {
      if (!isLegal(nextState)) {
        throw resolveErrorCodes().create('INGESTION_ILLEGAL_STATE_TRANSITION', {
          details: { attemptedState: nextState, currentState: current },
        });
      }
      current = nextState;
      var event = Object.freeze({ atUtc: toIso(clock.now()), state: current });
      events.push(event);
      return event;
    }

    function currentState() {
      return current;
    }

    function history() {
      return events.slice();
    }

    return Object.freeze({
      currentState: currentState,
      history: history,
      transition: transition,
    });
  }

  return Object.freeze({
    FAILURE_STATES: FAILURE_STATES,
    SUCCESS_PATH: SUCCESS_PATH,
    TERMINAL_STATES: TERMINAL_STATES,
    create: create,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RunStateMachine;
}
