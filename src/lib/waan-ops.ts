import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { db } from "@/lib/db";
import { getBotToken, tgSendMessage, tgSendPhoto } from "@/lib/telegram";

/**
 * "ให้ผมรันให้ไหม" — น้องวานรันคำสั่งกู้ระบบบนเครื่องพี่โด้ ผ่านการยืนยันในแชท
 *
 * ความปลอดภัย (ห้ามหย่อนข้อไหน):
 *  1) รันได้เฉพาะเจ้าของ — เทียบ Telegram user id "ตัวเลข" (ไม่ใช่ชื่อ/username ที่ปลอมได้)
 *  2) allowlist เท่านั้น — `npm run <script>` ที่มีจริงใน package.json ของโปรเจกต์นี้
 *     ไม่รับ shell อิสระจากแชท (ไม่มี string ไหนจากผู้ใช้ไหลเข้า argv) จึงไม่มี sudo/rm/;/&&/|
 *  3) ผูก "รันเลย" กับใบแจ้งเตือนใบใดใบหนึ่งชัดเจน — ค้างหลายตัวต้องถามก่อนว่าตัวไหน
 *     (เคสจริง: DRIVE กับ OHO เด้งพร้อมกัน 2 ใบ ถ้าไม่ผูกจะรันผิดตัว)
 *  4) คำขอหมดอายุใน 1 ชั่วโมง
 */

const PENDING_KEY = "waan_pending_cmd";
const OPS_CHAT_KEY = "waan_ops_chat_id"; // ห้องคุมระบบ (#Support • Agent / Leader)
const PENDING_TTL = 60 * 60 * 1000; // 1 ชั่วโมง
const RUN_TIMEOUT = 10 * 60 * 1000; // auth เด้งหน้าต่างล็อกอิน — ให้เวลาพี่โด้ 10 นาที

export interface PendingCmd {
  id: string;
  service: string; // refund | drive | oho | fb | line ...
  script: string; // ชื่อ script ใน package.json เช่น thunder:auth
  at: number; // เวลาที่ตั้งคำขอ (ms)
  chatId: string; // ห้องที่แจ้งไว้ (รายงานผลกลับที่นี่)
}

type PendingMap = Record<string, PendingCmd>;

// ===== ห้องคุมระบบ =====
export async function getOpsChatId(): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key: OPS_CHAT_KEY } }).catch(() => null);
  return row?.value?.trim() || null;
}
export async function setOpsChatId(chatId: string): Promise<void> {
  await db.setting.upsert({
    where: { key: OPS_CHAT_KEY },
    update: { value: String(chatId) },
    create: { key: OPS_CHAT_KEY, value: String(chatId) },
  });
}

// ===== allowlist: script ที่มีจริงใน package.json เท่านั้น =====
export function projectRoot(): string {
  return process.env.CHANGOH_ROOT?.trim() || process.cwd();
}

export function allowedScripts(): string[] {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot(), "package.json"), "utf8"));
    return Object.keys(pkg.scripts || {});
  } catch {
    return [];
  }
}

// ชื่อ script ต้องอยู่ใน package.json + รูปแบบต้องปลอดภัย (กันอักขระ shell หลุดเข้ามาทุกกรณี)
export function isAllowedScript(script: string): boolean {
  if (!/^[a-zA-Z0-9:_-]+$/.test(script)) return false;
  return allowedScripts().includes(script);
}

// ===== ทะเบียนคำขอที่รอยืนยัน =====
async function readPending(): Promise<PendingMap> {
  const row = await db.setting.findUnique({ where: { key: PENDING_KEY } }).catch(() => null);
  if (!row?.value) return {};
  try {
    return JSON.parse(row.value) as PendingMap;
  } catch {
    return {};
  }
}

async function writePending(map: PendingMap): Promise<void> {
  await db.setting.upsert({
    where: { key: PENDING_KEY },
    update: { value: JSON.stringify(map) },
    create: { key: PENDING_KEY, value: JSON.stringify(map) },
  });
}

function prune(map: PendingMap): PendingMap {
  const now = Date.now();
  const out: PendingMap = {};
  for (const [k, v] of Object.entries(map)) if (now - v.at < PENDING_TTL) out[k] = v;
  return out;
}

export async function listPending(): Promise<PendingCmd[]> {
  const map = prune(await readPending());
  await writePending(map);
  return Object.values(map).sort((a, b) => b.at - a.at);
}

