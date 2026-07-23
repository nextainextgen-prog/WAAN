import fs from "node:fs";
import path from "node:path";
import type { RefundFormInput } from "./refund-slots";

// ความจำระบบ: จำข้อมูลลูกค้าเดิมตาม "ยูสเซอร์" — พิมพ์ยูสเซอร์แล้วดึงกลับมาอัตโนมัติ
// เก็บเฉพาะข้อมูลที่ใช้ซ้ำได้ (ตัวตนลูกค้า + บัญชีรับคืน) · ยอดเงิน/วันที่ไม่เก็บ (เปลี่ยนทุกครั้ง)
const FILE = path.join(process.cwd(), ".generated", "refund-contacts.json");

export interface RefundContact {
  brand: string;
  userId: string;
  companyName: string;
  serviceLabel: string;
  packageName: string;
  bank: string;
  accountNo: string;
  accountName: string;
  updatedAt: string;
}

function norm(u: string): string {
  return String(u || "").trim().toLowerCase();
}

function readAll(): Record<string, RefundContact> {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

export function getRefundContact(user: string): RefundContact | null {
  const key = norm(user);
  if (!key) return null;
  return readAll()[key] || null;
}

// ค้นรายชื่อยูสเซอร์เดิมที่ตรงกับคำค้น (ขึ้นต้นก่อน แล้วค่อยที่มีคำนั้น) — ไว้ทำ autocomplete
export function searchRefundContactKeys(query: string, limit = 8): string[] {
  const q = norm(query);
  if (!q) return [];
  const keys = Object.keys(readAll());
  const starts = keys.filter((k) => k.startsWith(q));
  const contains = keys.filter((k) => !k.startsWith(q) && k.includes(q));
  return [...starts, ...contains].slice(0, limit);
}

export function saveRefundContact(form: RefundFormInput): void {
  const key = norm(form.user);
  if (!key) return;
  const all = readAll();
  all[key] = {
    brand: form.brand,
    userId: form.userId || "",
    companyName: form.companyName || "",
    serviceLabel: form.serviceLabel || "",
    packageName: form.packageName || "",
    bank: form.bank || "",
    accountNo: form.accountNo || "",
    accountName: form.accountName || "",
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
  } catch {
    /* เขียนไม่ได้ก็ปล่อย */
  }
}
