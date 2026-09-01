var PromotionChecklist = (function () {
  'use strict';

  function resolveConfig() {
    if (typeof Config !== 'undefined') {
      return Config;
    }
    return require('../config/Config.js');
  }

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function evaluate(input) {
    var source = input || {};
    var environment = resolveConfig().normalizeEnvironment(source.environment || 'DEV');
    var missing = [];
    var gates = Object.freeze({
      controlConfigured: Boolean(source.controlConfigured),
      healthHealthy: source.healthHealthy === true,
      localVerifyPassed: source.localVerifyPassed === true,
      masterTemplateConfigured: Boolean(source.masterTemplateConfigured),
      prodAcknowledged: source.prodAcknowledged === true,
      registryHeadersInstalled: source.registryHeadersInstalled === true,
      singleActiveWeek: source.singleActiveWeek === true,
      targetConfigured: Boolean(source.targetConfigured),
      triggerInventoryInstalled: source.triggerInventoryInstalled === true,
      driveInboxConfigured: Boolean(source.driveInboxConfigured),
    });

    Object.keys(gates).forEach(function (key) {
      if (key === 'prodAcknowledged') {
        return;
      }
      if (gates[key] !== true) {
        missing.push(key);
      }
    });
    if (environment === 'PROD' && gates.prodAcknowledged !== true) {
      missing.push('prodAcknowledged');
    }

    var promotionReady = missing.length === 0;
    var result = Object.freeze({
      environment: environment,
      gates: gates,
      missing: Object.freeze(missing.slice()),
      promotionReady: promotionReady,
    });
    if (!promotionReady && source.throwOnIncomplete === true) {
      throw resolveErrorCodes().create('PROMOTION_CHECKLIST_INCOMPLETE', {
        details: { missing: missing.slice(), environment: environment },
      });
    }
    return result;
  }

  return Object.freeze({ evaluate: evaluate });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PromotionChecklist;
}
