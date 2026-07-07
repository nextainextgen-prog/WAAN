import fs from "node:fs";
import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { getAllowedChatId, getAllowedGroups } from "@/lib/telegram";
import { isOwner, isAuthorized } from "@/lib/team";
import { runAffCheck } from "@/lib/aff-check";

export const runtime = "nodejs";
export const maxDuration = 240;

interface Send {
  kind: "text" | "photo";
  text?: string;
  caption?: string;
  dataBase64?: string;
}

export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const chatId = String(body.chatId || "");
  const fromId = String(body.fromId || "");
  const isGroup = Boolean(body.isGroup);
  const rawText = String(body.rawText || "");
  const files = (body.files as { path: string; filename: string }[]) || [];
  if (!chatId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  // ===== ตรวจสิทธิ์ =====
  const ownerHere = await isOwner(fromId);
  if (isGroup) {
    const groups = await getAllowedGroups();
    // กลุ่มที่ผูกแล้ว = ตรวจเอกสาร AFF ให้ทุกคนในกลุ่ม (กลุ่มงานที่เชื่อถือได้)
    if (!(groups.includes(chatId) || ownerHere)) return NextResponse.json({ ok: false, error: "unauthorized" });
  } else {
    const owner = await getAllowedChatId();
    if (owner && !(await isAuthorized(fromId))) return NextResponse.json({ ok: false, error: "unauthorized" });
  }

  const pdf = files.find((f) => /\.pdf$/i.test(f.filename) && fs.existsSync(f.path));
  if (!pdf) return NextResponse.json({ ok: false, error: "no_pdf" });

  try {
    const result = await runAffCheck(pdf.path, rawText);
    const sends: Send[] = [{ kind: "text", text: result.reportText }];
    for (const im of result.images) {
      try {
        const b64 = fs.readFileSync(im.path).toString("base64");
        sends.push({ kind: "photo", dataBase64: b64, caption: im.caption });
      } catch {
        /* ข้ามภาพที่อ่านไม่ได้ */
      }
    }
    return NextResponse.json({ ok: true, sends });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: detail });
  }
}
