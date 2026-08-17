/**
 * ============================================================================
 * Intelligent Test Data Simulator — Backend (Google Apps Script)
 * ----------------------------------------------------------------------------
 * ไฟล์นี้ต้องถูกวางไว้ใน Google Sheet ที่จะใช้เป็นฐานข้อมูล
 * (Extensions > Apps Script > วางโค้ดนี้ทับไฟล์ Code.gs เริ่มต้น)
 *
 * วิธีตั้งค่าเบื้องต้น:
 *   1. รันฟังก์ชัน setupSheet() หนึ่งครั้ง (จะขอสิทธิ์เข้าถึง Sheet — กด Allow)
 *      -> จะสร้าง 7 แท็บ: Users, ActivityLogs, GeneratedDatasets, SavedPrompts, GeneratedPromptLogs, ColumnSchemaConfig, QualityScores
 *      -> จะสร้างผู้ใช้เริ่มต้น username: Admin123 / password: SecurePassword!1 (role: Super_Admin)
 *   2. Project Settings (รูปเฟือง) > Script Properties > เพิ่มคีย์ GEMINI_API_KEY = <API key ของคุณ>
 *      (ขอฟรีได้ที่ https://aistudio.google.com/apikey — ไม่ต้องผูกบัตรเครดิต มี Free Tier ให้ใช้งานได้เลย)
 *   3. Deploy > New deployment > เลือกประเภท "Web app"
 *      - Execute as: Me
 *      - Who has access: Anyone
 *      -> จะได้ URL ของ Web App เอาไปใส่ในตัวแปร BACKEND_URL ที่หน้าเว็บ (Final.html)
 *
 * ดูรายละเอียดขั้นตอนแบบเต็มได้ในไฟล์ DEPLOY_GUIDE.md ที่มาคู่กัน
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------
const SHEET_NAMES = {
  USERS: 'Users',
  LOGS: 'ActivityLogs',
  DATASETS: 'GeneratedDatasets',
  PROMPTS: 'SavedPrompts',       // เฉพาะ prompt ที่ผู้ใช้ตั้งชื่อเองแล้วกด "บันทึก" ไว้ใช้ซ้ำ (ดึงกลับมาใช้บนหน้าเว็บได้)
  PROMPT_LOGS: 'GeneratedPromptLogs', // prompt ทุกครั้งที่กด Generate โดยยังไม่ได้ตั้งใจบันทึกไว้ใช้ซ้ำ (เก็บไว้ตรวจสอบย้อนหลังอย่างเดียว)
  SCHEMA: 'ColumnSchemaConfig',
  QUALITY: 'QualityScores'
};

// โมเดล Gemini ที่จะเรียกใช้ — ใช้ alias "gemini-flash-latest" เพื่อให้ชี้ไปยังรุ่น Flash ล่าสุดที่ Google รองรับเสมอ
// (กัน error "model no longer available" ที่เกิดขึ้นเมื่อ Google เลิกรองรับรุ่นเก่าแล้วบังคับให้ผู้ใช้ใหม่ต้องใช้รุ่นใหม่กว่า)
// รองรับ Free Tier (ไม่ต้องผูกบัตรเครดิต) และรับรูปภาพ (vision) ได้ด้วย
// ถ้าต้องการล็อกรุ่นตายตัวแทน ดูรายชื่อรุ่นที่รองรับได้ที่ https://ai.google.dev/gemini-api/docs/models
const GEMINI_MODEL = 'gemini-flash-latest';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent';
const GEMINI_MAX_TOKENS = 16000;

// จำกัดจำนวนแถวสูงสุดต่อคำขอ generate หนึ่งครั้ง — ผูกเหตุผลไว้กับ GEMINI_MAX_TOKENS ข้างบน:
// คำขอที่ขอแถวเยอะเกินไปมักถูก Gemini ตัดคำตอบก่อนครบตามจำนวนจริง (โดนจับได้อยู่แล้วจากเช็ค rows.length !== rowsRequested)
// แต่กว่าจะรู้ผลก็เสีย execution time ของ Apps Script ไปฟรีๆ ก่อน จึงตั้งเพดานให้อยู่ในช่วงที่ schema ทั่วไปยังมีโอกาสสำเร็จจริง
// (เดิมเคยตั้งไว้ที่ 1,000 ซึ่งสูงเกินกว่าที่ 16,000 token จะรองรับได้จริงสำหรับตารางที่มีมากกว่า 2-3 คอลัมน์)
const MAX_ROWS_PER_GENERATE = 300;

// ตัวเลขเวอร์ชันไว้เช็คว่า deployment ที่รันอยู่จริงเป็นโค้ดล่าสุดหรือไม่
// วิธีเช็ค: เปิด <BACKEND_URL>?action=ping ในเบราว์เซอร์ตรงๆ แล้วดูค่า "version" ในผลลัพธ์
const BACKEND_VERSION = 'v65-pending-super-admin-cannot-act-2026-07-21';

// Super_Admin "หลัก" ของระบบ — บัญชีที่ setupSheet() สร้างให้อัตโนมัติตอนติดตั้งครั้งแรก (ดู setupSheet())
// ใช้เทียบแบบ normalizeUsername_() เสมอ (ไม่สนตัวพิมพ์เล็ก/ใหญ่) เพื่อ (1) กันไม่ให้บัญชีนี้ส่งคำขอลบบัญชีตัวเองได้
// (2) เป็นคนเดียวที่อนุมัติ/ปฏิเสธคำขอสมัคร role Super_Admin ใหม่ๆ ได้ ถ้าต้องเปลี่ยนตัว Super_Admin หลักในอนาคต แก้ค่านี้ค่าเดียว
const PRIMARY_SUPER_ADMIN_USERNAME = 'Admin123';

// ---------------------------------------------------------------------------
// SETUP (รันเองครั้งเดียวจาก Apps Script Editor)
// ---------------------------------------------------------------------------
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let sh = getOrCreateSheet_(ss, SHEET_NAMES.USERS);
  setHeadersIfEmpty_(sh, ['username', 'salt', 'password_hash', 'role', 'created_at', 'email']);
  ensureColumnHeader_(sh, 'email'); // เผื่อ sheet เก่าที่ setup ไปแล้วก่อนมีฟีเจอร์ OTP ทางอีเมล ยังไม่มีคอลัมน์นี้
  ensureColumnHeader_(sh, 'full_name'); // ชื่อ-นามสกุลจริงของผู้สมัคร — เพิ่มเพื่อให้ Super_Admin ระบุตัวตนที่แท้จริงของ user ได้ง่ายกว่าดูแค่ username
  ensureColumnHeader_(sh, 'department'); // แผนก/ทีมที่สังกัด — ช่วยให้ดูภาพรวมว่าทีมไหนใช้งานระบบนี้อยู่บ้าง
  ensureColumnHeader_(sh, 'delete_requested_at'); // เวลาที่ผู้ใช้กด "ขอลบบัญชี" (ว่าง = ไม่มีคำขอค้าง)
  ensureColumnHeader_(sh, 'approval_status'); // '' = อนุมัติแล้ว/ไม่ต้องอนุมัติ, 'pending' = สมัคร role Super_Admin ที่รอ Super Admin หลักอนุมัติ
  seedAdminIfEmpty_(sh);

  sh = getOrCreateSheet_(ss, SHEET_NAMES.LOGS);
  setHeadersIfEmpty_(sh, ['timestamp', 'username', 'role', 'action_type', 'detail']);

  sh = getOrCreateSheet_(ss, SHEET_NAMES.DATASETS);
  setHeadersIfEmpty_(sh, ['ชุดข้อมูลที่บันทึกแล้ว (จัดเป็นกลุ่มตามรอบที่ Commit แต่ละครั้ง — คอลัมน์จริงจะเปลี่ยนไปตามประเภทข้อมูลของแต่ละรอบ กดเครื่องหมาย [－] ทางซ้ายเพื่อยุบ/ขยาย)']);
  try { sh.setRowGroupControlAfter(false); } catch (e) { /* ข้ามได้ถ้าตั้งค่าไม่สำเร็จ */ }

  // เฉพาะ prompt ที่ผู้ใช้ตั้งชื่อเองแล้วกด "บันทึก" ไว้ใช้ซ้ำ (ไม่ปนกับ prompt ที่เกิดจาก Generate ทุกครั้ง)
  // image_file_id / image_url: ลิงก์ไฟล์รูป Schema/ER Diagram ที่แนบไว้ตอนบันทึก (เก็บจริงใน Drive ไม่ใช่ Sheet เพราะ base64 รูปมักยาวเกิน 50,000 ตัวอักษรที่ cell รับได้)
  sh = getOrCreateSheet_(ss, SHEET_NAMES.PROMPTS);
  setHeadersIfEmpty_(sh, ['prompt_name', 'created_by', 'created_at', 'data_type', 'table_name', 'dialect', 'rows_requested', 'allow_null', 'ddl_script', 'prompt_addition', 'full_prompt_text', 'image_file_id', 'image_url']);

  // ประวัติ prompt ทุกครั้งที่กด Generate ที่ "ไม่ได้" ตั้งใจบันทึกไว้ใช้ซ้ำ แยกออกจาก SavedPrompts เพื่อให้ตรวจสอบง่าย
  sh = getOrCreateSheet_(ss, SHEET_NAMES.PROMPT_LOGS);
  setHeadersIfEmpty_(sh, ['timestamp', 'username', 'role', 'data_type', 'table_name', 'dialect', 'rows_requested', 'allow_null', 'ddl_script', 'prompt_addition', 'full_prompt_text', 'image_file_id', 'image_url']);

  sh = getOrCreateSheet_(ss, SHEET_NAMES.SCHEMA);
  setHeadersIfEmpty_(sh, ['data_type_key', 'max_columns', 'allowed_columns_csv', 'required_columns_csv', 'notes']);
  seedDefaultSchemaIfEmpty_(sh);

  // แท็บเก็บคะแนนคุณภาพข้อมูล (ตรงตามเงื่อนไข % / ความน่าเชื่อถือ %) ทุกครั้งที่กด "สร้างข้อมูลทดสอบ"
  // ออกแบบเป็นตารางแบนราบ คอลัมน์คงที่เสมอ (ไม่ผูกกับชนิดข้อมูลที่สร้าง) เพื่อให้เอาไปทำรายงาน/สรุปสถิติย้อนหลังได้ง่าย
  sh = getOrCreateSheet_(ss, SHEET_NAMES.QUALITY);
  setHeadersIfEmpty_(sh, ['timestamp', 'username', 'role', 'data_type', 'table_name', 'dialect', 'rows_requested', 'rows_actual', 'condition_match_percent', 'reliability_percent', 'summary']);

  SpreadsheetApp.getUi().alert('ตั้งค่าโครงสร้าง Sheet เรียบร้อยแล้ว ✅\n\nUser เริ่มต้น: Admin123 / SecurePassword!1\n\nอย่าลืมตั้งค่า GEMINI_API_KEY ใน Script Properties ก่อนใช้งานจริง (ขอฟรีได้ที่ https://aistudio.google.com/apikey)');
}

// ---------------------------------------------------------------------------
// เมนูสำหรับผู้ดูแลฐานข้อมูล (ขึ้นอัตโนมัติทุกครั้งที่เปิดสเปรดชีต)
// ---------------------------------------------------------------------------
// หมายเหตุ: ตั้งแต่เวอร์ชันนี้เป็นต้นไป การจัดกลุ่มทำให้อัตโนมัติทันทีตอนบันทึกข้อมูล
// (ActivityLogs จัดกลุ่มตามวันที่, GeneratedDatasets จัดกลุ่มตามรอบที่ Commit แต่ละครั้ง)
// ไม่ต้องกดเมนูเพื่อจัดกลุ่มเองอีกต่อไป — เมนูนี้เหลือไว้แค่เป็นเครื่องมือ "เริ่มต้นใหม่" เผื่อทดสอบ
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('เครื่องมือแอดมิน')
    .addItem('ล้างข้อมูลทดสอบเก่าใน ActivityLogs', 'resetActivityLogsData')
    .addItem('ล้างข้อมูลทดสอบเก่าใน GeneratedDatasets', 'resetGeneratedDatasetsData')
    .addSeparator()
    .addItem('ย้ายข้อมูลเก่าใน ActivityLogs ไปแท็บสำรอง (เกิน ' + ARCHIVE_THRESHOLD_MONTHS + ' เดือน)', 'archiveOldActivityLogs')
    .addItem('ย้ายข้อมูลเก่าใน QualityScores ไปแท็บสำรอง (เกิน ' + ARCHIVE_THRESHOLD_MONTHS + ' เดือน)', 'archiveOldQualityScores')
    .addItem('ย้ายข้อมูลเก่าใน GeneratedPromptLogs ไปแท็บสำรอง (เกิน ' + ARCHIVE_THRESHOLD_MONTHS + ' เดือน)', 'archiveOldGeneratedPromptLogs')
    .addSeparator()
    .addItem('เปิดระบบย้ายข้อมูลเก่าไปแท็บสำรองอัตโนมัติ (รันเองทุกวันที่ 1 ของเดือน)', 'enableAutoArchiveMonthly')
    .addItem('ปิดระบบย้ายข้อมูลเก่าไปแท็บสำรองอัตโนมัติ', 'disableAutoArchive')
    .addSeparator()
    .addItem('ล้างไฟล์รูปที่ไม่มีการอ้างอิงแล้วใน Drive', 'cleanupOrphanedSchemaImages')
    .addItem('ดูสรุปขนาดข้อมูลปัจจุบันของแต่ละชีต', 'showDataSizeSummary')
    .addItem('ตรวจสอบข้อมูลผิดปกติในชีต Users', 'checkUsersDataIssues')
    .addSeparator()
    .addItem('สำรองข้อมูลทั้งไฟล์เดี๋ยวนี้', 'backupSpreadsheetNow')
    .addItem('เปิดระบบสำรองข้อมูลอัตโนมัติ (รันเองทุกวันจันทร์)', 'enableAutoBackupWeekly')
    .addItem('ปิดระบบสำรองข้อมูลอัตโนมัติ', 'disableAutoBackup')
    .addSeparator()
    .addItem('ตรวจสอบความพร้อมก่อน Deploy', 'checkDeployReadiness')
    .addSeparator()
    .addItem('สร้างรายงานสรุประบบเป็น PDF', 'generateSystemReportPdf')
    .addToUi();
}

// ล้างข้อมูล (คงหัวตารางไว้) เผื่อมีข้อมูลทดสอบเก่าที่ยังเป็นรูปแบบก่อนหน้านี้ค้างอยู่ ก่อนเริ่มใช้ระบบจัดกลุ่มอัตโนมัติแบบใหม่
function resetActivityLogsData() {
  resetSheetDataKeepHeader_(SHEET_NAMES.LOGS, 'ActivityLogs');
}

function resetGeneratedDatasetsData() {
  resetSheetDataKeepHeader_(SHEET_NAMES.DATASETS, 'GeneratedDatasets');
}

function resetSheetDataKeepHeader_(sheetName, displayName) {
  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert(
    'ยืนยันการล้างข้อมูล',
    'ต้องการล้างข้อมูลทั้งหมดในชีต "' + displayName + '" (เก็บแถวหัวตารางไว้) ใช่หรือไม่? การกระทำนี้ย้อนกลับไม่ได้',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  const sh = getSheet_(sheetName);
  const lastRow = sh.getLastRow();
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, sh.getMaxColumns()).shiftRowGroupDepth(-8);
    sh.deleteRows(2, lastRow - 1);
  }
  ui.alert('ล้างข้อมูลในชีต "' + displayName + '" เรียบร้อยแล้ว ✅');
}

// ---------------------------------------------------------------------------
// เก็บถาวรข้อมูลเก่า — แก้ปัญหาที่ ActivityLogs/QualityScores/GeneratedPromptLogs โตขึ้นเรื่อยๆ ไม่มีที่สิ้นสุด
// (ทุก action เกือบทั้งหมดอ่านทั้งชีตทุกครั้งด้วย getDataRange().getValues() ยิ่งชีตโต การอ่านยิ่งช้าลงเรื่อยๆ)
// ย้ายบล็อกข้อมูล (แถวป้ายชื่อวันที่ + แถวข้อมูลใต้บล็อกนั้น) ที่เก่ากว่าเกณฑ์ที่กำหนดไปเก็บไว้อีกแท็บ (ชื่อ "<ชื่อชีตเดิม>_Archive")
// แล้วลบออกจากแท็บหลัก — ข้อมูลไม่หายไปไหน แค่ย้ายที่เก็บ ยังดูย้อนหลังได้ตามปกติที่แท็บ Archive
// รันเองจากเมนู "เครื่องมือแอดมิน" เป็นระยะๆ (เช่น ทุก 3-6 เดือน) ไม่ได้ตั้งเวลาอัตโนมัติ ให้ผู้ดูแลระบบเป็นคนตัดสินใจเองว่าจะเก็บถาวรเมื่อไหร่
// หมายเหตุ: ใช้ได้เฉพาะชีตที่จัดกลุ่มแบบ "แถวป้ายชื่อวันที่ (คอลัมน์ A เป็นข้อความ) ตามด้วยแถวข้อมูล (คอลัมน์ A เป็น Date)" เท่านั้น
// ไม่รวม GeneratedDatasets (จัดกลุ่มแบบรอบ Commit คอลัมน์ไม่คงที่ ต่างโครงสร้างไปเลย) และไม่รวม SavedPrompts (ผู้ใช้ยังต้องเลือกใช้ซ้ำอยู่ ไม่ควรถูกเก็บถาวรไปโดยอัตโนมัติ)
// ---------------------------------------------------------------------------
const ARCHIVE_THRESHOLD_MONTHS = 6;

function archiveOldActivityLogs() {
  runArchiveWithConfirm_('ActivityLogs', SHEET_NAMES.LOGS, SHEET_NAMES.LOGS + '_Archive',
    ['timestamp', 'username', 'role', 'action_type', 'detail']);
}

function archiveOldQualityScores() {
  runArchiveWithConfirm_('QualityScores', SHEET_NAMES.QUALITY, SHEET_NAMES.QUALITY + '_Archive',
    ['timestamp', 'username', 'role', 'data_type', 'table_name', 'dialect', 'rows_requested', 'rows_actual', 'condition_match_percent', 'reliability_percent', 'summary']);
}

function archiveOldGeneratedPromptLogs() {
  runArchiveWithConfirm_('GeneratedPromptLogs', SHEET_NAMES.PROMPT_LOGS, SHEET_NAMES.PROMPT_LOGS + '_Archive',
    ['timestamp', 'username', 'role', 'data_type', 'table_name', 'dialect', 'rows_requested', 'allow_null', 'ddl_script', 'prompt_addition', 'full_prompt_text', 'image_file_id', 'image_url']);
}

// ถามยืนยันก่อนเสมอ + ล็อกระหว่างทำงาน (กันชนกับ log/คะแนนใหม่ที่กำลังถูกเขียนเข้ามาพร้อมกันตอนกำลังเก็บถาวรอยู่) + สรุปผลให้ทราบ
function runArchiveWithConfirm_(displayName, sheetName, archiveSheetName, headers) {
  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert(
    'ยืนยันการย้ายข้อมูลเก่าไปแท็บสำรอง',
    'ต้องการย้ายข้อมูล "' + displayName + '" ที่เก่ากว่า ' + ARCHIVE_THRESHOLD_MONTHS + ' เดือน ไปเก็บไว้ที่แท็บสำรอง "' + archiveSheetName + '" (อยู่ในไฟล์ Google Sheet เดียวกันนี้) แล้วลบออกจากแท็บหลักใช่หรือไม่?\n\nข้อมูลจะไม่หายไปไหน แค่ย้ายไปอยู่คนละแท็บในไฟล์เดิม ดูย้อนหลังได้ตามปกติที่แท็บสำรองนั้น',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    ui.alert('ระบบมีผู้ใช้งานพร้อมกันหนาแน่นในขณะนี้ กรุณาลองใหม่อีกครั้งในอีกสักครู่');
    return;
  }
  try {
    const result = archiveOldDateGroupedRows_(sheetName, archiveSheetName, headers);
    ui.alert(
      result.archivedBlocks > 0
        ? 'ย้ายข้อมูลเก่าไปแท็บสำรองเรียบร้อยแล้ว: ย้าย ' + result.archivedBlocks + ' วัน (' + result.archivedRows + ' แถวข้อมูล) จาก "' + displayName + '" ไปที่แท็บ "' + archiveSheetName + '"'
        : 'ไม่พบข้อมูลใน "' + displayName + '" ที่เก่ากว่า ' + ARCHIVE_THRESHOLD_MONTHS + ' เดือน ไม่มีอะไรต้องย้ายตอนนี้'
    );
  } finally {
    lock.releaseLock();
  }
}

// ฟังก์ชันกลาง: สแกนชีตที่จัดกลุ่มแบบ "แถวป้ายชื่อวันที่ (คอลัมน์ A เป็นข้อความขึ้นต้นด้วย 📅) ตามด้วยแถวข้อมูล (คอลัมน์ A เป็น Date)"
// แบ่งเป็นบล็อกตามวัน แล้วย้ายเฉพาะบล็อกที่ "รู้วันที่แน่ชัด" และเก่ากว่า cutoff เท่านั้นไปยังแท็บ archive แล้วลบออกจากต้นฉบับ
function archiveOldDateGroupedRows_(sourceSheetName, archiveSheetName, headers) {
  const sh = getSheet_(sourceSheetName);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - ARCHIVE_THRESHOLD_MONTHS);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { archivedBlocks: 0, archivedRows: 0 };

  const numCols = sh.getLastColumn();
  const data = sh.getRange(2, 1, lastRow - 1, numCols).getValues(); // ไม่รวมแถวหัวตาราง (แถวที่ 1)

  // แบ่งเป็นบล็อกๆ: แต่ละบล็อกเริ่มด้วยแถวป้ายชื่อ (คอลัมน์ A เป็นข้อความ) ตามด้วยแถวข้อมูล (คอลัมน์ A เป็น Date) จนกว่าจะเจอป้ายชื่อถัดไป
  const blocks = [];
  let currentBlock = null;
  for (let i = 0; i < data.length; i++) {
    const cellA = data[i][0];
    const sheetRowNum = i + 2; // เลขแถวจริงในชีต (บวก 1 เพราะข้ามแถวหัวตาราง, บวกอีก 1 เพราะ index เริ่มที่ 0)
    if (typeof cellA === 'string' && cellA.indexOf('📅') === 0) {
      currentBlock = { labelRowIndex: sheetRowNum, rows: [], firstDataDate: null };
      blocks.push(currentBlock);
    } else {
      if (!currentBlock) continue; // แถวข้อมูลที่ไม่มีป้ายชื่อกำกับ (ไม่ควรเกิดตามโครงสร้างปกติ) ข้ามอย่างปลอดภัย ไม่แตะ
      currentBlock.rows.push(sheetRowNum);
      if (!currentBlock.firstDataDate && cellA instanceof Date) {
        currentBlock.firstDataDate = cellA;
      }
    }
  }

  // เลือกเฉพาะบล็อกที่มีแถวข้อมูลจริงอย่างน้อย 1 แถว (รู้วันที่แน่ชัด) และเก่ากว่า cutoff เท่านั้น กันเก็บถาวรบล็อกที่ระบุวันที่ไม่ได้โดยไม่ตั้งใจ
  const blocksToArchive = blocks.filter(function (b) {
    return b.firstDataDate && b.firstDataDate < cutoff;
  });
  if (!blocksToArchive.length) return { archivedBlocks: 0, archivedRows: 0 };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const archiveSh = getOrCreateSheet_(ss, archiveSheetName);
  setHeadersIfEmpty_(archiveSh, headers);
  try { archiveSh.setRowGroupControlAfter(false); } catch (e) { /* ข้ามได้ถ้าตั้งค่าไม่สำเร็จ */ }

  const tz = Session.getScriptTimeZone();
  let archivedRowsCount = 0;

  // เขียนบล็อกที่จะย้ายลงแท็บสำรอง โดยจัดเป็นชั้นซ้อน "ปี → เดือน → วัน" ให้กดยุบ/ขยายได้ทีละชั้น
  // (บล็อกที่มาถึงจุดนี้เรียงตามลำดับเวลาเดิมอยู่แล้วจากการสแกนบรรทัด 207-223 ด้านบน จึงจัดกลุ่มต่อเนื่องได้เลยโดยไม่ต้องเรียงใหม่)
  // หมายเหตุ: การรันแต่ละรอบจะเขียนต่อท้ายแท็บสำรองเสมอ ไม่ได้ย้อนไปรวมกลุ่มปี/เดือนที่เคยสร้างไว้จากรอบก่อนหน้า
  // ถ้าข้อมูลปีเดียวกันถูกย้ายมาคนละรอบ อาจเห็นหัวข้อปีนั้นซ้ำสองกลุ่มในแท็บสำรอง แต่ข้อมูลยังถูกต้องครบถ้วน แค่ไม่ได้รวมเป็นกลุ่มเดียวอัตโนมัติ
  let currentYearKey = null;
  let currentMonthKey = null;
  let yearGroupStartRow = null;
  let monthGroupStartRow = null;
  const yearRanges = [];
  const monthRanges = [];
  const dayRanges = [];

  function closeMonthGroup_() {
    if (monthGroupStartRow !== null) {
      const lastRow = archiveSh.getLastRow();
      if (lastRow >= monthGroupStartRow) monthRanges.push({ start: monthGroupStartRow, count: lastRow - monthGroupStartRow + 1 });
    }
  }
  function closeYearGroup_() {
    closeMonthGroup_();
    if (yearGroupStartRow !== null) {
      const lastRow = archiveSh.getLastRow();
      if (lastRow >= yearGroupStartRow) yearRanges.push({ start: yearGroupStartRow, count: lastRow - yearGroupStartRow + 1 });
    }
  }

  blocksToArchive.forEach(function (b) {
    const yearKey = yearKeyOf_(b.firstDataDate, tz);
    const monthKey = monthKeyOf_(b.firstDataDate, tz);

    if (yearKey !== currentYearKey) {
      closeYearGroup_();
      archiveSh.getRange(archiveSh.getLastRow() + 1, 1).setValue(yearLabelThai_(b.firstDataDate, tz));
      currentYearKey = yearKey;
      currentMonthKey = null; // ขึ้นปีใหม่ ต้องเปิดป้ายเดือนใหม่เสมอ
      yearGroupStartRow = archiveSh.getLastRow() + 1;
    }
    if (monthKey !== currentMonthKey) {
      closeMonthGroup_();
      archiveSh.getRange(archiveSh.getLastRow() + 1, 1).setValue(monthLabelThai_(b.firstDataDate, tz));
      currentMonthKey = monthKey;
      monthGroupStartRow = archiveSh.getLastRow() + 1;
    }

    const totalRowsInBlock = 1 + b.rows.length; // รวมแถวป้ายชื่อวันด้วย
    const blockValues = sh.getRange(b.labelRowIndex, 1, totalRowsInBlock, numCols).getValues();
    const dayLabelWriteRow = archiveSh.getLastRow() + 1;
    archiveSh.getRange(dayLabelWriteRow, 1, blockValues.length, numCols).setValues(blockValues);
    if (b.rows.length > 0) {
      dayRanges.push({ start: dayLabelWriteRow + 1, count: b.rows.length }); // ไม่รวมแถวป้ายวัน (📅) เอง
    }
    archivedRowsCount += b.rows.length;
  });
  closeYearGroup_();

  // ไล่ยกระดับความลึกของกลุ่มจากชั้นในสุดออกมาชั้นนอกสุดเสมอ (วัน → เดือน → ปี)
  // เพราะแต่ละชั้นเป็นการ "บวกเพิ่ม" จากชั้นก่อนหน้า ทำสลับลำดับจะได้ความลึกผิดเพี้ยน
  dayRanges.forEach(function (r) { archiveSh.getRange(r.start, 1, r.count, numCols).shiftRowGroupDepth(1); });
  monthRanges.forEach(function (r) { archiveSh.getRange(r.start, 1, r.count, numCols).shiftRowGroupDepth(1); });
  yearRanges.forEach(function (r) { archiveSh.getRange(r.start, 1, r.count, numCols).shiftRowGroupDepth(1); });

  // ลบออกจากต้นฉบับ เรียงจากแถวล่างสุดขึ้นบนสุดเสมอ กันเลขแถวเพี้ยนระหว่างลบ (ลบแถวบนก่อนจะทำให้เลขแถวของบล็อกที่เหลือขยับ)
  const sortedDesc = blocksToArchive.slice().sort(function (a, b) { return b.labelRowIndex - a.labelRowIndex; });
  sortedDesc.forEach(function (b) {
    const totalRowsInBlock = 1 + b.rows.length;
    sh.deleteRows(b.labelRowIndex, totalRowsInBlock);
  });

  return { archivedBlocks: blocksToArchive.length, archivedRows: archivedRowsCount };
}

// ---------------------------------------------------------------------------
// เปิด/ปิด "เก็บถาวรอัตโนมัติ" — ให้ archiveOldActivityLogs/QualityScores/GeneratedPromptLogs
// รันเองทุกเดือนโดยไม่ต้องกดเมนูเอง ใช้ time-driven trigger ของ Apps Script
// หมายเหตุ: ฟังก์ชันที่ trigger เรียก (runAllArchivesAutomatically_) ห้ามใช้ SpreadsheetApp.getUi()
// เพราะรันแบบไม่มีหน้าจอ (headless) เรียกแล้วจะเกิด error ทันที จึงสรุปผลด้วยการบันทึกลง ActivityLogs แทน
// ---------------------------------------------------------------------------
const AUTO_ARCHIVE_TRIGGER_HANDLER_ = 'runAllArchivesAutomatically_';

function enableAutoArchiveMonthly() {
  const ui = SpreadsheetApp.getUi();
  const already = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === AUTO_ARCHIVE_TRIGGER_HANDLER_;
  });
  if (already) {
    ui.alert('เปิดระบบย้ายข้อมูลเก่าไปแท็บสำรองอัตโนมัติไว้อยู่แล้ว (รันทุกวันที่ 1 ของเดือน) ไม่ต้องตั้งซ้ำ');
    return;
  }
  ScriptApp.newTrigger(AUTO_ARCHIVE_TRIGGER_HANDLER_)
    .timeBased()
    .onMonthDay(1)
    .atHour(3)
    .create();
  ui.alert(
    'เปิดระบบย้ายข้อมูลเก่าไปแท็บสำรองอัตโนมัติเรียบร้อย ✅\n\n' +
    'จะรันอัตโนมัติทุกวันที่ 1 ของเดือน ช่วงเวลาประมาณ 03:00 น. ย้ายข้อมูลที่เก่ากว่า ' + ARCHIVE_THRESHOLD_MONTHS + ' เดือน ' +
    'ใน ActivityLogs / QualityScores / GeneratedPromptLogs ไปแท็บสำรองในไฟล์เดียวกันให้เอง โดยไม่ต้องกดเมนูอีกต่อไป (ดูผลย้อนหลังได้จาก ActivityLogs หัวข้อ AUTO_ARCHIVE)\n\n' +
    'ถ้าต้องการปิด กดเมนู "ปิดระบบย้ายข้อมูลเก่าไปแท็บสำรองอัตโนมัติ" ได้ทุกเมื่อ'
  );
}

function disableAutoArchive() {
  const ui = SpreadsheetApp.getUi();
  const triggers = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === AUTO_ARCHIVE_TRIGGER_HANDLER_;
  });
  if (!triggers.length) {
    ui.alert('ยังไม่ได้เปิดระบบย้ายข้อมูลเก่าไปแท็บสำรองอัตโนมัติไว้');
    return;
  }
  triggers.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ui.alert('ปิดระบบย้ายข้อมูลเก่าไปแท็บสำรองอัตโนมัติเรียบร้อยแล้ว (ยังกดย้ายข้อมูลเองจากเมนูตามปกติได้อยู่)');
}

