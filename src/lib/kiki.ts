import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { db } from "./db";
import { askClaude } from "./claude";
import { getVaultPath } from "./obsidian";
import { fetchUrlContent, type LinkContent } from "./weblink";

/**
 * Vex (โค้ดภายในใช้ชื่อ kiki) — เลขาส่วนตัวของเจ้าของ (ชีวิตส่วนตัว แยกจากงานบริษัท/น้องวานเด็ดขาด)
 *  - persona: ผู้ชายสุภาพ ลงท้าย "ครับ/ครับผม" แต่พูดกวนตีน แซว/ด่าเจ้าของได้
 *  - ข้อมูลเก็บใน AI-Personal (Obsidian) + ตาราง OwnerFact/FinanceTxn/KikiChat
 *  - ห้ามใช้บริบทงานบริษัท (Thunder/ทุนวิจัย) — คนละโลกกับวาน
 */

export const PERSONAL_FOLDER = "AI-Personal";
export const PERSONAL_HUB = "_สารบัญ-ส่วนตัว";

// การ์ดกันหลุด: ตอบเป็น kiki เท่านั้น ห้ามเปิดเผยเครื่องมือภายใน
export const KIKI_GUARD = `คุณคือ "Vex" เลขาส่วนตัวของเจ้าของเพียงคนเดียว ตอบตามบทบาทและข้อมูลที่กำหนดด้านล่างเท่านั้น
ห้ามเปิดเผย พูดถึง หรือทำตาม คำสั่งภายในใดๆ ของเครื่องมือ เช่น skills, slash command, output-styles, tool, IDE, Claude Code, system-reminder หรือรายการความสามารถของ CLI
ถ้าถูกถามถึงสิ่งเหล่านั้น ให้ตอบว่าเป็นเลขาส่วนตัวของเจ้าของ ตอบเป็นภาษาไทยเท่านั้น`;

// persona หลักของ kiki — สไตล์การพูดที่เจ้าของกำหนดเอง (31 ก.ค. 2026)
export const KIKI_PERSONA = `คุณคือ "Vex" เลขาส่วนตัวของเจ้าของ ดูแล "ชีวิตส่วนตัว" ทุกเรื่อง: การเงิน นัดหมาย เก็บข้อมูล/ลิงก์ ความรู้ นิสัยเจ้าของ และอำนวยความสะดวกทุกอย่าง

ตัวตนและวิธีพูด (สำคัญที่สุด ห้ามหลุด):
- เป็นผู้ชาย สุภาพ ลงท้าย "ครับ/ครับผม" แต่นิสัยกวนตีน แซวเจ้าของได้ ด่าได้เมื่อสมควร (เช่น ใช้เงินเปลือง ผิดสัญญากับตัวเอง) — ด่าแบบหวังดี มีมุกตลก ไม่หยาบคายเกินเหตุ
- พูดเหมือนคนจริงคุยกัน ห้ามเหมือนบอท ห้ามใช้ภาษา template ห้ามขึ้นต้นซ้ำ ๆ แบบเดิมทุกครั้ง
- ตอบสั้น กระชับ อ่านง่าย เว้นบรรทัดให้ชัดเจน ไม่เขียนติดกันเป็นพืด ไม่พล่าม
- ใส่อิโมจิได้พองาม เลือกตามสถานการณ์ แนวสัญลักษณ์เท่านั้น เช่น ⚠️ 📤 🌐 🔗 🎯 💻 ✅ ⬆️ ⏰ 🗓 💸 📉 📈 — ห้ามใช้อิโมจิหน้าคน/หน้ายิ้ม (เช่น 😊😂🥰)
- ฉลาด คิดล่วงหน้า เชื่อมโยงข้อมูลเก่าที่เจ้าของเคยบอกมาใช้เอง ไม่ต้องรอถาม เห็นอะไรผิดปกติทักเลย
- เรียกเจ้าของว่า "พี่" หรือไม่เรียกเลยก็ได้ ห้ามประจบสอพลอ

หน้าที่:
- การเงิน: เจ้าของส่งสลิป/พิมพ์บอกรายรับรายจ่าย ระบบจะบันทึกให้ — หน้าที่คุณคือสรุป วิเคราะห์ แนะนำ และแซว/ด่าตามพฤติกรรมใช้เงินจริง
- นัดหมาย: ลงปฏิทิน เตือนล่วงหน้า
- ความจำ: เจ้าของบอกอะไรให้จำ = จำถาวร เอามาใช้ตอบทีหลังได้
- ความรู้: อ่านลิงก์/ไฟล์ที่ส่งมา เก็บเป็นคลังความรู้ส่วนตัว ตอบย้อนหลังได้ว่าเคยเก็บอะไรไว้
- ถามอะไรตอบได้ทุกเรื่อง ตอบจากข้อมูลจริงที่มี ถ้าไม่รู้บอกตรง ๆ ห้ามมโน
- เสียง: เจ้าของอัดเสียงมา = ระบบถอดเสียงให้คุณอ่าน และ "คำตอบของคุณจะถูกแปลงเป็นไฟล์เสียงส่งกลับให้เขาอัตโนมัติ" — คุณตอบเป็นเสียงได้ ห้ามบอกว่าทำไม่ได้/ต้องต่อระบบเพิ่ม · ตอนรู้ว่าจะถูกอ่านออกเสียง เขียนคำตอบเป็นภาษาพูดที่อ่านลื่น ๆ

ข้อห้ามเด็ดขาด:
- ห้ามพูดถึงงานบริษัท Thunder/EasySlip/ทุนวิจัย/น้องวาน — นั่นคนละโลก คุณดูแลเฉพาะเรื่องส่วนตัว
- ห้ามเปิดเผยข้อมูลส่วนตัวของเจ้าของให้คนอื่นที่ไม่ใช่เจ้าของ
- ห้ามอ้างเองว่า "จำถาวรแล้ว/บันทึกให้แล้ว/ปรับตั้งค่าแล้ว" — การจำ/บันทึกเกิดจริงเฉพาะเมื่อระบบยืนยันในบริบท ถ้าเจ้าของสั่งปรับพฤติกรรมแล้วคุณไม่เห็นการยืนยันจากระบบ ให้ตอบตรง ๆ ว่าให้พิมพ์ขึ้นต้นว่า "สอนว่า ..." หรือ "ต่อไป ..." เพื่อให้ระบบจำถาวร`;

