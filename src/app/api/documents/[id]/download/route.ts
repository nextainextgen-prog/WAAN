import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { requireUserOrService } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireUserOrService(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const url = new URL(req.url);
  const type = url.searchParams.get("type") === "signed" ? "signed" : "original";

  const doc = await db.document.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const filePath = type === "signed" ? doc.signedPath : doc.filePath;
  if (!filePath) return NextResponse.json({ error: "ยังไม่มีไฟล์ที่เซ็น" }, { status: 404 });

  let buf: Buffer;
  try {
    buf = await fs.readFile(filePath);
  } catch {
    return NextResponse.json({ error: "อ่านไฟล์ไม่ได้" }, { status: 404 });
  }

  const ext = path.extname(filePath).toLowerCase();
  const ctype = ext === ".pdf" ? "application/pdf" : "application/octet-stream";
  const name = encodeURIComponent(doc.filename.replace(/\.pdf$/i, "") + (type === "signed" ? "-signed.pdf" : ext));

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": ctype,
      "Content-Disposition": `inline; filename*=UTF-8''${name}`,
    },
  });
}
