import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { renderHtmlToPng } from "@/lib/html-pdf";
import { askClaude } from "@/lib/claude";
import { extractEvents, createEvent, getUpcoming, thaiDate } from "@/lib/calendar";
import { eventCardHtml, agendaCardHtml, weekCardHtml, editCalendar, weatherFor, evStart, type KikiEvent } from "@/lib/kiki-calendar";
import { handleWish, handleDebt, RECUR_RE, handleRecurring, handleFitnessLog, fitnessCoachContext, saveJournal } from "@/lib/kiki-life";
import { classifyPendingTxn, hasPendingTxn } from "@/lib/kiki-gmail";
import { MAC_RE, quickMac, macAgent } from "@/lib/kiki-mac";
import { userbotReady, findPeer, sendAsOwner, readChat, setPendingDm, getPendingDm, listDialogs, setAlias, getAliases, type PeerHit } from "@/lib/kiki-userbot";
import { extractUrls } from "@/lib/weblink";
import { routeIntent } from "@/lib/kiki-router";
import { addTask, tasksBlock, findTasks, completeTasks, matchTriggers, markNagged } from "@/lib/kiki-tasks";
import { recallContext, recentDaysContext } from "@/lib/kiki-memory";
import { vexList } from "@/lib/kiki-format";
import {
  askKiki,
  askExtractor,
  saveKikiChat,
  getKikiOwnerId,
  setSetting,
  KIKI_OWNER_KEY,
  addKikiChatId,
  rememberOwnerFact,
  forgetOwnerFacts,
  listOwnerFacts,
  retrievePersonalNotes,
  saveLinkToPersonal,
  writePersonalBinary,
  KIKI_GUARD,
  KIKI_PERSONA,
  ownerFactsContext,
  kikiConversation,
  transcribeAudio,
  findPersonalImages,
  VEX_RULE_CATEGORY,
  getSetting,
  ttsOgg,
  webResearch,
  isShoppingQuery,
  sanitizeVexText,
} from "@/lib/kiki";
import {
  extractFinance,
  recordTxns,
  deleteLastTxn,
  editFinance,
  setBudget,
  financeSnapshot,
  snapshotFacts,
  financeCardHtml,
  fmtBaht,
  TOTAL_BUDGET_KEY,
  EXPENSE_CATS,
  itemizedText,
  type ItemizedPeriod,
  type TxnRecord,
} from "@/lib/kiki-finance";

export const runtime = "nodejs";
export const maxDuration = 240;

// รูปแบบเดียวกับ ingest ของวาน — บอทฝั่ง kiki-bot.mjs เอาไปส่ง Telegram ต่อ
interface Send {
  kind: "text" | "document" | "photo" | "voice" | "video";
  text?: string;
  filename?: string;
  caption?: string;
  dataBase64?: string;
  parseMode?: "HTML" | "Markdown";
  noPreview?: boolean; // ไม่ให้ Telegram เด้ง link preview (ลิงก์ Google Calendar ฯลฯ)
  replyTo?: number; // reply ไปที่ข้อความไหน
  buttons?: { text: string; data: string }[][]; // ปุ่มกดยืนยัน (แทนการพิมพ์ "ยืนยัน")
  chatId?: string; // ส่งไปแชทอื่น (เช่น ทักในกลุ่มที่เพิ่งสร้าง) — ไม่ใส่ = แชทเดิม
}

const ok = (sends: Send[]) => NextResponse.json({ sends });

// การ์ดการเงิน → PNG (เรนเดอร์พลาด = ส่ง null ให้ fallback เป็นข้อความ)
async function financeCardPng(justAdded?: TxnRecord[]): Promise<{ png: string | null; snapFacts: string[] }> {
  const snap = await financeSnapshot();
  const facts = snapshotFacts(snap);
  try {
    // height เตี้ยกว่าเนื้อหาจริงเสมอ → fullPage ขยายเท่าเนื้อหาพอดี (ไม่เหลือพื้นว่างท้ายภาพ)
    const png = await renderHtmlToPng(financeCardHtml(snap, { justAdded }), { width: 720, height: 200 });
    return { png: png.toString("base64"), snapFacts: facts };
  } catch {
    return { png: null, snapFacts: facts };
  }
}

// ให้ Vex แต่งคำพูดจากข้อเท็จจริงจริง (คุมสั้น) — ล่มก็มี fallback ไม่เงียบ
async function vexSay(situation: string, facts: string[], fallback: string): Promise<string> {
  try {
    const reply = await askKiki(
      `[แต่งคำพูด] สถานการณ์: ${situation}\nข้อเท็จจริง (ห้ามแต่งตัวเลขเพิ่ม):\n${facts.map((f) => `- ${f}`).join("\n")}\n\nตอบเป็นข้อความที่จะส่งเข้าแชทเลย (สั้น อ่านง่าย เว้นบรรทัด ไม่เกิน 5 บรรทัด)`,
    );
    return reply.trim() || fallback;
  } catch {
    return fallback;
  }
}

