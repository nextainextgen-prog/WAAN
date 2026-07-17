// เฝ้า inbox Meta Business Suite (business.facebook.com) — เจอลูกค้าทักค้าง "ยังไม่อ่าน" (ตัวหนา) → เตือนเข้า Topic
// รัน: npm run fb:watch  (ต้อง fb:auth ก่อน) — เฝ้า 2 เพจ: Thunder API + BoostSMS
// สำคัญ: อ่านอย่างเดียว ไม่คลิกเปิดแชท (การเปิดใน Business Suite = mark read ทำให้แอดมินพลาด)
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { brandOf, platformEmoji, platformLabel, topicId } from "./lib/routes.mjs";
import { getTaggees, formatTags } from "./oho-shifts.mjs";
import { analyzeChat } from "./lib/ai-analyze.mjs";
import { esc, mmss, openChatButton, sendCard, copyReplyText, refreshMuted, isChatMuted, isBrandMuted } from "./lib/notify.mjs";
import { logActivity } from "./lib/activity.mjs";

// โซนคอลัมน์บทสนทนา (กลางจอ) สำหรับแคป — วัดจาก layout Business Suite ที่ 1500x1000
const FB_CLIP = { x: 528, y: 150, width: 624, height: 725 };
// อ่านบทสนทนาที่เปิดอยู่ (คอลัมน์กลาง) — ฝั่งซ้าย=ลูกค้า ขวา=แอดมิน (แบ่งที่ x≈840)
async function inspectConversation(page) {
  return page.evaluate(() => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const msgs = [];
    for (const e of document.querySelectorAll("span,div")) {
      if (e.querySelector("span,div")) continue;
      const t = clean(e.textContent); if (t.length < 1 || t.length > 400) continue;
      const r = e.getBoundingClientRect();
      if (r.width < 8 || r.x < 528 || r.x > 1150 || r.y < 215 || r.y > 875) continue; // เฉพาะคอลัมน์แชทกลาง (เลี่ยง header/กล่องพิมพ์)
      const cx = r.x + r.width / 2;
      msgs.push({ side: cx < 840 ? "customer" : "admin", text: t.slice(0, 300), y: Math.round(r.y) });
    }
    msgs.sort((a, b) => a.y - b.y);
    const recent = msgs.slice(-14).map((m) => ({ side: m.side, text: m.text }));
    let lastCust = ""; for (const m of recent) if (m.side === "customer") lastCust = m.text;
    return { ok: recent.length > 0, recentMsgs: recent, lastCust };
  });
}

