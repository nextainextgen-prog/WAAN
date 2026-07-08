import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { getAllowedChatId, getAllowedGroups, getManagerSigner } from "@/lib/telegram";
import { isOwner, isAuthorized } from "@/lib/team";
import { decideDocument } from "@/lib/documents";

export const runtime = "nodejs";

// รับ callback จากปุ่ม inline ของ Telegram (อนุมัติ/ไม่อนุมัติเอกสาร)
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const chatId = String(body.chatId || "");
  const fromId = String(body.fromId || "");
  const dataStr = String(body.data || "");

  // อนุญาตให้ตรงกับตอน "ออกเอกสาร": ผู้กดเป็นเจ้าของ/ทีมที่อนุญาต หรือแชทที่ผูก/กลุ่มที่อนุญาต
  const allowed = await getAllowedChatId();
  const chatOk = !allowed || chatId === allowed || (await getAllowedGroups()).includes(chatId);
  const userOk = fromId ? (await isOwner(fromId)) || (await isAuthorized(fromId)) : false;
  if (!chatOk && !userOk) {
    return NextResponse.json({ answer: "ไม่ได้รับอนุญาต", sends: [] });
  }

  // ปุ่มร่างเอกสาร (memo) — เซ็นเลย / แก้ไข
  const memo = dataStr.match(/^memo:(sign|revise):(.+)$/);
  if (memo) {
    const [, action, id] = memo;
    if (action === "sign") {
      const { signMemo, memoFilename } = await import("@/lib/memo-store");
      const res = await signMemo(id);
      if (!res.ok || !res.data) {
        return NextResponse.json({ answer: "ไม่พบร่าง", sends: [{ kind: "text", text: "ขออภัยค่ะ หาไฟล์ร่างไม่เจอ ลองออกเอกสารใหม่อีกครั้งนะคะ" }] });
      }
      const mgr = await getManagerSigner();
      const mention = mgr || undefined; // ให้บอทแท็กผู้จัดการที่ {{MENTION}}
      return NextResponse.json({
        answer: "เซ็นแล้วค่ะ",
        sends: [
          {
            kind: "text",
            text: "เซ็นเอกสารเรียบร้อยแล้วค่ะ ต่อไปรบกวน {{MENTION}} (ผู้จัดการ) เซ็นต่ออีกท่านนะคะ",
            mention,
          },
          {
            kind: "document",
            url: `/api/memo/${id}/pdf`,
            filename: memoFilename(res.data, true),
            caption: "เอกสารคืนเงิน (โด้เซ็นแล้ว) รบกวน {{MENTION}} เซ็นต่อ แล้วส่งต่อให้พี่บ๊อบบี้ได้เลยนะคะ",
            mention,
          },
        ],
      });
    }
    return NextResponse.json({
      answer: "รอรายละเอียดการแก้ไข",
      sends: [{ kind: "text", text: "ได้เลยค่ะ พิมพ์บอกได้เลยว่าอยากแก้ตรงไหน (เช่น ยอดเงิน วันที่ ชื่อบัญชี หรือข้อความ) เดี๋ยววานออกร่างใหม่ให้ค่ะ" }],
    });
  }

  const m = dataStr.match(/^doc:(approve|reject):(.+)$/);
  if (!m) return NextResponse.json({ answer: "คำสั่งไม่ถูกต้อง", sends: [] });

  const [, decision, id] = m;
  const result = await decideDocument(id, decision as "approve" | "reject");

  const sends: { kind: "text"; text: string }[] = [{ kind: "text", text: result.message }];
  return NextResponse.json({ answer: result.ok ? "บันทึกแล้ว" : "ไม่สำเร็จ", sends });
}
