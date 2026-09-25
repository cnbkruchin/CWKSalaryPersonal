/**
 * Reports.gs — รายงานสรุป (บันทึกข้อความขออนุมัติ, ใบโอนเงินธนาคาร) และข้อมูลสลิปเงินเดือนรายบุคคล
 */

var DEDUCTION_CATEGORY_LABEL = {
  'เงินยืม': 'หักคืนเงินยืม',
  'เกษียณ': 'ค่างานเลี้ยงเกษียณ',
  'อื่นๆ': 'รายการหักอื่นๆ'
};

function getBankTransferList(token, month) {
  try {
    requireAuth_(token, ['admin']);
    var rows = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month);
    if (!rows.length) return apiError('ยังไม่มีรอบจ่ายของเดือนนี้');
    var employeesById = {};
    readAll_(SHEET_NAMES.EMPLOYEES).forEach(function (e) { employeesById[e.EmployeeID] = e; });

    var list = rows.map(function (r) {
      var emp = employeesById[r.EmployeeID] || {};
      return {
        fullName: (emp.PrefixName || '') + (emp.FirstName || '') + ' ' + (emp.LastName || ''),
        bankName: emp.BankName || '', bankAccountNo: emp.BankAccountNo || '', netPay: Number(r.NetPay)
      };
    }).sort(function (a, b) { return a.fullName.localeCompare(b.fullName, 'th'); });

    var total = round2(list.reduce(function (s, x) { return s + x.netPay; }, 0));
    var settings = getSettings_();
    return apiOk({
      month: month, monthLabel: formatThaiMonthLong(month),
      schoolName: settings.SchoolName, list: list, total: total, totalText: bahtText(total)
    });
  } catch (e) {
    return apiError(e.message);
  }
}

function getApprovalMemo(token, month) {
  try {
    requireAuth_(token, ['admin']);
    var rows = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month);
    if (!rows.length) return apiError('ยังไม่มีรอบจ่ายของเดือนนี้');
    var deductions = findAll_(SHEET_NAMES.PAYROLL_DEDUCTIONS, 'Month', month);
    var settings = getSettings_();

    var totalBaseSalary = 0, totalAllowance = 0, totalBackPay = 0, totalSSOEmployee = 0, totalSSOEmployer = 0, totalCompFundEmployer = 0;
    rows.forEach(function (r) {
      totalBaseSalary += Number(r.BaseSalary);
      totalAllowance += Number(r.Allowance);
      totalBackPay += Number(r.BackPay);
      totalSSOEmployee += Number(r.SSOEmployee);
      totalSSOEmployer += Number(r.SSOEmployer);
      totalCompFundEmployer += Number(r.CompFundEmployer);
    });
    var totalNetPay = round2(rows.reduce(function (s, r) { return s + Number(r.NetPay); }, 0));

    var categorySums = {};
    deductions.forEach(function (d) {
      categorySums[d.Category] = (categorySums[d.Category] || 0) + Number(d.Amount);
    });

    var lines = [];
    lines.push({
      no: 1,
      description: 'ค่าจ้างลูกจ้างชั่วคราว เดือน' + formatThaiMonthLong(month),
      amount: totalNetPay,
      note: 'โอนผ่านธนาคาร'
    });

    var ssoCashAmount = round2(totalSSOEmployee + totalSSOEmployer + (categorySums['เงินยืม'] || 0));
    lines.push({
      no: 2,
      description: 'ค่าประกันสังคม',
      amount: ssoCashAmount,
      note: 'เบิกเงินสด'
    });

    var lineNo = 3;
    Object.keys(categorySums).forEach(function (cat) {
      if (cat === 'เงินยืม') return; // รวมอยู่ในรายการที่ 2 แล้ว
      if (categorySums[cat] <= 0) return;
      lines.push({
        no: lineNo++,
        description: DEDUCTION_CATEGORY_LABEL[cat] || cat,
        amount: round2(categorySums[cat]),
        note: 'เบิกเงินสด'
      });
    });

    var grandTotal = round2(lines.reduce(function (s, l) { return s + l.amount; }, 0));

    return apiOk({
      month: month,
      monthLabel: formatThaiMonthLong(month),
      schoolName: settings.SchoolName,
      schoolAddress: settings.SchoolAddress,
      lines: lines,
      grandTotal: grandTotal,
      grandTotalText: bahtText(grandTotal),
      breakdown: {
        totalBaseSalary: round2(totalBaseSalary),
        totalAllowance: round2(totalAllowance),
        totalBackPay: round2(totalBackPay),
        totalGrossIncome: round2(totalBaseSalary + totalAllowance + totalBackPay),
        totalSSOEmployee: round2(totalSSOEmployee),
        totalSSOEmployer: round2(totalSSOEmployer),
        totalCompFundEmployer: round2(totalCompFundEmployer),
        totalNetPay: totalNetPay,
        categorySums: categorySums
      },
      signers: {
        financeOfficerName: settings.FinanceOfficerName, financeOfficerTitle: settings.FinanceOfficerTitle,
        budgetHeadName: settings.BudgetHeadName, budgetHeadTitle: settings.BudgetHeadTitle,
        deputyDirectorName: settings.DeputyDirectorName, deputyDirectorTitle: settings.DeputyDirectorTitle,
        directorName: settings.DirectorName, directorTitle: settings.DirectorTitle
      }
    });
  } catch (e) {
    return apiError(e.message);
  }
}

