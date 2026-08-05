import { db } from "./db";

/**
 * นับโทเค็นที่ใช้กับ Gemini — ของที่ Claude/Codex มีให้ฟรีแต่ Gemini ไม่มี
 *
 * ทำไมต้องมี:
 *   Claude กับ Codex เป็น CLI ในเครื่อง เขียนไฟล์ .jsonl ทิ้งไว้ → อ่านย้อนหลังได้ตลอด
 *   Gemini เป็น API บนคลาวด์ ไม่ทิ้งร่องรอยอะไรในเครื่องเลย → ไม่จดตอนเรียก = ข้อมูลหายถาวร
 *   และ Gemini คิดเงินจริงตามโทเค็น (ต่างจากอีกสองตัวที่เป็นค่าสมาชิกรายเดือน)
 *
 * วิธีใช้ — เปลี่ยนแค่คำเดียวที่จุดเรียก:
 *   ก่อน:  const res = await fetch(url, { method: "POST", ... });
 *   หลัง:  const res = await geminiFetch(url, { method: "POST", ... }, "say");
 *
 * คืน Response หน้าตาเดิมเป๊ะ — โค้ดหลังจากนั้น (await res.json()) ไม่ต้องแก้อะไรเลย
 *
 * เก็บที่ไหน: Setting key `gemini_usage` (JSON) — เจตนาไม่แตะ prisma/schema.prisma
 * เพื่อไม่ให้ชนกับงานที่ห้องอื่นทำอยู่ และไม่ต้อง db:push + restart
 */

const KEY = "gemini_usage";
const KEEP_DAYS = 60; // เก็บย้อนหลังกี่วัน (เกินนี้ตัดทิ้งตอน flush)
const FLUSH_MS = 10_000; // รวมยอดในหน่วยความจำก่อน แล้วค่อยเขียนทีเดียว (กันเขียน DB ถี่ในเส้นทางร้อน)
const TZ = 7 * 3600_000; // Asia/Bangkok

export interface DayBucket {
  models: Record<string, { calls: number; in: number; out: number; total: number }>;
  tags: Record<string, { calls: number; total: number }>;
  errors: number;
  lastAt: number;
}
export type UsageStore = Record<string, DayBucket>; // "YYYY-MM-DD" → ยอดของวันนั้น

const emptyDay = (): DayBucket => ({ models: {}, tags: {}, errors: 0, lastAt: 0 });
const today = () => new Date(Date.now() + TZ).toISOString().slice(0, 10);

// ───────── บัฟเฟอร์ในหน่วยความจำ ─────────
let pending: UsageStore = {};
let timer: NodeJS.Timeout | null = null;

function bump(day: string, model: string, tag: string, tin: number, tout: number, total: number, isErr: boolean) {
  const d = (pending[day] ||= emptyDay());
  const m = (d.models[model] ||= { calls: 0, in: 0, out: 0, total: 0 });
  m.calls++; m.in += tin; m.out += tout; m.total += total;
  const t = (d.tags[tag] ||= { calls: 0, total: 0 });
  t.calls++; t.total += total;
  if (isErr) d.errors++;
  d.lastAt = Date.now();

  if (!timer) {
    timer = setTimeout(() => { timer = null; void flush(); }, FLUSH_MS);
    timer.unref?.(); // อย่าให้ตัวจับเวลาค้างไม่ให้โปรเซสจบ
  }
}

/** รวมยอดในบัฟเฟอร์เข้ากับที่เก็บไว้ใน DB — บวกส่วนต่าง ไม่ทับทั้งก้อน (กันสองโปรเซสเขียนชนกัน) */
export async function flush(): Promise<void> {
  const delta = pending;
  pending = {};
  if (!Object.keys(delta).length) return;
  try {
    const cur = await read();
    for (const [day, d] of Object.entries(delta)) {
      const t = (cur[day] ||= emptyDay());
      for (const [k, v] of Object.entries(d.models)) {
        const m = (t.models[k] ||= { calls: 0, in: 0, out: 0, total: 0 });
        m.calls += v.calls; m.in += v.in; m.out += v.out; m.total += v.total;
      }
      for (const [k, v] of Object.entries(d.tags)) {
        const g = (t.tags[k] ||= { calls: 0, total: 0 });
        g.calls += v.calls; g.total += v.total;
      }
      t.errors += d.errors;
      t.lastAt = Math.max(t.lastAt, d.lastAt);
    }
    // ตัดวันเก่าทิ้ง ไม่ให้ค่าบวมไม่จำกัด
    const cutoff = new Date(Date.now() + TZ - KEEP_DAYS * 86400_000).toISOString().slice(0, 10);
    for (const day of Object.keys(cur)) if (day < cutoff) delete cur[day];

    await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(cur) }, update: { value: JSON.stringify(cur) } });
  } catch {
    // เขียนไม่ได้ = ยอมทิ้งรอบนี้ ห้ามให้การนับโทเค็นทำงานหลักพัง
  }
}

export async function read(): Promise<UsageStore> {
  try {
    const r = await db.setting.findUnique({ where: { key: KEY } });
    return r?.value ? (JSON.parse(r.value) as UsageStore) : {};
  } catch {
    return {};
  }
}

// ───────── ตัวห่อ fetch ─────────

/** ดึงชื่อรุ่นจาก URL ของ Gemini (…/models/<ชื่อรุ่น>:generateContent) */
export function modelFromUrl(url: string): string {
  return url.match(/\/models\/([^:?]+)/)?.[1] || "unknown";
}

/**
 * เรียก Gemini แล้วจดโทเค็นให้อัตโนมัติ
 * @param tag ป้ายว่าเรียกจากงานอะไร — ใช้ตอบคำถาม "โทเค็นหมดไปกับอะไร"
 *            เช่น say · router · listen · tts · transcribe · research · youtube · extract · image
 */
export async function geminiFetch(url: string, init: RequestInit, tag = "อื่นๆ"): Promise<Response> {
  const model = modelFromUrl(url);
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    bump(today(), model, tag, 0, 0, 0, true);
    throw e;
  }

  // อ่าน body ครั้งเดียวแล้วประกอบ Response ใหม่ ให้ผู้เรียกยัง .json() ได้ตามปกติ
  const raw = await res.text();
  try {
    const j = JSON.parse(raw) as {
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
      error?: unknown;
    };
    const u = j.usageMetadata;
    bump(
      today(), model, tag,
      u?.promptTokenCount || 0,
      u?.candidatesTokenCount || 0,
      u?.totalTokenCount || (u?.promptTokenCount || 0) + (u?.candidatesTokenCount || 0),
      Boolean(j.error) || !res.ok,
    );
  } catch {
    bump(today(), model, tag, 0, 0, 0, !res.ok);
  }

  return new Response(raw, { status: res.status, statusText: res.statusText, headers: res.headers });
}