// ฟังก์ชันที่ trigger เรียกอัตโนมัติทุกเดือน — ห้ามเรียก SpreadsheetApp.getUi() ในนี้
function runAllArchivesAutomatically_() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    return; // ล็อกไม่ได้ (มีคนใช้งานพร้อมกันหนาแน่น) ข้ามรอบนี้ไป เดือนหน้าค่อยลองใหม่
  }
  try {
    const jobs = [
      { display: 'ActivityLogs', sheetName: SHEET_NAMES.LOGS,
        headers: ['timestamp', 'username', 'role', 'action_type', 'detail'] },
      { display: 'QualityScores', sheetName: SHEET_NAMES.QUALITY,
        headers: ['timestamp', 'username', 'role', 'data_type', 'table_name', 'dialect', 'rows_requested', 'rows_actual', 'condition_match_percent', 'reliability_percent', 'summary'] },
      { display: 'GeneratedPromptLogs', sheetName: SHEET_NAMES.PROMPT_LOGS,
        headers: ['timestamp', 'username', 'role', 'data_type', 'table_name', 'dialect', 'rows_requested', 'allow_null', 'ddl_script', 'prompt_addition', 'full_prompt_text', 'image_file_id', 'image_url'] }
    ];
    jobs.forEach(function (job) {
      try {
        const result = archiveOldDateGroupedRows_(job.sheetName, job.sheetName + '_Archive', job.headers);
        if (result.archivedBlocks > 0) {
          logActivity_('SYSTEM', 'System', 'AUTO_ARCHIVE',
            'ย้ายข้อมูลเก่าไปแท็บสำรองอัตโนมัติ "' + job.display + '": ย้าย ' + result.archivedBlocks + ' วัน (' + result.archivedRows + ' แถว) ไปที่แท็บ "' + job.sheetName + '_Archive"');
        }
      } catch (e) {
        Logger.log('Auto-archive failed for ' + job.display + ': ' + e.message);
      }
    });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// ล้างไฟล์รูป Schema/ER Diagram ที่ไม่มีการอ้างอิงแล้วใน Drive
// (ตอนลบ Prompt ที่บันทึกไว้ หรือลบชุดข้อมูลที่เคย Commit ระบบลบแค่แถวใน Sheet เท่านั้น
//  ไม่ได้ลบไฟล์รูปที่เคยแนบไว้ใน Drive ด้วย ไฟล์เหล่านี้จึงค้างเป็น "ไฟล์กำพร้า" สะสมไปเรื่อยๆ)
// เครื่องมือนี้สแกน image_file_id ที่ยังถูกอ้างอิงอยู่จริงจาก SavedPrompts / GeneratedPromptLogs
// (รวมแท็บ _Archive ของ GeneratedPromptLogs ด้วย เผื่อรูปถูกอ้างอิงจากแถวที่เก็บถาวรไปแล้ว)
// แล้วย้ายไฟล์ที่ไม่ถูกอ้างอิงเข้าถังขยะ (Trash) แทนการลบถาวรทันที กันพลาด — กู้คืนได้ภายใน 30 วันตามปกติของ Drive
// ---------------------------------------------------------------------------
function cleanupOrphanedSchemaImages() {
  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert(
    'ยืนยันการล้างไฟล์รูปที่ไม่มีการอ้างอิงแล้ว',
    'ระบบจะสแกนไฟล์รูป Schema/ER Diagram ทั้งหมดในโฟลเดอร์ Drive แล้วย้ายไฟล์ที่ไม่มีการอ้างอิงจาก SavedPrompts/GeneratedPromptLogs (รวม Archive) เข้าถังขยะ (Trash)\n\n' +
    'ไฟล์จะไม่ถูกลบถาวรทันที ยังกู้คืนได้จากถังขยะของ Drive ภายใน 30 วัน ต้องการดำเนินการต่อหรือไม่?',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    ui.alert('ระบบมีผู้ใช้งานพร้อมกันหนาแน่นในขณะนี้ กรุณาลองใหม่อีกครั้งในอีกสักครู่');
    return;
  }
  try {
    const referencedIds = collectReferencedImageFileIds_();
    const folder = getOrCreateImagesFolder_();
    const files = folder.getFiles();
    let trashedCount = 0;
    let keptCount = 0;
    while (files.hasNext()) {
      const file = files.next();
      if (referencedIds[file.getId()]) {
        keptCount++;
      } else {
        file.setTrashed(true);
        trashedCount++;
      }
    }
    ui.alert(
      trashedCount > 0
        ? 'ล้างไฟล์รูปที่ไม่มีการอ้างอิงแล้วเรียบร้อย: ย้ายเข้าถังขยะ ' + trashedCount + ' ไฟล์ (เหลือไฟล์ที่ยังถูกอ้างอิงอยู่ ' + keptCount + ' ไฟล์)'
        : 'ไม่พบไฟล์รูปที่ไม่มีการอ้างอิงแล้ว ไม่มีอะไรต้องล้างตอนนี้ (ไฟล์ที่ยังถูกอ้างอิงอยู่ ' + keptCount + ' ไฟล์)'
    );
  } finally {
    lock.releaseLock();
  }
}

// รวบรวม image_file_id ทั้งหมดที่ยังถูกอ้างอิงอยู่จริง จาก SavedPrompts, GeneratedPromptLogs และ GeneratedPromptLogs_Archive
function collectReferencedImageFileIds_() {
  const ids = {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetNames = [SHEET_NAMES.PROMPTS, SHEET_NAMES.PROMPT_LOGS, SHEET_NAMES.PROMPT_LOGS + '_Archive'];
  sheetNames.forEach(function (sheetName) {
    const sh = ss.getSheetByName(sheetName);
    if (!sh) return;
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return;
    const header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    const idCol = header.indexOf('image_file_id');
    if (idCol === -1) return;
    const values = sh.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
    values.forEach(function (row) {
      const id = row[0];
      if (id) ids[String(id)] = true;
    });
  });
  return ids;
}

// ---------------------------------------------------------------------------
// สรุปขนาดข้อมูลปัจจุบันของแต่ละชีต — ช่วยตัดสินใจเชิงรุกว่าควรเก็บถาวรตอนไหน
// แทนที่จะรอให้ระบบเริ่มช้าก่อนถึงจะรู้ตัว (ค่า ROW_WARN_THRESHOLD_ เป็นแค่เกณฑ์เตือนที่ตั้งไว้เอง
// ไม่ใช่ข้อจำกัดจริงของ Google Sheets ซึ่งรับแถวได้เป็นล้านแถว แต่ยิ่งชีตโต การอ่านทั้งชีตในทุก action ยิ่งช้าลง)
// ---------------------------------------------------------------------------
const ROW_WARN_THRESHOLD_ = 3000;

function showDataSizeSummary() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const targets = [
    { display: 'ActivityLogs', sheetName: SHEET_NAMES.LOGS },
    { display: 'QualityScores', sheetName: SHEET_NAMES.QUALITY },
    { display: 'GeneratedPromptLogs', sheetName: SHEET_NAMES.PROMPT_LOGS },
    { display: 'GeneratedDatasets', sheetName: SHEET_NAMES.DATASETS },
    { display: 'SavedPrompts', sheetName: SHEET_NAMES.PROMPTS },
    { display: 'Users', sheetName: SHEET_NAMES.USERS }
  ];

  const lines = targets.map(function (t) {
    const sh = ss.getSheetByName(t.sheetName);
    if (!sh) return t.display + ': ยังไม่มีชีตนี้';
    const rowCount = Math.max(sh.getLastRow() - 1, 0);
    const warn = rowCount >= ROW_WARN_THRESHOLD_ ? '  ⚠️ แถวเยอะแล้ว ควรพิจารณาย้ายข้อมูลเก่าไปแท็บสำรอง' : '';
    return t.display + ': ' + rowCount + ' แถว' + warn;
  });

  // โชว์แท็บสำรองคู่กันด้วย เผื่ออยากรู้ว่าย้ายไปแล้วเท่าไหร่
  const archiveLines = [];
  ['ActivityLogs', 'QualityScores', 'GeneratedPromptLogs'].forEach(function (n) {
    const sh = ss.getSheetByName(n + '_Archive');
    if (sh) archiveLines.push(n + '_Archive: ' + Math.max(sh.getLastRow() - 1, 0) + ' แถว (ย้ายไปแท็บสำรองไว้แล้ว)');
  });

  let message = lines.join('\n');
  if (archiveLines.length) message += '\n\n' + archiveLines.join('\n');
  message += '\n\n(เกณฑ์เตือน: ตั้งแต่ ' + ROW_WARN_THRESHOLD_ + ' แถวขึ้นไปต่อชีต)';

  ui.alert('สรุปขนาดข้อมูลปัจจุบัน', message, ui.ButtonSet.OK);
}

// ---------------------------------------------------------------------------
// ตรวจสอบข้อมูลผิดปกติในชีต Users — หา username ซ้ำ และผู้ใช้ที่ยังไม่มีอีเมลผูกไว้
// (ผู้ใช้ที่ไม่มีอีเมลจะกู้คืนรหัสผ่านเองผ่าน OTP ไม่ได้ ต้องให้ Super_Admin ตั้งอีเมลให้ก่อน)
// ---------------------------------------------------------------------------
function checkUsersDataIssues() {
  const ui = SpreadsheetApp.getUi();
  const sh = getSheet_(SHEET_NAMES.USERS);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    ui.alert('ยังไม่มีผู้ใช้งานในระบบ');
    return;
  }
  const lastCol = sh.getLastColumn();
  const header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const usernameCol = header.indexOf('username');
  const emailCol = header.indexOf('email');
  const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const seenUsernames = {};
  const duplicates = [];
  const missingEmail = [];

  data.forEach(function (row, i) {
    const sheetRow = i + 2;
    const username = String(row[usernameCol] || '').trim();
    if (!username) return;
    const normUsername = username.toLowerCase();
    if (seenUsernames[normUsername]) {
      duplicates.push(username + ' (แถว ' + seenUsernames[normUsername] + ' และ ' + sheetRow + ')');
    } else {
      seenUsernames[normUsername] = sheetRow;
    }
    if (emailCol !== -1 && !String(row[emailCol] || '').trim()) {
      missingEmail.push(username + ' (แถว ' + sheetRow + ')');
    }
  });

  const lines = [];
  lines.push('จำนวนผู้ใช้ทั้งหมด: ' + data.length + ' คน');
  lines.push('');
  lines.push(duplicates.length
    ? '⚠️ พบ username ซ้ำ ' + duplicates.length + ' คู่:\n' + duplicates.join('\n')
    : '✅ ไม่พบ username ซ้ำ');
  lines.push('');
  lines.push(missingEmail.length
    ? '⚠️ ผู้ใช้ที่ยังไม่มีอีเมลผูกไว้ ' + missingEmail.length + ' คน:\n' + missingEmail.join('\n')
    : '✅ ผู้ใช้ทุกคนมีอีเมลผูกไว้ครบแล้ว');

  ui.alert('ตรวจสอบข้อมูลผิดปกติในชีต Users', lines.join('\n'), ui.ButtonSet.OK);
}

// ---------------------------------------------------------------------------
// สำรองข้อมูลทั้งไฟล์ (Backup) — สร้างสำเนาสเปรดชีตทั้งไฟล์เก็บไว้ใน Drive แยกโฟลเดอร์ต่างหาก
// กันไว้เผื่อไฟล์หลักเสียหาย/ถูกลบโดยไม่ตั้งใจ ต่างจาก "ย้ายข้อมูลเก่าไปแท็บสำรอง" ตรงที่อันนั้นย้าย
// ข้อมูลบางส่วนไปแท็บอื่นในไฟล์เดิม ส่วนอันนี้คัดลอกทั้งไฟล์ (ทุกแท็บ ทุกข้อมูล) ไปเก็บเป็นอีกไฟล์ต่างหาก
// เก็บไว้ล่าสุดแค่ BACKUP_KEEP_COUNT_ ชุดเสมอ เกินนี้ลบตัวเก่าสุดทิ้งอัตโนมัติ กันโฟลเดอร์สำรองบวมไม่มีที่สิ้นสุด
// ---------------------------------------------------------------------------
const BACKUP_KEEP_COUNT_ = 8;
const AUTO_BACKUP_TRIGGER_HANDLER_ = 'runBackupAutomatically_';

function getOrCreateBackupsFolder_() {
  const props = PropertiesService.getScriptProperties();
  const cachedId = props.getProperty('BACKUPS_FOLDER_ID');
  if (cachedId) {
    try { return DriveApp.getFolderById(cachedId); } catch (e) { /* โฟลเดอร์อาจถูกลบไปแล้ว ให้สร้างใหม่ต่อด้านล่าง */ }
  }
  const folderName = 'TestDataSimulator_SpreadsheetBackups';
  const it = DriveApp.getFoldersByName(folderName);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
  props.setProperty('BACKUPS_FOLDER_ID', folder.getId());
  return folder;
}

// สร้างสำเนาไฟล์จริง แล้วเรียกลบไฟล์เก่าส่วนเกินทิ้ง คืนชื่อไฟล์/ลิงก์กลับไปให้ผู้เรียกใช้แสดงผลต่อ
function createSpreadsheetBackup_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const file = DriveApp.getFileById(ss.getId());
  const tz = Session.getScriptTimeZone();
  const stamp = Utilities.formatDate(new Date(), tz, 'yyyyMMdd_HHmmss');
  const backupName = ss.getName() + '_Backup_' + stamp;
  const folder = getOrCreateBackupsFolder_();
  const copy = file.makeCopy(backupName, folder);
  pruneOldBackups_(folder);
  return { name: backupName, url: copy.getUrl() };
}

// ลบไฟล์สำรองเก่าที่เกินจำนวนที่กำหนด (BACKUP_KEEP_COUNT_) ทิ้งไปถังขยะ เหลือแค่ชุดล่าสุด
function pruneOldBackups_(folder) {
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    files.push({ file: f, date: f.getDateCreated() });
  }
  if (files.length <= BACKUP_KEEP_COUNT_) return;
  files.sort(function (a, b) { return b.date - a.date; }); // ใหม่สุดก่อน
  files.slice(BACKUP_KEEP_COUNT_).forEach(function (item) {
    item.file.setTrashed(true);
  });
}

function backupSpreadsheetNow() {
  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert(
    'ยืนยันการสำรองข้อมูลทั้งไฟล์',
    'ระบบจะสร้างสำเนาของสเปรดชีตทั้งไฟล์ (ทุกแท็บ ทุกข้อมูล) เก็บไว้ในโฟลเดอร์ Drive แยกต่างหาก (TestDataSimulator_SpreadsheetBackups) เก็บไว้ล่าสุด ' + BACKUP_KEEP_COUNT_ + ' ชุด เกินนี้ลบตัวเก่าสุดทิ้งอัตโนมัติ ต้องการดำเนินการต่อหรือไม่?',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    ui.alert('ระบบมีผู้ใช้งานพร้อมกันหนาแน่นในขณะนี้ กรุณาลองใหม่อีกครั้งในอีกสักครู่');
    return;
  }
  try {
    const result = createSpreadsheetBackup_();
    ui.alert('สำรองข้อมูลเรียบร้อยแล้ว ✅\n\nชื่อไฟล์: ' + result.name + '\nลิงก์: ' + result.url);
  } catch (e) {
    ui.alert('สำรองข้อมูลไม่สำเร็จ: ' + e.message);
  } finally {
    lock.releaseLock();
  }
}

function enableAutoBackupWeekly() {
  const ui = SpreadsheetApp.getUi();
  const already = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === AUTO_BACKUP_TRIGGER_HANDLER_;
  });
  if (already) {
    ui.alert('เปิดระบบสำรองข้อมูลอัตโนมัติไว้อยู่แล้ว (รันทุกวันจันทร์) ไม่ต้องตั้งซ้ำ');
    return;
  }
  ScriptApp.newTrigger(AUTO_BACKUP_TRIGGER_HANDLER_)
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(4)
    .create();
  ui.alert(
    'เปิดระบบสำรองข้อมูลอัตโนมัติเรียบร้อย ✅\n\n' +
    'จะรันอัตโนมัติทุกวันจันทร์ ช่วงเวลาประมาณ 04:00 น. สร้างสำเนาสเปรดชีตทั้งไฟล์เก็บไว้ในโฟลเดอร์ Drive แยกต่างหาก เก็บล่าสุด ' + BACKUP_KEEP_COUNT_ + ' ชุดเสมอ (ดูผลย้อนหลังได้จาก ActivityLogs หัวข้อ AUTO_BACKUP)\n\n' +
    'ถ้าต้องการปิด กดเมนู "ปิดระบบสำรองข้อมูลอัตโนมัติ" ได้ทุกเมื่อ — หมายเหตุ: ใช้ handler ร่วมกับปุ่มปิดของระบบย้ายข้อมูลเก่า แต่เป็นคนละ trigger กัน ปิดแยกกันได้อิสระ'
  );
}

function disableAutoBackup() {
  const ui = SpreadsheetApp.getUi();
  const triggers = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === AUTO_BACKUP_TRIGGER_HANDLER_;
  });
  if (!triggers.length) {
    ui.alert('ยังไม่ได้เปิดระบบสำรองข้อมูลอัตโนมัติไว้');
    return;
  }
  triggers.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ui.alert('ปิดระบบสำรองข้อมูลอัตโนมัติเรียบร้อยแล้ว (ยังกดสำรองข้อมูลเองจากเมนูตามปกติได้อยู่)');
}

// ฟังก์ชันที่ trigger เรียกอัตโนมัติทุกสัปดาห์ — ห้ามเรียก SpreadsheetApp.getUi() ในนี้
function runBackupAutomatically_() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    return; // ล็อกไม่ได้ ข้ามรอบนี้ไป สัปดาห์หน้าค่อยลองใหม่
  }
  try {
    const result = createSpreadsheetBackup_();
    logActivity_('SYSTEM', 'System', 'AUTO_BACKUP', 'สำรองข้อมูลทั้งไฟล์อัตโนมัติสำเร็จ: "' + result.name + '"');
  } catch (e) {
    Logger.log('Auto-backup failed: ' + e.message);
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// ตรวจสอบความพร้อมก่อน Deploy — เช็ครวดเดียวว่าตั้งค่าที่จำเป็นครบหรือยัง
// ใช้ได้ทั้งตอนนี้ (สภาพแวดล้อมทดสอบ) และตอนย้ายไปสเปรดชีต/บัญชีจริงตอน Deploy โดยไม่ต้องแก้อะไรเพิ่ม
// ---------------------------------------------------------------------------
function checkDeployReadiness() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lines = [];

  // 1. ตั้งค่า GEMINI_API_KEY แล้วหรือยัง
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  lines.push(apiKey
    ? '✅ ตั้งค่า GEMINI_API_KEY ใน Script Properties แล้ว'
    : '❌ ยังไม่ได้ตั้งค่า GEMINI_API_KEY (ไปที่ Project Settings → Script Properties ใน Apps Script editor)');

  // 2. มีชีตหลักครบทุกแท็บที่จำเป็นไหม
  const requiredSheets = [SHEET_NAMES.USERS, SHEET_NAMES.LOGS, SHEET_NAMES.DATASETS, SHEET_NAMES.PROMPTS, SHEET_NAMES.PROMPT_LOGS, SHEET_NAMES.SCHEMA, SHEET_NAMES.QUALITY];
  const missingSheets = requiredSheets.filter(function (name) { return !ss.getSheetByName(name); });
  lines.push(missingSheets.length
    ? '❌ ยังไม่มีชีตต่อไปนี้: ' + missingSheets.join(', ') + ' (รันฟังก์ชัน setupSheet() ก่อน)'
    : '✅ มีชีตหลักครบทุกแท็บที่จำเป็น');

  // 3. มีผู้ใช้ role Super_Admin อย่างน้อย 1 คนไหม (ไม่นับที่ยังรออนุมัติ approval_status = 'pending')
  let hasSuperAdmin = false;
  const usersSh = ss.getSheetByName(SHEET_NAMES.USERS);
  if (usersSh && usersSh.getLastRow() >= 2) {
    const header = usersSh.getRange(1, 1, 1, usersSh.getLastColumn()).getValues()[0];
    const roleCol = header.indexOf('role');
    const approvalStatusCol = header.indexOf('approval_status');
    if (roleCol !== -1) {
      const uData = usersSh.getRange(2, 1, usersSh.getLastRow() - 1, usersSh.getLastColumn()).getValues();
      hasSuperAdmin = uData.some(function (r) {
        return r[roleCol] === 'Super_Admin' && (approvalStatusCol === -1 || r[approvalStatusCol] !== 'pending');
      });
    }
  }
  lines.push(hasSuperAdmin
    ? '✅ มีผู้ใช้ role Super_Admin อย่างน้อย 1 คน'
    : '❌ ยังไม่มีผู้ใช้ role Super_Admin เลย ต้องมีอย่างน้อย 1 คนเพื่อจัดการระบบ');

  // 4. สิทธิ์การแชร์สเปรดชีตถูกจำกัดไว้จริงไหม (เทียบกับ "จำกัด (Restricted)" ที่ตั้งไว้ในเช็กลิสต์ข้อ 1)
  try {
    const file = DriveApp.getFileById(ss.getId());
    const access = file.getSharingAccess();
    lines.push(access === DriveApp.Access.PRIVATE
      ? '✅ สิทธิ์การเข้าถึงสเปรดชีตตั้งเป็น "จำกัด" (Restricted) แล้ว'
      : '❌ สิทธิ์การเข้าถึงสเปรดชีตยังไม่ถูกจำกัด (ตอนนี้: ' + access + ') — กดปุ่ม "แชร์" มุมขวาบน แล้วตั้งการเข้าถึงทั่วไปเป็น "จำกัด"');
  } catch (e) {
    lines.push('⚠️ ตรวจสอบสิทธิ์การเข้าถึงสเปรดชีตไม่สำเร็จ: ' + e.message);
  }

  // ข้อมูลเสริม (ไม่บังคับ แค่แจ้งให้ทราบสถานะ)
  const hasAutoArchive = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === AUTO_ARCHIVE_TRIGGER_HANDLER_; });
  const hasAutoBackup = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === AUTO_BACKUP_TRIGGER_HANDLER_; });
  lines.push('');
  lines.push('ℹ️ ระบบย้ายข้อมูลเก่าอัตโนมัติ: ' + (hasAutoArchive ? 'เปิดอยู่' : 'ปิดอยู่ (ไม่บังคับ)'));
  lines.push('ℹ️ ระบบสำรองข้อมูลอัตโนมัติ: ' + (hasAutoBackup ? 'เปิดอยู่' : 'ปิดอยู่ (ไม่บังคับ)'));
  lines.push('ℹ️ เวอร์ชัน backend ปัจจุบัน: ' + BACKEND_VERSION);

  ui.alert('ตรวจสอบความพร้อมก่อน Deploy', lines.join('\n\n'), ui.ButtonSet.OK);
}

// ---------------------------------------------------------------------------
// สร้างรายงานสรุประบบเป็น PDF — รวมสถิติสำคัญจากหลายชีตไว้ในไฟล์เดียวอ่านง่าย
// (Google Sheets เองมี Pivot Table/Chart/Download ในตัวอยู่แล้ว แต่เป็นข้อมูลดิบแยกชีต ไม่ได้สรุปข้ามชีตให้พร้อมส่งต่อคนที่ไม่ได้ใช้ Sheets แบบนี้)
// ---------------------------------------------------------------------------
function getOrCreateReportsFolder_() {
  const props = PropertiesService.getScriptProperties();
  const cachedId = props.getProperty('REPORTS_FOLDER_ID');
  if (cachedId) {
    try { return DriveApp.getFolderById(cachedId); } catch (e) { /* โฟลเดอร์อาจถูกลบไปแล้ว ให้สร้างใหม่ต่อด้านล่าง */ }
  }
  const folderName = 'TestDataSimulator_Reports';
  const it = DriveApp.getFoldersByName(folderName);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
  props.setProperty('REPORTS_FOLDER_ID', folder.getId());
  return folder;
}

// รวบรวมรายละเอียดผู้ใช้งานทั้งหมดจากชีต Users: แยกตามบทบาท, แยกตามแผนก/ทีม, จำนวนที่ยังไม่กรอกอีเมล/ชื่อ-นามสกุล, และรายชื่อผู้ใช้ทั้งหมด
// (ใช้แทน collectDepartmentBreakdown_ เดิม — เพิ่มมิติอื่นๆ ให้ครบตามที่ผู้ใช้ขอให้รายงานละเอียดที่สุด)
function collectUserDetail_() {
  const sh = getSheet_(SHEET_NAMES.USERS);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { total: 0, byRole: [], byDepartment: [], missingEmailCount: 0, missingFullNameCount: 0, users: [] };
  const lastCol = sh.getLastColumn();
  const header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const idx = {
    username: header.indexOf('username'),
    role: header.indexOf('role'),
    createdAt: header.indexOf('created_at'),
    email: header.indexOf('email'),
    fullName: header.indexOf('full_name'),
    department: header.indexOf('department')
  };
  const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const roleCounts = {};
  const deptCounts = {};
  let missingEmailCount = 0;
  let missingFullNameCount = 0;
  const users = [];

  data.forEach(function (row) {
    const role = (idx.role !== -1 ? String(row[idx.role] || '').trim() : '') || 'ไม่ระบุ';
    roleCounts[role] = (roleCounts[role] || 0) + 1;

    const dept = (idx.department !== -1 ? String(row[idx.department] || '').trim() : '') || 'ไม่ระบุ';
    deptCounts[dept] = (deptCounts[dept] || 0) + 1;

    const email = idx.email !== -1 ? String(row[idx.email] || '').trim() : '';
    if (!email) missingEmailCount++;
    const fullName = idx.fullName !== -1 ? String(row[idx.fullName] || '').trim() : '';
    if (!fullName) missingFullNameCount++;

    users.push({
      username: idx.username !== -1 ? String(row[idx.username] || '') : '',
      fullName: fullName || '(ไม่ระบุ)',
      department: dept,
      role: role,
      hasEmail: !!email,
      createdAt: idx.createdAt !== -1 ? row[idx.createdAt] : ''
    });
  });

  const byRole = Object.keys(roleCounts)
    .sort(function (a, b) { return roleCounts[b] - roleCounts[a]; })
    .map(function (r) { return { role: r, count: roleCounts[r] }; });
  const byDepartment = Object.keys(deptCounts)
    .sort(function (a, b) { return deptCounts[b] - deptCounts[a]; })
    .map(function (d) { return { department: d, count: deptCounts[d] }; });

  return { total: data.length, byRole: byRole, byDepartment: byDepartment, missingEmailCount: missingEmailCount, missingFullNameCount: missingFullNameCount, users: users };
}

// รวบรวมสถิติกิจกรรมจากชีต ActivityLogs (ข้ามแถวป้ายชื่อวันที่ 📅): แยกตามประเภทกิจกรรม, ผู้ใช้ที่ใช้งานมากสุด 10 อันดับ, ช่วงวันที่ที่มีบันทึก
function collectActivityLogSummary_() {
  const sh = getSheet_(SHEET_NAMES.LOGS);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { total: 0, byActionType: [], topUsers: [], earliestDate: null, latestDate: null };
  const lastCol = Math.max(sh.getLastColumn(), 5);
  const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const actionCounts = {};
  const userCounts = {};
  let total = 0, earliest = null, latest = null;

  data.forEach(function (row) {
    const ts = row[0];
    if (typeof ts === 'string' && ts.indexOf('📅') === 0) return; // ข้ามแถวป้ายชื่อวันที่
    if (!(ts instanceof Date)) return;
    total++;
    if (!earliest || ts < earliest) earliest = ts;
    if (!latest || ts > latest) latest = ts;
    const actionType = String(row[3] || 'ไม่ระบุ');
    actionCounts[actionType] = (actionCounts[actionType] || 0) + 1;
    const username = String(row[1] || 'ไม่ระบุ');
    userCounts[username] = (userCounts[username] || 0) + 1;
  });

  const byActionType = Object.keys(actionCounts)
    .sort(function (a, b) { return actionCounts[b] - actionCounts[a]; })
    .map(function (a) { return { actionType: a, count: actionCounts[a] }; });
  const topUsers = Object.keys(userCounts)
    .sort(function (a, b) { return userCounts[b] - userCounts[a]; })
    .slice(0, 10)
    .map(function (u) { return { username: u, count: userCounts[u] }; });

  return { total: total, byActionType: byActionType, topUsers: topUsers, earliestDate: earliest, latestDate: latest };
}

// รวบรวมสถิติคุณภาพข้อมูลจากชีต QualityScores (ข้ามแถวป้ายชื่อวันที่ที่ขึ้นต้นด้วย 📅)
// นอกจากค่าเฉลี่ยเดิม เพิ่ม: ค่าต่ำสุด/สูงสุด, จำนวนผ่าน/ไม่ผ่าน/N/A ตามเกณฑ์ขั้นต่ำ, แยกตาม dialect, แยกตามประเภทข้อมูล, ผู้ใช้ที่สร้างข้อมูลมากสุด 10 อันดับ
function collectQualitySummary_() {
  const sh = getSheet_(SHEET_NAMES.QUALITY);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    return {
      totalGenerates: 0, avgConditionMatch: null, avgReliability: null,
      minConditionMatch: null, maxConditionMatch: null, minReliability: null, maxReliability: null,
      passCount: 0, failCount: 0, naCount: 0, byDialect: [], byDataType: [], topUsers: []
    };
  }
  const lastCol = sh.getLastColumn();
  const header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const condCol = header.indexOf('condition_match_percent');
  const relCol = header.indexOf('reliability_percent');
  const dialectCol = header.indexOf('dialect');
  const dataTypeCol = header.indexOf('data_type');
  const usernameCol = header.indexOf('username');
  const passCol = header.indexOf('pass_minimum_threshold');
  const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  let totalGenerates = 0;
  let condSum = 0, condCount = 0, condMin = null, condMax = null;
  let relSum = 0, relCount = 0, relMin = null, relMax = null;
  let passCount = 0, failCount = 0, naCount = 0;
  const dialectStats = {}, dataTypeStats = {}, userCounts = {};

  data.forEach(function (row) {
    const cellA = row[0];
    if (typeof cellA === 'string' && cellA.indexOf('📅') === 0) return; // ข้ามแถวป้ายชื่อวันที่
    if (!(cellA instanceof Date)) return; // แถวที่ไม่ใช่แถวข้อมูลจริง (เช่นแถวว่าง) ข้ามอย่างปลอดภัย
    totalGenerates++;
    if (condCol !== -1) {
      const cond = Number(row[condCol]);
      if (!isNaN(cond)) {
        condSum += cond; condCount++;
        condMin = (condMin === null) ? cond : Math.min(condMin, cond);
        condMax = (condMax === null) ? cond : Math.max(condMax, cond);
      }
    }
    if (relCol !== -1) {
      const rel = Number(row[relCol]);
      if (!isNaN(rel)) {
        relSum += rel; relCount++;
        relMin = (relMin === null) ? rel : Math.min(relMin, rel);
        relMax = (relMax === null) ? rel : Math.max(relMax, rel);
      }
    }
    if (passCol !== -1) {
      const passVal = String(row[passCol] || '');
      if (passVal === 'ผ่าน') passCount++;
      else if (passVal === 'ไม่ผ่าน') failCount++;
      else naCount++;
    }
    if (dialectCol !== -1) {
      const dialect = String(row[dialectCol] || 'ไม่ระบุ');
      dialectStats[dialect] = (dialectStats[dialect] || 0) + 1;
    }
    if (dataTypeCol !== -1) {
      const dt = String(row[dataTypeCol] || 'ไม่ระบุ');
      dataTypeStats[dt] = (dataTypeStats[dt] || 0) + 1;
    }
    if (usernameCol !== -1) {
      const u = String(row[usernameCol] || 'ไม่ระบุ');
      userCounts[u] = (userCounts[u] || 0) + 1;
    }
  });

  const byDialect = Object.keys(dialectStats)
    .sort(function (a, b) { return dialectStats[b] - dialectStats[a]; })
    .map(function (d) { return { dialect: d, count: dialectStats[d] }; });
  const byDataType = Object.keys(dataTypeStats)
    .sort(function (a, b) { return dataTypeStats[b] - dataTypeStats[a]; })
    .map(function (d) { return { dataType: d, count: dataTypeStats[d] }; });
  const topUsers = Object.keys(userCounts)
    .sort(function (a, b) { return userCounts[b] - userCounts[a]; })
    .slice(0, 10)
    .map(function (u) { return { username: u, count: userCounts[u] }; });

  return {
    totalGenerates: totalGenerates,
    avgConditionMatch: condCount > 0 ? Math.round(condSum / condCount) : null,
    avgReliability: relCount > 0 ? Math.round(relSum / relCount) : null,
    minConditionMatch: condMin, maxConditionMatch: condMax,
    minReliability: relMin, maxReliability: relMax,
    passCount: passCount, failCount: failCount, naCount: naCount,
    byDialect: byDialect, byDataType: byDataType, topUsers: topUsers
  };
}

// รวบรวมสถิติชุดข้อมูลที่เคย Commit จากชีต GeneratedDatasets โดยแกะแถวป้ายชื่อ 📦 ของแต่ละรอบ (ใช้ parseGeneratedDatasetBatches_ ตัวเดียวกับที่หน้าเว็บใช้แสดงประวัติ เพื่อความสอดคล้องกัน)
function collectGeneratedDatasetsSummary_() {
  const batches = parseGeneratedDatasetBatches_();
  let totalRows = 0;
  const byUser = {}, byDataType = {}, byTable = {};

  batches.forEach(function (b) {
    totalRows += b.rows.length;
    const labelParts = String(b.label).split('|');
    const dataType = labelParts[0] ? labelParts[0].replace('📦', '').trim() : 'ไม่ระบุ';
    const tableName = labelParts[1] ? labelParts[1].replace('ตาราง:', '').trim() : 'ไม่ระบุ';
    const username = labelParts[2] ? labelParts[2].replace('ผู้บันทึก:', '').trim() : 'ไม่ระบุ';

    byUser[username] = (byUser[username] || 0) + b.rows.length;
    byDataType[dataType] = (byDataType[dataType] || 0) + b.rows.length;
    byTable[tableName] = (byTable[tableName] || 0) + b.rows.length;
  });

  const toSortedArr = function (obj, keyName) {
    return Object.keys(obj)
      .sort(function (a, b) { return obj[b] - obj[a]; })
      .map(function (k) { const o = {}; o[keyName] = k; o.rowCount = obj[k]; return o; });
  };

  return {
    totalCommitRounds: batches.length,
    totalRows: totalRows,
    byUser: toSortedArr(byUser, 'username').slice(0, 10),
    byDataType: toSortedArr(byDataType, 'dataType'),
    byTable: toSortedArr(byTable, 'tableName').slice(0, 10)
  };
}

// รวบรวมสถิติ prompt ที่ผู้ใช้ตั้งชื่อเองแล้วบันทึกไว้ใช้ซ้ำ จากชีต SavedPrompts (ข้ามแถวป้ายชื่อวันที่ 📅 — created_at อยู่คอลัมน์ที่ 3 ไม่ใช่คอลัมน์แรก)
function collectSavedPromptsSummary_() {
  const sh = getSheet_(SHEET_NAMES.PROMPTS);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { total: 0, withImageCount: 0, byDialect: [], byDataType: [] };
  const lastCol = sh.getLastColumn();
  const header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const dataTypeCol = header.indexOf('data_type');
  const dialectCol = header.indexOf('dialect');
  const imageFileIdCol = header.indexOf('image_file_id');
  const createdAtCol = header.indexOf('created_at');
  const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  let total = 0, withImageCount = 0;
  const dialectStats = {}, dataTypeStats = {};

  data.forEach(function (row) {
    const cellA = row[0];
    if (typeof cellA === 'string' && cellA.indexOf('📅') === 0) return; // ข้ามแถวป้ายชื่อวันที่
    const createdAtVal = createdAtCol !== -1 ? row[createdAtCol] : null;
    if (!(createdAtVal instanceof Date)) return; // แถวที่ไม่ใช่แถวข้อมูลจริง ข้ามอย่างปลอดภัย
    total++;
    if (imageFileIdCol !== -1 && String(row[imageFileIdCol] || '').trim()) withImageCount++;
    if (dialectCol !== -1) {
      const dialect = String(row[dialectCol] || 'ไม่ระบุ');
      dialectStats[dialect] = (dialectStats[dialect] || 0) + 1;
    }
    if (dataTypeCol !== -1) {
      const dt = String(row[dataTypeCol] || 'ไม่ระบุ');
      dataTypeStats[dt] = (dataTypeStats[dt] || 0) + 1;
    }
  });

  const byDialect = Object.keys(dialectStats)
    .sort(function (a, b) { return dialectStats[b] - dialectStats[a]; })
    .map(function (d) { return { dialect: d, count: dialectStats[d] }; });
  const byDataType = Object.keys(dataTypeStats)
    .sort(function (a, b) { return dataTypeStats[b] - dataTypeStats[a]; })
    .map(function (d) { return { dataType: d, count: dataTypeStats[d] }; });

  return { total: total, withImageCount: withImageCount, byDialect: byDialect, byDataType: byDataType };
}

// รวบรวมสถิติ prompt ทุกครั้งที่กด Generate จากชีต GeneratedPromptLogs (ข้ามแถวป้ายชื่อวันที่ 📅) — แยกตาม dialect, ประเภทข้อมูล, และสัดส่วนการเปิด/ปิด allow_null
function collectGeneratedPromptLogsSummary_() {
  const sh = getSheet_(SHEET_NAMES.PROMPT_LOGS);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { total: 0, byDialect: [], byDataType: [], allowNullTrueCount: 0, allowNullFalseCount: 0, withImageCount: 0 };
  const lastCol = sh.getLastColumn();
  const header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const dataTypeCol = header.indexOf('data_type');
  const dialectCol = header.indexOf('dialect');
  const allowNullCol = header.indexOf('allow_null');
  const imageFileIdCol = header.indexOf('image_file_id');
  const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  let total = 0, allowNullTrueCount = 0, allowNullFalseCount = 0, withImageCount = 0;
  const dialectStats = {}, dataTypeStats = {};

  data.forEach(function (row) {
    const cellA = row[0];
    if (typeof cellA === 'string' && cellA.indexOf('📅') === 0) return; // ข้ามแถวป้ายชื่อวันที่
    if (!(cellA instanceof Date)) return;
    total++;
    if (allowNullCol !== -1) {
      if (row[allowNullCol] === true) allowNullTrueCount++;
      else allowNullFalseCount++;
    }
    if (imageFileIdCol !== -1 && String(row[imageFileIdCol] || '').trim()) withImageCount++;
    if (dialectCol !== -1) {
      const dialect = String(row[dialectCol] || 'ไม่ระบุ');
      dialectStats[dialect] = (dialectStats[dialect] || 0) + 1;
    }
    if (dataTypeCol !== -1) {
      const dt = String(row[dataTypeCol] || 'ไม่ระบุ');
      dataTypeStats[dt] = (dataTypeStats[dt] || 0) + 1;
    }
  });

  const byDialect = Object.keys(dialectStats)
    .sort(function (a, b) { return dialectStats[b] - dialectStats[a]; })
    .map(function (d) { return { dialect: d, count: dialectStats[d] }; });
  const byDataType = Object.keys(dataTypeStats)
    .sort(function (a, b) { return dataTypeStats[b] - dataTypeStats[a]; })
    .map(function (d) { return { dataType: d, count: dataTypeStats[d] }; });

  return { total: total, byDialect: byDialect, byDataType: byDataType, allowNullTrueCount: allowNullTrueCount, allowNullFalseCount: allowNullFalseCount, withImageCount: withImageCount };
}

