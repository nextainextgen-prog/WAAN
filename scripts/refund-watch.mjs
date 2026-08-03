// เฝ้าคำขอคืนเครดิต Thunder — ยิง /api/telegram/refund-poll เป็นระยะ
// รัน: npm run refund:watch   (ต้องรัน backend อยู่ + มี .thunder-session.json)
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

const APP_URL = process.env.APP_URL || "http://localhost:3000";
const INTERNAL = process.env.INTERNAL_API_TOKEN;
// 2 นาที = ดีฟอลต์ · ถ้า Thunder rate-limit (คืน "0 รายการ" มั่ว) ขยับเป็น 5 นาทีด้วย env นี้
const POLL = Number(process.env.REFUND_POLL_SECONDS || 120) * 1000;

if (!INTERNAL) {
  console.error("ยังไม่ได้ตั้ง INTERNAL_API_TOKEN ใน .env");
  process.exit(1);
}

const stamp = () => new Date().toLocaleTimeString("th-TH", { hour12: false });

async function tick() {
  try {
    const res = await fetch(APP_URL + "/api/telegram/refund-poll", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
    });
    const j = await res.json();
    if (!j.ok) {
      // no_group = ยังไม่ได้ผูกกลุ่ม (ปกติตอนยังไม่ตั้งค่า) — ไม่ต้องรก log
      if (j.error !== "no_group") console.error(`[${stamp()}] refund poll: ${j.error}`);
      return;
    }
    if (j.notified || j.flagged || j.skipped || j.reminded || j.expired) {
      console.log(
        `[${stamp()}] รออนุมัติ ${j.pending} · แจ้งใหม่ ${j.notified} · ธงแดง ${j.flagged} · ข้าม(nining) ${j.skipped} · เตือนซ้ำ ${j.reminded || 0} · หมดเวลา ${j.expired || 0}`,
      );
    }
  } catch (e) {
    console.error(`[${stamp()}] refund poll error:`, e.message);
  }
}

console.log(`เฝ้าคำขอคืนเครดิต Thunder ทุก ${POLL / 1000} วินาที (${APP_URL})`);
await tick();
setInterval(tick, POLL);
