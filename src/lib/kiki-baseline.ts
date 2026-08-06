import { db } from "./db";
import { getSetting, setSetting, askExtractor } from "./kiki";
import { fmtBaht } from "./kiki-finance";

/**
 * ฐานข้อมูลการเงินหลัก 4 อย่าง (เจ้าของสั่ง 6 ส.ค. 2026)
 *
 * *"พร้อมช่องทางรับข้อมูลการเงินหลัก 4 อย่าง (รายรับจริงต่อเดือน · รายจ่ายตัดประจำ ·
 *   เงินเก็บ · หนี้ค้าง) เข้าระบบถาวรเพื่อใช้เป็นฐานวิเคราะห์แทนการเดาจากยอดไม่กี่วัน"*
 *
 * ทำไมจำเป็น: ที่ผ่านมาการวิเคราะห์อิง `financeSnapshot()` ซึ่งนับจากรายการที่บันทึกไว้
 * ในเดือนนั้นล้วน ๆ — เดือนที่เพิ่งเริ่มหรือเดือนที่ลืมบันทึก ตัวเลขจะเพี้ยนหนัก
 * (เคสจริง 6 ส.ค.: บรีฟบอก "ติดลบ 3,732" ทั้งที่ 92% ของยอดคือก้อน "รอระบุ" ที่ยังไม่รู้ว่าอะไร)
 *
 * ออกแบบให้ **ไม่เก็บซ้ำกับของที่มีอยู่แล้ว**:
 *  - รายจ่ายตัดประจำ → อ่านจาก `RecurringBill` (มีอยู่แล้ว มีวันตัดด้วย)
 *  - หนี้ค้าง → อ่านจาก `Debt` (มีอยู่แล้ว มีงวดผ่อนด้วย)
 *  - เก็บเพิ่มแค่ 2 ตัวที่ยังไม่มีที่อยู่: รายรับจริงต่อเดือน · เงินเก็บ
 */

const KEY = "vex_finance_baseline";

interface Stored {
  monthlyIncome?: number;   // รายรับจริงต่อเดือน (เฉลี่ยที่เข้าจริง ไม่ใช่เงินเดือนบนกระดาษ)
  incomeNote?: string;      // มาจากไหนบ้าง
  savings?: number;         // เงินเก็บที่มีอยู่ตอนนี้
  savingsNote?: string;     // อยู่ที่ไหน แตะได้ไหม
  updatedAt?: number;
}

export interface Baseline {
  monthlyIncome: number | null;
  incomeNote: string;
  savings: number | null;
  savingsNote: string;
  fixedExpenses: { label: string; amount: number; day: number }[];
  fixedTotal: number;
  debts: { person: string; amount: number; perMonth: number | null }[];
  debtTotal: number;
  debtPerMonth: number;
  updatedAt: number | null;
  /** อะไรที่ยังไม่รู้ — เอาไว้ขอจากเจ้าของ และเอาไว้เตือนว่าวิเคราะห์บนข้อมูลไม่ครบ */
  missing: string[];
}

async function read(): Promise<Stored> {
  try {
    return JSON.parse((await getSetting(KEY)) || "{}") as Stored;
  } catch {
    return {};
  }
}

export async function getBaseline(): Promise<Baseline> {
  const s = await read();
  const bills = await db.recurringBill.findMany({ where: { active: true } }).catch(() => []);
  const fixed = bills.filter((b) => b.type !== "income").map((b) => ({ label: b.label, amount: b.amount, day: b.dayOfMonth }));
  const debtRows = await db.debt.findMany({ where: { settledAt: null, direction: "i_owe" } }).catch(() => []);
  const debts = debtRows.map((d) => ({ person: d.person, amount: d.amount, perMonth: d.installmentAmount ?? null }));

  const missing: string[] = [];
  if (typeof s.monthlyIncome !== "number") missing.push("รายรับจริงต่อเดือน");
  if (!fixed.length) missing.push("รายจ่ายที่ตัดประจำทุกเดือน");
  if (typeof s.savings !== "number") missing.push("เงินเก็บที่มีอยู่ตอนนี้");
  if (!debts.length) missing.push("หนี้ค้าง (ถ้าไม่มีเลยก็บอกว่าไม่มี)");

  return {
    monthlyIncome: s.monthlyIncome ?? null,
    incomeNote: s.incomeNote || "",
    savings: s.savings ?? null,
    savingsNote: s.savingsNote || "",
    fixedExpenses: fixed,
    fixedTotal: fixed.reduce((a, b) => a + b.amount, 0),
    debts,
    debtTotal: debts.reduce((a, b) => a + b.amount, 0),
    debtPerMonth: debts.reduce((a, b) => a + (b.perMonth || 0), 0),
    updatedAt: s.updatedAt ?? null,
    missing,
  };
}

