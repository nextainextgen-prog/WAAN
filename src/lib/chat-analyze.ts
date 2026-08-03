// ===== Thunder — วิเคราะห์บทสนทนารายแชท (Typhoon ผ่าน Ollama, รันในเครื่อง) =====
// ใช้โมเดลไทย local: ฟรี ไม่กิน quota Claude และข้อมูลลูกค้าไม่ออกนอกเครื่อง (PDPA)
// Claude เอาไว้ใช้ตอนสรุปรวมรายวันทีเดียว (เห็นแค่ตัวเลข ไม่เห็นบทสนทนาดิบ)
import { db } from "@/lib/db";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const CHAT_MODEL = process.env.THUNDER_CHAT_MODEL || "scb10x/llama3.1-typhoon2-8b-instruct:latest";

export const TOPICS = ["ต่ออายุ", "ติดตั้ง", "ปัญหาใช้งาน", "สอบถามราคา", "สอบถามทั่วไป", "อื่นๆ"] as const;
const INTENT_MAP: Record<string, string> = {
  "ต่ออายุ": "renew", "ติดตั้ง": "install", "ปัญหาใช้งาน": "issue",
  "สอบถามราคา": "pricing", "สอบถามทั่วไป": "info", "อื่นๆ": "other",
};

export interface ChatAnalysis {
  topic: string;
  intent: string;
  question: string;
  problem: string | null;
  resolved: boolean | null;
  adminHelp: "good" | "ok" | "poor" | null;
  adminTone: "good" | "ok" | "poor" | null;
  summary: string;
  customerSay: string | null;
  adminSay: string | null;
  sentiment: "happy" | "neutral" | "upset" | null;
}

function buildPrompt(messages: { side: string; text: string }[]): string {
  const convo = messages
    .map((m) => `${m.side === "admin" ? "แอดมิน" : "ลูกค้า"}: ${m.text}`)
    .join("\n")
    .slice(0, 6000);
  return `คุณคือผู้ช่วยวิเคราะห์บทสนทนาฝ่ายบริการลูกค้า อ่านบทสนทนาแล้วตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่น

บทสนทนา:
${convo}

กติกาสำคัญ (ต้องทำตามเคร่งครัด):
1. "problem" — ถ้าลูกค้าแจ้งอาการเสีย/ใช้ไม่ได้/ติดขัด ต้องเขียนอาการนั้นออกมาเสมอ ห้ามใส่ null
   ใส่ null ได้เฉพาะกรณีลูกค้าแค่สอบถาม/สั่งซื้อ/ต่ออายุ โดยไม่มีอะไรเสีย
2. "customerSay" — คัดลอกประโยคจริงของลูกค้าที่สื่อความต้องการ/ปัญหาชัดที่สุดมา 1 ประโยค (ห้ามแต่งใหม่)
3. "adminSay" — คัดลอกประโยคจริงของแอดมินที่เป็นคำตอบ/การแก้ปัญหาที่สำคัญที่สุดมา 1 ประโยค (ห้ามแต่งใหม่)
4. เกณฑ์ให้คะแนน (เข้มงวด ห้ามให้ good ทุกเคส):
   - good = ตอบตรงคำถาม ให้ข้อมูลครบ ลูกค้าได้สิ่งที่ต้องการ
   - ok   = ตอบได้แต่ไม่ครบ ลูกค้าต้องถามซ้ำ หรือตอบช้า/วกวน
   - poor = ตอบไม่ตรงคำถาม ปล่อยค้าง ลูกค้าต้องทวง หรือไม่ได้แก้ปัญหา
   - ถ้า resolved = false ห้ามให้ adminHelp = good เด็ดขาด

ตอบ JSON ตามรูปแบบนี้:
{
  "topic": "เลือก 1 จาก: ต่ออายุ | ติดตั้ง | ปัญหาใช้งาน | สอบถามราคา | สอบถามทั่วไป | อื่นๆ",
  "question": "คำถาม/ความต้องการหลักของลูกค้า สรุปสั้นไม่เกิน 80 ตัวอักษร",
  "customerSay": "ประโยคจริงของลูกค้า (คัดลอกมา)",
  "problem": "อาการ/ปัญหาที่ลูกค้าเจอ (null เฉพาะกรณีไม่มีอะไรเสีย)",
  "adminSay": "ประโยคจริงของแอดมินที่เป็นคำตอบสำคัญ (คัดลอกมา)",
  "resolved": true/false,
  "sentiment": "happy | neutral | upset (อารมณ์ลูกค้าตอนจบบทสนทนา)",
  "adminHelp": "good | ok | poor",
  "adminTone": "good | ok | poor",
  "summary": "สรุปเคสนี้ 1 บรรทัด ไม่เกิน 100 ตัวอักษร"
}`;
}

// ถามซ้ำเฉพาะจุด: เคสที่เป็นปัญหาแต่ดึงอาการไม่ได้ (โมเดลชอบตอบ null)
function buildProblemPrompt(messages: { side: string; text: string }[]): string {
  const convo = messages.map((m) => `${m.side === "admin" ? "แอดมิน" : "ลูกค้า"}: ${m.text}`).join("\n").slice(0, 5000);
  return `อ่านบทสนทนานี้ แล้วบอกว่า "ลูกค้าเจอปัญหาอะไร" เป็นประโยคเดียวสั้นๆ ภาษาไทย
ต้องเขียนอาการจริงที่อ่านได้จากบทสนทนา ห้ามลอกข้อความตัวอย่างด้านล่างมาตอบ

ตัวอย่างคำตอบที่ถูก: {"problem": "แนบสลิปแล้วระบบขึ้น error"}
ตัวอย่างคำตอบที่ถูก: {"problem": "เติมเครดิตแล้วยอดไม่เข้า"}
ถ้าลูกค้าไม่ได้แจ้งปัญหาอะไรเลยจริงๆ ให้ตอบ {"problem": null}

บทสนทนา:
${convo}`;
}

