import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAllowedChatId, getBotToken, tgSendDocument, tgSendMessage } from "@/lib/telegram";
import { readSlideFile, getSlideMeta } from "@/lib/slide-store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!getBotToken()) {
    return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า Telegram bot token" }, { status: 400 });
  }
  const chatId = await getAllowedChatId();
  if (!chatId) {
    return NextResponse.json(
      { error: "ยังไม่ได้ผูก Telegram — ทักบอทด้วย /start ก่อนหนึ่งครั้ง" },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  const meta = await getSlideMeta(id);
  const html = await readSlideFile(id, "html");
  const pdf = await readSlideFile(id, "pdf");
  if (!meta || !html || !pdf) {
    return NextResponse.json({ error: "ไม่พบไฟล์สไลด์" }, { status: 404 });
  }

  const safe = meta.title.replace(/[^\p{L}\p{N}ก-๙\s_-]/gu, "").slice(0, 50) || "slides";
  await tgSendMessage(chatId, `สไลด์ "${meta.title}" (${meta.slideCount} สไลด์)`);
  await tgSendDocument(chatId, pdf, `${safe}.pdf`, meta.title);
  await tgSendDocument(chatId, html, `${safe}.html`, "ไฟล์เด็คแบบเปิดในเบราว์เซอร์ (เลื่อนดูได้)");

  return NextResponse.json({ ok: true });
}
