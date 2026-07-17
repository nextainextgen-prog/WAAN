import fs from "node:fs/promises";
import path from "node:path";
import { pdfFileToText, pdfFileToPngs } from "@/lib/pdf-to-images";
import { extractText } from "@/lib/extract";

// สกัดเนื้อหาจากไฟล์แนบหลายชนิด → { text, images } ป้อนให้ generateDeck/reviseDeck
// รองรับ: PDF (ข้อความ+รูปหน้า), รูป, .md/.txt/.csv/.json/.yaml, .docx/.html
export async function extractFilesToSource(
  files: { path: string; filename: string }[],
  outDir: string,
): Promise<{ text: string; images: string[] }> {
  const textParts: string[] = [];
  const images: string[] = [];
  for (const f of files) {
    const ext = path.extname(f.path).toLowerCase();
    try {
      if (ext === ".pdf") {
        const txt = await pdfFileToText(f.path).catch(() => "");
        if (txt) textParts.push(`===== ${f.filename} =====\n${txt}`);
        const pngs = await pdfFileToPngs(f.path, outDir, { maxPages: 8 }).catch(() => []);
        images.push(...pngs);
      } else if (/\.(png|jpe?g|webp)$/i.test(ext)) {
        images.push(f.path);
      } else if (/\.(md|markdown|txt|csv|tsv|json|log|ya?ml)$/i.test(ext)) {
        const txt = await fs.readFile(f.path, "utf8").catch(() => "");
        if (txt.trim()) textParts.push(`===== ${f.filename} =====\n${txt}`);
      } else if (/\.(docx?|rtf|odt|html?)$/i.test(ext)) {
        const { text } = await extractText(f.path).catch(() => ({ text: "" }));
        if (text.trim()) textParts.push(`===== ${f.filename} =====\n${text}`);
      } else {
        const txt = await fs.readFile(f.path, "utf8").catch(() => "");
        if (txt.trim() && /[\p{L}\p{N}]/u.test(txt)) textParts.push(`===== ${f.filename} =====\n${txt}`);
      }
    } catch {
      /* ข้ามไฟล์ที่อ่านไม่ได้ */
    }
  }
  return { text: textParts.join("\n\n").trim(), images };
}
