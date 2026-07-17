import { randomUUID } from "node:crypto";
import { askClaude } from "./claude";
import { db } from "./db";
import { getCalendar } from "./google";

// น้องวานจดตารางงาน/ปฏิทิน + ลง Google Calendar จริง แล้วแจ้งเตือนเมื่อถึงวัน
export interface ParsedEvent {
  date: string; // YYYY-MM-DD
  timeText?: string; // เวลาเริ่ม "14:00" ถ้าระบุ
  endTime?: string; // เวลาสิ้นสุด "16:00" ถ้าระบุช่วง
  title: string;
  emoji?: string;
  attendees?: string[]; // อีเมลที่ต้องเชิญ/ยิงไป
  needsMeet?: boolean; // ขอห้องประชุมออนไลน์ (Google Meet) มาด้วย
}

const EXTRACT_SYSTEM = `คุณคือผู้ช่วยจดตารางงาน อ่านข้อความผู้ใช้แล้วดึงเป็นรายการปฏิทิน ตอบ JSON เท่านั้น ไม่มีข้อความอื่น ไม่มี \`\`\`
โครงสร้าง: {"date":"YYYY-MM-DD","timeText":"HH:MM เวลาเริ่ม หรือว่าง","endTime":"HH:MM เวลาจบ หรือว่าง","title":"สิ่งที่ต้องทำ (สั้น กระชับ)","emoji":"อิโมจิที่ผู้ใช้พิมพ์มา ถ้าไม่มีให้ว่าง","needsMeet":true/false}
กติกา:
- needsMeet=true เมื่อผู้ใช้ขอห้องประชุมออนไลน์/ลิงก์ประชุม เช่น พูดถึง Meet, Google Meet, ประชุมออนไลน์, ลิงก์ประชุม, ห้องประชุม, VC, call, zoom · ถ้าเป็นงานทั่วไปที่ไม่ต้องประชุมออนไลน์ให้ false
- ตีความวันจากข้อความเทียบกับ "วันนี้" ที่ให้มา เช่น วันนี้/พรุ่งนี้/มะรืน/จันทร์หน้า/วันที่ 15/สิ้นเดือน → แปลงเป็น YYYY-MM-DD จริง
- ถ้าไม่ได้ระบุวันเลย ให้ใช้ "วันนี้"
- ถ้าระบุช่วงเวลา เช่น "09:00-12:00" หรือ "บ่าย 2 ถึง 4 โมง" → timeText=เวลาเริ่ม, endTime=เวลาจบ
- title ตัดคำสั่ง (เช่น "ลงปฏิทิน", "จดไว้", "เตือน", "ยิงไปที่เมล...") + อีเมล ออก เหลือแต่เนื้องาน
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
  // ดึงอีเมลจากข้อความตรงๆ (แม่นกว่าให้ LLM เดา) — ไว้เชิญเข้าปฏิทิน/ยิงเมล
  const emails = (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).map((e) => e.toLowerCase());
  if (emails.length) ex.attendees = [...new Set(emails)];
  // ขอ Meet: จับจากข้อความตรงๆ ด้วย (กัน LLM พลาด) — ตรงไหนตรงหนึ่งก็ถือว่าขอ
  if (/\bmeet\b|google\s*meet|ประชุมออนไลน์|ลิงก์ประชุม|ลิ้งก์ประชุม|ห้องประชุมออนไลน์|\bvc\b|\bzoom\b/i.test(text)) {
    ex.needsMeet = true;
  }
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
  gcalLink?: string | null; // ลิงก์เปิดใน Google Calendar (ถ้าลงสำเร็จ)
  meetLink?: string | null; // ลิงก์ห้อง Google Meet (ถ้าขอมาและสร้างสำเร็จ)
  gcalError?: string | null; // เหตุที่ลง Google Calendar ไม่ได้ (เช่น ต้อง re-auth)
}

const TZ = "Asia/Bangkok";

// สร้าง event จริงใน Google Calendar (ปฏิทินหลักของบัญชีที่เชื่อมไว้) → คืน htmlLink
async function createGoogleEvent(parsed: ParsedEvent): Promise<{ link?: string; meet?: string; error?: string }> {
  try {
    const cal = getCalendar();
    const summary = `${parsed.emoji ? parsed.emoji + " " : ""}${parsed.title}`;
    const requestBody: Record<string, unknown> = { summary };
    if (parsed.timeText && /^\d{1,2}:\d{2}$/.test(parsed.timeText)) {
      const start = `${parsed.date}T${parsed.timeText.padStart(5, "0")}:00`;
      // เวลาจบ: ใช้ endTime ถ้ามี ไม่งั้น +1 ชม.
      let end: string;
      if (parsed.endTime && /^\d{1,2}:\d{2}$/.test(parsed.endTime)) {
        end = `${parsed.date}T${parsed.endTime.padStart(5, "0")}:00`;
      } else {
        const [h, mi] = parsed.timeText.split(":").map(Number);
        end = `${parsed.date}T${String((h + 1) % 24).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00`;
      }
      requestBody.start = { dateTime: start, timeZone: TZ };
      requestBody.end = { dateTime: end, timeZone: TZ };
    } else {
      // ทั้งวัน: end.date = วันถัดไป
      const [y, m, d] = parsed.date.split("-").map(Number);
      const next = new Date(y, m - 1, d + 1);
      const nextISO = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
      requestBody.start = { date: parsed.date };
      requestBody.end = { date: nextISO };
    }
    if (parsed.attendees?.length) requestBody.attendees = parsed.attendees.map((email) => ({ email }));
    requestBody.reminders = { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] };
    // ขอห้อง Google Meet ให้ Google สร้างมาพร้อม event (ต้องส่ง conferenceDataVersion: 1 ด้วย)
    if (parsed.needsMeet) {
      requestBody.conferenceData = {
        createRequest: {
          requestId: randomUUID(),
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      };
    }
    const res = await cal.events.insert({
      calendarId: "primary",
      requestBody,
      conferenceDataVersion: parsed.needsMeet ? 1 : 0,
      sendUpdates: parsed.attendees?.length ? "all" : "none",
    });
    return { link: res.data.htmlLink || undefined, meet: res.data.hangoutLink || undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // scope ไม่พอ / ยังไม่ได้เชื่อม → ให้ผู้ใช้ re-auth
    if (/insufficient|scope|invalid_grant|forbidden|permission|unauthorized|no access|invalid_request/i.test(msg)) {
      return { error: "need_auth" };
    }
    return { error: msg.slice(0, 120) };
  }
}

export async function createEvent(input: {
  chatId: string;
  parsed: ParsedEvent;
  createdById?: string;
  creatorName?: string;
}): Promise<CalEvent> {
  const [y, m, d] = input.parsed.date.split("-").map(Number);
  const date = dayStart(new Date(y, m - 1, d));
  const rec = await db.calendarEvent.create({
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
  const g = await createGoogleEvent(input.parsed);
  return { ...rec, gcalLink: g.link || null, meetLink: g.meet || null, gcalError: g.error || null };
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

const TH_MONTHS_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const TH_WD = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const hourLabel = (h: number) => (h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`);

