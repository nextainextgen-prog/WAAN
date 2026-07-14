import { db } from "./db";

/**
 * Task board ง่ายๆ สำหรับ PM ใช้ track งาน (เก็บใน Setting table เป็น JSON)
 * ไม่ต้อง migrate schema ใหม่
 */
export type TaskStatus = "todo" | "doing" | "review" | "done" | "blocked";

export interface Task {
  id: string;
  title: string;
  assignee?: string; // ชื่อ/username คนรับผิดชอบ
  status: TaskStatus;
  blocker?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

const STORE_KEY = "task_board";

async function load(): Promise<Task[]> {
  const row = await db.setting.findUnique({ where: { key: STORE_KEY } });
  if (!row?.value) return [];
  try {
    return JSON.parse(row.value) as Task[];
  } catch {
    return [];
  }
}

async function save(tasks: Task[]) {
  await db.setting.upsert({
    where: { key: STORE_KEY },
    update: { value: JSON.stringify(tasks) },
    create: { key: STORE_KEY, value: JSON.stringify(tasks) },
  });
}

// id สั้นแบบ deterministic (นับต่อจากของเดิม) — เลี่ยง Date.now/random
function nextId(tasks: Task[]): string {
  const max = tasks.reduce((m, t) => Math.max(m, parseInt(t.id.replace(/\D/g, ""), 10) || 0), 0);
  return `T${max + 1}`;
}

export async function addTask(input: {
  title: string;
  assignee?: string;
  status?: TaskStatus;
  note?: string;
  now: string;
}): Promise<Task> {
  const tasks = await load();
  const t: Task = {
    id: nextId(tasks),
    title: input.title.trim(),
    assignee: input.assignee?.trim() || undefined,
    status: input.status || "todo",
    note: input.note?.trim() || undefined,
    createdAt: input.now,
    updatedAt: input.now,
  };
  tasks.push(t);
  await save(tasks);
  return t;
}

export async function updateTask(
  id: string,
  patch: Partial<Pick<Task, "status" | "assignee" | "blocker" | "note" | "title">>,
  now: string,
): Promise<Task | null> {
  const tasks = await load();
  const t = tasks.find((x) => x.id.toUpperCase() === id.toUpperCase());
  if (!t) return null;
  Object.assign(t, patch, { updatedAt: now });
  await save(tasks);
  return t;
}

export async function listTasks(filter?: { status?: TaskStatus; assignee?: string }): Promise<Task[]> {
  let tasks = await load();
  if (filter?.status) tasks = tasks.filter((t) => t.status === filter.status);
  if (filter?.assignee) tasks = tasks.filter((t) => (t.assignee || "").includes(filter.assignee!));
  return tasks;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "รอเริ่ม",
  doing: "กำลังทำ",
  review: "รอตรวจ",
  done: "เสร็จ",
  blocked: "ติดปัญหา",
};

// สรุปบอร์ดเป็นข้อความ (ไว้ให้ PM รายงาน)
export function formatBoard(tasks: Task[]): string {
  if (!tasks.length) return "ยังไม่มี task ในบอร์ดค่ะ";
  const order: TaskStatus[] = ["blocked", "doing", "review", "todo", "done"];
  const groups = order
    .map((s) => ({ s, items: tasks.filter((t) => t.status === s) }))
    .filter((g) => g.items.length);
  return groups
    .map(
      (g) =>
        `[${STATUS_LABEL[g.s]}]\n` +
        g.items
          .map(
            (t) =>
              `- ${t.id} ${t.title}${t.assignee ? ` (@${t.assignee.replace(/^@/, "")})` : ""}${t.status === "blocked" && t.blocker ? ` — ติด: ${t.blocker}` : ""}`,
          )
          .join("\n"),
    )
    .join("\n\n");
}
