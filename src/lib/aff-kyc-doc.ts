import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

/**
 * สร้าง "หน้าเอกสารยืนยันตัวตน" ของลูกค้า AFF (ไฟล์ที่แอดมินเคยทำมือผ่าน Google Docs)
 * = โลโก้ Thunder มุมบนซ้าย + ภาพแคปหน้าข้อมูล KYC วางกึ่งกลางหน้า A4
 *
 * วัดตำแหน่งจากไฟล์ตัวอย่างที่เจ้าของทำเอง (ศศิภา (palmnoiinaja).pdf):
 *   โลโก้  x 52.6-117.4 pt · จากขอบบน 45.4-90.7 pt (เนื้อโลโก้ 64.8 x 45.4 pt)
 *   ภาพแคป x 138.0-471.4 pt (กว้าง 333 pt · กึ่งกลางหน้า) · จากขอบบน 134.6 pt
 */

const A4 = { w: 595.28, h: 841.89 };
// กรอบที่ "ตัวโลโก้จริง" ต้องไปวางทับ (วัดจากไฟล์ตัวอย่าง)
const LOGO = { x: 52.6, top: 45.4, w: 64.8 }; // กว้างของ 'เนื้อโลโก้' (มาร์ก + คำว่า THUNDER SOLUTION)
// ไฟล์โลโก้เป็นสี่เหลี่ยมจัตุรัสที่มีขอบว่างรอบ ๆ — ต้องเผื่อขอบ ไม่งั้นโลโก้จะเล็กกว่าต้นฉบับ
// สัดส่วนเนื้อโลโก้ในไฟล์ memo-thunder-logo.png (2640x2640): กว้าง 92.3% สูง 64.9% เริ่มที่ x 3.9% y 16.7%
const LOGO_CONTENT = { wRatio: 0.9231, hRatio: 0.6489, xRatio: 0.0394, yRatio: 0.167 };
const SHOT = { top: 134.6, maxW: 333.4, maxH: 660 };

function assetPath(...p: string[]): string {
  return path.join(process.cwd(), ...p);
}

export interface KycDocInput {
  username: string;
  fullName: string; // ชื่อ-สกุลลูกค้า (ใช้ตั้งชื่อไฟล์ให้เหมือนที่ทำมือ)
  shot: Buffer; // ภาพแคปหน้าข้อมูล KYC (PNG)
  outDir: string;
}

export interface KycDocResult {
  pdfPath: string;
  filename: string;
  pdf: Buffer;
}

export async function buildKycDocPdf(input: KycDocInput): Promise<KycDocResult> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([A4.w, A4.h]);

  // โลโก้ Thunder มุมบนซ้าย (ไม่มีไฟล์ก็ข้าม ไม่ให้ล้ม)
  const logoFile = assetPath("public/brand/memo-thunder-logo.png");
  if (fs.existsSync(logoFile)) {
    const img = await pdf.embedPng(fs.readFileSync(logoFile));
    // ขยายทั้งไฟล์ให้ "เนื้อโลโก้" พอดีกรอบเป้าหมาย แล้วเลื่อนชดเชยขอบว่าง
    const W = LOGO.w / LOGO_CONTENT.wRatio; // ยึดความกว้างเป็นหลัก (สัดส่วนไฟล์ต่างจากต้นฉบับเล็กน้อย)
    const H = W * (img.height / img.width);
    const x = LOGO.x - LOGO_CONTENT.xRatio * W;
    const top = LOGO.top - LOGO_CONTENT.yRatio * H;
    page.drawImage(img, { x, y: A4.h - top - H, width: W, height: H });
  }

  // ภาพแคปหน้าข้อมูล KYC — กึ่งกลางหน้า ขนาดเท่าไฟล์ตัวอย่าง
  const shotImg = await pdf.embedPng(input.shot);
  const sc = Math.min(SHOT.maxW / shotImg.width, SHOT.maxH / shotImg.height);
  const w = shotImg.width * sc, h = shotImg.height * sc;
  page.drawImage(shotImg, { x: (A4.w - w) / 2, y: A4.h - SHOT.top - h, width: w, height: h });

  const bytes = Buffer.from(await pdf.save());
  // ชื่อไฟล์แบบเดียวกับที่แอดมินทำมือ: "<ชื่อ> (<username>).pdf"
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "").trim();
  const filename = `${safe(input.fullName) || input.username} (${input.username}).pdf`.normalize("NFC");
  fs.mkdirSync(input.outDir, { recursive: true });
  const pdfPath = path.join(input.outDir, filename);
  fs.writeFileSync(pdfPath, bytes);
  return { pdfPath, filename, pdf: bytes };
}
