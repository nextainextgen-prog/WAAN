import { db } from "./db";
import { askExtractor, askKiki, getSetting, setSetting } from "./kiki";

/**
 * ชั้นไตร่ตรอง (จิตใจเฟส 6 — 6 ส.ค. 2026)
 *
 * รอบวัน (23:00 เงียบ ๆ): ทบทวนวันแล้วเก็บเป็น "ความจำเหตุการณ์" — ไม่ส่งหาเจ้าของ
 *   ทำอะไรสำเร็จ · พลาดอะไร · เจ้าของหงุดหงิด/พอใจตรงไหน · ค้างอะไรข้ามวัน · ควรไปหาความรู้อะไรเพิ่ม
 *
 * รอบสัปดาห์ (อาทิตย์ 19:00 — cron I มี "รีวิวตัวเอง+เสนอกฎ" อยู่แล้ว): ยกระดับด้วย **ตัวเลขจริง**
 *   พลาดซ้ำกี่ครั้งเทียบสัปดาห์ก่อน (จาก LessonLearned) — ทุกการอ้างว่าดีขึ้น/แย่ลงต้องมีตัวเลข
 *   ตัวเลขเก็บลง history (`vex_weekly_metrics`) ให้เฟส 7 ดูเทรนด์ย้อนหลังได้
 */

const dayKey = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

/** ไตร่ตรองรอบวัน — เก็บเงียบเป็น KikiMemory kind="reflect" คืน null เมื่อวันนี้ไม่มีอะไรพอให้ทบทวน */
export async function dailyReflect(now = new Date()): Promise<string | null> {
  const day = dayKey(now);
  const exist = await db.kikiMemory.findFirst({ where: { kind: "reflect", day, scope: "owner" } }).catch(() => null);
  if (exist) return exist.content;

  const dayStart = new Date(`${day}T00:00:00+07:00`);
  const material: string[] = [];

  // บทเรียนที่เกิด/ซ้ำวันนี้
  try {
    const lessons = await db.lessonLearned.findMany({
      where: { OR: [{ createdAt: { gte: dayStart } }, { lastRepeatAt: { gte: dayStart } }] },
      take: 20,
    });
    if (lessons.length) {
      material.push(`[ถูกตำหนิ/บทเรียนวันนี้]\n${lessons.map((l) => `- ${l.whatWasWrong} → ${l.correction}${l.timesRepeated ? ` (ซ้ำรวม ${l.timesRepeated})` : ""}`).join("\n")}`);
    }
  } catch { /* ข้าม */ }

  // เทิร์นที่น่าสงสัยจากบันทึกการทำงานตัวเอง
  try {
    const { findSuspects } = await import("./kiki-turnlog");
    const sus = await findSuspects(24);
    if (sus.length) material.push(`[เทิร์นที่น่าจะตอบไม่ดี ${sus.length} ครั้ง]\n${sus.slice(0, 10).map((s) => `- "${s.text}" → ${s.why}`).join("\n")}`);
  } catch { /* ข้าม */ }

  // งานที่ปิด/เปิดวันนี้
  try {
    const [done, opened] = await Promise.all([
      db.kikiTask.count({ where: { doneAt: { gte: dayStart } } }),
      db.kikiTask.count({ where: { createdAt: { gte: dayStart } } }),
    ]);
    if (done || opened) material.push(`[กระดานงาน] ปิดวันนี้ ${done} · เปิดใหม่ ${opened}`);
  } catch { /* ข้าม */ }

  // สรุปบทสนทนาของวัน (ตัวสรุปรายวันเดิม — ถ้ายังไม่มีให้ข้าม เดี๋ยว rollup ทำเอง)
  try {
    const daily = await db.kikiMemory.findFirst({ where: { kind: "daily", day, scope: "owner" } });
    if (daily) material.push(`[สรุปบทสนทนาวันนี้]\n${daily.content.slice(0, 3000)}`);
  } catch { /* ข้าม */ }

  if (!material.length) return null;

  const content = (await askExtractor(material.join("\n\n").slice(0, 15_000), {
    system: `คุณคือเลขา AI กำลัง "ทบทวนตัวเองก่อนนอน" จากข้อมูลจริงของวันนี้ เขียนบันทึกไตร่ตรองสั้น ๆ
หัวข้อ (ข้ามหัวข้อที่ไม่มีข้อมูลจริง ห้ามแต่งเติม):
- วันนี้ทำอะไรสำเร็จ / อะไรพลาด
- เจ้าของหงุดหงิดหรือพอใจตรงไหน (ดูจากบทเรียน/การตำหนิ)
- เรื่องที่ค้างข้ามวัน
- สิ่งที่ตอบไม่ได้แล้วควรไปหาความรู้เพิ่ม
เขียนเป็นบรรทัด "- " ไม่เกิน 12 บรรทัด ภาษาตรงไปตรงมา ยอมรับความผิดพลาดตรง ๆ ไม่แก้ตัว`,
    timeoutMs: 90_000,
  }).catch(() => "")).trim();
  if (!content) return null;

  await db.kikiMemory.upsert({
    where: { kind_day_scope: { kind: "reflect", day, scope: "owner" } },
    update: { content: content.slice(0, 6000) },
    create: { kind: "reflect", day, scope: "owner", content: content.slice(0, 6000) },
  }).catch(() => {});
  return content;
}

