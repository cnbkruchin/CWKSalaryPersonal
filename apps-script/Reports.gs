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
        employeeId: r.EmployeeID, fullName: fullNameOf_(emp),
        bankName: emp.BankName || '', bankAccountNo: emp.BankAccountNo || '', netPay: Number(r.NetPay)
      };
    }).sort(function (a, b) { return String(a.employeeId).localeCompare(String(b.employeeId), 'en', { numeric: true }); });

    var total = round2(list.reduce(function (s, x) { return s + x.netPay; }, 0));
    var settings = getSettings_();
    return apiOk({
      month: month, monthLabel: formatThaiMonthLong(month),
      schoolName: settings.SchoolName, list: list, total: total, totalText: bahtText(total),
      approved: rows.every(function (r) { return r.Status === 'approved'; })
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

    var totalBaseSalary = 0, totalPositionAllowance = 0, totalOnDutyPay = 0, totalOtherIncome = 0, totalBackPay = 0, totalSSOEmployee = 0, totalSSOEmployer = 0, totalCompFundEmployer = 0;
    rows.forEach(function (r) {
      totalBaseSalary += Number(r.BaseSalary);
      totalPositionAllowance += Number(r.PositionAllowance);
      totalOnDutyPay += Number(r.OnDutyPay);
      totalOtherIncome += Number(r.OtherIncome);
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
        totalPositionAllowance: round2(totalPositionAllowance),
        totalOnDutyPay: round2(totalOnDutyPay),
        totalOtherIncome: round2(totalOtherIncome),
        totalBackPay: round2(totalBackPay),
        totalGrossIncome: round2(totalBaseSalary + totalPositionAllowance + totalOnDutyPay + totalOtherIncome + totalBackPay),
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

/** รหัสตรวจสอบสลิป (HMAC ของเดือน+รหัสพนักงาน+ยอดเงิน) — ถ้ามีใครแก้ตัวเลขบนสลิป รหัสจะไม่ตรงกับข้อมูลจริง */
function payslipCode_(run) {
  var key = 'verify:' + getSetting_('AuthPepper', '');
  var msg = [run.Month, run.EmployeeID, Number(run.GrossPay).toFixed(2), Number(run.NetPay).toFixed(2)].join('|');
  var hex = bytesToHex_(Utilities.computeHmacSha256Signature(msg, key)).substring(0, 12).toUpperCase();
  return 'CWK-' + hex.substring(0, 4) + '-' + hex.substring(4, 8) + '-' + hex.substring(8, 12);
}

function appUrl_() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (e) {
    return '';
  }
}

function buildPayslip_(month, run, emp, deductions) {
  var settings = getSettings_();
  var approved = run.Status === 'approved';
  var code = approved ? payslipCode_(run) : '';
  var baseUrl = appUrl_();
  return {
    month: month,
    monthLabel: formatThaiMonthLong(month),
    schoolName: settings.SchoolName,
    schoolAddress: settings.SchoolAddress,
    financeOfficerName: settings.FinanceOfficerName,
    financeOfficerTitle: settings.FinanceOfficerTitle,
    employeeId: emp.EmployeeID,
    fullName: fullNameOf_(emp),
    group: emp.Group || '',
    position: emp.Position || '',
    bankName: emp.BankName || '',
    bankAccountNo: emp.BankAccountNo || '',
    baseSalary: Number(run.BaseSalary),
    positionAllowance: Number(run.PositionAllowance),
    onDutyPay: Number(run.OnDutyPay),
    otherIncome: Number(run.OtherIncome),
    otherIncomeNote: run.OtherIncomeNote || '',
    backPay: Number(run.BackPay),
    backPayNote: run.BackPayNote || '',
    grossPay: Number(run.GrossPay),
    ssoEmployee: Number(run.SSOEmployee),
    compFundEmployer: Number(run.CompFundEmployer),
    otherDeductions: deductions.map(function (d) { return { label: (DEDUCTION_CATEGORY_LABEL[d.Category] || d.Category) + (d.Label ? (' - ' + d.Label) : ''), amount: Number(d.Amount) }; }),
    totalDeduction: Number(run.TotalDeduction),
    netPay: Number(run.NetPay),
    netPayText: bahtText(Number(run.NetPay)),
    paidDate: run.PaidDate || '',
    paidDateLabel: formatThaiDateShort(run.PaidDate),
    status: run.Status,
    verifyCode: code,
    verifyUrl: code && baseUrl ? (baseUrl + '?verify=' + encodeURIComponent(code)) : ''
  };
}

/** ใช้โดยแอดมิน: ดึงสลิปทุกคนของเดือนที่ระบุ สำหรับพิมพ์รวม (A5 แนวนอน) — รอบแบบร่างจะมีลายน้ำ "ร่าง" */
function getPayslipsForPrint(token, month) {
  try {
    var session = requireAuth_(token, ['admin']);
    var rows = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month);
    if (!rows.length) return apiError('ยังไม่มีรอบจ่ายของเดือนนี้');
    var employeesById = {};
    readAll_(SHEET_NAMES.EMPLOYEES).forEach(function (e) { employeesById[e.EmployeeID] = e; });
    var deductions = findAll_(SHEET_NAMES.PAYROLL_DEDUCTIONS, 'Month', month);

    var slips = rows.map(function (r) {
      var emp = employeesById[r.EmployeeID] || { EmployeeID: r.EmployeeID, FirstName: '(ไม่พบข้อมูล)' };
      var myDeductions = deductions.filter(function (d) { return d.EmployeeID === r.EmployeeID; });
      return buildPayslip_(month, r, emp, myDeductions);
    }).sort(function (a, b) { return String(a.employeeId).localeCompare(String(b.employeeId), 'en', { numeric: true }); });

    audit_(session.employeeId, session.role, 'PRINT_PAYSLIPS', month, slips.length + ' ใบ');
    return apiOk(slips);
  } catch (e) {
    return apiError(e.message);
  }
}

/** หน้าบ้าน: ดูสลิปของตัวเองในเดือนที่เลือก (เฉพาะรอบที่อนุมัติแล้ว) */
function getMyPayslip(token, month) {
  try {
    var session = requireAuth_(token, ['employee']);
    var run = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month)
      .filter(function (r) { return r.EmployeeID === session.employeeId && r.Status === 'approved'; })[0];
    if (!run) return apiError('ยังไม่มีสลิปเงินเดือนของเดือนนี้');
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
    var session = requireAuth_(token, ['employee']);
    var rows = readAll_(SHEET_NAMES.PAYROLL_RUNS)
      .filter(function (r) { return r.EmployeeID === session.employeeId && r.Status === 'approved'; })
      .map(function (r) {
        return { month: r.Month, monthLabel: formatThaiMonthLong(r.Month), grossPay: Number(r.GrossPay), netPay: Number(r.NetPay), paidDateLabel: formatThaiDateShort(r.PaidDate) };
      });
    rows.sort(function (a, b) { return compareMonthKey(b.month, a.month); });
    return apiOk(rows);
  } catch (e) {
    return apiError(e.message);
  }
}

/**
 * หน้าบ้าน: สรุปรายได้ทั้งปี (ปีภาษี = ม.ค.–ธ.ค.) ใช้ประกอบการยื่นภาษี ภ.ง.ด.90/91 หรือยื่นกู้ธนาคาร
 * year = ปี ค.ศ.
 */
function getMyAnnualSummary(token, year) {
  try {
    var session = requireAuth_(token, ['employee']);
    var mine = readAll_(SHEET_NAMES.PAYROLL_RUNS).filter(function (r) {
      return r.EmployeeID === session.employeeId && r.Status === 'approved';
    });
    var years = {};
    mine.forEach(function (r) { years[String(r.Month).substring(0, 4)] = true; });
    var yearList = Object.keys(years).sort().reverse();
    var y = String(year || yearList[0] || new Date().getFullYear());

    var rows = mine.filter(function (r) { return String(r.Month).substring(0, 4) === y; })
      .sort(function (a, b) { return compareMonthKey(a.Month, b.Month); })
      .map(function (r) {
        return {
          month: r.Month, monthLabel: formatThaiMonthLong(r.Month),
          baseSalary: Number(r.BaseSalary),
          otherIncome: round2(Number(r.PositionAllowance) + Number(r.OnDutyPay) + Number(r.OtherIncome) + Number(r.BackPay)),
          grossPay: Number(r.GrossPay), ssoEmployee: Number(r.SSOEmployee),
          otherDeduction: Number(r.OtherDeductionTotal), netPay: Number(r.NetPay)
        };
      });
    var totals = { baseSalary: 0, otherIncome: 0, grossPay: 0, ssoEmployee: 0, otherDeduction: 0, netPay: 0 };
    rows.forEach(function (r) { Object.keys(totals).forEach(function (k) { totals[k] += r[k]; }); });
    Object.keys(totals).forEach(function (k) { totals[k] = round2(totals[k]); });

    var emp = getEmployee_(session.employeeId);
    var settings = getSettings_();
    return apiOk({
      year: y, yearBE: parseInt(y, 10) + 543, years: yearList.map(function (v) { return { year: v, yearBE: parseInt(v, 10) + 543 }; }),
      schoolName: settings.SchoolName, schoolAddress: settings.SchoolAddress,
      financeOfficerName: settings.FinanceOfficerName, financeOfficerTitle: settings.FinanceOfficerTitle,
      employeeId: emp.EmployeeID, fullName: fullNameOf_(emp), position: emp.Position || emp.Group || '',
      rows: rows, totals: totals, grossText: bahtText(totals.grossPay)
    });
  } catch (e) {
    return apiError(e.message);
  }
}

function maskName_(emp) {
  var last = String(emp.LastName || '');
  return (emp.PrefixName || '') + (emp.FirstName || '') + (last ? (' ' + last.charAt(0) + '***') : '');
}

/** สาธารณะ (ไม่ต้องล็อกอิน): ตรวจสอบความถูกต้องของสลิปจากรหัส/QR บนสลิป เช่น ธนาคารใช้ตรวจตอนยื่นกู้ */
function verifyPayslip(code) {
  try {
    var normalized = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^CWK[0-9A-F]{12}$/.test(normalized)) return apiOk({ valid: false });
    var pretty = 'CWK-' + normalized.substring(3, 7) + '-' + normalized.substring(7, 11) + '-' + normalized.substring(11, 15);
    var match = readAll_(SHEET_NAMES.PAYROLL_RUNS).filter(function (r) {
      return r.Status === 'approved' && payslipCode_(r) === pretty;
    })[0];
    audit_('public', '', 'VERIFY_PAYSLIP', pretty, match ? 'valid' : 'invalid');
    if (!match) return apiOk({ valid: false, code: pretty });
    var emp = getEmployee_(match.EmployeeID) || {};
    return apiOk({
      valid: true,
      code: pretty,
      schoolName: getSetting_('SchoolName', ''),
      name: maskName_(emp),
      position: emp.Position || emp.Group || '',
      monthLabel: formatThaiMonthLong(match.Month),
      grossPay: Number(match.GrossPay),
      netPay: Number(match.NetPay),
      paidDateLabel: formatThaiDateShort(match.PaidDate)
    });
  } catch (e) {
    return apiError('ตรวจสอบไม่สำเร็จ กรุณาลองใหม่');
  }
}

