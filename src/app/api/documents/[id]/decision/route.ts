import { NextResponse } from "next/server";
import { getCurrentUser, isServiceRequest } from "@/lib/auth";
import { decideDocument } from "@/lib/documents";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const allowed = isServiceRequest(req) || (await getCurrentUser());
  if (!allowed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const decision = body.decision;
  if (decision !== "approve" && decision !== "reject") {
    return NextResponse.json({ error: "invalid decision" }, { status: 400 });
  }

  const result = await decideDocument(id, decision);
  return NextResponse.json(result);
}
