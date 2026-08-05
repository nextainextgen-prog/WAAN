import { db } from "./db";
import { getSetting, setSetting, askKiki } from "./kiki";

/**
 * ชั้นเลือกปลายทางแจ้งเตือน (สเปกข้อ 4.4 — เฟส 2, 4 ส.ค. 2026)
 *
 * ปัญหา: cron 18 งานของ Vex ยิงเข้า Telegram หมด ถ้าไม่ทำอะไร Discord จะเงียบสนิท
 * แต่ "เจ้าของอยู่ในสายเสียงไหม" มีแต่ท่อ Discord ที่รู้ (คนละโปรเซสกับเว็บ)
 *
 * ทางออก: เว็บหย่อนงานไว้ในกล่อง VexOutbox แล้วท่อ Discord มาหยิบไปส่งเอง
 *
 * กติกาที่ห้ามละเมิด (เจ้าของสั่ง):
 *  - ค่าเริ่มต้นของทุกอย่างที่เป็นเชิงรุก = ปิด ให้สั่งเปิดด้วยปากทีละกฎ
 *  - Telegram ต้องได้รับเหมือนเดิมเสมอ ไม่ว่าอะไรจะเกิดขึ้น (กันพลาดเรื่องสำคัญตอนระบบยังไม่นิ่ง)
 *  - ห้ามพูดใส่ห้องเปล่า — ไม่อยู่ในสาย = ค้างไว้ในกล่อง รอเล่าตอนกลับมา
 */

// เจ้าของอยู่ในห้องเสียงไหม — ท่อ Discord รายงานเข้ามา ไม่ใช่เว็บเดาเอง
const PRESENCE_KEY = "vex_voice_presence"; // JSON: { inVoice: boolean, at: number }
const PRESENCE_STALE_MS = 3 * 60_000; // ไม่มีรายงานเกิน 3 นาที = ถือว่าไม่อยู่ (ท่ออาจตายไปแล้ว)

// สวิตช์เชิงรุก — ปิดไว้ก่อนตามกติกา เปิดด้วยการสั่งเท่านั้น
export const ANNOUNCE_KEY = "vex_voice_announce";

export async function setVoicePresence(inVoice: boolean): Promise<void> {
  await setSetting(PRESENCE_KEY, JSON.stringify({ inVoice, at: Date.now() }));
}

export async function ownerInVoice(): Promise<boolean> {
  try {
    const raw = await getSetting(PRESENCE_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw) as { inVoice?: boolean; at?: number };
    if (!p.inVoice) return false;
    // รายงานเก่าเกินไป = ท่อน่าจะตาย ถือว่าไม่อยู่ ดีกว่าพูดใส่ห้องเปล่า
    return Date.now() - (p.at || 0) < PRESENCE_STALE_MS;
  } catch {
    return false;
  }
}

export async function announceEnabled(): Promise<boolean> {
  return (await getSetting(ANNOUNCE_KEY)) === "1";
}

export interface QueueItem {
  target: "discord-text" | "discord-voice" | "discord-watch" | "discord-log";
  topic?: string;
  text?: string;
  payload?: unknown; // Send ตัวเต็ม (รูป/ไฟล์/ปุ่ม)
  priority?: number;
}

export async function queueOut(item: QueueItem): Promise<string | null> {
  if (!item.text && !item.payload) return null;
  const row = await db.vexOutbox.create({
    data: {
      target: item.target,
      topic: item.topic?.slice(0, 200) || null,
      text: item.text?.slice(0, 8000) || null,
      payload: item.payload ? JSON.stringify(item.payload).slice(0, 2_000_000) : null,
      priority: item.priority ?? 0,
    },
  });
  return row.id;
}

/**
 * ตัดสินว่างานเชิงรุกชิ้นนี้ควรไปทางไหนบ้าง แล้วหย่อนลงกล่อง
 * Telegram ไม่เกี่ยวกับฟังก์ชันนี้ — ฝั่งนั้น cron ส่งเองเหมือนเดิมทุกอย่าง
 */
export async function routeProactive(opts: {
  topic: string;      // หัวเรื่อง เอาไว้ทวนก่อนพูด
  text: string;       // เนื้อความเต็ม (ตัวเดียวกับที่ส่งเข้า Telegram)
  speakable?: boolean; // เหมาะจะอ่านออกเสียงไหม (การ์ด/ไฟล์/ลิสต์ยาว = ไม่เหมาะ)
  priority?: number;
}): Promise<{ voice: boolean; text: boolean }> {
  const on = await announceEnabled();
  if (!on) return { voice: false, text: false }; // ปิดอยู่ = ไม่แตะ Discord เลย
  const inVoice = await ownerInVoice();
  const out = { voice: false, text: false };

  // เนื้อความเต็มลงห้อง text เสมอเมื่อเปิดโหมดประกาศ — จอดับตอนพูด ต้องมีที่ย้อนดูทีหลัง
  await queueOut({ target: "discord-text", topic: opts.topic, text: opts.text, priority: opts.priority });
  out.text = true;

  // เสียงเฉพาะตอนอยู่ในสายจริง ๆ · ไม่อยู่ = ไม่ต้องเข้าคิวเสียง (ข้อความในห้อง text พอแล้ว
  // ไม่งั้นกลับเข้าห้องมาแล้วโดนถล่มด้วยเสียงย้อนหลังทั้งวัน)
  if (inVoice && opts.speakable !== false) {
    await queueOut({ target: "discord-voice", topic: opts.topic, text: opts.text, priority: opts.priority });
    out.voice = true;
  }
  return out;
}

