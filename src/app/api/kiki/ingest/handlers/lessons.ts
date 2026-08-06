import { askKiki, vexLine } from "@/lib/kiki";
import { listLessons, deactivateLessons } from "@/lib/kiki-lessons";
import { vexList } from "@/lib/kiki-format";
import type { Handler } from "../types";

/**
 * เจ้าของขอดู "บทเรียนที่เคยโดนด่า/ตำหนิ" (จิตใจเฟส 1 — 6 ส.ค. 2026)
 * สเปกเจ้าของ: ต้องดูได้พร้อมหลักฐานข้อความจริง และลบได้
 */
export const lessonsListHandler: Handler = async (ctx) => {
  const { msgId, is, reply } = ctx;
  if (!is("lessons_list")) return null;

  const lessons = await listLessons();
  if (!lessons.length) {
    return reply([{ kind: "text", text: await vexLine("ยังไม่มีบทเรียนที่จำไว้เลยครับ — แปลว่ายังไม่เคยโดนโด้ตำหนิแบบที่ระบบจับได้ หรือเพิ่งเริ่มเก็บ"), replyTo: msgId }]);
  }

  const block = vexList({
    title: `บทเรียนที่ผมจำไว้ (${lessons.length} ข้อ)`,
    numbered: true,
    items: lessons.map((l) => ({
      main: `${l.severity === "หนัก" ? "‼️ " : ""}${l.whatWasWrong} → ต้อง${l.correction}${l.timesRepeated ? ` (พลาดซ้ำ ${l.timesRepeated} ครั้ง)` : ""}`,
      sub: `หลักฐาน: "${l.evidence.slice(0, 120)}" · ${l.createdAt.toLocaleDateString("th-TH-u-ca-gregory", { day: "numeric", month: "short" })}`,
    })),
    note: 'ข้อไหนไม่อยากให้จำแล้ว สั่ง "ลบบทเรียนเรื่อง..." ได้เลยครับ',
  });

  const say = await askKiki(
    `[เจ้าของขอดูบทเรียนที่เราเคยโดนตำหนิ] มีทั้งหมด ${lessons.length} ข้อ พลาดซ้ำรวม ${lessons.reduce((a, b) => a + b.timesRepeated, 0)} ครั้ง (การ์ดรายละเอียดส่งไปแล้ว)\n` +
      `ยอมรับตรง ๆ ไม่แก้ตัว · ถ้ามีข้อที่พลาดซ้ำ ให้พูดถึงมันก่อนเพราะนั่นคือเรื่องที่แย่ที่สุด · ไม่เกิน 2 บรรทัด`,
  ).catch(() => null);

  return reply([
    { kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId },
    ...(say ? [{ kind: "text" as const, text: say }] : []),
  ]);
};

/** ลบบทเรียนตามสั่ง — ปิด active (กู้คืนได้) ไม่ลบแถวจริง */
export const lessonDeleteHandler: Handler = async (ctx) => {
  const { text, msgId, is, reply } = ctx;
  if (!is("lesson_delete")) return null;

  const removed = await deactivateLessons(text);
  if (!removed.length) {
    return reply([{ kind: "text", text: await vexLine("หาบทเรียนที่ตรงกับที่โด้สั่งลบไม่เจอครับ ลองบอกใจความของข้อนั้นมาอีกที"), replyTo: msgId }]);
  }
  return reply([{
    kind: "text",
    text: await vexLine(`ลบบทเรียนให้แล้ว ${removed.length} ข้อ: ${removed.join(" · ")} — จะไม่เอามาปรับพฤติกรรมอีก`),
    replyTo: msgId,
  }]);
};
