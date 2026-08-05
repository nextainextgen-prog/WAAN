import { db } from "./db";
import { getSetting, setSetting, askExtractor, vexRulesContext, askGeminiJson } from "./kiki";

/**
 * นโยบายขัดจังหวะ (สเปกข้อ 7 — หัวใจของงานนี้ สำคัญกว่าคุณภาพเสียง)
 *
 * "ผู้ช่วยที่พูดทุกครั้งที่มีเรื่องเข้า จะโดนปิดภายในวันเดียว"
 *
 * ทุกเหตุการณ์วิ่งผ่านตัวให้คะแนน 3 แกน แล้วออกมาเป็น 4 ระดับ:
 *   1 พูดทันทีในสาย
 *   2 เสียงสัญญาณสั้น + โพสต์ในห้อง text (ไม่พูด)
 *   3 กองไว้ เล่ารวบตอนพัก
 *   4 เงียบ ลงบันทึกอย่างเดียว
 */

export type EventSource = "telegram" | "gmail" | "calendar" | "job" | "system";

export interface IncomingEvent {
  source: EventSource;
  fromName: string;   // ใครส่งมา
  peerId?: string;
  text: string;
  isGroup?: boolean;
  dedupKey: string;   // กันเรื่องเดิมซ้ำ
}

export interface Verdict {
  level: 1 | 2 | 3 | 4;
  urgency: number;    // 0-10
  who: number;        // 0-10
  cost: number;       // 0-10 (ขัดจังหวะตอนนี้แพงแค่ไหน)
  topic: string;
  why: string;
}

const MIN_GAP_MS = 90_000;          // เว้นระยะขั้นต่ำระหว่างการพูดแต่ละครั้ง
const REPEAT_WINDOW_MS = 20 * 60_000; // ห้ามพูดเรื่องเดียวกันซ้ำใน 20 นาที
const LAST_SPOKE_KEY = "vex_last_interrupt_at";
const SEEN_KEY = "vex_interrupt_seen"; // JSON: { [dedupKey]: timestamp }

async function seen(): Promise<Record<string, number>> {
  try {
    const v = await getSetting(SEEN_KEY);
    const o = v ? (JSON.parse(v) as Record<string, number>) : {};
    const now = Date.now();
    for (const k of Object.keys(o)) if (now - o[k] > REPEAT_WINDOW_MS) delete o[k];
    return o;
  } catch {
    return {};
  }
}

async function markSeen(key: string): Promise<void> {
  const o = await seen();
  o[key] = Date.now();
  await setSetting(SEEN_KEY, JSON.stringify(o));
}

/** ตอนนี้ขัดจังหวะแพงไหม — จากปฏิทินจริง + เวลา + อยู่ในสายไหม */
async function interruptCost(now = new Date()): Promise<{ cost: number; why: string }> {
  const reasons: string[] = [];
  let cost = 2;
  // มีนัดอยู่ตอนนี้ = เงียบ (ดูจากปฏิทินจริง ไม่ใช่เดา)
  try {
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const rows = await db.calendarEvent.findMany({
      where: { agent: "kiki", done: false, date: { gte: dayStart, lt: new Date(dayStart.getTime() + 86400_000) } },
    });
    for (const r of rows) {
      if (!r.timeText) continue;
      const [h, m] = r.timeText.split(":").map(Number);
      const st = new Date(r.date); st.setHours(h || 0, m || 0, 0, 0);
      const en = new Date(st.getTime() + 90 * 60_000);
      if (now >= st && now <= en) { cost = 9; reasons.push(`อยู่ในนัด "${r.title}"`); break; }
    }
  } catch { /* อ่านปฏิทินไม่ได้ก็ใช้ค่ากลาง */ }
  const h = now.getHours();
  if (h < 7 || h >= 23) { cost = Math.max(cost, 8); reasons.push("นอกเวลาทำงาน"); }
  else if (h >= 12 && h < 13) { cost = Math.max(cost, 4); reasons.push("ช่วงพักเที่ยง"); }
  const { ownerInVoice } = await import("./kiki-outbox");
  const inVoice = await ownerInVoice();
  if (!inVoice) { cost = Math.max(cost, 6); reasons.push("ไม่ได้อยู่ในสาย"); }
  return { cost, why: reasons.join(" · ") || "ปกติ" };
}

