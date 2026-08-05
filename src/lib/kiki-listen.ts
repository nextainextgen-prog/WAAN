import { getSetting, setSetting } from "./kiki";
import { geminiFetch } from "./gemini-usage";

/**
 * โหมดการฟัง + สายสนทนาของ Vex (สเปกข้อ 6 · ปรับใหญ่ 5 ส.ค. 2026 หลังเจ้าของเทสจริง)
 *
 * เสียงบ่นจากการใช้จริงวันแรก:
 *  - "เลิกตั้งให้เรียกชื่อว่า Vex เพราะบางทีผมออกเสียงไม่ถูกมันก็ไม่ตอบ"
 *  - "ถ้าเรียกรอบแรกแล้วก็อยู่คุยยาวเลย จนกว่าผมจะบอก"
 *  - "ไม่รู้แล้วว่าเรียกได้ยินมั้ย"
 *
 * โครงใหม่:
 *   เงียบอยู่ → ได้ยินคำเปิด หรือ ประโยคที่เป็นคำสั่งชัด → ตอบรับทันทีจากคลังเสียง (0 วิ)
 *            → เปิดสาย: ทุกอย่างหลังจากนี้คือคุยกับเรา ไม่ต้องเรียกซ้ำ
 *            → ปิดเมื่อ: พูดคำจบ หรือ เงียบครบ 1 นาที
 */

export type ListenMode = "wake" | "open" | "silent" | "muted";

export const MODE_KEY = "vex_listen_mode";
export const MODE_LABEL: Record<ListenMode, string> = {
  wake: "เรียกชื่อ",
  open: "อิสระ",
  silent: "ฟังเงียบ",
  muted: "ปิดปาก",
};

export const DEFAULT_MODE: ListenMode = "wake";

export async function getMode(): Promise<ListenMode> {
  const v = (await getSetting(MODE_KEY)) as ListenMode | null;
  return v && v in MODE_LABEL ? v : DEFAULT_MODE;
}

export async function setMode(m: ListenMode): Promise<void> {
  await setSetting(MODE_KEY, m);
}

// ===== คำเปิดสาย =====
//
// เจ้าของเลือกเอง 5 ส.ค.: "เฮ้เพื่อน / เพื่อน / อยู่มั้ย แนวนี้"
// เลิกใช้ "Vex" เป็นตัวหลักเพราะคำต่างประเทศพยางค์เดียว ตัวถอดเสียงไทยแปลงได้สิบแบบ
// (เว็ก/เวก/เฝก/แว็กซ์) + การออกเสียงต่างกันทุกครั้ง = ชนไม่ตรงสักที
//
// รับให้กว้างไว้ก่อน — ปลุกผิดไม่มีต้นทุน (แค่ตอบ "ครับ" แล้วเงียบต่อ)
// แต่ปลุกไม่ติดคือพังทั้งประสบการณ์
// ขอบเขตท้ายคำแบบไทย — \b ของ JS ใช้ไม่ได้ (อักษรไทยนับเป็น non-word ทั้งหมด)
const TE = "(?![\\u0E01-\\u0E4F])";

// รับรูปที่ตัวถอดเสียงมักแปลงเพี้ยนด้วย (เทสจริง 5 ส.ค.: "เฮ้เพื่อน"→"เฮีย"/"เฮือน")
// แต่ต้องเป็น "คำเต็ม" เท่านั้น ไม่งั้น "เฮ" ไปแมตช์ต้นคำ "เฮือน" แล้วเหลือเศษ "ือน" เป็นคำสั่ง
const HEY = "เฮ้ย|เห้ย|เฮย|เฮีย|เอีย|เฮ่ย|เอ่ย|เฮ้|เห้|เฮ่|เอ้|เฮ|เห";
const BUDDY = "เพื่อน|เกลอ|สหาย|พวก";

