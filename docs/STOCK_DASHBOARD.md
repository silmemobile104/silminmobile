# แดชบอร์ดสต็อกสินค้า — รายละเอียดก่อนพัฒนา

สำรวจวันที่ 6 ตุลาคม 2026 จาก `HTML/stock-dashboard.html`, `routes/dailyStockRoutes.js`, `controllers/dailyStockController.js` และ `models/dailyStock.js`

URL ที่ผู้ใช้ระบุ: https://silminmobile.onrender.com/stock-dashboard.html

เครื่องมืออ่านเว็บเปิด URL นี้ไม่สำเร็จ จึงอธิบายพฤติกรรมจาก source ใน workspace ไม่ได้ยืนยันว่า deployment ใช้ revision เดียวกัน หรือทดสอบข้อมูลจริงผ่านบัญชีผู้ใช้

## 1. หน้าที่และขอบเขต

หน้านี้รายงานผลตรวจเครื่องรายวันจาก DailyStock และวิเคราะห์ snapshot ที่นำเข้า มีสามส่วนซึ่งดึงข้อมูลแยกกัน:

| ส่วน | ข้อมูล | ถูกควบคุมด้วยอะไร |
|---|---|---|
| ผลตรวจสต็อก | snapshot ตามช่วงวัน หรือประวัติของ IMEI | รูปแบบรายงาน สาขา ประเภท รุ่น IMEI และแท็บสถานะ |
| สรุปการเคลื่อนไหว | เปรียบเทียบ snapshot สองวัน | วันฐานและวันเปรียบเทียบใน modal เท่านั้น |
| สินค้าค้างสต็อก | เครื่องที่พบใน snapshot วันนี้และมีประวัติแรก >= 30 วัน | ข้อมูลวันนี้ของ server; ไม่มีตัวกรองจากรายงานหลัก |

หน้าไม่ได้นำเข้าข้อมูล สแกน หรืออนุมัติเอง งานเหล่านั้นอยู่ใน stock-management และ branch-daily-check หน้าไม่ใช้ ImportRequest, InventoryAudit หรือ DailyAccessoryCheck ในการคำนวณโดยตรง

## 2. การเปิดหน้าและสิทธิ์

- อ่าน token/user จาก localStorage หากขาดจะ redirect ไป `/`
- ยอมให้เข้าเมื่อ department มี Store/Stock/สต๊อก หรือ role อยู่ใน admin/executive/manager
- frontend ตรวจชื่อแผนกแบบ case-sensitive และไม่มี guard หยุด script หลัง redirect
- API สามเส้นทางตรวจ protect และ checkRole(admin/manager/executive/staff) ไม่ตรวจ department เพิ่ม และไม่อนุญาต hr ใน route แม้ hr อยู่แผนกสต๊อกแล้วหน้าเว็บยอมให้เข้า
- DailyStock ไม่มี companyId จึงไม่แบ่งบริษัทในรายงานนี้
- ใช้ fetch ตรง ไม่ใช้ fetchAPI wrapper และไม่มี interceptor logout เมื่อ token ถูกปฏิเสธ
- เมื่อเปิดหน้าเรียก handleReportTypeChange(), updateDashboard() และ fetchAgingReport() ส่วน comparison ดึงเมื่อกดดูสรุป
- ไม่มี polling; กดดึงรายงานจะ refresh เฉพาะรายงานหลัก ไม่ refresh aging

## 3. ลำดับส่วนประกอบบนหน้า

1. Sidebar: แดชบอร์ดรายงาน และกลับหน้าหลัก พร้อมปุ่มเปิด/ปิดสำหรับมือถือ
2. หัวข้อและปุ่มสรุปการเคลื่อนไหว
3. รูปแบบรายงาน สาขา ช่องวันที่/IMEI ตามรูปแบบ และปุ่มดึงข้อมูล
4. ตัวกรองใน browser: ประเภทสินค้า รุ่น และ IMEI
5. การ์ดสรุปหกใบ
6. สินค้าค้างสต็อก พร้อมตารางสาขาและ modal รายเครื่อง
7. ตารางรายละเอียดผลตรวจ พร้อมหกแท็บสถานะ
8. Modal เปรียบเทียบสองวัน

