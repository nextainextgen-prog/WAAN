// เก็บ session ระบบหลังบ้าน Thunder
// รัน: npm run thunder:auth
//
// โหมดอัตโนมัติ (ถ้าตั้ง THUNDER_ADMIN_USER / THUNDER_ADMIN_PASS ใน .env):
//   กรอกยูสเซอร์+รหัสให้เอง แล้วกดเข้าสู่ระบบ — หน้านี้ใช้ reCAPTCHA แบบ invisible (ไม่มีรูปให้กด)
//   เบราว์เซอร์เปิดจริง (headless:false) เลยมักผ่านเงียบ ๆ ไม่ต้องมีคนอยู่หน้าคอม
// ถ้ากรอกเองไม่ผ่านใน 60 วิ (reCAPTCHA เด้ง/รหัสผิด) → ถอยไปโหมดเดิม: ปล่อยหน้าต่างค้างไว้ให้พี่โด้ล็อกอินเอง
//   พร้อมแจ้งเข้าห้องคุมระบบว่าต้องมากดเอง จะได้ไม่รอเก้อ
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
// ภาพหลักฐาน = แคปเฉพาะ "หน้าเว็บที่วานทำงานอยู่" ไม่ใช่ทั้งหน้าจอเครื่อง
// (ห้องคุมระบบมีคนอื่นอยู่ด้วย ภาพเต็มจอจะพางานส่วนตัวของพี่โด้หลุดไปโชว์)
const SHOT = path.join(process.cwd(), ".run-logs", "shots", "thunder-auth.png");
const USER = (process.env.THUNDER_ADMIN_USER || "").trim();
const PASS = (process.env.THUNDER_ADMIN_PASS || "").trim();

// แจ้งเข้าห้องคุมระบบ (เงียบถ้ายังไม่ได้ตั้งค่า — ไม่ทำให้สคริปต์พัง)
async function notifyOps(text) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) return;
  let chat = "";
  try {
    const { execSync } = await import("node:child_process");
    for (const dbf of ["prisma/changoh.db", "changoh.db"]) {
      try {
        const v = execSync(`sqlite3 "${path.join(process.cwd(), dbf)}" "SELECT value FROM Setting WHERE key='waan_ops_chat_id' LIMIT 1;"`, { encoding: "utf8" }).trim();
        if (v) { chat = v; break; }
      } catch { /* ลองไฟล์ถัดไป */ }
    }
  } catch { /* ข้าม */ }
  if (!chat) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

const loggedIn = (u) => !/\/auth\//i.test(u);

/**
 * แคปเฉพาะหน้าเว็บที่วานเปิดอยู่ (viewport ของ Playwright) — ไม่แตะหน้าจอเครื่อง
 * สำเร็จ: ตัดเอาแค่แถบบน (ชื่อผู้ใช้ที่ล็อกอินอยู่ + ชื่อหน้า) พอเป็นหลักฐานว่าเข้าได้จริง
 *         ไม่เอาตารางถอนเงินด้านล่างที่มีเลขบัญชี/ชื่อลูกค้า — ห้องคุมระบบมีคนอื่นอยู่ด้วย
 * ไม่สำเร็จ: แคปเต็มหน้า (หน้าล็อกอิน/หน้าค้าง ไม่มีข้อมูลลูกค้าอยู่แล้ว) จะได้เห็นว่าติดตรงไหน
 */
async function saveShot(page, success) {
  try {
    fs.mkdirSync(path.dirname(SHOT), { recursive: true });
    const clip = success ? { x: 0, y: 0, width: 1280, height: 210 } : undefined;
    await page.screenshot({ path: SHOT, ...(clip ? { clip } : {}) });
  } catch { /* แคปไม่ได้ก็ไม่เป็นไร รายงานเป็นข้อความแทน */ }
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "th-TH" });
const page = await context.newPage();
await page.goto(`${BASE}/auth/sign-in?next=/admin/affiliate`);

console.log("\n=== เก็บ session ระบบหลังบ้าน Thunder ===");

// ---- 1) ลองล็อกอินให้เอง ----
let auto = false;
if (USER && PASS) {
  console.log("มี THUNDER_ADMIN_USER/PASS — ลองล็อกอินให้อัตโนมัติก่อน (รอสูงสุด 60 วิ)...");
  try {
    await page.waitForSelector('input[type="password"]', { timeout: 20000 });
    const boxes = page.locator("input");
    await boxes.nth(0).fill(USER);
    await page.locator('input[type="password"]').first().fill(PASS);
    const btn = page.getByRole("button", { name: /เข้าสู่ระบบ|sign\s*in|login/i });
    if (await btn.count()) await btn.first().click();
    else await page.keyboard.press("Enter");
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(2000);
      if (loggedIn(page.url())) { auto = true; break; }
    }
  } catch (e) {
    console.log("ล็อกอินอัตโนมัติไม่สำเร็จ:", e.message.split("\n")[0]);
  }
  console.log(auto ? "✅ ล็อกอินอัตโนมัติผ่าน" : "⚠️ ล็อกอินอัตโนมัติไม่ผ่าน — ต้องให้พี่โด้กดเอง");
} else {
  console.log("ยังไม่ได้ตั้ง THUNDER_ADMIN_USER/THUNDER_ADMIN_PASS ใน .env — ใช้โหมดล็อกอินเอง");
}

// ---- 2) ไม่ผ่าน → รอคนล็อกอินเอง (พฤติกรรมเดิม) ----
let ok = auto;
if (!ok) {
  await notifyOps(
    "🔐 <b>Thunder — ต้องให้พี่กดเองครับ</b>\n" +
    (USER && PASS ? "ผมลองกรอกให้แล้วแต่ไม่ผ่าน (น่าจะ reCAPTCHA เด้ง หรือรหัสไม่ตรง)\n" : "ยังไม่ได้ตั้ง user/pass ไว้ในเครื่อง\n") +
    "หน้าต่างล็อกอินเปิดค้างไว้ให้แล้ว — พี่ล็อกอินตอนไหนก็ได้ใน 5 นาทีนี้ ผมรออยู่ครับ",
  );
  console.log("ล็อกอินในหน้าต่างที่เปิดอยู่ — พอเข้าหน้า /admin ได้ สคริปต์จะเซฟให้เอง (รอสูงสุด 5 นาที)...\n");
  for (let i = 0; i < 150; i++) {
    await page.waitForTimeout(2000);
    let u = "";
    try { u = page.url(); } catch { break; }
    if (loggedIn(u)) { ok = true; break; }
  }
}

// ---- 3) ยืนยันว่าเข้าหน้า affiliate ได้จริง (ไม่เด้งกลับ login) ----
if (ok) {
  await page.goto(`${BASE}/admin/affiliate`, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(1500);
  if (!loggedIn(page.url())) ok = false;
}

// เก็บภาพหลักฐานก่อนปิดเบราว์เซอร์ — สำเร็จ = แถบบนของ /admin/affiliate, ไม่สำเร็จ = หน้าที่ค้างอยู่
await saveShot(page, ok);

if (ok) {
  await context.storageState({ path: OUT });
  console.log(`\n✅ เก็บ session แล้วที่ ${OUT}${auto ? " (ล็อกอินอัตโนมัติ)" : " (ล็อกอินเอง)"}`);
} else {
  console.log("\n⏱️ หมดเวลา/ยังไม่ได้ล็อกอิน — ลองรัน npm run thunder:auth ใหม่อีกครั้งนะคะ\n");
}
await browser.close();
process.exit(ok ? 0 : 1);