/**
 * ให้คะแนนเหตุการณ์ → ระดับการแจ้ง
 * กฎที่เจ้าของสอนไว้ ("ต่อไปนี้อั๋นทักให้บอกทันทีเสมอ") มีน้ำหนักเหนือคะแนนทุกอย่าง
 */
export async function scoreEvent(ev: IncomingEvent): Promise<Verdict> {
  // กันซ้ำก่อนเปลืองโมเดล
  if ((await seen())[ev.dedupKey]) {
    return { level: 4, urgency: 0, who: 0, cost: 0, topic: ev.fromName, why: "เรื่องเดิมเพิ่งแจ้งไปแล้ว" };
  }

  const { cost, why: costWhy } = await interruptCost();
  const rules = await vexRulesContext().catch(() => "");
  const aliases = await import("./kiki-userbot").then((m) => m.getAliases()).catch(() => []);
  const aliasNote = aliases.length
    ? `ชื่อเรียกที่เจ้าของตั้งไว้เอง (คนพวกนี้สำคัญกับเขา): ${aliases.map((a) => `${a.alias}${a.note ? `=${a.note}` : ""}`).join(" · ")}`
    : "";

  let urgency = 3;
  let who = 3;
  let topic = ev.text.slice(0, 40);

  // ตัวแจ้งเตือนอัตโนมัติ = ไม่ต้องเปลืองโมเดลให้คะแนน ลงบันทึกเงียบ ๆ พอ
  // (5 ส.ค. 2026: เหตุการณ์พวกนี้เข้ามาทั้งวัน ถ้าเรียกโมเดลทุกตัว เครื่องตันจน "แชทของเจ้าของ" ไม่ได้คิว)
  if (/notify|notification|bot\b|แจ้งเตือน|ระบบ|system/i.test(ev.fromName) && !/darling|แฟน|แม่|พ่อ/i.test(ev.fromName)) {
    return { level: 4, urgency: 1, who: 1, cost, topic: ev.fromName.slice(0, 40), why: "ตัวแจ้งเตือนอัตโนมัติ ลงบันทึกอย่างเดียว" };
  }

  // ให้คะแนนด้วยตัวเร็วก่อน (ไม่กี่วินาที) — ของเดิมเรียก Claude CLI ทุกเหตุการณ์
  // ทำให้ /api/kiki/event ใช้เวลา 40-77 วินาทีต่อครั้ง แล้วไปเบียดคิวจนแชทเจ้าของ timeout
  const fast = await askGeminiJson<{ urgency?: number; who?: number; topic?: string }>(
    `ให้คะแนนว่าควรรบกวนเจ้าของแค่ไหน ตอบ JSON เท่านั้น: {"urgency":0-10,"who":0-10,"topic":"หัวเรื่องสั้นมาก 2-6 คำ"}
urgency = ตอบช้าแล้วเสียหายไหม (นัดหมายที่ต้องยืนยันวันนี้/ลูกค้ารอ/เรื่องเงิน = สูง · ทักเล่น/ส่งรูป/สติกเกอร์ = ต่ำ)
who = คนนี้สำคัญแค่ไหนกับเจ้าของ (แฟน/แม่/ลูกค้า = สูง · กลุ่มใหญ่/คนไม่รู้จัก/บอท = ต่ำ)
ถ้ามีกฎที่เจ้าของสอนไว้เกี่ยวกับคนนี้หรือกลุ่มนี้ ให้ยึดกฎนั้นเป็นหลัก
${rules}
${aliasNote}`,
    `จาก: ${ev.fromName}${ev.isGroup ? " (กลุ่ม)" : ""}\nช่องทาง: ${ev.source}\nเนื้อหา: """${ev.text.slice(0, 800)}"""`,
    20_000,
  ).catch(() => null);
  if (fast) {
    urgency = Math.max(0, Math.min(10, Number(fast.urgency) ?? 3));
    who = Math.max(0, Math.min(10, Number(fast.who) ?? 3));
    topic = (fast.topic || topic).trim();
  }

  try {
    if (fast) throw new Error("ได้คะแนนจากตัวเร็วแล้ว"); // ข้ามตัวช้า — กติกาท้ายฟังก์ชันยังทำงานครบเหมือนเดิม
    const raw = await askExtractor(
      `${rules}\n${aliasNote}\n\nเหตุการณ์ที่เพิ่งเข้ามา:\nจาก: ${ev.fromName}${ev.isGroup ? " (กลุ่ม)" : ""}\nช่องทาง: ${ev.source}\nเนื้อหา: """${ev.text.slice(0, 800)}"""`,
      {
        system: `ให้คะแนนว่าควรรบกวนเจ้าของแค่ไหน ตอบ JSON เท่านั้น:
{"urgency":0-10,"who":0-10,"topic":"หัวเรื่องสั้นมาก 2-6 คำ"}

urgency = ตอบช้าแล้วเสียหายไหม (นัดหมายที่ต้องยืนยันวันนี้/ลูกค้ารอ/เรื่องเงิน = สูง · ทักเล่น/ส่งรูป/สติกเกอร์ = ต่ำ)
who = คนนี้สำคัญแค่ไหนกับเจ้าของ (แฟน/แม่/ลูกค้า = สูง · กลุ่มใหญ่/คนไม่รู้จัก/บอท = ต่ำ)
ถ้ามีกฎที่เจ้าของสอนไว้เกี่ยวกับคนนี้หรือกลุ่มนี้ ให้ยึดกฎนั้นเป็นหลัก`,
        timeoutMs: 40_000,
      },
    );
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}") as { urgency?: number; who?: number; topic?: string };
    urgency = Math.max(0, Math.min(10, Number(j.urgency) ?? 3));
    who = Math.max(0, Math.min(10, Number(j.who) ?? 3));
    topic = (j.topic || topic).trim();
  } catch { /* ให้คะแนนไม่ได้ = ใช้ค่ากลาง แล้วไปตกระดับ 3 เอง */ }

  // ยิ่งสำคัญ+ด่วน ยิ่งสู้ต้นทุนการขัดจังหวะได้
  const score = urgency * 1.2 + who - cost;
  let level: Verdict["level"];
  if (score >= 8) level = 1;
  else if (score >= 4) level = 2;
  else if (score >= 0) level = 3;
  else level = 4;

  // เว้นระยะขั้นต่ำระหว่างการพูด — ไม่งั้นรัวจนน่ารำคาญ (ยกเว้นด่วนจริง)
  const lastSpoke = Number((await getSetting(LAST_SPOKE_KEY)) || 0);
  if (level === 1 && Date.now() - lastSpoke < MIN_GAP_MS && urgency < 8) level = 2;

  await markSeen(ev.dedupKey);
  if (level === 1) await setSetting(LAST_SPOKE_KEY, String(Date.now()));
  return { level, urgency, who, cost, topic, why: `ด่วน ${urgency} · คน ${who} · ต้นทุนขัดจังหวะ ${cost} (${costWhy})` };
}

/** เรื่องที่กองไว้รอเล่ารวบตอนพัก (ระดับ 3) */
const PILE_KEY = "vex_interrupt_pile";

export async function pile(topic: string, line: string): Promise<void> {
  const cur = JSON.parse((await getSetting(PILE_KEY)) || "[]") as { topic: string; line: string; at: number }[];
  cur.push({ topic, line, at: Date.now() });
  await setSetting(PILE_KEY, JSON.stringify(cur.slice(-20)));
}

export async function drainPile(): Promise<{ topic: string; line: string }[]> {
  const cur = JSON.parse((await getSetting(PILE_KEY)) || "[]") as { topic: string; line: string; at: number }[];
  await setSetting(PILE_KEY, "[]");
  return cur;
}

export async function pileSize(): Promise<number> {
  try {
    return (JSON.parse((await getSetting(PILE_KEY)) || "[]") as unknown[]).length;
  } catch {
    return 0;
  }
}