ส่วนต้นใช้ max-w-4xl แต่มี closing div ปิด wrapper ก่อน aging/table จึงทำให้ช่วงท้ายไม่ได้อยู่ใน wrapper กว้างเดียวกับส่วนต้น ต้องตรวจ layout จริงเมื่อปรับหน้าตา

## 4. รูปแบบรายงานหลัก

| รูปแบบ | การสร้างช่วงเวลา | การเรียก API |
|---|---|---|
| วันนี้ | 00:00 ถึง 23:59:59.999 ตาม browser timezone | report?startDate=ISO&endDate=ISO&branch=... |
| รายเดือน | วันแรกถึงวันสุดท้ายของเดือนที่เลือก | แบบช่วงเวลา |
| รายปี | 1 ม.ค. ถึง 31 ธ.ค. ปี ค.ศ. ที่เลือก | แบบช่วงเวลา |
| กำหนดช่วงวัน | date input สองช่องต่อเวลาเริ่ม/สิ้นวัน | แบบช่วงเวลา |
| ประวัติ IMEI | ค้น productCode เท่ากับค่าที่กรอก ไม่จำกัดช่วงวัน | report?imei=...&branch=... |

เปลี่ยนรูปแบบจะเปลี่ยนช่องกรอก ยังไม่ดึงข้อมูลใหม่อัตโนมัติ ต้องกดดึงข้อมูล ไม่มี validation วันเริ่มหลังวันสิ้นสุด ปีผิดช่วง หรือ IMEI ต้องเป็น 15 หลัก มีเพียงตรวจไม่ว่างบางช่อง

ประวัติ IMEI เรียงวันเก่า → ใหม่; รายงานช่วงเวลาเรียงใหม่ → เก่า ทั้งสองส่งรายละเอียดไม่เกิน 1,000 แถว

default custom/comparison date ใช้ toISOString().split('T')[0] ซึ่งเป็นวัน UTC จึงอาจเป็นวันก่อนหน้าในช่วง 00:00–06:59 เวลาไทย ช่วงเวลารายงานหลักสร้างจาก timezone ของ browser ส่วน comparison/aging และการเปลี่ยนสถานะเก่าอิง timezone ของ server

## 5. ตัวกรองสองระดับ

### ระดับ server

report รับ startDate/endDate หรือ imei และ branch จากค่าขณะกดดึงข้อมูล อ่าน MongoDB แล้วคืน summary ทั้งขอบเขต, branches ของทั้งช่วง/IMEI โดยไม่จำกัดสาขาที่เลือก, data สูงสุด 1,000 แถว, hasMore และ limit

### ระดับ browser

getFilteredData() กรองเฉพาะ allStockData ที่โหลดมาแล้ว:

1. branch เท่ากับสาขาที่เลือก
2. iPad = productName มีคำว่า ipad
3. iPhone = productName ไม่มีคำว่า ipad จึงรวม Android/ชื่ออื่นด้วย
4. model = ค้น substring ใน productName โดยไม่สนตัวพิมพ์
5. IMEI = ค้น substring ใน productCode โดยไม่สนตัวพิมพ์

เปลี่ยนสาขาเรียก applyFilters() โดยไม่ได้ดึงข้อมูลใหม่ทันที ดังนั้น:

- หากโหลดทุกสาขาแล้วเปลี่ยนสาขา ตารางกรองได้เฉพาะข้อมูล 1,000 แถวที่มี
- หากกดดึงข้อมูลเฉพาะสาขา A แล้วเลือก B ตารางอาจว่างจนกดดึงใหม่ แม้ B มีข้อมูลในฐานข้อมูล
- กลับไปเลือกทุกสาขาหลังโหลดเฉพาะ A ยังมีข้อมูลเฉพาะ A
- ชื่อสาขาใน dropdown อาจมีสาขาที่ไม่มีแถวใน data ชุดปัจจุบัน เพราะ branches คำนวณจากทั้งช่วง

