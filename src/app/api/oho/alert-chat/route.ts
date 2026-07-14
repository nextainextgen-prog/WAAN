import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { getOhoAlertChat, setOhoAlertChat } from "@/lib/roles";

export const runtime = "nodejs";

// สคริปต์ oho-watch เรียกทุกรอบ → คืนกลุ่มเป้าหมาย (ตั้งผ่านปุ่มห้อง Lead; ไม่ตั้ง = ใช้ env เดิม)
// ส่ง { set: "<chatId>" } มา = อัปเดตปลายทาง (ใช้ตอนกลุ่มอัปเกรดเป็น supergroup แล้ว id เปลี่ยน)
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body?.set) {
    await setOhoAlertChat(String(body.set));
    return NextResponse.json({ ok: true, chatId: String(body.set) });
  }
  const chatId = (await getOhoAlertChat()) || process.env.OHO_ALERT_CHAT_ID || null;
  return NextResponse.json({ chatId });
}
