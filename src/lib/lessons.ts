import { db } from "./db";

// บทเรียนของวาน — สิ่งที่เจ้าของสอน หรือวานสรุปเองจากงาน แล้วเอามาใช้ตอบครั้งต่อไป (เก่งขึ้น/ไม่ผิดซ้ำ)
export interface LessonInput {
  content: string;
  category?: string;
  source?: "owner" | "self";
}

export async function addLesson(input: LessonInput) {
  const content = String(input?.content || "").replace(/\s+/g, " ").trim();
  if (!content) return null;
  return db.lesson
    .create({
      data: {
        content: content.slice(0, 1000),
        category: (input.category || "general").slice(0, 40),
        source: input.source === "self" ? "self" : "owner",
      },
    })
    .catch(() => null);
}

export async function listLessons(activeOnly = true) {
  return db.lesson
    .findMany({ where: activeOnly ? { active: true } : {}, orderBy: { createdAt: "desc" }, take: 100 })
    .catch(() => []);
}

// ปิดใช้บทเรียนที่ตรงข้อความ (ไม่ลบทิ้ง เก็บประวัติไว้) — คืนจำนวนที่ปิด
export async function deactivateLessons(match: string): Promise<number> {
  const m = String(match || "").trim();
  if (!m) return 0;
  const rows = await listLessons(true);
  const hit = rows.filter((r) => r.content.includes(m));
  for (const r of hit) await db.lesson.update({ where: { id: r.id }, data: { active: false } }).catch(() => {});
  return hit.length;
}

// ข้อความบทเรียนที่ active — ฉีดเข้า system prompt (ทำตามเสมอ)
export async function getLessonsContext(): Promise<string> {
  const rows = await listLessons(true);
  if (!rows.length) return "";
  return rows
    .slice(0, 60)
    .map((r, i) => `${i + 1}. ${r.content}`)
    .join("\n")
    .slice(0, 5000);
}
