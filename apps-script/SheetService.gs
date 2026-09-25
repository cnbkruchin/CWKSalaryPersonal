/**
 * SheetService.gs — เลเยอร์เข้าถึง Google Sheet ที่ใช้เป็นฐานข้อมูลของระบบทั้งหมด
 * ชีตทุกตัวถูกอ่าน/เขียนผ่านฟังก์ชันในไฟล์นี้เท่านั้น ไม่มีที่อื่นเรียก SpreadsheetApp ตรง ๆ
 *
 * - อ่าน/เขียนโดยจับคู่ตามชื่อหัวคอลัมน์จริงในชีต (ไม่ใช่ตามลำดับคอลัมน์) และเติมคอลัมน์ที่ขาดให้อัตโนมัติ
 *   จึงอัปเกรดระบบได้โดยไม่ต้องแก้ชีตเดิมด้วยมือ
 * - แคชผลการอ่านไว้ตลอดการเรียก 1 ครั้ง (1 execution) เพื่อความเร็ว และล้างแคชเมื่อมีการเขียน
 */

var SHEET_NAMES = {
  EMPLOYEES: 'Employees',
  SALARY_HISTORY: 'SalaryHistory',
  BACKPAY_QUEUE: 'BackPayQueue',
  PAYROLL_RUNS: 'PayrollRuns',
  PAYROLL_DEDUCTIONS: 'PayrollDeductions',
  SETTINGS: 'Settings',
  AUDIT_LOG: 'AuditLog'
};

var SHEET_HEADERS = {
  Employees: ['EmployeeID', 'PrefixName', 'FirstName', 'LastName', 'Group', 'Position', 'StartDate', 'Status', 'HasSSO', 'BankName', 'BankAccountNo', 'CitizenID', 'Phone', 'Role', 'PinHash', 'PinSalt', 'Note', 'CreatedAt', 'MustChangePin', 'PdpaAcceptedAt', 'LastLoginAt'],
  SalaryHistory: ['HistoryID', 'EmployeeID', 'EffectiveMonth', 'BaseSalary', 'ChangeType', 'ApprovedDate', 'ApprovedBy', 'Note', 'CreatedAt'],
  BackPayQueue: ['QueueID', 'EmployeeID', 'FromMonth', 'ToMonth', 'OldBaseSalary', 'NewBaseSalary', 'MonthlyDiff', 'MonthsCount', 'TotalBackPay', 'Status', 'AppliedRunMonth', 'CreatedAt', 'Note'],
  PayrollRuns: ['Month', 'EmployeeID', 'BaseSalary', 'PositionAllowance', 'OnDutyPay', 'OtherIncome', 'OtherIncomeNote', 'BackPay', 'BackPayNote', 'GrossPay', 'SSOEmployee', 'SSOEmployer', 'CompFundEmployer', 'OtherDeductionTotal', 'TotalDeduction', 'NetPay', 'Status', 'PaidDate', 'UpdatedAt', 'UpdatedBy'],
  PayrollDeductions: ['DeductionID', 'Month', 'EmployeeID', 'Category', 'Label', 'Amount'],
  Settings: ['Key', 'Value'],
  AuditLog: ['Timestamp', 'ActorID', 'Role', 'Action', 'Target', 'Detail']
};

var DEFAULT_SETTINGS = {
  SchoolName: 'โรงเรียนจุนวิทยาคม',
  SchoolAddress: 'อำเภอจุน จังหวัดพะเยา',
  SchoolDistrictOffice: 'สำนักงานเขตพื้นที่การศึกษามัธยมศึกษาพะเยา',
  SSORate: '0.05',
  SSOWageCap: '15000',
  CompFundRate: '0',
  FinanceOfficerName: '',
  FinanceOfficerTitle: 'เจ้าหน้าที่การเงิน',
  BudgetHeadName: '',
  BudgetHeadTitle: 'หัวหน้างานกลุ่มบริหารงบประมาณ',
  DeputyDirectorName: '',
  DeputyDirectorTitle: 'รองผู้อำนวยการกลุ่มบริหารงบประมาณ',
  DirectorName: '',
  DirectorTitle: 'ผู้อำนวยการโรงเรียน',
  DataControllerContact: 'ฝ่ายการเงิน โรงเรียนจุนวิทยาคม',
  SessionTimeoutMinutes: '480'
};

