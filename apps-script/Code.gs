/**
 * Code.gs — จุดเข้าเว็บแอป
 * ระบบเงินเดือนลูกจ้างชั่วคราว โรงเรียนจุนวิทยาคม
 *
 * วิธีติดตั้ง (สรุป — รายละเอียดเต็มดู docs/DEPLOYMENT.md):
 * 1. สร้างโปรเจกต์ Apps Script ใหม่ แล้ววางไฟล์ทั้งหมดในโฟลเดอร์ apps-script/
 * 2. รันฟังก์ชัน initializeSystem() หนึ่งครั้ง (อนุญาตสิทธิ์ที่ขอ)
 * 3. Deploy > New deployment > Web app แล้วเปิดลิงก์ที่ได้
 */

function doGet(e) {
  var page = HtmlService.createTemplateFromFile('Index');
  return page.evaluate()
    .setTitle('ระบบเงินเดือนลูกจ้าง โรงเรียนจุนวิทยาคม')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** ใช้รวมไฟล์ HTML/CSS/JS ย่อยเข้ากับ Index.html ตอน render ฝั่งเซิร์ฟเวอร์ */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