// ตั้งคำขอใหม่ (1 ใบแจ้งเตือน = 1 คำสั่ง) — service เดิมทับของเก่า ไม่สะสมซ้ำ
export async function addPending(service: string, script: string, chatId: string): Promise<PendingCmd | null> {
  if (!isAllowedScript(script)) return null;
  const map = prune(await readPending());
  const item: PendingCmd = { id: service.toLowerCase(), service: service.toLowerCase(), script, at: Date.now(), chatId: String(chatId) };
  map[item.id] = item;
  await writePending(map);
  return item;
}

export async function clearPending(id: string): Promise<void> {
  const map = prune(await readPending());
  delete map[id];
  await writePending(map);
}

/**
 * ตีความคำว่า "รันเลย" ว่าหมายถึงคำขอใบไหน
 *  - ระบุชื่อ service/script ในข้อความ → ใบนั้น
 *  - reply ใบแจ้งเตือน (replyText มีชื่อ service) → ใบนั้น
 *  - เหลือใบเดียว → ใบนั้น
 *  - หลายใบ ไม่ระบุ → คืน ambiguous ให้ไปถามก่อน (ห้ามเดา)
 */
export async function resolveConfirm(
  text: string,
  replyText = "",
): Promise<{ picked?: PendingCmd; ambiguous?: PendingCmd[]; none?: boolean }> {
  const items = await listPending();
  if (!items.length) return { none: true };
  const hay = `${text} ${replyText}`.toLowerCase();
  const named = items.filter((i) => hay.includes(i.service) || hay.includes(i.script.toLowerCase()));
  if (named.length === 1) return { picked: named[0] };
  if (named.length > 1) return { ambiguous: named };
  if (items.length === 1) return { picked: items[0] };
  return { ambiguous: items };
}

export const CONFIRM_RE = /^\s*(รันเลย|รันได้เลย|เอาเลย|จัดเลย|ทำเลย|ok\s*run|run\s*it|ยืนยัน(รัน)?)\s*[ค่ะครับนะ.!]*\s*$/i;
export const CONFIRM_LOOSE_RE = /(รันเลย|รันได้เลย|รันให้เลย|เอาเลย|จัดเลย|ทำเลย|ยืนยันรัน)/i;

// ===== รันจริง =====
export interface RunResult {
  script: string;
  code: number | null;
  timedOut: boolean;
  tail: string; // 5 บรรทัดท้ายของ output
}

/**
 * รัน `npm run <script>` ในโปรเจกต์ — ไม่ผ่าน shell (spawn ตรง, ไม่มี shell:true)
 * จึงไม่มีทางที่ข้อความจากแชทจะกลายเป็นคำสั่งอื่นได้
 */
