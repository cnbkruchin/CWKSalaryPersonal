/**
 * Payroll.gs — เครื่องมือสร้าง/แก้ไข/อนุมัติรอบจ่ายเงินเดือนรายเดือน (หลังบ้าน)
 * ทุกการแก้ไขทำภายใต้ LockService และบันทึก AuditLog
 */

function computeSSO_(baseSalary, hasSSO) {
  if (!hasSSO) return 0;
  var rate = parseFloat(getSetting_('SSORate', '0.05')) || 0.05;
  var cap = parseFloat(getSetting_('SSOWageCap', '15000')) || 15000;
  return Math.round(Math.min(Number(baseSalary) || 0, cap) * rate);
}

function computeCompFund_(baseSalary) {
  var rate = parseFloat(getSetting_('CompFundRate', '0')) || 0;
  return round2((Number(baseSalary) || 0) * rate);
}

function recalcLineTotals_(line) {
  var gross = round2(Number(line.BaseSalary) + Number(line.PositionAllowance) + Number(line.OnDutyPay) + Number(line.OtherIncome) + Number(line.BackPay));
  var totalDeduction = round2(Number(line.SSOEmployee) + Number(line.OtherDeductionTotal));
  line.GrossPay = gross;
  line.TotalDeduction = totalDeduction;
  line.NetPay = round2(gross - totalDeduction);
  return line;
}

/** อัตราเงินประจำตำแหน่งมักคงที่ทุกเดือน — ดึงค่าจากรอบจ่ายเดือนล่าสุดของพนักงานคนนี้มาเป็นค่าตั้งต้น */
function carryForwardIncome_(employeeId, beforeMonth) {
  var prior = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'EmployeeID', employeeId)
    .filter(function (r) { return compareMonthKey(r.Month, beforeMonth) < 0; })
    .sort(function (a, b) { return compareMonthKey(b.Month, a.Month); })[0];
  return prior ? { positionAllowance: Number(prior.PositionAllowance) || 0 } : { positionAllowance: 0 };
}

function sumDeductionsFor_(month, employeeId) {
  return findAll_(SHEET_NAMES.PAYROLL_DEDUCTIONS, 'Month', month)
    .filter(function (d) { return d.EmployeeID === employeeId; })
    .reduce(function (s, d) { return s + Number(d.Amount); }, 0);
}

function newRunLine_(emp, month) {
  var baseSalary = currentBaseSalaryOf_(emp.EmployeeID, month);
  var sso = computeSSO_(baseSalary, isTrue_(emp.HasSSO));
  var carried = carryForwardIncome_(emp.EmployeeID, month);
  var line = {
    Month: month, EmployeeID: emp.EmployeeID, BaseSalary: baseSalary,
    PositionAllowance: carried.positionAllowance, OnDutyPay: 0, OtherIncome: 0, OtherIncomeNote: '',
    BackPay: 0, BackPayNote: '',
    SSOEmployee: sso, SSOEmployer: sso, CompFundEmployer: computeCompFund_(baseSalary),
    OtherDeductionTotal: 0, Status: 'draft', PaidDate: '', UpdatedAt: nowIso(), UpdatedBy: ''
  };
  return recalcLineTotals_(line);
}

/**
 * ดึงรอบจ่ายของเดือนที่ระบุ ถ้ายังไม่มีให้สร้างแถว draft จากพนักงาน active ทั้งหมด
 * ถ้ามีแล้วและยังเป็นแบบร่าง จะเพิ่มลูกจ้างที่บรรจุใหม่ (ยังไม่มีในรอบ) ให้อัตโนมัติ
 */