const WAKE_PATTERNS: RegExp[] = [
  new RegExp(`^\\s*(?:${HEY})\\s*(?:${BUDDY})${TE}`, "i"),        // เฮ้เพื่อน / เฮ้ย เพื่อน
  new RegExp(`^\\s*(?:${HEY})${TE}`, "i"),                          // เฮ้ย เฉย ๆ
  new RegExp(`^\\s*(?:${BUDDY})`, "i"),                             // ขึ้นต้นด้วย "เพื่อน..." (พูดติดกันได้)
  new RegExp(`\\s(?:${BUDDY})${TE}`, "i"),                           // กลางประโยคต้องเป็นคำเต็ม
  new RegExp(`^\\s*(?:นี่|นี้|เนี่ย)${TE}`, "i"),
  /อยู่(มั้ย|ไหม|ป่ะ|เปล่า|รึเปล่า|หรือเปล่า)/,
  /ได้ยิน(มั้ย|ไหม|ป่ะ|เปล่า)/,
  /\b(vex|เว็?กซ์?|แว็?กซ์?)\b/i,                                   // ชื่อเดิม เก็บไว้เป็นทางเลือก
];

/** ประโยคนี้มีคำเปิดสายไหม + เนื้อคำสั่งที่เหลือหลังตัดคำเปิดออก */
export function matchWake(text: string): { woke: boolean; rest: string } {
  const t = (text || "").trim();
  if (!t) return { woke: false, rest: "" };
  let rest = t;
  let woke = false;
  for (const re of WAKE_PATTERNS) {
    if (!re.test(rest)) continue;
    woke = true;
    rest = rest.replace(re, " ");
  }
  if (!woke) return { woke: false, rest: t };
  rest = rest.replace(/^[\s,.…ๆ!?]+/, "").replace(/\s+/g, " ").trim();
  return { woke: true, rest };
}

// ===== คำปิดสาย =====
//
// เจ้าของบอกเอง 5 ส.ค.: "โอเคร ขอบคุณครับ เยี่ยมม ลุยย จัดไป เดี๋ยวมาต่อ อะไรพวกนี้"
// ต้องเป็น "ประโยคที่จบในตัว" เท่านั้น — "โอเคแล้วช่วยหาต่อให้หน่อย" ไม่ใช่คำปิด
const CLOSE_WORDS =
  "โอเค|โอเคร|okay|ok|ขอบคุณ|ขอบใจ|แต๊งค์|thanks|thank you|เยี่ยม|เจ๋ง|ดีเลย|ดีมาก|สุดยอด|เริ่ด|ลุย|จัดไป|จัดเลย|เอาเลย|ไปเลย|พอแล้ว|แค่นี้|เท่านี้|เดี๋ยวมาต่อ|ไว้คุยกันใหม่|บาย|แล้วเจอกัน";
// คนพูดคำจบต่อกันหลายคำเป็นปกติ ("โอเค ขอบคุณครับ" · "เยี่ยม ลุย")
const FILLER = "[\\s ๆครับคะค่ะนะจ้าฮะฮ่ะแล้วเลยมากๆ!.…]*";
const CLOSE_RE = new RegExp(`^${FILLER}(?:(?:${CLOSE_WORDS})${FILLER}){1,3}$`, "i");

export function isCloseCommand(text: string): boolean {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 40) return false; // ยาว = มีเนื้อความอื่นต่อ ไม่ใช่คำปิด
  return CLOSE_RE.test(t);
}

// ===== สายสนทนา =====
//
// เปิดแล้วคุยยาวไม่ต้องเรียกซ้ำ ปิดเมื่อพูดคำจบหรือเงียบครบ 1 นาที
const SESSION_KEY = "vex_session_until";
const SESSION_TOPIC_KEY = "vex_session_topic";
// เจ้าของกำหนด 1 นาทีตอนออกแบบ แต่ใช้จริงแล้วสั้นไป —
// เขาเปิดห้องค้างทั้งวันและคุยเป็นช่วง ๆ พอคิดงานอยู่แป๊บเดียวสายก็ปิด
// log จริง: พูดว่า "แล้วไงมันหมดอีกแล้วเหรอ ทำไมมันขึ้นหมดบ่อยจัง" → ข้าม (ยังไม่ได้เรียก)
// ต้องเรียกใหม่ทุกครั้งที่หยุดคิด = ขัดกับที่เขาสั่งว่า "เรียกรอบแรกแล้วอยู่คุยยาวเลย"
// 3 นาทีกำลังดี — ยังไม่นานพอให้เสียงคุยกับคนอื่นหลุดเข้ามา (มีตัวกรอง "พูดกับเราไหม" ซ้อนอีกชั้น)
export const SESSION_IDLE_MS = 3 * 60_000;

