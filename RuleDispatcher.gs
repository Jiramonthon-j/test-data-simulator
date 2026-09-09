/**
 * ============================================================================
 * Rule Dispatcher (Phase 2) — ต้นแบบ (ยังไม่ได้เชื่อมเข้า handleGenerate_ จริงใน Code.gs)
 * ----------------------------------------------------------------------------
 * รับ JSON Rules ที่ buildRuleCompilerPrompt_() (ดู RuleCompilerPrompt.gs) ให้ Gemini แปลไว้แล้ว
 * มาสุ่มค่าเองล้วนๆ ด้วยโค้ดตรงนี้ — ไม่มีการเรียก Gemini อีกเลยแม้แต่ครั้งเดียวในไฟล์นี้ทั้งไฟล์
 * (fix 2026-09-07: เดิมคอลัมน์ประเภท "ai_context" ต้องเรียก Gemini ซ้ำอีก 1 ครั้งหลังสุ่มครบทุกแถว ผ่าน
 * fillAiContextColumns_ ทำให้ Hybrid ยิง Gemini 3 ครั้ง/รอบ แพงกว่าระบบเดิม (buildSmartPrompt_) ที่ใช้ 2 ครั้ง/รอบ
 * แก้โดยให้ Gemini เขียน "แม่แบบ" เนื้อหาจริงมาตั้งแต่ compileRules_ (ครั้งเดียว) แล้วโค้ดตรงนี้สุ่มเลือก+แทนค่า
 * เอง — ดู genAiContextFromTemplate_ ท้ายไฟล์ ฟังก์ชัน fillAiContextColumns_ เดิมถูกลบออกแล้ว)
 *
 * ใช้ฟังก์ชันจริงที่มีอยู่แล้วใน Code.gs โดยไม่เขียนซ้ำ: callGemini_, extractJsonFromAiText_,
 * logActivity_, getTodayContextStr_ — ไฟล์นี้แค่ "เสริม" ไม่ได้แก้ของเดิม
 *
 * จุด "จับ" จริงของทั้งระบบอยู่ที่ runGenerator_() บรรทัดล่าง — เป็น dictionary lookup ตรงๆ ตามชื่อ
 * generator ที่ Gemini ตอบมา ไม่มีการอ่าน/ตีความประโยคภาษาใดๆ ในไฟล์นี้เลยแม้แต่บรรทัดเดียว
 *
 * ตัวอย่างการเรียกใช้แบบครบวงจร (ยังเป็นทางเลือกเสริม ไม่ได้ผูกกับปุ่ม "สร้างข้อมูลทดสอบ" เดิม):
 *   const rules = compileRules_(p);                            // เรียก Gemini ครั้งเดียวทั้งหมด (Rule Compiler)
 *   const rows = generateRowsFromRules_(rules, rowsRequested); // สุ่มด้วยโค้ดล้วนๆ ไม่เรียก Gemini เลย (รวม ai_context)
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// PHASE 1 WRAPPER — เรียก Gemini ให้แปลเงื่อนไขเป็น Rules (เรียกครั้งเดียวต่อคำขอ)
// ---------------------------------------------------------------------------
function compileRules_(p) {
  const todayStr = getTodayContextStr_();
  const promptText = buildRuleCompilerPrompt_(p, todayStr);

  let aiText;
  try {
    // (fix) เดิมส่ง null แทนรูปตรงๆ ทำให้รูป Schema/ER Diagram ที่แนบมาถูกเมินไปเงียบๆ ทั้งที่ path เดิม
    // (buildSmartPrompt_/callGemini_) รองรับอยู่แล้ว — แก้โดยส่ง p.schemaImageBase64 ต่อเข้าไปเหมือน path เดิม
    aiText = callGemini_(promptText, p.schemaImageBase64);
  } catch (err) {
    throw new Error('เรียก Gemini (Rule Compiler) ไม่สำเร็จ: ' + err.message);
  }

  const rules = extractJsonColumns_(aiText);

  // กันเคส Gemini ตอบคอลัมน์ไม่ครบ/เกินจาก DDL แต่เนิ่นๆ ก่อนไปถึงขั้นสุ่มค่าจริง จะได้ error message ที่ชี้จุดผิดชัดเจน
  // แทนที่จะปล่อยให้ไปพังตอน generateRowsFromRules_ แบบบอกสาเหตุคลุมเครือ
  // (fix) เดิมเช็ค "extra" (คอลัมน์ที่ Gemini ตอบมาแต่ไม่มีใน DDL) เป็น error เสมอ ไม่ว่าจะแนบรูป Schema/ER Diagram
  // มาด้วยหรือไม่ — ทั้งที่ "จุดประสงค์ของการแนบรูป" คือให้ Gemini เติมคอลัมน์ที่ DDL พิมพ์มาไม่ครบ (ดู buildRuleCompilerPrompt_
  // ที่สั่งไว้ตรงๆ ว่าให้ใช้รูปเติมคอลัมน์ที่ขาด) ผลคือทุกครั้งที่ใช้รูปช่วยเติมคอลัมน์เกินจาก DDL ที่พิมพ์ (ทำงานถูกต้องตามที่ตั้งใจ
  // ทุกประการ) ระบบกลับ throw error ว่า "ตอบคอลัมน์ไม่ตรงกับ DDL" เสียเอง — พิสูจน์แล้วจริงจากการทดสอบ Test 6 (2026-09-08)
  // แก้โดยข้ามการเช็ค "extra" เฉพาะตอนมีรูปแนบมาด้วยเท่านั้น (เพราะคอลัมน์เกินอาจมาจากรูปจริงๆ ไม่ใช่ Gemini เพี้ยน)
  // ส่วนเช็ค "missing" ยังคงบังคับเสมอไม่ว่าจะมีรูปหรือไม่ — คอลัมน์ที่ผู้ใช้พิมพ์ใน DDL ตรงๆ ต้องมีอยู่ในผลลัพธ์เสมอ ห้ามหายไปเฉยๆ
  const ddlColumns = parseDdlColumns_(p.ddlScript || '');
  if (ddlColumns.length) {
    const ruleNames = rules.columns.map(function (c) { return c.name; });
    const missing = ddlColumns.filter(function (name) { return ruleNames.indexOf(name) === -1; });
    const extra = p.schemaImageBase64 ? [] : ruleNames.filter(function (name) { return ddlColumns.indexOf(name) === -1; });
    if (missing.length || extra.length) {
      throw new Error('Rule Compiler ตอบคอลัมน์ไม่ตรงกับ DDL — ขาด: [' + missing.join(', ') + ']' + (extra.length ? ' เกิน: [' + extra.join(', ') + ']' : ''));
    }
  }

  return rules;
}

// ใช้กับคำตอบของ Rule Compiler โดยเฉพาะ (key คือ "columns" ไม่ใช่ "rows" เหมือน extractJsonFromAiText_ เดิมที่ล็อกไว้เฉพาะ "rows")
function extractJsonColumns_(text) {
  const cleaned = String(text).trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) throw new Error('ไม่พบ JSON ในคำตอบของ Rule Compiler');
  const parsed = JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
  if (!parsed.columns || !Array.isArray(parsed.columns)) throw new Error('รูปแบบ JSON ที่ Rule Compiler ตอบกลับไม่มี key "columns" เป็น array');
  return parsed;
}

// ---------------------------------------------------------------------------
// PHASE 2 — DISPATCH: เมนูปิดของ generator ต้องตรงกับ RULE_GENERATOR_MENU_ ใน RuleCompilerPrompt.gs เป๊ะ
// เพิ่ม generator ใหม่ต้องแก้ 2 จุดพร้อมกันเสมอ (เมนูในนั้น + dictionary ตรงนี้) ไม่งั้น Gemini จะเลือกชื่อที่นี่ไม่รู้จัก
// ---------------------------------------------------------------------------
const GENERATORS_ = {
  pattern:         function (rule)      { return fillPattern_(rule.pattern); },
  enum:            function (rule)      { return pickEnum_(rule.values); },
  number_range:    function (rule)      { return genNumberRange_(rule.min, rule.max, rule.decimals); },
  date_range:      function (rule)      { return genDateRange_(rule.start, rule.end); },
  thai_citizen_id: function ()          { return genThaiCitizenId_(); },
  phone_th:        function ()          { return genPhoneTh_(); },
  sequential:      function (rule, ctx) { return genSequential_(rule, ctx.rowIndex); },
  email_from_name: function (rule, ctx) { return genEmailFromName_(rule, ctx.row); },
  percent_of:      function (rule, ctx) { return genPercentOf_(rule, ctx.row); },
  // (fix) เดิม ai_context ไม่อยู่ใน dictionary นี้ เพราะต้องเรียก Gemini ซ้ำอีก "1 ครั้งเพิ่ม" หลังสุ่มครบทุกแถวแล้ว
  // (ดูฟังก์ชัน fillAiContextColumns_ เดิม — ลบออกแล้ว) ทำให้ทุก generate ที่มีคอลัมน์ข้อความอิสระ (มีในตารางจริงแทบทุกตาราง
  // เช่น customer_review/performance_review) ต้องยิง Gemini 3 ครั้ง/รอบ (แปลงกฎ+เติมข้อความ+AI self-check) แพงกว่า
  // ระบบเดิม (buildSmartPrompt_) ที่ใช้แค่ 2 ครั้ง/รอบ — พิสูจน์จากการทดสอบจริงว่ากินโควตาเร็วกว่าของเดิมมาก (2026-09-07)
  // แก้โดยให้ Gemini เขียน "แม่แบบ" เนื้อหาจริงมาตั้งแต่ตอน compileRules_ (ครั้งเดียว) แล้วโค้ดตรงนี้สุ่มเลือก+แทนค่า
  // เองต่อแถว (ดู genAiContextFromTemplate_) ไม่ต้องเรียก Gemini ซ้ำอีกเลย — Hybrid จึงเหลือ 2 ครั้ง/รอบเท่าระบบเดิม
  ai_context:      function (rule, ctx) { return genAiContextFromTemplate_(rule, ctx.row); }
};

/**
 * วนสร้างข้อมูลทีละแถวตาม Rules — ไม่เรียก Gemini เลยในฟังก์ชันนี้ทั้งฟังก์ชัน
 * @param {Object} rules          ผลจาก compileRules_() — {"columns":[{name, generator, ...params}]}
 * @param {number} rowsRequested  จำนวนแถวที่ต้องการ
 */
