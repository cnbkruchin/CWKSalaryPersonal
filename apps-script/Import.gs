/**
 * Import.gs — นำเข้าข้อมูลการจ่ายเงินเดือนย้อนหลังจากไฟล์ Excel (หลังบ้าน)
 *
 * ฝั่ง client อ่านไฟล์ .xlsx ด้วย SheetJS แล้วส่งค่าในแต่ละชีตมาเป็นอาเรย์ 2 มิติ
 * ฝั่งนี้ตรวจหาแถวหัวตารางและจับคู่คอลัมน์อัตโนมัติ รองรับรูปแบบที่โรงเรียนใช้อยู่:
 *   - ชีต "เงินเดือน" (หลักฐานการจ่าย): หัวตาราง 2 แถว, ชื่อ-สกุลแยก 2 คอลัมน์, มีแถว "รวม" ปิดท้าย
 *   - ชีต "SlipSheet": หัวตาราง 1 แถว มีรหัสพนักงาน/คำนำหน้า/ชื่อ/นามสกุลแยกกัน
 * ขั้นตอน: previewPayrollImport (ตรวจก่อน ไม่บันทึก) → commitPayrollImport (บันทึกเป็นรอบจ่ายที่อนุมัติแล้ว พร้อมวันที่จ่าย)
 */

var IMPORT_RULES = [
  { re: /สุทธิตัวอักษร|pdf|url|ลายมือ|^ลำดับ$|^ที่$/i, field: null },
  { re: /รหัสพนักงาน|รหัสลูกจ้าง/, field: 'employeeId' },
  { re: /คำนำหน้า/, field: 'prefix' },
  { re: /^นามสกุล$|^สกุล$/, field: 'lastName' },
  { re: /ชื่อ-?สกุล|ชื่อ-?นามสกุล/, field: 'fullName' },
  { re: /ชื่อตำแหน่ง|^ตำแหน่ง$/, field: 'position' },
  { re: /^ชื่อ$/, field: 'firstName' },
  { re: /หมายเลขบัญชี|เลขที่บัญชี|เลขบัญชี/, field: 'bankAccount' },
  { re: /ประจำเดือน/, field: 'monthCell' },
  { re: /สมทบ.*(ปกส|ประกันสังคม)|นายจ้างสมทบ/, field: 'ssoEmployer' },
  { re: /สมทบ.*ทดแทน/, field: 'compFundEmployer' },
  { re: /ตกเบิก/, field: 'backPay' },
  { re: /ปรับฐาน/, field: 'baseAdjust' },
  { re: /เงินประจำตำแหน่ง|ค่าตำแหน่ง/, field: 'positionAllowance' },
  { re: /^ค่าขึ้นเวร$/, field: 'onDutyPay' },
  { re: /^เงินเดือน$/, field: 'baseSalary' },
  { re: /รวมรับ/, field: 'grossCheck' },
  { re: /รวมหัก/, field: 'deductionCheck' },
  { re: /^คงเหลือ|^สุทธิ|^จำนวนเงิน/, field: 'netCheck' },
  { re: /ประกันสังคม|ปกส/, field: 'ssoEmployee' },
  { re: /ทดแทน/, field: 'compFundEmployee' },
  { re: /รับอื่น|เพิ่มพิเศษ/, field: 'otherIncome', multi: true },
  { re: /หักอื่น|^อื่นๆ$/, field: 'otherDeduction', multi: true },
  { re: /หมายเหตุ/, field: 'note', multi: true }
];

var AMOUNT_FIELDS = ['baseSalary', 'baseAdjust', 'positionAllowance', 'onDutyPay', 'otherIncome', 'backPay', 'ssoEmployee',
  'compFundEmployee', 'otherDeduction', 'ssoEmployer', 'compFundEmployer', 'grossCheck', 'deductionCheck', 'netCheck'];

function cellText_(v) {
  return String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim();
}

function headerKey_(v) {
  return cellText_(v).replace(/\s+/g, '').replace(/[()（）*]/g, '');
}

function fieldForHeader_(h) {
  var key = headerKey_(h);
  if (!key) return undefined;
  for (var i = 0; i < IMPORT_RULES.length; i++) {
    if (IMPORT_RULES[i].re.test(key)) return IMPORT_RULES[i].field;
  }
  return undefined;
}