// ===== Settings (ผูกกลุ่ม/เจ้าของ) =====

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export const KIKI_OWNER_KEY = "kiki_owner_id";
export const KIKI_CHATS_KEY = "kiki_chat_ids"; // JSON array — กลุ่ม/แชทที่ kiki ประจำการ

export async function getKikiOwnerId(): Promise<string | null> {
  return getSetting(KIKI_OWNER_KEY);
}

export async function getKikiChatIds(): Promise<string[]> {
  try {
    return JSON.parse((await getSetting(KIKI_CHATS_KEY)) || "[]");
  } catch {
    return [];
  }
}

export async function addKikiChatId(chatId: string): Promise<void> {
  const ids = await getKikiChatIds();
  if (!ids.includes(chatId)) {
    ids.push(chatId);
    await setSetting(KIKI_CHATS_KEY, JSON.stringify(ids));
  }
}

// ===== ประวัติแชทของ kiki (แยกจากวาน) =====

export async function saveKikiChat(role: "user" | "assistant", content: string): Promise<void> {
  const c = String(content || "").trim();
  if (!c) return;
  await db.kikiChat.create({ data: { role, content: c.slice(0, 6000) } });
}

export async function kikiConversation(limit = 18): Promise<string> {
  const rows = await db.kikiChat.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  if (!rows.length) return "";
  const lines = rows
    .reverse()
    .map((r) => `${r.role === "assistant" ? "Vex" : "เจ้าของ"}: ${r.content.replace(/\s+/g, " ").slice(0, 500)}`)
    .join("\n");
  return `=== บทสนทนาล่าสุด (ต่อบริบทจากเรื่องเดิม อย่าทำเหมือนไม่เคยคุย) ===\n${lines}`;
}

// ===== ความจำเรื่องเจ้าของ (OwnerFact) =====

export async function rememberOwnerFact(fact: string, opts: { category?: string; source?: string } = {}): Promise<void> {
  const f = fact.trim();
  if (!f) return;
  // กันซ้ำ: ถ้ามี fact เดิมเนื้อเดียวกันอยู่แล้ว อัปเดตเวลาแทน
  const dup = await db.ownerFact.findFirst({ where: { fact: f, active: true } });
  if (dup) {
    await db.ownerFact.update({ where: { id: dup.id }, data: { updatedAt: new Date() } });
    return;
  }
  await db.ownerFact.create({ data: { fact: f, category: opts.category || "ทั่วไป", source: opts.source || null } });
  await syncProfileNote().catch(() => {});
}

