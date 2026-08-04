import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { speak } from "./tts";

/**
 * คลังเสียงสำเร็จรูป + เสียงไทยในเครื่อง (5 ส.ค. 2026)
 *
 * ปัญหาที่แก้ (เจ้าของเทสจริงแล้วบ่น): "เรียกกว่าจะตอบเป็นนาที ไม่รู้ว่าได้ยินมั้ย"
 * ต้นเหตุ: กว่าจะได้เสียงตอบต้องผ่าน ถอดเสียง → คิด → แปลงเป็นเสียง = 60-100 วิ
 *
 * ทางแก้สองชั้น:
 *   1. คลังเสียง — ประโยคที่ใช้ซ้ำ ๆ อัดเก็บไฟล์ไว้ครั้งเดียว เล่นทันที 0 วินาที 0 โควตา
 *   2. Kanya — เสียงไทยที่ติดมากับ macOS พูดข้อความอะไรก็ได้ในเครื่อง ~0.2 วิ ฟรี ไม่ง้อเน็ต
 *
 * ลำดับที่ใช้: คลังเสียง → Kanya → Gemini (เพราะกว่าจะถึง Gemini คือรอ 3-8 วิ)
 * เจ้าของเลือกเอง 5 ส.ค.: "Kanya เร็ว + Gemini ตอนสำคัญ"
 */

const BANK_DIR = path.join(process.cwd(), ".run-logs", "voice-bank");
const ENGINE_FILE = path.join(BANK_DIR, "_engine.json"); // ไฟล์ไหนอัดด้วยอะไร
const SAY_BIN = "/usr/bin/say";
const FFMPEG = existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";

/**
 * ประโยคในคลัง — แต่ละคีย์มีหลายแบบ สุ่มเลือกเพื่อไม่ให้ฟังเป็นบอท
 * (กติกาเจ้าของ: ห้ามฟิกคำ พูดซ้ำเดิมทุกครั้งฟังไม่ได้)
 */
export const BANK: Record<string, string[]> = {
  // ตอบรับตอนถูกเรียก — ต้องสั้นที่สุด เพราะเป้าหมายคือ "รู้ว่าได้ยิน" ไม่ใช่เนื้อหา
  here: ["ครับ", "ว่ามาเลยครับ", "อยู่ครับ", "ครับผม", "ว่าไงครับ"],
  // รับงานที่ต้องไปหาข้อมูล
  onit: ["รับทราบครับ เดี๋ยวไปหาให้", "ได้ครับ ขอเวลาแป๊บนึง", "จัดให้ครับ รอสักครู่", "โอเคครับ กำลังหาให้"],
  // รับงานที่ต้องคิดนาน
  thinking: ["ขอคิดแป๊บนึงครับ", "รอนิดนะครับ กำลังดูให้", "แป๊บครับ"],
  // ยังทำอยู่ (พูดระหว่างงานยาว)
  still: ["ยังหาอยู่นะครับ", "ยังทำอยู่ครับ ใกล้แล้ว", "อีกแป๊บเดียวครับ"],
  // ฟังไม่ออก
  pardon: ["ฟังไม่ทันครับ พูดอีกทีได้ไหม", "ขอโทษครับ ไม่ได้ยินชัด พูดใหม่อีกทีได้ไหม", "เมื่อกี้ไม่ชัดครับ ว่าใหม่อีกทีนะ"],
  // ระบบมีปัญหา
  broke: ["สมองค้างแป๊บครับ ลองใหม่อีกทีนะ", "ตอนนี้ระบบมีปัญหาครับ เดี๋ยวลองใหม่"],
  // ปิดสายสนทนา
  bye: ["ครับผม", "ได้ครับ", "โอเคครับ"],
  // รับคำสั่งที่ลงมือทันที
  done: ["เรียบร้อยครับ", "จัดให้แล้วครับ", "เสร็จแล้วครับ"],
};

function pick(key: string): string {
  const list = BANK[key];
  if (!list?.length) return "";
  return list[Math.floor(Math.random() * list.length)];
}

const bankFile = (key: string, i: number) => path.join(BANK_DIR, `${key}-${i}.ogg`);

/**
 * อัดคลังเสียงเก็บไว้ (รันครั้งเดียว หรือตอนเปลี่ยนเสียง)
 * ใช้ Gemini เพราะเป็นของที่ฟังบ่อยที่สุด ต้องเพราะ — อัดครั้งเดียวใช้ตลอด ไม่กินโควตาซ้ำ
 * โควตาหมดตอนอัด = ตกไปใช้ Kanya อัดแทน ดีกว่าไม่มีคลังเลย
 */
async function engineMap(): Promise<Record<string, string>> {
  try { return JSON.parse(await fs.readFile(ENGINE_FILE, "utf8")) as Record<string, string>; } catch { return {}; }
}

/**
 * อัดคลังเสียง — ใช้ Gemini (เสียงที่เจ้าของเลือก) เป็นหลักเสมอ
 *
 * โควตาหมดตอนอัด = ยอมใช้ Kanya ไปก่อน แต่ "จดไว้" ว่าอัดด้วยอะไร
 * แล้วอัดทับใหม่ด้วย Gemini อัตโนมัติทันทีที่โควตากลับมา
 * (เจ้าของสั่ง 5 ส.ค.: "ให้มันพูดเป็นเสียงเดิม ไม่เอาเสียงแบบนี้")
 */
