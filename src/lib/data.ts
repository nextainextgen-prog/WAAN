import { db } from "./db";
import {
  GRANT_STATUSES,
  OKR_COUNTED_STATUSES,
  DEFAULT_PROBABILITY,
  type GrantStatus,
  daysUntil,
} from "./grants";
import { fiscalYearOf, fiscalRange, fiscalProgress, fiscalDaysLeft } from "./fiscal";

export async function getAllGrants() {
  return db.grant.findMany({
    orderBy: [{ status: "asc" }, { orderIndex: "asc" }],
    include: { installments: { orderBy: { seq: "asc" } } },
  });
}

/** ปีงบของทุน — ถ้าไม่ได้ระบุไว้ ใช้ปีงบตอนที่บันทึกเข้าระบบ */
export function grantFiscalYear(g: { fiscalYear: number | null; createdAt: Date }): number {
  return g.fiscalYear ?? fiscalYearOf(g.createdAt);
}

/** ยอดที่รับจริงของงวดหนึ่ง (ถ้าไม่กรอกยอดจริง ถือว่าได้ตามที่ตั้งไว้) */
export function installmentReceived(i: { amount: number; receivedAmount: number | null }): number {
  return i.receivedAmount ?? i.amount ?? 0;
}

export interface OkrSummary {
  fiscalYear: number; // ปีงบ ค.ศ.
  year: number; // alias เดิม (เลี่ยงพังโค้ดเก่า)
  target: number;

  received: number; // เงินรับจริงในปีงบนี้ (นับจากงวดที่ติ๊กว่ารับแล้ว) ← ตัวเลขหลักของ OKR
  actual: number; // alias ของ received
  awaiting: number; // เงินผูกพันแล้วแต่ยังไม่ได้รับ (งวดที่ยังไม่ติ๊ก ของทุนที่อนุมัติแล้ว)
  committed: number; // มูลค่าสัญญารวมของทุนที่อนุมัติแล้วในปีงบนี้
  pipeline: number; // มูลค่าทุนที่ยื่นไปแต่ยังไม่อนุมัติ
  weightedPipeline: number; // ท่อถ่วงน้ำหนักด้วยโอกาสได้ทุน

  percent: number; // received / target
  forecast: number; // คาดการณ์สิ้นปีงบ = รับจริง + รอรับ + ท่อถ่วงน้ำหนัก
  forecastPercent: number;

  paceRatio: number; // สัดส่วนของปีงบที่ผ่านไป (0-1)
  paceTarget: number; // ณ วันนี้ควรได้เท่าไหร่แล้ว
  paceDelta: number; // received - paceTarget (ลบ = ช้ากว่าเป้า)
  daysLeft: number;

  totalGrants: number;
  byStatus: { key: GrantStatus; label: string; count: number; amount: number }[];

  // จุดที่ต้องลงมือ
  missingInstallments: { id: string; projectName: string; amount: number }[]; // ทุนอนุมัติแล้วแต่ยังไม่ระบุงวด → ทำให้เลขรับจริงไม่ครบ
  overdueInstallments: InstallmentAlert[]; // เลยกำหนดรับแล้วยังไม่ได้เงิน
  dueInstallments: InstallmentAlert[]; // ครบกำหนดรับใน 30 วัน

  upcoming: {
    id: string;
    projectName: string;
    status: string;
    nextDeadline: Date | null;
    days: number | null;
  }[];
}

export interface InstallmentAlert {
  id: string;
  grantId: string;
  projectName: string;
  label: string;
  amount: number;
  dueDate: Date | null;
  days: number | null;
}

