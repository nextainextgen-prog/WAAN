import fs from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { askExtractor, writePersonalBinary, PERSONAL_FOLDER } from "./kiki";
import { getVaultPath } from "./obsidian";

/**
 * คลังรูป/วิดีโอของเจ้าของ (เจ้าของสั่ง 4 ส.ค. 2026: "เก็บรูปหรือวิดีโอได้ เวลาผมขอให้ส่งมาให้ผมได้")
 * กติกา: **เก็บเฉพาะที่สั่งให้เก็บ** — ส่งมาเฉย ๆ = ดูให้ ตอบให้ แต่ไม่เก็บ
 *
 * ต่างจากของเดิม (สารบัญ .md + คีย์เวิร์ด): มีตารางจริง + คำบรรยายจากวิชัน + ค้นด้วยความหมาย
 */

export type MediaKind = "image" | "video";

export interface SavedMedia {
  id: string;
  rel: string;
  description: string;
}

const monthDir = () => new Date().toISOString().slice(0, 7);

/** เก็บไฟล์เข้าคลัง + ให้วิชันบรรยายไว้ (ค้นย้อนหลังด้วยคำพูดธรรมดาได้) */
export async function saveMedia(srcPath: string, kind: MediaKind, label?: string): Promise<SavedMedia | null> {
  try {
    const buf = await fs.readFile(srcPath);
    const ext = path.extname(srcPath) || (kind === "video" ? ".mp4" : ".jpg");
    const rel = `media/${monthDir()}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`;
    const abs = await writePersonalBinary(rel, buf);
    if (!abs) return null;

    // รูป: ให้สมองดูแล้วบรรยาย (ไว้ค้นด้วยความหมาย) · วิดีโอ: ใช้คำที่เจ้าของบอกเป็นหลัก
    let description = label?.trim() || "";
    if (kind === "image") {
      const d = await askExtractor(
        `ดูรูปที่ path นี้: ${abs}\n${label ? `เจ้าของบอกว่า: ${label}\n` : ""}บรรยายสิ่งที่เห็นในรูปเป็นภาษาไทย 1-3 ประโยค ให้ค้นเจอทีหลังได้ (มีอะไร ข้อความในรูป สี บรรยากาศ ใคร ที่ไหน) ตอบเฉพาะคำบรรยาย`,
        { imagePaths: [abs], timeoutMs: 90_000 },
      ).catch(() => "");
      description = [label?.trim(), d.trim()].filter(Boolean).join(" · ").slice(0, 1200);
    }

    const row = await db.kikiMedia.create({
      data: { kind, path: rel, label: label?.slice(0, 300) || null, description: description || null },
    });
    // index ความหมาย (ใช้คลังเดียวกับความจำแชท)
    void import("./kiki-memory")
      .then((m) => m.indexMedia(row.id, `${kind === "video" ? "วิดีโอ" : "รูป"} ${label || ""} ${description}`))
      .catch(() => {});
    return { id: row.id, rel, description };
  } catch {
    return null;
  }
}

export interface MediaHit {
  id: string;
  kind: string;
  abs: string;
  label: string;
  description: string;
  createdAt: Date;
}

function absOf(rel: string): string | null {
  const vault = getVaultPath();
  if (!vault) return null;
  return path.resolve(vault, PERSONAL_FOLDER, rel);
}

/** ค้นรูป/วิดีโอที่เก็บไว้ — ความหมายก่อน แล้วค่อยคีย์เวิร์ด */
export async function findMedia(query: string, limit = 4): Promise<MediaHit[]> {
  const ids: string[] = [];
  try {
    const { searchMedia } = await import("./kiki-memory");
    ids.push(...(await searchMedia(query, limit * 2)));
  } catch { /* ไม่มี vec ก็ใช้คีย์เวิร์ด */ }

  const rows = ids.length ? await db.kikiMedia.findMany({ where: { id: { in: ids } } }) : [];
  const ordered = ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean) as typeof rows;

  if (ordered.length < limit) {
    const words = query
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ")
      .split(/\s+/)
      // ไทยไม่มีช่องว่างคั่นคำ → เศษคำสั้น ๆ จับมั่วได้ง่าย (เคสจริง: "อย" ไปแมตช์คำอื่น) จึงต้องยาวพอ
      .filter((w) => w.length >= 3 && !/^(ขอ|รูป|ภาพ|วิดีโอ|คลิป|หน่อย|ที่|เคย|ส่ง|เก็บ|ไว้|ให้|ดู)$/.test(w));
    if (words.length) {
      const more = await db.kikiMedia.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
      const scored = more
        .filter((r) => !ordered.some((o) => o.id === r.id))
        .map((r) => {
          const hay = `${r.label || ""} ${r.description || ""}`.toLowerCase();
          let score = 0;
          for (const w of words) if (hay.includes(w)) score += w.length >= 4 ? 3 : 1;
          return { r, score };
        })
        .filter((x) => x.score >= 3) // ต้องแมตช์คำที่มีน้ำหนักจริง ไม่ใช่เศษพยางค์
        .sort((a, b) => b.score - a.score);
      ordered.push(...scored.slice(0, limit - ordered.length).map((x) => x.r));
    }
  }

  const out: MediaHit[] = [];
  for (const r of ordered.slice(0, limit)) {
    const abs = absOf(r.path);
    if (!abs) continue;
    try {
      await fs.access(abs);
      out.push({ id: r.id, kind: r.kind, abs, label: r.label || "", description: r.description || "", createdAt: r.createdAt });
    } catch { /* ไฟล์หาย ข้าม */ }
  }
  return out;
}

export async function mediaCount(): Promise<number> {
  return db.kikiMedia.count();
}
