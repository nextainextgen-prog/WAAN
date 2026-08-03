// ===== Thunder — คลังเวกเตอร์ (sqlite-vec) =====
// อยู่คนละไฟล์กับ changoh.db โดยตั้งใจ: virtual table ของ sqlite-vec ทำให้ prisma db push พัง
// (Prisma อ่าน schema ทั้ง DB แต่โหลด extension ไม่ได้) → แยกไฟล์ = ไม่ชนกันตลอดไป
// ใช้ TEXT primary key = ThunderKnowledge.id ตรง ๆ ไม่ต้อง map rowid
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { EMBED_DIM } from "@/lib/embeddings";

let _db: Database.Database | null = null;

function conn(): Database.Database {
  if (_db) return _db;
  const dbPath = process.env.THUNDER_VEC_PATH || path.join(process.cwd(), "prisma", "thunder-vec.db");
  const db = new Database(dbPath);
  db.pragma("busy_timeout = 5000");
  try { db.pragma("journal_mode = WAL"); } catch { /* ข้ามได้ */ }
  sqliteVec.load(db);
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(knowledge_id TEXT PRIMARY KEY, embedding float[${EMBED_DIM}] distance_metric=cosine)`);
  _db = db;
  return db;
}

// เก็บ/อัปเดตเวกเตอร์ของความรู้ 1 แถว
export function upsertKnowledgeVector(id: string, embedding: Float32Array): boolean {
  try {
    const db = conn();
    const buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM knowledge_vec WHERE knowledge_id = ?").run(id);
      db.prepare("INSERT INTO knowledge_vec(knowledge_id, embedding) VALUES (?, ?)").run(id, buf);
    });
    tx();
    return true;
  } catch {
    return false;
  }
}

export function deleteKnowledgeVector(id: string): void {
  try { conn().prepare("DELETE FROM knowledge_vec WHERE knowledge_id = ?").run(id); } catch { /* ข้าม */ }
}

export interface VecHit { id: string; distance: number }

// ค้นเพื่อนบ้านใกล้สุด k อันดับ — คืนแค่ id + ระยะ (ผู้เรียกไป join ThunderKnowledge เองผ่าน Prisma)
export function searchVectors(embedding: Float32Array, k = 5): VecHit[] {
  try {
    const db = conn();
    const buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    const rows = db
      .prepare("SELECT knowledge_id, distance FROM knowledge_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?")
      .all(buf, k) as { knowledge_id: string; distance: number }[];
    return rows.map((r) => ({ id: r.knowledge_id, distance: r.distance }));
  } catch {
    return [];
  }
}

export function vectorCount(): number {
  try { return (conn().prepare("SELECT COUNT(*) AS c FROM knowledge_vec").get() as { c: number }).c; } catch { return 0; }
}

export function closeVector(): void {
  if (_db) { _db.close(); _db = null; }
}
