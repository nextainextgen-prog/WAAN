import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { parseSystemNoti } from "@/lib/aff-notify";
import { getGroupFunc, resolveAffTag } from "@/lib/roles";
import { makeAffReceipt, parseEdit } from "@/lib/aff-make";
import { saveChat } from "@/lib/secretary";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Send {
  kind: "text" | "photo" | "document";
  text?: string;
  caption?: string;
  filename?: string;
  dataBase64?: string;
  parseMode?: "HTML" | "Markdown";
}

// ถอดแท็ก HTML/tg-spoiler กลับเป็นข้อความจริง (ไว้เก็บลงประวัติให้ AI อ่าน)
function stripHtml(s: string): string {
  return s
    .replace(/<\/?tg-spoiler>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// วานสร้างใบสำคัญรับเงิน Affiliate เอง + ตรวจเอง เมื่อบอทระบบแจ้ง noti (กลุ่มที่ทำหน้าที่ aff)
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const chatId = String(body.chatId || "");
  const notiText = String(body.notiText || "");
  const isGroup = Boolean(body.isGroup);
  const editInstruction = String(body.editInstruction || ""); // คำสั่ง "แก้ไข" (ถ้ามี) → override แล้วสร้างใหม่
  if (!chatId || !notiText) return NextResponse.json({ ok: false, skip: true });

  const noti = parseSystemNoti(notiText);
  if (!noti || !noti.username) return NextResponse.json({ ok: false, skip: true });

  // เฉพาะกลุ่มที่ตั้งหน้าที่ = aff (กลุ่มอื่นเงียบ ไม่รบกวน) — แชทเจ้าของ (ไม่ใช่กลุ่ม) ให้ผ่านไว้ทดสอบ
  if (isGroup) {
    const gfn = await getGroupFunc(chatId);
    if (!gfn || gfn.id !== "aff") return NextResponse.json({ ok: false, skip: true });
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "waan-affmake-"));
  const overrides = editInstruction ? parseEdit(editInstruction) : undefined;
  let r;
  try {
    r = await makeAffReceipt({ noti, chatId, outDir: dir, overrides });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }

  const sends: Send[] = [];
  const pushPhoto = (p: string, caption: string) => {
    try { sends.push({ kind: "photo", dataBase64: fs.readFileSync(p).toString("base64"), caption }); } catch { /* skip */ }
  };

  if (r.status === "ok" || r.status === "amount_mismatch") {
    if (r.reportText) sends.push({ kind: "text", text: r.reportText, parseMode: "HTML" });
    for (const im of r.images || []) pushPhoto(im.path, im.caption);
    if (r.pdfPath) {
      try {
        sends.push({
          kind: "document",
          dataBase64: fs.readFileSync(r.pdfPath).toString("base64"),
          filename: path.basename(r.pdfPath),
          caption: "เอกสารที่จัดทำ (ร่าง)",
        });
      } catch { /* skip */ }
    }
    await saveChat("assistant", `[วานจัดทำ+ตรวจเอกสาร AFF ${r.username}]\n${stripHtml(r.reportText || "")}`.slice(0, 3500)).catch(() => {});
  } else if (r.status === "new_customer") {
    sends.push({
      kind: "text",
      text: `ยูสเซอร์ "${r.username}" ยังไม่มีไฟล์ในระบบ น่าจะเป็นลูกค้าใหม่ค่ะ\nรบกวนส่ง "หน้าข้อมูลลูกค้า" (หน้ายืนยันตัวตน + บัตรประชาชน) มาในแชทน้องวาน เดี๋ยวจัดทำเอกสารให้เลยนะคะ`,
    });
  } else if (r.status === "no_session") {
    sends.push({ kind: "text", text: `⚠️ ${r.note || "ยังไม่ได้เชื่อมระบบหลังบ้าน"} — รบกวนรัน npm run thunder:auth ค่ะ` });
  } else if (r.status === "not_found") {
    sends.push({ kind: "text", text: `ยังไม่พบรายการถอนของ "${r.username}" ในระบบหลังบ้านค่ะ (อาจยังไม่ขึ้นระบบ)` });
  } else {
    sends.push({ kind: "text", text: `ขออภัยค่ะ จัดทำเอกสารไม่สำเร็จ: ${r.note || r.status}` });
  }

  const tagTarget = await resolveAffTag(chatId).catch(() => null);
  return NextResponse.json({
    ok: true,
    status: r.status,
    allOk: !!r.allOk,
    summaryCaption: r.summaryCaption || "",
    tagTarget,
    sends,
  });
}
