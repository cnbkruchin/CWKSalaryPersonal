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
  const docs = ok(rt.call('getDisbursementDocs', token, '2026-08'));
  assert.strictEqual(docs.memoLines[0].amount, 10000 - 500);
  assert.strictEqual(docs.lines[0].bankAccountNo, '020229452329');
});

console.log('\nวันที่จ่ายเงินเดือน');
test('อนุมัติพร้อมระบุวันที่จ่าย, ค่าตั้งต้นเป็นวันทำการสุดท้าย, แก้วันที่จ่ายได้เฉพาะรอบที่อนุมัติ', () => {
  const { rt, token } = bootstrap();
  const e = addEmp(rt, token, 'Cwk001', 10000);
  const emp = employeeSession(rt, 'Cwk001', e.initialPin, '482915');
  const may = ok(rt.call('getOrCreatePayrollRun', token, '2026-05'));
  assert.strictEqual(may.defaultPaidDate, '2026-05-29');
  fails(rt.call('setPayrollPaidDate', token, '2026-05', '2026-05-28'), /เฉพาะรอบที่อนุมัติ/);
  fails(rt.call('approvePayrollRun', token, '2026-05', '2026-02-30'), /วันที่จ่ายไม่ถูกต้อง/);
  ok(rt.call('approvePayrollRun', token, '2026-05', '2026-05-27'));
  assert.strictEqual(ok(rt.call('getMyPayslip', emp, '2026-05')).paidDate, '2026-05-27');
  ok(rt.call('setPayrollPaidDate', token, '2026-05', '2026-05-28'));
  assert.strictEqual(ok(rt.call('getPayrollRun', token, '2026-05')).paidDate, '2026-05-28');
  ok(rt.call('getOrCreatePayrollRun', token, '2026-06'));
  ok(rt.call('approvePayrollRun', token, '2026-06'));
  assert.strictEqual(ok(rt.call('getPayrollRun', token, '2026-06')).paidDate, '2026-06-30');
});

console.log('\nนำเข้าข้อมูลย้อนหลังจาก Excel');
// ชีตจำลองที่จัดวางแบบเดียวกับไฟล์ "เงินเดือน" ของโรงเรียน (ชื่อสมมติ ตัวเลขจากไฟล์ตัวอย่าง)
const SALARY_SHEET = [
  [],
  ['หลักฐานการจ่ายค่าจ้างสอนและค่าจ้างอื่นของบุคลากรทางการศึกษา  โรงเรียนจุนวิทยาคม'],
  ['ประจำเดือนกันยายน 2569 ประจำปีงบประมาณ 2569 (ตั้งแต่วันที่ 1 ตุลาคม พ.ศ. 2568 ถึง 30 กันยายน พ.ศ. 2569)'],
  ['ลำดับ', 'ชื่อ-สกุล', '', 'รายรับ', '', '', '', '', 'รายจ่าย', '', '', '', 'คงเหลือ', 'สมทบ ปกส. ร.ร.', 'สมทบ ทดแทน ร.ร.', 'ลายมือชื่อ', 'หมายเลขบัญชี'],
  ['', '', '', 'เงินเดือน', 'ปรับฐาน', 'เงินเพิ่มพิเศษ', ' (ตกเบิก เม.ย)', 'รวมรับ', 'ปกส.', 'กองทุนเงินทดแทน', 'อื่นๆ', 'รวมหัก', '', '', '', '', ''],
  [1, 'นายสมชาย', 'ใจดี', 12050, '', 1000, '', 13050, 603, 0, 2700, 3303, 9747, 603, '', '', '020229452329'],
  [2, 'Mr.John', 'Smith', 29450, '', '', '', 29450, 875, 0, 0, 875, 28575, 875, '', '', '020361080680'],
  [3, 'นางสาวสมหญิง ', 'รักเรียน', 10300, '', '', '', 10300, 0, 0, 200, 200, 10100, 0, '', '', '020235832456'],
  [4, 'ว่าที่พ.ต.วิชัย', 'ขยันงาน', 11950, '', '', '', 11950, 598, 0, 200, 798, 11152, 598, '', '', '020134503364'],
  ['รวม', '', '', 63750, 0, 1000, 0, 64750, 2076, 0, 3100, 5176, 59574, 2076, 0],
  [],
  ['', '**หมายเหตุ**', '1.ค่าจ้างรายเดือน (เงินเดือน+ปรับฐาน)', '', '', '', 63750, 'บาท']
];

