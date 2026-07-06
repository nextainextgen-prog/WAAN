// ตั้งค่า OAuth ให้แอปเข้าถึง Google Drive (รันครั้งเดียว)
// ต้องมีไฟล์ credentials.json (OAuth Desktop client จาก Google Cloud) ก่อน
// รัน: node scripts/drive-auth.mjs
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { exec } from "node:child_process";
import { google } from "googleapis";

function loadEnv() {
  const p = path.join(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const CRED = process.env.DRIVE_CREDENTIALS_PATH || path.join(process.cwd(), "credentials.json");
const TOKEN = process.env.DRIVE_TOKEN_PATH || path.join(process.cwd(), ".drive-token.json");
const PORT = 4571;
const SCOPES = ["https://www.googleapis.com/auth/drive"];

if (!fs.existsSync(CRED)) {
  console.error(`\nไม่พบไฟล์ credentials: ${CRED}`);
  console.error("สร้าง OAuth client (Desktop app) ใน Google Cloud Console แล้วดาวน์โหลดมาไว้ที่ path นี้\n");
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(CRED, "utf8"));
const conf = raw.installed || raw.web;
const oauth2 = new google.auth.OAuth2(conf.client_id, conf.client_secret, `http://localhost:${PORT}`);

const authUrl = oauth2.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("no code");
    return;
  }
  try {
    const { tokens } = await oauth2.getToken(code);
    fs.writeFileSync(TOKEN, JSON.stringify(tokens, null, 2));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>เชื่อม Google Drive สำเร็จ! ปิดหน้านี้ได้เลย</h2>");
    console.log(`\nบันทึก token แล้ว: ${TOKEN}`);
    console.log("พร้อมรัน: npm run drive:watch\n");
    setTimeout(() => process.exit(0), 500);
  } catch (e) {
    res.writeHead(500).end("error: " + e.message);
    console.error(e);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log("\nเปิดเบราว์เซอร์เพื่ออนุญาตให้แอปเข้าถึง Google Drive...");
  console.log("ถ้าเบราว์เซอร์ไม่เปิดเอง เปิด URL นี้:\n" + authUrl + "\n");
  exec(`open "${authUrl}"`);
});
