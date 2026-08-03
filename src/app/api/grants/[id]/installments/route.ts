import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logGrantEvent } from "@/lib/grant-events";
import { formatBaht } from "@/lib/grants";

// งวดเงินของทุนหนึ่งก้อน — "เงินรับจริง" ใน OKR มาจากตารางนี้เท่านั้น
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const installments = await db.grantInstallment.findMany({
    where: { grantId: id },
    orderBy: { seq: "asc" },
  });
  return NextResponse.json({ installments });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const grant = await db.grant.findUnique({ where: { id }, select: { id: true } });
  if (!grant) return NextResponse.json({ error: "ไม่พบทุนนี้" }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  // แบ่งงวดอัตโนมัติ: ส่ง { split: 3 } มาเพื่อสร้าง 3 งวดเท่า ๆ กันจากมูลค่าสัญญา
  if (body.split) {
    const n = Math.min(Math.max(Number(body.split) || 0, 1), 12);
    const full = await db.grant.findUnique({ where: { id }, select: { amount: true } });
    const total = full?.amount || 0;
    const each = Math.floor(total / n);
    const existing = await db.grantInstallment.count({ where: { grantId: id } });
    if (existing > 0) {
      return NextResponse.json({ error: "ทุนนี้มีงวดเงินอยู่แล้ว" }, { status: 400 });
    }
    const rows = Array.from({ length: n }, (_, k) => ({
      grantId: id,
      seq: k + 1,
      label: `งวดที่ ${k + 1}`,
      // งวดสุดท้ายรับเศษที่หารไม่ลงตัว เพื่อให้ผลรวมเท่ามูลค่าสัญญาพอดี
      amount: k === n - 1 ? total - each * (n - 1) : each,
    }));
    await db.grantInstallment.createMany({ data: rows });
    await logGrantEvent(id, "installment", `แบ่งงวดเงินเป็น ${n} งวด รวม ${formatBaht(total)}`, {
      actor: user.name,
    });
    const installments = await db.grantInstallment.findMany({
      where: { grantId: id },
      orderBy: { seq: "asc" },
    });
    return NextResponse.json({ installments });
  }

  const maxSeq = await db.grantInstallment.aggregate({
    where: { grantId: id },
    _max: { seq: true },
  });
  const seq = Number(body.seq) || (maxSeq._max.seq ?? 0) + 1;

  const installment = await db.grantInstallment.create({
    data: {
      grantId: id,
      seq,
      label: body.label?.trim() || `งวดที่ ${seq}`,
      amount: Number(body.amount) || 0,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      receivedAt: body.receivedAt ? new Date(body.receivedAt) : null,
      receivedAmount: body.receivedAmount != null ? Number(body.receivedAmount) : null,
      note: body.note?.trim() || null,
    },
  });

  await logGrantEvent(
    id,
    "installment",
    `เพิ่ม ${installment.label} ${formatBaht(installment.amount)}`,
    { actor: user.name },
  );

  return NextResponse.json({ installment });
}