/** "12,050" / "-" / 12050 -> 12050 ; ข้อความที่ไม่ใช่ตัวเลขคืน null */
function parseAmount_(v) {
  if (typeof v === 'number') return v;
  var s = cellText_(v).replace(/,|บาท|฿|\s/g, '');
  if (s === '' || s === '-' || s === '–') return 0;
  var n = Number(s);
  return isNaN(n) ? null : n;
}

// สร้างตอนเรียกใช้ (ไม่สร้างตอนโหลดไฟล์) เพราะ Apps Script โหลดไฟล์ตามลำดับในโปรเจกต์ — THAI_MONTH_NAMES อยู่ใน Utils.gs
function thaiMonthRe_() {
  return new RegExp('(' + THAI_MONTH_NAMES.join('|') + ')\\s*(?:พ\\.?\\s*ศ\\.?)?\\s*(25\\d\\d|20\\d\\d)');
}

/** หาเดือนจากข้อความ เช่น "ประจำเดือนกันยายน 2569" หรือค่าวันที่ "2568-06-28" (ปี พ.ศ. ที่ถูกเก็บเป็น ค.ศ.) */
function monthFromText_(v) {
  var s = cellText_(v);
  var iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) {
    var y = parseInt(iso[1], 10);
    if (y > 2400) y -= 543;
    return y + '-' + iso[2];
  }
  var m = s.match(thaiMonthRe_());
  if (m) {
    var year = parseInt(m[2], 10);
    if (year > 2400) year -= 543;
    var mm = THAI_MONTH_NAMES.indexOf(m[1]) + 1;
    return year + '-' + (mm < 10 ? '0' : '') + mm;
  }
  return '';
}

var NAME_PREFIX_RES = [
  /^(ว่าที่\s*(?:[ก-ฮ]{1,3}\.\s*){1,3})/,
  /^(ว่าที่\s*ร้อย(?:ตรี|โท|เอก)(?:หญิง)?)/,
  /^(นางสาว|นาง|นาย|น\.ส\.|ดร\.|Mrs\.?|Mr\.?|Ms\.?|Miss|Dr\.?)\s*/i
];

/** แยกคำนำหน้าออกจากชื่อ "นางสาวกาญจนา" -> {prefix:"นางสาว", rest:"กาญจนา"} */
function splitPrefix_(text) {
  var s = cellText_(text);
  for (var i = 0; i < NAME_PREFIX_RES.length; i++) {
    var m = s.match(NAME_PREFIX_RES[i]);
    if (m && m[0].length < s.length) return { prefix: m[1].replace(/\s+/g, ''), rest: s.substring(m[0].length).trim() };
  }
  return { prefix: '', rest: s };
}

function normalizeName_(s) {
  return splitPrefix_(s).rest.replace(/[\s.]/g, '').toLowerCase();
}

function accountKey_(v) {
  return String(v === null || v === undefined ? '' : v).replace(/\D/g, '').replace(/^0+/, '');
}

/**
 * แปลงชีต (อาเรย์ 2 มิติ) เป็นรายการเงินเดือนรายคน
 * คืน { score, headerRow, columns, lines, monthGuess, problems }
 */
