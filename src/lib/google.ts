import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

// สร้าง OAuth2 client จาก credentials.json + .drive-token.json (ชุดเดียวกับ Drive watcher)
export function getOAuthClient() {
  const credPath = process.env.DRIVE_CREDENTIALS_PATH || path.join(process.cwd(), "credentials.json");
  const tokenPath = process.env.DRIVE_TOKEN_PATH || path.join(process.cwd(), ".drive-token.json");
  const raw = JSON.parse(fs.readFileSync(credPath, "utf8"));
  const conf = raw.installed || raw.web;
  const auth = new google.auth.OAuth2(conf.client_id, conf.client_secret, "http://localhost:4571");
  auth.setCredentials(JSON.parse(fs.readFileSync(tokenPath, "utf8")));
  return auth;
}

// โหลดไฟล์ดิบจาก Drive (รองรับไฟล์ Office เช่น .xlsx ที่อัปโหลด — ใช้ alt=media)
export async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const drive = google.drive({ version: "v3", auth: getOAuthClient() });
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(res.data as ArrayBuffer);
}
