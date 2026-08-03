import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { parseRefundNoti, cacheRefundNoti } from "@/lib/refund-notify";

export const runtime = "nodejs";

// รับ noti [#REQUEST_REFUND_SERVICE] จากบอทระบบ → จำ ไอดีบริการ/ชื่อร้าน ไว้ให้ poll เอาไปตรวจเพิ่ม
// (ตัวเร่งเท่านั้น — ถ้า Telegram ไม่ส่งข้อความบอทตัวอื่นให้เรา ระบบยังทำงานครบจากหน้าหลังบ้าน)
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const text = String(body.text || "");
  if (!text) return NextResponse.json({ ok: false });

  const noti = parseRefundNoti(text);
  if (!noti?.requestedBy) return NextResponse.json({ ok: false });
  await cacheRefundNoti(noti);
  return NextResponse.json({
    ok: true,
    requestedBy: noti.requestedBy,
    serviceId: noti.serviceId,
    shopName: noti.shopName,
    amount: noti.amount,
  });
}
