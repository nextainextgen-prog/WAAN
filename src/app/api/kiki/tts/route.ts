import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { speak } from "@/lib/tts";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * แปลงข้อความเป็นเสียงให้ท่อที่อยู่คนละโปรเซส (ท่อ Discord)
 * ที่ต้องผ่านเว็บเพราะการเลือกเจ้า/โมเดล/เสียง อ่านจากตาราง Setting — ท่อไม่ควรรู้จักเรื่องพวกนี้เลย
 */
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { text, voice } = (await req.json().catch(() => ({}))) as { text?: string; voice?: string };
  if (!text?.trim()) return NextResponse.json({ ogg: null });
  const buf = await speak(text, { voice });
  return NextResponse.json({ ogg: buf ? buf.toString("base64") : null });
}
