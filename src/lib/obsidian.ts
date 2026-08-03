import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * ตัวเชื่อม Obsidian vault เดิมของอาจารย์
 * หลักการแยกส่วน (ตามที่อาจารย์กำหนด):
 *  - AI "เขียน" ได้เฉพาะโฟลเดอร์ AI ของตัวเอง (OBSIDIAN_AI_FOLDER) เท่านั้น
 *  - AI "อ่าน" ความรู้จากโฟลเดอร์งานที่อนุญาต (OBSIDIAN_WORK_FOLDERS) + โฟลเดอร์ AI
 *  - ไม่ยุ่งกับโฟลเดอร์ส่วนตัว
 */

export function getVaultPath(): string | null {
  const p = process.env.OBSIDIAN_VAULT_PATH?.trim();
  if (!p) return null;
  return existsSync(p) ? p : null;
}

export function getAiFolder(): string {
  return process.env.OBSIDIAN_AI_FOLDER?.trim() || "AI-Changoh";
}

function getWorkFolders(): string[] {
  return (process.env.OBSIDIAN_WORK_FOLDERS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// โฟลเดอร์ที่วาน "อ่าน" ได้ (งานที่อนุญาต + โฟลเดอร์ AI ของตัวเอง)
export function getReadableFolders(): string[] {
  return [...getWorkFolders(), getAiFolder()];
}

// สารบัญ (MOC) ของโฟลเดอร์ AI — โน้ตที่วานสร้างใหม่ให้ลิงก์กลับตัวนี้เสมอ กันกราฟกระจายเป็นเกาะ
export const AI_HUB_NOTE = "_สารบัญ-เลขาAI";

// ฟุตเตอร์ลิงก์กลับสารบัญ + index หลัก — ผนวกท้ายโน้ตที่ AI สร้าง เพื่อให้เชื่อมกราฟเสมอ
export function aiHubFooter(extraLinks: string[] = []): string {
  const ai = getAiFolder();
  const links = [`[[${ai}/${AI_HUB_NOTE}|สารบัญเลขา AI]]`, `[[index|Second Brain Index]]`, ...extraLinks];
  return `\n\n---\n🔗 ${links.join(" · ")}\n`;
}

export function obsidianStatus() {
  const vault = getVaultPath();
  return {
    connected: Boolean(vault),
    vaultPath: vault,
    aiFolder: getAiFolder(),
    workFolders: getWorkFolders(),
  };
}

// ป้องกัน path traversal — ให้เขียนได้เฉพาะภายในโฟลเดอร์ AI
function resolveAiPath(relative: string): string | null {
  const vault = getVaultPath();
  if (!vault) return null;
  const aiRoot = path.resolve(vault, getAiFolder());
  const target = path.resolve(aiRoot, relative);
  if (target !== aiRoot && !target.startsWith(aiRoot + path.sep)) return null;
  return target;
}

async function listMarkdown(dir: string, max = 60): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    if (out.length >= max) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= max) break;
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith(".md")) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

/**
 * อ่านความรู้จาก vault (โฟลเดอร์งานที่อนุญาต + โฟลเดอร์ AI) เป็นบริบทให้ "สมอง AI"
 *
 * แบ่งงบแบบวนทีละโฟลเดอร์ (round-robin) ไม่ใช่ไล่ทีละโฟลเดอร์จนหมดงบ
 *
 * ทำไม: ของเดิมไล่ตามลำดับ พอ 10-companies มี 58 ไฟล์ มันกินงบ 30,000 ตัวอักษรหมดตั้งแต่ไฟล์ที่ 19
 * → 40-playbooks, 50-decisions, 80-sheets, 90-meta และโฟลเดอร์ AI ของวานเอง "ไม่เคยถูกอ่านเลยสักครั้ง"
 * (แปลว่า cache aff-customers.md ที่เขียนลง AI-Changoh ก็ไม่เคยเข้าสมองด้วย)
 * วนทีละโฟลเดอร์แล้วทุกโฟลเดอร์ได้ที่นั่งเสมอ ต่อให้โฟลเดอร์ไหนไฟล์เยอะกว่าก็ไม่กลืนคนอื่น
 */
export async function readVaultKnowledge(charBudget = 60_000, snippetChars = 2_800): Promise<string> {
  const vault = getVaultPath();
  if (!vault) return "";
  const folders = [...getWorkFolders(), getAiFolder()];

  const queues: string[][] = [];
  for (const folder of folders) {
    const dir = path.resolve(vault, folder);
    if (!existsSync(dir)) continue;
    const files = await listMarkdown(dir, 200);
    if (files.length) queues.push(files);
  }
  if (!queues.length) return "";

  const chunks: string[] = [];
  let used = 0;
  let alive = true;
  for (let round = 0; alive && used < charBudget; round++) {
    alive = false;
    for (const q of queues) {
      if (round >= q.length) continue;
      alive = true; // ยังมีโฟลเดอร์ที่เหลือไฟล์อยู่
      if (used >= charBudget) break;
      try {
        const content = await fs.readFile(q[round], "utf8");
        const snippet = content.slice(0, snippetChars).trim();
        if (!snippet) continue;
        const block = `### ${path.relative(vault, q[round])}\n${snippet}`;
        chunks.push(block);
        used += block.length;
      } catch {
        /* skip */
      }
    }
  }
  return chunks.join("\n\n");
}

