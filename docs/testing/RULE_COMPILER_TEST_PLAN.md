# แผนทดสอบก่อน Push — Rule Compiler (Beta)

เอกสารนี้รวมชุดทดสอบที่ยังไม่เคยทำจริง (นอกเหนือจากที่พิสูจน์แล้วในเซสชันก่อนหน้า) ให้ทำครบทุกข้อก่อนตัดสินใจ push ขึ้น GitHub Pages หรือเปิดให้ทีมใช้งานจริง

## สถานะที่พิสูจน์แล้ว (ไม่ต้องทดสอบซ้ำ)

- Rule Compiler ทั้ง 2 phase ทำงานถูกต้อง (unit test 55/55 + รันจริงผ่าน Gemini)
- Path เดิม (ไม่ติ๊ก Beta) ไม่ถูกกระทบเลย (พิสูจน์จาก git diff)
- Checksum เลขบัตร ปชช., อีเมลจากชื่อไทย/จีน/อังกฤษ, การแสดงผลตาราง (comma/เลข 0 นำหน้า) — ถูกต้อง
- Insurance reference hint ทำงานจริง ค่าตรงจากคลังข้อมูลเป๊ะ และรูปแบบค่าสะอาดพร้อมใช้เป็นข้อมูลจริงแล้ว
- percent_of แบบลูกโซ่ (chain) — แก้แล้วด้วย multi-pass resolver ทดสอบ offline ผ่านทั้งลำดับปกติ/สลับ/circular
- รูปภาพ Schema/ER Diagram — แก้ให้ `compileRules_` ส่งรูปจริงเข้า Gemini แล้ว (เดิมส่ง null)
- `sequential` เติมเลขศูนย์นำหน้าถูกต้องแล้ว (เช่น EMP-2026-001) — ทดสอบ offline ผ่าน ยังไม่เคยรีเทสต์ผ่าน Gemini จริง

## ⚠️ เปลี่ยนกลไก ai_context ใหม่ทั้งหมด (2026-09-07) — Test 1/2 เดิมถือว่า "ไม่นับ" สำหรับคอลัมน์ข้อความอิสระ

เดิมคอลัมน์ ai_context (เช่น `customer_review`, `performance_review`) ให้ Gemini เขียนเนื้อหาจริงหลังสุ่มข้อมูลเสร็จ (เรียก Gemini ซ้ำอีก 1 ครั้ง) ตอนนี้เปลี่ยนเป็นให้ Gemini เขียน "แม่แบบ" (templates/variants) มาตั้งแต่ครั้งแรกครั้งเดียว แล้วโค้ดสุ่มเลือก+แทนค่าเอง (ไม่เรียก Gemini ซ้ำ) — **ผลตรวจของ Test 1/2 ที่ทำไปก่อนหน้านี้ (customer_review, performance_review อ่านแล้วสมเหตุสมผล) เป็นผลจากกลไกเก่า ไม่ได้ยืนยันกลไกใหม่นี้** ทดสอบ offline แล้วว่า placeholder substitution + variant matching ทำงานถูกต้อง (200 แถวจำลอง ไม่มี `{{...}}` หลงเหลือ ไม่ข้ามไปใช้ variant ผิดสถานะ) แต่ **ยังไม่เคยพิสูจน์กับ Gemini จริง** — เวลารัน Test 1/2 ใหม่ ให้เพิ่มเช็คนี้ด้วย:
- Gemini เขียนแม่แบบ (templates/variants) ออกมาสมเหตุสมผลจริงไหม (ไม่ใช่แค่โค้ดแทนค่าไม่พัง)
- ข้อความแต่ละแถวไม่ซ้ำกันทุกแถว (ควรมีความหลากหลายจากการสุ่มเลือกแม่แบบ 2-4 แบบ)
- ถ้าเงื่อนไขต้องการให้เนื้อหาต่างกันตามคอลัมน์อื่น (เช่น shipping_status) Gemini ต้องแยก variants ให้จริง ไม่ใช่โยนมาเป็น templates แบบเดียวเหมารวม

## สิ่งที่ยังไม่เคยทดสอบจริง — ทำตามลำดับนี้

---

### Test 1 — โดเมน e-commerce (ทดสอบ generalization + ตรวจว่า insurance hint ไม่รั่วข้ามโดเมน)

**DDL:**
```sql
CREATE TABLE t_orders (
  order_no VARCHAR(20),
  customer_name VARCHAR(100),
  product_sku VARCHAR(20),
  category VARCHAR(50),
  unit_price NUMERIC(10,2),
  discount_amount NUMERIC(10,2),
  order_date DATE,
  shipping_status VARCHAR(20),
  customer_review VARCHAR(300)
);
```