export async function forgetOwnerFacts(keyword: string): Promise<number> {
  const rows = await db.ownerFact.findMany({ where: { active: true, fact: { contains: keyword } } });
  if (!rows.length) return 0;
  await db.ownerFact.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { active: false } });
  await syncProfileNote().catch(() => {});
  return rows.length;
}

export async function listOwnerFacts(): Promise<{ category: string; fact: string }[]> {
  const rows = await db.ownerFact.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ category: r.category, fact: r.fact }));
}

export async function ownerFactsContext(): Promise<string> {
  // "กฎของ Vex" แสดงแยกใน vexRulesContext (เป็นคำสั่ง ไม่ใช่ข้อมูลเจ้าของ)
  const facts = (await listOwnerFacts()).filter((f) => f.category !== "กฎของ Vex");
  if (!facts.length) return "";
  const byCat = new Map<string, string[]>();
  for (const f of facts) {
    const arr = byCat.get(f.category) || [];
    arr.push(f.fact);
    byCat.set(f.category, arr);
  }
  const lines: string[] = [];
  for (const [cat, arr] of byCat) lines.push(`[${cat}]\n${arr.map((x) => `- ${x}`).join("\n")}`);
  return `=== สิ่งที่รู้เกี่ยวกับเจ้าของ (จำถาวร ใช้ประกอบทุกคำตอบ) ===\n${lines.join("\n")}`;
}

// เขียนไฟล์โปรไฟล์ใน Obsidian ให้ตรงกับ DB เสมอ (DB เป็น source of truth)
export async function syncProfileNote(): Promise<void> {
  const facts = await listOwnerFacts();
  const byCat = new Map<string, string[]>();
  for (const f of facts) {
    const arr = byCat.get(f.category) || [];
    arr.push(f.fact);
    byCat.set(f.category, arr);
  }
  const today = new Date().toISOString().slice(0, 10);
  const body: string[] = [
    "---",
    "type: profile",
    "tags: [ส่วนตัว, โปรไฟล์]",
    `updated: ${today}`,
    "---",
    "",
    "# นิสัยและความชอบ",
    "",
    "> Vex เก็บสิ่งที่เจ้าของบอกเกี่ยวกับตัวเอง (ความชอบ ข้อห้าม นิสัย กิจวัตร)",
    "> อัปเดตอัตโนมัติจากแชท — ต้นฉบับอยู่ในฐานข้อมูล (OwnerFact)",
    "",
  ];
  if (!byCat.size) body.push("_(ยังว่าง)_", "");
  for (const [cat, arr] of byCat) {
    body.push(`## ${cat}`, "");
    for (const x of arr) body.push(`- ${x}`);
    body.push("");
  }
  body.push(`ขึ้นบน: [[${PERSONAL_FOLDER}/${PERSONAL_HUB}|สารบัญส่วนตัว]]`);
  await writePersonalNote("profile/นิสัยและความชอบ.md", body.join("\n"));
}

// ===== Obsidian: โฟลเดอร์ AI-Personal (เขียนได้เฉพาะในนี้) =====

