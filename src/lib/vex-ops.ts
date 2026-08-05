import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getSetting, setSetting } from "./kiki";

/**
 * เซสชันของ Vex ดูแลตัวเอง (เจ้าของสั่ง 5 ส.ค. 2026)
 *
 * "ทุกเซสชันมันหมดอายุ ผมอยากให้มันรันเองได้ / เซสชันไหนหมดให้แจ้งไปที่ในแชท
 *  แล้วผมจะบอกให้รัน ให้คุณรันให้ผมเลย ส่วนถ้ามันมีอะไรให้กรอกก็แคปหรือถามผมได้เลย
 *  แล้วผมจะบอกรหัสหรือ OTP ต่างๆ คุณก็เอาไปกรอกใส่ได้เลย"
 *
 * ของน้องวานมีครึ่งเดียว (`waan-ops.ts`): แจ้ง → ตอบ "รันเลย" → รันให้ → รายงาน
 * แต่ `runNpmScript()` ป้อน stdin ไม่ได้ ใช้ได้เฉพาะตัวที่เด้งหน้าต่างเบราว์เซอร์เอง
 * ตัวนี้เพิ่มส่วนที่ขาด: คุยกับโปรเซสได้ระหว่างรัน (เบอร์ · OTP · รหัส 2FA)
 *
 * กฎที่ยกมาจากบทเรียนของวาน:
 *  - เว็บล่ม = ทุกอย่างพ่น error พร้อมกัน ห้ามสรุปว่าเซสชันหมด (วานเคยกล่าวหาผิดตัวแล้วสั่งงานเจ้าของฟรี ๆ)
 *    → ตรงนี้จึงตัดสินจาก "หลักฐานของตัวเซสชันเอง" เท่านั้น ไม่ใช่จากอาการต่อไม่ติด
 *  - โปรเซสยังอยู่ ≠ ยังทำงาน (vex-eyes ตายเงียบ 4.5 ชม. โดยโปรเซสยังรันอยู่)
 *    → ตรวจ heartbeat จากไฟล์ log ที่ขยับจริง ไม่ใช่แค่ `pgrep`
 */

export interface VexSession {
  key: string;         // ชื่อสั้นไว้อ้างในคำสั่ง/ปุ่ม
  label: string;       // ชื่อที่เจ้าของอ่านรู้เรื่อง
  script: string;      // npm script ที่ใช้ล็อกอินใหม่
  sessionFile?: string;   // ไฟล์เซสชัน — ไม่มี/เก่ามาก = ต้องล็อกอินใหม่
  maxAgeDays?: number;    // เกินกี่วันถือว่าน่าจะหมดอายุ (0/ไม่ใส่ = ไม่ดูอายุ)
  heartbeatLog?: string;  // log ที่ต้องขยับเรื่อย ๆ ถ้าตัวนั้นยังทำงานจริง
  heartbeatMin?: number;  // log เงียบเกินกี่นาทีถือว่าตายเงียบ
  interactive: boolean;   // ต้องพิมพ์ตอบระหว่างรันไหม (OTP/รหัส) หรือเด้งหน้าต่างเอง
  askFor?: string;        // เจ้าของต้องเตรียมอะไรไว้ตอบ
}

/**
 * ทะเบียนเซสชันของ "โลก Vex" เท่านั้น — ของบริษัทเป็นของวาน (`waan-ops.ts`) ห้ามปนกัน
 * เพิ่มเซสชันใหม่ = เพิ่มที่นี่ที่เดียว ตัวเฝ้ากับตัวรันอ่านจากตารางนี้ทั้งคู่
 */