function escHtml(x: string): string {
  return String(x).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

// แถวใน CalendarEvent → KikiEvent (ไว้ส่งเข้าการ์ดนัด)
function toKikiEvent(r: { id: string; date: Date; timeText: string | null; endTime: string | null; title: string; location: string | null; withWho: string | null; note: string | null; gcalEventId: string | null; done: boolean }): KikiEvent {
  return { id: r.id, date: r.date, timeText: r.timeText, endTime: r.endTime, title: r.title, location: r.location, withWho: r.withWho, note: r.note, gcalEventId: r.gcalEventId, done: r.done };
}

// "ใช้ได้อีกวันละ X ฿" สำหรับใส่ในการ์ดนัด (ไม่มีงบ = null)
async function budgetLineToday(): Promise<string | null> {
  try {
    const snap = await financeSnapshot();
    return snap.safePerDay !== null ? `ใช้ได้อีก ${fmtBaht(Math.floor(snap.safePerDay))} ฿` : null;
  } catch {
    return null;
  }
}

// เก็บสลิปลง vault ถาวร (คืน path แรกที่เก็บได้)
async function storeSlips(imageFiles: string[]): Promise<string | null> {
  let first: string | null = null;
  const ym = new Date().toISOString().slice(0, 7);
  for (const p of imageFiles) {
    try {
      const buf = fs.readFileSync(p);
      const saved = await writePersonalBinary(`finance/slips/${ym}/${Date.now()}-${path.basename(p)}`, buf);
      if (saved && !first) first = saved;
    } catch {
      /* เก็บไม่ได้ก็ข้าม — ข้อมูลรายการยังอยู่ใน DB */
    }
  }
  return first;
}

const FINANCE_VERB_RE =
  /จ่าย|ซื้อ|โอน(ไป|ให้)|เสียเงิน|เติมเงิน|ค่า[ก-๙]{2,}|ได้เงิน|เงินเข้า|เงินเดือน(ออก|เข้า)|รายรับ|รายจ่าย|เงินเสริม|ถูกหวย|ขายได้|หมดไป|บาท/i;

export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const chatId = String(body.chatId || "");
  let text = String(body.text || "").trim();
  const fromId = String(body.fromId || "");
  const fromName = String(body.fromName || "").trim();
  const replyText = String(body.replyText || "").trim();
  const imageFiles = (body.imageFiles as string[] | undefined) || [];
  const audioFiles = (body.audioFiles as { path: string; mime?: string }[] | undefined) || [];
  const docFiles = (body.docFiles as { path: string; name: string }[] | undefined) || [];
  const videoFiles = (body.videoFiles as { path: string; name: string }[] | undefined) || [];
  const msgId = body.msgId ? Number(body.msgId) : undefined;
  const callbackData = String(body.callbackData || "");
  // ปุ่มกด = คำสั่งยืนยันแบบพิมพ์ (แปลงเป็นข้อความเดิม logic ยืนยันทุกตัวใช้ต่อได้เลย)
  if (callbackData === "kiki:dm:yes") text = "ยืนยัน";
  else if (callbackData === "kiki:dm:no") text = "ยกเลิก";
  else if (callbackData === "kiki:grp:yes") text = "[ปุ่ม:สร้างกลุ่ม]";
  else if (callbackData === "kiki:grp:no") text = "[ปุ่ม:ยกเลิกกลุ่ม]";
  else if (callbackData === "kiki:dev:yes") text = "[ปุ่ม:พัฒนาเลย]";
  else if (callbackData === "kiki:dev:no") text = "[ปุ่ม:ยกเลิกพัฒนา]";
  // ปุ่มโซเชียล: กดส่งจริง / ทิ้งร่าง
  if (callbackData === "kiki:social:send" || callbackData === "kiki:social:no") {
    const raw = await getSetting("kiki_pending_social");
    const pend = raw ? (JSON.parse(raw) as { url: string; text: string; what: string }) : null;
    await setSetting("kiki_pending_social", "");
    if (!pend) return ok([{ kind: "text", text: "ไม่มีร่างที่ค้างอยู่แล้วครับ" }]);
    const { sendDraft, discardDraft } = await import("@/lib/kiki-chrome");
    if (callbackData === "kiki:social:no") {
      await discardDraft(pend.url).catch(() => {});
      return ok([{ kind: "text", text: "ทิ้งร่างแล้วครับ ไม่ได้ส่ง ✅ (ปิดแท็บให้แล้ว)" }]);
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
        return ok([{ kind: "text", text: `ฟังเสียงไม่ออกครับ ⚠️ (${why.slice(0, 120)})\nพิมพ์มาแทนก่อนได้ไหมครับ` }]);
      }
    }
    const spoken = transcripts.join("\n").trim();
    if (spoken) {
      voiceNote = spoken;
      text = [text, spoken].filter(Boolean).join("\n").trim();
    }
  }

  // ===== กลุ่มเทรนเนอร์ของอั๋น — โหมดแยก มาก่อน owner gate (อั๋นไม่ใช่ owner แต่ต้องคุยได้) =====
  {
    const { getAunChatId, handleTrainerChat, AUN_USER_KEY } = await import("@/lib/kiki-aun");
    const aunChat = await getAunChatId();
    if (aunChat && chatId === aunChat && (text || audioFiles.length || imageFiles.length)) {
      const ownId = await getKikiOwnerId();
      const isOwner = fromId === ownId;
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

  // ===== ผูกเจ้าของ: คนแรกที่คุยกับ Vex = เจ้าของถาวร · คนอื่นเงียบสนิท =====
  let ownerId = await getKikiOwnerId();
  let justBound = false;
  if (!ownerId && fromId) {
    await setSetting(KIKI_OWNER_KEY, fromId);
    ownerId = fromId;
    justBound = true;
  }
  if (ownerId && fromId && fromId !== ownerId) return ok([]);
  await addKikiChatId(chatId);
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

  await saveKikiChat("user", text || `[ส่งรูปมา ${imageFiles.length} รูป]`);

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
    const cleaned = out
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

  const reply = async (sendsIn: Send[]) => {
    for (const s of sendsIn) if (s.kind === "text" && s.text) await saveKikiChat("assistant", s.text.replace(/<\/?copy>/g, ""));
    const fullText = sendsIn.filter((s) => s.kind === "text" && s.text).map((s) => s.text!).join("\n\n");
    const voiceAlways = (await getSetting("kiki_voice_always")) === "1";
    let voiceSend: Send | null = null;
    if ((voiceNote || voiceAlways) && fullText) {
      const ogg = await ttsOgg(fullText.replace(/<[^>]+>/g, " "));
      if (ogg) voiceSend = { kind: "voice", dataBase64: ogg.toString("base64"), filename: "vex.ogg" };
    }
    const withTrigger = triggerNote ? [...sendsIn, { kind: "text" as const, text: triggerNote }] : sendsIn;
    triggerNote = "";
    let sends = withTrigger.flatMap(explodeTextSend);
    // เจ้าของพูดมา = ตอบเสียง "อย่างเดียว" (ตัดข้อความออก คงการ์ด/ไฟล์/ข้อความข้ามกลุ่มไว้)
    // เจ้าของพูดมา = ตอบเสียงล้วน — แต่คงลิสต์/การ์ดที่จัดรูปแบบไว้ (parseMode) ไม่งั้นข้อมูลหาย
    if (voiceNote && voiceSend) sends = sends.filter((s) => s.kind !== "text" || s.chatId || s.parseMode);
    if (voiceSend) sends.push(voiceSend);
    return ok(sends);
  };

  try {
    // ===== ทักครั้งแรก / แนะนำตัว =====
    if (justBound || /^\/(start|hi)\b/i.test(text) || /แนะนำตัว/.test(text)) {
      const t = await vexSay(
        `เพิ่งเข้าประจำการในแชทนี้${justBound ? ` (ผูกเจ้าของเรียบร้อย: ${fromName || "คนแรกที่ทัก"})` : ""} — แนะนำตัวสั้น ๆ ว่าเป็นเลขาส่วนตัว ดูแลได้ทั้งการเงิน (ส่งสลิปมาได้เลย) นัดหมาย เก็บลิงก์/ความรู้ และจำทุกอย่างที่เจ้าของบอก`,
        ["ชื่อ Vex", "ส่งสลิป+พิมพ์บอกว่าค่าอะไร = บันทึกให้ทันที", 'ตั้งงบ: "ตั้งงบเดือนละ 20000"', 'ให้จำอะไรพิมพ์ "จำไว้ว่า ..."'],
        `มาแล้วครับผม ⚡ ผม Vex เลขาส่วนตัว\n\nส่งสลิปมาได้เลย เดี๋ยวจดให้ · ลงนัดก็ได้ · ส่งลิงก์ให้เก็บก็ได้\nอยากให้จำอะไรพิมพ์ "จำไว้ว่า ..." ครับ`,
      );
      return reply([{ kind: "text", text: t, replyTo: msgId }]);
    }

    // ===== ไฟล์เอกสาร (pdf/docx/txt/md) → สรุปเก็บเข้าคลังความรู้ (เจ้าของสั่ง 3 ส.ค.) =====
    if (docFiles.length) {
      // เจ้าของสั่ง 4 ส.ค.: "เก็บเฉพาะที่ผมบอกให้เก็บ" → ไม่สั่ง = อ่านให้ ตอบให้ แต่ไม่เขียนลงคลัง
      const wantSave = /เก็บ|บันทึก|เซฟ|save|เข้าคลัง|ลงคลัง|จำไว้/i.test(text);
      const { readDocDeep } = await import("@/lib/kiki-read");
      const reads: { name: string; summary: string }[] = [];
      const saved: string[] = [];
      const fails: string[] = [];
      for (const d of docFiles) {
        try {
          if (wantSave) {
            const { saveDocToPersonal } = await import("@/lib/kiki");
            const r = await saveDocToPersonal(d.path, d.name, text || undefined);
            saved.push(r.title);
            reads.push({ name: d.name, summary: r.summary });
          } else {
            const r = await readDocDeep(d.path, d.name, text || undefined);
            reads.push({ name: d.name, summary: r.summary });
          }
        } catch (e) {
          fails.push(`${d.name}: ${e instanceof Error ? e.message.slice(0, 100) : "อ่านไม่ได้"}`);
        }
      }
      if (!reads.length) {
        return reply([{ kind: "text", text: `อ่านไฟล์ไม่ได้ครับ ⚠️ ${fails.join(" · ")}`, replyTo: msgId }]);
      }
      const answer = await askKiki(
        text || "(เจ้าของส่งไฟล์มาโดยไม่ได้พิมพ์อะไร)",
        [
          `=== เนื้อหาไฟล์ที่เพิ่งอ่านให้ (อ่านครบทั้งไฟล์แล้ว ใช้ตอบได้เลย) ===\n${reads.map((r) => `### ${r.name}\n${r.summary.slice(0, 12_000)}`).join("\n\n")}`,
          saved.length ? `[ระบบเก็บเข้าคลังความรู้ให้แล้ว: ${saved.join(" · ")} — ยืนยันสั้น ๆ ได้]` : "[ยังไม่ได้เก็บเข้าคลัง เพราะเจ้าของไม่ได้สั่ง — ถ้าเนื้อหาน่าเก็บ ให้เสนอสั้น ๆ ว่าสั่งเก็บได้]",
          fails.length ? `[ไฟล์ที่อ่านไม่ได้: ${fails.join(" · ")}]` : "",
          "[ตอบตามที่เจ้าของถาม ถ้าไม่ได้ถามอะไร ให้สรุปสาระสำคัญของไฟล์แบบใช้งานได้จริง]",
        ].filter(Boolean).join("\n\n"),
      );
      return reply([{ kind: "text", text: answer.slice(0, 3900), replyTo: msgId }]);
    }

    // ===== อ่านเจตนาด้วยสมอง (4 ส.ค. 2026) — regex เหลือเฉพาะที่ชัด 100% =====
    // เจ้าของสั่ง: "ไม่ต้องฟิกข้อมูลอะไรเลย ปล่อยให้อิสระ" → พูดธรรมชาติแบบไหนก็ต้องไปถูกที่
    const route = await routeIntent({
      text,
      replyText,
      convo: await kikiConversation(10).catch(() => ""),
      hasImages: imageFiles.length > 0,
      hasDocs: docFiles.length > 0,
    }).catch(() => ({ intent: "chat", confidence: 0, args: {} as Record<string, string | boolean | undefined> }));
    const is = (id: string) => route.intent === id && route.confidence >= 0.45;
    const arg = (k: string) => {
      const v = route.args?.[k];
      return typeof v === "string" && v.trim() ? v.trim() : "";
    };

    // งานที่ผูกเงื่อนไขไว้ — เจ้าของพูดถึงเมื่อไหร่ = ถึงเวลาเตือน
    try {
      const hits = await matchTriggers(text);
      if (hits.length) {
        await markNagged(hits.map((h) => h.id));
        triggerNote = `เตือนตามที่พี่สั่งไว้:\n${hits.map((h) => `· ${h.title}`).join("\n")}`;
      }
    } catch { /* ไม่มีงานเงื่อนไขก็ข้าม */ }

    // ===== กระดานงาน: จด / ดู / ปิด (เจ้าของสั่ง 4 ส.ค.) =====
    if (is("task_add")) {
      const title = arg("title") || text.replace(/^(ช่วย)?(จด|โน้ต|ลิสต์|บันทึก)(ไว้)?(ว่า|ให้)?\s*/i, "").slice(0, 200);
      const dueRaw = arg("due");
      const t = await addTask({
        title,
        detail: arg("detail") || undefined,
        kind: (["todo", "idea", "waiting"].includes(arg("kind")) ? arg("kind") : "todo") as "todo" | "idea" | "waiting",
        priority: (["low", "normal", "high"].includes(arg("priority")) ? arg("priority") : "normal") as "low" | "normal" | "high",
        dueDate: dueRaw && /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? new Date(`${dueRaw}T09:00:00+07:00`) : null,
        triggerText: arg("trigger") || null,
        source: text,
        chatId,
      });
      const bits = [
        t.kind === "idea" ? "เก็บไว้พัฒนา" : t.kind === "waiting" ? "รออยู่" : "ต้องทำ",
        t.priority === "high" ? "สำคัญ" : "",
        t.dueDate ? `กำหนด ${t.dueDate.toLocaleDateString("th-TH-u-ca-gregory", { day: "numeric", month: "short" })}` : "",
        t.triggerText ? `จะเตือนตอนพี่พูดถึง "${t.triggerText}"` : "จะตามเตือนจนกว่าจะปิด",
      ].filter(Boolean);
      const block = vexList({ title: "จดลงกระดานงานแล้ว", items: [{ main: t.title, sub: bits.join(" · ") }] });
      return reply([{ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId }]);
    }
    if (is("task_list")) {
      const block = await tasksBlock();
      return reply([{ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId }]);
    }
    if (is("task_done")) {
      const found = await findTasks(arg("ref") || text);
      if (!found.length) {
        const block = await tasksBlock({ title: "ไม่แน่ใจว่างานไหนครับ — งานที่ค้างอยู่" });
        return reply([{ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId }]);
      }
      const closed = await completeTasks(found.map((f) => f.id));
      const left = await tasksBlock({ title: "ที่เหลือในกระดาน" });
      return reply([
        { kind: "text", text: vexList({ title: `ปิดงานแล้ว ${closed.length} งาน`, items: closed.map((c) => c.title) }).text, parseMode: "HTML", replyTo: msgId },
        { kind: "text", text: left.text, parseMode: left.parseMode },
      ]);
    }

    // ===== ค้นความจำบทสนทนาเก่า ("จำได้ไหมที่คุยเรื่อง...") =====
    if (is("memory_recall")) {
      const q = arg("query") || text;
      const [hits, days] = await Promise.all([
        recallContext(q, { k: 8 }).catch(() => ""),
        recentDaysContext(4).catch(() => ""),
      ]);
      const answer = await askKiki(
        text,
        [
          hits || "(ค้นในคลังแชทแล้วไม่เจอเรื่องนี้)",
          days,
          "[โหมดนึกย้อน] ตอบจากบทสนทนาเก่าที่ค้นเจอเท่านั้น บอกด้วยว่าคุยกันวันไหน ถ้าไม่เจอจริง ๆ ให้บอกตรง ๆ ว่าหาไม่เจอ ห้ามเดา",
        ].filter(Boolean).join("\n\n"),
      );
      return reply([{ kind: "text", text: answer.slice(0, 3900), replyTo: msgId }]);
    }

    // ===== ที่ปรึกษาการเงิน (เจ้าของเล่ารายละเอียดเงินมา → วิเคราะห์โหด + ลงงานให้) =====
    if (is("finance_advice")) {
      const { financeAdvice } = await import("@/lib/kiki-advice");
      const r = await financeAdvice([replyText, text].filter(Boolean).join("\n"), await kikiConversation(12).catch(() => ""));
      const sends: Send[] = [];
      const { png } = await financeCardPng();
      if (png) sends.push({ kind: "photo", dataBase64: png, filename: "finance.png" });
      sends.push({ kind: "text", text: r.plan.slice(0, 3500) || "วิเคราะห์ไม่ออกครับ ขอตัวเลขเพิ่มอีกนิด", replyTo: msgId });
      if (r.actions.length) {
        const block = vexList({
          title: `ลงกระดานงานให้แล้ว ${r.actions.length} อย่าง`,
          items: r.actions.map((a) => ({ main: a.title, sub: [a.priority === "high" ? "สำคัญ" : "", a.due || ""].filter(Boolean).join(" · ") || undefined })),
          note: r.facts.length ? `จำข้อมูลการเงินเพิ่ม ${r.facts.length} เรื่องแล้ว` : undefined,
        });
        sends.push({ kind: "text", text: block.text, parseMode: block.parseMode });
      }
      return reply(sends);
    }

    // ===== โซเชียล: ตอบโพสต์ / โพสต์ใหม่ / เช็คสถานะ (เจ้าของเลือกทาง A — Chrome ตัวจริง) =====
    if (is("social_status")) {
      const { ensureChrome, socialLoginStatus, chromeCdpUrl } = await import("@/lib/kiki-chrome");
      const st = await ensureChrome();
      if (!st.ok) {
        return reply([{ kind: "text", text: `เปิด Chrome ของผมไม่ได้ครับ ⚠️ ${st.msg}\n\nสั่งเปิดเองได้ที่เครื่อง: npm run kiki:chrome`, replyTo: msgId }]);
      }
      const rows = await socialLoginStatus().catch(() => []);
      const block = vexList({
        title: "สถานะเบราว์เซอร์ของผม",
        items: [
          { main: `Chrome พร้อมใช้งาน${st.started ? " (เพิ่งเปิดให้)" : ""}`, sub: chromeCdpUrl() },
          ...rows.map((r) => ({ main: `${r.site} — ${r.loggedIn ? "ล็อกอินอยู่" : "ยังไม่ได้ล็อกอิน"}` })),
        ],
        note: rows.some((r) => !r.loggedIn)
          ? "อันที่ยังไม่ล็อกอิน: ล็อกอินในหน้าต่าง Chrome ที่ผมเปิดไว้ครั้งเดียวพอ แล้วผมใช้ได้ตลอด"
          : "ครบแล้วครับ ส่งลิงก์โพสต์มาได้เลย",
      });
      return reply([{ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId }]);
    }

    if (is("social_reply") || is("social_post")) {
      const { draftReply, platformOf } = await import("@/lib/kiki-chrome");
      const linkFromText = [...extractUrls(text), ...extractUrls(replyText)][0] || "";
      let target = linkFromText;
      if (!target && is("social_post")) target = "https://x.com/compose/post";
      if (!target) {
        return reply([{ kind: "text", text: "ส่งลิงก์โพสต์ที่จะให้ตอบมาด้วยครับ (หรือ reply ข้อความที่มีลิงก์นั้น) แล้วบอกว่าจะให้ตอบว่าอะไร", replyTo: msgId }]);
      }
      // ให้ Vex ร่างข้อความเอง (โทนเหมือนเจ้าของพิมพ์) — อ่านโพสต์ก่อนถ้าเป็นการตอบ
      let postCtx = "";
      if (is("social_reply")) {
        const { readAnyUrl } = await import("@/lib/kiki-read");
        const r = await readAnyUrl(target, { shot: false }).catch(() => null);
        if (r?.ok) postCtx = `เนื้อหาโพสต์ที่จะตอบ:\n${r.text.slice(0, 4000)}`;
        else if (r?.problem) postCtx = `(อ่านโพสต์ไม่ได้: ${r.problem})`;
      }
      const drafted = await askKiki(
        `[ร่างข้อความโซเชียล] เจ้าของสั่ง: """${text}"""\n${postCtx}\n\nเขียน "ข้อความที่จะโพสต์/ตอบจริง" ในนามเจ้าของ (โทนเหมือนเขาพิมพ์เอง ไม่ต้องแนะนำตัว ไม่ต้องมีคำนำ) ตอบเฉพาะตัวข้อความเท่านั้น`,
      ).catch(() => "");
      const message = sanitizeVexText(drafted).text.replace(/<[^>]+>/g, "").trim().slice(0, 900);
      if (!message) return reply([{ kind: "text", text: "ร่างข้อความไม่สำเร็จครับ ลองบอกใหม่ว่าจะให้ตอบแนวไหน", replyTo: msgId }]);

      const d = await draftReply(target, message).catch((e) => ({
        ok: false, url: target, platform: platformOf(target), typed: "", shotBase64: undefined,
        msg: e instanceof Error ? e.message.slice(0, 160) : "เปิดเบราว์เซอร์ไม่ได้",
      }));
      const sends: Send[] = [];
      if (d.shotBase64) sends.push({ kind: "photo", dataBase64: d.shotBase64, filename: "draft.png", caption: "หน้าจอจริงตอนนี้ (พิมพ์ค้างไว้ ยังไม่ส่ง)" });
      if (!d.ok) {
        sends.push({ kind: "text", text: `ยังส่งไม่ได้ครับ ⚠️ ${d.msg}\n\nข้อความที่ร่างไว้:\n${message}`, replyTo: msgId });
        return reply(sends);
      }
      await setSetting("kiki_pending_social", JSON.stringify({ url: d.url, text: message, what: is("social_post") ? "โพสต์ใหม่" : "ตอบโพสต์" }));
      sends.push({
        kind: "text",
        text: `พิมพ์ค้างไว้ในหน้าจริงแล้วครับ (${d.platform.toUpperCase()}) ยังไม่กดส่ง\n\nข้อความ:\n${message}\n\nกดยืนยันแล้วผมกดส่งให้เลย`,
        replyTo: msgId,
        buttons: [[{ text: "ส่งเลย", data: "kiki:social:send" }, { text: "ยกเลิก", data: "kiki:social:no" }]],
      });
      return reply(sends);
    }

    // ===== ฝาก Hermes — งานยาก/หลายขั้น/ใช้เวลานาน (agent GPT-5.5 + เว็บ/เบราว์เซอร์/terminal) =====
    // จับทั้งแบบระบุชื่อ ("ฝาก Hermes ...") และแบบธรรมชาติ ("ผมฝากไปสร้าง...", "ฝากไปทำ...หน่อย")
    // — เคยพลาด: เจ้าของพิมพ์ "ฝากไปสร้างพื้นที่..." ไม่เข้า pattern แล้ว Vex แต่งคำสั่ง "ฝาก Hermes" เองซึ่งไม่มีผล งานหายเงียบ
    const hermesM =
      text.match(/^\s*(?:ผม)?(?:ฝาก|ให้)\s*(?:เฮอ(?:ร์)?เ?มี?ส|hermes)\s*(?:ไป|ช่วย|ทำ|จัดการ)?\s*[:：]?\s*([\s\S]{5,})/i) ||
      (!/ฝากบอก|ฝากแคป|ฝากทัก/.test(text) ? text.match(/^\s*(?:ผม)?ฝาก(?:มัน|ไป)\s*(?:ไป)?((?:สร้าง|ทำ|จัด|หา|เช็ค|รวบรวม|เตรียม)[\s\S]{5,})/) : null);
    if (hermesM || is("hermes")) {
      const { kikiHermesReady, queueHermesJob } = await import("@/lib/kiki-hermes");
      if (!kikiHermesReady()) return reply([{ kind: "text", text: `Hermes ยังไม่พร้อมใช้ในเครื่องครับ ⚠️ (หา CLI ไม่เจอ)`, replyTo: msgId }]);
      const task = (hermesM?.[1] || text).trim();
      await queueHermesJob(chatId, task);
      return reply([{ kind: "text", text: `รับงานแล้วครับ 🎯 ส่งต่อให้ Hermes ทำเบื้องหลัง\n\nงาน: ${task.slice(0, 200)}\n\nใช้เวลาได้ถึง 15 นาที เสร็จเมื่อไหร่ผมเอาผลมาส่งเอง ระหว่างนี้สั่งงานอื่นได้ปกติ`, replyTo: msgId }]);
    }

    // ===== ลบรายการเงินล่าสุด (ทางลัด — เฉพาะพูดถึง "ล่าสุด/เมื่อกี้" ชัด ๆ) =====
    if (/(ลบ|ยกเลิก|เอาออก).{0,12}(อันเมื่อกี้|ล่าสุด|เมื่อกี้)|บันทึกผิด|ลงผิด/i.test(text)) {
      const last = await deleteLastTxn();
      if (!last) return reply([{ kind: "text", text: "ยังไม่มีรายการให้ลบเลยครับ 🎯", replyTo: msgId }]);
      const t = `ลบให้แล้วครับ ✅\n\n${last.type === "income" ? "รับ" : "จ่าย"} ${fmtBaht(last.amount)} ฿ · ${last.category}${last.note ? ` · ${last.note}` : ""}`;
      return reply([{ kind: "text", text: t, replyTo: msgId }]);
    }

    // ===== แก้บัญชีด้วยภาษาคน (ลบตัวซ้ำ/แก้ยอด/เปลี่ยนตัวเลข — Vex ลงมือเองจริง) =====
    if (is("finance_edit")) {
      const r = await editFinance([replyText, text].filter(Boolean).join("\n"));
      if (!r.applied.length) {
        return reply([{ kind: "text", text: `ยังไม่ได้แตะอะไรนะครับ ⚠️ ${r.reason || "ไม่แน่ใจว่าหมายถึงรายการไหน"}\n\nบอกชื่อรายการ+ยอดชัด ๆ ได้เลย เช่น "ลบรายการเงินเดือน 20,739.12 ที่ซ้ำ"`, replyTo: msgId }]);
      }
      const { png, snapFacts } = await financeCardPng();
      const t = await vexSay(
        `เพิ่งแก้บัญชีตามคำสั่งเจ้าของสำเร็จจริง ${r.applied.length} รายการ — ยืนยันสิ่งที่ทำ + ยอดล่าสุด สั้น ๆ`,
        [...r.applied.map((x) => `ทำแล้ว: ${x}`), ...snapFacts],
        `จัดการแล้วครับ ✅\n\n${r.applied.join("\n")}`,
      );
      const sends: Send[] = [];
      if (png) sends.push({ kind: "photo", dataBase64: png, filename: "finance.png" });
      sends.push({ kind: "text", text: t, replyTo: msgId });
      return reply(sends);
    }

    // ===== ตั้งงบ =====
    const budgetM = text.match(/ตั้งงบ\s*([ก-๙a-zA-Z/]*)\s*(?:เดือนละ|ต่อเดือน)?\s*([\d,]+(?:\.\d+)?)/);
    if (budgetM) {
      const rawCat = (budgetM[1] || "").trim();
      const amount = Number(budgetM[2].replace(/,/g, ""));
      if (amount > 0) {
        const cat = !rawCat || rawCat === "รวม" || rawCat === "เดือนละ"
          ? TOTAL_BUDGET_KEY
          : EXPENSE_CATS.find((c) => c.includes(rawCat) || rawCat.includes(c)) || rawCat;
        await setBudget(cat, amount);
        const { png, snapFacts } = await financeCardPng();
        const t = await vexSay(
          `เจ้าของเพิ่งตั้งงบ${cat === TOTAL_BUDGET_KEY ? "รวมทั้งเดือน" : `หมวด ${cat}`} = ${fmtBaht(amount)} บาท/เดือน — ยืนยัน + แซวได้นิดหน่อยว่าจะคุมให้อยู่`,
          snapFacts,
          `ตั้งงบ${cat === TOTAL_BUDGET_KEY ? "" : `หมวด ${cat} `}เดือนละ ${fmtBaht(amount)} ฿ แล้วครับ ✅\nเกินเมื่อไหร่ผมด่าแน่นอน`,
        );
        const sends: Send[] = [{ kind: "text", text: t, replyTo: msgId }];
        if (png) sends.push({ kind: "photo", dataBase64: png, filename: "finance.png" });
        return reply(sends);
      }
    }

    // ===== บัญชีตัวเอง (1.4) — โอนข้ามบัญชีตัวเองไม่นับเป็นรายจ่าย =====
    if (/บัญชีตัวเอง(มี)?อะไรบ้าง|ลิสต์บัญชีตัวเอง/.test(text)) {
      const { getOwnAccounts } = await import("@/lib/kiki-finance");
      const list = await getOwnAccounts();
      return reply([{ kind: "text", text: list.length ? `บัญชีตัวเองที่จำไว้: ${list.join(" · ")}` : `ยังไม่มีครับ — พิมพ์ "บัญชีตัวเอง: <ชื่อตามเมลธนาคาร>" เพื่อสอนผม`, replyTo: msgId }]);
    }
    // เพิ่มต้องมี ":" หรือ "คือ" ชัดเจน — กันประโยคคำถามโดนจับเป็นชื่อบัญชี (เคยพัง: "บัญชีตัวเองมีอะไรบ้าง")
    const ownAccM = text.match(/^\s*บัญชี(?:ตัวเอง|ผม|ของผม)\s*(?:[:：]|คือ)\s*(.{3,60})$/);
    if (ownAccM) {
      const { addOwnAccount } = await import("@/lib/kiki-finance");
      const list = await addOwnAccount(ownAccM[1].trim());
      return reply([{ kind: "text", text: `จำแล้วครับ ✅ โอนไปหา "${ownAccM[1].trim()}" = ย้ายเงินตัวเอง ไม่นับเป็นรายจ่าย\n\nบัญชีตัวเองทั้งหมด: ${list.join(" · ")}`, replyTo: msgId }]);
    }

    // ===== ยอดเงินในบัญชี + เส้นเงินสด 30 วัน (2.1) =====
    const balM = text.match(/(?:ยอด(?:เงิน)?ใน(?:บัญชี|แบงค์|ธนาคาร)|เงินในบัญชี)\s*(?:ตอนนี้|เหลือ)?\s*[:：]?\s*([\d,]+(?:\.\d+)?)/);
    if (balM) {
      const { setBalance, cashForecast30 } = await import("@/lib/kiki-finance");
      const amt = Number(balM[1].replace(/,/g, ""));
      await setBalance(amt);
      const fc = await cashForecast30().catch(() => null);
      return reply([{ kind: "text", text: `ตั้งยอดตั้งต้น ${fmtBaht(amt)} ฿ แล้วครับ ✅ ต่อจากนี้ผมคำนวณยอดคงเหลือจากรายการที่บันทึกให้เอง\n\n${fc ? fc.lines.join("\n") : ""}`.trim(), replyTo: msgId }]);
    }
    if (is("finance_forecast")) {
      const { cashForecast30 } = await import("@/lib/kiki-finance");
      const fc = await cashForecast30().catch(() => null);
      if (!fc) return reply([{ kind: "text", text: `ยังคำนวณไม่ได้ครับ — บอกยอดตั้งต้นก่อน เช่น "ยอดในบัญชีตอนนี้ 25,000" แล้วผมจะพยากรณ์ 30 วันข้างหน้าให้ (บิลประจำ+pace ใช้จริง)`, replyTo: msgId }]);
      return reply([{ kind: "text", text: fc.lines.join("\n"), replyTo: msgId }]);
    }

    // ===== บิลประจำ / subscription (1.2) =====
    if (is("bill")) {
      const { handleBillCommand } = await import("@/lib/kiki-finance");
      const t = await handleBillCommand([replyText, text].filter(Boolean).join("\n"));
      return reply([{ kind: "text", text: t, replyTo: msgId }]);
    }

    // ===== ร้านประจำ (1.1) — ดูรายการที่ระบบจำได้ =====
    if (/ร้านประจำ(มี)?อะไรบ้าง|ลิสต์ร้านประจำ|ร้านที่จำได้/.test(text)) {
      const { listMerchants } = await import("@/lib/kiki-finance");
      return reply([{ kind: "text", text: await listMerchants(), replyTo: msgId }]);
    }

    // ===== การ์ดสุขภาพการเงิน (4.1) =====
    if (is("finance_health")) {
      const { healthSnapshot, healthCardHtml, healthFacts } = await import("@/lib/kiki-finance");
      const h = await healthSnapshot();
      const sendsH: Send[] = [];
      try {
        const png = await renderHtmlToPng(healthCardHtml(h), { width: 720, height: 200 });
        sendsH.push({ kind: "photo", dataBase64: png.toString("base64"), filename: "health.png" });
      } catch { /* การ์ดพัง ส่งข้อความล้วน */ }
      const t = await vexSay(
        "เจ้าของขอดูสุขภาพการเงินภาพรวม — วิเคราะห์จากตัวเลขจริง: จุดแข็ง จุดเสี่ยง สิ่งที่ควรทำ (ตรงไปตรงมา ไม่ชมลอย ๆ)",
        healthFacts(h),
        healthFacts(h).join("\n"),
      );
      sendsH.push({ kind: "text", text: t, replyTo: msgId });
      return reply(sendsH);
    }

    // ===== ถามวิเคราะห์อิสระ (2.3) — text→query บน DB ตัวเลขไม่ผ่าน AI =====
    if (is("finance_analyze")) {
      const { analyzeFinance } = await import("@/lib/kiki-finance");
      const t = await analyzeFinance([replyText, text].filter(Boolean).join("\n"));
      return reply([{ kind: "text", text: t, replyTo: msgId }]);
    }

    // ===== "ซื้อ/ใช้อะไรไปบ้าง" — ลิสต์รายการรายตัว (ตัวเลขจาก DB ตรง ๆ) =====
    if (is("finance_itemize")) {
      const period: ItemizedPeriod = /เมื่อวาน/.test(text) ? "yesterday"
        : /สัปดาห์|อาทิตย์(นี้|ที่ผ่าน)/.test(text) ? "week"
        : /เดือนนี้|ทั้งเดือน/.test(text) ? "month"
        : "today";
      const t = await itemizedText(period);
      return reply([{ kind: "text", text: t, replyTo: msgId }]);
    }

    // ===== ถามสถานะการเงิน =====
    if (is("finance_query")) {
      const { png, snapFacts } = await financeCardPng();
      const t = await vexSay(
        "เจ้าของขอดูสถานะการเงิน — สรุปสั้น + ความเห็น/คำเตือน/คำชมตามตัวเลขจริง (กวนตีนได้)",
        snapFacts,
        `สรุปให้แล้วครับ ดูการ์ดด้านล่างเลย 📉`,
      );
      const sends: Send[] = [];
      if (png) sends.push({ kind: "photo", dataBase64: png, filename: "finance.png", caption: undefined });
      sends.push({ kind: "text", text: t, replyTo: msgId });
      return reply(sends);
    }

    // ===== โหมดตอบเสียงตลอด =====
    if (/ตอบเสียงตลอด|โหมดเสียง(?!.{0,6}(ปิด|ออก))|พูดตลอด|ตอบเป็นเสียงทุกครั้ง/.test(text) && !/ปิด|เลิก|หยุด|ไม่เอา/.test(text)) {
      await setSetting("kiki_voice_always", "1");
      const sends: Send[] = [{ kind: "text", text: `เปิดโหมดตอบเสียงตลอดแล้วครับ ✅ ทุกคำตอบจะมีเสียงแนบ
เบื่อเมื่อไหร่พิมพ์ "ปิดโหมดเสียง"`, replyTo: msgId }];
      const ogg = await ttsOgg("เปิดโหมดพูดตลอดแล้วครับผม ต่อไปนี้ผมพูดให้ฟังทุกคำตอบเลย");
      if (ogg) sends.push({ kind: "voice", dataBase64: ogg.toString("base64"), filename: "vex.ogg" });
      return reply(sends);
    }
    if (/(ปิด|เลิก|หยุด|ไม่เอา).{0,10}(โหมดเสียง|ตอบเสียง|พูดตลอด)|ตอบข้อความพอ/.test(text)) {
      await setSetting("kiki_voice_always", "");
      return reply([{ kind: "text", text: "ปิดโหมดตอบเสียงตลอดแล้วครับ ✅ จะพูดเฉพาะตอนพี่พูดมา หรือสั่ง \"ตอบเสียง\"", replyTo: msgId }]);
    }

    // ===== Telegram userbot: ยืนยัน/ยกเลิกการส่งที่ค้างอยู่ =====
    {
      const pending = await getPendingDm();
      if (pending && /^\s*(ยืนยัน|ส่งเลย|ส่งได้|โอเค\s*ส่ง|เอาเลย)/.test(text)) {
        await setPendingDm(null);
        try {
          await sendAsOwner(pending.peerId, pending.message);
          return reply([{ kind: "text", text: `ส่งหา ${pending.peerName} แล้วครับ 📤 (ในนามบัญชีพี่เอง)`, replyTo: msgId }]);
        } catch (e) {
          return reply([{ kind: "text", text: `ส่งไม่สำเร็จครับ ⚠️ (${e instanceof Error ? e.message.slice(0, 120) : "error"})`, replyTo: msgId }]);
        }
      }
      if (pending && /^\s*(ยกเลิก|ไม่ส่ง|ไม่เอา)/.test(text)) {
        await setPendingDm(null);
        return reply([{ kind: "text", text: "ยกเลิกแล้วครับ ✅ ไม่ส่ง", replyTo: msgId }]);
      }
    }

    // ===== พัฒนาตัวเอง: ยืนยัน/ยกเลิก =====
    {
      const { getPendingDev, setPendingDev, queueDevJob, devJobRunning } = await import("@/lib/kiki-dev");
      const pendingDev = await getPendingDev();
      if (pendingDev && text === "[ปุ่ม:ยกเลิกพัฒนา]") {
        await setPendingDev(null);
        return reply([{ kind: "text", text: "ยกเลิกแล้วครับ ✅ ไม่พัฒนา", replyTo: msgId }]);
      }
      if (pendingDev && text === "[ปุ่ม:พัฒนาเลย]") {
        await setPendingDev(null);
        if (await devJobRunning()) return reply([{ kind: "text", text: `มีงานพัฒนารันอยู่แล้วครับ ⚠️ รอตัวเดิมจบก่อน (สูงสุด 45 นาที) ค่อยสั่งตัวใหม่`, replyTo: msgId }]);
        await queueDevJob(chatId, pendingDev);
        return reply([{ kind: "text", text: `รับงานแล้วครับ 🎯 ส่งสเปกให้วิศวกร (Claude ตัวเดียวกับที่พี่ใช้) ลงมือแก้โค้ดผมแล้ว\n\nใช้เวลาได้ถึง 45 นาที เสร็จแล้วรายงานพร้อม commit — ช่วงท้ายผมจะรีสตาร์ทตัวเองแป๊บนึง ถ้าเงียบช่วงสั้น ๆ คือกำลังเกิดใหม่ครับ`, replyTo: msgId }]);
      }
    }

    // ===== พัฒนาตัวเอง: รับสเปก + ปุ่มยืนยัน =====
    // แบบชัด: "พัฒนา: <สเปก>" · แบบหลวม: "มึงพัฒนาเองได้ ทำเลย" (สเปกอยู่ในเรื่องที่เพิ่งคุย — เคสจริง 3 ส.ค.)
    const devM = text.match(/^\s*(?:พัฒนา(?:ตัวเอง|ระบบ)?|อัปเกรด(?:ตัวเอง|ระบบ)?|เพิ่ม(?:ความสามารถ|ฟีเจอร์)|สร้างระบบ|ทำระบบ|แก้บั๊ก)\s*[:：]?\s*([\s\S]{10,})/);
    const devLoose = !devM && /(พัฒนา|อัปเกรด).{0,16}(ตัวเอง|เอง)|เพิ่มความสามารถ(ตัวเอง)?|ทำเองได้.{0,10}ทำเลย/.test(text) && !text.startsWith("[ปุ่ม");
    if ((devM || devLoose || is("self_dev")) && !text.startsWith("[ปุ่ม")) {
      const { setPendingDev } = await import("@/lib/kiki-dev");
      let spec = devM?.[1]?.trim() || "";
      if (!spec) {
        // สกัดสเปกจากบทสนทนา: เจ้าของเพิ่งบ่น/อยากได้อะไร
        const convo = await kikiConversation(14);
        try {
          const rawS = await askExtractor(`${convo}\n\nข้อความล่าสุดของเจ้าของ: """${text}"""${replyText ? `\n(reply ถึง: """${replyText.slice(0, 500)}""")` : ""}`, {
            system: `เจ้าของสั่งให้ "พัฒนาตัวเอง" โดยไม่บอกสเปกตรง ๆ — สเปกคือความสามารถที่เจ้าของเพิ่งอยากได้/เพิ่งถูกปฏิเสธในบทสนทนา ตอบ JSON เท่านั้น: {"spec":"สเปกที่ต้องพัฒนา เขียนชัด ๆ 1-3 ประโยค","confident":true/false}
ไม่แน่ใจว่าเจ้าของหมายถึงอะไร = confident:false`,
            timeoutMs: 60_000,
          });
          const mS = rawS.match(/\{[\s\S]*\}/);
          const j = mS ? (JSON.parse(mS[0]) as { spec?: string; confident?: boolean }) : null;
          if (j?.confident && j.spec) spec = j.spec.trim();
        } catch { /* ถามกลับข้างล่าง */ }
        if (!spec) {
          return reply([{ kind: "text", text: `ได้ครับ ผมพัฒนาตัวเองได้จริง — แต่ขอสเปกชัด ๆ หน่อยว่าให้เพิ่มอะไร\n\nพิมพ์: พัฒนา: <สิ่งที่อยากได้>`, replyTo: msgId }]);
        }
      }
      await setPendingDev(spec);
      return reply([{
        kind: "text",
        text: `จะส่งสเปกนี้ให้วิศวกรแก้โค้ดผมจริง ๆ นะครับ:\n\n"${spec.slice(0, 500)}"\n\nกติกา: แตะได้เฉพาะโค้ดฝั่งผม (Vex) · tsc ต้องผ่าน · commit+push · เสร็จแล้วรีสตาร์ทตัวเอง+รายงาน\nถ้าของที่ได้ไม่ตรงใจ บอกพี่โด้ให้ย้อน commit ได้เสมอ`,
        replyTo: msgId,
        buttons: [[{ text: "✅ พัฒนาเลย", data: "kiki:dev:yes" }, { text: "❌ ยกเลิก", data: "kiki:dev:no" }]],
      }]);
    }

    // ===== สร้างกลุ่มใหม่: ยืนยัน/ยกเลิก (ปุ่มหรือพิมพ์) =====
    {
      const rawGrp = await getSetting("kiki_pending_group");
      const pendingGrp = rawGrp ? (JSON.parse(rawGrp) as { title: string }) : null;
      if (pendingGrp && text === "[ปุ่ม:ยกเลิกกลุ่ม]") {
        await setSetting("kiki_pending_group", "");
        return reply([{ kind: "text", text: "ยกเลิกแล้วครับ ✅ ไม่สร้างกลุ่ม", replyTo: msgId }]);
      }
      if (pendingGrp && (text === "[ปุ่ม:สร้างกลุ่ม]" || /^\s*(สร้างเลย|ลุยเลย|เอาเลย)\s*$/.test(text))) {
        await setSetting("kiki_pending_group", "");
        const { userbotReady: ubReady, createOwnerGroup } = await import("@/lib/kiki-userbot");
        if (!ubReady()) return reply([{ kind: "text", text: `บัญชี Telegram ยังไม่เชื่อมครับ ⚠️ รัน: npm run kiki:tg-auth ก่อน`, replyTo: msgId }]);
        try {
          const g = await createOwnerGroup(pendingGrp.title);
          await addKikiChatId(g.chatId);
          const sends: Send[] = [];
          if (g.botAdded) {
            // ทักในกลุ่มใหม่ + แท็กเจ้าของ (tg://user ใช้ได้แม้ไม่มี username)
            sends.push({
              kind: "text",
              chatId: g.chatId,
              parseMode: "HTML",
              text: `กลุ่ม "${escHtml(g.title)}" พร้อมใช้แล้วครับ <a href="tg://user?id=${fromId}">พี่</a> — ผมประจำการที่นี่แล้ว ใช้ได้ทุกความสามารถเหมือนกลุ่มหลักเลย 🎯`,
            });
          }
          sends.push({
            kind: "text",
            text: `สร้างกลุ่ม "${g.title}" เสร็จแล้วครับ ✅ พี่เป็นเจ้าของกลุ่ม${g.botAdded ? " ผมเข้าไปประจำการ+ทักไว้ในนั้นแล้ว" : " ⚠️ แต่ดึงผมเข้าไม่สำเร็จ — เชิญ @kiki_lekha_bot เข้ากลุ่มให้หน่อยครับ"}\n\nเปิดดูในลิสต์แชท Telegram ได้เลย`,
            replyTo: msgId,
          });
          return reply(sends);
        } catch (e) {
          return reply([{ kind: "text", text: `สร้างกลุ่มไม่สำเร็จครับ ⚠️ ${e instanceof Error ? e.message.slice(0, 150) : "error"}`, replyTo: msgId }]);
        }
      }
    }

    // ===== สร้างกลุ่มใหม่: รับคำสั่ง + ตั้งชื่อ + ปุ่มยืนยัน =====
    if (is("tg_create_group") && !text.startsWith("[ปุ่ม")) {
      const { userbotReady: ubReady } = await import("@/lib/kiki-userbot");
      if (!ubReady()) return reply([{ kind: "text", text: `สร้างกลุ่มต้องใช้บัญชี Telegram พี่ครับ ⚠️ รัน: npm run kiki:tg-auth ก่อน (ครั้งเดียว)`, replyTo: msgId }]);
      const nameM = text.match(/สร้างกลุ่ม.{0,8}(?:ชื่อ|ว่า)\s*["“']?([^"”'\n]{2,60})/);
      let title = nameM?.[1]?.trim() || "";
      if (!title) {
        // ไม่บอกชื่อ = ตั้งจากเรื่องที่คุยกันล่าสุด
        const convo = await kikiConversation(16);
        try {
          const rawT = await askExtractor(`${convo}\n\nคำสั่งเจ้าของ: """${text}"""`, {
            system: `ตั้งชื่อกลุ่ม Telegram จากโปรเจกต์/เรื่องที่เจ้าของกำลังคุย ตอบ JSON เท่านั้น: {"title":"ชื่อกลุ่ม สั้น อ่านรู้เรื่อง (ไทย/อังกฤษได้ ไม่ใส่อิโมจิ)"}`,
            timeoutMs: 60_000,
          });
          const mT = rawT.match(/\{[\s\S]*\}/);
          title = mT ? String((JSON.parse(mT[0]) as { title?: string }).title || "").trim() : "";
        } catch { /* ตกไปใช้ชื่อกลาง */ }
      }
      if (!title) title = `โปรเจกต์ใหม่ — โด้ x Vex`;
      await setSetting("kiki_pending_group", JSON.stringify({ title }));
      return reply([{
        kind: "text",
        text: `จะสร้างกลุ่ม "${title}" ผ่านบัญชีพี่ (พี่เป็นเจ้าของกลุ่มอัตโนมัติ) แล้วดึงผมเข้าไปประจำการครับ\n\nถ้าอยากได้ชื่ออื่น พิมพ์ "สร้างกลุ่มชื่อ ..." มาใหม่ได้เลย`,
        replyTo: msgId,
        buttons: [[{ text: "✅ สร้างเลย", data: "kiki:grp:yes" }, { text: "❌ ยกเลิก", data: "kiki:grp:no" }]],
      }]);
    }

    // ===== Telegram userbot: ลิสต์รายชื่อแชทในบัญชีเจ้าของ =====
    if (is("tg_list_chats")) {
      if (!userbotReady()) return reply([{ kind: "text", text: `ยังไม่ได้เชื่อมบัญชี Telegram ครับ ⚠️ รัน: npm run kiki:tg-auth`, replyTo: msgId }]);
      const kind = /ไม่เอากลุ่ม|เฉพาะคน|แค่คน|คนอย่างเดียว/.test(text) ? "user" : /เฉพาะกลุ่ม|เอาแต่กลุ่ม|แค่กลุ่ม/.test(text) ? "group" : "all";
      try {
        const rows = await listDialogs(kind, 40);
        if (!rows.length) return reply([{ kind: "text", text: "ไม่เจอแชทเลยครับ 🎯", replyTo: msgId }]);
        await setSetting("kiki_last_dialog_list", JSON.stringify(rows));
        const aliases = await getAliases();
        const lines = rows.map((r, i) => {
          const al = aliases.find((a) => a.peerId === r.id);
          return `${i + 1}. ${r.name}${r.username ? ` (@${r.username})` : ""}${r.isGroup ? " · กลุ่ม" : ""}${al ? ` — เรียกว่า "${al.alias}"` : ""}`;
        });
        return reply([
          { kind: "text", text: `แชทล่าสุดในบัญชีพี่ (${rows.length}${kind === "user" ? " · เฉพาะคน" : kind === "group" ? " · เฉพาะกลุ่ม" : ""}):\n\n${lines.join("\n")}`, replyTo: msgId },
          { kind: "text", text: `ตั้งชื่อเรียกเองได้เลยครับ เช่น "แชท 3 คืออั๋น แฟนผม" หรือ "แชท <ชื่อ> คือพี่ภูมิ" — ต่อไปสั่ง "ไปบอกอั๋นว่า..." ได้ทันที 🎯` },
        ]);
      } catch (e) {
        return reply([{ kind: "text", text: `ดึงรายชื่อแชทไม่ได้ครับ ⚠️ (${e instanceof Error ? e.message.slice(0, 100) : "error"})`, replyTo: msgId }]);
      }
    }

    // ===== Telegram userbot: ตั้งชื่อเรียกแชทเอง ("แชท 3 คืออั๋น แฟนผม" / "แชท Aun คือแฟนผม ชื่ออั๋น") =====
    const aliasM = text.match(/^แชท\s*(?:หมายเลข|เบอร์|ที่)?\s*(.{1,50}?)\s*(?:คือ|=)\s*(.{1,80})$/);
    if (aliasM && userbotReady()) {
      const ref = aliasM[1].trim();
      const desc = aliasM[2].trim();
      let peer: PeerHit | null = null;
      if (/^\d{1,2}$/.test(ref)) {
        try {
          const list = JSON.parse((await getSetting("kiki_last_dialog_list")) || "[]") as PeerHit[];
          peer = list[Number(ref) - 1] || null;
        } catch { peer = null; }
        if (!peer) return reply([{ kind: "text", text: `หมายเลข ${ref} ไม่อยู่ในลิสต์ล่าสุดครับ — พิมพ์ "ขอรายชื่อแชท" ก่อนแล้วค่อยอ้างเลขนะครับ`, replyTo: msgId }]);
      } else {
        const hits = await findPeer(ref).catch(() => []);
        if (!hits.length) return reply([{ kind: "text", text: `หาแชท "${ref}" ไม่เจอครับ — ลอง "ขอรายชื่อแชท" แล้วอ้างหมายเลขแทน`, replyTo: msgId }]);
        if (hits.length > 1) return reply([{ kind: "text", text: `เจอหลายแชท: ${hits.map((h) => h.name).join(" · ")} — ใช้ "ขอรายชื่อแชท" แล้วอ้างหมายเลขชัวร์กว่าครับ`, replyTo: msgId }]);
        peer = hits[0];
      }
      // ชื่อเรียก = คำแรกของคำอธิบาย (เก็บคำอธิบายเต็มไว้ใน note + ความจำ)
      const alias = desc.replace(/^(ชื่อ|คือ)\s*/, "").split(/\s+/)[0].replace(/[,.]$/, "");
      await setAlias({ alias, peerId: peer.id, peerName: peer.name, note: desc !== alias ? desc : undefined });
      await rememberOwnerFact(`"${alias}" ใน Telegram = แชท "${peer.name}"${desc !== alias ? ` (${desc})` : ""}`, { category: "คนรอบตัว", source: text });
      return reply([{ kind: "text", text: `จำแล้วครับ ✅ "${alias}" = แชท ${peer.name}${desc !== alias ? ` (${desc})` : ""}\n\nต่อไปสั่งได้เลย: "ไปบอก${alias}ว่า..." / "สรุปแชทกับ${alias}"`, replyTo: msgId }]);
    }

    // ===== ส่งข้อความ/ประกาศเข้ากลุ่มที่ Vex ประจำการ (ส่งเองผ่านบอท ไม่ต้องยืนยัน) =====
    // เคสจริง 3 ส.ค.: "ไปแจ้งข้อความในกลุ่ม..." ไม่มี intent → Vex รับปากลอย ๆ ว่าส่งแล้ว
    if (is("tg_group_post")) {
      let titles: Record<string, string> = {};
      try { titles = JSON.parse((await getSetting("kiki_chat_titles")) || "{}"); } catch { /* ว่างก็ได้ */ }
      const knownIds = (await (await import("@/lib/kiki")).getKikiChatIds()).filter((id) => id.startsWith("-"));
      const candidates = knownIds.filter((id) => id !== chatId);
      const lower = text.toLowerCase();
      // จับชื่อกลุ่มจากข้อความ → ไม่เจอ = กลุ่มที่เพิ่มล่าสุด (เคส "กลุ่มที่เพิ่งสร้าง")
      let target = candidates.find((id) => {
        const t = (titles[id] || "").toLowerCase();
        return t && (lower.includes(t) || t.split(/[\s—–-]+/).some((w) => w.length >= 3 && lower.includes(w)));
      });
      if (!target && candidates.length) target = candidates[candidates.length - 1];
      if (target) {
        const convo = await kikiConversation(16);
        const wantTag = /แท็ก|tag|เมนชั่น/i.test(text);
        const content = await askKiki(
          `[เขียนประกาศลงกลุ่ม "${titles[target] || target}"] เจ้าของสั่ง: """${text}"""\nเขียน "เนื้อหาที่จะโพสต์จริง" ตามคำสั่ง อิงเรื่องที่คุยกันในบริบท ตอบเฉพาะเนื้อหาที่จะส่ง ไม่ต้องเกริ่น ไม่ต้องถามกลับ`,
          convo,
        ).catch(() => "");
        if (!content.trim()) return reply([{ kind: "text", text: `เรียบเรียงเนื้อหาไม่สำเร็จครับ ⚠️ ลองสั่งใหม่อีกที`, replyTo: msgId }]);
        const clean = sanitizeVexText(content).text.replace(/<[^>]+>/g, "");
        const finalHtml = `${wantTag ? `<a href="tg://user?id=${fromId}">พี่โด้</a>\n\n` : ""}${escHtml(clean)}`;
        return reply([
          { kind: "text", chatId: target, parseMode: "HTML", text: finalHtml },
          { kind: "text", text: `ส่งเข้ากลุ่ม "${titles[target] || target}" แล้วครับ ✅${wantTag ? " (แท็กพี่ไว้บรรทัดแรก)" : ""}\n\nเนื้อหาที่ส่ง:\n${clean.slice(0, 400)}${clean.length > 400 ? "..." : ""}`, replyTo: msgId },
        ]);
      }
      // ไม่รู้จักกลุ่มไหนเลย → ตกไปทาง userbot ข้างล่าง (กลุ่มนอกที่ Vex ไม่ได้อยู่)
    }

    // ===== Telegram userbot: ส่งข้อความหาใครก็ได้ในนามเจ้าของ (ยืนยันก่อนส่งเสมอ) =====
    if (is("tg_dm")) {
      if (!userbotReady()) {
        return reply([{ kind: "text", text: `ยังไม่ได้เชื่อมบัญชี Telegram พี่ครับ ⚠️ รันในเทอร์มินัล: npm run kiki:tg-auth (ครั้งเดียว) แล้วผมส่งแทนพี่ได้เลย`, replyTo: msgId }]);
      }
      let dm: { target?: string; message?: string } | null = null;
      try {
        const raw = await askExtractor(`ข้อความเจ้าของ: """${text}"""`, {
          system: `แยกคำสั่งส่งข้อความ ตอบ JSON เท่านั้น: {"target":"ชื่อ/username คนหรือกลุ่มที่จะส่งหา","message":"ข้อความที่จะส่ง (เรียบเรียงจากที่เจ้าของสั่ง ให้เหมือนเจ้าของพิมพ์เอง ไม่ต้องแนะนำตัว)"}`,
          timeoutMs: 60_000,
        });
        const m = raw.match(/\{[\s\S]*\}/);
        dm = m ? (JSON.parse(m[0]) as { target?: string; message?: string }) : null;
      } catch { dm = null; }
      if (!dm?.target || !dm.message) return reply([{ kind: "text", text: `บอกใหม่อีกทีครับ ใครและข้อความว่าอะไร เช่น "ไปบอกแม่ว่า เดี๋ยวกลับดึก"`, replyTo: msgId }]);
      const hits = await findPeer(dm.target).catch(() => []);
      if (!hits.length) return reply([{ kind: "text", text: `หาแชท "${dm.target}" ในบัญชีพี่ไม่เจอครับ 🎯 ลองบอกชื่อตามที่โชว์ใน Telegram หรือ @username`, replyTo: msgId }]);
      if (hits.length > 1) {
        return reply([{ kind: "text", text: `เจอหลายแชทครับ หมายถึงอันไหน:\n${hits.map((h, i) => `${i + 1}. ${h.name}${h.username ? ` (@${h.username})` : ""}${h.isGroup ? " · กลุ่ม" : ""}`).join("\n")}\n\nสั่งใหม่โดยระบุชื่อเต็ม/username ครับ`, replyTo: msgId }]);
      }
      await setPendingDm({ peerId: hits[0].id, peerName: hits[0].name, message: dm.message });
      return reply([{
        kind: "text",
        text: `จะส่งหา ${hits[0].name}${hits[0].username ? ` (@${hits[0].username})` : ""} ในนามบัญชีพี่ ว่า:\n\n"${dm.message}"`,
        replyTo: msgId,
        buttons: [[{ text: "✅ ส่งเลย", data: "kiki:dm:yes" }, { text: "❌ ไม่ส่ง", data: "kiki:dm:no" }]],
      }]);
    }

    // ===== Telegram userbot: สรุปแชท/กลุ่มไหนก็ได้ที่เจ้าของอยู่ =====
    const chatSumM = text.match(/สรุปแชท(?:กับ|กลุ่ม)?\s*([^\n]{2,40}?)(?:ให้|หน่อย|ล่าสุด|วันนี้|$)/);
    if (chatSumM && userbotReady() && !/ฟีด|เฟส|facebook/i.test(text)) {
      const hits = await findPeer(chatSumM[1].trim()).catch(() => []);
      if (hits.length === 1) {
        const lines = await readChat(hits[0].id, 80).catch(() => []);
        if (!lines.length) return reply([{ kind: "text", text: `อ่านแชท ${hits[0].name} ไม่ได้/ไม่มีข้อความครับ`, replyTo: msgId }]);
        const answer = await askKiki(
          `สรุปบทสนทนาในแชท "${hits[0].name}" ให้เจ้าของ: ประเด็นหลัก ใครพูดอะไรสำคัญ มีอะไรต้องทำ/ตอบไหม`,
          `=== ข้อความล่าสุดในแชท (เก่า→ใหม่) ===\n${lines.join("\n").slice(0, 12_000)}`,
        );
        return reply([{ kind: "text", text: answer.slice(0, 3900), replyTo: msgId }]);
      }
      if (hits.length > 1) return reply([{ kind: "text", text: `เจอหลายแชท: ${hits.map((h) => h.name).join(" · ")} — ระบุชื่อเต็มอีกทีครับ`, replyTo: msgId }]);
    }

    // ===== สั่งเครื่อง Mac (คำสั่งด่วน + agent ทำแทนที่เครื่อง/Warp/Chrome) =====
    if (is("mac") || (MAC_RE.test(text) && route.intent === "chat")) {
      try {
        const quick = await quickMac(text);
        const r = quick || (await macAgent(text));
        const sends: Send[] = [];
        for (const ip of r.imagePaths || []) {
          try { sends.push({ kind: "photo", dataBase64: fs.readFileSync(ip).toString("base64"), filename: path.basename(ip) }); } catch { /* ข้าม */ }
        }
        // เจ้าของเจอบ่อย: agent อ้างว่า "ส่งภาพแคปมาแล้ว" ทั้งที่ไม่มีไฟล์จริง
        // → ระบบเป็นคนตรวจ ไม่เชื่อคำพูด AI
        const claimsShot = /แคป|ภาพ|screenshot|หน้าจอ/i.test(r.text);
        const gotShot = sends.some((x) => x.kind === "photo");
        let body = r.text.slice(0, 3900);
        if (claimsShot && !gotShot) {
          body += `\n\n⚠️ หมายเหตุจากระบบ: ไม่มีไฟล์ภาพจริงแนบมาด้วยรอบนี้ (ที่บอกว่าแคปแล้วยังไม่เกิดขึ้นจริง) — สั่ง "แคปหน้าจอ" ตรง ๆ ผมทำให้ได้ทันที`;
        }
        sends.push({ kind: "text", text: body, replyTo: msgId });
        return reply(sends);
      } catch (e) {
        return reply([{ kind: "text", text: `ทำที่เครื่องไม่สำเร็จครับ ⚠️ ${e instanceof Error ? e.message.slice(0, 150) : "error"}`, replyTo: msgId }]);
      }
    }

    // (ยกเลิกแล้ว 3 ส.ค.: สรุปฟีด Facebook/X — เจ้าของสั่งเลิกอ่านโซเชียลทั้งหมด)

    // ===== เปลี่ยนเสียงพูดของ Vex =====
    const voiceM = text.match(/(?:เปลี่ยน|ใช้|เอา)เสียง(?:เป็น|ชื่อ)?\s*([A-Za-z]+)/);
    if (voiceM) {
      const { TTS_VOICES } = await import("@/lib/kiki");
      const pick = TTS_VOICES.find((v) => v.toLowerCase() === voiceM[1].toLowerCase());
      if (pick) {
        await setSetting("kiki_tts_voice", pick);
        const sends: Send[] = [{ kind: "text", text: `เปลี่ยนเสียงเป็น ${pick} แล้วครับ ✅ ฟังตัวอย่างด้านล่างเลย`, replyTo: msgId }];
        const ogg = await ttsOgg(`สวัสดีครับ นี่เสียงใหม่ของผม ${pick} ครับผม เป็นไงบ้าง ชอบมั้ยครับ`, pick);
        if (ogg) sends.push({ kind: "voice", dataBase64: ogg.toString("base64"), filename: "vex.ogg" });
        return reply(sends);
      }
      return reply([{ kind: "text", text: `ไม่รู้จักเสียง "${voiceM[1]}" ครับ — พิมพ์ "มีเสียงอะไรบ้าง" ดูรายชื่อได้`, replyTo: msgId }]);
    }
    if (/มีเสียง(อะไร|ไหน)บ้าง|เสียงทั้งหมด|รายชื่อเสียง/.test(text)) {
      const { TTS_VOICES } = await import("@/lib/kiki");
      const cur = (await getSetting("kiki_tts_voice")) || "Charon";
      return reply([{ kind: "text", text: `เสียงที่เลือกได้ (ตอนนี้ใช้ ${cur}):\n\n${TTS_VOICES.join(" · ")}\n\nเปลี่ยนโดยพิมพ์ "เปลี่ยนเสียงเป็น <ชื่อ>" ครับ`, replyTo: msgId }]);
    }

    // ===== เก็บรูปเข้าคลัง (เจ้าของสั่ง "เก็บรูปนี้") — เช็คก่อนเรื่องเงิน =====
    if ((imageFiles.length || videoFiles.length) && is("image_save")) {
      const { saveMedia } = await import("@/lib/kiki-media");
      const label = text.replace(/เก็บ|เซฟ|บันทึก|save|รูป(นี้|พวกนี้)?|ภาพ(นี้|พวกนี้)?|วิดีโอ|คลิป(นี้)?|ไว้|ให้(หน่อย|ที)?|ด้วย|นะ|ครับ|หน่อย/gi, " ").replace(/\s+/g, " ").trim();
      const saved: { what: string; desc: string }[] = [];
      for (const p of imageFiles) {
        const r = await saveMedia(p, "image", label || undefined);
        if (r) saved.push({ what: "รูป", desc: r.description });
      }
      for (const v of videoFiles) {
        const r = await saveMedia(v.path, "video", label || v.name);
        if (r) saved.push({ what: "วิดีโอ", desc: r.description || v.name });
      }
      if (!saved.length) return reply([{ kind: "text", text: "เก็บไม่สำเร็จครับ ⚠️ ลองส่งใหม่อีกทีนะครับ", replyTo: msgId }]);
      const block = vexList({
        title: `เก็บเข้าคลังแล้ว ${saved.length} ไฟล์`,
        items: saved.map((x) => ({ main: `${x.what}${label ? ` — ${label}` : ""}`, sub: x.desc.slice(0, 160) || undefined })),
        note: 'ขอคืนได้ทุกเมื่อ พูดธรรมดาเลย เช่น "ขอรูปที่เก็บเรื่อง..." ผมค้นจากสิ่งที่อยู่ในรูปได้ด้วย',
      });
      return reply([{ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId }]);
    }

    // ===== ขอรูปที่เคยเก็บกลับ =====
    if (!imageFiles.length && is("image_find")) {
      const { findMedia } = await import("@/lib/kiki-media");
      const hits = await findMedia(text).catch(() => []);
      const sends: Send[] = [];
      for (const h of hits) {
        try {
          const b64 = fs.readFileSync(h.abs).toString("base64");
          const cap = `${h.label || h.description.slice(0, 120)} · ${h.createdAt.toLocaleDateString("th-TH-u-ca-gregory", { day: "numeric", month: "short" })}`;
          sends.push({ kind: h.kind === "video" ? "video" : "photo", dataBase64: b64, filename: path.basename(h.abs), caption: cap.slice(0, 200) });
        } catch { /* ไฟล์เสีย ข้าม */ }
      }
      if (sends.length) {
        sends.unshift({ kind: "text", text: `เจอ ${sends.length} ไฟล์ครับ`, replyTo: msgId });
        return reply(sends);
      }
      // ระบบเก่า (รูปที่เก็บก่อนมีตาราง KikiMedia)
      const found = await findPersonalImages(text);
      if (found.length) {
        const old: Send[] = [{ kind: "text", text: `เจอในคลังเก่าครับ ${found.length} รูป`, replyTo: msgId }];
        for (const f of found) {
          try {
            old.push({ kind: "photo", dataBase64: fs.readFileSync(f.path).toString("base64"), filename: path.basename(f.path), caption: f.label || undefined });
          } catch { /* ข้าม */ }
        }
        if (old.length > 1) return reply(old);
      }
      return reply([{ kind: "text", text: "หาไม่เจอครับ — ผมเก็บเฉพาะไฟล์ที่พี่สั่งให้เก็บเท่านั้น (ส่งมาเฉย ๆ ผมดูให้แต่ไม่ได้เก็บ)", replyTo: msgId }]);
    }

    // ===== เจ้าของสอน/ปรับนิสัย Vex (พัฒนาตัวเองผ่านแชท) =====
    // จับทั้งแบบขึ้นต้นชัดเจน (สอนว่า/ต่อไป/ตั้งแต่นี้) และแบบสั่งห้ามที่มีคำบอกความถาวร (อย่า...อีก/ตลอด/ทุกครั้ง)
    // — เคยพลาด: "ต่อไปไม่ต้องใส่อิโมจิในภาพนี้" ไม่เข้า pattern แล้ว AI ตอบมั่วว่าจำแล้วทั้งที่ไม่ได้จำ
    const teachM = text.match(/^\s*(?:สอน(?:นาย|ไว้)?(?:ว่า)?|ต่อไป(?:นี้)?|ตั้งแต่(?:นี้|วันนี้)(?:ไป|เป็นต้นไป)?|นับจากนี้|จากนี้(?:ไป)?|หลังจากนี้|ครั้ง(?:หน้า|ต่อไป)|คราวหน้า|ปรับนิสัย|กฎใหม่)\s*[:：,]?\s*([\s\S]+)/);
    const banM = !teachM && /^\s*(?:อย่า|ห้าม|ไม่ต้อง|เลิก)/.test(text) && /ตลอด|ถาวร|ทุกครั้ง|อีกต่อไป|เด็ดขาด|อีกเลย|อีกแล้ว|ต่อไป/.test(text)
      ? text.trim()
      : null;
    if ((teachM && teachM[1].trim().length >= 5) || banM || is("rule_teach")) {
      const rule = (banM || teachM?.[1]?.trim() || text).trim();
      await rememberOwnerFact(rule, { category: VEX_RULE_CATEGORY, source: text });
      const t = await vexSay(
        `เจ้าของเพิ่งสอนกฎใหม่ให้ตัวเอง: "${rule}" — ยืนยันว่ารับมาปรับตัวถาวรแล้ว ตั้งแต่ข้อความหน้าเป็นต้นไป`,
        [`กฎใหม่: ${rule}`],
        `รับครับ ✅ ปรับตัวตามนี้ถาวรตั้งแต่ตอนนี้เลย\n\n"${rule}"`,
      );
      return reply([{ kind: "text", text: t, replyTo: msgId }]);
    }
    if (is("rule_list")) {
      const all = await listOwnerFacts();
      const rules = all.filter((f) => f.category === VEX_RULE_CATEGORY);
      const t = rules.length
        ? `กฎที่พี่สอนไว้ (${rules.length} ข้อ):\n\n${rules.map((r, i) => `${i + 1}. ${r.fact}`).join("\n")}`
        : `ยังไม่มีกฎพิเศษเลยครับ อยากให้ผมเป็นยังไงพิมพ์ "สอนว่า ..." มาได้เลย 🎯`;
      return reply([{ kind: "text", text: t, replyTo: msgId }]);
    }

    // ===== ลิสต์รายการเงินที่ยังไม่รู้ว่าค่าอะไร (เจ้าของขอ: "รวมมาให้หมด เดี๋ยวผมบอกทีเดียว") =====
    // ตอบทีเดียวหลายรายการ: "1 ค่าข้าว 2 ค่าน้ำมัน 3 ค่าหมอ"
    const batchPairs = [...text.matchAll(/(\d{1,6})[\s.):]+([ก-๙a-zA-Z][^\d\n]{1,40})/g)];
    if (is("finance_pending") && batchPairs.length >= 2) {
      const { classifyPendingBatch } = await import("@/lib/kiki-gmail");
      const r = await classifyPendingBatch([replyText, text].filter(Boolean).join("\n"));
      if (r.done.length) {
        const block = vexList({ title: `จัดหมวดให้แล้ว ${r.done.length} รายการ`, items: r.done, note: r.missed.join(" · ") || undefined });
        const { png } = await financeCardPng();
        const sends: Send[] = [];
        if (png) sends.push({ kind: "photo", dataBase64: png, filename: "finance.png" });
        sends.push({ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId });
        return reply(sends);
      }
      return reply([{ kind: "text", text: "จับคู่รายการไม่ได้เลยครับ ⚠️ ขอลิสต์ใหม่แล้วอ้างเลขข้อได้เลย", replyTo: msgId }]);
    }
    if (is("finance_pending") && !/^\s*[\d,]/.test(text) && !replyText) {
      const { PENDING_CATEGORY } = await import("@/lib/kiki-gmail");
      const dbp = (await import("@/lib/db")).db;
      const pend = await dbp.financeTxn.findMany({ where: { category: PENDING_CATEGORY }, orderBy: { occurredAt: "asc" }, take: 40 });
      if (pend.length) {
        const total = pend.reduce((sum, r) => sum + r.amount, 0);
        const block = vexList({
          title: `รายการที่ยังไม่รู้ว่าค่าอะไร (${pend.length} รายการ · รวม ${fmtBaht(total)} ฿)`,
          numbered: true,
          items: pend.map((r) => ({
            main: `${fmtBaht(r.amount)} ฿ — ${(r.note || "").replace(/ \(จากเมล K PLUS\)$/, "") || "ไม่มีรายละเอียด"}`,
            sub: `${r.occurredAt.toLocaleDateString("th-TH-u-ca-gregory", { day: "numeric", month: "short" })}${r.merchant ? ` · ${r.merchant}` : ""}`,
          })),
          note: 'ตอบรวดเดียวได้เลยครับ เช่น "1 ค่าข้าว 2 ค่าน้ำมัน 3 ค่าหมอ" หรือบอกเป็นยอดก็ได้ "319 ค่าตั๋วหนัง"',
        });
        return reply([{ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId }]);
      }
      return reply([{ kind: "text", text: "ไม่มีรายการค้างระบุเลยครับ เคลียร์หมดแล้ว", replyTo: msgId }]);
    }

    // ===== ตอบคำถาม "ค่าอะไร" ของรายการจากเมลธนาคาร (หมวด รอระบุ) =====
    // reply ที่ข้อความแจ้งเงิน (🔴/🟢) = ชี้ตัวรายการชัดเจน — ส่ง replyText เข้าไปให้จับคู่จากยอดจริง
    if (
      (replyText && /🔴 เงินออก|🟢 เงินเข้า|ค่าอะไร|รอระบุ/.test(replyText)) ||
      (!imageFiles.length && (await hasPendingTxn()) &&
        (/^(ค่า|เป็นค่า|มันคือ|อันนี้(คือ|เป็น)?|หมวด)/.test(text) ||
          /^\s*[\d,]+(\.\d+)?\s+\S/.test(text) || // "319 ค่าตั๋วหนัง" — บอกยอดนำหน้า จับคู่รายการจากยอด
          (!/\d/.test(text) && /^(จ่าย|ซื้อ|โอน)/.test(text))))
    ) {
      const done = await classifyPendingTxn(text, replyText || undefined);
      if (done && !done.ok) return reply([{ kind: "text", text: done.msg, replyTo: msgId }]);
      if (done) {
        const { png } = await financeCardPng();
        const todayList = await itemizedText("today").catch(() => "");
        const sends: Send[] = [];
        if (png) sends.push({ kind: "photo", dataBase64: png, filename: "finance.png" });
        sends.push({ kind: "text", text: `เข้าใจแล้วครับ ✅ ${done.msg}`, replyTo: msgId });
        if (todayList) sends.push({ kind: "text", text: todayList });
        return reply(sends);
      }
    }

    // ===== Wishlist: อยากได้/ซื้อไหวไหม (ยกเว้นสั่งหาสินค้า — อันนั้นไปทางค้นเว็บ) =====
    if (is("wish")) {
      const t = await handleWish(text);
      return reply([{ kind: "text", text: t, replyTo: msgId }]);
    }

    // ===== สมุดหนี้/เงินยืม =====
    if (is("debt")) {
      const t = await handleDebt([replyText, text].filter(Boolean).join("\n"));
      return reply([{ kind: "text", text: t, replyTo: msgId }]);
    }

    // ===== เตือนซ้ำประจำ (ต้องมาก่อนปฏิทิน — "เตือนทุกวันที่ 25" ไม่ใช่นัดครั้งเดียว) =====
    if (is("recurring")) {
      const t = await handleRecurring(text, chatId);
      return reply([{ kind: "text", text: t, replyTo: msgId }]);
    }

    // ===== ฟิตเนส: จดบันทึก + Vex เป็นโค้ช (ใช้คลัง 7966) =====
    if (is("fitness")) {
      const { logged, recentContext } = await handleFitnessLog(text);
      const coach = await fitnessCoachContext();
      const answer = await askKiki(
        text,
        [
          "[โหมดโค้ชฟิตเนส] ตอบแบบโค้ชส่วนตัว: แนะนำท่า/เซ็ต/จำนวนครั้ง/พักได้จริงจัง อิงคลังโค้ชกับบันทึกจริงของเจ้าของ ถ้าเจ้าของเพิ่งรายงานผล ให้คอมเมนต์ผลด้วย",
          logged.length ? `ระบบเพิ่งจดให้แล้ว: ${logged.join(" · ")} (ยืนยันในคำตอบด้วย)` : "",
          coach,
          recentContext,
        ].filter(Boolean).join("\n\n"),
      );
      return reply([{ kind: "text", text: answer.slice(0, 3900), replyTo: msgId }]);
    }

    // ===== จดไดอารี่ตรง ๆ =====
    const diaryM = text.match(/^\s*(?:จดไดอารี่|บันทึกวันนี้|ไดอารี่)\s*[:：]?\s*([\s\S]+)/);
    if (diaryM && diaryM[1].trim().length >= 5) {
      await saveJournal(diaryM[1].trim());
      return reply([{ kind: "text", text: "จดลงไดอารี่แล้วครับ ✅ สิ้นเดือนผมสรุปภาพรวมให้", replyTo: msgId }]);
    }

    // ===== บันทึกรายรับรายจ่าย (สลิป/ข้อความ) =====
    const financeLikely = imageFiles.length
      ? (text ? is("finance_record") || FINANCE_VERB_RE.test(text) || text.length < 60 : true)
      : is("finance_record") && /\d/.test(text);
    if (financeLikely) {
      // แนบรายการล่าสุดให้ตัวสกัดด้วย — เจ้าของพูดถึงยอดเดิม (ถาม/บ่น/แก้ความเข้าใจ) ต้องไม่ถูกลงซ้ำ
      const recent = await (await import("@/lib/db")).db.financeTxn.findMany({
        where: { occurredAt: { gte: new Date(Date.now() - 10 * 86400_000) } },
        orderBy: { createdAt: "desc" },
        take: 15,
      });
      const items = await extractFinance([replyText, text].filter(Boolean).join("\n"), imageFiles, recent);
      if (items.length) {
        const slipPath = imageFiles.length ? await storeSlips(imageFiles) : null;
        const recs = await recordTxns(items, { slipPath: slipPath || undefined, msgId: msgId ? String(msgId) : undefined });
        const { png, snapFacts } = await financeCardPng(recs);
        const addedFacts = recs.map(
          (r) => `เพิ่งบันทึก: ${r.type === "income" ? "เงินเข้า" : "จ่ายออก"} ${fmtBaht(r.amount)} บาท หมวด ${r.category}${r.note ? ` (${r.note})` : ""}`,
        );
        const comment = await vexSay(
          `เพิ่งบันทึกรายการเงินให้เจ้าของ ${recs.length} รายการ — คอมเมนต์สั้น ๆ ตามพฤติกรรม (รายรับ=ชม/แซว, รายจ่ายเยอะ=เตือน/ด่าแบบหวังดี, ใกล้เกินงบ=เตือนแรง) ไม่ต้องบอกว่าจดแล้ว (ระบบแจ้งเองแล้ว)`,
          [...addedFacts, ...snapFacts],
          "",
        );
        // เจ้าของสั่ง (3 ส.ค.): บอกชัดว่าเพิ่งลงค่าอะไร + แนบลิสต์ที่ซื้อวันนี้ต่อท้ายภาพทุกครั้ง
        const confirmed = `บันทึกแล้ว ✅\n${recs.map((r) => `${r.type === "income" ? "+" : "−"}${fmtBaht(r.amount)} ฿ · ${r.note || r.category} (${r.category})`).join("\n")}`;
        const todayList = await itemizedText("today").catch(() => "");
        const sends: Send[] = [];
        if (png) sends.push({ kind: "photo", dataBase64: png, filename: "finance.png" });
        sends.push({ kind: "text", text: confirmed, replyTo: msgId });
        if (todayList) sends.push({ kind: "text", text: todayList });
        if (comment.trim()) sends.push({ kind: "text", text: comment });
        return reply(sends);
      }
      // สกัดไม่ได้ → ไหลไปคุยปกติ (เผื่อไม่ใช่เรื่องเงินจริง ๆ)
    }

    // ===== ความจำ (จำ/ลืม/จำอะไรบ้าง) =====
    const rememberM = text.match(/^\s*(?:จำไว้(?:ว่า|นะ|ด้วย)?|ช่วยจำ(?:ว่า)?|จำด้วยว่า)\s*[:：]?\s*([\s\S]+)/);
    if ((rememberM && rememberM[1].trim().length >= 3) || (is("memory_remember") && (arg("fact") || text).length >= 5)) {
      const fact = (rememberM?.[1]?.trim() || arg("fact") || text).trim();
      const category = /ชอบ/.test(fact) && !/ไม่ชอบ/.test(fact) ? "ความชอบ"
        : /ไม่ชอบ|แพ้|เกลียด|ห้าม/.test(fact) ? "ไม่ชอบ"
        : /สุขภาพ|ยา|หมอ|ออกกำลัง|น้ำหนัก/.test(fact) ? "สุขภาพ"
        : /แฟน|แม่|พ่อ|พี่|น้อง|เพื่อน|ครอบครัว|วันเกิด/.test(fact) ? "คนรอบตัว"
        : /รหัส|บัญชี|เลขที่|ทะเบียน|wifi|password/i.test(fact) ? "ของสำคัญ"
        : "ทั่วไป";
      await rememberOwnerFact(fact, { category, source: text });
      const t = await vexSay(
        `เจ้าของสั่งให้จำ: "${fact}" (หมวด ${category}) — ยืนยันสั้น ๆ ว่าจำถาวรแล้ว`,
        [`จำไว้แล้ว: ${fact}`],
        `จำแล้วครับ ✅ "${fact}"\nถามเมื่อไหร่ก็ตอบได้`,
      );
      return reply([{ kind: "text", text: t, replyTo: msgId }]);
    }
    const forgetM = text.match(/^\s*(?:ลืม(?:เรื่อง|ว่า|ไปเลย)?|ลบความจำ(?:เรื่อง)?)\s*[:：]?\s*([\s\S]+)/);
    if ((forgetM && forgetM[1].trim().length >= 2) || is("memory_forget")) {
      const kw = (forgetM?.[1] || text.replace(/^\s*(ลืม(เรื่อง|ว่า)?|ลบความจำ(เรื่อง)?)\s*/, "")).trim();
      const n = await forgetOwnerFacts(kw);
      return reply([{ kind: "text", text: n ? `ลืมให้แล้ว ${n} เรื่องครับ ✅` : `หาเรื่อง "${kw}" ในความจำไม่เจอครับ 🎯`, replyTo: msgId }]);
    }
    if (is("memory_list")) {
      const facts = await listOwnerFacts();
      if (!facts.length) return reply([{ kind: "text", text: `ยังไม่มีอะไรในหัวเลยครับ 🎯 พิมพ์ "จำไว้ว่า ..." มาได้เลย`, replyTo: msgId }]);
      const lines = facts.map((f, i) => `${i + 1}. [${f.category}] ${f.fact}`).join("\n");
      return reply([{ kind: "text", text: `ที่จำไว้ตอนนี้ (${facts.length} เรื่อง):\n\n${lines}`, replyTo: msgId }]);
    }

    // ===== ลิงก์: เก็บเข้าคลัง / อ่านประกอบคำตอบ =====
    const urls = [...extractUrls(text), ...extractUrls(replyText)].slice(0, 3);
    const saveLinkIntent = urls.length > 0 && is("link_save");
    if (saveLinkIntent) {
      const saved: string[] = [];
      const failed: string[] = [];
      for (const u of urls) {
        try {
          const r = await saveLinkToPersonal(u, text.slice(0, 150));
          saved.push(r.title);
        } catch {
          failed.push(u);
        }
      }
      const t = await vexSay(
        "เพิ่งอ่านลิงก์ที่เจ้าของส่งมาแล้วเก็บเข้าคลังความรู้ส่วนตัวเรียบร้อย — ยืนยัน + สรุปสั้นมากว่าเรื่องอะไร",
        [...saved.map((s) => `เก็บแล้ว: ${s}`), ...failed.map((f) => `เปิดไม่ได้: ${f}`)],
        saved.length ? `เก็บเข้าคลังแล้วครับ 🔗 ${saved.join(" · ")}` : `เปิดลิงก์ไม่ได้เลยครับ ⚠️ ลองเช็คลิงก์อีกที`,
      );
      return reply([{ kind: "text", text: t, replyTo: msgId }]);
    }

    // ===== ปฏิทิน: เลื่อน/ยกเลิก/เสร็จแล้ว (แก้ด้วยภาษาคน + sync Google Calendar) =====
    if (is("calendar_edit")) {
      const r = await editCalendar([replyText, text].filter(Boolean).join("\n"), chatId);
      if (!r.applied.length) {
        return reply([{ kind: "text", text: `ยังไม่ได้แตะนัดไหนนะครับ ⚠️ ${r.reason || "ไม่แน่ใจว่าหมายถึงนัดไหน"}\nบอกชื่อนัดชัด ๆ อีกทีได้เลย`, replyTo: msgId }]);
      }
      const t = await vexSay(
        `เพิ่งจัดการตารางนัดตามคำสั่งสำเร็จ ${r.applied.length} รายการ (sync Google Calendar ให้แล้วด้วย) — ยืนยันสั้น ๆ`,
        r.applied,
        `จัดการแล้วครับ ✅\n\n${r.applied.join("\n")}`,
      );
      return reply([{ kind: "text", text: t, replyTo: msgId }]);
    }

    // ===== ปฏิทิน: ดู (วันนี้/พรุ่งนี้/สัปดาห์) =====
    if (is("calendar_view")) {
      const now = new Date();
      const travelMin = Number((await getSetting("kiki_travel_min")) || 40);
      const dayStartOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
      if (/สัปดาห์|อาทิตย์|7\s*วัน/.test(text)) {
        const from = dayStartOf(now);
        const to = new Date(from.getTime() + 7 * 86400_000);
        const rows = await (await import("@/lib/db")).db.calendarEvent.findMany({ where: { agent: "kiki", chatId, date: { gte: from, lt: to } }, orderBy: { date: "asc" } });
        const byDay = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(from.getTime() + i * 86400_000);
          return { date: d, events: rows.filter((r) => r.date.toDateString() === d.toDateString()).map(toKikiEvent) };
        });
        try {
          const png = await renderHtmlToPng(weekCardHtml(byDay, { now }), { width: 720, height: 200 });
          return reply([
            { kind: "photo", dataBase64: png.toString("base64"), filename: "week.png" },
            { kind: "text", text: rows.length ? `สัปดาห์นี้ ${rows.length} นัดครับ รายละเอียดตามการ์ดเลย` : `สัปดาห์นี้โล่งครับ 🎯`, replyTo: msgId },
          ]);
        } catch { /* การ์ดพลาด → ตกไปตอบแบบข้อความ */ }
      }
      const tomorrow = /พรุ่งนี้/.test(text) && !/วันนี้/.test(text);
      const target = tomorrow ? new Date(dayStartOf(now).getTime() + 86400_000) : dayStartOf(now);
      const next = new Date(target.getTime() + 86400_000);
      const dbi = (await import("@/lib/db")).db;
      const rows = await dbi.calendarEvent.findMany({ where: { agent: "kiki", chatId, date: { gte: target, lt: next } }, orderBy: { date: "asc" } });
      const tomorrowRows = tomorrow ? [] : await dbi.calendarEvent.count({ where: { agent: "kiki", chatId, date: { gte: next, lt: new Date(next.getTime() + 86400_000) } } });
      try {
        const png = await renderHtmlToPng(
          agendaCardHtml(rows.map(toKikiEvent), {
            heading: tomorrow ? "พรุ่งนี้" : "วันนี้",
            now,
            travelMin,
            budgetLine: tomorrow ? null : (await budgetLineToday())?.replace("ใช้ได้อีก ", ""),
            tomorrowLine: tomorrow ? null : tomorrowRows ? `${tomorrowRows} นัด` : "ไม่มีนัด",
          }),
          { width: 720, height: 200 },
        );
        const t = rows.length ? `${tomorrow ? "พรุ่งนี้" : "วันนี้"}มี ${rows.length} นัดครับ` : `${tomorrow ? "พรุ่งนี้" : "วันนี้"}ว่างครับ ไม่มีนัด 🎯`;
        return reply([{ kind: "photo", dataBase64: png.toString("base64"), filename: "agenda.png" }, { kind: "text", text: t, replyTo: msgId }]);
      } catch {
        const t = rows.length
          ? `${rows.map((e) => `• ${e.timeText || "ทั้งวัน"} — ${e.title}${e.location ? ` (${e.location})` : ""}`).join("\n")}`
          : "ไม่มีนัดครับ";
        return reply([{ kind: "text", text: t, replyTo: msgId }]);
      }
    }
    // ===== ปฏิทิน: ลงนัด =====
    if (is("calendar_create")) {
      try {
        const parsedList = await extractEvents(text, askExtractor);
        if (parsedList.length) {
          const now = new Date();
          const travelMin = Number((await getSetting("kiki_travel_min")) || 40);
          const budgetLine = await budgetLineToday();
          const sends: Send[] = [];
          const lines: string[] = [];
          const links: string[] = [];
          let authFailed = false;
          const dbi = (await import("@/lib/db")).db;
          for (const parsed of parsedList) {
            const ev = await createEvent({ chatId, parsed, createdById: fromId, creatorName: fromName || undefined, agent: "kiki" });
            if (ev.gcalError === "need_auth") authFailed = true;
            const kev: KikiEvent = { id: ev.id, date: ev.date, timeText: ev.timeText, endTime: parsed.endTime || null, title: ev.title, location: parsed.location || null, withWho: parsed.withWho || null, note: parsed.note || null, done: false };
            lines.push(`${ev.title} — ${thaiDate(ev.date)}${ev.timeText ? ` ${ev.timeText}${parsed.endTime ? `–${parsed.endTime}` : ""} น.` : " (ทั้งวัน)"}${parsed.location ? ` ที่${parsed.location}` : ""}`);
            if (ev.gcalLink) links.push(ev.gcalLink);
            try {
              const st = evStart(kev);
              const weather = await weatherFor(ev.date, st ? st.getHours() - 1 : undefined, st ? Math.min(23, st.getHours() + 4) : undefined);
              const dayStartOf = new Date(ev.date.getFullYear(), ev.date.getMonth(), ev.date.getDate());
              const dayRows = await dbi.calendarEvent.findMany({ where: { agent: "kiki", chatId, date: { gte: dayStartOf, lt: new Date(dayStartOf.getTime() + 86400_000) } } });
              const png = await renderHtmlToPng(
                eventCardHtml(kev, { mode: "created", now, weather, budgetLine, travelMin, dayEvents: dayRows.map(toKikiEvent) }),
                { width: 720, height: 200 },
              );
              sends.push({ kind: "photo", dataBase64: png.toString("base64"), filename: "event.png" });
            } catch { /* ภาพพลาดไม่เป็นไร ข้อความยังครบ */ }
          }
          let t = await vexSay(
            `เพิ่งลงนัดให้เจ้าของ ${parsedList.length} รายการ (การ์ดรายละเอียดส่งไปแล้ว) — ยืนยันสั้นมาก 1-2 บรรทัด + บอกว่าจะเตือนเย็นก่อนวันนัด เช้าวันนัด และก่อนถึงเวลา 1 ชม.`,
            lines,
            `ลงนัดแล้วครับ ✅ ${lines.join(" · ")}\nเดี๋ยวผมเตือนเป็นระยะเอง`,
          );
          if (authFailed) t += `\n\n⚠️ ลงในระบบแล้ว แต่ Google Calendar ยังไม่เชื่อม — รัน npm run drive:auth แล้วสั่งใหม่นะครับ`;
          let html = escHtml(t);
          if (links.length) html += `\n\n${links.map((l, i) => `<a href="${l}">เปิดใน Google Calendar${links.length > 1 ? ` (${i + 1})` : ""}</a>`).join(" · ")}`;
          sends.push({ kind: "text", text: html, parseMode: "HTML", noPreview: true, replyTo: msgId });
          return reply(sends);
        }
      } catch { /* แยกไม่ได้ → คุยปกติให้ถามต่อ */ }
    }

    // ===== หาข้อมูล/หาสินค้า/ค้นเว็บสด + วิเคราะห์ =====
    if ((is("web_research") || is("shopping")) && !imageFiles.length) {
      try {
        const shopping = is("shopping") || isShoppingQuery(text);
        // ส่งบทสนทนาล่าสุดไปด้วย — เจ้าของถามต่อเนื่องได้ ("เอาแบบเมื่อกี้แต่ถูกกว่า")
        const convoCtx = await kikiConversation(12).catch(() => "");
        const research = await webResearch([replyText, text].filter(Boolean).join("\n"), { context: convoCtx, shopping });
        const answer = await askKiki(
          text,
          `=== ผลค้นเว็บสด (ข้อมูลจริงเรียลไทม์ ใช้ตอบ/วิเคราะห์ได้เลย ห้ามมโนเพิ่ม) ===\n${research.slice(0, 14_000)}\n\n[${shopping ? "จัดเป็นลิสต์ตัวเลือกสินค้า: ชื่อ/ราคา/ข้อดี + ลิงก์ URL เต็มวางบรรทัดของมันเอง (ห้ามตัดลิงก์ทิ้ง ห้ามย่อ) ปิดท้ายฟันธงตัวที่แนะนำสุด+เหตุผล ตัดสินใจแทนเจ้าของได้เลย" : "วิเคราะห์+สรุปตามที่เจ้าของขอ เว้นบรรทัดอ่านง่าย ตัวเลข/วันที่ครบ"}]`,
        );
        return reply([{ kind: "text", text: answer.slice(0, 3900), replyTo: msgId }]);
      } catch { /* ค้นไม่ได้ → ตกไปคุยปกติ ตอบเท่าที่รู้ */ }
    }

    // ===== สรุปเป็น HTML (เจ้าของสั่ง "สรุป..." = เอกสาร HTML ละเอียดเสมอ) =====
    if (is("doc_summary")) {
      const ctxParts: string[] = [];
      if (replyText) ctxParts.push(`ข้อความที่เจ้าของ reply ถึง (หัวข้อหลักของสรุป):\n"""${replyText.slice(0, 3000)}"""`);
      const notes = await retrievePersonalNotes(text).catch(() => "");
      if (notes) ctxParts.push(`โน้ตส่วนตัวที่เกี่ยวข้อง:\n${notes}`);
      if (/เงิน|บัญชี|รายจ่าย|รายรับ|งบ|ใช้จ่าย/.test(text)) {
        const snap = await financeSnapshot();
        ctxParts.push(`ข้อมูลการเงินจริง:\n${snapshotFacts(snap).join("\n")}\nรายหมวด: ${snap.byCategory.map((c) => `${c.category} ${fmtBaht(c.amount)}฿`).join(", ")}`);
        const txns = await (await import("@/lib/db")).db.financeTxn.findMany({ orderBy: { occurredAt: "desc" }, take: 60 });
        ctxParts.push(`รายการล่าสุด:\n${txns.map((r) => `${r.occurredAt.toLocaleDateString("th-TH-u-ca-gregory")} ${r.type === "income" ? "+" : "-"}${r.amount} ${r.category} ${r.note || ""}`).join("\n")}`);
      }
      const convo = await kikiConversation(30);
      if (convo) ctxParts.push(convo);
      const facts = await ownerFactsContext();
      if (facts) ctxParts.push(facts);

      const raw = await askClaude(
        `คำสั่งจากเจ้าของ: ${text}\n\nสร้าง "เอกสารสรุป HTML" ฉบับสมบูรณ์ ภาษาไทย ละเอียดครบถ้วนตามข้อมูลจริงด้านล่าง ห้ามมโนข้อมูลที่ไม่มี\nข้อกำหนด: ไฟล์ HTML เดียวจบ (<!doctype html> ... </html>) มี CSS ในตัว ธีมสว่าง สะอาด อ่านง่าย มีหัวข้อ/ตาราง/ตัวเลขชัดเจน ถ้ามีข้อมูลตัวเลขให้ทำแถบกราฟง่าย ๆ ด้วย CSS ได้\nตอบเป็นโค้ด HTML ล้วน ๆ เท่านั้น ไม่มีข้อความอื่น\n\n=== ข้อมูลจริง ===\n${ctxParts.join("\n\n")}`,
        { guard: KIKI_GUARD, system: KIKI_PERSONA, timeoutMs: 220_000 },
      );
      const m = raw.match(/<!doctype[\s\S]*<\/html>/i) || raw.match(/<html[\s\S]*<\/html>/i);
      if (m) {
        const html = m[0];
        const name = `สรุป-${new Date().toISOString().slice(0, 10)}.html`;
        return reply([
          { kind: "text", text: `สรุปเสร็จแล้วครับ 📤 เปิดไฟล์ด้านล่างได้เลย`, replyTo: msgId },
          { kind: "document", dataBase64: Buffer.from(html, "utf8").toString("base64"), filename: name, caption: `🌐 ${text.slice(0, 80)}` },
        ]);
      }
      // ทำ HTML ไม่ได้ → ส่งเป็นข้อความปกติ
      return reply([{ kind: "text", text: raw.slice(0, 3800), replyTo: msgId }]);
    }

    // ===== คุยปกติ — สมอง Vex เต็มรูปแบบ =====
    const ctxParts: string[] = [];
    if (voiceNote) ctxParts.push(`เจ้าของ "อัดเสียงพูดมา" (ระบบถอดเสียงให้แล้ว ข้อความคือคำพูดจริงของเขา) — ตอบเหมือนคุยกันปกติ`);
    if (replyText) ctxParts.push(`เจ้าของกำลัง reply ข้อความนี้ ให้ตอบอ้างอิงเนื้อหานี้เป็นหลัก:\n"""${replyText.slice(0, 2000)}"""`);
    if (videoFiles.length) {
      ctxParts.push(
        `เจ้าของส่งวิดีโอมา ${videoFiles.length} ไฟล์ (${videoFiles.map((v) => v.name).join(", ")}) — ระบบยังไม่ได้เก็บเข้าคลัง (เก็บเฉพาะที่สั่ง) ถ้าอยากให้เก็บบอกได้`,
      );
    }
    if (imageFiles.length) {
      ctxParts.push(`เจ้าของส่งรูปมา ${imageFiles.length} รูป — เปิดอ่านด้วยเครื่องมือ Read ตาม path แล้วตอบจากเนื้อหาจริงในรูป (ห้ามบอกว่าไม่เห็นรูป):\n${imageFiles.map((p, i) => `${i + 1}. ${p}`).join("\n")}`);
    }
    // ลิงก์ที่ส่งมา: อ่านให้ลึกจริง (fetch → เบราว์เซอร์ของเจ้าของถ้าเว็บบังคับล็อกอิน) + แคปหน้าจอเป็นหลักฐาน
    const linkShots: { b64: string; caption: string }[] = [];
    if (urls.length) {
      const { readAnyUrl } = await import("@/lib/kiki-read");
      for (const u of urls.slice(0, 2)) {
        const r = await readAnyUrl(u, { shot: true, note: text.slice(0, 200) }).catch(() => null);
        if (!r) { ctxParts.push(`[อ่านลิงก์ ${u} ไม่สำเร็จ — บอกเจ้าของตรง ๆ ว่าเปิดไม่ได้ ห้ามเดาเนื้อหา]`); continue; }
        if (r.shotBase64 && r.via === "browser") linkShots.push({ b64: r.shotBase64, caption: `${r.title || u}`.slice(0, 200) });
        if (r.ok) {
          ctxParts.push(
            `เนื้อหาจากลิงก์ที่ส่งมา (ระบบเปิดอ่านให้จริงแล้ว${r.via === "browser" ? " ผ่านเบราว์เซอร์ที่ล็อกอินอยู่" : r.via === "youtube" ? " โดยดูคลิปจริง" : ""} — ใช้ตอบได้เลย):\n### ${r.title}\n${r.text.slice(0, 12_000)}`,
          );
        } else {
          ctxParts.push(`[เปิดลิงก์ ${u} ไม่สำเร็จ: ${r.problem || "ไม่ทราบสาเหตุ"} — บอกเจ้าของตรง ๆ ตามนี้ ห้ามเดาว่าในลิงก์เขียนอะไร]`);
        }
      }
    }
    if (is("think")) {
      ctxParts.push(
        `[โหมดคิด/เสนอ] เจ้าของขอให้คิด เสนอ ตั้งชื่อ ร่าง หรือช่วยตัดสินใจ — ลงมือเสนอของจริงทันที ห้ามถามกลับก่อนโดยไม่จำเป็น
ให้ตัวเลือกหลายอัน (3-6 อัน) แต่ละอันมีคำอธิบายว่าทำไมถึงเสนอ/ความหมาย/โทนที่ได้ แล้วปิดท้ายด้วยตัวที่แนะนำที่สุดพร้อมเหตุผล
เขียนบรรทัดละตัวเลือก ยาวได้ ไม่ต้องรวบสั้น`,
      );
    }
    const notes = await retrievePersonalNotes(text).catch(() => "");
    if (notes) ctxParts.push(`=== คลังความรู้/บันทึกส่วนตัวที่เกี่ยวข้อง (ใช้ตอบได้เลย ถ้าอยู่ในนี้อย่าบอกว่าไม่รู้) ===\n${notes}`);
    try {
      const snap = await financeSnapshot();
      if (snap.txnCount > 0) ctxParts.push(`=== การเงินเดือนนี้ (ย่อ) ===\n${snapshotFacts(snap).join("\n")}`);
    } catch { /* ไม่มีข้อมูลเงินก็ข้าม */ }
    try {
      const ups = await getUpcoming(chatId, 5);
      if (ups.length) ctxParts.push(`=== นัดที่จะถึง ===\n${ups.map((e) => `• ${thaiDate(e.date)}${e.timeText ? ` ${e.timeText}` : ""} — ${e.title}`).join("\n")}`);
    } catch { /* ข้าม */ }

    // เมื่อคืน Vex ถามไถ่วันนี้ไว้ → ข้อความเล่ายาว ๆ = บันทึกลง journal ให้เลย
    const today0 = new Date().toISOString().slice(0, 10);
    const journalPending = (await getSetting("kiki_journal_pending")) === today0;
    if (journalPending && text.length >= 20 && !imageFiles.length) {
      await setSetting("kiki_journal_pending", "");
      await saveJournal(text);
      ctxParts.push("[เจ้าของเพิ่งเล่าว่าวันนี้เป็นยังไง ตอบที่ Vex ถามไว้ — ระบบบันทึกลงไดอารี่แล้ว ตอบรับแบบเพื่อนคุยกัน สั้น ๆ อบอุ่น/แซวได้ ไม่ต้องบอกขั้นตอนระบบ]");
    }

    const answer = await askKiki(text || "(เจ้าของส่งรูปมาโดยไม่มีข้อความ — ดูรูปแล้วตอบตามเนื้อหา)", ctxParts.join("\n\n") || undefined);
    const outSends: Send[] = [
      ...linkShots.map((s0) => ({ kind: "photo" as const, dataBase64: s0.b64, filename: "page.png", caption: s0.caption })),
      { kind: "text" as const, text: answer.slice(0, 3900), replyTo: msgId },
    ];
    // สั่งด้วยข้อความว่า "อ่านให้ฟัง/ตอบเสียง" → อ่านข้อความที่ reply ถึง (หรือคำตอบ) เป็นเสียง
    // (กรณีเจ้าของพูดมาเป็นเสียง reply() แนบเสียงให้อยู่แล้ว ไม่ต้องซ้ำ)
    if (!voiceNote && /อ่านให้ฟัง|ตอบเสียง|พูดให้ฟัง/.test(text)) {
      const ogg = await ttsOgg(/อ่านให้ฟัง|พูดให้ฟัง/.test(text) && replyText ? replyText : answer);
      if (ogg) outSends.push({ kind: "voice", dataBase64: ogg.toString("base64"), filename: "vex.ogg" });
    }
    return reply(outSends);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return ok([{ kind: "text", text: `สมองค้างแป๊บครับ ⚠️ (${detail.slice(0, 200)})\nลองพิมพ์ใหม่อีกทีนะครับ` }]);
  }
}
