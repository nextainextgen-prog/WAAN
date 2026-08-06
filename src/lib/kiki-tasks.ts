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
  // กำหนดส่งที่อยู่ในอดีตเกิน 30 วัน = ตัวสกัดใส่ปีผิด (เคยได้ "เลยกำหนด 727 วัน" เพราะปี 2024)
  // งานที่เพิ่งจดไม่มีทางเลยกำหนดมาเป็นปี — เลื่อนปีจนเป็นอนาคตที่ใกล้ที่สุด
  if (input.dueDate && input.dueDate.getTime() < Date.now() - 30 * 86400_000) {
    const d = new Date(input.dueDate);
    while (d.getTime() < Date.now() - 86400_000) d.setFullYear(d.getFullYear() + 1);
    input = { ...input, dueDate: d };
  }
  // กันซ้ำ — เทียบแบบ "ใกล้เคียง" ไม่ใช่ตรงเป๊ะ
  // เจ้าของเจอเอง 6 ส.ค. 2026: กระดานมีทั้ง "แก้บั๊กระบบจองห้องประชุม" และ "แก้บัคระบบจองห้องประชุม"
  // เป็นคนละงาน ทั้งที่เป็นเรื่องเดียวกัน พิมพ์ต่างกันตัวเดียว
  const openRows = await db.kikiTask.findMany({ where: { status: "open" }, take: 60 });
  const key = (x: string) =>
    x.toLowerCase().replace(/[\s"'`ๆฯ.,!?()\-]/g, "").replace(/บั๊?[คก]/g, "บัค");
  const k = key(title);
  const dup =
    openRows.find((t) => key(t.title) === k) ||
    openRows.find((t) => {
      const o = key(t.title);
      const [a, b] = o.length > k.length ? [o, k] : [k, o];
      return b.length >= 8 && a.includes(b); // อีกอันเป็นส่วนหนึ่งของอีกอัน = เรื่องเดียวกัน
    });
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

/**
 * หางานจากคำพูด: เลขลำดับ หรือคำในชื่อ/รายละเอียด
 * เลขอ้างอิงยึด "ลิสต์ในข้อความที่เจ้าของ reply ถึง" ก่อนเสมอ — ลิสต์ re-number ใหม่ทุกครั้งที่แสดง
 * เลขที่เจ้าของพิมพ์คือเลขของลิสต์ที่เขาเห็นตอนนั้น ไม่ใช่ลิสต์ล่าสุดในระบบ (มั่วมาแล้วคาตาเจ้าของ 6 ส.ค.)
 */
export async function findTasks(ref: string, replyText = "") {
  const r = (ref || "").trim();
  if (!r) return [];
  const nums = [...r.matchAll(/\b(\d{1,2})\b/g)].map((m) => Number(m[1]));
  if (nums.length && replyText.trim()) {
    // แกะ "N. ชื่องาน" จากลิสต์ที่เขา reply → เทียบชื่อกับงานเปิดจริง (ตัดวงเล็บ/รายละเอียดท้ายทิ้ง)
    const byNum = new Map<number, string>();
    for (const m of replyText.matchAll(/^\s*(\d{1,2})\.\s*(.+)$/gm)) {
      byNum.set(Number(m[1]), m[2].replace(/\(.*$/, "").trim());
    }
    if (byNum.size) {
      const open = await openTasks();
      const norm = (x: string) => x.toLowerCase().replace(/[\s"'`ๆฯ.,!?()\-]/g, "");
      const picked: typeof open = [];
      for (const n of nums) {
        const name = byNum.get(n);
        if (!name) continue;
        const k = norm(name);
        const hit = open.find((t) => {
          const o = norm(t.title);
          const [a, b] = o.length > k.length ? [o, k] : [k, o];
          return b.length >= 6 && a.includes(b);
        });
        if (hit && !picked.some((p) => p.id === hit.id)) picked.push(hit);
      }
      if (picked.length) return picked;
    }
  }
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
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^(เสร็จ|ปิด|งาน|แล้ว|ข้อ|ที่|ทำ|ลบ|เอา|ออก|ครับ|หน่อย)$/.test(w));
  if (!words.length) return [];
  const scored = rows
    .map((t) => {
      const hay = `${t.title} ${t.detail || ""}`.toLowerCase();
      let score = 0;
      for (const w of words) if (hay.includes(w)) score += w.length >= 4 ? 3 : 1;
      return { t, score };
    })
    .filter((x) => x.score >= 3) // กันเศษพยางค์ไทยจับงานผิดตัว
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
      .replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !/^(ถ้า|แล้ว|เมื่อ|ตอน|ให้|ผม|กู|ไป|ถึง|มา)$/.test(w));
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

// ===== จัดกระดานทั้งชุดในคำสั่งเดียว (7 ส.ค. 2026) =====
//
// เคสจริงที่พังคาตาเจ้าของเมื่อคืน: "งานโน๊ตผมจริงๆมีแค่ 1 3 8 12 เท่านั้น ที่เหลือไม่เกี่ยว ตัดออก"
//  1. ระบบตีกลับด้าน — ไปปิดงาน 1 3 8 12 ที่เจ้าของสั่งให้ "เก็บ"
//  2. เลขอ้างอิงมั่ว — เจ้าของอ้างเลขจาก "ลิสต์ที่เพิ่งเห็น" แต่ลิสต์ re-number ใหม่ทุกครั้งที่แสดง
//  3. สั่งซ้ำอีกรอบก็มั่วต่อ เพราะรากทั้งสองข้อยังอยู่
//
// ตัวนี้ให้สมองอ่าน "คำสั่ง + ลิสต์ในข้อความที่ reply ถึง + กระดานจริง" แล้ววางแผนทีเดียว:
// เก็บอะไร ตัดอะไร ปิดอะไร เพิ่มอะไร เปิดงานที่เพิ่งถูกปิดผิดกลับมาได้ด้วย
// เลขอ้างอิงยึด "ลิสต์ในข้อความที่เจ้าของ reply" ก่อนเสมอ (นั่นคือเลขที่เขาเห็นตอนพิมพ์)

export interface ReorgResult {
  kept: string[];
  dropped: string[];
  closed: string[];
  added: string[];
  reopened: string[];
}

export async function reorganizeBoard(text: string, replyText = ""): Promise<ReorgResult | null> {
  const { askGeminiJson } = await import("./kiki");
  const open = await openTasks();
  // งานที่เพิ่งปิด/ตัดใน 24 ชม. — เผื่อคำสั่งนี้คือการแก้ความมั่วรอบก่อน (เปิดกลับได้)
  const recentClosed = await db.kikiTask.findMany({
    where: { status: { in: ["done", "dropped"] }, doneAt: { gte: new Date(Date.now() - 86400_000) } },
    orderBy: { doneAt: "desc" },
    take: 25,
  }).catch(() => []);

  const j = await askGeminiJson<{
    keep?: string[]; drop?: string[]; close?: string[]; reopen?: string[];
    add?: { title?: string; detail?: string }[];
  }>(
    `คุณคือตัวจัดกระดานงานของเลขา อ่านคำสั่งเจ้าของแล้ววางแผนว่ากระดานสุดท้ายต้องเหลืออะไร
ตอบ JSON เท่านั้น:
{"keep":["id งานเปิดที่ต้องเก็บไว้"],"drop":["id งานเปิดที่ต้องตัดทิ้ง (ไม่เกี่ยว/ไม่ใช่งานเจ้าของ)"],
 "close":["id งานเปิดที่เจ้าของบอกว่าทำเสร็จแล้ว"],"reopen":["id งานที่เพิ่งถูกปิด/ตัดไป แต่คำสั่งนี้บอกว่ามันคืองานจริง"],
 "add":[{"title":"งานใหม่ที่เจ้าของพูดถึงแต่ไม่มีในระบบเลย","detail":""}]}

กติกาเหล็ก
- "มีแค่ X / เหลือแค่ X / ที่เหลือตัดออก-ไม่เกี่ยว" = **เก็บ X แล้ว drop ทุกงานเปิดที่เหลือ** (ห้ามตีกลับด้านเด็ดขาด)
- เลขข้อที่เจ้าของอ้าง ให้เทียบกับ "ลิสต์ในข้อความที่เขา reply ถึง" ก่อนเสมอ (นั่นคือเลขที่เขาเห็น)
  ไม่มีลิสต์ใน reply ค่อยเทียบชื่อ/ความหมายกับกระดานจริง
- งานในคำสั่งที่ตรงกับงานที่เพิ่งถูกปิดไป (รายการ "เพิ่งปิด") = reopen ไม่ใช่ add ใหม่
- ตัดทิ้ง (drop) ≠ ทำเสร็จ (close) — "ไม่เกี่ยว/ไม่ใช่งานผม" = drop
- ไม่แน่ใจงานไหน = keep ไว้ (เก็บเกินดีกว่าตัดงานจริงทิ้ง)`,
    [
      `คำสั่งเจ้าของ: """${text.slice(0, 600)}"""`,
      replyText ? `ข้อความที่เจ้าของ reply ถึง (เลขข้อที่เขาอ้างมาจากลิสต์นี้):\n"""${replyText.slice(0, 2500)}"""` : "",
      `กระดานจริงตอนนี้ (งานเปิด):\n${open.map((t) => `${t.id} | ${t.title}`).join("\n") || "(ว่าง)"}`,
      recentClosed.length ? `งานที่เพิ่งถูกปิด/ตัดใน 24 ชม. (เปิดกลับได้ถ้าคำสั่งบอกว่าเป็นงานจริง):\n${recentClosed.map((t) => `${t.id} | ${t.title} (${t.status})`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n"),
    30_000,
  ).catch(() => null);
  if (!j) return null;

  const openIds = new Set(open.map((t) => t.id));
  const closedIds = new Set(recentClosed.map((t) => t.id));
  const pick = (arr: string[] | undefined, from: Set<string>) => (arr || []).filter((id) => from.has(id));

  const dropIds = pick(j.drop, openIds);
  const closeIds = pick(j.close, openIds).filter((id) => !dropIds.includes(id));
  const reopenIds = pick(j.reopen, closedIds);
  const keepIds = pick(j.keep, openIds);

  // กันแผนเพี้ยน: ถ้าแผนจะตัด "ทุกงาน" โดยไม่เหลืออะไรและไม่เพิ่ม/เปิดกลับเลย = น่าสงสัย ไม่ทำ
  if (dropIds.length + closeIds.length >= open.length && !keepIds.length && !reopenIds.length && !(j.add || []).length && open.length > 0) {
    return null;
  }

  const [droppedRows, closedRows] = await Promise.all([dropTasks(dropIds), completeTasks(closeIds)]);
  const reopenedRows = reopenIds.length
    ? await db.kikiTask.findMany({ where: { id: { in: reopenIds } } })
    : [];
  if (reopenIds.length) {
    await db.kikiTask.updateMany({ where: { id: { in: reopenIds } }, data: { status: "open", doneAt: null } }).catch(() => {});
  }
  const added: string[] = [];
  for (const a of j.add || []) {
    const title = (a.title || "").trim();
    if (title.length < 4) continue;
    const t = await addTask({ title, detail: a.detail || undefined, source: text.slice(0, 300) }).catch(() => null);
    if (t) added.push(t.title);
  }

  return {
    kept: open.filter((t) => keepIds.includes(t.id)).map((t) => t.title),
    dropped: droppedRows.map((t) => t.title),
    closed: closedRows.map((t) => t.title),
    added,
    reopened: reopenedRows.map((t) => t.title),
  };
}