/** หลังบ้าน: ภาพรวมสำหรับหน้าแดชบอร์ด */
function getAdminDashboard(token) {
  try {
    requireAuth_(token, ['admin']);
    var employees = readAll_(SHEET_NAMES.EMPLOYEES).filter(function (e) { return e.Role !== 'admin'; });
    var active = employees.filter(function (e) { return e.Status === 'active'; });
    var runs = readAll_(SHEET_NAMES.PAYROLL_RUNS);
    var current = currentMonthKey();

    var byMonth = {};
    runs.forEach(function (r) {
      var m = byMonth[r.Month] || (byMonth[r.Month] = { month: r.Month, netPay: 0, grossPay: 0, headcount: 0, status: 'approved' });
      m.netPay += Number(r.NetPay);
      m.grossPay += Number(r.GrossPay);
      m.headcount += 1;
      if (r.Status !== 'approved') m.status = 'draft';
    });
    var trend = Object.keys(byMonth).sort().slice(-6).map(function (k) {
      var m = byMonth[k];
      return { month: m.month, monthLabel: formatThaiMonthShort(m.month), netPay: round2(m.netPay), grossPay: round2(m.grossPay), headcount: m.headcount, status: m.status };
    });
    var cur = byMonth[current];

    var pending = readAll_(SHEET_NAMES.BACKPAY_QUEUE).filter(function (q) { return q.Status === 'pending'; });
    var audit = readAll_(SHEET_NAMES.AUDIT_LOG).slice(-8).reverse().map(auditView_);

    return apiOk({
      currentMonth: current,
      currentMonthLabel: formatThaiMonthLong(current),
      activeEmployees: active.length,
      ssoEmployees: active.filter(function (e) { return isTrue_(e.HasSSO); }).length,
      currentRun: cur ? { status: cur.status, netPay: round2(cur.netPay), grossPay: round2(cur.grossPay), headcount: cur.headcount } : null,
      trend: trend,
      pendingBackPay: { count: pending.length, total: round2(pending.reduce(function (s, q) { return s + Number(q.TotalBackPay); }, 0)) },
      accounts: {
        neverLoggedIn: active.filter(function (e) { return !e.LastLoginAt; }).length,
        mustChangePin: active.filter(needsPinChange_).length,
        pdpaAccepted: active.filter(function (e) { return !!e.PdpaAcceptedAt; }).length
      },
      recentActivity: audit
    });
  } catch (e) {
    return apiError(e.message);
  }
}

