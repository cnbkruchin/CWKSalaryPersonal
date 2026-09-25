/**
 * Auth.gs — การยืนยันตัวตน แยก 2 ทางเข้า
 *   หน้าบ้าน (ลูกจ้าง): รหัสพนักงาน + PIN 6 หลัก  → session สิทธิ์ 'employee' ดูได้เฉพาะข้อมูลตัวเอง
 *   หลังบ้าน (เจ้าหน้าที่): รหัสผู้ใช้ + รหัสผ่าน ≥ 8 ตัวอักษร (เฉพาะบัญชี Role=admin) → session สิทธิ์ 'admin'
 * session token เก็บใน CacheService (หมดอายุอัตโนมัติ ต่ออายุเมื่อมีการใช้งาน)
 */

var SESSION_CACHE_PREFIX = 'sess_';
var FAIL_CACHE_PREFIX = 'fail_';
var MAX_FAILED_ATTEMPTS = 5;
var LOCKOUT_SECONDS = 15 * 60;
var EMPLOYEE_SESSION_SECONDS = 30 * 60;
var MUST_CHANGE_PIN_NOTE = 'กรุณาเปลี่ยนรหัสผ่านทันที';
var GENERIC_LOGIN_ERROR = 'รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง';

function hashPin_(pin, salt) {
  var pepper = getSetting_('AuthPepper', '');
  var raw = String(pin) + ':' + String(salt) + ':' + pepper;
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return bytesToHex_(digest);
}

