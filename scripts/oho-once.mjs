// ยิงเตือนครั้งเดียวสำหรับแชทที่ระบุ (ตามชื่อ) — ใช้ทดสอบ/ส่งตัวอย่าง
// รัน: node scripts/oho-once.mjs "KORN" "Dohzy"
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { getTaggees, formatTags } from "./oho-shifts.mjs";

function loadEnv() {
  const p = path.join(process.cwd(), ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const URL = process.env.OHO_URL;
const SESSION = process.env.OHO_SESSION_PATH || ".oho-session.json";
const ALERT_CHAT = process.env.OHO_ALERT_CHAT_ID;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const targets = process.argv.slice(2).map((s) => s.toLowerCase());
if (!targets.length) { console.error("ใส่ชื่อแชทที่จะยิง เช่น: node scripts/oho-once.mjs KORN Dohzy"); process.exit(1); }

const esc = (s) => String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
function fmt(sec) {
  if (sec >= 3600) { const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return `${h} ชม.${m ? ` ${m} นาที` : ""}`; }
  const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${String(s).padStart(2, "0")} นาที`;
}

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({ storageState: SESSION, viewport: { width: 1440, height: 1000 }, locale: "th-TH" });
const page = await context.newPage();
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

// สแกนหาแชทที่ตรงชื่อ (unread + ไม่ใช่จบแชท)
const rooms = await page.evaluate((targets) => {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const toSec = (t) => { const m = (t || "").match(/(\d+):(\d{2}):(\d{2})/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null; };
  const parseRel = (t) => { if (!t) return null; if (/วินาที|ไม่กี่/.test(t)) return 30; const d = t.match(/(\d+)\s*วัน/); if (d) return +d[1] * 86400; let s = 0; const h = t.match(/(\d+)\s*ชั่วโมง/); const mn = t.match(/(\d+)\s*นาที/); if (h) s += +h[1] * 3600; if (mn) s += +mn[1] * 60; return s || null; };
  const out = [];
  for (const r of document.querySelectorAll(".smartchat-room.contact")) {
    const name = clean(r.querySelector(".contact-name")?.textContent);
    if (!targets.some((t) => name.toLowerCase().includes(t))) continue;
    const preview = clean(r.querySelector(".message")?.textContent);
    if (/^(จบแชท|จบเคส|ปิดแชท)/.test(preview)) continue;
    const tc = r.querySelector(".time-counter"), timeEl = r.querySelector(".time");
    out.push({ convId: (r.id || "").replace("room_item_", ""), channel: clean(r.querySelector(".channel-name")?.textContent), customer: name.slice(0, 40), waitSec: tc ? toSec(tc.textContent) : parseRel(clean(timeEl?.textContent)), team: [...r.querySelectorAll(".team-tag")].map((t) => clean(t.textContent)).filter((t) => !/สมาชิกทั้งหมด/.test(t)).join(",") });
  }
  return out;
}, targets);

console.log("found:", rooms.map((r) => r.customer + " " + r.waitSec + "s"));
const { taggees } = getTaggees(new Date());

for (const w of rooms) {
  // แคปเฉพาะช่องแชทนั้น
  const rect = await page.evaluate(async (id) => {
    const el = document.querySelector("#room_item_" + id); if (!el) return null;
    el.scrollIntoView({ block: "center" }); await new Promise((r) => setTimeout(r, 250));
    const r = el.getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height };
  }, w.convId);
  const photo = rect && rect.width > 10 ? await page.screenshot({ clip: rect }).catch(() => null) : null;
  const link = `${URL}?room=${w.convId}`;
  const caption =
    `🔴 <b>ด่วนมาก! แชทค้าง ยังไม่มีคนตอบ</b>\n` +
    `📥 ช่องทาง: <b>${esc(w.channel)}</b>${w.team ? ` · ทีม ${esc(w.team)}` : ""}\n` +
    `👤 ลูกค้า: <b>${esc(w.customer)}</b>\n` +
    `⚠️ รอมาแล้ว: <b>${fmt(w.waitSec)}</b>\n` +
    `🔗 เปิดแชท: <a href="${esc(link)}">คลิกเปิดแชทนี้</a>\n` +
    `${formatTags(taggees)} รบกวนกดรับแชทด้วยนะคะ`;
  const form = new FormData();
  form.append("chat_id", ALERT_CHAT);
  form.append("parse_mode", "HTML");
  form.append("caption", caption);
  if (photo) form.append("photo", new Blob([new Uint8Array(photo)]), "chat.png");
  const method = photo ? "sendPhoto" : "sendMessage";
  if (!photo) { form.delete("photo"); }
  const res = photo
    ? await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, { method: "POST", body: form }).then((r) => r.json())
    : await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: ALERT_CHAT, parse_mode: "HTML", text: caption }) }).then((r) => r.json());
  console.log("sent", w.customer, res.ok);
}
await browser.close();
process.exit(0);
