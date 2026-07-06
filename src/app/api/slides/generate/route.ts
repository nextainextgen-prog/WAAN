import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { generateSlideDoc } from "@/lib/slides";
import { renderPptx } from "@/lib/render-pptx";
import { renderPdf } from "@/lib/render-pdf";
import { saveSlideFiles } from "@/lib/slide-store";
import { writeAiNote, getVaultPath } from "@/lib/obsidian";

export const runtime = "nodejs";
export const maxDuration = 240;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const topic: string = (body.topic || "").trim();
  if (!topic) return NextResponse.json({ error: "กรุณาระบุหัวข้อสไลด์" }, { status: 400 });

  try {
    const doc = await generateSlideDoc(topic);
    const [pptx, pdf] = await Promise.all([renderPptx(doc), renderPdf(doc)]);
    const meta = await saveSlideFiles(doc, topic, pptx, pdf);

    // บันทึกโครงสไลด์ลง Obsidian (โฟลเดอร์ AI) ถ้าเชื่อมไว้
    if (getVaultPath()) {
      const outline = doc.slides
        .map((s, i) => `${i + 1}. [${s.layout}] ${s.title || ""}`)
        .join("\n");
      await writeAiNote(
        `slides/${meta.createdAt.slice(0, 10)}-${meta.id}.md`,
        `# ${doc.title}\n\n${doc.subtitle}\n\nหัวข้อที่สั่ง: ${topic}\n\n## โครงสไลด์\n${outline}\n`,
      ).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      id: meta.id,
      title: doc.title,
      subtitle: doc.subtitle,
      slideCount: doc.slides.length,
      slides: doc.slides.map((s) => ({ layout: s.layout, title: s.title })),
      files: { pptx: `/api/slides/${meta.id}/pptx`, pdf: `/api/slides/${meta.id}/pdf` },
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `สร้างสไลด์ไม่สำเร็จ: ${detail}` }, { status: 500 });
  }
}