function loadEnv() {
  const p = path.join(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
}
loadEnv();

const SESSION = process.env.FB_SESSION_PATH || path.join(process.cwd(), ".fb-session.json");
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALERT_CHAT = process.env.OHO_ALERT_CHAT_ID;
const APP_URL = process.env.APP_URL || "http://localhost:3000";
const INTERNAL = process.env.INTERNAL_API_TOKEN || "";
const POLL = Number(process.env.FB_POLL_SECONDS || 60) * 1000;
const THRESHOLD = Number(process.env.FB_THRESHOLD_SECONDS || 180);
const MAX_AGE = Number(process.env.FB_MAX_AGE_SECONDS || 86400);
const MAX_PER_TICK = Number(process.env.FB_MAX_PER_TICK || 5);
const OWNER_ID = "7750653134";

if (!TOKEN || !ALERT_CHAT) { console.error("ต้องตั้ง TELEGRAM_BOT_TOKEN + OHO_ALERT_CHAT_ID"); process.exit(1); }
if (!fs.existsSync(SESSION)) { console.error("ยังไม่มี session — รัน npm run fb:auth ก่อน"); process.exit(1); }

// เพจที่เฝ้า → บริษัท/Topic/KB (platform = fb ทุกอัน)
const PAGES = [
  { key: "thunderApi", company: "thunder", productKey: "thunderApi", title: "Thunder API", topicKey: "thunderApi",
    url: "https://business.facebook.com/latest/inbox/all/?asset_id=591225490748585" },
  // เพจนี้เป็นของ BoostSMS (EasyCRM ไม่มีเพจ Facebook) → เข้า Topic boostsms + ใช้ KB boostsms
  { key: "boostsms", company: "boostsms", productKey: "boostsms", title: "BoostSMS", topicKey: "boostsms",
    url: "https://business.facebook.com/latest/inbox/all/?global_scope_id=3572053362925317&business_id=3572053362925317&page_id=1007699475754291&asset_id=1007699475754291" },
];

const THAI_MONTH = /ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม/;

function nowBkkMin() {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  const h = p.hour === "24" ? 0 : Number(p.hour);
  return h * 60 + Number(p.minute);
}
// แปลงข้อความเวลาบนแถว → วินาทีที่รอ (คร่าวๆ) · เป็นวันที่ (เก่า) = คืนค่าใหญ่เกิน MAX_AGE ให้ถูกข้าม
function parseWaitSec(t) {
  t = (t || "").trim();
  if (!t) return null;
  if (/เมื่อสักครู่|ไม่กี่|เพิ่ง/.test(t)) return 20;
  let m;
  if ((m = t.match(/(\d+)\s*วินาที/))) return +m[1];
  if ((m = t.match(/(\d+)\s*นาที/))) return +m[1] * 60;
  if ((m = t.match(/(\d+)\s*(ชม|ชั่วโมง)/))) return +m[1] * 3600;
  if ((m = t.match(/(\d+)\s*วัน/))) return +m[1] * 86400;
  if ((m = t.match(/^(\d{1,2}):(\d{2})$/))) { let diff = nowBkkMin() - (+m[1] * 60 + +m[2]); if (diff < 0) diff += 1440; return diff * 60; }
  if (THAI_MONTH.test(t)) return MAX_AGE + 1; // เป็นวันที่ = เก่ากว่า 1 วัน → ข้าม
  return null;
}

// สแกน 1 เพจ (อ่านอย่างเดียว) — คืนแถวลูกค้าค้าง "ยังไม่อ่าน" (ตัวหนา)
// navigate=true → โหลดหน้าใหม่ (Business Suite อาจ auto-open แชทบนสุด = mark read 1 อัน) ทำเฉพาะตอนเริ่ม/รีเฟรชเป็นระยะ
// navigate=false → อ่าน DOM สดที่โหลดค้างไว้ (แชทค้างใหม่จะเด้งขึ้น list เอง โดยไม่ถูกเปิด = ไม่ mark read)
async function scanPage(page, P, navigate) {
  if (navigate) { await page.goto(P.url, { waitUntil: "domcontentloaded" }).catch(() => {}); await page.waitForTimeout(6000); }
  else { await page.waitForTimeout(800); }
  return page.evaluate(() => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const dateRe = /\d{1,2}\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)|\d{1,2}:\d{2}|เมื่อสักครู่|\d+\s*(วินาที|นาที|ชม|ชั่วโมง|วัน)/;
    // แถวแชท = container ที่ไล่ขึ้นจาก avatar img แล้วมีทั้ง img + ข้อความเวลา (class เฟซบุ๊ก mangle ใช้ไม่ได้)
    const rowEls = new Set();
    for (const img of document.querySelectorAll("img")) {
      let n = img;
      for (let i = 0; i < 9 && n; i++) {
        n = n.parentElement; if (!n) break;
        const txt = clean(n.textContent);
        if (txt.length > 6 && txt.length < 240 && dateRe.test(txt) && n.querySelector("img")) { rowEls.add(n); break; }
      }
    }
    const rows = [];
    for (const r of rowEls) {
      const leaves = [...r.querySelectorAll("span,div")].filter((e) => !e.querySelector("span,div") && clean(e.textContent));
      if (!leaves.length) continue;
      let maxW = 0; const texts = [];
      for (const e of leaves) { const t = clean(e.textContent); if (!t) continue; const w = parseInt(getComputedStyle(e).fontWeight || "400", 10); if (w > maxW) maxW = w; texts.push({ t, w }); }
      if (!texts.length) continue;
      // ข้อความที่เป็น "เวลา/วันที่/ป้าย" (ไม่ใช่ชื่อ/ข้อความ)
      const isTimeish = (t) => dateRe.test(t) || /^\d{1,2}:\d{2}$/.test(t) || /^\d{1,2}\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)/.test(t) || /^(เมื่อสักครู่|เพิ่ง)/.test(t);
      const isLabel = (t) => /^(Intake|ad_id|Messenger|Instagram|WhatsApp)/i.test(t);
      // ชื่อลูกค้า = ข้อความแรกที่ไม่ใช่เวลา/ป้าย (unread บางแถวขึ้นเวลาก่อนชื่อ) + ตัดป้าย "ตอบกลับโฆษณา/โพสต์"
      const name = (texts.find((x) => !isTimeish(x.t) && !isLabel(x.t) && x.t.length >= 2)?.t || texts[0].t).replace(/\s*ตอบกลับ(โฆษณา|โพสต์|สตอรี|เรื่องราว)\s*/g, " ").trim().slice(0, 40);
      // เวลา = token เวลา/วันที่ตัวท้ายสุดในข้อความทั้งแถว (รองรับ HH:MM, "X นาที", ชื่อเดือนเต็ม/ย่อ)
      const full = clean(r.textContent);
      const tm = full.match(/\d{1,2}:\d{2}|เมื่อสักครู่|เพิ่ง|\d+\s*(วินาที|นาที|ชม\.?|ชั่วโมง|วัน)|\d{1,2}\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)/g);
      const timeText = tm ? tm[tm.length - 1] : "";
      const cand = texts.filter((x) => x.t !== name && x.t !== timeText && !isLabel(x.t) && !isTimeish(x.t));
      const preview = (cand.sort((a, b) => b.t.length - a.t.length)[0]?.t || "").slice(0, 200);
      const rect = r.getBoundingClientRect();
      rows.push({ name, preview, timeText, unread: maxW >= 600, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
    }
    // dedup thread ที่ถูกจับหลาย DOM level (avatar + รูปโฆษณา) → รวมตามตำแหน่งแนวตั้ง เลือก unread ก่อน
    const byY = new Map();
    for (const r of rows) { const k = Math.round(r.rect.y / 8); const ex = byY.get(k); if (!ex || (r.unread && !ex.unread)) byY.set(k, r); }
    return [...byY.values()];
  });
}

