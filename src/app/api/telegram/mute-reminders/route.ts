import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { getBotToken, tgSendMessage } from "@/lib/telegram";
import { listMutedGroups } from "@/lib/mute";
import { thaiDate } from "@/lib/calendar";

export const runtime = "nodejs";

// เตือนรอบเช้า-เย็น: กลุ่มไหนที่ยัง "ปิดแจ้งเตือน" อยู่ วานกระซิบเตือนกันลืม (ตั้ง cron เช้า+เย็น)
// ส่งตรงด้วย tgSendMessage (ไม่โดน isMuted กั้น) เพราะตั้งใจส่งเข้ากลุ่มที่ปิดไว้โดยเฉพาะ
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!getBotToken()) return NextResponse.json({ error: "no bot token" }, { status: 400 });

  const muted = await listMutedGroups();
  const period = new Date().getHours() < 14 ? "เช้านี้" : "เย็นนี้";
  let sent = 0;
  for (const g of muted) {
    // กลุ่มที่ตั้งกำหนดเปิดเองไว้แล้ว ไม่ต้องจ้ำจี้ — ข้ามไป (มันเปิดเองอยู่แล้ว)
    if (g.until) continue;
    const since = g.since ? ` (ตั้งแต่ ${thaiDate(new Date(g.since))})` : "";
    await tgSendMessage(
      g.chatId,
      `🔕 กระซิบเตือน${period}ค่ะ — กลุ่มนี้ยังปิดแจ้งเตือนอยู่${since} ถ้าพร้อมรับแจ้งเตือนแล้ว พิมพ์ "เปิดแจ้งเตือน" ได้เลยนะคะ`,
    ).catch(() => {});
    sent++;
  }
  return NextResponse.json({ ok: true, muted: muted.length, sent });
}
