import { db } from "./db";
import { getSetting, setSetting } from "./kiki";
import { vexList, agoText, type VexBlock } from "./kiki-format";

/**
 * กระดานงานส่วนตัวของเจ้าของ (เจ้าของอธิบายเอง 4 ส.ค. 2026):
 *  - "ลงนัด/ลงคิว" + มีเวลาชัด        → CalendarEvent (ของเดิม) เตือนตามเวลา
 *  - "จดลิสต์ / โน้ตไว้ / เดี๋ยวทำ / เก็บไว้พัฒนา" → ที่นี่ + ตามเตือนจนกว่าจะปิด
 *  - "จำไว้หน่อย"                     → OwnerFact (จำเฉย ๆ ไม่กวน)
 *  - "ถ้า X แล้วบอกผมด้วย"            → ที่นี่ พร้อม triggerText (เตือนตอนเจ้าของพูดถึง X)
 */

export type TaskKind = "todo" | "idea" | "waiting";

export interface TaskInput {
  title: string;
  detail?: string;
  kind?: TaskKind;
  priority?: "low" | "normal" | "high";
  dueDate?: Date | null;
  triggerText?: string | null;
  remind?: boolean;
  source?: string;
  chatId?: string;
}

const KIND_LABEL: Record<string, string> = { todo: "ต้องทำ", idea: "เก็บไว้พัฒนา", waiting: "รออยู่" };
const LIST_KEY = "kiki_last_task_list"; // เก็บลำดับที่โชว์ล่าสุด ไว้ให้เจ้าของอ้าง "ปิดข้อ 2"

export async function addTask(input: TaskInput) {
  const title = input.title.trim().slice(0, 300);
  if (!title) throw new Error("ไม่มีชื่องาน");
  // กันซ้ำ: งานเปิดอยู่ชื่อเหมือนกันเป๊ะ = อัปเดตของเดิม
  const dup = await db.kikiTask.findFirst({ where: { status: "open", title } });
  if (dup) {
    return db.kikiTask.update({
      where: { id: dup.id },
      data: {
        detail: input.detail ?? dup.detail,
        priority: input.priority ?? dup.priority,
        dueDate: input.dueDate ?? dup.dueDate,
        triggerText: input.triggerText ?? dup.triggerText,
      },
    });
  }
  return db.kikiTask.create({
    data: {
      title,
      detail: input.detail?.slice(0, 2000) || null,
      kind: input.kind || "todo",
      priority: input.priority || "normal",
      dueDate: input.dueDate || null,
      triggerText: input.triggerText?.slice(0, 200) || null,
      remind: input.remind !== false,
      source: input.source?.slice(0, 500) || null,
      chatId: input.chatId || null,
    },
  });
}

export async function openTasks(kind?: TaskKind) {
  return db.kikiTask.findMany({
    where: { status: "open", ...(kind ? { kind } : {}) },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 60,
  });
}

/** ลิสต์งานแบบอ่านง่าย + จำลำดับไว้ให้อ้างเลขได้ */
export async function tasksBlock(opts: { kind?: TaskKind; title?: string } = {}): Promise<VexBlock> {
  const rows = await openTasks(opts.kind);
  await setSetting(LIST_KEY, JSON.stringify(rows.map((r) => r.id)));
  const now = Date.now();
  return vexList({
    title: opts.title || `งานค้างอยู่ (${rows.length})`,
    numbered: true,
    items: rows.map((r) => {
      const bits: string[] = [];
      if (r.kind !== "todo") bits.push(KIND_LABEL[r.kind] || r.kind);
      if (r.priority === "high") bits.push("สำคัญ");
      if (r.dueDate) {
        const d = Math.ceil((r.dueDate.getTime() - now) / 86400_000);
        bits.push(d < 0 ? `เลยกำหนด ${Math.abs(d)} วัน` : d === 0 ? "กำหนดวันนี้" : `อีก ${d} วัน`);
      }
      if (r.triggerText) bits.push(`เตือนเมื่อ: ${r.triggerText}`);
      bits.push(`จดไว้${agoText(r.createdAt)}`);
      if (r.detail) bits.push(r.detail.slice(0, 120));
      return { main: r.title, sub: bits.join(" · ") };
    }),
    empty: "กระดานโล่ง ไม่มีงานค้าง",
    note: rows.length ? 'ปิดงานพิมพ์ได้เลย เช่น "เสร็จข้อ 2" หรือ "ปิดงานทำสไลด์"' : undefined,
  });
}