var NUMERIC_COLUMNS = ['BaseSalary', 'PositionAllowance', 'OnDutyPay', 'OtherIncome', 'BackPay', 'GrossPay', 'SSOEmployee', 'SSOEmployer',
  'CompFundEmployer', 'OtherDeductionTotal', 'TotalDeduction', 'NetPay', 'Amount', 'OldBaseSalary', 'NewBaseSalary', 'MonthlyDiff',
  'MonthsCount', 'TotalBackPay'];
var BOOLEAN_COLUMNS = ['HasSSO', 'MustChangePin'];
var MONTH_COLUMNS = ['Month', 'EffectiveMonth', 'FromMonth', 'ToMonth', 'AppliedRunMonth'];

// แคชระดับ execution (Apps Script เริ่ม global ใหม่ทุกครั้งที่ถูกเรียก จึงไม่ค้างข้ามคำขอ)
var _ss = null;
var _rowsCache = {};
var _headerCache = {};

function getSpreadsheet_() {
  if (_ss) return _ss;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    try {
      _ss = SpreadsheetApp.openById(id);
      return _ss;
    } catch (e) {
      // ถ้าเปิดไม่ได้ (ถูกลบ/ย้าย) ให้สร้างใหม่ด้านล่าง
    }
  }
  _ss = SpreadsheetApp.create('ฐานข้อมูลระบบเงินเดือนลูกจ้าง - โรงเรียนจุนวิทยาคม');
  props.setProperty('SPREADSHEET_ID', _ss.getId());
  return _ss;
}

function getSheet_(name) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    var headers = SHEET_HEADERS[name];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ffffff');
    _headerCache[name] = headers.slice();
  } else if (!_headerCache[name]) {
    ensureHeaders_(sheet, name);
  }
  return sheet;
}

/** เติมหัวคอลัมน์ที่ระบบรุ่นใหม่ต้องใช้แต่ยังไม่มีในชีตเดิม (ต่อท้ายขวาสุด ข้อมูลเดิมไม่ขยับ) */
function ensureHeaders_(sheet, name) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var actual = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var missing = SHEET_HEADERS[name].filter(function (h) { return actual.indexOf(h) === -1; });
  if (missing.length) {
    var startCol = actual.filter(function (h) { return h !== ''; }).length + 1;
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing])
      .setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ffffff');
    actual = actual.slice(0, startCol - 1).concat(missing);
  }
  _headerCache[name] = actual;
}

function headersOf_(name) {
  getSheet_(name);
  return _headerCache[name];
}

function invalidate_(name) {
  delete _rowsCache[name];
}

/** อ่านทั้งชีตเป็นอาเรย์ของ object ตาม header แถวที่ 1 */
function readAll_(name) {
  if (_rowsCache[name]) return _rowsCache[name];
  var sheet = getSheet_(name);
  var headers = _headerCache[name];
  var lastRow = sheet.getLastRow();
  var out = [];
  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    for (var r = 0; r < values.length; r++) {
      var row = values[r];
      var isEmpty = row.every(function (v) { return v === '' || v === null; });
      if (isEmpty) continue;
      var obj = { _row: r + 2 };
      for (var c = 0; c < headers.length; c++) {
        if (headers[c]) obj[headers[c]] = normalizeCell_(headers[c], row[c]);
      }
      out.push(obj);
    }
  }
  _rowsCache[name] = out;
  return out;
}

/**
 * ค่าที่อ่านจากชีตอาจเป็น Date (ถ้ามีคนพิมพ์วันที่ลงชีตเอง) ซึ่ง google.script.run ส่งกลับ client ไม่ได้
 * และคีย์เดือน/รหัสที่เป็นตัวเลขต้องเป็นข้อความเสมอ จึงแปลงให้อยู่ในรูปแบบที่ระบบคาดหวังตั้งแต่ตอนอ่าน
 */
