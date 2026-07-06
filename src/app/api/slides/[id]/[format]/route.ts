import { NextResponse } from "next/server";
import { requireUserOrService } from "@/lib/auth";
import { readSlideFile, getSlideMeta } from "@/lib/slide-store";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; format: string }> },
) {
  if (!(await requireUserOrService(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, format } = await params;
  if (format !== "html" && format !== "pdf") {
    return NextResponse.json({ error: "invalid format" }, { status: 400 });
  }

  const buf = await readSlideFile(id, format);
  if (!buf) return NextResponse.json({ error: "not found" }, { status: 404 });

  const meta = await getSlideMeta(id);
  const safeTitle = (meta?.title || "slides").replace(/[^\p{L}\p{N}ก-๙\s_-]/gu, "").slice(0, 60) || "slides";

  if (format === "html") {
    // เปิดในเบราว์เซอร์ได้เลย (เด็คโต้ตอบ)
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const filename = encodeURIComponent(`${safeTitle}.pdf`);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${filename}`,
    },
  });
}