export const VEX_SESSIONS: VexSession[] = [
  {
    key: "telegram",
    label: "บัญชี Telegram ของเจ้าของ (ตาของ Vex)",
    script: "kiki:tg-auth",
    sessionFile: ".kiki-tg-session",
    maxAgeDays: 0, // เซสชัน Telegram ไม่มีวันหมดตายตัว — ดูจาก heartbeat แทน
    heartbeatLog: ".run-logs/vex-eyes.log",
    heartbeatMin: 90,
    interactive: true,
    askFor: "เบอร์โทร + รหัส OTP ที่เด้งในแอป Telegram (ถ้ามี 2FA ต้องใช้รหัสนั้นด้วย)",
  },
  {
    key: "drive",
    label: "Google Drive / Calendar",
    script: "drive:auth",
    sessionFile: ".drive-token.json",
    maxAgeDays: 0,
    interactive: false, // เด้งหน้าต่างเบราว์เซอร์ให้กดยินยอมเอง
    askFor: "กดยินยอมในหน้าต่างเบราว์เซอร์ที่เด้งขึ้น",
  },
];

export function projectRoot(): string {
  return process.env.CHANGOH_ROOT?.trim() || process.cwd();
}

// ===== ตรวจสุขภาพจากหลักฐานของตัวเอง =====

export type SessionState = "ok" | "missing" | "stale" | "silent" | "unknown";

export interface SessionHealth {
  key: string;
  label: string;
  state: SessionState;
  detail: string;   // หลักฐานที่ใช้ตัดสิน — ต้องเขียนให้เจ้าของตรวจสอบตามได้
  script: string;
  interactive: boolean;
  askFor: string;
}

function ageOf(file: string): { exists: boolean; days: number; mtime: Date | null } {
  try {
    const st = fs.statSync(path.join(projectRoot(), file));
    return { exists: true, days: (Date.now() - st.mtimeMs) / 86_400_000, mtime: st.mtime };
  } catch {
    return { exists: false, days: Infinity, mtime: null };
  }
}

export function checkSession(s: VexSession): SessionHealth {
  const base = { key: s.key, label: s.label, script: s.script, interactive: s.interactive, askFor: s.askFor || "" };

  if (s.sessionFile) {
    const a = ageOf(s.sessionFile);
    if (!a.exists) return { ...base, state: "missing", detail: `ไม่มีไฟล์ ${s.sessionFile} เลย — ยังไม่เคยล็อกอิน` };
    if (s.maxAgeDays && a.days > s.maxAgeDays) {
      return { ...base, state: "stale", detail: `${s.sessionFile} ไม่ถูกเขียนมา ${Math.floor(a.days)} วัน (เกินเพดาน ${s.maxAgeDays} วัน)` };
    }
  }

  // โปรเซสยังอยู่ไม่พอ — ต้องเห็นว่ามันยัง "ขยับ" จริง
  if (s.heartbeatLog && s.heartbeatMin) {
    const a = ageOf(s.heartbeatLog);
    if (!a.exists) return { ...base, state: "unknown", detail: `ไม่มี log ${s.heartbeatLog} — บอกไม่ได้ว่าทำงานอยู่ไหม` };
    const quietMin = Math.floor((Date.now() - (a.mtime?.getTime() || 0)) / 60_000);
    if (quietMin > s.heartbeatMin) {
      return { ...base, state: "silent", detail: `${s.heartbeatLog} เงียบมา ${quietMin} นาที (เพดาน ${s.heartbeatMin}) — โปรเซสอาจยังอยู่แต่ไม่ทำงานแล้ว` };
    }
    return { ...base, state: "ok", detail: `log ขยับล่าสุด ${quietMin} นาทีที่แล้ว` };
  }

  const a = s.sessionFile ? ageOf(s.sessionFile) : null;
  return { ...base, state: "ok", detail: a?.mtime ? `ไฟล์เซสชันอัปเดตล่าสุด ${a.mtime.toLocaleString("th-TH")}` : "ไม่มีเกณฑ์ให้ตรวจ" };
}

export function checkAllSessions(): SessionHealth[] {
  return VEX_SESSIONS.map(checkSession);
}

export const isBroken = (h: SessionHealth) => h.state === "missing" || h.state === "stale" || h.state === "silent";

// ===== ตัวรันแบบโต้ตอบ =====