function parsePayrollSheet_(rows, sheetName) {
  var result = { score: 0, headerRow: -1, columns: [], lines: [], monthGuess: '', problems: [] };
  rows = rows || [];

  // 1) หาแถวหัวตาราง: แถวแรกใน 20 แถวบนสุดที่จับคู่คอลัมน์ได้ ≥ 3 และมีคอลัมน์ชื่อ
  var headerRow = -1;
  for (var r = 0; r < Math.min(rows.length, 20); r++) {
    var fields = (rows[r] || []).map(fieldForHeader_);
    var known = fields.filter(function (f) { return f; }).length;
    var hasName = fields.some(function (f) { return f === 'fullName' || f === 'firstName'; });
    if (known >= 3 && hasName) { headerRow = r; break; }
  }
  if (headerRow === -1) {
    result.problems.push('ไม่พบแถวหัวตาราง (ต้องมีคอลัมน์ชื่อ และคอลัมน์จำนวนเงิน เช่น เงินเดือน/คงเหลือ)');
    return result;
  }

  // 2) หัวตาราง 2 แถว (หัวกลุ่ม "รายรับ/รายจ่าย" + หัวย่อย) — รวมเป็นแถวเดียว
  var width = rows.slice(headerRow, headerRow + 2).reduce(function (w, row) { return Math.max(w, (row || []).length); }, 0);
  var headers = [];
  for (var c = 0; c < width; c++) headers.push(cellText_((rows[headerRow] || [])[c]));
  var dataStart = headerRow + 1;
  var next = rows[headerRow + 1] || [];
  if (next.map(fieldForHeader_).filter(function (f) { return f; }).length >= 2) {
    for (var c2 = 0; c2 < width; c2++) {
      if (cellText_(next[c2])) headers[c2] = cellText_(next[c2]);
    }
    dataStart = headerRow + 2;
  }

  // 3) จับคู่คอลัมน์ (ฟิลด์ทั่วไปใช้คอลัมน์แรกที่พบ, ฟิลด์ multi รวมหลายคอลัมน์ได้)
  var map = {};
  var multiRules = {};
  IMPORT_RULES.forEach(function (rule) { if (rule.field && rule.multi) multiRules[rule.field] = true; });
  headers.forEach(function (h, idx) {
    var f = fieldForHeader_(h);
    result.columns.push({ index: idx, header: h, field: f || '' });
    if (!f) return;
    if (multiRules[f]) (map[f] = map[f] || []).push(idx);
    else if (map[f] === undefined) map[f] = idx;
  });
  // "ชื่อ-สกุล" ที่ผสานเซลล์ 2 คอลัมน์ (คอลัมน์ขวาไม่มีหัว) = ชื่อ | นามสกุล
  if (map.fullName !== undefined && map.lastName === undefined && !headers[map.fullName + 1]) {
    map.lastNamePart = map.fullName + 1;
  }
  if (map.baseSalary === undefined && map.netCheck === undefined) {
    result.problems.push('ไม่พบคอลัมน์ "เงินเดือน" หรือ "คงเหลือ/สุทธิ"');
  }
  if (map.baseSalary === undefined) result.problems.push('ไม่พบคอลัมน์ "เงินเดือน" — ไฟล์นี้อาจเป็นรายงานสรุป ไม่ใช่ตารางจ่ายเงินเดือน');

  // 4) เดือน: จากคอลัมน์ "ประจำเดือน" > ข้อความหัวเอกสาร > ชื่อชีต
  for (var t = 0; t < headerRow && !result.monthGuess; t++) {
    (rows[t] || []).some(function (v) { result.monthGuess = monthFromText_(v); return !!result.monthGuess; });
  }
  if (!result.monthGuess) result.monthGuess = monthFromText_(sheetName);

  // 5) แถวข้อมูล จนถึงแถว "รวม"
  var get = function (row, key) { return map[key] === undefined ? undefined : row[map[key]]; };
  for (var i = dataStart; i < rows.length; i++) {
    var row = rows[i] || [];
    var firstCells = row.slice(0, 4).map(cellText_);
    if (firstCells.some(function (x) { return /^รวม/.test(x); })) break;

    var line = { rowNo: i + 1, warnings: [] };
    var full = cellText_(get(row, 'fullName'));
    var first = cellText_(get(row, 'firstName'));
    var last = cellText_(get(row, 'lastName')) || cellText_(get(row, 'lastNamePart'));
    var prefix = cellText_(get(row, 'prefix'));
    if (!first && full) {
      var sp = splitPrefix_(full);
      prefix = prefix || sp.prefix;
      first = sp.rest;
      if (!last && map.lastNamePart === undefined && first.indexOf(' ') > 0 && !/^[A-Za-z]/.test(first)) {
        last = first.substring(first.indexOf(' ') + 1).trim();
        first = first.substring(0, first.indexOf(' '));
      }
    } else if (first && !prefix) {
      var sp2 = splitPrefix_(first);
      prefix = sp2.prefix;
      first = sp2.rest;
    }
    if (!first) continue;

    var numericFound = false;
    AMOUNT_FIELDS.forEach(function (f) {
      var cols = map[f] === undefined ? [] : [].concat(map[f]);
      var total = null;
      cols.forEach(function (col) {
        var n = parseAmount_(row[col]);
        if (n === null) {
          if (cellText_(row[col])) line.warnings.push('ช่อง "' + headers[col] + '" ไม่ใช่ตัวเลข: ' + cellText_(row[col]));
          n = 0;
        }
        total = (total || 0) + n;
      });
      line[f] = total === null ? null : round2(total);
      if (total) numericFound = true;
    });
    if (!numericFound) continue; // แถวหัวกลุ่ม เช่น "ครูอัตราจ้าง"

    line.employeeId = cellText_(get(row, 'employeeId'));
    line.prefix = prefix;
    line.firstName = first;
    line.lastName = last;
    line.displayName = prefix + first + (last ? ' ' + last : '');
    var acc = get(row, 'bankAccount');
    line.bankAccount = String(acc === undefined || acc === null ? '' : acc).replace(/\D/g, '');
    if (typeof acc === 'number') line.warnings.push('เลขบัญชีในไฟล์เก็บเป็นตัวเลข เลข 0 นำหน้าอาจหายไป');
    line.position = cellText_(get(row, 'position'));
    line.note = (map.note || []).map(function (col) { return cellText_(row[col]).replace(/^[-–]\s*/, ''); }).filter(function (x) { return x; }).join(' · ');
    line.monthCell = map.monthCell === undefined ? '' : monthFromText_(row[map.monthCell]);
    if (line.monthCell && !result.monthGuess) result.monthGuess = line.monthCell;

    // ยอดที่ระบบคำนวณเอง เทียบกับยอดในไฟล์
    var base = line.baseSalary || 0;
    line.otherIncomeTotal = round2((line.otherIncome || 0) + (line.baseAdjust || 0));
    line.gross = round2(base + (line.positionAllowance || 0) + (line.onDutyPay || 0) + line.otherIncomeTotal + (line.backPay || 0));
    line.sso = line.ssoEmployee || 0;
    line.otherDeductionTotal = round2((line.otherDeduction || 0) + (line.compFundEmployee || 0));
    line.totalDeduction = round2(line.sso + line.otherDeductionTotal);
    line.net = round2(line.gross - line.totalDeduction);
    if (line.grossCheck !== null && line.grossCheck !== undefined && Math.abs(line.grossCheck - line.gross) > 0.5) {
      line.warnings.push('รวมรับในไฟล์ ' + line.grossCheck + ' ไม่ตรงกับผลรวมรายการ ' + line.gross);
    }
    if (line.netCheck !== null && line.netCheck !== undefined && Math.abs(line.netCheck - line.net) > 0.5) {
      line.warnings.push('คงเหลือในไฟล์ ' + line.netCheck + ' ไม่ตรงกับที่คำนวณได้ ' + line.net);
    }
    if (line.monthCell && result.monthGuess && line.monthCell !== result.monthGuess) {
      line.warnings.push('ประจำเดือนในแถวนี้ (' + line.monthCell + ') ต่างจากเดือนของไฟล์');
    }
    result.lines.push(line);
  }

  result.headerRow = headerRow + 1;
  result.score = Object.keys(map).length + (map.baseSalary !== undefined ? 5 : 0) + (map.netCheck !== undefined ? 3 : 0) + Math.min(result.lines.length, 10);
  if (!result.lines.length) result.problems.push('ไม่พบแถวข้อมูลลูกจ้าง');
  return result;
}

