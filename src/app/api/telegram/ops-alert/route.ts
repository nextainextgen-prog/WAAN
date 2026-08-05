import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { getBotToken, tgSendMessage, getAllowedChatId } from "@/lib/telegram";
import { addPending, isAllowedScript } from "@/lib/waan-ops";

export const runtime = "nodejs";

/**
 * watchdog เรียกเข้ามาเมื่อเจอเซสชันหมดอายุ
 *  → ตั้งคำขอ "รอยืนยัน" 1 ใบ (ผูกกับ service นั้นชัดเจน)
 *  → โพสต์เข้าห้องคุมระบบ (#Support • Agent / Leader) พร้อมแท็กเจ้าของ ถามว่าให้รันให้ไหม
 * ยังไม่ได้ผูกห้อง → fallback แชทเจ้าของ (ไม่ปล่อยให้เงียบหาย)
 */
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!getBotToken()) return NextResponse.json({ error: "no bot token" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const service = String(body.service || "").trim().toLowerCase();
  const script = String(body.script || "").trim();
  if (!service || !isAllowedScript(script)) {
    return NextResponse.json({ ok: false, error: "service/script ไม่ถูกต้องหรือไม่อยู่ใน allowlist" }, { status: 400 });
  }

  // แจ้งเข้า "แชทส่วนตัวของพี่โด้" เสมอ — เรื่องเซสชันหมดอายุเป็นงานหลังบ้าน คนอื่นในกลุ่มไม่ต้องเห็น
  // (พี่โด้สั่งย้ายกลับจากกลุ่ม Leader เมื่อ 5 ส.ค. 2026 — ห้ามย้ายกลับไปกลุ่มโดยไม่ได้สั่ง)
  const chatId = await getAllowedChatId();
  if (!chatId) return NextResponse.json({ ok: false, error: "ยังไม่รู้แชทเจ้าของ" }, { status: 400 });

  const item = await addPending(service, script, String(chatId));
  if (!item) return NextResponse.json({ ok: false, error: "ตั้งคำขอไม่สำเร็จ" }, { status: 400 });

  // ข้อความสั้น ไม่ต้องสอนวิธีตอบ ไม่ต้องแท็ก (แชทส่วนตัว มีพี่โด้คนเดียวอยู่แล้ว)
  const text =
    `🔑 <b>เซสชัน ${service.toUpperCase()} หมดอายุ</b>\n` +
    `ให้ผมรัน <code>npm run ${script}</code> ให้เลยไหมครับ`;

  const res = await tgSendMessage(chatId, text, { parse_mode: "HTML", disable_web_page_preview: true });
  return NextResponse.json({ ok: true, chatId, pending: item, sent: Boolean((res as { ok?: boolean })?.ok) });
}
