import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAllowedChatId, getBotToken, tgSendMessage } from "@/lib/telegram";
import { statusLabel, formatThaiDate, daysUntil, formatBahtShort } from "@/lib/grants";
import { getOkrSummary } from "@/lib/data";
import { isMuted } from "@/lib/mute";

export const runtime = "nodejs";

// แจ้งเตือน deadline ประจำวัน (ตั้ง cron ให้ยิงทุกเช้า)
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!getBotToken()) return NextResponse.json({ error: "no bot token" }, { status: 400 });
  const chatId = await getAllowedChatId();
  if (!chatId) return NextResponse.json({ error: "no bound chat" }, { status: 400 });
  // กลุ่มนี้สั่งปิดแจ้งเตือนไว้ → ไม่ส่งสรุปประจำวัน (มีเตือนเช้า-เย็นแยกว่ายังปิดอยู่)
  if (await isMuted(chatId)) return NextResponse.json({ ok: true, muted: true });

  const [grants, okr] = await Promise.all([
    db.grant.findMany({ where: { status: { not: "closed" } } }),
    getOkrSummary(),
  ]);

  const withDl = grants
    .map((g) => ({ g, d: daysUntil(g.nextDeadline) }))
    .filter((x) => x.d !== null);

  const overdue = withDl.filter((x) => (x.d ?? 0) < 0).sort((a, b) => (a.d ?? 0) - (b.d ?? 0));
  const soon = withDl.filter((x) => (x.d ?? 99) >= 0 && (x.d ?? 99) <= 7).sort((a, b) => (a.d ?? 0) - (b.d ?? 0));

  const today = formatThaiDate(new Date());
  let msg = `สรุปงานประจำวัน ${today}\n\nOKR: บรรลุ ${okr.percent}% (${formatBahtShort(okr.actual)}/${formatBahtShort(okr.target)} บาท) · ${okr.totalGrants} ทุน`;

  if (overdue.length) {
    msg += `\n\nเลยกำหนด (${overdue.length}):`;
    for (const { g, d } of overdue.slice(0, 8))
      msg += `\n- ${g.projectName} — เลย ${Math.abs(d ?? 0)} วัน (${statusLabel(g.status)})`;
  }
  if (soon.length) {
    msg += `\n\nใกล้ครบกำหนดใน 7 วัน (${soon.length}):`;
    for (const { g, d } of soon.slice(0, 8))
      msg += `\n- ${g.projectName} — อีก ${d} วัน · ${formatThaiDate(g.nextDeadline)} (${statusLabel(g.status)})`;
  }
  if (!overdue.length && !soon.length) {
    msg += `\n\nไม่มีงานที่ใกล้ครบกำหนดใน 7 วันข้างหน้า`;
  }

  await tgSendMessage(chatId, msg);
  return NextResponse.json({ ok: true, overdue: overdue.length, soon: soon.length });
}
