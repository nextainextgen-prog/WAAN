// เฝ้าแชท OHO Chat — เจอแชทค้างเกิน 3 นาทียังไม่มีคนรับ → แคปช่องแชทนั้น → เตือนกลุ่ม + แท็กเวร
// รัน: npm run oho:watch  (ต้อง oho:auth ก่อน)  — process รันถาวร (เหมือน drive:watch)
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { getTaggees, formatTags, tagsForAgent, tagsForChannel } from "./oho-shifts.mjs";
import { classifyOho, brandOf, platformEmoji, platformLabel, topicId } from "./lib/routes.mjs";
import { analyzeChat } from "./lib/ai-analyze.mjs";
import { copyReplyText } from "./lib/notify.mjs";

function loadEnv() {
  const p = path.join(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const URL = process.env.OHO_URL || "https://app.oho.chat";
const SESSION = process.env.OHO_SESSION_PATH || path.join(process.cwd(), ".oho-session.json");
let ALERT_CHAT = process.env.OHO_ALERT_CHAT_ID; // ค่าเริ่มต้นจาก env; refreshAlertChat() จะอัปเดตจากที่ตั้งผ่านปุ่มห้อง Lead
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const POLL = Number(process.env.OHO_POLL_SECONDS || 60) * 1000;
const THRESHOLD = Number(process.env.OHO_THRESHOLD_SECONDS || 180);
const MAX_PER_TICK = Number(process.env.OHO_MAX_PER_TICK || 6); // กันส่งรัว — ที่เหลือรอบถัดไป
const MAX_AGE = Number(process.env.OHO_MAX_AGE_SECONDS || 86400); // ห้ามอ่าน/เตือนแชทที่ค้างเก่ากว่านี้ (default 1 วัน)
const CLOSE_AFTER = Number(process.env.OHO_CLOSE_REMIND_SECONDS || 900); // แอดมินรับแชทเกินเท่านี้ยังไม่ปิด → เตือนอย่าลืมปิด (default 15 นาที)
const CLOSE_CHECK_COOLDOWN = Number(process.env.OHO_CLOSE_CHECK_COOLDOWN_SECONDS || 300) * 1000; // เว้นระยะ re-inspect แชทเปิด-เก่าเพื่อเช็คปิด (default 5 นาที)
const APP_URL = process.env.APP_URL || "http://localhost:3000";
const INTERNAL = process.env.INTERNAL_API_TOKEN || "";
const OWNER_ID = "7750653134";

if (!TOKEN || !ALERT_CHAT) { console.error("ต้องตั้ง TELEGRAM_BOT_TOKEN + OHO_ALERT_CHAT_ID"); process.exit(1); }
if (!fs.existsSync(SESSION)) { console.error("ยังไม่มี session — รัน npm run oho:auth ก่อน"); process.exit(1); }

// ดึงกลุ่มเป้าหมายที่ตั้งผ่านปุ่มห้อง Lead (เก็บใน DB) — ไม่ได้ตั้ง/เรียกไม่ได้ = ใช้ค่า env เดิม
async function refreshAlertChat() {
  try {
    const r = await fetch(APP_URL + "/api/oho/alert-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
    });
    const j = await r.json();
    if (j && j.chatId) ALERT_CHAT = String(j.chatId);
  } catch { /* ใช้ค่าเดิม */ }
}

// ระดับการเตือน (escalation) + สีความรุนแรง
const LEVELS = [
  { sec: THRESHOLD, emoji: "🟡", label: `ค้างเกิน ${Math.round(THRESHOLD / 60)} นาที ยังไม่มีคนรับ` },
  { sec: 300, emoji: "🟠", label: "ยังไม่รับ เกิน 5 นาที (เตือนซ้ำ)" },
  { sec: 600, emoji: "🔴", label: "ด่วนมาก! ค้างเกิน 10 นาที ยังไม่มีคนรับ" },
];
function levelFor(sec) {
  let lv = 0;
  for (let i = 0; i < LEVELS.length; i++) if (sec >= LEVELS[i].sec) lv = i + 1;
  return lv; // 0=ยังไม่ถึง, 1..3
}

// กลุ่มอัปเกรดเป็น supergroup → id เปลี่ยน (Telegram คืน migrate_to_chat_id) → อัปเดต ALERT_CHAT + persist ลง DB แล้วส่งใหม่
async function persistAlertChat(newId) {
  ALERT_CHAT = String(newId);
  console.log(new Date().toISOString(), "กลุ่มถูกอัปเกรด → เปลี่ยนปลายทางเป็น", newId);
  try {
    await fetch(APP_URL + "/api/oho/alert-chat", { method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL }, body: JSON.stringify({ set: String(newId) }) });
  } catch { /* รอบหน้า refresh เอง */ }
}
async function tg(method, body) {
  let r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json());
  const mig = r?.parameters?.migrate_to_chat_id;
  if (mig && String(body.chat_id) === String(ALERT_CHAT)) {
    await persistAlertChat(mig);
    r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, chat_id: String(mig) }) }).then((x) => x.json());
  }
  return r;
}
async function sendPhoto(caption, photo, replyMarkup, threadId) {
  const build = (cid) => { const f = new FormData(); f.append("chat_id", String(cid)); if (threadId) f.append("message_thread_id", String(threadId)); f.append("parse_mode", "HTML"); f.append("caption", caption.slice(0, 1024)); if (replyMarkup) f.append("reply_markup", JSON.stringify(replyMarkup)); f.append("photo", new Blob([new Uint8Array(photo)]), "chat.png"); return f; };
  let r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, { method: "POST", body: build(ALERT_CHAT) }).then((x) => x.json());
  const mig = r?.parameters?.migrate_to_chat_id;
  if (mig) { await persistAlertChat(mig); r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, { method: "POST", body: build(ALERT_CHAT) }).then((x) => x.json()); }
  return r;
}
// ปุ่มกด "เปิดแชท" (inline keyboard, ลิงก์ตรงเข้าห้อง) — แนบกับทั้ง sendPhoto และ sendMessage
function openChatButton(link) {
  return { inline_keyboard: [[{ text: "💬 เปิดแชทนี้", url: link }]] };
}
function esc(s) {
  return String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function mmss(sec) {
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return `${h} ชม.${m ? ` ${m} นาที` : ""}`;
  }
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")} นาที`;
}

