// ===== Thunder — แคปหน้าจอแชทของ "เคสเด่น" ไว้ใส่ในไฟล์รายงาน =====
// ใช้: node scripts/thunder-shots.mjs <convId1> <convId2> ...
// เปิดห้องแชทใน OHO แล้วแคปคอลัมน์บทสนทนา → ส่งเข้า /api/thunder/chatshot
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

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
// คอลัมน์กลาง = เฉพาะช่องบทสนทนา
// สำคัญ: ต้องไม่กินรายชื่อห้องด้านซ้าย เพราะจะติดชื่อลูกค้ารายอื่นมาด้วย (ข้อมูลรั่ว)
const CLIP = { x: 668, y: 88, width: 560, height: 862 };
const stamp = () => new Date().toISOString();

const ids = process.argv.slice(2).filter(Boolean);
if (!ids.length) { console.log(stamp(), "ไม่มี convId ให้แคป — ข้าม"); process.exit(0); }
if (!fs.existsSync(SESSION)) { console.error("ไม่มี session OHO — รัน npm run oho:auth"); process.exit(1); }

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const ctx = await browser.newContext({ storageState: SESSION, viewport: { width: 1440, height: 1000 }, locale: "th-TH" });
const page = await ctx.newPage();
let ok = 0;

for (const convId of ids) {
  try {
    await page.goto(`${URL}?room=${convId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3200);
    // ปิด popup ที่อาจบังหน้าจอ
    await page.evaluate(() => {
      for (const w of document.querySelectorAll(".el-dialog__wrapper, [role=dialog]")) {
        const btn = w.querySelector("button, .el-dialog__headerbtn");
        if (btn) btn.click();
      }
    }).catch(() => {});
    await page.evaluate(() => {
      const c = document.querySelector(".message-container") || document.querySelector("[class*=message-list]");
      if (c) c.scrollTop = c.scrollHeight;
    }).catch(() => {});
    await page.waitForTimeout(600);
    const buf = await page.screenshot({ clip: CLIP, type: "jpeg", quality: 62 });
    const res = await fetch(`${APP_URL}/api/thunder/chatshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify({ convId, imageBase64: buf.toString("base64") }),
    });
    // ต้องเช็ค body ด้วย — API ตอบ 200 พร้อม ok:false ได้ (เช่นหา ChatLog ไม่เจอ)
    const j = await res.json().catch(() => null);
    if (res.ok && j?.ok) { ok++; console.log(stamp(), "แคปแล้ว", convId, `(${Math.round((j.bytes || 0) / 1024)}KB)`); }
    else console.error(stamp(), "ส่งภาพไม่สำเร็จ", convId, res.status, j?.skip || "");
  } catch (e) {
    console.error(stamp(), "แคปไม่ได้", convId, e?.message);
  }
}

console.log(stamp(), `แคปสำเร็จ ${ok}/${ids.length} เคส`);
await browser.close();
