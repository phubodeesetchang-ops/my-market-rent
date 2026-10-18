# Data Dictionary (ฉบับใช้งานจริง)

**ระบบบริหารจัดการแผงค้าและจัดเก็บค่าเช่าตลาดท้องถิ่น**

สร้างจากฐานข้อมูลจริงหลังรัน `supabase/migrations/20261017000100_init_schema.sql` — ตรงกับ SQL ทุกคอลัมน์

> ค่าที่เป็น ENUM เก็บเป็นรหัสภาษาอังกฤษ และหน้าเว็บแปลงเป็นภาษาไทย (ดูคำอธิบายในแต่ละคอลัมน์)

## 1. users

ผู้ใช้งานระบบ (เจ้าหน้าที่/ผู้บริหาร) — รหัสผ่านจัดการโดย Supabase Auth

*เปลี่ยนจากเอกสารเดิม:* ตัด `password` (Supabase Auth เก็บรหัสผ่านแบบ hash แทน) · `user_id` เป็น UUID อ้างอิง auth.users

| Field | Data Type | Key | Null | Description |
|---|---|---|---|---|
| user_id | UUID | PK, FK | NOT NULL | รหัสผู้ใช้งาน (PK, = auth.users.id) |
| username | VARCHAR(100) | UNIQUE | NOT NULL | ชื่อผู้ใช้งาน |
| full_name | VARCHAR(150) |  | NOT NULL | ชื่อ-นามสกุล |
| role | VARCHAR(20) |  | NOT NULL | สิทธิ์: admin=ผู้ดูแลระบบ, staff=เจ้าหน้าที่, manager=ผู้บริหาร |
| phone | VARCHAR(20) |  | NULL | เบอร์โทรศัพท์ |
| email | VARCHAR(150) |  | NULL | อีเมล |
| status | VARCHAR(20) |  | NOT NULL | สถานะ: active=ใช้งาน, inactive=ระงับ |
| created_at | TIMESTAMPTZ |  | NOT NULL | วันที่สร้างข้อมูล |

## 2. tenants

ผู้เช่าแผงค้า/ห้อง

*เปลี่ยนจากเอกสารเดิม:* เพิ่ม `line_user_id`, `auth_id` สำหรับ LINE LIFF login

| Field | Data Type | Key | Null | Description |
|---|---|---|---|---|
| tenant_id | INT | PK | NOT NULL | รหัสผู้เช่า (PK) |
| full_name | VARCHAR(150) |  | NOT NULL | ชื่อ-นามสกุล |
| id_card | VARCHAR(20) | UNIQUE | NULL | เลขประจำตัวผู้เช่า/บัตรประชาชน (ข้อมูลอ่อนไหว — จำกัดสิทธิ์การเข้าถึง) |
| phone | VARCHAR(20) |  | NULL | เบอร์โทรศัพท์ |
| address | TEXT |  | NULL | ที่อยู่ |
| business_name | VARCHAR(150) |  | NULL | ชื่อร้าน/กิจการ |
| line_user_id | VARCHAR(50) | UNIQUE | NULL | LINE User ID จาก LIFF (ใช้ผูกบัญชี LINE กับผู้เช่า) |
| auth_id | UUID | UNIQUE, FK | NULL | บัญชี Supabase Auth ของผู้เช่า (สร้างตอน login ผ่าน LINE ครั้งแรก) |
| status | VARCHAR(20) |  | NOT NULL | สถานะ: active=ใช้งาน, inactive=ระงับ |
| created_at | TIMESTAMPTZ |  | NOT NULL | วันที่สร้างข้อมูล |

## 3. markets

ตลาด/พื้นที่

