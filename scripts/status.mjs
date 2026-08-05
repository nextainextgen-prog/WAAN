#!/usr/bin/env node
/**
 * CHANGOH · SYSTEM STATUS — มอนิเตอร์กล่องแยกโซน
 *
 *   npm run status          รีเฟรชทุก 15 วิ
 *   npm run status -- 5     รีเฟรชทุก 5 วิ
 *   npm run status:once     เช็ครอบเดียวแล้วออก
 *
 * ทำไมเป็น Node ไม่ใช่ bash: กรอบกล่องต้องรู้ "ความกว้างที่แสดงจริง" ของข้อความ
 * แต่ภาษาไทยมีสระ/วรรณยุกต์ที่กิน 0 คอลัมน์ และอิโมจิกิน 2 คอลัมน์
 * bash นับได้แค่ไบต์/ตัวอักษร → ขอบขวาเบี้ยวทุกบรรทัดที่มีไทย
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { collectVex, ENV, ago, shortAgo, nf, baht } from "./status-vex.mjs";
import { collectGemini, geminiLines } from "./usage-gemini.mjs";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const LOGS = path.join(ROOT, ".run-logs");
const WEB = "http://localhost:3000";
const WINDOW = 300_000; // log ที่เขียนภายใน 5 นาที ถือว่าเป็นปัญหา "สด"

const argRaw = process.argv[2] || "15";
const ONCE = argRaw === "once";
const REFRESH = ONCE ? 0 : Math.max(2, Number(argRaw) || 15);

// ══════════════════ สี ══════════════════
const C = {
  r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", c: "\x1b[36m", m: "\x1b[35m",
  b: "\x1b[1m", d: "\x1b[2m", n: "\x1b[0m",
};

// ══════════════════ ความกว้างที่แสดงจริง ══════════════════
/** อักขระที่กิน 0 คอลัมน์ (สระบน/ล่าง + วรรณยุกต์ไทย, combining marks, ZWJ, variation selector) */
function isZeroWidth(cp) {
  return (
    cp === 0x0e31 || (cp >= 0x0e34 && cp <= 0x0e3a) || (cp >= 0x0e47 && cp <= 0x0e4e) || // ไทย
    (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x1ab0 && cp <= 0x1aff) ||                   // combining ทั่วไป
    cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0xfeff || cp === 0xfe0f
  );
}
/** อักขระที่กิน 2 คอลัมน์ (CJK + อิโมจิ) */
function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0x303e) || (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f9ff) || (cp >= 0x1fa70 && cp <= 0x1faff) || (cp >= 0x1f000 && cp <= 0x1f2ff)
  );
}
/**
 * สัญลักษณ์ใน BMP ที่แสดงเป็นอิโมจิโดยปริยาย (Emoji_Presentation=Yes) → กิน 2 คอลัมน์
 * ตัวที่ไม่อยู่ในลิสต์นี้ (เช่น ● ▲ ✕ ที่ใช้ทำตาราง) กิน 1 คอลัมน์ตามปกติ
 * เคสจริงที่ทำให้กล่องเบี้ยว: ⚡ (U+26A1) ในชื่อกลุ่ม Telegram
 */
