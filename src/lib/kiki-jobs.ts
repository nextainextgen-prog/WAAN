import { db } from "./db";
import { askExtractor, getSetting, setSetting } from "./kiki";

/**
 * งานเบื้องหลังหลายเรื่องพร้อมกัน (สเปกข้อ 15 — 4 ส.ค. 2026)
 *
 * ปัญหาเดิม: งานจะไปเบื้องหลังเฉพาะตอนเข้าเจตนา hermes เท่านั้น
 * "หาที่พักเชียงใหม่ให้หน่อย" เข้า web_research แล้วนั่งรอตอบในคำขอนั้น = เจ้าของรู้สึกค้าง
 *
 * ที่เพิ่ม:
 *  ก) ตัดสินเองว่างานไหนควรไปเบื้องหลัง (ไม่ต้องพูดคำว่า "ฝากไว้")
 *  ข) ถามสถานะได้ ("ที่สั่งไปถึงไหนแล้ว")
 *  ค) กระดานเรื่องที่กำลังทำ ใช้ตีความคำพูดลอย ๆ ("อันนั้นเอาถูกที่สุดนะ")
 *  ฉ) คิวจำกัด 2 งานพร้อมกัน — สั่งรัว 10 เรื่องต้องไม่แยก 10 โปรเซส
 *  ช) แยกว่างานไหนฝาก Hermes ได้ (ห้ามแนบข้อมูลส่วนตัว) งานไหนต้องทำในตัว Vex เอง
 */

export const MAX_CONCURRENT = 2; // เกินนี้เข้าคิวรอ — สั่งรัว 10 เรื่องต้องไม่ทำให้เครื่องสะดุด

export type JobRunner = "hermes" | "vex";

export interface JobPlan {
  background: boolean; // ควรไปทำเบื้องหลังไหม
  runner: JobRunner;   // ฝาก Hermes ได้ไหม หรือต้องทำในตัว Vex (ต้องใช้ความจำ/การเงิน/นัด/คลัง)
  seconds: number;     // ประเมินเวลาที่ใช้
  topic: string;       // หัวเรื่องสั้น ๆ ไว้ทวนก่อนรายงานผล
  ack: string;         // ประโยคตอบรับทันที
  brief: string;       // โจทย์ที่สมบูรณ์ในตัว (รวมบริบทจากข้อความที่ reply ถึงแล้ว)
  reason: string;
}

const BG_THRESHOLD_SEC = 10; // เกินนี้ = ตอบรับก่อนแล้วไปทำเบื้องหลัง

/**
 * ประเมินว่างานนี้ควรไปเบื้องหลังไหม และฝาก Hermes ได้หรือเปล่า
 *
 * เรื่องความปลอดภัยที่ห้ามพลาด: Hermes ได้รับเฉพาะโจทย์ที่เจ้าของพิมพ์
 * งานที่ต้องใช้ความจำ / การเงิน / นัด / แชท / คลัง Obsidian = ห้ามฝาก ต้องทำในตัว Vex
 *
 * เพิ่ม 5 ส.ค. 2026 — `brief`: โจทย์ที่อ่านแล้วเข้าใจได้ด้วยตัวเอง
 *   เคสจริงที่พัง: เจ้าของ reply ผลงานเก่า ("หาตัวต่อจอ 2 จอ") แล้วพิมพ์ว่า "ไปหาใหม่หน่อย งบ 500"
 *   ตัวรับงานได้ไปแค่ประโยคหลัง เลยถามกลับว่า "หาอะไร" แล้วจบงานไปเฉย ๆ
 *   ตรงนี้จึงหลอมบริบทจากข้อความที่ reply ถึงเข้าไปในโจทย์ให้ครบก่อนส่งออก
 *   ยังคงกติกาเดิม: ห้ามให้ข้อมูลส่วนตัวหลุดออกไปกับโจทย์ (ระบุไว้ในคำสั่งด้านล่าง)
 */