| Field | Data Type | Key | Null | Description |
|---|---|---|---|---|
| market_id | INT | PK | NOT NULL | รหัสตลาด (PK) |
| market_name | VARCHAR(150) | UNIQUE | NOT NULL | ชื่อตลาด/พื้นที่ |
| market_type | VARCHAR(50) |  | NOT NULL | ประเภท: market=ตลาดแผงค้า, building=อาคาร (เช่น อาคาร OTOP) |
| description | TEXT |  | NULL | รายละเอียด |
| status | VARCHAR(20) |  | NOT NULL | สถานะ: active=ใช้งาน, inactive=ปิด |
| promptpay_id | VARCHAR(20) |  | NULL | พร้อมเพย์ของตลาด: เบอร์มือถือ 10 หลัก หรือเลขผู้เสียภาษี 13 หลัก (ตัวเลขล้วน) ใช้สร้าง QR ในใบแจ้งหนี้ — NULL = ยังไม่ตั้ง *(เพิ่มใน migration 007)* |
| promptpay_name | VARCHAR(150) |  | NULL | ชื่อบัญชีพร้อมเพย์ แสดงให้ผู้เช่าตรวจก่อนโอน *(เพิ่มใน migration 007)* |
| created_at | TIMESTAMPTZ |  | NOT NULL | วันที่สร้าง |

## 4. zones

โซนพื้นที่ในตลาด (จำนวนแผงนับจากตาราง stalls)

*เปลี่ยนจากเอกสารเดิม:* ตัด `total_units` (นับจากตาราง stalls) · เพิ่ม `created_at`

| Field | Data Type | Key | Null | Description |
|---|---|---|---|---|
| zone_id | INT | PK | NOT NULL | รหัสโซน (PK) |
| market_id | INT | FK | NOT NULL | อ้างอิงตลาด (FK) |
| zone_name | VARCHAR(50) |  | NOT NULL | ชื่อโซน เช่น A, B, C |
| description | TEXT |  | NULL | รายละเอียด |
| status | VARCHAR(20) |  | NOT NULL | สถานะ: active=ใช้งาน, inactive=ปิด |
| created_at | TIMESTAMPTZ |  | NOT NULL | วันที่สร้าง |

## 5. stalls

แผงค้า/ห้องเช่า

*เปลี่ยนจากเอกสารเดิม:* เพิ่ม `created_at`

| Field | Data Type | Key | Null | Description |
|---|---|---|---|---|
| stall_id | INT | PK | NOT NULL | รหัสแผง/ห้อง (PK) |
| zone_id | INT | FK | NOT NULL | อ้างอิงโซน (FK) |
| stall_code | VARCHAR(50) |  | NOT NULL | เลขแผง/เลขห้อง เช่น A001 (ไม่ซ้ำภายในโซน) |
| unit_type | VARCHAR(20) |  | NOT NULL | ชนิด: stall=แผง, room=ห้อง |
| size | DECIMAL(10,2) |  | NULL | ขนาดพื้นที่ |
| size_unit | VARCHAR(20) |  | NULL | หน่วยพื้นที่ เช่น ตร.ม. |
| base_rent | DECIMAL(10,2) |  | NULL | ค่าเช่าเริ่มต้น |
| rent_period | VARCHAR(20) |  | NOT NULL | รอบค่าเช่า: monthly=รายเดือน, yearly=รายปี |
| status | VARCHAR(30) |  | NOT NULL | สถานะ: vacant=ว่าง, reserved=จอง, rented=เช่า, maintenance=ซ่อมบำรุง |
| created_at | TIMESTAMPTZ |  | NOT NULL | วันที่สร้าง |

## 6. contracts

สัญญาเช่า — คำขอเช่าจากผู้เช่าเริ่มที่ status = pending

*เปลี่ยนจากเอกสารเดิม:* เพิ่ม `renewed_from_id` สำหรับการต่ออายุสัญญา และ `note` (migration 005)

