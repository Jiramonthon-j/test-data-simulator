# ชุดเคสทดสอบสำหรับเดโม — Intelligent Test Data Simulator (ITDS)

> ก่อนวันนำเสนอ ให้รันทุกเคสจริง 1 รอบบนเครื่องที่จะใช้ เพื่อยืนยันว่ากฎในชีต RuleTemplates ของระบบจริงมีครบตามที่เคสต้องการ
> (DDL ของเคส Rule-Based ออกแบบจากไฟล์ `RuleTemplates_Insurance.xlsx` — ถ้าชีตจริงต่างจากไฟล์นี้ ผลอาจต่างไป)
> ตั้งจำนวนแถว = 10 ทุกเคส (เร็วและอ่านบนจอได้) / Dialect = PostgreSQL ยกเว้นเคสที่ระบุ

| เคส | โหมด | สิ่งที่พิสูจน์ | ใช้ AI สร้างข้อมูล | แนะนำโชว์บนเวที |
|---|---|---|---|---|
| 1 | Legacy | สร้างจากคำสั่งภาษาคนล้วน ไม่แนบ DDL | ใช่ | ✓ |
| 2 | Legacy + DDL | บังคับคอลัมน์ตาม DDL (ชุดเดียวกับภาคผนวก ก) | ใช่ | ✓ |
| 3 | Legacy + รูป ER | สร้างจากรูป ER Diagram | ใช่ | ถ้ามีเวลา |
| 4 | Rule-Based | สร้างด้วยโค้ดล้วน ไม่ใช้โควตา | ไม่ | ✓ (เคสหลัก) |
| 5 | Rule-Based | กฎเฉพาะตาราง (Override) + ค่าที่คำนวณจากคอลัมน์อื่น | ไม่ | ✓ |
| 6 | Rule-Based + Reference Lock | อ้างอิงค่าจริงจากชุดที่ Commit แล้ว | ไม่ | ✓ |
| 7 | Rule-Based (เคสผิดพลาด) | ไม่พบกฎของคอลัมน์ → ระบบหยุดและแจ้ง | ไม่ | ✓ |
| 8 | Rule-Based (เคสผิดพลาด) | ไม่แนบ DDL → ระบบไม่ยอมสร้าง | ไม่ | ถ้ามีเวลา |
| 9 | ส่งออก / Dialect | ไฟล์ .sql .csv .json และ SQL ต่าง Dialect | — | ✓ |

---

## เคส 1 — Legacy Mode: คำสั่งภาษาคนล้วน (ไม่แนบ DDL)
- ปิด Rule-Based Mode / ชื่อตาราง: `health_claims` / DDL: เว้นว่าง
- ข้อกำหนดเพิ่มเติม:
```
สร้างข้อมูลการเคลมประกันสุขภาพ มีเลขที่เคลม ชื่อผู้เอาประกัน โรงพยาบาล ผลการวินิจฉัย วันที่เข้ารักษา ยอดเคลม และสถานะการเคลม
- ยอดเคลมอยู่ระหว่าง 5,000-200,000 บาท
- วันที่เข้ารักษาอยู่ในปี 2569
- สถานะมี 3 แบบ: Approved, Pending, Rejected
```
- ผลที่คาดหวัง: ได้ 10 แถว คอลัมน์ตามที่บรรยาย ยอดเคลมอยู่ในช่วงที่กำหนด ผ่านหน้าตรวจคุณภาพ
- จุดที่พูด: "โหมดนี้ยืดหยุ่น ไม่ต้องมีกฎล่วงหน้า แต่ใช้โควตา AI และรันซ้ำจะได้ข้อมูลไม่เหมือนเดิม"

## เคส 2 — Legacy Mode + DDL (ชุดเดียวกับภาคผนวก ก)
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
- ผลที่คาดหวัง: คอลัมน์ครบ 7 ตัวและเรียงตาม DDL, is_paid = TRUE เฉพาะ Shipped/Completed
- จุดที่พูด: "ต่อให้ AI ตอบคอลัมน์เกินหรือสลับลำดับมา โค้ดจะจัดให้ตรง DDL เสมอ"

