import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { buildCard, raiseAlert } from "@/lib/kiki-monitor";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * ประกอบการ์ดสถานะให้ท่อเอาไปแก้ทับข้อความเดิมในห้องมอนิเตอร์
 * และตั้งเรื่องเข้าห้องเฝ้าระวังอัตโนมัติเมื่อเจอของที่ต้องลงมือ
 */
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as {
    services?: Record<string, boolean>; inVoice?: boolean; voiceConnected?: boolean;
  };
  const services = b.services || {};
  const card = await buildCard({
    services,
    inVoice: Boolean(b.inVoice),
    voiceConnected: Boolean(b.voiceConnected),
  });
  for (const [name, ok] of Object.entries(services)) {
    if (!ok) await raiseAlert(`svc-${name}`, "bad", `เซอร์วิส ${name} ไม่ทำงาน — LaunchAgent น่าจะพยายามปลุกอยู่ ถ้าไม่ขึ้นใน 2 นาทีต้องดูเอง`);
  }
  if (!b.voiceConnected) await raiseAlert("voice-down", "warn", "ยังไม่ได้เข้าห้องเสียง — กำลังพยายามต่อใหม่อัตโนมัติ");
  return NextResponse.json({ card });
}
