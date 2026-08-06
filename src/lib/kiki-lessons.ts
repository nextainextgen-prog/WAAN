import { db } from "./db";
import { askGeminiJson, getSetting, setSetting } from "./kiki";

/**
 * ชั้นบทเรียนเชิงลบ (ชั้น 1.5 ของจิตใจ — เจ้าของเน้นที่สุด 6 ส.ค. 2026)
 *
 * *"จำสิ่งที่ผมบอกว่าไม่เอา ไม่ถูก ไม่ตรง แล้วเอาไปพัฒนา"*
 *
 * ของที่มีอยู่ก่อนหน้า จับได้แค่ "แบบชัด" (rule_teach — เจ้าของพูดตรง ๆ ว่าต่อไปให้ทำยังไง)
 * ชั้นนี้เพิ่ม "แบบไม่ชัด" ที่ต้องอ่านเอง: ปฏิเสธสั้น ๆ · ถามซ้ำทันที · ขอใหม่ด้วยคำต่าง ·
 * บ่นรูปแบบ ("งง" "ยาวไป" "อ่านไม่รู้เรื่อง") — สัญญาณพวกนี้เกิดแล้วหายไปเฉย ๆ มาตลอด
 *
 * กติกาที่ยึด
 *  - ตัวจับเป็นโมเดลอ่านความหมาย ไม่ใช่ regex (กติกาข้อ 1 + บทเรียน Jaccard 16% กับภาษาไทย)
 *  - ไม่แน่ใจ = ไม่ใช่บทเรียน (false positive จะสอนนิสัยผิด ๆ ให้ระบบ แย่กว่าจับตก)
 *  - จับคู่บทเรียนซ้ำด้วยความหมายก่อนสร้างใหม่ — ซ้ำ = timesRepeated++ + ยกระดับความรุนแรง
 *  - ทุกอย่าง fire-and-forget: ล่ม/ช้า ห้ามกระทบการตอบแม้แต่มิลลิวินาทีเดียว
 *  - ปิดได้ด้วย Setting `vex_lessons` = "0"
 */

export interface Lesson {
  id: string;
  trigger: string;
  whatIDid: string;
  whatWasWrong: string;
  correction: string;
  evidence: string;
  severity: string;
  scope: string;
  timesRepeated: number;
}

const MOOD_KEY = "vex_owner_mood"; // {"mood":"...","at":ms} — เฟส 3 (สภาพเจ้าของ) ใช้ต่อ ไม่ต้องเรียกโมเดลเพิ่ม

async function enabled(): Promise<boolean> {
  return (await getSetting("vex_lessons").catch(() => null)) !== "0";
}

/**
 * อ่านคู่สนทนาล่าสุดแล้วจับว่า "ข้อความใหม่ของเจ้าของเป็นคำตำหนิ/สัญญาณไม่พอใจไหม"
 * เรียกหลังบันทึกข้อความเจ้าของทุกครั้ง (fire-and-forget จาก ingest)
 *
 * แถม: ประเมินอารมณ์เจ้าของจากข้อความเดียวกัน เก็บลง Setting — เฟส 3 ใช้โดยไม่ต้องเรียกโมเดลอีกรอบ
 */
