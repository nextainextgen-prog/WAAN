import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { bizDateOf, prevBizDate } from "@/lib/thunder";
import { analyzePhase, generateAndSaveDailyReport, purgeOldChatLogs } from "@/lib/chat-report";
import { getAllowedChatId } from "@/lib/telegram";
import { findRoleTopic } from "@/lib/roles";

export const runtime = "nodejs";
export const maxDuration = 3600; // วิเคราะห์หลายสิบเคสด้วยโมเดลในเครื่อง ใช้เวลานานได้

// ห้องรายงานแชท: Setting ที่ผูกผ่านแชท → ห้อง monitor → แชทเจ้าของ
async function reportTarget(): Promise<{ chatId: string; threadId?: string } | null> {
  const row = await db.setting.findUnique({ where: { key: "chat_report_target" } }).catch(() => null);
  if (row?.value) {
    try {
      const t = JSON.parse(row.value);
      if (t?.chatId) return { chatId: String(t.chatId), threadId: t.threadId ? String(t.threadId) : undefined };
    } catch { /* ตกไปใช้ค่าถัดไป */ }
  }
  const mon = await findRoleTopic("monitor").catch(() => null);
  if (mon?.chatId) return { chatId: mon.chatId, threadId: mon.threadId };
  const owner = await getAllowedChatId();
  return owner ? { chatId: owner } : null;
}

// phase = "analyze" → วิเคราะห์ + คัดเคสเด่น (คืน convId ให้ไปแคปภาพ)
// phase = "report"  → สร้างรายงานฉบับเต็ม (หลังแคปภาพเสร็จ)
// ไม่ระบุ phase = ทำทั้งสองต่อกัน (ไม่มีภาพ)
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const bizDate = String(b.bizDate || prevBizDate(bizDateOf()));
  const phase = String(b.phase || "all");

  if (phase === "analyze") {
    const r = await analyzePhase(bizDate);
    return NextResponse.json({ ok: true, bizDate, analyzed: r.analyzed, highlights: r.highlights });
  }

  if (phase !== "report") await analyzePhase(bizDate);
  const { messages, markdown, html, chatCount } = await generateAndSaveDailyReport(bizDate);
  const purged = b.purge === false ? 0 : await purgeOldChatLogs(90);
  const target = await reportTarget();
  return NextResponse.json({ ok: true, bizDate, chatCount, messages, markdown, html, target, purged });
}