const alerted = new Map(); // key -> firstTs (กันเตือนซ้ำ)
let primed = false;
let sessionWarned = false;
const rowKey = (P, r) => `${P.key}|${r.name}|${r.preview.slice(0, 30)}`;

async function tick(pages, navigate) {
  await refreshMuted(APP_URL, INTERNAL); // กลุ่มสั่งปิดแจ้งเตือน → ข้ามการเตือนรอบนี้
  if (isChatMuted(ALERT_CHAT)) return;
  const fresh = [];
  for (const { P, page } of pages) {
    let rows;
    try { rows = await scanPage(page, P, navigate); } catch (e) { console.error("scan fail", P.key, e?.message); continue; }
    // เช็ก session หลุด (ไม่เจอแถวเลย + เจอหน้า login)
    if (!rows.length) {
      const isLogin = /login|checkpoint/i.test(page.url());
      if (isLogin && !sessionWarned) { sessionWarned = true; await tg({ chat_id: OWNER_ID, text: "⚠️ เซสชัน Facebook หมดอายุ/หลุด — รบกวนพี่โด้รัน npm run fb:auth ใหม่นะคะ (เฝ้า inbox FB หยุดชั่วคราว)" }); }
      continue;
    }
    sessionWarned = false;
    for (const r of rows) {
      if (!r.unread) continue; // เฉพาะยังไม่อ่าน (ตัวหนา)
      const waitSec = parseWaitSec(r.timeText);
      if (waitSec == null || waitSec < THRESHOLD || waitSec >= MAX_AGE) continue;
      fresh.push({ P, page, r, waitSec, key: rowKey(P, r) });
    }
  }

  // รอบแรก: จำ backlog ไว้ ไม่ถล่มเตือน
  if (!primed) {
    primed = true;
    for (const f of fresh) alerted.set(f.key, Date.now());
    if (fresh.length) await tg({ chat_id: ALERT_CHAT, text: `เริ่มเฝ้า inbox Facebook แล้วค่ะ 👀 (Thunder API + BoostSMS) ตอนนี้มีลูกค้าทักค้างยังไม่อ่าน ${fresh.length} รายการ` });
    return;
  }

  const toAlert = fresh.filter((f) => !alerted.has(f.key)).sort((a, b) => b.waitSec - a.waitSec).slice(0, MAX_PER_TICK);
  for (const { P, page, r, waitSec, key } of toAlert) {
    if (isBrandMuted(P.company)) continue; // แบรนด์นี้สั่งปิดแจ้งเตือน → ข้าม
    const brand = brandOf(P.company);
    const pEmoji = platformEmoji(P.company, "fb");
    const link = P.url;

    // เปิดแชท (คลิกที่แถว) เพื่ออ่านบทสนทนาเต็ม + แคปคอลัมน์แชท (การเปิด = mark read ยอมรับได้ เพราะแจ้งเตือนแล้ว)
    let insp = { ok: false, recentMsgs: [], lastCust: "" };
    let photo = null;
    const rc = r.rect;
    if (rc && rc.width > 0 && rc.y >= 40 && rc.y + rc.height <= 1000) {
      try {
        await page.mouse.click(rc.x + rc.width / 2, rc.y + rc.height / 2);
        await page.waitForTimeout(3500);
        insp = await inspectConversation(page);
        photo = await page.screenshot({ clip: FB_CLIP }).catch(() => null);
      } catch { /* เปิดไม่ได้ = ใช้ preview */ }
    }
    const lastCust = insp.lastCust || r.preview;
    const recentMsgs = insp.recentMsgs.length ? insp.recentMsgs : [{ side: "customer", text: r.preview }];

    // AI ร่างข้อความพร้อมส่งให้ลูกค้าจากบทสนทนาเต็ม
    let aiLine = "", aiReply = "";
    try {
      const ai = await analyzeChat(P.productKey, { productTitle: P.title, customer: r.name, recentMsgs, lastCust });
      if (ai?.kind === "suggest") { aiReply = ai.text; aiLine = `🎯 <b>แอดมินร่างข้อความให้แล้ว</b> — ก๊อปด้านล่างส่งได้เลยค่ะ ⬇️\n`; }
      else if (ai?.kind === "missing") aiLine = `🎯 <b>ขอข้อมูลเพิ่มเข้าสมองหน่อยนะ</b> : <i>${esc(ai.text)}</i>\n`;
    } catch { /* ข้าม */ }

    const caption =
      `${brand.emoji} <b>${esc(P.title)}</b>  ·  ${pEmoji} เพจ Facebook\n` +
      `\n` +
      `🟡 <b>ลูกค้าทักค้าง ยังไม่มีแอดมินอ่าน</b>\n` +
      `\n` +
      `📲 ช่องทาง : <b>${esc(P.title)}</b> · เพจ Facebook\n` +
      `👤 ลูกค้า : <b>${esc(r.name || "-")}</b>\n` +
      `⚠️ รอมาแล้ว : <b>${mmss(waitSec)}</b>\n` +
      (lastCust ? `💬 ลูกค้าพิมพ์ล่าสุด : <b>${esc(lastCust)}</b>\n` : "") +
      aiLine +
      `\n` +
      `${formatTags(getTaggees(new Date()).taggees)}\nรบกวนเข้าไปตอบลูกค้าใน Facebook Inbox ด้วยนะคะ 🙏`;

    try {
      const res = await sendCard(TOKEN, ALERT_CHAT, { threadId: topicId(P.topicKey), caption, photo, replyMarkup: openChatButton(link) });
      if (res?.ok) {
        alerted.set(key, Date.now());
        if (aiReply) await sendCard(TOKEN, ALERT_CHAT, { threadId: topicId(P.topicKey), caption: copyReplyText(aiReply), replyTo: res.result.message_id });
        console.log(new Date().toISOString(), "fb-alert", P.key, r.name, r.timeText, mmss(waitSec));
        logActivity({ source: "fb", kind: "waiting-alert", platform: "fb", company: P.title || P.key, channel: P.title || P.key, customer: r.name, chatId: String(ALERT_CHAT), waitSec,
          summary: `แจ้งแชท Facebook ค้าง — ${r.name || "-"} (เพจ ${P.title || P.key}) รอมาแล้ว ${mmss(waitSec)} ยังไม่มีคนตอบ` });
      } else console.error("send fail", JSON.stringify(res).slice(0, 200));
    } catch (e) { console.error("send fail", e?.message); }
  }

  // เคลียร์ key ที่หายไป (แอดมินอ่าน/ตอบแล้ว = ไม่ unread) เพื่อให้เตือนใหม่ได้ถ้ากลับมาค้างอีก
  const liveKeys = new Set(fresh.map((f) => f.key));
  for (const k of [...alerted.keys()]) if (!liveKeys.has(k)) alerted.delete(k);
}

