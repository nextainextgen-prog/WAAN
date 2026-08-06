import { db } from "./db";
import { askGeminiJson } from "./kiki";

/**
 * บันทึกทุกเทิร์น + ไล่ย้อนหลังหาเทิร์นที่ตอบไม่ตรง (เจ้าของสั่ง 6 ส.ค. 2026: "ไม่ต้องรอโด้เจอ")
 *
 * คู่กับ kiki-selfcheck.ts ที่ตรวจว่า "ความสามารถไหนยังขาด" — ไฟล์นี้ตรวจว่า "ตอบไปแล้วดีไหม"
 *
 * ทุกเทิร์นถูกบันทึกไว้ (เจตนาที่เลือก · ตัวจัดการที่รับ · เวลาที่ใช้ · พังไหม)
 * ตัวนี้ไล่ย้อนหลังหา "เทิร์นที่น่าจะตอบไม่ตรง" ด้วยสัญญาณที่วัดได้จริง แล้วรายงานเอง
 */

export interface TurnLog {
  channel?: string;
  text: string;
  intent: string;
  confidence: number;
  handler?: string | null;
  ms: number;
  sends: number;
  error?: string | null;
}

export async function logTurn(t: TurnLog): Promise<void> {
  try {
    await db.vexTurn.create({
      data: {
        channel: t.channel || "telegram",
        text: (t.text || "").slice(0, 500),
        intent: t.intent,
        confidence: t.confidence,
        handler: t.handler || null,
        ms: Math.round(t.ms),
        sends: t.sends,
        error: t.error?.slice(0, 400) || null,
      },
    });
  } catch { /* บันทึกไม่ได้ก็ไม่ทำให้การตอบพัง */ }
}

export interface Suspect {
  id: string;
  why: string;
  text: string;
  intent: string;
  ms: number;
}

/** สัญญาณที่วัดได้จากของจริง — ไม่ต้องเดา ไม่ต้องเรียกโมเดล */
export async function findSuspects(hours = 24): Promise<Suspect[]> {
  const since = new Date(Date.now() - hours * 3600_000);
  const rows = await db.vexTurn.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "asc" }, take: 400 });
  const out: Suspect[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/[\s?!.]/g, "");

  rows.forEach((r, i) => {
    const why: string[] = [];
    if (r.error) why.push(`พัง: ${r.error.slice(0, 80)}`);
    if (r.ms > 120_000) why.push(`ใช้เวลา ${Math.round(r.ms / 1000)} วินาที`);
    if (!r.sends) why.push("ไม่ได้ตอบอะไรกลับเลย");
    if (r.confidence > 0 && r.confidence < 0.5 && r.intent !== "chat") why.push(`เลือกเจตนา ${r.intent} ทั้งที่ไม่มั่นใจ (${r.confidence})`);
    // เจ้าของถามซ้ำภายใน 5 นาที = คำตอบก่อนหน้าน่าจะไม่ได้เรื่อง
    const prev = rows[i - 1];
    if (prev && norm(prev.text) && norm(r.text) && norm(prev.text) === norm(r.text) && r.createdAt.getTime() - prev.createdAt.getTime() < 5 * 60_000) {
      why.push("เจ้าของถามซ้ำคำเดิมภายใน 5 นาที");
    }
    if (why.length) out.push({ id: r.id, why: why.join(" · "), text: r.text.slice(0, 90), intent: r.intent, ms: r.ms });
  });
  return out;
}

/** อ่านเทิร์นที่น่าสงสัยแล้วสรุปเป็นรายงานภาษาคน + จัดลำดับว่าอันไหนควรแก้ก่อน */
export async function selfCheckReport(hours = 24): Promise<{ count: number; text: string }> {
  const suspects = await findSuspects(hours);
  if (!suspects.length) return { count: 0, text: "" };

  await db.vexTurn
    .updateMany({ where: { id: { in: suspects.map((s) => s.id) } }, data: { flagged: "auto", reviewedAt: new Date() } })
    .catch(() => {});

  const lines = suspects.slice(0, 25).map((s) => `- "${s.text}" → ${s.intent} · ${s.why}`).join("\n");
  const j = await askGeminiJson<{ report?: string }>(
    `คุณคือระบบตรวจสุขภาพตัวเองของเลขา AI สรุปให้เจ้าของอ่านเข้าใจใน 6 บรรทัด
ตอบ JSON เท่านั้น: {"report":"ข้อความรายงาน"}
กติกา: บอกว่าเจออาการอะไรบ้าง กี่ครั้ง · อันไหนควรแก้ก่อนเพราะอะไร · ห้ามแต่งตัวเลขเพิ่ม · ห้ามแก้ตัว ยอมรับตรง ๆ`,
    `ช่วง ${hours} ชั่วโมงล่าสุด เจอเทิร์นที่น่าสงสัย ${suspects.length} รายการ:\n${lines}`,
    25_000,
  ).catch(() => null);

  const text = (j?.report || "").trim() || `เจอเทิร์นที่น่าสงสัย ${suspects.length} รายการใน ${hours} ชั่วโมงล่าสุด\n${lines.slice(0, 1200)}`;
  return { count: suspects.length, text };
}
