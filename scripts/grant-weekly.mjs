// สรุปทุนวิจัยรายสัปดาห์เข้า Telegram
// ตั้ง cron ให้รันเช้าวันจันทร์ เช่น:  0 8 * * 1  cd /path && npm run grants:weekly
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

const res = await fetch(APP_URL + "/api/telegram/grant-weekly", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
});
const data = await res.json().catch(() => ({}));
console.log(new Date().toISOString(), "grant-weekly:", JSON.stringify(data));