## 6. การ์ดและแท็บสถานะ

| การ์ด/แท็บ | เงื่อนไข |
|---|---|
| ทั้งหมด | จำนวน document |
| รอฝ่ายขายตรวจ | status = pending |
| รอสต๊อกยืนยัน | status = checked และ verificationStatus = waiting |
| ตรวจสำเร็จ | status = checked และ verificationStatus = success |
| ฝ่ายขายไม่ได้ตรวจสอบ | status = not_checked |
| ตรวจไม่สำเร็จ | status != not_checked และ verificationStatus = failed |

การ์ดใช้ globalSummary จาก server เมื่อไม่มี filter ประเภท/รุ่น/IMEI แต่เงื่อนไขนี้ไม่ตรวจตัวกรองสาขา หากมี filter ประเภท/รุ่น/IMEI จะเปลี่ยนมานับ data ใน browser ทั้งหมดที่ผ่านตัวกรอง

แท็บสถานะเปลี่ยนเฉพาะตาราง ไม่เปลี่ยนยอดการ์ด การนับรายเดือน/รายปีเป็นจำนวนครั้งที่เครื่องปรากฏใน snapshot ไม่ใช่จำนวนเครื่อง unique เช่น เครื่องเดิมอยู่ 30 วันสามารถนับเป็น 30 รายการ

การคลิกการ์ดตรวจไม่สำเร็จเปิด breakdown ซึ่งรวมทั้ง not_checked และ verification failed ต่างจากตัวเลขบนการ์ด failed ที่แยก not_checked ออก breakdown ใช้เพียงแถวที่โหลดมา ไม่ใช้ summary เต็มจาก server

เมื่อเกิน 1,000 แถวมี popup แจ้งว่าตารางจำกัด แต่เมื่อใช้ client filters ยอดการ์ดจะนับเฉพาะ subset ที่โหลดมาด้วย ไม่มี pagination หรือปุ่มโหลดเพิ่ม

## 7. ตารางและหลักฐาน

คอลัมน์: ลำดับ, productCode/IMEI, productName, branch, สถานะ, ผู้ตรวจ/เวลา และรูปหลักฐาน

- pending/not_checked แสดงวันที่ของรอบในช่องผู้ตรวจ
- checked แสดง checkedBy.fullname หรือ username และ scannedAt; fallback ใช้ item.date
- User model มี name แต่ไม่มี fullname ขณะที่ populate เลือก username/fullname/role จึงมักแสดง username แทนชื่อพนักงาน
- failed แสดงเหตุผลและ failDetail แบบตัด 15 ตัวอักษร โดยมี title ให้ดูเต็ม
- แสดงภาพเฉพาะ status checked และมี evidenceImage เปิดด้วย SweetAlert image modal
- ไม่แสดง expectedQuantity, note, verifiedBy หรือ verifiedAt; report ไม่ select note/verifiedBy/verifiedAt มาด้วย
- ไม่มี export/print รายงานหลักหรือกราฟในหน้านี้
- หลายค่าสร้างเป็น innerHTML โดยไม่ได้ escape ต้องพิจารณาเมื่อเพิ่มข้อมูลหรือข้อความผู้ใช้

## 8. API รายงานและผลข้างเคียง

`GET /api/daily-stocks/report` → getDailyStockReport() ที่ controllers/dailyStockController.js:251

ก่อนอ่านรายงานจะ updateMany pending ที่ date เก่ากว่าเริ่มวันนี้ให้เป็น not_checked, verification failed และ failReason not_checked ครอบคลุมข้อมูลเก่าทั้ง collection ไม่จำกัดช่วงรายงาน/สาขาที่ขอ ดังนั้นการเปิดรายงานมีผลเปลี่ยนสถานะในฐานข้อมูล

summary นับด้วย countDocuments เจ็ดครั้งตามลำดับ ตามด้วย distinct branches และ find/select/sort/limit/populate/lean ไม่มี transaction ให้ทุก query อ่าน snapshot ณ เวลาเดียวกัน และไม่มี index date แบบ explicit ใน schema มีเพียง productCode/branch index

