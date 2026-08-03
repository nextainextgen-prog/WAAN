import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { renderHtmlToPng } from "@/lib/html-pdf";
import { thaiDate } from "@/lib/calendar";
import { getKikiChatIds, getSetting, setSetting, askKiki, saveKikiChat, sanitizeVexText } from "@/lib/kiki";
import { financeSnapshot, snapshotFacts, financeCardHtml, fmtBaht, upcomingBills, detectRecurringBills, cashForecast30 } from "@/lib/kiki-finance";
import { PENDING_CATEGORY } from "@/lib/kiki-gmail";
import { eventCardHtml, agendaCardHtml, weatherFor, evStart, evEnd, fmtCountdown, type KikiEvent } from "@/lib/kiki-calendar";
import { dueRecurrings, debtNagFacts, weeklyReportFacts, debtDueReminders, autoRememberFromToday } from "@/lib/kiki-life";
import { pollBankEmails } from "@/lib/kiki-gmail";
import { collectHermesDeliveries } from "@/lib/kiki-hermes";
import { askClaude } from "@/lib/claude";
import { KIKI_GUARD, KIKI_PERSONA } from "@/lib/kiki";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 240;

// งานตามเวลาของ Vex — kiki-bot.mjs เรียกทุก 1 นาที แล้วเอา sends ไปส่งเอง (คนละโทเค็นกับวาน)
// ladder เตือนนัด: เย็นก่อนวันนัด 18:00 → เช้าวันนัด 07:00 (ใน brief) → ก่อนเวลา 1 ชม. (ทั้งวัน = 08:00) → ทักหลังนัดจบ
interface CronSend {
  chatId: string;
  kind: "text" | "photo" | "document" | "voice";
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

      // โครงบรีฟ deterministic — ตัวเลขจริงทั้งหมด ให้ AI แต่งได้แค่ 1 บรรทัดความเห็นปิดท้าย
      const secs: string[] = [`บรีฟเช้า · ${now.toLocaleDateString("th-TH-u-ca-gregory", { weekday: "long", day: "numeric", month: "long" })}`];
      secs.push(todayRows.length ? `นัดวันนี้ ${todayRows.length} นัด: ${todayRows.map((e) => `${e.timeText || "ทั้งวัน"} ${e.title}`).join(" · ")}` : "วันนี้ไม่มีนัด");
      if (yRows.length) {
        const items = yRows.filter((r) => r.type === "expense").slice(-6).map((r) => `${r.note || r.category} ${fmtBaht(r.amount)} ฿`).join(" · ");
        secs.push(`เมื่อวานใช้ ${fmtBaht(ySpent)} ฿ (${yRows.filter((r) => r.type === "expense").length} รายการ)${items ? `: ${items}` : ""}`);
      } else {
        secs.push("เมื่อวานไม่มีรายการใช้จ่าย");
      }
      if (snap.totalBudget !== null && snap.safePerDay !== null) secs.push(`งบเดือนนี้เหลือ ${fmtBaht(Math.max(0, snap.totalBudget - snap.monthExpense))} ฿ — ใช้ได้วันละ ${fmtBaht(Math.floor(snap.safePerDay))} ฿`);
      if (pendingRows.length) secs.push(`ค้างระบุหมวด ${pendingRows.length} รายการ (${fmtBaht(pendingRows.reduce((s, r) => s + r.amount, 0))} ฿) — เดี๋ยวผมไล่ถามช่วงเย็น`);
      const dueSoon = dueDebts.filter((d) => (d.dueDate && d.dueDate.getTime() - now.getTime() < 3 * 86400_000) || (d.installmentDay && Math.abs(d.installmentDay - now.getDate()) <= 2));
      if (dueSoon.length) secs.push(`หนี้ใกล้กำหนด: ${dueSoon.map((d) => `${d.person} ${fmtBaht(d.installmentAmount || d.amount)} ฿`).join(" · ")}`);
      if (bills.length) secs.push(`บิลจะตัดเร็ว ๆ นี้: ${bills.map((b) => `${b.label} ${fmtBaht(b.amount)} ฿ (${b.inDays === 0 ? "วันนี้" : `อีก ${b.inDays} วัน`})`).join(" · ")}`);
      if (cash) secs.push(cash.lines[cash.lines.length - 1]?.startsWith("⚠️") ? cash.lines[cash.lines.length - 1] : `คาดการณ์ 30 วัน: เหลือประมาณ ${fmtBaht(Math.round(cash.endBalance))} ฿`);

