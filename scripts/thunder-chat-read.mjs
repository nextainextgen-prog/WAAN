// ===== Thunder — ไล่อ่านแชท OHO ทั้งวัน (ครบทุกห้อง ไม่ใช่เฉพาะแชทค้าง) =====
// รันก่อนรายงาน 06:00: เปิด OHO ด้วย session เดิม → เดินลิสต์ทุกห้องที่มีความเคลื่อนไหวใน 24 ชม.
// → เข้าไปอ่านบทสนทนา → ส่งเก็บเป็น ChatLog
// รันเอง: npm run thunder:read           (24 ชม.ล่าสุด)
//         npm run thunder:read -- 12     (12 ชม.ล่าสุด)
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { classifyOho } from "./lib/routes.mjs";

const ROOT = process.cwd();
try {
  for (const l of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* ใช้ค่า default */ }

const URL = process.env.OHO_URL || "https://app.oho.chat";
const SESSION = process.env.OHO_SESSION_PATH || path.join(ROOT, ".oho-session.json");
const APP_URL = process.env.CHANGOH_WEB_URL || "http://localhost:3000";
const INTERNAL = process.env.INTERNAL_API_TOKEN || "";
const HOURS = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : Number(process.env.THUNDER_READ_HOURS || 24);
const MAX_AGE = HOURS * 3600;
const MAX_ROOMS = Number(process.env.THUNDER_READ_MAX || 400); // กันหลุดควบคุม
const WINDOW_START = Date.now() - MAX_AGE * 1000; // อ่านเฉพาะข้อความที่คุยกันในช่วงนี้
const stamp = () => new Date().toISOString();

if (!fs.existsSync(SESSION)) { console.error("ยังไม่มี session OHO — รัน npm run oho:auth ก่อน"); process.exit(1); }

// เดินลิสต์เก็บ "ทุกห้อง" ที่ขยับภายใน maxAge (ไม่กรอง unread เหมือนตัวเฝ้า)
async function scanAllRooms(page, maxAge) {
  return page.evaluate(async (maxAgeSec) => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const toSec = (t) => { const m = (t || "").match(/(\d+):(\d{2}):(\d{2})/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null; };
    const parseRel = (t) => {
      if (!t) return null;
      if (/วินาที|ไม่กี่/.test(t)) return 30;
      const day = t.match(/(\d+)\s*วัน/); if (day) return +day[1] * 86400;
      const mon = t.match(/(\d+)\s*เดือน/); if (mon) return +mon[1] * 2592000;
      let s = 0;
      const hr = t.match(/(\d+)\s*ชั่วโมง/); const mn = t.match(/(\d+)\s*นาที/);
      if (hr) s += +hr[1] * 3600; if (mn) s += +mn[1] * 60;
      return s || null;
    };
    const scroller = document.querySelector(".vue-recycle-scroller");
    const found = new Map();
    const collect = () => {
      for (const r of document.querySelectorAll(".smartchat-room.contact")) {
        const id = (r.id || "").replace("room_item_", "");
        if (!id || found.has(id)) continue;
        const tc = r.querySelector(".time-counter");
        const timeEl = r.querySelector(".time");
        const age = tc ? toSec(tc.textContent) : parseRel(clean(timeEl?.textContent));
        if (age == null || age > maxAgeSec) continue; // เก่ากว่าช่วงที่สนใจ → ข้าม
        found.set(id, {
          convId: id,
          channel: clean(r.querySelector(".channel-name")?.textContent),
          platform: (() => { const s = r.querySelector("img.platform")?.getAttribute("src") || ""; if (/line/i.test(s)) return "line"; if (/messenger|facebook/i.test(s)) return "fb"; return ""; })(),
          customer: clean(r.querySelector(".contact-name")?.textContent).slice(0, 40),
          ageSec: age,
        });
      }
    };
    if (scroller) {
      let last = -1;
      for (let guard = 0; guard < 200; guard++) {
        for (let y = 0; y <= scroller.scrollHeight + 600; y += 400) {
          scroller.scrollTop = y;
          await new Promise((r) => setTimeout(r, 110));
          collect();
        }
        if (found.size === last) break; // ไม่มีของใหม่แล้ว = สุดลิสต์
        last = found.size;
        scroller.scrollTop = scroller.scrollHeight;
        await new Promise((r) => setTimeout(r, 400)); // รอโหลดหน้าถัดไป (lazy load)
      }
      scroller.scrollTop = 0;
    } else collect();
    return [...found.values()];
  }, maxAge);
}

// แปลงเวลาไทยใน OHO ("20 ก.ค. 69 | 09:32") → epoch ms
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
function parseThaiStamp(text) {
  const m = (text || "").match(/(\d{1,2})\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(\d{2,4})\s*\|\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const day = +m[1];
  const mon = TH_MONTHS.indexOf(m[2]);
  if (mon < 0) return null;
  let yy = +m[3];
  const beYear = yy < 100 ? 2500 + yy : yy; // "69" = 2569
  const year = beYear - 543;
  return Date.UTC(year, mon, day, +m[4], +m[5]) - 7 * 3600_000; // เวลาไทย → epoch
}

// อ่านบทสนทนาในห้อง — เก็บเวลาของแต่ละข้อความมาด้วย เพื่อกรองเฉพาะช่วงที่สนใจ
// retry เมื่ออ่านได้ว่าง: บ่อยครั้ง bubble ยังโหลดไม่ทัน (โดยเฉพาะตอนยิงหลายห้องรัวๆ ตอนเช้า)
async function readRoom(page, convId) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await readRoomOnce(page, convId, attempt === 0 ? 2600 : 5000);
    if (res.ok && res.msgs.length) return res;
    if (attempt === 0) await page.waitForTimeout(1200); // รอแล้วลองใหม่หนึ่งครั้ง
    else return res;
  }
  return { ok: false, msgs: [] };
}

