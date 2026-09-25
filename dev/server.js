/**
 * server.js — พรีวิวระบบทั้งหน้าบ้านและหลังบ้านในเครื่อง โดยไม่ต้อง deploy ขึ้น Google
 * รันโค้ด .gs จริงผ่าน gas-runtime.js และเสิร์ฟ Index.html จริง (google.script.run ถูกส่งต่อผ่าน HTTP)
 *
 *   node dev/server.js            แล้วเปิด http://localhost:8080/exec
 *   หน้าบ้าน:   /exec              หลังบ้าน: /exec?page=admin
 * ข้อมูลเก็บในหน่วยความจำ (เริ่มใหม่ทุกครั้งที่รัน) พร้อมข้อมูลตัวอย่างจาก sample-data/
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createRuntime } = require('./gas-runtime');

const PORT = Number(process.env.PORT) || 8080;
const APP = path.join(__dirname, '..', 'apps-script');
const rt = createRuntime({ serviceUrl: 'http://localhost:' + PORT + '/exec' });
const demoPins = seedDemo(rt);

const SHIM = `<script>
(function () {
  function runner(ok, fail) {
    return new Proxy({}, { get: function (_, fn) {
      if (fn === 'withSuccessHandler') return function (f) { return runner(f, fail); };
      if (fn === 'withFailureHandler') return function (f) { return runner(ok, f); };
      return function () {
        var args = Array.prototype.slice.call(arguments);
        fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn: fn, args: args }) })
          .then(function (r) { return r.json(); })
          .then(function (r) { if (r.error) { fail && fail(new Error(r.error)); } else { ok && ok(r.result); } })
          .catch(function (e) { fail && fail(e); });
      };
    } });
  }
  window.google = { script: { run: runner(null, null) } };
})();
</script>`;

function renderIndex(query) {
  let mode = 'employee';
  let verifyCode = '';
  if (query.get('verify')) { mode = 'verify'; verifyCode = query.get('verify').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24); }
  else if (query.get('page') === 'admin') mode = 'admin';
  const config = JSON.stringify({ mode, verifyCode, appUrl: 'http://localhost:' + PORT + '/exec' }).replace(/</g, '\\u003c');
  return fs.readFileSync(path.join(APP, 'Index.html'), 'utf8')
    .replace(/<\?!= include\('(\w+)'\); \?>/g, (_, f) => fs.readFileSync(path.join(APP, f + '.html'), 'utf8'))
    .replace('<?!= appConfigJson ?>', config)
    .replace('<head>', '<head>' + SHIM);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/rpc') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let out;
      try {
        const { fn, args } = JSON.parse(body);
        out = { result: rt.call(fn, ...args) };
      } catch (e) {
        out = { error: e.message };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  if (url.pathname === '/' || url.pathname === '/exec') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderIndex(url.searchParams));
    return;
  }
  res.writeHead(404);
  res.end('not found');
}).listen(PORT, () => {
  console.log('พรีวิว: http://localhost:' + PORT + '/exec  (หลังบ้าน: ?page=admin)');
  console.log('หลังบ้าน  admin / Admin@2569');
  console.log('หน้าบ้าน  Cwk901 / PIN 482915 (ใช้งานแล้ว)');
  console.log('หน้าบ้าน  Cwk902 / PIN ชั่วคราว ' + demoPins.Cwk902 + ' (เข้าครั้งแรก: PDPA + ตั้ง PIN ใหม่)');
});

/** ข้อมูลตัวอย่าง: 4 คนจาก sample-data, รอบ ก.ค.–ส.ค. อนุมัติแล้ว, ก.ย. เป็นแบบร่าง, มีตกเบิกค้าง */
function seedDemo(rt) {
  const ok = (r) => { if (!r.ok) throw new Error(r.error); return r.data; };
  rt.call('initializeSystem');
  ok(rt.call('changeMyPin', ok(rt.call('adminLogin', 'admin', '123456')).token, '123456', 'Admin@2569'));
  const t = ok(rt.call('adminLogin', 'admin', 'Admin@2569')).token;
  ok(rt.call('updateSettings', t, { FinanceOfficerName: 'นางสาวตัวอย่าง ใจดี' }));

  const csv = fs.readFileSync(path.join(__dirname, '..', 'sample-data', 'employees_sample.csv'), 'utf8').trim().split('\n');
  const head = csv.shift().split(',');
  const pins = {};
  csv.forEach((line) => {
    const f = Object.fromEntries(line.split(',').map((v, i) => [head[i], v]));
    f.hasSSO = f.hasSSO === 'TRUE';
    f.startMonth = '2026-06';
    pins[f.employeeId] = ok(rt.call('addEmployee', t, f)).initialPin;
  });

  const s = ok(rt.call('employeeLogin', 'Cwk901', pins.Cwk901)).token;
  ok(rt.call('acceptPdpa', s));
  ok(rt.call('changeMyPin', s, pins.Cwk901, '482915'));

  ['2026-07', '2026-08'].forEach((m) => {
    ok(rt.call('getOrCreatePayrollRun', t, m));
    ok(rt.call('updatePayrollLine', t, m, 'Cwk901', { positionAllowance: 1000, onDutyPay: m === '2026-08' ? 900 : 600 }));
    ok(rt.call('addPayrollDeduction', t, m, 'Cwk904', 'เงินยืม', 'คืนเงินยืมสหกรณ์', 500));
    ok(rt.call('approvePayrollRun', t, m));
  });
  ok(rt.call('addSalaryAdjustment', t, { employeeId: 'Cwk902', effectiveMonth: '2026-08', baseSalary: 11000, changeType: 'เลื่อนขั้น', note: 'ขึ้นแล้ว 1 ส.ค.69' }));
  ok(rt.call('getOrCreatePayrollRun', t, '2026-09'));
  ok(rt.call('updatePayrollLine', t, '2026-09', 'Cwk901', { positionAllowance: 1000, onDutyPay: 300 }));
  pins.Cwk902 = ok(rt.call('adminResetPin', t, 'Cwk902')).newPin;
  return pins;
}
