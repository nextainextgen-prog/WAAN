import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logGrantEvent } from "@/lib/grant-events";
import { fiscalYearOf } from "@/lib/fiscal";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const grants = await db.grant.findMany({
    orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
    include: { installments: { orderBy: { seq: "asc" } } },
  });
  return NextResponse.json({ grants });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (!body.projectName?.trim()) {
    return NextResponse.json({ error: "กรุณาระบุชื่อโครงการ" }, { status: 400 });
  }

  const max = await db.grant.aggregate({
    where: { status: body.status || "submitted" },
    _max: { orderIndex: true },
  });

  const grant = await db.grant.create({
    data: {
      projectName: body.projectName.trim(),
      ownerName: body.ownerName?.trim() || null,
      source: body.source?.trim() || null,
      amount: Number(body.amount) || 0,
      status: body.status || "submitted",
      nextDeadline: body.nextDeadline ? new Date(body.nextDeadline) : null,
      note: body.note?.trim() || null,
      orderIndex: (max._max.orderIndex ?? -1) + 1,
      fiscalYear: Number(body.fiscalYear) || fiscalYearOf(),
      probability: body.probability != null ? Number(body.probability) : null,
      startDate: body.startDate ? new Date(body.startDate) : null,
      endDate: body.endDate ? new Date(body.endDate) : null,
    },
  });

  await logGrantEvent(grant.id, "created", `เพิ่มทุน "${grant.projectName}" เข้าระบบ`, {
    toStatus: grant.status,
    actor: user.name,
  });

  return NextResponse.json({ grant });
}