// ปิด popup/modal ที่ OHO เด้งขึ้นมาบังหน้าแชท (ประกาศอัปเดตระบบ, แบบสอบถามความพึงพอใจ ฯลฯ)
// → กดกากบาท (.el-dialog__headerbtn) ปิดเอง ไม่งั้นบังการแคป/อ่านห้องแชท
async function dismissPopups(page) {
  try {
    const closed = await page.evaluate(() => {
      const isVisible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
      };
      // เฉพาะ modal ที่เป็น "ประกาศ/แจ้งเตือน/แบบสอบถาม" (ไม่แตะ dialog ใช้งานปกติ)
      const KEY = /แจ้งอัปเดตระบบ|ขอแจ้งอัปเดต|ปรับปรุงประสิทธิภาพ|ประกาศ|แบบสอบถาม|ความเห็นของคุณลูกค้า|ความพึงพอใจ/;
      let n = 0;
      for (const w of document.querySelectorAll(".el-dialog__wrapper, [role=dialog]")) {
        if (!isVisible(w) || !KEY.test(w.textContent || "")) continue;
        const btn = w.querySelector(".el-dialog__headerbtn, .el-dialog__close");
        if (btn) { (btn.closest("button") || btn).click(); n++; }
      }
      return n;
    });
    if (closed) { await page.waitForTimeout(600); console.log(`[oho] ปิด popup ${closed} อัน`); }
    return closed;
  } catch { return 0; }
}

