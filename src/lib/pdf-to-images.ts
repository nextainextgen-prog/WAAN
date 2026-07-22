import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";

// แปลง PDF (ไฟล์) → PNG รายหน้า (สำหรับแนบในเอกสาร)
export async function pdfFileToPngs(
  pdfPath: string,
  outDir: string,
  opts: { maxPages?: number; scale?: number } = {},
): Promise<string[]> {
  const data = new Uint8Array(await fs.readFile(pdfPath));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // disableFontFace:true → pdfjs วาด glyph จาก path ของฟอนต์ฝังในไฟล์ (ภาษาไทยไม่กลายเป็นสี่เหลี่ยมบน node canvas)
  const doc = await pdfjs.getDocument({ data, disableFontFace: true }).promise;
  const maxPages = Math.min(doc.numPages, opts.maxPages ?? 5);
  const scale = opts.scale ?? 2;
  const base = path.basename(pdfPath, path.extname(pdfPath));
  await fs.mkdir(outDir, { recursive: true });

  const out: string[] = [];
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // @ts-expect-error napi canvas context is compatible with pdfjs
    await page.render({ canvasContext: ctx, viewport }).promise;
    const outPath = path.join(outDir, `${base}-p${i}.png`);
    await fs.writeFile(outPath, canvas.toBuffer("image/png"));
    out.push(outPath);
  }
  return out;
}

// ดึงข้อความจาก PDF (ทุกหน้า) — ไว้ใช้เป็นแหล่งข้อมูลทำสไลด์จากไฟล์ที่แนบมา
export async function pdfFileToText(pdfPath: string, maxPages = 20): Promise<string> {
  const data = new Uint8Array(await fs.readFile(pdfPath));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data, disableFontFace: true }).promise;
  const pages = Math.min(doc.numPages, maxPages);
  const out: string[] = [];
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const line = tc.items
      .map((it) => (typeof (it as { str?: string }).str === "string" ? (it as { str: string }).str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (line) out.push(`[หน้า ${i}]\n${line}`);
  }
  return out.join("\n\n").trim();
}

// เดาชื่อเอกสารแนบจากชื่อไฟล์
export function guessAttachmentLabel(filename: string): string {
  const f = filename.toLowerCase();
  if (/wti|หัก|50\s*ทวิ|ทวิ|withhold/.test(f)) return "หนังสือรับรองการหักภาษี ณ ที่จ่าย";
  if (/บัญชี|book\s*bank|bookbank|passbook|สมุด/.test(f)) return "ภาพถ่ายหน้าสมุดบัญชีธนาคาร (Bookbank)";
  if (/slip|สลิป|transfer|โอน|kbiz|receipt/.test(f)) return "สลิปโอนเงิน";
  if (/qt|quotation|เสนอราคา|invoice/.test(f)) return "ใบเสนอราคา";
  if (/chat|แชท|conversation|line/.test(f)) return "หลักฐานการสนทนายืนยันการคืนเงิน";
  return "เอกสารแนบ";
}

// เตรียมไฟล์แนบ: ถ้าเป็น PDF แปลงเป็น PNG, ถ้าเป็นรูปใช้เลย
export async function prepareAttachment(
  filePath: string,
  outDir: string,
  labelOverride?: string,
): Promise<{ label: string; imagePath: string }[]> {
  const ext = path.extname(filePath).toLowerCase();
  const label = labelOverride || guessAttachmentLabel(path.basename(filePath));
  if (ext === ".pdf") {
    const pngs = await pdfFileToPngs(filePath, outDir, { maxPages: 3 });
    return pngs.map((p, i) => ({ label: pngs.length > 1 ? `${label} (หน้า ${i + 1})` : label, imagePath: p }));
  }
  return [{ label, imagePath: filePath }];
}