export async function detectAndRecord(userText: string, userMsgId: string | null, channel: string): Promise<void> {
  if (!(await enabled())) return;
  const text = (userText || "").trim();
  if (!text || text.startsWith("[ปุ่ม:")) return;

  // หา "คำตอบล่าสุดของ Vex" กับ "ข้อความก่อนหน้าของเจ้าของ" จากประวัติจริง
  const rows = await db.kikiChat.findMany({
    where: { scope: "owner", NOT: { channel: "event" } },
    orderBy: { createdAt: "desc" },
    take: 8,
    skip: userMsgId ? 1 : 0, // ข้ามข้อความที่เพิ่งบันทึกไปเอง
  }).catch(() => []);
  const lastAssistant = rows.find((r) => r.role === "assistant");
  if (!lastAssistant) return;
  // คำตอบเก่าเกิน 3 ชม. = ข้อความใหม่คงเป็นเรื่องใหม่ ไม่ใช่ฟีดแบ็กของคำตอบนั้น
  if (Date.now() - lastAssistant.createdAt.getTime() > 3 * 3600_000) return;
  const prevUser = rows.find((r) => r.role === "user" && r.createdAt < lastAssistant.createdAt);

  const j = await askGeminiJson<{
    mood?: string;
    isNegative?: boolean;
    lesson?: { trigger?: string; whatIDid?: string; whatWasWrong?: string; correction?: string; severity?: string; scope?: string };
  }>(
    `คุณคือส่วน "รับรู้ฟีดแบ็ก" ของเลขาส่วนตัว อ่านจังหวะสนทนาแล้วตัดสิน 2 อย่าง ตอบ JSON เท่านั้น:
{"mood":"ปกติ|รีบ|เหนื่อย|หงุดหงิด|อารมณ์ดี",
 "isNegative":true/false,
 "lesson":{"trigger":"สถานการณ์ (ย่อ ไม่เกิน 15 คำ)","whatIDid":"สิ่งที่เลขาทำ","whatWasWrong":"ผิดตรงไหน","correction":"ครั้งหน้าต้องทำแบบไหนแทน","severity":"เบา|กลาง|หนัก","scope":"ทั่วไป|เรื่อง:<หัวข้อสั้น>"}}

isNegative = true เมื่อข้อความใหม่ของเจ้าของเป็น "ฟีดแบ็กเชิงลบต่อคำตอบ/การกระทำล่าสุดของเลขา" เช่น
- ปฏิเสธ/แก้: "ไม่ใช่" "ไม่ใช่แบบนั้น" "ผิด" "เอาใหม่" "ไม่ตรง"
- บ่นรูปแบบ: "งง" "อ่านไม่รู้เรื่อง" "ยาวไป" "สั้นไป" "ทำไมต้องซ้ำ" "ห่วย" รวมถึงคำหยาบที่ระบายใส่คุณภาพคำตอบ
- ถามเรื่องเดิมซ้ำทันทีทั้งที่เพิ่งได้คำตอบ = คำตอบแรกไม่ผ่าน
- สั่งเรื่องเดิมใหม่ด้วยคำต่างไปจากเดิม = การตีความรอบแรกผิด

isNegative = false เมื่อ: เรื่องใหม่ · คำสั่งต่อยอดปกติ · คำถามเพิ่มเติมที่ไม่ได้ตำหนิ · ตอบรับ/ขอบคุณ
**ไม่แน่ใจให้ตอบ false** — จับผิดพลาดแย่กว่าจับตก
lesson ใส่เฉพาะตอน isNegative=true และต้องเขียนจากสิ่งที่เกิดจริงในบทสนทนา ห้ามแต่งเติม
severity: หนัก = เจ้าของโกรธจริง/สั่งห้ามเด็ดขาด/เรื่องเงินหรือการกระทำที่เสียหาย · กลาง = ตำหนิชัดเจน · เบา = ขอปรับเล็กน้อย
mood ประเมินจากข้อความใหม่ล่าสุดเสมอ (แม้ isNegative=false)`,
    [
      prevUser ? `เจ้าของ (ก่อนหน้า): """${prevUser.content.slice(0, 800)}"""` : "",
      `เลขาตอบ: """${lastAssistant.content.replace(/<[^>]+>/g, "").slice(0, 1500)}"""`,
      `เจ้าของ (ล่าสุด): """${text.slice(0, 800)}"""`,
    ].filter(Boolean).join("\n\n"),
    25_000,
  ).catch(() => null);
  if (!j) return;

  const mood = (j.mood || "").trim();
  if (mood) await setSetting(MOOD_KEY, JSON.stringify({ mood, at: Date.now() })).catch(() => {});

  if (j.isNegative !== true || !j.lesson) return;
  const l = j.lesson;
  const whatWasWrong = (l.whatWasWrong || "").trim();
  const correction = (l.correction || "").trim();
  if (!whatWasWrong || !correction) return; // บทเรียนที่ไม่รู้ว่าผิดตรงไหน/แก้ยังไง = ขยะ ไม่เก็บ

  await recordLesson({
    trigger: (l.trigger || "").trim() || text.slice(0, 80),
    whatIDid: (l.whatIDid || "").trim() || lastAssistant.content.replace(/<[^>]+>/g, "").slice(0, 200),
    whatWasWrong,
    correction,
    evidence: text.slice(0, 500),
    evidenceMsgId: userMsgId,
    severity: ["เบา", "กลาง", "หนัก"].includes(l.severity || "") ? l.severity! : "กลาง",
    scope: (l.scope || "ทั่วไป").slice(0, 60),
  });

  // ทางเร็ว→ช้า (จิตใจเฟส 5): เทิร์นที่เพิ่งพลาดใช้เจตนาไหน ยกเพดานความมั่นใจของเจตนานั้น
  // ครั้งหน้าเรื่องเดียวกันจะเข้าทางช้า (chat) ที่มีเครื่องมือครบและด่านตรวจ — จนกว่ารอบทบทวนจะปลด
  try {
    const lastTurn = await db.vexTurn.findFirst({
      where: { createdAt: { lt: new Date() } },
      orderBy: { createdAt: "desc" },
      skip: 1, // ตัวล่าสุดคือเทิร์นของข้อความตำหนินี้เอง — เอาเทิร์นก่อนหน้า (ตัวที่ทำพลาด)
    });
    if (lastTurn?.intent) {
      const { raiseSlowpath } = await import("./kiki-autonomy");
      await raiseSlowpath(lastTurn.intent);
    }
  } catch { /* ยกไม่ได้ก็ข้าม */ }
}

