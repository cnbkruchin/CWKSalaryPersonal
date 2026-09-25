/**
 * Payroll.gs — เครื่องมือสร้าง/แก้ไข/อนุมัติรอบจ่ายเงินเดือนรายเดือน
 */

function computeSSO_(baseSalary, hasSSO) {
  if (!hasSSO) return 0;
  var rate = parseFloat(getSetting_('SSORate', '0.05')) || 0.05;
  var cap = parseFloat(getSetting_('SSOWageCap', '15000')) || 15000;
  return Math.round(Math.min(Number(baseSalary) || 0, cap) * rate);
}

function computeCompFund_(baseSalary) {
  var rate = parseFloat(getSetting_('CompFundRate', '0.002')) || 0;
  return round2((Number(baseSalary) || 0) * rate);
}

function recalcLineTotals_(line) {
  var gross = round2(Number(line.BaseSalary) + Number(line.Allowance) + Number(line.BackPay));
  var totalDeduction = round2(Number(line.SSOEmployee) + Number(line.OtherDeductionTotal));
  var net = round2(gross - totalDeduction);
  line.GrossPay = gross;
  line.TotalDeduction = totalDeduction;
  line.NetPay = net;
  return line;
}

function sumDeductionsFor_(month, employeeId) {
  return findAll_(SHEET_NAMES.PAYROLL_DEDUCTIONS, 'Month', month)
    .filter(function (d) { return d.EmployeeID === employeeId; })
    .reduce(function (s, d) { return s + Number(d.Amount); }, 0);
}

/** ดึงรอบจ่ายของเดือนที่ระบุ ถ้ายังไม่มีให้สร้างแถว draft จากพนักงาน active ทั้งหมด */
function getOrCreatePayrollRun(token, month) {
  try {
    requireAuth_(token, ['admin']);
    if (!isValidMonthKey(month)) return apiError('รูปแบบเดือนไม่ถูกต้อง');

    var existing = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month);
    if (existing.length === 0) {
      var employees = readAll_(SHEET_NAMES.EMPLOYEES).filter(function (e) { return e.Status === 'active'; });
      var newRows = employees.map(function (emp) {
        var baseSalary = currentBaseSalaryOf_(emp.EmployeeID, month);
        var hasSSO = emp.HasSSO === true || emp.HasSSO === 'TRUE';
        var sso = computeSSO_(baseSalary, hasSSO);
        var line = {
          Month: month, EmployeeID: emp.EmployeeID, BaseSalary: baseSalary,
          Allowance: 0, AllowanceNote: '', BackPay: 0, BackPayNote: '',
          SSOEmployee: sso, SSOEmployer: sso, CompFundEmployer: computeCompFund_(baseSalary),
          OtherDeductionTotal: 0, Status: 'draft', PaidDate: '', UpdatedAt: nowIso(), UpdatedBy: ''
        };
        recalcLineTotals_(line);
        return line;
      });
      appendRows_(SHEET_NAMES.PAYROLL_RUNS, newRows);
      existing = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month);
    }

    return apiOk(buildPayrollRunView_(month, existing));
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
    var pending = pendingBackPaySummaryFor_(r.EmployeeID);
    return {
      employeeId: r.EmployeeID,
      fullName: (emp.PrefixName || '') + (emp.FirstName || '') + ' ' + (emp.LastName || ''),
      group: emp.Group || '',
      bankAccountNo: emp.BankAccountNo || '',
      bankName: emp.BankName || '',
      baseSalary: Number(r.BaseSalary),
      allowance: Number(r.Allowance),
      allowanceNote: r.AllowanceNote,
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
      pendingBackPay: pending
    };
  });

  lines.sort(function (a, b) { return a.fullName.localeCompare(b.fullName, 'th'); });

  var totals = lines.reduce(function (acc, l) {
    acc.baseSalary += l.baseSalary; acc.allowance += l.allowance; acc.backPay += l.backPay;
    acc.grossPay += l.grossPay; acc.ssoEmployee += l.ssoEmployee; acc.ssoEmployer += l.ssoEmployer;
    acc.compFundEmployer += l.compFundEmployer; acc.otherDeductionTotal += l.otherDeductionTotal;
    acc.totalDeduction += l.totalDeduction; acc.netPay += l.netPay;
    return acc;
  }, { baseSalary: 0, allowance: 0, backPay: 0, grossPay: 0, ssoEmployee: 0, ssoEmployer: 0, compFundEmployer: 0, otherDeductionTotal: 0, totalDeduction: 0, netPay: 0 });
  Object.keys(totals).forEach(function (k) { totals[k] = round2(totals[k]); });

  return {
    month: month,
    monthLabel: formatThaiMonthLong(month),
    status: rows.length && rows.every(function (r) { return r.Status === 'approved'; }) ? 'approved' : 'draft',
    lines: lines,
    totals: totals,
    totalsText: bahtText(totals.grossPay)
  };
}

