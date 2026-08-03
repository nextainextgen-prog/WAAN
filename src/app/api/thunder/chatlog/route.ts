import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { bizDateOf } from "@/lib/thunder";

export const runtime = "nodejs";

// oho-watch ส่งบทสนทนาที่เพิ่งอ่านมาเก็บ (upsert ตาม convId+bizDate — อ่านซ้ำวันเดียวกันทับของเดิม)
// body: { convId, channel, platform, customer, admin, service, brand, messages:[{side,text}] }
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const convId = String(b.convId || "").trim();
  const messages = Array.isArray(b.messages) ? b.messages : [];
  if (!convId || !messages.length) return NextResponse.json({ ok: false, skip: "ไม่มี convId/ข้อความ" });

  const bizDate = String(b.bizDate || bizDateOf());
  const clean = messages
    .filter((m: { side?: string; text?: string }) => m && typeof m.text === "string" && m.text.trim())
    .map((m: { side?: string; text?: string }) => ({ side: m.side === "admin" ? "admin" : "customer", text: String(m.text).slice(0, 500) }));
  if (!clean.length) return NextResponse.json({ ok: false, skip: "ข้อความว่าง" });

  const data = {
    convId,
    bizDate,
    brand: b.brand ? String(b.brand) : null,
    service: b.service ? String(b.service) : null,
    channel: b.channel ? String(b.channel).slice(0, 60) : null,
    platform: b.platform ? String(b.platform) : null,
    customer: b.customer ? String(b.customer).slice(0, 60) : null,
    admin: b.admin ? String(b.admin).slice(0, 40) : null,
    messages: JSON.stringify(clean),
    msgCount: clean.length,
    analyzed: false, // มีข้อความใหม่ → ให้วิเคราะห์ใหม่รอบหน้า
  };

  const row = await db.chatLog.upsert({
    where: { convId_bizDate: { convId, bizDate } },
    update: data,
    create: data,
  });
  return NextResponse.json({ ok: true, id: row.id, msgCount: clean.length, bizDate });
}
