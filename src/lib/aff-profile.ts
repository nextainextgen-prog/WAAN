import { writeAiNote, writeAiBinary, readAiText, aiFilePath, listAiSubdirs } from "./obsidian";
import { existsSync } from "node:fs";

/**
 * คลังโปรไฟล์ลูกค้า Affiliate ใน Obsidian (AI-Changoh/aff-customers/<username>/)
 *  - profile.md : ข้อมูลตัวตน (ไว้เติมใบสำคัญรับเงิน)
 *  - attachment.png : หน้าเอกสารแนบ (หน้าระบบยืนยันตัวตน + บัตร ปชช.) ไว้แนบเป็นหน้า 2
 * ค้นด้วย username เป็นหลัก, ไม่เจอค่อย fuzzy ด้วยชื่อ
 */

const BASE = "aff-customers";

export interface AffProfile {
  username: string;
  prefix: string; // นาย / นาง / นางสาว
  name: string; // ชื่อ-สกุล ไม่รวมคำนำหน้า
  taxId: string;
  houseNo: string;
  moo: string;
  road: string;
  tambon: string;
  amphoe: string;
  changwat: string;
  bank?: string;
  account?: string;
  updatedAt?: string;
}

const FIELDS: (keyof AffProfile)[] = [
  "username", "prefix", "name", "taxId", "houseNo", "moo", "road",
  "tambon", "amphoe", "changwat", "bank", "account", "updatedAt",
];

function slug(username: string): string {
  return username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "_");
}

// ===== เขียน =====
export async function saveProfile(p: AffProfile): Promise<boolean> {
  const u = slug(p.username);
  const fm = FIELDS.map((k) => `${k}: ${String(p[k] ?? "").replace(/\n/g, " ")}`).join("\n");
  const md = `---\n${fm}\n---\n\n# ${p.prefix}${p.name} (${p.username})\n\n` +
    `- เลขผู้เสียภาษี: ${p.taxId}\n` +
    `- ที่อยู่: ${p.houseNo} หมู่ ${p.moo} ถนน ${p.road || "-"} ต.${p.tambon} อ.${p.amphoe} จ.${p.changwat}\n` +
    (p.bank ? `- ธนาคาร: ${p.bank} ${p.account || ""}\n` : "") +
    `- เอกสารแนบ: attachment.png\n`;
  return writeAiNote(`${BASE}/${u}/profile.md`, md);
}

export async function saveAttachment(username: string, png: Buffer): Promise<boolean> {
  return writeAiBinary(`${BASE}/${slug(username)}/attachment.png`, png);
}

// path เต็มของหน้าเอกสารแนบ (ไว้ส่งให้ buildReceiptPdf) — null ถ้าไม่มี
export function attachmentPath(username: string): string | null {
  const p = aiFilePath(`${BASE}/${slug(username)}/attachment.png`);
  return p && existsSync(p) ? p : null;
}

// ===== อ่าน =====
function parseFrontmatter(md: string): Record<string, string> {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function toProfile(fm: Record<string, string>): AffProfile {
  return {
    username: fm.username || "",
    prefix: fm.prefix || "",
    name: fm.name || "",
    taxId: fm.taxId || "",
    houseNo: fm.houseNo || "",
    moo: fm.moo || "",
    road: fm.road || "",
    tambon: fm.tambon || "",
    amphoe: fm.amphoe || "",
    changwat: fm.changwat || "",
    bank: fm.bank || undefined,
    account: fm.account || undefined,
    updatedAt: fm.updatedAt || undefined,
  };
}

export async function loadProfile(username: string): Promise<AffProfile | null> {
  const md = await readAiText(`${BASE}/${slug(username)}/profile.md`);
  if (!md) return null;
  return toProfile(parseFrontmatter(md));
}

// normalize ชื่อไทยสำหรับ fuzzy (ตัดคำนำหน้า+ช่องว่าง)
function normName(s: string): string {
  return (s || "").replace(/นางสาว|นาย|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\./g, "").replace(/\s+/g, "");
}

// หาโปรไฟล์: username ตรงก่อน → ไม่เจอ fuzzy ด้วยชื่อจริง (ถ้ามี)
export async function findProfile(username: string, name?: string): Promise<AffProfile | null> {
  const direct = await loadProfile(username);
  if (direct) return direct;
  if (!name) return null;
  const target = normName(name);
  if (!target) return null;
  for (const dir of await listAiSubdirs(BASE)) {
    const p = await loadProfile(dir);
    if (p && normName(p.name) === target) return p;
  }
  return null;
}

export async function listProfiles(): Promise<string[]> {
  return listAiSubdirs(BASE);
}