**เงื่อนไขเพิ่มเติม:**
```
order_no ขึ้นต้นด้วย ORD- ตามด้วยเลข 8 หลัก
customer_name สุ่มจากชื่อคนไทยชุดนี้: กมล แสงทอง, พิมพ์ใจ ศรีสุข, ธนกร วงศ์ไพศาล
product_sku ขึ้นต้นด้วย SKU- ตามด้วยตัวอักษร 2 ตัวและเลข 5 หลัก
category เป็นหนึ่งใน "เสื้อผ้า", "อิเล็กทรอนิกส์", "ของใช้ในบ้าน", "อาหารและเครื่องดื่ม"
unit_price อยู่ระหว่าง 100-5000 บาท
discount_amount = 0-30% ของ unit_price
order_date อยู่ในช่วง 6 เดือนที่ผ่านมาจากวันนี้
shipping_status เป็นหนึ่งใน "Pending", "Shipped", "Delivered", "Returned"
customer_review เป็นข้อความรีวิวสินค้าสั้นๆ ที่ต้องสอดคล้องกับ category และ shipping_status ของแถวนั้นจริง
```

**เกณฑ์ผ่าน:**
- ทุกคอลัมน์ตรงเงื่อนไข (pattern/enum/number_range/percent_of ถูกต้อง)
- `customer_review` (ai_context) เนื้อหาสอดคล้องกับ category/shipping_status จริง ไม่ใช่ข้อความลอยๆ
- เปิด log console คัดลอก prompt แล้วเช็คว่า **ไม่มี** ข้อความ "ข้อมูลอ้างอิงสายงานประกันภัยไทย" ปนมา (พิสูจน์ว่า insurance hint ไม่รั่วข้ามโดเมน)

---

### Test 2 — โดเมน HR/เงินเดือน (ทดสอบ sequential + email_from_name + percent_of ร่วมกัน)

**DDL:**
```sql
CREATE TABLE t_employees (
  employee_id VARCHAR(20),
  full_name VARCHAR(100),
  email VARCHAR(100),
  department VARCHAR(50),
  position VARCHAR(50),
  base_salary NUMERIC(10,2),
  bonus NUMERIC(10,2),
  hire_date DATE,
  employment_status VARCHAR(20),
  performance_review VARCHAR(300)
);
```

**เงื่อนไขเพิ่มเติม:**
```
employee_id รันต่อเนื่องจาก EMP-2026-001
full_name สุ่มจากชื่อคนไทยชุดนี้: ณัฐพล ก้าวหน้า, สุพัตรา เจริญสุข, วรากร ทองสกุล
email สร้างจากคอลัมน์ full_name
department เป็นหนึ่งใน "ฝ่ายขาย", "ฝ่ายบัญชี", "ฝ่ายไอที", "ฝ่ายทรัพยากรบุคคล"
position เป็นหนึ่งใน "พนักงาน", "หัวหน้างาน", "ผู้จัดการ"
base_salary อยู่ระหว่าง 18000-80000 บาท
bonus = 5-15% ของ base_salary
hire_date อยู่ในช่วง 5 ปีที่ผ่านมาจากวันนี้
employment_status เป็นหนึ่งใน "Active", "On Leave", "Resigned"
performance_review เป็นข้อความประเมินผลงานสั้นๆ ที่สอดคล้องกับตำแหน่งและแผนกของพนักงานคนนั้นจริง
```

**เกณฑ์ผ่าน:** เหมือน Test 1 + `employee_id` ต้องรันต่อเนื่องถูกต้องแม้ prefix มีตัวเลขปีปนอยู่ (`EMP-2026-001`, `EMP-2026-002`, ...)

---

### Test 3 — percent_of ลูกโซ่ผ่าน Gemini จริง (ยืนยันว่า fix ที่แก้ offline ใช้ได้จริงกับ Gemini)

**DDL:**
```sql
CREATE TABLE t_commission (
  agent_id VARCHAR(20),
  sale_amount NUMERIC(12,2),
  commission_amount NUMERIC(12,2),
  vat_on_commission NUMERIC(12,2)
);
```

**เงื่อนไขเพิ่มเติม:**
```
agent_id รันต่อเนื่องจาก AGT-001
sale_amount อยู่ระหว่าง 50,000-500,000 บาท
commission_amount = 3-5% ของ sale_amount
vat_on_commission = 7% ของ commission_amount (คำนวณจากค่าคอมมิชชัน ไม่ใช่จากยอดขาย)
```

**เกณฑ์ผ่าน:** `vat_on_commission` ต้อง = 7% ของ `commission_amount` จริง (ไม่ใช่ 7% ของ `sale_amount` และไม่ใช่ `null`) — ตรวจด้วยเครื่องคิดเลขจริงสัก 2-3 แถว จุดนี้คือจุดที่เคยพัง (ก่อนแก้) ถ้า Gemini เรียงคอลัมน์ `vat_on_commission` มาก่อน `commission_amount`

---

### Test 4 — Volume test (จำนวนแถวเยอะ ใกล้เพดาน 300)

ใช้ DDL จาก Test 1 หรือ 2 ก็ได้ ตั้งจำนวนแถวเป็น **280-300 แถว** ติ๊ก Beta