function isEmojiPresentation(cp) {
  return (
    (cp >= 0x231a && cp <= 0x231b) || (cp >= 0x23e9 && cp <= 0x23ec) || cp === 0x23f0 || cp === 0x23f3 ||
    (cp >= 0x25fd && cp <= 0x25fe) || (cp >= 0x2614 && cp <= 0x2615) || (cp >= 0x2648 && cp <= 0x2653) ||
    cp === 0x267f || cp === 0x2693 || cp === 0x26a1 || (cp >= 0x26aa && cp <= 0x26ab) ||
    (cp >= 0x26bd && cp <= 0x26be) || (cp >= 0x26c4 && cp <= 0x26c5) || cp === 0x26ce || cp === 0x26d4 ||
    cp === 0x26ea || (cp >= 0x26f2 && cp <= 0x26f3) || cp === 0x26f5 || cp === 0x26fa || cp === 0x26fd ||
    cp === 0x2705 || (cp >= 0x270a && cp <= 0x270b) || cp === 0x2728 || cp === 0x274c || cp === 0x274e ||
    (cp >= 0x2753 && cp <= 0x2755) || cp === 0x2757 || (cp >= 0x2795 && cp <= 0x2797) || cp === 0x27b0 ||
    cp === 0x27bf || (cp >= 0x2b1b && cp <= 0x2b1c) || cp === 0x2b50 || cp === 0x2b55
  );
}
const STRIP_ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
export function dw(s) {
  const chars = [...String(s).replace(STRIP_ANSI, "")];
  let w = 0;
  for (let i = 0; i < chars.length; i++) {
    const cp = chars[i].codePointAt(0);
    if (isZeroWidth(cp)) continue;
    // สัญลักษณ์ธรรมดาที่มี VS16 (U+FE0F) ตามหลัง จะถูกบังคับให้แสดงเป็นอิโมจิ = กิน 2 คอลัมน์
    const vs16 = chars[i + 1]?.codePointAt(0) === 0xfe0f;
    const forcedEmoji = vs16 && cp >= 0x2000 && cp <= 0x2bff;
    w += isWide(cp) || isEmojiPresentation(cp) || forcedEmoji ? 2 : 1;
  }
  return w;
}
const padR = (s, w) => s + " ".repeat(Math.max(0, w - dw(s)));
function trunc(s, w) {
  if (dw(s) <= w) return s;
  let out = "";
  for (const ch of String(s)) {
    if (dw(out + ch) > w - 1) break;
    out += ch;
  }
  return out + "…";
}

