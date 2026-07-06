import { NextResponse } from "next/server";
import { requireUserOrService } from "@/lib/auth";
import { getMemo, readMemoPdf, memoFilename } from "@/lib/memo-store";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireUserOrService(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const rec = await getMemo(id);
  const buf = await readMemoPdf(id);
  if (!rec || !buf) return NextResponse.json({ error: "not found" }, { status: 404 });
  const name = encodeURIComponent(memoFilename(rec.data, rec.signed));
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${name}`,
    },
  });
}
