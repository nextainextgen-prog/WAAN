import { askClaude } from "./claude";
import { buildRefundMemoHtml, type RefundMemoData, type MemoAttachment } from "./memo";
import { renderHtmlToPdf } from "./html-pdf";

// ให้ Claude อ่านข้อความแอดมิน (ดิบ) → ดึงข้อมูลลงช่องว่างของเอกสารต้นฉบับ
const EXTRACT_SYSTEM = `คุณคือผู้ช่วยฝ่ายบริการลูกค้าของบริษัท ธันเดอร์ โซลูชั่น จำกัด
อ่านข้อความที่แอดมินส่งมา (อาจไม่เป็นระเบียบ) และ "รูปแนบ" ที่ระบุ path มา แล้วดึงข้อมูลเพื่อ "เติมช่องว่าง" ในเอกสารคืนเงินหัก ณ ที่จ่าย

การอ่านรูปแนบ (สำคัญ): ถ้ามีรายการ path รูปแนบ ให้ใช้เครื่องมือ Read เปิดอ่านรูปทุกไฟล์ตาม path เต็มที่ให้มา แล้วดึง/ยืนยันข้อมูลจากรูปด้วย เช่น
- สลิปโอนเงิน: วันที่/เวลาโอน จำนวนเงินที่โอน ธนาคารปลายทาง
- หน้าสมุดบัญชี (bookbank): ธนาคาร เลขที่บัญชี ชื่อบัญชี
- ใบรับรองหัก ณ ที่จ่าย (50 ทวิ): อัตราร้อยละ และจำนวนเงินที่หัก
ถ้าข้อความกับรูปขัดกัน ให้ยึดตัวเลข/เลขบัญชีจากรูปเอกสารทางการเป็นหลัก

กติกา:
- ห้ามแต่งข้อมูลเอง ใช้เฉพาะที่มีในข้อความหรือในรูป ถ้าไม่มีจริงให้ใส่ค่าว่างหรือ 0
- ถ้ามีบรรทัด [คำสั่งแก้ไขจากผู้ใช้] ให้ยึดตามนั้นทับข้อมูลเดิมทุกครั้ง
- ตอบเป็น JSON เท่านั้น ไม่มีข้อความอื่น ไม่มี \`\`\`

โครงสร้าง JSON:
{
  "subject": "เรื่อง (ถ้ามีทั้งหัก ณ ที่จ่ายและส่วนเกิน ใช้ 'คืนเงินลูกค้าหัก ณ ที่จ่าย และยอดส่วนเกิน' ไม่งั้น 'คืนเงินลูกค้าหัก ณ ที่จ่าย')",
  "topupDate": "วันที่โอน/เติมเครดิต แปลงเป็น พ.ศ. เต็ม เช่น '2 ตุลาคม พ.ศ. 2568' (ถ้าไม่มีใส่ '')",
  "topupTime": "เวลาตัดเครดิต เช่น '13.16' (ถ้าไม่มีใส่ '')",
  "user": "ชื่อผู้ใช้งาน/อีเมล เช่น dev.x@gmail.com",
  "serviceName": "ชื่อบริการ/ชื่อลูกค้า",
  "packageName": "ชื่อแพ็กเกจ",
  "months": <จำนวนเดือน>,
  "amount": <จำนวนเงินที่ลูกค้าโอน/เติมเข้าระบบ ตัวเลข>,
  "whtRate": <อัตราหัก ณ ที่จ่าย ร้อยละ ปกติ 3>,
  "whtAmount": <จำนวนเงินหัก ณ ที่จ่าย ตัวเลข>,
  "overpay": <ยอดส่วนเกิน ตัวเลข 0 ถ้าไม่มี>,
  "bank": "ธนาคาร",
  "accountNo": "เลขบัญชี",
  "accountName": "ชื่อบัญชี"
}`;

interface Extracted {
  subject: string;
  topupDate: string;
  topupTime: string;
  user: string;
  serviceName: string;
  packageName: string;
  months: number;
  amount: number;
  whtRate: number;
  whtAmount: number;
  overpay: number;
  bank: string;
  accountNo: string;
  accountName: string;
}

function parseJson(text: string): Extracted {
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

export interface MemoValidation {
  ok: boolean;
  warnings: string[];
}

export function validateMemo(d: Extracted, refund: number): MemoValidation {
  const w: string[] = [];
  if (!d.serviceName && !d.user) w.push("ไม่พบชื่อลูกค้า/ผู้ใช้งาน");
  if (!refund) w.push("ยอดคืนเป็น 0 — ตรวจสอบยอดหัก ณ ที่จ่าย/ส่วนเกิน");
  if (!d.accountNo) w.push("ไม่พบเลขบัญชีรับเงินคืน");
  if (!d.topupDate) w.push("ไม่พบวันที่โอน/เติมเครดิต");
  return { ok: w.length === 0, warnings: w };
}

let seq = 0;
function genDocNo(): string {
  seq += 1;
  return `TS-CS-RF-${String(Date.now()).slice(-6)}${seq}`;
}

export interface GeneratedMemo {
  data: RefundMemoData;
  validation: MemoValidation;
  pdf: Buffer;
}

export async function generateRefundMemo(input: {
  rawText: string;
  attachments: MemoAttachment[];
  date: string;
  docNo?: string;
  editInstruction?: string; // ข้อความสั่งแก้ไขจากผู้ใช้ (ตอนกดปุ่ม "แก้ไข")
}): Promise<GeneratedMemo> {
  // สร้าง prompt: ข้อความแอดมิน + path รูปแนบ (ให้ Claude อ่านรูปด้วย) + คำสั่งแก้ไข (ถ้ามี)
  let prompt = `ข้อความจากแอดมิน:\n${input.rawText || "(ไม่มีข้อความ ให้ดึงจากรูปแนบ)"}`;
  const imagePaths = input.attachments.map((a) => a.imagePath).filter(Boolean);
  if (imagePaths.length) {
    prompt += `\n\nรูปแนบ (เปิดอ่านด้วยเครื่องมือ Read ทุกไฟล์):\n${imagePaths.map((p, i) => `${i + 1}. ${p}`).join("\n")}`;
  }
  if (input.editInstruction) {
    prompt += `\n\n[คำสั่งแก้ไขจากผู้ใช้]:\n${input.editInstruction}`;
  }
  const raw = await askClaude(prompt, { system: EXTRACT_SYSTEM, timeoutMs: 180_000 });
  const ex = parseJson(raw);
  const refund = Math.round(((ex.whtAmount || 0) + (ex.overpay || 0)) * 100) / 100;
  const validation = validateMemo(ex, refund);

  const data: RefundMemoData = {
    docNo: input.docNo || genDocNo(),
    date: input.date,
    subject: ex.subject || "คืนเงินลูกค้าหัก ณ ที่จ่าย",
    topupDate: ex.topupDate,
    topupTime: ex.topupTime || "-",
    user: ex.user,
    serviceName: ex.serviceName,
    packageName: ex.packageName,
    months: ex.months,
    amount: ex.amount,
    whtRate: ex.whtRate || 3,
    whtAmount: ex.whtAmount,
    overpay: ex.overpay || 0,
    refund,
    bank: ex.bank,
    accountNo: ex.accountNo,
    accountName: ex.accountName,
    attachments: input.attachments,
  };

  const html = buildRefundMemoHtml(data);
  const pdf = await renderHtmlToPdf(html);
  return { data, validation, pdf };
}
