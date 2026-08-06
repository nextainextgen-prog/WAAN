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

  let done: string[] = [];
  if (hasNew && parsed) done = await applyBaseline(parsed).catch(() => []);

  const b = await getBaseline();
  const sections = [];

  if (done.length) {
    sections.push({ icon: "✅", head: "บันทึกเข้าฐานแล้ว", lines: done as (string | VexRow)[] });
  }

  const now: VexRow[] = [];
  if (b.monthlyIncome !== null) now.push({ main: "รายรับจริงต่อเดือน", value: `${fmtBaht(b.monthlyIncome)} ฿` });
  if (b.fixedExpenses.length) now.push({ main: `ตัดประจำ (${b.fixedExpenses.length} รายการ)`, value: `${fmtBaht(b.fixedTotal)} ฿/เดือน` });
  if (b.savings !== null) now.push({ main: "เงินเก็บที่มี", value: `${fmtBaht(b.savings)} ฿` });
  if (b.debts.length) now.push({ main: `หนี้ค้าง (${b.debts.length} ราย)`, value: `${fmtBaht(b.debtTotal)} ฿${b.debtPerMonth ? ` · งวดละ ${fmtBaht(b.debtPerMonth)} ฿` : ""}` });
  if (b.monthlyIncome !== null) {
    const free = b.monthlyIncome - b.fixedTotal - b.debtPerMonth;
    now.push({ main: "เหลือใช้จริงต่อเดือน", value: `${fmtBaht(free)} ฿`, bold: true });
  }
  if (now.length) sections.push({ icon: "🧾", head: "ฐานการเงินตอนนี้", lines: now });

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

  const say = await askKiki(
    `[ฐานการเงินหลัก] ${done.length ? `เพิ่งบันทึกให้: ${done.join(" · ")}` : "เจ้าของถามถึงฐานการเงิน ยังไม่ได้บันทึกอะไรใหม่รอบนี้"}\n` +
      `${b.missing.length ? `ยังขาด: ${b.missing.join(" · ")}` : "ครบทั้ง 4 อย่างแล้ว"}\n\n` +
      `${b.missing.length
        ? "ขอสิ่งที่ขาดแบบสั้น ๆ บอกด้วยว่าพิมพ์รวดเดียวได้เลย ไม่ต้องตอบทีละข้อ · อธิบายสั้น ๆ ว่าทำไมต้องรู้ (จะได้วิเคราะห์จากของจริงแทนการเดาจากยอดไม่กี่วัน)"
        : "บอกว่าครบแล้ว และจากนี้จะวิเคราะห์จากตัวเลขจริงชุดนี้แทนการเดา · ชี้จุดที่น่าห่วงที่สุด 1 อย่างจากตัวเลขที่เห็น"}\n` +
      `ไม่เกิน 3 บรรทัด (การ์ดรายละเอียดส่งไปแล้ว)`,
  ).catch(() => null);

  sends.push({ kind: "text", text: say || (await vexLine(b.missing.length ? `ยังขาด ${b.missing.join(" · ")} ครับ พิมพ์มารวดเดียวได้เลย` : "ฐานการเงินครบแล้วครับ")) });
  return reply(sends);
};

/** ฐานการเงินสำหรับฉีดเข้าคำตอบอื่น ๆ (โหมดวิเคราะห์เชิงลึกใช้ตัวนี้) */
export { baselineContext };
