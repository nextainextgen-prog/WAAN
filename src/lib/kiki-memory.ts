import path from "node:path";
import { db } from "./db";

/**
 * ความจำระยะยาวของ Vex (เจ้าของสั่ง 4 ส.ค. 2026: "ความจำสั้น จำอะไรไม่ได้เลย")
 *
 * ปัญหาเดิม: บริบทมีแค่แชทล่าสุด 18 ข้อความ · แชทเก่าไม่เคยถูก index = ค้นกลับไม่ได้เลย
 * โครงใหม่ 4 ชั้น:
 *   1) หน้าต่างล่าสุด    — kikiConversation() ใน kiki.ts (ขยายแล้ว)
 *   2) recall แชทดิบ     — ทุกข้อความถูก embed เข้า kiki_recall (sqlite-vec + bge-m3 ในเครื่อง)
 *   3) สรุปรายวัน        — KikiMemory (ไม่เขียนลง Obsidian ตามกติกา "เก็บเฉพาะที่สั่งให้เก็บ")
 *   4) ข้อเท็จจริงถาวร   — OwnerFact เดิม
 *
 * ทุกชั้นพังได้โดยไม่ทำให้แชทล่ม (Ollama ไม่รัน = recall ว่าง แชทยังตอบปกติ)
 */

const KEY_CHAT = "chat:";
const KEY_DAY = "day:";
const KEY_MEDIA = "media:";

let _db: import("better-sqlite3").Database | null = null;

