// เฝ้า LINE OA Manager (chat.line.biz) — ลูกค้าทักค้าง "ยังไม่อ่าน" (จุดเขียว) > 3 นาที → เตือนเข้า Topic
// รัน: npm run line:watch  (ต้อง line:auth ก่อน) — เฝ้า 2 OA: EasyCRM + BoostSMS
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { brandOf, platformEmoji, topicId } from "./lib/routes.mjs";
import { getTaggees, formatTags } from "./oho-shifts.mjs";
import { analyzeChat } from "./lib/ai-analyze.mjs";
import { esc, mmss, openChatButton, sendCard, copyReplyText } from "./lib/notify.mjs";
import { logActivity } from "./lib/activity.mjs";

function loadEnv() {
  const p = path.join(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
}
loadEnv();

const SESSION = process.env.LINE_SESSION_PATH || path.join(process.cwd(), ".line-session.json");
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALERT_CHAT = process.env.OHO_ALERT_CHAT_ID;
const POLL = Number(process.env.LINE_POLL_SECONDS || 60) * 1000;
const THRESHOLD = Number(process.env.LINE_THRESHOLD_SECONDS || 180); // ยังไม่อ่าน (จุดเขียว) เกินเท่านี้ → เตือน
const ANSWER_THRESHOLD = Number(process.env.LINE_ANSWER_THRESHOLD_SECONDS || 300); // อ่านแล้วแต่ยังไม่ตอบเกินเท่านี้ → เตือน
const MAX_AGE = Number(process.env.LINE_MAX_AGE_SECONDS || 86400);
const MAX_PER_TICK = Number(process.env.LINE_MAX_PER_TICK || 5);
const OWNER_ID = "7750653134";

if (!TOKEN || !ALERT_CHAT) { console.error("ต้องตั้ง TELEGRAM_BOT_TOKEN + OHO_ALERT_CHAT_ID"); process.exit(1); }
if (!fs.existsSync(SESSION)) { console.error("ยังไม่มี session — รัน npm run line:auth ก่อน"); process.exit(1); }

const OAS = [
  { key: "easycrm", company: "easycrm", productKey: "easycrm", title: "EasyCRM", topicKey: "easycrm", url: "https://chat.line.biz/Ucc1f1adc19e09ad4cb7c854380ac27d8/" },
  { key: "boostsms", company: "boostsms", productKey: "boostsms", title: "BoostSMS", topicKey: "boostsms", url: "https://chat.line.biz/U897b8db65ac9a27eb438b401d8c04dee/" },
];

const LINE_CLIP = { x: 400, y: 75, width: 645, height: 760 };

function nowBkkMin() {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  const h = p.hour === "24" ? 0 : Number(p.hour);
  return h * 60 + Number(p.minute);
}
// เวลา LINE: "9.38 น." = วันนี้ (คิดนาทีที่ผ่านมา) · ชื่อวัน/วันที่ = เก่ากว่า 1 วัน → ข้าม
function parseWaitSec(t) {
  t = (t || "").trim();
  const m = t.match(/(\d{1,2})[.:](\d{2})\s*น\./);
  if (m) { let d = nowBkkMin() - (+m[1] * 60 + +m[2]); if (d < 0) d += 1440; return d * 60; }
  if (/เมื่อสักครู่|เพิ่ง/.test(t)) return 30;
  return MAX_AGE + 1;
}

// สแกน list 1 OA — คืนแถวลูกค้าทัก "ยังไม่อ่าน" (จุดเขียว)
async function scanPage(page, OA, navigate) {
  if (navigate) { await page.goto(OA.url, { waitUntil: "domcontentloaded" }).catch(() => {}); await page.waitForTimeout(6000); }
  else { await page.waitForTimeout(800); }
  return page.evaluate(() => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const timeRe = /\d{1,2}[.:]\d{2}\s*น\.|เมื่อสักครู่/;
    const rows = [];
    for (const a of document.querySelectorAll('a[href="#"]')) {
      const h6 = a.querySelector("h6"); if (!h6 || !a.querySelector("img")) continue;
      const rect = a.getBoundingClientRect();
      if (rect.x > 430 || rect.width < 180 || rect.width > 430) continue; // คอลัมน์ list ซ้าย
      const name = clean(h6.textContent).slice(0, 40);
      const leaves = [...a.querySelectorAll("p,span,div,h6")].filter((e) => !e.querySelector("p,span,div,h6") && clean(e.textContent));
      const texts = leaves.map((e) => clean(e.textContent));
      const timeText = texts.find((t) => timeRe.test(t)) || "";
      const preview = (texts.filter((t) => t !== name && t !== timeText).sort((a, b) => b.length - a.length)[0] || "").slice(0, 200);
      // ยังไม่อ่าน = มี element สีเขียว LINE (จุด/badge) ในแถว
      const unread = [...a.querySelectorAll("*")].some((e) => { const bg = getComputedStyle(e).backgroundColor; const mm = bg.match(/rgba?\((\d+), ?(\d+), ?(\d+)/); if (!mm) return false; const R = +mm[1], G = +mm[2], B = +mm[3]; return G > 150 && R < 80 && B < 140 && G > R + 60 && G > B + 30; });
      rows.push({ name, preview, timeText, unread, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
    }
    return rows;
  });
}

// อ่านบทสนทนาที่เปิดอยู่ (คอลัมน์กลาง x405..1035) — ซ้าย=ลูกค้า ขวา=แอดมิน (แบ่งที่ x720)
async function inspectConversation(page) {
  return page.evaluate(() => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const noise = /^(อ่านแล้ว|ยังไม่อ่าน|\d{1,2}[.:]\d{2}\s*น\.|วันนี้|เมื่อวาน|ผู้ใช้นี้เพิ่มคุณเป็นเพื่อน|ข้อความตอบกลับอัตโนมัติ|ผู้รับผิดชอบ)/;
    const msgs = [];
    for (const e of document.querySelectorAll("p,span,div")) {
      if (e.querySelector("p,span,div")) continue;
      const t = clean(e.textContent); if (t.length < 1 || t.length > 400 || noise.test(t)) continue;
      const r = e.getBoundingClientRect();
      if (r.width < 8 || r.x < 405 || r.x > 1035 || r.y < 80 || r.y > 835) continue;
      const cx = r.x + r.width / 2;
      msgs.push({ side: cx < 720 ? "customer" : "admin", text: t.slice(0, 300), y: Math.round(r.y) });
    }
    msgs.sort((a, b) => a.y - b.y);
    const recent = msgs.slice(-14).map((m) => ({ side: m.side, text: m.text }));
    let lastCust = ""; for (const m of recent) if (m.side === "customer") lastCust = m.text;
    return { ok: recent.length > 0, recentMsgs: recent, lastCust, lastSide: recent.length ? recent[recent.length - 1].side : null };
  });
}

const alerted = new Map();
const checkedAnswered = new Map(); // key -> ts : แชทอ่านแล้วที่เปิดเช็คแล้วพบว่าแอดมินตอบล่าสุด (กันเปิดซ้ำถี่)
const CHECK_COOLDOWN = Number(process.env.LINE_CHECK_COOLDOWN_SECONDS || 600) * 1000;
let primed = false, sessionWarned = false;
const rowKey = (OA, r) => `${OA.key}|${r.name}|${r.preview.slice(0, 30)}`;

async function tick(pages, navigate) {
  const fresh = [];
  for (const { OA, page } of pages) {
    let rows;
    try { rows = await scanPage(page, OA, navigate); } catch (e) { console.error("scan fail", OA.key, e?.message); continue; }
    if (!rows.length) {
      if (/line\.me\/.*login|access\.line/i.test(page.url()) && !sessionWarned) { sessionWarned = true; await tg({ chat_id: OWNER_ID, text: "⚠️ เซสชัน LINE หมดอายุ/หลุด — รบกวนพี่โด้รัน npm run line:auth ใหม่นะคะ (เฝ้า LINE OA หยุดชั่วคราว)" }); }
      continue;
    }
    sessionWarned = false;
    const nowMs = Date.now();
    for (const r of rows) {
      const waitSec = parseWaitSec(r.timeText);
      if (waitSec == null || waitSec >= MAX_AGE) continue; // เฉพาะ "วันนี้" (ชื่อวัน/วันที่ = เก่า ข้าม)
      const key = rowKey(OA, r);
      if (r.unread) {
        // (1) ยังไม่อ่าน (จุดเขียว) เกิน 3 นาที → ค้างแน่นอน
        if (waitSec >= THRESHOLD) fresh.push({ OA, page, r, waitSec, key, type: "unread" });
      } else if (waitSec >= ANSWER_THRESHOLD) {
        // (2) อ่านแล้วแต่เวลาล่าสุดเกิน 5 นาที → อาจ "อ่านแล้วไม่ตอบ" ต้องเปิดเช็ค lastSide (เว้น cooldown ที่เคยเช็คว่าตอบแล้ว)
        const ck = checkedAnswered.get(key);
        if (!ck || nowMs - ck >= CHECK_COOLDOWN) fresh.push({ OA, page, r, waitSec, key, type: "read" });
      }
    }
  }

  if (!primed) {
    primed = true;
    // จำ backlog เฉพาะ "ยังไม่อ่าน" (กันถล่มตอนเริ่ม) · ส่วน "อ่านแล้วไม่ตอบ" ปล่อยให้เตือน (แอดมินลืมตอบจริง)
    let bl = 0;
    for (const f of fresh) if (f.type === "unread") { alerted.set(f.key, Date.now()); bl++; }
    if (bl) await tg({ chat_id: ALERT_CHAT, text: `เริ่มเฝ้า LINE OA แล้วค่ะ 👀 (EasyCRM + BoostSMS) ตอนนี้มีลูกค้าทักค้างยังไม่อ่าน ${bl} รายการ` });
    return;
  }

  const toAlert = fresh.filter((f) => !alerted.has(f.key)).sort((a, b) => b.waitSec - a.waitSec).slice(0, MAX_PER_TICK);
  for (const { OA, page, r, waitSec, key, type } of toAlert) {
    const brand = brandOf(OA.company);
    const link = OA.url;
    let insp = { ok: false, recentMsgs: [], lastCust: "", lastSide: null }, photo = null;
    const rc = r.rect;
    if (rc && rc.width > 0 && rc.y >= 40 && rc.y + rc.height <= 940) {
      try {
        await page.mouse.click(rc.x + rc.width / 2, rc.y + rc.height / 2);
        await page.waitForTimeout(3500);
        insp = await inspectConversation(page);
        photo = await page.screenshot({ clip: LINE_CLIP }).catch(() => null);
      } catch { /* ใช้ preview */ }
    }
    // เคส "อ่านแล้ว": ยืนยันว่าข้อความล่าสุดเป็นของลูกค้าจริง (ไม่งั้น=แอดมินตอบแล้ว ไม่ต้องเตือน)
    if (type === "read") {
      if (insp.ok && insp.lastSide && insp.lastSide !== "customer") { checkedAnswered.set(key, Date.now()); continue; }
      if (!insp.ok) { checkedAnswered.set(key, Date.now()); continue; } // เปิด/อ่านไม่ได้ → ไม่เดา ข้ามไปก่อน
    }
    const lastCust = insp.lastCust || r.preview;
    const recentMsgs = insp.recentMsgs.length ? insp.recentMsgs : [{ side: "customer", text: r.preview }];

    let aiLine = "", aiReply = "";
    try {
      const ai = await analyzeChat(OA.productKey, { productTitle: OA.title, customer: r.name, recentMsgs, lastCust });
      if (ai?.kind === "suggest") { aiReply = ai.text; aiLine = `🎯 <b>แอดมินร่างข้อความให้แล้ว</b> — ก๊อปด้านล่างส่งได้เลยค่ะ ⬇️\n`; }
      else if (ai?.kind === "missing") aiLine = `🎯 <b>ขอข้อมูลเพิ่มเข้าสมองหน่อยนะ</b> : <i>${esc(ai.text)}</i>\n`;
    } catch { /* ข้าม */ }

    const reason = type === "read"
      ? `🟠 <b>แอดมินอ่านแล้วแต่ยังไม่ตอบ เกิน ${Math.round(ANSWER_THRESHOLD / 60)} นาที</b>`
      : `🟡 <b>ลูกค้าทักค้าง ยังไม่มีคนรับ (จุดเขียว)</b>`;
    const caption =
      `${brand.emoji} <b>${esc(OA.title)}</b>  ·  ${platformEmoji(OA.company, "line")} LINE OA\n` +
      `\n` +
      `${reason}\n` +
      `\n` +
      `📲 ช่องทาง : <b>${esc(OA.title)}</b> · LINE OA\n` +
      `👤 ลูกค้า : <b>${esc(r.name || "-")}</b>\n` +
      `⚠️ รอมาแล้ว : <b>${mmss(waitSec)}</b>\n` +
      (lastCust ? `💬 ลูกค้าพิมพ์ล่าสุด : <b>${esc(lastCust)}</b>\n` : "") +
      aiLine +
      `\n` +
      `${formatTags(getTaggees(new Date()).taggees)}\nรบกวนเข้าไปตอบลูกค้าใน LINE OA ด้วยนะคะ 🙏`;

    try {
      const res = await sendCard(TOKEN, ALERT_CHAT, { threadId: topicId(OA.topicKey), caption, photo, replyMarkup: openChatButton(link) });
      if (res?.ok) {
        alerted.set(key, Date.now());
        if (aiReply) await sendCard(TOKEN, ALERT_CHAT, { threadId: topicId(OA.topicKey), caption: copyReplyText(aiReply), replyTo: res.result.message_id });
        console.log(new Date().toISOString(), "line-alert", OA.key, `[${type}]`, r.name, r.timeText, mmss(waitSec));
        logActivity({ source: "line", kind: "waiting-alert", platform: "line", company: OA.title || OA.key, channel: OA.title || OA.key, customer: r.name, chatId: String(ALERT_CHAT), waitSec, outcome: type,
          summary: `แจ้งแชท LINE ค้าง [${type === "read" ? "อ่านแล้วยังไม่ตอบ" : "ยังไม่อ่าน"}] — ${r.name || "-"} (OA ${OA.title || OA.key}) รอมาแล้ว ${mmss(waitSec)}` });
      } else console.error("send fail", JSON.stringify(res).slice(0, 200));
    } catch (e) { console.error("send fail", e?.message); }
  }

  const liveKeys = new Set(fresh.map((f) => f.key));
  for (const k of [...alerted.keys()]) if (!liveKeys.has(k)) alerted.delete(k);
}

async function tg(body) {
  return fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => null);
}

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({ storageState: SESSION, viewport: { width: 1400, height: 950 }, locale: "th-TH" });
  const pages = [];
  for (const OA of OAS) { const page = await context.newPage(); await page.goto(OA.url, { waitUntil: "domcontentloaded" }).catch(() => {}); pages.push({ OA, page }); }
  await new Promise((r) => setTimeout(r, 6000));
  const RELOAD_EVERY = Number(process.env.LINE_RELOAD_EVERY_TICKS || 10);
  console.log("เฝ้า LINE OA แล้ว · เตือนที่", ALERT_CHAT, "· poll", POLL / 1000, "วิ · เกณฑ์", THRESHOLD, "วิ · OA:", OAS.map((o) => o.key).join(","));
  await tg({ chat_id: OWNER_ID, text: "เริ่มเฝ้า LINE OA แล้วค่ะ 👀 (EasyCRM + BoostSMS) เจอลูกค้าทักค้างยังไม่อ่าน (จุดเขียว) จะเตือนใน Topic ให้เลย" });
  let n = 0;
  for (;;) {
    const navigate = n === 0 || n % RELOAD_EVERY === 0;
    try { await tick(pages, navigate); } catch (e) { console.error("tick error", e?.message); }
    n++;
    await new Promise((r) => setTimeout(r, POLL));
  }
}

async function scanOnce() {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({ storageState: SESSION, viewport: { width: 1400, height: 950 }, locale: "th-TH" });
  const page = await context.newPage();
  for (const OA of OAS) {
    const rows = await scanPage(page, OA, true).catch((e) => { console.error("scan fail", OA.key, e?.message); return []; });
    console.log(`\n===== ${OA.key} (${rows.length} แถว) =====`);
    for (const r of rows) console.log(`${r.unread ? "🟢unread" : "อ่านแล้ว"} | รอ ${JSON.stringify(parseWaitSec(r.timeText))}s | เวลา "${r.timeText}" | ${r.name} — ${r.preview.slice(0, 45)}`);
  }
  await browser.close();
}

if (process.argv.includes("--scan-once")) scanOnce(); else main();
