import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { getBotToken, tgSendMessage } from "@/lib/telegram";
import { getDueEvents, markNotified, thaiDate } from "@/lib/calendar";

export const runtime = "nodejs";

// ยิงแจ้งเตือนงานที่ถึงกำหนดวันนี้ (บอทเรียกเป็นระยะ) แล้ว mark ว่าแจ้งแล้ว
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!getBotToken()) return NextResponse.json({ error: "no bot token" }, { status: 400 });

  const due = await getDueEvents();
  if (!due.length) return NextResponse.json({ ok: true, sent: 0 });

  // จัดกลุ่มตามแชท แล้วส่งทีเดียวต่อแชท
  const byChat = new Map<string, typeof due>();
  for (const e of due) {
    const arr = byChat.get(e.chatId) || [];
    arr.push(e);
    byChat.set(e.chatId, arr);
  }

  const sentIds: string[] = [];
  for (const [chatId, events] of byChat) {
    const lines = events.map(
      (e) => `• ${e.title}${e.timeText ? ` (เวลา ${e.timeText})` : ""}${e.emoji ? ` ${e.emoji}` : ""}`,
    );
    const head = events.length === 1 ? "ถึงกำหนดงานวันนี้แล้วนะคะ" : `ถึงกำหนด ${events.length} งานวันนี้แล้วนะคะ`;
    const msg = `⏰ ${head} (${thaiDate(events[0].date)})\n${lines.join("\n")}`;
    try {
      await tgSendMessage(chatId, msg);
      sentIds.push(...events.map((e) => e.id));
    } catch {
      /* ส่งไม่สำเร็จ ยังไม่ mark เพื่อให้รอบหน้าลองใหม่ */
    }
  }
  await markNotified(sentIds);
  return NextResponse.json({ ok: true, sent: sentIds.length });
}
