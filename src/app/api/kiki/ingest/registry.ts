import type { Handler } from "./types";
import { introHandler, docFilesHandler } from "./handlers/intro";
import { tasksHandler, memoryRecallHandler } from "./handlers/tasks";
import {
  financeAdviceHandler, financeDeleteLastHandler, financeEditHandler, budgetHandler, ownAccountsHandler,
  balanceHandler, forecastHandler, billHandler, merchantsHandler, financeHealthHandler, financeAnalyzeHandler,
  financeItemizeHandler, financeQueryHandler, pendingBatchHandler, pendingListHandler, pendingAnswerHandler,
  financeRecordHandler,
} from "./handlers/finance";
import { socialStatusHandler, socialDraftHandler } from "./handlers/social";
import { hermesHandler, sayVoiceHandler, voiceAnnounceHandler, voiceModeHandler, devConfirmHandler, selfDevHandler, macHandler, voicePickHandler } from "./handlers/system";
import {
  dmConfirmHandler, groupConfirmHandler, createGroupHandler, listChatsHandler, aliasHandler,
  groupPostHandler, dmHandler, chatSummaryHandler,
} from "./handlers/telegram";
import { imageSaveHandler, imageFindHandler } from "./handlers/media";
import { ruleTeachHandler, ruleListHandler, rememberHandler, forgetHandler, memoryListHandler } from "./handlers/memory";
import { wishHandler, debtHandler, recurringHandler, fitnessHandler, diaryHandler } from "./handlers/life";
import { linkSaveHandler, researchHandler, docSummaryHandler } from "./handlers/research";
import { calendarEditHandler, calendarViewHandler, calendarCreateHandler } from "./handlers/calendar";
import { chatFallbackHandler } from "./handlers/chat";
import { jobStatusHandler, autoBackgroundHandler } from "./handlers/jobs";
import { eyesHandler } from "./handlers/eyes";
import { undoSendHandler, confirmReplyHandler, replyToPersonHandler, trustHandler } from "./handlers/reply";
import { guiHandler } from "./handlers/gui";

/**
 * ทะเบียนเส้นทางของ Vex — เดินจากบนลงล่าง ตัวไหนคืนคำตอบก่อนก็จบ
 *
 * ลำดับสำคัญมาก และตรงกับของเดิมเป๊ะ (บรรทัด 372-1586 ของ route.ts ก่อนผ่า)
 * มีหลายคู่ที่ต้องมาก่อน/หลังกันเป๊ะ ๆ ไม่งั้นพังเงียบ เช่น
 *   - docFiles ต้องมาก่อนทุกอย่าง (ไฟล์ที่ส่งมาต้องถูกอ่านก่อนตีความเจตนา)
 *   - imageSave ต้องมาก่อน financeRecord (ไม่งั้นรูปที่สั่งเก็บโดนตีเป็นสลิป)
 *   - recurring ต้องมาก่อน calendar ("เตือนทุกวันที่ 25" ไม่ใช่นัด)
 *   - docSummary ต้องมาก่อน chatFallback และมาหลัง research
 * เพิ่มเส้นทางใหม่ = แทรกในลำดับที่ถูก แล้วเพิ่ม intent ใน INTENT_CATALOG (kiki-router.ts)
 */