function getOrCreatePayrollRun(token, month) {
  try {
    var session = requireAuth_(token, ['admin']);
    if (!isValidMonthKey(month)) return apiError('รูปแบบเดือนไม่ถูกต้อง');

    return withLock_(function () {
      var existing = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month);
      var isApproved = existing.length && existing.every(function (r) { return r.Status === 'approved'; });
      if (!isApproved) {
        var have = {};
        existing.forEach(function (r) { have[r.EmployeeID] = true; });
        var missing = readAll_(SHEET_NAMES.EMPLOYEES).filter(function (e) {
          return e.Status === 'active' && e.Role !== 'admin' && !have[e.EmployeeID];
        });
        if (missing.length) {
          appendRows_(SHEET_NAMES.PAYROLL_RUNS, missing.map(function (emp) { return newRunLine_(emp, month); }));
          audit_(session.employeeId, session.role, existing.length ? 'ADD_TO_RUN' : 'CREATE_RUN', month,
            missing.map(function (e) { return e.EmployeeID; }).join(', '));
          existing = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month);
        }
      }
      return apiOk(buildPayrollRunView_(month, existing));
    });
  } catch (e) {
    return apiError(e.message);
  }
}

function getPayrollRun(token, month) {
  try {
    requireAuth_(token, ['admin']);
    var rows = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month);
    if (!rows.length) return apiOk(null);
    return apiOk(buildPayrollRunView_(month, rows));
  } catch (e) {
    return apiError(e.message);
  }
}

function buildPayrollRunView_(month, rows) {
  var employeesById = {};
  readAll_(SHEET_NAMES.EMPLOYEES).forEach(function (e) { employeesById[e.EmployeeID] = e; });
  var deductions = findAll_(SHEET_NAMES.PAYROLL_DEDUCTIONS, 'Month', month);

  var lines = rows.map(function (r) {
    var emp = employeesById[r.EmployeeID] || {};
    return {
      employeeId: r.EmployeeID,
      fullName: fullNameOf_(emp),
      group: emp.Group || '',
      bankAccountNo: emp.BankAccountNo || '',
      bankName: emp.BankName || '',
      baseSalary: Number(r.BaseSalary),
      positionAllowance: Number(r.PositionAllowance),
      onDutyPay: Number(r.OnDutyPay),
      otherIncome: Number(r.OtherIncome),
      otherIncomeNote: r.OtherIncomeNote,
      backPay: Number(r.BackPay),
      backPayNote: r.BackPayNote,
      grossPay: Number(r.GrossPay),
      ssoEmployee: Number(r.SSOEmployee),
      ssoEmployer: Number(r.SSOEmployer),
      compFundEmployer: Number(r.CompFundEmployer),
      otherDeductionTotal: Number(r.OtherDeductionTotal),
      totalDeduction: Number(r.TotalDeduction),
      netPay: Number(r.NetPay),
      status: r.Status,
      deductions: deductions.filter(function (d) { return d.EmployeeID === r.EmployeeID; }).map(function (d) {
        return { deductionId: d.DeductionID, category: d.Category, label: d.Label, amount: Number(d.Amount) };
      }),
      pendingBackPay: pendingBackPaySummaryFor_(r.EmployeeID)
    };
  });

  lines.sort(function (a, b) { return String(a.employeeId).localeCompare(String(b.employeeId), 'en', { numeric: true }); });

  var keys = ['baseSalary', 'positionAllowance', 'onDutyPay', 'otherIncome', 'backPay', 'grossPay', 'ssoEmployee', 'ssoEmployer', 'compFundEmployer', 'otherDeductionTotal', 'totalDeduction', 'netPay'];
  var totals = {};
  keys.forEach(function (k) {
    totals[k] = round2(lines.reduce(function (s, l) { return s + l[k]; }, 0));
  });

  return {
    month: month,
    monthLabel: formatThaiMonthLong(month),
    status: rows.length && rows.every(function (r) { return r.Status === 'approved'; }) ? 'approved' : 'draft',
    lines: lines,
    totals: totals,
    totalsText: bahtText(totals.netPay)
  };
}

/** หาแถวรอบจ่ายของพนักงาน 1 คนที่ยังแก้ไขได้ (throw ถ้าไม่พบหรืออนุมัติแล้ว) */
function editableRunLine_(month, employeeId) {
  var run = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month).filter(function (r) { return r.EmployeeID === employeeId; })[0];
  if (!run) throw new Error('ไม่พบรายการนี้ในรอบจ่ายเดือนนี้');
  if (run.Status === 'approved') throw new Error('รอบจ่ายนี้อนุมัติแล้ว กรุณาเปิดรอบแก้ไขก่อน');
  return run;
}

