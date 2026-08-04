import { getSetting, setSetting, askKiki } from "./kiki";

/**
 * โหมดการฟังของ Vex ในห้องเสียง (สเปกข้อ 6 — เฟส 3/6, 4 ส.ค. 2026)
 *
 * ความต่างระหว่าง Siri ที่น่ารำคาญกับผู้ช่วยจริง อยู่ที่รายละเอียดพวกนี้:
 *  - เรียกครั้งเดียวคุยต่อได้หลายประโยค (หน้าต่างคุย) ไม่ใช่เรียกใหม่ทุกประโยค
 *  - ปลุกผิดต้องไม่มีต้นทุน — ปลุกแล้วไม่มีคำสั่งตามมา ให้หลับต่อเงียบ ๆ
 *    ห้ามพูดถามว่า "ครับ มีอะไรครับ" เด็ดขาด
 *  - แม้โหมดอิสระก็ยังต้องกรองว่าประโยคนี้พูดกับเราหรือเปล่า (เขาอาจพึมพำ/คุยโทรศัพท์/เปิดคลิป)
 *  - ไม่แน่ใจ = เงียบ ไม่ใช่เดา
 */

export type ListenMode = "wake" | "open" | "silent" | "muted";

export const MODE_KEY = "vex_listen_mode";
export const MODE_LABEL: Record<ListenMode, string> = {
  wake: "เรียกชื่อ",
  open: "อิสระ",
  silent: "ฟังเงียบ",
  muted: "ปิดปาก",
};

export const DEFAULT_MODE: ListenMode = "wake"; // ค่าเริ่มต้นตามสเปก

export async function getMode(): Promise<ListenMode> {
  const v = (await getSetting(MODE_KEY)) as ListenMode | null;
  return v && v in MODE_LABEL ? v : DEFAULT_MODE;
}

export async function setMode(m: ListenMode): Promise<void> {
  await setSetting(MODE_KEY, m);
  await setSetting(OPEN_SINCE_KEY, m === "open" ? String(Date.now()) : "");
}

// โหมดอิสระต้องมีทางออกอัตโนมัติ ไม่งั้นเปิดค้างทั้งวันแล้วโดนแทรกตลอด
const OPEN_SINCE_KEY = "vex_open_since";
export const OPEN_IDLE_EXIT_MS = 10 * 60_000; // ไม่มีใครพูดด้วย 10 นาที → กลับโหมดเรียกชื่อ
export const OPEN_ASK_AGAIN_MS = 30 * 60_000; // ครบ 30 นาที → ถามว่ายังเอาอยู่ไหม

export async function openModeAge(): Promise<number> {
  const v = await getSetting(OPEN_SINCE_KEY);
  return v ? Date.now() - Number(v) : 0;
}

// ===== คำปลุก =====
//
// "Vex" พยางค์เดียว ถอดเสียงไทยออกมาได้หลายแบบมาก — รับให้กว้างไว้ก่อน
// เพราะปลุกผิดไม่มีต้นทุน (หลับต่อเงียบ ๆ) แต่ปลุกไม่ติดคือพังทั้งประสบการณ์
const WAKE_RE = /\b(vex|hey vex|ok vex)\b|เว็?ก(ซ์|ส์|ส|ช)?|เฝ้?ก|เว็?คซ์?|แว็?กซ์?/i;

/** ประโยคนี้มีคำปลุกไหม + เนื้อคำสั่งที่เหลือหลังตัดคำปลุกออก */
export function matchWake(text: string): { woke: boolean; rest: string } {
  const t = (text || "").trim();
  if (!WAKE_RE.test(t)) return { woke: false, rest: t };
  const rest = t.replace(WAKE_RE, " ").replace(/^[\s,.…ๆ]+/, "").replace(/\s+/g, " ").trim();
  return { woke: true, rest };
}

// ขอบเขตท้ายคำสำหรับภาษาไทย
//
// \b ของ JS ดูแค่ตัวอักษร ASCII — ตัวไทยทุกตัวถือเป็น "ไม่ใช่ตัวอักษร" หมด
// ผลคือ /^(พอ)\b/ ไม่แมตช์ "พอ" ที่จบประโยค (ไม่มีตัว ASCII ให้เกิดขอบเขต)
// เคสจริงตอนเทส: "Vex พอ" สั่งหยุดไม่ติด ทั้งที่เป็นคำสั่งสำคัญที่สุดในระบบ
// → ใช้ lookahead ว่าตัวถัดไปต้องไม่ใช่พยัญชนะ/สระไทย แทน \b
const THAI_END = "(?![\\u0E01-\\u0E4F])";
const WAKE_PREFIX = "(?:vex\\s*|เว็?ก(?:ซ์|ส์|ส|ช)?\\s*)?";

// สั่งหยุดกลางประโยค — ต้องจับได้ตอน Vex กำลังพูดอยู่ (สเปก: "Vex พอ" ต้องหยุดทันที)
// เรียงตัวยาวก่อนตัวสั้นเสมอ ไม่งั้น "พอ" กินก่อนแล้ว "พอแล้ว" ไม่ได้ทำงาน
// ไม่เอา "เดี๋ยว" เข้ามาเป็นคำสั่งหยุด — กำกวมเกิน ("เดี๋ยวไปกินข้าว" ไม่ได้สั่งให้หยุด)
const STOP_RE = new RegExp(`^${WAKE_PREFIX}(พอแล้ว|พอก่อน|หยุดพูด|หยุด|เงียบ|พอ|stop)${THAI_END}`, "i");
export function isStopCommand(text: string): boolean {
  return STOP_RE.test((text || "").trim());
}