function importAll(rt, token, sheets, month, paidDate, extra) {
  const pv = ok(rt.call('previewPayrollImport', token, { sheets }));
  const assignments = {};
  pv.lines.forEach((l) => { if (!l.match) assignments[l.rowNo] = '__new__'; });
  return { pv, res: rt.call('commitPayrollImport', token, Object.assign({ sheets, sheetIndex: pv.sheetIndex, fileName: 'test.xlsx', month: month || pv.month, paidDate, assignments }, extra || {})) };
}

test('อ่านไฟล์แบบ "เงินเดือน": หัวตาราง 2 แถว, ชื่อ-สกุล 2 คอลัมน์, คำนำหน้า, เดือนจากหัวเอกสาร, หยุดที่แถวรวม', () => {
  const { rt, token } = bootstrap();
  const pv = ok(rt.call('previewPayrollImport', token, { sheets: [{ name: 'เงินเดือน', rows: SALARY_SHEET }] }));
  assert.strictEqual(pv.month, '2026-09');
  assert.strictEqual(pv.headerRow, 4);
  assert.strictEqual(pv.lines.length, 4);
  assert.deepStrictEqual(pv.lines.map((l) => l.prefix + '|' + l.firstName + '|' + l.lastName),
    ['นาย|สมชาย|ใจดี', 'Mr.|John|Smith', 'นางสาว|สมหญิง|รักเรียน', 'ว่าที่พ.ต.|วิชัย|ขยันงาน']);
  assert.strictEqual(pv.totals.net, 59574);
  assert.ok(pv.lines.every((l) => !l.warnings.length));
  assert.strictEqual(pv.defaultPaidDate, '2026-09-30');
});

test('นำเข้าแล้วได้รอบจ่ายที่อนุมัติ วันที่จ่ายตามที่ระบุ ยอดตามไฟล์ และเอกสารเบิกจ่ายกระทบยอดตรงกัน', () => {
  const { rt, token } = bootstrap();
  const { res } = importAll(rt, token, [{ name: 'เงินเดือน', rows: SALARY_SHEET }], null, '2026-09-30');
  const r = ok(res);
  assert.strictEqual(r.imported, 4);
  assert.deepStrictEqual(r.created.map((c) => c.employeeId), ['Cwk001', 'Cwk002', 'Cwk003', 'Cwk004']);
  const run = ok(rt.call('getPayrollRun', token, '2026-09'));
  assert.strictEqual(run.status, 'approved');
  assert.strictEqual(run.paidDate, '2026-09-30');
  const john = run.lines.find((l) => l.fullName.includes('John'));
  assert.strictEqual(john.ssoEmployee, 875); // ใช้ยอดจากไฟล์ ไม่คำนวณใหม่ตามเพดาน
  assert.strictEqual(john.bankAccountNo, '020361080680');
  const d = ok(rt.call('getDisbursementDocs', token, '2026-09'));
  assert.strictEqual(d.summary.grandTotal, 63750 + 1000 + 2076);
  assert.strictEqual(d.totals.netPay, 59574);
  assert.strictEqual(d.summary.reconciles, true);
  assert.strictEqual(d.memoLines.reduce((s, l) => s + l.amount, 0), d.summary.grandTotal);
  assert.strictEqual(d.paidDateLabel, '30 กันยายน พ.ศ. 2569');
  assert.match(d.fiscalRangeText, /1 ตุลาคม พ.ศ. 2568 ถึง 30 กันยายน พ.ศ. 2569/);
  const history = ok(rt.call('listSalaryHistory', token, 'Cwk001'));
  assert.strictEqual(history[0].baseSalary, 12050);
});

test('นำเข้าซ้ำเดือนเดิมต้องเลือกแทนที่ และแทนที่แล้วไม่มีข้อมูลซ้ำ', () => {
  const { rt, token } = bootstrap();
  const sheets = [{ name: 'เงินเดือน', rows: SALARY_SHEET }];
  ok(importAll(rt, token, sheets, null, '2026-09-30').res);
  fails(importAll(rt, token, sheets, null, '2026-09-30').res, /แทนที่ข้อมูลเดิม/);
  ok(importAll(rt, token, sheets, null, '2026-09-29', { replace: true }).res);
  const run = ok(rt.call('getPayrollRun', token, '2026-09'));
  assert.strictEqual(run.lines.length, 4);
  assert.strictEqual(run.paidDate, '2026-09-29');
  const docs = ok(rt.call('getDisbursementDocs', token, '2026-09'));
  assert.strictEqual(docs.categorySums['อื่นๆ'], 3100);
});

