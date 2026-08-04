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

  // โทเค็นใกล้เต็ม = เรื่องที่ต้องรู้ก่อนโดนตัด ไม่ใช่รู้ตอนใช้ไม่ได้แล้ว
  try {
    const u = await import("@/lib/usage");
    const now = Date.now();
    for (const p of u.readUsage(now)) {
      for (const [name, w, key] of [["5 ชม.", p.report.session, "SESSION"], ["7 วัน", p.report.week, "WEEK"]] as const) {
        const bud = u.budget(p.provider, key);
        if (!bud) continue;
        const frac = u.billable(w) / bud;
        if (frac >= 0.9) {
          await raiseAlert(`token-${p.provider}-${key}`, "bad", `${p.label} หน้าต่าง ${name} ใช้ไป ${Math.round(frac * 100)}% แล้ว — ${u.resetSuffix(w.firstTs, u.WINDOW_MS[key], now)}`);
        } else if (frac >= 0.75) {
          await raiseAlert(`token75-${p.provider}-${key}`, "warn", `${p.label} หน้าต่าง ${name} ใช้ไป ${Math.round(frac * 100)}% — ${u.resetSuffix(w.firstTs, u.WINDOW_MS[key], now)}`);
        }
      }
    }
  } catch { /* อ่านไม่ได้ก็ข้าม */ }

  return NextResponse.json({ card });
}