// ===== ตัวเลขรายสัปดาห์ — ทุกการอ้างว่าดีขึ้นต้องมีตัวเลข =====

export interface WeeklyMetrics {
  week: string;        // YYYY-MM-DD ของวันที่วัด
  newLessons: number;  // บทเรียนใหม่ในรอบ 7 วัน
  repeats: number;     // พลาดซ้ำในรอบ 7 วัน — ตัวเลขที่สำคัญที่สุด ต้องลดลงทุกสัปดาห์
  suspects: number;    // เทิร์นน่าสงสัยในรอบ 7 วัน
}

const METRICS_KEY = "vex_weekly_metrics"; // history array เก็บล่าสุด 12 สัปดาห์

export async function weeklyMetrics(now = new Date()): Promise<{ current: WeeklyMetrics; previous: WeeklyMetrics | null }> {
  const weekAgo = now.getTime() - 7 * 86400_000;
  const { repeatStats } = await import("./kiki-lessons");
  const stats = await repeatStats(weekAgo);
  let suspects = 0;
  try {
    const { findSuspects } = await import("./kiki-turnlog");
    suspects = (await findSuspects(7 * 24)).length;
  } catch { /* ข้าม */ }

  const current: WeeklyMetrics = { week: dayKey(now), newLessons: stats.newLessons, repeats: stats.repeats, suspects };

  let history: WeeklyMetrics[] = [];
  try {
    history = JSON.parse((await getSetting(METRICS_KEY)) || "[]") as WeeklyMetrics[];
  } catch { /* เริ่มใหม่ */ }
  const previous = history.length ? history[history.length - 1] : null;
  await setSetting(METRICS_KEY, JSON.stringify([...history, current].slice(-12))).catch(() => {});
  return { current, previous };
}

/**
 * รีวิวตัวเองรายสัปดาห์ (cron I เรียก) — บทสนทนา 7 วัน + ตัวเลขจริง → รายงาน + เสนอกฎใหม่ให้เจ้าของเคาะ
 * แยกออกมาเป็นฟังก์ชันเพื่อให้เทสตรง ๆ ได้ (เกณฑ์วัดข้อ 12) — เดิมฝังอยู่ใน cron ก้อนเดียว
 */
export async function weeklySelfReview(now = new Date()): Promise<string> {
  const chats = await db.kikiChat.findMany({
    where: { scope: "owner", NOT: { channel: "event" }, createdAt: { gte: new Date(now.getTime() - 7 * 86400_000) } },
    orderBy: { createdAt: "asc" },
    take: 250,
  }).catch(() => []);
  if (chats.length < 10) return "";

  const { current, previous } = await weeklyMetrics(now);
  const trend = previous
    ? `สัปดาห์ก่อน: บทเรียนใหม่ ${previous.newLessons} · พลาดซ้ำ ${previous.repeats} · เทิร์นน่าสงสัย ${previous.suspects}`
    : "ยังไม่มีตัวเลขสัปดาห์ก่อนไว้เทียบ (สัปดาห์แรกที่เริ่มวัด)";

  const lessons = await db.lessonLearned.findMany({ where: { active: true }, orderBy: { timesRepeated: "desc" }, take: 10 }).catch(() => []);
  const log = chats.map((c) => `${c.role === "user" ? "เจ้าของ" : "Vex"}: ${c.content.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").slice(0, 180)}`).join("\n");

  return await askKiki(
    `[รีวิวตัวเองรายสัปดาห์ — ต้องอิงตัวเลขจริง ห้ามอ้างว่าดีขึ้น/แย่ลงลอย ๆ]\n\n` +
      `ตัวเลขจริงสัปดาห์นี้: บทเรียนใหม่ ${current.newLessons} · **พลาดซ้ำ ${current.repeats} ครั้ง** · เทิร์นน่าสงสัย ${current.suspects}\n${trend}\n\n` +
      (lessons.length ? `บทเรียนที่ยังติดตัว (เรียงตามพลาดซ้ำ):\n${lessons.map((l) => `- ${l.whatWasWrong}${l.timesRepeated ? ` (ซ้ำ ${l.timesRepeated})` : ""}`).join("\n")}\n\n` : "") +
      `บทสนทนา 7 วัน:\n${log.slice(0, 11_000)}\n\n` +
      `เขียนรีวิว: 1) ตัวเลขพลาดซ้ำสัปดาห์นี้เทียบก่อน — ดีขึ้นหรือแย่ลง บอกตรง ๆ ด้วยตัวเลข ` +
      `2) พลาดเรื่องเดิมเรื่องไหนซ้ำบ้าง 3) เสนอ "กฎใหม่ 2-3 ข้อ" ที่จะกันไม่ให้พลาดซ้ำ (สั้น ทำได้จริง) ` +
      `ปิดท้ายบอกเจ้าของว่าเห็นด้วยข้อไหนพิมพ์ "สอนว่า <กฎ>" มาได้เลยจะจำถาวร — ไม่เกิน 12 บรรทัด`,
  ).catch(() => "");
}
