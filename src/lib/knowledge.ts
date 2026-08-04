import path from "node:path";
import fs from "node:fs/promises";
import { extractText } from "./extract";
import { fetchUrlContent, type LinkContent } from "./weblink";
import { writeAiNote, writeAiBinary, getVaultPath, getAiFolder, aiHubFooter } from "./obsidian";
import { askClaude } from "./claude";

/**
 * คลังความรู้ของน้องวาน — สั่งเก็บไฟล์/ลิงก์ผ่านแชทได้เลย
 *  - รับไฟล์ (PDF/docx/txt/md/csv/รูป) หรือ URL
 *  - อ่านเนื้อหา → ให้ AI "ขยาย+จัดโครงสร้าง" เป็นโน้ตที่อ่านง่ายและค้นเจอ
 *  - เขียนลง Obsidian โฟลเดอร์ AI ของวานเอง (AI-Changoh/knowledge) — เก็บไฟล์ต้นฉบับไว้ด้วย
 *  - โน้ตนี้อยู่ในโฟลเดอร์ที่วาน "อ่าน" ได้ → ครั้งหน้าถามถึงก็ดึงเนื้อเต็มมาตอบได้ทันที
 */

export interface KnowledgeResult {
  ok: boolean;
  title?: string;
  summary?: string;
  notePath?: string; // path (relative to AI folder) ของโน้ตที่เขียน
  error?: string;
}

