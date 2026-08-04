import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { parseSystemNoti } from "@/lib/aff-notify";
import { getGroupFunc, resolveAffTag } from "@/lib/roles";
import { makeAffReceipt, parseEditSmart } from "@/lib/aff-make";
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
  // ถ้าบอทส่ง overrides ที่ "แอดมินกดยืนยันแล้ว" มา ใช้ตามนั้นเลย (ไม่ตีความซ้ำ = ไม่มีโอกาสเพี้ยน)
  // ไม่งั้นค่อยตีความจากคำสั่งข้อความ (ทางเดิม เผื่อเรียกจากที่อื่น)
  const overrides = body.overrides && Object.keys(body.overrides).length
    ? (body.overrides as Awaited<ReturnType<typeof parseEditSmart>>)
    : editInstruction ? await parseEditSmart(editInstruction) : undefined;
  let r;
  try {
    r = await makeAffReceipt({ noti, chatId, outDir: dir, overrides });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }

  const sends: Send[] = [];
  // ตอบให้แอดมินเห็นว่าวานตีความคำสั่งแก้เป็นอะไรบ้าง (โปร่งใส กันแก้ผิดเงียบ)
  if (editInstruction && overrides && Object.keys(overrides).length) {
    const FL: Record<string, string> = { prefix: "คำนำหน้า", name: "ชื่อ", taxId: "เลขภาษี", houseNo: "บ้านเลขที่", moo: "หมู่", road: "ถนน/ซอย", tambon: "ตำบล/แขวง", amphoe: "อำเภอ/เขต", changwat: "จังหวัด", bank: "ธนาคาร", account: "เลขบัญชี", gross: "ยอด" };
    const parts = Object.entries(overrides).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${FL[k] || k}: ${v}`);
    if (parts.length) sends.push({ kind: "text", text: `✏️ รับคำสั่งแก้แล้วค่ะ — จะปรับ:\n${parts.map((p) => `• ${p}`).join("\n")}` });
  } else if (editInstruction) {
    sends.push({ kind: "text", text: `⚠️ อ่านคำสั่งแก้แล้วแต่ยังไม่แน่ใจว่าจะแก้ตรงไหนค่ะ ลองพิมพ์ระบุชัดขึ้น เช่น "ที่อยู่ 94 ซ.สวัสดี แขวงดินแดง เขตดินแดง กรุงเทพมหานคร" หรือ "ชื่อ นายสมชาย ใจดี"` });
  }
  const pushPhoto = (p: string, caption: string) => {
    try { sends.push({ kind: "photo", dataBase64: fs.readFileSync(p).toString("base64"), caption }); } catch { /* skip */ }
  };

  // ลูกค้าใหม่: วานไปทำ "เอกสารยืนยันตัวตน" จากหน้า KYC ในระบบมาให้เองแล้ว → ส่งเข้ากลุ่มก่อน
  if (r.kycCreated && r.kycDoc) {
    try {
      sends.push({
        kind: "document",
        dataBase64: fs.readFileSync(r.kycDoc.path).toString("base64"),
        filename: r.kycDoc.filename,
        caption:
          `✅ ทำเอกสารยืนยันตัวตนลูกค้าใหม่ "${r.username}" เรียบร้อยแล้วค่ะ (ดึงจากหน้ายืนยันตัวตนในระบบให้เอง)` +
          (r.kycNote ? `\n⚠️ ${r.kycNote}` : ""),
      });
    } catch { /* ส่งไฟล์ไม่ได้ก็ยังไปต่อ */ }
    sends.push({ kind: "text", text: "📄 เก็บเข้าคลังข้อมูล AFF ให้แล้ว กำลังทำเอกสารถอน AFF ต่อให้เลยนะคะ สักครู่ค่ะ" });
  }

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
    // ปกติวานจะไปดึงหน้ายืนยันตัวตนจากระบบมาทำเอกสารเอง — มาถึงตรงนี้ = ดึงไม่ได้จริง ๆ บอกสาเหตุตรง ๆ
    sends.push({
      kind: "text",
      text:
        `ยูสเซอร์ "${r.username}" ยังไม่มีเอกสารยืนยันตัวตนในคลัง และทำให้อัตโนมัติไม่สำเร็จค่ะ\n` +
        `สาเหตุ: ${r.note || "ไม่ทราบ"}\n` +
        `ถ้าลูกค้ายืนยันตัวตนในระบบแล้ว บอกให้ลองใหม่ได้เลย หรือส่งหน้าข้อมูลลูกค้ามาในแชทก็ได้ค่ะ`,
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
