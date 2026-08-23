var ProtectionHelpers = (function () {
  'use strict';

  var DESCRIPTION_PREFIX = 'CXP-02 managed protection:';

  function managedDescription(sheet) {
    return DESCRIPTION_PREFIX + ' ' + sheet.getName();
  }

  function editorEmail(editor) {
    return editor && typeof editor.getEmail === 'function' ? editor.getEmail() : '';
  }

  function validateServices(services, action) {
    var purpose = action || 'to protect backend sheets';
    if (
      !services ||
      !services.spreadsheetApp ||
      !services.spreadsheetApp.ProtectionType ||
      !services.session ||
      typeof services.session.getEffectiveUser !== 'function'
    ) {
      throw new Error('SpreadsheetApp and Session adapters are required ' + purpose + '.');
    }
    if (
      typeof services.spreadsheetApp.ProtectionType.SHEET === 'undefined' ||
      services.spreadsheetApp.ProtectionType.SHEET === null
    ) {
      throw new Error('SpreadsheetApp.ProtectionType.SHEET is required ' + purpose + '.');
    }
    var effectiveUser = services.session.getEffectiveUser();
    var effectiveEmail = editorEmail(effectiveUser);
    if (!effectiveUser || !effectiveEmail) {
      throw new Error('An effective user with an email is required ' + purpose + '.');
    }

    return Object.freeze({
      effectiveEmail: effectiveEmail,
      effectiveUser: effectiveUser,
      protectionType: services.spreadsheetApp.ProtectionType.SHEET,
    });
  }

  function assertManagedProtectionAvailable(sheet, protectionType) {
    if (!sheet || typeof sheet.getProtections !== 'function') {
      throw new Error('A Sheet-compatible backend surface is required.');
    }
    var protections = sheet.getProtections(protectionType);
    var description = managedDescription(sheet);
    if (
      protections.length > 1 ||
      (protections.length === 1 && protections[0].getDescription() !== description)
    ) {
      throw new Error(
        sheet.getName() +
          ' already has a non-CXP sheet protection; CXP-02 will not modify it.',
      );
    }
  }

  function ensureManagedProtection(sheet, services) {
    if (!sheet || typeof sheet.getProtections !== 'function') {
      throw new Error('A Sheet-compatible backend surface is required.');
    }
    var validated = validateServices(services, 'to protect backend sheets');
    var description = managedDescription(sheet);
    var protection = sheet.getProtections(validated.protectionType).filter(function (candidate) {
      return candidate.getDescription() === description;
    })[0];

    if (!protection) {
      protection = sheet.protect().setDescription(description);
    }

    protection.setWarningOnly(false);
    protection.addEditor(validated.effectiveUser);
    var otherEditors = protection.getEditors().filter(function (editor) {
      return editorEmail(editor) !== validated.effectiveEmail;
    });
    if (otherEditors.length > 0) {
      protection.removeEditors(otherEditors);
    }
    protection.getTargetAudiences().forEach(function (audienceId) {
      protection.removeTargetAudience(audienceId);
    });
    if (protection.canDomainEdit()) {
      protection.setDomainEdit(false);
    }
    protection.setUnprotectedRanges([]);

    return protection;
  }

  return Object.freeze({
    DESCRIPTION_PREFIX: DESCRIPTION_PREFIX,
    assertManagedProtectionAvailable: assertManagedProtectionAvailable,
    ensureManagedProtection: ensureManagedProtection,
    validateServices: validateServices,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ProtectionHelpers;
}
