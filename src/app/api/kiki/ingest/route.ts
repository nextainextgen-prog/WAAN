import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { RECUR_RE, handleRecurring } from "@/lib/kiki-life";
import { extractUrls } from "@/lib/weblink";
import { routeIntent } from "@/lib/kiki-router";
import { matchTriggers, markNagged } from "@/lib/kiki-tasks";
import {
  saveKikiChat,
  setSetting,
  ownerAccounts,
  isOwnerAccount,
  linkOwnerAccount,
  issueLinkCode,
  redeemLinkCode,
  peekLinkCode,
  addKikiChatId,
  transcribeAudio,
  kikiConversation,
  getSetting,
  setPendingFor,
  getPendingFor,
  pendingElsewhereNote,
  ttsOgg,
  sanitizeVexText,
  vexLine,
} from "@/lib/kiki";
import { escHtml } from "./shared";
import { ok, type Send, type Ctx } from "./types";
import { HANDLERS } from "./registry";

export const runtime = "nodejs";
export const maxDuration = 240;

/**
 * สมองเดียวของ Vex — ทุกช่องทางยิงเข้าที่นี่ (Telegram ผ่าน kiki-bot.mjs · Discord ในเฟส 1)
 *
 * ไฟล์นี้ทำแค่ 3 อย่าง: เตรียมบริบท → เดินทะเบียนเส้นทาง → ดักพังชั้นสุดท้าย
 * ตัวงานจริงอยู่ใน handlers/ ลำดับอยู่ใน registry.ts
 * (เดิมทั้งหมดกองอยู่ในฟังก์ชันเดียว 1,590 บรรทัด — ผ่าออกตอนเตรียมต่อช่องทางที่สอง)
 */

