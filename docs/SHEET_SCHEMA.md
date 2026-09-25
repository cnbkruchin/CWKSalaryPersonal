# โครงสร้างฐานข้อมูล Google Sheet

ระบบใช้ Google Sheet 1 ไฟล์เป็นฐานข้อมูลทั้งหมด (สร้างอัตโนมัติโดยฟังก์ชัน `initializeSystem()` ครั้งแรกที่ตั้งค่าระบบ)
ประกอบด้วย 6 ชีต ดังนี้ แถวที่ 1 ของทุกชีตคือหัวคอลัมน์ (header) ห้ามลบ/แก้ชื่อหัวคอลัมน์ด้วยมือ

## 1. `Employees` — ทะเบียนลูกจ้าง

| คอลัมน์ | ชนิด | คำอธิบาย |
|---|---|---|
| EmployeeID | string | รหัสพนักงาน ไม่ซ้ำ (เช่น E001) ใช้ล็อกอิน |
| PrefixName | string | คำนำหน้าชื่อ |
| FirstName | string | ชื่อ |
| LastName | string | นามสกุล |
| Group | string | กลุ่มงาน (ครูอัตราจ้าง / เจ้าหน้าที่ / พนักงานขับรถ / ภารโรง / แม่บ้าน / ยามรักษาการณ์ / อื่นๆ) |
| Position | string | ตำแหน่ง/รายละเอียดงาน |
| StartDate | date | วันที่เริ่มปฏิบัติงาน |
| Status | string | `active` / `inactive` |
| HasSSO | boolean | มีการหักสมทบประกันสังคมหรือไม่ |
| BankName | string | ธนาคาร |
| BankAccountNo | string | เลขที่บัญชี |
| CitizenID | string | เลขบัตรประชาชน (ใช้ตั้งรหัสผ่านเริ่มต้น) |
| Phone | string | เบอร์โทร |
| Role | string | `admin` หรือ `employee` |
| PinHash | string | รหัสผ่าน (PIN) ที่ถูกแฮชแล้ว (SHA-256 + salt) |
| PinSalt | string | salt เฉพาะราย |
| Note | string | หมายเหตุอิสระ |
| CreatedAt | datetime | วันที่สร้างระเบียน |

## 2. `SalaryHistory` — ประวัติเงินเดือนพื้นฐาน / การเลื่อนขั้น

| คอลัมน์ | คำอธิบาย |
|---|---|
| HistoryID | รหัสอ้างอิง |
| EmployeeID | อ้างอิงพนักงาน |
| EffectiveMonth | เดือนที่เริ่มมีผล รูปแบบ `YYYY-MM` (ค.ศ.) |
| BaseSalary | อัตราเงินเดือนใหม่ |
| ChangeType | `บรรจุใหม่` / `เลื่อนขั้น` / `ปรับวุฒิ` / `อื่นๆ` |
| ApprovedDate | วันที่อนุมัติ |
| ApprovedBy | ผู้อนุมัติ |
| Note | หมายเหตุ |
| CreatedAt | วันที่บันทึกในระบบ |

เมื่อบันทึกรายการใหม่ที่ `EffectiveMonth` ย้อนหลังกว่ารอบจ่ายที่อนุมัติไปแล้ว ระบบจะคำนวณส่วนต่างของเดือนที่จ่ายเงินเดือนเก่าไปแล้วให้อัตโนมัติ และเพิ่มแถวใน `BackPayQueue`

## 3. `BackPayQueue` — คิวเงินตกเบิก

| คอลัมน์ | คำอธิบาย |
|---|---|
| QueueID | รหัสอ้างอิง |
| EmployeeID | อ้างอิงพนักงาน |
| FromMonth / ToMonth | ช่วงเดือนที่จ่ายเงินเดือนอัตราเก่าไปแล้ว |
| OldBaseSalary / NewBaseSalary | อัตราก่อน/หลังปรับ |
| MonthlyDiff | ส่วนต่างต่อเดือน |
| MonthsCount | จำนวนเดือนที่ตกเบิก |
| TotalBackPay | ยอดตกเบิกรวม |
| Status | `pending` / `applied` |
| AppliedRunMonth | เดือนของรอบจ่ายที่ดึงยอดนี้ไปจ่ายจริง (ว่างถ้ายัง pending) |
| CreatedAt | วันที่คำนวณ |
| Note | หมายเหตุ (เช่น อ้างอิงประวัติการเลื่อนขั้นที่ทำให้เกิดรายการนี้) |

