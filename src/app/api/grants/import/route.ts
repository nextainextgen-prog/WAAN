import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { normalizeAmount, normalizeStatus, normalizeDate } from "@/lib/import";

interface RawRow {
  projectName?: unknown;
  ownerName?: unknown;
  source?: unknown;
  amount?: unknown;
  status?: unknown;
  nextDeadline?: unknown;
  note?: unknown;
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const rows: RawRow[] = body.rows || [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "ไม่มีข้อมูลให้นำเข้า" }, { status: 400 });
  }

  const baseOrder: Record<string, number> = {};
  const existing = await db.grant.groupBy({ by: ["status"], _max: { orderIndex: true } });
  for (const e of existing) baseOrder[e.status] = (e._max.orderIndex ?? -1) + 1;

  let imported = 0;
  let skipped = 0;
  const toCreate: {
    projectName: string;
    ownerName: string | null;
    source: string | null;
    amount: number;
    status: string;
    nextDeadline: Date | null;
    note: string | null;
    orderIndex: number;
  }[] = [];

  for (const r of rows) {
    const projectName = r.projectName != null ? String(r.projectName).trim() : "";
    if (!projectName) {
      skipped++;
      continue;
    }
    const status = normalizeStatus(r.status);
    const orderIndex = baseOrder[status] ?? 0;
    baseOrder[status] = orderIndex + 1;
    toCreate.push({
      projectName,
      ownerName: r.ownerName != null && String(r.ownerName).trim() ? String(r.ownerName).trim() : null,
      source: r.source != null && String(r.source).trim() ? String(r.source).trim() : null,
      amount: normalizeAmount(r.amount),
      status,
      nextDeadline: normalizeDate(r.nextDeadline),
      note: r.note != null && String(r.note).trim() ? String(r.note).trim() : null,
      orderIndex,
    });
    imported++;
  }

  if (toCreate.length) {
    await db.grant.createMany({ data: toCreate });
  }

  return NextResponse.json({ ok: true, imported, skipped });
}
