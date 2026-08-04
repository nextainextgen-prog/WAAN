import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { getSetting } from "./kiki";

/**
 * ชั้นเสียงพูดของ Vex — ถอดเปลี่ยนผู้ให้บริการได้ด้วยค่าตั้งค่า
 *
 * ทำไมต้องมีชั้นนี้: เจ้าของสั่งไว้ว่า "ไม่ว่าเลือกเจ้าไหน ให้ทำชั้น TTS เป็นผู้ให้บริการที่ถอดเปลี่ยนได้
 * เพราะจะมีการเปลี่ยนอีกแน่นอน" — ตอนนี้มีแต่ key ของ Gemini เจ้าอื่นรอเจ้าของสมัคร
 *
 * สัญญาเดียวของทั้งระบบ: speak(text) → Buffer ของ OGG/Opus 48k
 *   เลือกฟอร์แมตนี้เพราะกินได้ทั้งสองปลายทางโดยไม่ต้องแปลงซ้ำ
 *   - Telegram sendVoice กินตรง ๆ
 *   - @discordjs/voice กินตรง ๆ (เฟส 2)
 *   เจ้าไหนคืน mp3/wav ให้ provider ตัวนั้นแปลงเองด้วย ffmpeg ก่อนคืนออกมา
 *
 * ค่าตั้งค่า (ตาราง Setting — เปลี่ยนได้ผ่านแชท ไม่ต้องแก้โค้ด/รีสตาร์ท):
 *   kiki_tts_provider  gemini (ดีฟอลต์)
 *   kiki_tts_model     gemini-2.5-flash-preview-tts (ดีฟอลต์) | gemini-3.1-flash-tts-preview | gemini-2.5-pro-preview-tts
 *   kiki_tts_voice     Iapetus (เจ้าของเลือกเอง 4 ส.ค. 2026 จากการฟังเทียบ 30 เสียง)
 */

// เสียงทั้งหมดที่มี — ตรงตามเอกสารทางการ ai.google.dev/gemini-api/docs/speech-generation
export const GEMINI_VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
  "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi",
  "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird",
  "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
] as const;

export const DEFAULT_VOICE = "Iapetus";
export const DEFAULT_GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";

/**
 * ลำดับโมเดล TTS ที่จะไล่ลองเมื่อตัวก่อนหน้าตันโควตา
 *
 * โควตาของ Gemini เป็น "จำนวนคำขอต่อวันต่อโมเดล" (Tier 1 = 100/วัน) ไม่ใช่เรื่องยอดเงิน
 * แต่ละโมเดลนับแยกกัน → สลับตัวได้เมื่อตัวหนึ่งตัน (เจอจริง 5 ส.ค.: 2.5 ตันแต่ 3.1 ยังว่าง)
 * เสียงยังเป็นตัวเดิม (Iapetus) ทุกโมเดล เจ้าของจึงไม่ได้ยินความต่าง
 */
const TTS_MODEL_CHAIN = [
  "gemini-2.5-flash-preview-tts",
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-pro-preview-tts",
] as const;

export interface SpeakOptions {
  voice?: string;      // ทับเสียงที่ตั้งไว้ (ใช้ตอนให้ลองฟังเสียงใหม่)
  maxChars?: number;   // ตัดข้อความก่อนอ่าน (ดีฟอลต์ 900 — เท่าของเดิม)
  provider?: string;   // ทับผู้ให้บริการ
  model?: string;      // ทับโมเดล
}

function ffmpegBin(): string {
  return existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";
}

/** PCM ดิบ (s16le) → OGG/Opus — ปลายทางทุกเจ้าต้องผ่านตรงนี้เพื่อให้ได้ฟอร์แมตเดียวกัน */
async function pcmToOgg(pcm: Buffer, sampleRate = 24000): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vex-tts-"));
  const raw = path.join(dir, "v.pcm");
  const ogg = path.join(dir, "v.ogg");
  await fs.writeFile(raw, pcm);
  await new Promise<void>((resolve, reject) => {
    execFile(
      ffmpegBin(),
      ["-y", "-f", "s16le", "-ar", String(sampleRate), "-ac", "1", "-i", raw, "-c:a", "libopus", "-b:a", "48k", ogg],
      { timeout: 30_000 },
      (err) => (err ? reject(err) : resolve()),
    );
  });
  const out = await fs.readFile(ogg);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  return out;
}

// ===== แคชเสียงตามเนื้อความ =====
//
// โควตา 100 คำขอ/วัน/โมเดล ถือว่าน้อยมากสำหรับผู้ช่วยที่เปิดทั้งวัน
// ประโยคที่พูดซ้ำ ("วันนี้ว่างครับ" · "เรียบร้อยครับ") ไม่ควรเปลืองโควตารอบสอง
const CACHE_DIR = path.join(process.cwd(), ".run-logs", "tts-cache");

async function cacheKey(text: string, voice: string, model: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha1").update(`${model}|${voice}|${text}`).digest("hex").slice(0, 20);
}

async function fromCache(k: string): Promise<Buffer | null> {
  try { return await fs.readFile(path.join(CACHE_DIR, `${k}.ogg`)); } catch { return null; }
}

