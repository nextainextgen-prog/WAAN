import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { renderHtmlToPng } from "@/lib/html-pdf";
import { thaiDate } from "@/lib/calendar";
import { getKikiChatIds, getSetting, setSetting, askKiki, saveKikiChat, sanitizeVexText, vexLine } from "@/lib/kiki";
import { financeSnapshot, snapshotFacts, financeCardHtml, fmtBaht, upcomingBills, detectRecurringBills, cashForecast30 } from "@/lib/kiki-finance";
import { PENDING_CATEGORY } from "@/lib/kiki-gmail";
import { eventCardHtml, agendaCardHtml, weatherFor, evStart, evEnd, fmtCountdown, type KikiEvent } from "@/lib/kiki-calendar";
import { dueRecurrings, debtNagFacts, weeklyReportFacts, debtDueReminders, autoRememberFromToday } from "@/lib/kiki-life";
import { pollBankEmails } from "@/lib/kiki-gmail";
import { collectHermesDeliveries, collectJobPings, markDelivered } from "@/lib/kiki-hermes";
import { tasksToNag, markNagged } from "@/lib/kiki-tasks";
import { rollupRecentDays } from "@/lib/kiki-memory";
import { vexSections, vexList, type VexSection, type VexRow } from "@/lib/kiki-format";
import { askClaude } from "@/lib/claude";
import { KIKI_GUARD, KIKI_PERSONA } from "@/lib/kiki";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 240;

// งานตามเวลาของ Vex — kiki-bot.mjs เรียกทุก 1 นาที แล้วเอา sends ไปส่งเอง (คนละโทเค็นกับวาน)
//
// ladder เตือนนัด (แก้ 5 ส.ค. 2026 — เจ้าของแจ้งว่า "ถึงเวลาแล้วไม่มีอะไรแจ้งมาเลย"):
//   เย็นก่อนวันนัด 18:00 → เช้าวันนัด 07:00 (ใน brief) → ก่อนเวลา 1 ชม. (ทั้งวัน = 08:00)
//   → อีก 10 นาที → **ถึงเวลาแล้ว (T-0)** → เลยเวลา 10 นาทีแล้วยังเงียบ = ทวง → ทักหลังนัดจบ
// ของเดิมจบที่ขั้น "1 ชม." แล้วเงียบยาวจนนัดจบ เพราะ remindedHour เป็นธงเดียวยิงครั้งเดียว
interface CronSend {
  chatId: string;
  kind: "text" | "photo" | "document" | "voice";
  text?: string;
  dataBase64?: string;
  caption?: string;
  filename?: string;
  parseMode?: "HTML" | "Markdown";
  buttons?: { text: string; data: string }[][];
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
      // ปลายล่างของหน้าต่างคือ 12 นาที — ต่ำกว่านั้นปล่อยให้ขั้น "อีก 10 นาที" (A2) รับไป
      // ไม่งั้นนัดที่ลงกระชั้น 5 นาทีจะได้การ์ด "อีก 1 ชม." ซึ่งผิดความจริง
      const left = st ? st.getTime() - now.getTime() : 0;
      const fire = st
        ? left > 12 * 60_000 && left <= 65 * 60_000
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