/**
 * จับคู่แถวในไฟล์กับทะเบียนลูกจ้าง: เลขบัญชี / ชื่อ ต้องสอดคล้องกันก่อนเชื่อรหัสพนักงานในไฟล์
 * (รหัสในไฟล์เก่าอาจเป็นของคนละคนกับทะเบียนปัจจุบัน) ถ้าขัดแย้งจะไม่จับคู่และเพิ่มคำเตือน
 */
function buildEmployeeMatcher_() {
  var emps = readAll_(SHEET_NAMES.EMPLOYEES).filter(function (e) { return e.Role !== 'admin'; });
  var byId = {}, byAcc = {}, byName = {}, byFirst = {};
  emps.forEach(function (e) {
    byId[String(e.EmployeeID).toLowerCase()] = e;
    var a = accountKey_(e.BankAccountNo);
    if (a) byAcc[a] = e;
    byName[normalizeName_((e.PrefixName || '') + e.FirstName + (e.LastName || ''))] = e;
    var f = normalizeName_((e.PrefixName || '') + e.FirstName);
    byFirst[f] = byFirst[f] ? 'ambiguous' : e;
  });
  var result = function (e, by) { return { employeeId: e.EmployeeID, by: by, name: fullNameOf_(e) }; };
  return function (line) {
    var acc = line.bankAccount ? byAcc[accountKey_(line.bankAccount)] : null;
    var full = byName[normalizeName_(line.prefix + line.firstName + line.lastName)];
    var first = byFirst[normalizeName_(line.prefix + line.firstName)];
    var idEmp = line.employeeId ? byId[line.employeeId.toLowerCase()] : null;
    if (idEmp) {
      var nameOk = normalizeName_((idEmp.PrefixName || '') + idEmp.FirstName) === normalizeName_(line.prefix + line.firstName);
      var accOk = acc === idEmp;
      if (nameOk || accOk) return result(idEmp, 'รหัสพนักงาน');
      line.warnings.push('รหัส ' + line.employeeId + ' ในทะเบียนเป็นของ ' + fullNameOf_(idEmp) + ' ไม่ใช่คนในแถวนี้');
    }
    var sameFirst = function (e) { return normalizeName_((e.PrefixName || '') + e.FirstName) === normalizeName_(line.prefix + line.firstName); };
    if (full) {
      if (line.bankAccount && full.BankAccountNo && accountKey_(full.BankAccountNo) !== accountKey_(line.bankAccount)) {
        line.warnings.push('เลขบัญชีในไฟล์ (' + line.bankAccount + ') ไม่ตรงกับทะเบียน (' + full.BankAccountNo + ')');
      }
      return result(full, 'ชื่อ-สกุล');
    }
    if (acc) {
      if (!sameFirst(acc)) line.warnings.push('เลขบัญชีตรงกับ ' + fullNameOf_(acc) + ' แต่ชื่อในไฟล์ต่างกัน กรุณาตรวจสอบ');
      return result(acc, 'เลขบัญชี');
    }
    if (first && first !== 'ambiguous') {
      line.warnings.push('จับคู่จากชื่อต้นเท่านั้น (นามสกุลต่างกัน) กรุณาตรวจสอบ');
      return result(first, 'ชื่อ');
    }
    return null;
  };
}