const RUN_DIR = () => path.join(projectRoot(), ".vex-auth");
const RUN_KEY = "vex_auth_run"; // งานที่กำลังรันอยู่ (ทีละงานเท่านั้น)

export interface AuthRun {
  id: string;
  key: string;      // เซสชันไหน
  script: string;
  chatId: string;
  startedAt: number;
  fedCount: number; // ป้อนคำตอบไปแล้วกี่ครั้ง — ใช้กันป้อนซ้ำ
  lastAskedAt: number;
  lastPrompt: string;
}

export async function currentRun(): Promise<AuthRun | null> {
  try {
    const v = await getSetting(RUN_KEY);
    if (!v) return null;
    const r = JSON.parse(v) as AuthRun;
    // เกิน 20 นาทีถือว่าจบไปแล้ว (ตัวขับมี timeout 15 นาทีของตัวเอง)
    if (Date.now() - r.startedAt > 20 * 60_000) { await clearRun(); return null; }
    return r;
  } catch {
    return null;
  }
}

export async function clearRun(): Promise<void> {
  await setSetting(RUN_KEY, "");
}

const runFile = (id: string, ext: string) => path.join(RUN_DIR(), `${id}.${ext}`);

export function readRunLog(id: string): string {
  try { return fs.readFileSync(runFile(id, "log"), "utf8"); } catch { return ""; }
}

export function readRunStatus(id: string): "running" | "done" | "failed" | "timeout" | "gone" {
  try {
    const s = fs.readFileSync(runFile(id, "status"), "utf8").trim();
    return (["running", "done", "failed", "timeout"].includes(s) ? s : "gone") as "running";
  } catch {
    return "gone";
  }
}

/**
 * โปรเซสกำลังรอให้พิมพ์อะไรอยู่ไหม
 *
 * ดูจาก "บรรทัดสุดท้ายที่ยังไม่ขึ้นบรรทัดใหม่" — เทอร์มินัลค้างรอ input จะพิมพ์คำถามแล้วหยุดตรงนั้น
 * นี่คือการอ่านผลลัพธ์ของโปรแกรม ไม่ใช่การเดาเจตนาของคน (กติกาข้อ 1 ยอมให้ใช้ได้)
 */
export function pendingPrompt(id: string): string {
  const raw = readRunLog(id);
  if (!raw) return "";
  const clean = raw.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
  const tail = clean.split("\n").pop() || "";
  const t = tail.trim();
  if (!t) return "";
  // ค้างรอ input = บรรทัดท้ายยังไม่จบด้วยขึ้นบรรทัดใหม่ และลงท้ายด้วยเครื่องหมายถาม/โคลอน
  return /[:?：]\s*$/.test(t) ? t : "";
}

