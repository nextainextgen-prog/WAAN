import { askKiki, vexLine, getSetting, setSetting } from "@/lib/kiki";
import { resetFinance, spendVsDebt, fmtBaht } from "@/lib/kiki-finance";
import { vexList } from "@/lib/kiki-format";
import { db } from "@/lib/db";
import type { Handler, Send } from "../types";

/**
 * ล้างบัญชีเริ่มนับใหม่ + แยกค่าใช้จ่ายกับหนี้ (เจ้าของสั่ง 6 ส.ค. 2026)
 *
 * **เคสจริงที่พัง:** เจ้าของสั่ง *"เรื่องเงินเรามาเริ่ม 0 ใหม่ทั้งหมด ล้างออกหมดเลย"*
 * แล้วสั่งซ้ำอีกรอบ *"ผมบอกลบออกให้หมด แล้วเริ่มนับใหม่"*
 * ระบบตอบว่า **"ยังไม่ได้แตะอะไรนะครับ"** ทั้งสองครั้ง แล้วขอให้ยืนยันอีก
 * — ขอยืนยันทั้งที่ไม่มีปลายทางให้ไปต่อ เพราะความสามารถนี้ไม่เคยมีอยู่จริง
 *
 * ที่ทำตอนนี้: ทำได้จริง แต่ **สำรองลงไฟล์ก่อนลบเสมอ** และกู้คืนได้
 * ยืนยันครั้งเดียวด้วยปุ่ม (ลบข้อมูลจริงของเจ้าของ ถามครั้งเดียวคือพอดี ไม่ใช่ถามวน)
 */

const PENDING = "kiki_pending_reset";

export const financeResetHandler: Handler = async (ctx) => {
  const { text, msgId, is, channel, reply } = ctx;

  // กดปุ่มยืนยัน / ยกเลิก
  if (text === "[ปุ่ม:ล้างบัญชี]" || text === "[ปุ่ม:ไม่ล้าง]") {
    const raw = await getSetting(PENDING);
    await setSetting(PENDING, "");
    if (text === "[ปุ่ม:ไม่ล้าง]") {
      return reply([{ kind: "text", text: await vexLine("ไม่ล้างแล้วครับ ข้อมูลอยู่ครบเหมือนเดิม"), replyTo: msgId }]);
    }
    let scope: "month" | "all" = "all";
    try { scope = (JSON.parse(raw || "{}") as { scope?: "month" | "all" }).scope || "all"; } catch { /* ค่าเริ่มต้น */ }
    const r = await resetFinance({ scope });
    const t = await askKiki(
      `[ล้างบัญชีให้แล้วจริง] ลบรายการเงิน${r.scope} ไป ${r.deleted} รายการ\n` +
        `สำรองไว้ที่ ${r.backupFile} — ลบผิดบอกได้ กู้คืนได้ทั้งชุด\n\n` +
        `ยืนยันสั้น ๆ ว่าล้างแล้วเริ่มนับใหม่ได้เลย + บอกว่ากู้คืนได้ถ้าเปลี่ยนใจ ไม่เกิน 3 บรรทัด`,
    ).catch(() => `ล้างบัญชีให้แล้วครับ ✅ ลบไป ${r.deleted} รายการ (สำรองไว้แล้ว กู้คืนได้)`); // canned-ok: ตัวดักพัง — ผลการลบข้อมูลจริงต้องถึงมือเสมอ
    return reply([{ kind: "text", text: t, replyTo: msgId }]);
  }

  if (!is("finance_reset")) return null;

  // ขอบเขต: เดือนนี้ หรือทั้งหมด — ให้ตัวอ่านเจตนาบอกมา ไม่ใช่เดาจากคำ
  const scope: "month" | "all" = ctx.arg("scope") === "month" || /เดือนนี้/.test(text) ? "month" : "all";
  const now = new Date();
  const where = scope === "month"
    ? { occurredAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1), lt: new Date(now.getFullYear(), now.getMonth() + 1, 1) } }
    : {};
  const rows = await db.financeTxn.findMany({ where });
  if (!rows.length) {
    return reply([{ kind: "text", text: await vexLine("ไม่มีรายการให้ล้างอยู่แล้วครับ บัญชีว่างเปล่า เริ่มส่งใหม่ได้เลย"), replyTo: msgId }]);
  }

  const exp = rows.filter((r) => r.type === "expense").reduce((s, r) => s + r.amount, 0);
  const inc = rows.filter((r) => r.type === "income").reduce((s, r) => s + r.amount, 0);
  await setSetting(PENDING, JSON.stringify({ scope, at: Date.now(), channel }));

  const block = vexList({
    title: `จะล้าง ${rows.length} รายการ (${scope === "month" ? "เดือนนี้" : "ทั้งหมด"})`,
    items: [
      `รายจ่าย ${fmtBaht(exp)} ฿`,
      `รายรับ ${fmtBaht(inc)} ฿`,
      `ช่วง ${rows[0]?.occurredAt.toLocaleDateString("th-TH")} ถึง ${rows[rows.length - 1]?.occurredAt.toLocaleDateString("th-TH")}`,
    ],
    note: "สำรองไฟล์ไว้ก่อนลบเสมอ — ลบผิดบอกได้ กู้คืนได้ทั้งชุด",
  });

  return reply([
    { kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId },
    {
      kind: "text",
      text: await vexLine("กดยืนยันแล้วผมล้างให้เลย เริ่มนับใหม่ได้ทันที"),
      buttons: [[{ text: "🗑 ล้างเลย", data: "kiki:reset:yes" }, { text: "❌ ไม่ล้าง", data: "kiki:reset:no" }]],
    },
  ]);
};

/** แยกค่าใช้จ่าย / บิลประจำ / หนี้ ให้เห็นว่าจ่ายไปแล้วเท่าไหร่ เหลืออีกเท่าไหร่ */
export const financeSplitHandler: Handler = async (ctx) => {
  const { msgId, is, reply } = ctx;
  if (!is("finance_split")) return null;
  const lines = await spendVsDebt();
  const block = vexList({ title: "แยกค่าใช้จ่ายกับหนี้", items: lines });
  const sends: Send[] = [{ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId }];
  const say = await askKiki(
    `[แยกค่าใช้จ่ายกับหนี้ให้เจ้าของ] ข้อเท็จจริง (ห้ามเปลี่ยนตัวเลข):\n${lines.join("\n")}\n\n` +
      `ชี้จุดที่สำคัญที่สุด 1-2 บรรทัด · ถ้าหนี้หรือบิลยังไม่ได้บันทึกไว้ ให้ขอข้อมูลนั้นตรง ๆ`,
  ).catch(() => null);
  if (say) sends.push({ kind: "text", text: say });
  return reply(sends);
};