// โมเดลบางครั้ง "ลอกคำอธิบายฟิลด์" จาก prompt มาใส่เป็นคำตอบ (เช่น problem = "อาการที่ลูกค้าเจอ")
// ต้องตัดทิ้ง ไม่งั้นไปโผล่ในรายงานเป็นอันดับต้นๆ แบบไร้ความหมาย
const ECHO_PATTERNS = [
  /^อาการ\s*\/?\s*ปัญหาที่ลูกค้าเจอ/, /^อาการที่ลูกค้าเจอ$/, /^ปัญหาที่ลูกค้าเจอ$/,
  /^ประโยคจริงของ(ลูกค้า|แอดมิน)/, /^คำถาม\s*\/\s*ความต้องการหลัก/, /^สรุปเคสนี้/,
  /^คัดลอกมา$/, /^\(?คัดลอกมา\)?$/, /^null$/i, /^ไม่มี$/, /^-$/,
];
function isEcho(v: string): boolean {
  const t = (v || "").trim();
  if (!t) return true;
  return ECHO_PATTERNS.some((re) => re.test(t));
}

function parseJson(raw: string): Record<string, unknown> | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
function grade(v: unknown): "good" | "ok" | "poor" | null {
  const s = String(v || "").toLowerCase();
  return s === "good" || s === "ok" || s === "poor" ? s : null;
}

// วิเคราะห์ 1 บทสนทนา — คืน null ถ้าโมเดลไม่พร้อม/ตอบไม่เป็น JSON
export async function analyzeConversation(messages: { side: string; text: string }[]): Promise<ChatAnalysis | null> {
  if (!messages.length) return null;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: CHAT_MODEL,
        prompt: buildPrompt(messages),
        stream: false,
        format: "json",
        options: { temperature: 0.1, num_predict: 400 },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const parsed = parseJson(String(j.response || ""));
    if (!parsed) return null;
    const topic = TOPICS.includes(String(parsed.topic) as (typeof TOPICS)[number]) ? String(parsed.topic) : "อื่นๆ";
    const nullish = (v: unknown) => v == null || String(v).trim() === "" || isEcho(String(v));
    let problem = nullish(parsed.problem) ? null : String(parsed.problem).slice(0, 250);
    const resolved = typeof parsed.resolved === "boolean" ? parsed.resolved : null;
    let adminHelp = grade(parsed.adminHelp);
    // บังคับกติกา: เคสไม่จบ ห้ามได้ good (โมเดลชอบใจดี)
    if (resolved === false && adminHelp === "good") adminHelp = "ok";

    // เคสปัญหาแต่ดึงอาการไม่ได้ → ถามซ้ำเฉพาะจุด
    if (!problem && topic === "ปัญหาใช้งาน") {
      const again = await askOllama(buildProblemPrompt(messages), 200);
      const p2 = again ? parseJson(again) : null;
      if (p2 && !nullish(p2.problem)) problem = String(p2.problem).slice(0, 250);
      if (problem && isEcho(problem)) problem = null;
    }

    const sen = String(parsed.sentiment || "").toLowerCase();
    return {
      topic,
      intent: INTENT_MAP[topic] || "other",
      question: isEcho(String(parsed.question || "")) ? "" : String(parsed.question || "").slice(0, 200),
      problem,
      resolved,
      adminHelp,
      adminTone: grade(parsed.adminTone),
      summary: String(parsed.summary || "").slice(0, 250),
      customerSay: nullish(parsed.customerSay) ? null : String(parsed.customerSay).slice(0, 300),
      adminSay: nullish(parsed.adminSay) ? null : String(parsed.adminSay).slice(0, 300),
      sentiment: sen === "happy" || sen === "upset" || sen === "neutral" ? (sen as "happy" | "upset" | "neutral") : null,
    };
  } catch {
    return null;
  }
}

// เรียก Ollama ครั้งเดียว คืน raw text
async function askOllama(prompt: string, numPredict: number): Promise<string | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: CHAT_MODEL, prompt, stream: false, format: "json", options: { temperature: 0.1, num_predict: numPredict } }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return String(j.response || "");
  } catch {
    return null;
  }
}

// วิเคราะห์ ChatLog ที่ยังไม่ได้วิเคราะห์ของวันธุรกิจนั้น (ทีละตัว กัน Ollama ล้น)
export async function analyzePendingChats(bizDate: string, limit = 300): Promise<{ done: number; failed: number }> {
  const rows = await db.chatLog.findMany({
    where: { bizDate, analyzed: false },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let done = 0, failed = 0;
  for (const r of rows) {
    let msgs: { side: string; text: string }[] = [];
    try { msgs = JSON.parse(r.messages); } catch { /* ข้าม */ }
    const a = msgs.length ? await analyzeConversation(msgs) : null;
    if (!a) { failed++; continue; }
    await db.chatLog.update({
      where: { id: r.id },
      data: {
        analyzed: true, topic: a.topic, intent: a.intent, question: a.question,
        problem: a.problem, resolved: a.resolved, adminHelp: a.adminHelp,
        adminTone: a.adminTone, summary: a.summary,
        customerSay: a.customerSay, adminSay: a.adminSay, sentiment: a.sentiment,
      },
    });
    done++;
  }
  return { done, failed };
}

export async function chatModelReady(): Promise<boolean> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return false;
    const j = await r.json();
    const base = CHAT_MODEL.split(":")[0];
    return (j.models || []).some((m: { name?: string }) => (m.name || "").startsWith(base));
  } catch {
    return false;
  }
}