## 4. `PayrollRuns` — รอบจ่ายเงินเดือนรายเดือน (1 แถว = 1 คนต่อ 1 เดือน)

| คอลัมน์ | คำอธิบาย |
|---|---|
| Month | เดือนของรอบจ่าย `YYYY-MM` |
| EmployeeID | อ้างอิงพนักงาน |
| BaseSalary | เงินเดือนที่ใช้ในรอบนี้ (ดึงจาก SalaryHistory ล่าสุด ณ เดือนนั้น) |
| Allowance | เงินเพิ่มพิเศษ |
| AllowanceNote | หมายเหตุเงินเพิ่มพิเศษ |
| BackPay | ยอดตกเบิกที่รวมในรอบนี้ |
| BackPayNote | หมายเหตุตกเบิก (เช่น "ตกเบิก เม.ย.–ส.ค. 69") |
| GrossPay | รวมรับ = BaseSalary+Allowance+BackPay |
| SSOEmployee | หักสมทบ ปกส. ฝั่งลูกจ้าง |
| SSOEmployer | สมทบ ปกส. ฝั่งโรงเรียน |
| CompFundEmployer | สมทบกองทุนเงินทดแทนฝั่งโรงเรียน |
| OtherDeductionTotal | รวมยอดหักอื่น ๆ (มาจากชีต PayrollDeductions) |
| TotalDeduction | รวมหักทั้งหมด |
| NetPay | คงเหลือสุทธิที่โอนเข้าบัญชี |
| Status | `draft` / `approved` |
| PaidDate | วันที่จ่ายจริง |
| UpdatedAt / UpdatedBy | ผู้แก้ไขล่าสุด |

## 5. `PayrollDeductions` — รายการหักอื่น ๆ ต่อคนต่อเดือน (0..n แถวต่อคน)

| คอลัมน์ | คำอธิบาย |
|---|---|
| DeductionID | รหัสอ้างอิงรายการ (ใช้ลบ/แก้ไขรายการเดี่ยว ๆ) |
| Month | เดือนของรอบจ่าย |
| EmployeeID | อ้างอิงพนักงาน |
| Category | `เงินยืม` / `เกษียณ` / `อื่นๆ` — ใช้จัดกลุ่มยอดในบันทึกข้อความขออนุมัติ |
| Label | คำอธิบายรายการ |
| Amount | จำนวนเงิน |

## 6. `Settings` — ค่าตั้งต้นระบบ (คีย์-ค่า)

| Key | ตัวอย่างค่า |
|---|---|
| SchoolName | โรงเรียนจุนวิทยาคม |
| SchoolAddress | อำเภอจุน จังหวัดพะเยา |
| SchoolDistrictOffice | สำนักงานเขตพื้นที่การศึกษามัธยมศึกษาพะเยา |
| SSORate | 0.05 |
| SSOWageCap | 15000 |
| CompFundRate | 0.002 |
| FinanceOfficerName / Title | ชื่อ-ตำแหน่ง เจ้าหน้าที่การเงิน (ผู้จัดทำ) |
| BudgetHeadName / Title | หัวหน้างานกลุ่มบริหารงบประมาณ |
| DeputyDirectorName / Title | รองผู้อำนวยการ |
| DirectorName / Title | ผู้อำนวยการโรงเรียน |
| AuthPepper | ค่าสุ่มสำหรับแฮชรหัสผ่าน (สร้างอัตโนมัติ) |

ทุกฟิลด์แก้ไขได้จากหน้า "ตั้งค่าระบบ" ในแอดมิน โดยไม่ต้องแก้โค้ด
