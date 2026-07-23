import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { findMemoIdByMessage, recordMemoMessage } from "@/lib/memo-store";

export const runtime = "nodejs";

// GET ?chatId=&msgId= → { id } : หา memo จากข้อความในกลุ่ม (ไว้จับ reply แก้ไข)
export async function GET(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const chatId = sp.get("chatId") || "";
  const msgId = Number(sp.get("msgId") || 0);
  const id = chatId && msgId ? await findMemoIdByMessage(chatId, msgId) : null;
  return NextResponse.json({ id });
}

// POST { id, chatId, messageId } : จด message → memo (บอทเรียกตอน resend เอกสารที่แก้แล้ว)
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (b.id && b.chatId && b.messageId) {
    await recordMemoMessage(String(b.id), String(b.chatId), Number(b.messageId)).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