/** คำนวณยอดรวมใหม่ของแถวจากค่าปัจจุบัน + patch แล้วบันทึก */
function saveRunLine_(run, patch, actorId) {
  var next = {
    BaseSalary: Number(run.BaseSalary), PositionAllowance: Number(run.PositionAllowance), OnDutyPay: Number(run.OnDutyPay),
    OtherIncome: Number(run.OtherIncome), BackPay: Number(run.BackPay), SSOEmployee: Number(run.SSOEmployee),
    OtherDeductionTotal: sumDeductionsFor_(run.Month, run.EmployeeID)
  };
  Object.keys(patch).forEach(function (k) { next[k] = patch[k]; });
  recalcLineTotals_(next);
  next.UpdatedAt = nowIso();
  if (actorId) next.UpdatedBy = actorId;
  updateRowByIndex_(SHEET_NAMES.PAYROLL_RUNS, run._row, next);
}

function nonNegative_(v, label) {
  var n = Number(v);
  if (v === '' || v === null || v === undefined) return 0;
  if (isNaN(n) || n < 0) throw new Error(label + 'ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
  return round2(n);
}

/** แก้ไขรายรับ/ตกเบิก/ค่าประกันสังคม (override) ของพนักงาน 1 คนในรอบจ่ายเดือนนี้ */
function updatePayrollLine(token, month, employeeId, patch) {
  try {
    var session = requireAuth_(token, ['admin']);
    var p = {};
    if (patch.positionAllowance !== undefined) p.PositionAllowance = nonNegative_(patch.positionAllowance, 'เงินประจำตำแหน่ง');
    if (patch.onDutyPay !== undefined) p.OnDutyPay = nonNegative_(patch.onDutyPay, 'ค่าขึ้นเวร');
    if (patch.otherIncome !== undefined) p.OtherIncome = nonNegative_(patch.otherIncome, 'รับอื่นๆ');
    if (patch.otherIncomeNote !== undefined) p.OtherIncomeNote = String(patch.otherIncomeNote);
    if (patch.backPay !== undefined) p.BackPay = nonNegative_(patch.backPay, 'ตกเบิก');
    if (patch.backPayNote !== undefined) p.BackPayNote = String(patch.backPayNote);
    if (patch.ssoEmployee !== undefined) {
      p.SSOEmployee = nonNegative_(patch.ssoEmployee, 'ประกันสังคม');
      p.SSOEmployer = p.SSOEmployee;
    }
    return withLock_(function () {
      var run = editableRunLine_(month, employeeId);
      saveRunLine_(run, p, session.employeeId);
      audit_(session.employeeId, session.role, 'EDIT_PAY_LINE', employeeId + ' @ ' + month, p);
      return apiOk(true);
    });
  } catch (e) {
    return apiError(e.message);
  }
}

/** ดึงยอดตกเบิกค้างจ่ายทั้งหมดของพนักงานคนนี้เข้ารอบจ่ายเดือนนี้ */
function applyPendingBackPay(token, month, employeeId) {
  try {
    var session = requireAuth_(token, ['admin']);
    return withLock_(function () {
      var run = editableRunLine_(month, employeeId);
      var pending = pendingBackPaySummaryFor_(employeeId);
      if (pending.count === 0) return apiError('ไม่มีรายการตกเบิกค้างจ่าย');
      saveRunLine_(run, {
        BackPay: round2(Number(run.BackPay) + pending.total),
        BackPayNote: run.BackPayNote ? (run.BackPayNote + '; ' + pending.note) : pending.note
      }, session.employeeId);
      markBackPayApplied_(employeeId, month);
      audit_(session.employeeId, session.role, 'APPLY_BACKPAY', employeeId + ' @ ' + month, String(pending.total));
      return apiOk({ appliedTotal: pending.total });
    });
  } catch (e) {
    return apiError(e.message);
  }
}

function addPayrollDeduction(token, month, employeeId, category, label, amount) {
  try {
    var session = requireAuth_(token, ['admin']);
    var value = Number(amount);
    if (!value || value <= 0) return apiError('จำนวนเงินไม่ถูกต้อง');
    if (['เงินยืม', 'เกษียณ', 'อื่นๆ'].indexOf(category) === -1) category = 'อื่นๆ';
    return withLock_(function () {
      var run = editableRunLine_(month, employeeId);
      appendRow_(SHEET_NAMES.PAYROLL_DEDUCTIONS, {
        DeductionID: newId('DD'), Month: month, EmployeeID: employeeId,
        Category: category, Label: label || '', Amount: round2(value)
      });
      saveRunLine_(run, {}, session.employeeId);
      audit_(session.employeeId, session.role, 'ADD_DEDUCTION', employeeId + ' @ ' + month, category + ' ' + (label || '') + ' ' + value);
      return apiOk(true);
    });
  } catch (e) {
    return apiError(e.message);
  }
}

function removePayrollDeduction(token, month, employeeId, deductionId) {
  try {
    var session = requireAuth_(token, ['admin']);
    return withLock_(function () {
      var run = editableRunLine_(month, employeeId);
      var row = findOne_(SHEET_NAMES.PAYROLL_DEDUCTIONS, 'DeductionID', deductionId);
      if (!row || row.EmployeeID !== employeeId || row.Month !== month) return apiError('ไม่พบรายการหักนี้');
      deleteRowByIndex_(SHEET_NAMES.PAYROLL_DEDUCTIONS, row._row);
      saveRunLine_(run, {}, session.employeeId);
      audit_(session.employeeId, session.role, 'REMOVE_DEDUCTION', employeeId + ' @ ' + month, row.Category + ' ' + row.Label + ' ' + row.Amount);
      return apiOk(true);
    });
  } catch (e) {
    return apiError(e.message);
  }
}

function approvePayrollRun(token, month) {
  try {
    var session = requireAuth_(token, ['admin']);
    return withLock_(function () {
      var rows = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month);
      if (!rows.length) return apiError('ยังไม่มีรอบจ่ายของเดือนนี้');
      var negative = rows.filter(function (r) { return Number(r.NetPay) < 0; });
      if (negative.length) {
        return apiError('มียอดสุทธิติดลบ ' + negative.length + ' ราย (' + negative.map(function (r) { return r.EmployeeID; }).join(', ') + ') กรุณาตรวจสอบก่อนอนุมัติ');
      }
      var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd');
      var total = 0;
      rows.forEach(function (r) {
        total += Number(r.NetPay);
        updateRowByIndex_(SHEET_NAMES.PAYROLL_RUNS, r._row, { Status: 'approved', PaidDate: today, UpdatedAt: nowIso(), UpdatedBy: session.employeeId });
      });
      audit_(session.employeeId, session.role, 'APPROVE_RUN', month, rows.length + ' คน รวมสุทธิ ' + round2(total));
      return apiOk(true);
    });
  } catch (e) {
    return apiError(e.message);
  }
}

