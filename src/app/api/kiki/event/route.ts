import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { scoreEvent, pile, type IncomingEvent } from "@/lib/kiki-interrupt";
import { queueOut, announceEnabled } from "@/lib/kiki-outbox";
import { pushFocus } from "@/lib/kiki-jobs";
import { setOutgoing } from "@/lib/kiki-reply";
import { saveKikiChat } from "@/lib/kiki";

export const runtime = "nodejs";
export const maxDuration = 180;

/**
 * ท่อเหตุการณ์กลาง (สเปกข้อ 8 — ทางเดียวเท่านั้น)
 *
 * ทุกตัวเฝ้า (Telegram userbot · Gmail · ปฏิทิน · งานเบื้องหลัง · อนาคต: แจ้งเตือน macOS)
 * ต้องยิงเข้าที่นี่ ห้ามตัวเฝ้าตัวไหนตัดสินใจพูดเอง — ตัวให้คะแนนขัดจังหวะเป็นคนตัดสินคนเดียว
 */
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Partial<IncomingEvent>;
  if (!b.text?.trim() || !b.dedupKey) return NextResponse.json({ ok: false, why: "ข้อมูลไม่ครบ" });

  const ev: IncomingEvent = {
    source: (b.source as IncomingEvent["source"]) || "system",
    fromName: b.fromName || "ไม่ทราบชื่อ",
    peerId: b.peerId,
    text: b.text.trim(),
    isGroup: Boolean(b.isGroup),
    dedupKey: b.dedupKey,
  };

  const v = await scoreEvent(ev);
  const line = `${ev.fromName}${ev.isGroup ? " (กลุ่ม)" : ""}: ${ev.text.slice(0, 300)}`;

  // บันทึกไว้เสมอไม่ว่าระดับไหน — เจ้าของถามย้อนหลังได้ ("เมื่อกี้ใครทักมาบ้าง")
  await saveKikiChat("assistant", `[เหตุการณ์เข้า · ระดับ ${v.level}] ${line}`, "owner", "event");

  // ระดับ 4 = เงียบสนิท ลงบันทึกอย่างเดียว
  if (v.level === 4) return NextResponse.json({ ok: true, level: v.level, why: v.why });

  // เตรียมกระดานเรื่อง + ตั้งปลายทางตอบกลับไว้ล่วงหน้า (เจ้าของพูด "ตอบไปว่า..." ได้เลย)
  if (ev.peerId) {
    await pushFocus({ kind: "message", ref: ev.peerId, label: `${ev.fromName} ทักมา: ${ev.text.slice(0, 50)}` });
    await setOutgoing({ peerId: ev.peerId, peerName: ev.fromName, message: "", channel: "discord-voice" });
  }

  const on = await announceEnabled();
  if (!on) return NextResponse.json({ ok: true, level: v.level, why: "โหมดประกาศปิดอยู่ — บันทึกอย่างเดียว" });

  if (v.level === 3) {
    await pile(v.topic, line);
    return NextResponse.json({ ok: true, level: v.level, why: v.why });
  }

  // ระดับ 2 = ลงห้องแชท ไม่พูด · ระดับ 1 = พูดในสายด้วย
  await queueOut({ target: "discord-text", topic: v.topic, text: line, priority: v.level === 1 ? 3 : 1 });
  if (v.level === 1) {
    await queueOut({
      target: "discord-voice",
      topic: v.topic,
      // ทวนว่าใครทักเสมอ — จอดับ เจ้าของไม่รู้ว่าพูดถึงเรื่องไหน (สเปกข้อ 15ง)
      text: `${ev.fromName}ทักมาว่า ${ev.text.slice(0, 300)}`,
      priority: 3,
    });
  }
  return NextResponse.json({ ok: true, level: v.level, why: v.why });
}
