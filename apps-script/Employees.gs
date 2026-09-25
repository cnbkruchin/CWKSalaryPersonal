/**
 * Employees.gs — ทะเบียนลูกจ้าง (หลังบ้าน) และข้อมูลส่วนตัวของลูกจ้าง (หน้าบ้าน, ปิดบังข้อมูลอ่อนไหว)
 */

function listEmployees(token, includeInactive) {
  try {
    requireAuth_(token, ['admin']);
    var rows = readAll_(SHEET_NAMES.EMPLOYEES).filter(function (e) {
      return includeInactive || e.Status === 'active';
    });
    rows.sort(function (a, b) {
      return String(a.EmployeeID).localeCompare(String(b.EmployeeID), 'en', { numeric: true });
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
    hasSSO: isTrue_(e.HasSSO),
    bankName: e.BankName,
    bankAccountNo: e.BankAccountNo,
    citizenID: e.CitizenID,
    phone: e.Phone,
    role: e.Role,
    note: e.Note,
    mustChangePin: needsPinChange_(e),
    pdpaAcceptedAt: e.PdpaAcceptedAt || '',
    lastLoginAt: e.LastLoginAt || ''
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

/** ตรวจความถูกต้องของข้อมูลก่อนบันทึก คืนข้อความ error หรือ null */
function validateEmployeeForm_(form) {
  if (!form.firstName || !String(form.firstName).trim()) return 'กรุณากรอกชื่อ';
  var citizen = String(form.citizenID || '').replace(/[\s-]/g, '');
  if (/^\d{13}$/.test(citizen) && !isValidThaiCitizenId_(citizen)) return 'เลขบัตรประชาชนไม่ถูกต้อง (ตรวจ check digit ไม่ผ่าน)';
  if (citizen && !/^[A-Za-z0-9]{6,20}$/.test(citizen)) return 'เลขบัตรประชาชน/หนังสือเดินทางมีรูปแบบไม่ถูกต้อง';
  var account = String(form.bankAccountNo || '').replace(/[\s-]/g, '');
  if (account && !/^\d{10,15}$/.test(account)) return 'เลขที่บัญชีต้องเป็นตัวเลข 10-15 หลัก';
  var phone = String(form.phone || '').replace(/[\s-]/g, '');
  if (phone && !/^0\d{8,9}$/.test(phone)) return 'เบอร์โทรศัพท์ไม่ถูกต้อง';
  return null;
}

function cleanDigits_(v) {
  return String(v || '').replace(/[\s-]/g, '');
}

function addEmployee(token, form) {
  try {
    var session = requireAuth_(token, ['admin']);
    var employeeId = String(form.employeeId || '').trim();
    if (!/^[A-Za-z0-9_-]{2,20}$/.test(employeeId)) return apiError('รหัสพนักงานต้องเป็นตัวอักษรอังกฤษ/ตัวเลข 2-20 ตัว เช่น Cwk023');
    var invalid = validateEmployeeForm_(form);
    if (invalid) return apiError(invalid);
    if (form.baseSalary && (isNaN(Number(form.baseSalary)) || Number(form.baseSalary) < 0)) return apiError('อัตราเงินเดือนไม่ถูกต้อง');
    if (form.startMonth && !isValidMonthKey(form.startMonth)) return apiError('เดือนเริ่มนับเงินเดือนต้องอยู่ในรูปแบบ YYYY-MM');

    return withLock_(function () {
      if (getEmployee_(employeeId)) return apiError('รหัสพนักงานนี้มีอยู่แล้ว');

      var role = form.role === 'admin' ? 'admin' : 'employee';
      var citizen = cleanDigits_(form.citizenID);
      var initialPin = role === 'admin'
        ? ('Tmp' + randomDigits_(7))
        : (/^\d{13}$/.test(citizen) ? citizen.slice(-6) : randomDigits_(6));
      var salt = Utilities.getUuid();

      appendRow_(SHEET_NAMES.EMPLOYEES, {
        EmployeeID: employeeId,
        PrefixName: form.prefixName || '',
        FirstName: String(form.firstName).trim(),
        LastName: String(form.lastName || '').trim(),
        Group: form.group || '',
        Position: form.position || '',
        StartDate: form.startDate || '',
        Status: 'active',
        HasSSO: !!form.hasSSO,
        BankName: form.bankName || '',
        BankAccountNo: cleanDigits_(form.bankAccountNo),
        CitizenID: citizen,
        Phone: cleanDigits_(form.phone),
        Role: role,
        PinHash: hashPin_(initialPin, salt),
        PinSalt: salt,
        MustChangePin: true,
        Note: form.note || '',
        CreatedAt: nowIso()
      });

      if (form.baseSalary) {
        appendRow_(SHEET_NAMES.SALARY_HISTORY, {
          HistoryID: newId('SH'),
          EmployeeID: employeeId,
          EffectiveMonth: form.startMonth || currentMonthKey(),
          BaseSalary: Number(form.baseSalary),
          ChangeType: 'บรรจุใหม่',
          ApprovedDate: nowIso(),
          ApprovedBy: session.employeeId,
          Note: 'อัตราเริ่มต้นเมื่อบรรจุ',
          CreatedAt: nowIso()
        });
      }

      audit_(session.employeeId, session.role, 'ADD_EMPLOYEE', employeeId, role);
      return apiOk({ employeeId: employeeId, initialPin: initialPin });
    });
  } catch (e) {
    return apiError(e.message);
  }
}

function updateEmployee(token, employeeId, form) {
  try {
    var session = requireAuth_(token, ['admin']);
    var invalid = validateEmployeeForm_(form);
    if (invalid) return apiError(invalid);
    return withLock_(function () {
      var emp = getEmployee_(employeeId);
      if (!emp) return apiError('ไม่พบพนักงาน');
      var patch = {
        PrefixName: form.prefixName || '',
        FirstName: String(form.firstName).trim(),
        LastName: String(form.lastName || '').trim(),
        Group: form.group || '',
        Position: form.position || '',
        StartDate: form.startDate || '',
        HasSSO: !!form.hasSSO,
        BankName: form.bankName || '',
        BankAccountNo: cleanDigits_(form.bankAccountNo),
        CitizenID: cleanDigits_(form.citizenID),
        Phone: cleanDigits_(form.phone),
        Note: form.note || ''
      };
      var changed = Object.keys(patch).filter(function (k) { return String(emp[k] === undefined ? '' : emp[k]) !== String(patch[k]); });
      updateRowByIndex_(SHEET_NAMES.EMPLOYEES, emp._row, patch);
      if (changed.length) audit_(session.employeeId, session.role, 'UPDATE_EMPLOYEE', employeeId, changed.join(', '));
      return apiOk(true);
    });
  } catch (e) {
    return apiError(e.message);
  }
}

function setEmployeeStatus(token, employeeId, status) {
  try {
    var session = requireAuth_(token, ['admin']);
    if (status !== 'active' && status !== 'inactive') return apiError('สถานะไม่ถูกต้อง');
    if (status === 'inactive' && employeeId === session.employeeId) return apiError('ไม่สามารถปิดใช้งานบัญชีของตัวเองได้');
    return withLock_(function () {
      var emp = getEmployee_(employeeId);
      if (!emp) return apiError('ไม่พบพนักงาน');
      if (status === 'inactive' && emp.Role === 'admin') {
        var activeAdmins = readAll_(SHEET_NAMES.EMPLOYEES).filter(function (e) { return e.Role === 'admin' && e.Status === 'active'; });
        if (activeAdmins.length <= 1) return apiError('ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 บัญชี');
      }
      updateRowByIndex_(SHEET_NAMES.EMPLOYEES, emp._row, { Status: status });
      audit_(session.employeeId, session.role, status === 'active' ? 'ACTIVATE_EMPLOYEE' : 'DEACTIVATE_EMPLOYEE', employeeId, '');
      return apiOk(true);
    });
  } catch (e) {
    return apiError(e.message);
  }
}

/** หน้าบ้าน: ข้อมูลส่วนตัวของลูกจ้างเอง (เลขบัญชี/บัตรประชาชนแสดงเฉพาะ 4 หลักท้าย) */
function getMyProfile(token) {
  try {
    var session = requireAuth_(token, ['employee']);
    var emp = getEmployee_(session.employeeId);
    if (!emp) return apiError('ไม่พบข้อมูล');
    var history = findAll_(SHEET_NAMES.SALARY_HISTORY, 'EmployeeID', emp.EmployeeID)
      .sort(function (a, b) { return compareMonthKey(b.EffectiveMonth, a.EffectiveMonth); })
      .map(function (h) {
        return { effectiveMonth: h.EffectiveMonth, monthLabel: formatThaiMonthLong(h.EffectiveMonth), baseSalary: Number(h.BaseSalary), changeType: h.ChangeType };
      });
    return apiOk({
      employeeId: emp.EmployeeID,
      fullName: fullNameOf_(emp),
      group: emp.Group,
      position: emp.Position,
      startDate: emp.StartDate,
      startDateLabel: formatThaiDateShort(emp.StartDate),
      hasSSO: isTrue_(emp.HasSSO),
      bankName: emp.BankName,
      bankAccountMasked: maskTail_(emp.BankAccountNo),
      citizenIdMasked: maskTail_(emp.CitizenID),
      phone: emp.Phone,
      lastLoginAt: emp.LastLoginAt || '',
      salaryHistory: history
    });
  } catch (e) {
    return apiError(e.message);
  }
}
