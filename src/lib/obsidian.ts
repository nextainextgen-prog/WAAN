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

// อ่านความรู้จาก vault (โฟลเดอร์งานที่อนุญาต + โฟลเดอร์ AI) เป็นบริบทให้ "สมอง AI"
export async function readVaultKnowledge(charBudget = 12_000): Promise<string> {
  const vault = getVaultPath();
  if (!vault) return "";
  const folders = [getAiFolder(), ...getWorkFolders()];
  const chunks: string[] = [];
  let used = 0;

  for (const folder of folders) {
    const dir = path.resolve(vault, folder);
    if (!existsSync(dir)) continue;
    const files = await listMarkdown(dir);
    for (const f of files) {
      if (used >= charBudget) break;
      try {
        const content = await fs.readFile(f, "utf8");
        const rel = path.relative(vault, f);
        const snippet = content.slice(0, 1500).trim();
        if (!snippet) continue;
        const block = `### ${rel}\n${snippet}`;
        chunks.push(block);
        used += block.length;
      } catch {
        /* skip */
      }
    }
  }
  return chunks.join("\n\n");
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
