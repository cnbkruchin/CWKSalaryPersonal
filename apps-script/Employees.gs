/**
 * Employees.gs — ทะเบียนลูกจ้าง (CRUD) เข้าถึงได้เฉพาะแอดมิน
 * ยกเว้น getMyProfile ที่พนักงานเรียกดูข้อมูลตัวเองได้
 */

function listEmployees(token, includeInactive) {
  try {
    requireAuth_(token, ['admin']);
    var rows = readAll_(SHEET_NAMES.EMPLOYEES).filter(function (e) {
      return includeInactive || e.Status === 'active';
    });
    rows.sort(function (a, b) {
      return (a.FirstName || '').localeCompare(b.FirstName || '', 'th');
    });
    return apiOk(rows.map(sanitizeEmployee_));
  } catch (e) {
    return apiError(e.message);
  }
}

function sanitizeEmployee_(e) {
  return {
    employeeId: e.EmployeeID,
    prefixName: e.PrefixName,
    firstName: e.FirstName,
    lastName: e.LastName,
    group: e.Group,
    position: e.Position,
    startDate: e.StartDate,
    status: e.Status,
    hasSSO: e.HasSSO === true || e.HasSSO === 'TRUE',
    bankName: e.BankName,
    bankAccountNo: e.BankAccountNo,
    citizenID: e.CitizenID,
    phone: e.Phone,
    role: e.Role,
    note: e.Note
  };
}

function getEmployee_(employeeId) {
  return findOne_(SHEET_NAMES.EMPLOYEES, 'EmployeeID', employeeId);
}

function currentBaseSalaryOf_(employeeId, asOfMonth) {
  var history = findAll_(SHEET_NAMES.SALARY_HISTORY, 'EmployeeID', employeeId)
    .filter(function (h) { return compareMonthKey(h.EffectiveMonth, asOfMonth) <= 0; })
    .sort(function (a, b) { return compareMonthKey(b.EffectiveMonth, a.EffectiveMonth); });
  return history.length ? Number(history[0].BaseSalary) : 0;
}

function addEmployee(token, form) {
  try {
    requireAuth_(token, ['admin']);
    if (!form.employeeId || !form.firstName) return apiError('กรุณากรอกรหัสพนักงานและชื่อ');
    if (getEmployee_(form.employeeId)) return apiError('รหัสพนักงานนี้มีอยู่แล้ว');

    var salt = Utilities.getUuid();
    var initialPin = form.initialPin || (form.citizenID ? String(form.citizenID).slice(-6) : '123456');

    appendRow_(SHEET_NAMES.EMPLOYEES, {
      EmployeeID: String(form.employeeId).trim(),
      PrefixName: form.prefixName || '',
      FirstName: form.firstName || '',
      LastName: form.lastName || '',
      Group: form.group || '',
      Position: form.position || '',
      StartDate: form.startDate || '',
      Status: 'active',
      HasSSO: !!form.hasSSO,
      BankName: form.bankName || '',
      BankAccountNo: form.bankAccountNo || '',
      CitizenID: form.citizenID || '',
      Phone: form.phone || '',
      Role: form.role === 'admin' ? 'admin' : 'employee',
      PinHash: hashPin_(initialPin, salt),
      PinSalt: salt,
      Note: 'บัญชีใหม่ กรุณาเปลี่ยนรหัสผ่านทันที',
      CreatedAt: nowIso()
    });

    if (form.baseSalary) {
      appendRow_(SHEET_NAMES.SALARY_HISTORY, {
        HistoryID: newId('SH'),
        EmployeeID: form.employeeId,
        EffectiveMonth: form.startMonth || currentMonthKey(),
        BaseSalary: Number(form.baseSalary),
        ChangeType: 'บรรจุใหม่',
        ApprovedDate: nowIso(),
        ApprovedBy: '',
        Note: 'อัตราเริ่มต้นเมื่อบรรจุ',
        CreatedAt: nowIso()
      });
    }

    return apiOk({ employeeId: form.employeeId, initialPin: initialPin });
  } catch (e) {
    return apiError(e.message);
  }
}

function updateEmployee(token, employeeId, form) {
  try {
    requireAuth_(token, ['admin']);
    var emp = getEmployee_(employeeId);
    if (!emp) return apiError('ไม่พบพนักงาน');
    updateRowByIndex_(SHEET_NAMES.EMPLOYEES, emp._row, {
      PrefixName: form.prefixName,
      FirstName: form.firstName,
      LastName: form.lastName,
      Group: form.group,
      Position: form.position,
      StartDate: form.startDate,
      HasSSO: !!form.hasSSO,
      BankName: form.bankName,
      BankAccountNo: form.bankAccountNo,
      CitizenID: form.citizenID,
      Phone: form.phone,
      Note: form.note
    });
    return apiOk(true);
  } catch (e) {
    return apiError(e.message);
  }
}

function setEmployeeStatus(token, employeeId, status) {
  try {
    requireAuth_(token, ['admin']);
    var emp = getEmployee_(employeeId);
    if (!emp) return apiError('ไม่พบพนักงาน');
    if (status !== 'active' && status !== 'inactive') return apiError('สถานะไม่ถูกต้อง');
    updateRowByIndex_(SHEET_NAMES.EMPLOYEES, emp._row, { Status: status });
    return apiOk(true);
  } catch (e) {
    return apiError(e.message);
  }
}
