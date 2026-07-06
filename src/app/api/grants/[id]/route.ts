import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const data: Record<string, unknown> = {};
  if (body.projectName !== undefined) data.projectName = String(body.projectName).trim();
  if (body.ownerName !== undefined) data.ownerName = body.ownerName?.trim() || null;
  if (body.source !== undefined) data.source = body.source?.trim() || null;
  if (body.amount !== undefined) data.amount = Number(body.amount) || 0;
  if (body.status !== undefined) data.status = body.status;
  if (body.orderIndex !== undefined) data.orderIndex = Number(body.orderIndex);
  if (body.note !== undefined) data.note = body.note?.trim() || null;
  if (body.nextDeadline !== undefined)
    data.nextDeadline = body.nextDeadline ? new Date(body.nextDeadline) : null;

  const grant = await db.grant.update({ where: { id }, data });
  return NextResponse.json({ grant });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  await db.grant.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
