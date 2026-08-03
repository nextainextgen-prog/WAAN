import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { listGroupsWithFunc } from "@/lib/roles";

export const runtime = "nodejs";

// บอทเรียกเป็นระยะ → คืนกลุ่มที่ "ประมวลผลทุกข้อความ" (มีหน้าที่เดียวทั้งกลุ่ม เช่น ขยายวันหมดอายุ Thunder)
// ไม่ต้องขึ้นต้นด้วย "วาน"/แท็กบอท
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // ทุก func ที่เป็น "กลุ่มหน้าที่เดียว" ต้องอยู่ในนี้ ไม่งั้นวานจะเงียบถ้าไม่ถูกแท็ก
  const lists = await Promise.all([
    listGroupsWithFunc("thunder_expiry"),
    listGroupsWithFunc("thunder_refund"),
    listGroupsWithFunc("tax_invoice"),
  ]);
  const groups = [...new Set(lists.flat())];
  return NextResponse.json({ groups });
}
