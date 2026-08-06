import { addTask, tasksBlock, findTasks, completeTasks } from "@/lib/kiki-tasks";
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

    // ===== เข้าใจ "สิ่งที่จะทำ" ก่อนจด (6 ส.ค. 2026) =====
    // เจ้าของ reply ภาพแผนงานแล้วพิมพ์ว่า "โน้ตไว้หน่อย ทำต่อว่าง"
    // → ได้งานชื่อ "ทำต่อว่าง" ซึ่งเปิดมาอ่านอีกทีก็ไม่รู้ว่าคืออะไร
    // ชื่อสั้น/กำกวม หรือมีบริบทจากข้อความที่ reply ถึง = ต้องเรียบเรียงให้อ่านแล้วเข้าใจในตัว
    const vague = title.trim().length < 18 || !/[ก-๙a-z]{3,}\s+[ก-๙a-z]/i.test(title.trim());
    if (vague || ctx.replyText || ctx.replyIsScreenshot) {
      const { askGeminiJson, kikiConversation } = await import("@/lib/kiki");
      const convo = await kikiConversation(6).catch(() => "");
      const j = await askGeminiJson<{ title?: string; detail?: string }>(
        `เจ้าของสั่งให้จดงาน แต่พูดสั้น ๆ ตามบริบทที่เขากับเลขาคุยกันอยู่
เขียน "ชื่องาน" ให้อ่านแล้วเข้าใจในตัวโดยไม่ต้องดูบริบท และสรุปบริบทที่จำเป็นลง detail
ตอบ JSON เท่านั้น: {"title":"ชื่องานที่ชัดเจน ไม่เกิน 90 ตัวอักษร","detail":"บริบท/สิ่งที่ต้องทำจริง ๆ สั้น ๆ (ไม่มีก็เว้นว่าง)"}
ห้ามแต่งงานใหม่ที่เขาไม่ได้สั่ง ห้ามเปลี่ยนตัวเลข/ชื่อ/วันที่`,
        [
          convo,
          ctx.replyText ? `ข้อความที่เจ้าของ reply ถึง:\n"""${ctx.replyText.slice(0, 1500)}"""` : "",
          ctx.replyIsScreenshot ? "(เขา reply ภาพหน้าจอที่เลขาแคปมาให้ — บริบทอยู่ในเรื่องที่คุยกันด้านบน)" : "",
          `คำสั่งล่าสุด: """${text.slice(0, 500)}"""`,
        ].filter(Boolean).join("\n\n"),
        20_000,
      ).catch(() => null);
      if (j?.title && j.title.trim().length >= 4) {
        title = j.title.trim().slice(0, 200);
        if (j.detail?.trim()) detail = j.detail.trim().slice(0, 600);
      }
    }
    const dueRaw = arg("due");
    const t = await addTask({
      title,
      detail: detail || undefined,
      kind: (["todo", "idea", "waiting"].includes(arg("kind")) ? arg("kind") : "todo") as "todo" | "idea" | "waiting",
      priority: (["low", "normal", "high"].includes(arg("priority")) ? arg("priority") : "normal") as "low" | "normal" | "high",
      dueDate: dueRaw && /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? new Date(`${dueRaw}T09:00:00+07:00`) : null,
      triggerText: arg("trigger") || null,
      source: text,
      chatId,
    });
    const bits = [
      t.kind === "idea" ? "เก็บไว้พัฒนา" : t.kind === "waiting" ? "รออยู่" : "ต้องทำ",
      t.priority === "high" ? "สำคัญ" : "",
      t.dueDate ? `กำหนด ${t.dueDate.toLocaleDateString("th-TH-u-ca-gregory", { day: "numeric", month: "short" })}` : "",
      t.triggerText ? `จะเตือนตอนโด้พูดถึง "${t.triggerText}"` : "จะตามเตือนจนกว่าจะปิด",
    ].filter(Boolean);
    const block = vexList({ title: "จดลงกระดานงานแล้ว", items: [{ main: t.title, sub: bits.join(" · ") }] });
    return reply([{ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId }]);
  }
  if (is("task_list")) {
    const block = await tasksBlock();
    return reply([{ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId }]);
  }
  if (is("task_done")) {
    const found = await findTasks(arg("ref") || text);
    if (!found.length) {
      const block = await tasksBlock({ title: "ไม่แน่ใจว่างานไหนครับ — งานที่ค้างอยู่" });
      return reply([{ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId }]);
    }
    const closed = await completeTasks(found.map((f) => f.id));
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