// ══════════════════ ตัวเก็บข้อมูลระบบ ══════════════════
const sh = (cmd, args, ms = 6000) => {
  try { return execFileSync(cmd, args, { encoding: "utf8", timeout: ms, stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return ""; }
};
const curl = (url, ms = 5) => sh("curl", ["-s", "--max-time", String(ms), url], (ms + 2) * 1000);

let LAUNCH = "";
let PSLIST = "";
function refreshProcTables() {
  LAUNCH = sh("launchctl", ["list"]);
  PSLIST = sh("ps", ["-Ao", "etime=,command="]);
}
function pidOf(label) {
  for (const line of LAUNCH.split("\n")) {
    const f = line.split("\t");
    if (f[2] === label) return f[0];
  }
  return "";
}
function uptimeOf(match) {
  for (const line of PSLIST.split("\n")) {
    if (!line.includes(match) || line.includes("grep ")) continue;
    const e = line.trim().split(/\s+/)[0];
    let days = 0, rest = e;
    if (rest.includes("-")) { days = Number(rest.split("-")[0]); rest = rest.split("-")[1]; }
    const p = rest.split(":").map(Number);
    const [hh, mm] = p.length === 3 ? [p[0], p[1]] : [0, p[0]];
    const th = days * 24 + hh;
    if (th >= 24) return `${Math.floor(th / 24)}d ${th % 24}h`;
    if (th > 0) return `${th}h ${mm}m`;
    return `${mm}m`;
  }
  return "—";
}

const AUTHERR = /invalid_grant|unauthorized|Unauthorized|login required|เข้าสู่ระบบ|ต้องล็อกอิน| 401 |403 |sign.?in|เซสชันหมด/;
const CODEERR = /MODULE_NOT_FOUND|UnhandledPromise|TypeError|ReferenceError|EADDRINUSE|SyntaxError/;
const SOFTERR = /ENOTFOUND|fetch failed|scan fail|browser has been closed|ECONNREFUSED|ETIMEDOUT/;
const BANNER = /พร้อมทำงาน|เฝ้า|poll ทุก|watching|ready|กำลังต่อกลับ/;

/** คืน {state, msg, note} — state: OK | WARN | AUTH | DOWN */
function checkService(svc) {
  const pid = pidOf(svc.label);
  if (!pid || pid === "-") return { state: "DOWN", msg: `ไม่ได้รัน — watchdog จะปลุกให้ (launchctl kickstart -k gui/$UID/${svc.label})` };

  if (svc.web) {
    const code = sh("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "6", WEB], 8000).trim();
    return /^(200|30[1278])$/.test(code)
      ? { state: "OK", msg: `${svc.role} · HTTP ${code} · pid ${pid}` }
      : { state: "DOWN", msg: `ไม่ตอบสนอง (curl=${code || "timeout"}) — ดู .run-logs/${svc.log}` };
  }

  const lf = path.join(LOGS, svc.log);
  if (!fs.existsSync(lf)) return { state: "OK", msg: `${svc.role} · pid ${pid} (ยังไม่มี log)` };

  let note = "";
  let tail = [];
  try {
    const raw = fs.readFileSync(lf, "utf8");
    tail = raw.split("\n").slice(-60);
    if (svc.label === "com.changoh.bot" && tail.slice(-30).some((l) => l.includes("TOPIC_CLOSED")))
      note = "มีหัวข้อในกลุ่ม Telegram ถูกปิดอยู่ — เปิดใหม่หรือย้ายปลายทาง";
  } catch {}

  const age = Date.now() - (fs.statSync(lf).mtimeMs || 0);
  if (age < WINDOW) {
    let last = -1;
    tail.forEach((l, i) => { if (BANNER.test(l)) last = i; });
    const after = tail.slice(last + 1);
    const hits = (re) => after.filter((l) => re.test(l));
    const a = hits(AUTHERR), c = hits(CODEERR), s = hits(SOFTERR);
    if (a.length && svc.auth) return { state: "AUTH", msg: `เซสชันน่าจะหมดอายุ → ${svc.auth} · ${trunc(a.at(-1).trim(), 40)}`, note };
    if (c.length) return { state: "WARN", msg: `บั๊กโค้ด: ${trunc(c.at(-1).trim(), 56)}`, note };
    if (s.length >= 3) return { state: "WARN", msg: `ผิดพลาดซ้ำ ×${s.length}: ${trunc(s.at(-1).trim(), 44)}`, note };
    if (s.length) return { state: "OK", msg: `${svc.role} · pid ${pid}`, note: `${note ? note + " · " : ""}สะดุดชั่วคราว ×${s.length} — ต่อกลับเองอยู่` };
  }
  return { state: "OK", msg: `${svc.role} · pid ${pid}`, note };
}

const WAAN_SERVICES = [
  { name: "web", label: "com.changoh.web", log: "dev.log", role: "Web/API :3000", ps: "next dev", web: true },
  { name: "bot", label: "com.changoh.bot", log: "bot.log", role: "Telegram น้องวาน", ps: "telegram-bot.mjs" },
  { name: "drive", label: "com.changoh.drive", log: "drive.log", role: "Google Drive watcher", ps: "drive-watch.mjs", auth: "npm run drive:auth" },
  { name: "oho", label: "com.changoh.oho", log: "oho.log", role: "OHO chat watcher", ps: "oho-watch.mjs", auth: "npm run oho:auth" },
  { name: "fb", label: "com.changoh.fb", log: "fb.log", role: "Facebook inbox watcher", ps: "fb-watch.mjs", auth: "npm run fb:auth" },
  { name: "line", label: "com.changoh.line", log: "line.log", role: "LINE OA watcher", ps: "line-watch.mjs", auth: "npm run line:auth" },
  { name: "refund", label: "com.changoh.refund", log: "refund.log", role: "Thunder คืนเครดิต", ps: "refund-watch.mjs", auth: "npm run thunder:auth" },
];
const VEX_SERVICES = [
  { name: "kiki", label: "com.changoh.kiki", log: "kiki.log", role: "ท่อ Telegram", ps: "kiki-bot.mjs", auth: "npm run kiki:tg-auth" },
  { name: "discord", label: "com.changoh.vexdiscord", log: "vex-discord.log", role: "ท่อ Discord (ข้อความ+เสียง)", ps: "kiki-discord.mjs" },
  { name: "eyes", label: "com.changoh.vexeyes", log: "vex-eyes.log", role: "ตาเฝ้าเหตุการณ์ขาเข้า", ps: "vex-eyes.mjs" },
];

// ══════════════════ ตัววาดกล่อง ══════════════════
const GLYPH = { OK: "●", WARN: "▲", AUTH: "◆", DOWN: "✕", INFO: "·" };
const COLOR = { OK: C.g, WARN: C.y, AUTH: C.m, DOWN: C.r, INFO: C.d };
const WORD = { OK: "UP", WARN: "WARN", AUTH: "AUTH", DOWN: "DOWN", INFO: "" };

class Box {
  constructor(width, color) { this.w = width; this.color = color; this.lines = []; }
  top(title, right = "") {
    const inner = this.w - 2;
    const l = ` ${title} `, r = right ? ` ${right} ` : "";
    const fill = Math.max(1, inner - dw(l) - dw(r) - 1);
    this.lines.push(`${this.color}╭─${C.n}${this.color}${C.b}${l}${C.n}${this.color}${"─".repeat(fill)}${C.d}${r}${C.n}${this.color}─╮${C.n}`);
  }
  divider(label = "") {
    const inner = this.w - 2;
    if (!label) { this.lines.push(`${this.color}├${"─".repeat(inner)}┤${C.n}`); return; }
    const l = ` ${label} `;
    this.lines.push(`${this.color}├─${C.n}${C.d}${l}${C.n}${this.color}${"─".repeat(Math.max(1, inner - dw(l) - 1))}┤${C.n}`);
  }
  /** raw = ข้อความที่มีสีอยู่แล้ว, plain = ข้อความเดียวกันแบบไม่มีสี (ใช้วัดความกว้าง) */
  row(raw, plain) {
    const gap = Math.max(0, this.w - 2 - dw(plain ?? raw) - 2);
    this.lines.push(`${this.color}│${C.n} ${raw}${" ".repeat(gap)} ${this.color}│${C.n}`);
  }
  text(s) { this.row(trunc(s, this.w - 4)); }
  bottom() { this.lines.push(`${this.color}╰${"─".repeat(this.w - 2)}╯${C.n}`); }
}

function serviceRow(box, name, st, uptime, msg) {
  const g = `${COLOR[st]}${GLYPH[st]}${C.n}`;
  const w = `${COLOR[st]}${C.b}${padR(WORD[st], 5)}${C.n}`;
  const head = `${g} ${padR(name, 9)} ${w} ${padR(uptime, 9)} `;
  const budget = box.w - 4 - dw(`${GLYPH[st]} ${padR(name, 9)} ${padR(WORD[st], 5)} ${padR(uptime, 9)} `);
  const det = trunc(msg, budget);
  box.row(head + (st === "OK" ? C.d + det + C.n : det), `${GLYPH[st]} ${padR(name, 9)} ${padR(WORD[st], 5)} ${padR(uptime, 9)} ${det}`);
}
function noteRow(box, text) {
  const t = trunc(text, box.w - 10);
  box.row(`${C.d}      ↳ ${t}${C.n}`, `      ↳ ${t}`);
}
function bar(v, max, len = 12) {
  const f = Math.min(len, Math.max(0, Math.round((v / Math.max(1, max)) * len)));
  return `${"█".repeat(f)}${C.d}${"░".repeat(len - f)}${C.n}`;
}
function meterRow(box, label, value, max, tail, warn = false) {
  const lbl = padR(label, 14);
  const num = String(value).padStart(3);
  const t = trunc(tail, box.w - 4 - dw(lbl) - 12 - 1 - 3 - 3);
  const raw = `${lbl}${bar(value, max)} ${warn ? C.y : ""}${num}${warn ? C.n : ""}   ${C.d}${t}${C.n}`;
  box.row(raw, `${lbl}${"░".repeat(12)} ${num}   ${t}`);
}
function pairRow(box, label, text) {
  const lbl = padR(label, 13);
  const t = trunc(text, box.w - 4 - dw(lbl));
  box.row(`${C.c}${lbl}${C.n}${t}`, `${lbl}${t}`);
}

// ══════════════════ ประกอบทั้งหน้า ══════════════════
let FRAME = [];
let WORST = "OK";

/**
 * usage-cli.mjs เดินไฟล์ทั้ง ~/.claude/projects (1,700+ ไฟล์ · 1.2 GB) ใช้เวลา ~3.7 วิต่อครั้ง
 * ถ้าเรียกทุกรอบรีเฟรช (15 วิ) จะกินดิสก์กับซีพียูราว 25% ของเวลาที่เปิดจออยู่ โดยไม่ได้อะไรเพิ่ม
 * — ตัวเลขโทเค็นขยับช้ากว่านั้นมาก แคช 60 วินาทีก็เกินพอ
 * (เคสจริง 5 ส.ค.: การ์ดมอนิเตอร์ฝั่งเว็บอ่านโฟลเดอร์เดียวกันทุก 30 วิ จนแรมบวมแล้วเว็บถูกฆ่าทิ้งทั้งเช้า)
 */
const USAGE_TTL = 60_000;
let usageCache = { at: 0, text: "" };
function cachedUsage() {
  if (Date.now() - usageCache.at < USAGE_TTL) return usageCache.text;
  const text = sh("node", [path.join(ROOT, "scripts", "usage-cli.mjs")], 15000).trim();
  // อ่านไม่ได้ = ใช้ค่าเดิมต่อ ดีกว่าโชว์ช่องว่าง
  if (text) usageCache = { at: Date.now(), text };
  else usageCache.at = Date.now();
  return usageCache.text;
}

function build() {
  const cols = process.stdout.columns || 100;
  const W = Math.max(64, Math.min(cols - 2, 96));
  const out = [];
  let worst = "OK";
  const bump = (s) => {
    if (s === "DOWN" || s === "AUTH") worst = "BAD";
    else if (s === "WARN" && worst === "OK") worst = "WARN";
  };

  refreshProcTables();

  // ---------- โซน 1 · บริษัท ----------
  const waan = WAAN_SERVICES.map((s) => ({ s, r: checkService(s) }));
  const up = waan.filter((x) => x.r.state === "OK").length;
  const bad = waan.length - up;
  const b1 = new Box(W, C.c);
  b1.top("WAAN · ระบบบริษัท", bad ? `${up} ขึ้น · ${bad} มีปัญหา` : `${up} ขึ้นครบ`);
  for (const { s, r } of waan) {
    serviceRow(b1, s.name, r.state, r.state === "DOWN" ? "—" : uptimeOf(s.ps), r.msg);
    if (r.note) noteRow(b1, r.note);
    bump(r.state);
  }
  b1.divider("คลังกลาง");
  // gtoken
  const tf = path.join(ROOT, ".drive-token.json");
  if (fs.existsSync(tf)) {
    try {
      const t = JSON.parse(fs.readFileSync(tf, "utf8"));
      const mins = t.expiry_date ? Math.round((t.expiry_date - Date.now()) / 60000) : null;
      pairRow(b1, "gtoken", `refresh_token ปกติ${(t.scope || "").includes("calendar") ? " · มี calendar scope" : ""}${mins !== null ? (mins > 0 ? ` · access หมดใน ${mins}m` : " · access หมดแล้ว (ต่อเอง)") : ""}`);
    } catch { pairRow(b1, "gtoken", "อ่าน .drive-token.json ไม่ได้"); }
  } else { pairRow(b1, "gtoken", "ไม่มี .drive-token.json → npm run drive:auth"); bump("AUTH"); }
  // ollama
  const oll = curl("http://localhost:11434/api/tags", 4);
  if (oll.includes("bge-m3")) pairRow(b1, "ollama", "bge-m3 พร้อม · semantic search ใช้ได้");
  else { pairRow(b1, "ollama", "bge-m3 ไม่พร้อม · semantic search ปิดอยู่"); bump("WARN"); }
  // brain / chat
  const q = (sql) => sh("sqlite3", [path.join(ROOT, "prisma", "changoh.db"), sql]).trim();
  const brain = q("SELECT (SELECT COUNT(*) FROM Customer)||' ลูกค้า · '||(SELECT COUNT(*) FROM CustomerFact)||' ข้อเท็จจริง · '||(SELECT COUNT(*) FROM ThunderKnowledge)||' Q&A'");
  const chat = q("SELECT (SELECT COUNT(*) FROM ChatLog)||' บทสนทนา · วิเคราะห์แล้ว '||(SELECT COUNT(*) FROM ChatLog WHERE analyzed=1)||' · รายงาน '||(SELECT COUNT(*) FROM DailyReport)||' วัน'");
  pairRow(b1, "brain", brain || "ยังไม่มีข้อมูล");
  pairRow(b1, "chat", chat || "ยังไม่มีข้อมูล");
  b1.bottom();
  out.push(...b1.lines, "");

  // ---------- โซน 2 · Vex ----------
  const V = collectVex();
  const callTag = V.call
    ? `${V.call.inVoice ? "อยู่ในสาย" : "ไม่อยู่ในสาย"} · ${V.call.awake ? `กำลังคุย (${V.call.awakeSec} วิ)` : "โหมดเรียกชื่อ"}`
    : "อ่านสถานะไม่ได้";
  const b2 = new Box(W, C.m);
  b2.top("VEX · เลขาส่วนตัวของโด้", callTag);

  for (const s of VEX_SERVICES) {
    const r = checkService(s);
    serviceRow(b2, s.name, r.state, r.state === "DOWN" ? "—" : uptimeOf(s.ps), r.msg);
    if (r.note) noteRow(b2, r.note);
    bump(r.state);
  }
  // chrome: launchd เป็น one-shot (KeepAlive false) เช็ค pid ไม่ได้ ต้องเคาะพอร์ตดีบักเอง
  const cv = curl("http://localhost:9222/json/version", 3).match(/"Browser":\s*"([^"]+)"/);
  if (cv) serviceRow(b2, "chrome", "OK", "—", `Chrome ตัวจริง :9222 · ${cv[1]}`);
  else { serviceRow(b2, "chrome", "WARN", "—", "Chrome ตัวจริงไม่เปิด → npm run kiki:chrome"); bump("WARN"); }

  if (V.error) {
    b2.divider();
    b2.text(`${C.r}${V.error}${C.n}`);
  } else {
    // ----- แถบวัดสถานะสด -----
    b2.divider("สถานะสด");
    if (V.queue) {
      const t = [`รอพูด ${V.queue.voice} · รอโพสต์ ${V.queue.text}`, V.queue.oldest ? `เก่าสุด ${shortAgo(V.queue.oldest)}` : "", `ส่งวันนี้ ${V.queue.sentToday}`].filter(Boolean).join(" · ");
      meterRow(b2, "คิวพูด", V.queue.total, 10, t, V.queue.stuck > 0 || V.queue.err > 0);
      if (V.queue.stuck) { noteRow(b2, `ค้างลองซ้ำ ${V.queue.stuck} รายการ — ดู .run-logs/vex-discord.log`); bump("WARN"); }
    }
    if (V.pile) meterRow(b2, "กองรอเล่า", V.pile.n, 10, V.pile.last ? `"${V.pile.last}"` : "ไม่มีเรื่องรอเล่า", V.pile.n >= 10);
    if (V.focus) meterRow(b2, "เรื่องค้าง", V.focus.n, 10, V.focus.last ? `"${V.focus.last}"` : "ไม่มีเรื่องค้าง");
    if (V.tasks) meterRow(b2, "งานค้าง", V.tasks.open, 10, `ด่วน ${V.tasks.high} · ครบกำหนด ${V.tasks.due} · ปิดวันนี้ ${V.tasks.doneToday}`, V.tasks.due > 0);
    if (V.money) meterRow(b2, "รอระบุเงิน", V.money.pending, 30, V.money.pending >= 10 ? "สะสมเยอะแล้ว — ถามทีเดียวรวบได้" : "ปกติ", V.money.pending >= 10);
    if (V.hermes) meterRow(b2, "งานเบื้องหลัง", V.hermes.run, 3, `รอคิว ${V.hermes.pend} · เสร็จวันนี้ ${V.hermes.done} · ล้มเหลว ${V.hermes.fail}${V.hermes.top ? ` · "${V.hermes.top.task}"` : ""}`, V.hermes.fail > 0);
    if (V.hermes?.fail) bump("WARN");

    // ----- เรื่องที่ต้องตัดสินใจ -----
    const alerts = [];
    if (V.draft) alerts.push(`ร่างถึง ${V.draft.peer} รอยืนยัน${V.draft.msg ? ` · "${V.draft.msg}"` : " · (ยังไม่มีเนื้อความ)"}`);
    if (V.session?.some((s) => !s.ok)) alerts.push(`กุญแจขาด: ${V.session.filter((s) => !s.ok).map((s) => s.fix).join(" · ")}`);
    if (V.voice?.quotaBad?.length) alerts.push(`โควตาตัน: ${V.voice.quotaBad.join(", ")}`);
    if (alerts.length) {
      b2.divider("รอโด้ตัดสินใจ");
      for (const a of alerts) { const t = trunc(a, W - 8); b2.row(`${C.y}▲${C.n} ${t}`, `▲ ${t}`); }
      bump("WARN");
    }

    // ----- ข้อมูลสะสม -----
    b2.divider("ข้อมูล");
    if (V.doing !== undefined) pairRow(b2, "กำลังทำ", V.doing ? `${V.doing.text} (${ago(V.doing.at)})` : "ว่าง");
    if (V.call) pairRow(b2, "ได้ยินล่าสุด", `${ago(V.call.heardAt)}${V.call.topic ? ` · เรื่อง "${V.call.topic}"` : ""}`);
    if (V.memory) {
      const ch = V.memory.byChannel.map((r) => `${r.channel} ${nf(r.c)}`).join(" · ");
      pairRow(b2, "ความจำ", `ข้อเท็จจริง ${nf(V.memory.facts)} · สรุปยาว ${nf(V.memory.longterm)} · บทสนทนา ${nf(V.memory.chats)} (${ch}) · วันนี้ ${V.memory.today}`);
    }
    if (V.vault) pairRow(b2, "คลัง", V.vault.ok ? `AI-Personal · โน้ต ${nf(V.vault.notes)} ไฟล์ · vector ${V.vault.vec ?? "—"} · รูป/วิดีโอ ${nf(V.vault.media)}` : `หา AI-Personal ไม่เจอ (${V.vault.path || "ไม่ได้ตั้ง OBSIDIAN_VAULT_PATH"})`);
    if (V.money) pairRow(b2, "เงิน", `เดือนนี้จ่าย ${baht(V.money.expMonth)} ฿ · วันนี้ ${baht(V.money.expToday.s)} ฿ (${V.money.expToday.c} รายการ) · รับ ${baht(V.money.incToday)} ฿ · ${V.money.budget ? `งบเหลือ ${baht(V.money.budget - V.money.expMonth)} ฿` : "ยังไม่ตั้งงบเดือน"}`);
    if (V.agenda) pairRow(b2, "นัด", `วันนี้ ${V.agenda.today} · พรุ่งนี้ ${V.agenda.tomorrow}${V.agenda.next ? ` · ถัดไป ${V.agenda.next.time} ${V.agenda.next.title}` : " · ไม่มีนัดข้างหน้า"}`);
    if (V.voice) pairRow(b2, "เสียง", `${V.voice.name} · เรียก TTS วันนี้ ${V.voice.calls} ครั้ง${V.voice.models.length ? ` (${V.voice.models.join(" · ")})` : ""}`);
    if (V.session) pairRow(b2, "กุญแจ", V.session.map((s) => `${s.name} ${s.ok ? "ปกติ" : "ขาด"}`).join(" · "));
  }
  b2.bottom();
  out.push(...b2.lines, "");

  // ---------- โซน 3 · โทเค็น/ค่าใช้จ่าย ----------
  const usage = cachedUsage();
  const gem = geminiLines(collectGemini());
  if (usage || gem.length) {
    const b3 = new Box(W, C.c);
    b3.top("AI USAGE · โทเค็น · ค่าใช้จ่าย · บริบท");
    if (usage) for (const l of usage.split("\n")) b3.text(l);
    // Claude/Codex เป็นค่าสมาชิกรายเดือน ตัวเลข $ เป็นมูลค่าเทียบเคียง
    // แต่ Gemini คิดเงินจริงตามโทเค็น — แยกบรรทัดให้เห็นชัดว่าอันนี้คือเงินที่จ่ายจริง
    if (gem.length) {
      if (usage) b3.divider();
      for (const l of gem) b3.text(l);
    }
    b3.bottom();
    out.push(...b3.lines, "");
  }

  FRAME = out;
  WORST = worst;
}

// ══════════════════ วาดออกจอ ══════════════════
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BARMSG = { OK: "ทำงานปกติ — ไม่มีปัญหา", WARN: "มีบางอย่างต้องดู — ดูแถวที่ไฮไลต์ไว้", BAD: "มีปัญหา — บริการล่มหรือต้องล็อกอินใหม่" };
const BARBG = { OK: "\x1b[42m\x1b[30m", WARN: "\x1b[43m\x1b[30m", BAD: "\x1b[41m\x1b[97m" };

function draw(tick) {
  const cols = process.stdout.columns || 100;
  const W = Math.max(64, Math.min(cols - 2, 96));
  const clk = new Date().toLocaleTimeString("en-GB");
  const sp = SPIN[Math.floor(tick / 2) % SPIN.length];
  const head = ` ${sp}  ${C.b}CHANGOH · SYSTEM STATUS${C.n}`;
  const right = `${C.d}live · ${clk}${C.n}`;
  const gap = Math.max(1, W - dw(head.replace(STRIP_ANSI, "")) - dw(`live · ${clk}`));

  let s = "\x1b[H";
  s += head + " ".repeat(gap) + right + "\x1b[K\n";
  s += `${C.d}    รีเฟรชทุก ${REFRESH || "-"} วิ · Ctrl+C เพื่อออก${C.n}\x1b[K\n\x1b[K\n`;
  for (const l of FRAME) s += l + "\x1b[K\n";

  const msg = `   ${BARMSG[WORST]}   `;
  const bw = Math.min(W, dw(msg) + 14);
  const pad = Math.floor((bw - dw(msg)) / 2);
  const barTxt = " ".repeat(pad) + msg + " ".repeat(Math.max(0, bw - pad - dw(msg)));
  s += ` ${BARBG[WORST]}${barTxt}${C.n}\x1b[K\n`;
  s += "\x1b[J";
  process.stdout.write(s);
}

if (ONCE) {
  build();
  process.stdout.write("\x1b[2J");
  draw(0);
  process.stdout.write("\n");
  process.exit(0);
}

process.stdout.write("\x1b[?25l\x1b[2J");
const bye = () => { process.stdout.write("\x1b[?25h\n" + C.d + "ปิดมอนิเตอร์แล้ว" + C.n + "\n"); process.exit(0); };
process.on("SIGINT", bye);
process.on("SIGTERM", bye);

build();
let frame = 0;
const fpr = Math.max(1, Math.round((REFRESH * 1000) / 120));
setInterval(() => {
  if (frame % fpr === 0 && frame > 0) build();
  draw(frame++);
}, 120);
draw(0);
