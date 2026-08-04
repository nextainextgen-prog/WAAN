import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { getBotToken, tgSendMessage, getAllowedChatId } from "@/lib/telegram";
import { addPending, getOpsChatId, isAllowedScript } from "@/lib/waan-ops";
import { db } from "@/lib/db";

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

  const opsChat = await getOpsChatId();
  const chatId = opsChat || (await getAllowedChatId());
  if (!chatId) return NextResponse.json({ ok: false, error: "ยังไม่ได้ผูกห้องคุมระบบ" }, { status: 400 });

  const item = await addPending(service, script, String(chatId));
  if (!item) return NextResponse.json({ ok: false, error: "ตั้งคำขอไม่สำเร็จ" }, { status: 400 });

  const owner = await ownerTag();
  // ข้อความสั้น ไม่ต้องสอนวิธีตอบ (พี่โด้รู้อยู่แล้ว — สั่งไว้ 3 ส.ค. 2026)
  const text =
    `🔑 <b>เซสชัน ${service.toUpperCase()} หมดอายุ</b>${owner ? ` — ${owner}` : ""}\n` +
    `ให้ผมรัน <code>npm run ${script}</code> ให้เลยไหมครับ`;

  const res = await tgSendMessage(chatId, text, { parse_mode: "HTML", disable_web_page_preview: true });
  return NextResponse.json({ ok: true, chatId, pending: item, sent: Boolean((res as { ok?: boolean })?.ok) });
}

// แท็กเจ้าของด้วย tg://user?id= (ใช้ได้แม้ไม่มี username — ต้องเป็นสมาชิกกลุ่ม)
async function ownerTag(): Promise<string> {
  const id = await getAllowedChatId();
  if (!id) return "";
  const row = await db.setting.findUnique({ where: { key: "owner_display_name" } }).catch(() => null);
  const name = row?.value?.trim() || "พี่โด้";
  return `<a href="tg://user?id=${id}">${name}</a>`;
}
