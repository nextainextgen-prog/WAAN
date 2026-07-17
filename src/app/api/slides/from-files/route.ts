import { NextResponse } from "next/server";
import path from "node:path";
import { getCurrentUser, isServiceRequest } from "@/lib/auth";
import { generateDeck } from "@/lib/deck-generate";
import { saveDeckFiles } from "@/lib/slide-store";
import { extractFilesToSource } from "@/lib/slide-extract";
import { renderDeckPngs } from "@/lib/html-pdf";
import { isAuthorized } from "@/lib/team";
import { getAllowedGroups } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 300;

// ทำสไลด์ "จากไฟล์ที่ผู้ใช้แนบ" (PDF / รูป / .md .txt .csv .docx ฯลฯ) — อ่านเนื้อหาไฟล์นั้นมาทำ
export async function POST(req: Request) {
  const allowed = isServiceRequest(req) || (await getCurrentUser());
  if (!allowed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const topic: string = (body.topic || "ทำสไลด์จากเอกสาร").trim();
  const files: { path: string; filename: string }[] = body.files || [];
  if (!files.length) return NextResponse.json({ error: "ไม่มีไฟล์แนบ" }, { status: 400 });

  // ตรวจสิทธิ์ผู้สั่ง (จาก Telegram)
  const fromId = String(body.fromId || "");
  if (fromId) {
    if (body.isGroup) {
      const groups = await getAllowedGroups();
      if (!groups.includes(String(body.chatId)) && !(await isAuthorized(fromId))) {
        return NextResponse.json({ error: "unauthorized" }, { status: 403 });
      }
    }
    if (!(await isAuthorized(fromId))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 403 });
    }
  }

  // ดึงเนื้อหาจากไฟล์ตามชนิด
  const outDir = path.join(process.cwd(), ".generated", "slide-src");
  const { text: sourceText, images } = await extractFilesToSource(files, outDir);
  if (!sourceText && images.length === 0) {
    return NextResponse.json({ error: "อ่านเนื้อหาจากไฟล์ไม่ได้ (รองรับ PDF, รูป, .md/.txt/.csv, .docx)" }, { status: 422 });
  }

  try {
    const { deck, html, pdf } = await generateDeck(topic, { text: sourceText, images });
    const pngs = await renderDeckPngs(html).catch(() => [] as Buffer[]);
    const meta = await saveDeckFiles(
      { title: deck.title, subtitle: deck.subtitle, slideCount: deck.slides.length },
      topic,
      html,
      pdf,
      { pngs, source: { topic, sourceText, images, history: [], deck } },
    );
    return NextResponse.json({
      ok: true,
      id: meta.id,
      title: deck.title,
      subtitle: deck.subtitle,
      slideCount: deck.slides.length,
      pageCount: pngs.length,
      pages: pngs.map((_, i) => `/api/slides/${meta.id}/p${i}`),
      files: { html: `/api/slides/${meta.id}/html`, pdf: `/api/slides/${meta.id}/pdf` },
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `สร้างสไลด์ไม่สำเร็จ: ${detail}` }, { status: 500 });
  }
}