async function vecConn(): Promise<import("better-sqlite3").Database | null> {
  try {
    if (_db) return _db;
    const { default: Database } = await import("better-sqlite3");
    const sqliteVec = await import("sqlite-vec");
    const { EMBED_DIM } = await import("./embeddings");
    const dbPath = process.env.THUNDER_VEC_PATH || path.join(process.cwd(), "prisma", "thunder-vec.db");
    const d = new Database(dbPath);
    d.pragma("busy_timeout = 5000");
    try { d.pragma("journal_mode = WAL"); } catch { /* ข้าม */ }
    sqliteVec.load(d);
    d.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS kiki_recall USING vec0(key TEXT PRIMARY KEY, embedding float[${EMBED_DIM}] distance_metric=cosine)`);
    _db = d;
    return d;
  } catch {
    return null;
  }
}

async function putVec(key: string, text: string): Promise<boolean> {
  try {
    const { embedText } = await import("./embeddings");
    const vec = await embedText(text.slice(0, 4000));
    if (!vec) return false;
    const d = await vecConn();
    if (!d) return false;
    const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
    d.prepare("DELETE FROM kiki_recall WHERE key = ?").run(key);
    d.prepare("INSERT INTO kiki_recall(key, embedding) VALUES (?, ?)").run(key, buf);
    return true;
  } catch {
    return false;
  }
}

// ===== index แชท =====

/** index ข้อความเดียว (เรียกแบบ fire-and-forget หลังตอบ — ไม่ให้ถ่วงการตอบ) */
export async function indexChatMessage(id: string, role: string, content: string): Promise<boolean> {
  const body = (content || "").trim();
  if (body.length < 12) return false; // "ครับ" "โอเค" ไม่ต้องจำ
  return putVec(`${KEY_CHAT}${id}`, `${role === "assistant" ? "Vex" : "เจ้าของ"}: ${body}`);
}

/** backfill แชทเก่าที่ยังไม่เคย index (รันครั้งเดียวตอนติดตั้ง / ซ่อม) */
export async function reindexChats(limit = 4000): Promise<{ indexed: number; skipped: number }> {
  const d = await vecConn();
  if (!d) return { indexed: 0, skipped: 0 };
  const rows = await db.kikiChat.findMany({ where: { scope: "owner" }, orderBy: { createdAt: "desc" }, take: limit });
  const have = new Set<string>();
  try {
    for (const r of d.prepare("SELECT key FROM kiki_recall").all() as { key: string }[]) have.add(r.key);
  } catch { /* ตารางว่าง */ }
  const todo = rows.filter((r) => !have.has(`${KEY_CHAT}${r.id}`) && (r.content || "").trim().length >= 12);
  let indexed = 0;
  const { embedBatch } = await import("./embeddings");
  for (let i = 0; i < todo.length; i += 32) {
    const chunk = todo.slice(i, i + 32);
    const vecs = await embedBatch(chunk.map((r) => `${r.role === "assistant" ? "Vex" : "เจ้าของ"}: ${r.content.slice(0, 4000)}`));
    const ins = d.prepare("INSERT INTO kiki_recall(key, embedding) VALUES (?, ?)");
    const del = d.prepare("DELETE FROM kiki_recall WHERE key = ?");
    for (let k = 0; k < chunk.length; k++) {
      const v = vecs[k];
      if (!v) continue;
      try {
        const buf = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
        del.run(`${KEY_CHAT}${chunk[k].id}`);
        ins.run(`${KEY_CHAT}${chunk[k].id}`, buf);
        indexed++;
      } catch { /* ข้ามแถวเสีย */ }
    }
  }
  return { indexed, skipped: rows.length - indexed };
}

/** index รูป/วิดีโอที่เก็บเข้าคลัง (ค้นด้วยคำพูดธรรมดาทีหลัง) */
export async function indexMedia(id: string, text: string): Promise<boolean> {
  return putVec(`${KEY_MEDIA}${id}`, text);
}

/** ค้นสื่อในคลังด้วยความหมาย → คืน id เรียงตามความใกล้ */
export async function searchMedia(query: string, k = 6): Promise<string[]> {
  try {
    const { embedText } = await import("./embeddings");
    const vec = await embedText(query);
    if (!vec) return [];
    const d = await vecConn();
    if (!d) return [];
    const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
    const rows = d
      .prepare("SELECT key, distance FROM kiki_recall WHERE embedding MATCH ? ORDER BY distance LIMIT ?")
      .all(buf, k * 4) as { key: string; distance: number }[];
    return rows.filter((r) => r.key.startsWith(KEY_MEDIA) && r.distance < 0.8).slice(0, k).map((r) => r.key.slice(KEY_MEDIA.length));
  } catch {
    return [];
  }
}

// ===== ค้นความจำ =====

export interface RecallHit {
  when: Date;
  lines: string[];
  distance: number;
}

const thaiWhen = (d: Date) =>
  d.toLocaleDateString("th-TH-u-ca-gregory", { day: "numeric", month: "short", year: "2-digit" }) +
  " " +
  d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

/**
 * ค้นบทสนทนาเก่า/สรุปรายวันที่เกี่ยวกับคำถาม แล้วคืนเป็นช่วงบทสนทนา (มีข้อความข้างเคียงให้เห็นบริบท)
 * skipRecentMs: ข้ามช่วงที่อยู่ในหน้าต่างล่าสุดอยู่แล้ว (กันซ้ำซ้อนในโปรมป์)
 */
export async function recall(query: string, opts: { k?: number; skipRecentMs?: number } = {}): Promise<RecallHit[]> {
  const q = (query || "").trim();
  if (q.length < 4) return [];
  const k = opts.k ?? 6;
  const skipMs = opts.skipRecentMs ?? 3 * 3600_000;
  try {
    const { embedText } = await import("./embeddings");
    const vec = await embedText(q);
    if (!vec) return [];
    const d = await vecConn();
    if (!d) return [];
    const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
    const rows = d
      .prepare("SELECT key, distance FROM kiki_recall WHERE embedding MATCH ? ORDER BY distance LIMIT ?")
      .all(buf, k * 3) as { key: string; distance: number }[];
    const good = rows.filter((r) => r.distance < 0.78);
    if (!good.length) return [];

    const out: RecallHit[] = [];
    const usedWindows: number[] = [];
    const cutoff = Date.now() - skipMs;

    for (const r of good) {
      if (out.length >= k) break;
      if (r.key.startsWith(KEY_DAY)) {
        const day = r.key.slice(KEY_DAY.length);
        const mem = await db.kikiMemory.findFirst({ where: { kind: "daily", day, scope: "owner" } });
        if (mem) out.push({ when: new Date(`${day}T12:00:00`), lines: [`สรุปวันที่ ${day}: ${mem.content}`], distance: r.distance });
        continue;
      }
      if (!r.key.startsWith(KEY_CHAT)) continue;
      const id = r.key.slice(KEY_CHAT.length);
      const hit = await db.kikiChat.findUnique({ where: { id } });
      if (!hit) continue;
      const t = hit.createdAt.getTime();
      if (t > cutoff) continue; // อยู่ในหน้าต่างล่าสุดแล้ว
      if (usedWindows.some((u) => Math.abs(u - t) < 20 * 60_000)) continue; // ช่วงเดิม เอาครั้งเดียวพอ
      usedWindows.push(t);
      const around = await db.kikiChat.findMany({
        where: { scope: "owner", createdAt: { gte: new Date(t - 6 * 60_000), lte: new Date(t + 6 * 60_000) } },
        orderBy: { createdAt: "asc" },
        take: 10,
      });
      out.push({
        when: hit.createdAt,
        lines: around.map((a) => `${a.role === "assistant" ? "Vex" : "เจ้าของ"}: ${a.content.replace(/\s+/g, " ").slice(0, 600)}`),
        distance: r.distance,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** บล็อกความจำสำหรับยัดเข้าโปรมป์ (ว่าง = ไม่มีอะไรเกี่ยว) */
export async function recallContext(query: string, opts: { k?: number } = {}): Promise<string> {
  const hits = await recall(query, opts);
  if (!hits.length) return "";
  const blocks = hits.map((h) => `[${thaiWhen(h.when)}]\n${h.lines.join("\n")}`);
  return `=== ความจำ: บทสนทนาเก่าที่เกี่ยวกับเรื่องนี้ (ค้นจากคลังแชททั้งหมด — ใช้ตอบได้เลย อ้างวัน/เวลาได้ ห้ามบอกว่าจำไม่ได้) ===\n${blocks.join("\n\n").slice(0, 9000)}`;
}

// ===== สรุปรายวัน =====

const dayKey = (d: Date) => {
  const z = new Date(d.getTime() + 7 * 3600_000); // เวลาไทย
  return z.toISOString().slice(0, 10);
};

/** สรุปแชทของวันหนึ่งเก็บเป็นความจำ (cron เรียกกลางคืน) — มีอยู่แล้วไม่ทำซ้ำ */
export async function summarizeDay(date = new Date(), force = false): Promise<string | null> {
  const day = dayKey(date);
  const exist = await db.kikiMemory.findFirst({ where: { kind: "daily", day, scope: "owner" } });
  if (exist && !force) return exist.content;

  const start = new Date(`${day}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 86400_000);
  const rows = await db.kikiChat.findMany({
    where: { scope: "owner", createdAt: { gte: start, lt: end } },
    orderBy: { createdAt: "asc" },
    take: 400,
  });
  if (rows.length < 4) return null;

  const transcript = rows
    .map((r) => `${r.role === "assistant" ? "Vex" : "เจ้าของ"}: ${r.content.replace(/\s+/g, " ").slice(0, 700)}`)
    .join("\n")
    .slice(0, 40_000);

  const { askExtractor } = await import("./kiki");
  const summary = await askExtractor(
    `บทสนทนาระหว่างเจ้าของกับเลขา (Vex) ของวันที่ ${day}:\n\n${transcript}`,
    {
      system: `สรุปบทสนทนาของวันนี้เป็น "ความจำ" ให้เลขาเอาไว้ใช้ตอบย้อนหลัง เขียนภาษาไทยล้วน ไม่ต้องเกริ่น
เก็บให้ครบ: เรื่องที่คุยกัน · การตัดสินใจ · สิ่งที่เจ้าของสั่ง/อยากได้ · ตัวเลข ชื่อคน ชื่อของ วันเวลา ที่พูดถึง · เรื่องค้างที่ยังไม่จบ
เขียนเป็นบรรทัดสั้น ๆ ขึ้นต้นด้วย "- " ไม่เกิน 20 บรรทัด ห้ามแต่งเพิ่มจากที่ไม่มีในบทสนทนา`,
      timeoutMs: 120_000,
    },
  ).catch(() => "");

  const content = summary.trim();
  if (!content) return null;
  await db.kikiMemory.upsert({
    where: { kind_day_scope: { kind: "daily", day, scope: "owner" } },
    update: { content: content.slice(0, 8000) },
    create: { kind: "daily", day, scope: "owner", content: content.slice(0, 8000) },
  });
  await putVec(`${KEY_DAY}${day}`, `สรุปบทสนทนาวันที่ ${day}\n${content}`);
  return content;
}

