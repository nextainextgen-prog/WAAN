import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { renderHtmlToPng } from "@/lib/html-pdf";
import { thaiDate } from "@/lib/calendar";
import { getKikiChatIds, getSetting, setSetting, askKiki, saveKikiChat } from "@/lib/kiki";
import { financeSnapshot, snapshotFacts, financeCardHtml, fmtBaht } from "@/lib/kiki-finance";
import { eventCardHtml, agendaCardHtml, weatherFor, evStart, evEnd, fmtCountdown, type KikiEvent } from "@/lib/kiki-calendar";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 240;

// งานตามเวลาของ Vex — kiki-bot.mjs เรียกทุก 1 นาที แล้วเอา sends ไปส่งเอง (คนละโทเค็นกับวาน)
// ladder เตือนนัด: เย็นก่อนวันนัด 18:00 → เช้าวันนัด 07:00 (ใน brief) → ก่อนเวลา 1 ชม. (ทั้งวัน = 08:00) → ทักหลังนัดจบ
interface CronSend {
  chatId: string;
  kind: "text" | "photo";
  text?: string;
  dataBase64?: string;
  caption?: string;
  filename?: string;
}

type CalRow = {
  id: string; chatId: string; date: Date; timeText: string | null; endTime: string | null;
  title: string; location: string | null; withWho: string | null; note: string | null;
  gcalEventId: string | null; done: boolean;
};

const toKev = (r: CalRow): KikiEvent => ({
  id: r.id, date: r.date, timeText: r.timeText, endTime: r.endTime, title: r.title,
  location: r.location, withWho: r.withWho, note: r.note, gcalEventId: r.gcalEventId, done: r.done,
});