// สแกนแชทค้าง (เลื่อน virtual list เก็บให้ครบ)
// จับ "ลูกค้าทักแล้วยังไม่มีคนอ่าน/ตอบ" = มี .message.unread (ครอบคลุมทั้งแชทใหม่รอรับ และแชทที่ปิดแล้วลูกค้าทักใหม่)
async function scanWaiting(page, maxAgeSec) {
  return page.evaluate(async (maxAge) => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const toSec = (t) => { const m = (t || "").match(/(\d+):(\d{2}):(\d{2})/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null; };
    // เวลาสัมพัทธ์ไทย ("8 นาที", "1 ชั่วโมง", "ไม่กี่วินาที") → วินาที (หยาบ)
    const parseRel = (t) => {
      if (!t) return null;
      if (/วินาที|ไม่กี่/.test(t)) return 30;
      const day = t.match(/(\d+)\s*วัน/); if (day) return +day[1] * 86400;
      let s = 0; const hr = t.match(/(\d+)\s*ชั่วโมง/); const mn = t.match(/(\d+)\s*นาที/);
      if (hr) s += +hr[1] * 3600; if (mn) s += +mn[1] * 60;
      return s || null;
    };
    const scroller = document.querySelector(".vue-recycle-scroller");
    const found = new Map();
    const collect = () => {
      for (const r of document.querySelectorAll(".smartchat-room.contact")) {
        const preview = clean(r.querySelector(".message")?.textContent);
        // ข้ามแชทที่ "จบแชทแล้ว/ปิดเคส" (ข้อความล่าสุดเป็นระบบปิดแชท ไม่ใช่ลูกค้าทักค้าง)
        if (/^(จบแชท|จบเคส|ปิดแชท|ปิดเคส|โอนแชท)/.test(preview)) continue;
        // ต้องมีข้อความลูกค้าที่ยังไม่อ่าน (unread) หรือเป็นแชทใหม่รอรับ ถึงจะถือว่าค้าง
        // (ถ้าแอดมินรับ/กำลังตอบอยู่ ข้อความล่าสุดจะเป็นของแอดมิน = ไม่ unread → ถูกตัดออกเอง)
        if (!r.querySelector(".message.unread") && !r.querySelector(".case-status.start")) continue;
        const id = (r.id || "").replace("room_item_", "");
        if (!id) continue;
        const tc = r.querySelector(".time-counter");
        const timeEl = r.querySelector(".time");
        const waitSec = tc ? toSec(tc.textContent) : parseRel(clean(timeEl?.textContent));
        if (waitSec == null) continue;
        if (waitSec >= maxAge) continue; // ห้ามอ่าน/เตือนแชทค้างเก่ากว่า 1 วัน
        found.set(id, {
          convId: id,
          channel: clean(r.querySelector(".channel-name")?.textContent),
          // แพลตฟอร์มจากไอคอน img.platform (icon-line.svg=LINE / icon-messenger.svg=FB)
          platform: (() => { const s = r.querySelector("img.platform")?.getAttribute("src") || ""; if (/line/i.test(s)) return "line"; if (/messenger|facebook/i.test(s)) return "fb"; return ""; })(),
          customer: clean(r.querySelector(".contact-name")?.textContent).slice(0, 40),
          waitSec,
          precise: !!tc, // true=จากตัวนับ, false=จากเวลาสัมพัทธ์ (หยาบ)
          endCase: !!r.querySelector(".end-case"),
          team: [...r.querySelectorAll(".team-tag")].map((t) => clean(t.textContent)).filter((t) => !/สมาชิกทั้งหมด/.test(t)).join(","),
        });
      }
    };
    if (scroller) {
      for (let y = 0; y <= scroller.scrollHeight + 400; y += 400) { scroller.scrollTop = y; await new Promise((r) => setTimeout(r, 120)); collect(); }
      scroller.scrollTop = 0;
    } else collect();
    return [...found.values()];
  }, maxAgeSec);
}

// แคปเฉพาะช่องแชทนั้น — recycle-scroller ใช้ transform → ต้องเลื่อนทีละน้อยจนแถวอยู่ในจอจริง แล้ว clip จาก full page
async function shotRoom(page, convId) {
  const rect = await page.evaluate(async (id) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const scroller = document.querySelector(".vue-recycle-scroller");
    const findWrap = () => { const el = document.querySelector("#room_item_" + id); return el ? el.querySelector(".contact-wrapper") || el : null; };
    const okRect = (w) => { const r = w.getBoundingClientRect(); return r.height > 10 && r.y > 160 && r.y + r.height < 920 ? { x: Math.max(0, Math.round(r.x) - 6), y: Math.round(r.y) - 6, width: Math.round(r.width) + 12, height: Math.round(r.height) + 12 } : null; };
    let w = findWrap(); if (w) { const g = okRect(w); if (g) return g; }
    if (scroller) {
      for (let y = 0; y <= scroller.scrollHeight; y += 70) {
        scroller.scrollTop = y; await sleep(70);
        w = findWrap(); if (w) { const g = okRect(w); if (g) return g; }
      }
    }
    return null;
  }, convId);
  if (!rect) return null;
  return page.screenshot({ clip: rect }).catch(() => null);
}

