import { askKiki, vexLine } from "@/lib/kiki";
import { vexSay } from "../shared";
import type { Ctx, Handler } from "../types";

export const introHandler: Handler = async (ctx) => {
  const { text, fromName, msgId, justBound, reply } = ctx;
  // ===== ทักครั้งแรก / แนะนำตัว =====
  if (justBound || /^\/(start|hi)\b/i.test(text) || /แนะนำตัว/.test(text)) {
    const t = await vexSay(
      `เพิ่งเข้าประจำการในแชทนี้${justBound ? ` (ผูกเจ้าของเรียบร้อย: ${fromName || "คนแรกที่ทัก"})` : ""} — แนะนำตัวสั้น ๆ ว่าเป็นเลขาส่วนตัว ดูแลได้ทั้งการเงิน (ส่งสลิปมาได้เลย) นัดหมาย เก็บลิงก์/ความรู้ และจำทุกอย่างที่เจ้าของบอก`,
      ["ชื่อ Vex", "ส่งสลิป+พิมพ์บอกว่าค่าอะไร = บันทึกให้ทันที", 'ตั้งงบ: "ตั้งงบเดือนละ 20000"', 'ให้จำอะไรพิมพ์ "จำไว้ว่า ..."'],
      `มาแล้วครับผม ⚡ ผม Vex เลขาส่วนตัว\n\nส่งสลิปมาได้เลย เดี๋ยวจดให้ · ลงนัดก็ได้ · ส่งลิงก์ให้เก็บก็ได้\nอยากให้จำอะไรพิมพ์ "จำไว้ว่า ..." ครับ`,
    );
    return reply([{ kind: "text", text: t, replyTo: msgId }]);
  }

  return null;
};

export const docFilesHandler: Handler = async (ctx) => {
  const { text, docFiles, msgId, reply } = ctx;
  // ===== ไฟล์เอกสาร (pdf/docx/txt/md) → สรุปเก็บเข้าคลังความรู้ (เจ้าของสั่ง 3 ส.ค.) =====
  if (docFiles.length) {
    // เจ้าของสั่ง 4 ส.ค.: "เก็บเฉพาะที่ผมบอกให้เก็บ" → ไม่สั่ง = อ่านให้ ตอบให้ แต่ไม่เขียนลงคลัง
    const wantSave = /เก็บ|บันทึก|เซฟ|save|เข้าคลัง|ลงคลัง|จำไว้/i.test(text);
    const { readDocDeep } = await import("@/lib/kiki-read");
    const reads: { name: string; summary: string }[] = [];
    const saved: string[] = [];
    const fails: string[] = [];
    for (const d of docFiles) {
      try {
        if (wantSave) {
          const { saveDocToPersonal } = await import("@/lib/kiki");
          const r = await saveDocToPersonal(d.path, d.name, text || undefined);
          saved.push(r.title);
          reads.push({ name: d.name, summary: r.summary });
        } else {
          const r = await readDocDeep(d.path, d.name, text || undefined);
          reads.push({ name: d.name, summary: r.summary });
        }
      } catch (e) {
        fails.push(`${d.name}: ${e instanceof Error ? e.message.slice(0, 100) : "อ่านไม่ได้"}`);
      }
    }
    if (!reads.length) {
      return reply([{ kind: "text", text: await vexLine(`อ่านไฟล์ไม่ได้ครับ ⚠️ ${fails.join(" · ")}`), replyTo: msgId }]);
    }
    const answer = await askKiki(
      text || "(เจ้าของส่งไฟล์มาโดยไม่ได้พิมพ์อะไร)",
      [
        `=== เนื้อหาไฟล์ที่เพิ่งอ่านให้ (อ่านครบทั้งไฟล์แล้ว ใช้ตอบได้เลย) ===\n${reads.map((r) => `### ${r.name}\n${r.summary.slice(0, 12_000)}`).join("\n\n")}`,
        saved.length ? `[ระบบเก็บเข้าคลังความรู้ให้แล้ว: ${saved.join(" · ")} — ยืนยันสั้น ๆ ได้]` : "[ยังไม่ได้เก็บเข้าคลัง เพราะเจ้าของไม่ได้สั่ง — ถ้าเนื้อหาน่าเก็บ ให้เสนอสั้น ๆ ว่าสั่งเก็บได้]",
        fails.length ? `[ไฟล์ที่อ่านไม่ได้: ${fails.join(" · ")}]` : "",
        "[ตอบตามที่เจ้าของถาม ถ้าไม่ได้ถามอะไร ให้สรุปสาระสำคัญของไฟล์แบบใช้งานได้จริง]",
      ].filter(Boolean).join("\n\n"),
    );
    return reply([{ kind: "text", text: answer, replyTo: msgId }]);
  }

  return null;
};
