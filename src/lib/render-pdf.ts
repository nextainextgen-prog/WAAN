import PDFDocument from "pdfkit";
import path from "node:path";
import type { SlideDoc, Slide } from "./slides";

const W = 960;
const H = 540;
const C = {
  primary: "#1D4ED8",
  text: "#0F172A",
  muted: "#64748B",
  light: "#F6F8FB",
  border: "#E2E8F0",
  accent: "#059669",
  white: "#FFFFFF",
  blueLight: "#DBEAFE",
};

function fontPath(name: string) {
  return path.join(process.cwd(), "src/assets/fonts", name);
}

export async function renderPdf(doc: SlideDoc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: [W, H], margin: 0, autoFirstPage: false });
    pdf.registerFont("reg", fontPath("Sarabun-Regular.ttf"));
    pdf.registerFont("bold", fontPath("Sarabun-Bold.ttf"));
    pdf.registerFont("semi", fontPath("Sarabun-SemiBold.ttf"));

    const chunks: Buffer[] = [];
    pdf.on("data", (c) => chunks.push(c as Buffer));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    doc.slides.forEach((s) => {
      pdf.addPage({ size: [W, H], margin: 0 });
      if (s.layout === "title") titlePage(pdf, s, doc);
      else {
        contentHeader(pdf, s.title || "");
        if (s.layout === "stats") statsBody(pdf, s);
        else if (s.layout === "bullets") bulletsBody(pdf, s);
        else if (s.layout === "table") tableBody(pdf, s);
        footer(pdf, doc);
      }
    });

    pdf.end();
  });
}

type Doc = PDFKit.PDFDocument;

function titlePage(pdf: Doc, s: Slide, doc: SlideDoc) {
  pdf.rect(0, 0, W, H).fill(C.primary);
  pdf.rect(0, 424, W, 4).fill(C.white);
  pdf.fill(C.white).font("bold").fontSize(44).text(s.title || doc.title, 64, 190, { width: W - 128 });
  pdf.fill(C.blueLight).font("reg").fontSize(20).text(s.subtitle || doc.subtitle || "", 66, 300, { width: W - 132 });
  pdf.fill("#BFDBFE").font("reg").fontSize(12).text("Changoh System · ระบบบริหารทุนวิจัย มหาวิทยาลัยขอนแก่น", 66, 476);
}

function contentHeader(pdf: Doc, title: string) {
  pdf.rect(0, 0, W, H).fill(C.white);
  pdf.rect(0, 0, 20, H).fill(C.primary);
  pdf.fill(C.text).font("bold").fontSize(30).text(title, 50, 40, { width: W - 100 });
  pdf.rect(52, 104, 115, 4).fill(C.accent);
}

function footer(pdf: Doc, doc: SlideDoc) {
  pdf.fill(C.muted).font("reg").fontSize(9).text(doc.title, 50, 508, { width: 640 });
}

function statsBody(pdf: Doc, s: Slide) {
  const stats = (s.stats || []).slice(0, 4);
  const n = stats.length || 1;
  const gap = 24;
  const totalW = W - 100;
  const cardW = (totalW - gap * (n - 1)) / n;
  stats.forEach((st, i) => {
    const x = 50 + i * (cardW + gap);
    pdf.roundedRect(x, 170, cardW, 190, 12).fillAndStroke(C.light, C.border);
    pdf.fill(C.primary).font("bold").fontSize(32).text(st.value, x, 220, { width: cardW, align: "center" });
    pdf.fill(C.muted).font("reg").fontSize(14).text(st.label, x, 290, { width: cardW, align: "center" });
  });
}

function bulletsBody(pdf: Doc, s: Slide) {
  const items = (s.bullets || []).slice(0, 6);
  let y = 150;
  pdf.font("reg").fontSize(18);
  items.forEach((t) => {
    pdf.circle(64, y + 10, 3.5).fill(C.primary);
    pdf.fill(C.text).font("reg").fontSize(18).text(t, 82, y, { width: W - 150 });
    y = pdf.y + 16;
  });
}

function tableBody(pdf: Doc, s: Slide) {
  const cols = s.columns || [];
  const rows = (s.rows || []).slice(0, 8);
  const x0 = 50;
  const tableW = W - 100;
  const colW = tableW / (cols.length || 1);
  let y = 150;
  const rowH = 40;

  // header
  pdf.rect(x0, y, tableW, rowH).fill(C.primary);
  cols.forEach((c, i) => {
    pdf.fill(C.white).font("semi").fontSize(13).text(String(c), x0 + i * colW + 12, y + 12, { width: colW - 20 });
  });
  y += rowH;
  rows.forEach((r, ri) => {
    pdf.rect(x0, y, tableW, rowH).fill(ri % 2 === 0 ? C.white : C.light);
    r.forEach((cell, i) => {
      pdf.fill(C.text).font("reg").fontSize(12).text(String(cell ?? ""), x0 + i * colW + 12, y + 12, {
        width: colW - 20,
        height: rowH - 16,
        ellipsis: true,
      });
    });
    y += rowH;
  });
  pdf.rect(x0, 150, tableW, rowH + rows.length * rowH).stroke(C.border);
}
