/**
 * CXP-09 hosted UAT helpers for docs/cxp09-uat-runbook.md.
 *
 * Editor entrypoints (parameterless):
 *   CXP09UatStep01Install
 *   CXP09UatStep02InspectTopology
 *   CXP09UatStep08PromotionGate
 */

function CXP09UatStep01Install() {
  return initializeCxp09StableAggregationModel();
}

function CXP09UatStep02InspectTopology() {
  return diagnoseCxp09RunbookChecks();
}

function CXP09UatStep08PromotionGate() {
  var status = getCxp09StableAggregationStatus();
  var topology = diagnoseCxp09RunbookChecks();
  var aggSheets = ['_AGG_INTERVAL', '_AGG_FORECAST', '_AGG_ALLOCATION'];
  var checks = aggSheets.map(function (sheetName) {
    var entry = topology.aggregation[sheetName] || { present: false };
    return {
      sheetName: sheetName,
      present: entry.present === true,
      headerCountOk: entry.headerCountOk === true,
      formulaAnchorCountOk: entry.formulaAnchorCountOk === true,
    };
  });
  return {
    checks: checks,
    installComplete: status.status === 'COMPLETE' && status.nextStep === status.stepCount,
    promotionReady: status.status === 'COMPLETE' &&
      checks.every(function (check) {
        return check.present && check.headerCountOk && check.formulaAnchorCountOk;
      }),
    status: status,
  };
}
