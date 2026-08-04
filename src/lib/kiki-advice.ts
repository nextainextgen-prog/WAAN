import { db } from "./db";
import { askExtractor, rememberOwnerFact } from "./kiki";
import { addTask } from "./kiki-tasks";
import { financeSnapshot, snapshotFacts, fmtBaht } from "./kiki-finance";

/**
 * โหมดที่ปรึกษาการเงิน (เจ้าของสั่ง 4 ส.ค. 2026:
 *  "เดี๋ยวผมจะอธิบายรายละเอียดการเงินให้มันในแชท แล้วให้มันวิเคราะห์อย่างโหด ช่วยจัดการให้ และจำสิ่งที่ต้องทำด้วย")
 *
 * ทำ 3 อย่างในคราวเดียว: จำข้อเท็จจริงการเงินถาวร · ออกแผนจากตัวเลขจริง · ลงงานที่ต้องทำเข้ากระดาน
 */

export interface AdviceResult {
  facts: string[];
  actions: { title: string; priority: string; due?: string }[];
  plan: string;
  saved: boolean;
}

const PLAN_KIND = "finance_plan";

export async function financeAdvice(text: string, extraContext?: string): Promise<AdviceResult> {
  const snap = await financeSnapshot().catch(() => null);
  const [debts, bills, budgets] = await Promise.all([
    db.debt.findMany({ where: { settledAt: null } }).catch(() => []),
    db.recurringBill.findMany({ where: { active: true } }).catch(() => []),
    db.financeBudget.findMany().catch(() => []),
  ]);

  const real = [
    snap ? snapshotFacts(snap).join("\n") : "(ยังไม่มีข้อมูลการเงินในระบบ)",
    debts.length
      ? `หนี้/เงินยืมที่ยังไม่ปิด:\n${debts.map((d) => `- ${d.direction === "i_owe" ? "เราติด" : "เขาติดเรา"} ${d.person} ${fmtBaht(d.amount)} ฿${d.installmentAmount ? ` (ผ่อนงวดละ ${fmtBaht(d.installmentAmount)} ฿ ทุกวันที่ ${d.installmentDay ?? "-"})` : ""}`).join("\n")}`
      : "ไม่มีหนี้ค้างในระบบ",
    bills.length ? `บิลประจำ:\n${bills.map((b) => `- ${b.label} ${fmtBaht(b.amount)} ฿ ตัดทุกวันที่ ${b.dayOfMonth}`).join("\n")}` : "ยังไม่ได้บันทึกบิลประจำ",
    budgets.length ? `งบที่ตั้งไว้: ${budgets.map((b) => `${b.category} ${fmtBaht(b.monthly)} ฿`).join(" · ")}` : "ยังไม่ได้ตั้งงบ",
  ].join("\n\n");

  const raw = await askExtractor(
    `ข้อมูลจริงในระบบ:\n${real}\n\n${extraContext ? `บริบทเพิ่ม:\n${extraContext}\n\n` : ""}เจ้าของเล่าเรื่องการเงินมาว่า:\n"""${text}"""`,
    {
      system: `คุณคือที่ปรึกษาการเงินส่วนตัวที่ตรงไปตรงมาและโหด (เจ้าของขอเอง) วิเคราะห์จากตัวเลขจริงเท่านั้น ห้ามแต่งตัวเลขเพิ่ม
ตอบ JSON เท่านั้น:
{
 "facts": ["ข้อเท็จจริงการเงินที่ควรจำถาวร เขียนสมบูรณ์ในตัว เช่น 'รายได้ประจำเดือนละ 45,000 บาท เข้าทุกวันที่ 28'"],
 "actions": [{"title":"สิ่งที่ต้องลงมือทำ สั้น ชัด ทำได้จริง","priority":"high|normal|low","due":"YYYY-MM-DD ถ้ามีกำหนดชัด"}],
 "plan": "บทวิเคราะห์+แผน เขียนเป็นข้อความไทยอ่านง่าย บรรทัดละประเด็น ห้ามใช้ markdown"
}
กติกา plan: เปิดด้วยจุดที่อันตรายที่สุดก่อน · บอกตัวเลขจริงประกอบทุกข้อสรุป · ชี้ว่าต้องเปลี่ยนพฤติกรรมอะไรบ้างแบบเจาะจง (ไม่ใช่คำแนะนำลอย ๆ) · ถ้าตัวเลขไม่พอให้บอกว่าขาดข้อมูลอะไร
facts เอาเฉพาะที่เจ้าของ "บอกมาใหม่" ในข้อความนี้ (ไม่ใช่สิ่งที่ระบบมีอยู่แล้ว) ไม่มีก็ส่ง []`,
      timeoutMs: 150_000,
    },
  );

  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { facts: [], actions: [], plan: raw.trim().slice(0, 3500), saved: false };
  let parsed: AdviceResult;
  try {
    const j = JSON.parse(m[0]) as Partial<AdviceResult>;
    parsed = { facts: j.facts || [], actions: j.actions || [], plan: (j.plan || "").trim(), saved: false };
  } catch {
    return { facts: [], actions: [], plan: raw.trim().slice(0, 3500), saved: false };
  }

  for (const f of parsed.facts.slice(0, 12)) {
    await rememberOwnerFact(f, { category: "การเงิน", source: text.slice(0, 300) }).catch(() => {});
  }
  for (const a of parsed.actions.slice(0, 10)) {
    await addTask({
      title: a.title,
      kind: "todo",
      priority: (["low", "normal", "high"].includes(a.priority) ? a.priority : "normal") as "low" | "normal" | "high",
      dueDate: a.due && /^\d{4}-\d{2}-\d{2}$/.test(a.due) ? new Date(`${a.due}T09:00:00+07:00`) : null,
      detail: "จากการวางแผนการเงิน",
      source: text.slice(0, 300),
    }).catch(() => {});
  }
  if (parsed.plan) {
    const day = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    await db.kikiMemory
      .upsert({
        where: { kind_day_scope: { kind: PLAN_KIND, day, scope: "owner" } },
        update: { content: parsed.plan.slice(0, 8000) },
        create: { kind: PLAN_KIND, day, scope: "owner", content: parsed.plan.slice(0, 8000) },
      })
      .catch(() => {});
  }
  parsed.saved = true;
  return parsed;
}

/** แผนล่าสุดที่วางไว้ (ไว้เทียบตอนรีวิวรายสัปดาห์) */
export async function latestFinancePlan(): Promise<{ day: string; content: string } | null> {
  const row = await db.kikiMemory.findFirst({ where: { kind: PLAN_KIND, scope: "owner" }, orderBy: { day: "desc" } });
  return row ? { day: row.day, content: row.content } : null;
}
