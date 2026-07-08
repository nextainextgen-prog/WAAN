import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { getAllowedChatId, getManagerSigner } from "@/lib/telegram";

export const runtime = "nodejs";

// ให้บอทดึงค่า config ที่ต้องใช้ (แชทส่วนตัวเจ้าของ + ผู้จัดการที่ต้องแท็กเรื่องเอกสาร)
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    ownerChatId: await getAllowedChatId(),
    managerSigner: await getManagerSigner(),
  });
}
