/**
 * SheetService.gs — เลเยอร์เข้าถึง Google Sheet ที่ใช้เป็นฐานข้อมูลของระบบทั้งหมด
 * ชีตทุกตัวถูกอ่าน/เขียนผ่านฟังก์ชันในไฟล์นี้เท่านั้น ไม่มีที่อื่นเรียก SpreadsheetApp ตรง ๆ
 */

var SHEET_NAMES = {
  EMPLOYEES: 'Employees',
  SALARY_HISTORY: 'SalaryHistory',
  BACKPAY_QUEUE: 'BackPayQueue',
  PAYROLL_RUNS: 'PayrollRuns',
  PAYROLL_DEDUCTIONS: 'PayrollDeductions',
  SETTINGS: 'Settings'
};

var SHEET_HEADERS = {
  Employees: ['EmployeeID', 'PrefixName', 'FirstName', 'LastName', 'Group', 'Position', 'StartDate', 'Status', 'HasSSO', 'BankName', 'BankAccountNo', 'CitizenID', 'Phone', 'Role', 'PinHash', 'PinSalt', 'Note', 'CreatedAt'],
  SalaryHistory: ['HistoryID', 'EmployeeID', 'EffectiveMonth', 'BaseSalary', 'ChangeType', 'ApprovedDate', 'ApprovedBy', 'Note', 'CreatedAt'],
  BackPayQueue: ['QueueID', 'EmployeeID', 'FromMonth', 'ToMonth', 'OldBaseSalary', 'NewBaseSalary', 'MonthlyDiff', 'MonthsCount', 'TotalBackPay', 'Status', 'AppliedRunMonth', 'CreatedAt', 'Note'],
  PayrollRuns: ['Month', 'EmployeeID', 'BaseSalary', 'Allowance', 'AllowanceNote', 'BackPay', 'BackPayNote', 'GrossPay', 'SSOEmployee', 'SSOEmployer', 'CompFundEmployer', 'OtherDeductionTotal', 'TotalDeduction', 'NetPay', 'Status', 'PaidDate', 'UpdatedAt', 'UpdatedBy'],
  PayrollDeductions: ['DeductionID', 'Month', 'EmployeeID', 'Category', 'Label', 'Amount'],
  Settings: ['Key', 'Value']
};

var DEFAULT_SETTINGS = {
  SchoolName: 'โรงเรียนจุนวิทยาคม',
  SchoolAddress: 'อำเภอจุน จังหวัดพะเยา',
  SchoolDistrictOffice: 'สำนักงานเขตพื้นที่การศึกษามัธยมศึกษาพะเยา',
  SSORate: '0.05',
  SSOWageCap: '15000',
  CompFundRate: '0.002',
  FinanceOfficerName: '',
  FinanceOfficerTitle: 'เจ้าหน้าที่การเงิน',
  BudgetHeadName: '',
  BudgetHeadTitle: 'หัวหน้างานกลุ่มบริหารงบประมาณ',
  DeputyDirectorName: '',
  DeputyDirectorTitle: 'รองผู้อำนวยการกลุ่มบริหารงบประมาณ',
  DirectorName: '',
  DirectorTitle: 'ผู้อำนวยการโรงเรียน',
  SessionTimeoutMinutes: '480'
};

function getSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      // ถ้าเปิดไม่ได้ (ถูกลบ/ย้าย) ให้สร้างใหม่ด้านล่าง
    }
  }
  var ss = SpreadsheetApp.create('ฐานข้อมูลระบบเงินเดือนลูกจ้าง - โรงเรียนจุนวิทยาคม');
  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
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
  }
  return sheet;
}

/** อ่านทั้งชีตเป็นอาเรย์ของ object ตาม header แถวที่ 1 */
function readAll_(name) {
  var sheet = getSheet_(name);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var isEmpty = row.every(function (v) { return v === '' || v === null; });
    if (isEmpty) continue;
    var obj = { _row: r + 2 };
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = row[c];
    }
    out.push(obj);
  }
  return out;
}

function appendRow_(name, obj) {
  var sheet = getSheet_(name);
  var headers = SHEET_HEADERS[name];
  var row = headers.map(function (h) {
    var v = obj[h];
    return v === undefined || v === null ? '' : v;
  });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function appendRows_(name, objs) {
  if (!objs.length) return;
  var sheet = getSheet_(name);
  var headers = SHEET_HEADERS[name];
  var rows = objs.map(function (obj) {
    return headers.map(function (h) {
      var v = obj[h];
      return v === undefined || v === null ? '' : v;
    });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}

/** อัปเดตแถวที่ _row ระบุ (ได้จาก readAll_) ด้วยค่าใน patch (เฉพาะคีย์ที่มี) */
function updateRowByIndex_(name, rowIndex, patch) {
  var sheet = getSheet_(name);
  var headers = SHEET_HEADERS[name];
  var current = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  var next = headers.map(function (h, i) {
    return patch.hasOwnProperty(h) ? patch[h] : current[i];
  });
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([next]);
}

function deleteRowByIndex_(name, rowIndex) {
  getSheet_(name).deleteRow(rowIndex);
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
  requireAuth_(token, ['admin']);
  Object.keys(patch).forEach(function (k) {
    if (DEFAULT_SETTINGS.hasOwnProperty(k)) setSetting_(k, patch[k]);
  });
  return apiOk(getSettings_());
}

function getSettingsForClient(token) {
  requireAuth_(token, ['admin', 'employee']);
  var s = getSettings_();
  delete s.AuthPepper;
  return apiOk(s);
}

/**
 * เรียกครั้งเดียวตอนติดตั้งระบบใหม่ (เปิด Apps Script editor แล้วกด Run บนฟังก์ชันนี้)
 * สร้างสเปรดชีต + ชีตทั้งหมด + ค่าตั้งต้น + บัญชีแอดมินเริ่มต้น
 * รหัสแอดมินเริ่มต้น: EmployeeID = admin, PIN = 123456  (เปลี่ยนทันทีหลังเข้าใช้งานครั้งแรก)
 */
function initializeSystem() {
  var ss = getSpreadsheet_();

  Object.keys(SHEET_NAMES).forEach(function (k) {
    getSheet_(SHEET_NAMES[k]);
  });

  // ลบชีตเริ่มต้น "Sheet1" ถ้ายังไม่ถูกใช้งาน
  var sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && ss.getSheets().length > 1) {
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
      PrefixName: '',
      FirstName: 'ผู้ดูแลระบบ',
      LastName: '',
      Group: 'ผู้ดูแลระบบ',
      Position: 'แอดมิน',
      StartDate: '',
      Status: 'active',
      HasSSO: false,
      BankName: '',
      BankAccountNo: '',
      CitizenID: '',
      Phone: '',
      Role: 'admin',
      PinHash: hashPin_('123456', salt),
      PinSalt: salt,
      Note: 'บัญชีเริ่มต้น กรุณาเปลี่ยนรหัสผ่านทันที',
      CreatedAt: nowIso()
    });
  }

  return {
    spreadsheetUrl: ss.getUrl(),
    message: 'ติดตั้งระบบสำเร็จ เข้าใช้งานด้วย EmployeeID: admin, PIN: 123456 แล้วเปลี่ยนรหัสผ่านทันที'
  };
}