export function runNpmScript(script: string, timeoutMs = RUN_TIMEOUT): Promise<RunResult> {
  return new Promise((resolve) => {
    if (!isAllowedScript(script)) {
      resolve({ script, code: null, timedOut: false, tail: "คำสั่งนี้ไม่อยู่ในรายการที่อนุญาต" });
      return;
    }
    const npmPath = process.env.NPM_PATH?.trim() || "/Users/mx/.local/bin/npm";
    const child = spawn(npmPath, ["run", script], {
      cwd: projectRoot(),
      detached: true, // แยก process group — auth เด้งหน้าต่างล็อกอินค้างได้โดยไม่ผูกกับ request
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    let out = "";
    let done = false;
    const finish = (code: number | null, timedOut: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
      resolve({ script, code, timedOut, tail: lines.slice(-5).join("\n") });
    };
    const timer = setTimeout(() => {
      try { process.kill(-child.pid!, "SIGTERM"); } catch { /* จบไปแล้ว */ }
      finish(null, true);
    }, timeoutMs);
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.stderr?.on("data", (d) => (out += d.toString()));
    child.on("error", (e) => { out += `\n${e.message}`; finish(null, false); });
    child.on("close", (code) => finish(code, false));
  });
}

// เช็คว่าเซสชันกลับมาหรือยัง (ไฟล์ session ถูกเขียนใหม่ภายใน 10 นาที = เพิ่งล็อกอินสำเร็จ)
const SESSION_FILE: Record<string, string> = {
  refund: ".thunder-session.json",
  thunder: ".thunder-session.json",
  oho: ".oho-session.json",
  fb: ".fb-session.json",
  line: ".line-session.json",
  drive: ".drive-token.json",
};

export function sessionFreshness(service: string): string | null {
  const f = SESSION_FILE[service.toLowerCase()];
  if (!f) return null;
  try {
    const st = fs.statSync(path.join(projectRoot(), f));
    const mins = Math.round((Date.now() - st.mtimeMs) / 60000);
    return mins <= 10 ? `เซสชันกลับมาแล้ว ✅ (เพิ่งบันทึกเมื่อ ${mins} นาทีที่แล้ว)` : `⚠️ ไฟล์เซสชันยังเป็นของเก่า (${mins} นาทีที่แล้ว) — อาจยังล็อกอินไม่สำเร็จ`;
  } catch {
    return "⚠️ ยังไม่พบไฟล์เซสชัน — น่าจะยังล็อกอินไม่สำเร็จ";
  }
}

/**
 * โฟลเดอร์ "ภาพหลักฐาน" ที่สคริปต์แต่ละตัวแคปเฉพาะหน้าต่างงานของตัวเองมาวางไว้
 * จงใจไม่แคปทั้งหน้าจอ — ห้องคุมระบบมีคนอื่นอยู่ด้วย ภาพเต็มจอจะพางานส่วนตัวหลุดไปโชว์
 * (พี่โด้เจอเคสจริง 3 ส.ค. 2026: แคปหลังรันเสร็จติดหน้าจองานที่เปิดค้างไว้ทั้งหมด)
 */
export function shotsDir(): string {
  const d = path.join(projectRoot(), ".run-logs", "shots");
  try { fs.mkdirSync(d, { recursive: true }); } catch { /* มีอยู่แล้ว */ }
  return d;
}

export function shotPathFor(script: string): string {
  return path.join(shotsDir(), `${script.replace(/[^a-zA-Z0-9]+/g, "-")}.png`);
}

// เอาเฉพาะภาพที่ "เพิ่งถูกเขียนในรอบนี้" — กันหยิบภาพเก่าจากการรันครั้งก่อนมารายงานผิด
function freshShot(script: string, sinceMs: number): Buffer | null {
  const p = shotPathFor(script);
  try {
    if (fs.statSync(p).mtimeMs + 2000 < sinceMs) return null;
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

/**
 * รันแล้วรายงานผลกลับเข้าห้อง (ทำงานเบื้องหลัง — ไม่ผูกกับ HTTP request เพราะ auth ใช้เวลาได้ถึง 10 นาที)
 * รายงาน: คำสั่งอะไร · exit code · tail 5 บรรทัด · สถานะเซสชัน · แนบเฉพาะภาพหน้าต่างที่วานทำงาน (ถ้าสคริปต์แคปไว้ให้)
 */
export async function runAndReport(item: PendingCmd, tagLine: string): Promise<void> {
  const startedAt = Date.now();
  const r = await runNpmScript(item.script);
  const head = r.timedOut
    ? `⏱️ <b>${item.service.toUpperCase()} — หมดเวลา 10 นาที</b>`
    : r.code === 0
      ? `✅ <b>${item.service.toUpperCase()} — รันเสร็จแล้ว</b>`
      : `❌ <b>${item.service.toUpperCase()} — รันไม่สำเร็จ</b>`;
  const fresh = sessionFreshness(item.service);
  const body =
    `${tagLine}${head}\n` +
    `คำสั่ง: <code>npm run ${item.script}</code>\n` +
    `exit code: ${r.timedOut ? "หมดเวลา" : r.code}\n` +
    (fresh ? `${fresh}\n` : "") +
    (r.tail ? `\n<b>ท้าย output</b>\n<pre>${escapeHtml(r.tail)}</pre>` : "");

  // แนบเฉพาะภาพหน้าต่างที่สคริปต์แคปไว้เอง — ไม่มีก็ส่งข้อความล้วน (ห้ามแคปเต็มจอเด็ดขาด)
  const shot = freshShot(item.script, startedAt);
  if (shot && getBotToken()) {
    try {
      await tgSendPhoto(item.chatId, shot, body.slice(0, 1024), "result.png", { parse_mode: "HTML" });
      // caption จำกัด 1024 ตัว — ถ้ายาวกว่านั้นส่งเนื้อเต็มตามอีกใบ
      if (body.length > 1024) await tgSendMessage(item.chatId, body, { parse_mode: "HTML" });
      fs.unlink(shotPathFor(item.script), () => {}); // ใช้แล้วลบ ไม่ให้ค้างไว้ให้หยิบผิดรอบ
      return;
    } catch { /* ส่งภาพไม่ได้ → ส่งข้อความอย่างเดียว */ }
  }
  await tgSendMessage(item.chatId, body, { parse_mode: "HTML" }).catch(() => {});
}

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}
