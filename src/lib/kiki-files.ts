import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * หาไฟล์ในเครื่องเจ้าของ แล้วส่งกลับเข้าแชท (เจ้าของสั่ง 5 ส.ค. 2026)
 *
 * เคสที่พัง: เจ้าของ reply ข้อความที่มีชื่อไฟล์อยู่ในนั้น ("docs/monitor-guide.md ฝากไว้ให้แล้ว")
 * แล้วสั่งว่า "ไปหาไฟล์นี้ในเครื่องผมแล้วส่งมาให้หน่อย"
 * → Vex ตอบว่าไม่รู้ว่า "ไฟล์นี้" คือไฟล์ไหน (ไม่ได้อ่านข้อความที่ reply ถึง)
 *   และบอกว่าส่งไฟล์ออกจากเครื่องไม่ได้ ทั้งที่ระบบส่งไฟล์เข้าแชทได้อยู่แล้ว
 */

const HOME = os.homedir();
const SEARCH_DIRS = ["Projects", "Desktop", "Documents", "Downloads"].map((d) => path.join(HOME, d));
const MAX_SEND_BYTES = 45 * 1024 * 1024; // Telegram รับไฟล์ผ่านบอทได้ ~50MB

export interface FoundFile {
  path: string;
  name: string;
  size: number;
  mtime: Date;
}

/** ไฟล์ที่ไม่ควรส่งออกจากเครื่องแม้เจ้าของขอ (ความลับ/กุญแจ) — บอกที่อยู่ได้ แต่ไม่แนบไฟล์ */
export function isSensitive(p: string): boolean {
  const base = path.basename(p).toLowerCase();
  return (
    /^\.env/.test(base) ||
    /(^|[-_.])(credential|secret|token|apikey|api-key|password)/.test(base) ||
    /\.(pem|key|p12|pfx|keystore|jks)$/.test(base) ||
    /^id_(rsa|ed25519|ecdsa)/.test(base) ||
    /\.kiki-tg-session|session\.json$/.test(base)
  );
}

const run = (cmd: string, args: string[], timeout = 20_000): Promise<string> =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 8_000_000 }, (err, stdout) => resolve(err && !stdout ? "" : stdout.toString()));
  });

/** ดึง "ชื่อไฟล์" ที่พูดถึงในข้อความ (รองรับทั้ง "monitor-guide.md" และ "docs/monitor-guide.md") */
export function fileHintFrom(text: string): string {
  const t = (text || "").replace(/`/g, " ");
  const m =
    t.match(/[\w./-]*[\w-]+\.(md|txt|pdf|docx?|xlsx?|csv|pptx?|json|ya?ml|ts|tsx|js|mjs|png|jpe?g|zip|mp4|mov)\b/i) ||
    t.match(/["“']([^"”'\n]{3,80})["”']/);
  return (m?.[1] && !m[0].includes(".") ? m[1] : m?.[0] || "").trim();
}

async function stat(p: string): Promise<FoundFile | null> {
  try {
    const s = await fs.stat(p);
    if (!s.isFile()) return null;
    return { path: p, name: path.basename(p), size: s.size, mtime: s.mtime };
  } catch {
    return null;
  }
}

/**
 * ค้นไฟล์จากคำใบ้ — Spotlight ก่อน (เร็ว ครอบทั้งเครื่อง) แล้วค่อยไล่โฟลเดอร์งานหลัก
 * (Spotlight ไม่เห็นไฟล์ในโปรเจกต์บางที่ เช่น โฟลเดอร์ที่ถูกยกเว้น index)
 */
export async function findFiles(hint: string, limit = 8): Promise<FoundFile[]> {
  const raw = (hint || "").trim();
  if (!raw) return [];
  const base = path.basename(raw); // "docs/monitor-guide.md" → "monitor-guide.md"
  const dirHint = raw.includes("/") ? path.dirname(raw).replace(/^\.\//, "") : "";
  const seen = new Set<string>();
  const out: FoundFile[] = [];

  const add = async (p: string) => {
    const clean = p.trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    const f = await stat(clean);
    if (f) out.push(f);
  };

  // 1) Spotlight
  const spot = await run("mdfind", ["-name", base], 15_000);
  for (const line of spot.split("\n").slice(0, 60)) await add(line);

  // 2) ไล่โฟลเดอร์งานหลักเอง (ข้าม node_modules/.git ที่ทำให้ช้าและรก)
  if (out.length < limit) {
    const args = [
      ...SEARCH_DIRS,
      "-maxdepth", "7",
      "(", "-name", "node_modules", "-o", "-name", ".git", "-o", "-name", "Library", ")", "-prune", "-o",
      "-iname", `*${base}*`, "-type", "f", "-print",
    ];
    const found = await run("find", args, 25_000);
    for (const line of found.split("\n").slice(0, 60)) await add(line);
  }

  // เรียง: ตรงกับโฟลเดอร์ที่บอกใบ้ > ชื่อตรงเป๊ะ > แก้ไขล่าสุด
  const score = (f: FoundFile) => {
    let s = 0;
    if (dirHint && f.path.toLowerCase().includes(dirHint.toLowerCase())) s += 100;
    if (f.name.toLowerCase() === base.toLowerCase()) s += 50;
    if (!/\/(node_modules|\.git|Library|\.Trash)\//.test(f.path)) s += 10;
    return s;
  };
  return out
    .sort((a, b) => score(b) - score(a) || b.mtime.getTime() - a.mtime.getTime())
    .slice(0, limit);
}

export interface FilePayload {
  base64: string;
  name: string;
  size: number;
}

/** อ่านไฟล์เตรียมส่งเข้าแชท — ใหญ่เกินหรือเป็นไฟล์ความลับ = ไม่ส่ง คืนเหตุผลแทน */
export async function fileForSend(f: FoundFile): Promise<{ ok: true; payload: FilePayload } | { ok: false; why: string }> {
  if (isSensitive(f.path)) {
    return { ok: false, why: "เป็นไฟล์ความลับ (กุญแจ/รหัส/เซสชัน) ผมไม่ส่งออกจากเครื่องให้ทางแชท บอกที่อยู่ไฟล์ให้แทน" };
  }
  if (f.size > MAX_SEND_BYTES) {
    return { ok: false, why: `ไฟล์ใหญ่ ${(f.size / 1024 / 1024).toFixed(1)} MB เกินที่ส่งผ่านแชทได้ (45 MB)` };
  }
  try {
    const buf = await fs.readFile(f.path);
    return { ok: true, payload: { base64: buf.toString("base64"), name: f.name, size: f.size } };
  } catch (e) {
    return { ok: false, why: `อ่านไฟล์ไม่ได้ (${e instanceof Error ? e.message.slice(0, 80) : "error"})` };
  }
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** ย่อ path ให้อ่านง่าย (~/ แทนโฮม) */
export function shortPath(p: string): string {
  return p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p;
}
