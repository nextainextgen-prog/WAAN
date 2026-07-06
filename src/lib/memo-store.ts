import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildRefundMemoHtml, type RefundMemoData } from "./memo";
import { renderHtmlToPdf } from "./html-pdf";

const DIR = path.join(process.cwd(), ".generated", "memos");

async function ensureDir() {
  await fs.mkdir(DIR, { recursive: true });
}

export interface MemoRecord {
  id: string;
  data: RefundMemoData;
  signed: boolean;
  createdAt: string;
}

// เก็บ draft (data + pdf) — ให้ปุ่ม "เซ็นเลย"/"แก้ไข" อ้างอิงได้
export async function saveMemoDraft(data: RefundMemoData, pdf: Buffer): Promise<string> {
  await ensureDir();
  const id = randomUUID().replace(/-/g, "").slice(0, 10);
  const rec: MemoRecord = { id, data: { ...data, signed: false }, signed: false, createdAt: new Date().toISOString() };
  await fs.writeFile(path.join(DIR, `${id}.json`), JSON.stringify(rec, null, 2));
  await fs.writeFile(path.join(DIR, `${id}.pdf`), pdf);
  return id;
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
  await fs.writeFile(path.join(DIR, `${id}.pdf`), pdf);
  await fs.writeFile(
    path.join(DIR, `${id}.json`),
    JSON.stringify({ ...rec, data, signed: true }, null, 2),
  );
  return { ok: true, data };
}

export function memoFilename(data: RefundMemoData, signed: boolean): string {
  const who = (data.serviceName || data.accountName || "ลูกค้า").replace(/[^\p{L}\p{N}ก-๙\s_-]/gu, "").slice(0, 40);
  return `คืนเงินหักณที่จ่าย_${who}${signed ? "_เซ็นแล้ว" : "_ดราฟ"}.pdf`;
}