## เคส 3 — Legacy Mode + รูป ER Diagram
- ปิด Rule-Based Mode / ชื่อตาราง: `customer_orders` / DDL: เว้นว่าง
- แนบรูป: `customer_orders_er_diagram.png` (อยู่ในโฟลเดอร์ Test Deploy)
- ข้อกำหนดเพิ่มเติม:
```
สร้างข้อมูลตามโครงสร้างในรูป ER Diagram
- quantity อยู่ระหว่าง 1-5
- total_amount = quantity x unit_price
- payment_method มี: บัตรเครดิต, โอนเงิน, เก็บเงินปลายทาง
```
- ผลที่คาดหวัง: ได้ 14 คอลัมน์ตามรูป total_amount คำนวณถูก
- หมายเหตุ: ถ้าไม่แนบ DDL โค้ดจะบังคับคอลัมน์ไม่ได้ ผลขึ้นกับการอ่านรูปของ AI — เหมาะใช้โชว์ความยืดหยุ่น

## เคส 4 — Rule-Based Mode: สร้างด้วยโค้ดล้วน (เคสหลัก)
- เปิด Rule-Based Mode / ชื่อตาราง: `customers`
- DDL Script (ทุกคอลัมน์มีกฎกลางในชีต RuleTemplates):
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
- ข้อกำหนดเพิ่มเติม: เว้นว่าง (โหมดนี้ใช้กฎจากชีต)
- ผลที่คาดหวัง:
  - customer_id เรียงต่อกันแบบ `CUST-000001`, `CUST-000002`, …
  - national_id 13 หลัก checksum ถูกต้องตามเลขบัตรประชาชนไทย
  - phone ขึ้นต้น 06/08/09 และ email สร้างจาก full_name
  - Activity Log ไม่มีการเรียก Gemini ในขั้นสร้างข้อมูล
- **กด Commit เคสนี้ไว้** เพื่อใช้เป็นข้อมูลอ้างอิงในเคส 6
- จุดที่พูด: "โหมดนี้ไม่เรียก AI ตอนสร้างข้อมูลเลย ไม่เสียโควตา รันซ้ำได้โครงสร้างเหมือนเดิมทุกครั้ง"

## เคส 5 — Rule-Based Mode: กฎเฉพาะตาราง (Override) + ค่าคำนวณ
- เปิด Rule-Based Mode / ชื่อตาราง: `life_policy` (ต้องสะกดตรงนี้ เพื่อให้ใช้กฎเฉพาะตาราง)
- DDL Script:
```sql
CREATE TABLE life_policy (
    policy_no VARCHAR(20) PRIMARY KEY,
    policy_type VARCHAR(50),
    sum_assured DECIMAL(12,2) NOT NULL,
    premium DECIMAL(12,2),
    premium_payment_frequency VARCHAR(20),
    policy_status VARCHAR(20),
    policy_start_date DATE,
    policy_end_date DATE,
    agent_code VARCHAR(10),
    insurer_name VARCHAR(100)
);
```
- ผลที่คาดหวัง:
  - insurer_name เป็นบริษัทประกันชีวิตเท่านั้น (กฎเฉพาะตาราง life_policy ทับกฎกลาง)
  - premium คำนวณเป็นเปอร์เซ็นต์ของ sum_assured (generator percent_of)
  - policy_no รูปแบบ `POL-########`
- จุดที่พูด: "ตั้งกฎกลางไว้ใช้ทุกตาราง แล้วเขียนกฎเฉพาะตารางทับได้เมื่อต้องการ"

