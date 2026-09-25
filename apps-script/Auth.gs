/**
 * Auth.gs — ล็อกอินด้วยรหัสพนักงาน + PIN, จัดการ session token ผ่าน CacheService
 * (ไม่ต้องมีชีตเก็บ session แยก เพราะ CacheService หมดอายุอัตโนมัติ)
 */

var SESSION_CACHE_PREFIX = 'sess_';

function hashPin_(pin, salt) {
  var pepper = getSetting_('AuthPepper', '');
  var raw = String(pin) + ':' + String(salt) + ':' + pepper;
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return digest.map(function (b) { return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'); }).join('');
}

/** เข้าสู่ระบบด้วยรหัสพนักงานและ PIN คืน token + ข้อมูลผู้ใช้ */
function login(employeeId, pin) {
  try {
    var emp = findOne_(SHEET_NAMES.EMPLOYEES, 'EmployeeID', String(employeeId).trim());
    if (!emp) return apiError('ไม่พบรหัสพนักงานนี้ในระบบ');
    if (emp.Status !== 'active') return apiError('บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อฝ่ายบุคคล');

    var hash = hashPin_(pin, emp.PinSalt);
    if (hash !== emp.PinHash) return apiError('รหัสผ่านไม่ถูกต้อง');

    var token = Utilities.getUuid();
    var timeoutMin = parseInt(getSetting_('SessionTimeoutMinutes', '480'), 10) || 480;
    var payload = JSON.stringify({ employeeId: emp.EmployeeID, role: emp.Role });
    CacheService.getScriptCache().put(SESSION_CACHE_PREFIX + token, payload, Math.min(timeoutMin * 60, 21600));

    return apiOk({
      token: token,
      employeeId: emp.EmployeeID,
      role: emp.Role,
      fullName: (emp.PrefixName || '') + emp.FirstName + ' ' + emp.LastName,
      mustChangePin: /กรุณาเปลี่ยนรหัสผ่านทันที/.test(emp.Note || '')
    });
  } catch (e) {
    return apiError('เข้าสู่ระบบไม่สำเร็จ: ' + e.message);
  }
}

function logout(token) {
  CacheService.getScriptCache().remove(SESSION_CACHE_PREFIX + token);
  return apiOk(true);
}

/** ตรวจ session token คืนค่า {employeeId, role} หรือ throw ถ้าไม่ผ่าน */
function requireAuth_(token, allowedRoles) {
  if (!token) throw new Error('กรุณาเข้าสู่ระบบ');
  var raw = CacheService.getScriptCache().get(SESSION_CACHE_PREFIX + token);
  if (!raw) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  var session = JSON.parse(raw);
  if (allowedRoles && allowedRoles.indexOf(session.role) === -1) {
    throw new Error('ไม่มีสิทธิ์เข้าถึงส่วนนี้');
  }
  // ต่ออายุ session อัตโนมัติเมื่อใช้งาน
  var timeoutMin = parseInt(getSetting_('SessionTimeoutMinutes', '480'), 10) || 480;
  CacheService.getScriptCache().put(SESSION_CACHE_PREFIX + token, raw, Math.min(timeoutMin * 60, 21600));
  return session;
}

function whoAmI(token) {
  try {
    var session = requireAuth_(token, ['admin', 'employee']);
    var emp = findOne_(SHEET_NAMES.EMPLOYEES, 'EmployeeID', session.employeeId);
    if (!emp) return apiError('ไม่พบข้อมูลผู้ใช้');
    return apiOk({
      employeeId: emp.EmployeeID,
      role: emp.Role,
      fullName: (emp.PrefixName || '') + emp.FirstName + ' ' + emp.LastName
    });
  } catch (e) {
    return apiError(e.message);
  }
}

function changeMyPin(token, oldPin, newPin) {
  try {
    var session = requireAuth_(token, ['admin', 'employee']);
    var emp = findOne_(SHEET_NAMES.EMPLOYEES, 'EmployeeID', session.employeeId);
    if (!emp) return apiError('ไม่พบข้อมูลผู้ใช้');
    if (hashPin_(oldPin, emp.PinSalt) !== emp.PinHash) return apiError('รหัสผ่านเดิมไม่ถูกต้อง');
    if (!newPin || String(newPin).length < 4) return apiError('รหัสผ่านใหม่ต้องมีอย่างน้อย 4 หลัก');
    var salt = Utilities.getUuid();
    updateRowByIndex_(SHEET_NAMES.EMPLOYEES, emp._row, {
      PinHash: hashPin_(newPin, salt),
      PinSalt: salt,
      Note: /กรุณาเปลี่ยนรหัสผ่านทันที/.test(emp.Note || '') ? '' : emp.Note
    });
    return apiOk(true);
  } catch (e) {
    return apiError(e.message);
  }
}

/** แอดมินตั้งรหัสผ่านใหม่ให้พนักงาน (ใช้ตอนลืมรหัส) — รีเซ็ตกลับเป็นเลขบัตร ปชช. 6 หลักท้าย ถ้าไม่ระบุ */
function adminResetPin(token, employeeId, newPin) {
  try {
    requireAuth_(token, ['admin']);
    var emp = findOne_(SHEET_NAMES.EMPLOYEES, 'EmployeeID', employeeId);
    if (!emp) return apiError('ไม่พบพนักงาน');
    var pin = newPin || (emp.CitizenID ? String(emp.CitizenID).slice(-6) : '123456');
    var salt = Utilities.getUuid();
    updateRowByIndex_(SHEET_NAMES.EMPLOYEES, emp._row, {
      PinHash: hashPin_(pin, salt),
      PinSalt: salt,
      Note: 'รีเซ็ตรหัสผ่านโดยแอดมิน กรุณาเปลี่ยนรหัสผ่านทันที'
    });
    return apiOk({ newPin: pin });
  } catch (e) {
    return apiError(e.message);
  }
}
