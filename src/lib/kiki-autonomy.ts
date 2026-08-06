import { getSetting, setSetting } from "./kiki";

/**
 * ระดับความอิสระต่อ "การกระทำ" (จิตใจเฟส 5 — 6 ส.ค. 2026)
 *
 * "อิสระ" ไม่ได้แปลว่าทำอะไรก็ได้ แต่แปลว่ารู้ว่าอะไรทำได้เองโดยไม่ต้องถาม
 *
 *   0 ทำเลย ไม่ต้องบอก   — ย้อนกลับได้ ไม่มีผลกับคนอื่น
 *   1 ทำเลย แล้วบอก      — ย้อนกลับได้ แต่เจ้าของควรรู้
 *   2 เสนอก่อน รอไฟเขียว — มีผลกับคนอื่น หรือถอนยาก
 *   3 ห้ามแตะ            — ไม่มีเส้นทางให้ทำ ไม่ว่ากรณีไหน
 *
 * ต่างจาก "ความไว้ใจรายคน" (kiki-reply trust 0/1/2 — ใครคุยแทนได้แค่ไหน) ตรงที่
 * อันนี้คือระดับต่อชนิดการกระทำทั้งระบบ — สองชั้นทำงานร่วมกัน ไม่แทนกัน
 *
 * การเรียนรู้ระดับ (สเปกเจ้าของ):
 *  - อนุมัติเรื่องเดิมติดกัน 5 ครั้ง → **เสนอ**เลื่อนขึ้นระดับอิสระกว่า (ห้ามเลื่อนเองเงียบ ๆ)
 *  - เคยทำแล้วเจ้าของไม่พอใจ → ลดระดับทันที (demote) และบันทึกเป็นบทเรียน
 */

export type AutonomyLevel = 0 | 1 | 2 | 3;

export const ACTION_LEVELS: { key: string; level: AutonomyLevel; what: string }[] = [
  // 0 — เงียบได้
  { key: "memory_index", level: 0, what: "จัดหมวด/ดัชนีความจำภายใน" },
  // 1 — ทำแล้วบอก
  { key: "task_add", level: 1, what: "จดงานเข้ากระดาน" },
  { key: "task_done", level: 1, what: "ปิดงานที่เจ้าของบอกว่าเสร็จ" },
  { key: "calendar_create", level: 1, what: "ลงนัดที่เจ้าของพูดวันเวลาชัด" },
  { key: "link_save", level: 1, what: "เก็บลิงก์เข้าคลัง (เฉพาะที่สั่ง)" },
  { key: "memory_write", level: 1, what: "จำข้อเท็จจริงเกี่ยวกับเจ้าของ" },
  // 2 — เสนอก่อนเสมอ
  { key: "dm_send", level: 2, what: "ส่งข้อความในนามเจ้าของ" },
  { key: "social_post", level: 2, what: "โพสต์/ตอบโซเชียลในนามเจ้าของ" },
  { key: "group_create", level: 2, what: "สร้างกลุ่ม Telegram" },
  { key: "finance_reset", level: 2, what: "ล้างข้อมูลเงิน (มีไฟล์สำรอง)" },
  { key: "self_dev", level: 2, what: "แก้โค้ดตัวเอง" },
  // 3 — ห้ามแตะ (ไม่มีเส้นทางในระบบ และห้ามสร้าง)
  { key: "perm_change", level: 3, what: "เปลี่ยนสิทธิ์/ผูก-ถอนบัญชีเจ้าของเอง" },
  { key: "hard_delete", level: 3, what: "ลบข้อมูลถาวรแบบไม่มีสำรอง" },
  { key: "money_transfer", level: 3, what: "โอน/จ่ายเงินจริง" },
];

const OVERRIDE_KEY = "vex_autonomy";        // {"dm_send":1} — ระดับที่เจ้าของอนุมัติให้เลื่อนแล้ว
const TRACK_KEY = "vex_autonomy_track";     // {"dm_send":{"streak":3,"proposed":false,"at":ms}}

async function overrides(): Promise<Record<string, AutonomyLevel>> {
  try {
    return JSON.parse((await getSetting(OVERRIDE_KEY)) || "{}") as Record<string, AutonomyLevel>;
  } catch {
    return {};
  }
}

/** ระดับปัจจุบันของการกระทำ — override (ที่เจ้าของเคาะแล้ว) ชนะตารางตั้งต้น · ระดับ 3 ห้าม override */
export async function actionLevel(key: string): Promise<AutonomyLevel> {
  const base = ACTION_LEVELS.find((a) => a.key === key)?.level ?? 2; // ไม่รู้จัก = ขอก่อน ปลอดภัยสุด
  if (base === 3) return 3;
  const ov = (await overrides())[key];
  return ov !== undefined && ov >= 0 && ov <= 2 ? ov : base;
}

