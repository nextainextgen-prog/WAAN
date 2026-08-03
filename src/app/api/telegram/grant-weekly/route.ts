import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAllowedChatId, getBotToken, tgSendMessage } from "@/lib/telegram";
import { statusLabel, formatBahtShort, formatThaiDate } from "@/lib/grants";
import { getOkrSummary, installmentReceived } from "@/lib/data";
import { fiscalLabel } from "@/lib/fiscal";
import { isMuted } from "@/lib/mute";

export const runtime = "nodejs";

// สรุปทุนวิจัยรายสัปดาห์ (ตั้ง cron ให้ยิงเช้าวันจันทร์)
// ต่างจาก reminders รายวันตรงที่มองย้อนหลัง 7 วันว่า "สัปดาห์ที่ผ่านมาขยับอะไรไปบ้าง"
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!getBotToken()) return NextResponse.json({ error: "no bot token" }, { status: 400 });
  const chatId = await getAllowedChatId();
  if (!chatId) return NextResponse.json({ error: "no bound chat" }, { status: 400 });
  if (await isMuted(chatId)) return NextResponse.json({ ok: true, muted: true });

  const since = new Date(Date.now() - 7 * 86_400_000);

  const [okr, receivedThisWeek, statusMoves, newGrants] = await Promise.all([
    getOkrSummary(),
    db.grantInstallment.findMany({
      where: { receivedAt: { gte: since } },
      include: { grant: { select: { projectName: true } } },
      orderBy: { receivedAt: "desc" },
    }),
    db.grantEvent.findMany({
      where: { kind: "status", createdAt: { gte: since } },
      include: { grant: { select: { projectName: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.grant.findMany({
      where: { createdAt: { gte: since } },
      select: { projectName: true, amount: true },
    }),
  ]);

  const weekMoney = receivedThisWeek.reduce((s, i) => s + installmentReceived(i), 0);

  let msg = `สรุปทุนวิจัยรายสัปดาห์ · ${formatThaiDate(since)} ถึง ${formatThaiDate(new Date())}`;

  msg += `\n\nเงินเข้าสัปดาห์นี้ ${formatBahtShort(weekMoney)} บาท (${receivedThisWeek.length} งวด)`;
  msg += `\nสะสมปีงบ ${fiscalLabel(okr.fiscalYear)}: ${formatBahtShort(okr.received)} / ${formatBahtShort(okr.target)} บาท (${okr.percent}%)`;
  msg +=
    okr.paceDelta < 0
      ? `\nช้ากว่าเป้า ${formatBahtShort(Math.abs(okr.paceDelta))} บาท · เหลือ ${okr.daysLeft} วัน`
      : `\nนำเป้า ${formatBahtShort(okr.paceDelta)} บาท · เหลือ ${okr.daysLeft} วัน`;

  if (receivedThisWeek.length) {
    msg += `\n\nงวดที่รับเงินแล้ว:`;
    for (const i of receivedThisWeek.slice(0, 10))
      msg += `\n- ${i.grant.projectName} — ${i.label || `งวดที่ ${i.seq}`} ${formatBahtShort(installmentReceived(i))} บาท`;
  }

  if (statusMoves.length) {
    msg += `\n\nทุนที่ขยับสถานะ (${statusMoves.length}):`;
    for (const e of statusMoves.slice(0, 10))
      msg += `\n- ${e.grant.projectName} — ${statusLabel(e.fromStatus || "")} → ${statusLabel(e.toStatus || "")}`;
  }

  if (newGrants.length) {
    msg += `\n\nทุนใหม่ที่เพิ่มเข้าระบบ (${newGrants.length}):`;
    for (const g of newGrants.slice(0, 8))
      msg += `\n- ${g.projectName} (${formatBahtShort(g.amount)} บาท)`;
  }

  if (!receivedThisWeek.length && !statusMoves.length && !newGrants.length) {
    msg += `\n\nสัปดาห์นี้ไม่มีความเคลื่อนไหวของทุน`;
  }

  // สิ่งที่ต้องทำต่อ
  const todo: string[] = [];
  if (okr.overdueInstallments.length)
    todo.push(`ตามงวดที่เลยกำหนดรับ ${okr.overdueInstallments.length} งวด`);
  if (okr.dueInstallments.length)
    todo.push(`เตรียมเบิกงวดที่ครบกำหนดใน 30 วัน ${okr.dueInstallments.length} งวด`);
  if (okr.missingInstallments.length)
    todo.push(`ลงงวดเงินให้ทุนที่อนุมัติแล้ว ${okr.missingInstallments.length} ทุน`);
  if (todo.length) msg += `\n\nสัปดาห์หน้าควรทำ:\n- ${todo.join("\n- ")}`;

  await tgSendMessage(chatId, msg);
  return NextResponse.json({
    ok: true,
    weekMoney,
    received: receivedThisWeek.length,
    moves: statusMoves.length,
    newGrants: newGrants.length,
  });
}