export async function saveBaseline(patch: Pick<Stored, "monthlyIncome" | "incomeNote" | "savings" | "savingsNote">): Promise<void> {
  const cur = await read();
  const next: Stored = { ...cur, updatedAt: Date.now() };
  if (typeof patch.monthlyIncome === "number") next.monthlyIncome = patch.monthlyIncome;
  if (patch.incomeNote) next.incomeNote = patch.incomeNote;
  if (typeof patch.savings === "number") next.savings = patch.savings;
  if (patch.savingsNote) next.savingsNote = patch.savingsNote;
  await setSetting(KEY, JSON.stringify(next));
}

/**
 * แกะตัวเลขจากภาษาคน — เจ้าของพิมพ์ยาว ๆ ทีเดียวได้เลย
 * ("เงินเข้าเดือนละ 45000 มีเก็บอยู่ 80000 ผ่อนรถ 7500 ทุกวันที่ 5 ค่าเน็ต 599")
 */
export async function parseBaselineText(text: string): Promise<{
  monthlyIncome?: number; incomeNote?: string; savings?: number; savingsNote?: string;
  bills: { label: string; amount: number; dayOfMonth: number }[];
  debts: { person: string; amount: number; installmentAmount?: number; installmentDay?: number }[];
}> {
  const raw = await askExtractor(text.slice(0, 3000), {
    system: `แกะข้อมูลการเงินหลักจากที่เจ้าของพิมพ์มา ตอบ JSON เท่านั้น:
{"monthlyIncome":<ตัวเลข หรือไม่ใส่>,"incomeNote":"มาจากไหน","savings":<ตัวเลข>,"savingsNote":"อยู่ที่ไหน",
 "bills":[{"label":"ชื่อรายการ","amount":<ตัวเลข>,"dayOfMonth":<1-31 ไม่รู้ใส่ 1>}],
 "debts":[{"person":"เจ้าหนี้/ชื่อหนี้","amount":<ยอดคงเหลือ>,"installmentAmount":<งวดละ ถ้ามี>,"installmentDay":<วันที่ตัด ถ้ามี>}]}

กติกา
- ใส่เฉพาะที่เจ้าของบอกจริง ห้ามเดาตัวเลขเอง ไม่ได้พูดถึง = ไม่ต้องใส่คีย์นั้น
- "หมื่น/แสน/k" แปลงเป็นตัวเลขเต็ม เช่น 45k = 45000 · สี่หมื่นห้า = 45000
- รายจ่ายที่ตัดทุกเดือน (ค่าเน็ต ค่าบ้าน ประกัน subscription) = bills
- เงินที่ยังติดคนอื่น/ผ่อนอยู่ = debts
- บอกว่า "ไม่มีหนี้" = debts เป็น array ว่าง`,
    timeoutMs: 45_000,
  });
  const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}") as Record<string, unknown>;
  return {
    monthlyIncome: typeof j.monthlyIncome === "number" ? j.monthlyIncome : undefined,
    incomeNote: typeof j.incomeNote === "string" ? j.incomeNote : undefined,
    savings: typeof j.savings === "number" ? j.savings : undefined,
    savingsNote: typeof j.savingsNote === "string" ? j.savingsNote : undefined,
    bills: Array.isArray(j.bills) ? (j.bills as { label: string; amount: number; dayOfMonth: number }[]) : [],
    debts: Array.isArray(j.debts) ? (j.debts as { person: string; amount: number; installmentAmount?: number; installmentDay?: number }[]) : [],
  };
}

