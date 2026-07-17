import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { migrateGroupId } from "@/lib/roles";

export const runtime = "nodejs";

// กลุ่มอัปเกรดเป็น supergroup → chatId เปลี่ยน: บอทเรียกมาให้คัดลอก config เก่า→ใหม่
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const oldId = String(body.oldId || "");
  const newId = String(body.newId || "");
  if (!oldId || !newId) return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  try {
    const changed = await migrateGroupId(oldId, newId);
    return NextResponse.json({ ok: true, changed });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
