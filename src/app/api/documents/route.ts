import { NextResponse } from "next/server";
import { getCurrentUser, isServiceRequest } from "@/lib/auth";
import { ingestDocument, listDocuments } from "@/lib/documents";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const docs = await listDocuments();
  return NextResponse.json({ documents: docs });
}

export async function POST(req: Request) {
  const allowed = isServiceRequest(req) || (await getCurrentUser());
  if (!allowed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid form" }, { status: 400 });

  const file = form.get("file");
  const source = (form.get("source") as string) || undefined;
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "ไม่พบไฟล์" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = file.name || "document";
  const { id, summary } = await ingestDocument(buffer, filename, source);
  return NextResponse.json({ ok: true, id, summary });
}