function normalizeCell_(header, v) {
  if (v instanceof Date) {
    var tz = Session.getScriptTimeZone() || 'Asia/Bangkok';
    if (MONTH_COLUMNS.indexOf(header) !== -1) return Utilities.formatDate(v, tz, 'yyyy-MM');
    var hms = Utilities.formatDate(v, tz, 'HH:mm:ss');
    return Utilities.formatDate(v, tz, hms === '00:00:00' ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ss");
  }
  if (typeof v === 'number' && NUMERIC_COLUMNS.indexOf(header) === -1 && BOOLEAN_COLUMNS.indexOf(header) === -1) {
    return String(v);
  }
  return v;
}

/**
 * แปลง object เป็นแถวตามหัวคอลัมน์จริง — ข้อความทุกช่อง (ที่ไม่ใช่ตัวเลข/boolean) ใส่ ' นำหน้า
 * เพื่อไม่ให้ Sheets แปลงเองอัตโนมัติ (เช่น เลขบัญชี 0202... เสียเลข 0 นำหน้า หรือ "2026-09" กลายเป็นวันที่)
 * เครื่องหมาย ' ไม่ถูกเก็บเป็นส่วนหนึ่งของค่าในเซลล์
 */
function toRow_(headers, obj) {
  return headers.map(function (h) {
    var v = obj[h];
    if (v === undefined || v === null || v === '') return '';
    if (NUMERIC_COLUMNS.indexOf(h) !== -1) return Number(v) || 0;
    if (BOOLEAN_COLUMNS.indexOf(h) !== -1) return isTrue_(v);
    return "'" + String(v);
  });
}

function appendRow_(name, obj) {
  var sheet = getSheet_(name);
  sheet.appendRow(toRow_(_headerCache[name], obj));
  invalidate_(name);
  return sheet.getLastRow();
}

function appendRows_(name, objs) {
  if (!objs.length) return;
  var sheet = getSheet_(name);
  var headers = _headerCache[name];
  var rows = objs.map(function (obj) { return toRow_(headers, obj); });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  invalidate_(name);
}

/** อัปเดตแถวที่ _row ระบุ (ได้จาก readAll_) ด้วยค่าใน patch (เฉพาะคีย์ที่มี) */
function updateRowByIndex_(name, rowIndex, patch) {
  var sheet = getSheet_(name);
  var headers = _headerCache[name];
  var range = sheet.getRange(rowIndex, 1, 1, headers.length);
  var current = range.getValues()[0];
  var merged = {};
  headers.forEach(function (h, i) {
    if (h) merged[h] = patch.hasOwnProperty(h) ? patch[h] : normalizeCell_(h, current[i]);
  });
  range.setValues([toRow_(headers, merged)]);
  invalidate_(name);
}

function deleteRowByIndex_(name, rowIndex) {
  getSheet_(name).deleteRow(rowIndex);
  invalidate_(name);
}

/** ค้นแถวแรกที่ field === value คืนค่า object หรือ null */
function findOne_(name, field, value) {
  var rows = readAll_(name);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][field] === value) return rows[i];
  }
  return null;
}

function findAll_(name, field, value) {
  return readAll_(name).filter(function (r) { return r[field] === value; });
}

/**
 * รันงานที่แก้ไขข้อมูลภายใต้ LockService เพื่อกันการเขียนชนกันเมื่อมีผู้ใช้งานพร้อมกันหลายคน
 * (เช่น กดสร้างรอบจ่ายซ้ำ 2 เครื่องพร้อมกัน) และล้างแคชเพื่ออ่านข้อมูลล่าสุดหลังได้ล็อก
 */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    _rowsCache = {};
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------------- Audit log ----------------

/** บันทึกประวัติการใช้งาน (ใคร ทำอะไร กับข้อมูลใด เมื่อไร) — ล้มเหลวได้โดยไม่ทำให้งานหลักล้ม */
function audit_(actorId, role, action, target, detail) {
  try {
    appendRow_(SHEET_NAMES.AUDIT_LOG, {
      Timestamp: nowIso(), ActorID: actorId || '', Role: role || '', Action: action,
      Target: target || '', Detail: detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''
    });
  } catch (e) {
    console.error('audit failed: ' + e.message);
  }
}

