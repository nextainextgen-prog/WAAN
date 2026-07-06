import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { markDriveUploaded } from "@/lib/documents";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await markDriveUploaded(id);
  return NextResponse.json({ ok: true });
}
