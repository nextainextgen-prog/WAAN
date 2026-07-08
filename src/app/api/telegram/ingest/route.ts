import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { getAllowedChatId, setAllowedChatId, getAllowedGroups, addAllowedGroup } from "@/lib/telegram";
import { isOwner, isAuthorized, grantMember, revokeMember, rememberMember } from "@/lib/team";
import { askBrain } from "@/lib/brain";
import { saveChat } from "@/lib/secretary";
import { extractEvent, createEvent, getUpcoming, thaiDate } from "@/lib/calendar";
import { generateDeck } from "@/lib/deck-generate";
import { saveDeckFiles } from "@/lib/slide-store";
import { pageForQuestion, captureAppPage } from "@/lib/screenshot";
import { extractUrls, fetchUrlContent, saveLinkToBrain } from "@/lib/weblink";

export const runtime = "nodejs";
export const maxDuration = 240;

interface Send {
  kind: "text" | "document" | "photo";
  text?: string;
  url?: string;
  filename?: string;
  caption?: string;
  dataBase64?: string;
  parseMode?: "HTML" | "Markdown";
}

function escHtml(s: string): string {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

const WELCOME = `สวัสดีค่ะพี่โด้ น้องวานเองค่ะ

สั่งงานผ่านแชทนี้ได้เลยนะคะ เช่น
- ถามสถานะทุน: "สรุปสถานะทุนทั้งหมด"
- ตาม deadline: "ทุนไหนใกล้ครบกำหนด"
- ออกเอกสาร: ส่งรายละเอียด+ไฟล์แนบมาได้เลย
- สร้างสไลด์: "สร้างสไลด์ สรุปเดือนนี้"`;

const SLIDE_FALLBACK = "สรุปสถานะทุนวิจัยและความคืบหน้า OKR ล่าสุด";
function isSlideCommand(text: string): string | null {
  // ขึ้นต้นด้วยคำสั่งสไลด์
  const m = text.match(/^\s*(?:\/slide|สร้างสไลด์|ทำสไลด์|ขอสไลด์|สไลด์|พรีเซนต์|นำเสนอ)\s*[:：]?\s*(.*)$/i);
  if (m) return m[1].trim() || SLIDE_FALLBACK;
  // มีคำว่า สไลด์/slide/พรีเซนต์/นำเสนอ + กริยาสั่งทำ อยู่ตรงไหนก็ได้ (เช่น "ช่วยทำสไลด์ Weekly", "จัดสไลด์ให้หน่อย")
  if (/(สไลด์|slide|พรีเซนต์|นำเสนอ|เด็ค|deck)/i.test(text) && /(ทำ|สร้าง|ขอ|ช่วย|จัด|ออกแบบ|generate)/i.test(text)) {
    return text.replace(/^\s*วาน[\s,:ๆจ]*/i, "").trim() || SLIDE_FALLBACK;
  }
  return null;
}

export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const chatId = String(body.chatId || "");
  const text = String(body.text || "").trim();
  const fromId = String(body.fromId || "");
  const isGroup = Boolean(body.isGroup);
  const replyTo = body.replyTo as { id?: string; name?: string; username?: string } | undefined;
  const replyText = String(body.replyText || "").trim(); // ข้อความที่ผู้ใช้ reply อ้างถึง (บริบทต่อเนื่อง)
  const mentions = (body.mentions as { id?: string; name?: string; username?: string }[] | undefined) || [];
  const fromName = String(body.fromName || "").trim();       // ชื่อผู้ที่ส่งข้อความนี้ (ไม่ใช่เจ้าของเสมอไป)
  const fromUsername = String(body.fromUsername || "").trim();
  const imageFiles = (body.imageFiles as string[] | undefined) || []; // path รูปที่ผู้ใช้ส่งมา (ให้ AI อ่าน/วิเคราะห์)
  if (!chatId || !text) return NextResponse.json({ sends: [] });

  const owner = await getAllowedChatId();
  const ownerHere = await isOwner(fromId);

  // ผูกกลุ่มด้วยการ "แนะนำตัว": เจ้าของดึงวานเข้ากลุ่มแล้วสั่งให้แนะนำตัว = ผูกกลุ่มนั้น
  if (isGroup && ownerHere && /แนะนำตัว|introduce/i.test(text)) {
    await addAllowedGroup(chatId);
    return NextResponse.json({
      sends: [
        {
          kind: "text",
          text: `สวัสดีค่ะทุกคน น้องวานเองค่ะ เป็นผู้ช่วย AI ของทีม Thunder 🙌

ในกลุ่มนี้วานช่วยได้เลยนะคะ เช่น
- ตรวจเอกสาร Affiliate อัตโนมัติ (แอดมินแนบ PDF + รายละเอียด วานตรวจเทียบชีต/ระบบให้)
- ตอบคำถามเกี่ยวกับสินค้า/บริการ Thunder (EasySlip, BoostSMS, EasyCRM, ThunderBOT ฯลฯ)
- ออกเอกสารคืนเงินหัก ณ ที่จ่าย, ทำสไลด์
- ถามอะไรก็พิมพ์ "น้องวาน ..." ได้เลยค่ะ

ฝากตัวด้วยนะคะ 😊`,
        },
      ] as Send[],
    });
  }

  // ===== คำสั่งของเจ้าของ: อนุญาต/ยกเลิก/จดจำ ทีมงาน (reply ข้อความของคนนั้น หรือ แท็ก/mention ชื่อคนนั้น) =====
  const grantTarget = replyTo?.id ? replyTo : mentions.find((m) => m.id);
  if (ownerHere && grantTarget?.id) {
    // ชื่อจริงที่เขาใช้ใน Telegram (ใช้แท็ก) — ไม่ตั้งชื่อใหม่ให้เขา
    const realName = grantTarget.name || "สมาชิก";
    // ชื่อเล่นที่พี่โด้บอก เช่น "ชื่อเติ้ล" (ตัดสั้นถึงคำว่า "เป็น"/ช่องว่าง กันกินยาว) — ไว้เก็บ/เรียกในประโยค
    const nick = (text.match(/ชื่อ(?:เล่น)?\s*([ก-๙a-zA-Z]+?)(?=เป็น|\s|,|$)/)?.[1] || "").trim();
    const person = { id: String(grantTarget.id), name: nick || realName, username: grantTarget.username };
    if (/อนุญาต|ให้ตอบ|ให้ใช้|ใช้บอทได้|เป็นผู้ช่วย|ผู้ช่วยผม|เป็นแอดมิน|เพิ่ม.*ทีม|allow/i.test(text)) {
      await grantMember(person, { notes: `พี่โด้แนะนำให้เป็นผู้ช่วย/ทีมงาน${nick ? ` (ชื่อเล่น ${nick})` : ""}` });
      // แท็กด้วยชื่อจริงที่เขาใช้ (username ถ้ามี, ไม่งั้นชื่อ Telegram จริง) — ไม่ใช่ชื่อเล่นที่เพิ่งตั้ง
      const tag = person.username
        ? `@${person.username}`
        : `<a href="tg://user?id=${person.id}">${escHtml(realName)}</a>`;
      const greet = `สวัสดีค่ะ ${tag} น้องวานเองค่ะ 🙌 พี่โด้ฝากให้ดูแล${nick ? ` คุณ${escHtml(nick)}` : ""} เป็นผู้ช่วย/แอดมินของทีมนะคะ ต่อไปนี้ ${tag} สั่งงานหรือถามอะไรวานได้เลยค่ะ ยินดีที่ได้รู้จักค่ะ`;
      return NextResponse.json({ sends: [{ kind: "text", text: greet, parseMode: "HTML" }] as Send[] });
    }
    if (/ห้าม|ยกเลิกสิทธิ์|ถอดสิทธิ์|revoke/i.test(text)) {
      await revokeMember(person.id);
      return NextResponse.json({ sends: [{ kind: "text", text: `ยกเลิกสิทธิ์ของ ${person.name} แล้วค่ะ` }] as Send[] });
    }
    if (/จำ|นี่คือ|แนะนำ|ตำแหน่ง|เป็น(คน|ทีม|ฝ่าย)|profile|ประวัติ/i.test(text)) {
      await rememberMember(person, { notes: text });
      return NextResponse.json({ sends: [{ kind: "text", text: `จำ ${person.name} (${nick || person.name}) ไว้แล้วค่ะ` }] as Send[] });
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

  // ===== ปฏิทิน/ตารางงาน =====
  // ดูตารางที่จะถึง
  if (/(ดู|เช็ก|เช็ค|ขอดู|มีอะไร).{0,8}(ตาราง(งาน)?|ปฏิทิน|calendar|คิว|นัด)|(วันนี้|พรุ่งนี้|สัปดาห์นี้).{0,6}(มีอะไร|ทำอะไร|ต้องทำ)|ตารางงาน(วันนี้|พรุ่งนี้)?/i.test(text)) {
    const ups = await getUpcoming(chatId, 12);
    const reply = ups.length
      ? `ตารางงานที่จะถึงค่ะ\n${ups.map((e) => `• ${thaiDate(e.date)}${e.timeText ? ` ${e.timeText}` : ""} — ${e.title}${e.emoji ? ` ${e.emoji}` : ""}`).join("\n")}`
      : "ตอนนี้ยังไม่มีงานในปฏิทินเลยค่ะ ถ้าอยากให้ลงอะไรบอกได้เลยนะคะ";
    await saveChat("user", text);
    await saveChat("assistant", reply);
    return NextResponse.json({ sends: [{ kind: "text", text: reply }] as Send[] });
  }
  // ลงตารางงาน/ปฏิทิน
  if (/(ลง|ใส่|จด|บันทึก|เพิ่ม).{0,8}(ปฏิทิน|calendar|ตาราง(งาน)?|คิว|นัด(หมาย)?)|นัดหมาย|เตือน.{0,24}(ว่า|วันที่|พรุ่งนี้|มะรืน|วันนี้|จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์|สิ้นเดือน)/i.test(text)) {
    try {
      const parsed = await extractEvent(text);
      const ev = await createEvent({ chatId, parsed, createdById: fromId, creatorName: fromName || undefined });
      const when = `${thaiDate(ev.date)}${ev.timeText ? ` เวลา ${ev.timeText}` : ""}`;
      const em = ev.emoji ? ` ${ev.emoji}` : "";
      const reply = `ลง "${ev.title}" ${when} ให้เรียบร้อยแล้วค่ะ${em}\nถึงวันน้องวานจะแจ้งเตือนอีกทีนะคะ`;
      await saveChat("user", text);
      await saveChat("assistant", reply);
      return NextResponse.json({ sends: [{ kind: "text", text: reply }] as Send[] });
    } catch {
      /* แยกวัน/งานไม่ได้ → ตกไปคุยปกติให้ AI ถามรายละเอียดเพิ่ม */
    }
  }

  // แชทปกติ → สมอง AI
  await saveChat("user", text);
  try {
    const ctxParts: string[] = [];
    // ผู้ที่ถามในตอนนี้เป็น "ใคร" — ให้ตอบถึงคนนั้นโดยตรง ไม่ใช่เหมารวมว่าเป็นพี่โด้เสมอ
    const addressee = mentions.find((m) => m.name || m.username); // คนที่ผู้ส่ง "แท็ก/ระบุถึง" ในข้อความ
    if (addressee) {
      const an = addressee.name || addressee.username || "";
      const who = ownerHere ? "พี่โด้ (เจ้าของ)" : fromName || "ผู้ใช้";
      ctxParts.push(
        `ข้อความนี้ "${who}" เป็นผู้ส่ง และได้แท็ก/ระบุถึง "${an}" — ผู้ส่งต้องการให้คุณ "พูด/ทักทาย/สื่อสารกับ ${an}" โดยตรง ` +
          `ให้ตอบโดยพูดกับ ${an} (เช่น ทักทาย ${an}) ไม่ใช่พูดกับผู้ส่ง` +
          `${isGroup ? ` (ระบบจะแท็ก ${an} ให้อัตโนมัติที่ต้นข้อความ ไม่ต้องพิมพ์ "@" หรือชื่อซ้ำตอนขึ้นต้นเอง)` : ""}`,
      );
    } else if (ownerHere) {
      ctxParts.push(`ผู้ที่ส่งข้อความนี้คือ "พี่โด้" (เจ้าของ) — ตอบถึงพี่โด้ได้ตามปกติ`);
    } else {
      const display = fromName || fromUsername || "สมาชิกทีม";
      ctxParts.push(
        `ผู้ที่ส่งข้อความนี้คือ "${display}"${fromUsername ? ` (@${fromUsername})` : ""} ซึ่ง "ไม่ใช่พี่โด้" — ให้ตอบถึงคนนี้โดยตรง เรียกเขาว่า ${display} ` +
          `ห้ามเรียกผู้ถามว่า "พี่โด้" เด็ดขาด` +
          `${isGroup ? ` (ระบบจะแท็กชื่อผู้ถามให้อัตโนมัติที่ต้นข้อความ คุณไม่ต้องพิมพ์ "@" หรือชื่อซ้ำตอนขึ้นต้นเอง ตอบเนื้อหาได้เลย)` : ""}`,
      );
    }
    // รูปที่ผู้ใช้ส่งมา → ให้ AI เปิดอ่านด้วยตา (vision) แล้ววิเคราะห์/ตอบ
    if (imageFiles.length) {
      ctxParts.push(
        `ผู้ใช้ส่ง "รูปภาพ" มาด้วย ${imageFiles.length} รูป — เปิดอ่านด้วยเครื่องมือ Read ทุกไฟล์ตาม path ด้านล่าง แล้ววิเคราะห์/อธิบายว่าคืออะไร และตอบคำถามจากเนื้อหาในรูปได้เลย (ห้ามบอกว่ายังไม่เห็นรูป):\n${imageFiles
          .map((p, i) => `${i + 1}. ${p}`)
          .join("\n")}`,
      );
    }
    // ถ้าผู้ใช้ reply ข้อความก่อนหน้า → แนบเป็นบริบทให้ตอบตรงเรื่องที่อ้างถึง
    if (replyText) {
      ctxParts.push(
        `ผู้ใช้กำลังตอบกลับ (reply) ข้อความนี้ ให้ตอบโดยอ้างอิงเนื้อหานี้เป็นหลัก อย่าเปลี่ยนไปเรื่องอื่น:\n"""\n${replyText.slice(0, 2000)}\n"""`,
      );
    }
    // ถ้ามีลิงก์ในข้อความ/ข้อความที่ reply → เปิดอ่านเนื้อหาจริง + เก็บลงสมอง (ถ้าสั่งบันทึก)
    const urls = [...extractUrls(text), ...extractUrls(replyText)].slice(0, 3);
    if (urls.length) {
      const saveIntent = /บันทึก|เก็บ|จำ|save|เซฟ|จดไว้|เก็บไว้|ลงสมอง|ลงความจำ/i.test(text);
      const dateStr = new Date().toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
      const fetched: string[] = [];
      for (const u of urls) {
        try {
          const c = await fetchUrlContent(u);
          if (saveIntent) await saveLinkToBrain(c, dateStr, text.slice(0, 200));
          fetched.push(`### ${c.title} (${c.url})\n${c.text.slice(0, 8000)}`);
        } catch (err) {
          fetched.push(`### ${u}\n(เปิดลิงก์ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)})`);
        }
      }
      ctxParts.push(
        `${saveIntent ? "ผู้ใช้ให้บันทึกลิงก์นี้ลงความจำ (วานอ่านและบันทึกลงสมองแล้ว) ให้ยืนยันสั้นๆ แล้วสรุปประเด็นสำคัญจากเนื้อหาให้ด้วย" : "เนื้อหาจากลิงก์ที่ผู้ใช้ส่ง (วานเปิดอ่านจริงแล้ว ใช้ตอบ/สรุปได้เลย)"}:\n${fetched.join("\n\n")}`,
      );
    }
    const extraContext = ctxParts.length ? ctxParts.join("\n\n") : undefined;
    const { reply } = await askBrain(text, { extraContext });
    await saveChat("assistant", reply);
    const sends: Send[] = [{ kind: "text", text: reply }];
    // แคปหน้าเว็บแนบคำตอบ — ปิดไว้ก่อน (เปิดด้วย ENABLE_WEB_SCREENSHOT=1) เพราะเน้นตอบเรื่อง Thunder
    if (process.env.ENABLE_WEB_SCREENSHOT === "1") {
      const pick = pageForQuestion(text);
      if (pick) {
        try {
          const origin = new URL(req.url).origin;
          const png = await captureAppPage(origin, pick.path, { fullPage: pick.fullPage });
          sends.push({ kind: "photo", dataBase64: png.toString("base64"), caption: `${pick.label}ในระบบค่ะ` });
        } catch (err) {
          console.error("[ingest] screenshot failed:", err);
        }
      }
    }
    return NextResponse.json({ sends });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ sends: [{ kind: "text", text: `ขออภัย เชื่อมต่อสมอง AI ไม่ได้ (${detail})` }] as Send[] });
  }
}
