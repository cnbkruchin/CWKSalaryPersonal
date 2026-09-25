/**
 * Utils.gs — ฟังก์ชันช่วยเหลือทั่วไป: การจัดรูปแบบเดือน/วันที่แบบไทย,
 * แปลงตัวเลขเป็นตัวหนังสือภาษาไทย, สร้างรหัสอ้างอิง, และ wrapper คำตอบ API
 */

var THAI_MONTH_NAMES = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

var THAI_MONTH_ABBR = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];

/** คืนค่าเดือนปัจจุบันในรูปแบบ YYYY-MM (ค.ศ., ตามโซนเวลา Asia/Bangkok) */
function currentMonthKey() {
  var tz = Session.getScriptTimeZone() || 'Asia/Bangkok';
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM');
}

/** ตรวจรูปแบบ YYYY-MM */
function isValidMonthKey(monthKey) {
  return typeof monthKey === 'string' && /^\d{4}-\d{2}$/.test(monthKey);
}

/** เดือน YYYY-MM -> "กันยายน 2569" (พ.ศ.) */
function formatThaiMonthLong(monthKey) {
  var parts = monthKey.split('-');
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  return THAI_MONTH_NAMES[m - 1] + ' ' + (y + 543);
}

/** เดือน YYYY-MM -> "ก.ย.69" แบบย่อ */
function formatThaiMonthShort(monthKey) {
  var parts = monthKey.split('-');
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  return THAI_MONTH_ABBR[m - 1] + (y + 543 - 2500);
}

/** เปรียบเทียบเดือน YYYY-MM คืนค่า -1,0,1 */
function compareMonthKey(a, b) {
  return a < b ? -1 : (a > b ? 1 : 0);
}

/** บวก/ลบจำนวนเดือนจาก YYYY-MM คืนค่า YYYY-MM ใหม่ */
function addMonths(monthKey, delta) {
  var parts = monthKey.split('-');
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10) - 1;
  var d = new Date(Date.UTC(y, m + delta, 1));
  var yy = d.getUTCFullYear();
  var mm = d.getUTCMonth() + 1;
  return yy + '-' + (mm < 10 ? '0' + mm : '' + mm);
}

/** รายการเดือนทั้งหมดตั้งแต่ from ถึง to (รวมปลายทาง) */
function monthRange(fromMonth, toMonth) {
  var out = [];
  var cur = fromMonth;
  var guard = 0;
  while (compareMonthKey(cur, toMonth) <= 0 && guard < 600) {
    out.push(cur);
    cur = addMonths(cur, 1);
    guard++;
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').substring(0, 10);
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** wrapper มาตรฐานของทุกฟังก์ชันที่เรียกจากฝั่ง client ผ่าน google.script.run */
function apiOk(data) {
  return { ok: true, data: data };
}

function apiError(message) {
  return { ok: false, error: String(message) };
}

/**
 * แปลงจำนวนเงิน (บาท, ทศนิยมได้) เป็นคำอ่านภาษาไทย เช่น
 * 207877 -> "สองแสนเจ็ดพันแปดร้อยเจ็ดสิบเจ็ดบาทถ้วน"
 */
function bahtText(amount) {
  var THAI_NUM = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  var THAI_UNIT = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

  amount = Math.round((Number(amount) || 0) * 100) / 100;
  var negative = amount < 0;
  amount = Math.abs(amount);

  var baht = Math.floor(amount);
  var satang = Math.round((amount - baht) * 100);

  function readNumber(numStr) {
    var digits = numStr.split('').map(function (c) { return parseInt(c, 10); });
    var len = digits.length;
    var result = '';
    for (var i = 0; i < len; i++) {
      var digit = digits[i];
      var place = len - i - 1; // 0=หน่วย,1=สิบ,2=ร้อย,3=พัน,4=หมื่น,5=แสน,6=ล้าน (วนซ้ำทุกล้าน)
      var placeInMillion = place % 6;
      if (digit === 0) continue;

      if (placeInMillion === 0) { // หลักหน่วย
        if (digit === 1 && len > 1 && place === 0 && digits[i - 1] !== undefined) {
          result += 'เอ็ด';
        } else {
          result += THAI_NUM[digit];
        }
      } else if (placeInMillion === 1) { // หลักสิบ
        if (digit === 1) {
          result += 'สิบ';
        } else if (digit === 2) {
          result += 'ยี่สิบ';
        } else {
          result += THAI_NUM[digit] + 'สิบ';
        }
      } else {
        result += THAI_NUM[digit] + THAI_UNIT[placeInMillion];
      }
      if (place > 0 && placeInMillion === 0 && place % 6 === 0) {
        result += 'ล้าน';
      }
    }
    return result || 'ศูนย์';
  }

  var bahtWords = baht === 0 ? 'ศูนย์' : readNumber(String(baht));
  var text = bahtWords + 'บาท';
  if (satang === 0) {
    text += 'ถ้วน';
  } else {
    text += readNumber(String(satang)) + 'สตางค์';
  }
  if (negative) text = 'ลบ' + text;
  return text;
}