function pickSheet_(sheets, sheetIndex) {
  if (!sheets || !sheets.length) throw new Error('ไม่พบข้อมูลในไฟล์');
  var parsed = sheets.map(function (s) { return parsePayrollSheet_(s.rows, s.name); });
  var idx = (sheetIndex !== undefined && sheetIndex !== null && parsed[sheetIndex]) ? Number(sheetIndex)
    : parsed.reduce(function (best, p, i) { return p.score > parsed[best].score ? i : best; }, 0);
  return { index: idx, parsed: parsed[idx], names: sheets.map(function (s) { return s.name; }) };
}

/** ขั้นที่ 1: ตรวจไฟล์และแสดงตัวอย่าง (ยังไม่บันทึกอะไร) */
function previewPayrollImport(token, payload) {
  try {
    requireAuth_(token, ['admin']);
    var pick = pickSheet_(payload.sheets, payload.sheetIndex);
    var p = pick.parsed;
    var month = isValidMonthKey(payload.month) ? payload.month : p.monthGuess;
    var match = buildEmployeeMatcher_();
    var lines = p.lines.map(function (l) { l.match = match(l); return l; });
    var existing = month ? findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month) : [];
    var totals = { gross: 0, sso: 0, otherDeduction: 0, net: 0 };
    lines.forEach(function (l) { totals.gross += l.gross; totals.sso += l.sso; totals.otherDeduction += l.otherDeductionTotal; totals.net += l.net; });
    Object.keys(totals).forEach(function (k) { totals[k] = round2(totals[k]); });
    return apiOk({
      sheetNames: pick.names,
      sheetIndex: pick.index,
      headerRow: p.headerRow,
      columns: p.columns.filter(function (c) { return c.header; }),
      problems: p.problems,
      month: month,
      monthLabel: month ? formatThaiMonthLong(month) : '',
      defaultPaidDate: month ? defaultPaidDate_(month, getSetting_('DefaultPayDay', 'last-workday')) : '',
      existingRun: existing.length ? { count: existing.length, status: existing.every(function (r) { return r.Status === 'approved'; }) ? 'approved' : 'draft' } : null,
      lines: lines,
      totals: totals,
      totalsText: bahtText(totals.net),
      nextEmployeeId: nextEmployeeId_(),
      employees: readAll_(SHEET_NAMES.EMPLOYEES).filter(function (e) { return e.Role !== 'admin'; })
        .map(function (e) { return { employeeId: e.EmployeeID, fullName: fullNameOf_(e), status: e.Status }; })
    });
  } catch (e) {
    return apiError(e.message);
  }
}

