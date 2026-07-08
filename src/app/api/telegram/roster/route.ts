import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// ให้บอทดึงรายชื่อทีม ไว้แท็กตามชื่อที่ผู้ใช้พิมพ์ (เช่น "ส่งให้เนย")
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const members = await db.teamMember.findMany();
  return NextResponse.json({
    members: members.map((m) => ({
      id: m.telegramUserId,
      name: m.name,
      username: m.username || null,
      realName: (m.notes || "").replace(/^ชื่อในระบบ:\s*/, "") || null,
    })),
  });
}
