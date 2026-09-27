/**
 * Documents.gs — ข้อมูลสำหรับเอกสารประกอบการเบิกจ่ายประจำเดือน (หลังบ้าน) ตามแบบเอกสารเดิมของโรงเรียน
 *   1) บันทึกข้อความขออนุมัติเบิกเงิน
 *   2) ตารางเงินเดือน (หลักฐานการจ่ายค่าจ้าง) + กล่องสรุปเงินรับ/เงินหัก 1–14
 *   3) รายละเอียดเพิ่มเติม (แบบรายงาน งบบุคลากร ค่าจ้างลูกจ้างชั่วคราว) แยกตามกลุ่มงาน
 *   4) เอกสารส่งธนาคาร (หนังสือขอให้โอนเงิน + รายชื่อ/เลขบัญชี/จำนวนเงิน)
 * การจัดหน้า/พิมพ์/ส่งออก Excel-Word ทำฝั่ง client (JsAdminReports.html)
 */

var WORK_GROUP_ORDER = ['ครูอัตราจ้าง', 'เจ้าหน้าที่', 'พนักงานขับรถ', 'ภารโรง', 'แม่บ้าน', 'ยามรักษาการณ์'];
var EMPLOYMENT_TYPES = ['ลูกจ้าง มี ปกส.', 'จ้างเหมาบริการ', 'งบเขต', 'อื่นๆ'];

var DEDUCTION_CATEGORY_LABEL = {
  'เงินยืม': 'หักคืนเงินยืม',
  'เกษียณ': 'ค่างานเลี้ยงเกษียณ',
  'อื่นๆ': 'รายการหักอื่นๆ'
};

/** หมายเหตุ 1 ตามแบบเดิม: หมายเหตุในทะเบียน หรือวันที่เลื่อนขั้นล่าสุด/วันเริ่มงาน */
function statusNoteOf_(emp, month) {
  if (emp.Note && !/รหัสผ่าน/.test(emp.Note)) return emp.Note;
  var last = findAll_(SHEET_NAMES.SALARY_HISTORY, 'EmployeeID', emp.EmployeeID)
    .filter(function (h) { return compareMonthKey(h.EffectiveMonth, month) <= 0 && h.ChangeType === 'เลื่อนขั้น'; })
    .sort(function (a, b) { return compareMonthKey(b.EffectiveMonth, a.EffectiveMonth); })[0];
  if (last) return 'ขึ้นแล้ว ' + formatThaiDateShort(String(last.ApprovedDate).substring(0, 10) || (last.EffectiveMonth + '-01'));
  if (emp.StartDate) return 'เริ่มทำ ' + formatThaiDateShort(emp.StartDate);
  return '';
}