var AUDIT_ACTION_LABEL = {
  LOGIN: 'เข้าสู่ระบบ', LOGIN_FAILED: 'เข้าสู่ระบบไม่สำเร็จ', LOGIN_DENIED: 'ถูกปฏิเสธการเข้าหลังบ้าน', LOGOUT: 'ออกจากระบบ',
  CHANGE_PIN: 'เปลี่ยนรหัสผ่าน', RESET_PIN: 'รีเซ็ตรหัสผ่านให้ผู้อื่น', PDPA_ACCEPT: 'ยอมรับนโยบายความเป็นส่วนตัว',
  ADD_EMPLOYEE: 'เพิ่มลูกจ้าง', UPDATE_EMPLOYEE: 'แก้ไขข้อมูลลูกจ้าง', ACTIVATE_EMPLOYEE: 'เปิดใช้งานบัญชี', DEACTIVATE_EMPLOYEE: 'ปิดใช้งานบัญชี',
  SALARY_ADJUST: 'ปรับ/เลื่อนขั้นเงินเดือน', CREATE_RUN: 'สร้างรอบจ่าย', ADD_TO_RUN: 'เพิ่มลูกจ้างเข้ารอบจ่าย', EDIT_PAY_LINE: 'แก้ไขรายการเงินเดือน',
  APPLY_BACKPAY: 'ดึงตกเบิกเข้ารอบจ่าย', ADD_DEDUCTION: 'เพิ่มรายการหัก', REMOVE_DEDUCTION: 'ลบรายการหัก', APPROVE_RUN: 'อนุมัติรอบจ่าย',
  REOPEN_RUN: 'เปิดรอบจ่ายแก้ไข', PRINT_PAYSLIPS: 'พิมพ์สลิปรวม', UPDATE_SETTINGS: 'แก้ไขการตั้งค่า', VERIFY_PAYSLIP: 'ตรวจสอบสลิปจากภายนอก'
};

function auditView_(a) {
  return {
    timestamp: a.Timestamp, actorId: a.ActorID, role: a.Role, action: a.Action,
    actionLabel: AUDIT_ACTION_LABEL[a.Action] || a.Action, target: a.Target, detail: a.Detail
  };
}

/** หลังบ้าน: ประวัติการใช้งาน (ล่าสุดก่อน) กรองตามคำค้น (รหัสผู้ใช้/การกระทำ/เป้าหมาย) */
function listAuditLog(token, query, limit) {
  try {
    requireAuth_(token, ['admin']);
    var q = String(query || '').trim().toLowerCase();
    var rows = readAll_(SHEET_NAMES.AUDIT_LOG).slice().reverse().map(auditView_);
    if (q) {
      rows = rows.filter(function (r) {
        return [r.actorId, r.action, r.actionLabel, r.target, r.detail].join(' ').toLowerCase().indexOf(q) !== -1;
      });
    }
    return apiOk(rows.slice(0, Math.min(Number(limit) || 200, 1000)));
  } catch (e) {
    return apiError(e.message);
  }
}
