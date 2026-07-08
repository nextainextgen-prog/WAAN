import { askClaude } from "./claude";
import { buildRefundMemoHtml, type RefundMemoData, type MemoAttachment } from "./memo";
import { renderHtmlToPdf } from "./html-pdf";

// ดึงข้อมูลจาก "ข้อความแอดมิน" เท่านั้น → เติมช่องว่างเอกสารคืนเงิน (เอกสาร/รูปแนบเป็นแค่ประกอบ ห้ามอ่านมาเป็นข้อมูล)
const EXTRACT_SYSTEM = `คุณคือผู้ช่วยฝ่ายบริการลูกค้าของบริษัท ธันเดอร์ โซลูชั่น จำกัด
ดึงข้อมูลจาก "ข้อความที่แอดมินพิมพ์ส่งมา" เพื่อ "เติมช่องว่าง" ในเอกสารคืนเงินหัก ณ ที่จ่าย

**สำคัญที่สุด — แหล่งข้อมูล:**
- ใช้ข้อมูลจาก "ข้อความแอดมิน" เท่านั้น ในการเติมทุกช่อง
- **ห้ามอ่าน/ดึงข้อมูลจากรูปหรือเอกสารแนบเด็ดขาด** (สลิป/สมุดบัญชี/ใบ 50 ทวิ ฯลฯ เป็นแค่ "เอกสารประกอบ" ที่จะแนบท้าย ไม่ใช่แหล่งข้อมูลกรอกฟอร์ม)
- ถ้าข้อความแอดมินไม่มีข้อมูลบางช่อง ให้ใส่ค่าว่างหรือ 0 (อย่าไปเดาหรือหยิบจากรูป)

รูปแบบข้อความแอดมินมาตรฐาน (ตัวอย่าง):
  ยูส dev.x@gmail.com (API)
  โอนบัญชีธนาคาร กสิกรไทย
  083-5-55843-9
  ชื่อบัญชี บจก. ไฮเฟน พลัส
  ลูกค้าเติมเครดิตเพื่อต่ออายุแพ็กเกจ Ultimate plan จำนวน 1 เดือน
  ราคาที่ต้องชำระ 5,344.82 บาท ลูกค้าชำระไปแล้ว 5,400 บาท
  ลูกค้าต้องการขอคืนเงิน ส่วนต่างหัก ณ ที่จ่าย 154.18 บาท และ ยอดส่วนเกิน 55.18 บาท

กติกาการดึง:
- ห้ามแต่งข้อมูลเอง ใช้เฉพาะที่แอดมินพิมพ์มาจริง
- user: จาก "ยูส/user/ผู้ใช้งาน" · serviceType: ในวงเล็บ เช่น (API) · packageName/months: จาก "แพ็กเกจ ... จำนวน ... เดือน"
- netPrice: จาก "ราคาที่ต้องชำระ ..." · amount: จาก "ชำระไปแล้ว/ชำระเข้ามาแล้ว ..."
- whtAmount: จาก "ส่วนต่างหัก ณ ที่จ่าย ..." · overpay: จาก "ยอดส่วนเกิน ..." · discount: จาก "ส่วนลด ..." (ไม่มีใส่ 0)
- bank/accountNo/accountName: จากบรรทัด "โอนบัญชีธนาคาร... / เลขบัญชี / ชื่อบัญชี" (บัญชีลูกค้าที่แอดมินพิมพ์มา)
- ถ้ามีบรรทัด [คำสั่งแก้ไขจากผู้ใช้] ให้ยึดตามนั้นทับข้อมูลเดิมทุกครั้ง
- ตอบเป็น JSON เท่านั้น ไม่มีข้อความอื่น ห้ามครอบด้วยเครื่องหมาย code block

โครงสร้าง JSON:
{
  "user": "ชื่อผู้ใช้งาน/ยูส/อีเมล เช่น dev.x@gmail.com หรือ tdmkfb307",
  "topupDate": "วันที่เติมเครดิต/รอบต่ออายุ ตามที่แอดมินระบุ เช่น '15/06/2569' (ถ้าไม่มีใส่ '')",
  "serviceType": "ประเภทบริการในวงเล็บ เช่น 'API', 'บอทเช็กสลิป', 'BOT/API' (ดูจากที่แอดมินระบุ เช่น (API))",
  "serviceName": "ชื่อลูกค้า/บริษัท (เอาไว้ตั้งชื่อไฟล์ มักตรงกับชื่อบัญชี)",
  "packageName": "ชื่อแพ็กเกจ เช่น ULTIMATE plan, Verify Slip Silver",
  "months": <จำนวนเดือน ตัวเลข>,
  "netPrice": <ราคาค่าบริการที่ต้องชำระจริง/สุทธิ ตัวเลข (เช่น 'ราคาที่ต้องชำระ 5344.82')>,
  "amount": <จำนวนเงินที่ลูกค้าชำระเข้ามาแล้ว ตัวเลข (เช่น 'ชำระไปแล้ว 5499')>,
  "whtRate": <อัตราหัก ณ ที่จ่าย ร้อยละ ปกติ 3>,
  "whtAmount": <ยอดส่วนต่างหัก ณ ที่จ่ายที่ต้องคืน ตัวเลข>,
  "discount": <ยอดส่วนลดที่ต้องคืน ตัวเลข 0 ถ้าไม่มี>,
  "overpay": <ยอดชำระเกินที่ต้องคืน ตัวเลข 0 ถ้าไม่มี>,
  "bank": "ธนาคาร เช่น กสิกรไทย",
  "accountNo": "เลขบัญชี",
  "accountName": "ชื่อบัญชี"
}
หมายเหตุ: netPrice = ราคาสุทธิที่ต้องชำระ (มักน้อยกว่ายอดที่ชำระเข้ามา) · ถ้าแอดมินไม่ได้ระบุ netPrice ให้ใส่ 0 ระบบจะคำนวณเอง`;