function reopenPayrollRun(token, month, reason) {
  try {
    var session = requireAuth_(token, ['admin']);
    if (!reason || String(reason).trim().length < 3) return apiError('กรุณาระบุเหตุผลในการเปิดรอบแก้ไข');
    return withLock_(function () {
      var rows = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month);
      if (!rows.length) return apiError('ยังไม่มีรอบจ่ายของเดือนนี้');
      rows.forEach(function (r) {
        updateRowByIndex_(SHEET_NAMES.PAYROLL_RUNS, r._row, { Status: 'draft', UpdatedAt: nowIso(), UpdatedBy: session.employeeId });
      });
      audit_(session.employeeId, session.role, 'REOPEN_RUN', month, String(reason).trim());
      return apiOk(true);
    });
  } catch (e) {
    return apiError(e.message);
  }
}

function listPayrollMonths(token) {
  try {
    requireAuth_(token, ['admin']);
    var months = {};
    readAll_(SHEET_NAMES.PAYROLL_RUNS).forEach(function (r) {
      if (!months[r.Month] || r.Status === 'draft') months[r.Month] = r.Status;
    });
    var list = Object.keys(months).map(function (m) { return { month: m, monthLabel: formatThaiMonthLong(m), status: months[m] }; });
    list.sort(function (a, b) { return compareMonthKey(b.month, a.month); });
    return apiOk(list);
  } catch (e) {
    return apiError(e.message);
  }
}
