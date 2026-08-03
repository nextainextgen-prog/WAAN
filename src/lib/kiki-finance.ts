import { db } from "./db";
import { askExtractor, appendPersonalNote, readPersonalNote, writePersonalNote, personalHubFooter, PERSONAL_FOLDER } from "./kiki";

/**
 * การเงินส่วนตัวของเจ้าของ — Vex เป็นเลขาการเงิน
 *  ส่งสลิป/พิมพ์บอก → สกัดรายการ (LLM) → บันทึก FinanceTxn → การ์ดภาพ + คอมเมนต์
 */

export const EXPENSE_CATS = ["อาหาร", "เดินทาง", "ของใช้", "บันเทิง", "บิล/สมาชิก", "สุขภาพ", "ให้คนอื่น", "อื่นๆ"] as const;
export const INCOME_CATS = ["เงินเดือน", "เงินเสริม", "อื่นๆ"] as const;
export const TOTAL_BUDGET_KEY = "รวม";

export interface ParsedTxn {
  type: "income" | "expense";
  amount: number;
  category: string;
  note?: string;
  occurredAt?: string; // ISO ถ้าอ่านได้จากสลิป
}

const EXTRACT_SYSTEM = `คุณคือระบบสกัดรายการการเงินจากข้อความ/สลิปโอนเงินไทย ตอบ JSON เท่านั้น ไม่มีข้อความอื่น ไม่มี \`\`\`
โครงสร้าง: {"items":[{"type":"income|expense","amount":123.45,"category":"...","note":"จ่าย/รับค่าอะไร (สั้น)","occurredAt":"YYYY-MM-DDTHH:mm ถ้ารู้ ไม่รู้ให้ว่าง"}]}
กติกา:
- type: เงินเข้า/รายได้/เงินเดือน/มีคนโอนมา = income · จ่าย/ซื้อ/โอนให้คนอื่น/ค่าใช้จ่าย = expense
- category ของ expense เลือกจาก: ${EXPENSE_CATS.join(" | ")}
- category ของ income เลือกจาก: ${INCOME_CATS.join(" | ")}
- ถ้ามีรูปสลิปให้เปิดอ่านด้วยเครื่องมือ Read ตาม path ที่ให้ แล้วเอายอด/วันเวลา/ผู้รับจากสลิปจริง (ยึดข้อความเจ้าของเป็นตัวบอกว่าค่าอะไร)
- occurredAt = วันเวลาที่ "เงินเข้า/ออกจริง" จากสลิปโอนเท่านั้น — ถ้าเป็นจดหมาย/ใบแจ้ง/เอกสารที่วันที่ไม่ใช่วันโอนจริง หรือไม่แน่ใจ ให้เว้นว่าง (ระบบจะใช้เวลาปัจจุบัน = เวลาที่เจ้าของแจ้ง)
- บิลหารกัน: ถ้าเจ้าของบอกว่า หาร/หารกัน/หารสอง/คนละครึ่ง/หารกับ... ให้ลง amount เฉพาะ "ส่วนที่เจ้าของจ่ายเอง" (เช่น บิล 550 หารสอง = 275) แล้วใส่ note ว่าหารกับใคร จากบิลรวมเท่าไหร่
- หนึ่งข้อความอาจมีหลายรายการ — แยกเป็นหลาย item
- ไม่ใช่เรื่องการเงินเลย = {"items":[]}`;

export async function extractFinance(text: string, imagePaths: string[] = [], recent: TxnRecord[] = []): Promise<ParsedTxn[]> {
  const img = imagePaths.length
    ? `\n\nรูปสลิปที่แนบมา (เปิดอ่านด้วย Read ทุกไฟล์):\n${imagePaths.map((p, i) => `${i + 1}. ${p}`).join("\n")}`
    : "";
  // กันบันทึกซ้ำ: เจ้าของมัก "พูดถึง" ยอดเดิมตอนคุย/แก้ความเข้าใจ — ไม่ใช่แจ้งรายการใหม่ (เคยพัง: เงินเดือน+AIA โดนลงซ้ำ)
  const rec = recent.length
    ? `\n\nรายการที่บันทึกไปแล้วล่าสุด (ห้ามสร้างซ้ำ — ถ้ายอด/เรื่องที่เจ้าของพูดถึงตรงกับในนี้ = เขาพูดถึงของเดิม ห้ามใส่ใน items):\n${recent
        .map((r) => `- ${r.type === "income" ? "รับ" : "จ่าย"} ${r.amount} บาท · ${r.category}${r.note ? ` · ${r.note}` : ""}`)
        .join("\n")}\nถ้าเจ้าของแค่ถาม/อธิบาย/บ่น/แก้ความเข้าใจเรื่องยอดเดิม โดยไม่ได้แจ้งรายการใหม่ = {"items":[]}`
    : "";
  const raw = await askExtractor(`ข้อความจากเจ้าของ: """${text}"""${img}${rec}`, {
    system: EXTRACT_SYSTEM,
    timeoutMs: 120_000,
    imagePaths,
  });
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const j = JSON.parse(m[0]);
    const items = Array.isArray(j.items) ? j.items : [];
    return items
      .filter((x: ParsedTxn) => x && (x.type === "income" || x.type === "expense") && Number(x.amount) > 0)
      .map((x: ParsedTxn) => ({
        type: x.type,
        amount: Math.round(Number(x.amount) * 100) / 100,
        category: String(x.category || "อื่นๆ").slice(0, 30),
        note: x.note ? String(x.note).slice(0, 200) : undefined,
        occurredAt: x.occurredAt || undefined,
      }));
  } catch {
    return [];
  }
}

