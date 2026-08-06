import { db } from "./db";
import { getSetting } from "./kiki";

/**
 * สถานะโลก + สภาพเจ้าของ (จิตใจเฟส 3 — 6 ส.ค. 2026)
 *
 * ปัญหาเดิม: บริบทเวลา/นัด/งาน/สภาพระบบกระจายกันคนละก้อน บางเส้นทางได้ บางเส้นทางไม่ได้
 * และ "สภาพเจ้าของ" (รีบ เหนื่อย อารมณ์) ไม่เคยถูกมองเลย → ตอบยาวใส่คนที่กำลังรีบ
 * ทวงงานใส่คนที่เหนื่อยตอนดึก
 *
 * ชั้นนี้รวมเป็น "ก้อนเดียวที่ฉีดเข้าทุกการตัดสินใจ" — ทุกอย่างอ่านจากของจริงในเครื่อง
 * (SQLite local ทั้งหมด ไม่มีการเรียกโมเดล — ต้องเร็วพอที่จะเรียกได้ทุกคำตอบ)
 *
 * mood มาจากตัวจับบทเรียน (kiki-lessons.detectAndRecord) ที่อ่านทุก exchange อยู่แล้ว
 * — ไม่เรียกโมเดลเพิ่มแม้แต่คอลเดียว
 */

export interface OwnerState {
  /** ข้อความห้วน/ถี่ผิดปกติ = กำลังรีบ */
  hurried: boolean;
  /** 23:00–06:00 */
  lateNight: boolean;
  /** อารมณ์ล่าสุดจากตัวจับ (ปกติ | รีบ | เหนื่อย | หงุดหงิด | อารมณ์ดี) — null = ไม่รู้ */
  mood: string | null;
  /** ช่วงที่ไม่ควรทวงงาน/เสนอเรื่องใหม่/แซว */
  quiet: boolean;
  lines: string[];
}

const MOOD_KEY = "vex_owner_mood";
const FORCE_KEY = "vex_owner_state_force"; // override สำหรับเทส/สั่งมือ: {"hurried":true,"lateNight":true,"mood":"เหนื่อย"}

export async function ownerState(now = new Date()): Promise<OwnerState> {
  // override ก่อนเสมอ (ไว้เทส + ไว้ให้เจ้าของสั่ง "โหมดห้ามกวน" ได้ในอนาคต)
  try {
    const forced = JSON.parse((await getSetting(FORCE_KEY)) || "null") as Partial<OwnerState> | null;
    if (forced) {
      const st: OwnerState = {
        hurried: !!forced.hurried,
        lateNight: !!forced.lateNight,
        mood: forced.mood ?? null,
        quiet: !!(forced.quiet ?? (forced.lateNight || forced.mood === "หงุดหงิด" || forced.mood === "เหนื่อย")),
        lines: [],
      };
      st.lines = describe(st);
      return st;
    }
  } catch { /* ไม่มี override */ }

  const hour = now.getHours();
  const lateNight = hour >= 23 || hour < 6;

  // จังหวะจากตัวเลขจริง: ข้อความของเจ้าของช่วง 45 นาทีล่าสุด
  let hurried = false;
  try {
    const recent = await db.kikiChat.findMany({
      where: { role: "user", scope: "owner", NOT: { channel: "event" }, createdAt: { gte: new Date(now.getTime() - 45 * 60_000) } },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { content: true },
    });
    if (recent.length >= 3) {
      const avgLen = recent.reduce((a, b) => a + b.content.length, 0) / recent.length;
      // ยิงมาหลายข้อความติด ๆ และแต่ละอันสั้นมาก = กำลังรีบ/พิมพ์จากมือถือระหว่างทำอย่างอื่น
      if (avgLen < 25) hurried = true;
    }
  } catch { /* อ่านไม่ได้ = ถือว่าปกติ */ }

  // อารมณ์จากตัวจับบทเรียน (อายุไม่เกิน 2 ชม. — เก่ากว่านั้นถือว่าไม่รู้ ดีกว่าเดาจากอดีต)
  let mood: string | null = null;
  try {
    const m = JSON.parse((await getSetting(MOOD_KEY)) || "null") as { mood?: string; at?: number } | null;
    if (m?.mood && m.at && Date.now() - m.at < 2 * 3600_000 && m.mood !== "ปกติ") mood = m.mood;
  } catch { /* ไม่รู้อารมณ์ */ }

  const st: OwnerState = {
    hurried: hurried || mood === "รีบ",
    lateNight,
    mood,
    quiet: lateNight || mood === "หงุดหงิด" || mood === "เหนื่อย",
    lines: [],
  };
  st.lines = describe(st);
  return st;
}

function describe(st: OwnerState): string[] {
  const lines: string[] = [];
  if (st.hurried) lines.push("เจ้าของกำลังรีบ (ข้อความสั้นถี่) → ตอบสั้นที่สุด ฟันธงเลย ตัดคำเกริ่นทิ้งหมด");
  if (st.lateNight) lines.push("ตอนนี้ดึกแล้ว → อย่าทวงงาน อย่าเสนอเรื่องใหม่ที่ไม่ได้ถาม ตอบให้จบเรื่อง");
  if (st.mood === "หงุดหงิด") lines.push("เจ้าของอารมณ์ไม่ดีอยู่ → ห้ามแซว ห้ามเสนอความเห็นที่ไม่ได้ถาม ตอบตรงประเด็นอย่างเดียว");
  if (st.mood === "เหนื่อย") lines.push("เจ้าของดูเหนื่อย → ตอบนุ่มลง สั้นลง ไม่ยัดข้อมูล");
  if (st.mood === "อารมณ์ดี") lines.push("เจ้าของอารมณ์ดี → คุยสบาย ๆ ได้ แซวได้ตามจังหวะ");
  return lines;
}

