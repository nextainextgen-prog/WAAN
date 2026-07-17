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
const SCOPES = ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/calendar"];

if (!fs.existsSync(CRED)) {
  console.error(`\nไม่พบไฟล์ credentials: ${CRED}`);
  console.error("สร้าง OAuth client (Desktop app) ใน Google Cloud Console แล้วดาวน์โหลดมาไว้ที่ path นี้\n");
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(CRED, "utf8"));
const conf = raw.installed || raw.web;
const oauth2 = new google.auth.OAuth2(conf.client_id, conf.client_secret, `http://localhost:${PORT}`);

const authUrl = oauth2.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });

const page = (title, body, color = "#0A2F5C") =>
  `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,'IBM Plex Sans Thai',sans-serif;background:#F4F8FD;color:#0D1B2A;display:grid;place-items:center;height:100vh;margin:0}
.c{background:#fff;border:1px solid #E3ECF6;border-radius:16px;padding:34px 40px;box-shadow:0 10px 30px rgba(10,47,92,.1);max-width:560px}
h2{color:${color};margin:0 0 10px;font-size:22px}p{color:#5E6E84;line-height:1.6;margin:0;font-size:14px}</style></head>
<body><div class="c"><h2>${title}</h2><p>${body}</p></div></body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  // Google ส่ง error กลับมา (เช่น กดยกเลิก / ไม่มีสิทธิ์) — บอกให้ชัด ไม่ปล่อยหน้าขาว
  if (err) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page("อนุญาตไม่สำเร็จ", `Google แจ้งว่า: <b>${err}</b><br>ลองรัน <code>npm run drive:auth</code> ใหม่อีกครั้งนะครับ`, "#D9544D"));
    console.error(`\n❌ Google ส่ง error กลับมา: ${err}\n`);
    setTimeout(() => process.exit(1), 500);
    return;
  }
  if (!code) {
    // เปิด localhost:4571 ตรงๆ (ยังไม่ผ่านหน้าอนุญาต) — บอกวิธีให้ถูก ไม่ใช่หน้าขาว
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page("ยังไม่ได้เริ่มขั้นตอนอนุญาต", `หน้านี้เป็นปลายทางรับผลจาก Google เท่านั้น<br>กรุณาเปิดลิงก์อนุญาตที่แสดงในเทอร์มินัลก่อนนะครับ`, "#E5B342"));
    return;
  }
  try {
    const { tokens } = await oauth2.getToken(code);
    fs.writeFileSync(TOKEN, JSON.stringify(tokens, null, 2));
    const scopes = (tokens.scope || "").split(" ");
    const hasCal = scopes.some((s) => s.includes("/auth/calendar"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page("เชื่อม Google สำเร็จ! ปิดหน้านี้ได้เลย", `ได้สิทธิ์: Drive${hasCal ? " + Calendar ✅" : " (ยังไม่มีสิทธิ์ Calendar ⚠️)"}`, "#22A06B"));
    console.log(`\n✅ บันทึก token แล้ว: ${TOKEN}`);
    console.log(`สิทธิ์ที่ได้: ${tokens.scope}`);
    console.log(hasCal ? "→ ลง Google Calendar ได้แล้ว\n" : "⚠️ ยังไม่มี scope calendar — ตอนกด Allow ต้องติ๊กสิทธิ์ปฏิทินด้วย\n");
    setTimeout(() => process.exit(0), 500);
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page("แลก token ไม่สำเร็จ", String(e.message || e), "#D9544D"));
    console.error("\n❌ แลก token ไม่สำเร็จ:", e.message || e, "\n");
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log("\nเปิดเบราว์เซอร์เพื่ออนุญาตให้แอปเข้าถึง Google Drive...");
  console.log("ถ้าเบราว์เซอร์ไม่เปิดเอง เปิด URL นี้:\n" + authUrl + "\n");
  exec(`open "${authUrl}"`);
});
