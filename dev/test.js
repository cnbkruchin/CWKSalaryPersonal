/**
 * test.js — ทดสอบอัตโนมัติของตรรกะหลังบ้าน (รันโค้ด .gs จริงผ่าน gas-runtime.js)
 * วิธีรัน:  node dev/test.js
 */
const assert = require('assert');
const { createRuntime } = require('./gas-runtime');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failures.push(name); console.log('  ✗ ' + name + '\n      ' + e.message); }
}
const ok = (res) => { assert.strictEqual(res.ok, true, 'expected ok, got error: ' + res.error); return res.data; };
const fails = (res, pattern) => { assert.strictEqual(res.ok, false, 'expected failure'); if (pattern) assert.match(res.error, pattern); return res.error; };

function thaiId(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += +first12[i] * (13 - i);
  return first12 + ((11 - (sum % 11)) % 10);
}

function bootstrap() {
  const rt = createRuntime();
  rt.call('initializeSystem');
  let admin = ok(rt.call('adminLogin', 'admin', '123456'));
  ok(rt.call('changeMyPin', admin.token, '123456', 'Admin@2569'));
  admin = ok(rt.call('adminLogin', 'admin', 'Admin@2569'));
  return { rt, token: admin.token };
}

function addEmp(rt, token, id, salary, extra) {
  return ok(rt.call('addEmployee', token, Object.assign({
    employeeId: id, prefixName: 'นาย', firstName: 'ทดสอบ' + id, lastName: 'ระบบ', group: 'เจ้าหน้าที่',
    position: 'เจ้าหน้าที่ธุรการ', hasSSO: true, bankName: 'กรุงไทย', bankAccountNo: '020229452329',
    citizenID: thaiId('110000000' + id.slice(-3)), baseSalary: salary, startMonth: '2026-01'
  }, extra || {})));
}

function employeeSession(rt, id, initialPin, newPin) {
  const s = ok(rt.call('employeeLogin', id, initialPin));
  assert.strictEqual(s.mustChangePin, true);
  assert.strictEqual(s.needsPdpa, true);
  ok(rt.call('acceptPdpa', s.token));
  ok(rt.call('changeMyPin', s.token, initialPin, newPin));
  return s.token;
}

console.log('\nการยืนยันตัวตนและความปลอดภัย');
test('admin เริ่มต้นต้องเปลี่ยนรหัส และรหัสผ่านอ่อนถูกปฏิเสธ', () => {
  const rt = createRuntime();
  rt.call('initializeSystem');
  const s = ok(rt.call('adminLogin', 'admin', '123456'));
  assert.strictEqual(s.mustChangePin, true);
  fails(rt.call('changeMyPin', s.token, '123456', 'short'), /8 ตัวอักษร/);
  fails(rt.call('changeMyPin', s.token, '123456', '12345678'), /ตัวเลขล้วน/);
  ok(rt.call('changeMyPin', s.token, '123456', 'Admin@2569'));
  assert.strictEqual(ok(rt.call('adminLogin', 'admin', 'Admin@2569')).mustChangePin, false);
});

test('หน้าบ้าน/หลังบ้านแยกสิทธิ์: ลูกจ้างเข้าหลังบ้านไม่ได้ และ admin เข้าหน้าบ้านไม่ได้', () => {
  const { rt, token } = bootstrap();
  const e = addEmp(rt, token, 'Cwk001', 12000);
  fails(rt.call('adminLogin', 'Cwk001', e.initialPin), /ไม่มีสิทธิ์/);
  fails(rt.call('employeeLogin', 'admin', 'Admin@2569'), /ผู้ดูแลระบบ/);
  const emp = ok(rt.call('employeeLogin', 'Cwk001', e.initialPin));
  fails(rt.call('listEmployees', emp.token), /ไม่มีสิทธิ์/);
  fails(rt.call('getMyPayslip', token, '2026-09'), /ไม่มีสิทธิ์/);
});

test('ข้อความ error เหมือนกันทั้งกรณีไม่มีรหัสพนักงานและรหัสผิด (กันการเดาชื่อผู้ใช้)', () => {
  const { rt, token } = bootstrap();
  addEmp(rt, token, 'Cwk001', 12000);
  const a = fails(rt.call('employeeLogin', 'Cwk999', '000000'));
  const b = fails(rt.call('employeeLogin', 'Cwk001', '000000'));
  assert.strictEqual(a, b);
});

test('ใส่ PIN ผิด 5 ครั้งถูกล็อก และ admin รีเซ็ตแล้วปลดล็อก', () => {
  const { rt, token } = bootstrap();
  const e = addEmp(rt, token, 'Cwk001', 12000);
  for (let i = 0; i < 5; i++) fails(rt.call('employeeLogin', 'Cwk001', '000000'));
  fails(rt.call('employeeLogin', 'Cwk001', e.initialPin), /ล็อก/);
  const reset = ok(rt.call('adminResetPin', token, 'Cwk001'));
  assert.match(reset.newPin, /^\d{6}$/);
  assert.strictEqual(ok(rt.call('employeeLogin', 'Cwk001', reset.newPin)).mustChangePin, true);
});

