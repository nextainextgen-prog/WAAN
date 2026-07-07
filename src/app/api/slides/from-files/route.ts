import { NextResponse } from "next/server";
import path from "node:path";
import { getCurrentUser, isServiceRequest } from "@/lib/auth";
import { generateDeck } from "@/lib/deck-generate";
import { saveDeckFiles } from "@/lib/slide-store";
import { pdfFileToText, pdfFileToPngs } from "@/lib/pdf-to-images";
import { isAuthorized } from "@/lib/team";
import { getAllowedGroups } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 300;

// ทำสไลด์ "จากไฟล์ที่ผู้ใช้แนบ" (เช่น reply PDF แล้วสั่งทำสไลด์) — อ่านเนื้อหาไฟล์นั้นมาทำ
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

  // ดึงเนื้อหาจากไฟล์: PDF → ข้อความ (+รูปหน้าไว้ให้ AI อ่านถ้าข้อความน้อย), รูป → ส่งให้อ่านด้วย vision
  const outDir = path.join(process.cwd(), ".generated", "slide-src");
  const textParts: string[] = [];
  const images: string[] = [];
  for (const f of files) {
    const ext = path.extname(f.path).toLowerCase();
    try {
      if (ext === ".pdf") {
        const txt = await pdfFileToText(f.path).catch(() => "");
        if (txt) textParts.push(`===== ${f.filename} =====\n${txt}`);
        // แปลงหน้าเป็นรูปให้ AI อ่านด้วยตาเสมอ (ข้อความไทยจาก PDF มักเว้นวรรคเพี้ยน — อ่านจากรูปแม่นกว่า)
        const pngs = await pdfFileToPngs(f.path, outDir, { maxPages: 8 }).catch(() => []);
        images.push(...pngs);
      } else if (/\.(png|jpe?g|webp)$/i.test(ext)) {
        images.push(f.path);
      }
    } catch {
      /* ข้ามไฟล์ที่อ่านไม่ได้ */
    }
  }

  const sourceText = textParts.join("\n\n").trim();
  if (!sourceText && images.length === 0) {
    return NextResponse.json({ error: "อ่านเนื้อหาจากไฟล์ไม่ได้" }, { status: 422 });
  }

  try {
    const { deck, html, pdf } = await generateDeck(topic, { text: sourceText, images });
    const meta = await saveDeckFiles(
      { title: deck.title, subtitle: deck.subtitle, slideCount: deck.slides.length },
      topic,
      html,
      pdf,
    );
    return NextResponse.json({
      ok: true,
      id: meta.id,
      title: deck.title,
      subtitle: deck.subtitle,
      slideCount: deck.slides.length,
      files: { html: `/api/slides/${meta.id}/html`, pdf: `/api/slides/${meta.id}/pdf` },
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `สร้างสไลด์ไม่สำเร็จ: ${detail}` }, { status: 500 });
  }
}
