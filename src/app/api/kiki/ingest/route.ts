import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { renderHtmlToPng } from "@/lib/html-pdf";
import { askClaude } from "@/lib/claude";
import { extractEvents, createEvent, getUpcoming, thaiDate, buildCalendarDayHtml } from "@/lib/calendar";
import { extractUrls, fetchUrlContent } from "@/lib/weblink";
import {
  askKiki,
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
  saveImageToPersonal,
  findPersonalImages,
  VEX_RULE_CATEGORY,
} from "@/lib/kiki";
import {
  extractFinance,
  recordTxns,
  deleteLastTxn,
  setBudget,
  financeSnapshot,
  snapshotFacts,
  financeCardHtml,
  fmtBaht,
  TOTAL_BUDGET_KEY,
  EXPENSE_CATS,
  type TxnRecord,
} from "@/lib/kiki-finance";

export const runtime = "nodejs";
export const maxDuration = 240;

// รูปแบบเดียวกับ ingest ของวาน — บอทฝั่ง kiki-bot.mjs เอาไปส่ง Telegram ต่อ
interface Send {
  kind: "text" | "document" | "photo";
  text?: string;
  filename?: string;
  caption?: string;
  dataBase64?: string;
  parseMode?: "HTML" | "Markdown";
  replyTo?: number; // reply ไปที่ข้อความไหน
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

const FINANCE_QUERY_RE =
  /(สรุป|ขอดู|เช็ก|เช็ค|ดู).{0,10}(การเงิน|บัญชี|รายจ่าย|รายรับ|งบ)|ใช้ไปเท่า|เหลือเท่าไห?ร่|ยอดใช้|(วันนี้|เดือนนี้).{0,8}ใช้(ไป)?เท่า|งบเหลือ|การ์ดเงิน|สถานะเงิน|เงินเหลือ/i;
const FINANCE_VERB_RE =
  /จ่าย|ซื้อ|โอน(ไป|ให้)|เสียเงิน|เติมเงิน|ค่า[ก-๙]{2,}|ได้เงิน|เงินเข้า|เงินเดือน(ออก|เข้า)|รายรับ|รายจ่าย|เงินเสริม|ถูกหวย|ขายได้|หมดไป|บาท/i;
const CAL_VIEW_RE =
  /(ดู|เช็ก|เช็ค|ขอดู|มีอะไร).{0,8}(ตาราง(งาน)?|ปฏิทิน|calendar|คิว|นัด)|(วันนี้|พรุ่งนี้|สัปดาห์นี้).{0,6}(มีอะไร|ทำอะไร|ต้องทำ|ว่างไหม)|ตาราง(งาน)?(วันนี้|พรุ่งนี้)/i;
const CAL_CREATE_RE =
  /(ลง|ใส่|จด|บันทึก|เพิ่ม).{0,8}(ปฏิทิน|calendar|ตาราง(งาน)?|คิว|นัด(หมาย)?)|นัดหมาย|เตือน.{0,24}(ว่า|วันที่|พรุ่งนี้|มะรืน|วันนี้|จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์|สิ้นเดือน)/i;

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
  const msgId = body.msgId ? Number(body.msgId) : undefined;
  if (!chatId || (!text && !imageFiles.length && !audioFiles.length)) return ok([]);

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