/** สรุปวันล่าสุดที่ยังไม่ได้สรุป (วันนี้ + เมื่อวานเผื่อพลาด) */
export async function rollupRecentDays(): Promise<string[]> {
  const done: string[] = [];
  for (const offset of [1, 0]) {
    const d = new Date(Date.now() - offset * 86400_000);
    const day = dayKey(d);
    const exist = await db.kikiMemory.findFirst({ where: { kind: "daily", day, scope: "owner" } });
    if (exist) continue;
    const r = await summarizeDay(d).catch(() => null);
    if (r) done.push(day);
  }
  return done;
}

/** สรุปรายวันย้อนหลัง N วัน ใส่เป็นบริบท (ภาพรวมว่าช่วงนี้คุยอะไรกันบ้าง) */
export async function recentDaysContext(days = 3): Promise<string> {
  const keys: string[] = [];
  for (let i = 1; i <= days; i++) keys.push(dayKey(new Date(Date.now() - i * 86400_000)));
  const rows = await db.kikiMemory.findMany({ where: { kind: "daily", scope: "owner", day: { in: keys } }, orderBy: { day: "desc" } });
  if (!rows.length) return "";
  return `=== สรุปสิ่งที่คุยกันไม่กี่วันก่อน ===\n${rows.map((r) => `[${r.day}]\n${r.content}`).join("\n\n").slice(0, 6000)}`;
}