test('ไฟล์แบบ SlipSheet: เดือนจากปี พ.ศ. ในช่องวันที่, จับคู่ด้วยรหัสเมื่อชื่อตรง, รหัสขัดแย้งถูกเตือนและจับคู่ด้วยชื่อแทน', () => {
  const { rt, token } = bootstrap();
  ok(importAll(rt, token, [{ name: 'เงินเดือน', rows: SALARY_SHEET }], null, '2026-09-30').res);
  const slip = [
    ['ลำดับ', 'ประจำเดือน', 'รหัสพนักงาน', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'เงินเดือน', 'เงินประจำตำแหน่ง', 'ค่าขึ้นเวร', 'รับอื่นๆ', 'รวมรับ',
      'ประกันสังคม', 'กองทุนทดแทน', 'หักอื่นๆ', 'รวมหัก', 'คงเหลือ', 'นายจ้างสมทบประกันสังคม', 'หมายเลขบัญชี', 'ชื่อตำแหน่ง', 'หมายเหตุ1', 'สุทธิตัวอักษร'],
    [1, '2568-06-28', 'Cwk001', 'นาย', 'สมชาย', 'ใจดี', 11200, 0, 0, '-', 11200, 560, 0, 0, 560, 10640, 560, '020229452329', 'ครูอัตราจ้าง', '- ประกันสังคม 5 %', '(...)'],
    [2, '2568-06-28', 'Cwk002', 'นางสาว', 'สมหญิง', 'รักเรียน', 9500, 0, 0, '-', 9500, '-', 0, 0, 0, 9500, '-', '020235832456', 'เจ้าหน้าที่', '', ''],
    [3, '2568-06-28', 'Cwk050', 'นาง', 'มาลี', 'สวยงาม', 9000, 0, 300, '-', 9300, '-', 0, 0, 0, 9999, '-', '020999999999', 'แม่บ้าน', '', '']
  ];
  const pv = ok(rt.call('previewPayrollImport', token, { sheets: [{ name: 'SlipSheet', rows: slip }] }));
  assert.strictEqual(pv.month, '2025-06');
  const [a, b, c] = pv.lines;
  assert.strictEqual(a.match.employeeId, 'Cwk001');
  assert.strictEqual(a.match.by, 'รหัสพนักงาน');
  assert.strictEqual(b.match.employeeId, 'Cwk003');
  assert.ok(b.warnings.some((w) => /ไม่ใช่คนในแถวนี้/.test(w)));
  assert.strictEqual(c.match, null);
  assert.ok(c.warnings.some((w) => /คงเหลือในไฟล์/.test(w)));
  const res = ok(rt.call('commitPayrollImport', token, { sheets: [{ name: 'SlipSheet', rows: slip }], month: '2025-06', paidDate: '2025-06-30',
    assignments: { 4: '__new__' }, newEmployeeStatus: 'inactive' }));
  assert.deepStrictEqual(res.created.map((x) => x.employeeId), ['Cwk050']);
  const all = ok(rt.call('listEmployees', token, true));
  assert.strictEqual(all.find((x) => x.employeeId === 'Cwk050').status, 'inactive');
  const june = ok(rt.call('getPayrollRun', token, '2025-06'));
  assert.strictEqual(june.lines.find((l) => l.employeeId === 'Cwk050').onDutyPay, 300);
});

test('นำเข้า: ห้ามเลือกลูกจ้างซ้ำ 2 แถว และต้องเลือกแถวที่จับคู่ไม่ได้', () => {
  const { rt, token } = bootstrap();
  const sheets = [{ name: 'เงินเดือน', rows: SALARY_SHEET }];
  fails(rt.call('commitPayrollImport', token, { sheets, month: '2026-09', paidDate: '2026-09-30', assignments: {} }), /ยังไม่ได้เลือกลูกจ้าง/);
  ok(importAll(rt, token, sheets, null, '2026-09-30').res);
  fails(rt.call('commitPayrollImport', token, { sheets, month: '2026-08', paidDate: '2026-08-31', assignments: { 7: 'Cwk001' } }), /ถูกเลือกซ้ำ/);
});

console.log('\n' + passed + ' ผ่าน, ' + failures.length + ' ไม่ผ่าน');
process.exit(failures.length ? 1 : 0);
