/**
 * gas-runtime.js — จำลองบริการของ Google Apps Script ให้รันโค้ด .gs จริงบน Node.js ได้
 * ใช้สำหรับทดสอบอัตโนมัติ (dev/test.js) และพรีวิวหน้าเว็บในเครื่อง (dev/server.js)
 *
 * จุดสำคัญ: จำลองพฤติกรรม "แปลงค่าอัตโนมัติ" ของ Google Sheets ตอนเขียนข้อมูล
 * (ข้อความที่ดูเหมือนตัวเลข -> ตัวเลข, "2026-09" -> วันที่, ' นำหน้า -> บังคับเป็นข้อความ)
 * เพื่อให้การทดสอบจับปัญหาเลข 0 นำหน้าหาย / เดือนกลายเป็นวันที่ได้เหมือนของจริง
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const TZ = 'Asia/Bangkok';

function parseLikeSheets(v) {
  if (typeof v !== 'string') return v;
  if (v.startsWith("'")) return v.slice(1);
  if (v === '') return '';
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^TRUE$|^FALSE$/i.test(v)) return v.toUpperCase() === 'TRUE';
  let m = v.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +(m[3] || 1)) - 7 * 3600 * 1000); // เที่ยงคืนเวลาไทย
  return v;
}

class Range {
  constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr, nc }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) {
        const v = (this.sheet.data[this.row - 1 + r] || [])[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.nr || values.some((l) => l.length !== this.nc)) throw new Error('setValues: dimension mismatch');
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, parseLikeSheets(v))));
    return this;
  }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setNumberFormat() { return this; }
}

class Sheet {
  constructor(name) { this.name = name; this.data = []; }
  getName() { return this.name; }
  set(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    this.data[r - 1][c - 1] = v;
  }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some((v) => v !== '' && v !== undefined)) return i + 1;
    return 0;
  }
  getLastColumn() { return this.data.reduce((m, row) => Math.max(m, row ? row.length : 0), 0); }
  getRange(row, col, nr, nc) { return new Range(this, row, col, nr || 1, nc || 1); }
  appendRow(values) {
    const r = this.getLastRow() + 1;
    values.forEach((v, i) => this.set(r, i + 1, parseLikeSheets(v)));
    return this;
  }
  deleteRow(r) { this.data.splice(r - 1, 1); }
  setFrozenRows() { return this; }
}

class Spreadsheet {
  constructor(name) { this.id = crypto.randomUUID(); this.name = name; this.sheets = [new Sheet('Sheet1')]; }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets.slice(); }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
}

function signedBytes(buf) { return Array.from(buf).map((b) => (b > 127 ? b - 256 : b)); }

function formatDate(date, tz, pattern) {
  const parts = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: tz || TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
  return pattern.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss/g, (tok, lit) => {
    if (lit !== undefined) return lit;
    return { yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour, mm: parts.minute, ss: parts.second }[tok];
  });
}

function createRuntime(opts = {}) {
  const store = { spreadsheets: {}, props: {}, cache: {} };
  const serviceUrl = opts.serviceUrl || 'http://localhost:8080/exec';

  const context = {
    console,
    SpreadsheetApp: {
      create(name) { const ss = new Spreadsheet(name); store.spreadsheets[ss.id] = ss; return ss; },
      openById(id) { if (!store.spreadsheets[id]) throw new Error('not found'); return store.spreadsheets[id]; }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in store.props ? store.props[k] : null),
        setProperty: (k, v) => { store.props[k] = String(v); }
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get(k) { const e = store.cache[k]; if (!e || e.exp < Date.now()) { delete store.cache[k]; return null; } return e.v; },
        put(k, v, ttl) { store.cache[k] = { v: String(v), exp: Date.now() + (ttl || 600) * 1000 }; },
        remove(k) { delete store.cache[k]; }
      })
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Session: { getScriptTimeZone: () => TZ },
    ScriptApp: { getService: () => ({ getUrl: () => serviceUrl }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, value) => signedBytes(crypto.createHash(alg).update(String(value), 'utf8').digest()),
      computeHmacSha256Signature: (value, key) => signedBytes(crypto.createHmac('sha256', String(key)).update(String(value), 'utf8').digest()),
      formatDate
    },
    HtmlService: {}
  };
  vm.createContext(context);

  const dir = path.join(__dirname, '..', 'apps-script');
  fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort().forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), context, { filename: f });
  });

  /** เรียกฟังก์ชันเหมือน google.script.run: เริ่ม execution ใหม่ (ล้าง global cache) และ serialize ผลลัพธ์ */
  function call(fn, ...args) {
    if (typeof context[fn] !== 'function' || fn.endsWith('_')) throw new Error('No such public function: ' + fn);
    vm.runInContext('_ss = null; _rowsCache = {}; _headerCache = {};', context);
    const result = context[fn](...JSON.parse(JSON.stringify(args)));
    assertSerializable(result, fn);
    return JSON.parse(JSON.stringify(result === undefined ? null : result));
  }

  function assertSerializable(v, where) {
    if (v instanceof Date) throw new Error('google.script.run cannot return Date (in ' + where + ')');
    if (v && typeof v === 'object') Object.values(v).forEach((x) => assertSerializable(x, where));
  }

  function sheet(name) {
    const id = store.props.SPREADSHEET_ID;
    return id ? store.spreadsheets[id].getSheetByName(name) : null;
  }

  return { call, context, store, sheet };
}

module.exports = { createRuntime, parseLikeSheets };
