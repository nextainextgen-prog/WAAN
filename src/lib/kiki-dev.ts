import { spawn } from "node:child_process";
import path from "node:path";
import { db } from "./db";
import { getSetting, setSetting } from "./kiki";

/**
 * โหมดพัฒนาตัวเอง (เจ้าของสั่ง 3 ส.ค.): "พัฒนา/เพิ่มความสามารถ ..." ในแชท
 * → Vex ส่งสเปกให้ Claude CLI (วิศวกรตัวเดียวกับที่พี่โด้ใช้) แก้โค้ดตัวเองตามกติกาเดิมทุกข้อ
 * ตัวรันเป็นโปรเซส detached (scripts/kiki-dev-run.ts) เพราะงานจบด้วยการรีสตาร์ทเว็บ — รันในเว็บจะฆ่าตัวเองตาย
 */

const PENDING_KEY = "kiki_pending_dev";

export async function setPendingDev(spec: string | null): Promise<void> {
  await setSetting(PENDING_KEY, spec || "");
}

export async function getPendingDev(): Promise<string | null> {
  const v = await getSetting(PENDING_KEY);
  return v || null;
}

// มีงานพัฒนารันอยู่ไหม (กันรันซ้อน — แก้โค้ดพร้อมกันสองงาน = ชนกันแน่)
export async function devJobRunning(): Promise<boolean> {
  const n = await db.kikiHermesJob.count({
    where: { status: "running", task: { startsWith: "[พัฒนา]" }, startedAt: { gte: new Date(Date.now() - 50 * 60_000) } },
  });
  return n > 0;
}

export async function queueDevJob(chatId: string, spec: string): Promise<string> {
  const job = await db.kikiHermesJob.create({
    data: { chatId, task: `[พัฒนา] ${spec.slice(0, 3800)}`, status: "running", startedAt: new Date() },
  });
  // detached + unref: อยู่รอดข้ามการรีสตาร์ทเว็บ (ตัวรันเป็นคนรีสตาร์ทเองตอนจบ)
  const child = spawn("npx", ["tsx", path.join(process.cwd(), "scripts/kiki-dev-run.ts"), job.id], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  return job.id;
}
