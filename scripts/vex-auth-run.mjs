/**
 * ตัวขับคำสั่งล็อกอินแบบ "โต้ตอบได้" ของ Vex (5 ส.ค. 2026)
 *
 * ทำไมต้องมีตัวนี้แยก แทนที่จะ spawn จากในเว็บตรง ๆ:
 *   `runNpmScript()` ของน้องวานรันแล้วรอผลอย่างเดียว ป้อน stdin ไม่ได้
 *   ใช้กับ thunder:auth ได้เพราะมันเด้งหน้าต่างเบราว์เซอร์ แต่ kiki:tg-auth
 *   ต้องพิมพ์เบอร์ + OTP ลงเทอร์มินัล — ต้องมีคนถือ stdin ไว้จนจบ
 *   ถ้าถือไว้ในโปรเซสเว็บ พอเว็บรีสตาร์ท (ซึ่งเกิดบ่อย) การล็อกอินจะตายกลางคัน
 *   → แยกเป็นโปรเซสของตัวเอง คุยกันผ่านไฟล์ เว็บรีสตาร์ทกี่รอบก็ไม่กระทบ
 *
 * ท่านี้พิสูจน์แล้วด้วยมือเมื่อ 5 ส.ค. — ล็อกอิน Telegram userbot สำเร็จโดยเจ้าของ
 * แค่บอก OTP ในแชท ไม่ต้องเปิดเทอร์มินัลเอง
 *
 * รัน: node scripts/vex-auth-run.mjs <runId> <npm-script>
 * ไฟล์ที่ใช้คุยกัน (โฟลเดอร์ .vex-auth/):
 *   <id>.log     ผลลัพธ์ที่โปรเซสพ่นออกมา (เว็บอ่านไปแสดง/แคปเป็นภาพ)
 *   <id>.in      คำตอบจากเจ้าของ บรรทัดละคำตอบ (เว็บเขียน ตัวนี้อ่านแล้วป้อนเข้า stdin)
 *   <id>.status  running | done | failed | timeout
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [, , runId, script] = process.argv;
if (!runId || !script) {
  console.error("ใช้: node scripts/vex-auth-run.mjs <runId> <npm-script>");
  process.exit(2);
}

// ชื่อ script ต้องอยู่ใน package.json + ไม่มีอักขระ shell (กันคำสั่งแปลกปลอมหลุดเข้ามา)
const ROOT = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
if (!/^[a-zA-Z0-9:_-]+$/.test(script) || !Object.keys(pkg.scripts || {}).includes(script)) {
  console.error(`script "${script}" ไม่อยู่ในรายการที่อนุญาต`);
  process.exit(2);
}

const DIR = path.join(ROOT, ".vex-auth");
fs.mkdirSync(DIR, { recursive: true });
const F = (ext) => path.join(DIR, `${runId}.${ext}`);

fs.writeFileSync(F("log"), "");
fs.writeFileSync(F("in"), "");
fs.writeFileSync(F("status"), "running");

const TIMEOUT_MS = 15 * 60_000; // ล็อกอินไม่น่าใช้เกินนี้ — ค้างนานกว่านี้คือมีอะไรผิด
const npmPath = process.env.NPM_PATH?.trim() || "/Users/mx/.local/bin/npm";

const child = spawn(npmPath, ["run", script], {
  cwd: ROOT,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
});

const log = (s) => { try { fs.appendFileSync(F("log"), s); } catch { /* ดิสก์เต็ม */ } };
child.stdout.on("data", (d) => log(d.toString()));
child.stderr.on("data", (d) => log(d.toString()));

// เฝ้าไฟล์คำตอบ — เจอบรรทัดใหม่เมื่อไหร่ ป้อนเข้า stdin ทันที
// บันทึกลง log เป็นดอกจัน ไม่เก็บ OTP/รหัสเป็นตัวอักษรจริงลงดิสก์
let fed = 0;
const pump = setInterval(() => {
  let lines = [];
  try {
    lines = fs.readFileSync(F("in"), "utf8").split("\n").filter((l) => l.length > 0);
  } catch { return; }
  while (fed < lines.length) {
    try { child.stdin.write(`${lines[fed]}\n`); } catch { /* stdin ปิดไปแล้ว */ }
    log(`\n[ป้อนคำตอบเข้าไปแล้ว: ${"*".repeat(Math.min(12, lines[fed].length))}]\n`);
    fed++;
  }
}, 400);

const timer = setTimeout(() => {
  log("\n[หมดเวลา 15 นาที — ปิดโปรเซส]\n");
  try { child.kill("SIGTERM"); } catch { /* จบไปแล้ว */ }
  try { fs.writeFileSync(F("status"), "timeout"); } catch { /* ignore */ }
}, TIMEOUT_MS);

child.on("error", (e) => {
  log(`\n[รันไม่ขึ้น: ${e.message}]\n`);
  try { fs.writeFileSync(F("status"), "failed"); } catch { /* ignore */ }
});

child.on("close", (code) => {
  clearInterval(pump);
  clearTimeout(timer);
  log(`\n[จบแล้ว code=${code}]\n`);
  // timeout ตั้งสถานะไว้ก่อนแล้ว อย่าเขียนทับ
  try {
    if (fs.readFileSync(F("status"), "utf8").trim() === "running") {
      fs.writeFileSync(F("status"), code === 0 ? "done" : "failed");
    }
  } catch { /* ignore */ }
  process.exit(0);
});