      const comment = await askKiki(
        `[ปิดท้ายบรีฟเช้า] จากข้อมูลบรีฟด้านล่าง เขียน "1 บรรทัดเดียว" ที่มีประโยชน์ที่สุดกับการตัดสินใจวันนี้ (เตือน/ชี้จุดเสี่ยง/สิ่งควรทำ) ห้ามทักทาย ห้ามชมลอย ๆ:\n${secs.join("\n")}`,
      ).catch(() => "");
      const t = [secs[0], "", ...secs.slice(1).map((s) => `• ${s}`), comment ? `\n${comment.split("\n")[0]}` : ""].filter(Boolean).join("\n");
      sends.push({ chatId: mainChat, kind: "text", text: t });
      await saveKikiChat("assistant", t);
    }
  } catch { /* พรุ่งนี้ค่อยว่ากัน */ }

  // ===== C2) เย็น 19:00 — ไล่ถามรายการ "รอระบุ" ที่ค้าง (กันหมวดรอระบุบวมเงียบ ๆ) =====
  try {
    if (mainChat && now.getHours() >= 19 && (await getSetting("kiki_last_pending_nag")) !== today) {
      await setSetting("kiki_last_pending_nag", today);
      const pend = await db.financeTxn.findMany({ where: { category: PENDING_CATEGORY }, orderBy: { occurredAt: "asc" }, take: 15 });
      if (pend.length) {
        const lines = pend.map((r) => `🔴 เงินออก ${fmtBaht(r.amount)} ฿ · ${(r.note || "").replace(/ \(จากเมล K PLUS\)$/, "")} · ${r.occurredAt.toLocaleDateString("th-TH-u-ca-gregory", { day: "numeric", month: "short" })}`);
        const t = [
          `มี ${pend.length} รายการยังไม่รู้ว่าค่าอะไร (รวม ${fmtBaht(pend.reduce((s, r) => s + r.amount, 0))} ฿)`,
          "",
          ...lines,
          "",
          `ตอบทีละตัวได้เลย: reply ที่บรรทัดไหนไม่ได้ ให้พิมพ์บอกเช่น "319 ค่าตั๋วหนัง" เดี๋ยวผมจับคู่ยอดให้เอง`,
        ].join("\n");
        sends.push({ chatId: mainChat, kind: "text", text: t });
        await saveKikiChat("assistant", t);
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

  // ===== G2) งานที่ฝาก Hermes เสร็จแล้ว → ส่งผลเข้าแชท =====
  try {
    for (const d of await collectHermesDeliveries()) {
      const chatTo = d.chatId || mainChat;
      if (!chatTo) continue;
      const taskShort = d.task.length > 80 ? `${d.task.slice(0, 80)}...` : d.task;
      if (!d.ok) {
        const t = `งานที่ฝากไว้ ("${taskShort}") ไม่สำเร็จครับ ⚠️ ${d.body}`;
        sends.push({ chatId: chatTo, kind: "text", text: t });
        await saveKikiChat("assistant", t);
        continue;
      }
      if (d.body.length > 3200) {
        sends.push({ chatId: chatTo, kind: "text", text: `งานที่ฝากไว้เสร็จแล้วครับ ("${taskShort}") — ผลยาว แนบเป็นไฟล์ให้เปิดอ่าน 📤` });
        sends.push({ chatId: chatTo, kind: "document", dataBase64: Buffer.from(d.body, "utf8").toString("base64"), filename: `hermes-${today}.md`, caption: taskShort } as CronSend & { filename: string });
      } else {
        const t = `งานที่ฝากไว้เสร็จแล้วครับ ("${taskShort}")\n\n${d.body}`;
        sends.push({ chatId: chatTo, kind: "text", text: t });
      }
      await saveKikiChat("assistant", `[ผลงาน Hermes] ${d.body.slice(0, 1500)}`);
    }
  } catch { /* รอบหน้าลองใหม่ */ }

  // ===== G3) หนี้ถึงกำหนด/งวดผ่อน + บิลประจำใกล้ตัด (เช็ควันละครั้งตอน >= 10:00) =====
  try {
    if (mainChat && now.getHours() >= 10 && (await getSetting("kiki_last_debt_check")) !== today) {
      await setSetting("kiki_last_debt_check", today);
      for (const line of await debtDueReminders(now)) {
        const t = `⏰ ${line}`;
        sends.push({ chatId: mainChat, kind: "text", text: t });
        await saveKikiChat("assistant", t);
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
        const t = `พี่มีผ่อนอะไรอยู่บ้างครับ (บัตรเครดิต/ค่ารถ/ผ่อนของ) — บอกทีละรายการแบบนี้ได้เลย:\n\n"ผ่อนบัตรกรุงศรี เดือนละ 3,500 ตัดทุกวันที่ 25 เหลือ 42,000"\n\nผมจะเตือนก่อนตัดทุกงวด + รวมภาระต่อเดือนเข้าเส้นเงินสดให้ครับ`;
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
        // 2) ทวงหนี้
        const nags = await debtNagFacts();
        if (nags.length) {
          const t = await askKiki(`[ทวงหนี้ประจำสัปดาห์] แต่งข้อความเตือนเจ้าของให้ไปทวง (กวนตีนเต็มที่ งานถนัด):
${nags.map((x) => `- ${x}`).join("\n")}`).catch(() => `ทวงหนี้ประจำสัปดาห์:
${nags.join("\n")}`);
          sends.push({ chatId: mainChat, kind: "text", text: t });
          await saveKikiChat("assistant", t);
        }
        // 3) Vex รีวิวตัวเอง → เสนอกฎใหม่
        const chats = await db.kikiChat.findMany({ where: { createdAt: { gte: new Date(now.getTime() - 7 * 86400_000) } }, orderBy: { createdAt: "asc" }, take: 200 });
        if (chats.length >= 10) {
          const log = chats.map((c) => `${c.role === "user" ? "เจ้าของ" : "Vex"}: ${c.content.replace(/\s+/g, " ").slice(0, 200)}`).join("\n");
          const t = await askKiki(
            `[รีวิวตัวเองรายสัปดาห์] อ่านบทสนทนา 7 วันล่าสุดของตัวเอง: หาว่าโดนเจ้าของด่า/แก้เรื่องอะไร ทำอะไรพลาด แล้วเสนอ "กฎใหม่ 2-3 ข้อ" ที่จะทำให้ไม่พลาดซ้ำ (สั้น ทำได้จริง) ปิดท้ายบอกเจ้าของว่าถ้าเห็นด้วยข้อไหน พิมพ์ "สอนว่า <กฎ>" มาได้เลยจะจำถาวร\n\nบทสนทนา:\n${log.slice(0, 12000)}`,
          ).catch(() => "");
          if (t) {
            sends.push({ chatId: mainChat, kind: "text", text: t });
            await saveKikiChat("assistant", t);
          }
        }
      }
    }
  } catch { /* อาทิตย์หน้าลองใหม่ */ }

  // ===== J) ค่ำ 21:30 ถามไถ่วันนี้ (journal + mood) =====
  try {
    if (mainChat && now.getHours() >= 21 && now.getMinutes() >= 30 && (await getSetting("kiki_last_journal_ask")) !== today) {
      await setSetting("kiki_last_journal_ask", today);
      await setSetting("kiki_journal_pending", today);
      const t = await askKiki(`[ถามไถ่ก่อนนอน] ทักถามเจ้าของสั้น ๆ ว่าวันนี้เป็นยังไงบ้าง (เล่ามาได้เลย เดี๋ยวจดไดอารี่ให้) — โทนเพื่อนถาม ไม่เกิน 2 บรรทัด อย่าซ้ำกับที่เคยถาม`).catch(() => `วันนี้เป็นไงบ้างครับ เล่าให้ฟังหน่อย เดี๋ยวผมจดไดอารี่ให้ 🗓`);
      sends.push({ chatId: mainChat, kind: "text", text: t });
      await saveKikiChat("assistant", t);
    }
  } catch { /* พรุ่งนี้ค่อยถาม */ }

  // (ยกเลิกแล้ว 3 ส.ค.: ข่าวเช้าจากฟีดเฟส/X 08:30 — เจ้าของสั่งเลิกอ่านโซเชียลทั้งหมด)

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
  return NextResponse.json({ sends: cleaned });
}