export async function openSession(topic = ""): Promise<void> {
  await setSetting(SESSION_KEY, String(Date.now() + SESSION_IDLE_MS));
  if (topic) await setSetting(SESSION_TOPIC_KEY, topic.slice(0, 200));
}

export async function touchSession(): Promise<void> {
  await setSetting(SESSION_KEY, String(Date.now() + SESSION_IDLE_MS));
}

export async function closeSession(): Promise<void> {
  await setSetting(SESSION_KEY, "");
  await setSetting(SESSION_TOPIC_KEY, "");
}

export async function sessionOpen(): Promise<boolean> {
  return Date.now() < Number((await getSetting(SESSION_KEY)) || 0);
}

export async function sessionTopic(): Promise<string> {
  return (await getSetting(SESSION_TOPIC_KEY)) || "";
}

// ===== คำสั่งด่วนที่ต้องจับได้ทันที =====

const THAI_END = "(?![\\u0E01-\\u0E4F])";
const WAKE_PREFIX = "(?:vex\\s*|เว็?ก(?:ซ์|ส์|ส|ช)?\\s*|เพื่อน\\s*|เฮ้?ย?\\s*)?";

// หยุดพูดกลางประโยค
// \b ของ JS ใช้กับภาษาไทยไม่ได้ (อักษรไทยนับเป็น non-word ทั้งหมด) — เคยทำให้ "Vex พอ" ไม่ติดเลย
const STOP_RE = new RegExp(`^${WAKE_PREFIX}(พอแล้ว|พอก่อน|หยุดพูด|หยุด|เงียบ|พอ|stop)${THAI_END}`, "i");
export function isStopCommand(text: string): boolean {
  return STOP_RE.test((text || "").trim());
}

const UNDO_RE = new RegExp(`^${WAKE_PREFIX}(ถอนคืน|เรียกคืน|ถอน|undo)${THAI_END}`, "i");
export function isUndoCommand(text: string): boolean {
  return UNDO_RE.test((text || "").trim());
}

export function matchModeCommand(text: string): ListenMode | null {
  const t = (text || "").trim();
  if (!/เว็?ก|vex|เพื่อน|^โหมด|^กลับไป/i.test(t)) return null;
  if (/ปิดปาก|เงียบไปเลย|หุบปาก|ไม่ต้องฟัง/.test(t)) return "muted";
  if (/ฟังไว้เฉย|ฟังเงียบ|ฟังอย่างเดียว|จดไว้เฉย/.test(t)) return "silent";
  if (/อิสระ|คุยได้เลย|ไม่ต้องเรียก|พูดได้เลย/.test(t)) return "open";
  if (/เรียกชื่อ|กลับไปเรียก|โหมดปกติ|กลับปกติ/.test(t)) return "wake";
  return null;
}

// ===== ตัวกรองเร็วในเครื่อง: ประโยคนี้พูดกับเราไหม =====
//
// เจ้าของสั่ง 5 ส.ค.: "แยกให้ออกว่าผมคุยกับคุณหรือคุยกับคนอื่น
//  เวลาผมจะคุยกับคุณผมจะพูดแนวที่ผมบอกไป หรือถ้าเป็นประโยคคำสั่งที่ผมสั่ง"
//
// ทำในเครื่องก่อนเสมอ (0 วินาที) ถามสมองเฉพาะตอนกำกวมจริง ๆ

// คำที่บ่งว่าเป็นคำสั่ง/คำถามที่มุ่งมาที่ผู้ช่วย
const COMMAND_HINT =
  /ช่วย|หน่อย|ให้ที|ขอ(ดู|ทราบ|รู้)|เช็ค|หา|ค้น|บอก|จด|โน้ต|เตือน|ลง(นัด|ปฏิทิน)|บันทึก|สรุป|ทำ(ให้|ไฟล์)|ส่ง|ตอบ|ทัก|เปิด|ปิด|แคป|รัน|ถึงไหน|ยังไง|เท่าไหร่|กี่|เมื่อไหร่|ที่ไหน|ใคร|ทำไม|อะไร|มั้ย|ไหม|หรือเปล่า|ป่ะ/;

