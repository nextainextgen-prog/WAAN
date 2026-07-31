import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { renderHtmlToPng } from "@/lib/html-pdf";
import { getDueEvents, markNotified, thaiDate } from "@/lib/calendar";
import { getKikiChatIds, getSetting, setSetting, askKiki, saveKikiChat } from "@/lib/kiki";
import { financeSnapshot, snapshotFacts, financeCardHtml, fmtBaht } from "@/lib/kiki-finance";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 240;

// งานตามเวลาของ Vex — kiki-bot.mjs เรียกทุก ๆ 1 นาที แล้วเอา sends ไปส่งเอง (คนละโทเค็นกับวาน)
interface CronSend {
  chatId: string;
  kind: "text" | "photo";
  text?: string;
  dataBase64?: string;
  caption?: string;
  filename?: string;
}

export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sends: CronSend[] = [];
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const chats = await getKikiChatIds();
  const mainChat = chats[0];

  // ===== 1) นัดถึงกำหนดวันนี้ (agent kiki เท่านั้น) =====
  try {
    const due = await getDueEvents("kiki");
    if (due.length) {
      const byChat = new Map<string, typeof due>();
      for (const e of due) {
        const arr = byChat.get(e.chatId) || [];
        arr.push(e);
        byChat.set(e.chatId, arr);
      }
      const ids: string[] = [];
      for (const [chatId, events] of byChat) {
        const lines = events.map((e) => `• ${e.title}${e.timeText ? ` (${e.timeText} น.)` : ""}${e.emoji ? ` ${e.emoji}` : ""}`);
        sends.push({ chatId, kind: "text", text: `⏰ วันนี้มีนัดครับ (${thaiDate(events[0].date)})\n\n${lines.join("\n")}\n\nอย่าลืมล่ะ` });
        ids.push(...events.map((e) => e.id));
      }
      await markNotified(ids);
    }
  } catch { /* รอบหน้าลองใหม่ */ }

  // ===== 2) สรุปเช้า 07:00 (วันละครั้ง) =====
  try {
    if (mainChat && now.getHours() >= 7 && (await getSetting("kiki_last_brief")) !== today) {
      await setSetting("kiki_last_brief", today);
      const snap = await financeSnapshot();
      const yStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const yEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yRows = await db.financeTxn.findMany({ where: { type: "expense", occurredAt: { gte: yStart, lt: yEnd } } });
      const ySpent = yRows.reduce((s, r) => s + r.amount, 0);
      const ups = await db.calendarEvent.findMany({
        where: { agent: "kiki", done: false, date: { gte: yEnd, lt: new Date(yEnd.getTime() + 86400_000) } },
      });
      // มีอะไรให้พูดค่อยพูด — เช้าไหนไม่มีทั้งนัด ไม่มีการใช้เงิน ก็เงียบไว้ ไม่สแปม
      if (ySpent > 0 || ups.length > 0 || snap.txnCount > 0) {
        const facts = [
          `เมื่อวานใช้ไป ${fmtBaht(ySpent)} บาท (${yRows.length} รายการ)`,
          ...snapshotFacts(snap),
          ups.length ? `นัดวันนี้: ${ups.map((e) => `${e.title}${e.timeText ? ` ${e.timeText}น.` : ""}`).join(" · ")}` : "วันนี้ไม่มีนัด",
        ];
        const t = await askKiki(
          `[สรุปเช้าประจำวัน] แต่งข้อความทักเช้าสั้น ๆ (ไม่เกิน 6 บรรทัด) จากข้อเท็จจริงจริงเท่านั้น:\n${facts.map((f) => `- ${f}`).join("\n")}\n\nโทน: ทักเช้าแบบกวน ๆ + เตือนงบ/นัดวันนี้ ตอบเป็นข้อความที่จะส่งเลย`,
        ).catch(() => `เช้าแล้วครับ ⏰\n\nเมื่อวานใช้ไป ${fmtBaht(ySpent)} ฿${ups.length ? `\nวันนี้มีนัด: ${ups.map((e) => e.title).join(", ")}` : ""}`);
        sends.push({ chatId: mainChat, kind: "text", text: t });
        await saveKikiChat("assistant", t);
      }
    }
  } catch { /* พรุ่งนี้ค่อยว่ากัน */ }

  // ===== 3) สรุปสิ้นเดือน (วันที่ 1 เวลา >= 08:00 สรุปเดือนที่แล้ว) =====
  try {
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (mainChat && now.getDate() === 1 && now.getHours() >= 8 && (await getSetting("kiki_last_month_report")) !== ym) {
      await setSetting("kiki_last_month_report", ym);
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
      const snap = await financeSnapshot(lastMonth);
      try {
        const png = await renderHtmlToPng(financeCardHtml(snap), { width: 720, height: 200 });
        sends.push({ chatId: mainChat, kind: "photo", dataBase64: png.toString("base64"), filename: "month-summary.png", caption: "📉 สรุปเดือนที่แล้วครับ" });
      } catch { /* การ์ดพลาดก็ส่งแต่ข้อความ */ }
      const t = await askKiki(
        `[สรุปสิ้นเดือน] เดือนที่แล้วจบแล้ว แต่งสรุป+วิจารณ์พฤติกรรมใช้เงิน (ชม/ด่าตามจริง) จากข้อเท็จจริง:\n${snapshotFacts(snap).map((f) => `- ${f}`).join("\n")}\n\nไม่เกิน 8 บรรทัด ตอบเป็นข้อความที่จะส่งเลย`,
      ).catch(() => `จบเดือนแล้วครับ 📉 ใช้ไปทั้งเดือน ${fmtBaht(snap.monthExpense)} ฿ · รับเข้า ${fmtBaht(snap.monthIncome)} ฿`);
      sends.push({ chatId: mainChat, kind: "text", text: t });
      await saveKikiChat("assistant", t);
    }
  } catch { /* เดือนหน้าลองใหม่ */ }

  return NextResponse.json({ sends });
}
