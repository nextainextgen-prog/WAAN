import { addTask, tasksBlock, findTasks, completeTasks , reorganizeBoard } from "@/lib/kiki-tasks";
import { recallContext, recentDaysContext } from "@/lib/kiki-memory";
import { vexList } from "@/lib/kiki-format";
import { askKiki } from "@/lib/kiki";
import type { Ctx, Handler } from "../types";

export const tasksHandler: Handler = async (ctx) => {
  const { chatId, text, msgId, is, arg, reply } = ctx;
  // ===== กระดานงาน: จด / ดู / ปิด (เจ้าของสั่ง 4 ส.ค.) =====
  if (is("task_add")) {
    let title = arg("title") || text.replace(/^(ช่วย)?(จด|โน้ต|ลิสต์|บันทึก)(ไว้)?(ว่า|ให้)?\s*/i, "").slice(0, 200);
    let detail = arg("detail") || "";

    // ===== เข้าใจ "สิ่งที่จะทำ" ก่อนจด + รองรับหลายงานในข้อความเดียว (7 ส.ค. 2026) =====
    // เคยพัง 2 แบบ: ชื่อกำกวม ("ทำต่อว่าง") และเจ้าของส่งลิสต์ 3 งานมาทีเดียว
    // แล้วระบบจดได้อันเดียว + การ์ดแยกกระจัดกระจาย (ตามเก็บมาจดเพิ่มทีละใบ)
    let items: { title: string; detail?: string }[] = [];
    const vague = title.trim().length < 18 || !/[ก-๙a-z]{3,}\s+[ก-๙a-z]/i.test(title.trim());
    const multi = /\n/.test(text.trim()) || /\d\s*[.)]/.test(text);
    if (vague || multi || ctx.replyText || ctx.replyIsScreenshot) {
      const { askGeminiJson, kikiConversation } = await import("@/lib/kiki");
      const convo = await kikiConversation(6).catch(() => "");
      const j = await askGeminiJson<{ tasks?: { title?: string; detail?: string }[] }>(
        `เจ้าของสั่งให้จดงานเข้ากระดาน — อาจมีงานเดียวหรือหลายงานในข้อความเดียว
เขียน "ชื่องาน" แต่ละอันให้อ่านแล้วเข้าใจในตัวโดยไม่ต้องดูบริบท และสรุปบริบทที่จำเป็นลง detail
ตอบ JSON เท่านั้น: {"tasks":[{"title":"ชื่องานชัดเจน ไม่เกิน 90 ตัวอักษร","detail":"บริบทสั้น ๆ (ไม่มีก็เว้นว่าง)"}]}
เก็บครบทุกงานที่เขาสั่ง ห้ามแต่งงานที่ไม่ได้สั่ง ห้ามเปลี่ยนตัวเลข/ชื่อ/วันที่`,
        [
          convo,
          ctx.replyText ? `ข้อความที่เจ้าของ reply ถึง:\n"""${ctx.replyText.slice(0, 1500)}"""` : "",
          ctx.replyIsScreenshot ? "(เขา reply ภาพหน้าจอที่เลขาแคปมาให้ — บริบทอยู่ในเรื่องที่คุยกันด้านบน)" : "",
          `คำสั่งล่าสุด: """${text.slice(0, 800)}"""`,
        ].filter(Boolean).join("\n\n"),
        25_000,
      ).catch(() => null);
      items = (j?.tasks || [])
        .map((t) => ({ title: (t.title || "").trim().slice(0, 200), detail: (t.detail || "").trim().slice(0, 600) || undefined }))
        .filter((t) => t.title.length >= 4);
    }
    if (!items.length) items = [{ title, detail: detail || undefined }];

    const dueRaw = arg("due");
    const saved: { main: string; sub: string }[] = [];
    for (const it of items) {
      const t = await addTask({
        title: it.title,
        detail: it.detail,
        kind: (["todo", "idea", "waiting"].includes(arg("kind")) ? arg("kind") : "todo") as "todo" | "idea" | "waiting",
        priority: (["low", "normal", "high"].includes(arg("priority")) ? arg("priority") : "normal") as "low" | "normal" | "high",
        dueDate: items.length === 1 && dueRaw && /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? new Date(`${dueRaw}T09:00:00+07:00`) : null,
        triggerText: items.length === 1 ? arg("trigger") || null : null,
        source: text,
        chatId,
      }).catch(() => null);
      if (!t) continue;
      const bits = [
        t.kind === "idea" ? "เก็บไว้พัฒนา" : t.kind === "waiting" ? "รออยู่" : "ต้องทำ",
        t.priority === "high" ? "สำคัญ" : "",
        t.dueDate ? `กำหนด ${t.dueDate.toLocaleDateString("th-TH-u-ca-gregory", { day: "numeric", month: "short" })}` : "",
        t.triggerText ? `จะเตือนตอนโด้พูดถึง "${t.triggerText}"` : "",
      ].filter(Boolean);
      saved.push({ main: t.title, sub: bits.join(" · ") || "จะตามเตือนจนกว่าจะปิด" });
    }
    if (!saved.length) {
      ctx.setEvidence("ระบบจดงานไม่สำเร็จเลยสักอัน — ห้ามบอกว่าจดแล้ว");
      const { vexLine } = await import("@/lib/kiki");
      return reply([{ kind: "text", text: await vexLine("จดไม่เข้ากระดานครับ ลองพิมพ์ชื่องานตรง ๆ อีกที"), replyTo: msgId }]);
    }
    // หลักฐานให้ด่านตรวจ — จดครบทุกอันแล้วในรอบเดียว ไม่ต้องตามเก็บมาจดซ้ำ
    ctx.setEvidence(`ระบบจดงานเข้ากระดานแล้วจริง ${saved.length}/${items.length} งาน: ${saved.map((x) => x.main).join(" · ")} — ครบทุกงานที่สั่ง เรื่องนี้จบแล้ว`);
    const block = vexList({ title: `จดลงกระดานงานแล้ว${saved.length > 1 ? ` ${saved.length} งาน` : ""}`, items: saved });
    return reply([{ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId }]);
  }
  if (is("task_reorg")) {
    // จัดกระดานทั้งชุด (7 ส.ค. 2026) — "มีแค่ X ที่เหลือตัดออก" = เก็บ X ตัดที่เหลือ (เคยตีกลับด้านจนพังคาตา)
    const r = await reorganizeBoard(text, ctx.replyText);
    if (!r) {
      const block = await tasksBlock({ title: "ยังไม่ได้แตะกระดานครับ — งานที่ค้างอยู่ตอนนี้" });
      ctx.setEvidence("ระบบยังไม่ได้แตะกระดานเลย (วางแผนไม่สำเร็จ) — ห้ามบอกว่าจัดแล้ว");
      return reply([{ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId }]);
    }
    const doneBits: string[] = [];
    if (r.dropped.length) doneBits.push(`ตัดออก ${r.dropped.length}: ${r.dropped.join(" · ")}`);
    if (r.closed.length) doneBits.push(`ปิดเสร็จ ${r.closed.length}: ${r.closed.join(" · ")}`);
    if (r.reopened.length) doneBits.push(`เปิดกลับ ${r.reopened.length}: ${r.reopened.join(" · ")}`);
    if (r.added.length) doneBits.push(`จดใหม่ ${r.added.length}: ${r.added.join(" · ")}`);
    ctx.setEvidence(`ระบบจัดกระดานแล้วจริงตามสั่ง — ${doneBits.join(" | ") || "ไม่มีอะไรต้องเปลี่ยน"} — เรื่องนี้จบแล้ว ไม่มีส่วนไหนค้าง`);
    const board = await tasksBlock({ title: "กระดานตอนนี้" });
    return reply([{ kind: "text", text: board.text, parseMode: board.parseMode, replyTo: msgId }]);
  }
  if (is("task_list")) {
    const block = await tasksBlock();
    return reply([{ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId }]);
  }
  if (is("task_done")) {
    const found = await findTasks(arg("ref") || text, ctx.replyText);
    if (!found.length) {
      const block = await tasksBlock({ title: "ไม่แน่ใจว่างานไหนครับ — งานที่ค้างอยู่" });
      ctx.setEvidence("ระบบหางานที่ว่าไม่เจอ ยังไม่ได้ปิดอะไรเลย");
      return reply([{ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId }]);
    }
    const closed = await completeTasks(found.map((f) => f.id));
    // หลักฐานให้ด่านตรวจ — ไม่งั้นรอบตามเก็บวิ่งมาปิดงานซ้ำอีกรอบ (เกิดจริงคาตาเจ้าของ 6 ส.ค.)
    ctx.setEvidence(`ระบบปิดงานแล้วจริง ${closed.length} งาน: ${closed.map((c) => c.title).join(" · ")} — เรื่องนี้จบแล้ว`);
    const left = await tasksBlock({ title: "ที่เหลือในกระดาน" });
    return reply([
      { kind: "text", text: vexList({ title: `ปิดงานแล้ว ${closed.length} งาน`, items: closed.map((c) => c.title) }).text, parseMode: "HTML", replyTo: msgId },
      { kind: "text", text: left.text, parseMode: left.parseMode },
    ]);
  }

  return null;
};

export const memoryRecallHandler: Handler = async (ctx) => {
  const { text, msgId, is, arg, reply } = ctx;
  // ===== ค้นความจำบทสนทนาเก่า ("จำได้ไหมที่คุยเรื่อง...") =====
  if (is("memory_recall")) {
    const q = arg("query") || text;
    const [hits, days] = await Promise.all([
      recallContext(q, { k: 8 }).catch(() => ""),
      recentDaysContext(4).catch(() => ""),
    ]);
    const answer = await askKiki(
      text,
      [
        hits || "(ค้นในคลังแชทแล้วไม่เจอเรื่องนี้)",
        days,
        "[โหมดนึกย้อน] ตอบจากบทสนทนาเก่าที่ค้นเจอเท่านั้น บอกด้วยว่าคุยกันวันไหน ถ้าไม่เจอจริง ๆ ให้บอกตรง ๆ ว่าหาไม่เจอ ห้ามเดา",
      ].filter(Boolean).join("\n\n"),
    );
    return reply([{ kind: "text", text: answer, replyTo: msgId }]);
  }

  return null;
};
