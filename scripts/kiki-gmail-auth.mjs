// เชื่อม Gmail "ส่วนตัว" ของเจ้าของ (sodod666@gmail.com) ให้ Vex อ่านเมลแจ้งเตือนธนาคาร
// คนละบัญชี/คนละ token กับ Google ของระบบงาน — token เก็บแยกที่ .kiki-gmail-token.json
// รัน: npm run kiki:gmail-auth  แล้วล็อกอินด้วย Gmail ส่วนตัวในเบราว์เซอร์
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
const TOKEN = process.env.KIKI_GMAIL_TOKEN_PATH || path.join(process.cwd(), ".kiki-gmail-token.json");
const PORT = 4573;
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

if (!fs.existsSync(CRED)) {
  console.error(`\nไม่พบไฟล์ credentials: ${CRED}`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(CRED, "utf8"));
const conf = raw.installed || raw.web;
const oauth2 = new google.auth.OAuth2(conf.client_id, conf.client_secret, `http://localhost:${PORT}`);
const authUrl = oauth2.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });

const page = (title, body, color = "#0A2F5C") =>
  `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,'IBM Plex Sans Thai',sans-serif;background:#161b22;color:#e6edf3;display:grid;place-items:center;height:100vh;margin:0}
.c{background:#21262d;border:1px solid #2d333b;border-radius:16px;padding:34px 40px;max-width:560px}
h2{color:${color};margin:0 0 10px;font-size:22px}p{color:#8b949e;line-height:1.6;margin:0;font-size:14px}</style></head>
<body><div class="c"><h2>${title}</h2><p>${body}</p></div></body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page("อนุญาตไม่สำเร็จ", `Google แจ้งว่า: <b>${err}</b><br>รัน npm run kiki:gmail-auth ใหม่อีกครั้ง`, "#ff7b72"));
    setTimeout(() => process.exit(1), 500);
    return;
  }
  if (!code) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page("ยังไม่ได้เริ่ม", "เปิดลิงก์อนุญาตจากเทอร์มินัลก่อนครับ", "#f0b429"));
    return;
  }
  try {
    const { tokens } = await oauth2.getToken(code);
    fs.writeFileSync(TOKEN, JSON.stringify(tokens, null, 2));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page("เชื่อม Gmail สำเร็จ — Vex อ่านเมลธนาคารได้แล้ว", "ปิดหน้านี้ได้เลย ตั้งแต่ตอนนี้เงินเข้า-ออกใน K PLUS จะถูกจดอัตโนมัติ", "#3fb950"));
    console.log(`\n✅ บันทึก token แล้ว: ${TOKEN}`);
    console.log("Vex จะเริ่มเฝ้าเมลธนาคารภายใน 2 นาที (เฉพาะเมลใหม่หลังจากนี้)\n");
    setTimeout(() => process.exit(0), 500);
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page("แลก token ไม่สำเร็จ", String(e.message || e), "#ff7b72"));
    console.error("\n❌", e.message || e, "\n");
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log("\n⚠️ สำคัญ: ตอนหน้า Google เด้งขึ้นมา ให้เลือกล็อกอินด้วย Gmail ส่วนตัว (sodod666@gmail.com)");
  console.log("ไม่ใช่บัญชีงานที่เชื่อม Drive/Calendar อยู่\n");
  console.log("ถ้าเบราว์เซอร์ไม่เปิดเอง เปิด URL นี้:\n" + authUrl + "\n");
  exec(`open "${authUrl}"`);
});
