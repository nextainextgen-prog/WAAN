import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { raiseAlert, type Severity } from "@/lib/kiki-monitor";

export const runtime = "nodejs";

/**
 * ทางเข้าห้องเฝ้าระวังสำหรับตัวเฝ้าที่อยู่คนละโปรเซส (watchdog.mjs ฯลฯ)
 * ต่อจากระบบเฝ้าระวังเดิมของน้องวาน ไม่สร้างตัวที่สอง (เจ้าของสั่ง 5 ส.ค.)
 */
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { key, sev, text } = (await req.json().catch(() => ({}))) as { key?: string; sev?: Severity; text?: string };
  if (!text?.trim()) return NextResponse.json({ ok: false });
  const sent = await raiseAlert(key || "external", sev || "warn", text.trim());
  return NextResponse.json({ ok: true, sent });
}
