import { renderHtmlToPng } from "@/lib/html-pdf";
import { classifyPendingTxn, hasPendingTxn } from "@/lib/kiki-gmail";
import { vexList } from "@/lib/kiki-format";
import { kikiConversation, vexLine } from "@/lib/kiki";
import { extractFinance, recordTxns, deleteLastTxn, editFinance, setBudget, fmtBaht, TOTAL_BUDGET_KEY, EXPENSE_CATS, itemizedText, type ItemizedPeriod } from "@/lib/kiki-finance";
import { financeCardPng, vexSay, storeSlips, FINANCE_VERB_RE } from "../shared";
import type { Ctx, Handler } from "../types";
import { ok, type Send } from "../types";

export const financeAdviceHandler: Handler = async (ctx) => {
  const { text, replyText, msgId, is, reply } = ctx;
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

  return null;
};

export const financeDeleteLastHandler: Handler = async (ctx) => {
  const { text, msgId, reply } = ctx;
  // ===== ลบรายการเงินล่าสุด (ทางลัด — เฉพาะพูดถึง "ล่าสุด/เมื่อกี้" ชัด ๆ) =====
  if (/(ลบ|ยกเลิก|เอาออก).{0,12}(อันเมื่อกี้|ล่าสุด|เมื่อกี้)|บันทึกผิด|ลงผิด/i.test(text)) {
    const last = await deleteLastTxn();
    if (!last) return reply([{ kind: "text", text: await vexLine("ยังไม่มีรายการให้ลบเลยครับ 🎯"), replyTo: msgId }]);
    const t = `ลบให้แล้วครับ ✅\n\n${last.type === "income" ? "รับ" : "จ่าย"} ${fmtBaht(last.amount)} ฿ · ${last.category}${last.note ? ` · ${last.note}` : ""}`;
    return reply([{ kind: "text", text: t, replyTo: msgId }]);
  }

  return null;
};

