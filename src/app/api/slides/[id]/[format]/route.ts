import { NextResponse } from "next/server";
import { requireUserOrService } from "@/lib/auth";
import { readSlideFile, getSlideMeta } from "@/lib/slide-store";

export const runtime = "nodejs";

const TYPES: Record<string, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; format: string }> },
) {
  if (!(await requireUserOrService(_req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, format } = await params;
  if (format !== "pptx" && format !== "pdf") {
    return NextResponse.json({ error: "invalid format" }, { status: 400 });
  }

  const buf = await readSlideFile(id, format);
  if (!buf) return NextResponse.json({ error: "not found" }, { status: 404 });

  const meta = await getSlideMeta(id);
  const safeTitle = (meta?.title || "slides").replace(/[^\p{L}\p{N}ก-๙\s_-]/gu, "").slice(0, 60) || "slides";
  const filename = encodeURIComponent(`${safeTitle}.${format}`);

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      "Content-Length": String(buf.length),
    },
  });
}
