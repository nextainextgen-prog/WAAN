import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// อัปเดตสถานะ + ลำดับหลากรายการหลังลาก Kanban
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const updates: { id: string; status: string; orderIndex: number }[] = body.updates || [];
  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json({ error: "no updates" }, { status: 400 });
  }

  await db.$transaction(
    updates.map((u) =>
      db.grant.update({
        where: { id: u.id },
        data: { status: u.status, orderIndex: u.orderIndex },
      }),
    ),
  );
  return NextResponse.json({ ok: true });
}