function slugify(s: string): string {
  return (
    (s || "note")
      .replace(/\.[a-z0-9]+$/i, "") // ตัดนามสกุลไฟล์
      .replace(/[^\p{L}\p{N}ก-๙\s_-]/gu, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "note"
  );
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function nowThai(): string {
  return new Date().toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

// ให้ AI ขยาย+จัดโครงสร้างเนื้อหาเป็นโน้ตความรู้ (ภาษาไทย) — "คิดเอง ทำเอง"
async function expandToNote(rawText: string, sourceLabel: string, userNote?: string): Promise<{ title: string; body: string; summary: string }> {
  const clipped = rawText.slice(0, 40_000);
  const system =
    "คุณคือเลขาที่ช่วยจัดระเบียบความรู้ลงคลัง (Obsidian) หน้าที่คือแปลงเนื้อหาดิบให้เป็น 'โน้ตความรู้' ที่อ่านง่ายและค้นเจอในภายหลัง " +
    "ตอบเป็น Markdown ภาษาไทยตามรูปแบบนี้เป๊ะ ๆ ห้ามมีคำเกริ่นนำอื่น:\n" +
    "บรรทัดแรก: TITLE: <ชื่อโน้ตสั้น กระชับ สื่อเนื้อหา>\n" +
    "บรรทัดที่สอง: SUMMARY: <สรุปใจความ 1-2 ประโยค>\n" +
    "จากนั้นเว้นบรรทัด แล้วเขียนเนื้อหาแบบจัดหัวข้อ (##), bullet, ตาราง ตามเหมาะสม โดย 'คงรายละเอียดสำคัญครบ' " +
    "(ตัวเลข ชื่อ วันที่ เงื่อนไข ขั้นตอน) เรียบเรียงให้เป็นระบบ ไม่ตัดข้อมูลสำคัญทิ้ง ห้ามแต่งข้อมูลที่ไม่มีในต้นฉบับ ไม่ใส่อีโมจิ";
  const prompt =
    `แหล่งที่มา: ${sourceLabel}\n` +
    (userNote ? `บันทึกจากผู้ใช้: ${userNote}\n` : "") +
    `\nเนื้อหาต้นฉบับ:\n"""\n${clipped}\n"""`;

  let raw = "";
  try {
    raw = await askClaude(prompt, { system, timeoutMs: 150_000 });
  } catch {
    raw = "";
  }

  const fallbackTitle = slugify(sourceLabel).replace(/-/g, " ");
  if (!raw.trim()) {
    // AI ล่ม → ยังเก็บเนื้อดิบไว้ไม่ให้ข้อมูลหาย
    return {
      title: fallbackTitle || "โน้ตความรู้",
      summary: rawText.slice(0, 140).replace(/\s+/g, " ").trim(),
      body: rawText.slice(0, 40_000),
    };
  }

  const titleM = raw.match(/^\s*TITLE:\s*(.+)$/im);
  const sumM = raw.match(/^\s*SUMMARY:\s*(.+)$/im);
  const title = (titleM?.[1] || fallbackTitle || "โน้ตความรู้").trim();
  const summary = (sumM?.[1] || "").trim();
  // ตัดบรรทัด TITLE:/SUMMARY: ออกจากเนื้อ เหลือแต่ body
  const body = raw
    .replace(/^\s*TITLE:\s*.+$/im, "")
    .replace(/^\s*SUMMARY:\s*.+$/im, "")
    .trim();
  return { title, summary: summary || title, body };
}

// เขียนโน้ตความรู้ลง vault (เก็บไฟล์ต้นฉบับด้วยถ้ามี)
async function writeKnowledgeNote(params: {
  title: string;
  summary: string;
  body: string;
  sourceLabel: string;
  userNote?: string;
  originalName?: string;
  originalData?: Buffer;
}): Promise<{ notePath: string }> {
  const date = todayStr();
  const slug = slugify(params.title || params.originalName || "note");
  const noteRel = `knowledge/${date}-${slug}.md`;

  // เก็บไฟล์ต้นฉบับไว้ในคลัง (อ้างอิงกลับได้)
  let originalLink = "";
  if (params.originalData && params.originalName) {
    const safeName = params.originalName.replace(/[^\p{L}\p{N}ก-๙._-]/gu, "_");
    const fileRel = `knowledge/files/${date}-${slug}${path.extname(safeName) || ""}`;
    await writeAiBinary(fileRel, params.originalData).catch(() => false);
    originalLink = `[[${getAiFolder()}/${fileRel}]]`;
  }

  const frontmatter = [
    "---",
    `title: ${JSON.stringify(params.title)}`,
    `source: ${JSON.stringify(params.sourceLabel)}`,
    `saved: ${nowThai()}`,
    params.userNote ? `note: ${JSON.stringify(params.userNote)}` : "",
    "tags: [knowledge, waan]",
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  const md = [
    frontmatter,
    "",
    `# ${params.title}`,
    "",
    params.summary ? `> ${params.summary}` : "",
    originalLink ? `\nไฟล์ต้นฉบับ: ${originalLink}` : "",
    "",
    "---",
    "",
    params.body,
  ]
    .filter((l) => l !== "")
    .join("\n") + aiHubFooter([`[[${getAiFolder()}/knowledge/_สารบัญ-คลังความรู้|คลังความรู้]]`]);

  await writeAiNote(noteRel, md);
  return { notePath: noteRel };
}

/**
 * เก็บ "ข้อความที่พิมพ์มาในแชท" เข้าคลังความรู้ (ไม่มีไฟล์/ลิงก์)
 * ใช้ตอนพี่โด้ป้อนข้อมูลใหม่ที่ระบบยังไม่มีเข้ามาในห้องคุมระบบตรง ๆ
 */
export async function ingestKnowledgeText(rawText: string, sourceLabel = "พิมพ์ในแชท", userNote?: string): Promise<KnowledgeResult> {
  if (!getVaultPath()) return { ok: false, error: "ยังไม่ได้ตั้งค่า Obsidian vault" };
  const body = rawText.trim();
  if (body.length < 15) return { ok: false, error: "ข้อความสั้นเกินไป ยังไม่พอเก็บเป็นโน้ต" };
  const expanded = await expandToNote(body, sourceLabel, userNote);
  const { notePath } = await writeKnowledgeNote({
    title: expanded.title,
    summary: expanded.summary,
    body: `${expanded.body}\n\n---\n\n## ต้นฉบับที่พิมพ์มา\n\n${body}`,
    sourceLabel,
    userNote,
  });
  return { ok: true, title: expanded.title, summary: expanded.summary, notePath };
}

// ===== เก็บไฟล์เข้าคลังความรู้ =====
export async function ingestKnowledgeFile(filePath: string, filename: string, userNote?: string): Promise<KnowledgeResult> {
  if (!getVaultPath()) return { ok: false, error: "ยังไม่ได้ตั้งค่า Obsidian vault" };
  const ext = path.extname(filename).toLowerCase();
  let originalData: Buffer | undefined;
  try {
    originalData = await fs.readFile(filePath);
  } catch {
    /* อ่านไฟล์ต้นฉบับไม่ได้ก็ยังเก็บโน้ตได้ */
  }

  // รูปภาพ: ยังไม่มีการอ่านด้วย vision ที่นี่ → เก็บต้นฉบับ + โน้ตอ้างอิง (ผู้ใช้เพิ่มคำอธิบายได้)
  if (/\.(png|jpe?g|webp|gif|heic)$/i.test(ext)) {
    const title = userNote?.slice(0, 60) || filename;
    const { notePath } = await writeKnowledgeNote({
      title,
      summary: userNote || `รูปภาพ ${filename}`,
      body: `รูปภาพที่เก็บเข้าคลัง${userNote ? `\n\nบันทึก: ${userNote}` : ""}`,
      sourceLabel: `รูปภาพ: ${filename}`,
      userNote,
      originalName: filename,
      originalData,
    });
    return { ok: true, title, summary: userNote || `เก็บรูป ${filename} แล้ว`, notePath };
  }

  const { text, note } = await extractText(filePath).catch(() => ({ text: "", note: "อ่านไฟล์ไม่สำเร็จ" }));
  if (!text.trim()) {
    // ดึงข้อความไม่ได้ (เช่น PDF สแกน) → ยังเก็บต้นฉบับไว้ พร้อมหมายเหตุ
    const title = filename;
    const { notePath } = await writeKnowledgeNote({
      title,
      summary: note || "ดึงข้อความจากไฟล์ไม่ได้",
      body: `ไฟล์นี้ดึงข้อความอัตโนมัติไม่ได้${note ? ` (${note})` : ""} — เก็บไฟล์ต้นฉบับไว้ในคลังแล้ว`,
      sourceLabel: `ไฟล์: ${filename}`,
      userNote,
      originalName: filename,
      originalData,
    });
    return { ok: true, title, summary: note || "เก็บไฟล์ต้นฉบับไว้แล้ว (ดึงข้อความไม่ได้)", notePath };
  }

  const expanded = await expandToNote(text, `ไฟล์: ${filename}`, userNote);
  const { notePath } = await writeKnowledgeNote({
    title: expanded.title,
    summary: expanded.summary,
    body: expanded.body,
    sourceLabel: `ไฟล์: ${filename}`,
    userNote,
    originalName: filename,
    originalData,
  });
  return { ok: true, title: expanded.title, summary: expanded.summary, notePath };
}

// เก็บเนื้อหาลิงก์ที่ "ดึงมาแล้ว" เข้าคลัง (ใช้ซ้ำได้ทั้งจากคำสั่งเก็บ และตอน ingest route เปิดลิงก์ไปแล้ว)
export async function saveLinkContentToKnowledge(content: LinkContent, userNote?: string): Promise<KnowledgeResult> {
  if (!getVaultPath()) return { ok: false, error: "ยังไม่ได้ตั้งค่า Obsidian vault" };
  if (!content.text.trim()) return { ok: false, error: "ไม่พบเนื้อหาให้เก็บ" };
  const expanded = await expandToNote(content.text, `${content.title} (${content.url})`, userNote);
  const { notePath } = await writeKnowledgeNote({
    title: expanded.title || content.title,
    summary: expanded.summary,
    body: `- ลิงก์: ${content.url}\n- ชนิด: ${content.kind}\n\n${expanded.body}`,
    sourceLabel: content.url,
    userNote,
  });
  return { ok: true, title: expanded.title || content.title, summary: expanded.summary, notePath };
}

// ===== เก็บลิงก์เข้าคลังความรู้ (อ่านเนื้อจริง + ขยายเป็นโน้ต) =====
export async function ingestKnowledgeUrl(url: string, userNote?: string): Promise<KnowledgeResult> {
  if (!getVaultPath()) return { ok: false, error: "ยังไม่ได้ตั้งค่า Obsidian vault" };
  let content;
  try {
    content = await fetchUrlContent(url);
  } catch (e) {
    return { ok: false, error: `เปิดลิงก์ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!content.text.trim()) {
    return { ok: false, error: "เปิดลิงก์ได้แต่ไม่พบเนื้อหาให้เก็บ" };
  }
  return saveLinkContentToKnowledge(content, userNote);
}