// สัญญาณว่ากำลังคุยกับคนอื่นอยู่ ไม่ใช่กับเรา
const NOT_FOR_US =
  /^(ฮัลโหล|ครับพี่|ค่ะพี่|สวัสดีครับพี่|เดี๋ยวโทรกลับ|วางก่อนนะ|แป๊บนะ)/;

/**
 * คำรับ/คำน้ำ — ได้ยินแล้วต้อง "เงียบ" ไม่ใช่ตอบ (เจ้าของสั่ง 5 ส.ค. หลังใช้จริง)
 *
 * เคสจริงที่พังหนักที่สุด: log วันแรกมี `ได้ยิน: "ครับ" → say` **ติดกัน 5 ครั้ง**
 * แล้ว Vex ก็ตอบยาวทุกครั้ง — เพราะกฎ "ในสาย + สั้นกว่า 12 ตัวอักษร = ใช่แน่ ๆ"
 * ทั้งที่ "ครับ" คือเสียงรับของเจ้าของ (หรือเสียง Vex เองย้อนเข้าไมค์) ไม่ใช่คำสั่งสักนิด
 *
 * ต้องเป็นทั้งประโยคเท่านั้น — "ครับ ช่วยหาหน่อย" ยังต้องผ่านตามปกติ
 */
const BACKCHANNEL =
  /^[\s]*(ครับ|ครับผม|คับ|ค่ะ|คะ|จ้า|จ้าา|อือ|อืม|เออ|เอ่อ|อ่า|อ๋อ|โอเค|โอเคร|okay|ok|umm|uh huh|hmm|ha|ฮะ|หือ|หา|นะ|น่ะ|แหละ|เนอะ|ใช่|ได้|ก็ได้)[\s ๆ.!?…]*$/i;

export function isBackchannel(text: string): boolean {
  return BACKCHANNEL.test((text || "").trim());
}

/**
 * เรื่องที่เคาะประตูไว้แล้วรอเจ้าของอนุญาตให้เล่า (เจ้าของสั่ง 5 ส.ค. 2026)
 *
 * "เวลาพูดขึ้นมาให้ถามก่อนว่ากูว่างมั้ย ... ให้กูตอบก่อนค่อยว่ามา"
 * เก็บได้ทีละเรื่อง — เคาะซ้อนกันหลายเรื่องแล้วเขาตอบ "ว่ามา" ครั้งเดียวจะงงว่าหมายถึงอันไหน
 * เรื่องใหม่ทับเรื่องเก่า (เรื่องเก่ายังอยู่ในห้องแชทให้ย้อนดูอยู่แล้ว)
 */
const ANNOUNCE_KEY = "vex_pending_announce";
const ANNOUNCE_TTL_MS = 10 * 60_000; // เคาะไว้แล้วเขาไม่ตอบใน 10 นาที = เลิกถือไว้

export async function setPendingAnnounce(a: { topic: string; text: string }): Promise<void> {
  await setSetting(ANNOUNCE_KEY, JSON.stringify({ ...a, at: Date.now() }));
}

