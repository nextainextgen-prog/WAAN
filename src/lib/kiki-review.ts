import { geminiFetch } from "./gemini-usage";

/**
 * ตรวจคำตอบตัวเองก่อนส่ง (เจ้าของสั่ง 6 ส.ค. 2026)
 *
 * ช่องว่างที่ใหญ่ที่สุดเมื่อเทียบกับการคุยกับ AI ตัวเต็ม:
 *   ตัวเต็ม = ร่าง → ตรวจ → แก้ → ส่ง
 *   Vex เดิม = เขียน → ส่ง  (ไม่เคยอ่านคำตอบตัวเองซ้ำเลยสักครั้ง)
 *
 * ผลที่ตามมาซึ่งเจ้าของเจอเองซ้ำ ๆ:
 *  - ถามมา 3 อย่าง ตอบอย่างเดียว แล้วไม่มีใครรู้ว่าตกไป 2
 *  - เคลมว่าทำแล้วทั้งที่ไม่มีหลักฐาน
 *  - ตอบคนละเรื่องกับที่ถาม
 *
 * ตรงนี้จึงเป็นด่านสุดท้ายก่อนข้อความออกจากระบบ — ถูกกว่าและเร็วกว่าการไล่แก้รายเคส
 *
 * หลักที่ยึด
 *  - ตรวจ "ความครบ" กับ "เคลมเกินหลักฐาน" เท่านั้น ไม่แตะสำนวน/บุคลิก (นั่นเป็นของ persona)
 *  - ล้มเหลว/ช้า = ปล่อยของเดิมผ่านไป **ห้ามทำให้คำตอบหาย** (ด่านตรวจห้ามกลายเป็นจุดพัง)
 *  - แก้ได้เฉพาะ "เติมส่วนที่ตกไป" กับ "ถอนคำเคลมที่ไม่มีหลักฐาน" ห้ามแต่งข้อมูลใหม่
 */

export interface ReviewResult {
  ok: boolean;
  /** ส่วนของคำถามที่คำตอบยังไม่ได้แตะ */
  missing: string[];
  /** ประโยคที่เคลมเกินกว่าหลักฐานที่มี */
  overclaims: string[];
  /** คำตอบที่แก้แล้ว (มีเฉพาะตอนที่แก้ได้จริง) */
  revised?: string;
  ms: number;
}

const SYSTEM = `คุณคือด่านตรวจคุณภาพคำตอบของเลขาส่วนตัว ก่อนข้อความจะถูกส่งถึงเจ้าของ

ตรวจ 2 อย่างเท่านั้น
1. ครบไหม — เจ้าของถาม/สั่งมากี่เรื่อง คำตอบแตะครบทุกเรื่องหรือยัง
   นับเฉพาะสิ่งที่เจ้าของขอจริง ไม่ใช่สิ่งที่คุณคิดว่าน่าจะดีถ้ามี
2. เคลมเกินหลักฐานไหม — พูดว่า "ทำให้แล้ว/ส่งแล้ว/เก็บแล้ว/กำลังทำอยู่"
   โดยที่ในบริบทไม่มีหลักฐานว่าระบบทำจริง

ห้ามตรวจ: สำนวน · ความสุภาพ · ความยาว · การจัดรูปแบบ — พวกนั้นไม่ใช่หน้าที่คุณ

ตอบ JSON เท่านั้น:
{"ok":true/false,"missing":["ส่วนที่ยังไม่ได้ตอบ"],"overclaims":["ประโยคที่เคลมเกิน"],"revised":"คำตอบที่แก้แล้ว"}

กติกาของ revised
- ใส่เฉพาะตอน ok=false และแก้ได้จริงโดยไม่ต้องมีข้อมูลใหม่
- เติมส่วนที่ตกไปได้ **ถ้าตอบได้จากข้อมูลที่มีอยู่แล้วในบริบท**
  ตอบไม่ได้เพราะไม่มีข้อมูล ให้เขียนตรง ๆ ว่ายังตอบเรื่องนั้นไม่ได้เพราะอะไร
- คำเคลมที่ไม่มีหลักฐาน ให้เปลี่ยนเป็นสิ่งที่จริง เช่น "ทำให้แล้ว" → "ยังไม่ได้ทำ บอกมาได้ถ้าให้ทำ"
- ห้ามแต่งตัวเลข ชื่อ ลิงก์ หรือข้อเท็จจริงใหม่ที่ไม่มีในของเดิมเด็ดขาด
- คงสำนวนและบุคลิกเดิมทุกประโยคที่ไม่ได้แก้
- แก้ไม่ได้ก็ไม่ต้องใส่ revised`;