function generateRowsFromRules_(rules, rowsRequested) {
  if (!rules || !rules.columns || !rules.columns.length) {
    throw new Error('Rules ไม่มีคอลัมน์ให้สุ่ม (columns ว่างหรือหายไป)');
  }

  // แยก percent_of ออกมาสุ่มทีหลังเสมอ เพราะต้องอ่านค่า baseColumn ที่ "สุ่มไปแล้ว" ในแถวเดียวกัน
  // แยก ai_context (แบบ template) ออกมาสุ่ม "หลังสุด" เพราะแม่แบบอาจอ้างอิง {{ชื่อคอลัมน์}} หรือ variants.when
  // ของคอลัมน์ไหนก็ได้ในแถวเดียวกัน (รวมถึงคอลัมน์ percent_of เอง) จึงต้องรอให้ทุกคอลัมน์อื่นมีค่าแล้วก่อนเสมอ
  const independentCols = rules.columns.filter(function (c) { return c.generator !== 'percent_of' && c.generator !== 'ai_context'; });
  const dependentCols   = rules.columns.filter(function (c) { return c.generator === 'percent_of'; });
  const templateCols    = rules.columns.filter(function (c) { return c.generator === 'ai_context'; });

  const rows = [];
  for (let i = 0; i < rowsRequested; i++) {
    const row = {};
    const ctx = { rowIndex: i, row: row };

    independentCols.forEach(function (col) { row[col.name] = runGenerator_(col, ctx); });

    // (fix) percent_of อาจต่อกันเป็นลูกโซ่ได้ (เช่น stamp_duty = %ของ premium และ premium = %ของ sum_assured)
    // เดิมสุ่มทุกคอลัมน์ในกลุ่ม percent_of "พร้อมกันทีเดียว" ตามลำดับที่ Gemini ส่ง columns มา — ถ้า Gemini
    // ดันเรียง stamp_duty มาก่อน premium (สลับกับที่คาดไว้) จะได้ stamp_duty=null ทันที เพราะ premium ยังไม่มีค่า
    // ตอนนั้น (พิสูจน์แล้วจริงจากการทดสอบ 2026-09 — สลับลำดับ 2 คอลัมน์แล้ว null ทันที)
    // แก้ด้วย multi-pass: วนสุ่มเฉพาะคอลัมน์ที่ baseColumn ของมัน "มีค่าอยู่ในแถวแล้ว" ไปเรื่อยๆ จนกว่าจะไม่มี
    // ความคืบหน้าอีก (แก้ปัญหาลำดับได้ไม่ว่า Gemini จะส่งคอลัมน์มาลำดับไหนก็ตาม รองรับลูกโซ่กี่ชั้นก็ได้)
    // ถ้าค้าง (baseColumn ไม่มีอยู่จริง หรือ A/B อ้างอิงกันเองเป็นวงกลม) จะหยุด loop แล้วปล่อยให้รันแบบปกติ
    // ต่อ (จะได้ null + log ตามพฤติกรรมเดิมของ genPercentOf_ ไม่ค้างเป็น infinite loop)
    let remaining = dependentCols.slice();
    let safetyRounds = remaining.length + 1;
    while (remaining.length && safetyRounds > 0) {
      const stillPending = [];
      remaining.forEach(function (col) {
        if (Object.prototype.hasOwnProperty.call(row, col.baseColumn)) {
          row[col.name] = runGenerator_(col, ctx);
        } else {
          stillPending.push(col);
        }
      });
      if (stillPending.length === remaining.length) break; // ไม่มีความคืบหน้าเลยรอบนี้ (อ้างอิงวนกันเอง/ไม่มีจริง) หยุดกันลูปค้าง
      remaining = stillPending;
      safetyRounds--;
    }
    remaining.forEach(function (col) { row[col.name] = runGenerator_(col, ctx); }); // ที่เหลือค้างจริงๆ ให้รันแบบเดิม (null + log)

    // (fix) ai_context (แบบ template) ต้องรันเป็นลำดับสุดท้ายเสมอ หลังคอลัมน์อื่นทุกตัวในแถวนี้มีค่าแล้วจริงๆ
    // เพราะแม่แบบอาจอ้าง {{ชื่อคอลัมน์}} หรือ variants.when ของคอลัมน์ไหนก็ได้ รวมถึงคอลัมน์ percent_of ที่เพิ่งสุ่มไปข้างบน
    templateCols.forEach(function (col) { row[col.name] = runGenerator_(col, ctx); });

    rows.push(row);
  }
  return rows;
}