| Field | Data Type | Key | Null | Description |
|---|---|---|---|---|
| contract_id | INT | PK | NOT NULL | รหัสสัญญา (PK) |
| contract_no | VARCHAR(50) | UNIQUE | NOT NULL | เลขที่สัญญา (ออกอัตโนมัติ) |
| tenant_id | INT | FK | NOT NULL | อ้างอิงผู้เช่า (FK) |
| stall_id | INT | FK | NOT NULL | อ้างอิงแผง/ห้อง (FK) |
| start_date | DATE |  | NOT NULL | วันที่เริ่มสัญญา |
| end_date | DATE |  | NOT NULL | วันที่สิ้นสุดสัญญา |
| rent_amount | DECIMAL(10,2) |  | NOT NULL | ค่าเช่าตามสัญญา |
| rent_period | VARCHAR(20) |  | NOT NULL | รอบค่าเช่า: monthly=รายเดือน, yearly=รายปี |
| deposit_amount | DECIMAL(10,2) |  | NULL | เงินประกัน |
| status | VARCHAR(30) |  | NOT NULL | สถานะ: pending=รออนุมัติ, active=ใช้งาน, expired=สิ้นสุด, cancelled=ยกเลิก, rejected=ไม่อนุมัติ |
| renewed_from_id | INT | FK | NULL | ต่ออายุจากสัญญาเลขใด (FK → contracts) — NULL = สัญญาแรก · สัญญาหนึ่งมีสัญญาต่ออายุที่ยังมีผล (รออนุมัติ/ใช้งาน/สิ้นสุด) ได้ฉบับเดียว (unique index แบบมีเงื่อนไข, migration 005) |
| note | TEXT |  | NULL | หมายเหตุ เช่น เหตุผลที่ไม่อนุมัติ/ยกเลิก หรือข้อความจากผู้เช่าตอนส่งคำขอ (ไม่เกิน 500 ตัวอักษร) |
| created_by | UUID | FK | NULL | ผู้สร้างสัญญา (FK → users) — NULL = ผู้เช่าส่งคำขอเอง |
| created_at | TIMESTAMPTZ |  | NOT NULL | วันที่สร้าง |

## 7. utility_rates

อัตราค่าสาธารณูปโภค (น้ำ/ไฟ) ของแต่ละตลาด

*เปลี่ยนจากเอกสารเดิม:* เพิ่ม `created_at`

| Field | Data Type | Key | Null | Description |
|---|---|---|---|---|
| rate_id | INT | PK | NOT NULL | รหัสอัตรา (PK) |
| market_id | INT | FK | NOT NULL | อ้างอิงตลาด (FK) |
| utility_type | VARCHAR(30) |  | NOT NULL | ประเภท: electricity=ไฟฟ้า, water=น้ำ |
| rate_per_unit | DECIMAL(10,2) |  | NOT NULL | ราคาต่อหน่วย |
| unit_name | VARCHAR(30) |  | NOT NULL | หน่วย เช่น บาท/หน่วย |
| effective_from | DATE |  | NOT NULL | วันที่เริ่มใช้อัตรา |
| effective_to | DATE |  | NULL | วันที่สิ้นสุดอัตรา (NULL = ยังใช้อยู่) |
| status | VARCHAR(20) |  | NOT NULL | สถานะ: active=ใช้งาน, inactive=ยกเลิก |
| created_at | TIMESTAMPTZ |  | NOT NULL | วันที่สร้าง |

## 8. fees

ค่าธรรมเนียมของแต่ละตลาด

*เปลี่ยนจากเอกสารเดิม:* เพิ่ม `created_at`

| Field | Data Type | Key | Null | Description |
|---|---|---|---|---|
| fee_id | INT | PK | NOT NULL | รหัสค่าธรรมเนียม (PK) |
| market_id | INT | FK | NOT NULL | อ้างอิงตลาด (FK) |
| fee_name | VARCHAR(100) |  | NOT NULL | ชื่อค่าธรรมเนียม |
| fee_amount | DECIMAL(10,2) |  | NOT NULL | จำนวนเงิน |
| fee_period | VARCHAR(20) |  | NULL | รอบเรียกเก็บ: monthly=รายเดือน, yearly=รายปี, once=ครั้งเดียว |
| status | VARCHAR(20) |  | NOT NULL | สถานะ: active=ใช้งาน, inactive=ยกเลิก |
| created_at | TIMESTAMPTZ |  | NOT NULL | วันที่สร้าง |

## 9. utility_readings

