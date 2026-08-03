// น้องวาน watchdog — รันเป็นระยะ (LaunchAgent StartInterval)
//  1) service ไหนตาย → kickstart ให้ (สำรองจาก KeepAlive)
//  2) เว็บไม่ตอบ → รีสตาร์ท web
//  3) session หมดอายุ (fb/line/oho/thunder) → เตือน Telegram หาเจ้าของ + บอกคำสั่ง :auth
//     (auth พวกนี้มี reCAPTCHA/2FA เชื่อมเองอัตโนมัติไม่ได้ ต้องกดล็อกอินครั้งเดียว)
//  ใช้ fail-counter กัน false alarm: ต้อง "พังต่อเนื่อง" หลายรอบถึงเตือน
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const LOGS = path.join(ROOT, ".run-logs");
const STATE_FILE = path.join(ROOT, ".watchdog-state.json");
const UID = process.getuid();
const now = Date.now();

// โหลด .env
try {
  for (const l of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const WEB = process.env.CHANGOH_WEB_URL || "http://localhost:3000";
const FAIL_THRESHOLD = 3;              // พังต่อเนื่องกี่รอบ ถึงถือว่า session หมดจริง
const ALERT_COOLDOWN = 6 * 3600e3;     // เตือนซ้ำทุก 6 ชม.
const LOG_FRESH = 15 * 60e3;           // log ต้องเพิ่งเขียนใน 15 นาที ถึงนับว่า "กำลังพัง"

// owner chat id: จาก DB (setting telegram_chat_id) → fallback env
function ownerChatId() {
  for (const dbf of ["prisma/changoh.db", "changoh.db"]) {
    try {
      const v = execSync(`sqlite3 "${path.join(ROOT, dbf)}" "SELECT value FROM Setting WHERE key='telegram_chat_id' LIMIT 1;"`, { encoding: "utf8" }).trim();
      if (v) return v;
    } catch {}
  }
  return (process.env.TELEGRAM_ALLOWED_CHAT_ID || "").trim() || null;
}

async function tg(text) {
  const chat = ownerChatId();
  if (!TOKEN || !chat) return false;
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    return true;
  } catch { return false; }
}

function launchctlPid(label) {
  try {
    const out = execSync("launchctl list", { encoding: "utf8" });
    for (const l of out.split("\n")) {
      const c = l.trim().split(/\s+/);
      if (c[2] === label) return c[0];
    }
  } catch {}
  return null;
}
function kickstart(label) {
  try { execSync(`launchctl kickstart -k gui/${UID}/${label}`); return true; } catch { return false; }
}

const AUTHERR = /invalid_grant|unauthorized|login required|เข้าสู่ระบบ|ต้องล็อกอิน|\b401\b|\b403\b|sign.?in|เซสชันหมด/i;
const SOFTERR = /ENOTFOUND|fetch failed|scan fail|browser has been closed|ECONNREFUSED|ETIMEDOUT/i;
const BANNER = /พร้อมทำงาน|เฝ้า|poll ทุก|เฝ้าคำขอ|เฝ้าดู|เฝ้าแชท|watching|ready/;

// อ่านเฉพาะบรรทัดหลัง banner ล่าสุด
function afterBanner(logf, n = 50) {
  try {
    const lines = fs.readFileSync(logf, "utf8").split("\n").slice(-n);
    let last = -1;
    lines.forEach((l, i) => { if (BANNER.test(l)) last = i; });
    return lines.slice(last + 1);
  } catch { return []; }
}

const SERVICES = [
  { label: "com.changoh.web", log: "dev.log", name: "web", auth: null, web: true },
  { label: "com.changoh.bot", log: "bot.log", name: "bot", auth: null },
  { label: "com.changoh.drive", log: "drive.log", name: "drive", auth: "npm run drive:auth" },
  { label: "com.changoh.oho", log: "oho.log", name: "oho", auth: "npm run oho:auth" },
  { label: "com.changoh.fb", log: "fb.log", name: "fb", auth: "npm run fb:auth" },
  { label: "com.changoh.line", log: "line.log", name: "line", auth: "npm run line:auth" },
  { label: "com.changoh.refund", log: "refund.log", name: "refund", auth: "npm run thunder:auth" },
];

let state = {};
try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch {}
state.fail = state.fail || {};
state.alerted = state.alerted || {};

const restarted = [];
const expired = [];

for (const s of SERVICES) {
  // 1) process ตาย → kickstart
  const pid = launchctlPid(s.label);
  if (!pid || pid === "-") {
    if (kickstart(s.label)) restarted.push(s.name);
    state.fail[s.name] = 0;
    continue;
  }

  // 2) web ไม่ตอบ → รีสตาร์ท
  if (s.web) {
    let ok = false;
    try {
      const r = execSync(`curl -s -o /dev/null -w "%{http_code}" --max-time 8 "${WEB}"`, { encoding: "utf8" }).trim();
      ok = /^(200|301|302|307|308)$/.test(r);
    } catch {}
    if (!ok) { if (kickstart(s.label)) restarted.push(s.name + " (เว็บไม่ตอบ)"); }
    continue;
  }

  // 3) session หมด (เฉพาะ service ที่มี auth) — นับ fail ต่อเนื่อง
  if (!s.auth) { state.fail[s.name] = 0; continue; }
  const logf = path.join(LOGS, s.log);
  let failing = false;
  try {
    if (fs.statSync(logf).mtimeMs > now - LOG_FRESH) {
      const region = afterBanner(logf).join("\n");
      if (AUTHERR.test(region) || SOFTERR.test(region)) failing = true;
    }
  } catch {}
  if (failing) {
    state.fail[s.name] = (state.fail[s.name] || 0) + 1;
    if (state.fail[s.name] >= FAIL_THRESHOLD) {
      const lastAlert = state.alerted[s.name] || 0;
      if (now - lastAlert > ALERT_COOLDOWN) { expired.push(s); state.alerted[s.name] = now; }
    }
  } else {
    state.fail[s.name] = 0;
    delete state.alerted[s.name]; // หายแล้ว → ครั้งหน้าเตือนใหม่ได้
  }
}

// ---- ส่งแจ้งเตือน ----
if (restarted.length) {
  const k = "restart";
  if (now - (state.alerted[k] || 0) > 30 * 60e3) {
    await tg(`🔄 <b>น้องวาน: รีสตาร์ท service ที่หยุดไป</b>\n${restarted.join(", ")}\n(ระบบกู้ให้อัตโนมัติแล้ว)`);
    state.alerted[k] = now;
  }
}
for (const s of expired) {
  await tg(
    `🔑 <b>น้องวาน: เซสชัน ${s.name.toUpperCase()} น่าจะหมดอายุ</b>\n` +
    `พังต่อเนื่อง ${FAIL_THRESHOLD}+ รอบแล้ว — ตัวนี้ต้องล็อกอินเอง (มี reCAPTCHA/2FA)\n\n` +
    `เปิด <b>Terminal</b> แล้ววาง:\n<code>cd ${ROOT} && ${s.auth}</code>\n\n` +
    `ล็อกอินครั้งเดียวในหน้าต่างที่เด้งขึ้น เดี๋ยวระบบใช้ต่อเอง ไม่ต้องทำอย่างอื่น`
  );
}

// ---- 4) กู้รายงานแชท: ถ้าเลย 07:00 แล้วยังไม่มีรายงาน "เมื่อวาน" (เช่นเครื่องปิดตอน 06:00) → รันซ้ำเอง ----
// (เช็ก DailyReport ใน sqlite ตรงๆ — เร็ว ไม่พึ่ง web)
try {
  const TH = 7 * 3600e3, BH = 6 * 3600e3;
  const bizOf = (ms) => new Date(ms + TH - BH).toISOString().slice(0, 10);
  const hourTH = new Date(now + TH).getUTCHours();
  const todayBiz = bizOf(now);
  const yBiz = bizOf(Date.parse(todayBiz + "T00:00:00Z") + TH - BH - 12 * 3600e3);
  if (hourTH >= 7) { // ให้เลยเวลา 06:00 มาพอสมควรก่อน (งานปกติเสร็จแล้ว)
    const dbf = fs.existsSync(path.join(ROOT, "prisma/changoh.db")) ? "prisma/changoh.db" : "changoh.db";
    const has = execSync(`sqlite3 "${path.join(ROOT, dbf)}" "SELECT COUNT(*) FROM DailyReport WHERE bizDate='${yBiz}';"`, { encoding: "utf8" }).trim();
    const running = (() => { try { return execSync("pgrep -f thunder-daily", { encoding: "utf8" }).trim().length > 0; } catch { return false; } })();
    const lastRun = state.reportHealDate || "";
    // ยังไม่มีรายงานเมื่อวาน + ไม่มี process รันอยู่ + ยังไม่เคยกู้วันนี้ → รันซ้ำ (background, detached)
    if (has === "0" && !running && lastRun !== todayBiz) {
      state.reportHealDate = todayBiz; // กันรันซ้ำหลายรอบใน watchdog รอบถัดๆ ไป
      const logf = path.join(LOGS, "chat-report.log");
      execSync(`cd "${ROOT}" && nohup /Users/mx/.local/bin/npm run thunder:daily -- ${yBiz} >> "${logf}" 2>&1 &`, { encoding: "utf8" });
      await tg(`🔧 <b>น้องวาน: กู้รายงานแชท ${yBiz}</b>\nรายงานเช้านี้ยังไม่ได้ส่ง (เครื่องอาจปิดตอน 06:00) — กำลังรันซ้ำให้อัตโนมัติค่ะ`);
      console.log(new Date(now).toISOString(), `report-heal: rerun ${yBiz}`);
    }
  }
} catch (e) { console.error("report-heal error", e?.message); }

try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch {}
const stamp = new Date(now).toISOString();
console.log(`${stamp} watchdog · restarted:[${restarted.join(",") || "-"}] · session-expired-alert:[${expired.map(e => e.name).join(",") || "-"}] · fail=${JSON.stringify(state.fail)}`);
