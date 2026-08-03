import { askGemini } from "./gemini";
import { askClaude } from "./claude";
import { getLessonsContext } from "./lessons";

/**
 * "เสียงพูด" ของน้องวาน — แต่งประโยคสดทุกครั้งตามสถานการณ์จริง แทนข้อความตายตัวในโค้ด
 *
 * ที่มา: เดิมประโยครับเรื่อง/รอไฟล์/กำลังทำ/เสร็จแล้ว ถูกฮาร์ดโค้ดไว้ในบอท พูดซ้ำคำเดิมทุกครั้ง
 * ฟังดูเป็นบอท ที่นี่จึงส่ง "สถานการณ์ + ข้อเท็จจริง + บทสนทนาล่าสุดของห้องนั้น" ให้โมเดลแต่งคำเอง
 *
 * หลักสำคัญ: ต้องไม่ทำให้บอทช้าหรือเงียบ — ถ้าโมเดลช้า/ล่ม ให้ตกกลับไปใช้ประโยคสำรองทันที
 */

export interface VoiceInput {
  situation: string; // สถานการณ์ตอนนี้ (อธิบายเป็นภาษาคน)
  facts?: string[]; // ข้อเท็จจริงที่พูดถึงได้ — ห้ามพูดเกินจากนี้
  recent?: string[]; // บทสนทนาล่าสุดของห้องนั้น ["ชื่อ: ข้อความ", ...]
  avoid?: string[]; // ประโยคที่เพิ่งพูดไป (อย่าพูดซ้ำคำเดิม)
  speaker?: string; // คนที่กำลังคุยด้วยตอนนี้
  chatTitle?: string; // ชื่อห้อง/กลุ่ม
  isGroup?: boolean;
  timeoutMs?: number;
}

const MAX_LEN = 400;

// โมเดลล่ม/ช้าติดกัน → พักไม่เรียกชั่วคราว (ไม่ให้ทุกข้อความต้องรอ timeout ซ้ำ ๆ)
let failCount = 0;
let coolDownUntil = 0;
function noteFail() {
  failCount++;
  if (failCount >= 3) {
    coolDownUntil = Date.now() + 60_000;
    failCount = 0;
  }
}
function noteOk() {
  failCount = 0;
}

// บทเรียนที่เจ้าของสอนไว้เปลี่ยนไม่บ่อย — แคช 5 นาที ไม่ต้องยิง DB ทุกครั้งที่จะพูด
let lessonsCache = { text: "", at: 0 };
async function cachedLessons(): Promise<string> {
  if (Date.now() - lessonsCache.at < 5 * 60_000) return lessonsCache.text;
  const text = await getLessonsContext().catch(() => "");
  lessonsCache = { text, at: Date.now() };
  return text;
}

async function persona(): Promise<string> {
  const lessons = await cachedLessons();
  return `คุณคือ "วาน" น้องผู้หญิงในทีม Thunder Solution ทำงานเป็นผู้ช่วย/เลขาให้ทีมผ่านแชท Telegram
ตอนนี้คุณกำลังจะพิมพ์ข้อความตอบในแชท — เขียนให้เหมือนคนจริงพิมพ์เอง ไม่ใช่ข้อความสำเร็จรูปของบอท

วิธีพูด:
- ไทยธรรมชาติ อบอุ่น เป็นกันเอง ลงท้าย ค่ะ/คะ ตามจังหวะ กระชับ 1-2 ประโยคพอ
- พูดแบบ first-person ห้ามเรียกตัวเองว่า "วาน" และห้ามเรียกคนอื่นด้วยชื่อ/คำนำหน้า (เช่น พี่โด้)
- ไม่ต้องใช้สรรพนามแทนตัวเอง (ห้ามใช้ หนู/เรา/ดิฉัน/ตัวเอง) พูดตรง ๆ ได้เลย เช่น "เดี๋ยวดูให้นะคะ" "จัดให้เลยค่ะ"
- ดูบทสนทนาล่าสุดก่อนพูด ถ้ากำลังคุยเรื่องไหนอยู่ให้ต่อเรื่องนั้น อย่าพูดเหมือนเพิ่งเข้ามาใหม่
- เปลี่ยนคำ เปลี่ยนจังหวะทุกครั้ง อย่าขึ้นต้นด้วยคำเดิมซ้ำ ๆ ไม่ต้องเป็นทางการเกินไป

ข้อห้าม:
- ห้ามแต่งข้อมูล ตัวเลข ชื่อ หรือสัญญาอะไรที่ไม่มีใน "ข้อเท็จจริง" ที่ให้มา
- ห้ามใส่ @ แท็กใคร (ระบบเติมแท็กให้เองทีหลัง) ห้ามใส่ markdown ห้ามใส่เครื่องหมายคำพูดคร่อมข้อความ
- ห้ามขึ้นต้นด้วยชื่อผู้พูด และห้ามอธิบายว่าตัวเองเป็น AI/โมเดล
- อิโมจิใส่ได้ไม่เกิน 1 ตัว หรือไม่ใส่เลยก็ได้
- ตอบกลับมาเฉพาะ "ข้อความที่จะพิมพ์ในแชท" เท่านั้น ไม่ต้องอธิบายอะไรเพิ่ม${
    lessons ? `\n\nสิ่งที่เจ้าของเคยสอนไว้ (ยึดตามนี้เสมอ):\n${lessons}` : ""
  }`;
}

