import { askKiki, vexLine } from "@/lib/kiki";
import { getBaseline, parseBaselineText, applyBaseline, baselineContext } from "@/lib/kiki-baseline";
import { vexSections, type VexRow } from "@/lib/kiki-format";
import { fmtBaht } from "@/lib/kiki-finance";
import type { Handler, Send } from "../types";

/**
 * ฐานการเงินหลัก 4 อย่าง (เจ้าของสั่ง 6 ส.ค. 2026)
 * รายรับจริงต่อเดือน · รายจ่ายตัดประจำ · เงินเก็บ · หนี้ค้าง
 *
 * เก็บถาวรเพื่อใช้เป็นฐานวิเคราะห์ แทนการเดาจากยอดไม่กี่วันที่บันทึกไว้ในเดือนนั้น
 */
export const baselineHandler: Handler = async (ctx) => {
  const { text, replyText, msgId, is, reply } = ctx;
  if (!is("finance_baseline")) return null;

  const input = [replyText, text].filter(Boolean).join("\n");
  const parsed = await parseBaselineText(input).catch(() => null);
  const hasNew = parsed && (
    typeof parsed.monthlyIncome === "number" || typeof parsed.savings === "number" ||
    parsed.bills.length > 0 || parsed.debts.length > 0
  );

  const applied = hasNew && parsed ? await applyBaseline(parsed).catch(() => null) : null;

  const b = await getBaseline();
  const sections = [];

  // ลงอะไรไปบ้าง — ต้องกวาดตาแล้วตรวจได้ทันที ไม่ใช่ "บันทึกแล้ว" ลอย ๆ
  // (6 ส.ค. ตอบว่าบันทึกเรียบร้อยทั้งที่หายไป 3 ก้อน เพราะไม่เคยรายงานว่าลงกี่ก้อนจากกี่ก้อน)
  if (applied) {
    const rowOf = (r: { what: string; detail: string; action: string; incomplete?: string }): VexRow => ({
      main: `${r.action === "new" ? "＋" : "↻"} ${r.what}`,
      value: r.detail,
      sub: r.incomplete ? `ยังขาด: ${r.incomplete}` : undefined,
    });
    if (applied.income.length)
      sections.push({ icon: "💵", head: "รายรับ / เงินเก็บ", lines: applied.income.map(rowOf) as (string | VexRow)[] });
    if (applied.debts.length)
      sections.push({
        icon: "💳", head: "หนี้ที่ลงให้", sub: `${applied.saved.debts}/${applied.seen.debts} ก้อน`,
        lines: applied.debts.map(rowOf) as (string | VexRow)[],
      });
    if (applied.bills.length)
      sections.push({
        icon: "🧾", head: "บิลประจำที่ลงให้", sub: `${applied.saved.bills}/${applied.seen.bills} รายการ`,
        lines: applied.bills.map(rowOf) as (string | VexRow)[],
      });
    if (applied.warnings.length)
      sections.push({ icon: "⚠️", head: "ต้องดูก่อน", accent: true, lines: applied.warnings.map((w) => ({ main: w })) });
  }

  const now: VexRow[] = [];
  if (b.monthlyIncome !== null) now.push({ main: "รายรับจริงต่อเดือน", value: `${fmtBaht(b.monthlyIncome)} ฿` });
  if (b.fixedExpenses.length)
    now.push({
      main: `ตัดประจำ (${b.fixedExpenses.length} รายการ)`,
      value: `${fmtBaht(b.fixedTotal)} ฿/เดือน`,
      sub: b.fixedTotalMax > b.fixedTotal ? `เดือนที่แพงสุด ${fmtBaht(b.fixedTotalMax)} ฿` : undefined,
    });
  if (b.savings !== null) now.push({ main: "เงินเก็บที่มี", value: `${fmtBaht(b.savings)} ฿` });
  if (b.debts.length)
    now.push({
      main: `หนี้ค้าง (${b.debts.length} ก้อน)`,
      value: `${fmtBaht(b.debtTotal)} ฿${b.debtPerMonth ? ` · งวดละ ${fmtBaht(b.debtPerMonth)} ฿` : ""}`,
      sub: b.debtsUnknownAmount ? `อีก ${b.debtsUnknownAmount} ก้อนยังไม่รู้ยอด — ยอดจริงสูงกว่านี้` : undefined,
    });
  if (b.creditUsedPct !== null)
    now.push({
      main: "วงเงินบัตรที่ใช้ไป",
      value: `${b.creditUsedPct}%`,
      sub: `เหลือหมุนได้ ${fmtBaht(b.creditAvailableTotal)} ฿ จาก ${fmtBaht(b.creditLimitTotal)} ฿`,
      bold: b.creditUsedPct >= 80,
    });
  if (b.monthlyIncome !== null) {
    const free = b.monthlyIncome - b.fixedTotal - b.debtPerMonth;
    now.push({ main: "เหลือใช้จริงต่อเดือน", value: `${fmtBaht(free)} ฿`, bold: true });
  }
  if (now.length) sections.push({ icon: "📊", head: "ฐานการเงินตอนนี้", lines: now });

  if (b.missing.length) {
    sections.push({
      icon: "📥",
      head: "ยังขาดอยู่",
      sub: `${b.missing.length} อย่าง`,
      accent: true,
      lines: b.missing.map((m) => ({ main: m })),
    });
  }

  const sends: Send[] = [];
  if (sections.length) {
    const block = vexSections({
      titleIcon: "💰",
      title: "ฐานการเงินหลัก",
      subtitle: b.updatedAt ? `อัปเดตล่าสุด ${new Date(b.updatedAt).toLocaleString("th-TH")}` : undefined,
      sections,
    });
    sends.push({ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId });
  }

  const savedLine = applied
    ? `ลงหนี้ ${applied.saved.debts}/${applied.seen.debts} ก้อน · บิล ${applied.saved.bills}/${applied.seen.bills} รายการ`
    : "เจ้าของถามถึงฐานการเงิน ยังไม่ได้บันทึกอะไรใหม่รอบนี้";

  const say = await askKiki(
    `[ฐานการเงินหลัก] ${savedLine}\n` +
      `${applied?.warnings.length ? `เรื่องที่ต้องบอกตรง ๆ: ${applied.warnings.join(" · ")}\n` : ""}` +
      `${b.missing.length ? `ยังขาด: ${b.missing.join(" · ")}` : "ครบทั้ง 4 อย่างแล้ว"}\n\n` +
      `${applied?.warnings.length
        ? "เริ่มด้วยสิ่งที่ยังไม่เรียบร้อยก่อน ห้ามพูดว่าบันทึกครบถ้ามันไม่ครบ · แล้วขอของที่ขาดแบบสั้น ๆ"
        : b.missing.length
          ? "ขอสิ่งที่ขาดแบบสั้น ๆ บอกด้วยว่าพิมพ์รวดเดียวได้เลย ไม่ต้องตอบทีละข้อ · อธิบายสั้น ๆ ว่าทำไมต้องรู้ (จะได้วิเคราะห์จากของจริงแทนการเดาจากยอดไม่กี่วัน)"
          : "บอกว่าครบแล้ว และจากนี้จะวิเคราะห์จากตัวเลขจริงชุดนี้แทนการเดา · ชี้จุดที่น่าห่วงที่สุด 1 อย่างจากตัวเลขที่เห็น"}\n` +
      `ไม่เกิน 3 บรรทัด (การ์ดรายละเอียดส่งไปแล้ว)`,
  ).catch(() => null);

  sends.push({ kind: "text", text: say || (await vexLine(b.missing.length ? `ยังขาด ${b.missing.join(" · ")} ครับ พิมพ์มารวดเดียวได้เลย` : "ฐานการเงินครบแล้วครับ")) });
  return reply(sends);
};

/** ฐานการเงินสำหรับฉีดเข้าคำตอบอื่น ๆ (โหมดวิเคราะห์เชิงลึกใช้ตัวนี้) */
export { baselineContext };
