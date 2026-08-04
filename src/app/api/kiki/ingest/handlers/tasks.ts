import { addTask, tasksBlock, findTasks, completeTasks } from "@/lib/kiki-tasks";
import { recallContext, recentDaysContext } from "@/lib/kiki-memory";
import { vexList } from "@/lib/kiki-format";
import { askKiki } from "@/lib/kiki";
import type { Ctx, Handler } from "../types";

export const tasksHandler: Handler = async (ctx) => {
  const { chatId, text, msgId, is, arg, reply } = ctx;
  // ===== กระดานงาน: จด / ดู / ปิด (เจ้าของสั่ง 4 ส.ค.) =====
  if (is("task_add")) {
    const title = arg("title") || text.replace(/^(ช่วย)?(จด|โน้ต|ลิสต์|บันทึก)(ไว้)?(ว่า|ให้)?\s*/i, "").slice(0, 200);
    const dueRaw = arg("due");
    const t = await addTask({
      title,
      detail: arg("detail") || undefined,
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
      t.triggerText ? `จะเตือนตอนพี่พูดถึง "${t.triggerText}"` : "จะตามเตือนจนกว่าจะปิด",
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
    return reply([{ kind: "text", text: answer.slice(0, 3900), replyTo: msgId }]);
  }

  return null;
};
