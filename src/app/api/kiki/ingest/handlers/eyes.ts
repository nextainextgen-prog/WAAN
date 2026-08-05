import { getSetting, setSetting, vexLine, askExtractor } from "@/lib/kiki";
import type { Handler } from "../types";

/**
 * คุมว่า "ตา" จะเฝ้าแชทไหนบ้าง (เจ้าของสั่งปิดทั้งหมด 5 ส.ค. 2026)
 *
 * "ระบบที่จับข้อความตอนนี้ปิดรับไปก่อน ถ้าจะให้จับข้อความไหนเดี๋ยวผมบอกอีกที"
 *
 * เก็บเป็นรายชื่อใน Setting `vex_eyes_watch` — ตาอ่านสดทุกข้อความ เปลี่ยนแล้วมีผลทันที
 * ไม่ต้องรีสตาร์ทอะไรเลย
 */
const KEY = "vex_eyes_watch";

async function list(): Promise<string[]> {
  try {
    const v = await getSetting(KEY);
    return v ? (JSON.parse(v) as string[]) : [];
  } catch {
    return [];
  }
}

const save = (l: string[]) => setSetting(KEY, JSON.stringify(l));

export const eyesHandler: Handler = async (ctx) => {
  const { text, msgId, is, reply } = ctx;
  // รับทั้งทางเจตนา (พูดยังไงก็ได้) และ regex (คำที่ชัดอยู่แล้ว ไม่ต้องรอตัวอ่านเจตนา)
  if (!is("eyes_watch") && !/เฝ้า|จับข้อความ|ดักข้อความ|คอยดู(แชท|กลุ่ม)/.test(text)) return null;

  const cur = await list();

  // ดูว่าเฝ้าอะไรอยู่
  if (/ตอนนี้|อะไรบ้าง|ดูรายการ|เฝ้าอะไร/.test(text) && !/^(เฝ้า|ให้เฝ้า)/.test(text)) {
    return reply([{
      kind: "text",
      text: await vexLine(
        cur.length
          ? cur.includes("*")
            ? "ตอนนี้ผมเฝ้าทุกแชทครับ"
            : `ตอนนี้เฝ้าอยู่ ${cur.length} รายการ: ${cur.join(" · ")}`
          : "ตอนนี้ผมยังไม่เฝ้าแชทไหนเลยครับ สั่งได้เลยว่าจะให้เฝ้าอันไหน",
      ),
      replyTo: msgId,
    }]);
  }

  // สั่งปิด
  if (/เลิกเฝ้า|ไม่ต้องเฝ้า|ปิด(การ)?เฝ้า|หยุดเฝ้า|ปิดรับ/.test(text)) {
    const whoM = text.match(/(?:เลิกเฝ้า|ไม่ต้องเฝ้า|หยุดเฝ้า)\s*(?:แชท|กลุ่ม)?\s*(.{1,30})$/);
    let who = whoM?.[1]?.trim();
    // "เลิกเฝ้าทั้งหมด" ไม่ใช่ชื่อแชทชื่อ "ทั้งหมด" — เป็นคำสั่งล้างทั้งรายการ
    if (who && /^(ทั้งหมด|หมด|ทุกอัน|ทุกแชท|ทุกกลุ่ม|เลย|แล้ว)$/.test(who)) who = undefined;
    if (who && cur.length && !cur.includes("*")) {
      const next = cur.filter((x) => !x.toLowerCase().includes(who.toLowerCase()));
      await save(next);
      return reply([{ kind: "text", text: await vexLine(`เลิกเฝ้า "${who}" แล้วครับ${next.length ? ` เหลือเฝ้าอยู่ ${next.length} รายการ` : " ตอนนี้ไม่เฝ้าอะไรเลย"}`), replyTo: msgId }]);
    }
    await save([]);
    return reply([{ kind: "text", text: await vexLine("ปิดการจับข้อความทั้งหมดแล้วครับ จะไม่แจ้งอะไรจากแชทไหนเลย จนกว่าโด้จะสั่งใหม่"), replyTo: msgId }]);
  }

  // เฝ้าทุกแชท
  if (/ทุกแชท|ทุกกลุ่ม|ทั้งหมด/.test(text)) {
    await save(["*"]);
    return reply([{ kind: "text", text: await vexLine("เปิดเฝ้าทุกแชทแล้วครับ ถ้ารกไปบอกได้ เดี๋ยวเลือกเฉพาะที่สำคัญให้"), replyTo: msgId }]);
  }

  // เฝ้าเฉพาะที่ระบุ — ให้สมองแกะชื่อ (ชื่อคน/กลุ่มไทยรูปแบบอิสระมาก)
  let who = "";
  try {
    const raw = await askExtractor(`คำสั่ง: """${text}"""`, {
      system: `เจ้าของสั่งให้ผู้ช่วยเฝ้าแชทบางอัน แกะว่าเป็นแชทชื่ออะไร
ตอบ JSON: {"name":"ชื่อคน/กลุ่มที่จะเฝ้า (ไม่ชัด = เว้นว่าง)"}`,
      timeoutMs: 30_000,
    });
    who = String(JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}").name || "").trim();
  } catch { /* แกะไม่ได้ = ถามกลับ */ }

  if (!who) {
    return reply([{ kind: "text", text: await vexLine('ให้เฝ้าแชทไหนครับ บอกชื่อมาได้เลย หรือจะเอา "เฝ้าทุกแชท" ก็ได้'), replyTo: msgId }]);
  }
  const next = cur.includes("*") ? [who] : [...new Set([...cur, who])];
  await save(next);
  return reply([{
    kind: "text",
    text: await vexLine(`เริ่มเฝ้า "${who}" ให้แล้วครับ${next.length > 1 ? ` (รวมเป็น ${next.length} รายการ)` : ""} มีอะไรเข้ามาผมจะดูให้ว่าควรบอกโด้ไหม`),
    replyTo: msgId,
  }]);
};