export interface TxnRecord {
  id: string;
  type: string;
  amount: number;
  category: string;
  note: string | null;
  occurredAt: Date;
}

export async function recordTxns(items: ParsedTxn[], opts: { slipPath?: string; msgId?: string } = {}): Promise<TxnRecord[]> {
  const out: TxnRecord[] = [];
  for (const it of items) {
    // วันที่จากเอกสารเชื่อได้แค่ช่วงใกล้ ๆ (ย้อนหลัง 14 วัน – พรุ่งนี้) — นอกช่วง = วันที่ในเอกสารไม่ใช่วันเงินเข้า/ออกจริง
    // (เคยพัง: จดหมายเงินคืน AIA ลงวันที่เดือนอื่น ทำยอดหายจากสรุปเดือนปัจจุบัน)
    const now = new Date();
    let occurred = now;
    if (it.occurredAt) {
      const d = new Date(it.occurredAt);
      const inRange = !isNaN(d.getTime()) && d.getFullYear() > 2000 &&
        d.getTime() >= now.getTime() - 14 * 86400_000 && d.getTime() <= now.getTime() + 86400_000;
      if (inRange) occurred = d;
    }
    const rec = await db.financeTxn.create({
      data: {
        type: it.type,
        amount: it.amount,
        category: it.category,
        note: it.note || null,
        occurredAt: occurred,
        slipPath: opts.slipPath || null,
        source: opts.slipPath ? "slip" : "chat",
        msgId: opts.msgId || null,
      },
    });
    out.push(rec);
  }
  const months = new Set(out.map((r) => ymOf(r.occurredAt)));
  for (const ym of months) await rebuildLedgerMonth(ym).catch(() => {});
  return out;
}

export async function deleteLastTxn(): Promise<TxnRecord | null> {
  const last = await db.financeTxn.findFirst({ orderBy: { createdAt: "desc" } });
  if (!last) return null;
  await db.financeTxn.delete({ where: { id: last.id } });
  await rebuildLedgerMonth(ymOf(last.occurredAt)).catch(() => {});
  return last;
}

// ===== งบประมาณ =====

export async function setBudget(category: string, monthly: number): Promise<void> {
  await db.financeBudget.upsert({
    where: { category },
    update: { monthly },
    create: { category, monthly },
  });
}

export async function listBudgets(): Promise<{ category: string; monthly: number }[]> {
  return db.financeBudget.findMany({ orderBy: { monthly: "desc" } });
}

// ===== สรุป/วิเคราะห์ =====

function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function nextMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

export const fmtBaht = (n: number): string =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: n % 1 ? 2 : 0 });

export interface FinanceSnapshot {
  now: Date;
  todayExpense: number;
  monthExpense: number;
  monthIncome: number;
  prevMonthExpense: number;
  byCategory: { category: string; amount: number }[]; // expense เดือนนี้
  prevByCategory: Map<string, number>;
  budgets: { category: string; monthly: number }[];
  totalBudget: number | null;
  daysLeft: number; // รวมวันนี้
  safePerDay: number | null; // (งบรวม - ใช้ไป) / วันที่เหลือ
  projectedExpense: number | null; // ทำนายยอดจ่ายสิ้นเดือนจาก pace จริง (ต้องผ่านมา >= 3 วัน)
  daily14: { label: string; amount: number }[];
  txnCount: number;
  todayItems: { time: string; type: string; amount: number; category: string; note: string | null }[]; // รายการวันนี้รายตัว
}

