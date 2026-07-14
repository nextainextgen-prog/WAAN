// เก็บ session LINE Official Account Manager (chat.line.biz) ครั้งเดียว — พี่โด้ล็อกอินเอง
// รัน: npm run line:auth → ล็อกอิน LINE ในหน้าต่างที่เปิด (ครอบทั้ง EasyCRM + BoostSMS) → เซฟเองเมื่อเข้าหน้าแชท
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

function loadEnv() {
  const p = path.join(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
}
loadEnv();

const OUT = process.env.LINE_SESSION_PATH || path.join(process.cwd(), ".line-session.json");
const START = "https://chat.line.biz/Ucc1f1adc19e09ad4cb7c854380ac27d8/"; // EasyCRM OA

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, locale: "th-TH" });
const page = await context.newPage();
await page.goto(START).catch(() => {});

console.log("\n=== เก็บ session LINE OA Manager ===");
console.log("1) ล็อกอิน LINE ในหน้าต่างที่เปิด (บัญชีเดียวครอบทั้ง EasyCRM + BoostSMS)");
console.log("2) พอเข้าหน้าแชท OA ได้ สคริปต์จะเซฟให้อัตโนมัติ (หรือกด ENTER ที่เทอร์มินัลก็ได้) — รอสูงสุด 8 นาที\n");

const waitEnter = new Promise((res) => { process.stdin.resume(); process.stdin.once("data", () => res("enter")); });
const autoDetect = (async () => {
  for (let i = 0; i < 240; i++) {
    await page.waitForTimeout(2000);
    let url = ""; try { url = page.url(); } catch {}
    // กลับมาที่ chat.line.biz/<OAID> (ไม่ใช่หน้า login access.line/account.line) = ล็อกอินสำเร็จ
    if (/chat\.line\.biz\/U[0-9a-fA-F]+/i.test(url) && !/access\.line|account\.line|\/login/i.test(url)) { await page.waitForTimeout(1500); return "auto"; }
  }
  return "timeout";
})();

const how = await Promise.race([waitEnter, autoDetect]);
if (how === "timeout") { console.log("\n⏱️ หมดเวลา — ลองรัน npm run line:auth ใหม่นะคะ\n"); await browser.close(); process.exit(1); }
await context.storageState({ path: OUT });
console.log(`\n✅ เก็บ session แล้วที่ ${OUT} (${how === "enter" ? "กด ENTER" : "auto-detect"})\n`);
await browser.close();
process.exit(0);
