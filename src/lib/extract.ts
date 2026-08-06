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
        // ไม่มีชั้นข้อความ = ไฟล์สแกน → อ่านด้วยวิชันต่อเลย (เจ้าของสั่ง 6 ส.ค. 2026)
        const ocr = await ocrPdf(filePath);
        if (ocr.text) return ocr;
        return { text: trimmed, note: ocr.note || "เอกสารนี้เป็นไฟล์สแกนและอ่านข้อความไม่ได้" };
      }
      return { text: trimmed };
    } catch (e) {
      return { text: "", note: `อ่าน PDF ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // ===== ตาราง: Excel / CSV (เจ้าของสั่งเพิ่ม 6 ส.ค. 2026) =====
  if (ext === ".csv" || ext === ".tsv") {
    const raw = await fs.readFile(filePath, "utf8");
    return { text: raw.slice(0, 200_000) };
  }

  if (ext === ".xlsx" || ext === ".xls" || ext === ".xlsm") {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await fs.readFile(filePath), { type: "buffer" });
      const parts: string[] = [];
      for (const name of wb.SheetNames.slice(0, 12)) {
        const sheet = wb.Sheets[name];
        if (!sheet) continue;
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        if (csv.trim()) parts.push(`### ชีต: ${name}\n${csv.trim().slice(0, 40_000)}`);
      }
      const text = parts.join("\n\n").trim();
      return text ? { text } : { text: "", note: "เปิดไฟล์ Excel ได้แต่ไม่มีข้อมูลในชีตเลย" };
    } catch (e) {
      return { text: "", note: `อ่าน Excel ไม่สำเร็จ: ${e instanceof Error ? e.message.slice(0, 120) : "error"}` };
    }
  }

  // PowerPoint = zip ที่มี XML ของแต่ละสไลด์ — ใช้ unzip ของเครื่อง ไม่ต้องลงไลบรารีเพิ่ม
  if (ext === ".pptx") {
    try {
      const { execFile } = await import("node:child_process");
      const list = await new Promise<string>((resolve) =>
        execFile("unzip", ["-Z1", filePath], { maxBuffer: 4_000_000 }, (e, out) => resolve(e ? "" : out.toString())),
      );
      const slides = list
        .split("\n")
        .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.trim()))
        .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0))
        .slice(0, 60);
      const parts: string[] = [];
      for (const f of slides) {
        const xml = await new Promise<string>((resolve) =>
          execFile("unzip", ["-p", filePath, f.trim()], { maxBuffer: 8_000_000 }, (e, out) => resolve(e ? "" : out.toString())),
        );
        const txt = xml
          .replace(/<a:br\/>/g, "\n")
          .replace(/<\/a:p>/g, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/[ \t]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        if (txt) parts.push(`### สไลด์ ${f.match(/\d+/)?.[0] || "?"}\n${txt}`);
      }
      const text = parts.join("\n\n").trim();
      return text ? { text } : { text: "", note: "เปิดไฟล์ PowerPoint ได้แต่ไม่มีข้อความในสไลด์ (อาจเป็นภาพล้วน)" };
    } catch (e) {
      return { text: "", note: `อ่าน PowerPoint ไม่สำเร็จ: ${e instanceof Error ? e.message.slice(0, 120) : "error"}` };
    }
  }

  return { text: "", note: `ยังไม่รองรับไฟล์นามสกุล ${ext}` };
}

/**
 * อ่านข้อความจาก PDF สแกน (ไม่มีชั้นข้อความ) ด้วยวิชัน — ส่งไฟล์ทั้งก้อนให้โมเดลอ่าน
 * ไม่ต้องลงโปรแกรม OCR เพิ่มในเครื่อง และรองรับลายมือ/ตารางได้ดีกว่า OCR แบบเดิม
 */
export async function ocrPdf(filePath: string): Promise<{ text: string; note?: string }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return { text: "", note: "ยังไม่ได้ตั้งค่า GEMINI_API_KEY สำหรับอ่านไฟล์สแกน" };
  try {
    const buf = await fs.readFile(filePath);
    if (buf.length > 18 * 1024 * 1024) return { text: "", note: "ไฟล์สแกนใหญ่เกินไป (เกิน 18 MB) แยกไฟล์ก่อนแล้วส่งใหม่" };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: "application/pdf", data: buf.toString("base64") } },
            { text: "ถอดข้อความทั้งหมดในไฟล์นี้ออกมาตามที่เห็น เรียงตามหน้า คงตัวเลข/ชื่อ/วันที่ให้ตรงเป๊ะ ถ้าเป็นตารางให้จัดเป็นบรรทัดอ่านง่าย ตอบเฉพาะข้อความที่ถอดได้" },
          ],
        }],
        generationConfig: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
    if (j.error?.message) return { text: "", note: `อ่านไฟล์สแกนไม่สำเร็จ: ${j.error.message.slice(0, 120)}` };
    const text = (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || "").join("").trim();
    return text ? { text, note: "อ่านจากไฟล์สแกนด้วยวิชัน" } : { text: "", note: "อ่านไฟล์สแกนแล้วไม่เจอข้อความ" };
  } catch (e) {
    return { text: "", note: `อ่านไฟล์สแกนไม่สำเร็จ: ${e instanceof Error ? e.message.slice(0, 120) : "error"}` };
  }
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
