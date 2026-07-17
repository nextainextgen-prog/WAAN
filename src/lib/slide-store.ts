import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DIR = path.join(process.cwd(), ".generated", "slides");

async function ensureDir() {
  await fs.mkdir(DIR, { recursive: true });
}

export interface SlideMeta {
  id: string;
  title: string;
  subtitle: string;
  topic: string;
  slideCount: number;
  pageCount?: number; // จำนวนรูปหน้าที่เรนเดอร์ไว้ (ส่งพรีวิวทีละหน้า)
  createdAt: string;
}

// บริบทเด็ค (ไว้ reply แก้/ต่อข้อมูลภายหลัง — จำได้ว่าเด็คนี้มาจากอะไร แก้อะไรไปแล้วบ้าง)
export interface DeckSource {
  topic: string;
  sourceText: string; // เนื้อหาไฟล์/ข้อมูลที่ใช้ทำ (สะสมได้)
  images: string[]; // path รูปหน้าเอกสารต้นฉบับ
  history: string[]; // คำสั่งแก้ที่ทำมาแล้วตามลำดับ
  deck: unknown; // Deck JSON ล่าสุด (อ้างอิงตอนแก้)
}

// เก็บเด็คนำเสนอ (HTML โต้ตอบ + PDF + รูปต่อหน้า + บริบทไว้แก้ต่อ)
export async function saveDeckFiles(
  meta: { title: string; subtitle: string; slideCount: number },
  topic: string,
  html: string,
  pdf: Buffer,
  extra?: { id?: string; pngs?: Buffer[]; source?: DeckSource },
): Promise<SlideMeta> {
  await ensureDir();
  const id = extra?.id || randomUUID().replace(/-/g, "").slice(0, 8);
  const pngs = extra?.pngs || [];
  const rec: SlideMeta = {
    id,
    title: meta.title,
    subtitle: meta.subtitle,
    topic,
    slideCount: meta.slideCount,
    pageCount: pngs.length,
    createdAt: new Date().toISOString(),
  };
  // ถ้าเป็นการแก้ (id เดิม) ลบรูปหน้าเก่าก่อน กันหน้าค้างเกิน
  if (extra?.id) {
    const olds = (await fs.readdir(DIR).catch(() => [])).filter((f) => f.startsWith(`${id}-p`));
    await Promise.all(olds.map((f) => fs.rm(path.join(DIR, f)).catch(() => {})));
  }
  await Promise.all([
    fs.writeFile(path.join(DIR, `${id}.html`), html, "utf8"),
    fs.writeFile(path.join(DIR, `${id}.pdf`), pdf),
    fs.writeFile(path.join(DIR, `${id}.json`), JSON.stringify(rec, null, 2)),
    ...pngs.map((b, i) => fs.writeFile(path.join(DIR, `${id}-p${i}.png`), b)),
    ...(extra?.source ? [fs.writeFile(path.join(DIR, `${id}.src.json`), JSON.stringify(extra.source))] : []),
  ]);
  return rec;
}

export async function readSlidePng(id: string, page: number): Promise<Buffer | null> {
  if (!/^[a-f0-9]{8}$/.test(id) || !Number.isInteger(page) || page < 0) return null;
  try {
    return await fs.readFile(path.join(DIR, `${id}-p${page}.png`));
  } catch {
    return null;
  }
}

export async function getDeckSource(id: string): Promise<DeckSource | null> {
  if (!/^[a-f0-9]{8}$/.test(id)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(DIR, `${id}.src.json`), "utf8"));
  } catch {
    return null;
  }
}

export async function readSlideFile(id: string, format: "html" | "pdf"): Promise<Buffer | null> {
  if (!/^[a-f0-9]{8}$/.test(id)) return null;
  try {
    return await fs.readFile(path.join(DIR, `${id}.${format}`));
  } catch {
    return null;
  }
}

export async function getSlideMeta(id: string): Promise<SlideMeta | null> {
  if (!/^[a-f0-9]{8}$/.test(id)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(DIR, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

export async function listSlides(): Promise<SlideMeta[]> {
  await ensureDir();
  const files = await fs.readdir(DIR);
  const metas: SlideMeta[] = [];
  for (const f of files) {
    if (f.endsWith(".json")) {
      try {
        metas.push(JSON.parse(await fs.readFile(path.join(DIR, f), "utf8")));
      } catch {
        /* skip */
      }
    }
  }
  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