/**
 * งานที่รอส่ง — ท่อ Discord มาหยิบ
 *
 * ลองใหม่แบบถอยห่างขึ้นเรื่อย ๆ แทนการเลิกถาวรที่ 3 ครั้ง
 * เคสจริง 5 ส.ค.: เน็ตหลุดตอนตี 0 (getaddrinfo ENOTFOUND) → ลองครบ 3 → ค้างในกล่องตลอดกาล
 * ทั้งที่พอเน็ตกลับมาก็ส่งได้ปกติ · ของเก่าเกิน 12 ชม. ค่อยเลิก (ไม่มีประโยชน์แล้ว)
 */
const RETRY_BACKOFF_MS = [0, 30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];
const GIVE_UP_MS = 12 * 60 * 60_000;

// เสียงที่ค้างนานเกินไปไม่ควรพูดย้อนหลัง — เข้าห้องเสียงตอนบ่ายแล้วโดนถล่มด้วยเรื่องเมื่อเช้า
// ข้อความเต็มอยู่ในห้องแชทอยู่แล้ว ย้อนดูได้ตลอด
const VOICE_STALE_MS = 30 * 60_000;

export async function pendingOut(target: string, limit = 5) {
  const floor = target === "discord-voice" ? VOICE_STALE_MS : GIVE_UP_MS;
  const rows = await db.vexOutbox.findMany({
    where: { target, sentAt: null, createdAt: { gt: new Date(Date.now() - floor) } },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: limit * 3,
  });
  const now = Date.now();
  return rows
    .filter((r) => {
      if (!r.tries) return true;
      const wait = RETRY_BACKOFF_MS[Math.min(r.tries, RETRY_BACKOFF_MS.length - 1)];
      return now - r.createdAt.getTime() >= wait;
    })
    .slice(0, limit);
}


export async function markSent(id: string, error?: string): Promise<void> {
  await db.vexOutbox
    .update({
      where: { id },
      data: error ? { tries: { increment: 1 }, error: error.slice(0, 300) } : { sentAt: new Date() },
    })
    .catch(() => {});
}

/**
 * ย่อข้อความให้ "พูดออกเสียงแล้วฟังรู้เรื่อง"
 * เจ้าของสั่ง: ตอบด้วยเสียง 1-2 ประโยค · ห้ามอ่านลิสต์ออกเสียง ให้สรุปเป็นประโยคแทน
 * และต้องทวนหัวเรื่องก่อนเสมอถ้าไม่ได้ตอบสิ่งที่เพิ่งพูดจบ (สเปกข้อ 15ง — จอดับ มองไม่เห็น reply)
 */
export async function toSpeech(topic: string, text: string): Promise<string> {
  const flat = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  try {
    const said = await askKiki(
      `[แปลงเป็นคำพูด] เรื่อง: ${topic}\n\nเนื้อความที่จะสื่อ:\n"""${flat.slice(0, 4000)}"""\n\n` +
        `เขียนสิ่งที่จะ "พูดออกเสียง" ให้เจ้าของฟัง โดย:\n` +
        `- ขึ้นต้นด้วยการทวนหัวเรื่องสั้น ๆ ว่ากำลังพูดเรื่องอะไร (เขาจอดับอยู่ มองไม่เห็นว่าตอบเรื่องไหน)\n` +
        `- 1-2 ประโยค ห้ามอ่านเป็นลิสต์ ห้ามอ่านตัวเลขทุกตัว เอาเฉพาะที่สำคัญที่สุด\n` +
        `- ถ้ามีรายละเอียดเยอะ ให้บอกว่า "ที่เหลืออยู่ในห้องแชท"\n` +
        `- ภาษาพูดล้วน ไม่มีมาร์กอัป ไม่มีอิโมจิ ไม่มีหัวข้อ\n` +
        `ตอบเฉพาะข้อความที่จะพูดเท่านั้น`,
    );
    const t = said.replace(/<[^>]+>/g, " ").replace(/[*_`#>|]/g, " ").replace(/\s+/g, " ").trim();
    if (t) return t.slice(0, 600);
  } catch {
    /* ย่อไม่ได้ก็ใช้ทางสำรองข้างล่าง */
  }
  // ทางสำรอง: ตัดเอาสองประโยคแรก + ทวนหัวเรื่อง (ต้องไม่มีทางเงียบ)
  return `เรื่อง${topic}ครับ ${flat.split(/[.!?\n]|(?<=ครับ)/).slice(0, 2).join(" ").trim()}`.slice(0, 600);
}