response contract:

```js
{
  summary: { total, pending, waiting, success, notChecked, failed },
  hasMore: total > 1000,
  limit: 1000,
  branches: ['...'],
  data: [{
    _id, productCode, productName, branch, status, verificationStatus,
    failReason, failDetail, scannedAt, checkedBy, evidenceImage,
    expectedQuantity, date
  }]
}
```

## 9. สรุปการเคลื่อนไหว

`GET /api/daily-stocks/comparison?baseDate=YYYY-MM-DD&targetDate=YYYY-MM-DD` → getComparisonReport():417

อ่าน DailyStock สองวันทั้งชุดแล้วจับคู่ด้วย productCode ผ่าน Map:

- NEW: target มี แต่ base ไม่มี
- TRANSFERRED: มีทั้งสองวันแต่ branch เปลี่ยน
- SOLD: base มี แต่ target ไม่มี

คืน summary.newItems/transferredIn/soldOut และ details[] ที่มี code/name/type/branch หรือ fromBranch/toBranch

modal เปิดให้เลือกวันอิสระและแสดงสามการ์ดพร้อมรายละเอียด ไม่รับ branch/type/model/IMEI ของหน้าหลัก ไม่มีตรวจว่าวันฐานต้องก่อนวันเปรียบเทียบหรือมีการนำเข้าข้อมูลครบสองวัน

ข้อจำกัดทางความหมาย:

- SOLD หมายถึงหายจาก snapshot ไม่ยืนยันธุรกรรมขาย
- ถ้าวัน target ยังไม่ import อาจแสดงสินค้าทั้งวันฐานเป็นหาย/ขาย
- นำเข้าไม่ครบหรือชื่อสาขาเปลี่ยนสามารถดูเหมือน movement ได้
- Map ใช้ code อย่างเดียว รายการซ้ำทับกัน และ loops ยังวน raw arrays จึงอาจนับ movement ซ้ำ
- การเปลี่ยนจำนวน expectedQuantity ไม่ใช่เงื่อนไข movement

## 10. สินค้าค้างสต็อก

`GET /api/daily-stocks/aging-report` → getAgingStockReport():633

1. อ่าน productCode ทั้งหมดของวันนี้ แล้ว unique
2. query ประวัติของ codes เหล่านี้
3. group ตาม code ใช้ min(date) เป็น firstImportDate และ last(name/branch)
4. floor((เวลาปัจจุบัน − firstImportDate) / 24 ชั่วโมง)
5. คัด >= 30 วัน แล้วจัดกลุ่มสาขา

คืน totalAging และ branches[] (branchName/count/items[]) รายเครื่องมี code/name/branch/firstImportDate/agingDays

ส่วนนี้ไม่ตามช่วงรายงานหลัก ไม่ตามสาขาที่เลือก ไม่กรองสถานะยืนยัน และโหลดครั้งเดียวตอนเปิดหน้า หากวันนี้ยังไม่มี snapshot จะได้ศูนย์

ชื่อหน้าจอใช้ >30 แต่ backend ใช้ >=30 อายุเริ่มจากการพบครั้งแรกใน DailyStock ไม่ใช่วันซื้อเข้าจริงหรือวันเข้าถึงสาขาปัจจุบัน เครื่องหายแล้วกลับมาจะยังใช้อายุเดิม `$last` ไม่มี sort ก่อน group จึงไม่รับประกันว่า branch/name เป็น record ล่าสุด ควรดึงตำแหน่งจาก snapshot วันนี้เมื่อต้องการความหมายสาขาปัจจุบัน

modal agingDetailModal อยู่หลัง script หลัก การผูก listener click-outside ใน script จึงหา element ไม่เจอ ณ ตอนนั้น (optional chaining ทำให้ไม่ error) ปุ่มปิดยังทำงานจาก onclick ได้

## 11. State และจุดแก้หลัก

