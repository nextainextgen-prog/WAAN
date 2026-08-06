import { db } from "./db";
import { askExtractor } from "./kiki";

/**
 * หา "ช่วงวันที่เจ้าของหมายถึง" จากภาษาคน (6 ส.ค. 2026)
 *
 * **เคสจริงที่พัง** เจ้าของถาม *"แล้ววันที่ผมไปดูหนัง ผมไม่ได้ลงค่าอะไรบ้าง"*
 * → ตอบ *"วันนี้ยังไม่มีรายการเลยครับ"* · ถามซ้ำอีกรอบก็ตอบเหมือนเดิม
 *
 * ต้นตอ: ตัวลิสต์รายการเลือกช่วงด้วย regex 4 แบบตายตัว (วันนี้ · เมื่อวาน · สัปดาห์ · เดือน)
 * อย่างอื่นตกเป็น "วันนี้" ทั้งหมด — คือของที่กติกาข้อ 1 ห้ามไว้ตั้งแต่แรก
 * (ห้ามใช้ regex ตัดสินเจตนา) แต่ยังหลงเหลืออยู่ในเส้นทางนี้
 *
 * ตัวนี้แก้โดยให้อ้าง "เหตุการณ์จริง" ได้ — ไปดูว่าวันไหนมีรายการ/นัดที่ตรงกับที่พูดถึง
 * หาไม่เจอ = บอกตรง ๆ ว่าไม่รู้ว่าวันไหน **ห้ามเดาเป็นวันนี้**
 */

export interface Resolved {
  from: Date;
  to: Date;      // ไม่รวม (exclusive)
  label: string; // อธิบายว่าตีความเป็นวันไหน ไว้บอกเจ้าของ
  sure: boolean; // มั่นใจไหม — ไม่มั่นใจต้องบอกเขาว่าเดามาจากอะไร
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400_000);

/** ช่วงที่ระบุตรงตัวจนไม่มีทางกำกวม — ตรงนี้ใช้รูปแบบตายตัวได้ (กติกาข้อ 1 อนุญาต) */
function obvious(text: string, now: Date): Resolved | null {
  const t0 = dayStart(now);
  if (/เมื่อวาน|มื้อวาน/.test(text)) return { from: addDays(t0, -1), to: t0, label: "เมื่อวาน", sure: true };
  if (/วันนี้/.test(text)) return { from: t0, to: addDays(t0, 1), label: "วันนี้", sure: true };
  if (/เดือนนี้|ทั้งเดือน/.test(text)) {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 1), label: "เดือนนี้", sure: true };
  }
  if (/สัปดาห์นี้|อาทิตย์นี้|สัปดาห์ที่ผ่าน|อาทิตย์ที่ผ่าน/.test(text)) {
    return { from: addDays(t0, -((now.getDay() + 6) % 7)), to: addDays(t0, 1), label: "สัปดาห์นี้", sure: true };
  }
  return null;
}

/** สรุปว่าแต่ละวันย้อนหลังมีอะไรเกิดขึ้นบ้าง — ใช้ให้สมองจับคู่กับสิ่งที่เจ้าของพูดถึง */
async function recentDays(now: Date, days = 60): Promise<string> {
  const from = addDays(dayStart(now), -days);
  const [txns, events] = await Promise.all([
    db.financeTxn.findMany({ where: { occurredAt: { gte: from } }, orderBy: { occurredAt: "asc" }, take: 400 }).catch(() => []),
    db.calendarEvent.findMany({ where: { agent: "kiki", date: { gte: from } }, orderBy: { date: "asc" }, take: 120 }).catch(() => []),
  ]);
  const byDay = new Map<string, string[]>();
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  for (const t of txns) {
    const k = key(t.occurredAt);
    const arr = byDay.get(k) || [];
    if (arr.length < 12) arr.push(`${t.category}${t.note ? `:${t.note.slice(0, 40)}` : ""}`);
    byDay.set(k, arr);
  }
  for (const e of events) {
    const k = key(e.date);
    const arr = byDay.get(k) || [];
    arr.push(`[นัด]${e.title.slice(0, 40)}`);
    byDay.set(k, arr);
  }
  return [...byDay.entries()].map(([k, v]) => `${k}: ${v.join(" · ")}`).join("\n").slice(0, 12_000);
}

/**
 * @param replyText ข้อความที่เจ้าของ reply ถึง — มักเป็นที่ที่ "วันไหน" ถูกพูดไปแล้ว
 *   เคสจริง: Vex ตอบไปว่า "31 ก.ค. ที่ลงไว้แล้วมีตามนี้..." แล้วเจ้าของ reply ว่า
 *   "ขอรายงานลิสที่ลงค่าใช้จ่ายแล้ว" → ถ้าไม่อ่านข้อความที่ reply ถึง จะกลับไปเป็น "วันนี้" อีก
 */
export async function resolveWhen(text: string, now = new Date(), replyText = ""): Promise<Resolved | null> {
  // ข้อความที่ reply ถึงมาก่อน — เจ้าของกำลังต่อเรื่องจากตรงนั้น
  const o = obvious(text, now) || (replyText ? obvious(replyText, now) : null);
  if (o) return o;

  const context = await recentDays(now);
  if (!context.trim()) return null;

  const raw = await askExtractor(
    `${replyText ? `ข้อความที่เจ้าของกำลัง reply ถึง (เป็นบริบทว่าพูดถึงวันไหนอยู่):\n"""${replyText.slice(0, 1200)}"""\n\n` : ""}วันนี้คือ ${now.toLocaleDateString("th-TH-u-ca-gregory", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}\n\n` +
      `เจ้าของถามว่า: """${text.slice(0, 500)}"""\n\n` +
      `สิ่งที่เกิดขึ้นในแต่ละวันย้อนหลัง (จากรายการเงินจริงและนัดจริง):\n${context}`,
    {
      system: `เจ้าของอ้างถึง "วัน" ด้วยเหตุการณ์แทนที่จะบอกวันที่ตรง ๆ หาให้ว่าเขาหมายถึงวันไหน
ตอบ JSON เท่านั้น: {"from":"YYYY-MM-DD","to":"YYYY-MM-DD","label":"อธิบายสั้น ๆ ว่าวันไหนและรู้ได้ยังไง","sure":true/false}
- from/to รวมปลายทั้งสองข้าง (วันเดียวให้ from=to)
- จับคู่จากหมวด/โน้ตของรายการเงิน หรือชื่อนัด เช่น "วันที่ไปดูหนัง" → วันที่มีรายการหมวดบันเทิง/โน้ตเกี่ยวกับหนัง
- เจอหลายวันที่เข้าข่าย ให้เอาวันที่ใกล้ปัจจุบันที่สุด แล้ว sure=false
- **หาไม่เจอจริง ๆ ให้ตอบ {"from":"","to":"","label":"ไม่พบวันที่ตรงกับที่พูดถึง","sure":false}**
  ห้ามเดาเป็นวันนี้เด็ดขาด`,
      timeoutMs: 40_000,
    },
  ).catch(() => "");

  try {
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}") as { from?: string; to?: string; label?: string; sure?: boolean };
    if (!j.from || !j.to) return null;
    const f = new Date(`${j.from}T00:00:00`);
    const t = new Date(`${j.to}T00:00:00`);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return null;
    return { from: f, to: addDays(t, 1), label: (j.label || "").trim() || "ช่วงที่พูดถึง", sure: j.sure === true };
  } catch {
    return null;
  }
}