/** ตัดโค้ดสี ANSI ออกให้อ่านง่าย — ใช้ทั้งตอนโชว์ในแชทและตอนแคปเป็นภาพ */
export function cleanLog(id: string, lastLines = 22): string {
  return readRunLog(id)
    .replace(/\x1B\[[0-9;]*[A-Za-z]/g, "")
    .split("\n")
    .filter((l) => l.trim())
    .slice(-lastLines)
    .join("\n");
}

/** ภาพ "หน้าจอเทอร์มินัล" ให้เจ้าของเห็นว่าตอนนี้ค้างอยู่ตรงไหนจริง ๆ (กติกาข้อ 3 — ต้องมีหลักฐาน) */
export function terminalCardHtml(title: string, body: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0d1117;font-family:'SF Mono',Menlo,monospace">
  <div style="padding:18px 22px">
    <div style="color:#7d8590;font-size:13px;margin-bottom:10px">${esc(title)}</div>
    <pre style="margin:0;color:#c9d1d9;font-size:14px;line-height:1.55;white-space:pre-wrap;word-break:break-word">${esc(body)}</pre>
  </div></body>`;
}

/** เริ่มรันคำสั่งล็อกอิน — คืน null ถ้ามีงานค้างอยู่แล้ว (ทีละงานเท่านั้น) */
export async function startAuthRun(sess: VexSession, chatId: string): Promise<AuthRun | null> {
  if (await currentRun()) return null;
  const id = `${sess.key}-${Date.now().toString(36)}`;
  fs.mkdirSync(RUN_DIR(), { recursive: true });
  const child = spawn(process.execPath, [path.join(projectRoot(), "scripts/vex-auth-run.mjs"), id, sess.script], {
    cwd: projectRoot(),
    detached: true, // เว็บรีสตาร์ทแล้วการล็อกอินต้องไม่ตายกลางคัน
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();
  const run: AuthRun = {
    id, key: sess.key, script: sess.script, chatId,
    startedAt: Date.now(), fedCount: 0, lastAskedAt: 0, lastPrompt: "",
  };
  await setSetting(RUN_KEY, JSON.stringify(run));
  return run;
}

export async function saveRun(run: AuthRun): Promise<void> {
  await setSetting(RUN_KEY, JSON.stringify(run));
}

/** ป้อนคำตอบของเจ้าของเข้า stdin ของโปรเซสที่รออยู่ */
export async function feedAnswer(run: AuthRun, answer: string): Promise<boolean> {
  try {
    fs.appendFileSync(runFile(run.id, "in"), `${answer.trim()}\n`);
    run.fedCount += 1;
    run.lastPrompt = "";
    await saveRun(run);
    return true;
  } catch {
    return false;
  }
}

/**
 * ล็อกอินสำเร็จจริงไหม — ห้ามเชื่อคำพูดในผลลัพธ์อย่างเดียว (กติกาข้อ 3)
 * ต้องเห็นว่าไฟล์เซสชันถูก "เขียนใหม่หลังจากงานเริ่ม" ถึงจะนับ
 */
export function verifyAuthResult(run: AuthRun): { ok: boolean; evidence: string } {
  const sess = VEX_SESSIONS.find((s) => s.key === run.key);
  const status = readRunStatus(run.id);
  if (!sess?.sessionFile) {
    return { ok: status === "done", evidence: `โปรเซสจบด้วยสถานะ ${status} (เซสชันนี้ไม่มีไฟล์ให้ตรวจ)` };
  }
  const a = ageOf(sess.sessionFile);
  if (!a.exists) return { ok: false, evidence: `ยังไม่มีไฟล์ ${sess.sessionFile}` };
  const writtenAfterStart = (a.mtime?.getTime() || 0) >= run.startedAt;
  if (!writtenAfterStart) {
    return { ok: false, evidence: `${sess.sessionFile} ยังเป็นของเดิม (${a.mtime?.toLocaleString("th-TH")}) ไม่ได้ถูกเขียนใหม่` };
  }
  return { ok: status === "done", evidence: `${sess.sessionFile} ถูกเขียนใหม่ ${a.mtime?.toLocaleString("th-TH")} · โปรเซสจบด้วยสถานะ ${status}` };
}

/** ล้างไฟล์ของงานที่จบแล้ว — ไม่เก็บ log ล็อกอินไว้ในเครื่องนานเกินจำเป็น */
export function cleanupRun(id: string): void {
  for (const ext of ["log", "in", "status"]) {
    try { fs.unlinkSync(runFile(id, ext)); } catch { /* ไม่มีก็ไม่เป็นไร */ }
  }
}

// ===== กันแจ้งซ้ำ =====

const ALERT_KEY = "vex_session_alerts";

export async function shouldAlert(key: string, everyMin = 120): Promise<boolean> {
  try {
    const map = JSON.parse((await getSetting(ALERT_KEY)) || "{}") as Record<string, number>;
    if (Date.now() - (map[key] || 0) < everyMin * 60_000) return false;
    map[key] = Date.now();
    await setSetting(ALERT_KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

export async function resetAlert(key: string): Promise<void> {
  try {
    const map = JSON.parse((await getSetting(ALERT_KEY)) || "{}") as Record<string, number>;
    delete map[key];
    await setSetting(ALERT_KEY, JSON.stringify(map));
  } catch { /* ไม่สำคัญพอให้พัง */ }
}