function bytesToHex_(bytes) {
  return bytes.map(function (b) { return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'); }).join('');
}

function isTrue_(v) {
  return v === true || v === 'TRUE' || v === 'true';
}

function needsPinChange_(emp) {
  return isTrue_(emp.MustChangePin) || /กรุณาเปลี่ยนรหัสผ่านทันที/.test(emp.Note || '');
}

function fullNameOf_(emp) {
  return (emp.PrefixName || '') + (emp.FirstName || '') + ' ' + (emp.LastName || '');
}

/** นโยบายรหัสผ่าน: ลูกจ้างใช้ PIN ตัวเลข 6 หลักที่เดายาก, ผู้ดูแลระบบใช้รหัสผ่านอย่างน้อย 8 ตัวอักษร */
function validateNewSecret_(emp, secret) {
  secret = String(secret || '');
  if (emp.Role === 'admin') {
    if (secret.length < 8) return 'รหัสผ่านผู้ดูแลระบบต้องมีอย่างน้อย 8 ตัวอักษร';
    if (/^\d+$/.test(secret)) return 'รหัสผ่านผู้ดูแลระบบต้องมีตัวอักษรผสม ไม่ใช่ตัวเลขล้วน';
    return null;
  }
  if (!/^\d{6}$/.test(secret)) return 'PIN ต้องเป็นตัวเลข 6 หลัก';
  if (/^(\d)\1{5}$/.test(secret)) return 'PIN ห้ามเป็นตัวเลขซ้ำกันทั้งหมด';
  if ('0123456789'.indexOf(secret) !== -1 || '9876543210'.indexOf(secret) !== -1) return 'PIN ห้ามเป็นตัวเลขเรียงกัน';
  if (emp.CitizenID && String(emp.CitizenID).slice(-6) === secret) return 'PIN ห้ามตรงกับเลขบัตรประชาชน 6 หลักท้าย (ค่าเริ่มต้น)';
  return null;
}

function randomDigits_(n) {
  var s = '';
  while (s.length < n) s += Utilities.getUuid().replace(/\D/g, '');
  return s.substring(0, n);
}

function createSession_(emp, portal) {
  var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  var role = portal === 'admin' ? 'admin' : 'employee';
  var ttl = role === 'admin'
    ? Math.min((parseInt(getSetting_('SessionTimeoutMinutes', '480'), 10) || 480) * 60, 21600)
    : EMPLOYEE_SESSION_SECONDS;
  CacheService.getScriptCache().put(SESSION_CACHE_PREFIX + token, JSON.stringify({ employeeId: emp.EmployeeID, role: role, ttl: ttl }), ttl);
  return { token: token, role: role };
}

/** ตรวจรหัส + นับครั้งที่ผิด (ล็อก 15 นาทีเมื่อผิดครบ 5 ครั้ง) — ใช้ข้อความ error เดียวกันทุกกรณีเพื่อไม่ให้เดารหัสพนักงานได้ */
function authenticate_(employeeId, secret, portal) {
  var id = String(employeeId || '').trim();
  if (!id || !secret) return apiError('กรุณากรอกรหัสพนักงานและรหัสผ่าน');

  var cache = CacheService.getScriptCache();
  var failKey = FAIL_CACHE_PREFIX + id.toLowerCase();
  var fails = parseInt(cache.get(failKey) || '0', 10);
  if (fails >= MAX_FAILED_ATTEMPTS) {
    return apiError('ใส่รหัสผิดเกิน ' + MAX_FAILED_ATTEMPTS + ' ครั้ง บัญชีถูกล็อกชั่วคราว 15 นาที หรือติดต่อผู้ดูแลระบบเพื่อปลดล็อก');
  }

  var emp = findOne_(SHEET_NAMES.EMPLOYEES, 'EmployeeID', id);
  var ok = emp && emp.Status === 'active' && hashPin_(secret, emp.PinSalt) === emp.PinHash;
  if (!ok) {
    cache.put(failKey, String(fails + 1), LOCKOUT_SECONDS);
    audit_(id, '', 'LOGIN_FAILED', portal, 'attempt ' + (fails + 1));
    var left = MAX_FAILED_ATTEMPTS - fails - 1;
    return apiError(GENERIC_LOGIN_ERROR + (left > 0 && left <= 2 ? ' (เหลืออีก ' + left + ' ครั้งก่อนถูกล็อก)' : ''));
  }

  if (portal === 'admin' && emp.Role !== 'admin') {
    audit_(id, emp.Role, 'LOGIN_DENIED', portal, 'not an admin account');
    return apiError('บัญชีนี้ไม่มีสิทธิ์เข้าหน้าผู้ดูแลระบบ');
  }
  if (portal === 'employee' && emp.Role === 'admin') {
    return apiError('บัญชีผู้ดูแลระบบ กรุณาเข้าสู่ระบบทางหน้าผู้ดูแล');
  }

  cache.remove(failKey);
  var session = createSession_(emp, portal);
  withLock_(function () {
    var fresh = findOne_(SHEET_NAMES.EMPLOYEES, 'EmployeeID', id);
    updateRowByIndex_(SHEET_NAMES.EMPLOYEES, fresh._row, { LastLoginAt: nowIso() });
    audit_(id, session.role, 'LOGIN', portal, '');
  });

  return apiOk({
    token: session.token,
    employeeId: emp.EmployeeID,
    role: session.role,
    fullName: fullNameOf_(emp),
    firstName: emp.FirstName,
    mustChangePin: needsPinChange_(emp),
    needsPdpa: session.role === 'employee' && !emp.PdpaAcceptedAt
  });
}

/** หน้าบ้าน: ลูกจ้างเข้าสู่ระบบด้วยรหัสพนักงาน + PIN */
function employeeLogin(employeeId, pin) {
  try {
    return authenticate_(employeeId, pin, 'employee');
  } catch (e) {
    return apiError('เข้าสู่ระบบไม่สำเร็จ: ' + e.message);
  }
}

/** หลังบ้าน: เจ้าหน้าที่เข้าสู่ระบบด้วยรหัสผู้ใช้ + รหัสผ่าน */
function adminLogin(employeeId, password) {
  try {
    return authenticate_(employeeId, password, 'admin');
  } catch (e) {
    return apiError('เข้าสู่ระบบไม่สำเร็จ: ' + e.message);
  }
}

function logout(token) {
  try {
    var raw = CacheService.getScriptCache().get(SESSION_CACHE_PREFIX + token);
    if (raw) {
      var s = JSON.parse(raw);
      audit_(s.employeeId, s.role, 'LOGOUT', '', '');
    }
    CacheService.getScriptCache().remove(SESSION_CACHE_PREFIX + token);
  } catch (e) {
    // ออกจากระบบฝั่ง client ได้เสมอแม้ฝั่งเซิร์ฟเวอร์ผิดพลาด
  }
  return apiOk(true);
}

/** ตรวจ session token คืนค่า {employeeId, role} หรือ throw ถ้าไม่ผ่าน */
function requireAuth_(token, allowedRoles) {
  if (!token) throw new Error('กรุณาเข้าสู่ระบบ');
  var cache = CacheService.getScriptCache();
  var raw = cache.get(SESSION_CACHE_PREFIX + token);
  if (!raw) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  var session = JSON.parse(raw);
  if (allowedRoles && allowedRoles.indexOf(session.role) === -1) {
    throw new Error('ไม่มีสิทธิ์เข้าถึงส่วนนี้');
  }
  cache.put(SESSION_CACHE_PREFIX + token, raw, session.ttl || EMPLOYEE_SESSION_SECONDS);
  return session;
}

function whoAmI(token) {
  try {
    var session = requireAuth_(token, ['admin', 'employee']);
    var emp = findOne_(SHEET_NAMES.EMPLOYEES, 'EmployeeID', session.employeeId);
    if (!emp || emp.Status !== 'active') return apiError('ไม่พบข้อมูลผู้ใช้');
    return apiOk({
      employeeId: emp.EmployeeID,
      role: session.role,
      fullName: fullNameOf_(emp),
      firstName: emp.FirstName,
      mustChangePin: needsPinChange_(emp),
      needsPdpa: session.role === 'employee' && !emp.PdpaAcceptedAt
    });
  } catch (e) {
    return apiError(e.message);
  }
}

function changeMyPin(token, oldPin, newPin) {
  try {
    var session = requireAuth_(token, ['admin', 'employee']);
    return withLock_(function () {
      var emp = findOne_(SHEET_NAMES.EMPLOYEES, 'EmployeeID', session.employeeId);
      if (!emp) return apiError('ไม่พบข้อมูลผู้ใช้');
      if (hashPin_(oldPin, emp.PinSalt) !== emp.PinHash) return apiError('รหัสผ่านเดิมไม่ถูกต้อง');
      if (String(oldPin) === String(newPin)) return apiError('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม');
      var policyError = validateNewSecret_(emp, newPin);
      if (policyError) return apiError(policyError);
      var salt = Utilities.getUuid();
      updateRowByIndex_(SHEET_NAMES.EMPLOYEES, emp._row, {
        PinHash: hashPin_(newPin, salt),
        PinSalt: salt,
        MustChangePin: false,
        Note: /กรุณาเปลี่ยนรหัสผ่านทันที/.test(emp.Note || '') ? '' : emp.Note
      });
      audit_(session.employeeId, session.role, 'CHANGE_PIN', session.employeeId, '');
      return apiOk(true);
    });
  } catch (e) {
    return apiError(e.message);
  }
}

/** ลูกจ้างยอมรับประกาศความเป็นส่วนตัว (PDPA) ก่อนเข้าดูข้อมูลเงินเดือนครั้งแรก */
function acceptPdpa(token) {
  try {
    var session = requireAuth_(token, ['employee']);
    return withLock_(function () {
      var emp = findOne_(SHEET_NAMES.EMPLOYEES, 'EmployeeID', session.employeeId);
      if (!emp) return apiError('ไม่พบข้อมูลผู้ใช้');
      updateRowByIndex_(SHEET_NAMES.EMPLOYEES, emp._row, { PdpaAcceptedAt: nowIso() });
      audit_(session.employeeId, session.role, 'PDPA_ACCEPT', session.employeeId, '');
      return apiOk(true);
    });
  } catch (e) {
    return apiError(e.message);
  }
}

function getPdpaNotice() {
  try {
    var s = getSettings_();
    return apiOk({ schoolName: s.SchoolName, contact: s.DataControllerContact || s.SchoolName });
  } catch (e) {
    return apiError(e.message);
  }
}

/** แอดมินรีเซ็ตรหัสผ่านให้ (ลืมรหัส/ถูกล็อก): ตั้งรหัสชั่วคราวแบบสุ่ม ปลดล็อก และบังคับเปลี่ยนเมื่อเข้าใช้ครั้งถัดไป */
function adminResetPin(token, employeeId) {
  try {
    var session = requireAuth_(token, ['admin']);
    return withLock_(function () {
      var emp = findOne_(SHEET_NAMES.EMPLOYEES, 'EmployeeID', employeeId);
      if (!emp) return apiError('ไม่พบพนักงาน');
      var pin = emp.Role === 'admin' ? ('Tmp' + randomDigits_(7)) : randomDigits_(6);
      var salt = Utilities.getUuid();
      updateRowByIndex_(SHEET_NAMES.EMPLOYEES, emp._row, {
        PinHash: hashPin_(pin, salt),
        PinSalt: salt,
        MustChangePin: true
      });
      CacheService.getScriptCache().remove(FAIL_CACHE_PREFIX + String(employeeId).toLowerCase());
      audit_(session.employeeId, session.role, 'RESET_PIN', employeeId, '');
      return apiOk({ newPin: pin });
    });
  } catch (e) {
    return apiError(e.message);
  }
}
