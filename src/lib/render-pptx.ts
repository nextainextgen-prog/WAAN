import PptxGenJS from "pptxgenjs";
import type { SlideDoc, Slide } from "./slides";

const FONT = "Sarabun";
const C = {
  primary: "1D4ED8",
  primaryDark: "1E3A8A",
  text: "0F172A",
  muted: "64748B",
  light: "F6F8FB",
  border: "E2E8F0",
  accent: "059669",
  white: "FFFFFF",
};

export async function renderPptx(doc: SlideDoc): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 inch
  pptx.defineSlideMaster({
    title: "CHANGOH",
    background: { color: C.white },
  });

  for (const s of doc.slides) {
    const slide = pptx.addSlide();
    if (s.layout === "title") {
      titleSlide(slide, s, doc);
    } else {
      contentHeader(slide, s.title || "");
      if (s.layout === "stats") statsBody(slide, s);
      else if (s.layout === "bullets") bulletsBody(slide, s);
      else if (s.layout === "table") tableBody(slide, s);
      footer(slide, doc);
    }
  }

  const out = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return out;
}

type PptxSlide = ReturnType<PptxGenJS["addSlide"]>;

function titleSlide(slide: PptxSlide, s: Slide, doc: SlideDoc) {
  slide.background = { color: C.primary };
  slide.addShape("rect", { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: C.primary } });
  slide.addShape("rect", { x: 0, y: 5.9, w: 13.33, h: 0.08, fill: { color: C.white }, line: { type: "none" } });
  slide.addText(s.title || doc.title, {
    x: 0.9, y: 2.4, w: 11.5, h: 1.8, fontFace: FONT, fontSize: 40, bold: true, color: C.white, align: "left",
  });
  slide.addText(s.subtitle || doc.subtitle || "", {
    x: 0.95, y: 4.1, w: 11.5, h: 0.8, fontFace: FONT, fontSize: 20, color: "DBEAFE", align: "left",
  });
  slide.addText("Changoh System · ระบบบริหารทุนวิจัย มหาวิทยาลัยขอนแก่น", {
    x: 0.95, y: 6.6, w: 11.5, h: 0.5, fontFace: FONT, fontSize: 12, color: "BFDBFE",
  });
}

function contentHeader(slide: PptxSlide, title: string) {
  slide.addShape("rect", { x: 0, y: 0, w: 0.28, h: 7.5, fill: { color: C.primary } });
  slide.addText(title, {
    x: 0.7, y: 0.5, w: 12, h: 0.9, fontFace: FONT, fontSize: 28, bold: true, color: C.text,
  });
  slide.addShape("rect", { x: 0.72, y: 1.45, w: 1.6, h: 0.05, fill: { color: C.accent } });
}

function footer(slide: PptxSlide, doc: SlideDoc) {
  slide.addText(doc.title, {
    x: 0.7, y: 7.0, w: 9, h: 0.35, fontFace: FONT, fontSize: 10, color: C.muted,
  });
}

function statsBody(slide: PptxSlide, s: Slide) {
  const stats = (s.stats || []).slice(0, 4);
  const n = stats.length || 1;
  const gap = 0.35;
  const totalW = 12;
  const cardW = (totalW - gap * (n - 1)) / n;
  stats.forEach((st, i) => {
    const x = 0.7 + i * (cardW + gap);
    slide.addShape("roundRect", {
      x, y: 2.3, w: cardW, h: 2.6, rectRadius: 0.12,
      fill: { color: C.light }, line: { color: C.border, width: 1 },
    });
    slide.addText(st.value, {
      x, y: 2.9, w: cardW, h: 1.1, fontFace: FONT, fontSize: 30, bold: true, color: C.primary, align: "center",
    });
    slide.addText(st.label, {
      x, y: 4.0, w: cardW, h: 0.6, fontFace: FONT, fontSize: 14, color: C.muted, align: "center",
    });
  });
}

function bulletsBody(slide: PptxSlide, s: Slide) {
  const items = (s.bullets || []).slice(0, 6);
  slide.addText(
    items.map((t) => ({ text: t, options: { bullet: { code: "2022", indent: 20 }, color: C.text, fontSize: 18, paraSpaceAfter: 12 } })),
    { x: 0.9, y: 2.0, w: 11.4, h: 4.5, fontFace: FONT, valign: "top" },
  );
}

function tableBody(slide: PptxSlide, s: Slide) {
  const cols = s.columns || [];
  const rows = s.rows || [];
  const header = cols.map((c) => ({
    text: c,
    options: { bold: true, color: C.white, fill: { color: C.primary }, fontFace: FONT, fontSize: 13, align: "left" as const },
  }));
  const body = rows.slice(0, 8).map((r, ri) =>
    r.map((cell) => ({
      text: String(cell ?? ""),
      options: {
        color: C.text, fontFace: FONT, fontSize: 12,
        fill: { color: ri % 2 === 0 ? C.white : C.light },
        align: "left" as const,
      },
    })),
  );
  slide.addTable([header, ...body], {
    x: 0.7, y: 2.0, w: 12, border: { type: "solid", color: C.border, pt: 1 },
    rowH: 0.45, valign: "middle",
  });
}