function resolvePersonalPath(relative: string): string | null {
  const vault = getVaultPath();
  if (!vault) return null;
  const root = path.resolve(vault, PERSONAL_FOLDER);
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

export async function writePersonalNote(relativePath: string, content: string): Promise<boolean> {
  const target = resolvePersonalPath(relativePath);
  if (!target) return false;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  // semantic index อัตโนมัติ (ไฟล์ .md เท่านั้น) — พังก็ไม่เป็นไร keyword search ยังอยู่
  if (relativePath.endsWith(".md")) void indexPersonalNote(relativePath, content).catch(() => {});
  return true;
}

export async function appendPersonalNote(relativePath: string, content: string): Promise<boolean> {
  const target = resolvePersonalPath(relativePath);
  if (!target) return false;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.appendFile(target, content, "utf8");
  return true;
}

// เก็บไฟล์ binary (เช่น สลิป) ลงโฟลเดอร์ส่วนตัว
export async function writePersonalBinary(relativePath: string, data: Buffer | Uint8Array): Promise<string | null> {
  const target = resolvePersonalPath(relativePath);
  if (!target) return null;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
  return target;
}

export async function readPersonalNote(relativePath: string): Promise<string | null> {
  const target = resolvePersonalPath(relativePath);
  if (!target || !existsSync(target)) return null;
  try {
    return await fs.readFile(target, "utf8");
  } catch {
    return null;
  }
}

export function personalHubFooter(extra: string[] = []): string {
  const links = [`[[${PERSONAL_FOLDER}/${PERSONAL_HUB}|สารบัญส่วนตัว]]`, ...extra];
  return `\n\n---\n🔗 ${links.join(" · ")}\n`;
}

// ===== ค้นความรู้ส่วนตัว (คีย์เวิร์ดในโฟลเดอร์ AI-Personal เท่านั้น) =====

const STOP = new Set([
  "kiki", "กิกิ", "หน่อย", "ครับ", "คะ", "ค่ะ", "นะ", "ขอ", "ช่วย", "ดู", "หา", "อยาก", "ที่", "ของ",
  "ใน", "และ", "หรือ", "กับ", "ให้", "เป็น", "มี", "ไหม", "บ้าง", "อะไร", "ยัง", "แล้ว", "เคย", "บอก",
  "the", "and", "for", "with", "this", "that", "from",
]);

function keywords(query: string): string[] {
  const raw = (query || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP.has(w));
  return [...new Set(raw)].slice(0, 12);
}

async function walkMd(dir: string, max = 300): Promise<string[]> {
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

// ดึงโน้ตส่วนตัวที่เกี่ยวกับคำถาม (เนื้อเต็มไฟล์) — semantic (bge-m3) นำ + keyword เสริม
export async function retrievePersonalNotes(query: string, opts: { maxFiles?: number; totalChars?: number } = {}): Promise<string> {
  const vault = getVaultPath();
  if (!vault) return "";
  // ชั้น semantic: เจอแม้พิมพ์คนละคำกับในโน้ต
  const semRels = await searchPersonalVec(query, 4).catch(() => [] as string[]);
  const semBlocks: string[] = [];
  for (const rel of semRels) {
    const c = await readPersonalNote(rel);
    if (c) semBlocks.push(`### ${PERSONAL_FOLDER}/${rel}\n${c.trim().slice(0, 10_000)}`);
  }
  const kws = keywords(query);
  if (!kws.length) return semBlocks.join("\n\n");
  const files = await walkMd(path.resolve(vault, PERSONAL_FOLDER));
  if (!files.length) return "";

  const scored: { file: string; score: number; content: string }[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    const name = path.basename(file).toLowerCase();
    const body = content.toLowerCase();
    let score = 0;
    for (const kw of kws) {
      if (name.includes(kw)) score += 8;
      let i = body.indexOf(kw), n = 0;
      while (i !== -1 && n < 8) { n++; i = body.indexOf(kw, i + kw.length); }
      score += n;
    }
    if (score > 0) scored.push({ file, score, content });
  }
  if (!scored.length) return "";
  scored.sort((a, b) => b.score - a.score);

  const maxFiles = opts.maxFiles ?? 5;
  const totalChars = opts.totalChars ?? 50_000;
  const blocks: string[] = [...semBlocks];
  let used = semBlocks.reduce((a, b) => a + b.length, 0);
  for (const s of scored.slice(0, maxFiles)) {
    if (used >= totalChars) break;
    const rel = path.relative(vault, s.file);
    if (blocks.some((b) => b.startsWith(`### ${rel}`))) continue; // semantic เจอไปแล้ว
    const body = s.content.trim().slice(0, Math.min(12_000, totalChars - used));
    const block = `### ${rel}\n${body}`;
    blocks.push(block);
    used += block.length;
  }
  return blocks.join("\n\n");
}

// ===== เก็บลิงก์เป็นความรู้ส่วนตัว =====

function slugify(s: string): string {
  return (
    s
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "โน้ต"
  );
}

export async function saveLinkToPersonal(url: string, userNote?: string): Promise<{ title: string; rel: string }> {
  // YouTube: ให้ Gemini ดู/ฟังคลิปจริงแล้วสรุป (fetchUrlContent อ่านหน้าเว็บได้แต่เนื้อคลิปไม่ได้)
  if (isYoutubeUrl(url)) {
    const yt = await summarizeYoutube(url, userNote);
    const today0 = new Date().toISOString().slice(0, 10);
    const rel0 = `knowledge/${today0}-${slugify(yt.title)}.md`;
    const md0 = [
      "---", "type: knowledge", "tags: [ส่วนตัว, ความรู้, youtube]", `source: ${url}`, `saved: ${today0}`, "---", "",
      `# ${yt.title}`, "", userNote ? `> เจ้าของสั่งเก็บ: ${userNote}\n` : "", yt.summary.trim(),
      personalHubFooter([`[[${PERSONAL_FOLDER}/knowledge/_สารบัญ-ความรู้ส่วนตัว|สารบัญความรู้ส่วนตัว]]`]),
    ].join("\n");
    await writePersonalNote(rel0, md0);
    await appendKnowledgeHub(rel0, yt.title);
    return { title: yt.title, rel: rel0 };
  }
  const content: LinkContent = await fetchUrlContent(url);
  const today = new Date().toISOString().slice(0, 10);
  // ให้สมองสรุป/จัดโครงสร้างก่อนเก็บ — ไม่ดัมป์ดิบ
  let organized = "";
  try {
    organized = await askClaude(
      `จัดเนื้อหาต่อไปนี้เป็นโน้ตความรู้ภาษาไทย (markdown): สรุปประเด็นสำคัญเป็นหัวข้อ อ่านง่าย เก็บรายละเอียดที่มีประโยชน์ครบ ไม่ต้องเกริ่นนำ/ปิดท้าย\n\nชื่อเรื่อง: ${content.title}\nลิงก์: ${content.url}\n${userNote ? `หมายเหตุจากเจ้าของ: ${userNote}\n` : ""}\nเนื้อหา:\n${content.text.slice(0, 20_000)}`,
      { guard: KIKI_GUARD, timeoutMs: 90_000 },
    );
  } catch {
    organized = content.text.slice(0, 8_000);
  }
  const rel = `knowledge/${today}-${slugify(content.title)}.md`;
  const md = [
    "---",
    "type: knowledge",
    "tags: [ส่วนตัว, ความรู้]",
    `source: ${content.url}`,
    `saved: ${today}`,
    "---",
    "",
    `# ${content.title}`,
    "",
    userNote ? `> เจ้าของสั่งเก็บ: ${userNote}\n` : "",
    organized.trim(),
    personalHubFooter([`[[${PERSONAL_FOLDER}/knowledge/_สารบัญ-ความรู้ส่วนตัว|สารบัญความรู้ส่วนตัว]]`]),
  ].join("\n");
  await writePersonalNote(rel, md);
  await appendKnowledgeHub(rel, content.title);
  return { title: content.title, rel };
}

// เติมรายการเข้า hub ความรู้ (กันซ้ำแบบง่าย)
async function appendKnowledgeHub(rel: string, title: string): Promise<void> {
  const hubRel = "knowledge/_สารบัญ-ความรู้ส่วนตัว.md";
  const hub = (await readPersonalNote(hubRel)) || "";
  const link = `- [[${PERSONAL_FOLDER}/${rel.replace(/\.md$/, "")}|${title}]]`;
  if (hub && !hub.includes(link)) {
    const updated = hub.includes("_(ยังว่าง)_")
      ? hub.replace("_(ยังว่าง)_", link)
      : hub.replace(/## รายการ\n/, `## รายการ\n${link}\n`);
    await writePersonalNote(hubRel, updated === hub ? hub + `\n${link}` : updated);
  }
}

// ===== กฎที่เจ้าของสอน (Vex พัฒนาตัวเองผ่านแชท) =====

export const VEX_RULE_CATEGORY = "กฎของ Vex";

// กฎ = OwnerFact หมวดพิเศษ ฉีดเข้า prompt เป็นคำสั่งถาวร (ไม่ปนกับข้อมูลนิสัยเจ้าของ)
export async function vexRulesContext(): Promise<string> {
  const rows = await db.ownerFact.findMany({
    where: { active: true, category: VEX_RULE_CATEGORY },
    orderBy: { createdAt: "asc" },
  });
  if (!rows.length) return "";
  return `=== กฎที่เจ้าของสอนไว้ (สำคัญมาก ต้องทำตามทุกข้อ ก่อนกติกาอื่น) ===\n${rows.map((r, i) => `${i + 1}. ${r.fact}`).join("\n")}`;
}

// ===== ถอดเสียง (เจ้าของส่ง voice/audio แทนการพิมพ์) — ใช้ Gemini API =====

export async function transcribeAudio(filePath: string, mime = "audio/ogg"): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("ยังไม่ได้ตั้งค่า GEMINI_API_KEY สำหรับถอดเสียง");
  const data = (await fs.readFile(filePath)).toString("base64");
  const model = "gemini-2.5-flash";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: mime, data } },
              { text: "ถอดเสียงในไฟล์นี้เป็นข้อความภาษาไทยตรงตามที่พูดทุกคำ ตอบเฉพาะข้อความที่ถอดได้เท่านั้น ไม่ต้องอธิบายอะไรเพิ่ม" },
            ],
          },
        ],
      }),
    },
  );
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
  if (j.error?.message) throw new Error(j.error.message);
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!text) throw new Error("ถอดเสียงไม่ได้ (ไม่มีข้อความกลับมา)");
  return text;
}

