import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

// path ของลายเซ็น (ผู้ใช้วางไฟล์เอง) — PNG โปร่งใส
export function signatureImagePath(): string | null {
  const p = process.env.SIGNATURE_IMAGE_PATH?.trim() || path.join(process.cwd(), "public", "signature.png");
  return existsSync(p) ? p : null;
}

export function hasSignature(): boolean {
  return signatureImagePath() !== null;
}

// วางลายเซ็นภาพลงบน PDF (visual signature — ไม่ใช่ digital certificate)
export async function signPdf(
  inputPath: string,
  outputPath: string,
  opts?: { page?: "last" | "all"; xFrac?: number; yFrac?: number; widthFrac?: number },
): Promise<{ ok: boolean; error?: string }> {
  const sigPath = signatureImagePath();
  if (!sigPath) return { ok: false, error: "ยังไม่มีไฟล์ลายเซ็น (วาง public/signature.png)" };

  const ext = path.extname(inputPath).toLowerCase();
  if (ext !== ".pdf") return { ok: false, error: "เซ็นได้เฉพาะไฟล์ PDF" };

  try {
    const pdfBytes = await fs.readFile(inputPath);
    const pdf = await PDFDocument.load(pdfBytes);
    const sigBytes = await fs.readFile(sigPath);
    const isPng = sigPath.toLowerCase().endsWith(".png");
    const img = isPng ? await pdf.embedPng(sigBytes) : await pdf.embedJpg(sigBytes);

    const xFrac = opts?.xFrac ?? Number(process.env.SIGN_X ?? 0.62);
    const yFrac = opts?.yFrac ?? Number(process.env.SIGN_Y ?? 0.08);
    const widthFrac = opts?.widthFrac ?? Number(process.env.SIGN_WIDTH ?? 0.25);

    const pages = pdf.getPages();
    const targets = opts?.page === "all" ? pages : [pages[pages.length - 1]];
    for (const page of targets) {
      const { width, height } = page.getSize();
      const w = width * widthFrac;
      const h = (img.height / img.width) * w;
      page.drawImage(img, { x: width * xFrac, y: height * yFrac, width: w, height: h });
    }

    const out = await pdf.save();
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, out);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