// รวบรวมสถิติเชิงความปลอดภัยของระบบ ไว้ใช้เฉพาะหัวข้อ "สรุปความปลอดภัยระบบ" ของรายงาน PDF
// ต่างจากหัวข้ออื่นๆ ที่เน้นปริมาณ/คุณภาพการใช้งาน หัวข้อนี้รวบรวมเฉพาะสิ่งที่แผนกความปลอดภัยต้องการเห็น: สถานะการควบคุมสิทธิ์เข้าถึง, เหตุการณ์ยืนยันตัวตน, และนโยบายที่บังคับใช้อยู่จริงในโค้ด (ดึงค่าคงที่จริงมาแสดง ไม่ใช่พิมพ์ตัวเลขตายตัวแยกไว้ต่างหาก กันข้อมูลเพี้ยนถ้ามีการแก้ค่าคงที่ในอนาคต)
function collectSecuritySummary_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // สถานะสิทธิ์แชร์สเปรดชีต — ใช้ตรรกะเดียวกับ checkDeployReadiness()
  let sharingRestricted = null; // null = ตรวจสอบไม่ได้ (เช่นสิทธิ์ไม่พอ) ไม่ถือว่าผ่านหรือไม่ผ่าน
  try {
    const file = DriveApp.getFileById(ss.getId());
    sharingRestricted = (file.getSharingAccess() === DriveApp.Access.PRIVATE);
  } catch (e) { /* เก็บเป็น null ตามเดิม */ }

  const apiKeySet = !!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

  // นับเฉพาะ Super_Admin ที่อนุมัติแล้ว/ใช้งานได้จริง ไม่นับคำขอสมัคร Super_Admin ที่ยังรออนุมัติอยู่ (login ไม่ได้ ทำหน้าที่ Super_Admin จริงไม่ได้เลย)
  let superAdminCount = 0;
  const usersSh = ss.getSheetByName(SHEET_NAMES.USERS);
  if (usersSh && usersSh.getLastRow() >= 2) {
    const uHeader = usersSh.getRange(1, 1, 1, usersSh.getLastColumn()).getValues()[0];
    const roleCol = uHeader.indexOf('role');
    const approvalStatusCol = uHeader.indexOf('approval_status');
    if (roleCol !== -1) {
      const uData = usersSh.getRange(2, 1, usersSh.getLastRow() - 1, usersSh.getLastColumn()).getValues();
      superAdminCount = uData.filter(function (r) {
        return r[roleCol] === 'Super_Admin' && (approvalStatusCol === -1 || r[approvalStatusCol] !== 'pending');
      }).length;
    }
  }

  const autoArchiveEnabled = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === AUTO_ARCHIVE_TRIGGER_HANDLER_; });
  const autoBackupEnabled = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === AUTO_BACKUP_TRIGGER_HANDLER_; });

  // เหตุการณ์เชิงยืนยันตัวตน/สิทธิ์การเข้าถึงจาก ActivityLogs (ข้ามแถวป้ายชื่อวันที่ 📅 เหมือนตัวรวบรวมอื่นๆ)
  const logSh = getSheet_(SHEET_NAMES.LOGS);
  const lastRow = logSh.getLastRow();
  let loginSuccessCount = 0, loginFailCount = 0, lockoutCount = 0;
  let otpSentCount = 0, resetPasswordCount = 0, changePasswordCount = 0, changePasswordFailCount = 0;
  let adminResetPasswordCount = 0, adminSetEmailCount = 0, deleteUserCount = 0, registerCount = 0;
  let requestDeleteAccountCount = 0;

  if (lastRow >= 2) {
    const data = logSh.getRange(2, 1, lastRow - 1, 5).getValues();
    data.forEach(function (row) {
      const ts = row[0];
      if (typeof ts === 'string' && ts.indexOf('📅') === 0) return;
      if (!(ts instanceof Date)) return;
      const actionType = String(row[3] || '');
      const detail = String(row[4] || '');
      if (actionType === 'LOGIN_SUCCESS') loginSuccessCount++;
      else if (actionType === 'LOGIN_FAIL') {
        loginFailCount++;
        if (detail.indexOf('ล็อกบัญชีชั่วคราว') !== -1) lockoutCount++; // นับเฉพาะครั้งที่ผิดครบจนโดนล็อกจริง ไม่ใช่ทุกครั้งที่ผิด
      }
      else if (actionType === 'PASSWORD_RESET_OTP_SENT') otpSentCount++;
      else if (actionType === 'RESET_PASSWORD') resetPasswordCount++;
      else if (actionType === 'CHANGE_PASSWORD') changePasswordCount++;
      else if (actionType === 'CHANGE_PASSWORD_FAIL') changePasswordFailCount++;
      else if (actionType === 'ADMIN_RESET_PASSWORD') adminResetPasswordCount++;
      else if (actionType === 'ADMIN_SET_EMAIL') adminSetEmailCount++;
      else if (actionType === 'DELETE_USER') deleteUserCount++;
      else if (actionType === 'REGISTER') registerCount++;
      else if (actionType === 'REQUEST_DELETE_ACCOUNT') requestDeleteAccountCount++;
    });
  }

  return {
    sharingRestricted: sharingRestricted, apiKeySet: apiKeySet, superAdminCount: superAdminCount,
    autoArchiveEnabled: autoArchiveEnabled, autoBackupEnabled: autoBackupEnabled,
    loginSuccessCount: loginSuccessCount, loginFailCount: loginFailCount, lockoutCount: lockoutCount,
    otpSentCount: otpSentCount, resetPasswordCount: resetPasswordCount,
    changePasswordCount: changePasswordCount, changePasswordFailCount: changePasswordFailCount,
    adminResetPasswordCount: adminResetPasswordCount, adminSetEmailCount: adminSetEmailCount,
    deleteUserCount: deleteUserCount, registerCount: registerCount,
    requestDeleteAccountCount: requestDeleteAccountCount
  };
}

// ตัวช่วยแทรกย่อหน้า/หัวข้อลงในรายงาน PDF
// หมายเหตุ (แก้ไขหลังเจอ error จริง): DocumentApp.Paragraph ของ Apps Script ไม่มีเมธอด setKeepWithNext ให้ใช้ (มีแค่ใน Google Docs API ขั้นสูงที่ต้องเปิด Advanced Service เพิ่ม)
// จึงแก้ปัญหาหัวข้อย่อย/ตารางแยกหน้ากันด้วยวิธีที่ใช้ได้จริงแทน: บังคับขึ้นหน้าใหม่ก่อนหัวข้อย่อย (HEADING3) ทุกหัวข้อ
// รับประกันว่าหัวข้อย่อยกับตารางของมันจะเริ่มต้นที่หัวหน้าเดียวกันเสมอ ไม่มีทางถูกตัดแยกคนละหน้าอีก (แลกกับใช้จำนวนหน้ามากขึ้นเล็กน้อย)
// isFirstInSection: true สำหรับหัวข้อย่อย (HEADING3) ตัวแรกของแต่ละหัวข้อใหญ่ — ไม่ต้องขึ้นหน้าใหม่ซ้ำเพราะหัวข้อใหญ่เพิ่งขึ้นหน้าใหม่มาเองอยู่แล้ว (กันหน้าเปล่าที่มีแค่หัวข้อใหญ่ลอยๆ)
function reportHeading_(body, text, level, isFirstInSection) {
  if (level === DocumentApp.ParagraphHeading.HEADING3 && !isFirstInSection) {
    body.appendPageBreak();
  }
  const p = body.appendParagraph(text);
  p.setHeading(level);
  return p;
}
function reportParagraph_(body, text) {
  return body.appendParagraph(text);
}

// สร้างเอกสารรายงานผ่าน DocumentApp ก่อน แล้วแปลงเป็น PDF (Apps Script ไม่มี API สร้าง PDF ตรงๆ จากศูนย์ ต้องผ่าน Doc ก่อนเสมอ)
// เก็บเฉพาะไฟล์ PDF ไว้ใน Drive ลบ Google Doc ต้นฉบับทิ้งหลังแปลงเสร็จ กันบวมโฟลเดอร์โดยไม่จำเป็น
// v56: ขยายให้ละเอียดขึ้นมาก — แต่ละชีตมีหัวข้อของตัวเองพร้อมสถิติเจาะลึกหลายมิติ ไม่ใช่แค่จำนวนแถวรวมเหมือน v55
// v57: เพิ่มหัวข้อ "สรุปความปลอดภัยระบบ" (สำหรับส่งให้แผนกความปลอดภัยดูโดยเฉพาะ ไม่ใช่แค่สถิติการใช้งานทั่วไป) + ทุกหัวข้อตั้ง keepWithNext กันหัวข้อ/คำอธิบายไปแยกหน้ากับตารางของตัวเอง
function generateSystemReportPdf() {
  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert(
    'ยืนยันการสร้างรายงานสรุประบบ (ฉบับละเอียด)',
    'ระบบจะรวบรวมสถิติเจาะลึกจากทุกชีต พร้อมหัวข้อ "สรุปความปลอดภัยระบบ" แยกต่างหากสำหรับส่งให้แผนกความปลอดภัยตรวจสอบได้ในไฟล์เดียวกัน สร้างเป็นไฟล์ PDF เก็บไว้ในโฟลเดอร์ Drive แยกต่างหาก "TestDataSimulator_Reports" อาจใช้เวลาสักครู่หากมีข้อมูลจำนวนมาก ต้องการดำเนินการต่อหรือไม่?',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  let doc = null;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tz = Session.getScriptTimeZone();
    const now = new Date();
    const stamp = Utilities.formatDate(now, tz, 'yyyyMMdd_HHmmss');
    const reportName = 'รายงานสรุประบบ_' + stamp;
    const fmtDate = function (d) { return (d instanceof Date) ? Utilities.formatDate(d, tz, 'dd/MM/yyyy HH:mm') : '-'; };
    const pct = function (v) { return (v === null || v === undefined) ? 'N/A' : v + '%'; };
    const H1 = DocumentApp.ParagraphHeading.HEADING1;
    const H2 = DocumentApp.ParagraphHeading.HEADING2;
    const H3 = DocumentApp.ParagraphHeading.HEADING3;

    doc = DocumentApp.create(reportName);
    const body = doc.getBody();

    body.appendParagraph('รายงานสรุประบบ — Intelligent Test Data Simulator').setHeading(DocumentApp.ParagraphHeading.TITLE);
    body.appendParagraph('สร้างเมื่อ: ' + Utilities.formatDate(now, tz, 'dd/MM/yyyy HH:mm:ss') + ' | สเปรดชีต: ' + ss.getName());

    // ภาพรวมขนาดข้อมูลทั้งระบบ (สรุปสั้นๆ ก่อนลงรายละเอียดแต่ละหัวข้อด้านล่าง)
    reportHeading_(body, 'ภาพรวมขนาดข้อมูลทั้งระบบ', H2);
    const targets = [
      { display: 'Users', sheetName: SHEET_NAMES.USERS },
      { display: 'ActivityLogs', sheetName: SHEET_NAMES.LOGS },
      { display: 'QualityScores', sheetName: SHEET_NAMES.QUALITY },
      { display: 'GeneratedDatasets', sheetName: SHEET_NAMES.DATASETS },
      { display: 'SavedPrompts', sheetName: SHEET_NAMES.PROMPTS },
      { display: 'GeneratedPromptLogs', sheetName: SHEET_NAMES.PROMPT_LOGS }
    ];
    const sizeTableData = [['ชื่อชีต', 'จำนวนแถว']];
    targets.forEach(function (t) {
      const targetSh = ss.getSheetByName(t.sheetName);
      const rowCount = targetSh ? Math.max(targetSh.getLastRow() - 1, 0) : 0;
      sizeTableData.push([t.display, String(rowCount)]);
    });
    body.appendTable(sizeTableData);

    // ===== 1. สรุปความปลอดภัยระบบ (สำหรับแผนกความปลอดภัยโดยเฉพาะ) =====
    body.appendPageBreak();
    reportHeading_(body, '1. สรุปความปลอดภัยระบบ (Security Overview)', H1);
    const security = collectSecuritySummary_();

    reportHeading_(body, 'การควบคุมสิทธิ์เข้าถึง', H3, true);
    reportParagraph_(body, 'สิทธิ์การแชร์สเปรดชีต: ' + (security.sharingRestricted === true ? 'จำกัด (Restricted) ✅' : security.sharingRestricted === false ? 'ยังไม่ถูกจำกัด ⚠️' : 'ตรวจสอบไม่ได้'));
    reportParagraph_(body, 'ตั้งค่า GEMINI_API_KEY ใน Script Properties แล้ว: ' + (security.apiKeySet ? 'ใช่' : 'ยัง ⚠️'));
    reportParagraph_(body, 'จำนวนผู้ใช้ role Super_Admin: ' + security.superAdminCount + ' คน' + (security.superAdminCount < 1 ? ' ⚠️ (ต้องมีอย่างน้อย 1 คน)' : ''));
    reportParagraph_(body, 'ระบบย้ายข้อมูลเก่าไปแท็บสำรองอัตโนมัติ: ' + (security.autoArchiveEnabled ? 'เปิดอยู่' : 'ปิดอยู่'));
    body.appendParagraph('ระบบสำรองข้อมูลทั้งไฟล์อัตโนมัติ: ' + (security.autoBackupEnabled ? 'เปิดอยู่' : 'ปิดอยู่'));

    reportHeading_(body, 'เหตุการณ์ด้านการยืนยันตัวตน (จาก ActivityLogs)', H3);
    const secEventTable = [
      ['ประเภทเหตุการณ์', 'จำนวนครั้ง'],
      ['เข้าสู่ระบบสำเร็จ (LOGIN_SUCCESS)', String(security.loginSuccessCount)],
      ['เข้าสู่ระบบล้มเหลว (LOGIN_FAIL)', String(security.loginFailCount)],
      ['บัญชีถูกล็อกชั่วคราวจากรหัสผ่านผิดซ้ำ', String(security.lockoutCount)],
      ['ส่งรหัส OTP กู้คืนรหัสผ่าน (PASSWORD_RESET_OTP_SENT)', String(security.otpSentCount)],
      ['ตั้งรหัสผ่านใหม่ผ่าน OTP สำเร็จ (RESET_PASSWORD)', String(security.resetPasswordCount)],
      ['เปลี่ยนรหัสผ่านตัวเองสำเร็จ (CHANGE_PASSWORD)', String(security.changePasswordCount)],
      ['เปลี่ยนรหัสผ่านตัวเองล้มเหลว (CHANGE_PASSWORD_FAIL)', String(security.changePasswordFailCount)],
      ['Super_Admin รีเซ็ตรหัสผ่านให้ผู้ใช้อื่น (ADMIN_RESET_PASSWORD)', String(security.adminResetPasswordCount)],
      ['Super_Admin ตั้ง/แก้ไขอีเมลผู้ใช้อื่น (ADMIN_SET_EMAIL)', String(security.adminSetEmailCount)],
      ['ลบบัญชีผู้ใช้ (DELETE_USER)', String(security.deleteUserCount)],
      ['ลงทะเบียนผู้ใช้ใหม่ (REGISTER)', String(security.registerCount)],
      ['ผู้ใช้ขอให้ลบบัญชีตัวเอง (REQUEST_DELETE_ACCOUNT)', String(security.requestDeleteAccountCount)]
    ];
    body.appendTable(secEventTable);

    reportHeading_(body, 'นโยบายความปลอดภัยที่บังคับใช้อยู่ในโค้ดปัจจุบัน', H3);
    reportParagraph_(body, '• รหัสผ่านเก็บเป็น salted SHA-256 hash เท่านั้น ไม่มีการเก็บ/แสดงรหัสผ่านจริงที่จุดใดเลย รวมถึง Super_Admin ก็เห็นแค่ปุ่ม "รีเซ็ต" ไม่เห็นรหัสผ่านเดิม');
    reportParagraph_(body, '• ล็อกอินผิดติดต่อกัน ' + LOGIN_MAX_ATTEMPTS + ' ครั้ง จะถูกล็อกบัญชีชั่วคราว ' + LOGIN_LOCKOUT_SECONDS + ' วินาที พร้อมส่งอีเมลแจ้งเตือนเจ้าของบัญชี');
    reportParagraph_(body, '• รหัส OTP กู้คืนรหัสผ่านมีอายุ ' + OTP_TTL_SECONDS + ' วินาที ยืนยันผิดได้ไม่เกิน ' + OTP_MAX_VERIFY_ATTEMPTS + ' ครั้ง และขอรหัสใหม่ได้ไม่เกิน ' + OTP_REQUEST_MAX + ' ครั้งต่อ ' + OTP_REQUEST_WINDOW_SECONDS + ' วินาที');
    reportParagraph_(body, '• จำกัดการลงทะเบียนผู้ใช้ใหม่ไม่เกิน ' + REGISTER_RATE_LIMIT_MAX + ' ครั้งต่อ ' + REGISTER_RATE_LIMIT_WINDOW_SECONDS + ' วินาทีทั้งระบบ กันสคริปต์สมัครบัญชีปลอมรัวๆ');
    reportParagraph_(body, '• ห้ามตั้งรหัสผ่านใหม่ซ้ำกับรหัสผ่านเดิม ทั้งตอนเปลี่ยนรหัสผ่านเองและตอนกู้คืนผ่าน OTP');
    reportParagraph_(body, '• ตรวจสอบสิทธิ์ (role) จากข้อมูลจริงในชีต Users เสมอทุกครั้งที่เรียก action ของ Super_Admin ไม่เชื่อค่า role ที่ฝั่งหน้าเว็บส่งมา');
    reportParagraph_(body, '• Endpoint resetPassword ปฏิเสธทันทีถ้ายังไม่ผ่านการยืนยัน OTP ก่อน ป้องกันการเรียกข้ามขั้นตอนโดยตรง');
    reportParagraph_(body, '• ผู้ใช้ทั่วไปลบบัญชีตัวเองไม่ได้ทันที ทำได้แค่ "ส่งคำขอ" ให้ Super_Admin เป็นคนกดลบจริงผ่านแผงจัดการผู้ใช้งานเท่านั้น กันกดพลาด/กันลบบัญชีตัวเองเพื่อปิดร่องรอย');
    body.appendParagraph('• ข้อจำกัดที่ควรทราบ: ActivityLogs เป็น Google Sheet ธรรมดา ผู้ที่มีสิทธิ์แก้ไขสเปรดชีตนี้โดยตรง (นอกเหนือจากผ่านหน้าเว็บ) สามารถแก้ไข/ลบแถว log ได้โดยไม่ทิ้งร่องรอย log จึงไม่ใช่ tamper-proof — ควรจำกัดสิทธิ์แก้ไขสเปรดชีตนี้ให้แคบที่สุดเท่าที่จำเป็นเสมอ');

    reportHeading_(body, 'ข้อมูลส่วนบุคคลที่จัดเก็บ (อ้างอิง PRIVACY_POLICY.md)', H3);
    const pdpaTable = [
      ['ข้อมูล', 'เก็บไว้ที่'],
      ['ชื่อผู้ใช้งาน (username)', 'Users'],
      ['รหัสผ่าน (salted SHA-256 hash เท่านั้น)', 'Users'],
      ['อีเมล', 'Users'],
      ['ชื่อ-นามสกุลจริง', 'Users'],
      ['แผนก/ทีมที่สังกัด', 'Users'],
      ['บทบาท (role)', 'Users'],
      ['ประวัติการใช้งาน (เวลา/ผู้ใช้/ประเภทกิจกรรม)', 'ActivityLogs'],
      ['Prompt/เงื่อนไขที่ใช้สร้างข้อมูลทดสอบ (รวมรูปแนบ)', 'SavedPrompts, GeneratedPromptLogs']
    ];
    body.appendTable(pdpaTable);

    // ===== 2. Users =====
    body.appendPageBreak();
    reportHeading_(body, '2. Users — ผู้ใช้งานระบบ', H1);
    const userDetail = collectUserDetail_();
    reportParagraph_(body, 'จำนวนผู้ใช้งานทั้งหมด: ' + userDetail.total + ' คน');
    reportParagraph_(body, 'ยังไม่กรอกอีเมล: ' + userDetail.missingEmailCount + ' คน | ยังไม่กรอกชื่อ-นามสกุล: ' + userDetail.missingFullNameCount + ' คน');

    reportHeading_(body, 'แยกตามบทบาท (role)', H3, true);
    if (userDetail.byRole.length) {
      const roleTable = [['บทบาท', 'จำนวน']];
      userDetail.byRole.forEach(function (r) { roleTable.push([r.role, String(r.count)]); });
      body.appendTable(roleTable);
    }

    reportHeading_(body, 'แยกตามแผนก/ทีม', H3);
    if (userDetail.byDepartment.length) {
      const deptTable = [['แผนก/ทีม', 'จำนวนผู้ใช้']];
      userDetail.byDepartment.forEach(function (d) { deptTable.push([d.department, String(d.count)]); });
      body.appendTable(deptTable);
    }

    reportHeading_(body, 'รายชื่อผู้ใช้งานทั้งหมด', H3);
    if (userDetail.users.length) {
      const userTable = [['Username', 'ชื่อ-นามสกุล', 'แผนก/ทีม', 'บทบาท', 'มีอีเมล?', 'สมัครเมื่อ']];
      userDetail.users.forEach(function (u) {
        userTable.push([u.username, u.fullName, u.department, u.role, (u.hasEmail ? 'มี' : 'ไม่มี'), fmtDate(u.createdAt)]);
      });
      body.appendTable(userTable);
    }

    // ===== 3. ActivityLogs =====
    body.appendPageBreak();
    reportHeading_(body, '3. ActivityLogs — ประวัติการใช้งาน', H1);
    const activitySummary = collectActivityLogSummary_();
    reportParagraph_(body, 'จำนวนบันทึกกิจกรรมทั้งหมด: ' + activitySummary.total + ' รายการ');
    reportParagraph_(body, 'ช่วงเวลาที่มีบันทึก: ' + fmtDate(activitySummary.earliestDate) + ' ถึง ' + fmtDate(activitySummary.latestDate));

    reportHeading_(body, 'แยกตามประเภทกิจกรรม (action_type)', H3, true);
    if (activitySummary.byActionType.length) {
      const actionTable = [['ประเภทกิจกรรม', 'จำนวนครั้ง']];
      activitySummary.byActionType.forEach(function (a) { actionTable.push([a.actionType, String(a.count)]); });
      body.appendTable(actionTable);
    }

    reportHeading_(body, 'ผู้ใช้งานที่มีกิจกรรมมากสุด (สูงสุด 10 อันดับ)', H3);
    if (activitySummary.topUsers.length) {
      const topUserTable = [['Username', 'จำนวนกิจกรรม']];
      activitySummary.topUsers.forEach(function (u) { topUserTable.push([u.username, String(u.count)]); });
      body.appendTable(topUserTable);
    }

    // ===== 4. QualityScores =====
    body.appendPageBreak();
    reportHeading_(body, '4. QualityScores — คุณภาพข้อมูลที่สร้าง', H1);
    const qualitySummary = collectQualitySummary_();
    reportParagraph_(body, 'จำนวนครั้งที่สร้างข้อมูลทดสอบทั้งหมด: ' + qualitySummary.totalGenerates + ' ครั้ง');
    reportParagraph_(body, 'ผ่านเกณฑ์ขั้นต่ำ: ' + qualitySummary.passCount + ' ครั้ง | ไม่ผ่าน: ' + qualitySummary.failCount + ' ครั้ง | ประเมินไม่ได้ (N/A): ' + qualitySummary.naCount + ' ครั้ง');

    reportParagraph_(body, '% ตรงตามเงื่อนไข — เฉลี่ย ' + pct(qualitySummary.avgConditionMatch) + ' | ต่ำสุด ' + pct(qualitySummary.minConditionMatch) + ' | สูงสุด ' + pct(qualitySummary.maxConditionMatch));
    reportParagraph_(body, '% ความน่าเชื่อถือ — เฉลี่ย ' + pct(qualitySummary.avgReliability) + ' | ต่ำสุด ' + pct(qualitySummary.minReliability) + ' | สูงสุด ' + pct(qualitySummary.maxReliability));

    reportHeading_(body, 'แยกตาม Dialect', H3, true);
    if (qualitySummary.byDialect.length) {
      const dialectTable = [['Dialect', 'จำนวนครั้ง']];
      qualitySummary.byDialect.forEach(function (d) { dialectTable.push([d.dialect, String(d.count)]); });
      body.appendTable(dialectTable);
    }

    reportHeading_(body, 'แยกตามประเภทข้อมูล (data_type)', H3);
    if (qualitySummary.byDataType.length) {
      const dtTable = [['ประเภทข้อมูล', 'จำนวนครั้ง']];
      qualitySummary.byDataType.forEach(function (d) { dtTable.push([d.dataType, String(d.count)]); });
      body.appendTable(dtTable);
    }

    reportHeading_(body, 'ผู้ใช้งานที่สร้างข้อมูลมากสุด (สูงสุด 10 อันดับ)', H3);
    if (qualitySummary.topUsers.length) {
      const topGenTable = [['Username', 'จำนวนครั้งที่สร้าง']];
      qualitySummary.topUsers.forEach(function (u) { topGenTable.push([u.username, String(u.count)]); });
      body.appendTable(topGenTable);
    }

    // ===== 5. GeneratedDatasets =====
    body.appendPageBreak();
    reportHeading_(body, '5. GeneratedDatasets — ชุดข้อมูลที่ Commit แล้ว', H1);
    const datasetsSummary = collectGeneratedDatasetsSummary_();
    reportParagraph_(body, 'จำนวนรอบที่ Commit ทั้งหมด: ' + datasetsSummary.totalCommitRounds + ' รอบ | จำนวนแถวข้อมูลที่บันทึกสะสม: ' + datasetsSummary.totalRows + ' แถว');

    reportHeading_(body, 'แยกตามผู้บันทึก (สูงสุด 10 อันดับ ตามจำนวนแถว)', H3, true);
    if (datasetsSummary.byUser.length) {
      const dsUserTable = [['Username', 'จำนวนแถวที่บันทึก']];
      datasetsSummary.byUser.forEach(function (u) { dsUserTable.push([u.username, String(u.rowCount)]); });
      body.appendTable(dsUserTable);
    }

    reportHeading_(body, 'แยกตามประเภทข้อมูล (data_type)', H3);
    if (datasetsSummary.byDataType.length) {
      const dsTypeTable = [['ประเภทข้อมูล', 'จำนวนแถวที่บันทึก']];
      datasetsSummary.byDataType.forEach(function (d) { dsTypeTable.push([d.dataType, String(d.rowCount)]); });
      body.appendTable(dsTypeTable);
    }

    reportHeading_(body, 'แยกตามชื่อตาราง (สูงสุด 10 อันดับ ตามจำนวนแถว)', H3);
    if (datasetsSummary.byTable.length) {
      const dsTableTable = [['ตาราง', 'จำนวนแถวที่บันทึก']];
      datasetsSummary.byTable.forEach(function (t) { dsTableTable.push([t.tableName, String(t.rowCount)]); });
      body.appendTable(dsTableTable);
    }

    // ===== 6. SavedPrompts =====
    body.appendPageBreak();
    reportHeading_(body, '6. SavedPrompts — Prompt ที่บันทึกไว้ใช้ซ้ำ', H1);
    const savedPromptsSummary = collectSavedPromptsSummary_();
    reportParagraph_(body, 'จำนวน Prompt ที่บันทึกไว้ทั้งหมด: ' + savedPromptsSummary.total + ' รายการ | มีรูป Schema/ER Diagram แนบ: ' + savedPromptsSummary.withImageCount + ' รายการ');

    reportHeading_(body, 'แยกตาม Dialect', H3, true);
    if (savedPromptsSummary.byDialect.length) {
      const spDialectTable = [['Dialect', 'จำนวน']];
      savedPromptsSummary.byDialect.forEach(function (d) { spDialectTable.push([d.dialect, String(d.count)]); });
      body.appendTable(spDialectTable);
    }

    reportHeading_(body, 'แยกตามประเภทข้อมูล (data_type)', H3);
    if (savedPromptsSummary.byDataType.length) {
      const spTypeTable = [['ประเภทข้อมูล', 'จำนวน']];
      savedPromptsSummary.byDataType.forEach(function (d) { spTypeTable.push([d.dataType, String(d.count)]); });
      body.appendTable(spTypeTable);
    }

    // ===== 7. GeneratedPromptLogs =====
    body.appendPageBreak();
    reportHeading_(body, '7. GeneratedPromptLogs — Prompt ทุกครั้งที่กด Generate', H1);
    const promptLogsSummary = collectGeneratedPromptLogsSummary_();
    reportParagraph_(body, 'จำนวน Prompt ที่ถูกส่งไปสร้างข้อมูลทั้งหมด: ' + promptLogsSummary.total + ' ครั้ง | มีรูป Schema/ER Diagram แนบ: ' + promptLogsSummary.withImageCount + ' ครั้ง');
    reportParagraph_(body, 'เปิด allow_null: ' + promptLogsSummary.allowNullTrueCount + ' ครั้ง | ปิด allow_null: ' + promptLogsSummary.allowNullFalseCount + ' ครั้ง');

    reportHeading_(body, 'แยกตาม Dialect', H3, true);
    if (promptLogsSummary.byDialect.length) {
      const plDialectTable = [['Dialect', 'จำนวนครั้ง']];
      promptLogsSummary.byDialect.forEach(function (d) { plDialectTable.push([d.dialect, String(d.count)]); });
      body.appendTable(plDialectTable);
    }

    reportHeading_(body, 'แยกตามประเภทข้อมูล (data_type)', H3);
    if (promptLogsSummary.byDataType.length) {
      const plTypeTable = [['ประเภทข้อมูล', 'จำนวนครั้ง']];
      promptLogsSummary.byDataType.forEach(function (d) { plTypeTable.push([d.dataType, String(d.count)]); });
      body.appendTable(plTypeTable);
    }

    doc.saveAndClose();

    const docFile = DriveApp.getFileById(doc.getId());
    const pdfBlob = docFile.getAs(MimeType.PDF).setName(reportName + '.pdf');
    const folder = getOrCreateReportsFolder_();
    const pdfFile = folder.createFile(pdfBlob);
    docFile.setTrashed(true); // เก็บแค่ PDF ไว้ ลบ Google Doc ต้นฉบับที่ใช้แค่แปลงไฟล์ทิ้ง

    logActivity_('SYSTEM', 'System', 'GENERATE_REPORT', 'สร้างรายงานสรุประบบเป็น PDF (ฉบับละเอียด + หัวข้อความปลอดภัย): "' + reportName + '.pdf" ไปที่โฟลเดอร์ "TestDataSimulator_Reports"');
    ui.alert('สร้างรายงานสรุประบบเรียบร้อยแล้ว ✅\n\nชื่อไฟล์: ' + reportName + '.pdf\nลิงก์: ' + pdfFile.getUrl());
  } catch (e) {
    // ถ้าพังกลางทาง (เช่นแปลง PDF ไม่สำเร็จ) พยายามเก็บกวาด Doc ต้นฉบับที่สร้างค้างไว้ทิ้งด้วย กันขยะตกค้างใน Drive
    if (doc) { try { DriveApp.getFileById(doc.getId()).setTrashed(true); } catch (e2) { /* ข้ามได้ */ } }
    ui.alert('สร้างรายงานไม่สำเร็จ: ' + e.message);
  }
}

// สร้างข้อความวันที่แบบไทย เช่น "18 กรกฎาคม 2569" (ใช้ปี พ.ศ.)
function formatThaiDateLabel_(date, timeZone) {
  const thaiMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const day = Number(Utilities.formatDate(date, timeZone, 'd'));
  const monthIndex = Number(Utilities.formatDate(date, timeZone, 'M')) - 1;
  const yearBE = Number(Utilities.formatDate(date, timeZone, 'yyyy')) + 543;
  return day + ' ' + thaiMonths[monthIndex] + ' ' + yearBE;
}

function dateKeyOf_(dateVal, timeZone) {
  const d = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
  return Utilities.formatDate(d, timeZone, 'yyyy-MM-dd');
}

// ---------------------------------------------------------------------------
// ตัวช่วยจัดกลุ่มแท็บสำรอง (Archive) เป็นชั้นซ้อน ปี → เดือน → วัน แบบยุบ/ขยายได้
// ---------------------------------------------------------------------------
const THAI_MONTHS_ = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

function yearKeyOf_(dateVal, timeZone) {
  const d = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
  return Utilities.formatDate(d, timeZone, 'yyyy');
}

function monthKeyOf_(dateVal, timeZone) {
  const d = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
  return Utilities.formatDate(d, timeZone, 'yyyy-MM');
}

function yearLabelThai_(dateVal, timeZone) {
  const d = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
  const yearBE = Number(Utilities.formatDate(d, timeZone, 'yyyy')) + 543;
  return '📆 ปี ' + yearBE;
}

function monthLabelThai_(dateVal, timeZone) {
  const d = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
  const monthIndex = Number(Utilities.formatDate(d, timeZone, 'M')) - 1;
  const yearBE = Number(Utilities.formatDate(d, timeZone, 'yyyy')) + 543;
  return '🗓️ ' + THAI_MONTHS_[monthIndex] + ' ' + yearBE;
}

