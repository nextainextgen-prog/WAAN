// นิยาม "ช่องอัพโหลดเอกสาร" + โครงข้อมูลฟอร์มคืนเงิน (pure — ใช้ได้ทั้ง client และ server)

export type Brand = "thunder" | "easyslip";

// ช่องอัพโหลดแยกตามประเภทเอกสาร — ผูกกับข้อ "เอกสารแนบ" ในฟอร์ม PDF
// standard = เอกสารมาตรฐาน 3 ข้อแรก · extra = เอกสารเพิ่มเติม (เข้าข้อ 4 "อื่นๆ")
export interface UploadSlot {
  key: string;
  label: string; // ป้ายหัวหน้าเอกสารแนบ + ชื่อที่โชว์บนฟอร์ม
  hint: string;
  kind: "standard" | "extra";
}

export const UPLOAD_SLOTS: UploadSlot[] = [
  { key: "bankbook", label: "สำเนาสมุดบัญชีธนาคาร", hint: "หน้าสมุดบัญชีบริษัทที่จะให้โอนเงินคืน", kind: "standard" },
  { key: "slip", label: "หลักฐานการชำระ / สลิป", hint: "สลิปที่ลูกค้าโอนชำระค่าบริการเข้ามา", kind: "standard" },
  { key: "refundproof", label: "หลักฐานลูกค้าขอคืนเงิน", hint: "ภาพแชท/หลักฐานที่ลูกค้าแจ้งขอคืนเงิน", kind: "standard" },
  { key: "wht", label: "เอกสารหัก ณ ที่จ่าย (50 ทวิ)", hint: "หนังสือรับรองการหักภาษี ณ ที่จ่าย (ถ้ามี)", kind: "extra" },
  { key: "quotation", label: "ใบเสนอราคา", hint: "ใบเสนอราคาที่เกี่ยวข้อง (ถ้ามี)", kind: "extra" },
  { key: "other", label: "เอกสารอื่นๆ", hint: "เอกสารประกอบอื่นๆ (ถ้ามี)", kind: "extra" },
];

export const SLOT_BY_KEY: Record<string, UploadSlot> = Object.fromEntries(
  UPLOAD_SLOTS.map((s) => [s.key, s]),
);

// ข้อมูลที่แอดมินกรอกในเว็บฟอร์ม → map ตรงเข้าฟอร์ม PDF (ไม่ผ่าน AI)
export interface RefundFormInput {
  brand: Brand;
  // ลูกค้า
  user: string; // ยูสเซอร์ / อีเมล
  userId?: string; // ไอดียูสเซอร์
  companyName?: string; // ลูกค้าบริษัท (บริษัท/ห้างหุ้นส่วน ___ จำกัด)
  serviceLabel?: string; // ประเภทบริการ (เช่น บอทเช็คสลิป / API)
  reason?: string; // เหตุผลขอคืน
  // เงิน
  topupDate?: string; // วันที่เติมเครดิต
  amount?: number; // จำนวนเงินที่เติมเข้ามา
  purchaseDate?: string; // วันที่ซื้อบริการ
  packageName?: string; // แพ็คเกจ
  months?: number; // จำนวนเดือน
  netPrice?: number; // ราคาค่าบริการ
  remainingCredit?: number; // เครดิตคงเหลือก่อนขอคืน
  refund: number; // ยอดโอนคืนทั้งสิ้น
  // บัญชีรับเงินคืน
  bank?: string;
  accountNo?: string;
  accountName?: string;
  // ชื่อ/ข้อความเพิ่มสำหรับช่อง "อื่นๆ" (ถ้าแอดมินพิมพ์ระบุ)
  otherDocLabel?: string;
}

// สร้างข้อความ "รายละเอียดเอกสารแนบอื่นๆ" (ข้อ 4) จากช่อง extra ที่มีไฟล์แนบ
export function buildAttachNote(slotsWithFiles: Set<string>, otherDocLabel?: string): string {
  const parts: string[] = [];
  if (slotsWithFiles.has("wht")) parts.push("หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)");
  if (slotsWithFiles.has("quotation")) parts.push("ใบเสนอราคา");
  if (slotsWithFiles.has("other")) parts.push((otherDocLabel || "").trim() || "เอกสารประกอบเพิ่มเติม");
  return parts.join(", ");
}
