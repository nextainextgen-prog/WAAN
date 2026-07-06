import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SlideDoc } from "./slides";

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
  createdAt: string;
}

export async function saveSlideFiles(
  doc: SlideDoc,
  topic: string,
  pptx: Buffer,
  pdf: Buffer,
): Promise<SlideMeta> {
  await ensureDir();
  const id = randomUUID().slice(0, 8);
  const meta: SlideMeta = {
    id,
    title: doc.title,
    subtitle: doc.subtitle,
    topic,
    slideCount: doc.slides.length,
    createdAt: new Date().toISOString(),
  };
  await Promise.all([
    fs.writeFile(path.join(DIR, `${id}.pptx`), pptx),
    fs.writeFile(path.join(DIR, `${id}.pdf`), pdf),
    fs.writeFile(path.join(DIR, `${id}.json`), JSON.stringify(meta, null, 2)),
  ]);
  return meta;
}

export async function readSlideFile(id: string, format: "pptx" | "pdf"): Promise<Buffer | null> {
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
