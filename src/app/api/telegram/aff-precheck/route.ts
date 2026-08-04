import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { parseSystemNoti } from "@/lib/aff-notify";
import { findProfile } from "@/lib/aff-profile";

export const runtime = "nodejs";

/**
 * เช็คเร็ว ๆ ก่อนลงมือ: ยูสเซอร์ในแจ้งเตือนนี้มีเอกสารยืนยันตัวตนในคลังแล้วหรือยัง
 * ให้บอทบอกในกลุ่มได้ถูกเรื่องตั้งแต่ต้น (ลูกค้าใหม่ = "ยังไม่มีเอกสาร เดี๋ยวทำให้ก่อน")
 */
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const noti = parseSystemNoti(String(b.notiText || ""));
  if (!noti?.username) return NextResponse.json({ ok: false });
  const p = await findProfile(noti.username, noti.accountName).catch(() => null);
  return NextResponse.json({ ok: true, username: noti.username, hasProfile: Boolean(p) });
}