/**
 * บันทึกบทเรียน — เทียบกับของเดิมด้วย "ความหมาย" ก่อนเสมอ
 * ซ้ำ = timesRepeated++ (นี่คือตัวเลขที่สำคัญที่สุดของทั้งระบบ) + ยกระดับเป็น "หนัก" เมื่อซ้ำครั้งที่ 2
 */
export async function recordLesson(input: {
  trigger: string; whatIDid: string; whatWasWrong: string; correction: string;
  evidence: string; evidenceMsgId?: string | null; severity?: string; scope?: string;
}): Promise<{ id: string; repeated: boolean }> {
  const existing = await db.lessonLearned.findMany({
    where: { active: true },
    orderBy: { updatedAt: "desc" },
    take: 60,
  }).catch(() => []);

  let matchedId: string | null = null;
  if (existing.length) {
    const j = await askGeminiJson<{ match?: number }>(
      `บทเรียนใหม่ที่เพิ่งเกิด กับรายการบทเรียนเดิม อันไหน "เป็นความผิดพลาดเรื่องเดียวกัน" (พลาดซ้ำ)
ตอบ JSON เท่านั้น: {"match":<เลขลำดับของบทเรียนเดิมที่ตรง หรือ 0 ถ้าไม่มี>}
นับว่าเรื่องเดียวกันเมื่อ "สาเหตุและการแก้" ตรงกัน แม้สถานการณ์ต่างกัน (เช่น ตอบยาวไปในคนละหัวข้อ = เรื่องเดียวกัน)
ไม่แน่ใจ = 0 (สร้างใหม่ปลอดภัยกว่าจับคู่ผิด)`,
      `บทเรียนใหม่: ผิดเพราะ ${input.whatWasWrong} → ต้อง ${input.correction}\n\nบทเรียนเดิม:\n${existing
        .map((e, i) => `${i + 1}. ผิดเพราะ ${e.whatWasWrong} → ต้อง ${e.correction}`)
        .join("\n")}`,
      20_000,
    ).catch(() => null);
    const n = j?.match || 0;
    if (n >= 1 && n <= existing.length) matchedId = existing[n - 1].id;
  }

  if (matchedId) {
    const old = existing.find((e) => e.id === matchedId)!;
    const repeats = old.timesRepeated + 1;
    await db.lessonLearned.update({
      where: { id: matchedId },
      data: {
        timesRepeated: repeats,
        lastRepeatAt: new Date(),
        // ซ้ำครั้งที่ 2 ขึ้นไป = ยกเป็น "หนัก" ถาวร (จะอยู่ในบริบททุกคำตอบ)
        severity: repeats >= 2 ? "หนัก" : old.severity,
        evidence: `${old.evidence.slice(0, 300)} | ซ้ำล่าสุด: ${input.evidence.slice(0, 150)}`,
        ...(input.evidenceMsgId ? { evidenceMsgId: input.evidenceMsgId } : {}),
      },
    }).catch(() => {});
    return { id: matchedId, repeated: true };
  }

  const row = await db.lessonLearned.create({
    data: {
      trigger: input.trigger.slice(0, 200),
      whatIDid: input.whatIDid.slice(0, 300),
      whatWasWrong: input.whatWasWrong.slice(0, 300),
      correction: input.correction.slice(0, 300),
      evidence: input.evidence.slice(0, 500),
      evidenceMsgId: input.evidenceMsgId || null,
      severity: input.severity || "กลาง",
      scope: input.scope || "ทั่วไป",
    },
  });
  return { id: row.id, repeated: false };
}

