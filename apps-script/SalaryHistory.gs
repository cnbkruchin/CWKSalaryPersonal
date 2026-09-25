/**
 * SalaryHistory.gs — ประวัติเงินเดือนพื้นฐาน/การเลื่อนขั้น และการคำนวณเงินตกเบิกอัตโนมัติ
 *
 * เมื่อเพิ่มรายการปรับเงินเดือนที่มีผลย้อนหลัง (EffectiveMonth เก่ากว่ารอบจ่ายที่อนุมัติไปแล้ว)
 * ระบบจะเทียบกับรอบจ่าย (PayrollRuns, Status=approved) ของเดือนนั้น ๆ ที่จ่ายไปแล้วด้วยอัตราเก่า
 * แล้วสร้างรายการ "ตกเบิก" ต่อเดือนไว้ใน BackPayQueue ให้แอดมินเลือกดึงเข้ารอบจ่ายเดือนใดก็ได้ภายหลัง
 */

function listSalaryHistory(token, employeeId) {
  try {
    var session = requireAuth_(token, ['admin', 'employee']);
    if (session.role !== 'admin' && session.employeeId !== employeeId) {
      return apiError('ไม่มีสิทธิ์เข้าถึงข้อมูลนี้');
    }
    var rows = findAll_(SHEET_NAMES.SALARY_HISTORY, 'EmployeeID', employeeId)
      .sort(function (a, b) { return compareMonthKey(b.EffectiveMonth, a.EffectiveMonth); });
    return apiOk(rows.map(function (r) {
      return {
        historyId: r.HistoryID, effectiveMonth: r.EffectiveMonth, baseSalary: Number(r.BaseSalary),
        changeType: r.ChangeType, approvedDate: r.ApprovedDate, approvedBy: r.ApprovedBy, note: r.Note
      };
    }));
  } catch (e) {
    return apiError(e.message);
  }
}

function addSalaryAdjustment(token, form) {
  try {
    var session = requireAuth_(token, ['admin']);
    var employeeId = form.employeeId;
    var effectiveMonth = form.effectiveMonth;
    var newBaseSalary = Number(form.baseSalary);

    if (!isValidMonthKey(effectiveMonth)) return apiError('รูปแบบเดือนไม่ถูกต้อง (ต้องเป็น YYYY-MM)');
    if (!form.baseSalary || isNaN(newBaseSalary) || newBaseSalary < 0) return apiError('อัตราเงินเดือนไม่ถูกต้อง');

    return withLock_(function () {
      if (!getEmployee_(employeeId)) return apiError('ไม่พบพนักงาน');
      var dup = findAll_(SHEET_NAMES.SALARY_HISTORY, 'EmployeeID', employeeId)
        .some(function (h) { return h.EffectiveMonth === effectiveMonth; });
      if (dup) return apiError('มีรายการปรับเงินเดือนของเดือนนี้อยู่แล้ว');

      appendRow_(SHEET_NAMES.SALARY_HISTORY, {
        HistoryID: newId('SH'),
        EmployeeID: employeeId,
        EffectiveMonth: effectiveMonth,
        BaseSalary: newBaseSalary,
        ChangeType: form.changeType || 'เลื่อนขั้น',
        ApprovedDate: form.approvedDate || nowIso(),
        ApprovedBy: form.approvedBy || session.employeeId,
        Note: form.note || '',
        CreatedAt: nowIso()
      });

      var backPayCreated = computeBackPayForAdjustment_(employeeId, effectiveMonth, newBaseSalary, form.note || '');
      var total = round2(backPayCreated.reduce(function (s, x) { return s + x; }, 0));
      audit_(session.employeeId, session.role, 'SALARY_ADJUST', employeeId,
        effectiveMonth + ' -> ' + newBaseSalary + (total ? (' (ตกเบิก ' + total + ')') : ''));
      return apiOk({ created: true, backPayMonths: backPayCreated.length, backPayTotal: total });
    });
  } catch (e) {
    return apiError(e.message);
  }
}

/**
 * ผลของการปรับเงินเดือนต่อรอบจ่ายที่มีอยู่แล้ว ในช่วง [effectiveMonth, เดือนที่มีการปรับครั้งถัดไป):
 * - รอบที่อนุมัติ/จ่ายไปแล้ว: สร้างรายการตกเบิก 1 แถวต่อเดือน เท่ากับส่วนต่างที่ยังขาด
 *   (หักยอดตกเบิกที่เคยตั้งให้เดือนนั้นแล้ว เพื่อไม่ให้จ่ายซ้ำเมื่อมีการปรับย้อนหลังหลายครั้ง)
 * - รอบที่ยังเป็นแบบร่าง: ปรับเงินเดือนในรอบนั้นเป็นอัตราใหม่ทันที (ไม่ต้องตกเบิก)
 * คืนอาเรย์ของยอดตกเบิกที่สร้าง
 */