export async function planJob(text: string, intent: string, replyText = ""): Promise<JobPlan> {
  const fallback: JobPlan = {
    background: false, runner: "vex", seconds: 5,
    topic: text.slice(0, 40), ack: "", brief: text, reason: "ประเมินไม่ได้",
  };
  // เจตนาที่รู้อยู่แล้วว่าเร็ว ไม่ต้องเสียเวลาถามโมเดล
  const FAST = ["chat", "task_list", "task_done", "memory_list", "rule_list", "calendar_view",
    "finance_query", "finance_itemize", "voice_mode", "voice_announce", "job_status"];
  if (FAST.includes(intent)) return fallback;

  try {
    const raw = await askExtractor(
      `คำสั่งของเจ้าของ: """${text.slice(0, 1200)}"""\n` +
        (replyText ? `ข้อความที่เจ้าของ reply ถึง (คือบริบทว่าเขาหมายถึงอะไร): """${replyText.slice(0, 1500)}"""\n` : "") +
        `เจตนาที่ระบบอ่านได้: ${intent}`,
      {
        system: `ประเมินงานที่เลขาส่วนตัวได้รับ ตอบ JSON เท่านั้น:
{"seconds":<ประเมินวินาทีที่ต้องใช้>,"needsPrivate":true/false,"topic":"หัวเรื่องสั้นมาก 2-5 คำ","ack":"ประโยคตอบรับสั้น ๆ ที่จะพูดทันทีก่อนไปทำ","brief":"โจทย์ฉบับสมบูรณ์"}

seconds: ค้นเว็บหลายที่/อ่านลิงก์ยาว/เปรียบเทียบสินค้า/ทำเอกสาร = 30-300 · ตอบจากที่รู้/ดูข้อมูลในระบบ = 2-8
needsPrivate: งานนี้ต้องใช้ข้อมูลส่วนตัวของเจ้าของไหม (ความจำ การเงิน นัดหมาย แชท คลังโน้ตส่วนตัว) — ถ้าต้องใช้ = true
ack: เขียนแบบเลขานิ่ง ๆ เช่น "รับทราบครับ กำลังหาให้" ห้ามยาว ห้ามถามกลับ
brief: เขียนโจทย์ใหม่ให้ "คนที่ไม่เคยเห็นแชทนี้เลย" อ่านแล้วลงมือทำได้ทันที
  - ถ้าเจ้าของ reply ถึงข้อความไหน ให้ดึงของ/เรื่องที่พูดถึงในนั้นมาระบุให้ชัดในโจทย์
    เช่น reply เรื่อง "ตัวต่อจอ 2 จอ" แล้วพิมพ์ว่า "หาใหม่ งบ 500" → brief = "หาตัวต่อจอ 2 จอ ราคาไม่เกิน 500 บาท พร้อมลิงก์ร้าน"
  - ใส่เงื่อนไข/งบ/จำนวนที่เจ้าของบอกให้ครบ
  - ห้ามใส่ข้อมูลส่วนตัว: ยอดเงินในบัญชี ชื่อคนใกล้ตัว ที่อยู่ เบอร์โทร ชื่อไฟล์ส่วนตัว
  - ไม่มีบริบทเพิ่มก็คัดลอกคำสั่งเดิมมาได้เลย`,
        timeoutMs: 45_000,
      },
    );
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}") as {
      seconds?: number; needsPrivate?: boolean; topic?: string; ack?: string; brief?: string;
    };
    const seconds = Number(j.seconds) || 5;
    return {
      background: seconds >= BG_THRESHOLD_SEC,
      runner: j.needsPrivate ? "vex" : "hermes",
      seconds,
      topic: (j.topic || text.slice(0, 40)).trim(),
      ack: (j.ack || "รับทราบครับ เดี๋ยวจัดให้").trim(),
      brief: (j.brief || text).trim() || text,
      reason: `~${seconds} วิ · ${j.needsPrivate ? "ใช้ข้อมูลส่วนตัว ทำเองในตัว" : "ฝากได้"}`,
    };
  } catch {
    return fallback;
  }
}

// ===== คิว: รันจริงพร้อมกันไม่เกิน MAX_CONCURRENT =====

export async function runningCount(): Promise<number> {
  return db.kikiHermesJob.count({
    where: { status: "running", canceled: false, startedAt: { gte: new Date(Date.now() - 60 * 60_000) } },
  });
}

export async function queuedCount(): Promise<number> {
  return db.kikiHermesJob.count({ where: { status: "pending" } });
}

/**
 * ปล่อยงานที่รออยู่ในคิวเท่าที่ช่องว่างเหลือ — cron เรียกทุกนาที
 * งานที่ยังไม่ถึงคิวจะอยู่สถานะ pending เฉย ๆ ไม่กินอะไรเลย
 */
export async function drainQueue(): Promise<number> {
  const free = MAX_CONCURRENT - (await runningCount());
  if (free <= 0) return 0;
  const waiting = await db.kikiHermesJob.findMany({
    where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: free,
  });
  let started = 0;
  for (const j of waiting) {
    const { startQueuedJob } = await import("./kiki-hermes");
    if (await startQueuedJob(j.id)) started++;
  }
  return started;
}

