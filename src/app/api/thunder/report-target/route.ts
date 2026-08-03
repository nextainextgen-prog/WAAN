import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// อัปเดตห้องรายงานแชท — ใช้ตอนกลุ่มถูกอัปเกรดเป็น supergroup แล้ว chat id เปลี่ยน
// (ถ้าไม่ย้ายให้ รายงานจะเงียบหายทุกวันโดยไม่มีใครรู้)
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const chatId = String(b.chatId || "").trim();
  if (!chatId) return NextResponse.json({ ok: false, skip: "ไม่มี chatId" });

  const value = JSON.stringify({ chatId, threadId: b.threadId ? String(b.threadId) : null });
  await db.setting.upsert({
    where: { key: "chat_report_target" },
    update: { value },
    create: { key: "chat_report_target", value },
  });

  // เพิ่มเข้ากลุ่มที่อนุญาตด้วย ไม่งั้นบอทจะเงียบในกลุ่มใหม่
  const row = await db.setting.findUnique({ where: { key: "telegram_groups" } });
  let list: string[] = [];
  try { list = row?.value ? JSON.parse(row.value) : []; } catch { list = []; }
  if (!list.includes(chatId)) {
    list.push(chatId);
    await db.setting.upsert({
      where: { key: "telegram_groups" },
      update: { value: JSON.stringify(list) },
      create: { key: "telegram_groups", value: JSON.stringify(list) },
    });
  }

  return NextResponse.json({ ok: true, chatId, groups: list.length });
}