การจดมิเตอร์น้ำ-ไฟ รายแผง รายรอบบิล

*เปลี่ยนจากเอกสารเดิม:* เพิ่ม `billing_period`, `invoice_id`, `created_at`

| Field | Data Type | Key | Null | Description |
|---|---|---|---|---|
| reading_id | INT | PK | NOT NULL | รหัสการจดมิเตอร์ (PK) |
| stall_id | INT | FK | NOT NULL | อ้างอิงแผง/ห้อง (FK) |
| utility_type | VARCHAR(30) |  | NOT NULL | ประเภทมิเตอร์: electricity=ไฟฟ้า, water=น้ำ |
| billing_period | VARCHAR(20) |  | NOT NULL | รอบบิลที่จด รูปแบบ YYYY-MM (ค.ศ.) |
| previous_reading | DECIMAL(10,2) |  | NOT NULL | เลขมิเตอร์ครั้งก่อน |
| current_reading | DECIMAL(10,2) |  | NOT NULL | เลขมิเตอร์ครั้งปัจจุบัน |
| unit_used | DECIMAL(10,2) |  | NULL | หน่วยที่ใช้ (คำนวณอัตโนมัติ = ปัจจุบัน − ครั้งก่อน) |
| rate_per_unit | DECIMAL(10,2) |  | NOT NULL | อัตราต่อหน่วยที่ใช้คำนวณ — ไม่ต้องส่งมา ระบบเติมอัตราที่ใช้อยู่ ณ วันสุดท้ายของรอบบิลให้ (migration 006) และไม่เปลี่ยนตามถ้าแก้อัตราภายหลัง |
| reading_date | DATE |  | NOT NULL | วันที่จดมิเตอร์ |
| invoice_id | INT | FK | NULL | ออกบิลแล้วในใบแจ้งหนี้ใด (FK → invoices) — NULL = ยังไม่ออกบิล · มีค่าแล้วเจ้าหน้าที่แก้/ลบมิเตอร์ไม่ได้ จนกว่าจะยกเลิกใบนั้น (ยกเลิกแล้วกลับเป็น NULL อัตโนมัติ) |
| created_by | UUID | FK | NULL | ผู้บันทึก (FK → users) |
| created_at | TIMESTAMPTZ |  | NOT NULL | วันที่สร้าง |

## 10. invoices

ใบแจ้งหนี้ — ค้างชำระ = status unpaid และเลย due_date

*เปลี่ยนจากเอกสารเดิม:* แยก `utility_amount` เป็น `water_amount` + `electricity_amount` · เพิ่ม `created_by`, `created_at`

| Field | Data Type | Key | Null | Description |
|---|---|---|---|---|
| invoice_id | INT | PK | NOT NULL | รหัสใบแจ้งหนี้ (PK) |
| invoice_no | VARCHAR(50) | UNIQUE | NOT NULL | เลขที่ใบแจ้งหนี้ (ออกอัตโนมัติ) |
| contract_id | INT | FK | NOT NULL | อ้างอิงสัญญา (FK) |
| billing_period | VARCHAR(20) |  | NOT NULL | รอบบิล รูปแบบ YYYY-MM (ค.ศ.) |
| rent_amount | DECIMAL(10,2) |  | NOT NULL | ค่าเช่า |
| water_amount | DECIMAL(10,2) |  | NOT NULL | ค่าน้ำ |
| electricity_amount | DECIMAL(10,2) |  | NOT NULL | ค่าไฟ |
| fee_amount | DECIMAL(10,2) |  | NOT NULL | ค่าธรรมเนียม |
| total_amount | DECIMAL(10,2) |  | NULL | ยอดรวม (คำนวณอัตโนมัติ) |
| due_date | DATE |  | NOT NULL | วันครบกำหนดชำระ |
| status | VARCHAR(30) |  | NOT NULL | สถานะ: unpaid=รอชำระ, paid=ชำระแล้ว, cancelled=ยกเลิก — ยกเลิกแล้วเปลี่ยนต่อไม่ได้ · ใบที่ชำระแล้วยกเลิกไม่ได้ (migration 006) |
| created_by | UUID | FK | NULL | ผู้ออกใบแจ้งหนี้ (FK → users) |
| created_at | TIMESTAMPTZ |  | NOT NULL | วันที่สร้าง |