export async function getOkrSummary(fy?: number): Promise<OkrSummary> {
  const fiscalYear = fy ?? fiscalYearOf();
  const { start, end } = fiscalRange(fiscalYear);

  const [grants, targetRow, receivedRows] = await Promise.all([
    db.grant.findMany({ include: { installments: { orderBy: { seq: "asc" } } } }),
    db.okrTarget.findUnique({ where: { year: fiscalYear } }),
    // เงินเข้าจริงนับตามวันที่รับเงิน ไม่ว่าทุนนั้นจะเป็นของปีงบไหน (cash basis)
    db.grantInstallment.findMany({
      where: { receivedAt: { gte: start, lt: end } },
      select: { amount: true, receivedAmount: true },
    }),
  ]);

  const target = targetRow?.targetAmount ?? 10_000_000;
  const received = receivedRows.reduce((s, i) => s + installmentReceived(i), 0);

  // ทุนของปีงบนี้เท่านั้น สำหรับตัวเลขฝั่ง "สัญญา/ท่อ"
  const inYear = grants.filter((g) => grantFiscalYear(g) === fiscalYear);
  const counted = inYear.filter((g) => OKR_COUNTED_STATUSES.includes(g.status as GrantStatus));
  const submitted = inYear.filter((g) => g.status === "submitted");

  const committed = counted.reduce((s, g) => s + (g.amount || 0), 0);
  const awaiting = counted.reduce(
    (s, g) => s + g.installments.filter((i) => !i.receivedAt).reduce((t, i) => t + (i.amount || 0), 0),
    0,
  );
  const pipeline = submitted.reduce((s, g) => s + (g.amount || 0), 0);
  const weightedPipeline = submitted.reduce(
    (s, g) => s + (g.amount || 0) * ((g.probability ?? DEFAULT_PROBABILITY) / 100),
    0,
  );

  const forecast = received + awaiting + weightedPipeline;
  const paceRatio = fiscalProgress(fiscalYear);
  const paceTarget = target * paceRatio;

  const byStatus = GRANT_STATUSES.map((meta) => {
    const rows = inYear.filter((g) => g.status === meta.key);
    return {
      key: meta.key,
      label: meta.label,
      count: rows.length,
      amount: rows.reduce((s, g) => s + (g.amount || 0), 0),
    };
  });

  // ทุนอนุมัติแล้วแต่ยังไม่ได้ลงงวดเงิน — เงินรับจริงจะขาดไปจนกว่าจะลง
  const missingInstallments = counted
    .filter((g) => g.installments.length === 0)
    .map((g) => ({ id: g.id, projectName: g.projectName, amount: g.amount }));

  const alerts: InstallmentAlert[] = [];
  for (const g of grants) {
    for (const i of g.installments) {
      if (i.receivedAt || !i.dueDate) continue;
      alerts.push({
        id: i.id,
        grantId: g.id,
        projectName: g.projectName,
        label: i.label || `งวดที่ ${i.seq}`,
        amount: i.amount,
        dueDate: i.dueDate,
        days: daysUntil(i.dueDate),
      });
    }
  }
  const overdueInstallments = alerts
    .filter((a) => (a.days ?? 0) < 0)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  const dueInstallments = alerts
    .filter((a) => (a.days ?? 99) >= 0 && (a.days ?? 99) <= 30)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

  const upcoming = grants
    .filter((g) => g.nextDeadline && g.status !== "closed")
    .map((g) => ({
      id: g.id,
      projectName: g.projectName,
      status: g.status,
      nextDeadline: g.nextDeadline,
      days: daysUntil(g.nextDeadline),
    }))
    .filter((g) => g.days !== null && g.days <= 30)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

  return {
    fiscalYear,
    year: fiscalYear,
    target,
    received,
    actual: received,
    awaiting,
    committed,
    pipeline,
    weightedPipeline,
    percent: target > 0 ? Math.round((received / target) * 100) : 0,
    forecast,
    forecastPercent: target > 0 ? Math.round((forecast / target) * 100) : 0,
    paceRatio,
    paceTarget,
    paceDelta: received - paceTarget,
    daysLeft: fiscalDaysLeft(fiscalYear),
    totalGrants: inYear.length,
    byStatus,
    missingInstallments,
    overdueInstallments,
    dueInstallments,
    upcoming,
  };
}

/** ทุนที่ค้างสถานะเดิมนานเกินกำหนด — ใช้เตือนว่าเรื่องนิ่ง */
export async function getStuckGrants(thresholdDays = 60) {
  const grants = await db.grant.findMany({
    where: { status: { notIn: ["closed"] } },
    include: { events: { where: { kind: "status" }, orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const out: { id: string; projectName: string; status: string; days: number }[] = [];
  for (const g of grants) {
    const since = g.events[0]?.createdAt ?? g.createdAt;
    const days = Math.floor((Date.now() - since.getTime()) / 86_400_000);
    if (days >= thresholdDays) {
      out.push({ id: g.id, projectName: g.projectName, status: g.status, days });
    }
  }
  return out.sort((a, b) => b.days - a.days);
}
