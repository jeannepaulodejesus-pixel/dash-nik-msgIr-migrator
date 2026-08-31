/**
 * WB0817 source-error baseline seed for SOURCE_ERROR_BASELINE.
 *
 * Every record is bound to `config/formula-family-catalog.json` cached-error
 * evidence: 1,885 total (1,838 `#N/A`, 26 `#DIV/0!`, 21 `#REF!`). Where the
 * repository evidence is per-sheet rather than per-cell, the record stays a
 * bounded worksheet-scope count instead of inventing cell locations. The
 * superseded WB0809 count of 5,655 is never seeded.
 */
var SourceErrorBaseline = (function () {
  'use strict';

  function resolveContracts() {
    if (typeof ParityContracts !== 'undefined') {
      return ParityContracts;
    }
    return require('./ParityContracts.js');
  }

  var REFERENCE_KINDS = Object.freeze({
    formulaFamilyRange: 'FORMULA_FAMILY_RANGE',
    worksheetScope: 'WORKSHEET_SCOPE',
  });

  var TREATMENTS = Object.freeze({
    excludeFromDefects: 'EXCLUDE_FROM_MIGRATION_DEFECTS',
  });

  var CLASSIFICATION = 'INTENTIONAL_LEGACY_BEHAVIOR';

  var RULES = Object.freeze([
    Object.freeze({
      cellOrRange: 'G2:G5717',
      errorType: '#N/A',
      evidence: 'formula-family-catalog: Offered VLOOKUP(Case: Case Number, Handled!D:T, 17, 0) ' +
        'cachedErrors #N/A 919; sample cells begin at G4799.',
      expectedCount: 919,
      formulaFamily: 'VLOOKUP(Offered[[#This Row],[Case: Case Number]],Handled!D:T,17,0)',
      referenceKind: REFERENCE_KINDS.formulaFamilyRange,
      worksheet: 'Offered',
    }),
    Object.freeze({
      cellOrRange: 'F2:F5717',
      errorType: '#N/A',
      evidence: 'formula-family-catalog: Offered IF(Handled ASA<91,1,0) cachedErrors #N/A 919; ' +
        'propagated from the same missing handled-case lookups.',
      expectedCount: 919,
      formulaFamily: 'IF(Offered[[#This Row],[Handled ASA]]<91,1,0)',
      referenceKind: REFERENCE_KINDS.formulaFamilyRange,
      worksheet: 'Offered',
    }),
    Object.freeze({
      cellOrRange: 'WORKSHEET',
      errorType: '#REF!',
      evidence: 'formula-family-catalog cachedErrors.bySheet: Teams Update #REF! 13; broken ' +
        'Teams Update references are accepted legacy behavior.',
      expectedCount: 13,
      formulaFamily: 'teams_update_broken_reference',
      referenceKind: REFERENCE_KINDS.worksheetScope,
      worksheet: 'Teams Update',
    }),
    Object.freeze({
      cellOrRange: 'WORKSHEET',
      errorType: '#REF!',
      evidence: 'formula-family-catalog cachedErrors.bySheet: Interval View #REF! 8; broken ' +
        'LOB/sst defined names are accepted legacy behavior.',
      expectedCount: 8,
      formulaFamily: 'broken_defined_name_lob_sst',
      referenceKind: REFERENCE_KINDS.worksheetScope,
      worksheet: 'Interval View',
    }),
    Object.freeze({
      cellOrRange: 'WORKSHEET',
      errorType: '#DIV/0!',
      evidence: 'formula-family-catalog cachedErrors.bySheet: pull outs for alloc #DIV/0! 20; ' +
        'zero-denominator allocation pull-outs are accepted legacy behavior.',
      expectedCount: 20,
      formulaFamily: 'allocation_pullout_zero_denominator',
      referenceKind: REFERENCE_KINDS.worksheetScope,
      worksheet: 'pull outs for alloc',
    }),
    Object.freeze({
      cellOrRange: 'WORKSHEET',
      errorType: '#DIV/0!',
      evidence: 'formula-family-catalog cachedErrors.bySheet: Drivers and Allocation #DIV/0! 6; ' +
        'zero-denominator allocation ratios are accepted legacy behavior.',
      expectedCount: 6,
      formulaFamily: 'allocation_ratio_zero_denominator',
      referenceKind: REFERENCE_KINDS.worksheetScope,
      worksheet: 'Drivers and Allocation',
    }),
  ]);

  function listRecords() {
    var contracts = resolveContracts();
    return RULES.map(function (rule) {
      return Object.freeze({
        baselineVersion: contracts.BASELINE_VERSION,
        cellOrRange: rule.cellOrRange,
        classification: CLASSIFICATION,
        controlWorkbookSha256: contracts.CONTROL_WORKBOOK_SHA256,
        errorType: rule.errorType,
        evidence: rule.evidence,
        expectedCount: rule.expectedCount,
        formulaFamily: rule.formulaFamily,
        referenceKind: rule.referenceKind,
        resolutionStatus: contracts.RESOLUTION_STATUSES.closedExpected,
        treatment: TREATMENTS.excludeFromDefects,
        worksheet: rule.worksheet,
      });
    });
  }

  function totals(records) {
    var rows = records || listRecords();
    var byType = Object.create(null);
    var total = 0;
    rows.forEach(function (record) {
      byType[record.errorType] = (byType[record.errorType] || 0) +
        Number(record.expectedCount || 0);
      total += Number(record.expectedCount || 0);
    });
    return Object.freeze({ byType: Object.freeze(byType), total: total });
  }

  /** Fails closed when seeded rows drift from the WB0817 authority. */
  function verify(records) {
    var contracts = resolveContracts();
    var actual = totals(records);
    var expectedByType = contracts.BASELINE_ERRORS_BY_TYPE;
    var typeDiffs = Object.keys(expectedByType).filter(function (errorType) {
      return actual.byType[errorType] !== expectedByType[errorType];
    });
    var unexpectedTypes = Object.keys(actual.byType).filter(function (errorType) {
      return expectedByType[errorType] === undefined;
    });
    return Object.freeze({
      actualByType: actual.byType,
      actualTotal: actual.total,
      baselineVersion: contracts.BASELINE_VERSION,
      expectedByType: expectedByType,
      expectedTotal: contracts.BASELINE_TOTAL_ERRORS,
      pass: actual.total === contracts.BASELINE_TOTAL_ERRORS &&
        typeDiffs.length === 0 &&
        unexpectedTypes.length === 0,
      typeDiffs: Object.freeze(typeDiffs),
      unexpectedTypes: Object.freeze(unexpectedTypes),
    });
  }

  return Object.freeze({
    CLASSIFICATION: CLASSIFICATION,
    REFERENCE_KINDS: REFERENCE_KINDS,
    TREATMENTS: TREATMENTS,
    listRecords: listRecords,
    totals: totals,
    verify: verify,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SourceErrorBaseline;
}