// ---------------- Settings ----------------

function getSettings_() {
  var rows = readAll_(SHEET_NAMES.SETTINGS);
  var map = {};
  rows.forEach(function (r) { map[r.Key] = r.Value; });
  return map;
}

function getSetting_(key, fallback) {
  var found = findOne_(SHEET_NAMES.SETTINGS, 'Key', key);
  return found ? found.Value : fallback;
}

function setSetting_(key, value) {
  var found = findOne_(SHEET_NAMES.SETTINGS, 'Key', key);
  if (found) {
    updateRowByIndex_(SHEET_NAMES.SETTINGS, found._row, { Key: key, Value: value });
  } else {
    appendRow_(SHEET_NAMES.SETTINGS, { Key: key, Value: value });
  }
}

function updateSettings(token, patch) {
  try {
    var session = requireAuth_(token, ['admin']);
    return withLock_(function () {
      var changed = [];
      Object.keys(patch).forEach(function (k) {
        if (DEFAULT_SETTINGS.hasOwnProperty(k) && String(getSetting_(k, '')) !== String(patch[k])) {
          setSetting_(k, patch[k]);
          changed.push(k);
        }
      });
      if (changed.length) audit_(session.employeeId, session.role, 'UPDATE_SETTINGS', '', changed.join(', '));
      return apiOk(true);
    });
  } catch (e) {
    return apiError(e.message);
  }
}

function getSettingsForClient(token) {
  try {
    requireAuth_(token, ['admin']);
    var s = getSettings_();
    delete s.AuthPepper;
    return apiOk(s);
  } catch (e) {
    return apiError(e.message);
  }
}

/**
 * เรียกครั้งเดียวตอนติดตั้งระบบใหม่ (เปิด Apps Script editor แล้วกด Run บนฟังก์ชันนี้)
 * สร้างสเปรดชีต + ชีตทั้งหมด + ค่าตั้งต้น + บัญชีแอดมินเริ่มต้น — เรียกซ้ำได้อย่างปลอดภัย (ใช้อัปเกรดชีตเดิมด้วย)
 * รหัสแอดมินเริ่มต้น: EmployeeID = admin, รหัสผ่าน = 123456  (ระบบบังคับเปลี่ยนเป็น 8 ตัวอักษรขึ้นไปทันที)
 */
function initializeSystem() {
  var ss = getSpreadsheet_();

  Object.keys(SHEET_NAMES).forEach(function (k) {
    getSheet_(SHEET_NAMES[k]);
  });

  var sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && ss.getSheets().length > 1 && sheet1.getLastRow() === 0) {
    ss.deleteSheet(sheet1);
  }

  var settings = getSettings_();
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
    if (!settings.hasOwnProperty(k) || settings[k] === '') {
      setSetting_(k, DEFAULT_SETTINGS[k]);
    }
  });
  if (!settings.AuthPepper) {
    setSetting_('AuthPepper', Utilities.getUuid());
  }

  var admin = findOne_(SHEET_NAMES.EMPLOYEES, 'EmployeeID', 'admin');
  if (!admin) {
    var salt = Utilities.getUuid();
    appendRow_(SHEET_NAMES.EMPLOYEES, {
      EmployeeID: 'admin',
      FirstName: 'ผู้ดูแลระบบ',
      Group: 'ผู้ดูแลระบบ',
      Position: 'แอดมิน',
      Status: 'active',
      HasSSO: false,
      Role: 'admin',
      PinHash: hashPin_('123456', salt),
      PinSalt: salt,
      MustChangePin: true,
      CreatedAt: nowIso()
    });
  }

  return {
    spreadsheetUrl: ss.getUrl(),
    message: 'ติดตั้งระบบสำเร็จ เข้าหน้าผู้ดูแล (?page=admin) ด้วย admin / 123456 แล้วตั้งรหัสผ่านใหม่ทันที'
  };
}