## 11. payments

การชำระเงิน — ผู้เช่าแจ้งโอนพร้อมสลิป แล้วเจ้าหน้าที่ตรวจสอบ

*เปลี่ยนจากเอกสารเดิม:* เพิ่ม `created_at`

| Field | Data Type | Key | Null | Description |
|---|---|---|---|---|
| payment_id | INT | PK | NOT NULL | รหัสการชำระ (PK) |
| invoice_id | INT | FK | NOT NULL | อ้างอิงใบแจ้งหนี้ (FK) |
| payment_date | DATE |  | NOT NULL | วันที่ชำระ |
| amount | DECIMAL(10,2) |  | NOT NULL | จำนวนเงิน |
| payment_method | VARCHAR(30) |  | NOT NULL | วิธีชำระ: cash=เงินสด, transfer=โอน, promptpay=PromptPay |
| slip_image | VARCHAR(255) |  | NULL | path รูปสลิปใน Storage bucket `slips` รูปแบบ `<tenant_id>/<invoice_id>/<ชื่อไฟล์>` (bucket ส่วนตัว เปิดดูผ่าน signed URL) |
| transaction_ref | VARCHAR(100) |  | NULL | เลขอ้างอิงธุรกรรม |
| status | VARCHAR(30) |  | NOT NULL | สถานะ: pending=รอตรวจสอบ, verified=ตรวจสอบแล้ว, rejected=ไม่ผ่าน — รอตรวจ → ตรวจแล้ว/ไม่ผ่าน · ตรวจแล้ว → ไม่ผ่าน (= ยกเลิกใบเสร็จ เฉพาะผู้ดูแลระบบ) · ไม่ผ่าน = จบ · ตรวจแล้วรวมกันห้ามเกินยอดใบแจ้งหนี้ (migration 007) |
| note | TEXT |  | NULL | หมายเหตุ / เหตุผลที่ไม่ผ่าน / บันทึกการยกเลิกใบเสร็จ (เลขใบเสร็จ เหตุผล ผู้ยกเลิก วันที่) |
| verified_by | UUID | FK | NULL | ผู้ตรวจสอบ (FK → users) |
| verified_at | TIMESTAMPTZ |  | NULL | วันเวลาที่ตรวจสอบ |
| created_at | TIMESTAMPTZ |  | NOT NULL | วันที่สร้าง |

## 12. receipts

ใบเสร็จรับเงิน — ระบบออกให้อัตโนมัติเมื่อการชำระเปลี่ยนเป็น "ตรวจสอบแล้ว" (1 การชำระ = 1 ใบ) · แก้ไข/ลบไม่ได้ ·
ใบเสร็จที่การชำระเป็น "ไม่ผ่าน" ภายหลัง = ใบเสร็จที่ถูกยกเลิก (ยังเก็บไว้เป็นหลักฐาน)

| Field | Data Type | Key | Null | Description |
|---|---|---|---|---|
| receipt_id | INT | PK | NOT NULL | รหัสใบเสร็จ (PK) |
| receipt_no | VARCHAR(50) | UNIQUE | NOT NULL | เลขที่ใบเสร็จ (ออกอัตโนมัติ) |
| payment_id | INT | UNIQUE, FK | NOT NULL | อ้างอิงการชำระ (FK, 1:1) |
| receipt_date | DATE |  | NOT NULL | วันที่ออกใบเสร็จ (= วันที่ตรวจผ่าน ตามเวลาไทย) |
| amount | DECIMAL(10,2) |  | NOT NULL | จำนวนเงิน |
| issued_by | UUID | FK | NULL | ผู้ออกใบเสร็จ (FK → users) |
| created_at | TIMESTAMPTZ |  | NOT NULL | วันที่สร้าง |
