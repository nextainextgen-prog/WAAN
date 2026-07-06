// เฝ้าดู Google Drive folder → ไฟล์ใหม่เข้าไปป์ไลน์ → อัปไฟล์ที่เซ็นแล้วกลับ Drive
// รัน: node scripts/drive-watch.mjs  (ต้อง drive:auth ก่อน และรัน backend อยู่)
import fs from "node:fs";
import path from "node:path";
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
const INBOX = process.env.DRIVE_INBOX_FOLDER_ID;
const SIGNED = process.env.DRIVE_SIGNED_FOLDER_ID;
const APP_URL = process.env.APP_URL || "http://localhost:3000";
const INTERNAL = process.env.INTERNAL_API_TOKEN;
const POLL = Number(process.env.DRIVE_POLL_SECONDS || 20) * 1000;
const SEEN_FILE = path.join(process.cwd(), ".generated", "drive-seen.json");
const ALLOWED = [".pdf", ".docx", ".txt", ".md"];

for (const [k, v] of Object.entries({ credentials: CRED, token: TOKEN, DRIVE_INBOX_FOLDER_ID: INBOX })) {
  if (k === "credentials" || k === "token" ? !fs.existsSync(v) : !v) {
    console.error(`ยังไม่พร้อม: ${k} = ${v || "(ว่าง)"}`);
    if (k === "token") console.error("รัน: npm run drive:auth ก่อน");
    process.exit(1);
  }
}

const raw = JSON.parse(fs.readFileSync(CRED, "utf8"));
const conf = raw.installed || raw.web;
const auth = new google.auth.OAuth2(conf.client_id, conf.client_secret, "http://localhost:4571");
auth.setCredentials(JSON.parse(fs.readFileSync(TOKEN, "utf8")));
const drive = google.drive({ version: "v3", auth });

fs.mkdirSync(path.dirname(SEEN_FILE), { recursive: true });
const seen = new Set(fs.existsSync(SEEN_FILE) ? JSON.parse(fs.readFileSync(SEEN_FILE, "utf8")) : []);
const saveSeen = () => fs.writeFileSync(SEEN_FILE, JSON.stringify([...seen]));

async function downloadFile(fileId) {
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  return Buffer.from(res.data);
}

async function processInbox() {
  const res = await drive.files.list({
    q: `'${INBOX}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
    fields: "files(id, name, mimeType)",
    pageSize: 50,
  });
  for (const f of res.data.files || []) {
    if (seen.has(f.id)) continue;
    if (!ALLOWED.includes(path.extname(f.name).toLowerCase())) {
      seen.add(f.id);
      continue;
    }
    try {
      const buf = await downloadFile(f.id);
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(buf)]), f.name);
      form.append("source", "Google Drive");
      form.append("driveFileId", f.id);
      const r = await fetch(APP_URL + "/api/documents", {
        method: "POST",
        headers: { "x-internal-token": INTERNAL },
        body: form,
      });
      const d = await r.json().catch(() => ({}));
      console.log(new Date().toISOString(), "เข้าไปป์ไลน์:", f.name, "→", d.ok ? "สำเร็จ (แจ้ง Telegram แล้ว)" : JSON.stringify(d));
      seen.add(f.id);
      saveSeen();
    } catch (e) {
      console.error("download/ingest error:", f.name, e.message);
    }
  }
}

async function uploadSigned() {
  if (!SIGNED) return;
  const res = await fetch(APP_URL + "/api/documents/pending-upload", { headers: { "x-internal-token": INTERNAL } });
  if (!res.ok) return;
  const { documents } = await res.json();
  for (const doc of documents || []) {
    try {
      const fileRes = await fetch(APP_URL + doc.signedUrl, { headers: { "x-internal-token": INTERNAL } });
      if (!fileRes.ok) continue;
      const buf = Buffer.from(await fileRes.arrayBuffer());
      const name = doc.filename.replace(/\.pdf$/i, "") + " (เซ็นแล้ว).pdf";
      const { Readable } = await import("node:stream");
      await drive.files.create({
        requestBody: { name, parents: [SIGNED] },
        media: { mimeType: "application/pdf", body: Readable.from(buf) },
        fields: "id",
      });
      await fetch(APP_URL + `/api/documents/${doc.id}/mark-uploaded`, {
        method: "POST",
        headers: { "x-internal-token": INTERNAL },
      });
      console.log(new Date().toISOString(), "อัปไฟล์เซ็นแล้วขึ้น Drive:", name);
    } catch (e) {
      console.error("upload signed error:", doc.filename, e.message);
    }
  }
}

async function tick() {
  try {
    await processInbox();
    await uploadSigned();
  } catch (e) {
    console.error("tick error:", e.message);
  }
}

console.log("เฝ้าดู Google Drive folder:", INBOX);
console.log("อัปไฟล์เซ็นแล้วไปที่:", SIGNED || "(ไม่ตั้งค่า)");
console.log(`poll ทุก ${POLL / 1000} วินาที\n`);
tick();
setInterval(tick, POLL);