// ===== กระดานเรื่องที่กำลังคุย/กำลังทำ (focus stack) =====
//
// เจ้าของพูดลอย ๆ ว่า "อันนั้นเอาถูกที่สุดนะ" ต้องรู้ว่าหมายถึงงานไหน
// เดาไม่ออก = ถามกลับสั้น ๆ ห้ามเดาแล้วทำผิดตัว (สเปกข้อ 15ค)

const FOCUS_KEY = "vex_focus_stack";
const FOCUS_MAX = 5;

export interface FocusItem {
  kind: "job" | "message" | "topic";
  ref: string;    // jobId / peerName / อะไรก็ได้ที่ใช้อ้างกลับ
  label: string;  // อ่านรู้เรื่อง
  at: number;
}

export async function pushFocus(item: Omit<FocusItem, "at">): Promise<void> {
  const list = await getFocus();
  const next = [{ ...item, at: Date.now() }, ...list.filter((f) => f.ref !== item.ref)].slice(0, FOCUS_MAX);
  await setSetting(FOCUS_KEY, JSON.stringify(next));
}

export async function getFocus(): Promise<FocusItem[]> {
  try {
    const v = await getSetting(FOCUS_KEY);
    const list = v ? (JSON.parse(v) as FocusItem[]) : [];
    // เกิน 2 ชั่วโมงถือว่าไม่ใช่ "เรื่องที่กำลังคุย" แล้ว
    return list.filter((f) => Date.now() - f.at < 2 * 60 * 60_000);
  } catch {
    return [];
  }
}

export async function dropFocus(ref: string): Promise<void> {
  await setSetting(FOCUS_KEY, JSON.stringify((await getFocus()).filter((f) => f.ref !== ref)));
}

/** บริบทกระดานเรื่อง — ฉีดเข้า prompt ให้ Vex ตีความคำพูดลอย ๆ ได้ */
export async function focusContext(): Promise<string> {
  const list = await getFocus();
  if (!list.length) return "";
  return `=== เรื่องที่กำลังค้างอยู่ระหว่างเรา (ใหม่→เก่า) ===\n${
    list.map((f, i) => `${i + 1}. [${f.kind === "job" ? "งานที่กำลังทำ" : f.kind === "message" ? "ข้อความเข้า" : "เรื่อง"}] ${f.label}`).join("\n")
  }\nถ้าเจ้าของพูดลอย ๆ ว่า "อันนั้น/เรื่องนั้น/ตัวแรก" ให้เทียบกับรายการนี้ · เดาไม่ออกให้ถามกลับสั้น ๆ ห้ามเดาแล้วทำผิดตัว`;
}

// ===== รายงานสถานะงานที่ค้าง =====

export async function jobStatusReport(): Promise<string> {
  const rows = await db.kikiHermesJob.findMany({
    where: { status: { in: ["running", "pending"] }, canceled: false },
    orderBy: { createdAt: "asc" },
    take: 10,
  });
  if (!rows.length) return "";
  const now = Date.now();
  const lines = rows.map((r) => {
    const task = r.task.replace(/^\[พัฒนา\]\s*/, "").slice(0, 70);
    if (r.status === "pending") return `· ${task} — รอคิวอยู่`;
    const mins = Math.max(1, Math.round((now - (r.startedAt || r.createdAt).getTime()) / 60_000));
    const cap = r.task.startsWith("[พัฒนา]") ? 45 : 15;
    const left = Math.max(1, cap - mins);
    return `· ${task} — ทำมา ${mins} นาที น่าจะอีกราว ${left} นาที${r.progressText ? ` (ตอนนี้: ${r.progressText.slice(0, 60)})` : ""}`;
  });
  const running = rows.filter((r) => r.status === "running").length;
  const waiting = rows.length - running;
  return `กำลังทำอยู่ ${running} เรื่อง${waiting ? ` · รอคิวอีก ${waiting}` : ""}\n${lines.join("\n")}`;
}

/** เจ้าของถามย้ำว่า "เสร็จยัง" = ยกระดับเป็นด่วน พอเสร็จให้พูดได้ทันที (สเปกข้อ 15จ) */
export async function markUrgent(): Promise<void> {
  await setSetting("vex_jobs_urgent_until", String(Date.now() + 60 * 60_000));
}

export async function jobsAreUrgent(): Promise<boolean> {
  return Date.now() < Number((await getSetting("vex_jobs_urgent_until")) || 0);
}
