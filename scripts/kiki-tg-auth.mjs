// ล็อกอินบัญชี Telegram จริงของเจ้าของ (userbot) — รันครั้งเดียว
// ต้องมี api_id + api_hash จาก https://my.telegram.org (API development tools)
// รัน: npm run kiki:tg-auth
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions.js";

function loadEnv() {
  const p = path.join(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

const SESSION_PATH = process.env.KIKI_TG_SESSION_PATH || path.join(process.cwd(), ".kiki-tg-session");

async function main() {
  let apiId = process.env.KIKI_TG_API_ID;
  let apiHash = process.env.KIKI_TG_API_HASH;
  if (!apiId || !apiHash) {
    console.log("\nยังไม่มี API credentials — เอาจาก https://my.telegram.org (ล็อกอินเบอร์ตัวเอง → API development tools → สร้างแอปชื่ออะไรก็ได้)\n");
    apiId = (await ask("api_id: ")).trim();
    apiHash = (await ask("api_hash: ")).trim();
    fs.appendFileSync(path.join(process.cwd(), ".env"), `\nKIKI_TG_API_ID="${apiId}"\nKIKI_TG_API_HASH="${apiHash}"\n`);
    console.log("บันทึกลง .env แล้ว\n");
  }

  const client = new TelegramClient(new StringSession(""), Number(apiId), apiHash, { connectionRetries: 3 });
  await client.start({
    phoneNumber: async () => (await ask("เบอร์โทร (เช่น +66812345678): ")).trim(),
    password: async () => (await ask("รหัส 2FA (ถ้าไม่มีกด Enter): ")).trim(),
    phoneCode: async () => (await ask("รหัส OTP ที่เด้งในแอป Telegram: ")).trim(),
    onError: (e) => console.error("!", e.message),
  });

  fs.writeFileSync(SESSION_PATH, client.session.save(), "utf8");
  const me = await client.getMe();
  console.log(`\n✅ ล็อกอินสำเร็จ: ${me.firstName || ""} ${me.username ? "@" + me.username : ""}`);
  console.log(`session เก็บที่ ${SESSION_PATH} — Vex ส่งข้อความในนามบัญชีนี้ได้แล้ว\n`);
  await client.disconnect();
  rl.close();
  process.exit(0);
}
main().catch((e) => {
  console.error("\n❌", e.message);
  process.exit(1);
});