export async function financeSnapshot(now = new Date()): Promise<FinanceSnapshot> {
  const mStart = monthStart(now);
  const mEnd = nextMonth(now);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const tStart = dayStart(now);
  const d14 = new Date(tStart.getTime() - 13 * 86400_000);

  const [monthRows, prevRows, budgets] = await Promise.all([
    db.financeTxn.findMany({ where: { occurredAt: { gte: mStart, lt: mEnd } } }),
    db.financeTxn.findMany({ where: { type: "expense", occurredAt: { gte: prevStart, lt: mStart } } }),
    listBudgets(),
  ]);
  const last14 = await db.financeTxn.findMany({ where: { type: "expense", occurredAt: { gte: d14 } } });

  const monthExpRows = monthRows.filter((r) => r.type === "expense");
  const monthExpense = monthExpRows.reduce((s, r) => s + r.amount, 0);
  const monthIncome = monthRows.filter((r) => r.type === "income").reduce((s, r) => s + r.amount, 0);
  // ขอบบนจำเป็น: recordTxns ยอมรับ occurredAt ถึง "พรุ่งนี้" — ไม่กันไว้รายการวันหน้าจะโผล่ปนใน "วันนี้"
  const tEnd = new Date(tStart.getTime() + 86400_000);
  const todayExpense = monthExpRows.filter((r) => r.occurredAt >= tStart && r.occurredAt < tEnd).reduce((s, r) => s + r.amount, 0);
  const prevMonthExpense = prevRows.reduce((s, r) => s + r.amount, 0);

  const catMap = new Map<string, number>();
  for (const r of monthExpRows) catMap.set(r.category, (catMap.get(r.category) || 0) + r.amount);
  const byCategory = [...catMap.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  const prevByCategory = new Map<string, number>();
  for (const r of prevRows) prevByCategory.set(r.category, (prevByCategory.get(r.category) || 0) + r.amount);

  const totalBudget = budgets.find((b) => b.category === TOTAL_BUDGET_KEY)?.monthly ?? null;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate() + 1;
  const safePerDay = totalBudget !== null ? Math.max(0, (totalBudget - monthExpense) / daysLeft) : null;
  // ทำนายสิ้นเดือนจาก pace จริง (ผ่านมาแล้วกี่วัน ใช้เฉลี่ยวันละเท่าไหร่ → ถ้าจังหวะนี้ต่อจะจบที่เท่าไหร่)
  const daysPassed = now.getDate();
  const projectedExpense = daysPassed >= 3 ? Math.round((monthExpense / daysPassed) * daysInMonth) : null;

  const daily14: { label: string; amount: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const d0 = new Date(d14.getTime() + i * 86400_000);
    const d1 = new Date(d0.getTime() + 86400_000);
    const amt = last14.filter((r) => r.occurredAt >= d0 && r.occurredAt < d1).reduce((s, r) => s + r.amount, 0);
    daily14.push({ label: `${d0.getDate()}`, amount: amt });
  }

  const todayItems = monthRows
    .filter((r) => r.occurredAt >= tStart && r.occurredAt < tEnd)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((r) => ({
      time: r.occurredAt.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }),
      type: r.type,
      amount: r.amount,
      category: r.category,
      note: r.note,
    }));

  return {
    now, todayExpense, monthExpense, monthIncome, prevMonthExpense,
    byCategory, prevByCategory, budgets, totalBudget, daysLeft, safePerDay, projectedExpense, daily14,
    txnCount: monthRows.length, todayItems,
  };
}

// ข้อเท็จจริงสำหรับให้สมองแต่งคอมเมนต์ (ตัวเลขจริงล้วน ๆ)
export function snapshotFacts(s: FinanceSnapshot): string[] {
  const facts = [
    `วันนี้ใช้ไป ${fmtBaht(s.todayExpense)} บาท`,
    `เดือนนี้ใช้รวม ${fmtBaht(s.monthExpense)} บาท · รายรับเข้ามา ${fmtBaht(s.monthIncome)} บาท`,
  ];
  if (s.totalBudget !== null) {
    const pct = Math.round((s.monthExpense / s.totalBudget) * 100);
    facts.push(`งบทั้งเดือน ${fmtBaht(s.totalBudget)} บาท ใช้ไปแล้ว ${pct}% เหลือ ${fmtBaht(Math.max(0, s.totalBudget - s.monthExpense))} บาท`);
    if (s.safePerDay !== null) facts.push(`เหลืออีก ${s.daysLeft} วันถึงสิ้นเดือน ใช้ได้เฉลี่ยวันละ ${fmtBaht(Math.floor(s.safePerDay))} บาท`);
  }
  if (s.projectedExpense !== null && s.daysLeft > 2) {
    facts.push(`ทำนายจาก pace ตอนนี้: สิ้นเดือนจะจ่ายรวมประมาณ ${fmtBaht(s.projectedExpense)} บาท`);
    if (s.totalBudget !== null && s.projectedExpense > s.totalBudget) {
      facts.push(`⚠️ pace นี้จะเกินงบประมาณ ${fmtBaht(s.projectedExpense - s.totalBudget)} บาท — ต้องเบรกแล้ว`);
    }
  }
  if (s.prevMonthExpense > 0) {
    const diff = Math.round(((s.monthExpense - s.prevMonthExpense) / s.prevMonthExpense) * 100);
    facts.push(`เทียบเดือนที่แล้วทั้งเดือน (${fmtBaht(s.prevMonthExpense)} บาท): ตอนนี้${diff >= 0 ? "มากกว่า" : "น้อยกว่า"} ${Math.abs(diff)}%`);
  }
  if (s.byCategory.length) {
    facts.push(`หมวดที่ใช้เยอะสุดเดือนนี้: ${s.byCategory.slice(0, 3).map((c) => `${c.category} ${fmtBaht(c.amount)} บาท`).join(" · ")}`);
  }
  if (s.todayItems.length) {
    facts.push(`รายการวันนี้: ${s.todayItems.slice(-8).map((t) => `${t.type === "income" ? "+" : "−"}${fmtBaht(t.amount)}฿ ${t.note || t.category}`).join(" · ")}`);
  }
  for (const b of s.budgets) {
    if (b.category === TOTAL_BUDGET_KEY) continue;
    const used = s.byCategory.find((c) => c.category === b.category)?.amount || 0;
    const pct = Math.round((used / b.monthly) * 100);
    if (pct >= 80) facts.push(`⚠️ งบหมวด ${b.category} (${fmtBaht(b.monthly)} บาท/เดือน) ใช้ไปแล้ว ${pct}%`);
  }
  return facts;
}