// ===== ค้นแบบ "เจาะลึก": พอผู้ใช้ถามถึงโน้ต/หัวข้อไหน ดึงเนื้อ "ทั้งไฟล์" ที่เกี่ยวข้องมาให้สมอง =====
// overview (readVaultKnowledge) ให้เห็นหัวโน้ตทุกไฟล์อยู่แล้ว — ตัวนี้เสริมเนื้อเต็มเฉพาะไฟล์ที่ตรงคำถาม
// เพื่อให้ "อ่านได้ทั้งไฟล์ถ้าถามถึง" โดยไม่ต้องอัดทั้ง vault เข้าทุกครั้ง

// คำพื้น/คำช่วยภาษาไทย+อังกฤษ ที่ไม่ควรใช้เป็นคีย์เวิร์ดค้น (จะ match มั่ว)
const STOPWORDS = new Set([
  "วาน", "น้องวาน", "หน่อย", "ครับ", "คะ", "ค่ะ", "นะ", "จ้า", "ขอ", "ช่วย", "ดู", "หา", "อยาก",
  "ที่", "ของ", "ใน", "และ", "หรือ", "กับ", "ให้", "เป็น", "มี", "ไหม", "บ้าง", "อะไร", "ยัง", "แล้ว",
  "ไฟล์", "เอกสาร", "เรื่อง", "อัน", "นี้", "นั้น", "ตัว", "มัน", "จาก", "ถึง", "ได้", "ไป", "มา", "ก็",
  "the", "and", "for", "with", "this", "that", "from", "about", "please", "file", "note", "show", "find",
]);

// แตกคีย์เวิร์ดจากคำถาม: คำอังกฤษ/ตัวเลข + วลีไทย (ตัดด้วยช่องว่าง/วรรคตอน) — กรอง stopword + สั้นเกิน
export function keywordsOf(query: string): string[] {
  const raw = (query || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of raw) {
    if (w.length < 2) continue;
    if (STOPWORDS.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out.slice(0, 12);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1 && n < 20) {
    n++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

/**
 * ค้นโน้ตที่เกี่ยวกับคำถาม แล้วคืน "เนื้อเต็มไฟล์" ของไฟล์ที่ตรงที่สุด
 * - ค้นในโฟลเดอร์งานที่อนุญาต + โฟลเดอร์ AI เท่านั้น (เคารพขอบเขตเดิม)
 * - ให้น้ำหนักชื่อไฟล์มากกว่าเนื้อหา (ถามชื่อโน้ตตรง ๆ ต้องมาก่อน)
 */
export async function retrieveVaultNotes(
  query: string,
  opts: { maxFiles?: number; perFileChars?: number; totalChars?: number } = {},
): Promise<string> {
  const vault = getVaultPath();
  if (!vault) return "";
  const keywords = keywordsOf(query);
  if (!keywords.length) return "";

  const maxFiles = opts.maxFiles ?? 6;
  const perFileChars = opts.perFileChars ?? 14_000;
  const totalChars = opts.totalChars ?? 70_000;

  const folders = [...getWorkFolders(), getAiFolder()];
  const files: string[] = [];
  for (const folder of folders) {
    const dir = path.resolve(vault, folder);
    if (!existsSync(dir)) continue;
    files.push(...(await listMarkdown(dir, 400)));
  }
  if (!files.length) return "";

  type Scored = { file: string; score: number; content: string };
  const scored: Scored[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(vault, file).toLowerCase();
    const nameHay = path.basename(file).toLowerCase();
    const bodyHay = content.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (nameHay.includes(kw)) score += 8; // ชื่อไฟล์ตรง = สำคัญสุด
      else if (rel.includes(kw)) score += 4; // อยู่ใน path/โฟลเดอร์
      score += Math.min(countOccurrences(bodyHay, kw), 8) * 1; // เนื้อหา (cap กันไฟล์ยาวกินคะแนน)
    }
    // ตรงทั้งวลีคำถามในชื่อไฟล์ → ดันขึ้นแรง
    const qClean = query.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (qClean.length >= 4 && nameHay.replace(/[^\p{L}\p{N}]/gu, "").includes(qClean)) score += 15;
    if (score > 0) scored.push({ file, score, content });
  }
  if (!scored.length) return "";

  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, maxFiles);

  const blocks: string[] = [];
  let used = 0;
  for (const s of picked) {
    if (used >= totalChars) break;
    const budget = Math.min(perFileChars, totalChars - used);
    const body = s.content.trim().slice(0, budget);
    const truncated = s.content.trim().length > budget ? "\n…(ตัดเนื้อหาส่วนที่เหลือ)" : "";
    const block = `### ${path.relative(vault, s.file)}\n${body}${truncated}`;
    blocks.push(block);
    used += block.length;
  }
  return blocks.join("\n\n");
}

// ไล่หาไฟล์ตามนามสกุลในโฟลเดอร์ (recursive)
async function listFilesByExt(dir: string, exts: RegExp, max = 500): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    if (out.length >= max) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= max) break;
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (exts.test(e.name)) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

