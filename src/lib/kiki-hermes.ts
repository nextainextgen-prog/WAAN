import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { db } from "./db";

/**
 * "ฝาก Hermes" — มอบงานยาว/หลายขั้นให้ Hermes agent (GPT-5.5 + เครื่องมือครบ: เว็บ/เบราว์เซอร์/terminal/vision)
 * กติกาสำคัญ (เจ้าของสั่ง 3 ส.ค.):
 *  - โลกส่วนตัวของ Vex เท่านั้น — ห้ามผ่าน brain.ts ของวาน (ตัวนั้นฉีดบริบทงานบริษัท)
 *  - ส่งไปเฉพาะ "โจทย์ที่เจ้าของพิมพ์" ไม่แนบความจำ/การเงิน/ข้อมูลส่วนตัวอื่น
 *  - งานรันเบื้องหลัง → เสร็จแล้ว cron หยิบผลไปส่งในแชท (ingest ไม่ต้องรอ)
 */

const HERMES_GUARD = `คุณคือผู้ช่วยรับงานต่อจากเลขาส่วนตัวของเจ้าของ ทำงานที่มอบหมายให้จบด้วยเครื่องมือที่มี แล้วสรุปผลเป็นภาษาไทย
กฎความปลอดภัย (เด็ดขาด): ห้ามใช้ sudo · ห้ามลบ/ย้าย/เขียนทับไฟล์ของผู้ใช้ · ห้ามเข้าโฟลเดอร์ ~/Projects และ ~/Desktop · ห้ามติดตั้งโปรแกรมระดับระบบ · ห้ามส่งข้อมูลออกไปที่อื่นนอกจากตอบกลับมา
รูปแบบคำตอบ: สาระตรงประเด็น อ่านง่าย ถ้ามีลิงก์/ตัวเลขให้ครบถ้วน ไม่ต้องเล่าขั้นตอนการทำงาน`;

function hermesCliPath(): string | null {
  const explicit = process.env.HERMES_CLI_PATH?.trim();
  if (explicit) return existsSync(explicit) ? explicit : null;
  const candidates = [
    path.join(os.homedir(), ".local/bin/hermes"),
    "/usr/local/bin/hermes",
    path.join(os.homedir(), ".hermes/bin/hermes"),
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

export function kikiHermesReady(): boolean {
  return hermesCliPath() !== null;
}

// โฟลเดอร์ทำงานเปล่า ๆ — กันไฟล์โปรเจกต์/AGENTS.md รั่วเข้าไปในบริบท และให้มันมีที่เขียนไฟล์ชั่วคราวของตัวเอง
function jobCwd(): string {
  const dir = path.join(os.tmpdir(), "kiki-hermes-cwd");
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return dir;
}

function runHermes(task: string, timeoutMs: number): Promise<string> {
  const cli = hermesCliPath();
  if (!cli) return Promise.reject(new Error("ไม่พบ hermes CLI"));
  return new Promise((resolve, reject) => {
    const child = spawn(cli, ["-z", `${HERMES_GUARD}\n\n=== งานที่ได้รับมอบหมาย ===\n${task}`], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      cwd: jobCwd(),
    });
    let stdout = "";
    let stderr = "";
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill("SIGTERM");
      reject(new Error("Hermes ใช้เวลาเกินกำหนด (15 นาที)"));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const out = stdout.trim();
      if (out) resolve(out);
      else reject(new Error(`Hermes ไม่ตอบผลลัพธ์ (exit ${code}) ${stderr.slice(0, 200)}`));
    });
  });
}

// รับงานเข้าคิว + ปล่อยรันเบื้องหลังทันที (fire-and-forget) — ผลไปโผล่ทาง cron
export async function queueHermesJob(chatId: string, task: string): Promise<string> {
  const job = await db.kikiHermesJob.create({ data: { chatId, task: task.slice(0, 4000) } });
  void (async () => {
    try {
      await db.kikiHermesJob.update({ where: { id: job.id }, data: { status: "running", startedAt: new Date() } });
      const result = await runHermes(task, 15 * 60_000);
      await db.kikiHermesJob.update({ where: { id: job.id }, data: { status: "done", result: result.slice(0, 60_000), doneAt: new Date() } });
    } catch (e) {
      await db.kikiHermesJob
        .update({ where: { id: job.id }, data: { status: "failed", error: e instanceof Error ? e.message.slice(0, 500) : "error", doneAt: new Date() } })
        .catch(() => {});
    }
  })();
  return job.id;
}

export interface HermesDelivery {
  chatId: string;
  task: string;
  ok: boolean;
  body: string; // ผลงาน หรือเหตุที่พัง
}

// cron เรียกทุกนาที: หยิบงานที่เสร็จ/พังแล้วยังไม่ได้ส่ง + เก็บกวาดงานค้าง (เว็บรีสตาร์ทกลางคัน)
export async function collectHermesDeliveries(): Promise<HermesDelivery[]> {
  // งานที่สถานะ running นานผิดปกติ = โปรเซสตายไปแล้ว (เช่น restart เว็บ) — ปิดจ็อบตรง ๆ ไม่แขวนเงียบ
  // งาน Hermes รันในเว็บ = เพดาน 20 นาที · งาน [พัฒนา] รัน detached นอกเว็บ = เพดาน 60 นาที (ตัวรันมี timeout 45 นาทีของตัวเอง)
  await db.kikiHermesJob
    .updateMany({
      where: { status: "running", startedAt: { lt: new Date(Date.now() - 20 * 60_000) }, NOT: { task: { startsWith: "[พัฒนา]" } } },
      data: { status: "failed", error: "งานหลุดกลางคัน (ระบบรีสตาร์ท) — สั่งใหม่อีกทีครับ", doneAt: new Date() },
    })
    .catch(() => {});
  await db.kikiHermesJob
    .updateMany({
      where: { status: "running", startedAt: { lt: new Date(Date.now() - 60 * 60_000) }, task: { startsWith: "[พัฒนา]" } },
      data: { status: "failed", error: "งานพัฒนาหลุดกลางคัน — เช็ค git log ว่ามี commit ค้างไหม แล้วสั่งใหม่", doneAt: new Date() },
    })
    .catch(() => {});
  const rows = await db.kikiHermesJob.findMany({ where: { status: { in: ["done", "failed"] }, sentAt: null }, orderBy: { doneAt: "asc" }, take: 5 });
  const out: HermesDelivery[] = [];
  for (const r of rows) {
    await db.kikiHermesJob.update({ where: { id: r.id }, data: { sentAt: new Date() } }).catch(() => {});
    out.push({
      chatId: r.chatId,
      task: r.task,
      ok: r.status === "done",
      body: r.status === "done" ? r.result || "(ไม่มีเนื้อหา)" : r.error || "ไม่ทราบสาเหตุ",
    });
  }
  return out;
}
