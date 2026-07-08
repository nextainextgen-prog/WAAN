import { askClaude } from "./claude";
import { db } from "./db";

// น้องวานจดตารางงาน/ปฏิทิน แล้วแจ้งเตือนเมื่อถึงวัน
export interface ParsedEvent {
  date: string; // YYYY-MM-DD
  timeText?: string; // "14:00" ถ้าระบุ
  title: string;
  emoji?: string;
}

const EXTRACT_SYSTEM = `คุณคือผู้ช่วยจดตารางงาน อ่านข้อความผู้ใช้แล้วดึงเป็นรายการปฏิทิน ตอบ JSON เท่านั้น ไม่มีข้อความอื่น ไม่มี \`\`\`
โครงสร้าง: {"date":"YYYY-MM-DD","timeText":"HH:MM หรือว่าง","title":"สิ่งที่ต้องทำ (สั้น กระชับ)","emoji":"อิโมจิที่ผู้ใช้พิมพ์มา ถ้าไม่มีให้ว่าง"}
กติกา:
- ตีความวันจากข้อความเทียบกับ "วันนี้" ที่ให้มา เช่น วันนี้/พรุ่งนี้/มะรืน/จันทร์หน้า/วันที่ 15/สิ้นเดือน → แปลงเป็น YYYY-MM-DD จริง
- ถ้าไม่ได้ระบุวันเลย ให้ใช้ "วันนี้"
- title ตัดคำสั่ง (เช่น "ลงปฏิทิน", "จดไว้", "เตือน") ออก เหลือแต่เนื้องาน
- emoji เอาเฉพาะที่ผู้ใช้พิมพ์มาในข้อความ ถ้าไม่มีให้เว้นว่าง`;

function parseJson(text: string): ParsedEvent {
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

// เที่ยงคืนของวันที่ระบุ (เวลาเครื่อง = เวลาไทย)
function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

export async function extractEvent(text: string): Promise<ParsedEvent> {
  const now = new Date();
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const raw = await askClaude(`วันนี้คือ ${todayISO}\n\nข้อความ: ${text}`, { system: EXTRACT_SYSTEM, timeoutMs: 60_000 });
  const ex = parseJson(raw);
  if (!ex.title) throw new Error("ไม่พบรายละเอียดงานที่จะลง");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ex.date || "")) ex.date = todayISO;
  return ex;
}

export interface CalEvent {
  id: string;
  chatId: string;
  date: Date;
  timeText: string | null;
  title: string;
  emoji: string | null;
  creatorName: string | null;
}

export async function createEvent(input: {
  chatId: string;
  parsed: ParsedEvent;
  createdById?: string;
  creatorName?: string;
}): Promise<CalEvent> {
  const [y, m, d] = input.parsed.date.split("-").map(Number);
  const date = dayStart(new Date(y, m - 1, d));
  return db.calendarEvent.create({
    data: {
      chatId: input.chatId,
      date,
      timeText: input.parsed.timeText || null,
      title: input.parsed.title,
      emoji: input.parsed.emoji || null,
      createdById: input.createdById || null,
      creatorName: input.creatorName || null,
    },
  });
}

// รายการที่ถึงกำหนดแล้ว (วันมาถึง) และยังไม่ได้แจ้ง
export async function getDueEvents(): Promise<CalEvent[]> {
  const now = new Date();
  const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return db.calendarEvent.findMany({
    where: { notified: false, done: false, date: { lte: endToday } },
    orderBy: { date: "asc" },
  });
}

export async function markNotified(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.calendarEvent.updateMany({ where: { id: { in: ids } }, data: { notified: true } });
}

// งานที่ยังไม่ถึง (ไว้ให้ดูรายการล่วงหน้า)
export async function getUpcoming(chatId: string, limit = 10): Promise<CalEvent[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return db.calendarEvent.findMany({
    where: { chatId, done: false, date: { gte: start } },
    orderBy: { date: "asc" },
    take: limit,
  });
}

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
export function thaiDate(d: Date): string {
  return `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}