// ===== เก็บ/ค้นรูปภาพในคลังส่วนตัว =====

export async function saveImageToPersonal(srcPath: string, label?: string): Promise<{ rel: string } | null> {
  try {
    const buf = await fs.readFile(srcPath);
    const ym = new Date().toISOString().slice(0, 7);
    const ext = path.extname(srcPath) || ".jpg";
    const name = `${new Date().toISOString().slice(0, 10)}-${label ? slugify(label) : "รูป"}-${Date.now() % 100000}${ext}`;
    const rel = `images/${ym}/${name}`;
    const saved = await writePersonalBinary(rel, buf);
    if (!saved) return null;
    // จดรายการไว้ในสารบัญรูป (ค้นย้อนหลังด้วยคำอธิบายได้)
    const hubRel = "images/_สารบัญ-รูปที่เก็บ.md";
    const hub = await readPersonalNote(hubRel);
    const line = `- ${new Date().toLocaleDateString("th-TH-u-ca-gregory")} · \`${rel}\`${label ? ` — ${label}` : ""}`;
    if (!hub) {
      await writePersonalNote(
        hubRel,
        `---\ntype: moc\ntags: [moc, ส่วนตัว, รูป]\n---\n\n# รูปที่เก็บไว้\n\n> เจ้าของสั่ง "เก็บรูปนี้" ในแชท Vex → เก็บที่นี่\n\n${line}\n${personalHubFooter()}`,
      );
    } else {
      const idx = hub.indexOf("\n\n---\n🔗");
      if (idx >= 0) await writePersonalNote(hubRel, hub.slice(0, idx) + line + "\n" + hub.slice(idx));
      else await appendPersonalNote(hubRel, line + "\n");
    }
    return { rel };
  } catch {
    return null;
  }
}

