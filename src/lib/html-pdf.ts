import { chromium } from "playwright";

// เรนเดอร์ HTML → PDF ด้วย headless Chromium (คมชัด รองรับ CSS/ภาษาไทยเต็มรูปแบบ)
export async function renderHtmlToPdf(
  html: string,
  opts: { format?: "A4" | "Letter"; landscape?: boolean; margin?: string; width?: string; height?: string } = {},
): Promise<Buffer> {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    // รอฟอนต์โหลดครบ
    await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<void> } }).fonts.ready);
    const m = opts.margin ?? "0";
    const sized = opts.width && opts.height;
    const pdf = await page.pdf({
      ...(sized ? { width: opts.width, height: opts.height } : { format: opts.format ?? "A4" }),
      landscape: opts.landscape ?? false,
      printBackground: true,
      margin: { top: m, right: m, bottom: m, left: m },
      preferCSSPageSize: !sized,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

// เรนเดอร์เด็คนำเสนอ (16:9 widescreen)
export async function renderDeckPdf(html: string): Promise<Buffer> {
  return renderHtmlToPdf(html, { width: "1280px", height: "720px" });
}

// เรนเดอร์ HTML → PNG (ไว้ทำ preview / thumbnail)
export async function renderHtmlToPng(
  html: string,
  opts: { width?: number; height?: number } = {},
): Promise<Buffer> {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({
      viewport: { width: opts.width ?? 1280, height: opts.height ?? 720 },
      deviceScaleFactor: 2,
    });
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<void> } }).fonts.ready);
    const png = await page.screenshot({ type: "png", fullPage: true });
    return Buffer.from(png);
  } finally {
    await browser.close();
  }
}
