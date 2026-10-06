# เคสเดโมที่จำเป็น — ITDS (4 เคส ประมาณ 5 นาที)

> ตั้งจำนวนแถว = 10 / Dialect = PostgreSQL ทุกเคส
> ซ้อมรันจริงทั้ง 4 เคส 1 รอบก่อนวันนำเสนอ

---

## เคส 1 — Rule-Based Mode (สร้างด้วยโค้ด ไม่ใช้ AI)
- เปิด Rule-Based Mode / ชื่อตาราง: `customers` / ข้อกำหนดเพิ่มเติม: เว้นว่าง
- DDL Script:
```sql
CREATE TABLE customers (
    customer_id VARCHAR(20) PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    national_id CHAR(13) NOT NULL,
    gender VARCHAR(10),
    date_of_birth DATE,
    phone VARCHAR(10),
    email VARCHAR(100),
    province VARCHAR(50),
    zip_code CHAR(5),
    created_at DATE
);
```
- สิ่งที่โชว์: หน้าตรวจคุณภาพ → ตาราง + SQL → **Commit** → เปิด Google Sheets ให้เห็นข้อมูล
- พูด: "โหมดนี้ไม่เรียก AI ตอนสร้างข้อมูล ไม่เสียโควตา และได้โครงสร้างเหมือนเดิมทุกครั้ง"

## เคส 2 — Reference Column Lock (ต่อจากเคส 1)
- เปิด Rule-Based Mode / ชื่อตาราง: `life_policy`
- DDL Script:
```sql
CREATE TABLE life_policy (
    policy_no VARCHAR(20) PRIMARY KEY,
    customer_id VARCHAR(20) NOT NULL,
    policy_type VARCHAR(50),
    sum_assured DECIMAL(12,2) NOT NULL,
    premium DECIMAL(12,2),
    policy_status VARCHAR(20),
    policy_start_date DATE
);
```
- เปิด Reference Column Lock → เลือกชุด customers จากเคส 1 → ล็อก `customer_id`
- สิ่งที่โชว์: customer_id ทุกแถวเป็นค่าจริงจากชุด customers
- พูด: "ข้อมูลสองตารางอ้างอิงกันได้จริง ใช้ทดสอบ Foreign Key ได้เลย"

## เคส 3 — Legacy Mode + DDL (ให้ AI สร้าง)
- ปิด Rule-Based Mode / ชื่อตาราง: `test`
- DDL Script:
```sql
CREATE TABLE test (
    order_id INT PRIMARY KEY,
    customer_name VARCHAR(100) NOT NULL,
    email VARCHAR(100),
    order_date DATE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) NOT NULL,
    is_paid BOOLEAN
);
```
- ข้อกำหนดเพิ่มเติม:
```
สร้างข้อมูลคำสั่งซื้อโดยเน้นค่า:
- order_id เริ่มต้นตั้งแต่เลข 1001
- amount อยู่ในช่วง 500-5000 บาท
- order_date อยู่ในช่วงเดือนกันยายน 2569
- status มีค่าไล่เรียงกัน 4 แบบ: Pending, Shipped, Completed, Cancelled แบบสุ่ม
- is_paid เป็น TRUE เฉพาะสถานะ Shipped หรือ Completed เท่านั้น
```
- สิ่งที่โชว์: ข้อมูลตรงเงื่อนไขที่พิมพ์เป็นภาษาคน คอลัมน์เรียงตาม DDL
- พูด: "โหมดนี้ยืดหยุ่นกว่า ไม่ต้องมีกฎล่วงหน้า แต่ใช้โควตา AI"

## เคส 4 — ไม่พบกฎของคอลัมน์ (เคสผิดพลาดที่ตั้งใจ)
- เปิด Rule-Based Mode / ชื่อตาราง: `customers_ext`
- DDL Script:
```sql
CREATE TABLE customers_ext (
    customer_id VARCHAR(20) PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    favorite_color VARCHAR(20)
);
```
- สิ่งที่โชว์: ระบบหยุดและแจ้งว่า `favorite_color` ไม่มีกฎ → ส่งคำขอถึงผู้ดูแลระบบ → สลับบัญชี Super Admin ให้เห็นคำขอ
- พูด: "ระบบไม่เดาข้อมูลเอง ถ้าไม่มีกฎจะหยุดและบอกชัดว่าขาดคอลัมน์ไหน"

---

## เช็กก่อนวันจริง
- [ ] ชีต RuleTemplates จริงมีกฎครบทุกคอลัมน์ของเคส 1 และ 2 (ถ้าเคสไหนแจ้งว่าขาดกฎ ให้ลบคอลัมน์นั้นออกจาก DDL หรือเพิ่มกฎ)
- [ ] Commit เคส 1 ไว้ล่วงหน้าอีก 1 ชุด เผื่อ Commit บนเวทีไม่ทัน
- [ ] บัญชี QA Tester + Super Admin ใช้ได้
- [ ] อัดวิดีโอเดโมไว้สำรอง เผื่อเน็ตล่มหรือ Gemini ไม่ตอบ