export async function buildBank(force = false): Promise<{ made: number; skipped: number; upgraded: number; via: string }> {
  await fs.mkdir(BANK_DIR, { recursive: true });
  const eng = await engineMap();
  let made = 0, skipped = 0, upgraded = 0, via = "cache";
  let geminiDead = false;

  for (const [key, lines] of Object.entries(BANK)) {
    for (let i = 0; i < lines.length; i++) {
      const f = bankFile(key, i);
      const id = `${key}-${i}`;
      const have = existsSync(f);
      const isKanya = eng[id] !== "gemini"; // ไม่มีบันทึก = ไม่รู้ที่มา ถือว่าต้องอัปเกรด
      // มีแล้วและเป็นเสียงที่ต้องการ = ข้าม · เป็น Kanya = พยายามอัปเกรดเป็น Gemini
      if (!force && have && !isKanya) { skipped++; continue; }
      if (!force && have && isKanya && geminiDead) { skipped++; continue; }

      let buf: Buffer | null = null;
      if (!geminiDead) {
        buf = await speak(lines[i], { maxChars: 200 }).catch(() => null);
        if (buf) { eng[id] = "gemini"; via = "gemini"; if (have) upgraded++; else made++; }
        else geminiDead = true; // โควตาหมด/ล่ม — ไม่ต้องลองซ้ำทุกประโยคให้เสียเวลา
      }
      if (!buf && !have) {
        buf = await sayKanya(lines[i]);
        if (buf) { eng[id] = "kanya"; via = via === "gemini" ? "ผสม" : "kanya"; made++; }
      }
      if (buf) await fs.writeFile(f, buf);
    }
  }
  await fs.writeFile(ENGINE_FILE, JSON.stringify(eng, null, 2)).catch(() => {});
  return { made, skipped, upgraded, via };
}

/** ยังมีประโยคที่อัดด้วย Kanya ค้างอยู่ไหม (รอโควตา Gemini กลับมาแล้วอัปเกรด) */
export async function bankNeedsUpgrade(): Promise<number> {
  const eng = await engineMap();
  let n = 0;
  for (const [key, lines] of Object.entries(BANK)) {
    for (let i = 0; i < lines.length; i++) {
      if (existsSync(bankFile(key, i)) && eng[`${key}-${i}`] !== "gemini") n++;
    }
  }
  return n;
}

/** หยิบเสียงจากคลัง — คืน null ถ้ายังไม่ได้อัด (ผู้เรียกตกไป Kanya) */
export async function fromBank(key: string): Promise<{ ogg: Buffer; text: string } | null> {
  const list = BANK[key];
  if (!list?.length) return null;
  const order = list.map((_, i) => i).sort(() => Math.random() - 0.5);
  for (const i of order) {
    const f = bankFile(key, i);
    if (existsSync(f)) {
      try { return { ogg: await fs.readFile(f), text: list[i] }; } catch { /* ลองตัวถัดไป */ }
    }
  }
  return null;
}

/**
 * เสียงไทยของ macOS (Kanya) → OGG/Opus
 * ~0.2 วินาที ไม่ต้องต่อเน็ต ไม่มีโควตา — ทางถอยที่ทำให้ Vex ไม่มีวันใบ้
 */
export async function sayKanya(text: string, rate = 190): Promise<Buffer | null> {
  if (!existsSync(SAY_BIN)) return null;
  const clean = String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, " ")
    .replace(/[*_`#>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
  if (!clean) return null;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vex-kanya-"));
  const aiff = path.join(dir, "v.aiff");
  const ogg = path.join(dir, "v.ogg");
  try {
    await new Promise<void>((res, rej) =>
      execFile(SAY_BIN, ["-v", "Kanya", "-r", String(rate), "-o", aiff, clean], { timeout: 25_000 }, (e) => (e ? rej(e) : res())),
    );
    await new Promise<void>((res, rej) =>
      execFile(FFMPEG, ["-y", "-i", aiff, "-ac", "1", "-c:a", "libopus", "-b:a", "48k", ogg], { timeout: 25_000 }, (e) => (e ? rej(e) : res())),
    );
    return await fs.readFile(ogg);
  } catch {
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface Spoken {
  ogg: Buffer;
  text: string;
  via: "bank" | "kanya" | "gemini";
  ms: number;
}

/**
 * พูดอะไรก็ได้ให้เร็วที่สุดเท่าที่จะทำได้
 *
 * bankKey  — ถ้ามีในคลัง ใช้เลย 0 วินาที (และคืนข้อความจริงที่พูดออกไป ไว้กันเสียงย้อนเข้าไมค์)
 * text     — ข้อความอิสระ
 * quality  — true = ยอมรอ Gemini เพื่อเสียงที่เพราะกว่า (บรีฟเช้า/คำตอบยาว/เรื่องสำคัญ)
 */
export async function speakFast(opts: { bankKey?: string; text?: string; quality?: boolean }): Promise<Spoken | null> {
  const t0 = Date.now();
  if (opts.bankKey) {
    const b = await fromBank(opts.bankKey);
    if (b) return { ...b, via: "bank", ms: Date.now() - t0 };
    // ยังไม่มีในคลัง — ใช้ประโยคตัวอย่างของคีย์นั้นผ่าน Kanya
    const line = pick(opts.bankKey);
    if (line) {
      const k = await sayKanya(line);
      if (k) return { ogg: k, text: line, via: "kanya", ms: Date.now() - t0 };
    }
  }
  const text = (opts.text || "").trim();
  if (!text) return null;

  // Gemini (เสียง Iapetus ที่เจ้าของเลือก) เป็นหลักเสมอ — Kanya เหลือเป็นทางถอยตอนโควตาหมด/เน็ตล่ม
  // เจ้าของสั่ง 5 ส.ค.: "ให้มันพูดเป็นเสียงเดิม ไม่เอาเสียงแบบนี้"
  const g = await speak(text).catch(() => null);
  if (g) return { ogg: g, text, via: "gemini", ms: Date.now() - t0 };
  const k = await sayKanya(text);
  return k ? { ogg: k, text, via: "kanya", ms: Date.now() - t0 } : null;
}