// ===== การ์ดภาพ (HTML → PNG) สไตล์เดียวกับ Usage Monitor =====

function esc(s: string): string {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

// ตัวเลขย่อสำหรับป้ายบนแท่งกราฟ (185, 1.2k, 21k)
function fmtCompact(n: number): string {
  if (n >= 100_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(n));
}

// การ์ดสไตล์เดียวกับ Usage Monitor — เจ้าของสั่ง (31 ก.ค. 2026): ห้ามมีอิโมจิในการ์ดนี้
export function financeCardHtml(s: FinanceSnapshot, opts: { justAdded?: TxnRecord[] } = {}): string {
  const pctTotal = s.totalBudget ? Math.min(100, Math.round((s.monthExpense / s.totalBudget) * 100)) : null;
  const monthLabel = s.now.toLocaleDateString("th-TH-u-ca-gregory", { month: "long", year: "numeric" });

  // แถบงบรายหมวด: หมวดที่ตั้งงบไว้ก่อน แล้วตามด้วยหมวดใช้เยอะ (สูงสุด 6 แถว)
  const rows: { label: string; used: number; cap: number | null }[] = [];
  for (const b of s.budgets) {
    if (b.category === TOTAL_BUDGET_KEY) continue;
    rows.push({ label: b.category, used: s.byCategory.find((c) => c.category === b.category)?.amount || 0, cap: b.monthly });
  }
  for (const c of s.byCategory) {
    if (rows.length >= 6) break;
    if (!rows.some((r) => r.label === c.category)) rows.push({ label: c.category, used: c.amount, cap: null });
  }
  const maxUsed = Math.max(1, ...rows.map((r) => r.cap || r.used));
  const rowHtml = rows
    .map((r) => {
      const pct = r.cap ? Math.min(100, Math.round((r.used / r.cap) * 100)) : Math.round((r.used / maxUsed) * 100);
      const warn = r.cap ? r.used / r.cap >= 0.85 : false;
      const val = r.cap
        ? `<b${warn ? ' class="red"' : ""}>${pct}%</b> · <span class="muted">${fmtBaht(r.used)} / ${fmtBaht(r.cap)}</span>`
        : `<b>${fmtBaht(r.used)} ฿</b>`;
      return `<div class="row">
        <div class="wlabel">${esc(r.label)}</div>
        <div class="track"><div class="fill${warn ? " warn" : ""}" style="width:${Math.max(2, pct)}%"></div></div>
        <div class="wval">${val}</div>
      </div>`;
    })
    .join("");

  // กราฟรายวัน: ทุกวันมี "ราง" จุดเต็มความสูงแบบหลอด Usage + แท่งเติมจากล่าง + ป้ายยอดบนแท่งที่มีจริง
  // ไม่มีข้อมูลเลย = ข้อความแทน (แท่งเปล่า ๆ ทั้งแถวดูเหมือนการ์ดพัง)
  const maxDay = Math.max(...s.daily14.map((d) => d.amount));
  const chart = maxDay <= 0
    ? `<div class="empty">ยังไม่มีรายจ่ายใน 14 วันที่ผ่านมา — ส่งสลิปหรือพิมพ์บอกได้เลย</div>`
    : `<div class="chart">${s.daily14
        .map((d, i) => {
          const today = i === s.daily14.length - 1;
          const h = Math.round((d.amount / maxDay) * 100);
          return `<div class="bcol">
            <div class="bval">${d.amount > 0 ? fmtCompact(d.amount) : ""}</div>
            <div class="btrack"><div class="bfill${today ? " today" : ""}" style="height:${d.amount > 0 ? Math.max(6, h) : 0}%"></div></div>
            <div class="blab${today ? " now" : ""}">${esc(d.label)}</div>
          </div>`;
        })
        .join("")}</div>`;

  const added = (opts.justAdded || [])
    .map((t) => {
      const sign = t.type === "income" ? "+" : "−";
      const cls = t.type === "income" ? "green" : "red";
      return `<div class="added"><span class="${cls}">${sign}${fmtBaht(t.amount)} ฿</span> · ${esc(t.category)}${t.note ? ` · ${esc(t.note)}` : ""}</div>`;
    })
    .join("");

  // รายการวันนี้รายตัว — เจ้าของอยากเห็นว่า "จ่ายไปกับอะไรบ้าง" ไม่ใช่แค่ยอดรวมรายหมวด
  const itemsToday = s.todayItems.slice(-12);
  const itemsHtml = itemsToday.length
    ? `<div class="sect">รายการวันนี้</div><div class="items">${itemsToday
        .map((t) => {
          const inc = t.type === "income";
          return `<div class="item">
            <span class="itime">${esc(t.time)}</span>
            <span class="iname">${esc(t.note || t.category)}</span>
            <span class="icat">${esc(t.category)}</span>
            <span class="iamt ${inc ? "green" : "red"}">${inc ? "+" : "−"}${fmtBaht(t.amount)} ฿</span>
          </div>`;
        })
        .join("")}</div>`
    : "";

  const totalBar = pctTotal !== null
    ? `<div class="row big">
        <div class="wlabel">งบเดือนนี้</div>
        <div class="track"><div class="fill${pctTotal >= 85 ? " warn" : ""}" style="width:${Math.max(2, pctTotal)}%"></div></div>
        <div class="wval"><b${pctTotal >= 85 ? ' class="red"' : ""}>${pctTotal}%</b> · <span class="muted">เหลือ ${fmtBaht(Math.max(0, (s.totalBudget || 0) - s.monthExpense))} ฿</span></div>
      </div>`
    : `<div class="nobudget">ยังไม่ได้ตั้งงบรวม — พิมพ์ "ตั้งงบเดือนละ 20000" ได้เลย</div>`;

  const safe = s.safePerDay !== null
    ? `<div class="safe">ใช้ได้อีกวันละ <b>${fmtBaht(Math.floor(s.safePerDay))} ฿</b> <span class="muted">(เหลือ ${s.daysLeft} วันถึงสิ้นเดือน)</span></div>`
    : "";

  return `<!doctype html><html lang="th"><head><meta charset="utf-8"/>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { width:720px; background:#161b22; color:#e6edf3; font-family:"Noto Sans Thai","Sarabun","Helvetica Neue",Arial,sans-serif; padding:26px 30px 22px; -webkit-font-smoothing:antialiased; }
    .title { font-size:20px; font-weight:800; letter-spacing:.2px; }
    .muted { color:#8b949e; }
    .title .muted { font-weight:600; }
    .sub { color:#8b949e; font-size:13px; margin-top:3px; }
    .hr { height:1px; background:#2d333b; margin:14px 0 16px; }
    .stats { display:flex; gap:12px; margin-bottom:16px; }
    .stat { flex:1; background:#21262d; border-radius:10px; padding:12px 14px; }
    .stat .k { font-size:12px; color:#8b949e; margin-bottom:4px; }
    .stat .v { font-size:19px; font-weight:800; }
    .green { color:#3fb950; } .red { color:#ff7b72; }
    .row { display:flex; align-items:center; gap:12px; margin:7px 0; }
    .row.big { margin:10px 0 4px; }
    .wlabel { flex:0 0 96px; font-size:13px; font-weight:600; color:#adbac7; font-family:"SF Mono",ui-monospace,Menlo,"Noto Sans Thai",monospace; background:#21262d; border-radius:6px; padding:5px 8px; text-align:center; }
    .track { position:relative; flex:1; height:22px; border-radius:6px; background-color:#262c34; background-image:radial-gradient(rgba(255,255,255,.16) 1.3px, transparent 1.4px); background-size:9px 9px; overflow:hidden; }
    .fill { position:absolute; top:0; left:0; bottom:0; border-radius:6px; background:linear-gradient(90deg,#4b78ff,#7d9bff); }
    .fill.warn { background:linear-gradient(90deg,#e5534b,#ff7b72); }
    .wval { flex:0 0 auto; min-width:170px; font-size:13.5px; text-align:right; color:#e6edf3; }
    .wval b { font-weight:700; }
    .nobudget { color:#8b949e; font-size:13px; margin:8px 0 4px; }
    .safe { margin:10px 0 2px; font-size:14.5px; }
    .safe b { color:#3fb950; font-size:16px; }
    .sect { font-size:14px; font-weight:700; margin:16px 0 10px; color:#adbac7; }
    .empty { color:#6e7681; font-size:13px; background:#1b2129; border:1px dashed #2d333b; border-radius:8px; padding:16px; text-align:center; }
    .chart { display:flex; gap:7px; }
    .bcol { flex:1; display:flex; flex-direction:column; align-items:center; gap:4px; }
    .bval { height:15px; font-size:10.5px; font-weight:700; color:#adbac7; }
    .btrack { position:relative; width:100%; height:96px; border-radius:5px; background-color:#20262e; background-image:radial-gradient(rgba(255,255,255,.13) 1.2px, transparent 1.3px); background-size:8px 8px; overflow:hidden; }
    .bfill { position:absolute; left:0; right:0; bottom:0; border-radius:5px 5px 0 0; background:linear-gradient(180deg,#7d9bff,#4b78ff); }
    .bfill.today { background:linear-gradient(180deg,#ffd166,#f0b429); }
    .blab { font-size:10.5px; color:#6e7681; }
    .blab.now { color:#f0b429; font-weight:700; }
    .added { font-size:14px; margin:3px 0; }
    .items { display:flex; flex-direction:column; gap:4px; }
    .item { display:flex; align-items:center; gap:10px; background:#1b2129; border-radius:8px; padding:7px 12px; font-size:13.5px; }
    .itime { flex:0 0 44px; color:#6e7681; font-size:12px; font-family:"SF Mono",ui-monospace,Menlo,monospace; }
    .iname { flex:1; color:#e6edf3; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .icat { flex:0 0 auto; color:#8b949e; font-size:11.5px; background:#21262d; border-radius:5px; padding:2px 7px; }
    .iamt { flex:0 0 auto; min-width:74px; text-align:right; font-weight:700; }
    .foot { border-top:1px solid #2d333b; margin-top:16px; padding-top:12px; font-size:12px; color:#6e7681; }
  </style></head>
  <body>
    <div class="title">การเงินส่วนตัว <span class="muted">· ${esc(monthLabel)}</span></div>
    <div class="sub">บันทึกแล้ว ${s.txnCount} รายการเดือนนี้</div>
    <div class="hr"></div>
    ${added ? `<div style="margin-bottom:12px">${added}</div>` : ""}
    <div class="stats">
      <div class="stat"><div class="k">ใช้วันนี้</div><div class="v">${fmtBaht(s.todayExpense)} ฿</div></div>
      <div class="stat"><div class="k">ใช้เดือนนี้</div><div class="v red">${fmtBaht(s.monthExpense)} ฿</div></div>
      <div class="stat"><div class="k">รับเดือนนี้</div><div class="v green">${fmtBaht(s.monthIncome)} ฿</div></div>
      <div class="stat"><div class="k">รับ−จ่าย</div><div class="v ${s.monthIncome - s.monthExpense >= 0 ? "green" : "red"}">${fmtBaht(s.monthIncome - s.monthExpense)} ฿</div></div>
    </div>
    ${totalBar}
    ${safe}
    ${itemsHtml}
    ${rowHtml ? `<div class="sect">รายหมวด · เดือนนี้</div>${rowHtml}` : ""}
    <div class="sect">รายจ่ายรายวัน · 14 วันล่าสุด</div>
    ${chart}
    <div class="foot">${esc(s.now.toLocaleString("th-TH-u-ca-gregory", { dateStyle: "short", timeStyle: "short" }))} · Vex</div>
  </body></html>`;
}

// ===== "ซื้ออะไรไปบ้าง" — ลิสต์รายการรายตัวจาก DB ตรง ๆ (ไม่ผ่าน LLM ตัวเลขไม่มีทางเพี้ยน) =====

export type ItemizedPeriod = "today" | "yesterday" | "week" | "month";

export async function itemizedText(period: ItemizedPeriod, now = new Date()): Promise<string> {
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let from: Date, to: Date, label: string;
  if (period === "yesterday") {
    from = new Date(t0.getTime() - 86400_000); to = t0; label = "เมื่อวาน";
  } else if (period === "week") {
    from = new Date(t0.getTime() - ((now.getDay() + 6) % 7) * 86400_000); to = new Date(t0.getTime() + 86400_000); label = "สัปดาห์นี้";
  } else if (period === "month") {
    from = new Date(now.getFullYear(), now.getMonth(), 1); to = new Date(now.getFullYear(), now.getMonth() + 1, 1); label = "เดือนนี้";
  } else {
    from = t0; to = new Date(t0.getTime() + 86400_000); label = "วันนี้";
  }
  const rows = await db.financeTxn.findMany({ where: { occurredAt: { gte: from, lt: to } }, orderBy: { occurredAt: "asc" } });
  if (!rows.length) return `${label}ยังไม่มีรายการเลยครับ`;
  const exp = rows.filter((r) => r.type === "expense").reduce((s, r) => s + r.amount, 0);
  const inc = rows.filter((r) => r.type === "income").reduce((s, r) => s + r.amount, 0);
  const lines: string[] = [`รายการ${label} (${rows.length} รายการ · จ่าย ${fmtBaht(exp)} ฿${inc ? ` · รับ ${fmtBaht(inc)} ฿` : ""})`];
  const multiDay = period === "week" || period === "month";
  let lastDay = "";
  for (const r of rows) {
    if (multiDay) {
      const d = r.occurredAt.toLocaleDateString("th-TH-u-ca-gregory", { weekday: "short", day: "numeric", month: "short" });
      if (d !== lastDay) { lines.push(`\n${d}`); lastDay = d; }
    }
    const time = r.occurredAt.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    lines.push(`• ${time} ${r.type === "income" ? "+" : "−"}${fmtBaht(r.amount)} ฿ ${r.note || r.category}${r.note ? ` (${r.category})` : ""}`);
  }
  return lines.join("\n");
}

// ===== สมุดบัญชีใน Obsidian (AI-Personal/finance/YYYY-MM.md) =====
// เขียนใหม่ทั้งไฟล์จาก DB ทุกครั้งที่บัญชีเปลี่ยน (append อย่างเดียวทำไฟล์เพี้ยนตอนลบ/แก้รายการ)

export function ymOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function rebuildLedgerMonth(ym: string): Promise<void> {
  const [y, m] = ym.split("-").map(Number);
  const from = new Date(y, m - 1, 1);
  const to = new Date(y, m, 1);
  const rows = await db.financeTxn.findMany({
    where: { occurredAt: { gte: from, lt: to } },
    orderBy: { occurredAt: "asc" },
  });
  const lines = rows.map((t) => {
    const dateStr = t.occurredAt.toLocaleString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    return `| ${dateStr} | ${t.type === "income" ? "รับ" : "จ่าย"} | ${t.category} | ${t.type === "income" ? "+" : "−"}${fmtBaht(t.amount)} | ${t.note || "-"} |`;
  });
  const income = rows.filter((r) => r.type === "income").reduce((a, r) => a + r.amount, 0);
  const expense = rows.filter((r) => r.type === "expense").reduce((a, r) => a + r.amount, 0);
  const md = [
    "---",
    "type: ledger",
    "tags: [ส่วนตัว, การเงิน]",
    `month: ${ym}`,
    "---",
    "",
    `# บัญชี ${ym}`,
    "",
    `รับ ${fmtBaht(income)} ฿ · จ่าย ${fmtBaht(expense)} ฿ · คงเหลือ ${fmtBaht(income - expense)} ฿ (${rows.length} รายการ)`,
    "",
    "| วันที่ | ประเภท | หมวด | จำนวน (฿) | รายละเอียด |",
    "|---|---|---|---:|---|",
    ...(lines.length ? lines : ["| - | - | - | - | ยังไม่มีรายการ |"]),
  ].join("\n");
  await writePersonalNote(`finance/${ym}.md`, md + personalHubFooter([`[[${PERSONAL_FOLDER}/finance/_สารบัญ-การเงิน|สารบัญการเงิน]]`]));
}

// ===== แก้บัญชีด้วยภาษาคน (Vex แก้ตัวเลขเองได้) =====
// เจ้าของสั่งอิสระ เช่น "ลบรายการเงินเดือน Thunder ที่ซ้ำ" / "แก้ค่ากาแฟเมื่อกี้เป็น 55" / "ยอดจริงคือ 22,879.12"
// LLM เลือก action จากตารางรายการจริงเท่านั้น → ระบบลงมือ + rebuild สมุดบัญชี → ยืนยันด้วยผลที่ทำจริง

const EDIT_SYSTEM = `คุณคือระบบแก้ไขบัญชีการเงินส่วนตัว ตอบ JSON เท่านั้น ไม่มีข้อความอื่น ไม่มี \`\`\`
โครงสร้าง: {"actions":[{"action":"delete","id":"..."},{"action":"update","id":"...","set":{"amount":123.45,"category":"...","type":"income|expense","note":"...","occurredAt":"YYYY-MM-DDTHH:mm"}}],"reason":"อธิบายสั้น ๆ ว่าทำอะไรเพราะอะไร"}
กติกา:
- เลือก id จาก "ตารางรายการ" ที่ให้เท่านั้น ห้ามสร้าง id เอง
- "ซ้ำ/ตัวซ้ำ/บันทึกซ้ำ" = เก็บรายการที่บันทึกก่อน (บันทึกเมื่อ เก่าสุด) แล้วลบตัวที่บันทึกทีหลัง
- ถ้าเจ้าของบอกยอดรวมที่ถูกต้อง ให้หา action ที่ทำให้ยอดรวมตรงตามนั้น (มักเป็นการลบตัวซ้ำ)
- update.set ใส่เฉพาะ field ที่ต้องเปลี่ยน
- แก้เฉพาะที่เจ้าของสั่งชัดเจนเท่านั้น ไม่แน่ใจว่าหมายถึงรายการไหน = {"actions":[],"reason":"บอกว่าติดตรงไหน"}`;

export interface EditFinanceResult {
  applied: string[]; // สิ่งที่ทำสำเร็จ (ประโยคอ่านรู้เรื่อง)
  reason: string;    // คำอธิบาย/เหตุที่ไม่ทำ
}

export async function editFinance(command: string): Promise<EditFinanceResult> {
  const since = new Date(Date.now() - 62 * 86400_000);
  const rows = await db.financeTxn.findMany({ where: { occurredAt: { gte: since } }, orderBy: { createdAt: "asc" }, take: 60 });
  if (!rows.length) return { applied: [], reason: "ยังไม่มีรายการในระบบ" };
  const table = rows
    .map((r) => `${r.id} | เกิด ${r.occurredAt.toISOString().slice(0, 16)} | ${r.type} | ${r.amount} | ${r.category} | ${r.note || "-"} | บันทึกเมื่อ ${r.createdAt.toISOString().slice(0, 16)}`)
    .join("\n");
  const raw = await askExtractor(
    `คำสั่งจากเจ้าของ: """${command}"""\n\nตารางรายการ (id | เกิดเมื่อ | ประเภท | จำนวน | หมวด | โน้ต | บันทึกเมื่อ):\n${table}`,
    { system: EDIT_SYSTEM, timeoutMs: 120_000 },
  );
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { applied: [], reason: "อ่านคำสั่งไม่ออก ลองบอกชื่อรายการ+ยอดชัด ๆ อีกที" };
  let actions: { action: string; id: string; set?: Record<string, unknown> }[] = [];
  let reason = "";
  try {
    const j = JSON.parse(m[0]);
    actions = Array.isArray(j.actions) ? j.actions : [];
    reason = String(j.reason || "");
  } catch {
    return { applied: [], reason: "อ่านคำสั่งไม่ออก ลองบอกชื่อรายการ+ยอดชัด ๆ อีกที" };
  }

  const applied: string[] = [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const touched = new Set<string>();
  for (const a of actions.slice(0, 12)) {
    const row = byId.get(String(a.id));
    if (!row) continue;
    if (a.action === "delete") {
      await db.financeTxn.delete({ where: { id: row.id } }).catch(() => null);
      applied.push(`ลบ: ${row.type === "income" ? "รับ" : "จ่าย"} ${fmtBaht(row.amount)} ฿ · ${row.category}${row.note ? ` · ${row.note}` : ""}`);
      touched.add(ymOf(row.occurredAt));
    } else if (a.action === "update" && a.set && typeof a.set === "object") {
      const set = a.set as { amount?: number; category?: string; type?: string; note?: string; occurredAt?: string };
      const data: Record<string, unknown> = {};
      if (typeof set.amount === "number" && set.amount > 0) data.amount = Math.round(set.amount * 100) / 100;
      if (set.category) data.category = String(set.category).slice(0, 30);
      if (set.type === "income" || set.type === "expense") data.type = set.type;
      if (set.note !== undefined) data.note = String(set.note).slice(0, 200) || null;
      if (set.occurredAt) {
        const d = new Date(set.occurredAt);
        if (!isNaN(d.getTime()) && d.getFullYear() > 2000) data.occurredAt = d;
      }
      if (!Object.keys(data).length) continue;
      await db.financeTxn.update({ where: { id: row.id }, data }).catch(() => null);
      const changes = Object.entries(data).map(([k, v]) => `${k}=${v instanceof Date ? v.toLocaleDateString("th-TH-u-ca-gregory") : v}`).join(", ");
      applied.push(`แก้ ${row.category} ${fmtBaht(row.amount)} ฿ → ${changes}`);
      touched.add(ymOf(row.occurredAt));
      if (data.occurredAt instanceof Date) touched.add(ymOf(data.occurredAt));
    }
  }
  for (const ym of touched) await rebuildLedgerMonth(ym).catch(() => {});
  return { applied, reason };
}
