import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { speakFast, buildBank } from "@/lib/kiki-voicebank";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * แปลงข้อความเป็นเสียงให้ท่อที่อยู่คนละโปรเซส
 *
 * เลือกทางเองตามความเร่งด่วน (เจ้าของสั่ง 5 ส.ค.: "Kanya เร็ว + Gemini ตอนสำคัญ"):
 *   bankKey  — ประโยคสำเร็จรูปในคลัง 0 วินาที
 *   quality  — ยอมรอ Gemini เพื่อเสียงที่เพราะกว่า
 *   ปกติ     — Kanya ในเครื่อง ~0.2 วินาที
 */
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { text, bankKey, quality, build } = (await req.json().catch(() => ({}))) as {
    text?: string; bankKey?: string; quality?: boolean; build?: boolean;
  };
  if (build) return NextResponse.json(await buildBank(false));
  const s = await speakFast({ bankKey, text, quality });
  if (!s) return NextResponse.json({ ogg: null });
  return NextResponse.json({ ogg: s.ogg.toString("base64"), text: s.text, via: s.via, ms: s.ms });
}