async function tg(body) {
  return fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => null);
}

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({ storageState: SESSION, viewport: { width: 1500, height: 1000 }, locale: "th-TH" });
  // 1 แท็บต่อ 1 เพจ — โหลดครั้งเดียวตอนเริ่ม แล้วอ่าน DOM สดทุกรอบ (ไม่ reload = ไม่ auto-open/mark read)
  const pages = [];
  for (const P of PAGES) { const page = await context.newPage(); await page.goto(P.url, { waitUntil: "domcontentloaded" }).catch(() => {}); pages.push({ P, page }); }
  await new Promise((r) => setTimeout(r, 6000));
  const RELOAD_EVERY = Number(process.env.FB_RELOAD_EVERY_TICKS || 10); // รีเฟรชหน้าเป็นระยะ กัน list ค้าง (ยอมรับ auto-open 1 อันตอน reload)
  console.log("เฝ้า Facebook inbox แล้ว · เตือนที่", ALERT_CHAT, "· poll", POLL / 1000, "วิ · เกณฑ์", THRESHOLD, "วิ · เพจ:", PAGES.map((p) => p.key).join(","));
  await tg({ chat_id: OWNER_ID, text: "เริ่มเฝ้า inbox Facebook แล้วค่ะ 👀 (Thunder API + BoostSMS) เจอลูกค้าทักค้างยังไม่อ่านจะเตือนใน Topic ให้เลย" });
  let n = 0;
  for (;;) {
    const navigate = n === 0 || n % RELOAD_EVERY === 0; // รอบแรกและทุกๆ RELOAD_EVERY = โหลดใหม่
    try { await tick(pages, navigate); } catch (e) { console.error("tick error", e?.message); }
    n++;
    await new Promise((r) => setTimeout(r, POLL));
  }
}

// โหมดทดสอบ: สแกนครั้งเดียว พิมพ์ผลลัพธ์ ไม่ส่งเตือน ไม่เปิดแชท (ปลอดภัย)
async function scanOnce() {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({ storageState: SESSION, viewport: { width: 1500, height: 1000 }, locale: "th-TH" });
  const page = await context.newPage();
  for (const P of PAGES) {
    const rows = await scanPage(page, P, true).catch((e) => { console.error("scan fail", P.key, e?.message); return []; });
    console.log(`\n===== ${P.key} (${rows.length} แถว) =====`);
    for (const r of rows) console.log(`${r.unread ? "🔴unread" : "อ่านแล้ว"} | รอ ${JSON.stringify(parseWaitSec(r.timeText))}s | เวลา "${r.timeText}" | ${r.name} — ${r.preview.slice(0, 50)}`);
  }
  await browser.close();
}

if (process.argv.includes("--scan-once")) scanOnce(); else main();