export const financeEditHandler: Handler = async (ctx) => {
  const { text, replyText, msgId, is, reply } = ctx;
  // ===== แก้บัญชีด้วยภาษาคน (ลบตัวซ้ำ/แก้ยอด/เปลี่ยนตัวเลข — Vex ลงมือเองจริง) =====
  if (is("finance_edit")) {
    const r = await editFinance([replyText, text].filter(Boolean).join("\n"));
    if (!r.applied.length) {
      return reply([{ kind: "text", text: await vexLine(`ยังไม่ได้แตะอะไรนะครับ ⚠️ ${r.reason || "ไม่แน่ใจว่าหมายถึงรายการไหน"}\n\nบอกชื่อรายการ+ยอดชัด ๆ ได้เลย เช่น "ลบรายการเงินเดือน 20,739.12 ที่ซ้ำ"`), replyTo: msgId }]);
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

  return null;
};

export const budgetHandler: Handler = async (ctx) => {
  const { text, msgId, is, reply } = ctx;
  // ===== ตั้งงบ =====
  const budgetM = text.match(/ตั้งงบ\s*([ก-๙a-zA-Z/]*)\s*(?:เดือนละ|ต่อเดือน)?\s*([\d,]+(?:\.\d+)?)/);
  // เจตนา finance_budget ไม่เคยมีตัวรับ — พูดว่า "เดือนนี้ขอใช้ไม่เกินสองหมื่น" แล้วคำสั่งหายเงียบ
  // ตั้งงบเป็นการเขียนข้อมูลจริง ถ้าจับตัวเลขไม่ได้ต้องถามกลับ ห้ามเดา (ซ่อม 4 ส.ค. 2026)
  if (!budgetM && is("finance_budget")) {
    return reply([{
      kind: "text",
      text: await vexLine('จะตั้งงบเดือนละเท่าไหร่ครับ บอกตัวเลขมาได้เลย เช่น "ตั้งงบเดือนละ 20000" หรือระบุหมวดก็ได้ "ตั้งงบอาหาร 6000"'),
      replyTo: msgId,
    }]);
  }
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

  return null;
};

export const ownAccountsHandler: Handler = async (ctx) => {
  const { text, msgId, reply } = ctx;
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
    return reply([{ kind: "text", text: `จำแล้วครับ ✅ โอนไปหา "${ownAccM[1].trim()}" = ย้ายเงินตัวเอง ไม่นับเป็นรายจ่าย\n\nบัญชีตัวเองทั้งหมด: ${list.join(" · ")}`, replyTo: msgId }]); // canned-ok: ต่อท้ายด้วยลิสต์บัญชีจริง
  }

  return null;
};

export const balanceHandler: Handler = async (ctx) => {
  const { text, msgId, reply } = ctx;
  // ===== ยอดเงินในบัญชี + เส้นเงินสด 30 วัน (2.1) =====
  const balM = text.match(/(?:ยอด(?:เงิน)?ใน(?:บัญชี|แบงค์|ธนาคาร)|เงินในบัญชี)\s*(?:ตอนนี้|เหลือ)?\s*[:：]?\s*([\d,]+(?:\.\d+)?)/);
  if (balM) {
    const { setBalance, cashForecast30 } = await import("@/lib/kiki-finance");
    const amt = Number(balM[1].replace(/,/g, ""));
    await setBalance(amt);
    const fc = await cashForecast30().catch(() => null);
    return reply([{ kind: "text", text: `ตั้งยอดตั้งต้น ${fmtBaht(amt)} ฿ แล้วครับ ✅ ต่อจากนี้ผมคำนวณยอดคงเหลือจากรายการที่บันทึกให้เอง\n\n${fc ? fc.lines.join("\n") : ""}`.trim(), replyTo: msgId }]); // canned-ok: ต่อท้ายด้วยเส้นเงินสดที่คำนวณจริง
  }
  return null;
};

export const forecastHandler: Handler = async (ctx) => {
  const { text, msgId, is, reply } = ctx;
  if (is("finance_forecast")) {
    const { cashForecast30 } = await import("@/lib/kiki-finance");
    const fc = await cashForecast30().catch(() => null);
    if (!fc) return reply([{ kind: "text", text: await vexLine(`ยังคำนวณไม่ได้ครับ — บอกยอดตั้งต้นก่อน เช่น "ยอดในบัญชีตอนนี้ 25,000" แล้วผมจะพยากรณ์ 30 วันข้างหน้าให้ (บิลประจำ+pace ใช้จริง)`), replyTo: msgId }]);
    return reply([{ kind: "text", text: fc.lines.join("\n"), replyTo: msgId }]);
  }

  return null;
};

export const billHandler: Handler = async (ctx) => {
  const { text, replyText, msgId, is, reply } = ctx;
  // ===== บิลประจำ / subscription (1.2) =====
  if (is("bill")) {
    const { handleBillCommand } = await import("@/lib/kiki-finance");
    const t = await handleBillCommand([replyText, text].filter(Boolean).join("\n"));
    return reply([{ kind: "text", text: t, replyTo: msgId }]);
  }

  return null;
};

export const merchantsHandler: Handler = async (ctx) => {
  const { text, msgId, reply } = ctx;
  // ===== ร้านประจำ (1.1) — ดูรายการที่ระบบจำได้ =====
  if (/ร้านประจำ(มี)?อะไรบ้าง|ลิสต์ร้านประจำ|ร้านที่จำได้/.test(text)) {
    const { listMerchants } = await import("@/lib/kiki-finance");
    return reply([{ kind: "text", text: await listMerchants(), replyTo: msgId }]);
  }

  return null;
};

export const financeHealthHandler: Handler = async (ctx) => {
  const { text, msgId, is, reply } = ctx;
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

  return null;
};

export const financeAnalyzeHandler: Handler = async (ctx) => {
  const { text, replyText, msgId, is, reply } = ctx;
  // ===== ถามวิเคราะห์อิสระ (2.3) — text→query บน DB ตัวเลขไม่ผ่าน AI =====
  if (is("finance_analyze")) {
    const { analyzeFinance } = await import("@/lib/kiki-finance");
    const t = await analyzeFinance([replyText, text].filter(Boolean).join("\n"));
    return reply([{ kind: "text", text: t, replyTo: msgId }]);
  }

  return null;
};

export const financeItemizeHandler: Handler = async (ctx) => {
  const { text, msgId, is, reply } = ctx;
  // ===== "ซื้อ/ใช้อะไรไปบ้าง" — ลิสต์รายการรายตัว (ตัวเลขจาก DB ตรง ๆ) =====
  if (is("finance_itemize")) {
    const period: ItemizedPeriod = /เมื่อวาน/.test(text) ? "yesterday"
      : /สัปดาห์|อาทิตย์(นี้|ที่ผ่าน)/.test(text) ? "week"
      : /เดือนนี้|ทั้งเดือน/.test(text) ? "month"
      : "today";
    const t = await itemizedText(period);
    return reply([{ kind: "text", text: t, replyTo: msgId }]);
  }

  return null;
};

export const financeQueryHandler: Handler = async (ctx) => {
  const { text, msgId, is, reply } = ctx;
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

  return null;
};

export const pendingBatchHandler: Handler = async (ctx) => {
  const { text, replyText, msgId, is, reply } = ctx;
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
    return reply([{ kind: "text", text: await vexLine("จับคู่รายการไม่ได้เลยครับ ⚠️ ขอลิสต์ใหม่แล้วอ้างเลขข้อได้เลย"), replyTo: msgId }]);
  }
  return null;
};

export const pendingListHandler: Handler = async (ctx) => {
  const { text, replyText, msgId, is, reply } = ctx;
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
    return reply([{ kind: "text", text: await vexLine("ไม่มีรายการค้างระบุเลยครับ เคลียร์หมดแล้ว"), replyTo: msgId }]);
  }

  return null;
};

export const pendingAnswerHandler: Handler = async (ctx) => {
  const { text, replyText, imageFiles, msgId, reply } = ctx;
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
      sends.push({ kind: "text", text: await vexLine(`เข้าใจแล้วครับ ✅ ${done.msg}`), replyTo: msgId });
      if (todayList) sends.push({ kind: "text", text: todayList });
      return reply(sends);
    }
  }

  return null;
};

export const financeRecordHandler: Handler = async (ctx) => {
  const { text, replyText, imageFiles, msgId, is, reply } = ctx;
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

  return null;
};
