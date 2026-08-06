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
  fixedExpenses: { label: string; amount: number; amountMax: number | null; day: number }[];
  fixedTotal: number;
  /** เพดานบนของบิลที่เป็นช่วง — เดือนที่แพงสุดจ่ายเท่าไหร่ */
  fixedTotalMax: number;
  debts: {
    person: string; amount: number; perMonth: number | null;
    amountKnown: boolean; kind: string | null;
    creditLimit: number | null; availableCredit: number | null;
    interestRate: number | null; termsTotal: number | null; termsPaid: number | null;
  }[];
  /** ยอดหนี้รวมเฉพาะก้อนที่รู้ยอดจริง — ก้อนที่ยังไม่รู้ห้ามเอามาบวกให้ดูเหมือนครบ */
  debtTotal: number;
  debtPerMonth: number;
  /** กี่ก้อนที่ลงไว้แล้วแต่ยังไม่รู้ยอดคงเหลือ */
  debtsUnknownAmount: number;
  /** วงเงินหมุนเวียนรวม / คงเหลือ / ใช้ไปกี่ % (null = ยังไม่มีข้อมูลวงเงินเลย) */
  creditLimitTotal: number;
  creditAvailableTotal: number;
  creditUsedPct: number | null;
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
  const fixed = bills.filter((b) => b.type !== "income").map((b) => ({ label: b.label, amount: b.amount, amountMax: b.amountMax ?? null, day: b.dayOfMonth }));
  const debtRows = await db.debt.findMany({ where: { settledAt: null, direction: "i_owe" } }).catch(() => []);
  const debts = debtRows.map((d) => ({
    person: d.person,
    amount: d.amount,
    perMonth: d.installmentAmount ?? null,
    amountKnown: d.amountKnown,
    kind: d.kind ?? null,
    creditLimit: d.creditLimit ?? null,
    availableCredit: d.availableCredit ?? null,
    interestRate: d.interestRate ?? null,
    termsTotal: d.termsTotal ?? null,
    termsPaid: d.termsPaid ?? null,
  }));

  const withLimit = debts.filter((d) => d.creditLimit !== null && d.availableCredit !== null);
  const creditLimitTotal = withLimit.reduce((a, b) => a + (b.creditLimit || 0), 0);
  const creditAvailableTotal = withLimit.reduce((a, b) => a + (b.availableCredit || 0), 0);
  const unknownAmount = debts.filter((d) => !d.amountKnown);

  const missing: string[] = [];
  if (typeof s.monthlyIncome !== "number") missing.push("รายรับจริงต่อเดือน");
  if (!fixed.length) missing.push("รายจ่ายที่ตัดประจำทุกเดือน");
  if (typeof s.savings !== "number") missing.push("เงินเก็บที่มีอยู่ตอนนี้");
  if (!debts.length) missing.push("หนี้ค้าง (ถ้าไม่มีเลยก็บอกว่าไม่มี)");
  for (const d of unknownAmount) missing.push(`ยอดคงเหลือของ ${d.person}`);

  return {
    monthlyIncome: s.monthlyIncome ?? null,
    incomeNote: s.incomeNote || "",
    savings: s.savings ?? null,
    savingsNote: s.savingsNote || "",
    fixedExpenses: fixed,
    fixedTotal: fixed.reduce((a, b) => a + b.amount, 0),
    fixedTotalMax: fixed.reduce((a, b) => a + (b.amountMax ?? b.amount), 0),
    debts,
    debtTotal: debts.filter((d) => d.amountKnown).reduce((a, b) => a + b.amount, 0),
    debtPerMonth: debts.reduce((a, b) => a + (b.perMonth || 0), 0),
    debtsUnknownAmount: unknownAmount.length,
    creditLimitTotal,
    creditAvailableTotal,
    creditUsedPct: creditLimitTotal > 0 ? Math.round(((creditLimitTotal - creditAvailableTotal) / creditLimitTotal) * 100) : null,
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

export interface ParsedBill {
  label: string;
  amount: number;
  amountMax?: number;   // "ค่าเน็ต 700 บางที 1,000" → amount 700 · amountMax 1000
  dayOfMonth: number;
}

export interface ParsedDebt {
  person: string;
  amount?: number;              // ยอดคงเหลือ/ปิดบัญชี — ไม่มีก็ยังลงได้ (นี่คือบั๊กที่ทำข้อมูลหาย 6 ส.ค.)
  installmentAmount?: number;
  installmentDay?: number;
  kind?: "revolving" | "installment" | "personal";
  creditLimit?: number;
  availableCredit?: number;
  interestRate?: number;
  termsTotal?: number;
  termsPaid?: number;
}

export interface ParsedBaseline {
  monthlyIncome?: number; incomeNote?: string; savings?: number; savingsNote?: string;
  bills: ParsedBill[];
  debts: ParsedDebt[];
  /** ยอดรวมงวดต่อเดือนที่เจ้าของเขียนไว้เอง — เอาไว้กระทบยอดกับที่ระบบบวกได้ */
  statedMonthlyTotal?: number;
}

/**
 * แกะตัวเลขจากภาษาคน — เจ้าของพิมพ์ยาว ๆ ทีเดียวได้เลย
 * ("เงินเข้าเดือนละ 45000 มีเก็บอยู่ 80000 ผ่อนรถ 7500 ทุกวันที่ 5 ค่าเน็ต 599")
 */
export async function parseBaselineText(text: string): Promise<ParsedBaseline> {
  const raw = await askExtractor(text.slice(0, 6000), {
    system: `แกะข้อมูลการเงินหลักจากที่เจ้าของพิมพ์มา ตอบ JSON เท่านั้น:
{"monthlyIncome":<ตัวเลข หรือไม่ใส่>,"incomeNote":"มาจากไหน","savings":<ตัวเลข>,"savingsNote":"อยู่ที่ไหน",
 "bills":[{"label":"ชื่อรายการ","amount":<ปกติเดือนละเท่าไหร่>,"amountMax":<ถ้าบอกเป็นช่วง ใส่ขอบบน>,"dayOfMonth":<1-31 ไม่รู้ใส่ 1>}],
 "debts":[{"person":"ชื่อหนี้/เจ้าหนี้","amount":<ยอดคงเหลือ/ปิดบัญชี ถ้ามี>,
           "installmentAmount":<ต้องจ่ายเดือนละ/ขั้นต่ำ>,"installmentDay":<วันที่ตัด>,
           "kind":"revolving|installment|personal","creditLimit":<วงเงิน>,"availableCredit":<วงเงินคงเหลือ>,
           "interestRate":<ดอก %/ปี>,"termsTotal":<ผ่อนกี่งวด>,"termsPaid":<จ่ายไปแล้วกี่งวด>}],
 "statedMonthlyTotal":<ถ้าเจ้าของสรุปยอดรวมที่ต้องจ่ายต่อเดือนไว้เอง ใส่ตัวเลขนั้น>}

กติกา
- ใส่เฉพาะที่เจ้าของบอกจริง **ห้ามเดาตัวเลขเอง** ไม่ได้พูดถึง = ไม่ต้องใส่คีย์นั้น
- **รู้แค่ค่างวด ไม่รู้ยอดคงเหลือ ก็ต้องใส่มา** (ใส่ installmentAmount ไม่ต้องใส่ amount) ห้ามข้ามรายการนั้นทิ้งเด็ดขาด
- "หมื่น/แสน/k" แปลงเป็นตัวเลขเต็ม เช่น 45k = 45000 · สี่หมื่นห้า = 45000
- รายจ่ายที่ตัดทุกเดือนและไม่ใช่หนี้ (ค่าเน็ต ค่าน้ำค่าไฟ ค่าน้ำมัน ประกัน subscription) = bills
- เงินที่ยังติดคนอื่น/ผ่อนอยู่/บัตรเครดิต/สินเชื่อ = debts
- kind: บัตรเครดิตหรือวงเงินหมุนเวียนที่รูดซ้ำได้ = revolving · ผ่อนเป็นงวดแล้วจบ (รถ/สินค้า) = installment · ยืมคนรู้จัก = personal
- ระวังอย่าสับสน: "วงเงินคงเหลือ" = availableCredit (เงินที่ยังรูดได้) ไม่ใช่ยอดหนี้ · "ปิดยอดทั้งหมด" = amount (ยอดหนี้)
- บอกว่า "ไม่มีหนี้" = debts เป็น array ว่าง`,
    timeoutMs: 60_000,
  });
  const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}") as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    monthlyIncome: num(j.monthlyIncome),
    incomeNote: typeof j.incomeNote === "string" ? j.incomeNote : undefined,
    savings: num(j.savings),
    savingsNote: typeof j.savingsNote === "string" ? j.savingsNote : undefined,
    statedMonthlyTotal: num(j.statedMonthlyTotal),
    bills: Array.isArray(j.bills) ? (j.bills as ParsedBill[]) : [],
    debts: Array.isArray(j.debts) ? (j.debts as ParsedDebt[]) : [],
  };
}