  // ===== A2/A3/A4) อีก 10 นาที · ถึงเวลาแล้ว · เลยเวลาแล้วยังเงียบ =====
  //
  // ขั้นที่ขาดหายไปทั้งหมดอยู่ตรงนี้ — เดิมเตือนครั้งสุดท้ายที่ T-65 นาทีแล้วเงียบจนนัดจบ
  // ทั้งสามขั้นเป็นข้อความล้วน ไม่มีการ์ด (การ์ดรายละเอียดส่งไปแล้วตอน T-1 ชม. — ส่งซ้ำคือสแปม)
  try {
    const rows = (await db.calendarEvent.findMany({
      where: {
        agent: "kiki", done: false, date: { gte: dayStart, lt: dayEnd },
        OR: [{ remindedSoon: false }, { remindedNow: false }, { nudgedLate: false }],
      },
    })) as (CalRow & { remindedSoon: boolean; remindedNow: boolean; nudgedLate: boolean })[];

    for (const r of rows) {
      const st = evStart(toKev(r));
      if (!st) continue; // นัดทั้งวันไม่มี T-0 ให้เตือน
      const left = st.getTime() - now.getTime();
      const where = `${r.location ? ` ที่ ${r.location}` : ""}${r.withWho ? ` กับ${r.withWho}` : ""}`;

      // --- A2) อีกราว 10 นาทีจะถึง ---
      if (!r.remindedSoon && left > 0 && left <= 12 * 60_000) {
        await db.calendarEvent.update({ where: { id: r.id }, data: { remindedSoon: true } }).catch(() => {});
        const t = await askKiki(
          `[เตือนนัด ใกล้ถึงแล้ว] อีก ${Math.max(1, Math.round(left / 60_000))} นาทีจะถึงนัด "${r.title}"${where}` +
            ` — เตือนสั้น ๆ บรรทัดเดียว ให้เก็บของ/ออกตัวได้แล้ว`,
        ).catch(() => `อีก ${Math.max(1, Math.round(left / 60_000))} นาทีถึงนัด "${r.title}" แล้วนะครับ`); // canned-ok: ตัวดักพังของงานตามเวลา — สมองล่มก็ต้องเตือนให้ทัน
        sends.push({ chatId: r.chatId, kind: "text", text: t });
        await saveKikiChat("assistant", t, "owner", "cron");
        continue; // ขั้นเดียวต่อรอบต่อนัด — ไม่ยิงรัวติดกัน
      }

      // --- A3) ถึงเวลาแล้ว (T-0) — ขั้นที่เจ้าของบอกว่าหายไป ---
      if (!r.remindedNow && left <= 0 && left > -6 * 60_000) {
        await db.calendarEvent.update({
          where: { id: r.id },
          data: { remindedNow: true, remindedSoon: true, remindedHour: true },
        }).catch(() => {});
        const t = await askKiki(
          `[เตือนนัด ถึงเวลาแล้ว] ตอนนี้ ${r.timeText} น. ถึงเวลานัด "${r.title}"${where} พอดี` +
            ` — บอกสั้น ๆ ว่าถึงเวลาแล้ว 1-2 บรรทัด กวนได้นิดหน่อย`,
        ).catch(() => `ถึงเวลานัด "${r.title}" แล้วครับ ⏰`); // canned-ok: ตัวดักพังของงานตามเวลา — สมองล่มก็ต้องเตือนให้ทัน
        sends.push({ chatId: r.chatId, kind: "text", text: t });
        await saveKikiChat("assistant", t, "owner", "cron");
        continue;
      }

      // --- A4) เลยเวลามา 10 นาทีแล้ว "และเจ้าของยังไม่พูดอะไรเลย" = ทวง ---
      // เงื่อนไขข้อหลังสำคัญ: ตอบแล้ว/คุยอยู่ = ไม่ต้องทวง (กฎข้อ 3 — ดูหลักฐานจริง ไม่เดา)
      if (!r.nudgedLate && r.remindedNow && left <= -10 * 60_000 && left > -40 * 60_000) {
        const spoke = await db.kikiChat.count({
          where: { role: "user", scope: "owner", createdAt: { gte: new Date(st.getTime() - 60_000) } },
        }).catch(() => 1); // นับไม่ได้ = ถือว่าพูดแล้ว ไม่ทวง (เงียบดีกว่ากวนผิด)
        await db.calendarEvent.update({ where: { id: r.id }, data: { nudgedLate: true } }).catch(() => {});
        if (spoke > 0) continue;
        const t = await askKiki(
          `[ทวงนัด] เลยเวลานัด "${r.title}"${where} มา ${Math.round(-left / 60_000)} นาทีแล้ว` +
            ` และเจ้าของยังไม่ได้พูดอะไรเลยตั้งแต่ถึงเวลา — ทวงสั้น ๆ บรรทัดเดียวว่าไปหรือยัง`,
        ).catch(() => `เลยเวลานัด "${r.title}" มา ${Math.round(-left / 60_000)} นาทีแล้วครับ ไปหรือยัง`); // canned-ok: ตัวดักพังของงานตามเวลา
        sends.push({ chatId: r.chatId, kind: "text", text: t });
        await saveKikiChat("assistant", t, "owner", "cron");
      }
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

  // ===== C) บรีฟเช้า 09:10 ฉบับเลขามืออาชีพ (เจ้าของสั่ง 3 ส.ค.) =====
  // ครบทุกมุมในชุดเดียว: นัด · เงินเมื่อวานรายตัว · งบ/pace · รอระบุค้าง · หนี้-บิลใกล้กำหนด · เส้นเงินสด
  try {
    if (mainChat && (now.getHours() > 9 || (now.getHours() === 9 && now.getMinutes() >= 10)) && (await getSetting("kiki_last_brief")) !== today) {
      await setSetting("kiki_last_brief", today);
      const snap = await financeSnapshot();
      const yRows = await db.financeTxn.findMany({ where: { occurredAt: { gte: new Date(dayStart.getTime() - 86400_000), lt: dayStart } }, orderBy: { occurredAt: "asc" } });
      const ySpent = yRows.filter((r) => r.type === "expense").reduce((s, r) => s + r.amount, 0);
      const todayRows = (await db.calendarEvent.findMany({ where: { agent: "kiki", date: { gte: dayStart, lt: dayEnd } }, orderBy: { date: "asc" } })) as CalRow[];
      const tmrCount = await db.calendarEvent.count({ where: { agent: "kiki", date: { gte: dayEnd, lt: tmrEnd } } });
      const pendingRows = await db.financeTxn.findMany({ where: { category: PENDING_CATEGORY }, orderBy: { occurredAt: "asc" }, take: 30 });
      const dueDebts = await db.debt.findMany({ where: { settledAt: null } });
      const bills = await upcomingBills(now, 5);
      const cash = await cashForecast30(now).catch(() => null);

      // การ์ด agenda เฉพาะวันที่มีนัด — วันว่างเอาแต่ข้อความพอ ไม่สแปมภาพ
      if (todayRows.length) {
        await db.calendarEvent.updateMany({ where: { id: { in: todayRows.map((r) => r.id) } }, data: { notified: true } }).catch(() => {});
        const png = await cardPng(agendaCardHtml(todayRows.map(toKev), { heading: "วันนี้", now, travelMin, budgetLine: await budgetLine(), tomorrowLine: tmrCount ? `${tmrCount} นัด` : "ไม่มีนัด" }));
        if (png) sends.push({ chatId: mainChat, kind: "photo", dataBase64: png, filename: "agenda.png" });
      }

      // 6 ส.ค. 2026: จัดใหม่อีกรอบ (เจ้าของ: "รายงานดูเฉย ๆ มาก ให้เพิ่มองค์ประกอบ/จัดเรียงใหม่ + อิโมจิมืออาชีพ")
      // หลักที่ใช้: หัวข้อมีไอคอนนำ · ยอดรวมแยกเป็น sub ของหัวข้อ · ค่าตัวเลขชิดท้ายบรรทัดให้ไล่สายตาได้
      // เรียงตาม "ต้องรู้ก่อน" ไม่ใช่ตามหมวด: นัด → เงินคงเหลือ → กำหนดจ่าย → งานค้าง → รายละเอียดเมื่อวาน
      const sections: VexSection[] = [];

      sections.push({
        icon: todayRows.length ? "🗓" : "🌤",
        head: "นัดวันนี้",
        sub: todayRows.length ? `${todayRows.length} นัด` : undefined,
        lines: todayRows.length
          ? todayRows.map((e) => ({ lead: e.timeText ? `${e.timeText} น.` : "ทั้งวัน", main: `${e.title}${e.location ? ` ที่${e.location}` : ""}` }))
          : ["ว่างทั้งวัน"],
      });

      // สถานะเงินขึ้นก่อนรายการรายตัว — ตอนเช้าต้องรู้ "เหลือเท่าไหร่" ก่อนรู้ "เมื่อวานใช้อะไร"
      const moneyLines: VexRow[] = [];
      if (snap.totalBudget !== null && snap.safePerDay !== null) {
        moneyLines.push({ main: "งบเดือนนี้เหลือ", value: `${fmtBaht(Math.max(0, snap.totalBudget - snap.monthExpense))} ฿` });
        moneyLines.push({ main: "ใช้ได้วันละ", value: `${fmtBaht(Math.floor(snap.safePerDay))} ฿` });
      }
      const net = snap.monthIncome - snap.monthExpense;
      moneyLines.push({ main: net < 0 ? "เดือนนี้ติดลบ" : "เดือนนี้เหลือสุทธิ", value: `${fmtBaht(Math.abs(net))} ฿`, bold: net < 0 });
      if (cash) {
        const warn = cash.lines[cash.lines.length - 1];
        if (warn?.startsWith("⚠️")) moneyLines.push({ main: warn.replace(/^⚠️\s*/, ""), lead: "⚠️", bold: true });
        else moneyLines.push({ main: "คาดการณ์ 30 วัน", value: `เหลือราว ${fmtBaht(Math.round(cash.endBalance))} ฿` });
      }
      if (moneyLines.length) sections.push({ icon: net < 0 ? "📉" : "📈", head: "สถานะเงิน", lines: moneyLines });

      const dueSoon = dueDebts.filter((d) => (d.dueDate && d.dueDate.getTime() - now.getTime() < 3 * 86400_000) || (d.installmentDay && Math.abs(d.installmentDay - now.getDate()) <= 2));
      const dueLines: VexRow[] = [
        ...dueSoon.map((d) => ({ main: `หนี้ ${d.person}`, value: `${fmtBaht(d.installmentAmount || d.amount)} ฿` })),
        ...bills.map((b) => ({ main: b.label, value: `${fmtBaht(b.amount)} ฿ · ${b.inDays === 0 ? "ตัดวันนี้" : `อีก ${b.inDays} วัน`}` })),
      ];
      if (dueLines.length) sections.push({ icon: "⏰", head: "ใกล้ถึงกำหนดจ่าย", sub: `${dueLines.length} รายการ`, lines: dueLines, accent: true });

      const yExpense = yRows.filter((r) => r.type === "expense");
      sections.push({
        icon: "💸",
        head: "เมื่อวานใช้ไป",
        sub: `${fmtBaht(ySpent)} ฿ · ${yExpense.length} รายการ`,
        lines: yExpense.length
          ? yExpense.slice(-8).map((r) => ({ main: r.note || r.category, value: `${fmtBaht(r.amount)} ฿` }))
          : ["ไม่มีรายการ"],
      });

      // งานค้างในกระดาน (ระบบใหม่ 4 ส.ค.) — ทวงเช้าละครั้ง
      const nagTasks = await tasksToNag(now).catch(() => []);
      if (nagTasks.length) {
        await markNagged(nagTasks.map((t) => t.id)).catch(() => {});
        sections.push({
          icon: "📌",
          head: "งานค้างในกระดาน",
          sub: `${nagTasks.length} งาน`,
          lines: nagTasks.slice(0, 10).map((t) => {
            const days = Math.floor((now.getTime() - t.createdAt.getTime()) / 86400_000);
            return { main: t.title, value: days >= 1 ? `ค้างมา ${days} วัน` : undefined };
          }),
        });
      }

      if (pendingRows.length) {
        sections.push({
          icon: "❓",
          head: "เงินออกที่ยังไม่รู้ว่าค่าอะไร",
          sub: `${pendingRows.length} รายการ · ${fmtBaht(pendingRows.reduce((s, r) => s + r.amount, 0))} ฿`,
          lines: [{ main: 'ตอบทีเดียวได้เลย เช่น "1 ค่าข้าว 2 ค่าน้ำมัน" หรือขอลิสต์เต็มได้ตลอด', lead: "→" }],
        });
      }

      const rowText = (l: string | VexRow) => (typeof l === "string" ? l : `${l.main}${l.value ? ` ${l.value}` : ""}`);
      const flat = sections.map((s) => `${s.head}${s.sub ? ` (${s.sub})` : ""}: ${s.lines.map(rowText).join(" / ")}`).join("\n");
      // B4 (7 ส.ค. 2026): สิ่งที่สังเกตได้จากการไตร่ตรองเมื่อคืน — พูดในบรีฟ ไม่แทรกกลางวัน
      let reflectNote = "";
      if ((await getSetting("vex_pattern_speak")) === "1") {
        const yday = new Date(now.getTime() - 86400_000);
        const ydayKey = new Date(yday.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
        const refl = await db.kikiMemory.findFirst({ where: { kind: "reflect", day: ydayKey, scope: "owner" } }).catch(() => null);
        if (refl) reflectNote = `\n\nบันทึกไตร่ตรองของผมเมื่อคืน (แพทเทิร์นที่สังเกตได้ — หยิบมาพูดเฉพาะข้อที่คุ้มค่าการตัดสินใจวันนี้ ไม่มีก็ข้าม):\n${refl.content.slice(0, 1200)}`;
      }
      const comment = await askKiki(
        `[ปิดท้ายบรีฟเช้า] จากข้อมูลบรีฟด้านล่าง เขียน "1 บรรทัดเดียว" ที่มีประโยชน์ที่สุดกับการตัดสินใจวันนี้ (เตือน/ชี้จุดเสี่ยง/สิ่งควรทำ) ห้ามทักทาย ห้ามชมลอย ๆ:\n${flat}${reflectNote}`,
      ).catch(() => "");
      const block = vexSections({
        titleIcon: "☀️",
        title: "บรีฟเช้า",
        subtitle: now.toLocaleDateString("th-TH-u-ca-gregory", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
        sections,
        footer: comment ? comment.split("\n")[0].trim() : undefined,
        footerIcon: "🎯",
      });
      sends.push({ chatId: mainChat, kind: "text", text: block.text, parseMode: block.parseMode });
      await saveKikiChat("assistant", `บรีฟเช้า\n${flat}`);
    }
  } catch { /* พรุ่งนี้ค่อยว่ากัน */ }

  // ===== C2) เย็น 19:00 — ไล่ถามรายการ "รอระบุ" ที่ค้าง (กันหมวดรอระบุบวมเงียบ ๆ) =====
  try {
    if (mainChat && now.getHours() >= 19 && (await getSetting("kiki_last_pending_nag")) !== today) {
      // สภาพเจ้าของ (จิตใจเฟส 3): ช่วงควรเงียบ = เลื่อนการทวงไปรอบถัดไป
      const { ownerPrefersQuiet } = await import("@/lib/kiki-world");
      if (!(await ownerPrefersQuiet().catch(() => false))) {
      await setSetting("kiki_last_pending_nag", today);
      const pend = await db.financeTxn.findMany({ where: { category: PENDING_CATEGORY }, orderBy: { occurredAt: "asc" }, take: 15 });
      if (pend.length) {
        const block = vexList({
          title: `เงินออกที่ยังไม่รู้ว่าค่าอะไร (${pend.length} รายการ · รวม ${fmtBaht(pend.reduce((s, r) => s + r.amount, 0))} ฿)`,
          numbered: true,
          items: pend.map((r) => ({
            main: `${fmtBaht(r.amount)} ฿ — ${(r.note || "").replace(/ \(จากเมล K PLUS\)$/, "") || "ไม่มีรายละเอียด"}`,
            sub: r.occurredAt.toLocaleDateString("th-TH-u-ca-gregory", { day: "numeric", month: "short" }),
          })),
          note: 'ตอบรวดเดียวได้เลยครับ เช่น "1 ค่าข้าว 2 ค่าน้ำมัน" หรือบอกเป็นยอด "319 ค่าตั๋วหนัง"',
        });
        sends.push({ chatId: mainChat, kind: "text", text: block.text, parseMode: block.parseMode });
        await saveKikiChat("assistant", block.text.replace(/<[^>]+>/g, ""));
      }
      }
    }
  } catch { /* พรุ่งนี้ค่อยถาม */ }

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

  // ===== F) เตือนซ้ำประจำ (ทุกวันที่ X / ทุกจันทร์ / ทุกวัน) =====
  try {
    for (const r of await dueRecurrings(now)) {
      const t = await askKiki(`[เตือนประจำ] ถึงรอบเตือนเรื่อง: "${r.title}" — แต่งข้อความเตือน 1-2 บรรทัด กวนได้`).catch(() => `ถึงรอบแล้วครับ ⏰ ${r.title}`);
      sends.push({ chatId: r.chatId, kind: "text", text: t });
      await saveKikiChat("assistant", t);
    }
  } catch { /* รอบหน้าลองใหม่ */ }

  // ===== G) เมลธนาคาร (K PLUS) → ร้านประจำจัดหมวดเอง · บัญชีตัวเองไม่นับ · ที่เหลือถาม "ค่าอะไร" =====
  try {
    if (mainChat) {
      const { txns, ownTransfers } = await pollBankEmails();
      for (const ot of ownTransfers) {
        const t = `🔁 โอนข้ามบัญชีตัวเอง ${fmtBaht(ot.amount)} ฿ (${ot.counterparty}) — ไม่นับเป็นรายจ่ายครับ`;
        sends.push({ chatId: mainChat, kind: "text", text: t });
        await saveKikiChat("assistant", t);
      }
      for (const ev of txns) {
        // โครงข้อความตายตัวตามที่เจ้าของสั่ง (31 ก.ค.): 🟢 เงินเข้า / 🔴 เงินออก + ข้อมูลเรียงอ่านง่าย
        const out = ev.txn.type === "expense";
        const when = ev.txn.occurredAt.toLocaleString("th-TH-u-ca-gregory", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
        const head = [
          `${out ? "🔴 เงินออก" : "🟢 เงินเข้า"} ${fmtBaht(ev.txn.amount)} ฿`,
          `${out ? "ไปที่" : "จาก"}: ${ev.counterparty}`,
          `เวลา: ${when} น. · K PLUS`,
        ].join("\n");
        // ร้านประจำ = จบในข้อความเดียว ไม่ต้องถาม (แก้ได้ถ้าผิด)
        const t = ev.autoCategory
          ? `${head}\n\nร้านประจำ — จัดเข้าหมวด ${ev.autoCategory} ให้แล้วครับ ผิดหมวดสั่งแก้ได้เลย`
          : `${head}\n\n${await askKiki(
              `[แจ้งเงิน${out ? "ออก" : "เข้า"}จากเมลธนาคาร] ส่วนหัวระบบจัดให้แล้ว:\n${head}\n\nเติมท้ายให้ 1 บรรทัด: ${out ? "ถามว่าเป็นค่าอะไร ให้ตอบมาเดี๋ยวจัดหมวดให้" : "ถามว่าเงินอะไรเข้ามา"} ตอบเฉพาะบรรทัดที่จะเติม`,
            ).catch(() => (out ? "ค่าอะไรครับ บอกมาเดี๋ยวจดหมวดให้" : "เงินอะไรเข้ามาครับ"))}`;
        sends.push({ chatId: mainChat, kind: "text", text: t });
        await saveKikiChat("assistant", t);
      }
    }
  } catch { /* รอบหน้าลองใหม่ */ }

  // ===== G1.85) อัปเกรดคลังเสียงเป็นเสียงจริงทันทีที่โควตา Gemini กลับมา =====
  // เจ้าของไม่ชอบเสียง Kanya — อัดไว้ชั่วคราวตอนโควตาหมดเท่านั้น ต้องเปลี่ยนกลับเองอัตโนมัติ
  try {
    if (now.getMinutes() < 2) {
      const { bankNeedsUpgrade, buildBank } = await import("@/lib/kiki-voicebank");
      if ((await bankNeedsUpgrade()) > 0) {
        const r = await buildBank(false);
        if (r.upgraded > 0) {
          console.log(`[vex] อัปเกรดคลังเสียงเป็น Iapetus ${r.upgraded} ประโยค`);
          const { raiseAlert } = await import("@/lib/kiki-monitor");
          await raiseAlert("bank-upgraded", "ok", `โควตาเสียงกลับมาแล้ว — อัดคลังเสียงใหม่ด้วยเสียง Iapetus ${r.upgraded} ประโยค`);
        }
      }
    }
  } catch { /* ชั่วโมงหน้าลองใหม่ */ }

  // ===== G1.9) ปล่อยงานที่รอคิว (เพดาน 2 งานพร้อมกัน — สเปกข้อ 15ฉ) =====
  try {
    const { drainQueue } = await import("@/lib/kiki-jobs");
    const started = await drainQueue();
    if (started) console.log(`[vex] ปล่อยงานจากคิว ${started} งาน`);
  } catch { /* รอบหน้าลองใหม่ */ }

  // ===== G1.95) คิดดัง ๆ — งานที่ทำนานเกินไปต้องส่งเสียงบอก ไม่ใช่เงียบหายสามนาที =====
  try {
    const { ownerInVoice, announceEnabled, queueOut } = await import("@/lib/kiki-outbox");
    if ((await announceEnabled()) && (await ownerInVoice())) {
      const long = await db.kikiHermesJob.findMany({
        where: { status: "running", canceled: false, startedAt: { lt: new Date(Date.now() - 60_000) } },
        take: 2,
      });
      for (const j of long) {
        const mins = Math.round((Date.now() - (j.startedAt || j.createdAt).getTime()) / 60_000);
        const key = `vex_loud_${j.id}_${mins}`;
        if (await getSetting(key)) continue;
        if (mins !== 1 && mins !== 3 && mins !== 6) continue; // พูดที่ 1, 3, 6 นาที ไม่รัวเกินไป
        await setSetting(key, "1");
        const task = j.task.replace(/^\[พัฒนา\]\s*/, "").slice(0, 60);
        await queueOut({
          target: "discord-voice",
          topic: task,
          // canned-ok: ต้องบอกตรง ๆ ว่ายังไม่เสร็จ ห้ามให้ถ้อยคำกลายเป็นเคลมว่าเสร็จแล้ว
          text: `เรื่อง${task}ที่สั่งไว้นะครับ ยังทำอยู่ ผ่านไป ${mins} นาทีแล้ว`,
          priority: 1,
        });
      }
    }
  } catch { /* รอบหน้าลองใหม่ */ }

  // ===== G2) งานที่ฝาก Hermes เสร็จแล้ว → ส่งผลเข้าแชท =====
  //
  // ผลดิบห้ามออกไปตรง ๆ (แก้ 5 ส.ค. 2026): ตัวรับงานเป็นคนละตัวกับ Vex สรรพนาม/หางเสียงคนละแบบ
  // เจ้าของเจอเองว่าลงท้าย "ค่ะ" แล้วหลุดคาแรกเตอร์ทันที · ตรงนี้จึงเรียบเรียงใหม่ด้วยเสียง Vex ก่อนส่ง
  // ข้อเท็จจริงห้ามเปลี่ยน — ตัวเลข ลิงก์ ชื่อรุ่น ต้องยกมาครบเป๊ะ (เขียนกำกับไว้ในคำสั่ง)
  try {
    for (const d of await collectHermesDeliveries()) {
      const chatTo = d.chatId || mainChat;
      if (!chatTo) continue;
      const taskShort = d.task.length > 80 ? `${d.task.slice(0, 80)}...` : d.task;
      if (!d.ok) {
        const t = `งานที่ฝากไว้ ("${taskShort}") ไม่สำเร็จครับ ⚠️ ${d.body}`; // canned-ok: รายงานความล้มเหลว ต้องคงข้อความ error ดิบไว้ให้เห็น
        sends.push({ chatId: chatTo, kind: "text", text: t });
        await markDelivered(d.id, t);
        await saveKikiChat("assistant", t);
        continue;
      }
      if (d.body.length > 3200) {
        const head = await vexLine(`งานที่ฝากไว้เสร็จแล้วครับ ("${taskShort}") — ผลยาว แนบเป็นไฟล์ให้เปิดอ่าน`);
        sends.push({ chatId: chatTo, kind: "text", text: head });
        sends.push({ chatId: chatTo, kind: "document", dataBase64: Buffer.from(d.body, "utf8").toString("base64"), filename: `hermes-${today}.md`, caption: taskShort } as CronSend & { filename: string });
        await markDelivered(d.id, head);
      } else {
        const t = await askKiki(
          `[ส่งผลงานที่ฝากไว้ให้เจ้าของ] โจทย์ที่สั่งไว้คือ: "${d.task.slice(0, 300)}"\n\n` +
            `ผลที่ผู้ช่วยเบื้องหลังทำมา (ยังไม่ได้เรียบเรียง เป็นคนละคนกับคุณ สรรพนาม/หางเสียงอาจไม่ใช่ของคุณ):\n"""${d.body}"""\n\n` +
            `เล่าผลนี้ให้เจ้าของฟังด้วยคำพูดของคุณเอง ขึ้นต้นด้วยการทวนว่านี่คือผลของงานอะไร\n` +
            `กติกา: ตัวเลข ราคา ชื่อรุ่น ลิงก์ ต้องยกมาให้ครบเป๊ะ ห้ามตัดทิ้ง ห้ามแต่งเพิ่มเอง\n` +
            `ลิสต์เขียนบรรทัดละรายการ · ถ้าผลมีตัวเลือกหลายอัน ปิดท้ายด้วยตัวที่แนะนำพร้อมเหตุผล\n` +
            `ถ้าผลที่ได้มาเป็นแค่คำถามกลับ ไม่ใช่ของจริง ให้บอกเจ้าของตรง ๆ ว่ารอบนี้ยังไม่ได้ของ แล้วถามสิ่งที่ขาดพร้อมเสนอตัวเลือกให้เลือก`,
        ).catch(() => `งานที่ฝากไว้เสร็จแล้วครับ ("${taskShort}")\n\n${d.body}`); // canned-ok: ตัวดักพัง — สมองล่มก็ต้องส่งผลถึงมือ
        sends.push({ chatId: chatTo, kind: "text", text: t });
        await markDelivered(d.id, t);
      }
      await saveKikiChat("assistant", `[ผลงาน Hermes] ${d.body.slice(0, 1500)}`);
    }
  } catch { /* รอบหน้าลองใหม่ */ }

  // ===== G1.5) เซสชันของตัวเองหมดอายุ → แจ้งพร้อมปุ่ม "รันเลย" (เจ้าของสั่ง 5 ส.ค.) =====
  //
  // ตัดสินจากหลักฐานของตัวเซสชันเองเท่านั้น (ไฟล์เซสชัน · log ที่ต้องขยับ)
  // ไม่ใช่จากอาการ "ต่อไม่ติด" — วานเคยพลาดตรงนี้แล้วกล่าวหาผิดตัว สั่งงานเจ้าของฟรี ๆ
  try {
    const { checkAllSessions, isBroken, shouldAlert, currentRun } = await import("@/lib/vex-ops");
    if (mainChat && !(await currentRun())) { // กำลังล็อกอินอยู่ = ไม่ต้องแจ้งซ้ำ
      for (const h of checkAllSessions().filter(isBroken)) {
        if (!(await shouldAlert(h.key, 120))) continue;
        const t = await askKiki(
          `[เซสชันหมดอายุ] "${h.label}" ใช้ไม่ได้แล้ว\nหลักฐานที่ตรวจได้: ${h.detail}\n` +
            `${h.interactive ? `ถ้าล็อกอินใหม่จะต้องขอ: ${h.askFor}` : `ล็อกอินใหม่ได้เลย (${h.askFor})`}\n\n` +
            `บอกเจ้าของสั้น ๆ ว่าตัวไหนหมด กระทบอะไร แล้วถามว่าให้จัดการเลยไหม (กดปุ่มด้านล่างได้) ไม่เกิน 3 บรรทัด`,
        ).catch(() => `เซสชัน "${h.label}" หมดอายุแล้วครับ 🔑 (${h.detail}) ให้ผมล็อกอินใหม่ให้เลยไหม`); // canned-ok: ตัวดักพัง — ใบแจ้งต้องถึงมือเสมอ
        sends.push({
          chatId: mainChat, kind: "text", text: t,
          buttons: [[{ text: "รันเลย", data: `auth:${h.key}` }, { text: "ไว้ก่อน", data: "auth-skip" }]],
        });
        await saveKikiChat("assistant", t, "owner", "cron");
      }
    }
  } catch { /* รอบหน้าลองใหม่ */ }

  // ===== G1.6) กำลังล็อกอินอยู่แล้วโปรเซสรออะไรค้าง → ตามถามให้ ไม่ปล่อยค้างเงียบ =====
  try {
    const { currentRun, readRunStatus, pendingPrompt, cleanLog, saveRun } = await import("@/lib/vex-ops");
    const run = await currentRun();
    if (run && readRunStatus(run.id) === "running") {
      const prompt = pendingPrompt(run.id);
      // ถามซ้ำได้ทุก 2 นาที และเฉพาะคำถามที่ยังไม่เคยถาม (กันสแปม)
      if (prompt && prompt !== run.lastPrompt && Date.now() - run.lastAskedAt > 120_000) {
        run.lastAskedAt = Date.now();
        run.lastPrompt = prompt;
        await saveRun(run);
        const t = await askKiki(
          `[กำลังล็อกอินให้เจ้าของ] คำสั่ง ${run.script} ค้างรอให้พิมพ์ตอบว่า: "${prompt}"\n` +
            `ทวงสั้น ๆ 1-2 บรรทัด ว่ารออะไรอยู่ พิมพ์ตอบในแชทได้เลย`,
        ).catch(() => `รอตรงนี้อยู่ครับ: ${prompt}\nพิมพ์ตอบมาได้เลย เดี๋ยวผมกรอกให้`); // canned-ok: ตัวดักพัง — ไม่ถามได้ = ล็อกอินค้างตาย
        sends.push({ chatId: run.chatId || mainChat, kind: "text", text: `${t}\n\n<pre>${cleanLog(run.id, 10).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!))}</pre>`, parseMode: "HTML" });
        await saveKikiChat("assistant", t, "owner", "cron");
      }
    }
  } catch { /* รอบหน้าลองใหม่ */ }

  // ===== G2.5) งานเบื้องหลังยังทำอยู่ → รายงานทุก 3 นาที (เจ้าของสั่ง 4 ส.ค.) =====
  try {
    for (const p of await collectJobPings(now)) {
      sends.push({
        chatId: p.chatId,
        kind: "text",
        text: p.text,
        buttons: [[{ text: "หยุดงานนี้", data: `kiki:job:cancel:${p.jobId}` }]],
      });
    }
  } catch { /* รอบหน้าค่อยรายงาน */ }

  // ===== G3) หนี้ถึงกำหนด/งวดผ่อน + บิลประจำใกล้ตัด (เช็ควันละครั้งตอน >= 10:00) =====
  try {
    if (mainChat && now.getHours() >= 10 && (await getSetting("kiki_last_debt_check")) !== today) {
      await setSetting("kiki_last_debt_check", today);
      const dueLines2 = await debtDueReminders(now);
      for (const line of dueLines2) {
        const t = `⏰ ${line}`;
        sends.push({ chatId: mainChat, kind: "text", text: t });
        await saveKikiChat("assistant", t);
      }
      // B4 (7 ส.ค. 2026): มีงวดต้องจ่ายวันนี้ + เดือนนี้ติดลบอยู่ = บอกให้เห็นภาพเงินก่อนควัก
      if (dueLines2.length && (await getSetting("vex_pattern_speak")) === "1") {
        try {
          const snap2 = await financeSnapshot(now);
          const net2 = snap2.monthIncome - snap2.monthExpense;
          if (net2 < 0) {
            const warn = await askKiki(
              `[เตือนเงินตึงตอนมีงวดต้องจ่าย] เดือนนี้รับ ${fmtBaht(snap2.monthIncome)} จ่ายไปแล้ว ${fmtBaht(snap2.monthExpense)} = ติดลบ ${fmtBaht(Math.abs(net2))} บาท และวันนี้มีงวดหนี้ต้องจ่ายอีก (${dueLines2.length} รายการ) — เตือนสั้น 2 บรรทัด: จ่ายงวดห้ามขาด แต่ให้รู้ตัวว่าเงินเดือนนี้ตึงแค่ไหน + ควรเบรกหมวดไหนที่เบรกได้`,
            ).catch(() => "");
            if (warn) {
              sends.push({ chatId: mainChat, kind: "text", text: warn });
              await saveKikiChat("assistant", warn);
            }
          }
        } catch { /* ไม่มีข้อมูลเงินก็ข้าม */ }
      }
      // บิลตัดในอีก 2 วัน — เตือนล่วงหน้าครั้งเดียวต่อเดือนต่อบิล
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      let reminded: Record<string, string> = {};
      try { reminded = JSON.parse((await getSetting("kiki_bill_reminded")) || "{}"); } catch { /* เริ่มใหม่ */ }
      for (const b of await upcomingBills(now, 2)) {
        if (b.inDays !== 2 || reminded[b.id] === ym) continue;
        reminded[b.id] = ym;
        const t = `⏰ อีก 2 วันบิล "${b.label}" ${fmtBaht(b.amount)} ฿ จะตัด (วันที่ ${b.dayOfMonth}) — เตรียมเงินไว้ครับ`;
        sends.push({ chatId: mainChat, kind: "text", text: t });
        await saveKikiChat("assistant", t);
      }
      await setSetting("kiki_bill_reminded", JSON.stringify(reminded));
      // จับบิลประจำใหม่จากรายการซ้ำ (สะสมข้อมูลพอเมื่อไหร่ก็เริ่มเจอ)
      const found = await detectRecurringBills(now);
      if (found.length) {
        const t = `ผมสังเกตเห็นรายจ่ายซ้ำทุกเดือน เลยขึ้นทะเบียนเป็นบิลประจำให้:\n${found.map((f) => `• ${f}`).join("\n")}\n\nไม่ใช่บิลประจำตัวไหน สั่ง "ยกเลิกบิล..." ได้เลย`;
        sends.push({ chatId: mainChat, kind: "text", text: t });
        await saveKikiChat("assistant", t);
      }
      // ถามข้อมูลผ่อนบัตร/ค่ารถครั้งเดียว (3.2 — เจ้าของสั่งให้มาถามเอง)
      if (!(await getSetting("kiki_asked_installments"))) {
        await setSetting("kiki_asked_installments", "1");
        const t = `โด้มีผ่อนอะไรอยู่บ้างครับ (บัตรเครดิต/ค่ารถ/ผ่อนของ) — บอกทีละรายการแบบนี้ได้เลย:\n\n"ผ่อนบัตรกรุงศรี เดือนละ 3,500 ตัดทุกวันที่ 25 เหลือ 42,000"\n\nผมจะเตือนก่อนตัดทุกงวด + รวมภาระต่อเดือนเข้าเส้นเงินสดให้ครับ`;
        sends.push({ chatId: mainChat, kind: "text", text: t });
        await saveKikiChat("assistant", t);
      }
    }
  } catch { /* พรุ่งนี้ค่อยเช็ค */ }

  // ===== G3.5) เทรนเนอร์อั๋น — เช็คอินทุกเย็น 19:00 ในกลุ่มเทรนเนอร์ =====
  try {
    const { getAunChatId, askTrainer } = await import("@/lib/kiki-aun");
    const aunChat = await getAunChatId();
    if (aunChat && now.getHours() >= 19 && (await getSetting("kiki_last_aun_checkin")) !== today) {
      await setSetting("kiki_last_aun_checkin", today);
      const t = await askTrainer(
        `[เช็คอินประจำเย็น] ทักอั๋นในกลุ่ม: ถามว่าวันนี้ได้ขยับตัว/กินตามแผนไหม ชวนรายงานน้ำหนักถ้ายังไม่ได้ชั่งสัปดาห์นี้ อิงเป้าเดือนปัจจุบันจากแผนจริง สั้น กระชับ ให้กำลังใจ`,
      ).catch(() => "");
      if (t) sends.push({ chatId: aunChat, kind: "text", text: t });
    }
  } catch { /* พรุ่งนี้ค่อยทัก */ }

  // ===== G3.6) ปิดวันของอั๋น — การ์ดสรุปแคล + ครบไม่ครบ (21:00) =====
  try {
    const { getAunChatId, askTrainer } = await import("@/lib/kiki-aun");
    const aunChat = await getAunChatId();
    if (aunChat && now.getHours() >= 21 && (await getSetting("kiki_last_aun_food")) !== today) {
      await setSetting("kiki_last_aun_food", today);
      const { getAunDay, aunDayCardPng, aunDayFacts, dayCaption } = await import("@/lib/kiki-aun-food");
      const day = await getAunDay(now);
      const facts = aunDayFacts(day);
      if (day.meals.length || day.water) {
        const png = await aunDayCardPng(day);
        if (png) sends.push({ chatId: aunChat, kind: "photo", dataBase64: png, filename: `แคลวันนี้-${day.day}.png`, caption: dayCaption(day) } as CronSend & { filename: string });
        const t = await askTrainer(
          `[ปิดวัน] สรุปการกินของอั๋นวันนี้ ระบบส่งการ์ดสรุปให้แล้ว\n[ตัวเลขจริง ห้ามคิดเลขใหม่]\n${facts.map((f) => `- ${f}`).join("\n")}\n\nสรุปให้อั๋นสั้น ๆ ว่าวันนี้ครบไหม ทำอะไรได้ดี พรุ่งนี้ปรับอะไร (ไม่เกิน 5 บรรทัด)${png ? "" : "\n(การ์ดเรนเดอร์ไม่ผ่าน ให้ใส่ตัวเลขสำคัญในข้อความแทน)"}`,
        ).catch(() => "");
        if (t) sends.push({ chatId: aunChat, kind: "text", text: t });
      } else {
        const t = await askTrainer(
          `[ปิดวัน] วันนี้อั๋นยังไม่ได้บันทึกมื้ออาหารเลยสักมื้อ (ระบบเช็คแล้ว 0 มื้อ 0 แก้วน้ำ)\nทักสั้น ๆ ชวนให้พรุ่งนี้ถ่ายรูปอาหารส่งมาทุกมื้อ เดี๋ยวผมคำนวณแคลให้เอง — ไม่ตำหนิ`,
        ).catch(() => "");
        if (t) sends.push({ chatId: aunChat, kind: "text", text: t });
      }
    }
  } catch { /* พรุ่งนี้ค่อยสรุป */ }

  // ===== G4) จำเองไม่ต้องสั่ง — สกัดข้อเท็จจริงใหม่จากบทสนทนาของวัน (21:00) =====
  try {
    if (mainChat && now.getHours() >= 21 && (await getSetting("kiki_last_autofact")) !== today) {
      await setSetting("kiki_last_autofact", today);
      const saved = await autoRememberFromToday(now);
      if (saved.length) {
        const t = `จากที่คุยกันวันนี้ ผมจำเพิ่ม ${saved.length} เรื่อง:\n${saved.map((f) => `• ${f}`).join("\n")}\n\nข้อไหนผิดสั่ง "ลืมเรื่อง..." ได้เลยครับ`;
        sends.push({ chatId: mainChat, kind: "text", text: t });
        await saveKikiChat("assistant", t);
      }
    }
  } catch { /* พรุ่งนี้ค่อยจำ */ }

  // ===== H) เตือน pace เกินงบ (เที่ยงวัน วันละครั้ง ตั้งแต่วันที่ 5 ของเดือน) =====
  try {
    if (mainChat && now.getHours() >= 12 && now.getDate() >= 5 && (await getSetting("kiki_last_pace_warn")) !== today) {
      const snap = await financeSnapshot();
      if (snap.totalBudget !== null && snap.projectedExpense !== null && snap.projectedExpense > snap.totalBudget * 1.05) {
        await setSetting("kiki_last_pace_warn", today);
        const t = await askKiki(
          `[เตือน pace ใช้เงิน] ตอนนี้ pace จะทำให้สิ้นเดือนจ่ายรวม ${fmtBaht(snap.projectedExpense)} บาท เกินงบ ${fmtBaht(snap.totalBudget)} ไป ${fmtBaht(snap.projectedExpense - snap.totalBudget)} บาท — เตือนแรง ๆ ให้เบรก (ด่าได้) 3-4 บรรทัด พร้อมแนะว่าหมวดไหนควรหยุด: ${snap.byCategory.slice(0, 3).map((c) => `${c.category} ${fmtBaht(c.amount)}฿`).join(", ")}`,
        ).catch(() => `⚠️ pace นี้สิ้นเดือนจะเกินงบ ${fmtBaht(snap.projectedExpense! - snap.totalBudget!)} ฿ นะครับ เบรกด่วน`);
        sends.push({ chatId: mainChat, kind: "text", text: t });
        await saveKikiChat("assistant", t);
      } else {
        await setSetting("kiki_last_pace_warn", today); // เช็คแล้ววันนี้ ไม่ต้องเช็คซ้ำ
      }
    }
  } catch { /* พรุ่งนี้ค่อยเช็ค */ }

  // ===== I) อาทิตย์เย็น: รายงานสัปดาห์ HTML + ทวงหนี้ + Vex รีวิวตัวเอง =====
  try {
    if (mainChat && now.getDay() === 0 && now.getHours() >= 19) {
      const wk = `${now.getFullYear()}-w${Math.ceil((now.getDate() + new Date(now.getFullYear(), now.getMonth(), 1).getDay()) / 7)}-${now.getMonth()}`;
      if ((await getSetting("kiki_last_week_report")) !== wk) {
        await setSetting("kiki_last_week_report", wk);
        // 1) รายงานสัปดาห์ HTML ละเอียด
        const facts = await weeklyReportFacts(now);
        const raw = await askClaude(
          `สร้าง "รายงานการเงินประจำสัปดาห์" เป็นไฟล์ HTML สมบูรณ์ (<!doctype html>...</html>) ภาษาไทย ธีมมืด (#161b22) สวยแบบแดชบอร์ด: ตัวเลขใหญ่ ตาราง แถบเทียบหมวดด้วย CSS เทียบสัปดาห์ก่อน + **ตารางรายการละเอียดทุกรายการ** (วันที่ | เวลา | รายการที่ซื้อ/จ่ายตามที่เจ้าของแจ้ง | หมวด | จำนวนเงิน — เอาจาก "รายการสัปดาห์นี้" ด้านล่างครบทุกตัว ห้ามตัด) + ช่อง "คำด่าประจำสัปดาห์" เขียนแบบ Vex (กวนตีน ตรงไปตรงมา) ข้อมูลจริงเท่านั้น:
${facts}
ตอบเป็น HTML ล้วน`,
          { guard: KIKI_GUARD, system: KIKI_PERSONA, timeoutMs: 220_000 },
        ).catch(() => "");
        const m = raw.match(/<!doctype[\s\S]*<\/html>/i) || raw.match(/<html[\s\S]*<\/html>/i);
        if (m) {
          sends.push({ chatId: mainChat, kind: "document", dataBase64: Buffer.from(m[0], "utf8").toString("base64"), filename: `รายงานสัปดาห์-${today}.html`, caption: "รายงานประจำสัปดาห์ครับ เปิดอ่านได้เลย" } as CronSend & { filename: string });
        }
        // 1.5) เทียบกับ "แผนการเงิน" ที่วางไว้ล่าสุด (โหมดที่ปรึกษา — เจ้าของสั่ง 4 ส.ค.)
        try {
          const { latestFinancePlan } = await import("@/lib/kiki-advice");
          const plan = await latestFinancePlan();
          if (plan) {
            const openTasksNow = await db.kikiTask.findMany({ where: { status: "open", detail: "จากการวางแผนการเงิน" }, take: 15 });
            const doneTasks = await db.kikiTask.count({ where: { status: "done", detail: "จากการวางแผนการเงิน", doneAt: { gte: new Date(now.getTime() - 7 * 86400_000) } } });
            const t = await askKiki(
              `[รีวิวแผนการเงินรายสัปดาห์] แผนที่วางไว้เมื่อ ${plan.day}:\n${plan.content.slice(0, 3000)}\n\nสัปดาห์นี้: ปิดงานตามแผมไปแล้ว ${doneTasks} อย่าง · ยังค้าง ${openTasksNow.length} อย่าง (${openTasksNow.map((t2) => t2.title).join(" / ") || "-"})\n\nตัวเลขจริงสัปดาห์นี้:\n${facts.slice(0, 2500)}\n\nเขียนรีวิวสั้น (ไม่เกิน 8 บรรทัด): ทำตามแผนได้แค่ไหน ตรงไหนหลุด ต้องแก้อะไรสัปดาห์หน้า — ตรงไปตรงมา ด่าได้ตามจริง`,
            ).catch(() => "");
            if (t.trim()) {
              sends.push({ chatId: mainChat, kind: "text", text: t.trim() });
              await saveKikiChat("assistant", t.trim());
            }
          }
        } catch { /* ไม่มีแผนก็ข้าม */ }

        // 2) ทวงหนี้
        const nags = await debtNagFacts();
        if (nags.length) {
          const t = await askKiki(`[ทวงหนี้ประจำสัปดาห์] แต่งข้อความเตือนเจ้าของให้ไปทวง (กวนตีนเต็มที่ งานถนัด):
${nags.map((x) => `- ${x}`).join("\n")}`).catch(() => `ทวงหนี้ประจำสัปดาห์:
${nags.join("\n")}`);
          sends.push({ chatId: mainChat, kind: "text", text: t });
          await saveKikiChat("assistant", t);
        }
        // 3) Vex รีวิวตัวเอง → เสนอกฎใหม่ (จิตใจเฟส 6: มีตัวเลขพลาดซ้ำเทียบสัปดาห์ก่อนเสมอ)
        const { weeklySelfReview } = await import("@/lib/kiki-reflect");
        const t = await weeklySelfReview(now).catch(() => "");
        if (t) {
          sends.push({ chatId: mainChat, kind: "text", text: t });
          await saveKikiChat("assistant", t);
        }
      }
    }
  } catch { /* อาทิตย์หน้าลองใหม่ */ }

  // ===== J) ค่ำ 21:30 ถามไถ่วันนี้ (journal + mood) =====
  try {
    if (mainChat && now.getHours() >= 21 && now.getMinutes() >= 30 && (await getSetting("kiki_last_journal_ask")) !== today) {
      // สภาพเจ้าของ (จิตใจเฟส 3): อารมณ์ไม่ดี/เหนื่อยอยู่ = เลื่อนไปก่อน (รอบ cron ถัดไปลองใหม่ ไม่ใช่ยกเลิก)
      const { ownerPrefersQuiet } = await import("@/lib/kiki-world");
      if (!(await ownerPrefersQuiet().catch(() => false))) {
        await setSetting("kiki_last_journal_ask", today);
        await setSetting("kiki_journal_pending", today);
        const t = await askKiki(`[ถามไถ่ก่อนนอน] ทักถามเจ้าของสั้น ๆ ว่าวันนี้เป็นยังไงบ้าง (เล่ามาได้เลย เดี๋ยวจดไดอารี่ให้) — โทนเพื่อนถาม ไม่เกิน 2 บรรทัด อย่าซ้ำกับที่เคยถาม`).catch(() => `วันนี้เป็นไงบ้างครับ เล่าให้ฟังหน่อย เดี๋ยวผมจดไดอารี่ให้ 🗓`);
        sends.push({ chatId: mainChat, kind: "text", text: t });
        await saveKikiChat("assistant", t);
      }
    }
  } catch { /* พรุ่งนี้ค่อยถาม */ }

  // (ยกเลิกแล้ว 3 ส.ค.: ข่าวเช้าจากฟีดเฟส/X 08:30 — เจ้าของสั่งเลิกอ่านโซเชียลทั้งหมด)

  // ===== J2) สรุปบทสนทนาของวันเก็บเป็นความจำระยะยาว (23:00) =====
  try {
    if (now.getHours() >= 23 && (await getSetting("kiki_last_rollup")) !== today) {
      await setSetting("kiki_last_rollup", today);
      await rollupRecentDays().catch(() => []);
      // ไตร่ตรองรอบวัน (จิตใจเฟส 6) — ทบทวนเงียบ ๆ เก็บเป็นความจำ ไม่ส่งหาเจ้าของ
      const { dailyReflect } = await import("@/lib/kiki-reflect");
      await dailyReflect(now).catch(() => null);
    }
  } catch { /* พรุ่งนี้ค่อยสรุป */ }

  // ===== J3) Vex ตรวจการทำงานตัวเองย้อนหลัง 24 ชม. แล้วรายงานเอง (22:00) =====
  // เจ้าของสั่ง 6 ส.ค. 2026: "ให้ Vex จับบั๊กตัวเองได้ ไม่ต้องรอโด้เจอ"
  try {
    if (mainChat && now.getHours() >= 22 && (await getSetting("kiki_last_selfcheck")) !== today) {
      await setSetting("kiki_last_selfcheck", today);
      // B3 (7 ส.ค. 2026): อาการเดิมซ้ำ ≥3 ครั้ง = ไม่แค่รายงาน แต่ร่างสเปกแก้+ปุ่ม "พัฒนาเลย" ให้กดจบ
      const { proposeFromSuspects } = await import("@/lib/kiki-selfheal");
      const proposed = await proposeFromSuspects().catch(() => false);
      if (!proposed) {
        const { selfCheckReport } = await import("@/lib/kiki-turnlog");
        const r = await selfCheckReport(24);
        if (r.count) {
          sends.push({ chatId: mainChat, kind: "text", text: `ตรวจงานตัวเองย้อนหลัง 24 ชั่วโมงแล้วครับ\n\n${r.text}` });
          await saveKikiChat("assistant", r.text);
        }
      }
    }
  } catch { /* พรุ่งนี้ค่อยตรวจ */ }

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

  // ตาข่ายมืออาชีพขาออก: markdown ที่ AI เผลอเขียนต้องไม่หลุดถึง Telegram ดิบ ๆ (เคสจริง 3 ส.ค.)
  const cleaned = sends.map((s) => {
    if (s.kind !== "text" || !s.text || (s as CronSend & { parseMode?: string }).parseMode) return s;
    const c = sanitizeVexText(s.text);
    return { ...s, text: c.text, ...(c.parseMode ? { parseMode: c.parseMode } : {}) };
  });

  // ===== ชั้นเลือกปลายทาง (เฟส 2 — สเปกข้อ 4.4) =====
  // Telegram ได้ของครบเหมือนเดิมทุกอย่างเสมอ (ค่าเริ่มต้นที่ปลอดภัย — ห้ามพลาดเรื่องสำคัญ)
  // ที่เพิ่มคือ "สำเนา" ไปทาง Discord เมื่อเจ้าของเปิดโหมดประกาศไว้เท่านั้น
  // ปิดอยู่ (ค่าเริ่มต้น) = routeProactive ไม่ทำอะไรเลย
  try {
    const { routeProactive } = await import("@/lib/kiki-outbox");
    for (const s of cleaned) {
      if (s.kind !== "text" || !s.text) continue;
      // การ์ด/ไฟล์อ่านออกเสียงไม่ได้ — ตัวที่มีภาพมาคู่กันจะได้แค่ข้อความในห้อง text
      const speakable = !cleaned.some((o) => o !== s && o.kind === "photo" && o.chatId === s.chatId);
      await routeProactive({ topic: topicOf(s.text), text: s.text, speakable });
    }
  } catch { /* กล่องขาออกพังก็ไม่กระทบ Telegram */ }

  return NextResponse.json({ sends: cleaned });
}

// หัวเรื่องสั้น ๆ ของข้อความเชิงรุก — เอาไว้ทวนก่อนพูด (จอดับ เจ้าของมองไม่เห็นว่าตอบเรื่องไหน)
function topicOf(text: string): string {
  const t = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (/บรีฟเช้า/.test(t)) return "บรีฟเช้า";
  if (/นัด|ปฏิทิน/.test(t)) return "นัดหมาย";
  if (/บิล|ตัดบัญชี|subscription/i.test(t)) return "บิลที่ใกล้ตัด";
  if (/หนี้|ผ่อน|งวด/.test(t)) return "หนี้/ค่างวด";
  if (/งบ|pace|เกิน/.test(t)) return "งบประมาณ";
  if (/รอระบุ|ค่าอะไร/.test(t)) return "รายการเงินที่ยังไม่ระบุ";
  if (/Hermes|งานที่ฝาก/i.test(t)) return "งานที่ฝากไว้";
  if (/สรุปสัปดาห์|รายงานสัปดาห์/.test(t)) return "รายงานสัปดาห์";
  if (/เงินเข้า|เงินออก|ใช้ไป|฿/.test(t)) return "การเงิน";
  return t.slice(0, 40);
}
