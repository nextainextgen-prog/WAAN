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

/** บรรทัดล่าสุดที่มีเนื้อจริง — เอาไว้บอกเจ้าของว่า "ตอนนี้ทำถึงไหน" */
export function lastMeaningfulLine(buf: string): string {
  const lines = buf
    .split("\n")
    .map((l) => l.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").trim()) // ตัดสี ANSI
    .filter((l) => l.length >= 6 && !/^[-=_*·.\s]+$/.test(l));
  return lines.length ? lines[lines.length - 1].slice(0, 280) : "";
}

function runHermes(task: string, timeoutMs: number, jobId?: string): Promise<string> {
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
    // จดความคืบหน้าลง DB เป็นระยะ (cron หยิบไปรายงานทุก 3 นาที — เจ้าของสั่ง 4 ส.ค.)
    let lastNote = 0;
    if (jobId) {
      db.kikiHermesJob.update({ where: { id: jobId }, data: { pid: child.pid ?? null } }).catch(() => {});
    }
    const note = () => {
      if (!jobId || Date.now() - lastNote < 15_000) return;
      lastNote = Date.now();
      const line = lastMeaningfulLine(stdout + "\n" + stderr);
      if (!line) return;
      db.kikiHermesJob.update({ where: { id: jobId }, data: { progressText: line, progressAt: new Date() } }).catch(() => {});
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill("SIGTERM");
      reject(new Error("Hermes ใช้เวลาเกินกำหนด (15 นาที)"));
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d.toString(); note(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); note(); });
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

/**
 * รับงานเข้าคิว — ปล่อยรันทันทีถ้ายังมีช่องว่าง ไม่งั้นค้างสถานะ pending ให้ cron ปล่อยทีหลัง
 *
 * เดิมยิงทันทีทุกงานไม่มีเพดาน สั่งรัว 10 เรื่อง = แยก 10 โปรเซสพร้อมกัน กิน CPU จนเครื่องสะดุด
 * (สเปกข้อ 15ฉ — และต้องบอกเจ้าของด้วยว่ามีงานรอคิวอยู่ ไม่ใช่เงียบไป)
 */
export async function queueHermesJob(chatId: string, task: string): Promise<{ id: string; queued: boolean; ahead: number }> {
  const job = await db.kikiHermesJob.create({ data: { chatId, task: task.slice(0, 4000) } });
  const { MAX_CONCURRENT, runningCount, queuedCount } = await import("./kiki-jobs");
  const running = await runningCount();
  if (running >= MAX_CONCURRENT) {
    const ahead = (await queuedCount()) - 1;
    return { id: job.id, queued: true, ahead: Math.max(0, ahead) };
  }
  await startQueuedJob(job.id);
  return { id: job.id, queued: false, ahead: 0 };
}

/** ปล่อยงานที่อยู่ในคิวให้เริ่มรันจริง — คืน false ถ้างานไม่อยู่ในสถานะที่ปล่อยได้แล้ว */
export async function startQueuedJob(jobId: string): Promise<boolean> {
  const job = await db.kikiHermesJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "pending") return false;
  await db.kikiHermesJob.update({ where: { id: jobId }, data: { status: "running", startedAt: new Date() } });
  void (async () => {
    try {
      const result = await runHermes(job.task, 15 * 60_000, jobId);
      await db.kikiHermesJob.update({ where: { id: jobId }, data: { status: "done", result: result.slice(0, 60_000), doneAt: new Date() } });
    } catch (e) {
      await db.kikiHermesJob
        .update({ where: { id: jobId }, data: { status: "failed", error: e instanceof Error ? e.message.slice(0, 500) : "error", doneAt: new Date() } })
        .catch(() => {});
    }
  })();
  return true;
}

// ===== รายงานความคืบหน้าระหว่างทำ (เจ้าของสั่ง 4 ส.ค.: ทุก 3 นาทีบอกว่าถึงขั้นไหน) =====

export interface JobPing {
  jobId: string;
  chatId: string;
  text: string;
}

const PING_EVERY_MS = 3 * 60_000;

/** งานที่รันอยู่และถึงคิวรายงาน — cron เรียกทุกนาที */
export async function collectJobPings(now = new Date()): Promise<JobPing[]> {
  const rows = await db.kikiHermesJob.findMany({ where: { status: "running", canceled: false }, take: 5 });
  const out: JobPing[] = [];
  for (const r of rows) {
    const started = r.startedAt || r.createdAt;
    const last = r.lastPingAt || started;
    if (now.getTime() - last.getTime() < PING_EVERY_MS) continue;
    await db.kikiHermesJob.update({ where: { id: r.id }, data: { lastPingAt: now } }).catch(() => {});
    const mins = Math.max(1, Math.round((now.getTime() - started.getTime()) / 60_000));
    const isDev = r.task.startsWith("[พัฒนา]");
    const cap = isDev ? 45 : 15;
    const head = `${isDev ? "งานพัฒนา" : "งานที่ฝากไว้"}ยังทำอยู่ครับ · ผ่านไป ${mins} นาที (เพดาน ${cap} นาที)`;
    const body = r.progressText
      ? `ตอนนี้: ${r.progressText}`
      : "ยังไม่มีเอาต์พุตกลับมาจากตัวรัน — ผมจะรายงานใหม่อีก 3 นาที";
    out.push({
      jobId: r.id,
      chatId: r.chatId,
      text: `${head}\n\nงาน: ${r.task.replace(/^\[พัฒนา\]\s*/, "").slice(0, 120)}\n${body}`,
    });
  }
  return out;
}

/** ยกเลิกงานที่รันอยู่ (ปุ่มในข้อความรายงาน) */
export async function cancelJob(jobId: string): Promise<{ ok: boolean; msg: string }> {
  const r = await db.kikiHermesJob.findUnique({ where: { id: jobId } });
  if (!r) return { ok: false, msg: "หางานนี้ไม่เจอครับ" };
  if (r.status !== "running") return { ok: false, msg: `งานนี้${r.status === "done" ? "เสร็จไปแล้ว" : "จบไปแล้ว"}ครับ` };
  if (r.pid) {
    try { process.kill(r.pid, "SIGTERM"); } catch { /* โปรเซสตายไปแล้ว */ }
  }
  await db.kikiHermesJob.update({
    where: { id: jobId },
    data: { status: "failed", canceled: true, error: "เจ้าของสั่งยกเลิก", doneAt: new Date(), sentAt: new Date() },
  });
  return { ok: true, msg: `ยกเลิกงานให้แล้วครับ: ${r.task.replace(/^\[พัฒนา\]\s*/, "").slice(0, 100)}` };
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