// จุด "จับ" จริงของทั้งระบบ — lookup ชื่อ generator ตรงๆ กับ dictionary ปิด ไม่มีการตีความภาษาใดๆ ในนี้เลย
// ถ้า Gemini ตอบชื่อ generator ที่ไม่รู้จัก (พิมพ์ผิด/หลอน) ไม่ throw ทันที เพราะ 1 คอลัมน์พังไม่ควรทำทั้ง batch ล้ม
// แต่ log ไว้ให้เห็นชัดว่าเกิดจากอะไร แล้วใส่ null แทน (เหมือนพฤติกรรม allowNull ของระบบเดิม)
function runGenerator_(col, ctx) {
  const fn = GENERATORS_[col.generator];
  if (!fn) {
    logActivity_('SYSTEM', 'SYSTEM', 'RULE_GENERATOR_UNKNOWN',
      'คอลัมน์ "' + col.name + '" ได้ generator ที่ไม่รู้จัก: "' + col.generator + '" — ใส่ null แทน');
    return null;
  }
  return fn(col, ctx);
}

// ---------------------------------------------------------------------------
// GENERATOR ฟังก์ชันจริงแต่ละตัว — ล้วนเป็นโค้ดสุ่มธรรมดา ไม่มีตัวไหนเรียก Gemini เลย
// ---------------------------------------------------------------------------
function fillPattern_(pattern) {
  if (!pattern) return '';
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '#') out += Math.floor(Math.random() * 10);
    else if (ch === '@') out += String.fromCharCode(65 + Math.floor(Math.random() * 26));
    else out += ch;
  }
  return out;
}

