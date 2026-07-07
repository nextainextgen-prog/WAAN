// เฝ้าแชท OHO Chat — เจอแชทค้างเกิน 3 นาทียังไม่มีคนรับ → แคปช่องแชทนั้น → เตือนกลุ่ม + แท็กเวร
// รัน: npm run oho:watch  (ต้อง oho:auth ก่อน)  — process รันถาวร (เหมือน drive:watch)
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { getTaggees, formatTags } from "./oho-shifts.mjs";

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
const ALERT_CHAT = process.env.OHO_ALERT_CHAT_ID;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const POLL = Number(process.env.OHO_POLL_SECONDS || 60) * 1000;
const THRESHOLD = Number(process.env.OHO_THRESHOLD_SECONDS || 180);
const MAX_PER_TICK = Number(process.env.OHO_MAX_PER_TICK || 6); // กันส่งรัว — ที่เหลือรอบถัดไป
const OWNER_ID = "7750653134";

if (!TOKEN || !ALERT_CHAT) { console.error("ต้องตั้ง TELEGRAM_BOT_TOKEN + OHO_ALERT_CHAT_ID"); process.exit(1); }
if (!fs.existsSync(SESSION)) { console.error("ยังไม่มี session — รัน npm run oho:auth ก่อน"); process.exit(1); }

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

async function tg(method, body) {
  return fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}
async function sendPhoto(caption, photo) {
  const form = new FormData();
  form.append("chat_id", ALERT_CHAT);
  form.append("parse_mode", "HTML");
  form.append("caption", caption.slice(0, 1024));
  form.append("photo", new Blob([new Uint8Array(photo)]), "chat.png");
  return fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, { method: "POST", body: form }).then((r) => r.json());
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

// สแกนแชทค้าง (เลื่อน virtual list เก็บให้ครบ)
// จับ "ลูกค้าทักแล้วยังไม่มีคนอ่าน/ตอบ" = มี .message.unread (ครอบคลุมทั้งแชทใหม่รอรับ และแชทที่ปิดแล้วลูกค้าทักใหม่)
async function scanWaiting(page) {
  return page.evaluate(async () => {
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
        found.set(id, {
          convId: id,
          channel: clean(r.querySelector(".channel-name")?.textContent),
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
  });
}

// แคปเฉพาะช่องแชทนั้น (เลื่อนให้ render ก่อน แล้ว clip)
async function shotRoom(page, convId) {
  const rect = await page.evaluate(async (id) => {
    const sel = "#room_item_" + id;
    const scroller = document.querySelector(".vue-recycle-scroller");
    const find = () => document.querySelector(sel);
    if (!find() && scroller) {
      for (let y = 0; y <= scroller.scrollHeight + 400; y += 300) { scroller.scrollTop = y; await new Promise((r) => setTimeout(r, 100)); if (find()) break; }
    }
    const el = find(); if (!el) return null;
    el.scrollIntoView({ block: "center" }); await new Promise((r) => setTimeout(r, 200));
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height };
  }, convId);
  if (!rect || rect.width < 10) return null;
  return page.screenshot({ clip: rect }).catch(() => null);
}

const state = new Map(); // convId -> { level, shiftNames, firstTs }
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

  const waiting = await scanWaiting(page);
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

  // คัดเฉพาะที่ต้องเตือน (ข้ามเกณฑ์ใหม่) เรียงด่วนสุดก่อน แล้วจำกัดจำนวนต่อรอบ กันส่งรัว
  const candidates = waiting
    .filter((w) => levelFor(w.waitSec) > (state.get(w.convId)?.level || 0))
    .sort((a, b) => b.waitSec - a.waitSec);
  const toAlert = candidates.slice(0, MAX_PER_TICK);
  const overflow = candidates.length - toAlert.length;

  for (const w of toAlert) {
    const lv = levelFor(w.waitSec);
    const prev = state.get(w.convId);
    const now = new Date();
    const { taggees, shift, offHours, onBreak } = getTaggees(now);
    const L = LEVELS[lv - 1];
    // ค้างข้ามกะ: เวรตอนแรก vs ตอนนี้ ต่างกัน
    const crossShift = prev && prev.shiftNames && prev.shiftNames !== shift.map((s) => s.name).join(",");

    const link = `${URL}?room=${w.convId}`;
    const notes = [];
    if (offHours) notes.push("นอกเวลาทำการ/ไม่มีเวร — แจ้งผู้จัดการกับพี่โด้ตรง");
    if (onBreak) notes.push("ช่วงนี้อาจมีคนพัก");
    if (crossShift) notes.push("แชทค้างข้ามกะ — แท็กกะที่รับช่วงต่อ");

    const caption =
      `${L.emoji} <b>${esc(L.label)}</b>\n` +
      `📥 ช่องทาง: <b>${esc(w.channel || "-")}</b>${w.team ? ` · ทีม ${esc(w.team)}` : ""}\n` +
      `👤 ลูกค้า: <b>${esc(w.customer || "-")}</b>\n` +
      `⚠️ รอมาแล้ว: <b>${mmss(w.waitSec)}</b>\n` +
      `🔗 เปิดแชท: <a href="${esc(link)}">คลิกเปิดแชทนี้</a>\n` +
      `${formatTags(taggees)} รบกวนกดรับแชทด้วยนะคะ` +
      (notes.length ? `\n<i>(${esc(notes.join(" · "))})</i>` : "");

    const photo = await shotRoom(page, w.convId).catch(() => null);
    try {
      if (photo) await sendPhoto(caption, photo);
      else await tg("sendMessage", { chat_id: ALERT_CHAT, parse_mode: "HTML", text: caption });
      console.log(new Date().toISOString(), `alert L${lv}`, w.channel, w.customer, mmss(w.waitSec));
    } catch (e) {
      console.error("send fail", e?.message);
    }
    state.set(w.convId, { level: lv, shiftNames: shift.map((s) => s.name).join(","), firstTs: prev?.firstTs || Date.now() });
  }

  // ถ้ารอบนี้มีค้างเกินโควตา → บอกสรุปว่าเหลืออีกกี่แชท (ทยอยเตือนรอบถัดไป)
  if (overflow > 0) {
    await tg("sendMessage", { chat_id: ALERT_CHAT, text: `…และมีแชทค้างรออีก ${overflow} รายการ เดี๋ยววานทยอยแจ้งให้นะคะ` }).catch(() => {});
  }

  // แชทที่หายไป (แอดมินรับแล้ว/จบแล้ว) → เคลียร์สถานะ
  for (const id of [...state.keys()]) if (!activeIds.has(id)) state.delete(id);
}

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({ storageState: SESSION, viewport: { width: 1440, height: 1000 }, locale: "th-TH" });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  console.log("เฝ้าแชท OHO แล้ว · เตือนที่", ALERT_CHAT, "· poll", POLL / 1000, "วิ · เกณฑ์", THRESHOLD, "วิ");
  await tg("sendMessage", { chat_id: OWNER_ID, text: "เริ่มเฝ้าแชท OHO แล้วค่ะ 👀 เจอแชทค้างเกิน 3 นาทีจะเตือนในกลุ่มพร้อมแท็กเวรให้เลย" }).catch(() => {});

  for (;;) {
    try { await tick(page); } catch (e) { console.error("tick error", e?.message); }
    await new Promise((r) => setTimeout(r, POLL));
  }
}
main();
