import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { listMutedChatIds, listMutedBrandKeys } from "@/lib/mute";

export const runtime = "nodejs";

// watcher (oho/fb/line) เรียกเป็นระยะ → คืนกลุ่ม (chatId) + แบรนด์ที่ปิดแจ้งเตือนไว้ (จะได้ข้ามการส่ง)
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [groups, brands] = await Promise.all([listMutedChatIds(), listMutedBrandKeys()]);
  return NextResponse.json({ groups, brands });
}
