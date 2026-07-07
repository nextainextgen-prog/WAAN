import { NextResponse } from "next/server";
import { isServiceRequest, getCurrentUser } from "@/lib/auth";
import { reviseMemo, memoFilename } from "@/lib/memo-store";
import { isAuthorized } from "@/lib/team";
import { getAllowedGroups } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 240;

// กด "แก้ไข" แล้วพิมพ์บอกว่าอยากแก้อะไร → ออกร่างใหม่จากเอกสารเดิม (id เดิม)
export async function POST(req: Request) {
  const allowed = isServiceRequest(req) || (await getCurrentUser());
  if (!allowed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  const instruction = String(body.instruction || "").trim();
  if (!id || !instruction) return NextResponse.json({ error: "no input" }, { status: 400 });

  // ตรวจสิทธิ์ผู้สั่ง (จาก Telegram) เหมือนตอนออกเอกสาร
  const fromId = String(body.fromId || "");
  if (fromId) {
    if (body.isGroup) {
      const groups = await getAllowedGroups();
      if (!groups.includes(String(body.chatId)) && !(await isAuthorized(fromId))) {
        return NextResponse.json({ error: "unauthorized" }, { status: 403 });
      }
    }
    if (!(await isAuthorized(fromId))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 403 });
    }
  }

  try {
    const res = await reviseMemo(id, instruction);
    if (!res.ok || !res.data) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      id,
      serviceName: res.data.serviceName,
      refund: res.data.refund,
      whtAmount: res.data.whtAmount,
      overpay: res.data.overpay,
      attachCount: res.data.attachments.length,
      filename: memoFilename(res.data, false),
      valid: res.validation?.ok ?? true,
      warnings: res.validation?.warnings ?? [],
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
