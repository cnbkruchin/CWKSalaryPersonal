/**
 * Code.gs — จุดเข้าเว็บแอป ระบบเงินเดือนลูกจ้างชั่วคราว โรงเรียนจุนวิทยาคม
 *
 * ลิงก์เดียว 3 ทางเข้า:
 *   <URL เว็บแอป>                 หน้าบ้าน — ลูกจ้างล็อกอินด้วย PIN ดู/ดาวน์โหลดสลิปของตัวเอง
 *   <URL เว็บแอป>?page=admin      หลังบ้าน — เจ้าหน้าที่การเงินจัดการเงินเดือน
 *   <URL เว็บแอป>?verify=รหัส      สาธารณะ — ตรวจสอบความถูกต้องของสลิป (จาก QR บนสลิป)
 *
 * วิธีติดตั้งดู docs/DEPLOYMENT.md
 */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var mode = 'employee';
  var verifyCode = '';
  if (p.verify) {
    mode = 'verify';
    verifyCode = String(p.verify).toUpperCase().replace(/[^A-Z0-9-]/g, '').substring(0, 24);
  } else if (p.page === 'admin') {
    mode = 'admin';
  }

  var titles = {
    employee: 'สลิปเงินเดือน · โรงเรียนจุนวิทยาคม',
    admin: 'หลังบ้าน · ระบบเงินเดือนลูกจ้าง โรงเรียนจุนวิทยาคม',
    verify: 'ตรวจสอบสลิปเงินเดือน · โรงเรียนจุนวิทยาคม'
  };

  var page = HtmlService.createTemplateFromFile('Index');
  page.appConfigJson = JSON.stringify({ mode: mode, verifyCode: verifyCode, appUrl: appUrl_() }).replace(/</g, '\\u003c');
  return page.evaluate()
    .setTitle(titles[mode])
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** ใช้รวมไฟล์ HTML/CSS/JS ย่อยเข้ากับ Index.html ตอน render ฝั่งเซิร์ฟเวอร์ */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
