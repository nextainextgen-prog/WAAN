import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { getAllowedChatId, setAllowedChatId } from "@/lib/telegram";
import { askBrain } from "@/lib/brain";
import { saveChat } from "@/lib/secretary";
import { generateSlideDoc } from "@/lib/slides";
import { renderPptx } from "@/lib/render-pptx";
import { renderPdf } from "@/lib/render-pdf";
import { saveSlideFiles } from "@/lib/slide-store";

export const runtime = "nodejs";
export const maxDuration = 240;

interface Send {
  kind: "text" | "document";
  text?: string;
  url?: string;
  filename?: string;
  caption?: string;
}

const WELCOME = `สวัสดีครับอาจารย์ช้างโอ๋ ผมคือเลขา AI ของระบบ Changoh

สั่งงานผ่านแชทนี้ได้เลย เช่น
- ถามสถานะทุน: "สรุปสถานะทุนทั้งหมด"
- ตาม deadline: "ทุนไหนใกล้ครบกำหนด"
- ร่างเอกสาร: "ร่างอีเมลแจ้งความก้าวหน้า"
- สร้างสไลด์: "สร้างสไลด์ สรุปทุนเดือนนี้"`;

function isSlideCommand(text: string): string | null {
  const m = text.match(/^\s*(?:\/slide|สร้างสไลด์|ทำสไลด์|สไลด์)\s*[:：]?\s*(.*)$/i);
  if (!m) return null;
  return m[1].trim() || "สรุปสถานะทุนวิจัยและความคืบหน้า OKR ล่าสุด";
}

export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const chatId = String(body.chatId || "");
  const text = String(body.text || "").trim();
  if (!chatId || !text) return NextResponse.json({ sends: [] });

  // ผูก chat แรกเป็นเจ้าของ
  let allowed = await getAllowedChatId();
  if (!allowed) {
    await setAllowedChatId(chatId);
    allowed = chatId;
    return NextResponse.json({
      sends: [{ kind: "text", text: `เชื่อมต่อสำเร็จ (chat id: ${chatId})\n\n${WELCOME}` }] as Send[],
    });
  }
  if (chatId !== allowed) {
    return NextResponse.json({
      sends: [{ kind: "text", text: "ขออภัย บอทนี้ผูกกับบัญชีอื่นแล้ว" }] as Send[],
    });
  }

  // /start หรือทักทาย
  if (/^\/start$/i.test(text)) {
    return NextResponse.json({ sends: [{ kind: "text", text: WELCOME }] as Send[] });
  }

  // คำสั่งสร้างสไลด์
  const slideTopic = isSlideCommand(text);
  if (slideTopic) {
    try {
      const doc = await generateSlideDoc(slideTopic);
      const [pptx, pdf] = await Promise.all([renderPptx(doc), renderPdf(doc)]);
      const meta = await saveSlideFiles(doc, slideTopic, pptx, pdf);
      const safe = doc.title.replace(/[^\p{L}\p{N}ก-๙\s_-]/gu, "").slice(0, 50) || "slides";
      return NextResponse.json({
        sends: [
          { kind: "text", text: `สร้างสไลด์ "${doc.title}" (${doc.slides.length} สไลด์) เรียบร้อยครับ` },
          { kind: "document", url: `/api/slides/${meta.id}/pdf`, filename: `${safe}.pdf`, caption: doc.title },
          { kind: "document", url: `/api/slides/${meta.id}/pptx`, filename: `${safe}.pptx` },
        ] as Send[],
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ sends: [{ kind: "text", text: `สร้างสไลด์ไม่สำเร็จ: ${detail}` }] as Send[] });
    }
  }

  // แชทปกติ → สมอง AI
  await saveChat("user", text);
  try {
    const { reply } = await askBrain(text);
    await saveChat("assistant", reply);
    return NextResponse.json({ sends: [{ kind: "text", text: reply }] as Send[] });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ sends: [{ kind: "text", text: `ขออภัย เชื่อมต่อสมอง AI ไม่ได้ (${detail})` }] as Send[] });
  }
}