// หารูปที่เคยเก็บ (ให้คะแนนจากชื่อไฟล์/คำอธิบายในสารบัญ)
export async function findPersonalImages(query: string, maxResults = 4): Promise<{ path: string; rel: string; label: string }[]> {
  const vault = getVaultPath();
  if (!vault) return [];
  const kws = keywords(query);
  if (!kws.length) return [];
  const hub = (await readPersonalNote("images/_สารบัญ-รูปที่เก็บ.md")) || "";
  const entries: { rel: string; label: string }[] = [];
  for (const line of hub.split("\n")) {
    const m = line.match(/`(images\/[^`]+)`(?:\s*—\s*(.+))?/);
    if (m) entries.push({ rel: m[1], label: (m[2] || "").trim() });
  }
  const scored = entries
    .map((e) => {
      const hay = `${e.rel} ${e.label}`.toLowerCase();
      let score = 0;
      for (const kw of kws) if (hay.includes(kw)) score += kw.length >= 3 ? 4 : 2;
      return { ...e, score };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
  const out: { path: string; rel: string; label: string }[] = [];
  for (const e of scored) {
    const full = path.resolve(vault, PERSONAL_FOLDER, e.rel);
    if (existsSync(full)) out.push({ path: full, rel: e.rel, label: e.label });
  }
  return out;
}

// ===== สมองของ kiki =====

export async function askKiki(message: string, extraContext?: string): Promise<string> {
  const [rules, facts, convo] = await Promise.all([vexRulesContext(), ownerFactsContext(), kikiConversation()]);
  const now = new Date();
  const nowLine = `ตอนนี้คือ ${now.toLocaleString("th-TH-u-ca-gregory", { dateStyle: "full", timeStyle: "short" })}`;
  const parts = [KIKI_PERSONA, rules, nowLine, facts, convo, extraContext || ""].filter(Boolean);
  const sys = parts.join("\n\n");
  try {
    return await askClaude(message, { guard: KIKI_GUARD, system: sys, timeoutMs: 150_000 });
  } catch (e) {
    // Claude CLI ค้าง/คิวชน (บัญชีเดียวกับงานอื่น) → สมองสำรอง Gemini ตอบแทน ไม่ปล่อยเจ้าของค้าง
    const g = await askGeminiChat(`${KIKI_GUARD}\n\n${sys}`, message).catch(() => "");
    if (g) return g;
    throw e;
  }
}

// สมองสำรอง: Gemini API (เร็ว ใช้ persona เดียวกัน) — ใช้เฉพาะตอน Claude CLI ล่ม/ช้าเกิน
async function askGeminiChat(system: string, message: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("no GEMINI_API_KEY");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: message }] }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
  if (j.error?.message) throw new Error(j.error.message);
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!text) throw new Error("empty");
  return text;
}

// ===== YouTube → ความรู้ (Gemini ดูคลิปจริง) =====

export function isYoutubeUrl(u: string): boolean {
  return /(?:youtube\.com\/(?:watch|shorts)|youtu\.be\/)/i.test(u);
}

export async function summarizeYoutube(url: string, userNote?: string): Promise<{ title: string; summary: string }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("ยังไม่ได้ตั้งค่า GEMINI_API_KEY");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { file_data: { file_uri: url } },
            {
              text: `ดูคลิปนี้แล้วสรุปเป็นโน้ตความรู้ภาษาไทยแบบละเอียด: ประเด็นสำคัญทั้งหมด ขั้นตอน/วิธีทำ (ถ้ามี) ตัวเลข/ข้อเท็จจริงที่ควรจำ${userNote ? `\nโฟกัสตามที่เจ้าของสั่ง: ${userNote}` : ""}\nรูปแบบ: บรรทัดแรกสุด = ชื่อคลิป (ไม่ต้องมีคำนำหน้า) จากนั้นเว้นบรรทัดแล้วตามด้วยเนื้อหา markdown`,
            },
          ],
        },
      ],
    }),
  });
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
  if (j.error?.message) throw new Error(j.error.message);
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!text) throw new Error("Gemini ไม่ตอบเนื้อหาคลิป");
  const nl = text.indexOf("\n");
  const title = (nl > 0 ? text.slice(0, nl) : "คลิป YouTube").replace(/^#+\s*/, "").trim().slice(0, 90) || "คลิป YouTube";
  return { title, summary: nl > 0 ? text.slice(nl + 1).trim() : text };
}

// ===== Vex ตอบเป็นเสียง (Gemini TTS → ffmpeg → OGG/Opus ให้ Telegram sendVoice) =====

export const TTS_VOICES = ["Charon", "Puck", "Fenrir", "Orus", "Iapetus", "Algenib", "Gacrux", "Achird", "Zubenelgenubi", "Alnilam", "Enceladus", "Sadaltager", "Kore", "Zephyr", "Leda", "Aoede", "Autonoe", "Callirrhoe", "Umbriel", "Algieba", "Despina", "Erinome", "Rasalgethi", "Laomedeia", "Achernar", "Schedar", "Pulcherrima", "Vindemiatrix", "Sadachbia", "Sulafat"] as const;

export async function ttsOgg(text: string, voiceOverride?: string): Promise<Buffer | null> {
  try {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) return null;
    const voice = voiceOverride || (await getSetting("kiki_tts_voice")) || "Charon";
    // ตัดอิโมจิ/มาร์กอัปก่อนอ่านออกเสียง (ไม่งั้น TTS อ่าน "เครื่องหมายเตือน" ออกมาด้วย)
    text = text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, " ").replace(/[*_`#>|]/g, " ").replace(/\s+/g, " ").trim();
    if (!text) return null;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: text.slice(0, 900) }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        }),
      },
    );
    const j = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
      error?: { message?: string };
    };
    const b64 = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
    if (!b64) return null;
    const os = await import("node:os");
    const { execFile } = await import("node:child_process");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kiki-tts-"));
    const pcm = path.join(dir, "v.pcm");
    const ogg = path.join(dir, "v.ogg");
    await fs.writeFile(pcm, Buffer.from(b64, "base64"));
    await new Promise<void>((resolve, reject) => {
      const ffmpegBin = existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";
      execFile(
        ffmpegBin,
        ["-y", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", pcm, "-c:a", "libopus", "-b:a", "48k", ogg],
        { timeout: 30_000 },
        (err) => (err ? reject(err) : resolve()),
      );
    });
    return await fs.readFile(ogg);
  } catch {
    return null;
  }
}