/** แก้ไขรายการเงินเพิ่มพิเศษ / ตกเบิกด้วยมือ / ค่าประกันสังคม (override) ของพนักงาน 1 คนในรอบจ่ายเดือนนี้ */
function updatePayrollLine(token, month, employeeId, patch) {
  try {
    var session = requireAuth_(token, ['admin']);
    var run = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month).filter(function (r) { return r.EmployeeID === employeeId; })[0];
    if (!run) return apiError('ไม่พบรายการนี้ในรอบจ่ายเดือนนี้');
    if (run.Status === 'approved') return apiError('รอบจ่ายนี้อนุมัติแล้ว กรุณาเปิดรอบใหม่ก่อนแก้ไข');

    var next = {
      BaseSalary: patch.baseSalary !== undefined ? Number(patch.baseSalary) : Number(run.BaseSalary),
      Allowance: patch.allowance !== undefined ? Number(patch.allowance) : Number(run.Allowance),
      AllowanceNote: patch.allowanceNote !== undefined ? patch.allowanceNote : run.AllowanceNote,
      BackPay: patch.backPay !== undefined ? Number(patch.backPay) : Number(run.BackPay),
      BackPayNote: patch.backPayNote !== undefined ? patch.backPayNote : run.BackPayNote,
      SSOEmployee: patch.ssoEmployee !== undefined ? Number(patch.ssoEmployee) : Number(run.SSOEmployee),
      SSOEmployer: patch.ssoEmployee !== undefined ? Number(patch.ssoEmployee) : Number(run.SSOEmployer),
      CompFundEmployer: patch.compFundEmployer !== undefined ? Number(patch.compFundEmployer) : Number(run.CompFundEmployer),
      OtherDeductionTotal: sumDeductionsFor_(month, employeeId)
    };
    recalcLineTotals_(next);
    next.UpdatedAt = nowIso();
    next.UpdatedBy = session.employeeId;
    updateRowByIndex_(SHEET_NAMES.PAYROLL_RUNS, run._row, next);
    return apiOk(true);
  } catch (e) {
    return apiError(e.message);
  }
}

/** ดึงยอดตกเบิกค้างจ่ายทั้งหมดของพนักงานคนนี้เข้ารอบจ่ายเดือนนี้ */
function applyPendingBackPay(token, month, employeeId) {
  try {
    requireAuth_(token, ['admin']);
    var run = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month).filter(function (r) { return r.EmployeeID === employeeId; })[0];
    if (!run) return apiError('ไม่พบรายการนี้ในรอบจ่ายเดือนนี้');
    if (run.Status === 'approved') return apiError('รอบจ่ายนี้อนุมัติแล้ว กรุณาเปิดรอบใหม่ก่อนแก้ไข');

    var pending = pendingBackPaySummaryFor_(employeeId);
    if (pending.count === 0) return apiError('ไม่มีรายการตกเบิกค้างจ่าย');

    var next = {
      BackPay: round2(Number(run.BackPay) + pending.total),
      BackPayNote: run.BackPayNote ? (run.BackPayNote + '; ' + pending.note) : pending.note,
      OtherDeductionTotal: sumDeductionsFor_(month, employeeId)
    };
    Object.assign(next, {
      BaseSalary: Number(run.BaseSalary), Allowance: Number(run.Allowance),
      SSOEmployee: Number(run.SSOEmployee)
    });
    recalcLineTotals_(next);
    next.UpdatedAt = nowIso();
    updateRowByIndex_(SHEET_NAMES.PAYROLL_RUNS, run._row, next);
    markBackPayApplied_(employeeId, month);
    return apiOk({ appliedTotal: pending.total });
  } catch (e) {
    return apiError(e.message);
  }
}

