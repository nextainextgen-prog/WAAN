// สร้าง Telegram Forum Topics 7 ห้อง (idempotent) + เซฟ thread ID ลง scripts/topics.json
// รัน: node scripts/setup-topics.mjs   (บอทต้องเป็นแอดมิน + สิทธิ์ Manage Topics)
import fs from "node:fs";
import path from "node:path";

function loadEnv() {
  const p = path.join(process.cwd(), ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.OHO_ALERT_CHAT_ID || "-1003906693402";
const OUT = path.join(process.cwd(), "scripts", "topics.json");

// key → { name, iconColor } — key ใช้อ้างใน routes.mjs
const TOPICS = [
  { key: "thunderBot", name: "แชทค้าง Thunder Bot", color: 0x6fb9f0 },
  { key: "thunderApi", name: "แชทค้าง Thunder API", color: 0x6fb9f0 },
  { key: "easyslip", name: "แชทค้าง EasySlip Bot/Api", color: 0xcb86db },
  { key: "easycrm", name: "แชทค้าง EasyCRM", color: 0x8eee98 },
  { key: "boostsms", name: "แชทค้าง BoostSMS", color: 0xffd67e },
  { key: "closeThunder", name: "อย่าลืมปิดแชท Thunder", color: 0xfb6f5f },
  { key: "closeEasyslip", name: "อย่าลืมปิดแชท EasySlip", color: 0xff93b2 },
];

async function tg(method, body) {
  return fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((x) => x.json());
}

async function main() {
  const saved = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
  for (const t of TOPICS) {
    if (saved[t.key]) { console.log(`มีอยู่แล้ว: ${t.name} → ${saved[t.key]}`); continue; }
    const r = await tg("createForumTopic", { chat_id: CHAT, name: t.name, icon_color: t.color });
    if (!r.ok) { console.error(`สร้างไม่สำเร็จ: ${t.name} —`, JSON.stringify(r)); continue; }
    saved[t.key] = r.result.message_thread_id;
    console.log(`สร้างแล้ว: ${t.name} → ${saved[t.key]}`);
    fs.writeFileSync(OUT, JSON.stringify(saved, null, 2));
  }
  console.log("\nเสร็จ · topics.json =", OUT);
  console.log(JSON.stringify(saved, null, 2));
}
main();