async function readRoomOnce(page, convId, waitMs) {
  try {
    await page.goto(`${URL}?room=${convId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(waitMs);
    // รอ bubble โผล่จริงก่อน (สูงสุด 6 วิ) — กันเคสหน้าโหลดช้า
    await page.waitForFunction(() => document.querySelectorAll(".bubble-wrap").length > 0, null, { timeout: 6000, polling: 400 }).catch(() => {});
    await page.evaluate(() => {
      const c = document.querySelector(".message-container") || document.querySelector("[class*=message-list]");
      if (c) c.scrollTop = c.scrollHeight;
    }).catch(() => {});
    await page.waitForTimeout(400);
    return await page.evaluate(() => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const sideOf = (el) => {
        let n = el;
        for (let i = 0; i < 6 && n; i++) {
          const c = typeof n.className === "string" ? n.className : "";
          if (/\bnot-customer\b|\bagent-user\b/.test(c)) return "admin";
          n = n.parentElement;
        }
        return "customer";
      };
      // เดินตามลำดับจริงในหน้า: .time เป็นป้ายเวลาของข้อความถัดไป (บางข้อความไม่มีป้าย = ใช้ของก่อนหน้า)
      const cont = document.querySelector("#conversation") || document.querySelector(".message-container")?.parentElement || document.body;
      const nodes = [...cont.querySelectorAll(".time, .bubble-wrap")];
      const msgs = [];
      let lastTime = "";
      for (const n of nodes) {
        const cls = typeof n.className === "string" ? n.className : "";
        if (/\btime\b/.test(cls)) { const t = clean(n.textContent); if (t) lastTime = t; continue; }
        const t = clean(n.textContent);
        if (!t) continue;
        msgs.push({ side: sideOf(n), text: t.replace(/^ios_share\s*(อ่านแล้ว)?\s*/, "").slice(0, 500), timeText: lastTime });
      }
      let assignedName = "";
      const careEl = [...document.querySelectorAll("*")].find((e) => {
        const x = clean(e.textContent);
        return /กำลังดูแล\s*\d{1,2}:\d{2}:\d{2}/.test(x) && x.length < 90;
      });
      if (careEl) {
        const m = clean(careEl.textContent).match(/^(.*?)\s*(?:Day|Night)?\s*กำลังดูแล/);
        if (m) assignedName = (m[1] || "").trim().slice(0, 30);
      }
      return { ok: msgs.length > 0, msgs, assignedName };
    });
  } catch {
    return { ok: false, msgs: [] };
  }
}

async function save(row, msgs, admin) {
  const route = classifyOho(row.channel);
  try {
    const r = await fetch(`${APP_URL}/api/thunder/chatlog`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify({
        convId: row.convId, channel: row.channel, platform: row.platform, customer: row.customer,
        admin: admin || null, brand: route?.company || null, service: route?.product || null, messages: msgs,
      }),
    });
    return r.ok;
  } catch { return false; }
}

async function main() {
  console.log(stamp(), `เริ่มไล่อ่านแชท OHO ย้อนหลัง ${HOURS} ชม. (เก็บเฉพาะข้อความตั้งแต่ ${new Date(WINDOW_START + 7 * 3600_000).toISOString().slice(0, 16).replace("T", " ")} น. เวลาไทย)`);
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({ storageState: SESSION, viewport: { width: 1440, height: 1000 }, locale: "th-TH" });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);

  if (/login|signin/i.test(page.url())) {
    console.error(stamp(), "เซสชัน OHO หมดอายุ — รัน npm run oho:auth");
    await browser.close();
    process.exit(2);
  }

  const rooms = await scanAllRooms(page, MAX_AGE);
  console.log(stamp(), `เจอห้องที่ขยับใน ${HOURS} ชม.: ${rooms.length} ห้อง`);
  const list = rooms.slice(0, MAX_ROOMS);
  if (rooms.length > list.length) console.log(stamp(), `⚠️ จำกัดที่ ${MAX_ROOMS} ห้อง (เหลือ ${rooms.length - list.length} ห้องไม่ได้อ่าน)`);

  let saved = 0, empty = 0, failed = 0, outOfWindow = 0;
  for (const [i, row] of list.entries()) {
    const res = await readRoom(page, row.convId);
    if (!res.ok || !res.msgs.length) { empty++; continue; }

    // เก็บเฉพาะข้อความที่คุยกันในช่วงเวลาที่สนใจ (ไม่ลากบทสนทนาเก่าของสัปดาห์ก่อนเข้ามาปน)
    const inWindow = res.msgs.filter((m) => {
      const ts = parseThaiStamp(m.timeText);
      return ts === null ? false : ts >= WINDOW_START;
    });
    if (!inWindow.length) { outOfWindow++; continue; } // ห้องนี้ไม่มีการคุยในช่วงนี้จริง
    const msgs = inWindow.slice(-60).map((m) => ({ side: m.side, text: m.text }));

    const ok = await save(row, msgs, res.assignedName);
    ok ? saved++ : failed++;
    if ((i + 1) % 20 === 0) console.log(stamp(), `...อ่านแล้ว ${i + 1}/${list.length} (เก็บ ${saved})`);
    await page.waitForTimeout(250); // เว้นจังหวะ ไม่ถล่ม OHO
  }

  console.log(stamp(), `เสร็จ · เก็บ ${saved} ห้อง · ไม่มีข้อความในช่วงเวลา ${outOfWindow} · ว่าง/อ่านไม่ได้ ${empty} · ส่งไม่สำเร็จ ${failed}`);
  await browser.close();
}

main().catch(async (e) => { console.error(stamp(), "ผิดพลาด:", e?.message || e); process.exit(1); });