// สั่งถอนสิ่งที่เพิ่งส่งไป (สเปกข้อ 9 ระดับความไว้ใจ 2)
const UNDO_RE = new RegExp(`^${WAKE_PREFIX}(ถอนคืน|เรียกคืน|ถอน|ยกเลิก|undo)${THAI_END}`, "i");
export function isUndoCommand(text: string): boolean {
  return UNDO_RE.test((text || "").trim());
}

// ===== สั่งเปลี่ยนโหมดด้วยปาก =====
// ใช้ regex ที่นี่เพราะเป็นคำสั่งสั้น ๆ ต้องตอบไว และห้ามพลาด — ไม่ผ่านตัวอ่านเจตนา
export function matchModeCommand(text: string): ListenMode | null {
  const t = (text || "").trim();
  if (!/เว็?ก|vex/i.test(t) && !/^(โหมด|กลับไป)/.test(t)) return null;
  if (/ปิดปาก|เงียบไปเลย|หุบปาก|ไม่ต้องฟัง/.test(t)) return "muted";
  if (/ฟังไว้เฉย|ฟังเงียบ|ฟังอย่างเดียว|จดไว้เฉย/.test(t)) return "silent";
  if (/อิสระ|คุยได้เลย|ไม่ต้องเรียก|พูดได้เลย/.test(t)) return "open";
  if (/เรียกชื่อ|กลับไปเรียก|โหมดปกติ|กลับปกติ/.test(t)) return "wake";
  return null;
}

/**
 * ประโยคนี้พูดกับ Vex หรือเปล่า — ใช้ในโหมดอิสระที่ไม่ต้องเรียกชื่อ
 * เจ้าของอาจพึมพำกับตัวเอง คุยโทรศัพท์ หรือเปิดคลิปดู — ห้ามแทรก
 * ไม่แน่ใจ = false (เงียบไว้ก่อนเสมอ)
 */
export async function addressedToVex(text: string, recentContext: string): Promise<boolean> {
  const t = (text || "").trim();
  if (t.length < 2) return false;
  if (matchWake(t).woke) return true; // เรียกชื่อมาก็จบ ไม่ต้องคิด
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return false; // ตัดสินไม่ได้ = เงียบ
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{
            text: `ตัดสินว่าประโยคที่ได้ยินนี้ "พูดกับผู้ช่วย AI (ชื่อ Vex)" หรือเปล่า
เจ้าของเปิดไมค์ค้างไว้ทั้งวัน เสียงที่เข้ามาอาจเป็น: พึมพำกับตัวเอง · คุยโทรศัพท์กับคนอื่น · เสียงจากคลิป/ทีวี · คุยกับคนในห้อง
ให้ตอบ true เฉพาะเมื่อมันเป็นคำสั่ง/คำถาม/การคุยที่มุ่งมาที่ผู้ช่วยจริง ๆ
ไม่แน่ใจ = false เสมอ (แทรกผิดจังหวะแย่กว่าเงียบ)
ตอบ JSON: {"toVex":true/false}`,
          }],
        },
        contents: [{ role: "user", parts: [{ text: `บทสนทนาก่อนหน้า:\n${recentContext.slice(-800)}\n\nประโยคที่เพิ่งได้ยิน:\n"""${t}"""` }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: AbortSignal.timeout(8000),
    });
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    return JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}").toVex === true;
  } catch {
    return false;
  }
}

/**
 * เสียงตัวเองย้อนเข้าไมค์ (เจ้าของเปิดลำโพงแทนหูฟัง) — ห้ามเอามาตอบตัวเอง
 * เทียบกับสิ่งที่ Vex เพิ่งพูดไป ถ้าซ้ำกันมากแปลว่าเป็นเสียงสะท้อน
 */
export function looksLikeEcho(heard: string, lastSpoken: string): boolean {
  if (!lastSpoken) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const h = norm(heard);
  const s = norm(lastSpoken);
  if (h.length < 6) return false;
  if (s.includes(h)) return true;
  // ทับกันเกินครึ่งของสิ่งที่ได้ยิน = สะท้อน
  let hit = 0;
  for (let i = 0; i + 6 <= h.length; i += 3) if (s.includes(h.slice(i, i + 6))) hit++;
  return hit > 0 && hit / Math.ceil((h.length - 5) / 3) > 0.5;
}

/** สรุปสั้นมากไว้ตอบกลับด้วยเสียงในสาย (คนละตัวกับ toSpeech ที่ใช้กับงานเชิงรุก) */
export async function toVoiceReply(fullText: string): Promise<string> {
  const flat = fullText.replace(/<[^>]+>/g, " ").replace(/[*_`#>|]/g, " ").replace(/\s+/g, " ").trim();
  if (flat.length <= 220) return flat;
  try {
    const t = await askKiki(
      `[ย่อเป็นคำพูดในสาย] เจ้าของกำลังคุยกับคุณด้วยเสียง จอดับอยู่\n\nคำตอบเต็ม:\n"""${flat.slice(0, 6000)}"""\n\n` +
        `พูดกลับให้เขาฟังภายใน 1-2 ประโยค เอาแก่นล้วน ห้ามอ่านลิสต์ ห้ามอ่านตัวเลขทุกตัว\n` +
        `ถ้ามีรายละเอียดเยอะให้ปิดท้ายว่า "ที่เหลือลงในห้องแชทให้แล้ว"\n` +
        `ตอบเฉพาะข้อความที่จะพูด ภาษาพูดล้วน`,
    );
    const out = t.replace(/<[^>]+>/g, " ").replace(/[*_`#>|]/g, " ").replace(/\s+/g, " ").trim();
    if (out) return out.slice(0, 700);
  } catch { /* ตกไปทางสำรอง */ }
  return flat.slice(0, 300);
}