async function toCache(k: string, buf: Buffer): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(path.join(CACHE_DIR, `${k}.ogg`), buf);
  } catch { /* แคชไม่ได้ก็ไม่เป็นไร */ }
}

/** นับคำขอที่ยิงไปวันนี้ต่อโมเดล — ไว้โชว์ในการ์ดและกันชนเพดานแบบไม่รู้ตัว */
async function noteRequest(model: string): Promise<void> {
  try {
    const { setSetting } = await import("./kiki");
    const today = new Date().toISOString().slice(0, 10);
    const raw = (await getSetting("vex_tts_calls")) || "{}";
    const m = JSON.parse(raw) as Record<string, Record<string, number>>;
    if (!m[today]) Object.keys(m).forEach((d) => delete m[d]); // เก็บเฉพาะวันนี้
    m[today] = m[today] || {};
    m[today][model] = (m[today][model] || 0) + 1;
    await setSetting("vex_tts_calls", JSON.stringify(m));
  } catch { /* นับไม่ได้ก็ข้าม */ }
}

export async function ttsCallsToday(): Promise<Record<string, number>> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const m = JSON.parse((await getSetting("vex_tts_calls")) || "{}") as Record<string, Record<string, number>>;
    return m[today] || {};
  } catch {
    return {};
  }
}

/** ตัดอิโมจิ/มาร์กอัปก่อนอ่านออกเสียง — ไม่งั้น TTS อ่าน "เครื่องหมายเตือน" ออกมาด้วย */
export function cleanForSpeech(text: string): string {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, " ")
    .replace(/[*_`#>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ===== ผู้ให้บริการ =====

type Provider = (text: string, voice: string, model: string) => Promise<Buffer | null>;

const callGemini = async (text: string, voice: string, model: string): Promise<Buffer | null> => {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const j = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
    error?: { message?: string };
  };
  const b64 = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!b64) {
    // โดนจำกัดโควตา = จดไว้ให้การ์ดมอนิเตอร์กับห้องเฝ้าระวังรู้ (เจอจริง 4 ส.ค. แล้วเงียบหายไปเฉย ๆ)
    if (res.status === 429 || /quota|rate/i.test(j.error?.message || "")) {
      void import("./kiki-monitor").then(async (m) => {
        if (await m.noteQuotaHit("เสียงพูด")) {
          await m.raiseAlert("quota-tts", "warn", "โควตาเสียงพูด Gemini หมด — สลับไปใช้ Kanya ในเครื่องอัตโนมัติ (รีเซ็ตพรุ่งนี้)");
        }
      }).catch(() => {});
    }
    return null; // รวมกรณี error ของโมเดล เช่น "Model tried to generate text" (เจอจริงตอนเทียบเสียง)
  }
  await noteRequest(model);
  return pcmToOgg(Buffer.from(b64, "base64"), 24000);
};

/**
 * ไล่ลองโมเดลตามลำดับจนกว่าจะได้เสียง + แคชผลไว้ใช้ซ้ำ
 * เสียงเป็นตัวเดียวกันทุกโมเดล เจ้าของจึงไม่ได้ยินความต่างเวลาสลับ
 */
const geminiProvider: Provider = async (text, voice, model) => {
  // เริ่มจากโมเดลที่ตั้งไว้ แล้วค่อยไล่ตัวที่เหลือในสาย
  const chain = [model, ...TTS_MODEL_CHAIN.filter((m) => m !== model)];
  for (const m of chain) {
    const k = await cacheKey(text, voice, m);
    const hit = await fromCache(k);
    if (hit) return hit;
  }
  for (const m of chain) {
    const buf = await callGemini(text, voice, m).catch(() => null);
    if (buf) {
      await toCache(await cacheKey(text, voice, m), buf);
      return buf;
    }
  }
  return null;
};

const PROVIDERS: Record<string, Provider> = {
  gemini: geminiProvider,
  // เพิ่มเจ้าใหม่ที่นี่ที่เดียว — ต้องคืน OGG/Opus เสมอ (แปลงเองถ้าเจ้านั้นคืนฟอร์แมตอื่น)
};

export function availableProviders(): string[] {
  return Object.keys(PROVIDERS);
}

/**
 * พูดข้อความออกมาเป็นไฟล์เสียง — พังคืน null เสมอ (ผู้เรียกตกกลับไปส่งข้อความแทน ไม่มีทางเงียบ)
 */
export async function speak(text: string, opts: SpeakOptions = {}): Promise<Buffer | null> {
  try {
    const clean = cleanForSpeech(text).slice(0, opts.maxChars ?? 900);
    if (!clean) return null;
    const providerName = opts.provider || (await getSetting("kiki_tts_provider")) || "gemini";
    const provider = PROVIDERS[providerName] || geminiProvider;
    const voice = opts.voice || (await getSetting("kiki_tts_voice")) || DEFAULT_VOICE;
    const model = opts.model || (await getSetting("kiki_tts_model")) || DEFAULT_GEMINI_TTS_MODEL;
    return await provider(clean, voice, model);
  } catch {
    return null;
  }
}
