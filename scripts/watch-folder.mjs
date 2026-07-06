// เฝ้าดูโฟลเดอร์ → มีไฟล์ใหม่ → ส่งเข้าไปป์ไลน์เอกสารอัตโนมัติ
// ตั้งค่า WATCH_FOLDER ใน .env (เช่น โฟลเดอร์ที่ sync กับ Google Drive)
// รัน: node scripts/watch-folder.mjs
import fs from "node:fs";
import path from "node:path";

function loadEnv() {
  const p = path.join(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const FOLDER = process.env.WATCH_FOLDER;
const APP_URL = process.env.APP_URL || "http://localhost:3000";
const INTERNAL = process.env.INTERNAL_API_TOKEN;
const ALLOWED_EXT = [".pdf", ".docx", ".txt", ".md"];

if (!FOLDER) {
  console.error("ยังไม่ได้ตั้งค่า WATCH_FOLDER ใน .env");
  process.exit(1);
}
if (!fs.existsSync(FOLDER)) {
  console.error("ไม่พบโฟลเดอร์:", FOLDER);
  process.exit(1);
}

const seen = new Set(fs.readdirSync(FOLDER));
console.log(`เฝ้าดูโฟลเดอร์: ${FOLDER}`);
console.log(`ไฟล์เดิม ${seen.size} ไฟล์ (จะไม่ประมวลผลซ้ำ) — รอไฟล์ใหม่...\n`);

async function upload(filename) {
  const full = path.join(FOLDER, filename);
  const buf = fs.readFileSync(full);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)]), filename);
  form.append("source", `โฟลเดอร์: ${path.basename(FOLDER)}`);
  const res = await fetch(APP_URL + "/api/documents", {
    method: "POST",
    headers: { "x-internal-token": INTERNAL },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  console.log(new Date().toISOString(), "ประมวลผล:", filename, "→", data.ok ? "สำเร็จ (แจ้ง Telegram แล้ว)" : JSON.stringify(data));
}

setInterval(() => {
  let current;
  try {
    current = fs.readdirSync(FOLDER);
  } catch {
    return;
  }
  for (const f of current) {
    if (seen.has(f)) continue;
    seen.add(f);
    if (f.startsWith(".")) continue;
    if (!ALLOWED_EXT.includes(path.extname(f).toLowerCase())) continue;
    // รอให้ไฟล์เขียนเสร็จก่อน
    setTimeout(() => upload(f).catch((e) => console.error("upload error:", e.message)), 1500);
  }
}, 4000);
