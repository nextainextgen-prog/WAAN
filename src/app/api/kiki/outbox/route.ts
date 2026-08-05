import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { setVoicePresence, pendingOut, markSent, toSpeech } from "@/lib/kiki-outbox";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * กล่องขาออกของท่อ Discord (เฟส 2)
 *
 * ท่อ Discord เรียกที่นี่ทุกไม่กี่วินาทีเพื่อ:
 *  1. รายงานว่าเจ้าของอยู่ในห้องเสียงไหม (มีแต่ท่อที่รู้ เว็บเดาเองไม่ได้)
 *  2. หยิบงานที่เว็บหย่อนไว้ไปส่ง
 *  3. บอกว่าส่งสำเร็จแล้ว
 *
 * ฝั่งเสียงจะถูกย่อเป็นภาษาพูดที่นี่ (ไม่ใช่ที่ท่อ) เพราะการย่อต้องใช้สมองซึ่งอยู่ฝั่งเว็บ
 */
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  // 1) รายงานสถานะการอยู่ในห้องเสียง
  if (typeof body.inVoice === "boolean") await setVoicePresence(body.inVoice);

  // 2) ยืนยันว่าส่งของที่หยิบไปรอบก่อนแล้ว
  for (const d of (body.done as { id: string; error?: string }[] | undefined) || []) {
    await markSent(d.id, d.error);
  }

  // 3) หยิบงานรอบใหม่ — เสียงเอาทีละชิ้น (พูดทับกันไม่ได้) · ข้อความเอาได้หลายชิ้น
  const voice = body.inVoice ? await pendingOut("discord-voice", 1) : [];
  const text = await pendingOut("discord-text", 5);
  const watch = await pendingOut("discord-watch", 5); // ห้องเฝ้าระวัง
  const logs = await pendingOut("discord-log", 8);    // ห้องบันทึก

  const items = [];
  for (const r of voice) {
    // ย่อเป็นภาษาพูดตรงนี้ ใช้สมองฝั่งเว็บ — ท่อไม่ต้องรู้จักโมเดลอะไรเลย
    items.push({ id: r.id, target: r.target, topic: r.topic, speak: await toSpeech(r.topic || "ที่ฝากไว้", r.text || "") });
  }
  for (const r of [...text, ...watch, ...logs]) {
    items.push({ id: r.id, target: r.target, topic: r.topic, text: r.text, payload: r.payload ? JSON.parse(r.payload) : null });
  }

  return NextResponse.json({ items });
}
