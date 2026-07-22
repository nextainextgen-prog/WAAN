import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildRefundMemoHtml, type RefundMemoData } from "./memo";
import { renderHtmlToPdf } from "./html-pdf";
import { generateRefundMemo, type MemoValidation } from "./memo-generate";
import { lockPdf } from "./pdf-lock";

const DIR = path.join(process.cwd(), ".generated", "memos");

async function ensureDir() {
  await fs.mkdir(DIR, { recursive: true });
}

// เขียนไฟล์ PDF ที่ล็อกรหัสแล้วเสมอ (เปิดต้องใส่รหัส) — choke point เดียวของทุก path
async function writePdf(id: string, pdf: Buffer) {
  await fs.writeFile(path.join(DIR, `${id}.pdf`), await lockPdf(pdf));
}

export interface MemoRecord {
  id: string;
  data: RefundMemoData;
  signed: boolean;
  createdAt: string;
  rawText?: string; // ข้อความต้นฉบับจากแอดมิน — เก็บไว้ให้ปุ่ม "แก้ไข" ออกร่างใหม่ได้
}

// เก็บ draft (data + pdf) — ให้ปุ่ม "เซ็นเลย"/"แก้ไข" อ้างอิงได้
export async function saveMemoDraft(data: RefundMemoData, pdf: Buffer, rawText?: string): Promise<string> {
  await ensureDir();
  const id = randomUUID().replace(/-/g, "").slice(0, 10);
  const rec: MemoRecord = { id, data: { ...data, signed: false }, signed: false, createdAt: new Date().toISOString(), rawText };
  await fs.writeFile(path.join(DIR, `${id}.json`), JSON.stringify(rec, null, 2));
  await writePdf(id, pdf);
  return id;
}

// กด "แก้ไข" แล้วพิมพ์สั่ง → ออกร่างใหม่ (ใช้ id เดิม, เลขเอกสารเดิม, ไฟล์แนบเดิม, ข้อความเดิม + คำสั่งแก้)
export async function reviseMemo(
  id: string,
  instruction: string,
): Promise<{ ok: boolean; data?: RefundMemoData; validation?: MemoValidation }> {
  const rec = await getMemo(id);
  if (!rec) return { ok: false };
  const res = await generateRefundMemo({
    rawText: rec.rawText || "",
    attachments: rec.data.attachments || [],
    date: rec.data.date,
    docNo: rec.data.docNo,
    editInstruction: instruction,
  });
  await ensureDir();
  const next: MemoRecord = { ...rec, data: { ...res.data, signed: false }, signed: false, rawText: rec.rawText };
  await fs.writeFile(path.join(DIR, `${id}.json`), JSON.stringify(next, null, 2));
  await writePdf(id, res.pdf);
  return { ok: true, data: res.data, validation: res.validation };
}

export async function getMemo(id: string): Promise<MemoRecord | null> {
  if (!/^[a-f0-9]{10}$/.test(id)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(DIR, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

export async function readMemoPdf(id: string): Promise<Buffer | null> {
  if (!/^[a-f0-9]{10}$/.test(id)) return null;
  try {
    return await fs.readFile(path.join(DIR, `${id}.pdf`));
  } catch {
    return null;
  }
}

// กด "เซ็นเลย" → เรนเดอร์ใหม่พร้อมลายเซ็น
export async function signMemo(id: string): Promise<{ ok: boolean; data?: RefundMemoData }> {
  const rec = await getMemo(id);
  if (!rec) return { ok: false };
  const data = { ...rec.data, signed: true };
  const pdf = await renderHtmlToPdf(buildRefundMemoHtml(data));
  await ensureDir();
  await writePdf(id, pdf);
  await fs.writeFile(
    path.join(DIR, `${id}.json`),
    JSON.stringify({ ...rec, data, signed: true }, null, 2),
  );
  return { ok: true, data };
}

// ตั้งชื่อไฟล์: ยูสเซอร์ + วันที่ + เวลา (HH.MM.SS)
// เช่น "dev.x@gmail.com 22-07-2569 15.34.20.pdf"
export function memoFilename(data: RefundMemoData, _signed: boolean): string {
  const who = (data.user || data.serviceName || data.accountName || "ลูกค้า")
    .replace(/[^\p{L}\p{N}ก-๙\s._@-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40) || "ลูกค้า";
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const datePart = `${p2(now.getDate())}-${p2(now.getMonth() + 1)}-${now.getFullYear() + 543}`;
  const timePart = `${p2(now.getHours())}.${p2(now.getMinutes())}.${p2(now.getSeconds())}`;
  return `${who} ${datePart} ${timePart}.pdf`;
}