function computeBackPayForAdjustment_(employeeId, effectiveMonth, newBaseSalary, historyNote) {
  var nextChange = findAll_(SHEET_NAMES.SALARY_HISTORY, 'EmployeeID', employeeId)
    .map(function (h) { return h.EffectiveMonth; })
    .filter(function (m) { return compareMonthKey(m, effectiveMonth) > 0; })
    .sort()[0];
  var inRange = function (month) {
    return compareMonthKey(month, effectiveMonth) >= 0 && (!nextChange || compareMonthKey(month, nextChange) < 0);
  };

  var emp = getEmployee_(employeeId);
  var runs = findAll_(SHEET_NAMES.PAYROLL_RUNS, 'EmployeeID', employeeId).filter(function (r) { return inRange(r.Month); });
  var queued = findAll_(SHEET_NAMES.BACKPAY_QUEUE, 'EmployeeID', employeeId);

  var created = [];
  runs.forEach(function (run) {
    if (run.Status !== 'approved') {
      var sso = computeSSO_(newBaseSalary, emp && isTrue_(emp.HasSSO));
      var line = {
        BaseSalary: newBaseSalary, PositionAllowance: Number(run.PositionAllowance), OnDutyPay: Number(run.OnDutyPay),
        OtherIncome: Number(run.OtherIncome), BackPay: Number(run.BackPay), SSOEmployee: sso, SSOEmployer: sso,
        CompFundEmployer: computeCompFund_(newBaseSalary), OtherDeductionTotal: Number(run.OtherDeductionTotal), UpdatedAt: nowIso()
      };
      recalcLineTotals_(line);
      updateRowByIndex_(SHEET_NAMES.PAYROLL_RUNS, run._row, line);
      return;
    }
    var alreadyQueued = queued
      .filter(function (q) { return q.FromMonth === run.Month; })
      .reduce(function (s, q) { return s + Number(q.TotalBackPay); }, 0);
    var diff = round2(newBaseSalary - Number(run.BaseSalary) - alreadyQueued);
    if (diff <= 0) return;
    appendRow_(SHEET_NAMES.BACKPAY_QUEUE, {
      QueueID: newId('BP'),
      EmployeeID: employeeId,
      FromMonth: run.Month,
      ToMonth: run.Month,
      OldBaseSalary: Number(run.BaseSalary) + alreadyQueued,
      NewBaseSalary: newBaseSalary,
      MonthlyDiff: diff,
      MonthsCount: 1,
      TotalBackPay: diff,
      Status: 'pending',
      AppliedRunMonth: '',
      CreatedAt: nowIso(),
      Note: 'จากการปรับเงินเดือนมีผล ' + formatThaiMonthLong(effectiveMonth) + (historyNote ? (' — ' + historyNote) : '')
    });
    created.push(diff);
  });
  return created;
}

function listBackPayQueue(token, employeeId, statusFilter) {
  try {
    var session = requireAuth_(token, ['admin', 'employee']);
    if (session.role !== 'admin' && session.employeeId !== employeeId) {
      return apiError('ไม่มีสิทธิ์เข้าถึงข้อมูลนี้');
    }
    var rows = employeeId ? findAll_(SHEET_NAMES.BACKPAY_QUEUE, 'EmployeeID', employeeId) : readAll_(SHEET_NAMES.BACKPAY_QUEUE);
    if (statusFilter) rows = rows.filter(function (r) { return r.Status === statusFilter; });
    rows.sort(function (a, b) { return compareMonthKey(a.FromMonth, b.FromMonth); });
    return apiOk(rows.map(function (r) {
      return {
        queueId: r.QueueID, employeeId: r.EmployeeID, fromMonth: r.FromMonth, toMonth: r.ToMonth,
        oldBaseSalary: Number(r.OldBaseSalary), newBaseSalary: Number(r.NewBaseSalary),
        monthlyDiff: Number(r.MonthlyDiff), monthsCount: Number(r.MonthsCount), totalBackPay: Number(r.TotalBackPay),
        status: r.Status, appliedRunMonth: r.AppliedRunMonth, note: r.Note
      };
    }));
  } catch (e) {
    return apiError(e.message);
  }
}

function pendingBackPaySummaryFor_(employeeId) {
  var rows = findAll_(SHEET_NAMES.BACKPAY_QUEUE, 'EmployeeID', employeeId).filter(function (r) { return r.Status === 'pending'; });
  var total = 0;
  var notes = [];
  rows.forEach(function (r) {
    total += Number(r.TotalBackPay);
    notes.push(formatThaiMonthShort(r.FromMonth));
  });
  return { total: round2(total), count: rows.length, note: notes.length ? ('ตกเบิกเดือน ' + notes.join(', ')) : '' };
}

function markBackPayApplied_(employeeId, month) {
  var rows = findAll_(SHEET_NAMES.BACKPAY_QUEUE, 'EmployeeID', employeeId).filter(function (r) { return r.Status === 'pending'; });
  rows.forEach(function (r) {
    updateRowByIndex_(SHEET_NAMES.BACKPAY_QUEUE, r._row, { Status: 'applied', AppliedRunMonth: month });
  });
}
