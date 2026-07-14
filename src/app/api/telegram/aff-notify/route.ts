import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { parseSystemNoti, cacheNoti } from "@/lib/aff-notify";

export const runtime = "nodejs";

// รับ noti "กำลังรออนุมัติ" ที่บอทระบบส่งเข้ากลุ่ม → แยกข้อมูล + จำไว้ cross-check ตอนตรวจ
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const chatId = String(body.chatId || "");
  const text = String(body.text || "");
  if (!chatId || !text) return NextResponse.json({ ok: false });

  const noti = parseSystemNoti(text);
  if (!noti || !noti.username) return NextResponse.json({ ok: false });
  await cacheNoti(chatId, noti);
  return NextResponse.json({
    ok: true,
    username: noti.username,
    amount: noti.amount,
    dateText: noti.dateText,
  });
}
