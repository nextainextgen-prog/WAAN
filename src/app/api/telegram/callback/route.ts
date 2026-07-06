import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { getAllowedChatId } from "@/lib/telegram";
import { decideDocument } from "@/lib/documents";

export const runtime = "nodejs";

// รับ callback จากปุ่ม inline ของ Telegram (อนุมัติ/ไม่อนุมัติเอกสาร)
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const chatId = String(body.chatId || "");
  const dataStr = String(body.data || "");

  const allowed = await getAllowedChatId();
  if (allowed && chatId !== allowed) {
    return NextResponse.json({ answer: "ไม่ได้รับอนุญาต", sends: [] });
  }

  const m = dataStr.match(/^doc:(approve|reject):(.+)$/);
  if (!m) return NextResponse.json({ answer: "คำสั่งไม่ถูกต้อง", sends: [] });

  const [, decision, id] = m;
  const result = await decideDocument(id, decision as "approve" | "reject");

  const sends: { kind: "text"; text: string }[] = [{ kind: "text", text: result.message }];
  return NextResponse.json({ answer: result.ok ? "บันทึกแล้ว" : "ไม่สำเร็จ", sends });
}
