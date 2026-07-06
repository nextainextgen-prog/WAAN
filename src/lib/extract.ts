import fs from "node:fs/promises";
import path from "node:path";
import { askClaude } from "./claude";

// ดึงข้อความจากไฟล์เอกสาร (PDF / DOCX / TXT)
export async function extractText(filePath: string): Promise<{ text: string; note?: string }> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".txt" || ext === ".md") {
    return { text: await fs.readFile(filePath, "utf8") };
  }

  if (ext === ".docx") {
    const mammoth = await import("mammoth");
    const res = await mammoth.extractRawText({ path: filePath });
    return { text: res.value };
  }

  if (ext === ".pdf") {
    try {
      const data = new Uint8Array(await fs.readFile(filePath));
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const doc = await pdfjs.getDocument({ data }).promise;
      let text = "";
      const maxPages = Math.min(doc.numPages, 30);
      for (let i = 1; i <= maxPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        text += content.items
          .map((it) => ("str" in it ? it.str : ""))
          .join(" ") + "\n";
      }
      const trimmed = text.trim();
      if (trimmed.length < 20) {
        return {
          text: trimmed,
          note: "เอกสารนี้อาจเป็นไฟล์สแกน (ไม่มีชั้นข้อความ) — แนะนำให้เปิด OCR เพื่อดึงข้อความ",
        };
      }
      return { text: trimmed };
    } catch (e) {
      return { text: "", note: `อ่าน PDF ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  return { text: "", note: `ยังไม่รองรับไฟล์นามสกุล ${ext}` };
}

// สรุปเอกสารเป็นภาษาไทย 3-5 บรรทัดผ่าน Claude
export async function summarizeDocument(text: string, filename: string): Promise<string> {
  if (!text.trim()) return "ไม่พบข้อความในเอกสาร (อาจเป็นไฟล์สแกน)";
  const clipped = text.slice(0, 12_000);
  const system =
    "คุณคือผู้ช่วยสรุปเอกสารราชการ/วิชาการ สรุปสาระสำคัญเป็นภาษาไทย 3-5 บรรทัด กระชับ ตรงประเด็น เน้นว่าเอกสารเกี่ยวกับอะไร ใคร ต้องทำอะไร มีกำหนดเวลาหรือจำนวนเงินสำคัญไหม ตอบเฉพาะเนื้อหาสรุป ไม่ต้องเกริ่นนำ ไม่ใส่อีโมจิ";
  const prompt = `ไฟล์: ${filename}\n\nเนื้อหา:\n${clipped}`;
  return askClaude(prompt, { system, timeoutMs: 120_000 });
}
