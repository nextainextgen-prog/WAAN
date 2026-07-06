import { db } from "./db";
import {
  GRANT_STATUSES,
  OKR_COUNTED_STATUSES,
  type GrantStatus,
  daysUntil,
} from "./grants";

export async function getAllGrants() {
  return db.grant.findMany({ orderBy: [{ status: "asc" }, { orderIndex: "asc" }] });
}

export interface OkrSummary {
  year: number;
  target: number;
  actual: number; // เงินที่นับเป็นผลงาน
  percent: number;
  totalGrants: number;
  byStatus: { key: GrantStatus; label: string; count: number; amount: number }[];
  upcoming: {
    id: string;
    projectName: string;
    status: string;
    nextDeadline: Date | null;
    days: number | null;
  }[];
}

export async function getOkrSummary(): Promise<OkrSummary> {
  const year = new Date().getFullYear();
  const [grants, targetRow] = await Promise.all([
    db.grant.findMany(),
    db.okrTarget.findUnique({ where: { year } }),
  ]);

  const target = targetRow?.targetAmount ?? 10_000_000;
  const actual = grants
    .filter((g) => OKR_COUNTED_STATUSES.includes(g.status as GrantStatus))
    .reduce((s, g) => s + (g.amount || 0), 0);

  const byStatus = GRANT_STATUSES.map((meta) => {
    const inStatus = grants.filter((g) => g.status === meta.key);
    return {
      key: meta.key,
      label: meta.label,
      count: inStatus.length,
      amount: inStatus.reduce((s, g) => s + (g.amount || 0), 0),
    };
  });

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
    year,
    target,
    actual,
    percent: target > 0 ? Math.round((actual / target) * 100) : 0,
    totalGrants: grants.length,
    byStatus,
    upcoming,
  };
}
