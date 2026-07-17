import { NextResponse } from "next/server";
import { requireUserOrService } from "@/lib/auth";
import { readSlideFile, getSlideMeta, readSlidePng } from "@/lib/slide-store";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; format: string }> },
) {
  if (!(await requireUserOrService(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, format } = await params;

  // รูปหน้า: /api/slides/{id}/p0, p1, ... (พรีวิวทีละหน้า)
  const pm = format.match(/^p(\d+)$/);
  if (pm) {
    const png = await readSlidePng(id, Number(pm[1]));
    if (!png) return NextResponse.json({ error: "not found" }, { status: 404 });
    return new NextResponse(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
  }

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