/** บันทึกทั้งชุดลงที่ที่ถูกต้องของแต่ละอย่าง (บิลลง RecurringBill · หนี้ลง Debt) */
export async function applyBaseline(p: Awaited<ReturnType<typeof parseBaselineText>>): Promise<string[]> {
  const done: string[] = [];
  if (typeof p.monthlyIncome === "number" || typeof p.savings === "number") {
    await saveBaseline(p);
    if (typeof p.monthlyIncome === "number") done.push(`รายรับต่อเดือน ${fmtBaht(p.monthlyIncome)} ฿`);
    if (typeof p.savings === "number") done.push(`เงินเก็บ ${fmtBaht(p.savings)} ฿`);
  }
  for (const b of p.bills) {
    if (!b.label || !(b.amount > 0)) continue;
    const exists = await db.recurringBill.findFirst({ where: { label: b.label, active: true } }).catch(() => null);
    if (exists) await db.recurringBill.update({ where: { id: exists.id }, data: { amount: b.amount, dayOfMonth: b.dayOfMonth || exists.dayOfMonth } }).catch(() => {});
    else await db.recurringBill.create({ data: { label: b.label, amount: b.amount, dayOfMonth: b.dayOfMonth || 1, source: "manual" } }).catch(() => {});
    done.push(`บิล ${b.label} ${fmtBaht(b.amount)} ฿ (ตัดวันที่ ${b.dayOfMonth || 1})`);
  }
  for (const d of p.debts) {
    if (!d.person || !(d.amount > 0)) continue;
    const exists = await db.debt.findFirst({ where: { person: d.person, settledAt: null, direction: "i_owe" } }).catch(() => null);
    const data = { amount: d.amount, installmentAmount: d.installmentAmount ?? null, installmentDay: d.installmentDay ?? null };
    if (exists) await db.debt.update({ where: { id: exists.id }, data }).catch(() => {});
    else await db.debt.create({ data: { direction: "i_owe", person: d.person, ...data } }).catch(() => {});
    done.push(`หนี้ ${d.person} ${fmtBaht(d.amount)} ฿${d.installmentAmount ? ` (งวดละ ${fmtBaht(d.installmentAmount)} ฿)` : ""}`);
  }
  return done;
}

/**
 * บล็อกฐานการเงินสำหรับฉีดเข้าบริบท — ตัวนี้คือ "ความจริงตั้งต้น" ที่ใช้แทนการเดาจากยอดไม่กี่วัน
 * ขาดอะไรต้องบอกด้วย ไม่งั้นจะวิเคราะห์บนข้อมูลไม่ครบโดยไม่มีใครรู้
 */
export async function baselineContext(): Promise<string> {
  const b = await getBaseline();
  if (b.monthlyIncome === null && !b.fixedExpenses.length && b.savings === null && !b.debts.length) return "";
  const lines: string[] = [];
  if (b.monthlyIncome !== null) lines.push(`รายรับจริงต่อเดือน: ${fmtBaht(b.monthlyIncome)} ฿${b.incomeNote ? ` (${b.incomeNote})` : ""}`);
  if (b.fixedExpenses.length) {
    lines.push(`รายจ่ายตัดประจำรวม: ${fmtBaht(b.fixedTotal)} ฿/เดือน`);
    for (const f of b.fixedExpenses) lines.push(`  · ${f.label} ${fmtBaht(f.amount)} ฿ (วันที่ ${f.day})`);
  }
  if (b.savings !== null) lines.push(`เงินเก็บที่มี: ${fmtBaht(b.savings)} ฿${b.savingsNote ? ` (${b.savingsNote})` : ""}`);
  if (b.debts.length) {
    lines.push(`หนี้ค้างรวม: ${fmtBaht(b.debtTotal)} ฿${b.debtPerMonth ? ` · ต้องจ่ายเดือนละ ${fmtBaht(b.debtPerMonth)} ฿` : ""}`);
    for (const d of b.debts) lines.push(`  · ${d.person} ${fmtBaht(d.amount)} ฿${d.perMonth ? ` (งวดละ ${fmtBaht(d.perMonth)} ฿)` : ""}`);
  }
  if (b.monthlyIncome !== null) {
    const free = b.monthlyIncome - b.fixedTotal - b.debtPerMonth;
    lines.push(`เหลือใช้จริงหลังหักตัดประจำและงวดหนี้: ${fmtBaht(free)} ฿/เดือน`);
  }
  const head = `=== ฐานการเงินหลักของเจ้าของ (ตัวเลขตั้งต้น ใช้อันนี้เป็นหลักในการวิเคราะห์) ===`;
  const tail = b.missing.length
    ? `\n\nยังไม่รู้: ${b.missing.join(" · ")}\nวิเคราะห์ต่อได้ แต่ต้องบอกเจ้าของด้วยว่าตัวเลขไหนยังขาด และขอเพิ่มตอนจบ`
    : "";
  return `${head}\n${lines.join("\n")}${tail}`;
}