/**
 * จับคู่ชื่อที่เจ้าของพิมพ์มา กับรายการที่มีอยู่แล้วในฐาน — **ให้สมองตัดสินจากความหมาย**
 *
 * ทำไมไม่เทียบตัวอักษร: "Umay+" / "umay plus" / "อูเมย์" คือก้อนเดียวกัน แต่เทียบตัวอักษรแล้วคนละตัว
 * ผลคือเดือนหน้าเจ้าของส่งชุดเดิมมาอัปเดต จะได้หนี้ซ้ำอีกชุด ยอดรวมพุ่งเป็นสองเท่า
 * (บทเรียนเดียวกับ dropRepeats — วัดความคล้ายด้วยตัวอักษรใช้กับภาษาไทยไม่ได้)
 *
 * เรียกครั้งเดียวต่อชุด ไม่ใช่ต่อรายการ · ล้มเหลว = ถอยไปเทียบชื่อตรงเป๊ะแบบเดิม (ไม่พัง แค่ระวังตัวมากขึ้น)
 */
async function matchExisting(incoming: string[], existing: string[]): Promise<Record<string, string>> {
  if (!incoming.length || !existing.length) return {};
  const raw = await askExtractor(
    `รายการใหม่ที่เจ้าของเพิ่งพิมพ์มา:\n${incoming.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n` +
      `รายการที่มีอยู่แล้วในฐานข้อมูล:\n${existing.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
    {
      system: `จับคู่ว่า "รายการใหม่" แต่ละอันหมายถึงอันเดียวกับ "รายการที่มีอยู่แล้ว" อันไหน
ตอบ JSON: {"pairs":[{"new":"<ชื่อจากรายการใหม่ ตรงตัวอักษรเป๊ะ>","old":"<ชื่อจากรายการเดิม ตรงตัวอักษรเป๊ะ>"}]}

กติกา
- คู่กันเมื่อ**หมายถึงหนี้/บิลก้อนเดียวกันจริง ๆ** แม้เขียนคนละแบบ (Umay+ = umay plus = อูเมย์ · บัตรกรุงศรี = uchoose กรุงศรีเฟิร์สช้อยส์)
- ไม่แน่ใจ = **ไม่ต้องจับคู่** (สร้างใหม่ยังแก้ได้ จับคู่ผิดทับข้อมูลเดิมหาย)
- ระวังของที่ชื่อคล้ายแต่คนละก้อน: "Ascend Pay Next" กับ "Ascend Pay Next Extra" คือคนละใบ ห้ามจับคู่กัน
- ไม่มีคู่เลย = {"pairs":[]}`,
      timeoutMs: 45_000,
    },
  ).catch(() => "");
  try {
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}") as { pairs?: { new: string; old: string }[] };
    const map: Record<string, string> = {};
    for (const p of j.pairs || []) {
      if (incoming.includes(p.new) && existing.includes(p.old)) map[p.new] = p.old;
    }
    return map;
  } catch {
    return {};
  }
}

export interface AppliedRow {
  what: string;                 // ชื่อรายการ
  detail: string;               // ยอด/งวด อ่านแล้วตรวจได้ทันที
  action: "new" | "update";     // สร้างใหม่ หรือ อัปเดตของเดิม
  incomplete?: string;          // ลงให้แล้วแต่ยังขาดอะไร (ก่อนหน้านี้ของแบบนี้ถูกทิ้งเงียบ)
}

export interface ApplyResult {
  income: AppliedRow[];
  bills: AppliedRow[];
  debts: AppliedRow[];
  /** เจ้าของพิมพ์มากี่ก้อน · ลงได้กี่ก้อน — ไม่เท่ากันต้องทัก ห้ามเงียบ */
  seen: { bills: number; debts: number };
  saved: { bills: number; debts: number };
  /** ยอดรวมงวด/เดือนที่ระบบบวกได้ vs ที่เจ้าของเขียนไว้เอง */
  monthlyTotal: number;
  statedMonthlyTotal?: number;
  /** เรื่องที่ต้องบอกเจ้าของตรง ๆ (ตกหล่น · ยอดไม่ตรง · ข้อมูลไม่ครบ) */
  warnings: string[];
}

/** บันทึกทั้งชุดลงที่ที่ถูกต้องของแต่ละอย่าง (บิลลง RecurringBill · หนี้ลง Debt) */
export async function applyBaseline(p: ParsedBaseline): Promise<ApplyResult> {
  const res: ApplyResult = {
    income: [], bills: [], debts: [],
    seen: { bills: p.bills.length, debts: p.debts.length },
    saved: { bills: 0, debts: 0 },
    monthlyTotal: 0,
    statedMonthlyTotal: p.statedMonthlyTotal,
    warnings: [],
  };

  if (typeof p.monthlyIncome === "number" || typeof p.savings === "number") {
    await saveBaseline(p);
    if (typeof p.monthlyIncome === "number")
      res.income.push({ what: "รายรับต่อเดือน", detail: `${fmtBaht(p.monthlyIncome)} ฿`, action: "update" });
    if (typeof p.savings === "number")
      res.income.push({ what: "เงินเก็บ", detail: `${fmtBaht(p.savings)} ฿`, action: "update" });
  }

  // --- บิลประจำ ---
  const billRows = await db.recurringBill.findMany({ where: { active: true } }).catch(() => []);
  const billMap = await matchExisting(p.bills.map((b) => b.label).filter(Boolean), billRows.map((b) => b.label));
  for (const b of p.bills) {
    if (!b.label) { res.warnings.push("มีบิลหนึ่งรายการที่อ่านชื่อไม่ออก เลยยังไม่ได้ลง"); continue; }
    if (!(b.amount > 0)) {
      res.warnings.push(`บิล "${b.label}" ยังไม่รู้ยอด — บอกมาได้เลยว่าเดือนละเท่าไหร่`);
      continue;
    }
    const oldLabel = billMap[b.label];
    const exists = billRows.find((r) => r.label === (oldLabel || b.label)) || null;
    const day = b.dayOfMonth || exists?.dayOfMonth || 1;
    const max = b.amountMax && b.amountMax > b.amount ? b.amountMax : exists?.amountMax ?? null;
    const range = max ? `${fmtBaht(b.amount)}–${fmtBaht(max)}` : fmtBaht(b.amount);
    const billData = { label: b.label, amount: b.amount, amountMax: max, dayOfMonth: day };
    if (exists) await db.recurringBill.update({ where: { id: exists.id }, data: billData }).catch(() => {});
    else await db.recurringBill.create({ data: { ...billData, source: "manual" } }).catch(() => {});
    res.saved.bills++;
    res.bills.push({ what: b.label, detail: `${range} ฿ · ตัดวันที่ ${day}`, action: exists ? "update" : "new" });
  }

  // --- หนี้ ---
  const debtRows = await db.debt.findMany({ where: { settledAt: null, direction: "i_owe" } }).catch(() => []);
  const debtMap = await matchExisting(p.debts.map((d) => d.person).filter(Boolean), debtRows.map((d) => d.person));
  for (const d of p.debts) {
    if (!d.person) { res.warnings.push("มีหนี้หนึ่งก้อนที่อ่านชื่อไม่ออก เลยยังไม่ได้ลง"); continue; }

    // จุดที่เคยพัง: ไม่มียอดคงเหลือ = ข้ามทิ้งเงียบ ทำให้ 6 ส.ค. หายไป 3 ก้อน (Umay+ / มอไซค์ / จอคอม)
    // ตอนนี้ลงให้เสมอถ้ารู้อย่างใดอย่างหนึ่ง แล้วมาร์คว่ายอดยังไม่รู้
    const hasAmount = typeof d.amount === "number" && d.amount > 0;
    const hasInstallment = typeof d.installmentAmount === "number" && d.installmentAmount > 0;
    if (!hasAmount && !hasInstallment) {
      res.warnings.push(`หนี้ "${d.person}" ไม่มีทั้งยอดคงเหลือและค่างวด เลยยังลงไม่ได้`);
      continue;
    }

    const oldPerson = debtMap[d.person];
    const exists = debtRows.find((r) => r.person === (oldPerson || d.person)) || null;
    const data = {
      person: d.person,
      amount: hasAmount ? d.amount! : exists?.amount ?? 0,
      amountKnown: hasAmount || (exists?.amountKnown ?? false),
      installmentAmount: d.installmentAmount ?? exists?.installmentAmount ?? null,
      installmentDay: d.installmentDay ?? exists?.installmentDay ?? null,
      kind: d.kind ?? exists?.kind ?? null,
      creditLimit: d.creditLimit ?? exists?.creditLimit ?? null,
      availableCredit: d.availableCredit ?? exists?.availableCredit ?? null,
      interestRate: d.interestRate ?? exists?.interestRate ?? null,
      termsTotal: d.termsTotal ?? exists?.termsTotal ?? null,
      termsPaid: d.termsPaid ?? exists?.termsPaid ?? null,
    };
    if (exists) await db.debt.update({ where: { id: exists.id }, data }).catch(() => {});
    else await db.debt.create({ data: { direction: "i_owe", ...data } }).catch(() => {});
    res.saved.debts++;
    if (data.installmentAmount) res.monthlyTotal += data.installmentAmount;

    const bits: string[] = [];
    bits.push(data.amountKnown ? `เหลือ ${fmtBaht(data.amount)} ฿` : "ยอดคงเหลือยังไม่รู้");
    if (data.installmentAmount) bits.push(`งวดละ ${fmtBaht(data.installmentAmount)} ฿`);
    if (data.termsTotal) bits.push(`งวดที่ ${data.termsPaid ?? 0}/${data.termsTotal}`);
    if (data.creditLimit && data.availableCredit !== null) {
      const used = Math.round(((data.creditLimit - data.availableCredit) / data.creditLimit) * 100);
      bits.push(`ใช้วงเงินไป ${used}%`);
    }
    const gaps: string[] = [];
    if (!data.amountKnown) gaps.push("ยอดคงเหลือ");
    if (data.kind === "revolving" && data.interestRate === null) gaps.push("ดอกเบี้ย");
    res.debts.push({
      what: d.person,
      detail: bits.join(" · "),
      action: exists ? "update" : "new",
      incomplete: gaps.length ? gaps.join(" · ") : undefined,
    });
  }

  // --- ตัวกระทบยอด: พิมพ์มากี่ก้อน ลงได้กี่ก้อน ยอดตรงกับที่เจ้าของสรุปไว้ไหม ---
  if (res.saved.debts < res.seen.debts)
    res.warnings.push(`หนี้: พิมพ์มา ${res.seen.debts} ก้อน ลงได้ ${res.saved.debts} ก้อน — ขาดไป ${res.seen.debts - res.saved.debts}`);
  if (res.saved.bills < res.seen.bills)
    res.warnings.push(`บิล: พิมพ์มา ${res.seen.bills} รายการ ลงได้ ${res.saved.bills} รายการ`);
  if (p.statedMonthlyTotal && res.monthlyTotal > 0) {
    const diff = Math.abs(p.statedMonthlyTotal - res.monthlyTotal);
    if (diff / p.statedMonthlyTotal > 0.01)
      res.warnings.push(
        `ยอดงวดรวมไม่ตรง — ระบบบวกได้ ${fmtBaht(res.monthlyTotal)} ฿ แต่ที่เขียนไว้คือ ${fmtBaht(p.statedMonthlyTotal)} ฿ (ต่างกัน ${fmtBaht(diff)} ฿)`,
      );
  }
  return res;
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
    lines.push(
      `รายจ่ายตัดประจำรวม: ${fmtBaht(b.fixedTotal)} ฿/เดือน${b.fixedTotalMax > b.fixedTotal ? ` (เดือนที่แพงสุด ${fmtBaht(b.fixedTotalMax)} ฿)` : ""}`,
    );
    for (const f of b.fixedExpenses)
      lines.push(`  · ${f.label} ${f.amountMax ? `${fmtBaht(f.amount)}–${fmtBaht(f.amountMax)}` : fmtBaht(f.amount)} ฿ (วันที่ ${f.day})`);
  }
  if (b.savings !== null) lines.push(`เงินเก็บที่มี: ${fmtBaht(b.savings)} ฿${b.savingsNote ? ` (${b.savingsNote})` : ""}`);
  if (b.debts.length) {
    lines.push(
      `หนี้ค้างรวม: ${fmtBaht(b.debtTotal)} ฿${b.debtsUnknownAmount ? ` (เฉพาะ ${b.debts.length - b.debtsUnknownAmount} ก้อนที่รู้ยอด · อีก ${b.debtsUnknownAmount} ก้อนยังไม่รู้ยอด ยอดจริงสูงกว่านี้)` : ""}` +
        `${b.debtPerMonth ? ` · ต้องจ่ายเดือนละ ${fmtBaht(b.debtPerMonth)} ฿` : ""}`,
    );
    for (const d of b.debts) {
      const bits = [d.amountKnown ? `${fmtBaht(d.amount)} ฿` : "ยอดยังไม่รู้"];
      if (d.perMonth) bits.push(`งวดละ ${fmtBaht(d.perMonth)} ฿`);
      if (d.termsTotal) bits.push(`งวดที่ ${d.termsPaid ?? 0}/${d.termsTotal}`);
      if (d.interestRate !== null) bits.push(`ดอก ${d.interestRate}%/ปี`);
      if (d.creditLimit && d.availableCredit !== null)
        bits.push(`วงเงิน ${fmtBaht(d.creditLimit)} เหลือ ${fmtBaht(d.availableCredit)} (ใช้ไป ${Math.round(((d.creditLimit - d.availableCredit) / d.creditLimit) * 100)}%)`);
      lines.push(`  · ${d.person} — ${bits.join(" · ")}`);
    }
    if (b.creditUsedPct !== null)
      lines.push(`วงเงินหมุนเวียนรวม ${fmtBaht(b.creditLimitTotal)} ฿ · เหลือให้ใช้ ${fmtBaht(b.creditAvailableTotal)} ฿ · ใช้ไปแล้ว ${b.creditUsedPct}%`);
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