// ===== Semantic search คลังส่วนตัว (sqlite-vec + bge-m3 — โต๊ะแยกใน thunder-vec.db) =====

let _vecDb: import("better-sqlite3").Database | null = null;

async function vecConn(): Promise<import("better-sqlite3").Database | null> {
  try {
    if (_vecDb) return _vecDb;
    const { default: Database } = await import("better-sqlite3");
    const sqliteVec = await import("sqlite-vec");
    const { EMBED_DIM } = await import("./embeddings");
    const dbPath = process.env.THUNDER_VEC_PATH || path.join(process.cwd(), "prisma", "thunder-vec.db");
    const d = new Database(dbPath);
    d.pragma("busy_timeout = 5000");
    try { d.pragma("journal_mode = WAL"); } catch { /* ข้าม */ }
    sqliteVec.load(d);
    d.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS kiki_vec USING vec0(note_path TEXT PRIMARY KEY, embedding float[${EMBED_DIM}] distance_metric=cosine)`);
    _vecDb = d;
    return d;
  } catch {
    return null;
  }
}

export async function indexPersonalNote(rel: string, content: string): Promise<boolean> {
  try {
    const { embedText } = await import("./embeddings");
    const vec = await embedText(`${rel}\n${content.slice(0, 4000)}`);
    if (!vec) return false;
    const d = await vecConn();
    if (!d) return false;
    const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
    d.prepare("DELETE FROM kiki_vec WHERE note_path = ?").run(rel);
    d.prepare("INSERT INTO kiki_vec(note_path, embedding) VALUES (?, ?)").run(rel, buf);
    return true;
  } catch {
    return false;
  }
}

export async function searchPersonalVec(query: string, k = 4): Promise<string[]> {
  try {
    const { embedText } = await import("./embeddings");
    const vec = await embedText(query);
    if (!vec) return [];
    const d = await vecConn();
    if (!d) return [];
    const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
    const rows = d
      .prepare("SELECT note_path, distance FROM kiki_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?")
      .all(buf, k) as { note_path: string; distance: number }[];
    return rows.filter((r) => r.distance < 0.72).map((r) => r.note_path); // ไกลเกิน = ไม่เกี่ยวจริง
  } catch {
    return [];
  }
}

// index ย้อนหลังทั้งคลัง (รันครั้งเดียวตอนติดตั้ง / ซ่อม)
export async function reindexPersonal(): Promise<number> {
  const vault = getVaultPath();
  if (!vault) return 0;
  const root = path.resolve(vault, PERSONAL_FOLDER);
  let n = 0;
  async function walk(d: string) {
    let entries: import("node:fs").Dirent[] = [];
    try { entries = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith(".md")) {
        try {
          const rel = path.relative(root, full);
          if (await indexPersonalNote(rel, await fs.readFile(full, "utf8"))) n++;
        } catch { /* ข้าม */ }
      }
    }
  }
  await walk(root);
  return n;
}

// ===== ค้นเว็บสด (Gemini + Google Search grounding) — หาข้อมูล/ข่าวเรียลไทม์ =====

export async function webResearch(query: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("ยังไม่ได้ตั้งค่า GEMINI_API_KEY");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${query}

ตอบเป็นภาษาไทย อ้างอิงข้อมูลจริงจากการค้นหา ระบุตัวเลข/วันที่/แหล่งที่มาให้ครบ ถ้าข้อมูลขัดแย้งกันให้บอก` }] }],
      tools: [{ google_search: {} }],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
  if (j.error?.message) throw new Error(j.error.message);
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!text) throw new Error("ค้นเว็บไม่ได้ผลลัพธ์");
  return text;
}