const BUDGET_MS = 25_000;

/**
 * @param question ข้อความที่เจ้าของพิมพ์มา
 * @param answer   คำตอบที่กำลังจะส่ง
 * @param evidence บริบทที่ระบบมีจริง (ผลการทำงาน/ข้อมูลที่ดึงมาได้) — ใช้ตัดสินว่าเคลมเกินไหม
 */
export async function reviewAnswer(question: string, answer: string, evidence = ""): Promise<ReviewResult> {
  const t0 = Date.now();
  const nope: ReviewResult = { ok: true, missing: [], overclaims: [], ms: 0 };
  const key = process.env.GEMINI_API_KEY?.trim();
  // เกณฑ์เดิมข้ามคำตอบสั้นกว่า 40 ตัวอักษร — แล้ว "วันนี้ยังไม่มีรายการเลยครับ" (27 ตัว)
  // ซึ่งเป็นคำตอบที่ผิดคำถามคนละเรื่อง ก็เลยหลุดด่านไปทั้งสองรอบ
  // คำตอบสั้นคือจุดที่ "ตอบไม่ตรงคำถาม" บ่อยที่สุด ต้องตรวจ
  if (!key || !question.trim() || answer.trim().length < 8) return nope;

  try {
    const res = await geminiFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents: [{
            role: "user",
            parts: [{
              text:
                `เจ้าของพิมพ์มาว่า:\n"""${question.slice(0, 2000)}"""\n\n` +
                `คำตอบที่กำลังจะส่ง:\n"""${answer.slice(0, 6000)}"""\n\n` +
                (evidence ? `หลักฐาน/ข้อมูลที่ระบบมีจริงรอบนี้:\n"""${evidence.slice(0, 4000)}"""` : `ระบบไม่ได้แนบหลักฐานการลงมือทำอะไรมาในรอบนี้`),
            }],
          }],
          generationConfig: { temperature: 0, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
        }),
        signal: AbortSignal.timeout(BUDGET_MS),
      },
      "review",
    );
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
    if (j.error?.message) return { ...nope, ms: Date.now() - t0 };
    const raw = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { ...nope, ms: Date.now() - t0 };
    const p = JSON.parse(m[0]) as { ok?: boolean; missing?: string[]; overclaims?: string[]; revised?: string };

    const revised = typeof p.revised === "string" ? p.revised.trim() : "";
    // ตัวแก้ที่สั้นกว่าของเดิมมาก = น่าจะตัดเนื้อหาทิ้ง ไม่ใช่แก้ ปลอดภัยกว่าถ้าไม่ใช้
    const safeRevised = revised && revised.length >= answer.length * 0.6 ? revised : "";

    return {
      ok: p.ok !== false,
      missing: Array.isArray(p.missing) ? p.missing.slice(0, 5) : [],
      overclaims: Array.isArray(p.overclaims) ? p.overclaims.slice(0, 5) : [],
      ...(safeRevised ? { revised: safeRevised } : {}),
      ms: Date.now() - t0,
    };
  } catch {
    return { ...nope, ms: Date.now() - t0 }; // ตรวจไม่ได้ = ปล่อยผ่าน ห้ามทำให้คำตอบหาย
  }
}
