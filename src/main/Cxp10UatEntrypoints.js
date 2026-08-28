/**
 * CXP-10 hosted UAT helpers for docs/cxp10-uat-runbook.md.
 *
 * Editor entrypoints (parameterless):
 *   CXP10UatStep01Install
 *   CXP10UatStep02InspectTopology
 *   CXP10UatStep08PromotionGate
 */

function CXP10UatStep01Install() {
  return initializeCxp10ReportingSurfaces();
}

function CXP10UatStep02InspectTopology() {
  return diagnoseCxp10RunbookChecks();
}

function CXP10UatStep08PromotionGate() {
  var status = getCxp10ReportingSurfaceStatus();
  var topology = diagnoseCxp10RunbookChecks();
  return {
    installComplete: status.status === 'COMPLETE' && status.nextStep === status.stepCount,
    intervalViewReady: topology.intervalView &&
      topology.intervalView.present === true &&
      topology.intervalView.headerCountOk === true &&
      topology.intervalView.metricAnchorCountOk === true &&
      topology.intervalView.legacyBackendReferenceDetected !== true,
    momReady: topology.mom && topology.mom.present === true,
    forecastBridgeReady: topology.forecastBridge &&
      topology.forecastBridge.present === true &&
      topology.forecastBridge.bridgeFormulaPresent === true &&
      topology.forecastBridge.momReferenceDetected === true,
    promotionReady: status.status === 'COMPLETE' &&
      topology.intervalView &&
      topology.intervalView.present === true &&
      topology.intervalView.headerCountOk === true &&
      topology.intervalView.metricAnchorCountOk === true &&
      topology.intervalView.legacyBackendReferenceDetected !== true &&
      topology.mom &&
      topology.mom.present === true &&
      topology.forecastBridge &&
      topology.forecastBridge.bridgeFormulaPresent === true,
    status: status,
    topology: topology,
  };
}