/** cron ใช้ตัดสินว่า "ตอนนี้ควรเงียบไหม" ก่อนทวงงาน/ถามไดอารี่ — เลื่อนไปก่อน ไม่ใช่ยกเลิก */
export async function ownerPrefersQuiet(): Promise<boolean> {
  return (await ownerState()).quiet;
}

/**
 * สถานะโลกก้อนเดียว — ฉีดเข้าทุกคำตอบแทน nowLine เดิม
 * ทุกบรรทัดมาจากของจริง: ปฏิทิน (query ตรง — getUpcoming กรองด้วย chatId ใช้ไม่ได้กับ agent) ·
 * กระดานงาน · Hermes · โหมดฟัง · เหตุการณ์เข้า · สภาพเจ้าของ
 */
export async function worldState(now = new Date()): Promise<string> {
  const lines: string[] = [];
  lines.push(`ตอนนี้คือ ${now.toLocaleString("th-TH-u-ca-gregory", { dateStyle: "full", timeStyle: "short" })}`);

  // นัดวันนี้ + นัดถัดไปอีกกี่นาที
  try {
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86400_000);
    const rows = await db.calendarEvent.findMany({
      where: { agent: "kiki", done: false, date: { gte: dayStart, lt: dayEnd } },
      orderBy: { date: "asc" },
      take: 6,
    });
    if (rows.length) {
      lines.push(`นัดวันนี้ ${rows.length} รายการ: ${rows.map((r) => `${r.timeText || "ทั้งวัน"} ${r.title}`).join(" · ")}`);
      const next = rows.find((r) => r.date.getTime() > now.getTime() - 30 * 60_000 && r.timeText);
      if (next) {
        const [hh, mm] = (next.timeText || "0:0").split(/[:.]/).map(Number);
        const at = new Date(next.date); at.setHours(hh || 0, mm || 0, 0, 0);
        const mins = Math.round((at.getTime() - now.getTime()) / 60_000);
        if (mins > 0 && mins < 600) lines.push(`นัดถัดไปในอีก ${mins < 60 ? `${mins} นาที` : `${Math.floor(mins / 60)} ชม. ${mins % 60} นาที`} (${next.title})`);
      }
    } else {
      lines.push("วันนี้ไม่มีนัดในปฏิทิน");
    }
  } catch { /* ปฏิทินอ่านไม่ได้ก็ข้าม */ }

  // งานค้าง (นับ + เรื่องด่วน)
  try {
    const open = await db.kikiTask.findMany({ where: { status: "open" }, orderBy: { createdAt: "desc" }, take: 30 });
    if (open.length) {
      const high = open.filter((t) => t.priority === "high");
      lines.push(`งานค้างในกระดาน ${open.length} เรื่อง${high.length ? ` (ด่วน: ${high.slice(0, 2).map((t) => t.title).join(" · ")})` : ""}`);
    }
  } catch { /* ข้าม */ }

  // งานเบื้องหลังที่กำลังรัน
  try {
    const running = await db.kikiHermesJob.count({ where: { status: "running", canceled: false } });
    if (running) lines.push(`งานเบื้องหลังกำลังรัน ${running} งาน`);
  } catch { /* ข้าม */ }

  // โหมดเสียง/การอยู่ในสาย
  try {
    const [mode, voiceAlways] = await Promise.all([getSetting("vex_listen_mode"), getSetting("kiki_voice_always")]);
    const bits: string[] = [];
    if (mode) bits.push(`โหมดฟัง: ${mode}`);
    if (voiceAlways === "1") bits.push("เจ้าของสั่งให้ตอบเป็นเสียงตลอด");
    if (bits.length) lines.push(bits.join(" · "));
  } catch { /* ข้าม */ }

  // เหตุการณ์เข้าใหม่ (คนอื่นทัก) ชั่วโมงล่าสุด
  try {
    const ev = await db.kikiChat.count({
      where: { scope: "owner", channel: "event", createdAt: { gte: new Date(now.getTime() - 3600_000) } },
    });
    if (ev) lines.push(`มีเหตุการณ์เข้าใหม่ (คนอื่นทัก/ระบบแจ้ง) ${ev} เรื่องในชั่วโมงล่าสุด`);
  } catch { /* ข้าม */ }

  // สภาพเจ้าของ — บรรทัดที่ "เปลี่ยนพฤติกรรมจริง" ไม่ใช่แค่บอกให้รู้
  try {
    const st = await ownerState(now);
    lines.push(...st.lines);
  } catch { /* ข้าม */ }

  return `=== สถานะโลกตอนนี้ (ของจริงทั้งหมด ใช้ประกอบทุกการตัดสินใจ) ===\n${lines.join("\n")}`;
}
