import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { pollRefunds } from "@/lib/refund-flow";

export const runtime = "nodejs";
export const maxDuration = 240; // เปิด browser หลายรอบ (refund + logs ต่อเคส)

// scripts/refund-watch.mjs ยิงมาทุก 2 นาที → วานเฝ้าหน้า /admin/refund หาคำขอ "รออนุมัติ"
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const summary = await pollRefunds();
  return NextResponse.json(summary);
}