// ---------------------------------------------------------------------------
// ENTRY POINTS
// ---------------------------------------------------------------------------
function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  let result;
  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    switch (payload.action) {
      case 'register':
        result = withLock_(function () { return handleRegister_(payload); });
        break;
      case 'login':
        result = handleLogin_(payload);
        break;
      case 'generate':
        result = handleGenerate_(payload);
        break;
      case 'commit':
        result = handleCommit_(payload);
        break;
      case 'savePrompt':
        result = handleSavePrompt_(payload);
        break;
      case 'getSavedPrompts':
        result = handleGetSavedPrompts_(payload);
        break;
      case 'deletePrompt':
        result = withLock_(function () { return handleDeletePrompt_(payload); });
        break;
      case 'getQualityScores':
        result = handleGetQualityScores_(payload);
        break;
      case 'getSavedImage':
        result = handleGetSavedImage_(payload);
        break;
      case 'getGeneratedDatasetsList':
        result = handleGetGeneratedDatasetsList_(payload);
        break;
      case 'getGeneratedDatasetBatch':
        result = handleGetGeneratedDatasetBatch_(payload);
        break;
      case 'deleteGeneratedDatasetBatch':
        result = withLock_(function () { return handleDeleteGeneratedDatasetBatch_(payload); });
        break;
      case 'getAllUsers':
        result = handleGetAllUsers_(payload);
        break;
      case 'deleteUser':
        result = withLock_(function () { return handleDeleteUser_(payload); });
        break;
      case 'adminResetPassword':
        result = withLock_(function () { return handleAdminResetPassword_(payload); });
        break;
      case 'approveSuperAdminRequest':
        result = withLock_(function () { return handleApproveSuperAdminRequest_(payload); });
        break;
      case 'rejectSuperAdminRequest':
        result = withLock_(function () { return handleRejectSuperAdminRequest_(payload); });
        break;
      case 'getGeminiQuotaStatus':
        result = handleGetGeminiQuotaStatus_(payload);
        break;
      case 'checkUserExists':
        result = handleCheckUserExists_(payload);
        break;
      case 'requestPasswordResetOtp':
        result = handleRequestPasswordResetOtp_(payload);
        break;
      case 'verifyPasswordResetOtp':
        result = handleVerifyPasswordResetOtp_(payload);
        break;
      case 'resetPassword':
        result = withLock_(function () { return handleResetPassword_(payload); });
        break;
      case 'adminSetUserEmail':
        result = withLock_(function () { return handleAdminSetUserEmail_(payload); });
        break;
      case 'changeOwnPassword':
        result = withLock_(function () { return handleChangeOwnPassword_(payload); });
        break;
      case 'requestDeleteAccount':
        result = withLock_(function () { return handleRequestDeleteAccount_(payload); });
        break;
      case 'dismissDeleteAccountRequest':
        result = withLock_(function () { return handleDismissDeleteAccountRequest_(payload); });
        break;
      case 'logout':
        result = handleLogout_(payload);
        break;
      case 'validateSession':
        result = handleValidateSession_(payload);
        break;
      case 'renewSession':
        result = handleRenewSession_(payload);
        break;
      case 'invalidateSession':
        result = handleInvalidateSession_(payload);
        break;
      case 'ping':
        result = { success: true, message: 'pong', version: BACKEND_VERSION };
        break;
      default:
        result = { success: false, error: 'ไม่รู้จัก action: ' + payload.action };
    }
  } catch (err) {
    result = { success: false, error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์: ' + err.message };
  }
  return jsonOutput_(result);
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ป้องกัน race condition: ใช้ล็อกก่อนรัน action ที่แก้ไข/ลบแถวโดยอ้างอิง row index
// (ถ้ามีคำขอพร้อมกันสองคำขอ ตัวที่มาทีหลังอาจใช้ index ที่เลื่อนไปแล้วจากคำขอแรก)
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { success: false, error: 'ระบบมีผู้ใช้งานพร้อมกันหนาแน่นในขณะนี้ กรุณาลองใหม่อีกครั้งในอีกสักครู่' };
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------
// ทำให้ username เทียบกันแบบไม่สนตัวพิมพ์เล็ก/ใหญ่ และตัดช่องว่างหัวท้ายทิ้งก่อนเทียบเสมอ
// เพื่อป้องกันกรณีเช่น "Admin123" กับ "admin123" หรือมีช่องว่างแฝงมา ถูกนับเป็นคนละคนกันทั้งที่ควรถือเป็น username ซ้ำ
function normalizeUsername_(username) {
  return String(username || '').trim().toLowerCase();
}

// ตรวจรูปแบบอีเมลแบบคร่าวๆ (ไม่ต้องเป๊ะตาม RFC เต็มรูปแบบ แค่พอกันพิมพ์ผิดชัดๆ ก่อนบันทึกลง Sheet)
function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

// ใช้เฉพาะตอนสมัครบัญชีใหม่ — บังคับให้เป็นอีเมล gmail.com เท่านั้น (กันพิมพ์ผิด เช่น "gamil.com" ที่ผ่าน isValidEmail_ เพราะรูปแบบยังถูกต้องตาม RFC)
// ไม่ใช้ helper นี้กับ handleAdminSetUserEmail_ โดยตั้งใจ เพื่อให้ Super_Admin ยังตั้งอีเมลโดเมนอื่นให้ผู้ใช้ที่มีอยู่แล้วได้ตามความจำเป็น
function isGmailAddress_(email) {
  const trimmed = String(email || '').trim();
  if (!isValidEmail_(trimmed)) return false;
  const domain = trimmed.split('@')[1] || '';
  return domain.toLowerCase() === 'gmail.com';
}

// ---------------------------------------------------------------------------
// SESSION TOKEN (สำหรับ "จดจำการเข้าสู่ระบบ" ฝั่งหน้าเว็บผ่าน localStorage + Auto Logout อัตโนมัติเมื่อหมดอายุ)
// ใช้ CacheService ของ Apps Script เก็บ token ชั่วคราว เพราะมี expiry ในตัวจริงๆ (server บังคับหมดอายุเอง
// ไม่ต้องพึ่งฝั่ง client อย่างเดียว) — ไม่ได้เก็บรหัสผ่านไว้ใน token เด็ดขาด เก็บแค่ username/role ที่ผูกกับ token นี้เท่านั้น
// ---------------------------------------------------------------------------
const SESSION_DURATION_SECONDS = 600; // Auto Logout แบบ idle timeout — ไม่มี action เกิน 10 นาที (ทดสอบผ่านที่ 1 นาทีแล้ว ปรับเป็นค่าใช้งานจริง) ต้องตรงกับ IDLE_TIMEOUT_MS ฝั่ง Final.html เสมอ
const SESSION_CACHE_PREFIX_ = 'SESSION_';

// สร้าง session token ใหม่ ผูกกับ username/role แล้วเก็บลง CacheService (หมดอายุอัตโนมัติตาม SESSION_DURATION_SECONDS)
function generateSessionToken_(username, role) {
  const token = Utilities.getUuid();
  try {
    CacheService.getScriptCache().put(SESSION_CACHE_PREFIX_ + token, JSON.stringify({ username: username, role: role }), SESSION_DURATION_SECONDS);
  } catch (e) {
    // ถ้าสร้าง session cache ไม่สำเร็จ ไม่ควรทำให้ login ทั้งหมดล้มเหลว แค่ไม่มี token ให้ใช้ "จดจำการเข้าสู่ระบบ" เท่านั้น
    return null;
  }
  return token;
}

// ตรวจสอบว่า token ยังใช้ได้จริงหรือไม่ (ยังไม่หมดอายุใน CacheService) คืนค่า {username, role} ถ้าใช้ได้ ไม่งั้นคืน null
function validateSessionToken_(token) {
  if (!token) return null;
  try {
    const raw = CacheService.getScriptCache().get(SESSION_CACHE_PREFIX_ + token);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// ลบ token ทิ้งทันที (ใช้ตอนกด logout ด้วยตนเอง ไม่ต้องรอให้หมดอายุเอง)
function invalidateSessionToken_(token) {
  if (!token) return;
  try {
    CacheService.getScriptCache().remove(SESSION_CACHE_PREFIX_ + token);
  } catch (e) {
    // ข้ามได้
  }
}

// ต่ออายุ token ออกไปอีก SESSION_DURATION_SECONDS นับจากตอนนี้ — เรียกเฉพาะตอนหน้าเว็บตรวจพบว่า "มีการใช้งานจริง" เท่านั้น
// (Auto Logout แบบนี้คือ idle timeout: อายุ session จะยืดออกไปเรื่อยๆ ตราบใดที่ยังมี action เกิดขึ้น จะหมดอายุก็ต่อเมื่อไม่มี action เลยนานเกินกำหนด)
// ไม่ต่ออายุให้ถ้า token เดิมหมดอายุไปแล้วจริง (validateSessionToken_ คืน null) เพื่อไม่ให้ session ที่หมดอายุไปแล้วฟื้นกลับมาใช้ได้อีก
function renewSessionToken_(token) {
  const session = validateSessionToken_(token);
  if (!session) return null;
  try {
    CacheService.getScriptCache().put(SESSION_CACHE_PREFIX_ + token, JSON.stringify(session), SESSION_DURATION_SECONDS);
  } catch (e) {
    return null;
  }
  return session;
}

// ให้หน้าเว็บเรียกตอนโหลดหน้าใหม่ (จาก token ที่เก็บไว้ใน localStorage) เพื่อเช็คว่ายัง "จดจำการเข้าสู่ระบบ" ได้อยู่ไหม
function handleValidateSession_(p) {
  const session = validateSessionToken_(p.token);
  if (!session) {
    return { success: false, error: 'Session หมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' };
  }
  return { success: true, username: session.username, role: session.role };
}

// ให้หน้าเว็บเรียกเป็นระยะๆ ตอนตรวจพบว่าผู้ใช้มีการใช้งานจริง (idle timeout) เพื่อยืดอายุ session ออกไปอีก
function handleRenewSession_(p) {
  const session = renewSessionToken_(p.token);
  if (!session) {
    return { success: false, error: 'Session หมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' };
  }
  return { success: true, username: session.username, role: session.role, expiresInSeconds: SESSION_DURATION_SECONDS };
}

// ให้หน้าเว็บเรียกตอนกด logout ด้วยตนเอง เพื่อล้าง token ทิ้งทันทีไม่ต้องรอหมดอายุเอง
function handleInvalidateSession_(p) {
  invalidateSessionToken_(p.token);
  return { success: true };
}

// จำกัดจำนวนการสมัครสมาชิกรวมทั้งระบบต่อช่วงเวลาสั้นๆ (ไม่ได้จำกัดต่อ username เพราะทุกครั้งเป็นชื่อใหม่ที่ไม่ซ้ำกันอยู่แล้ว)
// กันสคริปต์ยิงสมัครบัญชีปลอมรัวๆ จนชีต Users รก — ทีมจริงแทบไม่มีทางสมัครพร้อมกันเกินนี้ในเวลาสั้นขนาดนี้อยู่แล้ว
const REGISTER_RATE_LIMIT_MAX = 5;
const REGISTER_RATE_LIMIT_WINDOW_SECONDS = 60;
const REGISTER_RATE_LIMIT_CACHE_KEY_ = 'REGISTER_RATE_COUNT';

// คืน true ถ้ายังลงทะเบียนได้ (ไม่เกินโควต้าในช่วงเวลานี้) — เรียกแล้วนับเพิ่มให้ในตัวเลย
function checkAndRecordRegisterRate_() {
  try {
    const cache = CacheService.getScriptCache();
    const count = (parseInt(cache.get(REGISTER_RATE_LIMIT_CACHE_KEY_) || '0', 10) || 0) + 1;
    if (count > REGISTER_RATE_LIMIT_MAX) return false;
    cache.put(REGISTER_RATE_LIMIT_CACHE_KEY_, String(count), REGISTER_RATE_LIMIT_WINDOW_SECONDS);
    return true;
  } catch (e) {
    return true; // เช็คไม่สำเร็จ ปล่อยผ่านไปก่อน ดีกว่าทำให้สมัครสมาชิกใช้งานไม่ได้ทั้งหมด
  }
}

function handleRegister_(p) {
  if (!p.username || !p.password || !p.role) {
    return { success: false, error: 'ข้อมูลลงทะเบียนไม่ครบถ้วน' };
  }
  if (!checkAndRecordRegisterRate_()) {
    return { success: false, error: 'มีการลงทะเบียนถี่เกินไปในระบบขณะนี้ กรุณาลองใหม่อีกครั้งในอีกสักครู่' };
  }
  // อีเมลบังคับกรอกตั้งแต่เวอร์ชันนี้เป็นต้นไป — ใช้สำหรับส่งรหัสยืนยัน (OTP) ตอน "ลืมรหัสผ่าน" ในอนาคต
  // จำกัดเฉพาะโดเมน gmail.com เท่านั้นตอนสมัคร กันพิมพ์โดเมนผิด (เช่น gamil.com) ที่ผ่านการตรวจรูปแบบทั่วไปได้เพราะยังนับเป็นอีเมลที่ถูกต้องตาม RFC
  if (!p.email || !isGmailAddress_(p.email)) {
    return { success: false, error: 'กรุณากรอกอีเมลให้เป็น Gmail (gmail.com) เท่านั้น' };
  }
  // ชื่อ-นามสกุล และแผนก/ทีม บังคับกรอกตั้งแต่เวอร์ชันนี้เป็นต้นไป — ช่วยให้ Super_Admin ระบุตัวตนจริงของ user และเห็นภาพรวมว่าทีมไหนใช้งานระบบนี้บ้าง
  if (!p.fullName || !String(p.fullName).trim()) {
    return { success: false, error: 'กรุณากรอกชื่อ-นามสกุลจริง' };
  }
  if (!p.department || !String(p.department).trim()) {
    return { success: false, error: 'กรุณากรอกแผนก/ทีมที่สังกัด' };
  }
  const sh = getSheet_(SHEET_NAMES.USERS);
  ensureColumnHeader_(sh, 'email'); // เผื่อ sheet เก่ายังไม่มีคอลัมน์นี้
  ensureColumnHeader_(sh, 'full_name'); // เผื่อ sheet เก่ายังไม่มีคอลัมน์นี้ (setupSheet() อาจยังไม่ถูกรันซ้ำหลังเพิ่มฟีเจอร์นี้)
  ensureColumnHeader_(sh, 'department');
  // '' (ว่าง) = อนุมัติแล้ว/ไม่ต้องอนุมัติ (ค่าเริ่มต้นของผู้ใช้ทั่วไปและบัญชีเก่าก่อนฟีเจอร์นี้) — 'pending' = สมัคร role Super_Admin ที่ยังรอ Super Admin หลักอนุมัติ
  ensureColumnHeader_(sh, 'approval_status');
  const data = sh.getDataRange().getValues();
  const header = data[0];
  const usernameCol = header.indexOf('username');
  const normNewUsername = normalizeUsername_(p.username);

  for (let i = 1; i < data.length; i++) {
    if (normalizeUsername_(data[i][usernameCol]) === normNewUsername) {
      return { success: false, error: 'ชื่อผู้ใช้งานนี้ได้รับการลงทะเบียนในระบบแล้ว (ไม่สนใจตัวพิมพ์เล็ก/ใหญ่)' };
    }
  }

  // สมัคร role Super_Admin ต้องรอ Super Admin หลัก (PRIMARY_SUPER_ADMIN_USERNAME) อนุมัติก่อนเสมอ
  // กันไม่ให้ใครก็ได้เลือก role นี้จาก dropdown ตอนสมัครแล้วได้สิทธิ์สูงสุดทันทีโดยไม่มีใครตรวจสอบ/อนุมัติเลย
  const isSuperAdminRequest = (p.role === 'Super_Admin');
  const approvalStatus = isSuperAdminRequest ? 'pending' : '';

  const salt = generateSalt_();
  const hash = hashPassword_(p.password, salt);
  // สร้างแถวใหม่โดยอ้างอิงตำแหน่งคอลัมน์จาก header จริงเสมอ (ไม่ใช้ fixed array ตามลำดับที่เขียนในโค้ด)
  // กันปัญหาข้อมูลเลื่อนคอลัมน์ผิดถ้ามีคอลัมน์อื่นถูกแทรกเพิ่มมาก่อนหน้านี้จากฟีเจอร์อื่น (เช่น delete_requested_at)
  const newRow = new Array(header.length).fill('');
  newRow[usernameCol] = p.username.trim();
  newRow[header.indexOf('salt')] = salt;
  newRow[header.indexOf('password_hash')] = hash;
  newRow[header.indexOf('role')] = p.role;
  newRow[header.indexOf('created_at')] = new Date();
  newRow[header.indexOf('email')] = p.email.trim();
  newRow[header.indexOf('full_name')] = String(p.fullName).trim();
  newRow[header.indexOf('department')] = String(p.department).trim();
  newRow[header.indexOf('approval_status')] = approvalStatus;
  sh.appendRow(newRow);

  if (isSuperAdminRequest) {
    logActivity_(p.username, p.role, 'REGISTER_PENDING_APPROVAL', 'สมัครสมาชิก role Super_Admin ใหม่ รอ Super Admin หลัก ("' + PRIMARY_SUPER_ADMIN_USERNAME + '") อนุมัติก่อนจึงจะเข้าสู่ระบบได้');
    // แจ้งอีเมล Super Admin หลักเท่านั้น (ไม่ใช่ Super_Admin ทุกคน) — ส่งอีเมลไม่สำเร็จก็ไม่ควรทำให้การสมัครทั้งหมดล้มเหลว แค่บันทึก log เพิ่มไว้
    try {
      const primaryEmail = getPrimarySuperAdminEmail_();
      if (primaryEmail) {
        MailApp.sendEmail({
          to: primaryEmail,
          subject: 'มีคำขอสมัคร Super Admin ใหม่รออนุมัติ — Intelligent Test Data Simulator',
          body: 'มีผู้สมัครสมาชิกเลือก role "Super Admin" ในระบบ Intelligent Test Data Simulator รอการอนุมัติจากคุณในฐานะ Super Admin หลักของระบบ\n\n' +
                'ชื่อผู้ใช้งาน: ' + p.username.trim() + '\n' +
                'ชื่อ-นามสกุล: ' + String(p.fullName).trim() + '\n' +
                'แผนก/ทีม: ' + String(p.department).trim() + '\n' +
                'อีเมล: ' + p.email.trim() + '\n\n' +
                'กรุณาเข้าสู่ระบบแล้วเปิดแผง "🛡️ จัดการผู้ใช้งาน" เพื่อพิจารณาอนุมัติหรือปฏิเสธคำขอนี้ ผู้สมัครจะยังไม่สามารถเข้าสู่ระบบได้จนกว่าคุณจะอนุมัติ'
        });
      }
    } catch (e) {
      try { logActivity_(p.username, p.role, 'REGISTER_PENDING_APPROVAL_EMAIL_FAIL', 'ส่งอีเมลแจ้ง Super Admin หลักเรื่องคำขอสมัคร Super_Admin ไม่สำเร็จ: ' + e.message); } catch (e2) { /* ข้ามได้ */ }
    }
    return { success: true, pendingApproval: true };
  }

  logActivity_(p.username, p.role, 'REGISTER', 'ลงทะเบียนผู้ใช้ใหม่สำเร็จ');
  return { success: true };
}

// ---------------------------------------------------------------------------
// LOGIN LOCKOUT (กันบรute-force เดารหัสผ่าน) — เข้าสู่ระบบผิดพลาดติดต่อกันครบ LOGIN_MAX_ATTEMPTS ครั้ง จะถูกล็อกชั่วคราว LOGIN_LOCKOUT_SECONDS วินาที
// เก็บผ่าน CacheService (เหมือน session token) เพราะมี expiry ในตัว ไม่ต้องเขียนโค้ดจับเวลาเคลียร์เอง และนับแยกต่อ username (ไม่กระทบบัญชีอื่น)
// ---------------------------------------------------------------------------
const LOGIN_MAX_ATTEMPTS = 3;
const LOGIN_LOCKOUT_SECONDS = 60;
const LOGIN_FAIL_CACHE_PREFIX_ = 'LOGIN_FAIL_';
const LOGIN_LOCK_CACHE_PREFIX_ = 'LOGIN_LOCK_';

// คืนจำนวนวินาทีที่เหลือของการล็อก (0 ถ้าไม่ได้ถูกล็อกอยู่)
function getLoginLockRemainingSeconds_(normUsername) {
  try {
    const raw = CacheService.getScriptCache().get(LOGIN_LOCK_CACHE_PREFIX_ + normUsername);
    if (!raw) return 0;
    const remaining = Math.ceil((parseInt(raw, 10) - Date.now()) / 1000);
    return remaining > 0 ? remaining : 0;
  } catch (e) {
    return 0;
  }
}

// บันทึกว่า login ผิดพลาด 1 ครั้ง ถ้าครบ LOGIN_MAX_ATTEMPTS จะสั่งล็อกทันที คืนค่าจำนวนโอกาสที่เหลือ/สถานะว่าล็อกไปหรือยัง
function recordLoginFailure_(normUsername) {
  try {
    const cache = CacheService.getScriptCache();
    const key = LOGIN_FAIL_CACHE_PREFIX_ + normUsername;
    const count = (parseInt(cache.get(key) || '0', 10) || 0) + 1;
    if (count >= LOGIN_MAX_ATTEMPTS) {
      cache.put(LOGIN_LOCK_CACHE_PREFIX_ + normUsername, String(Date.now() + LOGIN_LOCKOUT_SECONDS * 1000), LOGIN_LOCKOUT_SECONDS);
      cache.remove(key); // เริ่มนับใหม่หลังปลดล็อก
      return { justLocked: true, remainingAttempts: 0 };
    }
    cache.put(key, String(count), LOGIN_LOCKOUT_SECONDS); // ตัวนับหมดอายุเองถ้าไม่ผิดซ้ำภายในเวลานี้ กันค้างตลอดไป
    return { justLocked: false, remainingAttempts: LOGIN_MAX_ATTEMPTS - count };
  } catch (e) {
    return { justLocked: false, remainingAttempts: null };
  }
}

// เคลียร์ตัวนับความผิดพลาดทิ้งทันทีตอน login สำเร็จ
function clearLoginFailures_(normUsername) {
  try {
    const cache = CacheService.getScriptCache();
    cache.remove(LOGIN_FAIL_CACHE_PREFIX_ + normUsername);
    cache.remove(LOGIN_LOCK_CACHE_PREFIX_ + normUsername);
  } catch (e) {
    // ข้ามได้
  }
}

// แจ้งเตือนเจ้าของบัญชีทางอีเมลเมื่อบัญชีโดนล็อกจาก login lockout — ใช้ MailApp เดียวกับที่มี infrastructure อยู่แล้วจากฟีเจอร์ OTP
// จำกัดไม่เกิน 1 ฉบับ/ชั่วโมงต่อ username กันไม่ให้กลายเป็นช่องทางใหม่ที่ใช้ยิงรัวๆ จนโควต้าส่งอีเมลของทั้งระบบหมด (ความเสี่ยงเดียวกับที่ป้องกันไว้ใน requestPasswordResetOtp)
const LOCKOUT_NOTIFY_COOLDOWN_SECONDS = 3600;
const LOCKOUT_NOTIFY_CACHE_PREFIX_ = 'LOCKOUT_NOTIFY_';

function maybeSendLockoutNotification_(normUsername, displayUsername, email) {
  if (!email) return; // ไม่มีอีเมลผูกไว้ ก็แจ้งไม่ได้ ข้ามเงียบๆ (ไม่ควรทำให้ login lockout ล้มเหลวเพราะเรื่องนี้)
  try {
    const cache = CacheService.getScriptCache();
    const key = LOCKOUT_NOTIFY_CACHE_PREFIX_ + normUsername;
    if (cache.get(key)) return; // เพิ่งแจ้งไปแล้วในชั่วโมงนี้ ข้าม
    cache.put(key, '1', LOCKOUT_NOTIFY_COOLDOWN_SECONDS);
    MailApp.sendEmail({
      to: email,
      subject: 'แจ้งเตือนความปลอดภัย: บัญชีของคุณถูกล็อกชั่วคราว — Intelligent Test Data Simulator',
      body: 'บัญชีผู้ใช้งาน "' + displayUsername + '" มีการพยายามเข้าสู่ระบบด้วยรหัสผ่านผิดติดต่อกัน ' + LOGIN_MAX_ATTEMPTS + ' ครั้ง ระบบจึงล็อกบัญชีนี้ชั่วคราว ' + LOGIN_LOCKOUT_SECONDS + ' วินาทีเพื่อความปลอดภัย\n\n' +
            'ถ้าเป็นคุณเองที่พิมพ์รหัสผ่านผิด ไม่ต้องดำเนินการอะไรเพิ่มเติม รอครบเวลาแล้วลองเข้าสู่ระบบใหม่ได้ตามปกติ\n\n' +
            'ถ้าไม่ใช่คุณ แนะนำให้เข้าสู่ระบบแล้วเปลี่ยนรหัสผ่านทันทีผ่านปุ่ม "เปลี่ยนรหัสผ่าน" เพื่อความปลอดภัยของบัญชีคุณ'
    });
  } catch (e) {
    // ส่งอีเมลแจ้งเตือนไม่สำเร็จ ไม่ควรทำให้ login lockout logic ปกติล้มเหลวไปด้วย ข้ามได้เงียบๆ
  }
}

function handleLogin_(p) {
  if (!p.username || !p.password) {
    return { success: false, error: 'กรุณาระบุชื่อผู้ใช้งานและรหัสผ่าน' };
  }
  const normUsername = normalizeUsername_(p.username);

  // เช็ค lockout ก่อนเสมอ ไม่ว่า username นี้จะมีจริงในระบบหรือไม่ก็ตาม (กันเดาชื่อผู้ใช้งานแบบ brute-force ไปด้วย)
  const lockRemaining = getLoginLockRemainingSeconds_(normUsername);
  if (lockRemaining > 0) {
    // ส่ง lockedSeconds กลับไปด้วย (นอกจากข้อความ error) เพื่อให้หน้าเว็บปิดปุ่ม "เข้าสู่ระบบ" ชั่วคราวและนับถอยหลังให้ตรงกับเวลาจริงที่เหลือ
    return { success: false, error: 'เข้าสู่ระบบผิดพลาดติดต่อกันเกินกำหนด ระบบล็อกบัญชีนี้ชั่วคราว กรุณารออีก ' + lockRemaining + ' วินาทีแล้วลองใหม่', lockedSeconds: lockRemaining };
  }

  const sh = getSheet_(SHEET_NAMES.USERS);
  ensureColumnHeader_(sh, 'email'); // เผื่อ sheet เก่ายังไม่มีคอลัมน์นี้ — ใช้แจ้งเตือนตอนโดน lockout ด้วย
  ensureColumnHeader_(sh, 'approval_status'); // เผื่อ sheet เก่ายังไม่มีคอลัมน์นี้ — เช็คว่าบัญชี Super_Admin ที่สมัครใหม่ได้รับอนุมัติจาก Super Admin หลักแล้วหรือยัง
  const data = sh.getDataRange().getValues();
  const header = data[0];
  const idx = {
    username: header.indexOf('username'),
    salt: header.indexOf('salt'),
    hash: header.indexOf('password_hash'),
    role: header.indexOf('role'),
    email: header.indexOf('email'),
    approvalStatus: header.indexOf('approval_status')
  };

  for (let i = 1; i < data.length; i++) {
    if (normalizeUsername_(data[i][idx.username]) === normUsername) {
      const computed = hashPassword_(p.password, data[i][idx.salt]);
      if (computed === data[i][idx.hash]) {
        // รหัสผ่านถูกต้อง แต่ถ้าเป็นคำขอสมัคร Super_Admin ที่ยังรอ Super Admin หลักอนุมัติอยู่ ยังไม่ให้เข้าระบบ (ไม่นับเป็นความผิดพลาด ไม่กระทบ login lockout)
        const approvalStatus = idx.approvalStatus !== -1 ? data[i][idx.approvalStatus] : '';
        if (approvalStatus === 'pending') {
          return { success: false, error: 'บัญชีนี้เป็นคำขอสมัคร Super Admin ที่ยังรอ Super Admin หลักของระบบอนุมัติอยู่ กรุณารอการอนุมัติแล้วลองเข้าสู่ระบบใหม่อีกครั้ง (ระบบจะส่งอีเมลแจ้งเมื่อได้รับการอนุมัติ)', pendingApproval: true };
        }
        clearLoginFailures_(normUsername);
        logActivity_(data[i][idx.username], data[i][idx.role], 'LOGIN_SUCCESS', 'เข้าสู่ระบบสำเร็จ');
        // สร้าง session token ให้ด้วย (ไม่บังคับว่าหน้าเว็บต้องใช้) เพื่อรองรับฟีเจอร์ "จดจำการเข้าสู่ระบบ" ผ่าน localStorage + Auto Logout อัตโนมัติ
        const sessionToken = generateSessionToken_(data[i][idx.username], data[i][idx.role]);
        return { success: true, role: data[i][idx.role], token: sessionToken, expiresInSeconds: SESSION_DURATION_SECONDS };
      }
      const attemptsInfo = recordLoginFailure_(normUsername);
      logActivity_(data[i][idx.username], data[i][idx.role], 'LOGIN_FAIL', 'เข้าสู่ระบบล้มเหลว (รหัสผ่านไม่ถูกต้อง)' + (attemptsInfo.justLocked ? ' — ผิดครบ ' + LOGIN_MAX_ATTEMPTS + ' ครั้ง ล็อกบัญชีชั่วคราว ' + LOGIN_LOCKOUT_SECONDS + ' วินาที' : ''));
      if (attemptsInfo.justLocked) {
        maybeSendLockoutNotification_(normUsername, data[i][idx.username], idx.email !== -1 ? data[i][idx.email] : '');
        return { success: false, error: 'เข้าสู่ระบบผิดพลาดครบ ' + LOGIN_MAX_ATTEMPTS + ' ครั้งติดต่อกัน ระบบล็อกบัญชีนี้ชั่วคราว ' + LOGIN_LOCKOUT_SECONDS + ' วินาที กรุณาลองใหม่ภายหลัง', lockedSeconds: LOGIN_LOCKOUT_SECONDS };
      }
      const remainingMsg = (attemptsInfo.remainingAttempts !== null) ? (' (เหลือโอกาสอีก ' + attemptsInfo.remainingAttempts + ' ครั้งก่อนถูกล็อกชั่วคราว)') : '';
      return { success: false, error: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' + remainingMsg };
    }
  }

  const attemptsInfo = recordLoginFailure_(normUsername);
  if (attemptsInfo.justLocked) {
    return { success: false, error: 'เข้าสู่ระบบผิดพลาดครบ ' + LOGIN_MAX_ATTEMPTS + ' ครั้งติดต่อกัน ระบบล็อกบัญชีนี้ชั่วคราว ' + LOGIN_LOCKOUT_SECONDS + ' วินาที กรุณาลองใหม่ภายหลัง', lockedSeconds: LOGIN_LOCKOUT_SECONDS };
  }
  return { success: false, error: 'ไม่พบชื่อผู้ใช้งานนี้ในระบบ' };
}

function handleCheckUserExists_(p) {
  if (!p.username) return { success: false, error: 'กรุณาระบุชื่อผู้ใช้งาน' };
  const sh = getSheet_(SHEET_NAMES.USERS);
  const data = sh.getDataRange().getValues();
  const header = data[0];
  const usernameCol = header.indexOf('username');
  const normUsername = normalizeUsername_(p.username);
  for (let i = 1; i < data.length; i++) {
    if (normalizeUsername_(data[i][usernameCol]) === normUsername) {
      return { success: true, exists: true };
    }
  }
  return { success: true, exists: false };
}

// ---------------------------------------------------------------------------
// OTP ทางอีเมลสำหรับ "ลืมรหัสผ่าน" — เพิ่มขึ้นเพราะเดิม handleResetPassword_ ยอมให้ตั้งรหัสผ่านใหม่ได้ทันที
// แค่รู้ username ที่มีอยู่จริง โดยไม่มีการยืนยันตัวตนเลย ซึ่งเป็นช่องทางบายพาส login lockout ได้ง่ายๆ
// (ผิดรหัสผ่านครบ 3 ครั้งโดนล็อก แต่กด "ลืมรหัสผ่าน" แล้วตั้งรหัสทับได้เลยโดยไม่ต้องรู้รหัสเดิม)
// ใช้ CacheService เก็บรหัส OTP ชั่วคราวแบบเดียวกับ session token/login lockout เพื่อให้หมดอายุอัตโนมัติ ไม่ต้องเขียนโค้ดเคลียร์เอง
// ---------------------------------------------------------------------------
const OTP_CODE_CACHE_PREFIX_ = 'PW_OTP_CODE_';
const OTP_ATTEMPTS_CACHE_PREFIX_ = 'PW_OTP_ATTEMPTS_';
const OTP_VERIFIED_CACHE_PREFIX_ = 'PW_OTP_VERIFIED_';
const OTP_TTL_SECONDS = 300; // รหัส OTP มีอายุ 5 นาที
const OTP_MAX_VERIFY_ATTEMPTS = 5; // กันเดารหัส OTP 6 หลักมั่วๆ ซ้ำๆ

// จำกัดจำนวนครั้งที่ "ขอ" OTP ต่อ username หนึ่งคน — กันคนยิงขอ OTP รัวๆ จนโควต้าส่งอีเมลของทั้งระบบ
// (MailApp ~100 ฉบับ/วันสำหรับ Gmail ฟรี) หมดเร็วเกินไป ซึ่งจะทำให้ "ทุกคน" ขอ OTP ไม่ได้เลยจนกว่าจะข้ามวัน ไม่ใช่แค่บัญชีที่โดนยิง
const OTP_REQUEST_MAX = 3;
const OTP_REQUEST_WINDOW_SECONDS = 600; // ขอได้ไม่เกิน 3 ครั้งต่อ 10 นาที
const OTP_REQUEST_LOCK_SECONDS = 600; // ถ้าเกิน ล็อกไม่ให้ขอต่ออีก 10 นาที
const OTP_REQUEST_COUNT_CACHE_PREFIX_ = 'OTP_REQ_COUNT_';
const OTP_REQUEST_LOCK_CACHE_PREFIX_ = 'OTP_REQ_LOCK_';

// เช็ค + บันทึกอัตราการขอ OTP ของ username นี้ คืนค่าจำนวนวินาทีที่เหลือถ้าโดนล็อกอยู่ (0 = ยังขอได้)
function checkAndRecordOtpRequestRate_(normUsername) {
  try {
    const cache = CacheService.getScriptCache();
    const lockKey = OTP_REQUEST_LOCK_CACHE_PREFIX_ + normUsername;
    const existingLock = cache.get(lockKey);
    if (existingLock) {
      const remaining = Math.ceil((parseInt(existingLock, 10) - Date.now()) / 1000);
      if (remaining > 0) return remaining;
    }

    const countKey = OTP_REQUEST_COUNT_CACHE_PREFIX_ + normUsername;
    const count = (parseInt(cache.get(countKey) || '0', 10) || 0) + 1;
    if (count > OTP_REQUEST_MAX) {
      cache.put(lockKey, String(Date.now() + OTP_REQUEST_LOCK_SECONDS * 1000), OTP_REQUEST_LOCK_SECONDS);
      cache.remove(countKey);
      return OTP_REQUEST_LOCK_SECONDS;
    }
    cache.put(countKey, String(count), OTP_REQUEST_WINDOW_SECONDS);
    return 0;
  } catch (e) {
    return 0; // ถ้าเช็คไม่สำเร็จ ปล่อยผ่านไปก่อน ดีกว่าทำให้ฟีเจอร์ใช้งานไม่ได้ทั้งหมด
  }
}

function generateOtpCode_() {
  return String(Math.floor(100000 + Math.random() * 900000)); // สุ่มเลข 6 หลักเสมอ (100000-999999)
}

// ปิดบังอีเมลบางส่วนก่อนโชว์ที่หน้าเว็บ เช่น "so***@gmail.com" กันคนอื่นที่ไม่ใช่เจ้าของบัญชีเดาอีเมลเต็มได้จากหน้าจอ
function maskEmail_(email) {
  const parts = String(email || '').split('@');
  if (parts.length !== 2) return email;
  const name = parts[0];
  const masked = name.length <= 2 ? (name.charAt(0) + '*') : (name.slice(0, 2) + '*'.repeat(Math.max(1, name.length - 2)));
  return masked + '@' + parts[1];
}

// ขั้นที่ 1: ผู้ใช้กรอก username แล้วขอรหัส OTP — ถ้าพบบัญชีจริงและมีอีเมลผูกไว้ จะส่งรหัส 6 หลักไปที่อีเมลนั้นทันที
function handleRequestPasswordResetOtp_(p) {
  if (!p.username) return { success: false, error: 'กรุณาระบุชื่อผู้ใช้งาน' };

  // เช็ค rate limit ก่อนเสมอ ไม่ว่า username นี้จะมีจริงในระบบหรือไม่ก็ตาม (กันใช้เป็นช่องทางเดา/ยิงรัวๆ ไปด้วย)
  const normUsernameForRate = normalizeUsername_(p.username);
  const rateLimitRemaining = checkAndRecordOtpRequestRate_(normUsernameForRate);
  if (rateLimitRemaining > 0) {
    return { success: false, error: 'ขอรหัส OTP บ่อยเกินไป กรุณารออีก ' + rateLimitRemaining + ' วินาทีก่อนขอรหัสใหม่อีกครั้ง' };
  }

  const sh = getSheet_(SHEET_NAMES.USERS);
  const emailCol = ensureColumnHeader_(sh, 'email'); // เผื่อ sheet เก่ายังไม่มีคอลัมน์นี้ (คืนเลขคอลัมน์แบบ 1-based)
  const data = sh.getDataRange().getValues();
  const header = data[0];
  const usernameCol = header.indexOf('username');
  const roleCol = header.indexOf('role');
  const normUsername = normalizeUsername_(p.username);

  for (let i = 1; i < data.length; i++) {
    if (normalizeUsername_(data[i][usernameCol]) === normUsername) {
      const email = String(data[i][emailCol - 1] || '').trim();
      if (!email) {
        return { success: false, error: 'บัญชีนี้ยังไม่มีอีเมลผูกไว้ในระบบ กรุณาติดต่อผู้ดูแลระบบ (Super_Admin) ให้ช่วยเพิ่มอีเมลหรือรีเซ็ตรหัสผ่านให้' };
      }
      const otp = generateOtpCode_();
      const cache = CacheService.getScriptCache();
      cache.put(OTP_CODE_CACHE_PREFIX_ + normUsername, otp, OTP_TTL_SECONDS);
      cache.remove(OTP_ATTEMPTS_CACHE_PREFIX_ + normUsername);
      cache.remove(OTP_VERIFIED_CACHE_PREFIX_ + normUsername);
      try {
        MailApp.sendEmail({
          to: email,
          subject: 'รหัสยืนยันตัวตนสำหรับตั้งรหัสผ่านใหม่ — Intelligent Test Data Simulator',
          body: 'รหัสยืนยัน (OTP) ของคุณคือ: ' + otp + '\n\n' +
                'รหัสนี้จะหมดอายุภายใน ' + Math.round(OTP_TTL_SECONDS / 60) + ' นาที และใช้ได้ครั้งเดียวเท่านั้น\n' +
                'ถ้าคุณไม่ได้เป็นผู้ขอตั้งรหัสผ่านใหม่ กรุณาละเว้นอีเมลฉบับนี้ (บัญชีของคุณยังปลอดภัยดี)'
        });
      } catch (e) {
        return { success: false, error: 'ส่งอีเมลไม่สำเร็จ: ' + e.message };
      }
      logActivity_(data[i][usernameCol], data[i][roleCol], 'PASSWORD_RESET_OTP_SENT', 'ส่งรหัส OTP สำหรับตั้งรหัสผ่านใหม่ไปที่อีเมลที่ผูกไว้แล้ว');
      return { success: true, maskedEmail: maskEmail_(email) };
    }
  }
  return { success: false, error: 'ไม่พบชื่อผู้ใช้งานนี้ในระบบ' };
}

// ขั้นที่ 2: ผู้ใช้กรอกรหัส OTP ที่ได้รับทางอีเมลกลับมายืนยัน — ถูกต้องแล้วจะปลดล็อกให้ตั้งรหัสผ่านใหม่ได้ในขั้นถัดไป (ใช้ได้ครั้งเดียว)
function handleVerifyPasswordResetOtp_(p) {
  if (!p.username || !p.otp) return { success: false, error: 'กรุณาระบุรหัส OTP' };
  const normUsername = normalizeUsername_(p.username);
  const cache = CacheService.getScriptCache();
  const codeKey = OTP_CODE_CACHE_PREFIX_ + normUsername;
  const attemptsKey = OTP_ATTEMPTS_CACHE_PREFIX_ + normUsername;
  const storedCode = cache.get(codeKey);

  if (!storedCode) {
    return { success: false, error: 'รหัส OTP หมดอายุหรือยังไม่ได้ขอรหัส กรุณากดปุ่ม "ขอรหัสใหม่" ที่หน้านี้เพื่อขอรหัสใหม่อีกครั้ง' };
  }

  if (String(p.otp).trim() !== storedCode) {
    const attempts = (parseInt(cache.get(attemptsKey) || '0', 10) || 0) + 1;
    if (attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
      cache.remove(codeKey);
      cache.remove(attemptsKey);
      return { success: false, error: 'กรอกรหัส OTP ผิดเกินจำนวนที่กำหนด กรุณากดขอรหัสใหม่อีกครั้ง' };
    }
    cache.put(attemptsKey, String(attempts), OTP_TTL_SECONDS);
    return { success: false, error: 'รหัส OTP ไม่ถูกต้อง (เหลือโอกาสอีก ' + (OTP_MAX_VERIFY_ATTEMPTS - attempts) + ' ครั้งก่อนต้องขอรหัสใหม่)' };
  }

  // ถูกต้อง — เผารหัสทิ้งทันที (ใช้ครั้งเดียว) แล้วออกใบอนุญาตชั่วคราวให้ตั้งรหัสผ่านใหม่ได้ในขั้นถัดไป
  cache.remove(codeKey);
  cache.remove(attemptsKey);
  cache.put(OTP_VERIFIED_CACHE_PREFIX_ + normUsername, '1', OTP_TTL_SECONDS);
  return { success: true };
}

// ขั้นที่ 3: ตั้งรหัสผ่านใหม่จริง — ต้องผ่านการยืนยัน OTP ทางอีเมล (ขั้นที่ 2) มาก่อนเสมอ ถึงจะทำสำเร็จ
// นี่คือจุดที่ปิดช่องบายพาส login lockout เดิม เพราะแค่รู้ username เฉยๆ ตั้งรหัสผ่านทับไม่ได้อีกต่อไป
function handleResetPassword_(p) {
  if (!p.username || !p.newPassword) {
    return { success: false, error: 'ข้อมูลสำหรับตั้งรหัสผ่านใหม่ไม่ครบถ้วน' };
  }
  const normUsername = normalizeUsername_(p.username);
  const cache = CacheService.getScriptCache();
  const verifiedKey = OTP_VERIFIED_CACHE_PREFIX_ + normUsername;
  if (cache.get(verifiedKey) !== '1') {
    return { success: false, error: 'กรุณายืนยันรหัส OTP ที่ส่งไปยังอีเมลให้เรียบร้อยก่อนตั้งรหัสผ่านใหม่ (ถ้ารหัสหมดอายุแล้ว กรุณากด "ลืมรหัสผ่าน" เพื่อขอรหัสใหม่)' };
  }

  const sh = getSheet_(SHEET_NAMES.USERS);
  const data = sh.getDataRange().getValues();
  const header = data[0];
  const idx = {
    username: header.indexOf('username'),
    salt: header.indexOf('salt'),
    hash: header.indexOf('password_hash'),
    role: header.indexOf('role')
  };

  for (let i = 1; i < data.length; i++) {
    if (normalizeUsername_(data[i][idx.username]) === normUsername) {
      // กันตั้งรหัสผ่านใหม่ซ้ำกับรหัสผ่านเดิม (เทียบด้วย salt เดิมก่อนสร้าง salt ใหม่) — ถือเป็นสุขอนามัยความปลอดภัยพื้นฐาน ไม่ใช่แค่ยอมให้ตั้งซ้ำแบบขอไปที
      const sameAsOldHash = hashPassword_(p.newPassword, data[i][idx.salt]);
      if (sameAsOldHash === data[i][idx.hash]) {
        return { success: false, error: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม กรุณาตั้งรหัสผ่านใหม่ที่แตกต่างออกไป' };
      }
      const newSalt = generateSalt_();
      const newHash = hashPassword_(p.newPassword, newSalt);
      sh.getRange(i + 1, idx.salt + 1).setValue(newSalt);
      sh.getRange(i + 1, idx.hash + 1).setValue(newHash);
      cache.remove(verifiedKey); // ใบอนุญาตใช้ได้ครั้งเดียว
      clearLoginFailures_(normUsername); // ยืนยันตัวตนผ่าน OTP จริงแล้ว ปลดล็อก login lockout ที่อาจติดค้างอยู่ให้ไปด้วยเลย
      logActivity_(data[i][idx.username], data[i][idx.role], 'RESET_PASSWORD', 'ตั้งรหัสผ่านใหม่สำเร็จผ่านหน้ากู้คืนรหัสผ่าน (ยืนยันตัวตนด้วย OTP ทางอีเมลแล้ว)');
      return { success: true };
    }
  }
  return { success: false, error: 'ไม่พบชื่อผู้ใช้งานนี้ในระบบ' };
}

// เปลี่ยนรหัสผ่านของตัวเองระหว่าง login อยู่ (ต่างจาก handleResetPassword_ ตรงที่ต้องยืนยันรหัสผ่านเดิมก่อนเสมอ ไม่ใช่แค่ยืนยันตัวตนผ่านชื่อผู้ใช้งานอย่างเดียวเหมือนหน้าลืมรหัสผ่าน)
function handleChangeOwnPassword_(p) {
  if (!p.username || !p.currentPassword || !p.newPassword) {
    return { success: false, error: 'ข้อมูลสำหรับเปลี่ยนรหัสผ่านไม่ครบถ้วน' };
  }
  const sh = getSheet_(SHEET_NAMES.USERS);
  const data = sh.getDataRange().getValues();
  const header = data[0];
  const idx = {
    username: header.indexOf('username'),
    salt: header.indexOf('salt'),
    hash: header.indexOf('password_hash'),
    role: header.indexOf('role')
  };
  const normUsername = normalizeUsername_(p.username);

  for (let i = 1; i < data.length; i++) {
    if (normalizeUsername_(data[i][idx.username]) === normUsername) {
      const computedCurrent = hashPassword_(p.currentPassword, data[i][idx.salt]);
      if (computedCurrent !== data[i][idx.hash]) {
        logActivity_(data[i][idx.username], data[i][idx.role], 'CHANGE_PASSWORD_FAIL', 'เปลี่ยนรหัสผ่านของตัวเองไม่สำเร็จ (รหัสผ่านปัจจุบันไม่ถูกต้อง)');
        return { success: false, error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' };
      }
      // กันตั้งรหัสผ่านใหม่ซ้ำกับรหัสผ่านเดิม (เทียบด้วย salt เดิมก่อนสร้าง salt ใหม่) — ให้สอดคล้องกับ handleResetPassword_
      const sameAsOldHash = hashPassword_(p.newPassword, data[i][idx.salt]);
      if (sameAsOldHash === data[i][idx.hash]) {
        logActivity_(data[i][idx.username], data[i][idx.role], 'CHANGE_PASSWORD_FAIL', 'เปลี่ยนรหัสผ่านของตัวเองไม่สำเร็จ (รหัสผ่านใหม่ซ้ำกับรหัสผ่านเดิม)');
        return { success: false, error: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม กรุณาตั้งรหัสผ่านใหม่ที่แตกต่างออกไป' };
      }
      const newSalt = generateSalt_();
      const newHash = hashPassword_(p.newPassword, newSalt);
      sh.getRange(i + 1, idx.salt + 1).setValue(newSalt);
      sh.getRange(i + 1, idx.hash + 1).setValue(newHash);
      logActivity_(data[i][idx.username], data[i][idx.role], 'CHANGE_PASSWORD', 'เปลี่ยนรหัสผ่านของตัวเองสำเร็จ (ขณะ login อยู่)');
      return { success: true };
    }
  }
  return { success: false, error: 'ไม่พบชื่อผู้ใช้งานนี้ในระบบ' };
}

// ---------------------------------------------------------------------------
// ขอให้ลบบัญชีตัวเอง (self-service, ไม่ลบทันที) — ผู้ใช้ทั่วไปกดขอเองได้ แต่ไม่ลบให้อัตโนมัติ
// ตั้งใจให้เป็นแค่ "คำขอ" ไม่ใช่ "ลบทันที" เพื่อกันกดพลาด/กันคนร้ายลบบัญชีตัวเองปิดร่องรอยหลังทำอะไรผิดไว้
// Super_Admin ยังต้องเป็นคนกดลบจริงผ่านแผงจัดการผู้ใช้งานเดิม (handleDeleteUser_) เหมือนเดิมทุกอย่าง
// ---------------------------------------------------------------------------
const DELETE_ACCOUNT_REQUEST_COOLDOWN_SECONDS = 86400; // จำกัด 1 คำขอ/24 ชม. ต่อคน กันสแปมคำขอรัวๆ
const DELETE_ACCOUNT_REQUEST_CACHE_PREFIX_ = 'DELETE_ACCOUNT_REQUEST_';

// รวบรวมอีเมลของผู้ใช้ role Super_Admin ทุกคนที่มีอีเมลผูกไว้แล้ว (ใช้แจ้งคำขอลบบัญชีเข้าอีเมลผู้ดูแลระบบ)
function getSuperAdminEmails_() {
  const sh = getSheet_(SHEET_NAMES.USERS);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  const lastCol = sh.getLastColumn();
  const header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const roleCol = header.indexOf('role');
  const emailCol = header.indexOf('email');
  const approvalStatusCol = header.indexOf('approval_status');
  if (roleCol === -1 || emailCol === -1) return [];
  const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const emails = [];
  data.forEach(function (row) {
    // ข้ามคำขอสมัคร Super_Admin ที่ยังรออนุมัติอยู่ (approval_status === 'pending') — บัญชีนี้ยัง login ไม่ได้และยังทำหน้าที่ Super_Admin จริงไม่ได้เลย ไม่ควรได้รับอีเมลแจ้งคำขอลบบัญชีของคนอื่น
    const approvalStatus = approvalStatusCol !== -1 ? row[approvalStatusCol] : '';
    if (row[roleCol] === 'Super_Admin' && approvalStatus !== 'pending') {
      const email = String(row[emailCol] || '').trim();
      if (email) emails.push(email);
    }
  });
  return emails;
}

// อีเมลของ Super Admin หลักของระบบเท่านั้น (PRIMARY_SUPER_ADMIN_USERNAME) — ใช้แจ้งคำขอสมัคร role Super_Admin ใหม่ ต่างจาก getSuperAdminEmails_ ที่ส่งให้ Super_Admin ทุกคน
function getPrimarySuperAdminEmail_() {
  const sh = getSheet_(SHEET_NAMES.USERS);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return '';
  const lastCol = sh.getLastColumn();
  const header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const usernameCol = header.indexOf('username');
  const emailCol = header.indexOf('email');
  if (usernameCol === -1 || emailCol === -1) return '';
  const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const normPrimary = normalizeUsername_(PRIMARY_SUPER_ADMIN_USERNAME);
  for (let i = 0; i < data.length; i++) {
    if (normalizeUsername_(data[i][usernameCol]) === normPrimary) {
      return String(data[i][emailCol] || '').trim();
    }
  }
  return '';
}

function handleRequestDeleteAccount_(p) {
  if (!p.username) {
    return { success: false, error: 'ไม่พบชื่อผู้ใช้งาน' };
  }
  const sh = getSheet_(SHEET_NAMES.USERS);
  ensureColumnHeader_(sh, 'delete_requested_at'); // ต้องเรียกก่อน getDataRange() เสมอ ไม่งั้น snapshot ข้อมูลที่อ่านมาจะไม่มีคอลัมน์นี้รวมอยู่
  const data = sh.getDataRange().getValues();
  const header = data[0];
  const idx = {
    username: header.indexOf('username'),
    role: header.indexOf('role'),
    fullName: header.indexOf('full_name'),
    deleteRequestedAt: header.indexOf('delete_requested_at')
  };
  const normUsername = normalizeUsername_(p.username);

  let foundRowIndex = -1; // 0-based index ใน data[] (แถวจริงในชีตคือ +1 เสมอ)
  for (let i = 1; i < data.length; i++) {
    if (normalizeUsername_(data[i][idx.username]) === normUsername) {
      foundRowIndex = i;
      break;
    }
  }
  if (foundRowIndex === -1) {
    return { success: false, error: 'ไม่พบชื่อผู้ใช้งานนี้ในระบบ' };
  }
  const found = data[foundRowIndex];
  const displayUsername = found[idx.username];
  const role = found[idx.role];
  const fullName = idx.fullName !== -1 ? String(found[idx.fullName] || '').trim() : '';

  // Super_Admin หลักของระบบ (ดู PRIMARY_SUPER_ADMIN_USERNAME) ห้ามส่งคำขอลบบัญชีตัวเองได้เด็ดขาด — บัญชีนี้ต้องมีอยู่เสมอเพื่อดูแลระบบ/อนุมัติ Super_Admin ใหม่
  if (normalizeUsername_(displayUsername) === normalizeUsername_(PRIMARY_SUPER_ADMIN_USERNAME)) {
    return { success: false, error: 'บัญชี Super Admin หลักของระบบ ("' + PRIMARY_SUPER_ADMIN_USERNAME + '") ไม่สามารถส่งคำขอลบบัญชีตัวเองได้ เนื่องจากต้องมีอยู่เสมอเพื่อดูแลระบบ' };
  }

  // ถ้ามีคำขอที่ยัง "รอดำเนินการ" อยู่แล้วจริงๆ (Super_Admin ยังไม่ได้ลบ/ยกเลิกคำขอ) ปฏิเสธทันทีโดยไม่ต้องรอ cooldown หมดอายุ
  if (idx.deleteRequestedAt !== -1 && found[idx.deleteRequestedAt]) {
    return { success: false, error: 'คุณมีคำขอลบบัญชีที่ส่งไปแล้วและยังรอผู้ดูแลระบบดำเนินการอยู่ ไม่ต้องส่งซ้ำ' };
  }

  const cache = CacheService.getScriptCache();
  const cacheKey = DELETE_ACCOUNT_REQUEST_CACHE_PREFIX_ + normUsername;
  if (cache.get(cacheKey)) {
    return { success: false, error: 'คุณเพิ่งส่งคำขอลบบัญชีไปแล้วเมื่อไม่นานนี้ กรุณารอให้ผู้ดูแลระบบดำเนินการ หรือลองใหม่อีกครั้งในภายหลัง' };
  }
  cache.put(cacheKey, '1', DELETE_ACCOUNT_REQUEST_COOLDOWN_SECONDS);

  // บันทึกเวลาไว้ในคอลัมน์ delete_requested_at ของแถวนั้นจริง เพื่อให้แผงจัดการผู้ใช้งานของ Super_Admin แสดงรายชื่อผู้ที่รอดำเนินการได้ตรงๆ ไม่ต้องไปไล่หาใน ActivityLogs เอง
  if (idx.deleteRequestedAt !== -1) {
    sh.getRange(foundRowIndex + 1, idx.deleteRequestedAt + 1).setValue(new Date());
  }

  logActivity_(displayUsername, role, 'REQUEST_DELETE_ACCOUNT', 'ผู้ใช้งานส่งคำขอให้ลบบัญชีของตัวเองออกจากระบบ (รอผู้ดูแลระบบดำเนินการผ่านแผงจัดการผู้ใช้งาน)');

  // แจ้งอีเมล Super_Admin ทุกคนที่มีอีเมลผูกไว้ — ส่งอีเมลไม่สำเร็จก็ไม่ควรทำให้คำขอทั้งหมดล้มเหลว แค่บันทึก log เพิ่มไว้
  try {
    const adminEmails = getSuperAdminEmails_();
    if (adminEmails.length) {
      MailApp.sendEmail({
        to: adminEmails.join(','),
        subject: 'คำขอลบบัญชีผู้ใช้งาน — Intelligent Test Data Simulator',
        body: 'ผู้ใช้งาน "' + displayUsername + '"' + (fullName ? ' (' + fullName + ')' : '') + ' (บทบาท: ' + role + ') ได้ส่งคำขอให้ลบบัญชีของตัวเองออกจากระบบ\n\n' +
              'กรุณาเข้าไปที่แผงจัดการผู้ใช้งาน (🛡️ จัดการผู้ใช้งาน) บนหน้าเว็บ เพื่อตรวจสอบและลบบัญชีนี้เองหากต้องการดำเนินการตามคำขอ\n\n' +
              'หมายเหตุ: อีเมลนี้เป็นแค่คำขอ ระบบไม่ได้ลบบัญชีให้อัตโนมัติ ต้องให้ผู้ดูแลระบบกดลบเองเท่านั้น'
      });
    }
  } catch (e) {
    try { logActivity_(displayUsername, role, 'REQUEST_DELETE_ACCOUNT_EMAIL_FAIL', 'ส่งอีเมลแจ้ง Super_Admin เรื่องคำขอลบบัญชีไม่สำเร็จ: ' + e.message); } catch (e2) { /* ข้ามได้ */ }
  }

  return { success: true };
}

function handleLogout_(p) {
  logActivity_(p.username, p.role, 'LOGOUT', 'ออกจากระบบสำเร็จ');
  // ล้าง session token ทิ้งทันทีถ้าหน้าเว็บส่งมาด้วย (ไม่บังคับ — ถ้าไม่มีก็ข้ามได้ ไม่กระทบ logout ปกติ)
  if (p.token) invalidateSessionToken_(p.token);
  return { success: true };
}

// ---------------------------------------------------------------------------
// แผงจัดการผู้ใช้งาน (เฉพาะ Super_Admin) — ดู/ลบ user คนอื่น และรีเซ็ตรหัสผ่านคนอื่นจากหน้าเว็บ
// สำคัญ: ต้องตรวจสิทธิ์จริงจากข้อมูล role ที่เก็บไว้ใน Sheet เสมอ (ห้ามเชื่อ role ที่ฝั่งหน้าเว็บส่งมาตรงๆ เพราะปลอมแปลงได้)
// ---------------------------------------------------------------------------
function isSuperAdmin_(username) {
  if (!username) return false;
  const sh = getSheet_(SHEET_NAMES.USERS);
  const data = sh.getDataRange().getValues();
  const header = data[0];
  const usernameCol = header.indexOf('username');
  const roleCol = header.indexOf('role');
  const approvalStatusCol = header.indexOf('approval_status');
  const normUsername = normalizeUsername_(username);
  for (let i = 1; i < data.length; i++) {
    if (normalizeUsername_(data[i][usernameCol]) === normUsername) {
      // สำคัญ: คำขอสมัคร Super_Admin ที่ยังรออนุมัติ (approval_status = 'pending') ต้องไม่นับว่าเป็น Super_Admin
      // ที่ใช้งานได้ แม้ role จะถูกตั้งเป็น 'Super_Admin' ไว้ตั้งแต่ตอนสมัครแล้วก็ตาม เพื่อกันไม่ให้ผู้สมัครที่ยังไม่ได้รับอนุมัติ
      // (ซึ่ง login ปกติเข้าไม่ได้อยู่แล้ว) เรียก action ที่สงวนไว้เฉพาะ Super_Admin ได้โดยตรงผ่านการยิง request เอง
      const approvalStatus = approvalStatusCol !== -1 ? data[i][approvalStatusCol] : '';
      return data[i][roleCol] === 'Super_Admin' && approvalStatus !== 'pending';
    }
  }
  return false;
}

// เช็คว่า username ที่ระบุคือ Super Admin "หลัก" ของระบบหรือไม่ (เทียบกับ PRIMARY_SUPER_ADMIN_USERNAME แบบ normalize เสมอ)
// ใช้เฉพาะจุดที่ต้องจำกัดสิทธิ์ให้แคบกว่า isSuperAdmin_ ทั่วไป เช่น การอนุมัติ/ปฏิเสธคำขอสมัคร Super_Admin ใหม่
function isPrimarySuperAdmin_(username) {
  return !!username && normalizeUsername_(username) === normalizeUsername_(PRIMARY_SUPER_ADMIN_USERNAME);
}

// รายชื่อผู้ใช้งานทั้งหมด (ไม่ส่ง salt/password_hash กลับไปเด็ดขาด) ให้เฉพาะ Super_Admin เรียกดูได้
function handleGetAllUsers_(p) {
  if (!isSuperAdmin_(p.requestingUsername)) {
    return { success: false, error: 'ไม่มีสิทธิ์เข้าถึงส่วนนี้ (เฉพาะ Super_Admin เท่านั้น)' };
  }
  const sh = getSheet_(SHEET_NAMES.USERS);
  ensureColumnHeader_(sh, 'email'); // เผื่อ sheet เก่ายังไม่มีคอลัมน์นี้ ให้ Super_Admin เห็น/จัดการอีเมลของผู้ใช้ทุกคนได้
  ensureColumnHeader_(sh, 'full_name'); // เผื่อ sheet เก่ายังไม่มีคอลัมน์นี้ (user ที่สมัครไว้ก่อนฟีเจอร์นี้จะเห็นเป็นค่าว่าง ไม่ถือเป็น error)
  ensureColumnHeader_(sh, 'department');
  ensureColumnHeader_(sh, 'delete_requested_at'); // เผื่อ sheet เก่ายังไม่มีคอลัมน์นี้ ให้ Super_Admin เห็นคิวคำขอลบบัญชีที่รอดำเนินการได้ตรงในตาราง
  ensureColumnHeader_(sh, 'approval_status'); // เผื่อ sheet เก่ายังไม่มีคอลัมน์นี้ ให้ Super Admin หลักเห็นคิวคำขอสมัคร Super_Admin ที่รออนุมัติได้ตรงในตาราง
  const data = sh.getDataRange().getValues();
  const header = data[0];
  const idx = { username: header.indexOf('username'), role: header.indexOf('role'), createdAt: header.indexOf('created_at'), email: header.indexOf('email'), fullName: header.indexOf('full_name'), department: header.indexOf('department'), deleteRequestedAt: header.indexOf('delete_requested_at'), approvalStatus: header.indexOf('approval_status') };
  const tz = Session.getScriptTimeZone();

  const users = [];
  for (let i = 1; i < data.length; i++) {
    let createdAt = data[i][idx.createdAt];
    if (createdAt instanceof Date) createdAt = Utilities.formatDate(createdAt, tz, 'yyyy-MM-dd HH:mm:ss');
    let deleteRequestedAt = idx.deleteRequestedAt !== -1 ? data[i][idx.deleteRequestedAt] : '';
    if (deleteRequestedAt instanceof Date) deleteRequestedAt = Utilities.formatDate(deleteRequestedAt, tz, 'yyyy-MM-dd HH:mm:ss');
    const approvalStatus = idx.approvalStatus !== -1 ? String(data[i][idx.approvalStatus] || '') : '';
    users.push({
      username: data[i][idx.username],
      role: data[i][idx.role],
      createdAt: createdAt,
      email: (idx.email !== -1 ? (data[i][idx.email] || '') : ''),
      fullName: (idx.fullName !== -1 ? (data[i][idx.fullName] || '') : ''),
      department: (idx.department !== -1 ? (data[i][idx.department] || '') : ''),
      deleteRequestedAt: deleteRequestedAt || '',
      approvalStatus: approvalStatus // '' = อนุมัติแล้ว/ไม่ต้องอนุมัติ, 'pending' = รอ Super Admin หลักอนุมัติ (สมัคร role Super_Admin เท่านั้น)
    });
  }
  // เรียงให้ผู้ที่มีคำขอลบบัญชีค้าง หรือคำขอสมัคร Super_Admin ที่รออนุมัติ ขึ้นก่อนเสมอ เพื่อให้ Super_Admin เห็นและจัดการได้ทันทีโดยไม่ต้องไล่หาในตาราง
  users.sort(function (a, b) {
    const aPending = (a.deleteRequestedAt || a.approvalStatus === 'pending') ? 1 : 0;
    const bPending = (b.deleteRequestedAt || b.approvalStatus === 'pending') ? 1 : 0;
    return bPending - aPending;
  });
  return { success: true, users: users };
}

// ล้าง cache ทุกตัวที่ผูกกับ username เดิม (login lockout, OTP, คำขอลบบัญชี ฯลฯ) — ต้องเรียกทุกครั้งที่ลบบัญชีออกจากระบบจริง
// (ทั้งผ่านปุ่ม "ลบ" ธรรมดา และปุ่ม "❌ ปฏิเสธ" คำขอสมัคร Super_Admin) กันบั๊ก: ถ้ามีคนสมัคร username เดิมซ้ำหลังบัญชีเก่าถูกลบไปแล้ว
// จะไม่โดน cache เก่าของบัญชีที่ถูกลบไปแล้วเล่นงาน เช่น ขึ้น error "เพิ่งส่งคำขอลบบัญชีไปแล้ว" ทั้งที่บัญชีปัจจุบันเพิ่งสมัครใหม่และไม่เคยส่งคำขอเลย
function clearUserScopedCaches_(username) {
  const normUsername = normalizeUsername_(username);
  try {
    const cache = CacheService.getScriptCache();
    [
      LOGIN_FAIL_CACHE_PREFIX_,
      LOGIN_LOCK_CACHE_PREFIX_,
      LOCKOUT_NOTIFY_CACHE_PREFIX_,
      OTP_CODE_CACHE_PREFIX_,
      OTP_ATTEMPTS_CACHE_PREFIX_,
      OTP_VERIFIED_CACHE_PREFIX_,
      OTP_REQUEST_COUNT_CACHE_PREFIX_,
      OTP_REQUEST_LOCK_CACHE_PREFIX_,
      DELETE_ACCOUNT_REQUEST_CACHE_PREFIX_
    ].forEach(function (prefix) {
      cache.remove(prefix + normUsername);
    });
  } catch (e) {
    // ล้าง cache ไม่สำเร็จ ไม่ควรทำให้การลบบัญชีล้มเหลวไปด้วย ข้ามได้เงียบๆ
  }
}

// ลบผู้ใช้งานออกจากระบบ — กันลบตัวเองขณะล็อกอินอยู่ และกันลบ Super_Admin คนสุดท้าย (จะไม่มีใครเข้ามาจัดการระบบต่อได้อีก)
function handleDeleteUser_(p) {
  if (!isSuperAdmin_(p.requestingUsername)) {
    return { success: false, error: 'ไม่มีสิทธิ์เข้าถึงส่วนนี้ (เฉพาะ Super_Admin เท่านั้น)' };
  }
  if (!p.targetUsername) return { success: false, error: 'กรุณาระบุชื่อผู้ใช้งานที่จะลบ' };

  const normTarget = normalizeUsername_(p.targetUsername);
  const normRequester = normalizeUsername_(p.requestingUsername);
  if (normTarget === normRequester) {
    return { success: false, error: 'ไม่สามารถลบบัญชีของตัวเองขณะที่ล็อกอินอยู่ได้' };
  }
  // Super Admin หลักของระบบ (PRIMARY_SUPER_ADMIN_USERNAME) ห้ามถูกลบเด็ดขาด ไม่ว่าใครจะเป็นคนกด (แม้แต่ Super_Admin คนอื่น)
  // เพราะสิทธิ์อนุมัติคำขอสมัคร Super_Admin ใหม่ผูกกับ username นี้ตรงๆ ถ้าถูกลบไปจะไม่มีใครอนุมัติคำขอใหม่ได้อีกเลย
  if (isPrimarySuperAdmin_(p.targetUsername)) {
    return { success: false, error: 'ไม่สามารถลบบัญชี Super Admin หลักของระบบ ("' + PRIMARY_SUPER_ADMIN_USERNAME + '") ได้ เนื่องจากต้องมีอยู่เสมอเพื่อดูแลระบบและอนุมัติ Super_Admin ใหม่' };
  }

  const sh = getSheet_(SHEET_NAMES.USERS);
  ensureColumnHeader_(sh, 'approval_status'); // เผื่อ sheet เก่ายังไม่มีคอลัมน์นี้ — ใช้กันไม่ให้ลบคำขอสมัคร Super_Admin ที่รออนุมัติผ่านปุ่ม "ลบ" ธรรมดา
  ensureColumnHeader_(sh, 'delete_requested_at'); // เผื่อ sheet เก่ายังไม่มีคอลัมน์นี้ — ใช้เช็คว่าการลบครั้งนี้เป็นการทำตามคำขอ "ขอลบบัญชี" ของเจ้าของบัญชีเองหรือไม่ (ถ้าใช่ต้องส่งอีเมลแจ้งด้วย)
  ensureColumnHeader_(sh, 'email');
  const data = sh.getDataRange().getValues();
  const header = data[0];
  const usernameCol = header.indexOf('username');
  const roleCol = header.indexOf('role');
  const approvalStatusCol = header.indexOf('approval_status');
  const deleteRequestedAtCol = header.indexOf('delete_requested_at');
  const emailCol = header.indexOf('email');

  let targetRowIndex = -1;
  let targetRole = '';
  let targetApprovalStatus = '';
  let targetHadDeleteRequest = false;
  let targetEmail = '';
  let superAdminCount = 0; // นับเฉพาะ Super_Admin ที่อนุมัติแล้ว/ใช้งานได้จริง ไม่นับคำขอสมัครที่ยังรออนุมัติอยู่ (login ไม่ได้ ทำหน้าที่ Super_Admin จริงไม่ได้เลย)
  for (let i = 1; i < data.length; i++) {
    const rowApprovalStatus = approvalStatusCol !== -1 ? data[i][approvalStatusCol] : '';
    if (data[i][roleCol] === 'Super_Admin' && rowApprovalStatus !== 'pending') superAdminCount++;
    if (normalizeUsername_(data[i][usernameCol]) === normTarget) {
      targetRowIndex = i;
      targetRole = data[i][roleCol];
      targetApprovalStatus = rowApprovalStatus;
      targetHadDeleteRequest = deleteRequestedAtCol !== -1 && !!data[i][deleteRequestedAtCol];
      targetEmail = emailCol !== -1 ? String(data[i][emailCol] || '').trim() : '';
    }
  }
  if (targetRowIndex === -1) return { success: false, error: 'ไม่พบชื่อผู้ใช้งานนี้ในระบบ' };
  if (targetRole === 'Super_Admin' && targetApprovalStatus !== 'pending' && superAdminCount <= 1) {
    return { success: false, error: 'ไม่สามารถลบ Super_Admin คนสุดท้ายในระบบได้ (จะไม่มีใครเข้าจัดการระบบได้อีก)' };
  }
  // คำขอสมัคร Super_Admin ที่ยังรออนุมัติ ต้องผ่านปุ่ม "❌ ปฏิเสธ" เท่านั้น (ไม่ใช่ปุ่ม "ลบ" ธรรมดา) เพราะปฏิเสธจะส่งอีเมลแจ้งผู้สมัครและบันทึก log ที่ถูกต้องให้ด้วยเสมอ
  if (targetApprovalStatus === 'pending') {
    return { success: false, error: 'ผู้ใช้งานนี้เป็นคำขอสมัคร Super_Admin ที่ยังรออนุมัติอยู่ กรุณาใช้ปุ่ม "❌ ปฏิเสธ" แทน (จะลบบัญชีพร้อมส่งอีเมลแจ้งผู้สมัครให้ถูกต้อง)' };
  }

  sh.deleteRow(targetRowIndex + 1);
  clearUserScopedCaches_(p.targetUsername); // กันบั๊ก username เดิมถูกสมัครใหม่แล้วโดน cache ของบัญชีเก่าที่เพิ่งลบไปเล่นงาน (เช่น cooldown คำขอลบบัญชี)
  logActivity_(p.requestingUsername, 'Super_Admin', 'DELETE_USER', 'ลบผู้ใช้งาน "' + p.targetUsername + '" (role เดิม: ' + targetRole + ') ออกจากระบบผ่านแผงจัดการผู้ใช้งาน' + (targetHadDeleteRequest ? ' (ตามคำขอ "ขอลบบัญชี" ที่เจ้าของบัญชีส่งมาเอง)' : ''));

  // ถ้าเป็นการลบตามคำขอ "ขอลบบัญชี" ของเจ้าของบัญชีเอง (ไม่ใช่แค่ Super_Admin ลบเหตุผลอื่น) ต้องส่งอีเมลแจ้งผลด้วยเสมอ — ส่งอีเมลไม่สำเร็จก็ไม่ควรทำให้การลบทั้งหมดล้มเหลว แค่บันทึก log เพิ่มไว้
  if (targetHadDeleteRequest && targetEmail) {
    try {
      MailApp.sendEmail({
        to: targetEmail,
        subject: 'คำขอลบบัญชีของคุณได้รับการดำเนินการแล้ว — Intelligent Test Data Simulator',
        body: 'คำขอ "ขอลบบัญชี" ที่คุณส่งมาสำหรับชื่อผู้ใช้งาน "' + p.targetUsername + '" ได้รับการอนุมัติจากผู้ดูแลระบบแล้ว บัญชีนี้ถูกลบออกจากระบบเรียบร้อยแล้ว (username/password ที่เคยใช้ก็ถูกลบไปด้วย)\n\n' +
              'หากต้องการใช้งานระบบอีกครั้งในอนาคต สามารถสมัครสมาชิกใหม่ได้ทุกเมื่อ'
      });
    } catch (e) {
      try { logActivity_(p.requestingUsername, 'Super_Admin', 'DELETE_USER_EMAIL_FAIL', 'ส่งอีเมลแจ้งผลคำขอลบบัญชีให้ "' + p.targetUsername + '" ไม่สำเร็จ: ' + e.message); } catch (e2) { /* ข้ามได้ */ }
    }
  }
  return { success: true };
}

// ยกเลิกคำขอลบบัญชี (ล้างค่า delete_requested_at) โดยไม่ลบผู้ใช้งานออกจากระบบ — ใช้เมื่อ Super_Admin พิจารณาแล้วว่าไม่ควรลบ หรือคุยกับเจ้าของบัญชีแล้วยกเลิกคำขอ
function handleDismissDeleteAccountRequest_(p) {
  if (!isSuperAdmin_(p.requestingUsername)) {
    return { success: false, error: 'ไม่มีสิทธิ์เข้าถึงส่วนนี้ (เฉพาะ Super_Admin เท่านั้น)' };
  }
  if (!p.targetUsername) return { success: false, error: 'กรุณาระบุชื่อผู้ใช้งาน' };

  const sh = getSheet_(SHEET_NAMES.USERS);
  ensureColumnHeader_(sh, 'delete_requested_at');
  ensureColumnHeader_(sh, 'email');
  const data = sh.getDataRange().getValues();
  const header = data[0];
  const idx = { username: header.indexOf('username'), role: header.indexOf('role'), deleteRequestedAt: header.indexOf('delete_requested_at'), email: header.indexOf('email') };
  const normTarget = normalizeUsername_(p.targetUsername);

  let targetRowIndex = -1;
  let targetRole = '';
  let targetEmail = '';
  for (let i = 1; i < data.length; i++) {
    if (normalizeUsername_(data[i][idx.username]) === normTarget) {
      targetRowIndex = i;
      targetRole = data[i][idx.role];
      targetEmail = idx.email !== -1 ? String(data[i][idx.email] || '').trim() : '';
      break;
    }
  }
  if (targetRowIndex === -1) return { success: false, error: 'ไม่พบชื่อผู้ใช้งานนี้ในระบบ' };
  if (idx.deleteRequestedAt === -1 || !data[targetRowIndex][idx.deleteRequestedAt]) {
    return { success: false, error: 'ผู้ใช้งานนี้ไม่มีคำขอลบบัญชีที่รอดำเนินการอยู่' };
  }

  sh.getRange(targetRowIndex + 1, idx.deleteRequestedAt + 1).clearContent();
  // ล้าง cooldown cache ด้วย เพื่อให้เจ้าของบัญชีส่งคำขอใหม่ได้ทันทีถ้าจำเป็น แทนที่จะต้องรอครบ 24 ชม. จากคำขอเดิมที่ถูกยกเลิกไปแล้ว
  try {
    CacheService.getScriptCache().remove(DELETE_ACCOUNT_REQUEST_CACHE_PREFIX_ + normTarget);
  } catch (e) { /* ไม่ critical ถ้าล้าง cache ไม่สำเร็จ */ }

  logActivity_(p.requestingUsername, 'Super_Admin', 'DISMISS_DELETE_ACCOUNT_REQUEST', 'ยกเลิกคำขอลบบัญชีของผู้ใช้งาน "' + p.targetUsername + '" (role: ' + targetRole + ') โดยไม่ลบบัญชี');

  // แจ้งเจ้าของบัญชีทางอีเมลว่าคำขอถูกปฏิเสธ/ยกเลิก บัญชียังอยู่ตามปกติ — ส่งอีเมลไม่สำเร็จก็ไม่ควรทำให้การยกเลิกคำขอล้มเหลว แค่บันทึก log เพิ่มไว้
  if (targetEmail) {
    try {
      MailApp.sendEmail({
        to: targetEmail,
        subject: 'คำขอลบบัญชีของคุณถูกยกเลิก — Intelligent Test Data Simulator',
        body: 'คำขอ "ขอลบบัญชี" ที่คุณส่งมาสำหรับชื่อผู้ใช้งาน "' + p.targetUsername + '" ถูกผู้ดูแลระบบยกเลิก บัญชีของคุณยังคงอยู่และใช้งานได้ตามปกติ ไม่ได้ถูกลบแต่อย่างใด\n\n' +
              'หากยังต้องการลบบัญชีนี้ สามารถกดปุ่ม "🗑️ ขอลบบัญชี" ส่งคำขอใหม่ได้อีกครั้ง'
      });
    } catch (e) {
      try { logActivity_(p.requestingUsername, 'Super_Admin', 'DISMISS_DELETE_ACCOUNT_REQUEST_EMAIL_FAIL', 'ส่งอีเมลแจ้งผลยกเลิกคำขอลบบัญชีให้ "' + p.targetUsername + '" ไม่สำเร็จ: ' + e.message); } catch (e2) { /* ข้ามได้ */ }
    }
  }
  return { success: true };
}

// ---------------------------------------------------------------------------
// อนุมัติ/ปฏิเสธคำขอสมัคร role Super_Admin ใหม่ — จำกัดสิทธิ์ให้เฉพาะ Super Admin หลักของระบบ (PRIMARY_SUPER_ADMIN_USERNAME) เท่านั้น
// ไม่ใช้ isSuperAdmin_ ทั่วไป เพราะเจตนาให้มีคนเดียวที่ตัดสินใจให้สิทธิ์ Super_Admin คนใหม่ได้ กันสถานการณ์ Super_Admin หลายคนอนุมัติกันเองพร่ำเพรื่อ
// ---------------------------------------------------------------------------
function handleApproveSuperAdminRequest_(p) {
  if (!isPrimarySuperAdmin_(p.requestingUsername)) {
    return { success: false, error: 'ไม่มีสิทธิ์เข้าถึงส่วนนี้ (เฉพาะ Super Admin หลักของระบบเท่านั้นที่อนุมัติคำขอสมัคร Super_Admin ใหม่ได้)' };
  }
  if (!p.targetUsername) return { success: false, error: 'กรุณาระบุชื่อผู้ใช้งาน' };

  const sh = getSheet_(SHEET_NAMES.USERS);
  ensureColumnHeader_(sh, 'approval_status');
  const data = sh.getDataRange().getValues();
  const header = data[0];
  const idx = { username: header.indexOf('username'), role: header.indexOf('role'), email: header.indexOf('email'), approvalStatus: header.indexOf('approval_status') };
  const normTarget = normalizeUsername_(p.targetUsername);

  let targetRowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (normalizeUsername_(data[i][idx.username]) === normTarget) {
      targetRowIndex = i;
      break;
    }
  }
  if (targetRowIndex === -1) return { success: false, error: 'ไม่พบชื่อผู้ใช้งานนี้ในระบบ' };
  const targetRow = data[targetRowIndex];
  if (idx.approvalStatus === -1 || targetRow[idx.approvalStatus] !== 'pending') {
    return { success: false, error: 'ผู้ใช้งานนี้ไม่มีคำขอสมัคร Super_Admin ที่รออนุมัติอยู่' };
  }

  sh.getRange(targetRowIndex + 1, idx.approvalStatus + 1).setValue('');
  logActivity_(p.requestingUsername, 'Super_Admin', 'APPROVE_SUPER_ADMIN_REQUEST', 'อนุมัติคำขอสมัคร role Super_Admin ของผู้ใช้งาน "' + p.targetUsername + '"');

  // แจ้งผู้สมัครว่าอนุมัติแล้ว ลอง Login ได้เลย — ส่งอีเมลไม่สำเร็จก็ไม่ควรทำให้การอนุมัติล้มเหลว แค่บันทึก log เพิ่มไว้
  try {
    const targetEmail = idx.email !== -1 ? String(targetRow[idx.email] || '').trim() : '';
    if (targetEmail) {
      MailApp.sendEmail({
        to: targetEmail,
        subject: 'บัญชี Super Admin ของคุณได้รับการอนุมัติแล้ว — Intelligent Test Data Simulator',
        body: 'บัญชีผู้ใช้งาน "' + p.targetUsername + '" ของคุณที่สมัครไว้ในระบบ Intelligent Test Data Simulator ด้วย role "Super Admin" ได้รับการอนุมัติจาก Super Admin หลักของระบบเรียบร้อยแล้ว\n\n' +
              'ตอนนี้สามารถเข้าสู่ระบบ (Login) ด้วยชื่อผู้ใช้งานและรหัสผ่านที่ตั้งไว้ตอนสมัครได้ทันที'
      });
    }
  } catch (e) {
    try { logActivity_(p.requestingUsername, 'Super_Admin', 'APPROVE_SUPER_ADMIN_REQUEST_EMAIL_FAIL', 'ส่งอีเมลแจ้งผลอนุมัติให้ "' + p.targetUsername + '" ไม่สำเร็จ: ' + e.message); } catch (e2) { /* ข้ามได้ */ }
  }
  return { success: true };
}

// ปฏิเสธคำขอสมัคร Super_Admin — ลบบัญชีนั้นออกจากระบบไปเลย (ไม่เคยได้รับอนุมัติ จึงไม่ควรค้างเป็นบัญชีที่เข้าระบบไม่ได้ตลอดไป) แล้วแจ้งอีเมลผู้สมัครว่าคำขอไม่ผ่าน
function handleRejectSuperAdminRequest_(p) {
  if (!isPrimarySuperAdmin_(p.requestingUsername)) {
    return { success: false, error: 'ไม่มีสิทธิ์เข้าถึงส่วนนี้ (เฉพาะ Super Admin หลักของระบบเท่านั้นที่ปฏิเสธคำขอสมัคร Super_Admin ใหม่ได้)' };
  }
  if (!p.targetUsername) return { success: false, error: 'กรุณาระบุชื่อผู้ใช้งาน' };

  const sh = getSheet_(SHEET_NAMES.USERS);
  ensureColumnHeader_(sh, 'approval_status');
  const data = sh.getDataRange().getValues();
  const header = data[0];
  const idx = { username: header.indexOf('username'), email: header.indexOf('email'), approvalStatus: header.indexOf('approval_status') };
  const normTarget = normalizeUsername_(p.targetUsername);

  let targetRowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (normalizeUsername_(data[i][idx.username]) === normTarget) {
      targetRowIndex = i;
      break;
    }
  }
  if (targetRowIndex === -1) return { success: false, error: 'ไม่พบชื่อผู้ใช้งานนี้ในระบบ' };
  const targetRow = data[targetRowIndex];
  if (idx.approvalStatus === -1 || targetRow[idx.approvalStatus] !== 'pending') {
    return { success: false, error: 'ผู้ใช้งานนี้ไม่มีคำขอสมัคร Super_Admin ที่รออนุมัติอยู่' };
  }
  const targetEmail = idx.email !== -1 ? String(targetRow[idx.email] || '').trim() : '';

  sh.deleteRow(targetRowIndex + 1);
  clearUserScopedCaches_(p.targetUsername); // กันบั๊ก username เดิมถูกสมัครใหม่แล้วโดน cache ของบัญชีเก่าที่เพิ่งถูกปฏิเสธเล่นงาน (เช่น cooldown คำขอลบบัญชี)
  logActivity_(p.requestingUsername, 'Super_Admin', 'REJECT_SUPER_ADMIN_REQUEST', 'ปฏิเสธคำขอสมัคร role Super_Admin ของผู้ใช้งาน "' + p.targetUsername + '" และลบบัญชีที่ยังไม่ได้รับอนุมัติออกจากระบบ');

  try {
    if (targetEmail) {
      MailApp.sendEmail({
        to: targetEmail,
        subject: 'คำขอสมัคร Super Admin ของคุณไม่ได้รับการอนุมัติ — Intelligent Test Data Simulator',
        body: 'คำขอสมัครสมาชิกด้วยชื่อผู้ใช้งาน "' + p.targetUsername + '" role "Super Admin" ในระบบ Intelligent Test Data Simulator ไม่ได้รับการอนุมัติจาก Super Admin หลักของระบบ ระบบได้ลบชื่อผู้ใช้งานและรหัสผ่านที่สมัครไว้ออกจากระบบเรียบร้อยแล้ว\n\n' +
              'หากต้องการใช้งานระบบ กรุณาสมัครสมาชิกใหม่อีกครั้ง (ชื่อผู้ใช้งานเดิมสามารถใช้สมัครซ้ำได้ทันทีเนื่องจากถูกลบออกจากระบบแล้ว) หรือติดต่อผู้ดูแลระบบโดยตรงหากคิดว่าเป็นความผิดพลาด'
      });
    }
  } catch (e) {
    try { logActivity_(p.requestingUsername, 'Super_Admin', 'REJECT_SUPER_ADMIN_REQUEST_EMAIL_FAIL', 'ส่งอีเมลแจ้งผลปฏิเสธให้ "' + p.targetUsername + '" ไม่สำเร็จ: ' + e.message); } catch (e2) { /* ข้ามได้ */ }
  }
  return { success: true };
}

// รีเซ็ตรหัสผ่านให้ผู้ใช้งานคนอื่น (แยกจาก handleResetPassword_ ที่เป็นการกู้คืนรหัสผ่านด้วยตนเองโดยเจตนา เพื่อไม่ให้กระทบ flow เดิมนั้นเลย)
function handleAdminResetPassword_(p) {
  if (!isSuperAdmin_(p.requestingUsername)) {
    return { success: false, error: 'ไม่มีสิทธิ์เข้าถึงส่วนนี้ (เฉพาะ Super_Admin เท่านั้น)' };
  }
  if (!p.targetUsername || !p.newPassword) {
    return { success: false, error: 'ข้อมูลสำหรับตั้งรหัสผ่านใหม่ไม่ครบถ้วน' };
  }

  const sh = getSheet_(SHEET_NAMES.USERS);
  const data = sh.getDataRange().getValues();
  const header = data[0];
  const idx = { username: header.indexOf('username'), salt: header.indexOf('salt'), hash: header.indexOf('password_hash') };
  const normTarget = normalizeUsername_(p.targetUsername);

  for (let i = 1; i < data.length; i++) {
    if (normalizeUsername_(data[i][idx.username]) === normTarget) {
      const newSalt = generateSalt_();
      const newHash = hashPassword_(p.newPassword, newSalt);
      sh.getRange(i + 1, idx.salt + 1).setValue(newSalt);
      sh.getRange(i + 1, idx.hash + 1).setValue(newHash);
      logActivity_(p.requestingUsername, 'Super_Admin', 'ADMIN_RESET_PASSWORD', 'รีเซ็ตรหัสผ่านให้ผู้ใช้งาน "' + p.targetUsername + '" ผ่านแผงจัดการผู้ใช้งาน (Admin Panel)');
      return { success: true };
    }
  }
  return { success: false, error: 'ไม่พบชื่อผู้ใช้งานนี้ในระบบ' };
}

// ให้ Super_Admin ตั้ง/แก้ไขอีเมลของผู้ใช้งานคนใดก็ได้ — จำเป็นสำหรับผู้ใช้เก่าที่สมัครไว้ก่อนมีฟีเจอร์นี้ (ยังไม่มีอีเมลผูกในระบบ
// จึงใช้ OTP ทางอีเมลกู้คืนรหัสผ่านเองไม่ได้จนกว่า Super_Admin จะเพิ่มอีเมลให้ก่อน)
function handleAdminSetUserEmail_(p) {
  if (!isSuperAdmin_(p.requestingUsername)) {
    return { success: false, error: 'ไม่มีสิทธิ์เข้าถึงส่วนนี้ (เฉพาะ Super_Admin เท่านั้น)' };
  }
  if (!p.targetUsername || !p.email) {
    return { success: false, error: 'กรุณาระบุชื่อผู้ใช้งานและอีเมล' };
  }
  if (!isValidEmail_(p.email)) {
    return { success: false, error: 'กรุณากรอกอีเมลให้ถูกต้องตามรูปแบบ' };
  }

  const sh = getSheet_(SHEET_NAMES.USERS);
  const emailCol = ensureColumnHeader_(sh, 'email'); // คืนเลขคอลัมน์แบบ 1-based
  const data = sh.getDataRange().getValues();
  const header = data[0];
  const usernameCol = header.indexOf('username');
  const normTarget = normalizeUsername_(p.targetUsername);

  for (let i = 1; i < data.length; i++) {
    if (normalizeUsername_(data[i][usernameCol]) === normTarget) {
      sh.getRange(i + 1, emailCol).setValue(p.email.trim());
      logActivity_(p.requestingUsername, 'Super_Admin', 'ADMIN_SET_EMAIL', 'ตั้ง/แก้ไขอีเมลให้ผู้ใช้งาน "' + p.targetUsername + '" ผ่านแผงจัดการผู้ใช้งาน');
      return { success: true };
    }
  }
  return { success: false, error: 'ไม่พบชื่อผู้ใช้งานนี้ในระบบ' };
}

function hashPassword_(password, salt) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '::' + password, Utilities.Charset.UTF_8);
  return raw.map(function (b) { return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'); }).join('');
}

function generateSalt_() {
  return Utilities.getUuid();
}

// ---------------------------------------------------------------------------
// GENERATE (หัวใจหลัก: prompt -> Gemini API -> ตรวจสอบ -> คืนผลไปพักที่หน้าเว็บ)
// ---------------------------------------------------------------------------
function handleGenerate_(p) {
  const rowsRequested = parseInt(p.rowsRequested, 10);
  if (!p.dataType || !p.tableName || !rowsRequested || rowsRequested <= 0) {
    return { success: false, error: 'ข้อมูลคำขอไม่ครบถ้วน (ต้องมี dataType, tableName, rowsRequested)' };
  }
  if (rowsRequested > MAX_ROWS_PER_GENERATE) {
    return { success: false, error: 'จำกัดไม่เกิน ' + MAX_ROWS_PER_GENERATE + ' แถวต่อคำขอ (ป้องกันคำขอที่มีโอกาสสูงจะถูก AI ตัดคำตอบก่อนครบ เนื่องจากข้อจำกัดความยาวคำตอบสูงสุดของโมเดล)' };
  }

  // ถ้าผู้ใช้วาง DDL Script มาเอง ถือว่า DDL คือแหล่งความจริงของคอลัมน์ (ยืดหยุ่นเต็มที่ตามที่ผู้ใช้ระบุ)
  // จะไม่ไปตัด/จำกัดคอลัมน์ตาม ColumnSchemaConfig ทับซ้อนกันโดยเด็ดขาด
  // การจำกัดคอลัมน์ตาม ColumnSchemaConfig จะมีผลเฉพาะกรณีที่ "ไม่ได้แนบ DDL" และมีแถว config ที่ตรงกับ data_type/table เท่านั้น (เป็นออปชันที่ต้องตั้งค่าเองล่วงหน้า ไม่ใช่ค่าเริ่มต้นของระบบ)
  const schemaConfig = p.ddlScript ? null : getColumnSchemaFor_(p.dataType, p.tableName);
  const allowNull = (p.allowNull === true || p.allowNull === 'true');
  const formInputs = { rowsRequested: rowsRequested, allowNull: allowNull };

  const smartPrompt = buildSmartPrompt_(p, schemaConfig, rowsRequested, allowNull);

  let aiText;
  try {
    aiText = callGemini_(smartPrompt, p.schemaImageBase64);
  } catch (err) {
    logActivity_(p.username, p.role, 'GENERATE_FAIL', 'เรียก Gemini API ไม่สำเร็จ: ' + err.message);
    return { success: false, error: 'เรียก AI API ไม่สำเร็จ: ' + err.message };
  }

  let parsed;
  try {
    parsed = extractJsonFromAiText_(aiText);
  } catch (err) {
    logActivity_(p.username, p.role, 'GENERATE_FAIL', 'AI ตอบกลับไม่เป็น JSON ที่ใช้ได้: ' + err.message);
    return { success: false, error: 'ไม่สามารถแปลผลลัพธ์จาก AI เป็นข้อมูลได้: ' + err.message, rawAiText: aiText };
  }

  let rows = parsed.rows || [];

  // 1) Reconcile คอลัมน์ตาม schema ที่ "หลังบ้าน" กำหนดไว้สำหรับ data_type/table นี้
  const reconciled = reconcileColumns_(rows, schemaConfig);
  rows = reconciled.rows;

  // 2) ตรวจโครงสร้างพื้นฐาน (จำนวนแถว, ค่าว่างที่ไม่อนุญาต)
  const structuralErrors = validateStructure_(rows, formInputs);

  // 3) ตรวจสอบเชิงเนื้อหาว่าข้อมูลตรงกับเงื่อนไขที่ผู้ใช้ตั้งไว้หรือไม่ (ให้ Gemini ช่วยตรวจซ้ำ)
  //    การเรียกครั้งนี้ให้ Gemini คำนวณคะแนนเปอร์เซ็นต์ "ตรงตามเงื่อนไข" และ "ความน่าเชื่อถือ" มาด้วยในตัว
  const semanticCheck = callGeminiValidate_(rows, p);

  const overallPass = structuralErrors.length === 0 && reconciled.missingRequired.length === 0 && semanticCheck.pass;

  // ผสมคะแนนที่ AI ประเมินเข้ากับผลตรวจเชิงโครงสร้างที่ระบบจับได้แน่ชัดอยู่แล้ว (กันกรณี AI ให้คะแนนสูงเกินจริงทั้งที่มี error ชัดเจน)
  // ถ้าขั้นตอนตรวจสอบเชิงเนื้อหาล้มเหลวทางเทคนิคจริงๆ (semanticCheck.checkFailed) ห้ามใส่ค่า fallback เป็นตัวเลข (เช่น 100%) เด็ดขาด
  // เพราะจะทำให้เข้าใจผิดว่าเป็นผลวิเคราะห์จริงจาก AI ทั้งที่จริงๆ ไม่ได้ถูกวิเคราะห์เลย ให้ใช้ค่า 'N/A' แทนเพื่อความชัดเจน
  let conditionMatchPercent, reliabilityPercent;
  if (semanticCheck.checkFailed) {
    conditionMatchPercent = 'N/A';
    reliabilityPercent = 'N/A';
  } else {
    conditionMatchPercent = clampPercent_(semanticCheck.conditionMatchPercent, semanticCheck.pass ? 100 : 60);
    reliabilityPercent = clampPercent_(semanticCheck.reliabilityPercent, 85);
    if (structuralErrors.length > 0 || reconciled.missingRequired.length > 0) {
      conditionMatchPercent = Math.min(conditionMatchPercent, 70);
    }
    if (rows.length !== rowsRequested) {
      conditionMatchPercent = Math.min(conditionMatchPercent, 80);
    }
  }

  const validationReport = {
    requestedRows: rowsRequested,
    actualRows: rows.length,
    droppedColumns: reconciled.droppedColumns,
    missingRequiredColumns: reconciled.missingRequired,
    structuralErrors: structuralErrors,
    semanticIssues: semanticCheck.issues,
    // ส่งค่า pass/fail ของการตรวจสอบเนื้อหา (AI self-check) แยกออกมาตรงๆ
    // เพราะ semanticIssues อาจมีรายการ "ข้อสังเกต" อยู่ได้แม้ AI จะสรุปว่า "ผ่าน" แล้วก็ตาม (เป็นแค่ข้อสังเกตย่อยที่ไม่กระทบเงื่อนไขหลัก)
    // ถ้าฝั่งหน้าเว็บเช็คแค่ "มี issue อยู่ไหม" เพื่อตัดสิน ✅/❌ อาจขึ้นกากบาทผิดๆ ทั้งที่ผลรวมผ่านจริง
    semanticPass: semanticCheck.pass,
    overallPass: overallPass
  };

  // เช็คเกณฑ์ขั้นต่ำแยกจาก overallPass เดิม (ซึ่งเป็นแค่ boolean structural/AI self-check pass-fail)
  // passMinimumThreshold: true = ตรงตามเงื่อนไข >= 70% และความน่าเชื่อถือ >= 90% ทั้งคู่ (ใช้บล็อกปุ่มนำเข้า Dashboard ฝั่งหน้าเว็บ)
  //                        null = ไม่สามารถประเมินได้ (ตรวจสอบเชิงเนื้อหาล้มเหลวทางเทคนิค ค่าเป็น 'N/A') ให้ฝั่งหน้าเว็บอนุญาตผ่านแบบ advisory เหมือนเดิม ไม่บล็อก
  const passMinimumThreshold = (typeof conditionMatchPercent === 'number' && typeof reliabilityPercent === 'number')
    ? (conditionMatchPercent >= MIN_CONDITION_MATCH_PERCENT && reliabilityPercent >= MIN_RELIABILITY_PERCENT)
    : null;
  const qualityLevel = computeQualityLevel_(conditionMatchPercent, reliabilityPercent);

  const qualityScore = {
    conditionMatchPercent: conditionMatchPercent,
    reliabilityPercent: reliabilityPercent,
    summary: semanticCheck.summary || '',
    passMinimumThreshold: passMinimumThreshold,
    qualityLevel: qualityLevel,
    minConditionMatchPercent: MIN_CONDITION_MATCH_PERCENT,
    minReliabilityPercent: MIN_RELIABILITY_PERCENT
  };

  const sql = buildSqlFromRows_(rows, p.tableName, p.dialect);

  logActivity_(
    p.username, p.role, 'GENERATE',
    'สร้างข้อมูล [' + p.dataType + '] ตาราง [' + p.tableName + '] จำนวน ' + rows.length +
    ' แถว | ผลตรวจสอบ: ' + (overallPass ? 'ผ่าน' : 'ไม่ผ่าน — ต้องตรวจสอบก่อน commit') +
    ' | ตรงตามเงื่อนไข ' + conditionMatchPercent + (conditionMatchPercent === 'N/A' ? '' : '%') +
    ' | ความน่าเชื่อถือ ' + reliabilityPercent + (reliabilityPercent === 'N/A' ? '' : '%')
  );

  logQualityScore_(p, rows.length, conditionMatchPercent, reliabilityPercent, qualityScore.summary, qualityLevel, passMinimumThreshold);
  logGeneratedPrompt_(p, smartPrompt, allowNull, rowsRequested);

  return {
    success: true,
    qualityScore: qualityScore,
    rows: rows,
    sql: sql,
    validationReport: validationReport,
    promptUsed: smartPrompt
  };
}

// วันที่ปัจจุบันจริง (ตามเวลาของ Apps Script) ใช้บอก AI ให้คำนวณช่วงเวลาสัมพัทธ์ (6 เดือนล่าสุด, ปีนี้ ฯลฯ) ได้ถูกต้อง
// เพราะ AI ไม่รู้ "วันนี้" ของระบบจริงเอง ถ้าไม่บอกไว้ตรงๆ จะเดาปีจากข้อมูลฝึกฝนแทน ซึ่งอาจเก่ากว่าความเป็นจริงมาก
function getTodayContextStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function buildSmartPrompt_(p, schemaConfig, rowsRequested, allowNull) {
  const parts = [];
  const todayStr = getTodayContextStr_();
  parts.push('คุณคือระบบสร้างข้อมูลทดสอบ (test data) สำหรับฐานข้อมูล ' + p.dialect + '.');
  parts.push('วันที่ปัจจุบันคือ ' + todayStr + ' (ปฏิทินสากล) ให้ใช้วันที่นี้เป็นฐานอ้างอิงทุกครั้งที่โจทย์พูดถึงเวลาสัมพัทธ์ เช่น "วันนี้", "ล่าสุด", "X เดือน/ปีที่ผ่านมา" ห้ามใช้ปีหรือช่วงเวลาจากความจำของตัวเองโดยเด็ดขาด ต้องคำนวณจากวันที่นี้เท่านั้น');
  parts.push('ต้องการข้อมูลประเภท: "' + p.dataType + '" สำหรับตาราง "' + p.tableName + '" จำนวน ' + rowsRequested + ' แถว.');

  if (p.ddlScript) {
    parts.push('โครงสร้างตารางอ้างอิง (DDL Script) ต้องยึดตามนี้เป็นหลัก:\n' + p.ddlScript);
  }

  // สำคัญมาก: ถ้ามีรูปภาพ Schema/ER Diagram แนบมาด้วย (ส่งเป็น inline_data แยกต่างหากใน callGemini_)
  // ต้องบอก Gemini ตรงๆ ในข้อความ prompt ว่ามีรูปนี้อยู่และต้องใช้ทำอะไร ไม่งั้น Gemini จะเห็นรูปแต่ไม่รู้ว่าเกี่ยวข้องกับคำขอนี้ยังไง แล้วมักจะเมินรูปไปเฉยๆ
  if (p.schemaImageBase64) {
    parts.push(
      'มีรูปภาพ Schema/ER Diagram แนบมาพร้อมคำขอนี้ด้วย ให้วิเคราะห์รูปอย่างละเอียดแล้วใช้เป็นข้อมูลอ้างอิงหลักสำหรับ: ชื่อตาราง/collection, ชื่อคอลัมน์, ชนิดข้อมูลของแต่ละคอลัมน์, คีย์หลัก (primary key), คีย์นอก (foreign key) และความสัมพันธ์ระหว่างตาราง (เช่น 1:1, 1:N, N:M) ที่ปรากฏในรูป' +
      (p.ddlScript
        ? ' หากรายละเอียดในรูป (เช่น ชื่อคอลัมน์/ชนิดข้อมูล) ขัดแย้งกับ DDL Script ด้านบน ให้ยึดตาม DDL Script เป็นหลัก แต่ยังคงต้องใช้รูปประกอบการทำความเข้าใจความสัมพันธ์ระหว่างตารางอยู่ดี'
        : ' ห้ามเพิกเฉยต่อรูปนี้หรือสร้างข้อมูลที่ไม่เกี่ยวข้องกับโครงสร้างในรูปโดยเด็ดขาด') +
      ' ถ้าคำขอนี้ต้องสร้างข้อมูลของหลายตาราง/collection ที่มีความสัมพันธ์กันตามรูป ค่าคีย์ที่เชื่อมโยงกัน (เช่น foreign key) ในแต่ละแถวต้องอ้างอิงถึงกันได้จริงและสอดคล้องกันระหว่างชุดข้อมูล ไม่ใช่สุ่มสร้างแยกกันโดยไม่เกี่ยวข้องกัน'
    );
  }

  if (schemaConfig && schemaConfig.allowedColumns && schemaConfig.allowedColumns.length) {
    let hint = 'ควรเลือกใช้ชื่อคอลัมน์จากชุดที่ระบบอนุญาตนี้เท่านั้น (เลือกเฉพาะที่จำเป็นและเกี่ยวข้องกับข้อมูลที่ขอ ไม่จำเป็นต้องใช้ครบทุกตัว): '
      + schemaConfig.allowedColumns.join(', ') + '.';
    if (schemaConfig.requiredColumns && schemaConfig.requiredColumns.length) {
      hint += ' คอลัมน์ต่อไปนี้ต้องมีอยู่ในทุกแถวเสมอ: ' + schemaConfig.requiredColumns.join(', ') + '.';
    }
    parts.push(hint);
  }

  parts.push(allowNull
    ? 'อนุญาตให้บางฟิลด์มีค่าว่าง (null) ได้ตามความสมเหตุสมผลของข้อมูลจริง — ถ้าเงื่อนไขระบุสัดส่วนหรือจำนวนแถวที่ต้องเว้นว่างไว้ (เช่น "30-40% ของแถวให้เว้นว่าง") ให้ใส่ค่า null จริงในฟิลด์ JSON นั้นเป๊ะๆ ห้ามใส่ข้อความแทนค่าว่าง เช่น "N/A", "NONE", "NOCOUPON", "ไม่มี", "-" หรือคำอื่นใดที่สื่อความหมายว่าง เพราะ null กับ string ที่ไม่ว่างมีผลต่างกันทางเทคนิคเวลานำไป query จริง'
    : 'ห้ามมีค่าว่าง (null หรือ empty string) ในทุกฟิลด์ของทุกแถวโดยเด็ดขาด');

  if (p.promptAddition) {
    parts.push('เงื่อนไขเพิ่มเติมที่ต้องปฏิบัติตามอย่างเคร่งครัด: ' + p.promptAddition);
    parts.push('สำคัญมาก: ถ้าเงื่อนไขข้างต้นระบุข้อความที่อยู่ในเครื่องหมายคำพูด (เช่น ต้องเป็นหนึ่งใน "ก", "ข", "ค") ให้ใช้ข้อความนั้นตรงตัวทุกตัวอักษรเป๊ะๆ ห้ามดัดแปลง ห้ามใช้คำพ้องความหมาย ห้ามแปลภาษา ห้ามย่อ/ขยายคำ แม้ความหมายจะใกล้เคียงกันแค่ไหนก็ตาม เพราะระบบปลายทางเทียบค่าแบบตรงตัวอักษร (exact string match) ไม่ใช่เทียบความหมาย');
  }

  parts.push('ข้อมูลต้องสมจริง สอดคล้องกันเชิงตรรกะภายในแต่ละแถว และเหมาะสมกับบริบทธุรกิจของประเภทข้อมูลที่ระบุ');
  parts.push('ตอบกลับเป็น JSON ล้วนเท่านั้น ห้ามมีข้อความอื่นใดนอก JSON และห้ามใช้ markdown code block');
  parts.push('รูปแบบ JSON ต้องเป็น: {"rows": [ {...}, {...}, ... ]} โดยจำนวน object ใน rows ต้องเท่ากับ ' + rowsRequested + ' พอดี');
  parts.push('สำคัญมาก: ให้ตอบ JSON แบบ compact (บีบอัด) ไม่ต้องเว้นบรรทัดหรือเคาะ indent ระหว่าง key/value เพื่อประหยัดพื้นที่คำตอบ และต้องปิด JSON ให้ครบสมบูรณ์เสมอ ห้ามตอบข้อมูลค้างครึ่งกลาง');

  return parts.filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------------------
// เรียก Gemini API (Google AI Studio — มี Free Tier ใช้งานได้โดยไม่ต้องผูกบัตรเครดิต)
// ---------------------------------------------------------------------------
// พยายามอ่านระยะเวลาที่ Gemini แนะนำให้รอก่อนลองใหม่ จาก error response (google.rpc.RetryInfo.retryDelay เช่น "3.8s")
// ถ้าหาไม่เจอ ให้ใช้ค่า default แทน — ใช้ตอนเจอ HTTP 429 (rate limit ของ free tier) เพื่อลองซ้ำอัตโนมัติแทนที่จะพังทันที
function extractRetryDelaySeconds_(body) {
  try {
    const details = body && body.error && body.error.details;
    if (!details) return null;
    for (let i = 0; i < details.length; i++) {
      if (details[i] && details[i].retryDelay) {
        const m = String(details[i].retryDelay).match(/([\d.]+)s/);
        if (m) return parseFloat(m[1]);
      }
    }
  } catch (e) { /* ข้ามได้ ใช้ default แทน */ }
  return null;
}

// ---------------------------------------------------------------------------
// ตัวเช็ค/แจ้งเตือนโควตา Gemini คร่าวๆ ก่อน generate
// Google ไม่มี API ให้เช็คโควตาที่เหลือจริงของ free tier โดยตรง จึงนับจำนวนครั้งที่เรียก Gemini จริงเอง (ฝั่งเรา)
// เทียบกับ limit ที่เจอจริงจาก error message ก่อนหน้านี้ ("...limit: 20...") เป็นการประมาณการเท่านั้น ไม่ใช่ตัวเลขที่แม่นยำ 100% จาก Google โดยตรง
// ---------------------------------------------------------------------------
const GEMINI_RATE_LIMIT_PER_MINUTE = 20; // อ้างอิงจาก error จริงที่เคยเจอ: "limit: 20" — ปรับเลขนี้ได้ถ้า Google เปลี่ยนโควตา free tier ในอนาคต
const GEMINI_CALL_LOG_PROPERTY_ = 'GEMINI_CALL_TIMESTAMPS';
const GEMINI_COOLDOWN_UNTIL_PROPERTY_ = 'GEMINI_COOLDOWN_UNTIL'; // เวลา (ms epoch) ที่โควตาจะว่างจริง — คำนวณจาก retryDelay จริงที่ Gemini ส่งกลับมาตอนชนโควตาของ API Key นี้ (ไม่ใช่ค่าประมาณการ)

// บันทึกเวลาที่โควตาของ API Key นี้จะว่างอีกครั้ง โดยอ้างอิงจากค่า retryDelay จริงที่ Google ส่งกลับมาตอนเจอ HTTP 429
// เก็บใน Script Properties เดียวกับสถิติการเรียก (ฝั่งเซิร์ฟเวอร์) จึงคงอยู่ข้ามการ logout/reset ฝั่งหน้าเว็บได้เองอยู่แล้วโดยธรรมชาติ
function recordGeminiCooldown_(waitSeconds) {
  try {
    const until = Date.now() + Math.ceil(waitSeconds) * 1000;
    PropertiesService.getScriptProperties().setProperty(GEMINI_COOLDOWN_UNTIL_PROPERTY_, String(until));
  } catch (e) {
    // ข้ามได้ ไม่ควรกระทบการเรียก Gemini จริง
  }
}

// เคลียร์ cooldown เดิมทิ้ง เมื่อพิสูจน์แล้วว่าเรียก Gemini สำเร็จจริง (โควตาว่างแล้วจริงๆ ไม่ต้องรอตามเวลาเดิมอีกต่อไป)
function clearGeminiCooldown_() {
  try {
    PropertiesService.getScriptProperties().deleteProperty(GEMINI_COOLDOWN_UNTIL_PROPERTY_);
  } catch (e) {
    // ข้ามได้
  }
}

// บันทึกว่ามีการยิง request ไปหา Gemini จริง 1 ครั้ง (นับทุก attempt รวม retry ด้วย เพราะฝั่ง Google นับเป็นคำขอจริงทุกครั้ง)
// ครอบด้วย try/catch ทั้งหมด เพื่อไม่ให้การบันทึกสถิตินี้ทำให้การเรียก Gemini จริงล้มเหลวไปด้วยเด็ดขาด
function recordGeminiApiCall_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const now = Date.now();
    let timestamps = [];
    try {
      timestamps = JSON.parse(props.getProperty(GEMINI_CALL_LOG_PROPERTY_) || '[]');
    } catch (e) {
      timestamps = [];
    }
    timestamps.push(now);
    // เก็บแค่ 60 วินาทีล่าสุดพอ ตัดของเก่าทิ้งกันพร็อพเพอร์ตี้บวมขึ้นเรื่อยๆ
    timestamps = timestamps.filter(function (t) { return now - t < 60000; });
    props.setProperty(GEMINI_CALL_LOG_PROPERTY_, JSON.stringify(timestamps));
  } catch (e) {
    // ข้ามได้ ไม่ควรกระทบการเรียก Gemini จริง
  }
}

// อ่านสถานะโควตาโดยประมาณ ณ ขณะนี้ (จำนวนครั้งที่เรียกไปแล้วใน 60 วิล่าสุด เทียบกับ limit)
function getGeminiQuotaStatus_() {
  const props = PropertiesService.getScriptProperties();
  const now = Date.now();
  let timestamps = [];
  try {
    timestamps = JSON.parse(props.getProperty(GEMINI_CALL_LOG_PROPERTY_) || '[]');
  } catch (e) {
    timestamps = [];
  }
  timestamps = timestamps.filter(function (t) { return now - t < 60000; });

  const usedCount = timestamps.length;
  const limit = GEMINI_RATE_LIMIT_PER_MINUTE;
  const usedPercent = Math.min(100, Math.round((usedCount / limit) * 100));
  const remainingCount = Math.max(0, limit - usedCount);

  // เวลาที่จะรอ Cooldown จริง (ถ้ามี) — มาจากค่า retryDelay จริงที่ Gemini เคยส่งกลับมาตอนชนโควตาของ API Key นี้ครั้งล่าสุด
  // เก็บอยู่ใน Script Properties เดียวกับสถิติการเรียก จึงยังคงอยู่แม้ผู้ใช้จะ logout หรือกดรีเซ็ตหน้าเว็บไปแล้วก็ตาม
  let cooldownUntil = 0;
  try {
    cooldownUntil = parseInt(props.getProperty(GEMINI_COOLDOWN_UNTIL_PROPERTY_) || '0', 10) || 0;
  } catch (e) {
    cooldownUntil = 0;
  }
  const inCooldown = cooldownUntil > now;
  const cooldownRemainingSeconds = inCooldown ? Math.ceil((cooldownUntil - now) / 1000) : 0;

  return {
    usedCount: usedCount,
    limit: limit,
    usedPercent: usedPercent,
    remainingCount: remainingCount,
    windowSeconds: 60,
    inCooldown: inCooldown,
    cooldownRemainingSeconds: cooldownRemainingSeconds,
    // ส่ง timestamp จริง (ms epoch) ของทุกครั้งที่เรียก Gemini ในช่วง 60 วิล่าสุดกลับไปด้วย
    // ให้หน้าเว็บคำนวณเองว่าแต่ละครั้งจะหลุดจากช่วงนับเมื่อไหร่ แล้วไล่ลด % แบบ real-time ทุกวินาทีได้
    // โดยอ้างอิงจากเวลาจริงที่เซิร์ฟเวอร์บันทึกไว้ ไม่ใช่การเดาหรือประมาณการฝั่งหน้าเว็บเอง
    timestamps: timestamps
  };
}

function handleGetGeminiQuotaStatus_(p) {
  try {
    return { success: true, quota: getGeminiQuotaStatus_() };
  } catch (e) {
    return { success: false, error: 'อ่านสถานะโควตา Gemini ไม่สำเร็จ: ' + e.message };
  }
}

function callGemini_(promptText, imageBase64) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('ยังไม่ได้ตั้งค่า GEMINI_API_KEY ใน Script Properties (Project Settings > Script Properties) — ขอฟรีได้ที่ https://aistudio.google.com/apikey');

  const parts = [{ text: promptText }];
  if (imageBase64) {
    const match = String(imageBase64).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (match) {
      parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
    }
  }

  const payload = {
    contents: [{ parts: parts }],
    generationConfig: { maxOutputTokens: GEMINI_MAX_TOKENS }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  // Free tier ของ Gemini มี rate limit ต่อนาทีค่อนข้างต่ำ ถ้าชนโควตา (HTTP 429) มักหายเองภายในไม่กี่วินาที
  // จึงลองซ้ำอัตโนมัติสูงสุด 3 ครั้ง โดยรอตามเวลาที่ Gemini แนะนำมา (หรือ 5 วิ ถ้าไม่มีคำแนะนำ) ก่อนพังจริง
  const maxAttempts = 3;
  let code, bodyText, body;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    recordGeminiApiCall_(); // นับ request จริงทุก attempt (รวม retry) ไว้ประมาณการ % โควตาที่ใช้ไป
    const resp = UrlFetchApp.fetch(GEMINI_API_URL, options);
    code = resp.getResponseCode();
    bodyText = resp.getContentText();
    try { body = JSON.parse(bodyText); } catch (e) { body = null; }

    if (code === 429) {
      // waitSec นี้เป็นสัญญาณจริงจาก Google ที่ผูกกับ API Key นี้โดยตรง (retryDelay ในตัว error response) ไม่ใช่ค่าประมาณการของเราเอง
      // บันทึกไว้เป็นเวลาที่โควตาจะว่างจริง ให้หน้าเว็บใช้แสดง Cooldown ที่แม่นยำกว่าการนับจำนวนครั้งเอง และอยู่ทน ข้าม logout/reset ได้เพราะเก็บฝั่งเซิร์ฟเวอร์
      const waitSec = extractRetryDelaySeconds_(body) || 5;
      recordGeminiCooldown_(waitSec);
      if (attempt < maxAttempts) {
        // เดิมจำกัดรอสูงสุดแค่ 20 วิ แต่ free tier บางครั้งขอให้รอเกือบ 60 วิถึงจะเคลียร์โควตา (เจอจริงจาก error: "Please retry in 59s")
        // รอไม่พอ = ลองซ้ำแล้วก็ยังชนโควตาเดิมอยู่ดี จึงขยับเพดานเป็น 65 วิ ให้รอได้นานพอจริงๆ (ยังปลอดภัยเทียบกับ execution limit 6 นาทีของ Apps Script)
        Utilities.sleep(Math.min(Math.ceil(waitSec) + 2, 65) * 1000);
        continue;
      }
    } else if (code === 503 || code === 500 || code === 502 || code === 504) {
      // เซิร์ฟเวอร์ Gemini โหลดสูงชั่วคราว (ฝั่ง Google เอง) — ไม่ใช่โควตา/token ของเราหมด จึงไม่ต้องบันทึก Cooldown
      // ปกติหายเองภายในไม่กี่วินาที จึงลองซ้ำได้เลยโดยรอสั้นๆ แบบ exponential backoff (2 วิ, 4 วิ)
      if (attempt < maxAttempts) {
        Utilities.sleep(2000 * attempt);
        continue;
      }
    } else if (code === 200) {
      clearGeminiCooldown_(); // เรียกสำเร็จจริง แปลว่าโควตาว่างแล้วจริงๆ ไม่ต้องให้ผู้ใช้รอตาม Cooldown เดิมอีกต่อไป
    }
    break;
  }

  if (code !== 200) {
    const msg = body && body.error && body.error.message ? body.error.message : bodyText;
    const extra = code === 429
      ? ' — ลองใหม่อัตโนมัติแล้วแต่โควตา Gemini free tier ยังไม่ว่าง กรุณารอสักครู่แล้วกดสร้างข้อมูลอีกครั้ง'
      : ((code === 503 || code === 500 || code === 502 || code === 504) ? ' — ลองใหม่อัตโนมัติแล้วแต่เซิร์ฟเวอร์ Gemini ยังคงมีผู้ใช้งานหนาแน่นอยู่ กรุณาลองใหม่อีกครั้งในอีกสักครู่' : '');
    throw new Error('Gemini API error (HTTP ' + code + '): ' + msg + extra);
  }

  const candidate = body.candidates && body.candidates[0];
  if (!candidate || !candidate.content || !candidate.content.parts) {
    const blockReason = body.promptFeedback && body.promptFeedback.blockReason;
    throw new Error('Gemini ไม่ส่งผลลัพธ์ข้อความกลับมา' + (blockReason ? ' (ถูกบล็อกด้วยเหตุผล: ' + blockReason + ')' : ' (อาจโดนตัดเพราะ maxOutputTokens ไม่พอ หรือเนื้อหาถูกกรองโดยระบบความปลอดภัยของ Gemini)'));
  }

  // ถ้าคำตอบถูกตัดกลางคันเพราะโทเค็นไม่พอ (finishReason = MAX_TOKENS) ให้แจ้งเตือนชัดเจนแทนที่จะปล่อยให้ไปพังตอนแปลง JSON
  if (candidate.finishReason === 'MAX_TOKENS') {
    throw new Error('คำตอบจาก Gemini ถูกตัดกลางคันเพราะยาวเกิน maxOutputTokens ที่กำหนดไว้ (ลองลดจำนวนแถวที่ขอ หรือลดจำนวนคอลัมน์ลง แล้วลองใหม่)');
  }

  return candidate.content.parts.map(function (part) { return part.text || ''; }).join('\n');
}

function callGeminiValidate_(rows, p) {
  if (!rows.length) return { pass: false, issues: ['ไม่มีข้อมูลให้ตรวจสอบ (rows ว่างเปล่า)'] };

  const sample = rows.slice(0, Math.min(rows.length, 15));
  const allowNull = (p.allowNull === true || p.allowNull === 'true');
  const todayStr = getTodayContextStr_();

  const parts = [];
  parts.push('วันนี้คือวันที่ ' + todayStr + ' — ใช้เป็นฐานอ้างอิงเวลาสัมพัทธ์ตอนตรวจสอบข้อมูล (เช่น "6 เดือนล่าสุด" ต้องนับถอยหลังจากวันนี้จริงๆ ไม่ใช่เดาจากความจำ)');
  parts.push('ตรวจสอบว่าข้อมูลตัวอย่างต่อไปนี้ (สุ่มมาบางส่วนจากทั้งหมด ' + rows.length + ' แถว) ตรงตามเงื่อนไขที่ตั้งไว้จริงหรือไม่:');
  parts.push('- ประเภทข้อมูล: ' + p.dataType);
  if (p.promptAddition) parts.push('- เงื่อนไขเพิ่มเติม: ' + p.promptAddition);
  parts.push('- ' + (allowNull ? 'อนุญาตให้มีค่าว่างได้' : 'ห้ามมีค่าว่าง'));
  parts.push('ข้อมูลตัวอย่าง (JSON):\n' + JSON.stringify(sample));
  parts.push('ให้ตรวจสอบอย่างเข้มงวดเป็นพิเศษ 3 เรื่องนี้ ถ้าพบให้ pass = false และระบุรายละเอียดใน issues ชัดเจนว่าแถวไหน/ฟิลด์ไหนผิด:');
  parts.push('1) ถ้าเงื่อนไขระบุชุดค่าที่อนุญาตไว้ (เช่น "ต้องเป็นหนึ่งใน...") ค่าที่ใช้จริงต้องตรงตัวอักษรเป๊ะกับที่ระบุเท่านั้น ไม่ใช่แค่ความหมายใกล้เคียงหรือคำพ้องความหมาย (เช่น "จัดส่งแล้ว" ไม่เท่ากับ "จัดส่งสำเร็จ" ถือว่าไม่ผ่าน)');
  parts.push('2) ถ้าเงื่อนไขระบุให้บางแถวเว้นว่าง/ไม่มีค่า ต้องเป็นค่าว่างจริง (null หรือ empty string) ไม่ใช่ข้อความ placeholder เช่น "NONE", "N/A", "ไม่มี", "NOCOUPON"');
  parts.push('3) ถ้าเงื่อนไขระบุช่วงเวลาสัมพัทธ์กับวันนี้ (เช่น "X เดือน/ปีล่าสุด") ให้เทียบกับวันที่ปัจจุบันที่ระบุไว้ด้านบนจริงๆ');
  parts.push('นอกเหนือจาก 3 ข้อข้างต้น ให้ pass = false เฉพาะกรณีที่ข้อมูลขัดกับเงื่อนไขที่ระบุไว้จริงๆ อย่างชัดเจนเท่านั้น ไม่ต้อง strict กับรายละเอียดเล็กน้อยที่ไม่กระทบเงื่อนไขหลัก');
  parts.push('นอกจากนี้ให้ประเมินเป็นคะแนนเปอร์เซ็นต์ 2 ค่าเพิ่มเติม (0-100 จำนวนเต็ม):');
  parts.push('- conditionMatchPercent: สัดส่วนของเงื่อนไขทั้งหมดที่ระบุไว้ (ชนิดข้อมูล/DDL, ค่าที่อนุญาต, ค่าว่าง, ช่วงเวลา, สูตรคำนวณ ฯลฯ) ที่ข้อมูลตัวอย่างนี้ทำได้ตรงจริง ให้คิดเป็นสัดส่วนแถว/เงื่อนไขที่ผ่านจริงเทียบกับทั้งหมด ไม่ใช่ให้เต็ม 100 ทุกครั้ง');
  parts.push('- reliabilityPercent: ความน่าเชื่อถือของข้อมูล พิจารณาจากความสมจริง ความสอดคล้องเชิงตรรกะภายในแต่ละแถว ความหลากหลายไม่ซ้ำซาก รูปแบบข้อมูลถูกต้อง (อีเมล/วันที่/ตัวเลข) และไม่มี id ซ้ำ');
  parts.push('ตอบกลับเป็น JSON ล้วนเท่านั้น รูปแบบ: {"pass": true หรือ false, "issues": ["..."], "conditionMatchPercent": number, "reliabilityPercent": number, "summary": "สรุปผลสั้นๆ เป็นภาษาไทยไม่เกิน 2 ประโยค"}');

  try {
    const resultText = callGemini_(parts.join('\n\n'));
    const cleaned = resultText.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) throw new Error('ไม่พบ JSON ในคำตอบตรวจสอบของ AI');
    const parsed = JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
    return {
      pass: !!parsed.pass,
      issues: parsed.issues || [],
      conditionMatchPercent: parsed.conditionMatchPercent,
      reliabilityPercent: parsed.reliabilityPercent,
      summary: parsed.summary || ''
    };
  } catch (err) {
    // ถ้าขั้นตอนตรวจสอบเชิงเนื้อหาล้มเหลว ไม่ควรบล็อกผู้ใช้ทั้งหมด แต่ต้องแจ้งเตือนให้ตรวจสอบเองก่อน commit
    // checkFailed = true บอกให้ handleGenerate_ รู้ว่านี่คือความล้มเหลวทางเทคนิคจริงๆ (ไม่ใช่ AI วิเคราะห์แล้วให้ผ่าน)
    // เพื่อไม่ให้แสดง % เป็นค่า fallback (เช่น 100%) ที่อาจทำให้เข้าใจผิดว่าเป็นผลวิเคราะห์จริงจาก AI
    return {
      pass: true,
      checkFailed: true,
      issues: ['ระบบตรวจสอบเชิงเนื้อหาไม่สำเร็จ (' + err.message + ') กรุณาตรวจสอบข้อมูลด้วยตนเองก่อนบันทึกลงฐานข้อมูล'],
      conditionMatchPercent: undefined,
      reliabilityPercent: undefined,
      summary: 'ระบบตรวจสอบเชิงเนื้อหาไม่สำเร็จ กรุณาตรวจสอบข้อมูลด้วยตนเอง'
    };
  }
}

// จำกัดค่าเปอร์เซ็นต์ให้อยู่ในช่วง 0-100 และเป็นจำนวนเต็มเสมอ ถ้า AI ไม่ได้ส่งค่ามาให้ (undefined/NaN) ใช้ค่า fallback ที่ระบุ
function clampPercent_(val, fallback) {
  const n = Number(val);
  if (isNaN(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ---------------------------------------------------------------------------
// เกณฑ์ขั้นต่ำที่ข้อมูลต้องผ่าน ถึงจะอนุญาตให้กดนำเข้าสู่ Dashboard ได้ (ฝั่งหน้าเว็บใช้ค่านี้บล็อกปุ่ม "ยืนยันนำเข้าสู่ Dashboard" ที่หน้าจุดพัก)
// ใช้แยกกันคนละตัวชี้วัดกับ overallPass (ซึ่งเช็คแค่ structural/columns/AI self-check pass-fail แบบ boolean เท่านั้น ไม่เกี่ยวกับตัวเลข % นี้โดยตรง)
// ---------------------------------------------------------------------------
const MIN_CONDITION_MATCH_PERCENT = 70;
const MIN_RELIABILITY_PERCENT = 90;

// ระดับคุณภาพของข้อมูลที่สร้าง (พื้นฐาน/ปานกลาง/ขั้นสูง) — คิดจากค่าที่ "ต่ำสุด" ของสองคะแนน (condition/reliability)
// เพื่อความระมัดระวัง (conservative) ไม่ให้ตัวเลขตัวใดตัวหนึ่งสูงโดดเด่นมาบดบังอีกตัวที่ยังต่ำอยู่
// ฟังก์ชันนี้คืนค่า level เฉพาะกรณีที่ผ่านเกณฑ์ขั้นต่ำ (MIN_CONDITION_MATCH_PERCENT/MIN_RELIABILITY_PERCENT) แล้วเท่านั้น
// ถ้าไม่ผ่านเกณฑ์ขั้นต่ำ หรือค่าใดค่าหนึ่งเป็น 'N/A' (ตรวจสอบเชิงเนื้อหาล้มเหลวทางเทคนิค) จะคืน null แทน
function computeQualityLevel_(conditionMatchPercent, reliabilityPercent) {
  if (typeof conditionMatchPercent !== 'number' || typeof reliabilityPercent !== 'number') return null;
  if (conditionMatchPercent < MIN_CONDITION_MATCH_PERCENT || reliabilityPercent < MIN_RELIABILITY_PERCENT) return null;
  const minPercent = Math.min(conditionMatchPercent, reliabilityPercent);
  if (minPercent >= 95) return 'ขั้นสูง';
  if (minPercent >= 85) return 'ปานกลาง';
  return 'พื้นฐาน';
}

// เช็คว่าต้องขึ้นแถวป้ายชื่อ "วันนี้" ใหม่ในชีตนี้หรือไม่ — ไล่ตรวจย้อนขึ้นจากแถวสุดท้าย (ใช้ร่วมกันได้ทุกชีตที่คอลัมน์แรกเป็น timestamp)
// ถ้าเจอแถวข้อมูลที่เป็นวันอื่นก่อนเจอ label แปลว่ายังไม่มี label ของวันนี้ ต้องสร้างใหม่
// ถ้าไล่จนสุดถึงหัวตาราง (หรือเจอ label ที่ข้อความไม่ตรง) โดยไม่เจอ label ของวันนี้เลย ก็ต้องสร้างใหม่เช่นกัน
// (กันกรณีมีแถวเก่าค้างอยู่ก่อนเปิดใช้ฟีเจอร์จัดกลุ่มตามวัน ซึ่งจะไม่มี label นำหน้าอยู่จริง)
// dateCol = คอลัมน์ (1-based) ที่เก็บค่า timestamp ของแถวข้อมูล — ปกติคือคอลัมน์ 1 แต่บางชีต (เช่น SavedPrompts) ไม่ได้เอา timestamp ไว้คอลัมน์แรก
function sheetNeedsDateLabel_(sh, tz, now, todayKey, dateCol) {
  dateCol = dateCol || 1;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return true;

  const expectedLabel = '📅 ' + formatThaiDateLabel_(now, tz);
  let r = lastRow;
  while (r >= 2) {
    const dateVal = sh.getRange(r, dateCol).getValue();
    if (dateVal instanceof Date) {
      if (dateKeyOf_(dateVal, tz) !== todayKey) return true;
      r--;
      continue;
    }
    // คอลัมน์วันที่ว่าง แปลว่าแถวนี้ไม่ใช่แถวข้อมูล น่าจะเป็นแถวป้ายชื่อ — ข้อความป้ายชื่อจะอยู่ที่คอลัมน์แรกเสมอไม่ว่า dateCol จะเป็นคอลัมน์ไหน
    const labelVal = sh.getRange(r, 1).getValue();
    return String(labelVal) !== expectedLabel;
  }
  return true;
}

// ขึ้นแถวป้ายชื่อวันที่ (ถ้ายังไม่มี) แล้วคืนค่าไว้ให้ผู้เรียกไปต่อแถวข้อมูลเอง — ใช้ร่วมกันได้ทุกชีตที่ต้องการจัดกลุ่มตามวันแบบเดียวกับ ActivityLogs/QualityScores
// colCount ควรเป็นจำนวนคอลัมน์ล่าสุดของชีต ณ ตอนนั้น (รวมคอลัมน์ที่เพิ่งเติมผ่าน ensureColumnHeader_ แล้ว) เพื่อให้แถบสีป้ายกว้างครอบคลุมทุกคอลัมน์จริง
function insertDateGroupLabelIfNeeded_(sh, tz, now, todayKey, colCount, dateCol) {
  try { sh.setRowGroupControlAfter(false); } catch (e) { /* ข้ามได้ถ้าตั้งค่าไม่สำเร็จ */ }
  if (!sheetNeedsDateLabel_(sh, tz, now, todayKey, dateCol)) return;

  const labelRow = new Array(colCount).fill('');
  labelRow[0] = '📅 ' + formatThaiDateLabel_(now, tz);
  sh.appendRow(labelRow);
  const labelRowIdx = sh.getLastRow();
  sh.getRange(labelRowIdx, 1, 1, colCount).setFontWeight('bold').setBackground('#e0e7ff');
}

// จัดกลุ่มแถวข้อมูลที่เพิ่ง appendRow ไปล่าสุดให้เข้าไปอยู่ใต้แถวป้ายชื่อวันที่ (เรียกทันทีหลัง appendRow แถวข้อมูลเสร็จ)
function groupLastRowUnderDateLabel_(sh) {
  const dataRow = sh.getLastRow();
  try {
    sh.getRange(dataRow, 1).shiftRowGroupDepth(1);
  } catch (e) {
    // ไม่ควรทำให้การบันทึกข้อมูลหลักล้มเหลวเพียงเพราะจัดกลุ่มไม่สำเร็จ
  }
}

// บันทึกคะแนนคุณภาพข้อมูลลง Google Sheet แท็บ QualityScores ทุกครั้งที่ generate สำเร็จ (ไม่ผูกกับการ commit)
// เพื่อให้เอาไปทำรายงาน/ดูสถิติย้อนหลังได้ว่าโดยรวมแล้ว AI สร้างข้อมูลได้ตรงเงื่อนไข/น่าเชื่อถือแค่ไหน
function logQualityScore_(p, rowsActual, conditionMatchPercent, reliabilityPercent, summary, qualityLevel, passMinimumThreshold) {
  try {
    // ใช้ getOrCreateSheet_ แทน getSheet_ เพื่อให้ทำงานได้เองแม้สเปรดชีตเก่าที่ยังไม่เคยรัน setupSheet() ซ้ำหลังเพิ่มแท็บนี้
    // (getSheet_ จะโยน error ทันทีถ้าไม่พบแท็บ ทำให้เขียนคะแนนไม่ลงเลยแบบเงียบๆ โดยไม่มีใครรู้)
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = getOrCreateSheet_(ss, SHEET_NAMES.QUALITY);
    const headers = ['timestamp', 'username', 'role', 'data_type', 'table_name', 'dialect', 'rows_requested', 'rows_actual', 'condition_match_percent', 'reliability_percent', 'summary'];
    setHeadersIfEmpty_(sh, headers);
    // เพิ่มคอลัมน์ใหม่แบบไม่ทำลายชีตเก่าที่มีข้อมูลอยู่แล้ว (เหมือน image_file_id/image_url ที่อื่น) แทนการรื้อ headers เดิม
    ensureColumnHeader_(sh, 'quality_level');
    ensureColumnHeader_(sh, 'pass_minimum_threshold');
    const colCount = sh.getLastColumn();

    const tz = Session.getScriptTimeZone();
    const now = new Date();
    const todayKey = dateKeyOf_(now, tz);

    // จัดกลุ่มตามวันแบบเดียวกับ ActivityLogs — ไล่ตรวจย้อนขึ้นไปจากแถวสุดท้ายว่ามีแถวป้ายชื่อ "วันนี้" จริงๆ อยู่แล้วหรือยัง
    // (เช็คแบบนี้แทนการดูแค่แถวสุดท้ายว่าเป็นวันที่ตรงกันไหม เพื่อรองรับกรณีมีแถวเก่าค้างอยู่ก่อนเปิดใช้ฟีเจอร์นี้ — ถ้าไม่เจอ label จริงจะสร้างให้ใหม่เองอัตโนมัติ)
    insertDateGroupLabelIfNeeded_(sh, tz, now, todayKey, colCount);

    // pass_minimum_threshold: true/false/'' (ค่าว่างหมายถึงประเมินไม่ได้ เพราะตรวจสอบเชิงเนื้อหาล้มเหลวทางเทคนิค — ไม่ใช่ false)
    const passMinCell = (passMinimumThreshold === true) ? 'ผ่าน' : (passMinimumThreshold === false) ? 'ไม่ผ่าน' : 'N/A';

    sh.appendRow([
      now,
      p.username || '',
      p.role || '',
      p.dataType || '',
      p.tableName || '',
      p.dialect || '',
      p.rowsRequested || '',
      rowsActual,
      conditionMatchPercent,
      reliabilityPercent,
      summary || '',
      qualityLevel || 'N/A',
      passMinCell
    ]);
    groupLastRowUnderDateLabel_(sh);
  } catch (e) {
    // ไม่ควรทำให้การสร้างข้อมูลหลักล้มเหลวเพียงเพราะบันทึกคะแนนไม่สำเร็จ แต่ต้องบันทึก log ไว้ให้เห็นว่าเกิดปัญหา ไม่ใช่เงียบหายไปเฉยๆ
    try { logActivity_(p.username, p.role, 'QUALITY_LOG_FAIL', 'บันทึกคะแนนคุณภาพข้อมูลลง QualityScores ไม่สำเร็จ: ' + e.message); } catch (e2) { /* ข้ามได้ */ }
  }
}

function extractJsonFromAiText_(text) {
  let cleaned = String(text).trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) throw new Error('ไม่พบ JSON ในคำตอบของ AI');
  const jsonStr = cleaned.substring(firstBrace, lastBrace + 1);
  const parsed = JSON.parse(jsonStr);
  if (!parsed.rows || !Array.isArray(parsed.rows)) throw new Error('รูปแบบ JSON ที่ AI ตอบกลับไม่มี key "rows" เป็น array');
  return parsed;
}

// ---------------------------------------------------------------------------
// COLUMN SCHEMA RECONCILIATION (ตรรกะตัด/ตรวจคอลัมน์ตามที่ "หลังบ้าน" กำหนดไว้)
// ---------------------------------------------------------------------------
function getColumnSchemaFor_(dataType, tableName) {
  const sh = getSheet_(SHEET_NAMES.SCHEMA);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return null;

  const header = data[0];
  const idx = {
    key: header.indexOf('data_type_key'),
    max: header.indexOf('max_columns'),
    allowed: header.indexOf('allowed_columns_csv'),
    required: header.indexOf('required_columns_csv')
  };

  const normDataType = String(dataType || '').trim().toLowerCase();
  const normTableName = String(tableName || '').trim().toLowerCase();

  let matchRow = null;

  // 1) จับคู่แบบตรงเป๊ะก่อน (data_type หรือ table_name ตรงกับ key)
  for (let i = 1; i < data.length; i++) {
    const key = String(data[i][idx.key] || '').trim().toLowerCase();
    if (!key) continue;
    if (key === normDataType || key === normTableName) { matchRow = data[i]; break; }
  }

  // 2) ถ้าไม่เจอ ลองจับคู่แบบ "มีคำนี้อยู่ใน" (ยืดหยุ่นกับข้อความอิสระที่ผู้ใช้พิมพ์)
  if (!matchRow) {
    for (let i = 1; i < data.length; i++) {
      const key = String(data[i][idx.key] || '').trim().toLowerCase();
      if (!key) continue;
      if (normDataType.indexOf(key) !== -1 || key.indexOf(normDataType) !== -1) { matchRow = data[i]; break; }
    }
  }

  // ไม่พบ config เฉพาะสำหรับประเภทนี้ -> ไม่มีข้อจำกัดคอลัมน์ (ปล่อยผ่านตามที่ AI สร้างมา)
  if (!matchRow) return null;

  return {
    maxColumns: Number(matchRow[idx.max]) || null,
    allowedColumns: String(matchRow[idx.allowed] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
    requiredColumns: String(matchRow[idx.required] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)
  };
}

function reconcileColumns_(rows, schemaConfig) {
  if (!schemaConfig || !schemaConfig.allowedColumns || schemaConfig.allowedColumns.length === 0) {
    return {
      rows: rows,
      droppedColumns: [],
      missingRequired: [],
      keptColumns: rows.length ? Object.keys(rows[0]) : []
    };
  }

  const allowedSet = {};
  schemaConfig.allowedColumns.forEach(function (c) { allowedSet[c] = true; });

  const sourceColumns = rows.length ? Object.keys(rows[0]) : [];
  const keptColumns = sourceColumns.filter(function (c) { return allowedSet[c]; });
  const droppedColumns = sourceColumns.filter(function (c) { return !allowedSet[c]; });

  const newRows = rows.map(function (row) {
    const r = {};
    keptColumns.forEach(function (c) { r[c] = row[c]; });
    return r;
  });

  const requiredColumns = schemaConfig.requiredColumns || [];
  const missingRequired = requiredColumns.filter(function (c) { return keptColumns.indexOf(c) === -1; });

  return { rows: newRows, droppedColumns: droppedColumns, missingRequired: missingRequired, keptColumns: keptColumns };
}

function validateStructure_(rows, formInputs) {
  const errors = [];
  if (rows.length !== formInputs.rowsRequested) {
    errors.push('จำนวนแถวไม่ตรงตามที่ขอ (ขอ ' + formInputs.rowsRequested + ' ได้ ' + rows.length + ')');
  }
  if (!formInputs.allowNull) {
    rows.forEach(function (row, idx) {
      Object.keys(row).forEach(function (k) {
        const v = row[k];
        if (v === null || v === undefined || v === '') {
          errors.push('แถวที่ ' + (idx + 1) + ' คอลัมน์ ' + k + ' มีค่าว่างทั้งที่ไม่อนุญาต (Allow Null = false)');
        }
      });
    });
  }
  return errors;
}

// ---------------------------------------------------------------------------
// SQL BUILDER (รองรับคอลัมน์แบบไดนามิก ไม่ผูกกับ field ตายตัว)
// ---------------------------------------------------------------------------
// ครอบชื่อ identifier (ชื่อตาราง/ชื่อคอลัมน์) ให้ถูกต้องตามธรรมเนียมของแต่ละ dialect เสมอ
// เพื่อป้องกันปัญหาชื่อคอลัมน์ชนกับคำสงวน (reserved word) หรือมีช่องว่าง/อักขระพิเศษ ไม่ว่า AI จะตั้งชื่อคอลัมน์มาว่าอะไรก็ตาม
function quoteIdentifier_(name, dialect) {
  if (dialect === 'PostgreSQL') return '"' + name + '"';
  if (dialect === 'MySQL') return '`' + name + '`';
  if (dialect === 'MS SQL') return '[' + name + ']';
  if (dialect === 'Oracle') return '"' + String(name).toUpperCase() + '"';
  return name;
}

// สคริปต์แบบ MongoDB shell (db.collection.insertMany([...])) สำหรับตัวเลือกฐานข้อมูลแบบ Non-Relational
// MongoDB เก็บข้อมูลเป็นเอกสาร (BSON/JSON-like) อยู่แล้ว จึงใช้ JSON ตรงๆ ไม่ต้อง quote identifier หรือแปลงค่าแบบ SQL dialect อื่น
function buildMongoInsertScript_(rows, tableName) {
  const collection = tableName || 'collection';
  return 'db.' + collection + '.insertMany(\n' + JSON.stringify(rows, null, 2) + '\n);';
}

function buildSqlFromRows_(rows, tableName, dialect) {
  if (!rows.length) return '';
  if (dialect === 'MongoDB') return buildMongoInsertScript_(rows, tableName);

  const columns = Object.keys(rows[0]);
  const quotedTable = quoteIdentifier_(tableName, dialect);
  const quotedColumns = columns.map(function (c) { return quoteIdentifier_(c, dialect); });

  const lines = rows.map(function (row) {
    const values = columns.map(function (col) { return formatSqlValue_(row[col], dialect); });
    return 'INSERT INTO ' + quotedTable + ' (' + quotedColumns.join(', ') + ') VALUES (' + values.join(', ') + ');';
  });

  return lines.join('\n');
}

function formatSqlValue_(val, dialect) {
  if (val === null || val === undefined || val === '') return 'NULL';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') {
    if (dialect === 'PostgreSQL') return val ? 'true' : 'false';
    if (dialect === 'Oracle') return val ? "'Y'" : "'N'";
    return val ? '1' : '0';
  }
  const strVal = String(val);
  if (/^-?\d+(\.\d+)?$/.test(strVal)) return strVal;
  if (strVal.toLowerCase() === 'true' || strVal.toLowerCase() === 'false') {
    const b = strVal.toLowerCase() === 'true';
    if (dialect === 'PostgreSQL') return b ? 'true' : 'false';
    if (dialect === 'Oracle') return b ? "'Y'" : "'N'";
    return b ? '1' : '0';
  }

  // Oracle ไม่รับ string literal วันที่ตรงๆ เหมือน dialect อื่น (PostgreSQL/MySQL/MS SQL แปลงให้อัตโนมัติ)
  // ต้องครอบด้วย TO_DATE(...) พร้อมระบุ format mask ไม่งั้นอาจ query ไม่ผ่านหรือตีความวันที่ผิดตามการตั้งค่า NLS ของฐานข้อมูลปลายทาง
  if (dialect === 'Oracle') {
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(strVal)) {
      const normalized = strVal.replace('T', ' ').split('.')[0];
      return "TO_DATE('" + normalized.replace(/'/g, "''") + "', 'YYYY-MM-DD HH24:MI:SS')";
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(strVal)) {
      return "TO_DATE('" + strVal.replace(/'/g, "''") + "', 'YYYY-MM-DD')";
    }
  }

  return "'" + strVal.replace(/'/g, "''") + "'";
}

// ---------------------------------------------------------------------------
// COMMIT (บันทึกชุดข้อมูลที่ผ่านการตรวจสอบแล้วลง Google Sheet จริง)
// จัดกลุ่มเป็น "หนึ่งรอบ Commit = หนึ่งกลุ่ม" พร้อมแถวป้ายชื่อบอกชื่อชุดข้อมูล/ตาราง ให้เห็นชัดเจนง่ายต่อการตรวจสอบ
// ---------------------------------------------------------------------------
function handleCommit_(p) {
  if (!p.rows || !p.rows.length) {
    return { success: false, error: 'ไม่มีข้อมูลให้บันทึก' };
  }
  const sh = getSheet_(SHEET_NAMES.DATASETS);
  const tz = Session.getScriptTimeZone();
  const now = new Date();

  try { sh.setRowGroupControlAfter(false); } catch (e) { /* ข้ามได้ถ้าตั้งค่าไม่สำเร็จ */ }

  const columns = Object.keys(p.rows[0] || {});
  const colCount = Math.max(columns.length, 1);

  // แถวป้ายชื่อของรอบนี้ — อยู่นอกกลุ่ม (depth 0) จึงมองเห็นเสมอแม้จะยุบกลุ่มข้อมูลด้านล่างไว้
  const labelText = '📦 ' + (p.dataType || p.tableName || 'ชุดข้อมูล') +
    ' | ตาราง: ' + (p.tableName || '-') +
    ' | ผู้บันทึก: ' + (p.username || '-') +
    ' | ' + formatThaiDateLabel_(now, tz) + ' ' + Utilities.formatDate(now, tz, 'HH:mm') +
    ' | ' + p.rows.length + ' แถว';
  sh.appendRow([labelText]);
  const labelRow = sh.getLastRow();
  sh.getRange(labelRow, 1, 1, colCount).merge()
    .setFontWeight('bold').setBackground('#dbeafe').setFontColor('#1e3a8a');
  if (p.sql) {
    sh.getRange(labelRow, 1).setNote('SQL ที่ใช้บันทึกรอบนี้:\n\n' + p.sql);
  }

  // แถวหัวคอลัมน์เฉพาะของรอบนี้ (ชื่อคอลัมน์เปลี่ยนไปตามประเภทข้อมูลที่ AI สร้างในแต่ละรอบ)
  sh.appendRow(columns);
  const headerRow = sh.getLastRow();
  sh.getRange(headerRow, 1, 1, columns.length).setFontWeight('bold').setBackground('#f1f5f9');

  // แถวข้อมูลจริงทีละแถว
  const dataStartRow = sh.getLastRow() + 1;
  const rowsMatrix = p.rows.map(function (row) {
    return columns.map(function (c) {
      const v = row[c];
      return (v !== undefined && v !== null) ? v : '';
    });
  });
  sh.getRange(dataStartRow, 1, rowsMatrix.length, columns.length).setValues(rowsMatrix);
  const dataEndRow = dataStartRow + rowsMatrix.length - 1;

  // จัดกลุ่ม: ยุบตั้งแต่แถวหัวคอลัมน์ถึงแถวข้อมูลแถวสุดท้าย (แถวป้ายชื่อด้านบนไม่ถูกยุบ ทำหน้าที่เป็นหัวเรื่องของกลุ่มเสมอ)
  try {
    sh.getRange(headerRow, 1, dataEndRow - headerRow + 1, 1).shiftRowGroupDepth(1);
  } catch (e) {
    // ไม่ควรทำให้การบันทึกข้อมูลหลักล้มเหลวเพียงเพราะจัดกลุ่มไม่สำเร็จ
  }

  logActivity_(p.username, p.role, 'COMMIT', '[TRANSACTION COMMIT] บันทึกชุดข้อมูล [' + p.dataType + '] ตาราง [' + p.tableName + '] จำนวน ' + p.rows.length + ' แถว ลง Google Sheet สำเร็จ');
  return { success: true };
}

// ---------------------------------------------------------------------------
// ประวัติชุดข้อมูลที่เคย Commit (อ่านอย่างเดียว — ไม่แตะ handleCommit_ หรือโครงสร้างชีต GeneratedDatasets เดิมเลย)
// GeneratedDatasets เป็นชีตที่แต่ละรอบ Commit มีคอลัมน์ไม่เท่ากัน (แล้วแต่ประเภทข้อมูลที่ AI สร้างในรอบนั้น) จึงต้อง "แกะ" โครงสร้าง
// แถวป้ายชื่อ (ขึ้นต้นด้วย 📦) -> แถวหัวคอลัมน์ของรอบนั้น -> แถวข้อมูล ไปเรื่อยๆ จนเจอแถวป้ายชื่อถัดไปหรือจบชีต
// ---------------------------------------------------------------------------
const THAI_MONTHS_LOOKUP_ = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

// แกะวันที่แบบไทยที่ฝังอยู่ในแถวป้ายชื่อ (รูปแบบคงที่จาก formatThaiDateLabel_ ตอน commit เช่น "...| 18 กรกฎาคม 2569 14:32 | 5 แถว")
// คืนค่าเป็น key แบบ 'yyyy-MM-dd' (ปีเป็น ค.ศ.) ไว้ใช้จัดกลุ่มตามวันที่บนหน้าเว็บ — ถ้าแกะไม่ได้คืนค่า null (หน้าเว็บจะจัดกลุ่มเป็น "ไม่ทราบวันที่" แทน)
function parseThaiDateKeyFromLabel_(label) {
  try {
    const parts = String(label).split('|');
    if (parts.length < 4) return null;
    const dateTimePart = parts[3].trim(); // เช่น "18 กรกฎาคม 2569 14:32"
    const m = dateTimePart.match(/^(\d{1,2})\s+(\S+)\s+(\d{4})/);
    if (!m) return null;
    const day = parseInt(m[1], 10);
    const monthIdx = THAI_MONTHS_LOOKUP_.indexOf(m[2]);
    const yearCE = parseInt(m[3], 10) - 543;
    if (monthIdx === -1 || !day || !yearCE) return null;
    const mm = String(monthIdx + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return yearCE + '-' + mm + '-' + dd;
  } catch (e) {
    return null;
  }
}

function parseGeneratedDatasetBatches_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = getOrCreateSheet_(ss, SHEET_NAMES.DATASETS);
  const lastRow = sh.getLastRow();
  const lastCol = Math.max(sh.getLastColumn(), 1);
  if (lastRow < 2) return [];

  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const batches = [];
  let i = 1; // แถวแรก (index 0) เป็นคำอธิบาย placeholder ของทั้งชีต ไม่ใช่ข้อมูลรอบ commit

  while (i < values.length) {
    const firstCell = String(values[i][0] || '');
    if (firstCell.indexOf('📦') === 0) {
      const labelSheetRow = i + 1; // เลขแถวจริงในชีต (1-based) ไว้ดึง note ที่แปะ SQL ไว้
      const label = firstCell;
      i++;
      if (i >= values.length) break;

      const headerRow = values[i].filter(function (h) { return h !== ''; });
      i++;

      const dataRows = [];
      while (i < values.length && String(values[i][0] || '').indexOf('📦') !== 0) {
        if (values[i].every(function (c) { return c === ''; })) { i++; continue; }
        const rowObj = {};
        headerRow.forEach(function (h, idx) { rowObj[h] = values[i][idx]; });
        dataRows.push(rowObj);
        i++;
      }

      batches.push({ labelSheetRow: labelSheetRow, label: label, dateKey: parseThaiDateKeyFromLabel_(label), headers: headerRow, rows: dataRows });
    } else {
      i++; // แถวที่ไม่รู้จัก (กันเหนียวเผื่อรูปแบบเก่ากว่านี้) ข้ามไปเฉยๆ
    }
  }
  return batches;
}

// รายการสรุปย่อของทุกรอบ Commit (ไม่ส่งข้อมูลแถวจริงมาด้วย เพื่อให้โหลดหน้ารายการเร็ว) ให้เลือกก่อนค่อยดึงรายละเอียดเต็ม
function handleGetGeneratedDatasetsList_(p) {
  try {
    const batches = parseGeneratedDatasetBatches_();
    const list = batches.map(function (b, idx) {
      return { batchIndex: idx, label: b.label, dateKey: b.dateKey, rowCount: b.rows.length, columnCount: b.headers.length };
    }).reverse(); // ใหม่สุดขึ้นก่อน
    return { success: true, batches: list };
  } catch (e) {
    return { success: false, error: 'โหลดประวัติชุดข้อมูลไม่สำเร็จ: ' + e.message };
  }
}

// รายละเอียดเต็มของรอบ Commit หนึ่งรอบ (ใช้ batchIndex ตามลำดับที่ปรากฏในชีตจริง นับจาก 0) พร้อม SQL ที่เคยใช้บันทึกรอบนั้น
function handleGetGeneratedDatasetBatch_(p) {
  try {
    const idx = parseInt(p.batchIndex, 10);
    if (isNaN(idx) || idx < 0) return { success: false, error: 'batchIndex ไม่ถูกต้อง' };
    const batches = parseGeneratedDatasetBatches_();
    const b = batches[idx];
    if (!b) return { success: false, error: 'ไม่พบชุดข้อมูลรอบนี้ (อาจถูกลบ/ล้างไปแล้วในชีต)' };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = getOrCreateSheet_(ss, SHEET_NAMES.DATASETS);
    const sql = sh.getRange(b.labelSheetRow, 1).getNote() || '';

    return { success: true, label: b.label, sql: sql, headers: b.headers, rows: b.rows };
  } catch (e) {
    return { success: false, error: 'โหลดข้อมูลชุดนี้ไม่สำเร็จ: ' + e.message };
  }
}

// ลบชุดข้อมูลที่เคย Commit ไว้ 1 รอบ ออกจากชีต GeneratedDatasets ทั้งบล็อก
// (แถวป้ายชื่อ 📦 + แถวหัวคอลัมน์ของรอบนั้น + แถวข้อมูลทั้งหมดของรอบนั้น) ด้วย sh.deleteRows()
// เพื่อกันข้อมูลรกที่ไม่ใช้แล้วค้างอยู่ในชีต ไม่ใช่แค่ล้างค่าในเซลล์ทิ้งไว้เป็นแถวว่าง
function handleDeleteGeneratedDatasetBatch_(p) {
  try {
    const idx = parseInt(p.batchIndex, 10);
    if (isNaN(idx) || idx < 0) return { success: false, error: 'batchIndex ไม่ถูกต้อง' };
    const batches = parseGeneratedDatasetBatches_();
    const b = batches[idx];
    if (!b) return { success: false, error: 'ไม่พบชุดข้อมูลรอบนี้แล้ว (อาจถูกลบไปก่อนหน้านี้) กรุณารีเฟรชรายการแล้วลองใหม่' };

    // เช็คซ้ำว่า label ของรอบนี้ตรงกับที่หน้าเว็บคาดไว้ก่อนลบจริง กันกรณีลำดับ batchIndex เปลี่ยนไปจากการ commit/ลบแทรกก่อนหน้านี้
    if (p.label && b.label !== p.label) {
      return { success: false, error: 'ข้อมูลรอบนี้เปลี่ยนไปแล้ว กรุณารีเฟรชรายการแล้วลองใหม่อีกครั้ง' };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = getOrCreateSheet_(ss, SHEET_NAMES.DATASETS);
    const startRow = b.labelSheetRow;
    const numRows = 2 + b.rows.length; // แถวป้ายชื่อ 1 + แถวหัวคอลัมน์ 1 + แถวข้อมูล b.rows.length แถว
    sh.deleteRows(startRow, numRows);

    logActivity_(p.username, p.role, 'DELETE_GENERATED_DATASET', 'ลบชุดข้อมูลที่เคย Commit ไว้ออกจากระบบ: "' + b.label + '" (' + b.rows.length + ' แถว)');
    return { success: true };
  } catch (e) {
    return { success: false, error: 'ลบชุดข้อมูลไม่สำเร็จ: ' + e.message };
  }
}

// ---------------------------------------------------------------------------
// SAVED PROMPTS (เก็บ prompt ที่เคยใช้ไว้เรียกซ้ำ)
// ---------------------------------------------------------------------------

// บันทึก prompt เต็มที่ "ส่งจริง" ไปให้ AI ทุกครั้งที่มีการ Generate ข้อมูลสำเร็จ (อัตโนมัติ ไม่ต้องรอผู้ใช้กดบันทึกเอง)
// ---------------------------------------------------------------------------
// SCHEMA IMAGE STORAGE (Google Drive)
// ---------------------------------------------------------------------------
// เก็บรูป Schema/ER Diagram ไว้ที่ Drive แทนที่จะแปะ base64 ตรงๆ ลง cell ของ Sheet
// เพราะ Google Sheets จำกัดความยาวต่อ cell ไว้ที่ 50,000 ตัวอักษร ส่วนรูปภาพเข้ารหัส base64 มักยาวเกินนั้นมาก
function getOrCreateImagesFolder_() {
  const props = PropertiesService.getScriptProperties();
  const cachedId = props.getProperty('IMAGES_FOLDER_ID');
  if (cachedId) {
    try { return DriveApp.getFolderById(cachedId); } catch (e) { /* โฟลเดอร์อาจถูกลบไปแล้ว ให้สร้างใหม่ต่อด้านล่าง */ }
  }
  const folderName = 'TestDataSimulator_SchemaImages';
  const it = DriveApp.getFoldersByName(folderName);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
  props.setProperty('IMAGES_FOLDER_ID', folder.getId());
  return folder;
}

// แปลง data URL (data:image/png;base64,....) เป็นไฟล์เก็บลง Drive แล้วคืน fileId/url กลับมาให้บันทึกลง Sheet
// คืนค่า null ถ้าไม่มีรูปแนบมาตั้งแต่แรก หรือคืน { error: ... } ถ้าแปลง/บันทึกไม่สำเร็จ (เช่น ยังไม่ได้ authorize สิทธิ์ Drive)
// ผู้เรียกต้องเช็ค .error เอง แล้ว log ไว้ให้เห็นสาเหตุจริงใน ActivityLogs แทนที่จะปล่อยให้ image_file_id ว่างแบบไม่รู้สาเหตุ
function saveImageToDrive_(dataUrl, fileNameHint) {
  if (!dataUrl) return null;
  const match = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return { error: 'รูปแบบข้อมูลรูปภาพไม่ถูกต้อง (ไม่ใช่ data URL ของรูปภาพ)' };
  try {
    const mimeType = match[1];
    const base64Data = match[2];
    const bytes = Utilities.base64Decode(base64Data);
    const ext = mimeType.split('/')[1] || 'png';
    const safeHint = String(fileNameHint || 'schema').replace(/[^a-zA-Z0-9ก-๙_-]/g, '_').slice(0, 40);
    const fileName = safeHint + '_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss') + '.' + ext;
    const blob = Utilities.newBlob(bytes, mimeType, fileName);
    const folder = getOrCreateImagesFolder_();
    const file = folder.createFile(blob);
    return { fileId: file.getId(), url: file.getUrl() };
  } catch (e) {
    return { error: e.message };
  }
}

// ดึงรูปที่เคยบันทึกไว้กลับมาเป็น base64 ให้หน้าเว็บเอาไปใส่ในฟอร์มได้ทันที (ใช้ตอนโหลด Prompt ที่เคยบันทึกไว้กลับมาใช้)
function handleGetSavedImage_(p) {
  if (!p.fileId) return { success: false, error: 'ไม่พบ fileId ของรูปภาพ' };
  try {
    const file = DriveApp.getFileById(p.fileId);
    const blob = file.getBlob();
    const base64 = Utilities.base64Encode(blob.getBytes());
    const mimeType = blob.getContentType() || 'image/png';
    return { success: true, imageBase64: 'data:' + mimeType + ';base64,' + base64 };
  } catch (e) {
    return { success: false, error: 'ดึงรูปภาพไม่สำเร็จ: ' + e.message };
  }
}

// ใช้แท็บ GeneratedPromptLogs แยกต่างหากจาก SavedPrompts โดยเจตนา — นี่คือกรณี "สร้างข้อมูลแล้วไม่ได้ตั้งใจบันทึกไว้ใช้ต่อ"
// เก็บไว้เป็นประวัติ/ตรวจสอบย้อนหลังว่าส่ง prompt อะไรไปให้ AI บ้างในแต่ละครั้งเท่านั้น ไม่ปนกับรายการที่ตั้งใจบันทึกไว้ใช้ซ้ำ
function logGeneratedPrompt_(p, smartPrompt, allowNull, rowsRequested) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = getOrCreateSheet_(ss, SHEET_NAMES.PROMPT_LOGS);
    setHeadersIfEmpty_(sh, ['timestamp', 'username', 'role', 'data_type', 'table_name', 'dialect', 'rows_requested', 'allow_null', 'ddl_script', 'prompt_addition', 'full_prompt_text', 'image_file_id', 'image_url']);
    ensureColumnHeader_(sh, 'image_file_id');
    ensureColumnHeader_(sh, 'image_url');

    // จัดกลุ่มตามวันแบบเดียวกับ ActivityLogs/QualityScores — timestamp อยู่คอลัมน์แรกของชีตนี้
    const tz = Session.getScriptTimeZone();
    const now = new Date();
    const todayKey = dateKeyOf_(now, tz);
    insertDateGroupLabelIfNeeded_(sh, tz, now, todayKey, sh.getLastColumn());

    // ถ้ามีการแนบรูป Schema/ER Diagram มาด้วยตอนกด Generate ให้บันทึกลง Drive แล้วเก็บลิงก์ไว้ในแถวนี้ด้วย
    let imageInfo = null;
    if (p.schemaImageBase64) {
      imageInfo = saveImageToDrive_(p.schemaImageBase64, p.tableName);
      if (imageInfo && imageInfo.error) {
        try { logActivity_(p.username, p.role, 'IMAGE_SAVE_FAIL', 'บันทึกรูป Schema/ER Diagram ลง Drive ไม่สำเร็จ: ' + imageInfo.error); } catch (e2) { /* ข้ามได้ */ }
        imageInfo = null;
      }
    }

    sh.appendRow([
      now,
      p.username || '',
      p.role || '',
      p.dataType || '',
      p.tableName || '',
      p.dialect || '',
      rowsRequested || '',
      !!allowNull,
      p.ddlScript || '',
      p.promptAddition || '',
      smartPrompt || '',
      imageInfo ? imageInfo.fileId : '',
      imageInfo ? imageInfo.url : ''
    ]);
    groupLastRowUnderDateLabel_(sh);
  } catch (e) {
    try { logActivity_(p.username, p.role, 'PROMPT_LOG_FAIL', 'บันทึก prompt อัตโนมัติลง GeneratedPromptLogs ไม่สำเร็จ: ' + e.message); } catch (e2) { /* ข้ามได้ */ }
  }
}

function handleSavePrompt_(p) {
  if (!p.promptName) return { success: false, error: 'กรุณาระบุชื่อ prompt ที่จะบันทึก' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = getOrCreateSheet_(ss, SHEET_NAMES.PROMPTS);
  setHeadersIfEmpty_(sh, ['prompt_name', 'created_by', 'created_at', 'data_type', 'table_name', 'dialect', 'rows_requested', 'allow_null', 'ddl_script', 'prompt_addition', 'full_prompt_text', 'image_file_id', 'image_url']);
  ensureColumnHeader_(sh, 'image_file_id');
  ensureColumnHeader_(sh, 'image_url');

  // จัดกลุ่มตามวันแบบเดียวกับ ActivityLogs/QualityScores — แต่ชีตนี้ timestamp (created_at) อยู่คอลัมน์ที่ 3 ไม่ใช่คอลัมน์แรก (คอลัมน์แรกคือ prompt_name)
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const todayKey = dateKeyOf_(now, tz);
  insertDateGroupLabelIfNeeded_(sh, tz, now, todayKey, sh.getLastColumn(), 3);

  // ถ้าตอนบันทึก prompt มีรูป Schema/ER Diagram แนบอยู่ในฟอร์มด้วย ให้บันทึกลง Drive แล้วผูกลิงก์ไว้
  // เพื่อให้ตอน "โหลดมาใช้" ครั้งหน้า ดึงรูปเดิมกลับมาใส่ในฟอร์มให้อัตโนมัติได้เลย ไม่ต้องอัปโหลดซ้ำ
  let imageInfo = null;
  if (p.imageBase64) {
    imageInfo = saveImageToDrive_(p.imageBase64, p.tableName);
    if (imageInfo && imageInfo.error) {
      try { logActivity_(p.username, p.role, 'IMAGE_SAVE_FAIL', 'บันทึกรูป Schema/ER Diagram ลง Drive ไม่สำเร็จ: ' + imageInfo.error); } catch (e2) { /* ข้ามได้ */ }
      imageInfo = null;
    }
  }

  sh.appendRow([
    p.promptName,
    p.username || '',
    now,
    p.dataType || '',
    p.tableName || '',
    p.dialect || '',
    p.rowsRequested || '',
    !!(p.allowNull === true || p.allowNull === 'true'),
    p.ddlScript || '',
    p.promptAddition || '',
    p.fullPromptText || '',
    imageInfo ? imageInfo.fileId : '',
    imageInfo ? imageInfo.url : ''
  ]);
  groupLastRowUnderDateLabel_(sh);
  logActivity_(p.username, p.role, 'SAVE_PROMPT', 'บันทึก prompt ชื่อ "' + p.promptName + '" ไว้ใช้ซ้ำ' + (imageInfo ? ' (พร้อมรูปภาพแนบ)' : ''));
  return { success: true };
}

// ดึงประวัติคะแนนคุณภาพข้อมูลทั้งหมด (ใหม่สุดขึ้นก่อน) ให้หน้าเว็บเอาไปแสดง/เลือกออกรายงานได้
function handleGetQualityScores_(p) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = getOrCreateSheet_(ss, SHEET_NAMES.QUALITY);
  setHeadersIfEmpty_(sh, ['timestamp', 'username', 'role', 'data_type', 'table_name', 'dialect', 'rows_requested', 'rows_actual', 'condition_match_percent', 'reliability_percent', 'summary']);

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return { success: true, scores: [] };

  const header = data[0];
  const tz = Session.getScriptTimeZone();
  const scores = data.slice(1)
    // ข้ามแถวป้ายชื่อวันที่ (เช่น "📅 18 กรกฎาคม 2569") ที่แทรกไว้เพื่อจัดกลุ่มตามวันในชีต — แถวจริงคอลัมน์ timestamp ต้องเป็น Date เท่านั้น
    .filter(function (row) { return row[0] instanceof Date; })
    .map(function (row) {
      const obj = {};
      header.forEach(function (h, i) {
        let v = row[i];
        if (h === 'timestamp' && v instanceof Date) {
          v = Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss');
        }
        obj[h] = v;
      });
      return obj;
    }).reverse();

  return { success: true, scores: scores };
}

function handleGetSavedPrompts_(p) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = getOrCreateSheet_(ss, SHEET_NAMES.PROMPTS);
  setHeadersIfEmpty_(sh, ['prompt_name', 'created_by', 'created_at', 'data_type', 'table_name', 'dialect', 'rows_requested', 'allow_null', 'ddl_script', 'prompt_addition', 'full_prompt_text', 'image_file_id', 'image_url']);

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return { success: true, prompts: [] };

  const header = data[0];
  const createdAtCol = header.indexOf('created_at');
  // ไม่ต้องกรอง AUTO_ อีกต่อไป เพราะ prompt ที่เกิดจาก Generate ทุกครั้งแยกไปอยู่แท็บ GeneratedPromptLogs ต่างหากแล้ว
  // แท็บนี้ (SavedPrompts) จึงมีแต่รายการที่ผู้ใช้ตั้งใจกด "บันทึก" ไว้ใช้ซ้ำเท่านั้น
  // ข้ามแถวป้ายชื่อวันที่ (เช่น "📅 18 กรกฎาคม 2569") ที่แทรกไว้เพื่อจัดกลุ่มตามวัน — แถวข้อมูลจริงคอลัมน์ created_at ต้องเป็น Date เท่านั้น
  // แนบ sheetRow (เลขแถวจริงในชีต นับแบบ 1-based) ไปกับแต่ละรายการด้วย เพื่อให้ตอนกด "ลบ" จากหน้าเว็บ
  // รู้ตำแหน่งแถวที่แน่นอนสำหรับลบทั้งแถวออกจากชีตจริง ไม่ใช่แค่ล้างค่า (กันแถวว่างค้าง)
  const prompts = data
    .map(function (row, idx) { return { row: row, sheetRow: idx + 1 }; }) // idx 0 = แถวที่ 1 ในชีต (header), idx 1 = แถวที่ 2, ...
    .slice(1)
    .filter(function (entry) { return createdAtCol === -1 || entry.row[createdAtCol] instanceof Date; })
    .map(function (entry) {
      const obj = { sheetRow: entry.sheetRow };
      header.forEach(function (h, i) { obj[h] = entry.row[i]; });
      return obj;
    })
    .reverse(); // ใหม่สุดขึ้นก่อน

  return { success: true, prompts: prompts };
}

// ลบ prompt ที่บันทึกไว้ 1 รายการ ออกจากชีต SavedPrompts แบบลบทั้งแถวจริง (sh.deleteRow)
// เพื่อกันแถวว่างค้างอยู่ในชีต — ไม่ใช่แค่ล้างค่าในเซลล์
function handleDeletePrompt_(p) {
  const sheetRow = parseInt(p.sheetRow, 10);
  if (!sheetRow || isNaN(sheetRow) || sheetRow < 2) {
    return { success: false, error: 'ไม่พบตำแหน่งแถวของ Prompt ที่จะลบ กรุณารีเฟรชรายการแล้วลองใหม่' };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = getOrCreateSheet_(ss, SHEET_NAMES.PROMPTS);

  if (sheetRow > sh.getLastRow()) {
    return { success: false, error: 'ไม่พบ Prompt นี้แล้ว (อาจถูกลบไปก่อนหน้านี้) กรุณารีเฟรชรายการแล้วลองใหม่' };
  }

  // เช็คซ้ำว่าชื่อ prompt ที่แถวนี้ตรงกับที่หน้าเว็บคาดไว้ก่อนลบจริง กันกรณีแถวเลื่อนตำแหน่งไปแล้ว (เช่น มีการบันทึก/ลบ prompt อื่นแทรกก่อนหน้านี้)
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const nameCol = header.indexOf('prompt_name');
  if (p.promptName && nameCol !== -1) {
    const actualName = sh.getRange(sheetRow, nameCol + 1).getValue();
    if (String(actualName) !== String(p.promptName)) {
      return { success: false, error: 'ตำแหน่งของ Prompt นี้เปลี่ยนไปแล้ว กรุณารีเฟรชรายการแล้วลองใหม่อีกครั้ง' };
    }
  }

  sh.deleteRow(sheetRow);
  logActivity_(p.username, p.role, 'DELETE_PROMPT', 'ลบ prompt ที่บันทึกไว้ชื่อ "' + (p.promptName || '') + '" ออกจากระบบ');
  return { success: true };
}

// ---------------------------------------------------------------------------
// ACTIVITY LOG (จัดกลุ่มตามวันที่ให้อัตโนมัติ พร้อมแถวป้ายชื่อวันที่ให้เห็นชัดเจน)
// ---------------------------------------------------------------------------
function logActivity_(username, role, actionType, detail) {
  const sh = getSheet_(SHEET_NAMES.LOGS);
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const todayKey = dateKeyOf_(now, tz);

  try { sh.setRowGroupControlAfter(false); } catch (e) { /* ข้ามได้ถ้าตั้งค่าไม่สำเร็จ */ }

  // เช็คว่าแถวสุดท้ายในชีตเป็นข้อมูลของ "วันนี้" อยู่แล้วหรือยัง ถ้ายัง ต้องขึ้นแถวป้ายชื่อวันที่ใหม่ก่อน
  const lastRow = sh.getLastRow();
  let needsNewLabel = true;
  if (lastRow >= 2) {
    const lastVal = sh.getRange(lastRow, 1).getValue();
    if (lastVal instanceof Date && dateKeyOf_(lastVal, tz) === todayKey) {
      needsNewLabel = false;
    }
  }

  if (needsNewLabel) {
    sh.appendRow(['📅 ' + formatThaiDateLabel_(now, tz), '', '', '', '']);
    const labelRow = sh.getLastRow();
    sh.getRange(labelRow, 1, 1, 5).setFontWeight('bold').setBackground('#e0e7ff');
  }

  sh.appendRow([now, username || '', role || '', actionType, detail]);
  const dataRow = sh.getLastRow();
  try {
    sh.getRange(dataRow, 1).shiftRowGroupDepth(1);
  } catch (e) {
    // ไม่ควรทำให้การบันทึก log ทั้งหมดล้มเหลวเพียงเพราะจัดกลุ่มไม่สำเร็จ
  }
}

// ---------------------------------------------------------------------------
// SHEET HELPERS
// ---------------------------------------------------------------------------
function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('ไม่พบ sheet ชื่อ "' + name + '" — กรุณารันฟังก์ชัน setupSheet() ก่อนใช้งาน');
  return sh;
}

function getOrCreateSheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function setHeadersIfEmpty_(sh, headers) {
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
}

// migration helper: เผื่อ sheet ที่มีอยู่แล้วจากเวอร์ชันเก่ายังไม่มีคอลัมน์นี้ (setHeadersIfEmpty_ จะไม่เพิ่มให้เพราะ sheet ไม่ว่างแล้ว)
// จึงต้องเช็คแยกแล้วเติมคอลัมน์ต่อท้ายให้เอง แบบไม่กระทบข้อมูลเดิมที่มีอยู่
function ensureColumnHeader_(sh, headerName) {
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const headerRow = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  let idx = headerRow.indexOf(headerName);
  if (idx === -1) {
    const newCol = lastCol + 1;
    sh.getRange(1, newCol).setValue(headerName).setFontWeight('bold');
    idx = newCol - 1;
  }
  return idx + 1; // คืนเลขคอลัมน์แบบ 1-based
}

function seedAdminIfEmpty_(sh) {
  if (sh.getLastRow() <= 1) {
    const salt = generateSalt_();
    const hash = hashPassword_('SecurePassword!1', salt);
    sh.appendRow(['Admin123', salt, hash, 'Super_Admin', new Date()]);
  }
}

function seedDefaultSchemaIfEmpty_(sh) {
  // ไม่ seed แถวตัวอย่างใดๆ ไว้ล่วงหน้า — ปล่อยให้แท็บนี้ว่างเปล่าโดยตั้งใจ
  // เพื่อให้ทุกประเภทข้อมูล/ตารางยืดหยุ่นเต็มที่ตามเงื่อนไขที่ผู้ใช้กรอกในหน้าเว็บ (DDL, คำอธิบาย, เงื่อนไขเพิ่มเติม)
  // ถ้าต้องการ "ล็อก" คอลัมน์ของประเภทข้อมูล/ตารางใดโดยเฉพาะ ให้เพิ่มแถวในแท็บนี้เองภายหลังได้ตลอด (ไม่ต้องแก้โค้ด)
  // การจำกัดคอลัมน์จะมีผลเฉพาะเมื่อผู้ใช้ "ไม่ได้แนบ DDL Script" และมีแถว config ที่ตรงกับ data_type/table ที่พิมพ์เท่านั้น
}
