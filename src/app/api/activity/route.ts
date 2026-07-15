import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { logActivity, getActivityDigest, type ActivityInput } from "@/lib/activity";

export const runtime = "nodejs";

// บันทึกกิจกรรมของน้องวาน (เรียกจาก watcher .mjs ผ่าน x-internal-token)
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: ActivityInput;
  try {
    body = (await req.json()) as ActivityInput;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const row = await logActivity(body);
  return NextResponse.json({ ok: !!row, id: row?.id });
}

// debug: ดู digest ที่จะฉีดเข้าบริบท
export async function GET(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, digest: await getActivityDigest() });
}
