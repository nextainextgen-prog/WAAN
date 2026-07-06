import { askClaude } from "./claude";
import { buildRefundMemoHtml, type RefundMemoData, type MemoAttachment } from "./memo";
import { renderHtmlToPdf } from "./html-pdf";

// ให้ Claude อ่านข้อความแอดมิน (ดิบ) → ดึงข้อมูล + เกลาเป็นเอกสารราชการ
const EXTRACT_SYSTEM = `คุณคือผู้ช่วยฝ่ายบริการลูกค้าของบริษัท ธันเดอร์ โซลูชั่น จำกัด
หน้าที่: อ่านข้อความที่แอดมินส่งมา (อาจไม่เป็นระเบียบ) แล้วดึงข้อมูลออกมาเพื่อออก "เอกสารคืนเงินส่วนต่างหัก ณ ที่จ่าย"
ตอบเป็น JSON เท่านั้น ไม่มีข้อความอื่น ไม่มี \`\`\`

โครงสร้าง JSON:
{
  "customerName": "ชื่อบริษัทลูกค้า (เต็ม)",
  "serviceUser": "ยูส/อีเมล/บริการ เช่น dev.x@gmail.com · API",
  "packageName": "ชื่อแพ็กเกจ เช่น Ultimate Plan",
  "months": <จำนวนเดือน ตัวเลข>,
  "topupDate": "วันที่เติมเครดิต (พ.ศ.) เช่น 25 มิถุนายน 2569",
  "priceNet": <ราคาที่ต้องชำระจริง/สุทธิ ตัวเลขทศนิยม>,
  "paid": <ยอดที่ลูกค้าชำระเข้ามา ตัวเลข>,
  "whtRefund": <ส่วนต่างหัก ณ ที่จ่ายที่ต้องคืน ตัวเลข>,
  "overpay": <ยอดส่วนเกินที่ต้องคืน ตัวเลข>,
  "bank": "ชื่อธนาคาร",
  "accountNo": "เลขบัญชี",
  "accountName": "ชื่อบัญชี"
}

กติกา:
- ใช้ตัวเลขจากข้อความจริงเท่านั้น ห้ามเดา ถ้าไม่มีให้ใส่ 0 หรือ ""
- แปลง ค.ศ. เป็น พ.ศ. (บวก 543) ในฟิลด์วันที่
- ตอบ JSON อย่างเดียว`;

interface Extracted {
  customerName: string;
  serviceUser: string;
  packageName: string;
  months: number;
  topupDate: string;
  priceNet: number;
  paid: number;
  whtRefund: number;
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

// ตรวจความถูกต้องของตัวเลข (กันพิมพ์ผิด)
export function validateMemoMath(d: Extracted): MemoValidation {
  const warnings: string[] = [];
  const round = (n: number) => Math.round(n * 100) / 100;
  const expectedOverpay = round(d.paid - d.priceNet);
  if (d.overpay && Math.abs(expectedOverpay - d.overpay) > 0.02) {
    warnings.push(`ยอดส่วนเกินที่ระบุ (${d.overpay}) ไม่ตรงกับ ชำระเข้ามา−สุทธิ = ${expectedOverpay}`);
  }
  if (d.paid && d.priceNet && d.paid < d.priceNet) {
    warnings.push(`ยอดที่ชำระเข้ามา (${d.paid}) น้อยกว่าค่าบริการสุทธิ (${d.priceNet}) — ตรวจสอบอีกครั้ง`);
  }
  return { ok: warnings.length === 0, warnings };
}

let seq = 0;
function genDocNo(): string {
  seq += 1;
  const y = 2569; // จะแทนที่ด้วยปีจริงจาก caller ได้
  return `TS-CS-RF-${y}-${String(Date.now()).slice(-4)}${seq}`;
}

export interface GeneratedMemo {
  data: RefundMemoData;
  validation: MemoValidation;
  pdf: Buffer;
}

export async function generateRefundMemo(input: {
  rawText: string;
  attachments: MemoAttachment[];
  date: string; // วันที่ออกเอกสาร (พ.ศ.)
  docNo?: string;
}): Promise<GeneratedMemo> {
  const raw = await askClaude(input.rawText, { system: EXTRACT_SYSTEM, timeoutMs: 120_000 });
  const ex = parseJson(raw);
  const validation = validateMemoMath(ex);

  const totalRefund = Math.round((ex.whtRefund + ex.overpay) * 100) / 100;
  const data: RefundMemoData = {
    docNo: input.docNo || genDocNo(),
    date: input.date,
    customerName: ex.customerName,
    serviceUser: ex.serviceUser,
    packageName: ex.packageName,
    months: ex.months,
    topupDate: ex.topupDate,
    priceNet: ex.priceNet,
    paid: ex.paid,
    whtRefund: ex.whtRefund,
    overpay: ex.overpay,
    totalRefund,
    bank: ex.bank,
    accountNo: ex.accountNo,
    accountName: ex.accountName,
    attachments: input.attachments,
  };

  const html = buildRefundMemoHtml(data);
  const pdf = await renderHtmlToPdf(html);
  return { data, validation, pdf };
}
