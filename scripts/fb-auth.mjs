// เก็บ session Meta Business Suite (business.facebook.com) ครั้งเดียว — พี่โด้ล็อกอินเอง
// รัน: npm run fb:auth  → ล็อกอินในหน้าต่างที่เปิด (ทั้ง 2 เพจใช้บัญชีเดียวกัน) → กลับมากด ENTER ที่เทอร์มินัล
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

const OUT = process.env.FB_SESSION_PATH || path.join(process.cwd(), ".fb-session.json");
// เพจ Thunder API — ล็อกอินหน้านี้ก่อน (บัญชีเดียวครอบทุกเพจ)
const START = "https://business.facebook.com/latest/inbox/all/?asset_id=591225490748585";

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, locale: "th-TH" });
const page = await context.newPage();
await page.goto(START).catch(() => {});

console.log("\n=== เก็บ session Meta Business Suite ===");
console.log("1) ล็อกอิน Facebook/Business ในหน้าต่างที่เปิด");
console.log("2) พอเห็นกล่องข้อความ (Inbox) โหลดขึ้นมาแล้ว กลับมาที่เทอร์มินัลนี้แล้วกด ENTER");
console.log("   (จะรอสูงสุด 8 นาที)\n");

// รอ ENTER จากผู้ใช้ หรือ auto-detect ว่าล็อกอินสำเร็จ = มีคุกกี้ c_user (id ผู้ใช้ Facebook)
// (เชื่อคุกกี้ ไม่เช็คช่องรหัสผ่าน เพราะ FB ฝัง input password ซ่อนไว้ใน DOM เสมอ)
const waitEnter = new Promise((res) => { process.stdin.resume(); process.stdin.once("data", () => res("enter")); });
const autoDetect = (async () => {
  for (let i = 0; i < 240; i++) {
    await page.waitForTimeout(2000);
    const cookies = await context.cookies().catch(() => []);
    if (cookies.some((c) => c.name === "c_user" && c.value && c.value.length > 3)) { await page.waitForTimeout(1500); return "auto"; }
  }
  return "timeout";
})();

const how = await Promise.race([waitEnter, autoDetect]);

if (how === "timeout") {
  console.log("\n⏱️ หมดเวลา — ลองรัน npm run fb:auth ใหม่นะคะ\n");
  await browser.close();
  process.exit(1);
}

await context.storageState({ path: OUT });
console.log(`\n✅ เก็บ session แล้วที่ ${OUT} (${how === "enter" ? "กด ENTER" : "auto-detect"})`);
console.log("ต่อไปรัน probe DOM แล้วสร้าง fb:watch ได้เลย\n");
await browser.close();
process.exit(0);