test('นโยบาย PIN ลูกจ้าง: 6 หลัก ห้ามเรียง ห้ามซ้ำ ห้ามตรงเลขบัตร', () => {
  const { rt, token } = bootstrap();
  const e = addEmp(rt, token, 'Cwk001', 12000);
  const s = ok(rt.call('employeeLogin', 'Cwk001', e.initialPin));
  fails(rt.call('changeMyPin', s.token, e.initialPin, '12345'), /6 หลัก/);
  fails(rt.call('changeMyPin', s.token, e.initialPin, '123456'), /เรียงกัน/);
  fails(rt.call('changeMyPin', s.token, e.initialPin, '777777'), /ซ้ำกัน/);
  fails(rt.call('changeMyPin', s.token, e.initialPin, e.initialPin), /ไม่ซ้ำ/);
  ok(rt.call('changeMyPin', s.token, e.initialPin, '482915'));
});

console.log('\nการจัดเก็บข้อมูลใน Google Sheet');
test('เลขบัญชีขึ้นต้นด้วย 0 ไม่หาย และเดือนยังเป็นข้อความ (Sheets ไม่แปลงเอง)', () => {
  const { rt, token } = bootstrap();
  addEmp(rt, token, 'Cwk001', 12000, { startDate: '2023-05-01' });
  const list = ok(rt.call('listEmployees', token, false));
  const emp = list.find((x) => x.employeeId === 'Cwk001');
  assert.strictEqual(emp.bankAccountNo, '020229452329');
  assert.strictEqual(emp.startDate, '2023-05-01');
  ok(rt.call('getOrCreatePayrollRun', token, '2026-09'));
  const month = rt.sheet('PayrollRuns').getRange(2, 1, 1, 1).getValues()[0][0];
  assert.strictEqual(month, '2026-09');
});

test('ชีตเก่าที่คอลัมน์เรียงต่างกัน/ขาดคอลัมน์ ถูกอัปเกรดและเขียนข้อมูลลงคอลัมน์ถูกต้อง', () => {
  const { rt, token } = bootstrap();
  const s = rt.sheet('Settings');
  // จำลองชีตรุ่นเก่า: สลับลำดับคอลัมน์
  s.data = s.data.map((row) => [row[1], row[0]]);
  s.data[0] = ['Value', 'Key'];
  ok(rt.call('updateSettings', token, { SchoolName: 'โรงเรียนทดสอบ' }));
  const rows = s.getRange(2, 1, s.getLastRow() - 1, 2).getValues();
  assert.ok(rows.some((r) => r[1] === 'SchoolName' && r[0] === 'โรงเรียนทดสอบ'));
  const emp = rt.sheet('Employees');
  emp.data[0] = emp.data[0].filter((h) => h !== 'LastLoginAt');
  addEmp(rt, token, 'Cwk001', 12000);
  const e = addEmp(rt, token, 'Cwk002', 12000);
  ok(rt.call('employeeLogin', 'Cwk002', e.initialPin));
  assert.ok(emp.data[0].includes('LastLoginAt'));
});

test('ตรวจเลขบัตรประชาชนด้วย check digit', () => {
  const { rt, token } = bootstrap();
  fails(rt.call('addEmployee', token, { employeeId: 'Cwk010', firstName: 'ก', citizenID: '1100000000001' }), /check digit/);
  fails(rt.call('addEmployee', token, { employeeId: 'Cwk010', firstName: 'ก', bankAccountNo: '12-34' }), /เลขที่บัญชี/);
  ok(rt.call('addEmployee', token, { employeeId: 'Cwk010', firstName: 'ก', citizenID: thaiId('110000000010') }));
});

console.log('\nรอบจ่ายเงินเดือน');
test('สร้างรอบจ่าย: ปกส. 5% มีเพดาน 15,000 และไม่รวมบัญชีผู้ดูแลระบบ', () => {
  const { rt, token } = bootstrap();
  addEmp(rt, token, 'Cwk001', 12050);
  addEmp(rt, token, 'Cwk002', 29450);
  addEmp(rt, token, 'Cwk003', 8000, { hasSSO: false });
  const run = ok(rt.call('getOrCreatePayrollRun', token, '2026-09'));
  assert.strictEqual(run.lines.length, 3);
  const by = Object.fromEntries(run.lines.map((l) => [l.employeeId, l]));
  assert.strictEqual(by.Cwk001.ssoEmployee, 603);
  assert.strictEqual(by.Cwk002.ssoEmployee, 750);
  assert.strictEqual(by.Cwk003.ssoEmployee, 0);
  assert.strictEqual(by.Cwk001.netPay, 12050 - 603);
});

