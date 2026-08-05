import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { getSetting } from "./kiki";
import { geminiFetch } from "./gemini-usage";

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
  const res = await geminiFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
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
  }, "tts");
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

/**
 * ===== OpenAI =====
 *
 * เจ้าของเลือกเอง 5 ส.ค. 2026 หลังฟัง F5-TTS ในเครื่องแล้วไม่ผ่าน ("เสียงแตก/เพี้ยน")
 *
 * ใช้ `gpt-4o-mini-tts` ไม่ใช่ `tts-1` ที่เจ้าของเอ่ยถึงตอนแรก เพราะตัวนี้ตัวเดียว
 * ที่ "สั่งสไตล์การพูดด้วยข้อความ" ได้ (พารามิเตอร์ instructions) — ซึ่งจำเป็นมากในเคสนี้
 * เพราะเจ้าของอยากได้จังหวะแบบคลิปต้นแบบ ไม่ใช่แค่เสียงอ่านเฉย ๆ
 * `tts-1` อ่านอย่างเดียว ปรับโทนไม่ได้เลย
 *
 * ข้อควรรู้จากเอกสารทางการ: "Voices are currently optimized for English"
 * เสียงทั้ง 13 ตัวปรับมาเพื่ออังกฤษ ภาษาไทยรองรับแต่สำเนียงต้องฟังของจริงก่อนตัดสิน
 * → มี scripts/vex-openai-voice-pick.mjs ไว้คัดเสียงเทียบกับคลิปต้นแบบ
 *
 * เสียง Arbor ที่เจ้าของอยากได้ **ไม่มีใน API** (เป็นเสียงเฉพาะแอป ChatGPT)
 * จึงต้องหาตัวที่ใกล้ที่สุดจาก 13 ตัวนี้แทน
 */
export const OPENAI_VOICES = [
  "alloy", "ash", "ballad", "coral", "echo", "fable",
  "onyx", "nova", "sage", "shimmer", "verse", "marin", "cedar",
] as const;

export const DEFAULT_OPENAI_TTS_MODEL = "gpt-4o-mini-tts";

/**
 * คำสั่งโทนเสียง — ถอดจากคลิปต้นแบบที่เจ้าของส่งมา (วัดได้ว่าเงียบ 40-45% หยุดเฉลี่ย 0.66-0.68 วิ)
 * แก้ผ่านค่าตั้งค่า kiki_tts_instructions ได้โดยไม่ต้องแตะโค้ด
 */
export const DEFAULT_OPENAI_INSTRUCTIONS = [
  "Speak Thai naturally, like a close friend chatting casually — not a narrator, not customer service.",
  "Pace: unhurried and relaxed. Leave real pauses between sentences, around 0.6-0.7 seconds.",
  "Roughly 40% of the time should be silence. Never rush from one sentence into the next.",
  "Tone: warm, low-key, thoughtful. Low energy rather than upbeat. Never enthusiastic or salesy.",
  "Let filler words like 'อืม', 'เออ', 'อ๋อ' land naturally as thinking sounds, not as words being read.",
  "Treat '...' as a genuine pause where you stop and breathe.",
].join(" ");

const callOpenAI = async (text: string, voice: string, model: string): Promise<Buffer | null> => {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  const instructions = (await getSetting("kiki_tts_instructions")) || DEFAULT_OPENAI_INSTRUCTIONS;
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      // opus มาเป็น OGG/Opus อยู่แล้ว = ฟอร์แมตเดียวกับที่ทั้งระบบใช้ ไม่ต้องแปลงซ้ำ
      response_format: "opus",
      // tts-1/tts-1-hd ไม่รู้จักพารามิเตอร์นี้ ใส่เฉพาะรุ่นที่รองรับ
      ...(model.includes("4o") || model.includes("gpt-audio") ? { instructions } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  }).catch(() => null);
  if (!res) return null;
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    if (res.status === 429 || /quota|rate|insufficient/i.test(msg)) {
      void import("./kiki-monitor").then(async (m) => {
        if (await m.noteQuotaHit("เสียงพูด OpenAI")) {
          await m.raiseAlert("quota-tts-openai", "warn", `เรียกเสียง OpenAI ไม่ผ่าน (${res.status}) — เช็คยอดเงินในบัญชี`);
        }
      }).catch(() => {});
    }
    return null;
  }
  await noteRequest(model);
  return Buffer.from(await res.arrayBuffer());
};

const openaiProvider: Provider = async (text, voice, model) => {
  const m = model.startsWith("gpt") || model.startsWith("tts") ? model : DEFAULT_OPENAI_TTS_MODEL;
  const k = await cacheKey(text, voice, m);
  const hit = await fromCache(k);
  if (hit) return hit;
  const buf = await callOpenAI(text, voice, m).catch(() => null);
  if (buf) await toCache(k, buf);
  return buf;
};

const PROVIDERS: Record<string, Provider> = {
  gemini: geminiProvider,
  openai: openaiProvider,
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
    // ชื่อเสียงกับชื่อโมเดลของแต่ละเจ้าไม่เหมือนกันเลย — สลับเจ้าแล้วต้องสลับค่าเริ่มต้นตาม
    // (ไม่งั้นส่ง "Iapetus" ของ Gemini ไปให้ OpenAI แล้วมันตอบ 400 กลับมาเงียบ ๆ)
    const isOpenAI = providerName === "openai";
    const voiceKey = isOpenAI ? "kiki_tts_voice_openai" : "kiki_tts_voice";
    const modelKey = isOpenAI ? "kiki_tts_model_openai" : "kiki_tts_model";
    const voice = opts.voice || (await getSetting(voiceKey)) || (isOpenAI ? "ash" : DEFAULT_VOICE);
    const model = opts.model || (await getSetting(modelKey)) || (isOpenAI ? DEFAULT_OPENAI_TTS_MODEL : DEFAULT_GEMINI_TTS_MODEL);
    return await provider(clean, voice, model);
  } catch {
    return null;
  }
}
