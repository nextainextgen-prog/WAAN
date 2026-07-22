import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getRefundContact } from "@/lib/refund-contacts";

export const runtime = "nodejs";

// ค้นข้อมูลลูกค้าเดิมจาก "ยูสเซอร์" (ความจำระบบ) — ให้ฟอร์มดึงกลับมาอัตโนมัติ
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = new URL(req.url).searchParams.get("user") || "";
  const contact = getRefundContact(q);
  return NextResponse.json({ found: !!contact, contact });
}