// สร้างภาพ "หน้าปฏิทินรายวัน" แนว Google Calendar (เรนเดอร์เอง — ไม่ต้องล็อกอินเว็บ Google)
export function buildCalendarDayHtml(ev: CalEvent, parsed: ParsedEvent): string {
  const d = ev.date;
  const hasTime = !!(ev.timeText && /^\d{1,2}:\d{2}$/.test(ev.timeText));
  const [sh, sm] = hasTime ? ev.timeText!.split(":").map(Number) : [9, 0];
  let eh = sh + 1, em = sm;
  if (parsed.endTime && /^\d{1,2}:\d{2}$/.test(parsed.endTime)) [eh, em] = parsed.endTime.split(":").map(Number);
  const startF = sh + sm / 60, endF = Math.max(startF + 0.5, eh + em / 60);
  const gridStart = Math.max(0, Math.floor(startF) - 2);
  const gridEnd = Math.min(24, Math.ceil(endF) + 2);
  const ROW = 56; // px ต่อชั่วโมง
  const rows: string[] = [];
  for (let h = gridStart; h <= gridEnd; h++) {
    rows.push(`<div class="hr"><span class="hl">${hourLabel(h)}</span><span class="hline"></span></div>`);
  }
  const top = (startF - gridStart) * ROW;
  const height = (endF - startF) * ROW;
  const timeRange = hasTime
    ? `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")} – ${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`
    : "ทั้งวัน";
  const esc = (s: string) => String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
  const attendeeLine = parsed.attendees?.length ? `<div class="el">👥 ${esc(parsed.attendees.join(", "))}</div>` : "";
  const eventBlock = hasTime
    ? `<div class="ev" style="top:${top}px;height:${Math.max(height, 40)}px">
         <div class="et">${ev.emoji ? esc(ev.emoji) + " " : ""}${esc(ev.title)}</div>
         <div class="etime">${timeRange}</div>${attendeeLine}
       </div>`
    : `<div class="allday"><div class="et">${ev.emoji ? esc(ev.emoji) + " " : ""}${esc(ev.title)}</div><div class="etime">ทั้งวัน</div>${attendeeLine}</div>`;
  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=Archivo:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:'IBM Plex Sans Thai','Archivo',sans-serif}
body{background:#fff;color:#3c4043;width:1000px}
.cal{width:1000px;padding:22px 26px 26px}
.hd{display:flex;align-items:center;gap:16px;border-bottom:1px solid #e0e3e7;padding-bottom:16px;margin-bottom:6px}
.hd .dnum{width:58px;height:58px;border-radius:50%;background:#1a73e8;color:#fff;font-family:'Archivo';font-weight:700;font-size:28px;display:flex;align-items:center;justify-content:center}
.hd .wd{font-size:13px;color:#1a73e8;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.hd .full{font-size:22px;font-weight:600;color:#3c4043;margin-top:2px}
.hd .tz{margin-left:auto;font-size:12px;color:#70757a}
.grid{position:relative;margin-top:10px}
.hr{position:relative;height:${ROW}px;display:flex;align-items:flex-start}
.hr .hl{width:64px;flex:none;font-size:11px;color:#70757a;transform:translateY(-7px)}
.hr .hline{flex:1;border-top:1px solid #e8eaed;margin-top:0}
.ev,.allday{position:absolute;left:78px;right:14px;background:#039be5;color:#fff;border-radius:8px;padding:8px 12px;box-shadow:0 1px 3px rgba(0,0,0,.18);overflow:hidden}
.allday{position:relative;left:0;right:0;margin:8px 0 4px;background:#0b8043}
.ev .et,.allday .et{font-weight:700;font-size:15px;line-height:1.2}
.ev .etime,.allday .etime{font-size:12.5px;opacity:.95;margin-top:2px}
.ev .el,.allday .el{font-size:11.5px;opacity:.9;margin-top:4px}
</style></head><body>
<div class="cal">
  <div class="hd">
    <div class="dnum">${d.getDate()}</div>
    <div><div class="wd">${TH_WD[d.getDay()]}</div><div class="full">${d.getDate()} ${TH_MONTHS_FULL[d.getMonth()]} ${d.getFullYear() + 543}</div></div>
    <div class="tz">GMT+07</div>
  </div>
  <div class="grid">${rows.join("")}${eventBlock}</div>
</div>
</body></html>`;
}
