var DatasetSheets = (function () {
  'use strict';

  function resolveSheetNames() {
    if (typeof SheetNames !== 'undefined') {
      return SheetNames;
    }
    return require('./SheetNames.js');
  }

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  var datasetNames = Object.freeze([
    'Handled',
    'Offered',
    'AHT - Raw',
    'Auxes - Raw',
    'Staff',
  ]);
  var cachedBindings = null;

  function resolveBindings() {
    if (!cachedBindings) {
      var names = resolveSheetNames().TARGET;
      cachedBindings = Object.freeze(datasetNames.map(function (datasetName, index) {
        return Object.freeze({
          datasetName: datasetName,
          rawSheetName: names.raw[index],
          stagingSheetName: names.staging[index],
        });
      }));
    }
    return cachedBindings;
  }

  function listBindings() {
    return resolveBindings();
  }

  function getByDatasetName(datasetName) {
    var binding = resolveBindings().filter(function (candidate) {
      return candidate.datasetName === datasetName;
    })[0];
    if (!binding) {
      throw resolveErrorCodes().create('SCHEMA_UNKNOWN_DATASET', {
        details: { datasetName: datasetName },
      });
    }
    return binding;
  }

  return Object.freeze({
    getByDatasetName: getByDatasetName,
    listBindings: listBindings,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DatasetSheets;
}
