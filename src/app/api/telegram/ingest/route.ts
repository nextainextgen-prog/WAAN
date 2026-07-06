import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { getAllowedChatId, setAllowedChatId, getAllowedGroups, addAllowedGroup } from "@/lib/telegram";
import { isOwner, isAuthorized, grantMember, revokeMember, rememberMember } from "@/lib/team";
import { askBrain } from "@/lib/brain";
import { saveChat } from "@/lib/secretary";
import { generateDeck } from "@/lib/deck-generate";
import { saveDeckFiles } from "@/lib/slide-store";

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
  const fromId = String(body.fromId || "");
  const isGroup = Boolean(body.isGroup);
  const replyTo = body.replyTo as { id?: string; name?: string; username?: string } | undefined;
  if (!chatId || !text) return NextResponse.json({ sends: [] });

  const owner = await getAllowedChatId();
  const ownerHere = await isOwner(fromId);

  // เจ้าของอยู่ในกลุ่มไหน = ผูกกลุ่มนั้นอัตโนมัติ (สมาชิกที่อนุญาตจะใช้ได้ทันที)
  if (isGroup && ownerHere) await addAllowedGroup(chatId);

  // ===== คำสั่งของเจ้าของ: อนุญาต/ยกเลิก/จดจำ ทีมงาน (ตอบกลับข้อความของคนนั้น) =====
  if (ownerHere && replyTo?.id) {
    const person = { id: String(replyTo.id), name: replyTo.name || "สมาชิก", username: replyTo.username };
    if (/อนุญาต|ให้ตอบ|ให้ใช้|ใช้บอทได้|เพิ่ม.*ทีม|allow/i.test(text)) {
      await grantMember(person, { notes: text.replace(/อนุญาต|ให้ตอบ(คนนี้)?(ได้)?|ให้ใช้(บอท)?(ได้)?|allow/gi, "").trim() || undefined });
      return NextResponse.json({ sends: [{ kind: "text", text: `รับทราบค่ะ ให้ ${person.name} ใช้งานน้องวานได้แล้ว จะจำไว้เลยนะคะ` }] as Send[] });
    }
    if (/ห้าม|ยกเลิกสิทธิ์|ถอดสิทธิ์|revoke/i.test(text)) {
      await revokeMember(person.id);
      return NextResponse.json({ sends: [{ kind: "text", text: `ยกเลิกสิทธิ์ของ ${person.name} แล้วค่ะ` }] as Send[] });
    }
    if (/จำ|นี่คือ|แนะนำ|ตำแหน่ง|เป็น(คน|ทีม|ฝ่าย)|profile|ประวัติ/i.test(text)) {
      await rememberMember(person, { notes: text });
      return NextResponse.json({ sends: [{ kind: "text", text: `จำ ${person.name} ไว้แล้วค่ะ` }] as Send[] });
    }
  }

  if (isGroup) {
    // เจ้าของผูกกลุ่ม
    if (/^\s*(ผูกกลุ่ม|bind)/i.test(text)) {
      if (!ownerHere) return NextResponse.json({ sends: [{ kind: "text", text: "ขอโทษค่ะ ต้องให้เจ้าของเป็นคนผูกกลุ่มนะคะ" }] as Send[] });
      await addAllowedGroup(chatId);
      return NextResponse.json({ sends: [{ kind: "text", text: "ผูกกลุ่มนี้เรียบร้อยแล้วค่ะ ทำได้ทุกอย่างในกลุ่มนี้เลยนะคะ" }] as Send[] });
    }
    const groups = await getAllowedGroups();
    const groupOk = groups.includes(chatId) || ownerHere;
    if (!groupOk) return NextResponse.json({ sends: [] }); // กลุ่มยังไม่ผูก — เงียบ
    // ต้องมีสิทธิ์ (เจ้าของ หรือทีมที่อนุญาต)
    if (!(await isAuthorized(fromId))) {
      return NextResponse.json({ sends: [{ kind: "text", text: "ขอโทษค่ะ ต้องให้เจ้าของอนุญาตก่อนถึงจะช่วยได้นะคะ" }] as Send[] });
    }
  } else {
    // แชทส่วนตัว
    if (!owner) {
      await setAllowedChatId(chatId);
      return NextResponse.json({ sends: [{ kind: "text", text: `เชื่อมต่อสำเร็จ (chat id: ${chatId})\n\n${WELCOME}` }] as Send[] });
    }
    if (!(await isAuthorized(fromId))) {
      return NextResponse.json({ sends: [{ kind: "text", text: "ขออภัย บอทนี้ผูกกับบัญชีอื่นแล้ว" }] as Send[] });
    }
  }

  // /start หรือทักทาย
  if (/^\/start$/i.test(text)) {
    return NextResponse.json({ sends: [{ kind: "text", text: WELCOME }] as Send[] });
  }

  // คำสั่งสร้างสไลด์
  const slideTopic = isSlideCommand(text);
  if (slideTopic) {
    try {
      const { deck, html, pdf } = await generateDeck(slideTopic);
      const meta = await saveDeckFiles(
        { title: deck.title, subtitle: deck.subtitle, slideCount: deck.slides.length },
        slideTopic,
        html,
        pdf,
      );
      const safe = deck.title.replace(/[^\p{L}\p{N}ก-๙\s_-]/gu, "").slice(0, 50) || "slides";
      return NextResponse.json({
        sends: [
          { kind: "text", text: `ทำสไลด์ "${deck.title}" (${deck.slides.length} สไลด์) ให้แล้วค่ะ ส่งทั้ง PDF และไฟล์เด็คที่เลื่อนดูได้ให้เลยนะคะ` },
          { kind: "document", url: `/api/slides/${meta.id}/pdf`, filename: `${safe}.pdf`, caption: deck.title },
          { kind: "document", url: `/api/slides/${meta.id}/html`, filename: `${safe}.html` },
        ] as Send[],
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ sends: [{ kind: "text", text: `สร้างสไลด์ไม่สำเร็จค่ะ: ${detail}` }] as Send[] });
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