export const HANDLERS: Handler[] = [
  // "Vex ถอน" — ต้องมาก่อนทุกอย่าง มีเวลาแค่ 30 วินาที
  undoSendHandler,
  // ยืนยัน/แก้ร่างที่อ่านทวนไปแล้ว — ต้องมาก่อนตัวที่สร้างร่างใหม่
  confirmReplyHandler,

  // ทักครั้งแรก + ไฟล์เอกสาร — ต้องมาก่อนตัวอ่านเจตนา
  introHandler,
  docFilesHandler,

  // กระดานงาน + ความจำบทสนทนา
  tasksHandler,
  memoryRecallHandler,

  // ที่ปรึกษาการเงิน (ต้องมาก่อนเส้นทางเงินตัวอื่น — ข้อความยาวมีหลายตัวเลข)
  financeAdviceHandler,

  // โซเชียล
  socialStatusHandler,
  socialDraftHandler,

  // คุมว่าจะเฝ้าข้อความเข้าจากแชทไหน
  eyesHandler,

  // งานเบื้องหลัง — jobStatus ต้องมาก่อน hermes (ไม่งั้น "งานถึงไหนแล้ว" ถูกตีเป็นสั่งงานใหม่ซ้ำ)
  jobStatusHandler,
  hermesHandler,

  // การเงิน
  financeDeleteLastHandler,
  financeEditHandler,
  budgetHandler,
  ownAccountsHandler,
  balanceHandler,
  forecastHandler,
  billHandler,
  merchantsHandler,
  financeHealthHandler,
  financeAnalyzeHandler,
  financeItemizeHandler,
  financeQueryHandler,

  // เสียง (voiceAnnounce = พูดขึ้นมาเอง · voiceMode = ตอบเป็นเสียง — คนละเรื่องกัน)
  // พูดประโยคที่สั่ง (say_voice) ต้องมาก่อนตั้งค่าโหมดเสียง — ไม่งั้นโดนตีเป็น "เปิดโหมดเสียง"
  sayVoiceHandler,
  voiceAnnounceHandler,
  voiceModeHandler,

  // ยืนยันที่ค้างอยู่ (ต้องมาก่อนตัวที่สร้างงานใหม่)
  dmConfirmHandler,
  devConfirmHandler,
  selfDevHandler,
  groupConfirmHandler,

  // Telegram userbot
  createGroupHandler,
  listChatsHandler,
  aliasHandler,
  groupPostHandler,
  // ปรับความไว้ใจ ต้องมาก่อนตัวส่งจริง · replyToPerson แทน dmHandler เดิม (มีสไตล์+ความไว้ใจ)
  trustHandler,
  replyToPersonHandler,
  dmHandler,
  chatSummaryHandler,

  // เครื่อง Mac + เลือกเสียง
  // คุมแอปบนเครื่อง (พิมพ์/สลับห้อง/สั่ง Warp) — ต้องมาก่อน macHandler ตัวเดิม
  guiHandler,
  macHandler,
  voicePickHandler,

  // คลังรูป (ต้องมาก่อนบันทึกเงิน — ไม่งั้นรูปที่สั่งเก็บโดนตีเป็นสลิป)
  imageSaveHandler,
  imageFindHandler,

  // กฎที่สอนไว้
  ruleTeachHandler,
  ruleListHandler,

  // รายการเงินที่ยังไม่ระบุหมวด
  pendingBatchHandler,
  pendingListHandler,
  pendingAnswerHandler,

  // ชีวิตประจำวัน (recurring ต้องมาก่อนปฏิทิน)
  wishHandler,
  debtHandler,
  recurringHandler,
  fitnessHandler,
  diaryHandler,

  // บันทึกรายรับรายจ่าย
  financeRecordHandler,

  // ความจำถาวร
  rememberHandler,
  forgetHandler,
  memoryListHandler,

  // ลิงก์ + ปฏิทิน
  linkSaveHandler,
  calendarEditHandler,
  calendarViewHandler,
  calendarCreateHandler,

  // ค้นเว็บ + ทำเอกสาร — autoBackground ดักก่อน: งานยาวต้องตอบรับแล้วไปทำเบื้องหลัง
  // ไม่ใช่ให้เจ้าของนั่งรอจนจบในคำขอเดียว (สเปกข้อ 15ก)
  autoBackgroundHandler,
  researchHandler,
  docSummaryHandler,

  // คุยปกติ — ตัวสุดท้ายเสมอ รับทุกอย่างที่เหลือ
  chatFallbackHandler,
];
