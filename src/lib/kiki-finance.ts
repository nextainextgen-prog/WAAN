import { db } from "./db";
import { askClaude } from "./claude";
import { KIKI_GUARD, appendPersonalNote, readPersonalNote, writePersonalNote, personalHubFooter, PERSONAL_FOLDER } from "./kiki";

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
- หนึ่งข้อความอาจมีหลายรายการ — แยกเป็นหลาย item
- ไม่ใช่เรื่องการเงินเลย = {"items":[]}`;

export async function extractFinance(text: string, imagePaths: string[] = []): Promise<ParsedTxn[]> {
  const img = imagePaths.length
    ? `\n\nรูปสลิปที่แนบมา (เปิดอ่านด้วย Read ทุกไฟล์):\n${imagePaths.map((p, i) => `${i + 1}. ${p}`).join("\n")}`
    : "";
  const raw = await askClaude(`ข้อความจากเจ้าของ: """${text}"""${img}`, {
    guard: KIKI_GUARD,
    system: EXTRACT_SYSTEM,
    timeoutMs: 120_000,
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
    let occurred = new Date();
    if (it.occurredAt) {
      const d = new Date(it.occurredAt);
      if (!isNaN(d.getTime()) && d.getFullYear() > 2000) occurred = d;
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
    await appendLedger(rec).catch(() => {});
  }
  return out;
}

export async function deleteLastTxn(): Promise<TxnRecord | null> {
  const last = await db.financeTxn.findFirst({ orderBy: { createdAt: "desc" } });
  if (!last) return null;
  await db.financeTxn.delete({ where: { id: last.id } });
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
  daily14: { label: string; amount: number }[];
  txnCount: number;
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
  const todayExpense = monthExpRows.filter((r) => r.occurredAt >= tStart).reduce((s, r) => s + r.amount, 0);
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

  const daily14: { label: string; amount: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const d0 = new Date(d14.getTime() + i * 86400_000);
    const d1 = new Date(d0.getTime() + 86400_000);
    const amt = last14.filter((r) => r.occurredAt >= d0 && r.occurredAt < d1).reduce((s, r) => s + r.amount, 0);
    daily14.push({ label: `${d0.getDate()}`, amount: amt });
  }

  return {
    now, todayExpense, monthExpense, monthIncome, prevMonthExpense,
    byCategory, prevByCategory, budgets, totalBudget, daysLeft, safePerDay, daily14,
    txnCount: monthRows.length,
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
  if (s.prevMonthExpense > 0) {
    const diff = Math.round(((s.monthExpense - s.prevMonthExpense) / s.prevMonthExpense) * 100);
    facts.push(`เทียบเดือนที่แล้วทั้งเดือน (${fmtBaht(s.prevMonthExpense)} บาท): ตอนนี้${diff >= 0 ? "มากกว่า" : "น้อยกว่า"} ${Math.abs(diff)}%`);
  }
  if (s.byCategory.length) {
    facts.push(`หมวดที่ใช้เยอะสุดเดือนนี้: ${s.byCategory.slice(0, 3).map((c) => `${c.category} ${fmtBaht(c.amount)} บาท`).join(" · ")}`);
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
      const val = r.cap ? `${fmtBaht(r.used)} / ${fmtBaht(r.cap)} · ${pct}%` : `${fmtBaht(r.used)} ฿`;
      return `<div class="row">
        <div class="wlabel">${esc(r.label)}</div>
        <div class="track"><div class="fill${warn ? " warn" : ""}" style="width:${Math.max(2, pct)}%"></div></div>
        <div class="wval${warn ? " red" : ""}">${esc(val)}</div>
      </div>`;
    })
    .join("");

  const maxDay = Math.max(1, ...s.daily14.map((d) => d.amount));
  const bars = s.daily14
    .map((d, i) => {
      const h = Math.round((d.amount / maxDay) * 78);
      const today = i === s.daily14.length - 1;
      return `<div class="bcol"><div class="bar${today ? " today" : ""}" style="height:${Math.max(3, h)}px"></div><div class="blab">${esc(d.label)}</div></div>`;
    })
    .join("");

  const added = (opts.justAdded || [])
    .map((t) => {
      const sign = t.type === "income" ? "+" : "−";
      const cls = t.type === "income" ? "green" : "red";
      return `<div class="added"><span class="${cls}">${sign}${fmtBaht(t.amount)} ฿</span> · ${esc(t.category)}${t.note ? ` · ${esc(t.note)}` : ""}</div>`;
    })
    .join("");

  const totalBar = pctTotal !== null
    ? `<div class="row big">
        <div class="wlabel">งบเดือนนี้</div>
        <div class="track"><div class="fill${pctTotal >= 85 ? " warn" : ""}" style="width:${Math.max(2, pctTotal)}%"></div></div>
        <div class="wval${pctTotal >= 85 ? " red" : ""}">${pctTotal}% · เหลือ ${fmtBaht(Math.max(0, (s.totalBudget || 0) - s.monthExpense))} ฿</div>
      </div>`
    : `<div class="nobudget">ยังไม่ได้ตั้งงบรวม — พิมพ์ "ตั้งงบเดือนละ 20000" ได้เลย</div>`;

  const safe = s.safePerDay !== null
    ? `<div class="safe">ใช้ได้อีกวันละ <b>${fmtBaht(Math.floor(s.safePerDay))} ฿</b> (เหลือ ${s.daysLeft} วันถึงสิ้นเดือน)</div>`
    : "";

  return `<!doctype html><html lang="th"><head><meta charset="utf-8"/>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { width:720px; background:#161b22; color:#e6edf3; font-family:"Noto Sans Thai","Sarabun","Helvetica Neue",Arial,sans-serif; padding:26px 30px 22px; -webkit-font-smoothing:antialiased; }
    .title { font-size:20px; font-weight:800; }
    .title .em { color:#f0b429; }
    .sub { color:#8b949e; font-size:13px; margin-top:3px; }
    .hr { height:1px; background:#2d333b; margin:14px 0 16px; }
    .stats { display:flex; gap:12px; margin-bottom:16px; }
    .stat { flex:1; background:#21262d; border-radius:10px; padding:12px 14px; }
    .stat .k { font-size:12px; color:#8b949e; margin-bottom:4px; }
    .stat .v { font-size:19px; font-weight:800; }
    .green { color:#3fb950; } .red { color:#ff7b72; }
    .row { display:flex; align-items:center; gap:12px; margin:7px 0; }
    .row.big { margin:10px 0 4px; }
    .wlabel { flex:0 0 96px; font-size:13px; font-weight:600; color:#adbac7; background:#21262d; border-radius:6px; padding:5px 8px; text-align:center; }
    .track { position:relative; flex:1; height:22px; border-radius:6px; background-color:#262c34; background-image:radial-gradient(rgba(255,255,255,.16) 1.3px, transparent 1.4px); background-size:9px 9px; overflow:hidden; }
    .fill { position:absolute; top:0; left:0; bottom:0; border-radius:6px; background:linear-gradient(90deg,#4b78ff,#7d9bff); }
    .fill.warn { background:linear-gradient(90deg,#e5534b,#ff7b72); }
    .wval { flex:0 0 auto; min-width:150px; font-size:13px; font-weight:600; text-align:right; color:#adbac7; }
    .nobudget { color:#8b949e; font-size:13px; margin:8px 0 4px; }
    .safe { margin:10px 0 2px; font-size:14.5px; color:#e6edf3; }
    .safe b { color:#3fb950; font-size:16px; }
    .sect { font-size:14px; font-weight:700; margin:16px 0 8px; color:#adbac7; }
    .chart { display:flex; align-items:flex-end; gap:7px; height:100px; padding:2px 2px 0; }
    .bcol { flex:1; display:flex; flex-direction:column; align-items:center; gap:4px; }
    .bar { width:100%; border-radius:4px 4px 0 0; background:linear-gradient(180deg,#7d9bff,#4b78ff); }
    .bar.today { background:linear-gradient(180deg,#ffd166,#f0b429); }
    .blab { font-size:10.5px; color:#6e7681; }
    .added { font-size:14px; margin:3px 0; }
    .foot { border-top:1px solid #2d333b; margin-top:14px; padding-top:12px; font-size:12px; color:#6e7681; }
  </style></head>
  <body>
    <div class="title">💸 <span class="em">การเงินส่วนตัว</span> · ${esc(monthLabel)}</div>
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
    ${rowHtml ? `<div class="sect">รายหมวด (เดือนนี้)</div>${rowHtml}` : ""}
    <div class="sect">รายจ่ายรายวัน · 14 วันล่าสุด</div>
    <div class="chart">${bars}</div>
    <div class="foot">🕐 ${esc(s.now.toLocaleString("th-TH-u-ca-gregory", { dateStyle: "short", timeStyle: "short" }))} · Vex</div>
  </body></html>`;
}

// ===== สมุดบัญชีใน Obsidian (AI-Personal/finance/YYYY-MM.md) =====

async function appendLedger(t: TxnRecord): Promise<void> {
  const d = t.occurredAt;
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const rel = `finance/${ym}.md`;
  const exists = await readPersonalNote(rel);
  if (!exists) {
    const head = [
      "---",
      "type: ledger",
      "tags: [ส่วนตัว, การเงิน]",
      `month: ${ym}`,
      "---",
      "",
      `# บัญชี ${ym}`,
      "",
      "| วันที่ | ประเภท | หมวด | จำนวน (฿) | รายละเอียด |",
      "|---|---|---|---:|---|",
      "",
    ].join("\n");
    await writePersonalNote(rel, head + personalHubFooter([`[[${PERSONAL_FOLDER}/finance/_สารบัญ-การเงิน|สารบัญการเงิน]]`]));
  }
  const dateStr = d.toLocaleString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const row = `| ${dateStr} | ${t.type === "income" ? "รับ" : "จ่าย"} | ${t.category} | ${t.type === "income" ? "+" : "−"}${fmtBaht(t.amount)} | ${t.note || "-"} |`;
  // แทรกแถวก่อน footer (ท้ายตาราง)
  const cur = (await readPersonalNote(rel)) || "";
  const idx = cur.indexOf("\n\n---\n🔗");
  if (idx >= 0) await writePersonalNote(rel, cur.slice(0, idx) + row + "\n" + cur.slice(idx));
  else await appendPersonalNote(rel, row + "\n");
}
