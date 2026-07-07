// เก็บ session ระบบหลังบ้าน Thunder ครั้งเดียว (พี่โด้ล็อกอินเอง — ผ่าน reCAPTCHA ได้)
// รัน: npm run thunder:auth  แล้วล็อกอินในหน้าต่างที่เปิดขึ้น เสร็จแล้วกด Enter ในเทอร์มินัล
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
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

const BASE = (process.env.THUNDER_ADMIN_URL || "https://old.thunder.in.th").replace(/\/$/, "");
const OUT = process.env.THUNDER_SESSION_PATH || path.join(process.cwd(), ".thunder-session.json");

const ask = (q) =>
  new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => {
      rl.close();
      res(a);
    });
  });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "th-TH" });
const page = await context.newPage();
await page.goto(`${BASE}/auth/sign-in?next=/admin/affiliate`);

console.log("\n=== เก็บ session ระบบหลังบ้าน Thunder ===");
console.log("1) ล็อกอินในหน้าต่างเบราว์เซอร์ที่เพิ่งเปิด (ใส่ user/pass + ผ่าน reCAPTCHA)");
console.log("2) พอเข้าหน้า /admin/affiliate ได้แล้ว กลับมากด Enter ที่นี่\n");
await ask("กด Enter เมื่อล็อกอินเสร็จแล้ว... ");

await context.storageState({ path: OUT });
console.log(`\n✅ เก็บ session แล้วที่ ${OUT}`);
console.log("ตอนนี้น้องวานจะเทียบยอดกับระบบหลังบ้าน + แคปภาพระบบได้แล้ว (เฟส 2)\n");
await browser.close();
process.exit(0);