test('แก้ไขรายรับ/หักอื่นๆ คำนวณยอดใหม่ และลูกจ้างเห็นสลิปหลังอนุมัติเท่านั้น', () => {
  const { rt, token } = bootstrap();
  const e = addEmp(rt, token, 'Cwk001', 12050);
  const emp = employeeSession(rt, 'Cwk001', e.initialPin, '482915');
  ok(rt.call('getOrCreatePayrollRun', token, '2026-09'));
  ok(rt.call('updatePayrollLine', token, '2026-09', 'Cwk001', { positionAllowance: 1000, onDutyPay: 600 }));
  ok(rt.call('addPayrollDeduction', token, '2026-09', 'Cwk001', 'เงินยืม', 'คืนเงินยืม', 2700));
  fails(rt.call('getMyPayslip', emp, '2026-09'), /ยังไม่มีสลิป/);
  ok(rt.call('approvePayrollRun', token, '2026-09'));
  const slip = ok(rt.call('getMyPayslip', emp, '2026-09'));
  assert.strictEqual(slip.grossPay, 13650);
  assert.strictEqual(slip.totalDeduction, 603 + 2700);
  assert.strictEqual(slip.netPay, 13650 - 3303);
  assert.match(slip.verifyCode, /^CWK-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  fails(rt.call('updatePayrollLine', token, '2026-09', 'Cwk001', { onDutyPay: 1 }), /อนุมัติแล้ว/);
  fails(rt.call('reopenPayrollRun', token, '2026-09', ''), /เหตุผล/);
  ok(rt.call('reopenPayrollRun', token, '2026-09', 'แก้ค่าเวร'));
});

test('ห้ามอนุมัติเมื่อมียอดสุทธิติดลบ และห้ามกรอกจำนวนติดลบ', () => {
  const { rt, token } = bootstrap();
  addEmp(rt, token, 'Cwk001', 1000);
  ok(rt.call('getOrCreatePayrollRun', token, '2026-09'));
  fails(rt.call('updatePayrollLine', token, '2026-09', 'Cwk001', { onDutyPay: -5 }), /ตั้งแต่ 0/);
  ok(rt.call('addPayrollDeduction', token, '2026-09', 'Cwk001', 'อื่นๆ', 'ทดสอบ', 5000));
  fails(rt.call('approvePayrollRun', token, '2026-09'), /ติดลบ/);
});

test('ลูกจ้างบรรจุใหม่ถูกเพิ่มเข้ารอบจ่ายแบบร่างอัตโนมัติ', () => {
  const { rt, token } = bootstrap();
  addEmp(rt, token, 'Cwk001', 10000);
  ok(rt.call('getOrCreatePayrollRun', token, '2026-09'));
  addEmp(rt, token, 'Cwk002', 9000);
  assert.strictEqual(ok(rt.call('getOrCreatePayrollRun', token, '2026-09')).lines.length, 2);
});

console.log('\nเลื่อนขั้นและตกเบิก');
test('เลื่อนขั้นย้อนหลัง: สร้างตกเบิกเฉพาะเดือนที่อนุมัติแล้ว และปรับรอบแบบร่างทันที', () => {
  const { rt, token } = bootstrap();
  addEmp(rt, token, 'Cwk001', 10000);
  ['2026-07', '2026-08'].forEach((m) => { ok(rt.call('getOrCreatePayrollRun', token, m)); ok(rt.call('approvePayrollRun', token, m)); });
  ok(rt.call('getOrCreatePayrollRun', token, '2026-09'));
  const r = ok(rt.call('addSalaryAdjustment', token, { employeeId: 'Cwk001', effectiveMonth: '2026-07', baseSalary: 10500, changeType: 'เลื่อนขั้น' }));
  assert.strictEqual(r.backPayMonths, 2);
  assert.strictEqual(r.backPayTotal, 1000);
  const sep = ok(rt.call('getPayrollRun', token, '2026-09')).lines[0];
  assert.strictEqual(sep.baseSalary, 10500);
  assert.strictEqual(sep.ssoEmployee, 525);
  ok(rt.call('applyPendingBackPay', token, '2026-09', 'Cwk001'));
  const after = ok(rt.call('getPayrollRun', token, '2026-09')).lines[0];
  assert.strictEqual(after.backPay, 1000);
  assert.strictEqual(after.pendingBackPay.count, 0);
  fails(rt.call('applyPendingBackPay', token, '2026-09', 'Cwk001'), /ไม่มีรายการ/);
});

test('ปรับเงินเดือนย้อนหลังซ้อนกัน 2 ครั้ง ไม่จ่ายตกเบิกซ้ำ', () => {
  const { rt, token } = bootstrap();
  addEmp(rt, token, 'Cwk001', 10000);
  ['2026-07', '2026-08'].forEach((m) => { ok(rt.call('getOrCreatePayrollRun', token, m)); ok(rt.call('approvePayrollRun', token, m)); });
  ok(rt.call('addSalaryAdjustment', token, { employeeId: 'Cwk001', effectiveMonth: '2026-07', baseSalary: 10500 }));
  const second = ok(rt.call('addSalaryAdjustment', token, { employeeId: 'Cwk001', effectiveMonth: '2026-08', baseSalary: 10800 }));
  assert.strictEqual(second.backPayTotal, 300);
  const q = ok(rt.call('listBackPayQueue', token, 'Cwk001', 'pending'));
  assert.strictEqual(q.reduce((s, x) => s + x.totalBackPay, 0), 1300);
});

test('ปรับย้อนหลังก่อนการปรับที่มีอยู่ ไม่คิดตกเบิกเกินช่วงของอัตรานั้น', () => {
  const { rt, token } = bootstrap();
  addEmp(rt, token, 'Cwk001', 10000);
  ['2026-07', '2026-08'].forEach((m) => { ok(rt.call('getOrCreatePayrollRun', token, m)); ok(rt.call('approvePayrollRun', token, m)); });
  ok(rt.call('addSalaryAdjustment', token, { employeeId: 'Cwk001', effectiveMonth: '2026-08', baseSalary: 11000 }));
  const earlier = ok(rt.call('addSalaryAdjustment', token, { employeeId: 'Cwk001', effectiveMonth: '2026-07', baseSalary: 10500 }));
  assert.strictEqual(earlier.backPayTotal, 500);
});

console.log('\nรายงาน ตรวจสอบสลิป และประวัติการใช้งาน');
test('ตรวจสอบสลิปจากรหัส QR: รหัสจริงผ่าน รหัสปลอมไม่ผ่าน และปิดบังนามสกุล', () => {
  const { rt, token } = bootstrap();
  const e = addEmp(rt, token, 'Cwk001', 12050);
  const emp = employeeSession(rt, 'Cwk001', e.initialPin, '482915');
  ok(rt.call('getOrCreatePayrollRun', token, '2026-09'));
  ok(rt.call('approvePayrollRun', token, '2026-09'));
  const slip = ok(rt.call('getMyPayslip', emp, '2026-09'));
  assert.ok(slip.verifyUrl.includes('?verify='));
  const v = ok(rt.call('verifyPayslip', slip.verifyCode.toLowerCase()));
  assert.strictEqual(v.valid, true);
  assert.strictEqual(v.netPay, slip.netPay);
  assert.ok(!v.name.includes('ระบบ'));
  assert.strictEqual(ok(rt.call('verifyPayslip', 'CWK-0000-0000-0000')).valid, false);
  assert.strictEqual(ok(rt.call('verifyPayslip', '<script>')).valid, false);
});

test('สรุปรายปี, ข้อมูลส่วนตัวแบบปิดบัง, แดชบอร์ด และบันทึกประวัติการใช้งาน', () => {
  const { rt, token } = bootstrap();
  const e = addEmp(rt, token, 'Cwk001', 10000);
  const emp = employeeSession(rt, 'Cwk001', e.initialPin, '482915');
  ['2026-07', '2026-08'].forEach((m) => { ok(rt.call('getOrCreatePayrollRun', token, m)); ok(rt.call('approvePayrollRun', token, m)); });
  const y = ok(rt.call('getMyAnnualSummary', emp, '2026'));
  assert.strictEqual(y.rows.length, 2);
  assert.strictEqual(y.totals.grossPay, 20000);
  assert.strictEqual(y.yearBE, 2569);
  const p = ok(rt.call('getMyProfile', emp));
  assert.strictEqual(p.bankAccountMasked, '••••••••2329');
  const d = ok(rt.call('getAdminDashboard', token));
  assert.strictEqual(d.activeEmployees, 1);
  assert.strictEqual(d.trend.length, 2);
  const log = ok(rt.call('listAuditLog', token, '', 100));
  ['LOGIN', 'ADD_EMPLOYEE', 'PDPA_ACCEPT', 'CHANGE_PIN', 'CREATE_RUN', 'APPROVE_RUN'].forEach((a) => {
    assert.ok(log.some((l) => l.action === a), 'missing audit ' + a);
  });
  const memo = ok(rt.call('getApprovalMemo', token, '2026-08'));
  assert.strictEqual(memo.lines[0].amount, 10000 - 500);
  assert.strictEqual(ok(rt.call('getBankTransferList', token, '2026-08')).list[0].bankAccountNo, '020229452329');
});

console.log('\n' + passed + ' ผ่าน, ' + failures.length + ' ไม่ผ่าน');
process.exit(failures.length ? 1 : 0);