interface Track {
  streak: number;
  proposed: boolean;
  at: number;
}

async function tracks(): Promise<Record<string, Track>> {
  try {
    return JSON.parse((await getSetting(TRACK_KEY)) || "{}") as Record<string, Track>;
  } catch {
    return {};
  }
}

export interface ApprovalResult {
  streak: number;
  /** ครบเกณฑ์แล้ว — ผู้เรียกควรต่อท้ายข้อเสนอ "เลื่อนระดับไหม" ให้เจ้าของเคาะ */
  shouldPropose: boolean;
}

const PROPOSE_AT = 5; // อนุมัติติดกันกี่ครั้งถึงเสนอ (สเปกเจ้าของ: 5)

/**
 * บันทึกผลการขออนุมัติของการกระทำระดับ 2
 * approved ติดกันครบ 5 + ยังเป็นระดับ 2 + ยังไม่เคยเสนอ → shouldPropose (เสนอครั้งเดียว ไม่พร่ำ)
 * ไม่อนุมัติ = streak เริ่มนับใหม่
 */
export async function recordApproval(key: string, approved: boolean): Promise<ApprovalResult> {
  const t = await tracks();
  const cur: Track = t[key] || { streak: 0, proposed: false, at: 0 };
  cur.streak = approved ? cur.streak + 1 : 0;
  cur.at = Date.now();
  const level = await actionLevel(key);
  const shouldPropose = approved && level === 2 && cur.streak >= PROPOSE_AT && !cur.proposed;
  if (shouldPropose) cur.proposed = true; // เสนอครั้งเดียวพอ — เจ้าของไม่ตอบ = ไม่เอา อย่าถามซ้ำ
  t[key] = cur;
  await setSetting(TRACK_KEY, JSON.stringify(t)).catch(() => {});
  return { streak: cur.streak, shouldPropose };
}

/** เจ้าของตอบรับข้อเสนอ → เลื่อนเป็นระดับ 1 (ทำเลยแล้วบอก) — เลื่อนได้เฉพาะที่เจ้าของเคาะเอง */
export async function promoteAction(key: string): Promise<void> {
  const ov = await overrides();
  ov[key] = 1;
  await setSetting(OVERRIDE_KEY, JSON.stringify(ov)).catch(() => {});
}

/** เจ้าของไม่พอใจการกระทำนี้ → กลับไประดับ 2 ทันที + ล้าง streak (บทเรียนบันทึกโดยชั้นบทเรียนอยู่แล้ว) */
export async function demoteAction(key: string): Promise<void> {
  const ov = await overrides();
  delete ov[key]; // กลับค่าตั้งต้นจากตาราง
  await setSetting(OVERRIDE_KEY, JSON.stringify(ov)).catch(() => {});
  const t = await tracks();
  if (t[key]) {
    t[key] = { streak: 0, proposed: false, at: Date.now() };
    await setSetting(TRACK_KEY, JSON.stringify(t)).catch(() => {});
  }
}

// ===== ทางเร็ว / ทางช้า =====
//
// ทางเร็ว = ตัวจัดการเฉพาะทาง (รูปแบบชัด เสี่ยงต่ำ ทำเลย) · ทางช้า = chat (เครื่องมือครบ + ด่านตรวจ)
// การเรียนรู้: intent ไหนเคยทำให้เกิด "บทเรียน" (เจ้าของตำหนิ) → ยกเพดานความมั่นใจของ intent นั้น
// ไม่มั่นใจพอ = ตกไปทางช้า — คือการ "ย้ายเรื่องที่เคยพลาดไปทางที่คิดเยอะกว่า" ตามสเปกเจ้าของ

const SLOWPATH_KEY = "vex_slowpath"; // {"finance_itemize":0.7}

export async function slowpathMap(): Promise<Record<string, number>> {
  try {
    return JSON.parse((await getSetting(SLOWPATH_KEY)) || "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

/** เจตนานี้เพิ่งทำให้เจ้าของตำหนิ → ยกเพดานความมั่นใจ (ครั้งถัดไปไม่มั่นใจจริงจะตกไปทางช้า) */
export async function raiseSlowpath(intent: string): Promise<void> {
  if (!intent || intent === "chat" || intent === "error") return;
  const m = await slowpathMap();
  m[intent] = 0.7;
  await setSetting(SLOWPATH_KEY, JSON.stringify(m)).catch(() => {});
}