export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const chatId = String(body.chatId || "");
  let text = String(body.text || "").trim();
  const fromId = String(body.fromId || "");
  // ช่องทางที่ข้อความนี้เข้ามา — ท่อเก่า (kiki-bot.mjs) ไม่ส่งมา = telegram เหมือนเดิมทุกอย่าง
  // platform = ระบบบัญชี (ใช้เช็คสิทธิ์) · channel = สื่อ (ใช้ติดป้ายในประวัติ)
  const platform = String(body.platform || "telegram").toLowerCase();
  const channel = String(body.channel || platform).toLowerCase();
  const fromName = String(body.fromName || "").trim();
  const replyText = String(body.replyText || "").trim();
  const replyIsScreenshot = Boolean(body.replyIsScreenshot);
  const imageFiles = (body.imageFiles as string[] | undefined) || [];
  const audioFiles = (body.audioFiles as { path: string; mime?: string }[] | undefined) || [];
  const docFiles = (body.docFiles as { path: string; name: string }[] | undefined) || [];
  const videoFiles = (body.videoFiles as { path: string; name: string }[] | undefined) || [];
  // ส่งผ่านตามที่ได้มา ห้ามแปลงชนิด (Telegram ส่งตัวเลข · Discord ส่ง snowflake ที่ต้องคงเป็นสตริง)
  const msgId = (body.msgId ?? undefined) as number | string | undefined;
  const callbackData = String(body.callbackData || "");
  // ปุ่มกด = คำสั่งยืนยันแบบพิมพ์ (แปลงเป็นข้อความเดิม logic ยืนยันทุกตัวใช้ต่อได้เลย)
  if (callbackData === "kiki:dm:yes") text = "ยืนยัน";
  else if (callbackData === "kiki:dm:no") text = "ยกเลิก";
  else if (callbackData === "kiki:grp:yes") text = "[ปุ่ม:สร้างกลุ่ม]";
  else if (callbackData === "kiki:grp:no") text = "[ปุ่ม:ยกเลิกกลุ่ม]";
  else if (callbackData === "kiki:dev:yes") text = "[ปุ่ม:พัฒนาเลย]";
  else if (callbackData === "kiki:dev:no") text = "[ปุ่ม:ยกเลิกพัฒนา]";
  else if (callbackData === "kiki:reset:yes") text = "[ปุ่ม:ล้างบัญชี]";
  else if (callbackData === "kiki:reset:no") text = "[ปุ่ม:ไม่ล้าง]";
  // ปุ่มจากใบแจ้ง "เซสชันหมดอายุ" — เคยส่งปุ่มออกไปโดยไม่มีตัวรับ กดแล้วเงียบสนิท (เจ้าของเจอเอง 6 ส.ค. 2026)
  else if (callbackData === "auth-skip") text = "[ปุ่ม:auth-skip]";
  else if (/^auth:[a-z0-9_-]+$/i.test(callbackData)) text = `[ปุ่ม:${callbackData}]`;
  else if (callbackData === "auth-stop") text = "[ปุ่ม:หยุดล็อกอิน]";
  // ปุ่มโซเชียล: กดส่งจริง / ทิ้งร่าง
  if (callbackData === "kiki:social:send" || callbackData === "kiki:social:no") {
    const box = await getPendingFor<{ url: string; text: string; what: string }>("kiki_pending_social", channel);
    // ร่างโพสต์ค้างคนละช่องทาง = ไม่กดส่งให้ (โพสต์ในนามเจ้าของ ลบทีหลังก็มีคนเห็นไปแล้ว)
    if (box && !box.sameChannel) {
      // canned-ok: เหตุผลเดียวกัน — ห้ามให้ถ้อยคำกลายเป็นการเคลมว่าโพสต์ไปแล้ว
      return ok([{ kind: "text", text: pendingElsewhereNote(`ร่าง${box.data.what}`, box.channel) }]);
    }
    const pend = box?.data ?? null;
    await setPendingFor("kiki_pending_social", channel, null);
    if (!pend) return ok([{ kind: "text", text: await vexLine("ไม่มีร่างที่ค้างอยู่แล้วครับ") }]);
    const { sendDraft, discardDraft } = await import("@/lib/kiki-chrome");
    if (callbackData === "kiki:social:no") {
      await discardDraft(pend.url).catch(() => {});
      return ok([{ kind: "text", text: await vexLine("ทิ้งร่างแล้วครับ ไม่ได้ส่ง ✅ (ปิดแท็บให้แล้ว)") }]);
    }
    const r = await sendDraft(pend.url).catch((e) => ({ ok: false, msg: e instanceof Error ? e.message.slice(0, 150) : "ส่งไม่สำเร็จ", shotBase64: undefined }));
    const outs: Send[] = [];
    if (r.shotBase64) outs.push({ kind: "photo", dataBase64: r.shotBase64, filename: "sent.png", caption: "หลังกดส่ง" });
    outs.push({ kind: "text", text: r.ok ? `ส่งแล้วครับ ✅ (${r.msg})\n\nดูภาพหลังส่งด้านบนได้เลย ถ้าไม่ขึ้นตามที่ควรบอกผมได้` : `ส่งไม่สำเร็จครับ ⚠️ ${r.msg}` });
    return ok(outs);
  }

  // ปุ่ม "หยุดงานนี้" ในรายงานความคืบหน้าทุก 3 นาที
  if (callbackData.startsWith("kiki:job:cancel:")) {
    const { cancelJob } = await import("@/lib/kiki-hermes");
    const r = await cancelJob(callbackData.slice("kiki:job:cancel:".length));
    return ok([{ kind: "text", text: r.ok ? `${r.msg} ✅` : `${r.msg} ⚠️` }]);
  }
  if (!chatId || (!text && !imageFiles.length && !audioFiles.length && !docFiles.length && !videoFiles.length)) return ok([]);

  // ===== เสียง → ข้อความ (เจ้าของอัดเสียงสั่งแทนการพิมพ์ได้ทุกอย่าง) =====
  let voiceNote = "";
  if (audioFiles.length) {
    const transcripts: string[] = [];
    for (const a of audioFiles.slice(0, 3)) {
      try {
        transcripts.push(await transcribeAudio(a.path, a.mime || "audio/ogg"));
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        return ok([{ kind: "text", text: await vexLine(`ฟังเสียงไม่ออกครับ ⚠️ (${why.slice(0, 120)})\nพิมพ์มาแทนก่อนได้ไหมครับ`) }]);
      }
    }
    const spoken = transcripts.join("\n").trim();
    if (spoken) {
      voiceNote = spoken;
      text = [text, spoken].filter(Boolean).join("\n").trim();
    }
  }

  // ===== กลุ่มเทรนเนอร์ของอั๋น — โหมดแยก มาก่อน owner gate (อั๋นไม่ใช่ owner แต่ต้องคุยได้) =====
  // ล็อกไว้เฉพาะ Telegram: กลุ่มนี้เป็นกลุ่ม Telegram เท่านั้น ถ้าไม่กันไว้ ช่องทางอื่นที่บังเอิญมี
  // chatId ตรงกัน จะหลุดเข้าโหมดอั๋น = ข้อมูล scope aun รั่ว (privacy สองทางที่ตั้งใจกันไว้แต่แรก)
  if (platform === "telegram") {
    const { getAunChatId, handleTrainerChat, AUN_USER_KEY } = await import("@/lib/kiki-aun");
    const aunChat = await getAunChatId();
    if (aunChat && chatId === aunChat && (text || audioFiles.length || imageFiles.length)) {
      const isOwner = await isOwnerAccount(platform, fromId);
      // จำ Telegram id ของอั๋นจากคนแรกที่ไม่ใช่เจ้าของ (ไว้กันคนนอกถ้าโดนดึงเข้ากลุ่ม)
      const aunId = await getSetting(AUN_USER_KEY);
      if (!isOwner && !aunId && fromId) await setSetting(AUN_USER_KEY, fromId);
      else if (!isOwner && aunId && fromId !== aunId) return ok([]); // คนที่สามในกลุ่ม = เงียบ
      // เตือนประจำของอั๋น (ใช้ระบบ Recurring เดิม ผูกกับ chatId กลุ่มนี้ — cron ส่งเข้ากลุ่มนี้เอง)
      if (RECUR_RE.test(text) && !imageFiles.length) {
        const t = await handleRecurring(text, chatId);
        const { saveKikiChat: saveAun } = await import("@/lib/kiki");
        await saveAun("assistant", t, "aun");
        return ok([{ kind: "text", text: t, replyTo: msgId }]);
      }
      const r = await handleTrainerChat(text, fromName, isOwner, imageFiles);
      // ซอยบับเบิล + sanitize เหมือนโหมดหลัก · การ์ดแคลส่งก่อนคำพูดเสมอ (อั๋นเห็นตัวเลขก่อน)
      const sends: Send[] = [];
      if (r.photo) sends.push({ kind: "photo", dataBase64: r.photo.dataBase64, filename: r.photo.filename, caption: r.photo.caption, replyTo: msgId });
      sends.push({ kind: "text", text: r.text, ...(r.photo ? {} : { replyTo: msgId }) });
      if (r.doc) sends.push({ kind: "document", dataBase64: r.doc.dataBase64, filename: r.doc.filename });
      return ok(sends.flatMap((s) => {
        if (s.kind !== "text" || !s.text) return [s];
        return s.text.split(/\n{2,}/).map((p, i) => ({ kind: "text" as const, text: p.trim(), ...(i === 0 ? { replyTo: s.replyTo } : {}) })).filter((x) => x.text);
      }));
    }
  }

  // ===== ประตูเจ้าของ (เฟส 0.5 — 4 ส.ค. 2026) =====
  // เดิม: "คนแรกที่ทัก = เจ้าของถาวร" ซึ่งพังทันทีที่มีช่องทางที่สอง (id คนละระบบ = ถูกตั้ง owner ทับ)
  // ใหม่: เช็คผ่านตัวตนที่ผูกได้หลายบัญชี · ช่องทางใหม่ไม่มีทางกลายเป็นเจ้าของเองโดยอัตโนมัติ
  const accounts = await ownerAccounts();
  let isOwner = await isOwnerAccount(platform, fromId);
  let justBound = false;

  // ระบบยังไม่เคยมีเจ้าของเลย (เครื่องใหม่/DB ใหม่) → ผูกให้ได้เฉพาะทาง Telegram ซึ่งเป็นช่องทางตั้งต้น
  // ป้องกันไม่ให้ Discord (หรือช่องทางไหนก็ตามที่เพิ่มทีหลัง) ตั้งตัวเองเป็นเจ้าของได้
  if (!accounts.length && fromId && platform === "telegram") {
    await linkOwnerAccount(platform, fromId);
    isOwner = true;
    justBound = true;
  }

  if (!isOwner) {
    // ช่องทางที่ยังไม่ผูก: ตอบได้อย่างเดียวคือผลของการกรอกรหัสผูกบัญชี ห้ามรั่วอย่างอื่นออกไปเด็ดขาด
    const pending = await peekLinkCode();
    if (pending && pending.platform === platform && /^\s*\d{4}\s*$/.test(text)) {
      const r = await redeemLinkCode(platform, fromId, text);
      if (r.ok) {
        // เก็บเฉพาะแชท Telegram — cron ใช้ตัวแรกในรายการนี้เป็นปลายทางแจ้งเตือน
  // ถ้าเอา channel id ของ Discord ไปปน งานเชิงรุกจะยิงผิดที่ (ชั้นเลือกปลายทางจริงอยู่ในเฟส 2)
  if (platform === "telegram") await addKikiChatId(chatId);
        await saveKikiChat("assistant", `[ผูกบัญชี ${platform} สำเร็จ]`, "owner", channel);
        return ok([{ kind: "text", text: await vexLine("ผูกบัญชีเรียบร้อยแล้วครับโด้ ต่อจากนี้คุยกับผมทางนี้ได้เหมือนเดิมทุกอย่าง") }]);
      }
      return ok([{ kind: "text", text: "รหัสไม่ถูกต้องครับ" }]); // canned-ok: คนนอกอาจกำลังเดารหัส ห้ามให้ AI แต่งจนหลุดบริบทหรือใบ้ต่อ
    }
    return ok([]); // ไม่ใช่เจ้าของ = เงียบสนิท เหมือนเดิม
  }

  // ===== เจ้าของสั่งผูกช่องทางใหม่ (ออกรหัสจากช่องทางที่เป็นเจ้าของอยู่แล้วเท่านั้น) =====
  const linkM = text.match(/^\s*(?:ผูก|เชื่อม|เพิ่ม)\s*(discord|ดิสคอร์ด|ดิส)\b/i);
  if (linkM) {
    const c = await issueLinkCode("discord");
    return ok([
      {
        kind: "text",
        // canned-ok: รหัสกับขั้นตอนต้องตรงตัวเป๊ะ ห้ามให้ AI เรียบเรียงจนเลขหรือลำดับเพี้ยน
        text: `รหัสผูก Discord: ${c.code}\n\nพิมพ์เลข 4 หลักนี้ในห้องที่ Vex อยู่ภายใน 10 นาที แล้วบัญชีนั้นจะกลายเป็นบัญชีของโด้เอง`,
        replyTo: msgId,
      },
    ]);
  }

  // เก็บเฉพาะแชท Telegram — cron ใช้ตัวแรกในรายการนี้เป็นปลายทางแจ้งเตือน
  // ถ้าเอา channel id ของ Discord ไปปน งานเชิงรุกจะยิงผิดที่ (ชั้นเลือกปลายทางจริงอยู่ในเฟส 2)
  if (platform === "telegram") await addKikiChatId(chatId);
  // จำชื่อกลุ่ม (ไว้ resolve "ไปแจ้งในกลุ่ม X" ว่าหมายถึงแชทไหน)
  const chatTitleIn = String(body.chatTitle || "").trim();
  if (chatTitleIn) {
    try {
      const titles = JSON.parse((await getSetting("kiki_chat_titles")) || "{}") as Record<string, string>;
      if (titles[chatId] !== chatTitleIn) {
        titles[chatId] = chatTitleIn;
        await setSetting("kiki_chat_titles", JSON.stringify(titles));
      }
    } catch { /* map พังก็สร้างใหม่รอบหน้า */ }
  }

  const userMsgId = await saveKikiChat("user", text || `[ส่งรูปมา ${imageFiles.length} รูป]`, "owner", channel);

  // ชั้นบทเรียนเชิงลบ (จิตใจเฟส 1 — 6 ส.ค. 2026): อ่านคู่สนทนาล่าสุดเบื้องหลัง
  // จับคำตำหนิ/สัญญาณไม่พอใจแบบไม่ชัด + อารมณ์เจ้าของ — fire-and-forget ห้ามถ่วงการตอบ
  if (text) {
    void import("@/lib/kiki-lessons").then((m) => m.detectAndRecord(text, userMsgId, channel)).catch(() => {});
  }

  // ซอยข้อความยาวเป็นหลายบับเบิล (เจ้าของสั่ง 31 ก.ค.): ย่อหน้าละข้อความ · <copy>...</copy> = กล่องแตะก็อปก้อนเดียว
  const explodeTextSend = (s: Send): Send[] => {
    if (s.kind !== "text" || !s.text || s.parseMode) return [s];
    const out: Send[] = [];
    const segs = s.text.split(/<copy>([\s\S]*?)<\/copy>/g);
    segs.forEach((seg, i) => {
      if (i % 2 === 1) {
        const c = seg.trim();
        if (c) out.push({ kind: "text", parseMode: "HTML", text: `<pre>${escHtml(c)}</pre>` });
      } else {
        // 4 ส.ค. 2026: เลิกซอย "บรรทัดละบับเบิล" (เจ้าของด่าว่ากระจัดกระจาย อ่านไม่รู้เรื่อง)
        // แยกตามย่อหน้าจริงเท่านั้น — ลิสต์/ตาราง/ย่อหน้ายาวอยู่ก้อนเดียวกันหมด
        for (const para of seg.split(/\n{2,}/)) {
          const p = para.trim();
          if (p) out.push({ kind: "text", text: p });
        }
      }
    });
    if (!out.length) return [s];
    if (out.length > 3) {
      // เกิน 3 ก้อน = รวมส่วนที่เหลือเป็นก้อนเดียว (คุมให้แชทเป็นระเบียบ)
      const tail = out.splice(2);
      out.push({ kind: "text", text: tail.map((t) => t.text).join("\n\n"), parseMode: tail.some((t) => t.parseMode) ? "HTML" : undefined });
    }
    // ===== ก้อนที่ยาวเกินเพดาน Telegram ต้อง "ซอย" ไม่ใช่ "ตัดทิ้ง" (6 ส.ค. 2026) =====
    // เจ้าของเจอเอง: คำตอบยาว ๆ จบกลางประโยค ("1. **ล็อกอิน Telegram ของโด้ใ")
    // เพราะตัวจัดการทำ .slice(0, 3900) แล้วส่วนที่เหลือหายไปเงียบ ๆ ไม่มีใครรู้ว่าตกอะไรไป
    // กฎ 3 บับเบิลยอมให้เกินได้ตรงนี้ — ข้อมูลหายแย่กว่าบับเบิลเยอะ
    const LIMIT = 3800;
    //
    // **ห้าม return ตรงนี้** — ผลต้องไหลต่อไปที่ `cleaned` ข้างล่าง ซึ่งเป็นที่ที่
    // ใส่ปุ่ม · แปลง markdown เป็น HTML · ผูก chatId/replyTo
    // (6 ส.ค. 2026: ตอนแก้เรื่องข้อความถูกตัด เผลอใส่ return ตรงนี้ แล้ว **ปุ่มหายทั้งระบบ**
    //  เจ้าของสั่งล้างบัญชีแล้ววนอยู่ 3 รอบเพราะไม่มีปุ่มให้กด)
    const split = out.flatMap((b) => {
      if (!b.text || b.text.length <= LIMIT) return [b];
      const chunks: string[] = [];
      let buf = "";
      for (const line of b.text.split("\n")) {
        // บรรทัดเดียวยาวเกินเพดาน (ตารางยาว/ลิงก์ยาว) — จำใจตัดตรงกลาง แต่ไม่ทิ้ง
        if (line.length > LIMIT) {
          if (buf) { chunks.push(buf); buf = ""; }
          for (let i = 0; i < line.length; i += LIMIT) chunks.push(line.slice(i, i + LIMIT));
          continue;
        }
        if (buf.length + line.length + 1 > LIMIT) { chunks.push(buf); buf = line; }
        else buf = buf ? `${buf}\n${line}` : line;
      }
      if (buf) chunks.push(buf);
      return chunks.map((text) => ({ ...b, text }));
    });
    const cleaned = split
      .filter((x) => x.parseMode || (x.text || "").trim())
      .map((x) => {
        // ตาข่ายมืออาชีพ: markdown ที่ AI เผลอเขียน (** ## ---) ต้องไม่หลุดถึงแชทดิบ ๆ
        if (x.parseMode || !x.text) return x;
        const clean = sanitizeVexText(x.text);
        return { ...x, text: clean.text, parseMode: clean.parseMode };
      })
      .map((x, i) => ({ ...x, chatId: s.chatId, ...(i === 0 ? { replyTo: s.replyTo } : {}) }));
    // ปุ่มติดบับเบิลสุดท้าย (ข้อความยืนยันมักจบท้ายก้อน)
    if (s.buttons && cleaned.length) cleaned[cleaned.length - 1] = { ...cleaned[cleaned.length - 1], buttons: s.buttons };
    return cleaned;
  };

  // งานที่ผูกเงื่อนไข ("ถ้าถึง BNI แล้วเตือนผมด้วย") — เติมท้ายคำตอบเส้นทางไหนก็ได้
  let triggerNote = "";

  // หลักฐานที่ระบบทำได้จริงรอบนี้ — ใช้ตอนตรวจว่าเคลมเกินไหม
  let evidence = "";

  /**
   * ทำต่อส่วนของคำสั่งที่ตัวจัดการตัวแรกไม่ได้แตะ (6 ส.ค. 2026)
   *
   * รากของอาการ "สั่ง 3 อย่างได้คำตอบเรื่องเดียว": ทะเบียนเดินจากบนลงล่าง
   * ตัวไหนรับก่อนก็จบทันที ที่เหลือหายเงียบโดยไม่มีใครรู้
   * ตรงนี้คือรอบตามเก็บ — ใช้ลูปเครื่องมือไปหาคำตอบของส่วนที่ตกไป แล้วต่อท้าย
   *
   * รอบเดียวเท่านั้น และไม่เรียกทะเบียนซ้ำ (กันวนไม่จบและกันทำงานซ้ำสองรอบ)
   */
  let inFollowUp = false; // กันวนซ้อน — รอบตามเก็บต้องไม่ถูกตรวจ/ตามเก็บอีก
  let ctxRef: Ctx | null = null; // ชี้ไปที่ Ctx จริง (สร้างทีหลัง) ให้รอบตามเก็บยืมของไปใช้

  const runFollowUp = async (missing: string[]): Promise<string> => {
    if (!missing.length || inFollowUp) return "";
    inFollowUp = true;
    try {
      // เอาส่วนที่ตกไป "เดินทะเบียนใหม่" — ไม่ใช่แค่ไปหาข้อมูลมาเล่า
      //
      // เหตุผล: กฎ "คำสั่งหลายเรื่อง = ไปทาง chat" ทำให้คำสั่งที่ต้องลงมือจริง
      // (จดงาน · ลงนัด · บันทึกเงิน) เลี่ยงตัวจัดการที่ทำได้จริงไปหมด
      // เคสจริง 6 ส.ค.: "จดไว้ว่าต้องโทรหาช่างแอร์ แล้วบอกด้วยว่าวันนี้มีนัดอะไร"
      // → ตอบเรื่องนัดให้ แต่งานไม่เคยลงกระดาน แล้วบอกตรง ๆ ว่ายังไม่ได้จด
      // → รอบตามเก็บจึงต้องเข้าถึงความสามารถชุดเดียวกับเส้นทางปกติ
      const subText = missing.join(" และ ");
      const subRoute = await routeIntent({
        text: subText,
        replyText: "",
        convo: await kikiConversation(6).catch(() => ""),
        hasImages: false,
        hasDocs: false,
        replyIsScreenshot: false,
      }).catch(() => null);

      const captured: string[] = [];
      if (subRoute) {
        const subCtx: Ctx = {
          ...ctxRef!,
          text: subText,
          route: subRoute,
          is: (id: string) => subRoute.intent === id && subRoute.confidence >= 0.45,
          arg: (k: string) => {
            const v = subRoute.args?.[k];
            return typeof v === "string" && v.trim() ? v.trim() : "";
          },
          // ตัวจัดการย่อยห้ามส่งของออกเอง — เก็บข้อความไว้ให้ตัวหลักต่อท้าย
          reply: async (ss: Send[]) => {
            for (const s of ss) if (s.kind === "text" && s.text && !s.chatId) captured.push(s.text);
            return ok([]);
          },
          setTriggerNote: () => {},
          setEvidence: () => {},
        };
        for (const handler of HANDLERS) {
          // ข้ามตัวคุยปกติ — ถ้าตกมาถึงมัน แปลว่าไม่มีใครทำได้จริง ค่อยให้สมองตอบข้างล่าง
          if (handler === HANDLERS[HANDLERS.length - 1]) break;
          const res = await handler(subCtx).catch(() => null);
          if (res) break;
        }
      }
      if (captured.length) return captured.join("\n\n");

      // ไม่มีตัวจัดการไหนรับ = เป็นคำถามธรรมดา ตอบด้วยสมอง + เครื่องมือ
      const { gatherFacts } = await import("@/lib/kiki-agent");
      const g = await gatherFacts(`เจ้าของสั่งมาว่า: """${text.slice(0, 1500)}"""\nส่วนที่ยังไม่ได้ตอบคือ: ${subText}`, "", { allowActions: true }).catch(() => null);
      const { askKiki } = await import("@/lib/kiki");
      return await askKiki(
        `[ตามเก็บส่วนที่ยังไม่ได้ตอบ] เจ้าของสั่ง: """${text.slice(0, 1500)}"""\n` +
          `ส่วนที่คำตอบก่อนหน้ายังไม่ได้แตะ: ${subText}\n` +
          (g?.notes ? `\nข้อเท็จจริงที่เพิ่งไปหามาให้:\n${g.notes}\n` : "") +
          `\nตอบ "เฉพาะส่วนที่ตกไป" อย่างเดียว ห้ามทวนของที่ตอบไปแล้ว\n` +
          `ตอบไม่ได้จริงเพราะไม่มีข้อมูล ให้บอกตรง ๆ ว่าติดตรงไหน ห้ามเดา`,
      ).catch(() => "");
    } finally {
      inFollowUp = false;
    }
  };

  let sentCount = 0;
  const reply = async (sendsIn: Send[]) => {
    // ===== ด่านตรวจก่อนส่ง (6 ส.ค. 2026) =====
    //
    // ตัวเต็มที่เจ้าของใช้เทียบ: ร่าง → ตรวจ → แก้ → ส่ง · ของเดิม: เขียน → ส่ง
    // ตรวจแค่ 2 อย่าง "ตอบครบไหม" กับ "เคลมเกินหลักฐานไหม" ไม่แตะสำนวน
    // ล้มเหลว/ช้า = ปล่อยของเดิมผ่าน ห้ามทำให้คำตอบหาย
    //
    // ข้ามเมื่อ: เป็นการ์ด/ลิสต์ที่จัดรูปแบบไว้แล้ว · ข้อความข้ามแชท · เจ้าของพูดมาเป็นเสียง (ต้องไว)
    let outSends = sendsIn;
    // ตรวจจาก "ข้อความรวมทุกก้อน" ไม่ใช่ก้อนแรกที่เจอ
    // เคยพลาด: ตัวจัดการที่ตอบเป็นการ์ด HTML ทำให้ด่านตรวจข้ามไปทั้งอัน
    // (เคสจริง: "จดไว้ว่าโทรหาช่างแอร์ แล้วบอกด้วยว่าวันนี้มีนัดอะไร" → ได้แต่การ์ดงาน เรื่องนัดหาย)
    const textSends = sendsIn.filter((s) => s.kind === "text" && s.text && !s.chatId);
    if (textSends.length && !inFollowUp && !voiceNote && text.trim().length >= 8) {
      try {
        const { reviewAnswer } = await import("@/lib/kiki-review");
        const draft = textSends.map((s) => s.text!).join("\n\n");
        const r = await reviewAnswer(text, draft, evidence);
        if (!r.ok) {
          const extra = r.missing.length ? await runFollowUp(r.missing).catch(() => "") : "";
          // แก้ถ้อยคำได้เฉพาะข้อความธรรมดา — การ์ด/ลิสต์ที่จัดรูปแบบไว้ห้ามแตะ (จะพัง HTML)
          const plainIdx = sendsIn.findIndex((s) => s.kind === "text" && s.text && !s.chatId && !s.parseMode);
          if (r.revised && plainIdx >= 0 && textSends.length === 1) {
            outSends = sendsIn.map((s, i) => (i === plainIdx ? { ...s, text: r.revised! } : s));
          }
          // ส่วนที่ตกไป ต่อเป็นก้อนใหม่เสมอ ไม่ยัดรวมกับการ์ด
          //
          // ต่อท้ายเฉพาะของที่ "เพิ่มขึ้นจริง" — กันสองอาการที่เจอตอนเทส 6 ส.ค.
          //  1. สั้นเกินไป = ตัวจัดการย่อยทำไม่ได้แล้วคืนประโยคเดียว ("จับคู่รายการไม่ได้เลยครับ")
          //     ไปต่อท้ายคำตอบที่ดีอยู่แล้ว กลายเป็นบรรทัดขยะ
          //  2. ซ้ำของเดิม = รอบตามเก็บวิ่งไปเจอตัวจัดการเดิม แล้วได้ลิสต์เดิมมาทั้งก้อน
          //     เจ้าของเห็นคำตอบเดียวกันสองรอบติดกัน
          const e = extra.trim();
          // เทียบแบบ "ถอดแท็กก่อน" — ของที่ต่อท้ายมักมีแท็ก <b>/<i> ส่วนต้นฉบับไม่มี (หรือกลับกัน)
          // ถ้าเทียบทั้งดุ้นจะไม่เจอว่าซ้ำ แล้วเจ้าของได้การ์ดเดิมซ้ำอีกรอบ คราวนี้แท็กโผล่ดิบ ๆ ด้วย
          const norm = (x: string) => x.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
          const nd = norm(draft);
          const ne = norm(e);
          const dup = ne.length >= 25 && (nd.includes(ne.slice(0, 60)) || ne.includes(nd.slice(0, 60)));
          if (ne.length >= 60 && !dup) outSends = [...outSends, { kind: "text" as const, text: e }];
        }
      } catch { /* ตรวจไม่ได้ = ส่งของเดิม */ }
    }
    const sendsFinal = outSends;

    for (const s of sendsFinal) if (s.kind === "text" && s.text) await saveKikiChat("assistant", s.text.replace(/<\/?copy>/g, ""), "owner", channel);
    const fullText = sendsFinal.filter((s) => s.kind === "text" && s.text).map((s) => s.text!).join("\n\n");
    const voiceAlways = (await getSetting("kiki_voice_always")) === "1";
    let voiceSend: Send | null = null;
    if ((voiceNote || voiceAlways) && fullText) {
      const ogg = await ttsOgg(fullText.replace(/<[^>]+>/g, " "));
      if (ogg) voiceSend = { kind: "voice", dataBase64: ogg.toString("base64"), filename: "vex.ogg" };
    }
    const withTrigger = triggerNote ? [...sendsFinal, { kind: "text" as const, text: triggerNote }] : sendsFinal;
    triggerNote = "";
    let sends = withTrigger.flatMap(explodeTextSend);
    // เจ้าของพูดมา = ตอบเสียง "อย่างเดียว" (ตัดข้อความออก คงการ์ด/ไฟล์/ข้อความข้ามกลุ่มไว้)
    // เจ้าของพูดมา = ตอบเสียงล้วน — แต่คงลิสต์/การ์ดที่จัดรูปแบบไว้ (parseMode) ไม่งั้นข้อมูลหาย
    if (voiceNote && voiceSend) sends = sends.filter((s) => s.kind !== "text" || s.chatId || s.parseMode);

    // ===== ตัดข้อความที่พูดเรื่องเดิมซ้ำ (6 ส.ค. 2026) =====
    //
    // เจ้าของเจอเอง: สอนกฎหนึ่งข้อ แล้วได้คำตอบ 3 บับเบิลที่พูดเรื่องเดียวกัน
    //   "รับทราบครับว่าต้องการให้เพิ่มอิโมจิ ✅ ทุกครั้ง... จะจดจำไว้เป็นนิสัยถาวร"
    //   "รับทราบครับโด้ ต่อไปเวลาแจ้งว่าจดงานเข้ากระดาน ผมจะปิดท้ายด้วย ✅ ทุกครั้ง"
    //   "ตรวจความจำแล้วด้วย กฎนี้ถูกบันทึกถาวรเรียบร้อย"
    //
    // ที่มาไม่ใช่โมเดลพูดเยอะ แต่เป็นระบบเอาหลายชั้นมาต่อกัน (ตัวจัดการ + รอบตามเก็บ + หมายเหตุ)
    //
    // **ลองนับความคล้ายของตัวอักษรก่อนแล้วใช้ไม่ได้** — วัดจริงกับ 3 บับเบิลที่เจ้าของเจอ
    // ได้ความคล้ายแค่ 16% / 3% / 2% ซึ่งแยกไม่ออกจากข้อความคนละเรื่อง (2-4%)
    // เพราะภาษาไทยพูดเรื่องเดียวกันด้วยคำคนละชุดได้สนิท → ต้องให้สมองตัดสินจากความหมาย
    if (sends.filter((x) => x.kind === "text" && x.text && !x.chatId && !x.parseMode).length > 1) {
      const { dropRepeats } = await import("@/lib/kiki-review");
      sends = await dropRepeats(sends);
    }

    // บังคับใช้กฎที่เจ้าของสอนกับข้อความขาออกทุกก้อน (รวมการ์ด/ลิสต์ที่ระบบสร้างเอง)
    // — เดิมกฎมีผลแค่กับข้อความที่สมองแต่ง เจ้าของเลยเจอ "ช่วงแรกทำ หลัง ๆ ไม่ทำ"
    try {
      const { applyStyleRules } = await import("@/lib/kiki");
      sends = await Promise.all(
        sends.map(async (s) =>
          s.kind === "text" && s.text
            ? { ...s, text: await applyStyleRules(s.text, { html: s.parseMode === "HTML" }) }
            : s,
        ),
      );
    } catch { /* ปรับไม่ได้ = ส่งของเดิม */ }

    if (voiceSend) sends.push(voiceSend);
    sentCount = sends.length;
    return ok(sends);
  };

  // ===== เตรียมบริบทให้ตัวจัดการทุกตัว =====
  try {
    // อ่านเจตนาด้วยสมอง (4 ส.ค. 2026) — regex เหลือเฉพาะที่ชัด 100%
    // เจ้าของสั่ง: "ไม่ต้องฟิกข้อมูลอะไรเลย ปล่อยให้อิสระ" → พูดธรรมชาติแบบไหนก็ต้องไปถูกที่
    const route = await routeIntent({
      text,
      replyText,
      convo: await kikiConversation(10).catch(() => ""),
      hasImages: imageFiles.length > 0,
      hasDocs: docFiles.length > 0,
      replyIsScreenshot,
    }).catch(() => ({ intent: "chat", confidence: 0, args: {} as Record<string, string | boolean | undefined> }));

    // งานที่ผูกเงื่อนไขไว้ — เจ้าของพูดถึงเมื่อไหร่ = ถึงเวลาเตือน
    try {
      const hits = await matchTriggers(text);
      if (hits.length) {
        await markNagged(hits.map((h) => h.id));
        triggerNote = `เตือนตามที่โด้สั่งไว้:\n${hits.map((h) => `· ${h.title}`).join("\n")}`;
      }
    } catch { /* ไม่มีงานเงื่อนไขก็ข้าม */ }

    const ctx: Ctx = {
      chatId, text, fromId, fromName, platform, channel, replyText,
      imageFiles, audioFiles, docFiles, videoFiles, msgId, userChatRowId: userMsgId, callbackData,
      voiceNote, justBound, replyIsScreenshot,
      route,
      is: (id: string) => route.intent === id && route.confidence >= 0.45,
      arg: (k: string) => {
        const v = route.args?.[k];
        return typeof v === "string" && v.trim() ? v.trim() : "";
      },
      urls: [...extractUrls(text), ...extractUrls(replyText)].slice(0, 3),
      reply,
      setTriggerNote: (note: string) => { triggerNote = note; },
      setEvidence: (e: string) => { evidence = e.slice(0, 4000); },
    };

    ctxRef = ctx;

    // เดินทะเบียน — ตัวไหนคืนคำตอบก่อนก็จบ ตัวสุดท้าย (คุยปกติ) รับทุกอย่างที่เหลือเสมอ
    // บันทึกทุกเทิร์นไว้ให้ Vex ไล่ย้อนหลังเองว่าเทิร์นไหนตอบไม่ตรง/พัง (เจ้าของสั่ง 6 ส.ค. 2026)
    const turnStart = Date.now();
    for (const handler of HANDLERS) {
      const res = await handler(ctx);
      if (res) {
        void import("@/lib/kiki-turnlog")
          .then((m) => m.logTurn({
            channel, text, intent: route.intent, confidence: route.confidence,
            handler: handler.name || null, ms: Date.now() - turnStart, sends: sentCount,
          }))
          .catch(() => {});
        return res;
      }
    }
    // ไม่ควรมาถึงตรงนี้ (chatFallback รับหมด) — แต่ถ้ามาถึงจริงต้องไม่เงียบ
    return reply([{ kind: "text", text: await vexLine("ผมยังไม่แน่ใจว่าโด้อยากให้ทำอะไรครับ บอกใหม่อีกทีได้ไหม") }]);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    void import("@/lib/kiki-turnlog")
      .then((m) => m.logTurn({ channel, text, intent: "error", confidence: 0, ms: 0, sends: 0, error: detail }))
      .catch(() => {});
    return ok([{ kind: "text", text: `สมองค้างแป๊บครับ ⚠️ (${detail.slice(0, 200)})\nลองพิมพ์ใหม่อีกทีนะครับ` }]); // canned-ok: ตัวดักพังชั้นสุดท้าย — ตอน LLM ล่มต้องยังตอบได้
  }
}