/** หางานจากคำพูด: เลขลำดับจากลิสต์ล่าสุด หรือคำในชื่อ/รายละเอียด */
export async function findTasks(ref: string) {
  const r = (ref || "").trim();
  if (!r) return [];
  const nums = [...r.matchAll(/\b(\d{1,2})\b/g)].map((m) => Number(m[1]));
  if (nums.length) {
    try {
      const ids = JSON.parse((await getSetting(LIST_KEY)) || "[]") as string[];
      const picked = nums.map((n) => ids[n - 1]).filter(Boolean);
      if (picked.length) {
        const rows = await db.kikiTask.findMany({ where: { id: { in: picked }, status: "open" } });
        if (rows.length) return rows;
      }
    } catch { /* ไม่มีลิสต์ล่าสุด → ไปทางคำ */ }
  }
  const rows = await openTasks();
  const words = r
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !/^(เสร็จ|ปิด|งาน|แล้ว|ข้อ|ที่|ทำ|ลบ|เอา|ออก|ครับ|หน่อย)$/.test(w));
  if (!words.length) return [];
  const scored = rows
    .map((t) => {
      const hay = `${t.title} ${t.detail || ""}`.toLowerCase();
      let score = 0;
      for (const w of words) if (hay.includes(w)) score += w.length >= 4 ? 3 : 1;
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((x) => x.t);
}

export async function completeTasks(ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.kikiTask.findMany({ where: { id: { in: ids } } });
  await db.kikiTask.updateMany({ where: { id: { in: ids } }, data: { status: "done", doneAt: new Date() } });
  return rows;
}

export async function dropTasks(ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.kikiTask.findMany({ where: { id: { in: ids } } });
  await db.kikiTask.updateMany({ where: { id: { in: ids } }, data: { status: "dropped", doneAt: new Date() } });
  return rows;
}

/**
 * งานที่ผูกเงื่อนไข: เจ้าของพูดถึงคำนั้นเมื่อไหร่ = ถึงเวลาเตือน
 * เช่น "ถ้าผมถึง BNI แล้ว อย่าลืมบอกผมแจ้ง HR" → triggerText = "ถึง BNI"
 */
export async function matchTriggers(text: string) {
  const t = (text || "").toLowerCase();
  if (t.length < 3) return [];
  const rows = await db.kikiTask.findMany({ where: { status: "open", NOT: { triggerText: null } }, take: 40 });
  const hits = rows.filter((r) => {
    const words = (r.triggerText || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !/^(ถ้า|แล้ว|เมื่อ|ตอน|ให้|ผม|กู|ไป|ถึง|มา)$/.test(w));
    if (!words.length) return false;
    const need = Math.min(words.length, 2); // อย่างน้อย 2 คำสำคัญต้องโผล่ (กันเตือนมั่ว)
    return words.filter((w) => t.includes(w)).length >= need;
  });
  return hits;
}

/** งานที่ควรทวงวันนี้ (บรีฟเช้า/ตอนเย็น) — ทวงงานละไม่เกินวันละครั้ง */
export async function tasksToNag(now = new Date()) {
  const rows = await db.kikiTask.findMany({ where: { status: "open", remind: true }, orderBy: { createdAt: "asc" }, take: 40 });
  const dayAgo = now.getTime() - 20 * 3600_000;
  return rows.filter((r) => {
    if (r.lastNaggedAt && r.lastNaggedAt.getTime() > dayAgo) return false;
    const overdue = r.dueDate ? r.dueDate.getTime() <= now.getTime() + 86400_000 : false;
    const stale = now.getTime() - r.createdAt.getTime() > 20 * 3600_000;
    return overdue || stale || r.priority === "high";
  });
}

export async function markNagged(ids: string[]) {
  if (!ids.length) return;
  await db.kikiTask.updateMany({ where: { id: { in: ids } }, data: { lastNaggedAt: new Date(), nagCount: { increment: 1 } } });
}

/** บริบทสั้น ๆ ให้สมอง Vex รู้ว่ามีงานอะไรค้างอยู่ (ใช้ตอบ/เชื่อมโยงเองได้) */
export async function tasksContext(): Promise<string> {
  const rows = await openTasks();
  if (!rows.length) return "";
  const lines = rows.slice(0, 25).map((r, i) => {
    const bits = [KIND_LABEL[r.kind] || r.kind];
    if (r.priority === "high") bits.push("สำคัญ");
    if (r.dueDate) bits.push(`กำหนด ${r.dueDate.toLocaleDateString("th-TH-u-ca-gregory", { day: "numeric", month: "short" })}`);
    if (r.triggerText) bits.push(`เตือนเมื่อ ${r.triggerText}`);
    return `${i + 1}. ${r.title} (${bits.join(" · ")} · จด${agoText(r.createdAt)})`;
  });
  return `=== กระดานงานที่ยังค้าง (${rows.length} งาน — เจ้าของสั่งให้จำและตามเตือน) ===\n${lines.join("\n")}`;
}