async function cardPng(html: string): Promise<string | null> {
  try {
    return (await renderHtmlToPng(html, { width: 720, height: 200 })).toString("base64");
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sends: CronSend[] = [];
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const chats = await getKikiChatIds();
  const mainChat = chats[0];
  const travelMin = Number((await getSetting("kiki_travel_min")) || 40);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 86400_000);
  const tmrEnd = new Date(dayEnd.getTime() + 86400_000);

  const budgetLine = async () => {
    try {
      const snap = await financeSnapshot();
      return snap.safePerDay !== null ? `${fmtBaht(Math.floor(snap.safePerDay))} ฿` : null;
    } catch {
      return null;
    }
  };

  // ===== A) เตือนก่อนถึงเวลา 1 ชม. · นัดทั้งวันเตือน 08:00 =====
  try {
    const rows = (await db.calendarEvent.findMany({
      where: { agent: "kiki", done: false, remindedHour: false, date: { gte: dayStart, lt: dayEnd } },
    })) as CalRow[];
    for (const r of rows) {
      const kev = toKev(r);
      const st = evStart(kev);
      const fire = st
        ? st.getTime() - now.getTime() > 0 && st.getTime() - now.getTime() <= 65 * 60_000
        : now.getHours() >= 8;
      if (!fire) continue;
      await db.calendarEvent.update({ where: { id: r.id }, data: { remindedHour: true } }).catch(() => {});
      const dayRows = (await db.calendarEvent.findMany({ where: { agent: "kiki", chatId: r.chatId, date: { gte: dayStart, lt: dayEnd } } })) as CalRow[];
      const weather = await weatherFor(r.date, st ? st.getHours() - 1 : undefined, st ? Math.min(23, st.getHours() + 4) : undefined);
      const png = await cardPng(eventCardHtml(kev, { mode: st ? "hour" : "day", now, weather, budgetLine: (await budgetLine()) ? `ใช้ได้อีก ${await budgetLine()}` : null, travelMin, dayEvents: dayRows.map(toKev) }));
      if (png) sends.push({ chatId: r.chatId, kind: "photo", dataBase64: png, filename: "event.png" });
      const t = await askKiki(
        `[เตือนนัด] ${st ? `อีก ${fmtCountdown(st.getTime() - now.getTime())} จะถึงนัด` : "วันนี้มีนัดทั้งวัน"}: "${r.title}"${r.location ? ` ที่ ${r.location}` : ""}${r.withWho ? ` กับ${r.withWho}` : ""} — แต่งข้อความเตือนสั้น 1-2 บรรทัด (การ์ดรายละเอียดส่งไปแล้ว) กวนได้นิดหน่อย`,
      ).catch(() => `อีก${st ? ` ${fmtCountdown(st.getTime() - now.getTime())}` : "เดี๋ยว"}ถึงนัด "${r.title}" แล้วนะครับ ⏰ เตรียมตัวเลย`);
      sends.push({ chatId: r.chatId, kind: "text", text: t });
      await saveKikiChat("assistant", t);
    }
  } catch { /* รอบหน้าลองใหม่ */ }

  // ===== B) เย็นก่อนวันนัด 18:00 =====
  try {
    if (now.getHours() >= 18) {
      const rows = (await db.calendarEvent.findMany({
        where: { agent: "kiki", done: false, remindedEve: false, date: { gte: dayEnd, lt: tmrEnd } },
      })) as CalRow[];
      for (const r of rows) {
        await db.calendarEvent.update({ where: { id: r.id }, data: { remindedEve: true } }).catch(() => {});
        const kev = toKev(r);
        const st = evStart(kev);
        const weather = await weatherFor(r.date, st ? st.getHours() - 1 : undefined, st ? Math.min(23, st.getHours() + 4) : undefined);
        const png = await cardPng(eventCardHtml(kev, { mode: "eve", now, weather, travelMin }));
        if (png) sends.push({ chatId: r.chatId, kind: "photo", dataBase64: png, filename: "event.png" });
        const t = await askKiki(
          `[เตือนล่วงหน้า] พรุ่งนี้มีนัด "${r.title}"${r.timeText ? ` เวลา ${r.timeText} น.` : " (ทั้งวัน)"}${r.location ? ` ที่ ${r.location}` : ""} — แต่งข้อความเตือนตอนเย็นสั้น 1-2 บรรทัด ให้เตรียมตัวก่อนนอน`,
        ).catch(() => `พรุ่งนี้มีนัด "${r.title}" นะครับ ⏰ เตรียมของก่อนนอนเลย`);
        sends.push({ chatId: r.chatId, kind: "text", text: t });
        await saveKikiChat("assistant", t);
      }
    }
  } catch { /* รอบหน้าลองใหม่ */ }

  // ===== C) สรุปเช้า 07:00 (การเงินเมื่อวาน + agenda วันนี้) =====
  try {
    if (mainChat && now.getHours() >= 7 && (await getSetting("kiki_last_brief")) !== today) {
      await setSetting("kiki_last_brief", today);
      const snap = await financeSnapshot();
      const yStart = new Date(dayStart.getTime() - 86400_000);
      const yRows = await db.financeTxn.findMany({ where: { type: "expense", occurredAt: { gte: yStart, lt: dayStart } } });
      const ySpent = yRows.reduce((s, r) => s + r.amount, 0);
      const todayRows = (await db.calendarEvent.findMany({ where: { agent: "kiki", date: { gte: dayStart, lt: dayEnd } }, orderBy: { date: "asc" } })) as CalRow[];
      const tmrCount = await db.calendarEvent.count({ where: { agent: "kiki", date: { gte: dayEnd, lt: tmrEnd } } });
      if (ySpent > 0 || todayRows.length > 0 || snap.txnCount > 0) {
        // การ์ด agenda เฉพาะวันที่มีนัด — วันว่างเอาแต่ข้อความพอ ไม่สแปมภาพ
        if (todayRows.length) {
          await db.calendarEvent.updateMany({ where: { id: { in: todayRows.map((r) => r.id) } }, data: { notified: true } }).catch(() => {});
          const png = await cardPng(agendaCardHtml(todayRows.map(toKev), { heading: "วันนี้", now, travelMin, budgetLine: await budgetLine(), tomorrowLine: tmrCount ? `${tmrCount} นัด` : "ไม่มีนัด" }));
          if (png) sends.push({ chatId: mainChat, kind: "photo", dataBase64: png, filename: "agenda.png" });
        }
        const facts = [
          `เมื่อวานใช้ไป ${fmtBaht(ySpent)} บาท (${yRows.length} รายการ)`,
          ...snapshotFacts(snap),
          todayRows.length ? `นัดวันนี้: ${todayRows.map((e) => `${e.title}${e.timeText ? ` ${e.timeText}น.` : ""}`).join(" · ")}` : "วันนี้ไม่มีนัด",
        ];
        const t = await askKiki(
          `[สรุปเช้าประจำวัน] แต่งข้อความทักเช้าสั้น ๆ (ไม่เกิน 6 บรรทัด) จากข้อเท็จจริงจริงเท่านั้น:\n${facts.map((f) => `- ${f}`).join("\n")}\n\nโทน: ทักเช้าแบบกวน ๆ + เตือนงบ/นัดวันนี้ ตอบเป็นข้อความที่จะส่งเลย`,
        ).catch(() => `เช้าแล้วครับ ⏰\n\nเมื่อวานใช้ไป ${fmtBaht(ySpent)} ฿${todayRows.length ? `\nวันนี้มีนัด: ${todayRows.map((e) => e.title).join(", ")}` : ""}`);
        sends.push({ chatId: mainChat, kind: "text", text: t });
        await saveKikiChat("assistant", t);
      }
    }
  } catch { /* พรุ่งนี้ค่อยว่ากัน */ }

  // ===== D) ทักหลังนัดจบ (ถามผล + ชวนส่งสลิปค่าใช้จ่าย) =====
  try {
    const rows = (await db.calendarEvent.findMany({
      where: { agent: "kiki", followedUp: false, date: { gte: dayStart, lt: dayEnd } },
    })) as CalRow[];
    for (const r of rows) {
      const kev = toKev(r);
      const ended = kev.timeText
        ? now.getTime() > evEnd(kev).getTime() + 30 * 60_000
        : now.getHours() >= 20;
      if (!ended) continue;
      await db.calendarEvent.update({ where: { id: r.id }, data: { followedUp: true, done: true } }).catch(() => {});
      const t = await askKiki(
        `[ทักหลังนัดจบ] นัด "${r.title}"${r.withWho ? ` กับ${r.withWho}` : ""}${r.location ? ` ที่ ${r.location}` : ""} เพิ่งจบไป — ทักถามสั้น ๆ ว่าเป็นไงบ้าง + ถ้ามีค่าใช้จ่ายให้ส่งสลิป/พิมพ์บอกมาจะจดให้ (1-3 บรรทัด เป็นกันเอง)`,
      ).catch(() => `นัด "${r.title}" เป็นไงบ้างครับ — มีค่าใช้จ่ายอะไรส่งสลิปมาได้เลย ผมจดให้ 💸`);
      sends.push({ chatId: r.chatId, kind: "text", text: t });
      await saveKikiChat("assistant", t);
    }
  } catch { /* รอบหน้าลองใหม่ */ }

  // ===== E) สรุปสิ้นเดือน (วันที่ 1 เวลา >= 08:00 สรุปเดือนที่แล้ว) =====
  try {
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (mainChat && now.getDate() === 1 && now.getHours() >= 8 && (await getSetting("kiki_last_month_report")) !== ym) {
      await setSetting("kiki_last_month_report", ym);
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
      const snap = await financeSnapshot(lastMonth);
      const png = await cardPng(financeCardHtml(snap));
      if (png) sends.push({ chatId: mainChat, kind: "photo", dataBase64: png, filename: "month-summary.png", caption: "สรุปเดือนที่แล้วครับ" });
      const t = await askKiki(
        `[สรุปสิ้นเดือน] เดือนที่แล้วจบแล้ว แต่งสรุป+วิจารณ์พฤติกรรมใช้เงิน (ชม/ด่าตามจริง) จากข้อเท็จจริง:\n${snapshotFacts(snap).map((f) => `- ${f}`).join("\n")}\n\nไม่เกิน 8 บรรทัด ตอบเป็นข้อความที่จะส่งเลย`,
      ).catch(() => `จบเดือนแล้วครับ 📉 ใช้ไปทั้งเดือน ${fmtBaht(snap.monthExpense)} ฿ · รับเข้า ${fmtBaht(snap.monthIncome)} ฿`);
      sends.push({ chatId: mainChat, kind: "text", text: t });
      await saveKikiChat("assistant", t);
    }
  } catch { /* เดือนหน้าลองใหม่ */ }

  return NextResponse.json({ sends });
}
