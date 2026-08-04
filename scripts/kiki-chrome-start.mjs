// เปิด Chrome โปรไฟล์ของ Vex พร้อมพอร์ตดีบัก (ล็อกอิน X/FB/IG ในหน้าต่างนี้ครั้งเดียว แล้วเปิดค้างไว้)
// Chrome 136+ ห้ามเปิด remote debugging บนโปรไฟล์ Default → ต้องใช้โปรไฟล์แยกตัวนี้
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.KIKI_CHROME_PORT || 9222);
const PROFILE = process.env.KIKI_CHROME_PROFILE || path.join(os.homedir(), ".vex-chrome");
const BIN = process.env.KIKI_CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const alive = async () => {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
};

if (await alive()) {
  console.log(`Chrome ของ Vex เปิดอยู่แล้ว (พอร์ต ${PORT})`);
  process.exit(0);
}
if (!fs.existsSync(BIN)) { console.error(`หา Chrome ไม่เจอ: ${BIN}`); process.exit(1); }
fs.mkdirSync(PROFILE, { recursive: true });
const child = spawn(BIN, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  "--restore-last-session",
  "--no-first-run",
  "--no-default-browser-check",
], { detached: true, stdio: "ignore" });
child.unref();

for (let i = 0; i < 25; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  if (await alive()) {
    console.log(`เปิด Chrome ของ Vex แล้ว (พอร์ต ${PORT} · โปรไฟล์ ${PROFILE})`);
    console.log("ล็อกอิน X / Facebook / Instagram ในหน้าต่างนี้ครั้งเดียว แล้วเปิดค้างไว้");
    process.exit(0);
  }
}
console.error("เปิด Chrome แล้วแต่ต่อพอร์ตดีบักไม่ได้");
process.exit(1);