function nextEmployeeId_(extraTaken) {
  var max = 0;
  readAll_(SHEET_NAMES.EMPLOYEES).map(function (e) { return String(e.EmployeeID); }).concat(extraTaken || []).forEach(function (id) {
    var m = id.match(/^cwk(\d+)$/i);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  var n = String(max + 1);
  while (n.length < 3) n = '0' + n;
  return 'Cwk' + n;
}

/**
 * ขั้นที่ 2: บันทึกเป็นรอบจ่ายที่อนุมัติแล้ว
 * payload: { sheets, sheetIndex, fileName, month, paidDate, assignments: {rowNo: employeeId|'__new__'|'__skip__'}, replace, newEmployeeStatus }
 */
function commitPayrollImport(token, payload) {
  try {
    var session = requireAuth_(token, ['admin']);
    var month = payload.month;
    var paidDate = payload.paidDate;
    if (!isValidMonthKey(month)) return apiError('กรุณาระบุเดือนของข้อมูล (YYYY-MM)');
    if (!isValidDateKey(paidDate)) return apiError('กรุณาระบุวันที่จ่ายเงินเดือน');
    var pick = pickSheet_(payload.sheets, payload.sheetIndex);
    var p = pick.parsed;
    if (!p.lines.length) return apiError(p.problems.join(' / ') || 'ไม่พบข้อมูลที่นำเข้าได้');
    var assignments = payload.assignments || {};
    var newStatus = payload.newEmployeeStatus === 'inactive' ? 'inactive' : 'active';
    var source = 'นำเข้า: ' + String(payload.fileName || 'ไฟล์ Excel').substring(0, 80) + ' / ' + pick.names[pick.index];

    return withLock_(function () {
      var match = buildEmployeeMatcher_();
      var plan = [];
      var used = {};
      for (var i = 0; i < p.lines.length; i++) {
        var l = p.lines[i];
        var auto = match(l);
        var target = assignments[l.rowNo] || (auto ? auto.employeeId : '');
        if (target === '__skip__') continue;
        if (!target) return apiError('แถวที่ ' + l.rowNo + ' (' + l.displayName + ') ยังไม่ได้เลือกลูกจ้าง หรือเลือก "สร้างใหม่"/"ข้าม"');
        if (target !== '__new__') {
          if (!getEmployee_(target)) return apiError('แถวที่ ' + l.rowNo + ': ไม่พบรหัสพนักงาน ' + target);
          if (used[target]) return apiError('ลูกจ้าง ' + target + ' ถูกเลือกซ้ำในแถวที่ ' + used[target] + ' และ ' + l.rowNo);
          used[target] = l.rowNo;
        }
        plan.push({ line: l, target: target });
      }
      if (!plan.length) return apiError('ไม่มีแถวที่จะนำเข้า');

      var existing = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month);
      if (existing.length && !payload.replace) {
        return apiError('มีรอบจ่ายของ ' + formatThaiMonthLong(month) + ' อยู่แล้ว ' + existing.length + ' รายการ — เลือก "แทนที่ข้อมูลเดิม" หากต้องการนำเข้าทับ');
      }
      if (existing.length) {
        var dRows = findAll_(SHEET_NAMES.PAYROLL_DEDUCTIONS, 'Month', month).map(function (d) { return d._row; });
        dRows.sort(function (a, b) { return b - a; }).forEach(function (r) { deleteRowByIndex_(SHEET_NAMES.PAYROLL_DEDUCTIONS, r); });
        existing.map(function (r) { return r._row; }).sort(function (a, b) { return b - a; })
          .forEach(function (r) { deleteRowByIndex_(SHEET_NAMES.PAYROLL_RUNS, r); });
      }

      // สร้างลูกจ้างใหม่จากไฟล์
      var created = [];
      var takenIds = [];
      plan.forEach(function (item) {
        if (item.target !== '__new__') return;
        var l = item.line;
        var id = (l.employeeId && /^[A-Za-z0-9_-]{2,20}$/.test(l.employeeId) && !getEmployee_(l.employeeId) && takenIds.indexOf(l.employeeId) === -1)
          ? l.employeeId : nextEmployeeId_(takenIds);
        takenIds.push(id);
        var pin = randomDigits_(6);
        var salt = Utilities.getUuid();
        appendRow_(SHEET_NAMES.EMPLOYEES, {
          EmployeeID: id, PrefixName: l.prefix, FirstName: l.firstName, LastName: l.lastName, Position: l.position,
          Status: newStatus, HasSSO: l.sso > 0, BankAccountNo: l.bankAccount, Role: 'employee',
          PinHash: hashPin_(pin, salt), PinSalt: salt, MustChangePin: true, CreatedAt: nowIso(), Note: l.note,
          EmploymentType: l.sso > 0 ? 'ลูกจ้าง มี ปกส.' : ''
        });
        created.push({ employeeId: id, name: l.displayName, pin: pin, rowNo: l.rowNo });
        item.target = id;
      });

      // รอบจ่าย + รายการหัก + ประวัติเงินเดือน
      var runRows = [];
      var dedRows = [];
      var filled = [];
      plan.forEach(function (item) {
        var l = item.line;
        var emp = getEmployee_(item.target);
        var line = {
          Month: month, EmployeeID: item.target, BaseSalary: l.baseSalary || 0,
          PositionAllowance: l.positionAllowance || 0, OnDutyPay: l.onDutyPay || 0,
          OtherIncome: l.otherIncomeTotal, OtherIncomeNote: l.baseAdjust ? ('ปรับฐาน ' + l.baseAdjust) : '',
          BackPay: l.backPay || 0, BackPayNote: l.backPay ? 'ตกเบิก (นำเข้า)' : '',
          SSOEmployee: l.sso, SSOEmployer: l.ssoEmployer === null || l.ssoEmployer === undefined ? l.sso : l.ssoEmployer,
          CompFundEmployer: l.compFundEmployer || 0, OtherDeductionTotal: l.otherDeductionTotal,
          Status: 'approved', PaidDate: paidDate, UpdatedAt: nowIso(), UpdatedBy: session.employeeId,
          Note: l.note, Source: source
        };
        runRows.push(recalcLineTotals_(line));
        if (l.otherDeduction) dedRows.push({ DeductionID: newId('DD'), Month: month, EmployeeID: item.target, Category: 'อื่นๆ', Label: 'หักอื่นๆ (นำเข้า)', Amount: l.otherDeduction });
        if (l.compFundEmployee) dedRows.push({ DeductionID: newId('DD'), Month: month, EmployeeID: item.target, Category: 'อื่นๆ', Label: 'กองทุนเงินทดแทน', Amount: l.compFundEmployee });

        if (l.baseSalary && currentBaseSalaryOf_(item.target, month) !== l.baseSalary) {
          appendRow_(SHEET_NAMES.SALARY_HISTORY, {
            HistoryID: newId('SH'), EmployeeID: item.target, EffectiveMonth: month, BaseSalary: l.baseSalary,
            ChangeType: 'นำเข้าข้อมูลย้อนหลัง', ApprovedDate: nowIso(), ApprovedBy: session.employeeId,
            Note: source, CreatedAt: nowIso()
          });
        }
        // เติมข้อมูลทะเบียนที่ยังว่าง (ไม่เขียนทับของเดิม)
        var patch = {};
        if (!emp.BankAccountNo && l.bankAccount) patch.BankAccountNo = l.bankAccount;
        if (!emp.Position && l.position) patch.Position = l.position;
        if (Object.keys(patch).length) {
          updateRowByIndex_(SHEET_NAMES.EMPLOYEES, emp._row, patch);
          filled.push(item.target);
        }
      });
      appendRows_(SHEET_NAMES.PAYROLL_RUNS, runRows);
      appendRows_(SHEET_NAMES.PAYROLL_DEDUCTIONS, dedRows);

      var totalNet = round2(runRows.reduce(function (s, r) { return s + r.NetPay; }, 0));
      audit_(session.employeeId, session.role, 'IMPORT_PAYROLL', month,
        runRows.length + ' คน สุทธิ ' + totalNet + ' จ่าย ' + paidDate + (existing.length ? ' (แทนที่ข้อมูลเดิม)' : '') +
        (created.length ? ' สร้างลูกจ้างใหม่ ' + created.map(function (c) { return c.employeeId; }).join(', ') : '') + ' — ' + source);
      return apiOk({
        month: month, monthLabel: formatThaiMonthLong(month), imported: runRows.length,
        skipped: p.lines.length - plan.length, totalNet: totalNet, created: created, filledEmployees: filled
      });
    });
  } catch (e) {
    return apiError(e.message);
  }
}