function buildPrompt(input: VoiceInput): string {
  const parts: string[] = [];
  parts.push(`สถานการณ์ตอนนี้: ${input.situation}`);
  if (input.isGroup) parts.push(`ที่นี่คือกลุ่ม${input.chatTitle ? ` "${input.chatTitle}"` : ""} (มีหลายคนอยู่ในห้อง)`);
  else parts.push("ที่นี่คือแชทส่วนตัวกับเจ้าของ");
  if (input.speaker) parts.push(`คนที่กำลังคุยด้วยตอนนี้: ${input.speaker}`);
  if (input.facts?.length) parts.push(`ข้อเท็จจริงที่พูดถึงได้ (ห้ามเกินจากนี้):\n- ${input.facts.join("\n- ")}`);
  if (input.recent?.length)
    parts.push(`บทสนทนาล่าสุดในห้องนี้ (เก่า→ใหม่):\n${input.recent.slice(-12).join("\n")}`);
  if (input.avoid?.length)
    parts.push(`ประโยคที่เพิ่งพูดไป — ห้ามพูดซ้ำหรือใกล้เคียง:\n- ${input.avoid.slice(-5).join("\n- ")}`);
  return parts.join("\n\n");
}

// ล้างสิ่งที่โมเดลชอบแถมมา: เครื่องหมายคำพูด, markdown, ชื่อผู้พูดนำหน้า, บรรทัดอธิบาย
function clean(raw: string, maxLines = 3): string {
  let t = String(raw || "").trim();
  if (!t) return "";
  t = t.replace(/^```[\s\S]*?\n|```$/g, "").trim();
  t = t.replace(/^(น้องวาน|วาน|บอท|assistant)\s*[:：]\s*/i, "");
  t = t.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  t = t.replace(/\*\*/g, "").replace(/^[*-]\s+/gm, "");
  // เอาเฉพาะบรรทัดที่มีเนื้อ ตามจำนวนที่ขอ (กันโมเดลร่ายยาว)
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, maxLines);
  return lines.join("\n").slice(0, MAX_LEN * Math.max(1, Math.ceil(maxLines / 3))).trim();
}

async function generate(prompt: string, sys: string, timeoutMs: number, maxLines = 3): Promise<string> {
  // Gemini Flash ผ่าน REST + ปิด thinking = ตอบใน ~1 วิ (เปิด thinking จะ 3-4 วิ ช้าเกินไปสำหรับประโยคทักทาย)
  // temperature สูงหน่อยเพื่อให้คำพูดไม่ซ้ำเดิมทุกครั้ง
  try {
    const out = await askGemini(prompt, {
      system: sys,
      timeoutMs,
      fast: true,
      temperature: 1.1,
      maxOutputTokens: 160 * Math.max(1, maxLines),
    });
    const t = clean(out, maxLines);
    if (t) return t;
  } catch {
    /* ลองทางสำรองต่อ */
  }
  // สำรอง: Claude CLI (ช้ากว่า แต่ยังอยู่ในงบเวลาถ้าไม่ได้ตั้ง Gemini ไว้)
  const out = await askClaude(prompt, { system: sys, timeoutMs });
  return clean(out, maxLines);
}

/** แต่งประโยคเดียวตามสถานการณ์ — คืนค่าว่างถ้าแต่งไม่ได้ (ให้ผู้เรียกใช้ประโยคสำรอง) */
export async function speak(input: VoiceInput): Promise<string> {
  if (Date.now() < coolDownUntil) return "";
  const timeoutMs = input.timeoutMs ?? 8000;
  try {
    const text = await generate(buildPrompt(input), await persona(), timeoutMs);
    if (!text) {
      noteFail();
      return "";
    }
    noteOk();
    return text;
  } catch {
    noteFail();
    return "";
  }
}

/**
 * แต่งชุดข้อความสถานะระหว่างทำงาน (progress) — บรรทัดแรกคือประโยครับเรื่อง
 * ที่เหลือคือความคืบหน้าที่จะทยอยอัปเดตให้เห็นว่ายังทำอยู่
 */
export async function speakSteps(input: VoiceInput & { count: number }): Promise<string[]> {
  if (Date.now() < coolDownUntil) return [];
  const timeoutMs = input.timeoutMs ?? 9000;
  const n = Math.max(2, Math.min(8, input.count));
  const prompt =
    `${buildPrompt(input)}\n\n` +
    `เขียนข้อความสถานะ ${n} บรรทัด (บรรทัดละ 1 ข้อความ ไม่ต้องมีเลขข้อ):\n` +
    `- บรรทัดแรก = ตอบรับงานที่เพิ่งถูกสั่ง บอกสั้น ๆ ว่ากำลังจะทำอะไรให้\n` +
    `- บรรทัดถัด ๆ ไป = รายงานความคืบหน้าตามลำดับจริงของงาน (จะถูกอัปเดตทับทีละบรรทัดทุก 6 วินาที)\n` +
    `- แต่ละบรรทัดสั้น ๆ ขึ้นต้นด้วยอิโมจิ 1 ตัวได้ ห้ามซ้ำคำเดิมกันเอง`;
  try {
    const raw = await generate(prompt, await persona(), timeoutMs, n);
    const steps = raw
      .split("\n")
      .map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim())
      .filter(Boolean)
      .slice(0, n);
    if (steps.length < 2) {
      noteFail();
      return [];
    }
    noteOk();
    return steps;
  } catch {
    noteFail();
    return [];
  }
}
