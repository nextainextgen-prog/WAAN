import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { extractText, summarizeDocument } from "./extract";
import { signPdf } from "./sign";
import { getAllowedChatId, getBotToken, tgSendMessage } from "./telegram";
import { writeAiNote, getVaultPath } from "./obsidian";

const DIR = path.join(process.cwd(), ".generated", "documents");

async function ensureDir() {
  await fs.mkdir(DIR, { recursive: true });
}

// รับเอกสารเข้าไปป์ไลน์: คัดลอกไฟล์ → สรุป → แจ้งเตือน Telegram
export async function ingestDocument(
  srcPathOrBuffer: string | Buffer,
  filename: string,
  source?: string,
  driveFileId?: string,
): Promise<{ id: string; summary: string }> {
  await ensureDir();
  const id = randomUUID().slice(0, 10);
  const ext = path.extname(filename) || ".bin";
  const stored = path.join(DIR, `${id}${ext}`);

  if (typeof srcPathOrBuffer === "string") await fs.copyFile(srcPathOrBuffer, stored);
  else await fs.writeFile(stored, srcPathOrBuffer);

  const { text, note } = await extractText(stored);
  let summary: string;
  try {
    summary = await summarizeDocument(text, filename);
  } catch (e) {
    summary = `สรุปไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (note) summary += `\n(${note})`;

  await db.document.create({
    data: {
      id,
      filename,
      source: source || null,
      filePath: stored,
      summary,
      status: "pending",
      driveFileId: driveFileId || null,
    },
  });

  // แจ้งเตือน Telegram พร้อมปุ่มอนุมัติ/ไม่อนุมัติ
  await notifyNewDocument(id, filename, summary).catch(() => {});

  return { id, summary };
}

async function notifyNewDocument(id: string, filename: string, summary: string) {
  if (!getBotToken()) return;
  const chatId = await getAllowedChatId();
  if (!chatId) return;
  const text = `เอกสารใหม่รออนุมัติ\n\nไฟล์: ${filename}\n\nสรุป:\n${summary}`;
  await tgSendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "อนุมัติ", callback_data: `doc:approve:${id}` },
          { text: "ไม่อนุมัติ", callback_data: `doc:reject:${id}` },
        ],
      ],
    },
  });
}

// ตัดสินใจอนุมัติ/ไม่อนุมัติ
export async function decideDocument(
  id: string,
  decision: "approve" | "reject",
): Promise<{ ok: boolean; message: string; signed?: boolean }> {
  const doc = await db.document.findUnique({ where: { id } });
  if (!doc) return { ok: false, message: "ไม่พบเอกสาร" };
  if (doc.status !== "pending") return { ok: false, message: `เอกสารนี้ถูก${doc.status === "approved" ? "อนุมัติ" : "ปฏิเสธ"}ไปแล้ว` };

  if (decision === "reject") {
    await db.document.update({ where: { id }, data: { status: "rejected", decidedAt: new Date() } });
    await logToObsidian(doc.filename, "ไม่อนุมัติ", doc.summary || "");
    return { ok: true, message: `ไม่อนุมัติเอกสาร "${doc.filename}" แล้ว` };
  }

  // approve → เซ็น PDF
  const ext = path.extname(doc.filePath).toLowerCase();
  let signed = false;
  let signedPath: string | null = null;
  let signMsg = "";
  if (ext === ".pdf") {
    const outPath = doc.filePath.replace(/(\.pdf)$/i, ".signed.pdf");
    const res = await signPdf(doc.filePath, outPath);
    if (res.ok) {
      signed = true;
      signedPath = outPath;
    } else {
      signMsg = ` (แต่เซ็นไม่สำเร็จ: ${res.error})`;
    }
  } else {
    signMsg = " (ไฟล์ไม่ใช่ PDF จึงไม่ได้เซ็น)";
  }

  await db.document.update({
    where: { id },
    data: { status: "approved", decidedAt: new Date(), signedPath },
  });
  await logToObsidian(doc.filename, "อนุมัติ" + (signed ? " + เซ็นแล้ว" : ""), doc.summary || "");

  return {
    ok: true,
    signed,
    message: `อนุมัติเอกสาร "${doc.filename}" แล้ว${signed ? " และเซ็นเรียบร้อย" : signMsg}`,
  };
}

async function logToObsidian(filename: string, action: string, summary: string) {
  if (!getVaultPath()) return;
  const date = new Date().toISOString().slice(0, 10);
  const time = new Date().toISOString();
  await writeAiNote(
    `logs/${date}-documents.md`,
    `\n## ${time} — ${action}\nไฟล์: ${filename}\nสรุป: ${summary}\n`,
  ).catch(() => {});
}

export async function listDocuments() {
  return db.document.findMany({ orderBy: { createdAt: "desc" } });
}

// เอกสารที่อนุมัติ+เซ็นแล้ว แต่ยังไม่ได้อัปกลับ Drive
export async function listPendingDriveUpload() {
  return db.document.findMany({
    where: { status: "approved", signedPath: { not: null }, driveUploaded: false },
    orderBy: { decidedAt: "asc" },
  });
}

export async function markDriveUploaded(id: string) {
  await db.document.update({ where: { id }, data: { driveUploaded: true } });
}