## เคส 6 — Reference Column Lock (อ้างอิงข้อมูลจริงที่ Commit แล้ว)
- ต้อง Commit เคส 4 ก่อน
- เปิด Rule-Based Mode / ชื่อตาราง: `life_policy`
- DDL: ใช้ของเคส 5 แล้วเพิ่มคอลัมน์ `customer_id VARCHAR(20) NOT NULL` ต่อจาก policy_no
- เปิด Reference Column Lock → เลือกชุดข้อมูล customers จากเคส 4 → ล็อกคอลัมน์ `customer_id`
- ผลที่คาดหวัง: customer_id ทุกแถวเป็นค่าที่มีอยู่จริงในชุด customers และใช้ครบทุกคนก่อนวนซ้ำ (Fisher-Yates + Round-robin)
- จุดที่พูด: "ข้อมูลสองตารางอ้างอิงกันได้จริง เอาไปทดสอบ Foreign Key ได้เลย"

## เคส 7 — ไม่พบกฎของคอลัมน์ (เคสผิดพลาดที่ตั้งใจ)
- เปิด Rule-Based Mode / ชื่อตาราง: `customers_ext`
- DDL Script:
```sql
CREATE TABLE customers_ext (
    customer_id VARCHAR(20) PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    favorite_color VARCHAR(20)
);
```
- ผลที่คาดหวัง: ระบบหยุด และแจ้งว่าคอลัมน์ `favorite_color` ยังไม่มีกฎ
- ต่อด้วย: กดส่งคำขอถึงผู้ดูแลระบบ → สลับไปบัญชี Super Admin ให้เห็นคำขอ (ต่อเข้าสไลด์ระบบติดต่อผู้ดูแลระบบ) หรือปิด Rule-Based แล้วสร้างด้วย Legacy แทน
- จุดที่พูด: "ระบบไม่เดาข้อมูลเอง ถ้าไม่มีกฎจะหยุดและบอกชัดว่าขาดคอลัมน์ไหน"

## เคส 8 — Rule-Based โดยไม่แนบ DDL (เคสผิดพลาดที่ตั้งใจ)
- เปิด Rule-Based Mode / DDL: เว้นว่าง / กดสร้าง
- ผลที่คาดหวัง: แจ้งว่า Rule-Based Mode ต้องแนบ DDL Script เสมอ

## เคส 9 — ส่งออกและ Dialect
- ใช้ผลจากเคส 2 หรือ 4
- ดาวน์โหลด .sql / .csv / .json ครบ 3 แบบ
- เปลี่ยน Dialect เป็น MySQL แล้วสร้างใหม่ เทียบคำสั่ง INSERT กับ PostgreSQL

---

## ลำดับเดโมที่แนะนำ (5–7 นาที)
1. เข้าสู่ระบบ → หน้าแรก/Dashboard
2. **เคส 4** (Rule-Based) → หน้าตรวจคุณภาพ → ตาราง + SQL → Commit → เปิด Google Sheets ให้ดู + Activity Log
3. **เคส 6** (Reference Lock ต่อจากเคส 4)
4. **เคส 2** (Legacy + DDL) เทียบกับ Rule-Based
5. **เคส 7** (ไม่พบกฎ) → ส่งคำขอ → สลับบัญชี Super Admin
6. ถ้ามีเวลา: เคส 1 / 3 / 9

## สิ่งที่ต้องเช็กก่อนวันจริง
- [ ] ชีต RuleTemplates ของระบบจริงมีกฎครบทุกคอลัมน์ของเคส 4, 5 และมีกฎเฉพาะ `life_policy` สำหรับ insurer_name
- [ ] Commit เคส 4 ไว้ล่วงหน้าอีก 1 ชุด เผื่อ Commit บนเวทีไม่ทัน
- [ ] บัญชี QA Tester + Super Admin ใช้ได้ (อย่ากรอกรหัสผิด 3 ครั้ง)
- [ ] โควตา Gemini เหลือพอสำหรับเคส Legacy + การตรวจคุณภาพทุกเคส
- [ ] อัดวิดีโอเดโมทุกเคสไว้สำรอง
