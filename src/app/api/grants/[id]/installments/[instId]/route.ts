import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logGrantEvent, installmentReceivedDetail } from "@/lib/grant-events";
import { formatBaht } from "@/lib/grants";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; instId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, instId } = await params;
  const before = await db.grantInstallment.findUnique({ where: { id: instId } });
  if (!before || before.grantId !== id) {
    return NextResponse.json({ error: "ไม่พบงวดเงินนี้" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (body.label !== undefined) data.label = body.label?.trim() || null;
  if (body.seq !== undefined) data.seq = Number(body.seq) || 1;
  if (body.amount !== undefined) data.amount = Number(body.amount) || 0;
  if (body.dueDate !== undefined) data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
  if (body.note !== undefined) data.note = body.note?.trim() || null;
  if (body.receivedAt !== undefined)
    data.receivedAt = body.receivedAt ? new Date(body.receivedAt) : null;
  if (body.receivedAmount !== undefined)
    data.receivedAmount =
      body.receivedAmount === null || body.receivedAmount === "" ? null : Number(body.receivedAmount);

  const installment = await db.grantInstallment.update({ where: { id: instId }, data });

  const label = installment.label || `งวดที่ ${installment.seq}`;
  // ติ๊กรับเงิน = เหตุการณ์สำคัญที่สุด บันทึกแยกให้ชัด
  if (!before.receivedAt && installment.receivedAt) {
    await logGrantEvent(
      id,
      "installment",
      installmentReceivedDetail(
        label,
        installment.receivedAmount ?? installment.amount,
        installment.receivedAt,
      ),
      { actor: user.name },
    );
  } else if (before.receivedAt && !installment.receivedAt) {
    await logGrantEvent(id, "installment", `ยกเลิกการรับเงิน ${label}`, { actor: user.name });
  }

  return NextResponse.json({ installment });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; instId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, instId } = await params;
  const row = await db.grantInstallment.findUnique({ where: { id: instId } });
  if (!row || row.grantId !== id) {
    return NextResponse.json({ error: "ไม่พบงวดเงินนี้" }, { status: 404 });
  }

  await db.grantInstallment.delete({ where: { id: instId } });
  await logGrantEvent(
    id,
    "installment",
    `ลบ ${row.label || `งวดที่ ${row.seq}`} (${formatBaht(row.amount)})`,
    { actor: user.name },
  );

  return NextResponse.json({ ok: true });
}
