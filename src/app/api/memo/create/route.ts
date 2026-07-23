import { NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareAttachment } from "@/lib/pdf-to-images";
import { createRefundMemoFromForm } from "@/lib/memo-generate";
import { saveMemoDraft, memoFilename, readMemoPdf, recordMemoMessage } from "@/lib/memo-store";
import { getBotToken, getAllowedChatId, getRefundMemoChatId, tgSendDocument } from "@/lib/telegram";
import { UPLOAD_SLOTS, SLOT_BY_KEY, buildAttachNote, type RefundFormInput } from "@/lib/refund-slots";
import { saveRefundContact } from "@/lib/refund-contacts";
import type { MemoAttachment } from "@/lib/memo";

export const runtime = "nodejs";
export const maxDuration = 240;

const thaiDate = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function esc(v: unknown): string {
  return String(v ?? "-").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}
function spoiler(v: unknown): string {
  return `<tg-spoiler>${esc(v)}</tg-spoiler>`;
}

export async function POST(req: Request) {
  // หน้า /refund เปิดสาธารณะ (ไม่ต้อง login) — เอกสารที่ออกยังต้องให้เจ้าของตรวจ+กด "เซ็นเลย" ในกลุ่มก่อนเสมอ
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const payloadRaw = String(fd.get("payload") || "");
  let form: RefundFormInput;
  try {
    form = JSON.parse(payloadRaw);
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  if (!form.brand || (form.brand !== "thunder" && form.brand !== "easyslip")) {
    return NextResponse.json({ error: "กรุณาเลือกบริษัท" }, { status: 400 });
  }
  if (!form.user?.trim()) return NextResponse.json({ error: "กรุณากรอกยูสเซอร์" }, { status: 400 });
  if (!form.refund || form.refund <= 0) return NextResponse.json({ error: "กรุณากรอกยอดโอนคืน" }, { status: 400 });

  // เก็บไฟล์อัพโหลดเข้าหน่วยความจำเร็ว ๆ (ไล่ตามลำดับช่อง)
  const uploads: { slotKey: string; name: string; buf: Buffer }[] = [];
  const slotsWithFiles = new Set<string>();
  for (const slot of UPLOAD_SLOTS) {
    const files = fd.getAll(`f:${slot.key}`).filter((v): v is File => v instanceof File && v.size > 0);
    if (!files.length) continue;
    slotsWithFiles.add(slot.key);
    for (const file of files) {
      uploads.push({ slotKey: slot.key, name: file.name || `${slot.key}.bin`, buf: Buffer.from(await file.arrayBuffer()) });
    }
  }

  // งานหนัก (แปลงไฟล์ → ออก PDF → ล็อก → โพสต์ TG) ทำเบื้องหลัง — ตอบ client ทันที ไม่ต้องรอ
  void processMemo(form, uploads, slotsWithFiles).catch((e) =>
    console.error("[memo/create] background error:", e instanceof Error ? e.message : e),
  );

  return NextResponse.json({ ok: true, queued: true });
}

// ประมวลผลเบื้องหลัง: สร้างเอกสาร + โพสต์เข้ากลุ่ม (รันบน Node server ที่อยู่ตลอด ไม่ใช่ serverless)
async function processMemo(
  form: RefundFormInput,
  uploads: { slotKey: string; name: string; buf: Buffer }[],
  slotsWithFiles: Set<string>,
): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "waan-memo-form-"));
  const outDir = path.join(process.cwd(), ".generated", "memo-attach");
  const attachments: MemoAttachment[] = [];
  try {
    let i = 0;
    for (const u of uploads) {
      const safe = u.name.replace(/[^\w.\-ก-๙ ()]/g, "_");
      const dest = path.join(tmp, `${u.slotKey}-${i++}-${safe}`);
      fs.writeFileSync(dest, u.buf);
      try {
        attachments.push(...(await prepareAttachment(dest, outDir, SLOT_BY_KEY[u.slotKey]?.label)));
      } catch {
        /* ข้ามไฟล์ที่อ่านไม่ได้ */
      }
    }

    const attachNote = buildAttachNote(slotsWithFiles, form.otherDocLabel, form.docType);
    const date = thaiDate.format(new Date());
    const { data, pdf } = await createRefundMemoFromForm({ form, attachments, attachNote, date });
    const id = await saveMemoDraft(data, pdf, undefined, form); // เก็บ form ไว้ให้แก้ไขผ่านแชท
    saveRefundContact(form); // ความจำระบบ: จำข้อมูลลูกค้าไว้ให้ครั้งหน้าดึงกลับ

    // โพสต์เข้ากลุ่ม Telegram (flow เดิม: ปุ่ม "เซ็นเลย" → callback route จัดการ)
    const chatId = (await getRefundMemoChatId()) || (await getAllowedChatId());
    if (!getBotToken() || !chatId) {
      console.error("[memo/create] posted ไม่ได้ — ยังไม่ได้ตั้งค่า bot token / กลุ่มปลายทาง");
      return;
    }
    const locked = (await readMemoPdf(id)) || pdf;
    const caption =
      `📥 ออกร่างเอกสารคืนเงินให้แล้วนะคะ (ยังไม่เซ็น)\n\n` +
      `🏢 บริษัท: ${data.brand === "easyslip" ? "อีซี่สลิป" : "ธันเดอร์ โซลูชั่น"}\n` +
      `👤 ลูกค้า: ${spoiler(data.serviceName || "-")}\n` +
      `📊 ยอดคืนรวม: ${spoiler(`${data.refund.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท`)}\n` +
      `🖼️ แนบครบ ${esc(data.attachments.length)} หน้า\n\n` +
      `⏳ รบกวนดำเนินการภายใน 24 ชม. ก่อนประวัติแชทจะถูกลบค่ะ\n` +
      `🔒 ไฟล์นี้ล็อกรหัสไว้นะคะ (รหัสเปิด)\n` +
      `<pre>xxxx-xxx</pre>\n\n` +
      `✅ ถ้าโอเคกด "เซ็นเลย" เดี๋ยวเติมลายเซ็นให้ค่ะ`;
    const sent = await tgSendDocument(chatId, locked, memoFilename(data, false), caption, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "เซ็นเลย", callback_data: `memo:sign:${id}` }]] },
    });
    // จด message → memo ไว้ให้จับ reply แก้ไข
    const msgId = (sent as { result?: { message_id?: number } })?.result?.message_id;
    if (msgId) await recordMemoMessage(id, chatId, msgId).catch(() => {});
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