function pickEnum_(values) {
  if (!values || !values.length) return null;
  return values[Math.floor(Math.random() * values.length)];
}

function genNumberRange_(min, max, decimals) {
  const lo = Number(min), hi = Number(max), d = decimals || 0;
  if (isNaN(lo) || isNaN(hi)) return null;
  const val = lo + Math.random() * (hi - lo);
  const factor = Math.pow(10, d);
  return Math.round(val * factor) / factor;
}

function genDateRange_(start, end) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) {
    // (fix) เดิม return "start" (string ดิบที่ parse ไม่ผ่าน) ตรงๆ — ได้ค่าเดียวกันซ้ำทุกแถวและมักไม่ใช่รูปแบบวันที่ที่ใช้งานได้จริง
    // ซึ่งเป็นบั๊กคลาสเดียวกับ genEmailFromName_ (generator คืนค่าที่ "ไม่สัมพันธ์กับเจตนาเดิม" แบบเงียบๆ ไม่มีใครรู้ตัว)
    // แก้โดย log ให้เห็นชัดเจน (เหมือน runGenerator_ ตอนเจอ generator ที่ไม่รู้จัก) แล้วคืน null แทน ให้ระบบ allowNull จัดการต่อตามปกติ
    logActivity_('SYSTEM', 'SYSTEM', 'RULE_GENERATOR_BAD_INPUT',
      'date_range parse ไม่ผ่าน (start="' + start + '", end="' + end + '") — ใส่ null แทน');
    return null;
  }
  const randMs = startMs + Math.random() * (endMs - startMs);
  return Utilities.formatDate(new Date(randMs), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// สูตร checksum จริงของเลขบัตรประชาชนไทย: หลักที่ 13 = (11 - (ผลรวม(หลักที่ i * (13-i)) mod 11)) mod 10
function genThaiCitizenId_() {
  const digits = [1 + Math.floor(Math.random() * 8)]; // หลักแรกใช้ 1-8 ตามรูปแบบเลขบัตรจริงทั่วไป
  for (let i = 1; i < 12; i++) digits.push(Math.floor(Math.random() * 10));
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += digits[i] * (13 - i);
  const checkDigit = (11 - (sum % 11)) % 10;
  return digits.join('') + checkDigit;
}

function genPhoneTh_() {
  const prefixes = ['06', '08', '09'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  let rest = '';
  for (let i = 0; i < 8; i++) rest += Math.floor(Math.random() * 10);
  return prefix + rest;
}

// (fix) เดิมไม่รองรับเลขศูนย์นำหน้า (zero-padding) เลย — ตัวอย่างเงื่อนไข "EMP-2026-001" ถูกแปลงเป็น
// rule.start=1 (Number) เพียวๆ ไม่มีที่เก็บว่า "001" ยาว 3 หลัก ผลคือทุกแถวออกมาเป็น "EMP-2026-1",
// "EMP-2026-2", ... ไม่ตรงรูปแบบเลย — จับได้จริงจาก AI self-check ตอนทดสอบโดเมน HR (2026-09-06)
// แก้โดยเพิ่มพารามิเตอร์ digits ในเมนู generator (ดู RuleCompilerPrompt.gs) ให้ Gemini ระบุความยาวหลัก
// ที่ต้องการมาตรงๆ แล้ว padStart ด้วยเลข 0 ตามนั้น — ถ้าไม่ส่ง digits มา (คอลัมน์ไม่ต้องการเลขศูนย์นำหน้า)
// พฤติกรรมยังเหมือนเดิมทุกประการ ไม่กระทบเคสที่เคยใช้งานถูกต้องอยู่แล้ว
function genSequential_(rule, rowIndex) {
  const start = (rule.start !== undefined && rule.start !== null) ? Number(rule.start) : 1;
  const num = start + rowIndex;
  const digits = (rule.digits !== undefined && rule.digits !== null) ? Number(rule.digits) : 0;
  const numStr = (digits > 0 && !isNaN(digits)) ? String(num).padStart(digits, '0') : String(num);
  return (rule.prefix || '') + numStr;
}

// (fix) เดิม regex [^a-z0-9] ตัดทุกอักขระที่ไม่ใช่ a-z0-9 ทิ้งหมด ทำให้ชื่อภาษาอื่นที่ไม่ใช่อังกฤษ (ไทย/จีน/ญี่ปุ่น/อาหรับ ฯลฯ)
// โดนกรองจนเหลือค่าว่าง แล้ว fallback เป็น "user"+เลขสุ่ม ซึ่งไม่มีความสัมพันธ์กับชื่อจริงเลย — พิสูจน์แล้วจริงจาก AI self-check
// ที่จับได้ตรงๆ ว่า "email ไม่ได้ถูกสร้างหรือมีความสัมพันธ์กับคอลัมน์ customer_name ตามเงื่อนไข" (ทดสอบจริงกับชื่อไทย 2026-09)
// แก้โดยใช้ \p{L}/\p{N}/\p{M} (Unicode property escape, รองรับใน V8 runtime ของ Apps Script) เก็บตัวอักษร/ตัวเลขได้ทุกภาษา
// \p{M} (combining mark) ต้องรวมไว้ด้วยเสมอ ไม่งั้นภาษาที่มีสระ/วรรณยุกต์ลอย (ไทย/เวียดนาม/ฮินดี ฯลฯ) จะถูกตัดกลางคำ
// เช่น "สมหญิง" -> ถ้าไม่รวม \p{M} จะได้ "สมหญ.ง" (ตัวสระ ิ หลุดไปแยกเป็นคนละ token) แก้แล้วได้ "สมหญิง" ครบคำ
// ไม่จำกัดแค่ a-z0-9 อีกต่อไป แก้ปัญหาทั้งคลาส (ชื่อภาษาไหนก็ได้) ไม่ใช่แค่เคสภาษาไทยเคสเดียว
function genEmailFromName_(rule, currentRow) {
  const nameVal = rule.nameColumn ? currentRow[rule.nameColumn] : null;
  const slug = String(nameVal || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '.')
    .replace(/^\.+|\.+$/g, '');
  const base = slug || 'user'; // เหลือ fallback ไว้เฉพาะกรณีค่าว่างจริงๆ (เช่น nameColumn พิมพ์ผิดหรือ currentRow ยังไม่มีค่านั้น)
  const rand = Math.floor(100 + Math.random() * 900);
  return base + rand + '@example.com';
}

function genPercentOf_(rule, currentRow) {
  const baseVal = Number(currentRow[rule.baseColumn]);
  if (isNaN(baseVal)) {
    // (fix) เดิมคืน null เงียบๆ ไม่มี log — ถ้า Gemini พิมพ์ชื่อ baseColumn ผิด (เช่นสะกดเพี้ยนจากชื่อคอลัมน์จริงใน DDL)
    // จะไม่มีใครสังเกตเห็นเลยว่าทำไมค่านี้ถึงว่างทุกแถว ต้องมานั่งไล่เดา — log ไว้ให้เห็นสาเหตุตรงๆ เหมือนจุดอื่นที่แก้ไปแล้ว
    logActivity_('SYSTEM', 'SYSTEM', 'RULE_GENERATOR_BAD_INPUT',
      'percent_of หา baseColumn "' + rule.baseColumn + '" ไม่เจอ/ไม่ใช่ตัวเลขในแถวนี้ — ใส่ null แทน');
    return null;
  }
  const pMin = Number(rule.percentMin), pMax = Number(rule.percentMax);
  const pct = (isNaN(pMin) || isNaN(pMax)) ? 0 : pMin + Math.random() * (pMax - pMin);
  return Math.round(baseVal * pct / 100 * 100) / 100;
}

// ---------------------------------------------------------------------------
// AI_CONTEXT (แบบ template) — เฉพาะคอลัมน์ที่ Rule Compiler ตัดสินว่าซับซ้อนเกินเมนู generator ปิด
// (fix) เดิมฟังก์ชันนี้ (fillAiContextColumns_) เรียก Gemini อีก "1 ครั้งเพิ่ม" หลังสุ่มครบทุกแถวแล้ว เพื่อให้ Gemini
// เขียนเนื้อหาจริงทีเดียวทุกแถว ทำให้ Hybrid ยิง Gemini 3 ครั้ง/รอบ (แปลงกฎ+เติมข้อความ+AI self-check) แพงกว่า
// ระบบเดิม (buildSmartPrompt_) ที่ใช้แค่ 2 ครั้ง/รอบ — พิสูจน์จากการทดสอบจริงว่ากินโควตาเร็วกว่าของเดิมมาก (2026-09-07)
// ลบฟังก์ชันนั้นทิ้งแล้ว แทนที่ด้วย genAiContextFromTemplate_ ด้านล่าง ซึ่งไม่เรียก Gemini เลย — เพราะตอนนี้
// compileRules_ (เรียกครั้งเดียว) ให้ Gemini เขียน "แม่แบบ" เนื้อหาจริงมาตั้งแต่ต้นแล้ว (ดู RuleCompilerPrompt.gs
// ส่วน "(2) ถ้าเป็นข้อความอิสระ...") โค้ดตรงนี้แค่สุ่มเลือกแม่แบบที่เหมาะกับแถวนั้น + แทนค่าคอลัมน์จริงเอง
// ---------------------------------------------------------------------------

// เลือก pool ของแม่แบบที่ตรงกับแถวปัจจุบันที่สุด: ถ้ามี variants ให้หา variant ที่ "when" ตรงกับค่าจริงในแถวนี้ทุกคีย์
// (รองรับ when เป็นค่าเดียวหรือ array ของค่าที่ยอมรับได้) ถ้าไม่ตรง variant ไหนเลยให้ fallback ไปที่ templates ระดับบนสุด
// ถ้าไม่มี variants เลยตั้งแต่แรก (คอลัมน์ไม่ต้องแยกตามบริบท) ก็ใช้ templates ตรงๆ
function pickAiContextTemplatePool_(rule) {
  if (Array.isArray(rule.variants) && rule.variants.length) {
    const matched = rule.variants.filter(function (v) {
      if (!v || !v.when) return false;
      return Object.keys(v.when).every(function (key) {
        const want = v.when[key];
        const actual = rule.__row && rule.__row[key];
        if (Array.isArray(want)) return want.map(String).indexOf(String(actual)) !== -1;
        return String(actual) === String(want);
      });
    });
    const pool = [].concat.apply([], matched.map(function (v) { return Array.isArray(v.templates) ? v.templates : []; }));
    if (pool.length) return pool;
  }
  return Array.isArray(rule.templates) ? rule.templates : [];
}

// แทนที่ {{ชื่อคอลัมน์}} ในแม่แบบด้วยค่าจริงของคอลัมน์นั้นในแถวเดียวกัน — ถ้าอ้างชื่อคอลัมน์ที่ไม่มีอยู่จริง
// (Gemini สะกดผิด/คอลัมน์ถูกตัดออกไปก่อนหน้านี้) ให้แทนด้วยค่าว่างเงียบๆ แทนที่จะโชว์ "{{...}}" ดิบๆ ในผลลัพธ์
function fillTemplatePlaceholders_(template, row) {
  return String(template).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, function (m, colName) {
    const val = row[colName];
    return (val === undefined || val === null) ? '' : String(val);
  });
}

// (fix 2026-09-10) เดิมสุ่มเลือกแม่แบบแบบ "สุ่มอิสระทุกแถว" (random with replacement, ดู pool[Math.floor(Math.random()*pool.length)] เดิม)
// พิสูจน์จริงว่าต่อให้มีแม่แบบมากพอ (เช่น 5 แม่แบบสำหรับ 5 แถว) ก็ยังมีโอกาสสุ่มซ้ำโดยบังเอิญได้ (เจอจริง: ซ้ำ 3 ใน 5 แถว 2026-09-10)
// แก้ด้วยเทคนิคเดียวกับ applyReferenceColumnLock_ ใน Code.gs — สับไพ่ (Fisher-Yates, ใช้ shuffleArray_ ตัวเดียวกัน) แล้ว
// "วนใช้ตามลำดับ" (round-robin) แทน การันตีว่าถ้ามีแม่แบบมากพอ (>= จำนวนแถวที่เหลือในรอบสับไพ่นั้น) จะไม่ซ้ำกันเลยจริงๆ
// ไม่ใช่แค่ "โอกาสน้อยลง" — ใช้ได้เฉพาะกรณีไม่มี variants เท่านั้น (pool คงที่ตลอดทั้งคอลัมน์) เพราะกรณีมี variants
// pool อาจเปลี่ยนไปตามค่าจริงในแต่ละแถว (เช่น variant ต่างกันตามสถานะจัดส่ง) ไม่มี "ชุดคงที่" ให้วนรอบได้ เคสนั้นยังคงสุ่มอิสระแบบเดิมไปก่อน
function genAiContextFromTemplate_(rule, currentRow) {
  // ผูกแถวปัจจุบันเข้ากับ rule ชั่วคราวเพื่อให้ pickAiContextTemplatePool_ อ่านค่าจริงมาเทียบ variants.when ได้
  // (ไม่กระทบ rule ต้นฉบับข้ามแถว เพราะ rowIndex ถัดไปจะ set ค่านี้ทับใหม่ทุกครั้งอยู่แล้ว)
  rule.__row = currentRow;
  const pool = pickAiContextTemplatePool_(rule);
  if (!pool.length) {
    // (fix) กัน edge case ที่ Gemini ตอบ schema มาไม่ครบ (ไม่มีทั้ง templates และ variants ที่ match ได้เลย)
    // ไม่ควรทำให้ทั้งแถวพังเพราะคอลัมน์เดียว — log ให้เห็นสาเหตุชัดเจนแล้วคืน null แทน (เหมือน generator อื่นๆ)
    logActivity_('SYSTEM', 'SYSTEM', 'RULE_GENERATOR_BAD_INPUT',
      'ai_context ("' + rule.name + '") ไม่มีแม่แบบ (templates/variants) ให้เลือกเลย — ใส่ null แทน');
    return null;
  }

  const hasVariants = Array.isArray(rule.variants) && rule.variants.length > 0;
  if (!hasVariants) {
    if (!rule.__shuffledPool || !rule.__shuffledPool.length || rule.__cycleIndex >= rule.__shuffledPool.length) {
      // ยังไม่เคยสับไพ่เลย หรือใช้ครบรอบแล้ว (แถวมากกว่าจำนวนแม่แบบ) — สับไพ่รอบใหม่แล้ววนต่อ
      // ยังดีกว่าสุ่มอิสระล้วนๆ เพราะรับประกันว่า "ภายในแต่ละรอบสับไพ่" จะไม่ซ้ำกันเอง แม้ข้ามรอบอาจซ้ำกันได้บ้างถ้าแถวเยอะกว่าแม่แบบมาก
      rule.__shuffledPool = shuffleArray_(pool);
      rule.__cycleIndex = 0;
    }
    const chosen = rule.__shuffledPool[rule.__cycleIndex];
    rule.__cycleIndex++;
    return fillTemplatePlaceholders_(chosen, currentRow);
  }

  const chosen = pool[Math.floor(Math.random() * pool.length)];
  return fillTemplatePlaceholders_(chosen, currentRow);
}