export async function takePendingAnnounce(): Promise<{ topic: string; text: string } | null> {
  try {
    const raw = await getSetting(ANNOUNCE_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as { topic: string; text: string; at: number };
    await setSetting(ANNOUNCE_KEY, "");
    if (!a?.text || Date.now() - a.at > ANNOUNCE_TTL_MS) return null;
    return { topic: a.topic || "", text: a.text };
  } catch {
    return null;
  }
}

/**
 * "ว่ามา / เอาสิ / ว่าง / บอกมา" = อนุญาตให้เล่าเรื่องที่เคาะไว้
 *
 * แยกกริยากับหางประโยค เพราะคนพูดผสมกันได้อิสระ —
 * เทสรอบแรกพลาดเพราะไล่เขียนเป็นวลีเต็มทีละอัน ("ว่ามา" ผ่าน แต่ "ว่ามาเลย" ไม่ผ่าน)
 */
const GO_VERB = "ว่า|บอก|พูด|เล่า|เอา|ฟัง";
const GO_TAIL = "มา|เลย|สิ|ซิ|เถอะ|ต่อ|อยู่|มาเลย|เลยครับ";
const GO_AHEAD = new RegExp(
  `^[\\s]*(?:(?:${GO_VERB})(?:\\s*(?:${GO_TAIL}))*|ว่าง|ว่างอยู่|สะดวก|โอเค|ได้|มีอะไร|อะไร(?:เหรอ|หรอ|นะ)?)` +
    `[\\s ๆครับคะค่ะนะจ้าฮะเลย.!?…]*$`,
  "i",
);

export function isGoAhead(text: string): boolean {
  return GO_AHEAD.test((text || "").trim());
}

export type Addressed = "yes" | "no" | "unsure";

/**
 * เดาแบบเร็วในเครื่อง — คืน unsure เมื่อต้องให้สมองช่วยตัดสิน
 * ประหยัดทั้งเวลาและค่าถอดเสียง: เคสชัด ๆ ไม่ต้องยิงโมเดลเลย
 */
export function quickAddressed(text: string, opts: { inSession: boolean }): Addressed {
  const t = (text || "").trim();
  if (t.length < 2) return "no";
  // คำสั่งหยุด/ถอน/ปิดสาย ต้องมาก่อนทุกอย่าง — "พอ" สั้นก็จริงแต่สำคัญที่สุด
  if (isStopCommand(t) || isUndoCommand(t) || isCloseCommand(t)) return "yes";
  // คำรับล้วน ๆ = เงียบ (ต้องเช็คก่อนคำปลุก เพราะ "เออ"/"หา" ชนรูปคำปลุกได้)
  if (isBackchannel(t)) return "no";
  if (matchWake(t).woke) return "yes";
  if (NOT_FOR_US.test(t)) return "no";
  if (!opts.inSession) {
    // นอกสาย: รับเฉพาะคำเปิด หรือประโยคที่เป็นคำสั่งชัดเจนมาก (เจ้าของเลือก "รอคำเปิดอย่างเดียว")
    return "no";
  }
  // ในสาย: ประโยคที่มีรูปคำสั่ง/คำถาม = ใช่แน่ ๆ
  if (COMMAND_HINT.test(t)) return "yes";
  // ในสาย ประโยคสั้น ๆ ที่ตอบรับ ("เอา" "ใช่" "ไม่") = ต่อบทสนทนา
  // เดิมปล่อยผ่านทุกอย่างที่สั้นกว่า 12 ตัว → "ครับ" กลายเป็นคำสั่งแล้ววนตอบไม่จบ
  // ตอนนี้ตัวคำรับถูกดักไปข้างบนแล้ว เหลือแต่คำสั้นที่มีเนื้อจริง
  if (t.length <= 12) return "yes";
  return "unsure";
}

/** ตัวตัดสินชั้นสอง — ใช้สมองเฉพาะตอนกำกวม (ไม่แน่ใจ = เงียบ) */
export async function addressedToVex(text: string, recentContext: string): Promise<boolean> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return false;
  try {
    const res = await geminiFetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{
            text: `ตัดสินว่าประโยคที่ได้ยินนี้ "พูดกับผู้ช่วย AI" หรือเปล่า
เจ้าของเปิดไมค์ค้างทั้งวัน เสียงที่เข้ามาอาจเป็น: พึมพำกับตัวเอง · คุยโทรศัพท์ · เสียงจากคลิป/ทีวี · คุยกับคนในห้อง
ตอนนี้กำลังอยู่ในบทสนทนากับผู้ช่วยอยู่ ประโยคต่อเนื่องจากเรื่องที่คุยกันอยู่ = true
ไม่แน่ใจ = false (แทรกผิดจังหวะแย่กว่าเงียบ)
ตอบ JSON: {"toVex":true/false}`,
          }],
        },
        contents: [{ role: "user", parts: [{ text: `บทสนทนาก่อนหน้า:\n${recentContext.slice(-700)}\n\nประโยคที่เพิ่งได้ยิน:\n"""${text.trim()}"""` }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: AbortSignal.timeout(6000),
    }, "listen");
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    return JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}").toVex === true;
  } catch {
    return false;
  }
}

