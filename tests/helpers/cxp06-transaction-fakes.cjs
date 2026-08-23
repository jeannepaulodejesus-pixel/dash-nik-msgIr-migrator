class FakeUser {
  constructor(email) {
    this.email = email;
  }

  getEmail() {
    return this.email;
  }
}

class FakeProtection {
  constructor(editors, description = 'copied legacy protection') {
    this.description = description;
    this.domainEdit = true;
    this.editors = editors.slice();
    this.removed = false;
    this.targetAudiences = ['audience-all'];
    this.unprotectedRanges = ['A1'];
    this.warningOnly = true;
  }

  addEditor(user) {
    if (!this.editors.some((editor) => editor.getEmail() === user.getEmail())) {
      this.editors.push(user);
    }
    return this;
  }

  canDomainEdit() {
    return this.domainEdit;
  }

  canEdit() {
    return true;
  }

  getDescription() {
    return this.description;
  }

  getEditors() {
    return this.editors.slice();
  }

  getTargetAudiences() {
    return this.targetAudiences.slice();
  }

  remove() {
    this.removed = true;
  }

  removeEditors(editors) {
    const emails = new Set(editors.map((editor) => editor.getEmail()));
    this.editors = this.editors.filter((editor) => !emails.has(editor.getEmail()));
    return this;
  }

  removeTargetAudience(audienceId) {
    this.targetAudiences = this.targetAudiences.filter((value) => value !== audienceId);
    return this;
  }

  setDescription(description) {
    this.description = description;
    return this;
  }

  setDomainEdit(value) {
    this.domainEdit = value;
    return this;
  }

  setUnprotectedRanges(ranges) {
    this.unprotectedRanges = ranges.slice();
    return this;
  }

  setWarningOnly(value) {
    this.warningOnly = value;
    return this;
  }
}

class FakeRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    Object.assign(this, { sheet, row, column, rowCount, columnCount });
  }

  clearContent() {
    this.sheet.spreadsheet.events.push(['clearContent', this.sheet.name]);
    this.sheet.values = this.sheet.values.map((row) => row.map(() => ''));
    this.sheet.formulas = this.sheet.formulas.map((row) => row.map(() => ''));
    return this;
  }

  getFormulas() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        this.sheet.formulas[this.row - 1 + rowOffset]?.[this.column - 1 + columnOffset] || '',
      ),
    );
  }

  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        this.sheet.values[this.row - 1 + rowOffset]?.[this.column - 1 + columnOffset] ?? '',
      ),
    );
  }

  setValues(values) {
    if (this.sheet.spreadsheet.failWriteSheet === this.sheet.name) {
      throw new Error(`synthetic write failure: ${this.sheet.name}`);
    }
    this.sheet.spreadsheet.events.push(['setValues', this.sheet.name]);
    this.sheet.values = values.map((row) => row.slice());
    this.sheet.formulas = values.map((row) =>
      row.map((value) => (typeof value === 'string' && value.startsWith('=') ? value : '')),
    );
    return this;
  }
}

class FakeSheet {
  constructor(spreadsheet, name, values, formulas, protections = []) {
    this.formulas = formulas.map((row) => row.slice());
    this.hidden = false;
    this.name = name;
    this.protections = protections.slice();
    this.sheetId = spreadsheet.nextSheetId++;
    this.spreadsheet = spreadsheet;
    this.values = values.map((row) => row.slice());
  }

  copyTo(destination) {
    this.spreadsheet.events.push(['copyTo', this.name]);
    return destination.copySheet(this);
  }

  getDataRange() {
    return new FakeRange(
      this,
      1,
      1,
      Math.max(1, this.values.length),
      Math.max(1, ...this.values.map((row) => row.length)),
    );
  }

  getName() {
    return this.name;
  }

  getProtections() {
    return this.protections.filter((protection) => !protection.removed);
  }

  getRange(row, column, rowCount, columnCount) {
    return new FakeRange(this, row, column, rowCount, columnCount);
  }

  getSheetId() {
    return this.sheetId;
  }

  hideSheet() {
    this.hidden = true;
    this.spreadsheet.events.push(['hideSheet', this.name]);
    return this;
  }

  protect() {
    const protection = new FakeProtection(this.spreadsheet.defaultEditors, '');
    this.protections.push(protection);
    return protection;
  }

  setName(name) {
    this.spreadsheet.renameSheet(this, name);
    return this;
  }
}

class FakeSpreadsheet {
  constructor(defaultEditors = []) {
    this.defaultEditors = defaultEditors.slice();
    this.events = [];
    this.failWriteSheet = null;
    this.nextSheetId = 1;
    this.sheets = [];
  }

  addSheet(name, values, formulas) {
    const safeValues = values || [['']];
    const safeFormulas = formulas || safeValues.map((row) => row.map(() => ''));
    const sheet = new FakeSheet(this, name, safeValues, safeFormulas);
    this.sheets.push(sheet);
    return sheet;
  }

  copySheet(source) {
    const copiedProtections = source.getProtections().map(
      (protection) => new FakeProtection(
        protection.getEditors(),
        protection.getDescription(),
      ),
    );
    const sheet = new FakeSheet(
      this,
      `Copy of ${source.getName()}`,
      source.values,
      source.formulas,
      copiedProtections,
    );
    this.sheets.push(sheet);
    return sheet;
  }

  deleteSheet(sheet) {
    this.events.push(['deleteSheet', sheet.getName()]);
    this.sheets = this.sheets.filter((candidate) => candidate !== sheet);
  }

  getSheetByName(name) {
    return this.sheets.find((sheet) => sheet.getName() === name) || null;
  }

  getSheets() {
    return this.sheets.slice();
  }

  renameSheet(sheet, name) {
    if (this.getSheetByName(name)) {
      throw new Error(`Duplicate sheet name: ${name}`);
    }
    sheet.name = name;
    this.events.push(['setName', name]);
  }
}

module.exports = { FakeProtection, FakeSpreadsheet, FakeUser };