interface Extracted {
  user: string;
  topupDate: string;
  serviceType: string;
  serviceName: string;
  packageName: string;
  months: number;
  netPrice: number;
  amount: number;
  whtRate: number;
  whtAmount: number;
  discount: number;
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
  if (!d.serviceName && !d.user && !d.accountName) w.push("ไม่พบชื่อลูกค้า/ผู้ใช้งาน");
  if (!refund) w.push("ยอดคืนเป็น 0 — ตรวจสอบยอดหัก ณ ที่จ่าย/ส่วนลด");
  if (!d.accountNo) w.push("ไม่พบเลขบัญชีรับเงินคืน");
  if (!d.amount) w.push("ไม่พบยอดที่ลูกค้าชำระเข้ามา");
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
  // ดึงข้อมูลจาก "ข้อความแอดมิน" เท่านั้น (รูปแนบเป็นแค่เอกสารประกอบ ไม่อ่านมาเป็นข้อมูล) + คำสั่งแก้ไข (ถ้ามี)
  let prompt = `ข้อความจากแอดมิน:\n${input.rawText || "(ไม่มีข้อความ)"}`;
  if (input.editInstruction) {
    prompt += `\n\n[คำสั่งแก้ไขจากผู้ใช้]:\n${input.editInstruction}`;
  }
  const raw = await askClaude(prompt, { system: EXTRACT_SYSTEM, timeoutMs: 120_000 });
  const ex = parseJson(raw);
  const round2 = (n: number) => Math.round((n || 0) * 100) / 100;
  const refund = round2((ex.whtAmount || 0) + (ex.discount || 0) + (ex.overpay || 0));
  // netPrice: ถ้าแอดมินไม่ได้ระบุ ให้คำนวณ = ยอดที่ชำระเข้ามา - ยอดที่ต้องคืน
  const netPrice = ex.netPrice ? round2(ex.netPrice) : round2((ex.amount || 0) - refund);
  const validation = validateMemo(ex, refund);

  const data: RefundMemoData = {
    docNo: input.docNo || genDocNo(),
    date: input.date,
    subject: "คืนเงินส่วนต่างหัก ณ ที่จ่าย",
    topupDate: ex.topupDate || "",
    topupTime: "",
    user: ex.user,
    serviceName: ex.serviceName || ex.accountName || "",
    serviceType: ex.serviceType || "BOT/API",
    packageName: ex.packageName,
    months: ex.months,
    netPrice,
    amount: ex.amount,
    whtRate: ex.whtRate || 3,
    whtAmount: ex.whtAmount,
    discount: ex.discount || 0,
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