function addPayrollDeduction(token, month, employeeId, category, label, amount) {
  try {
    requireAuth_(token, ['admin']);
    var run = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month).filter(function (r) { return r.EmployeeID === employeeId; })[0];
    if (!run) return apiError('ไม่พบรายการนี้ในรอบจ่ายเดือนนี้');
    if (run.Status === 'approved') return apiError('รอบจ่ายนี้อนุมัติแล้ว กรุณาเปิดรอบใหม่ก่อนแก้ไข');
    if (!amount || Number(amount) <= 0) return apiError('จำนวนเงินไม่ถูกต้อง');

    appendRow_(SHEET_NAMES.PAYROLL_DEDUCTIONS, {
      DeductionID: newId('DD'), Month: month, EmployeeID: employeeId,
      Category: category || 'อื่นๆ', Label: label || '', Amount: Number(amount)
    });

    var next = {
      OtherDeductionTotal: sumDeductionsFor_(month, employeeId),
      BaseSalary: Number(run.BaseSalary), Allowance: Number(run.Allowance), BackPay: Number(run.BackPay),
      SSOEmployee: Number(run.SSOEmployee)
    };
    recalcLineTotals_(next);
    next.UpdatedAt = nowIso();
    updateRowByIndex_(SHEET_NAMES.PAYROLL_RUNS, run._row, next);
    return apiOk(true);
  } catch (e) {
    return apiError(e.message);
  }
}

function removePayrollDeduction(token, month, employeeId, deductionId) {
  try {
    requireAuth_(token, ['admin']);
    var run = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month).filter(function (r) { return r.EmployeeID === employeeId; })[0];
    if (!run) return apiError('ไม่พบรายการนี้ในรอบจ่ายเดือนนี้');
    if (run.Status === 'approved') return apiError('รอบจ่ายนี้อนุมัติแล้ว กรุณาเปิดรอบใหม่ก่อนแก้ไข');

    var row = findOne_(SHEET_NAMES.PAYROLL_DEDUCTIONS, 'DeductionID', deductionId);
    if (row) deleteRowByIndex_(SHEET_NAMES.PAYROLL_DEDUCTIONS, row._row);

    var next = {
      OtherDeductionTotal: sumDeductionsFor_(month, employeeId),
      BaseSalary: Number(run.BaseSalary), Allowance: Number(run.Allowance), BackPay: Number(run.BackPay),
      SSOEmployee: Number(run.SSOEmployee)
    };
    recalcLineTotals_(next);
    next.UpdatedAt = nowIso();
    updateRowByIndex_(SHEET_NAMES.PAYROLL_RUNS, run._row, next);
    return apiOk(true);
  } catch (e) {
    return apiError(e.message);
  }
}

function approvePayrollRun(token, month) {
  try {
    var session = requireAuth_(token, ['admin']);
    var rows = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month);
    if (!rows.length) return apiError('ยังไม่มีรอบจ่ายของเดือนนี้');
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd');
    rows.forEach(function (r) {
      updateRowByIndex_(SHEET_NAMES.PAYROLL_RUNS, r._row, { Status: 'approved', PaidDate: today, UpdatedAt: nowIso(), UpdatedBy: session.employeeId });
    });
    return apiOk(true);
  } catch (e) {
    return apiError(e.message);
  }
}

function reopenPayrollRun(token, month) {
  try {
    requireAuth_(token, ['admin']);
    var rows = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month);
    if (!rows.length) return apiError('ยังไม่มีรอบจ่ายของเดือนนี้');
    rows.forEach(function (r) {
      updateRowByIndex_(SHEET_NAMES.PAYROLL_RUNS, r._row, { Status: 'draft', UpdatedAt: nowIso() });
    });
    return apiOk(true);
  } catch (e) {
    return apiError(e.message);
  }
}

function listPayrollMonths(token) {
  try {
    requireAuth_(token, ['admin']);
    var rows = readAll_(SHEET_NAMES.PAYROLL_RUNS);
    var months = {};
    rows.forEach(function (r) { months[r.Month] = months[r.Month] || r.Status; if (r.Status === 'draft') months[r.Month] = 'draft'; });
    var list = Object.keys(months).map(function (m) { return { month: m, monthLabel: formatThaiMonthLong(m), status: months[m] }; });
    list.sort(function (a, b) { return compareMonthKey(b.month, a.month); });
    return apiOk(list);
  } catch (e) {
    return apiError(e.message);
  }
}
