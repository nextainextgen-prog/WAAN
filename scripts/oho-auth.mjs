// เก็บ session OHO Chat ครั้งเดียว (พี่โด้ล็อกอินเอง) — เหมือน thunder:auth
// รัน: npm run oho:auth  แล้วล็อกอินในหน้าต่างที่เปิดขึ้น สคริปต์จะเซฟ session ให้เองเมื่อเข้าหน้าแชทได้
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

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
const OUT = process.env.OHO_SESSION_PATH || path.join(process.cwd(), ".oho-session.json");

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, locale: "th-TH" });
const page = await context.newPage();
await page.goto(URL);

console.log("\n=== เก็บ session OHO Chat ===");
console.log("ล็อกอินในหน้าต่างที่เปิด — พอผ่านหน้า login เข้าแอปได้ สคริปต์จะพาไปหน้าแชทแล้วเซฟให้เอง (รอสูงสุด 8 นาที)...\n");

let ok = false;
for (let i = 0; i < 240; i++) {
  await page.waitForTimeout(2000);
  let url = "";
  try { url = page.url(); } catch { url = ""; }
  const onLogin = /\/(sign-?in|login|auth|register)/i.test(url);
  const rooms = await page.locator(".smartchat-room, .contact-wrapper").count().catch(() => 0);
  if (rooms > 0) { ok = true; break; }
  // ผ่าน login แล้ว (อยู่ในแอป business) แต่ยังไม่ใช่หน้าแชท → พาไปหน้าแชท
  if (!onLogin && /\/business\//i.test(url) && !/smartchat/i.test(url)) {
    await page.goto(URL, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(3000);
  }
}

if (ok) {
  await context.storageState({ path: OUT });
  console.log(`\n✅ เก็บ session แล้วที่ ${OUT}`);
  console.log("รัน npm run oho:watch เพื่อเริ่มเฝ้าแชท\n");
} else {
  console.log("\n⏱️ หมดเวลา/ยังไม่ได้เข้าหน้าแชท — ลองรัน npm run oho:auth ใหม่นะคะ\n");
}
await browser.close();
process.exit(ok ? 0 : 1);