**เกณฑ์ผ่าน:**
- ไม่ error/timeout จาก Apps Script (เพดาน execution 6 นาที/ครั้ง)
- คอลัมน์ ai_context (เช่น customer_review) มีเนื้อหาครบทุกแถว ไม่มี `{{...}}` หลงเหลือ และไม่ซ้ำแบบเดิมทุกแถว (สุ่มจากแม่แบบหลายแบบ)
- เทียบเวลาที่ใช้ทั้งหมดกับตอนไม่ติ๊ก Beta ที่จำนวนแถวเท่ากัน (ควรเร็วกว่าชัดเจน เพราะตอนนี้ Rule Compiler ยิง Gemini แค่ 2 ครั้ง/รอบเท่านั้นไม่ว่าแถวจะเยอะแค่ไหน — compileRules_ 1 ครั้ง + AI self-check 1 ครั้ง — เท่ากับ path เดิมพอดี ไม่มีการเรียก Gemini เพิ่มสำหรับคอลัมน์ ai_context อีกต่อไป หลังแก้ปัญหาโควตาหมดเร็ว 2026-09-07)

---

### Test 5 — Reference Column Lock ร่วมกับ Rule Compiler

1. สร้างและ commit ชุดข้อมูลใดๆ ไปก่อน 1 ชุด (ไม่ต้องติ๊ก Beta ก็ได้) เก็บไว้เป็นชุดอ้างอิง
2. เปิดตัวเลือก "อ้างอิงข้อมูลจากชุดที่เคย Commit" (Reference Lock) เลือกคอลัมน์บางคอลัมน์จากชุดที่ commit ไว้
3. ติ๊ก "ใช้ Rule Compiler (Beta)" ด้วย แล้ว generate ชุดใหม่

**เกณฑ์ผ่าน:** คอลัมน์ที่ล็อกไว้ต้องได้ค่าจากชุดอ้างอิงจริง (ไม่ใช่ค่าที่ Rule Compiler สุ่มขึ้นเอง) — เพราะ `applyReferenceColumnLock_` ควรทับค่าอยู่แล้วไม่ว่าข้อมูลจะมาจาก path ไหน แต่ยังไม่เคยพิสูจน์คู่กันจริง

---

### Test 6 — รูปภาพ Schema/ER Diagram + Rule Compiler (เพิ่งแก้ ต้องพิสูจน์)

แนบรูป ER Diagram ที่มีความสัมพันธ์ระหว่างตาราง (เช่น 1 ตารางมี foreign key ไปอีกตาราง) โดย**ไม่ต้องพิมพ์ DDL** หรือพิมพ์ DDL แบบไม่ครบถ้วน ติ๊ก Beta แล้ว generate

**เกณฑ์ผ่าน:** Rule Compiler ต้องอ่านชื่อคอลัมน์/ชนิดข้อมูลจากรูปได้ถูกต้อง (เทียบว่าคอลัมน์ที่ได้ตรงกับที่เห็นในรูปจริง) — ถ้ายังส่ง DDL ว่างไม่ได้ (ระบบบังคับกรอก DDL) ให้ทดสอบแบบพิมพ์ DDL คร่าวๆ ไม่ครบทุกรายละเอียดแล้วดูว่า Gemini ใช้รูปช่วยเติมส่วนที่ขาดไหม

---

## เกณฑ์ตัดสินใจสุดท้าย (Go / No-Go)

| เงื่อนไข | ผ่านแล้ว |
|---|---|
| Test 1 (e-commerce) — คอลัมน์/percent_of/ai_context ถูกต้องครบ | ✅ (2026-09-07) |
| Test 1 — ไม่มี insurance hint รั่วข้ามโดเมน (เช็ค log console แล้ว) | ✅ (2026-09-08) |
| Test 2 (HR) ผ่านครบ รวม sequential zero-padding + ai_context template | ✅ (2026-09-07, รีเทสต์แล้ว) |
| Test 3 (percent_of ลูกโซ่ผ่าน Gemini จริง) ผ่าน — vat_on_commission = 7% ของ commission_amount ถูกต้องทุกแถว | ✅ (2026-09-07) |
| Test 4 (volume 280 แถว) ไม่ timeout/ไม่ตัดข้อมูล + ความหลากหลาย ai_context ปรับแล้ว | ✅ (2026-09-07/08) |
| Test 5 (Reference Lock + Beta) ค่าที่ล็อกไว้ถูกต้องครบ 5 คู่ | ✅ (2026-09-08) |
| Test 6 (รูปภาพ Schema + Beta) อ่านรูปได้จริง เติมคอลัมน์ที่ขาดจาก DDL ครบ | ✅ (2026-09-08) |
| Test 7 (Insurance Reference Data สดครั้งแรก) ค่าตรงจากคลังข้อมูลจริง | ✅ (2026-09-08) |

**สถานะ: GO — ผ่านครบทุกข้อแล้ว** พร้อมหลักฐานการทดสอบจริงกับ Gemini ทุกเคส (ไม่ใช่แค่ offline unit test) พร้อม push ขึ้น GitHub Pages / เปิดให้ทีมใช้งานจริง และพร้อมถอด label "Beta" ออกจากหน้าเว็บได้
