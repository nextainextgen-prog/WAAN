import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { speak, speakSteps } from "@/lib/voice";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * บอทเรียกทุกครั้งที่จะ "พูด" — ส่งสถานการณ์ + ข้อเท็จจริง + บทสนทนาล่าสุดมา แล้วรับประโยคที่แต่งสดกลับไป
 * mode "line"  → { text }   ประโยคเดียว
 * mode "steps" → { steps }  ชุดข้อความสถานะระหว่างทำงาน
 * แต่งไม่ได้/โมเดลล่ม → คืนค่าว่าง ให้ฝั่งบอทใช้ประโยคสำรองของตัวเอง (ต้องไม่เงียบ)
 */
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const input = {
    situation: String(body.situation || "").slice(0, 1500),
    facts: Array.isArray(body.facts) ? body.facts.map((f: unknown) => String(f).slice(0, 400)).slice(0, 20) : [],
    recent: Array.isArray(body.recent) ? body.recent.map((r: unknown) => String(r).slice(0, 400)).slice(-14) : [],
    avoid: Array.isArray(body.avoid) ? body.avoid.map((a: unknown) => String(a).slice(0, 300)).slice(-5) : [],
    speaker: body.speaker ? String(body.speaker).slice(0, 80) : undefined,
    chatTitle: body.chatTitle ? String(body.chatTitle).slice(0, 120) : undefined,
    isGroup: Boolean(body.isGroup),
    timeoutMs: Number(body.timeoutMs) > 0 ? Math.min(20000, Number(body.timeoutMs)) : undefined,
  };
  if (!input.situation) return NextResponse.json({ text: "", steps: [] });

  if (body.mode === "steps") {
    const steps = await speakSteps({ ...input, count: Number(body.count) || 4 });
    return NextResponse.json({ steps });
  }
  const text = await speak(input);
  return NextResponse.json({ text });
}