/**
 * บล็อกบทเรียนสำหรับฉีดเข้าบริบท "ทุกคำตอบ" — เก็บไว้เฉย ๆ ไม่มีประโยชน์ (สเปกเจ้าของ)
 * หนัก = มาทุกตัวเสมอ · กลาง/เบา = เอาตัวที่ยังสดหรือใช้บ่อย เพดานรวม ~1,800 ตัวอักษร
 */
export async function lessonsContext(opts: { heavyOnly?: boolean; maxChars?: number } = {}): Promise<string> {
  if (!(await enabled())) return "";
  const maxChars = opts.maxChars ?? 1800;
  try {
    const heavy = await db.lessonLearned.findMany({
      where: { active: true, severity: "หนัก" },
      orderBy: { updatedAt: "desc" },
      take: 8,
    });
    const rest = opts.heavyOnly
      ? []
      : await db.lessonLearned.findMany({
          where: { active: true, NOT: { severity: "หนัก" } },
          orderBy: [{ useCount: "desc" }, { updatedAt: "desc" }],
          take: Math.max(0, 12 - heavy.length),
        });
    const all = [...heavy, ...rest];
    if (!all.length) return "";

    // นับว่าเพิ่งถูกใช้ (ความจำเด่นขึ้น) — เบื้องหลัง ไม่ถ่วง
    void db.lessonLearned
      .updateMany({ where: { id: { in: all.map((l) => l.id) } }, data: { lastUsedAt: new Date(), useCount: { increment: 1 } } })
      .catch(() => {});

    const lines: string[] = [];
    let used = 0;
    for (const l of all) {
      const line = `· ${l.severity === "หนัก" ? "[ห้ามพลาดซ้ำ] " : ""}${l.whatWasWrong} → ต้อง${l.correction}${l.timesRepeated ? ` (เคยพลาดซ้ำ ${l.timesRepeated} ครั้ง)` : ""}`;
      if (used + line.length > maxChars) break;
      used += line.length;
      lines.push(line);
    }
    if (!lines.length) return "";
    return `=== บทเรียนจากที่เจ้าของเคยตำหนิ (ปรับพฤติกรรมตามนี้ทุกคำตอบ — พลาดซ้ำเรื่องเดิมคือความผิดร้ายแรงที่สุด) ===\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}

/** รายการบทเรียนทั้งหมด (ให้เจ้าของดู "เคยด่าอะไรบ้าง" — ต้องมีหลักฐานจริงประกอบ) */
export async function listLessons(): Promise<(Lesson & { createdAt: Date })[]> {
  const rows = await db.lessonLearned.findMany({ where: { active: true }, orderBy: [{ severity: "desc" }, { updatedAt: "desc" }], take: 40 }).catch(() => []);
  return rows.map((r) => ({
    id: r.id, trigger: r.trigger, whatIDid: r.whatIDid, whatWasWrong: r.whatWasWrong,
    correction: r.correction, evidence: r.evidence, severity: r.severity, scope: r.scope,
    timesRepeated: r.timesRepeated, createdAt: r.createdAt,
  }));
}

/** ลบบทเรียนตามที่เจ้าของสั่ง — หาโดยความหมาย ปิด active (ย้อนกลับได้ ไม่ลบทิ้งจริง) */
export async function deactivateLessons(query: string): Promise<string[]> {
  const rows = await db.lessonLearned.findMany({ where: { active: true }, take: 40 }).catch(() => []);
  if (!rows.length) return [];
  const j = await askGeminiJson<{ ids?: number[] }>(
    `เจ้าของสั่งลบบทเรียน: """${query.slice(0, 300)}"""\nรายการบทเรียน:\n${rows.map((r, i) => `${i + 1}. ${r.whatWasWrong} → ${r.correction}`).join("\n")}\n\nตอบ JSON: {"ids":[เลขข้อที่ตรงกับที่สั่งลบ]} — ไม่ตรงสักอัน = []`,
    "",
    20_000,
  ).catch(() => null);
  const picked = (j?.ids || []).map((n) => rows[n - 1]).filter(Boolean);
  if (!picked.length) return [];
  await db.lessonLearned.updateMany({ where: { id: { in: picked.map((p) => p.id) } }, data: { active: false } }).catch(() => {});
  return picked.map((p) => p.whatWasWrong);
}

/**
 * เจ้าของแก้ร่างข้อความที่ Vex เขียนให้ ก่อนส่ง = สไตล์ยังไม่ตรง — เก็บ diff ไว้เรียน
 * (สเปกเจ้าของ: "แก้ข้อความที่ Vex ร่างให้ก่อนส่ง = สไตล์ยังไม่ตรง เก็บ diff ไว้เรียน")
 */
export async function recordStyleLesson(original: string, edited: string, audience: string): Promise<void> {
  if (!(await enabled())) return;
  const a = original.trim();
  const b = edited.trim();
  if (!a || !b || a === b) return;
  const j = await askGeminiJson<{ different?: boolean; lesson?: string }>(
    `เลขาร่างข้อความให้เจ้าของ แล้วเจ้าของแก้เองก่อนส่ง เทียบสองเวอร์ชันแล้วสรุป "บทเรียนเรื่องสไตล์" 1 ประโยค
ตอบ JSON: {"different":true/false,"lesson":"ครั้งหน้าเวลาร่างให้<ใคร> ควร<ปรับยังไง>"}
different=false เมื่อแก้แค่ตัวสะกด/เว้นวรรคเล็กน้อย ไม่ใช่สไตล์`,
    `ร่างของเลขา: """${a.slice(0, 600)}"""\nที่เจ้าของแก้เป็น: """${b.slice(0, 600)}"""\nผู้รับ: ${audience}`,
    20_000,
  ).catch(() => null);
  if (!j?.different || !j.lesson?.trim()) return;
  await recordLesson({
    trigger: `ร่างข้อความให้ส่งหา${audience}`,
    whatIDid: `ร่างว่า "${a.slice(0, 120)}"`,
    whatWasWrong: `สไตล์ไม่ตรง เจ้าของต้องแก้เองเป็น "${b.slice(0, 120)}"`,
    correction: j.lesson.trim(),
    evidence: `แก้ร่างจาก "${a.slice(0, 150)}" เป็น "${b.slice(0, 150)}"`,
    severity: "เบา",
    scope: "เรื่อง:ร่างข้อความ",
  });
}

/** ตัวเลขพลาดซ้ำในช่วงเวลา — เฟส 6/7 ใช้รายงานเทรนด์ (ทุกการอ้างว่าดีขึ้นต้องมีตัวเลข) */
export async function repeatStats(sinceMs: number): Promise<{ newLessons: number; repeats: number }> {
  const since = new Date(sinceMs);
  const [newLessons, repeated] = await Promise.all([
    db.lessonLearned.count({ where: { createdAt: { gte: since } } }).catch(() => 0),
    db.lessonLearned.findMany({ where: { lastRepeatAt: { gte: since } }, select: { timesRepeated: true } }).catch(() => []),
  ]);
  return { newLessons, repeats: repeated.length };
}
