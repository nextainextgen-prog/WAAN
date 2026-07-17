import { NextResponse } from "next/server";
import path from "node:path";
import { getCurrentUser, isServiceRequest } from "@/lib/auth";
import { reviseDeck } from "@/lib/deck-generate";
import { saveDeckFiles, getDeckSource } from "@/lib/slide-store";
import { extractFilesToSource } from "@/lib/slide-extract";
import { renderDeckPngs } from "@/lib/html-pdf";
import { isAuthorized } from "@/lib/team";
import { getAllowedGroups } from "@/lib/telegram";
import type { Deck } from "@/lib/deck-html";

export const runtime = "nodejs";
export const maxDuration = 300;

// แก้/ต่อยอดเด็คเดิม (reply เด็คแล้วสั่งแก้ หรือแนบไฟล์เพิ่มข้อมูล) — คงสไตล์เดิม จำบริบทเดิม
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const allowed = isServiceRequest(req) || (await getCurrentUser());
  if (!allowed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const instruction: string = String(body.instruction || "").trim();
  const files: { path: string; filename: string }[] = body.files || [];

  // ตรวจสิทธิ์ผู้สั่ง (เหมือน from-files)
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

  if (!instruction && !files.length) {
    return NextResponse.json({ error: "ยังไม่มีคำสั่งแก้หรือไฟล์เพิ่มค่ะ" }, { status: 400 });
  }

  const src = await getDeckSource(id);
  if (!src) {
    return NextResponse.json({ error: "หาเด็คเดิมไม่เจอ (อาจถูกลบไปแล้ว) — ลองทำใหม่นะคะ" }, { status: 404 });
  }

  // ไฟล์ที่แนบเพิ่ม (ต่อข้อมูล)
  let add: { text?: string; images?: string[] } | undefined;
  if (files.length) {
    const outDir = path.join(process.cwd(), ".generated", "slide-src");
    const ex = await extractFilesToSource(files, outDir);
    add = { text: ex.text, images: ex.images };
  }

  try {
    const { deck, html, pdf, source } = await reviseDeck(
      { topic: src.topic, sourceText: src.sourceText, images: src.images, history: src.history, deck: src.deck as Deck },
      instruction || "ปรับเด็คตามข้อมูลที่แนบเพิ่ม",
      add,
    );
    const pngs = await renderDeckPngs(html).catch(() => [] as Buffer[]);
    const meta = await saveDeckFiles(
      { title: deck.title, subtitle: deck.subtitle, slideCount: deck.slides.length },
      src.topic,
      html,
      pdf,
      { id, pngs, source },
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
    return NextResponse.json({ error: `แก้สไลด์ไม่สำเร็จ: ${detail}` }, { status: 500 });
  }
}