export interface FoundFile {
  path: string; // path เต็มในเครื่อง (ไว้อ่าน/ส่ง)
  rel: string; // path เทียบกับ vault (ไว้โชว์)
  filename: string;
  score: number;
}

/**
 * ค้น "ไฟล์" (รูป/เอกสาร) ที่เกี่ยวกับคำถามในโฟลเดอร์ที่อ่านได้ — ให้คะแนนจากชื่อไฟล์/พาธ
 * ใช้ตอนผู้ใช้ขอ "เอารูป X จากคลัง" → คืนไฟล์ที่ตรงที่สุดกลับไปส่งในแชท
 */
export async function findVaultFiles(query: string, exts: RegExp, maxResults = 6): Promise<FoundFile[]> {
  const vault = getVaultPath();
  if (!vault) return [];
  const keywords = keywordsOf(query);
  if (!keywords.length) return [];

  const files: string[] = [];
  for (const folder of getReadableFolders()) {
    const dir = path.resolve(vault, folder);
    if (!existsSync(dir)) continue;
    files.push(...(await listFilesByExt(dir, exts)));
  }
  if (!files.length) return [];

  const scored: FoundFile[] = [];
  const qClean = query.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  for (const file of files) {
    const rel = path.relative(vault, file);
    const nameHay = path.basename(file).toLowerCase();
    const pathHay = rel.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (nameHay.includes(kw)) score += 8;
      else if (pathHay.includes(kw)) score += 3;
    }
    if (qClean.length >= 4 && nameHay.replace(/[^\p{L}\p{N}]/gu, "").includes(qClean)) score += 15;
    if (score > 0) scored.push({ path: file, rel, filename: path.basename(file), score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults);
}

// เขียนไฟล์ลงโฟลเดอร์ AI เท่านั้น (ปลอดภัย)
export async function writeAiNote(relativePath: string, content: string): Promise<boolean> {
  const target = resolveAiPath(relativePath);
  if (!target) return false;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  return true;
}

export async function appendAiNote(relativePath: string, content: string): Promise<boolean> {
  const target = resolveAiPath(relativePath);
  if (!target) return false;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.appendFile(target, content, "utf8");
  return true;
}

// เขียน/อ่านไฟล์ binary (PDF/PNG) ในโฟลเดอร์ AI เท่านั้น (ปลอดภัย)
export async function writeAiBinary(relativePath: string, data: Buffer | Uint8Array): Promise<boolean> {
  const target = resolveAiPath(relativePath);
  if (!target) return false;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
  return true;
}

// path เต็มของไฟล์ในโฟลเดอร์ AI (null ถ้า traversal/ไม่มี vault) — ใช้ส่งต่อให้ pdf-lib/telegram
export function aiFilePath(relativePath: string): string | null {
  return resolveAiPath(relativePath);
}

export async function readAiText(relativePath: string): Promise<string | null> {
  const target = resolveAiPath(relativePath);
  if (!target || !existsSync(target)) return null;
  try {
    return await fs.readFile(target, "utf8");
  } catch {
    return null;
  }
}

// รายชื่อโฟลเดอร์ย่อยในโฟลเดอร์ AI (เช่น aff-customers/*)
export async function listAiSubdirs(relativePath: string): Promise<string[]> {
  const target = resolveAiPath(relativePath);
  if (!target || !existsSync(target)) return [];
  try {
    const entries = await fs.readdir(target, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

// สร้างโครงสร้างโฟลเดอร์ AI เริ่มต้น (แยกจากงาน/ส่วนตัว)
export async function ensureAiStructure(): Promise<boolean> {
  const vault = getVaultPath();
  if (!vault) return false;
  const base = path.resolve(vault, getAiFolder());
  const subs = ["memory", "meetings", "logs", "slides"];
  for (const s of subs) await fs.mkdir(path.join(base, s), { recursive: true });
  const readme = path.join(base, "README.md");
  if (!existsSync(readme)) {
    await fs.writeFile(
      readme,
      `# ${getAiFolder()}\n\nโฟลเดอร์นี้จัดการโดยเลขา AI (Changoh System) โดยอัตโนมัติ แยกจากโน้ตงานและส่วนตัว\n\n- memory/ — ความจำและ decisions ที่ AI บันทึก\n- meetings/ — สรุปการประชุม\n- logs/ — บันทึกการอนุมัติเอกสารและกิจกรรม\n- slides/ — โครงสไลด์ที่สร้าง\n`,
      "utf8",
    );
  }
  return true;
}
