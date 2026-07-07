// เก็บ session ระบบหลังบ้าน Thunder ครั้งเดียว (พี่โด้ล็อกอินเอง — ผ่าน reCAPTCHA ได้)
// รัน: npm run thunder:auth  แล้วล็อกอินในหน้าต่างที่เปิดขึ้น — สคริปต์จะรู้เองว่าล็อกอินเสร็จ แล้ว save ให้อัตโนมัติ
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

const BASE = (process.env.THUNDER_ADMIN_URL || "https://old.thunder.in.th").replace(/\/$/, "");
const OUT = process.env.THUNDER_SESSION_PATH || path.join(process.cwd(), ".thunder-session.json");

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "th-TH" });
const page = await context.newPage();
await page.goto(`${BASE}/auth/sign-in?next=/admin/affiliate`);

console.log("\n=== เก็บ session ระบบหลังบ้าน Thunder ===");
console.log("ล็อกอินในหน้าต่างเบราว์เซอร์ที่เพิ่งเปิด (ใส่ user/pass + ผ่าน reCAPTCHA)");
console.log("พอเข้าหน้า /admin ได้ สคริปต์จะเซฟ session ให้เองอัตโนมัติ (รอสูงสุด 5 นาที)...\n");

// รอจนกว่าจะออกจากหน้า sign-in (= ล็อกอินสำเร็จ)
let ok = false;
for (let i = 0; i < 150; i++) {
  await page.waitForTimeout(2000);
  let u = "";
  try {
    u = page.url();
  } catch {
    break;
  }
  if (!/\/auth\//i.test(u)) {
    ok = true;
    break;
  }
}

if (ok) {
  // ยืนยันว่าเข้าหน้า affiliate ได้จริง (ไม่เด้งกลับ login)
  await page.goto(`${BASE}/admin/affiliate`, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(1500);
  if (/\/auth\//i.test(page.url())) ok = false;
}

if (ok) {
  await context.storageState({ path: OUT });
  console.log(`\n✅ เก็บ session แล้วที่ ${OUT}`);
  console.log("ตอนนี้น้องวานจะเทียบยอดกับระบบหลังบ้าน + แคปภาพระบบได้แล้ว (เฟส 2)\n");
} else {
  console.log("\n⏱️ หมดเวลา/ยังไม่ได้ล็อกอิน — ลองรัน npm run thunder:auth ใหม่อีกครั้งนะคะ\n");
}
await browser.close();
process.exit(ok ? 0 : 1);
