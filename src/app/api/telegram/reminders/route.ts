import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAllowedChatId, getBotToken, tgSendMessage } from "@/lib/telegram";
import { statusLabel, formatThaiDate, daysUntil, formatBahtShort } from "@/lib/grants";
import { getOkrSummary, getStuckGrants } from "@/lib/data";
import { fiscalLabel } from "@/lib/fiscal";
import { isMuted } from "@/lib/mute";

export const runtime = "nodejs";

// จำนวนวันที่ถือว่าทุน "ค้าง" ในสถานะเดิมนานเกินไป
const STUCK_DAYS = 60;

// แจ้งเตือน deadline ประจำวัน (ตั้ง cron ให้ยิงทุกเช้า)
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!getBotToken()) return NextResponse.json({ error: "no bot token" }, { status: 400 });
  const chatId = await getAllowedChatId();
  if (!chatId) return NextResponse.json({ error: "no bound chat" }, { status: 400 });
  // กลุ่มนี้สั่งปิดแจ้งเตือนไว้ → ไม่ส่งสรุปประจำวัน (มีเตือนเช้า-เย็นแยกว่ายังปิดอยู่)
  if (await isMuted(chatId)) return NextResponse.json({ ok: true, muted: true });

  const [grants, okr, stuck] = await Promise.all([
    db.grant.findMany({ where: { status: { not: "closed" } } }),
    getOkrSummary(),
    getStuckGrants(STUCK_DAYS),
  ]);

  const withDl = grants
    .map((g) => ({ g, d: daysUntil(g.nextDeadline) }))
    .filter((x) => x.d !== null);

  const overdue = withDl.filter((x) => (x.d ?? 0) < 0).sort((a, b) => (a.d ?? 0) - (b.d ?? 0));
  const soon = withDl
    .filter((x) => (x.d ?? 99) >= 0 && (x.d ?? 99) <= 7)
    .sort((a, b) => (a.d ?? 0) - (b.d ?? 0));

  // งวดเงินที่ครบกำหนดรับใน 7 วัน (ยังไม่ได้รับ)
  const dueSoon = okr.dueInstallments.filter((a) => (a.days ?? 99) <= 7);

  const today = formatThaiDate(new Date());
  let msg = `สรุปงานประจำวัน ${today}`;

  // บรรทัดจังหวะ OKR — เห็นทันทีว่าตามเป้าหรือไม่
  msg += `\n\nOKR ปีงบ ${fiscalLabel(okr.fiscalYear)} · เหลือ ${okr.daysLeft} วัน`;
  msg += `\nรับจริง ${formatBahtShort(okr.received)} / ${formatBahtShort(okr.target)} บาท (${okr.percent}%)`;
  msg +=
    okr.paceDelta < 0
      ? `\nช้ากว่าเป้า ${formatBahtShort(Math.abs(okr.paceDelta))} บาท (ณ วันนี้ควรได้ ${formatBahtShort(okr.paceTarget)})`
      : `\nนำเป้าอยู่ ${formatBahtShort(okr.paceDelta)} บาท`;
  msg += `\nผูกพันรอรับอีก ${formatBahtShort(okr.awaiting)} บาท · คาดสิ้นปีงบ ${formatBahtShort(okr.forecast)} บาท (${okr.forecastPercent}%)`;

  if (okr.overdueInstallments.length) {
    msg += `\n\nงวดเงินเลยกำหนดรับ (${okr.overdueInstallments.length}):`;
    for (const a of okr.overdueInstallments.slice(0, 8))
      msg += `\n- ${a.projectName} — ${a.label} ${formatBahtShort(a.amount)} บาท · เลย ${Math.abs(a.days ?? 0)} วัน`;
  }

  if (dueSoon.length) {
    msg += `\n\nงวดเงินที่จะรับใน 7 วัน (${dueSoon.length}):`;
    for (const a of dueSoon.slice(0, 8))
      msg += `\n- ${a.projectName} — ${a.label} ${formatBahtShort(a.amount)} บาท · อีก ${a.days} วัน`;
  }

  if (overdue.length) {
    msg += `\n\nงานเลยกำหนด (${overdue.length}):`;
    for (const { g, d } of overdue.slice(0, 8))
      msg += `\n- ${g.projectName} — เลย ${Math.abs(d ?? 0)} วัน (${statusLabel(g.status)})`;
  }
  if (soon.length) {
    msg += `\n\nงานใกล้ครบกำหนดใน 7 วัน (${soon.length}):`;
    for (const { g, d } of soon.slice(0, 8))
      msg += `\n- ${g.projectName} — อีก ${d} วัน · ${formatThaiDate(g.nextDeadline)} (${statusLabel(g.status)})`;
  }

  if (okr.missingInstallments.length) {
    msg += `\n\nทุนที่อนุมัติแล้วแต่ยังไม่ได้ลงงวดเงิน (${okr.missingInstallments.length}) — เงินรับจริงยังนับไม่ครบ:`;
    for (const g of okr.missingInstallments.slice(0, 5))
      msg += `\n- ${g.projectName} (${formatBahtShort(g.amount)} บาท)`;
  }

  if (stuck.length) {
    msg += `\n\nทุนที่ค้างสถานะเดิมเกิน ${STUCK_DAYS} วัน (${stuck.length}):`;
    for (const s of stuck.slice(0, 5))
      msg += `\n- ${s.projectName} — ค้างที่ "${statusLabel(s.status)}" มา ${s.days} วัน`;
  }

  const nothing =
    !overdue.length &&
    !soon.length &&
    !dueSoon.length &&
    !okr.overdueInstallments.length &&
    !okr.missingInstallments.length &&
    !stuck.length;
  if (nothing) msg += `\n\nไม่มีงานค้างหรือใกล้ครบกำหนดใน 7 วันข้างหน้า`;

  await tgSendMessage(chatId, msg);
  return NextResponse.json({
    ok: true,
    overdue: overdue.length,
    soon: soon.length,
    overdueInstallments: okr.overdueInstallments.length,
    dueSoon: dueSoon.length,
    stuck: stuck.length,
  });
}