function buildDisbursement_(month) {
  var runs = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'Month', month);
  if (!runs.length) throw new Error('ยังไม่มีรอบจ่ายของเดือนนี้');
  var settings = getSettings_();
  var emps = {};
  readAll_(SHEET_NAMES.EMPLOYEES).forEach(function (e) { emps[e.EmployeeID] = e; });
  var dedByEmp = {};
  var categorySums = { 'เงินยืม': 0, 'เกษียณ': 0, 'อื่นๆ': 0 };
  findAll_(SHEET_NAMES.PAYROLL_DEDUCTIONS, 'Month', month).forEach(function (d) {
    var cat = categorySums.hasOwnProperty(d.Category) ? d.Category : 'อื่นๆ';
    var m = dedByEmp[d.EmployeeID] || (dedByEmp[d.EmployeeID] = { 'เงินยืม': 0, 'เกษียณ': 0, 'อื่นๆ': 0 });
    m[cat] += Number(d.Amount);
    categorySums[cat] += Number(d.Amount);
  });

  var lines = runs.map(function (r) {
    var e = emps[r.EmployeeID] || { EmployeeID: r.EmployeeID, FirstName: r.EmployeeID };
    var extra = round2(Number(r.PositionAllowance) + Number(r.OnDutyPay) + Number(r.OtherIncome));
    return {
      employeeId: r.EmployeeID,
      firstWithPrefix: (e.PrefixName || '') + (e.FirstName || ''),
      lastName: e.LastName || '',
      fullName: fullNameOf_(e),
      group: e.Group || '',
      position: e.Position || '',
      bankName: e.BankName || '',
      bankAccountNo: e.BankAccountNo || '',
      baseSalary: Number(r.BaseSalary),
      positionAllowance: Number(r.PositionAllowance),
      onDutyPay: Number(r.OnDutyPay),
      otherIncome: Number(r.OtherIncome),
      extraIncome: extra,
      backPay: Number(r.BackPay),
      backPayNote: r.BackPayNote || '',
      grossPay: Number(r.GrossPay),
      ssoEmployee: Number(r.SSOEmployee),
      compFundEmployee: 0,
      otherDeduction: Number(r.OtherDeductionTotal),
      totalDeduction: Number(r.TotalDeduction),
      netPay: Number(r.NetPay),
      ssoEmployer: Number(r.SSOEmployer),
      compFundEmployer: Number(r.CompFundEmployer),
      budgetTotal: round2(Number(r.BaseSalary) + extra + Number(r.BackPay) + Number(r.SSOEmployer) + Number(r.CompFundEmployer)),
      note1: statusNoteOf_(e, month),
      note2: e.EmploymentType || (isTrue_(e.HasSSO) ? 'ลูกจ้าง มี ปกส.' : 'จ้างเหมาบริการ'),
      deductionsByCategory: dedByEmp[r.EmployeeID] || { 'เงินยืม': 0, 'เกษียณ': 0, 'อื่นๆ': 0 }
    };
  }).sort(function (a, b) { return String(a.employeeId).localeCompare(String(b.employeeId), 'en', { numeric: true }); });
  lines.forEach(function (l, i) { l.seq = i + 1; });

  var keys = ['baseSalary', 'positionAllowance', 'onDutyPay', 'otherIncome', 'extraIncome', 'backPay', 'grossPay', 'ssoEmployee',
    'compFundEmployee', 'otherDeduction', 'totalDeduction', 'netPay', 'ssoEmployer', 'compFundEmployer', 'budgetTotal'];
  var totals = {};
  keys.forEach(function (k) { totals[k] = round2(lines.reduce(function (s, l) { return s + l[k]; }, 0)); });
  Object.keys(categorySums).forEach(function (k) { categorySums[k] = round2(categorySums[k]); });

  // กล่องสรุปท้ายตารางเงินเดือน (ตามลำดับเลขข้อในไฟล์ "เงินเดือน" เดิม)
  var s1 = totals.baseSalary;
  var s2 = round2(totals.extraIncome + totals.backPay);
  var s3 = totals.ssoEmployer;
  var s4 = totals.compFundEmployer;
  var s5 = round2(s1 + s2 + s3 + s4);
  var s6 = categorySums['เงินยืม'];
  var s7 = categorySums['เกษียณ'];
  var s8 = totals.ssoEmployee;
  var s9 = totals.compFundEmployee;
  var s10 = categorySums['อื่นๆ'];
  var s11 = round2(s3 + s4 + s6 + s7 + s8 + s9 + s10);
  var s13 = round2(s5 - s11);
  var summary = {
    income: [
      { no: 1, label: 'ค่าจ้างรายเดือน (เงินเดือน)', amount: s1 },
      { no: 2, label: 'รวมรับอื่นๆ (ค่าตำแหน่ง/ค่าเวร/เพิ่มพิเศษ/ตกเบิก)', amount: s2 },
      { no: 3, label: 'ร.ร. สมทบ ปกส.', amount: s3 },
      { no: 4, label: 'ร.ร. สมทบกองทุนเงินทดแทน', amount: s4 },
      { no: 5, label: 'ยอดรวม (1+2+3+4)', amount: s5, total: true }
    ],
    deduction: [
      { no: 6, label: 'รวมหักอื่นๆ (หักคืนเงินยืม)', amount: s6 },
      { no: 7, label: 'รวมหักอื่นๆ (ค่างานเลี้ยงเกษียณ)', amount: s7 },
      { no: 8, label: 'รวมหัก ปกส. 5%', amount: s8 },
      { no: 9, label: 'รวมหัก กองทุนเงินทดแทน', amount: s9 },
      { no: 10, label: 'รวมหักอื่นๆ (รายการอื่น)', amount: s10 },
      { no: 11, label: 'รวมยอดถอนเงินสด (3+4+6+7+8+9+10)', amount: s11, total: true },
      { no: 13, label: 'คงเหลือโอนเข้าบัญชี (5-11)', amount: s13, total: true },
      { no: 14, label: 'รวมสุทธิ (11+13)', amount: round2(s11 + s13), total: true }
    ],
    grandTotal: s5,
    grandTotalText: bahtText(s5),
    reconciles: Math.abs(s13 - totals.netPay) < 0.01
  };

  // รายการในบันทึกข้อความขออนุมัติ (ยอดรวม = ข้อ 5 ของกล่องสรุปเสมอ)
  var memoLines = [
    { description: 'ค่าจ้างลูกจ้างชั่วคราว เดือน' + formatThaiMonthLong(month), amount: totals.netPay, note: 'โอนผ่านธนาคาร' },
    { description: 'ค่าประกันสังคม (ลูกจ้าง ' + formatMoney_(s8) + ' + โรงเรียนสมทบ ' + formatMoney_(s3 + s4) + ')', amount: round2(s8 + s3 + s4), note: 'เบิกเงินสด' }
  ];
  if (s6) memoLines.push({ description: 'หักคืนเงินยืม', amount: s6, note: 'เบิกเงินสด' });
  if (s7) memoLines.push({ description: 'ค่างานเลี้ยงเกษียณ', amount: s7, note: 'เบิกเงินสด' });
  if (s10) memoLines.push({ description: 'รายการหักอื่นๆ', amount: s10, note: 'เบิกเงินสด' });

  var approved = runs.every(function (r) { return r.Status === 'approved'; });
  var paidDate = approved ? runs[0].PaidDate : defaultPaidDate_(month, settings.DefaultPayDay);
  var fy = thaiFiscalYear_(month);
  return {
    month: month,
    monthLabel: formatThaiMonthLong(month),
    fiscalYearBE: fy.yearBE,
    fiscalRangeText: fy.rangeText,
    approved: approved,
    paidDate: paidDate,
    paidDateLabel: formatThaiDateLong(paidDate),
    todayLabel: formatThaiDateLong(Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd')),
    school: {
      name: settings.SchoolName, address: settings.SchoolAddress, districtOffice: settings.SchoolDistrictOffice,
      memoDocPrefix: settings.MemoDocPrefix || '',
      bankName: settings.SchoolBankName || '', bankBranch: settings.SchoolBankBranch || '',
      bankAccountName: settings.SchoolBankAccountName || '', bankAccountNo: settings.SchoolBankAccountNo || ''
    },
    signers: {
      financeOfficerName: settings.FinanceOfficerName, financeOfficerTitle: settings.FinanceOfficerTitle,
      budgetHeadName: settings.BudgetHeadName, budgetHeadTitle: settings.BudgetHeadTitle,
      deputyDirectorName: settings.DeputyDirectorName, deputyDirectorTitle: settings.DeputyDirectorTitle,
      directorName: settings.DirectorName, directorTitle: settings.DirectorTitle
    },
    lines: lines,
    totals: totals,
    totalsNetText: bahtText(totals.netPay),
    categorySums: categorySums,
    summary: summary,
    memoLines: memoLines,
    groupOrder: WORK_GROUP_ORDER
  };
}

function formatMoney_(n) {
  var parts = round2(n).toFixed(2).split('.');
  return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (parts[1] === '00' ? '' : '.' + parts[1]);
}

function getDisbursementDocs(token, month) {
  try {
    requireAuth_(token, ['admin']);
    if (!isValidMonthKey(month)) return apiError('รูปแบบเดือนไม่ถูกต้อง');
    return apiOk(buildDisbursement_(month));
  } catch (e) {
    return apiError(e.message);
  }
}

/** บันทึกว่ามีการพิมพ์/ส่งออกเอกสารใด (สำหรับตรวจสอบย้อนหลัง) */
function logDocumentExport(token, month, kind) {
  try {
    var session = requireAuth_(token, ['admin']);
    audit_(session.employeeId, session.role, 'EXPORT_DOCUMENT', month, String(kind || '').substring(0, 60));
    return apiOk(true);
  } catch (e) {
    return apiError(e.message);
  }
}