  await saveKikiChat("user", text || `[ส่งรูปมา ${imageFiles.length} รูป]`);
  const reply = async (sends: Send[]) => {
    for (const s of sends) if (s.kind === "text" && s.text) await saveKikiChat("assistant", s.text);
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

    // ===== ลบรายการเงินล่าสุด =====
    if (/(ลบ|ยกเลิก|เอาออก).{0,12}(รายการ|บันทึก|อันเมื่อกี้|ล่าสุด)|บันทึกผิด|ลงผิด/i.test(text)) {
      const last = await deleteLastTxn();
      if (!last) return reply([{ kind: "text", text: "ยังไม่มีรายการให้ลบเลยครับ 🎯", replyTo: msgId }]);
      const t = `ลบให้แล้วครับ ✅\n\n${last.type === "income" ? "รับ" : "จ่าย"} ${fmtBaht(last.amount)} ฿ · ${last.category}${last.note ? ` · ${last.note}` : ""}`;
      return reply([{ kind: "text", text: t, replyTo: msgId }]);
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

    // ===== ถามสถานะการเงิน =====
    if (FINANCE_QUERY_RE.test(text) && !/สรุป.{0,20}(html|ไฟล์|เอกสาร|ละเอียด)/i.test(text)) {
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

    // ===== เก็บรูปเข้าคลัง (เจ้าของสั่ง "เก็บรูปนี้") — เช็คก่อนเรื่องเงิน =====
    if (imageFiles.length && /เก็บ(รูป|ภาพ|ไว้)|เซฟ(รูป|ภาพ)|บันทึก(รูป|ภาพ)|save\s*(รูป|ภาพ|pic)/i.test(text) && !FINANCE_VERB_RE.test(text)) {
      const label = text.replace(/เก็บ|เซฟ|บันทึก|save|รูป(นี้|พวกนี้)?|ภาพ(นี้|พวกนี้)?|ไว้|ให้(หน่อย|ที)?|ด้วย|นะ|ครับ|หน่อย/gi, " ").trim();
      const saved: string[] = [];
      for (const p of imageFiles) {
        const r = await saveImageToPersonal(p, label || undefined);
        if (r) saved.push(r.rel);
      }
      const t = saved.length
        ? `เก็บให้แล้วครับ ✅ ${saved.length} รูป${label ? ` — "${label}"` : ""}\nอยากได้คืนเมื่อไหร่ พิมพ์ "ขอรูป${label ? label : "ที่เก็บไว้"}" ได้เลย`
        : `เก็บรูปไม่สำเร็จครับ ⚠️ ลองส่งใหม่อีกทีนะครับ`;
      return reply([{ kind: "text", text: t, replyTo: msgId }]);
    }

    // ===== ขอรูปที่เคยเก็บกลับ =====
    if (!imageFiles.length && /(ขอ|เอา|ส่ง|หา|ดู|เปิด).{0,10}(รูป|ภาพ)|(รูป|ภาพ).{0,14}(ที่เก็บ|เก็บไว้|ในคลัง|เคยส่ง)/i.test(text)) {
      const found = await findPersonalImages(text);
      if (found.length) {
        const sends: Send[] = [{ kind: "text", text: `เจอครับ 🎯 ${found.length} รูป`, replyTo: msgId }];
        for (const f of found) {
          try {
            sends.push({ kind: "photo", dataBase64: fs.readFileSync(f.path).toString("base64"), filename: path.basename(f.path), caption: f.label || undefined });
          } catch { /* อ่านไฟล์ไม่ได้ก็ข้าม */ }
        }
        if (sends.length > 1) return reply(sends);
      }
      // ไม่เจอ → ไหลไปคุยปกติ (อาจหมายถึงเรื่องอื่น)
    }

    // ===== เจ้าของสอน/ปรับนิสัย Vex (พัฒนาตัวเองผ่านแชท) =====
    const teachM = text.match(/^\s*(?:สอน(?:นาย|ไว้)?(?:ว่า)?|ต่อไปนี้|ตั้งแต่นี้(?:ไป|เป็นต้นไป)?|นับจากนี้|ปรับนิสัย|กฎใหม่)\s*[:：,]?\s*([\s\S]+)/);
    if (teachM && teachM[1].trim().length >= 5) {
      const rule = teachM[1].trim();
      await rememberOwnerFact(rule, { category: VEX_RULE_CATEGORY, source: text });
      const t = await vexSay(
        `เจ้าของเพิ่งสอนกฎใหม่ให้ตัวเอง: "${rule}" — ยืนยันว่ารับมาปรับตัวถาวรแล้ว ตั้งแต่ข้อความหน้าเป็นต้นไป`,
        [`กฎใหม่: ${rule}`],
        `รับครับ ✅ ปรับตัวตามนี้ถาวรตั้งแต่ตอนนี้เลย\n\n"${rule}"`,
      );
      return reply([{ kind: "text", text: t, replyTo: msgId }]);
    }
    if (/(กฎ|สิ่งที่สอน|สอนอะไร)(นาย|ไว้|ไป)?(มี)?อะไรบ้าง|มีกฎอะไร/.test(text)) {
      const all = await listOwnerFacts();
      const rules = all.filter((f) => f.category === VEX_RULE_CATEGORY);
      const t = rules.length
        ? `กฎที่พี่สอนไว้ (${rules.length} ข้อ):\n\n${rules.map((r, i) => `${i + 1}. ${r.fact}`).join("\n")}`
        : `ยังไม่มีกฎพิเศษเลยครับ อยากให้ผมเป็นยังไงพิมพ์ "สอนว่า ..." มาได้เลย 🎯`;
      return reply([{ kind: "text", text: t, replyTo: msgId }]);
    }

    // ===== บันทึกรายรับรายจ่าย (สลิป/ข้อความ) =====
    const financeLikely = imageFiles.length
      ? (text ? FINANCE_VERB_RE.test(text) || text.length < 60 : true)
      : FINANCE_VERB_RE.test(text) && /\d/.test(text);
    if (financeLikely) {
      const items = await extractFinance([replyText, text].filter(Boolean).join("\n"), imageFiles);
      if (items.length) {
        const slipPath = imageFiles.length ? await storeSlips(imageFiles) : null;
        const recs = await recordTxns(items, { slipPath: slipPath || undefined, msgId: msgId ? String(msgId) : undefined });
        const { png, snapFacts } = await financeCardPng(recs);
        const addedFacts = recs.map(
          (r) => `เพิ่งบันทึก: ${r.type === "income" ? "เงินเข้า" : "จ่ายออก"} ${fmtBaht(r.amount)} บาท หมวด ${r.category}${r.note ? ` (${r.note})` : ""}`,
        );
        const t = await vexSay(
          `เพิ่งบันทึกรายการเงินให้เจ้าของ ${recs.length} รายการ — ยืนยันว่าจดแล้ว + คอมเมนต์ตามพฤติกรรม (รายรับ=ชม/แซว, รายจ่ายเยอะ=เตือน/ด่าแบบหวังดี, ใกล้เกินงบ=เตือนแรง)`,
          [...addedFacts, ...snapFacts],
          `จดแล้วครับ ✅ ${recs.map((r) => `${r.type === "income" ? "+" : "−"}${fmtBaht(r.amount)} ฿ (${r.category})`).join(" · ")}`,
        );
        const sends: Send[] = [];
        if (png) sends.push({ kind: "photo", dataBase64: png, filename: "finance.png" });
        sends.push({ kind: "text", text: t, replyTo: msgId });
        return reply(sends);
      }
      // สกัดไม่ได้ → ไหลไปคุยปกติ (เผื่อไม่ใช่เรื่องเงินจริง ๆ)
    }

    // ===== ความจำ (จำ/ลืม/จำอะไรบ้าง) =====
    const rememberM = text.match(/^\s*(?:จำไว้(?:ว่า|นะ|ด้วย)?|ช่วยจำ(?:ว่า)?|จำด้วยว่า)\s*[:：]?\s*([\s\S]+)/);
    if (rememberM && rememberM[1].trim().length >= 3) {
      const fact = rememberM[1].trim();
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
    if (forgetM && forgetM[1].trim().length >= 2) {
      const n = await forgetOwnerFacts(forgetM[1].trim());
      return reply([{ kind: "text", text: n ? `ลืมให้แล้ว ${n} เรื่องครับ ✅` : `หาเรื่อง "${forgetM[1].trim()}" ในความจำไม่เจอครับ 🎯`, replyTo: msgId }]);
    }
    if (/(จำอะไร(ได้)?บ้าง|รู้อะไรเกี่ยวกับ(ผม|กู|เรา)|ความจำมีอะไร|มีข้อมูลผมอะไรบ้าง)/i.test(text)) {
      const facts = await listOwnerFacts();
      if (!facts.length) return reply([{ kind: "text", text: `ยังไม่มีอะไรในหัวเลยครับ 🎯 พิมพ์ "จำไว้ว่า ..." มาได้เลย`, replyTo: msgId }]);
      const lines = facts.map((f, i) => `${i + 1}. [${f.category}] ${f.fact}`).join("\n");
      return reply([{ kind: "text", text: `ที่จำไว้ตอนนี้ (${facts.length} เรื่อง):\n\n${lines}`, replyTo: msgId }]);
    }

    // ===== ลิงก์: เก็บเข้าคลัง / อ่านประกอบคำตอบ =====
    const urls = [...extractUrls(text), ...extractUrls(replyText)].slice(0, 3);
    const saveLinkIntent = urls.length > 0 && /เก็บ|บันทึก|เซฟ|save|เข้าคลัง|ลงคลัง|จำลิงก์|อ่านเก็บ/i.test(text);
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

    // ===== ปฏิทิน: ดู =====
    if (CAL_VIEW_RE.test(text)) {
      const ups = await getUpcoming(chatId, 12);
      const t = ups.length
        ? `นัดที่จะถึงครับ 🗓\n\n${ups.map((e) => `• ${thaiDate(e.date)}${e.timeText ? ` ${e.timeText}` : ""} — ${e.title}${e.emoji ? ` ${e.emoji}` : ""}`).join("\n")}`
        : `ปฏิทินโล่งครับ ไม่มีนัดเลย 🎯 อยากลงอะไรบอกมา`;
      return reply([{ kind: "text", text: t, replyTo: msgId }]);
    }
    // ===== ปฏิทิน: ลงนัด =====
    if (CAL_CREATE_RE.test(text)) {
      try {
        const parsedList = await extractEvents(text);
        if (parsedList.length) {
          const sends: Send[] = [];
          const lines: string[] = [];
          for (const parsed of parsedList) {
            const ev = await createEvent({ chatId, parsed, createdById: fromId, creatorName: fromName || undefined, agent: "kiki" });
            const timeStr = ev.timeText ? ` ${ev.timeText}${parsed.endTime ? `–${parsed.endTime}` : ""} น.` : " (ทั้งวัน)";
            lines.push(`• ${ev.title} — ${thaiDate(ev.date)}${timeStr}${ev.gcalLink ? `\n  🔗 ${ev.gcalLink}` : ""}`);
            try {
              const png = await renderHtmlToPng(buildCalendarDayHtml(ev, parsed), { width: 1000 });
              sends.push({ kind: "photo", dataBase64: png.toString("base64"), caption: `🗓 ${ev.title} · ${thaiDate(ev.date)}` });
            } catch { /* ภาพพลาดไม่เป็นไร */ }
          }
          const t = await vexSay(
            `เพิ่งลงนัดให้เจ้าของ ${parsedList.length} รายการ — ยืนยันสั้น ๆ ว่าลงแล้ว ถึงวันจะเตือน`,
            lines,
            `ลงนัดให้แล้วครับ ⏰\n\n${lines.join("\n")}\n\nถึงวันผมเตือนเอง`,
          );
          sends.push({ kind: "text", text: t, replyTo: msgId });
          return reply(sends);
        }
      } catch { /* แยกไม่ได้ → คุยปกติให้ถามต่อ */ }
    }

    // ===== สรุปเป็น HTML (เจ้าของสั่ง "สรุป..." = เอกสาร HTML ละเอียดเสมอ) =====
    if (/^\s*(ขอ)?(ช่วย)?(ทำ)?สรุป/.test(text)) {
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
    if (imageFiles.length) {
      ctxParts.push(`เจ้าของส่งรูปมา ${imageFiles.length} รูป — เปิดอ่านด้วยเครื่องมือ Read ตาม path แล้วตอบจากเนื้อหาจริงในรูป (ห้ามบอกว่าไม่เห็นรูป):\n${imageFiles.map((p, i) => `${i + 1}. ${p}`).join("\n")}`);
    }
    if (urls.length) {
      for (const u of urls.slice(0, 2)) {
        try {
          const c = await fetchUrlContent(u);
          ctxParts.push(`เนื้อหาจากลิงก์ที่ส่งมา (อ่านให้แล้ว ใช้ตอบได้เลย):\n### ${c.title}\n${c.text.slice(0, 6000)}`);
        } catch { /* เปิดไม่ได้ก็ตอบเท่าที่รู้ */ }
      }
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

    const answer = await askKiki(text || "(เจ้าของส่งรูปมาโดยไม่มีข้อความ — ดูรูปแล้วตอบตามเนื้อหา)", ctxParts.join("\n\n") || undefined);
    return reply([{ kind: "text", text: answer.slice(0, 3900), replyTo: msgId }]);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return ok([{ kind: "text", text: `สมองค้างแป๊บครับ ⚠️ (${detail.slice(0, 200)})\nลองพิมพ์ใหม่อีกทีนะครับ` }]);
  }
}
