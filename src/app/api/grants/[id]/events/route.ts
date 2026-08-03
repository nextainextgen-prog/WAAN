import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// ประวัติความเคลื่อนไหวของทุน (ใหม่สุดขึ้นก่อน)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const events = await db.grantEvent.findMany({
    where: { grantId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ events });
}
