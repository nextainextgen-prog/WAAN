import { google } from "googleapis";
import { getOAuthClient } from "./google";
import { writeAiNote } from "./obsidian";

export interface LinkContent {
  url: string;
  title: string;
  text: string;
  kind: "gdoc" | "gsheet" | "gdrive" | "web";
}

// ดึง URL ทั้งหมดจากข้อความ
export function extractUrls(text: string): string[] {
  const re = /https?:\/\/[^\s<>"')]+/gi;
  return Array.from(new Set((text || "").match(re) || [])).slice(0, 5);
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

// กันยิงเข้า network ภายใน (SSRF เบื้องต้น)
function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h.endsWith(".local")) return false;
    if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false;
    return true;
  } catch {
    return false;
  }
}

// อ่านเนื้อหาจากลิงก์ (Google Docs/Sheets/Drive ผ่าน token, หรือเว็บทั่วไป)
export async function fetchUrlContent(url: string): Promise<LinkContent> {
  if (!isSafeUrl(url)) throw new Error("ลิงก์ไม่ปลอดภัย/ไม่รองรับ");

  const gdoc = url.match(/docs\.google\.com\/document\/d\/([-\w]+)/);
  if (gdoc) {
    const drive = google.drive({ version: "v3", auth: getOAuthClient() });
    const meta = await drive.files.get({ fileId: gdoc[1], fields: "name", supportsAllDrives: true });
    const res = await drive.files.export({ fileId: gdoc[1], mimeType: "text/plain" }, { responseType: "text" });
    return { url, title: String(meta.data.name || "Google Doc"), text: String(res.data || "").trim(), kind: "gdoc" };
  }

  const gsheet = url.match(/docs\.google\.com\/spreadsheets\/d\/([-\w]+)/);
  if (gsheet) {
    const drive = google.drive({ version: "v3", auth: getOAuthClient() });
    const meta = await drive.files.get({ fileId: gsheet[1], fields: "name,mimeType", supportsAllDrives: true });
    let text = "";
    const mime = String(meta.data.mimeType || "");
    if (mime.includes("google-apps.spreadsheet")) {
      const r = await drive.files.export({ fileId: gsheet[1], mimeType: "text/csv" }, { responseType: "text" });
      text = String(r.data || "").trim();
    } else {
      text = "(สเปรดชีตนี้เป็นไฟล์อัปโหลด — อ่านสรุปตรงๆ ไม่ได้)";
    }
    return { url, title: String(meta.data.name || "Google Sheet"), text, kind: "gsheet" };
  }

  const gfile = url.match(/drive\.google\.com\/file\/d\/([-\w]+)/);
  if (gfile) {
    const drive = google.drive({ version: "v3", auth: getOAuthClient() });
    const meta = await drive.files.get({ fileId: gfile[1], fields: "name,mimeType", supportsAllDrives: true });
    return {
      url,
      title: String(meta.data.name || "Google Drive file"),
      text: `(ไฟล์บน Google Drive: ${meta.data.name} · ชนิด ${meta.data.mimeType})`,
      kind: "gdrive",
    };
  }

  // เว็บทั่วไป
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; NongWaanBot/1.0)" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    const html = await res.text();
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || url;
    return { url, title, text: stripHtml(html).slice(0, 20000), kind: "web" };
  } finally {
    clearTimeout(timer);
  }
}

function slugify(s: string): string {
  return (s || "link")
    .replace(/[^\p{L}\p{N}ก-๙\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60) || "link";
}

// เก็บเนื้อหาลิงก์ลงสมอง (Obsidian AI-Changoh/links/) เพื่อให้สมองวานใช้ต่อ
export async function saveLinkToBrain(c: LinkContent, dateStr: string, note?: string): Promise<boolean> {
  const body = [
    `# ${c.title}`,
    "",
    `- ลิงก์: ${c.url}`,
    `- ชนิด: ${c.kind}`,
    `- บันทึกเมื่อ: ${dateStr}`,
    note ? `- หมายเหตุ: ${note}` : "",
    "",
    "---",
    "",
    c.text.slice(0, 30000),
  ]
    .filter((l) => l !== "")
    .join("\n");
  return writeAiNote(`links/${slugify(c.title)}.md`, body);
}
