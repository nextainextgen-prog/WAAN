import { NextResponse } from "next/server";
import { getRefundContact } from "@/lib/refund-contacts";

export const runtime = "nodejs";

// ค้นข้อมูลลูกค้าเดิมจาก "ยูสเซอร์" (ความจำระบบ) — ให้ฟอร์มดึงกลับมาอัตโนมัติ
// เปิดสาธารณะ (คู่กับหน้า /refund ที่ไม่ต้อง login)
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("user") || "";
  const contact = getRefundContact(q);
  return NextResponse.json({ found: !!contact, contact });
}