/**
 * เสียงสั้น ๆ ที่ถอดออกมาไม่ชัด แต่น่าจะเป็นการเรียก
 *
 * เทสจริง 5 ส.ค.: "เฮ้เพื่อน" ถอดได้ "เฮีย" · "อยู่มั้ย" ได้ "เอีย" · "เพื่อน" ได้ "อ๋อ"
 * คำสั้น ๆ ถอดเพี้ยนเป็นปกติ ถ้ายึดการเทียบคำอย่างเดียวจะเรียกไม่ติดตลอด
 *
 * หลักคิด: ปลุกผิดไม่มีต้นทุน (แค่ได้ยิน "ครับ" หนึ่งครั้งแล้วเงียบต่อ)
 * แต่ปลุกไม่ติด = พังทั้งประสบการณ์ → เอียงไปทางรับไว้ก่อน
 *
 * เงื่อนไข: ต้องสั้นจริง (ไม่ใช่ประโยค) และไม่ใช่คำที่รู้แน่ว่าไม่ได้เรียกเรา
 */
const NOT_A_CALL = /^(ครับ|ค่ะ|คะ|ใช่|ไม่|โอเค|อืม|เออ|อ๋อ|อ้อ|หา|เอ่อ|เอ๋|นะ|จ้า|ฮะ)$/;

export function maybeWakeShort(text: string, audioBytes: number): boolean {
  const t = (text || "").replace(/[\s.,!?ๆ]/g, "").trim();
  if (!t || t.length > 8) return false;          // ยาว = เป็นประโยค ไม่ใช่คำเรียก
  if (audioBytes > 14_000) return false;          // เสียงยาวเกิน ~2 วิ = ไม่ใช่คำเรียกสั้น
  if (NOT_A_CALL.test(t)) return false;           // คำตอบรับทั่วไป ไม่ใช่การเรียก
  if (/^[0-9]+$/.test(t)) return false;
  return true;
}

/** เสียงตัวเองย้อนเข้าไมค์ (เปิดลำโพงแทนหูฟัง) — ห้ามเอามาตอบตัวเอง */
export function looksLikeEcho(heard: string, lastSpoken: string): boolean {
  if (!lastSpoken) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const h = norm(heard);
  const s = norm(lastSpoken);
  if (!h) return false;
  // คำสั้น ๆ ที่โผล่ในสิ่งที่เราเพิ่งพูด = เสียงตัวเองย้อนเข้าไมค์เกือบแน่นอน
  // เดิมข้ามทุกอย่างที่สั้นกว่า 6 ตัวอักษร → "ครับ" ที่ Vex เพิ่งพูดเอง
  // ย้อนกลับเข้ามาแล้วถูกนับเป็นคำสั่งใหม่ วนอยู่อย่างนั้น (เจอจริงใน log 5 รอบติด)
  if (h.length < 6) return s.includes(h);
  if (s.includes(h)) return true;
  let hit = 0;
  for (let i = 0; i + 6 <= h.length; i += 3) if (s.includes(h.slice(i, i + 6))) hit++;
  return hit > 0 && hit / Math.ceil((h.length - 5) / 3) > 0.5;
}

/**
 * ประโยคนี้ดูเหมือนโดนตัดกลางคันไหม
 * เจอจริงใน log: "เป็นเรื่องที่" · "ที่จับได้ตอนนี้มีแค่" — คนไทยหยุดหายใจกลางประโยค
 * ถ้าดูค้าง ให้ท่อรอประโยคถัดไปมาต่อก่อนส่งเข้าสมอง
 */
export function looksTruncated(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return true;
  if (t.length < 6) return true;
  // ลงท้ายด้วยคำเชื่อม/คำนำหน้าที่ต้องมีอะไรตามมา
  return /(ที่|ซึ่ง|และ|แล้ว|กับ|แต่|เพราะ|ให้|ของ|ใน|จาก|ไป|มา|คือ|ว่า|จะ|ได้|มี|เป็น|ก็|ยัง|ถ้า|พอ|แค่|เอา|ช่วย|ขอ)\s*$/.test(t);
}