| ตัวแปร/ฟังก์ชัน | หน้าที่ |
|---|---|
| allStockData | รายละเอียด report ล่าสุด สูงสุด 1,000 แถว |
| globalSummary | ยอดทั้งหมดจาก server สำหรับ report ล่าสุด |
| currentTab | แท็บตารางปัจจุบัน ไม่ reset เมื่อโหลดช่วงใหม่ |
| globalAgingData | aging แยกสาขา โหลดแยกจาก report |
| handleReportTypeChange():456 | เปลี่ยนช่อง input ตามรายงาน |
| updateDashboard():538 | สร้าง query อ่าน report เก็บ state และ render |
| getFilteredData():631 | ตัวกรอง browser |
| updateCards():669 | เลือกยอด server หรือยอด subset |
| showFailedBreakdown():702 | popup เหตุผลไม่สำเร็จ |
| setTab():745 / renderTable():774 | แท็บและตาราง |
| fetchComparisonReport():900 | โหลดและ render modal movement |
| fetchAgingReport():958 | โหลด aging |
| viewAgingDetails():1019 | รายละเอียด aging แยกสาขา |

การเปลี่ยน report API กระทบเฉพาะหน้านี้ตามการเรียกที่พบ ส่วน comparison/aging ถูกเรียกจากหน้านี้ใน HTML ที่ใช้งานจริง dailyStockController ยังมี import/scan/verify/balance ที่ใช้ model ร่วมกัน การเปลี่ยน schema หรือกฎสถานะจึงต้องตรวจ stock-management, branch-daily-check และ stock-balance ด้วย

## 12. พฤติกรรมที่ยืนยันด้วยข้อมูลจำลอง

นำฟังก์ชัน getFilteredData/updateCards จากไฟล์จริงมารันในสภาพแวดล้อมจำลอง ไม่มี DB/network และไม่ได้แก้ application source:

| กรณี | ผล |
|---|---|
| โหลด A/B รวม 2 แถว แล้วเลือก A โดยไม่กดดึงข้อมูล | ตารางเหลือ 1 แถว แต่การ์ดทั้งหมดแสดง 2 |
| เลือก iPhone บนชุด iPhone 14 และ Samsung | ได้ทั้ง iPhone 14 และ Samsung |

ข้อค้นพบอื่นเป็นการตรวจ source ยังไม่ได้ยืนยันด้วย DOM/browser ของเว็บที่ deploy

## 13. สิ่งที่ต้องกำหนดเมื่อเริ่มพัฒนา

ยังไม่มีการกำหนดฟีเจอร์ใหม่จากผู้ใช้ ประเด็นต่อไปนี้เป็นจุดตัดสินใจสำหรับคำสั่งพัฒนาถัดไป:

- ให้ตัวกรองสาขา/รุ่น/IMEI คุม report, movement และ aging ร่วมกันหรือแยกส่วนตามเดิม
- ตัวเลขเป็นจำนวนบันทึกตรวจ, จำนวน IMEI unique, จำนวนเครื่อง หรือยอด expectedQuantity
- ให้ค้นในข้อมูลทั้งฐานก่อนแบ่งหน้า เพื่อให้ยอด/ตาราง/breakdown ใช้ขอบเขตเดียวกัน
- ให้ movement หมายถึงเปรียบเทียบ snapshot หรือธุรกรรมจริง และจัดการวันที่ import ไม่ครบอย่างไร
- aging นับจากพบครั้งแรก วันรับเข้า หรือวันที่เข้าถึงสาขาปัจจุบัน รวมถึงเกณฑ์ >=30 หรือ >30
- ใช้วัน Asia/Bangkok เป็นมาตรฐานทั้งหน้าและ server
- กำหนดสิทธิ์ตามแผนก/role และขอบเขตบริษัทให้ตรงกัน
- กำหนดรายละเอียดที่จะเพิ่ม เช่น ผู้ยืนยัน หมายเหตุ export หรือรูปแบบแสดงประวัติ IMEI

เอกสารนี้บันทึกพฤติกรรมปัจจุบันและข้อจำกัดเพื่อเตรียมพัฒนา ยังไม่ได้แก้หน้าเว็บ/API หรือ deploy