function buildPayslip_(month, run, emp, deductions) {
  var settings = getSettings_();
  return {
    month: month,
    monthLabel: formatThaiMonthLong(month),
    schoolName: settings.SchoolName,
    schoolAddress: settings.SchoolAddress,
    employeeId: emp.EmployeeID,
    fullName: (emp.PrefixName || '') + (emp.FirstName || '') + ' ' + (emp.LastName || ''),
    group: emp.Group || '',
    position: emp.Position || '',
    bankName: emp.BankName || '',
    bankAccountNo: emp.BankAccountNo || '',
    baseSalary: Number(run.BaseSalary),
    allowance: Number(run.Allowance),
    allowanceNote: run.AllowanceNote || '',
    backPay: Number(run.BackPay),
    backPayNote: run.BackPayNote || '',
    grossPay: Number(run.GrossPay),
    ssoEmployee: Number(run.SSOEmployee),
    otherDeductions: deductions.map(function (d) { return { label: (DEDUCTION_CATEGORY_LABEL[d.Category] || d.Category) + (d.Label ? (' - ' + d.Label) : ''), amount: Number(d.Amount) }; }),
    totalDeduction: Number(run.TotalDeduction),
    netPay: Number(run.NetPay),
    netPayText: bahtText(Number(run.NetPay)),
    status: run.Status
  };
}

/** ใช้โดยแอดมิน: ดึงสลิปทุกคนของเดือนที่ระบุ สำหรับพิมพ์รวม (A5 แนวนอน) */
function getPayslipsForPrint(token, month) {
  try {
    requireAuth_(token, ['admin']);
    var rows = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month);
    if (!rows.length) return apiError('ยังไม่มีรอบจ่ายของเดือนนี้');
    var employeesById = {};
    readAll_(SHEET_NAMES.EMPLOYEES).forEach(function (e) { employeesById[e.EmployeeID] = e; });
    var deductions = findAll_(SHEET_NAMES.PAYROLL_DEDUCTIONS, 'Month', month);

    var slips = rows.map(function (r) {
      var emp = employeesById[r.EmployeeID] || { EmployeeID: r.EmployeeID, FirstName: '(ไม่พบข้อมูล)' };
      var myDeductions = deductions.filter(function (d) { return d.EmployeeID === r.EmployeeID; });
      return buildPayslip_(month, r, emp, myDeductions);
    }).sort(function (a, b) { return a.fullName.localeCompare(b.fullName, 'th'); });

    return apiOk(slips);
  } catch (e) {
    return apiError(e.message);
  }
}

/** ใช้โดยพนักงาน: ดูสลิปของตัวเองในเดือนที่เลือก (ต้องเป็นรอบที่อนุมัติแล้วเท่านั้น) */
function getMyPayslip(token, month) {
  try {
    var session = requireAuth_(token, ['admin', 'employee']);
    var run = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month)
      .filter(function (r) { return r.EmployeeID === session.employeeId; })[0];
    if (!run) return apiError('ไม่มีข้อมูลเงินเดือนของเดือนนี้');
    if (run.Status !== 'approved' && session.role !== 'admin') return apiError('ยังไม่มีการอนุมัติจ่ายเงินเดือนของเดือนนี้');

    var emp = getEmployee_(session.employeeId);
    var deductions = findAll_(SHEET_NAMES.PAYROLL_DEDUCTIONS, 'Month', month).filter(function (d) { return d.EmployeeID === session.employeeId; });
    return apiOk(buildPayslip_(month, run, emp, deductions));
  } catch (e) {
    return apiError(e.message);
  }
}

/** รายชื่อเดือนที่พนักงานคนนี้มีสลิปเงินเดือน (อนุมัติแล้ว) เรียงใหม่ล่าสุดก่อน */
function listMyPayslipMonths(token) {
  try {
    var session = requireAuth_(token, ['admin', 'employee']);
    var rows = readAll_(SHEET_NAMES.PAYROLL_RUNS)
      .filter(function (r) { return r.EmployeeID === session.employeeId && r.Status === 'approved'; })
      .map(function (r) { return { month: r.Month, monthLabel: formatThaiMonthLong(r.Month), netPay: Number(r.NetPay) }; });
    rows.sort(function (a, b) { return compareMonthKey(b.month, a.month); });
    return apiOk(rows);
  } catch (e) {
    return apiError(e.message);
  }
}
