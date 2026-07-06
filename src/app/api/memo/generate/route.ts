import { NextResponse } from "next/server";
import path from "node:path";
import { isServiceRequest, getCurrentUser } from "@/lib/auth";
import { generateRefundMemo } from "@/lib/memo-generate";
import { prepareAttachment } from "@/lib/pdf-to-images";
import { saveMemoDraft } from "@/lib/memo-store";
import { isAuthorized } from "@/lib/team";
import { getAllowedGroups } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 240;

const thaiDate = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export async function POST(req: Request) {
  const allowed = isServiceRequest(req) || (await getCurrentUser());
  if (!allowed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const rawText: string = (body.rawText || "").trim();
  const files: { path: string; filename: string }[] = body.files || [];
  if (!rawText) return NextResponse.json({ error: "no text" }, { status: 400 });

  // ตรวจสิทธิ์ผู้สั่ง (จาก Telegram): เจ้าของ หรือทีมที่อนุญาต + กลุ่มต้องผูกแล้ว
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

  // เตรียมไฟล์แนบ (PDF → PNG, รูป → ใช้เลย)
  const outDir = path.join(process.cwd(), ".generated", "memo-attach");
  const attachments: { label: string; imagePath: string }[] = [];
  for (const f of files) {
    try {
      const prepped = await prepareAttachment(f.path, outDir);
      // ใช้ชื่อไฟล์จริงเดาป้าย (prepareAttachment ใช้ basename ของ path)
      attachments.push(...prepped);
    } catch {
      /* ข้ามไฟล์ที่อ่านไม่ได้ */
    }
  }

  const date = thaiDate.format(new Date());
  try {
    const res = await generateRefundMemo({ rawText, attachments, date });
    const id = await saveMemoDraft(res.data, res.pdf);
    return NextResponse.json({
      ok: true,
      id,
      serviceName: res.data.serviceName,
      refund: res.data.refund,
      whtAmount: res.data.whtAmount,
      overpay: res.data.overpay,
      attachCount: res.data.attachments.length,
      valid: res.validation.ok,
      warnings: res.validation.warnings,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