// โซนคอลัมน์กลาง (บทสนทนา) สำหรับแคป — วัดจาก layout OHO ที่ viewport 1440x1000
const CENTER_CLIP = { x: 660, y: 62, width: 470, height: 902 };

// เข้าแชทด้วย deep-link ?room= → อ่านสถานะบทสนทนา (ไม่ต้องคลิก list ที่ virtualize)
//   lastSide: ข้อความล่าสุดเป็นของใคร (customer/admin) · notAccepted: มีปุ่ม "รับแชท" = ยังไม่มีคนรับ
async function inspectRoom(page, convId) {
  try {
    await page.goto(`${URL}?room=${convId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    await dismissPopups(page); // popup อาจเด้งใหม่หลังโหลดหน้า → ปิดก่อนอ่าน/แคป
    await page.evaluate(() => {
      const c = document.querySelector(".message-container") || document.querySelector("[class*=message-list]");
      if (c) c.scrollTop = c.scrollHeight; // เลื่อนไปข้อความล่าสุด
    }).catch(() => {});
    await page.waitForTimeout(500);
    return await page.evaluate(() => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const bubbles = [...document.querySelectorAll(".bubble-wrap")];
      // แอดมิน = ancestor มี class not-customer/agent-user · ลูกค้า = ไม่มี marker พวกนี้ (เชื่อถือได้กว่าตำแหน่ง)
      const sideOf = (el) => {
        let n = el;
        for (let i = 0; i < 6 && n; i++) { const c = typeof n.className === "string" ? n.className : ""; if (/\bnot-customer\b|\bagent-user\b/.test(c)) return "admin"; n = n.parentElement; }
        return "customer";
      };
      let lastSide = null, lastCust = "";
      const msgs = []; // บทสนทนาล่าสุด (ไว้ให้ AI วิเคราะห์) — {side, text}
      for (const b of bubbles) {
        const t = clean(b.textContent); if (!t) continue;
        lastSide = sideOf(b);
        const text = t.replace(/^ios_share\s*(อ่านแล้ว)?\s*/, "");
        if (lastSide === "customer") lastCust = text;
        msgs.push({ side: lastSide, text: text.slice(0, 300) });
      }
      const recentMsgs = msgs.slice(-12); // เก็บ 12 ข้อความล่าสุดพอเป็นบริบท
      // แอดมินที่รับแชท + เวลาตั้งแต่รับ: header "X (Day/Night) กำลังดูแล H:MM:SS" (ต้องมี timer ถึงนับว่ารับจริง กันชนกับ "สมาชิกท่านอื่นกำลังดูแล...")
      let assigned = false, assignedName = "", handlingSec = null;
      const careEl = [...document.querySelectorAll("*")].find((e) => { const t = clean(e.textContent); return /กำลังดูแล\s*\d{1,2}:\d{2}:\d{2}/.test(t) && t.length < 90; });
      if (careEl) {
        const m = clean(careEl.textContent).match(/^(.*?)\s*(?:Day|Night)?\s*กำลังดูแล\s*(\d{1,2}):(\d{2}):(\d{2})/);
        if (m) { assigned = true; assignedName = (m[1] || "").trim().slice(0, 30); handlingSec = (+m[2]) * 3600 + (+m[3]) * 60 + (+m[4]); }
      }
      return { ok: bubbles.length > 0, lastSide, lastCust: lastCust.slice(0, 200), recentMsgs, assigned, assignedName, handlingSec };
    });
  } catch {
    return { ok: false };
  }
}
// แคปคอลัมน์กลาง (บทสนทนา) — อยู่บนหน้าแชทแล้วจาก inspectRoom
async function shotCenter(page) {
  return page.screenshot({ clip: CENTER_CLIP }).catch(() => null);
}

const state = new Map(); // convId -> { level, shiftNames, firstTs, handled, closeReminded }
const recentAlert = new Map(); // convId -> { level, ts } : กันเตือนซ้ำระดับเดิมถี่ๆ (เช่นแชทบอทที่ auto-reply เคลียร์ state)
const REALERT_COOLDOWN = Number(process.env.OHO_REALERT_COOLDOWN_SECONDS || 600) * 1000; // เว้นระยะเตือนซ้ำระดับเดิม (default 10 นาที)
const pendingClose = new Set(); // convId ที่แอดมินรับแล้วแต่ยังไม่ถึง 15 นาที — จับตา re-inspect ทุกรอบจนถึงเกณฑ์/ปิด
let sessionWarned = false;
let primed = false; // รอบแรก: บันทึก backlog เดิมไว้ (ไม่เตือนเดี่ยว) แล้วสรุปครั้งเดียว

async function tick(page) {
  // เช็ก session
  const alive = await page.locator(".smartchat-room, .contact-wrapper").count().catch(() => 0);
  if (alive === 0) {
    if (/\/(sign-?in|login)/i.test(page.url()) || alive === 0) {
      if (!sessionWarned) {
        sessionWarned = true;
        await tg("sendMessage", { chat_id: OWNER_ID, text: "⚠️ เซสชัน OHO หมดอายุ/หลุด — รบกวนพี่โด้รัน npm run oho:auth ใหม่นะคะ (การเฝ้าแชทหยุดชั่วคราว)" });
      }
      await page.goto(URL, { waitUntil: "domcontentloaded" }).catch(() => {});
      return;
    }
  }
  sessionWarned = false;

  await dismissPopups(page); // ปิด popup ประกาศ/แบบสอบถามที่บังหน้าแชทก่อนสแกน
  await refreshAlertChat(); // อัปเดตกลุ่มเป้าหมาย (เผื่อเปลี่ยนผ่านปุ่มห้อง Lead)
  const waiting = await scanWaiting(page, MAX_AGE);
  const activeIds = new Set(waiting.map((w) => w.convId));

  // รอบแรก: บันทึกแชทค้างเดิมทั้งหมดไว้เป็น "รู้แล้ว" (ไม่ถล่มเตือนเดี่ยว) แล้วสรุปครั้งเดียว
  // ต่อจากนี้จะเตือนเดี่ยวเฉพาะแชทที่ค้างใหม่/ยกระดับหลังเริ่มเฝ้า
  if (!primed) {
    primed = true;
    const backlog = waiting.filter((w) => levelFor(w.waitSec) > 0);
    for (const w of backlog) state.set(w.convId, { level: levelFor(w.waitSec), shiftNames: "", firstTs: Date.now() });
    if (backlog.length) {
      await tg("sendMessage", {
        chat_id: ALERT_CHAT,
        text: `เริ่มเฝ้าแชท OHO แล้วค่ะ 👀 ตอนนี้มีแชทที่ยังไม่มีคนตอบค้างอยู่ ${backlog.length} รายการ\nต่อจากนี้ถ้ามีแชทค้างใหม่เกิน 3 นาที วานจะแจ้งเตือนพร้อมแท็กเวรให้เลยค่ะ`,
      }).catch(() => {});
    }
    return;
  }

  // คัดที่ต้องเตือน (ข้ามเกณฑ์ใหม่) + แชทที่จับตารอเตือนปิด (assigned <15นาที) เพื่อ re-inspect ทุกรอบ
  const candidates = waiting
    .filter((w) => levelFor(w.waitSec) > (state.get(w.convId)?.level || 0))
    .sort((a, b) => b.waitSec - a.waitSec);
  const toAlert = candidates.slice(0, MAX_PER_TICK);
  const overflow = candidates.length - toAlert.length;
  const watchClose = waiting.filter((w) => pendingClose.has(w.convId) && !toAlert.some((a) => a.convId === w.convId));
  // แชทเปิดที่เก่าเกินเกณฑ์ปิด (>15นาที) และยังไม่เคยเตือนปิด → inspect เพื่อเช็คกฎ "อย่าลืมปิด"
  // (ครอบเคสที่แอดมินรับไว้ตั้งแต่ก่อน/หลัง watcher restart ที่ไม่ใช่ candidate แล้ว) — มี cooldown กันเปิดถี่
  const nowMs = Date.now();
  const inToInspect = (id) => toAlert.some((a) => a.convId === id) || watchClose.some((a) => a.convId === id);
  const closeCheck = waiting.filter((w) => {
    const st = state.get(w.convId);
    return w.waitSec >= CLOSE_AFTER && !st?.closeReminded && !inToInspect(w.convId) && nowMs - (st?.closeCheckedAt || 0) > CLOSE_CHECK_COOLDOWN;
  });
  const toInspect = [...toAlert, ...watchClose, ...closeCheck.slice(0, MAX_PER_TICK)];

  for (const w of toInspect) {
    const prev = state.get(w.convId);
    const now = new Date();
    const { taggees, shift, offHours, onBreak } = getTaggees(now);
    const lv = Math.max(1, levelFor(w.waitSec));
    const L = LEVELS[lv - 1];
    const crossShift = prev && prev.shiftNames && prev.shiftNames !== shift.map((s) => s.name).join(",");
    const link = `${URL}?room=${w.convId}`;
    const shiftNames = shift.map((s) => s.name).join(",");

    // จำแนก Product/บริษัท/แพลตฟอร์ม → หัวการ์ด + Topic ปลายทาง
    const route = classifyOho(w.channel); // {product,company,topicKey,title} | null
    const brand = route ? brandOf(route.company) : null;
    const pEmoji = route ? platformEmoji(route.company, w.platform) : "";
    const pLabel = platformLabel(w.platform);
    // หัวการ์ดบอก Product + แพลตฟอร์ม (ไม่รู้จัก = ไม่มีหัว)
    const brandHead = route ? `${brand.emoji} <b>${esc(route.title)}</b>${pEmoji ? `  ·  ${pEmoji} ${esc(pLabel)}` : ""}\n` : "";
    const chanLine = `📲 ช่องทาง : <b>${esc(w.channel || "-")}</b>${pLabel ? ` · ${esc(pLabel)}` : ""}${w.team ? ` · ทีม ${esc(w.team)}` : ""}\n`;

    // เข้าไปอ่านบทสนทนาจริง (สถานะ + แคปหน้าแชท + ข้อความลูกค้าล่าสุด + แอดมินที่รับ + เวลาตั้งแต่รับ)
    const insp = await inspectRoom(page, w.convId);

    // แอดมินรับแชทแล้ว (header "กำลังดูแล") = ไม่ใช่ "ยังไม่มีคนรับ" → ไม่ต้องปลุกทั้งกลุ่มให้กดรับ
    // (เคส Image #1: ลูกค้าพิมพ์เพิ่มระหว่างที่แอดมินดูแลอยู่ — เดิมเตือนผิดว่าค้าง ตอนนี้ข้าม)
    // เช็คก่อน lastSide=customer เพราะสถานะ "กำลังดูแล" สำคัญกว่าใครพิมพ์ล่าสุด
    if (insp.assigned && insp.handlingSec != null) {
      // (A) รับแล้วเกินเกณฑ์ปิด ยังไม่ปิด → เตือน "อย่าลืมปิดแชท" (ครั้งเดียว) + แท็กเฉพาะแอดมินที่ดูแล
      if (insp.handlingSec >= CLOSE_AFTER) {
        if (!prev?.closeReminded) {
          // ลำดับความสำคัญ: ช่องทาง (EasySlip=หนิง+โด้) → ชื่อแอดมินที่ดูแล → เวร (กันไม่มีคนถูกแท็ก)
          const owners = tagsForChannel(w.channel).length ? tagsForChannel(w.channel) : tagsForAgent(insp.assignedName);
          const tagStr = owners.length ? formatTags(owners) : formatTags(taggees);
          const caption =
            brandHead +
            `⏰ <b>อย่าลืมปิดแชท</b> (แอดมินรับเกิน ${Math.round(CLOSE_AFTER / 60)} นาที)\n` +
            `\n` +
            chanLine +
            `👤 ลูกค้า : <b>${esc(w.customer || "-")}</b>\n` +
            (insp.assignedName ? `🙋 แอดมินที่ดูแล : <b>${esc(insp.assignedName)}</b>\n` : "") +
            `⏱️ รับแชทมาแล้ว : <b>${mmss(insp.handlingSec)}</b>\n` +
            `\n` +
            `${tagStr}\nถ้าคุยจบแล้วรบกวนกดปิดแชทด้วยนะคะ 🙏`;
          const photo = await shotCenter(page).catch(() => null);
          const kb = openChatButton(link);
          const thread = route ? topicId(brand.closeKey) : undefined; // ปิดแชท Thunder/EasySlip แยกห้อง
          try {
            if (photo) await sendPhoto(caption, photo, kb, thread);
            else await tg("sendMessage", { chat_id: ALERT_CHAT, message_thread_id: thread, parse_mode: "HTML", text: caption, reply_markup: kb });
            console.log(new Date().toISOString(), "close-remind", w.channel, w.customer, mmss(insp.handlingSec), insp.assignedName, "→", route?.company || "?");
          } catch (e) { console.error("send fail", e?.message); }
          state.set(w.convId, { ...prev, level: lv, shiftNames, firstTs: prev?.firstTs || Date.now(), closeReminded: true });
        }
        pendingClose.delete(w.convId);
        continue;
      }
      // (B) รับแล้วแต่ยังไม่ถึงเกณฑ์ปิด → จับตาไว้ re-inspect รอบถัดไปจนถึงเกณฑ์/ปิด (ไม่เตือน)
      pendingClose.add(w.convId);
      state.set(w.convId, { ...prev, level: lv, shiftNames, firstTs: prev?.firstTs || Date.now() });
      console.log(new Date().toISOString(), "watch-close", w.channel, w.customer, mmss(insp.handlingSec));
      continue;
    }

    // ถึงตรงนี้ = ยังไม่มีแอดมินรับ (ไม่ขึ้น "กำลังดูแล") หรืออ่านสถานะไม่ได้
    // (1) ลูกค้าพิมพ์ล่าสุด / อ่านไม่ได้ → แชทค้างจริง เตือนเมื่อยกระดับ + แท็กเวร+ผจก.+เจ้าของ (ตามเดิม)
    if (!insp.ok || insp.lastSide === "customer") {
      // กันเตือนซ้ำระดับเดิมถี่ๆ: เพิ่งเตือน convId นี้ที่ระดับ >= lv ภายใน cooldown → ไม่เตือนซ้ำ (ยังยกระดับสูงขึ้นได้)
      const ra = recentAlert.get(w.convId);
      const cooled = ra && nowMs - ra.ts < REALERT_COOLDOWN && lv <= ra.level;
      const escalated = lv > (prev?.level || 0) && !cooled;
      if (escalated) {
        const notes = [];
        if (offHours) notes.push("นอกเวลาทำการ/ไม่มีเวร — แจ้งผู้จัดการกับพี่โด้ตรง");
        if (onBreak) notes.push("ช่วงนี้อาจมีคนพัก");
        if (crossShift) notes.push("แชทค้างข้ามกะ — แท็กกะที่รับช่วงต่อ");
        // ช่องทางที่มีเจ้าภาพเฉพาะ (EasySlip=หนิง+โด้) แท็กเฉพาะเจ้าภาพ ไม่งั้นแท็กเวร+ผจก.+เจ้าของ
        const alertTags = formatTags(tagsForChannel(w.channel).length ? tagsForChannel(w.channel) : taggees);
        // AI วิเคราะห์บทสนทนา → ร่างข้อความพร้อมส่งให้ลูกค้า (ก๊อปได้) — ล่ม/ช้า = ข้าม ไม่บล็อกการเตือน
        let aiLine = "", aiReply = "";
        if (route) {
          try {
            const ai = await analyzeChat(route.product, { productTitle: route.title, customer: w.customer, recentMsgs: insp.recentMsgs, lastCust: insp.lastCust });
            if (ai?.kind === "suggest") { aiReply = ai.text; aiLine = `🎯 <b>แอดมินร่างข้อความให้แล้ว</b> — ก๊อปด้านล่างส่งได้เลยค่ะ ⬇️\n`; }
            else if (ai?.kind === "missing") aiLine = `🎯 <b>ขอข้อมูลเพิ่มเข้าสมองหน่อยนะ</b> : <i>${esc(ai.text)}</i>\n`;
          } catch { /* ข้าม */ }
        }
        const caption =
          brandHead +
          `${L.emoji} <b>${esc(L.label)}</b>\n` +
          `\n` +
          chanLine +
          `👤 ลูกค้า : <b>${esc(w.customer || "-")}</b>\n` +
          `⚠️ รอมาแล้ว : <b>${mmss(w.waitSec)}</b>\n` +
          (insp.lastCust ? `💬 ลูกค้าพิมพ์ล่าสุด : <b>${esc(insp.lastCust)}</b>\n` : "") +
          aiLine +
          `\n` +
          `${alertTags}\nรบกวนกดรับแชท/ตอบลูกค้าด้วยนะคะ 🙏` +
          (notes.length ? `\n\n<i>(${esc(notes.join(" · "))})</i>` : "");
        let photo = insp.ok ? await shotCenter(page).catch(() => null) : null;
        if (!photo) photo = await shotRoom(page, w.convId).catch(() => null);
        const kb = openChatButton(link);
        const thread = route ? topicId(route.topicKey) : undefined; // เข้า Topic ตาม Product
        try {
          const sent = photo ? await sendPhoto(caption, photo, kb, thread) : await tg("sendMessage", { chat_id: ALERT_CHAT, message_thread_id: thread, parse_mode: "HTML", text: caption, reply_markup: kb });
          // ข้อความพร้อมส่งให้ลูกค้า — ส่งเป็นบล็อกก๊อปใต้การ์ด
          if (aiReply && sent?.ok) await tg("sendMessage", { chat_id: ALERT_CHAT, message_thread_id: thread, reply_to_message_id: sent.result.message_id, parse_mode: "HTML", text: copyReplyText(aiReply) });
          if (sent?.ok) recentAlert.set(w.convId, { level: lv, ts: nowMs }); // จำเวลาเตือนล่าสุด กันซ้ำระดับเดิม
          console.log(new Date().toISOString(), `alert L${lv} (ค้าง-ลูกค้ารอ)`, w.channel, w.customer, w.platform, mmss(w.waitSec), "→", route?.topicKey || "?");
        } catch (e) { console.error("send fail", e?.message); }
      }
      state.set(w.convId, { ...prev, level: Math.max(lv, prev?.level || 0), shiftNames, firstTs: prev?.firstTs || Date.now(), closeCheckedAt: nowMs });
      continue;
    }

    // (2) แอดมินตอบล่าสุด แต่ไม่ขึ้น "กำลังดูแล" (อ่าน timer ไม่ได้) → ถือว่าดูแลอยู่ ข้าม
    state.set(w.convId, { ...prev, level: lv, shiftNames, firstTs: prev?.firstTs || Date.now(), handled: true, closeCheckedAt: nowMs });
    console.log(new Date().toISOString(), "skip (แอดมินตอบล่าสุด)", w.channel, w.customer);
  }

  // inspectRoom นำทางออกจากหน้า list → กลับมาหน้า list ให้รอบถัดไปสแกนได้
  if (toInspect.length) {
    await page.goto(URL, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  // ถ้ารอบนี้มีค้างเกินโควตา → บอกสรุปว่าเหลืออีกกี่แชท (ทยอยเตือนรอบถัดไป)
  if (overflow > 0) {
    await tg("sendMessage", { chat_id: ALERT_CHAT, text: `…และมีแชทค้างรออีก ${overflow} รายการ เดี๋ยววานทยอยแจ้งให้นะคะ` }).catch(() => {});
  }

  // แชทที่หายไป (แอดมินรับแล้ว/จบแล้ว) → เคลียร์สถานะ
  for (const id of [...state.keys()]) if (!activeIds.has(id)) state.delete(id);
  for (const id of [...pendingClose]) if (!activeIds.has(id)) pendingClose.delete(id);
  for (const [id, ra] of recentAlert) if (nowMs - ra.ts > REALERT_COOLDOWN) recentAlert.delete(id); // prune cooldown เก่า
}

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({ storageState: SESSION, viewport: { width: 1440, height: 1000 }, locale: "th-TH" });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await refreshAlertChat(); // ดึงปลายทางล่าสุด (ตั้งผ่านปุ่ม/DB) ก่อน log+ส่ง
  console.log("เฝ้าแชท OHO แล้ว · เตือนที่", ALERT_CHAT, "· poll", POLL / 1000, "วิ · เกณฑ์", THRESHOLD, "วิ");
  await tg("sendMessage", { chat_id: OWNER_ID, text: "เริ่มเฝ้าแชท OHO แล้วค่ะ 👀 เจอแชทค้างเกิน 3 นาทีจะเตือนในกลุ่มพร้อมแท็กเวรให้เลย" }).catch(() => {});

  for (;;) {
    try { await tick(page); } catch (e) { console.error("tick error", e?.message); }
    await new Promise((r) => setTimeout(r, POLL));
  }
}
main();
