import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { tgSendMessage } from "@/lib/telegram";

export const runtime = "nodejs";

// แจ้งลิงก์ tunnel ใหม่เข้ากลุ่ม (เรียกจาก scripts/tunnel-announce.mjs เมื่อ URL เปลี่ยน)
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { url } = await req.json().catch(() => ({}));
  if (!url || !/^https:\/\/[^\s]+$/.test(String(url))) {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }

  // กลุ่มปลายทาง: DB setting tunnel_announce_chat_id → fallback telegram_chat_id
  const row = await db.setting.findUnique({ where: { key: "tunnel_announce_chat_id" } });
  // ปิดการแจ้งเตือนลิงก์ (ตั้งค่าเป็น "off") — ไม่โพสต์เข้ากลุ่ม (quick tunnel เปลี่ยน URL บ่อยเลยสแปม)
  if (row?.value === "off") return NextResponse.json({ ok: false, disabled: true });
  const chatId =
    row?.value || (await db.setting.findUnique({ where: { key: "telegram_chat_id" } }))?.value;
  if (!chatId) return NextResponse.json({ error: "no chat configured" }, { status: 400 });

  const link = `${String(url).replace(/\/+$/, "")}/refund`;
  const text =
    `🌐 <b>ลิงก์ฟอร์มคืนเงินอัปเดตแล้ว</b>\n\n` +
    `เปิดฟอร์ม (ต้อง login ก่อน):\n${link}\n\n` +
    `ℹ️ ลิงก์เปลี่ยนใหม่เพราะเพิ่งเปิด/รีสตาร์ทระบบ — ใช้ลิงก์นี้แทนอันเดิมได้เลยค่ะ`;

  const res = await tgSendMessage(chatId, text, { parse_mode: "HTML", disable_web_page_preview: true }).catch(
    (e) => ({ ok: false, description: e instanceof Error ? e.message : String(e) }),
  );
  const ok = !!(res as { ok?: boolean }).ok;
  return NextResponse.json({ ok, chatId, link, error: ok ? undefined : (res as { description?: string }).description });
}
