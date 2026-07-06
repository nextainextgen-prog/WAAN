import { NextResponse } from "next/server";
import { getCurrentUser, isServiceRequest } from "@/lib/auth";
import { generateDeck } from "@/lib/deck-generate";
import { saveDeckFiles } from "@/lib/slide-store";
import { writeAiNote, getVaultPath } from "@/lib/obsidian";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const allowed = isServiceRequest(req) || (await getCurrentUser());
  if (!allowed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const topic: string = (body.topic || "").trim();
  if (!topic) return NextResponse.json({ error: "กรุณาระบุหัวข้อสไลด์" }, { status: 400 });

  try {
    const { deck, html, pdf } = await generateDeck(topic);
    const meta = await saveDeckFiles(
      { title: deck.title, subtitle: deck.subtitle, slideCount: deck.slides.length },
      topic,
      html,
      pdf,
    );

    if (getVaultPath()) {
      const outline = deck.slides.map((s, i) => `${i + 1}. [${s.layout}] ${s.title || deck.title}`).join("\n");
      await writeAiNote(
        `slides/${meta.createdAt.slice(0, 10)}-${meta.id}.md`,
        `# ${deck.title}\n\n${deck.subtitle}\n\nหัวข้อที่สั่ง: ${topic}\n\n## โครงสไลด์\n${outline}\n`,
      ).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      id: meta.id,
      title: deck.title,
      subtitle: deck.subtitle,
      slideCount: deck.slides.length,
      slides: deck.slides.map((s) => ({ layout: s.layout, title: s.title || deck.title })),
      files: { html: `/api/slides/${meta.id}/html`, pdf: `/api/slides/${meta.id}/pdf` },
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `สร้างสไลด์ไม่สำเร็จ: ${detail}` }, { status: 500 });
  }
}
