import { NextResponse } from "next/server";
import { getRefundContact, searchRefundContactKeys } from "@/lib/refund-contacts";

export const runtime = "nodejs";

// ค้นข้อมูลลูกค้าเดิมจาก "ยูสเซอร์" (ความจำระบบ) — เปิดสาธารณะ (คู่กับหน้า /refund)
// ?q= : ค้นรายชื่อยูสเซอร์ที่ตรงคำค้น (autocomplete) → { users: [...] }
// ?user= : ดึงข้อมูลลูกค้าเต็มของยูสเซอร์นั้น → { found, contact }
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q");
  if (q != null) {
    return NextResponse.json({ users: searchRefundContactKeys(q) });
  }
  const contact = getRefundContact(sp.get("user") || "");
  return NextResponse.json({ found: !!contact, contact });
}
