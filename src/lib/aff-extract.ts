import { askClaude } from "./claude";
import { extractText } from "./extract";

export interface AffDocFields {
  username: string; // ยูสเซอร์ (มาจากข้อความแอดมิน — เอกสารไม่มี)
  name: string; // ชื่อ-สกุล (ไม่มีคำนำหน้า) เช่น "สุวรรณ อุ่นเรือน"
  taxId: string; // เลขประจำตัวผู้เสียภาษี / เลขบัตรประชาชน
  address: string; // ที่อยู่รวม
  bank: string; // ธนาคาร
  account: string; // เลขบัญชี
  date: string; // วันที่ในเอกสาร รูปแบบ "d/m/yyyy" (พ.ศ. ตามที่เขียน)
  gross: number | null; // รวมจำนวนเงิน (ก่อนหัก)
  wht: number | null; // หัก ณ ที่จ่าย
  net: number | null; // จำนวนเงินทั้งสิ้น (สุทธิ)
  email?: string; // ที่อยู่จัดส่งเอกสาร (อีเมล)
  pdfText: string; // ข้อความดิบจาก PDF (ไว้ debug)
}

function parseJsonLoose(s: string): Record<string, unknown> {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("ไม่พบ JSON ในคำตอบ");
  return JSON.parse(body.slice(start, end + 1));
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// parse ข้อความสรุปของแอดมิน (ฟอร์แมตเป็นข้อ ๆ) แบบ deterministic — เชื่อถือได้กว่า LLM
function parseAdminMsg(t: string): Partial<Record<string, string>> {
  if (!t) return {};
  const g = (re: RegExp) => t.match(re)?.[1]?.trim();
  const name = g(/ชื่อ\s*:\s*([^\n]+)/);
  return {
    username: g(/(?:ยูสเซอร์|ยูเซอร์|username)\s*:?\s*([^\s\n]+)/i),
    name: name && !/บัญชี/.test(name) ? name : undefined,
    address: g(/(?:^|\n)\s*\d*\.?\s*ที่อยู่\s*:\s*([^\n]+)/),
    taxId: g(/เลข(?:ประจำตัว)?ผู้เสียภาษี\s*:?\s*([0-9]{10,13})/),
    date: g(/วันที่ทำการถอน\s*:?\s*([0-9/.-]+)/),
    email: g(/จัดส่งเอกสาร\s*:?\s*([^\s\n]+@[^\s\n]+)/),
  };
}

// สกัดฟิลด์จากเอกสารใบสำคัญรับเงิน (PDF) + ข้อความสรุปของแอดมิน → โครงสร้าง
export async function extractAffDoc(pdfPath: string, adminText = ""): Promise<AffDocFields> {
  const { text: pdfText } = await extractText(pdfPath);

  const prompt = `ต่อไปนี้คือข้อมูลจาก "ใบสำคัญรับเงิน" (Affiliate) ของบริษัท ธันเดอร์ โซลูชั่น
โปรดสกัดข้อมูลออกมาเป็น JSON เท่านั้น (ห้ามมีข้อความอื่น)

=== ข้อความในเอกสาร PDF ===
${pdfText}

=== ข้อความสรุปจากแอดมิน (ถ้ามี) ===
${adminText || "(ไม่มี)"}

สกัดเป็น JSON ตามคีย์นี้ (ถ้าไม่พบให้ใส่ค่าว่าง "" หรือ null):
{
  "username": "ยูสเซอร์ (เอามาจากข้อความแอดมิน คำว่า 'ยูสเซอร์' — เอกสารไม่มี)",
  "name": "ชื่อ-นามสกุลผู้รับเงิน ไม่ต้องมีคำนำหน้า เช่น นาย/นาง",
  "taxId": "เลขประจำตัวผู้เสียภาษี (ตัวเลขล้วน)",
  "address": "ที่อยู่รวม บ้านเลขที่ หมู่ ตำบล อำเภอ จังหวัด",
  "bank": "ธนาคารที่โอนเข้า",
  "account": "เลขบัญชี (ตัวเลขล้วน)",
  "date": "วันที่ในเอกสาร รูปแบบ d/m/yyyy โดย yyyy เป็น พ.ศ. ตามที่เขียน",
  "gross": ยอด "รวมจำนวนเงิน" เป็นตัวเลข,
  "wht": ยอด "หักภาษี ณ ที่จ่าย" เป็นตัวเลข,
  "net": ยอด "จำนวนเงินทั้งสิ้น" เป็นตัวเลข,
  "email": "ที่อยู่จัดส่งเอกสาร/อีเมล (จากข้อความแอดมิน ถ้ามี)"
}`;

  const raw = await askClaude(prompt, {
    system: "คุณเป็นผู้ช่วยสกัดข้อมูลเอกสารการเงิน ตอบเป็น JSON ที่ถูกต้องเท่านั้น",
    timeoutMs: 90_000,
  });
  const j = parseJsonLoose(raw);
  const a = parseAdminMsg(adminText);

  // ฟิลด์ระบุตัวตน: ใช้ค่าจากข้อความแอดมิน (regex เชื่อถือได้) เป็นหลัก, PDF/LLM เป็น fallback
  const pick = (adminVal?: string, llmVal?: unknown) =>
    (adminVal && adminVal.length ? adminVal : String(llmVal ?? "")).trim();

  return {
    username: pick(a.username, j.username),
    name: pick(a.name, j.name),
    taxId: pick(a.taxId, j.taxId).replace(/\s/g, ""),
    address: pick(a.address, j.address),
    bank: String(j.bank ?? "").trim(), // ธนาคารมีเฉพาะในเอกสาร
    account: String(j.account ?? "").replace(/\s/g, "").trim(),
    date: pick(a.date, j.date),
    gross: num(j.gross),
    wht: num(j.wht),
    net: num(j.net),
    email: a.email || (j.email ? String(j.email).trim() : undefined),
    pdfText,
  };
}
