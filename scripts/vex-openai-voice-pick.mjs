/**
 * คัดเสียง OpenAI ที่ใกล้ "Arbor" ที่สุด — วิธีเดียวกับตอนคัด 30 เสียงของ Gemini จนได้ Iapetus
 *
 * ทำไมต้องมีสคริปต์นี้: เสียง Arbor ที่เจ้าของอยากได้ไม่มีใน API (เป็นเสียงเฉพาะแอป ChatGPT)
 * เลยต้องหาตัวที่ใกล้ที่สุดจาก 13 เสียงที่มี — และ "ใกล้" ต้องวัดได้ ไม่ใช่เดาจากชื่อ
 *
 * วัด 3 อย่างเทียบกับคลิปต้นแบบที่เจ้าของส่งมา:
 *   1. ระดับเสียง (F0)   — Arbor วัดได้ 113 Hz · ยิ่งใกล้ยิ่งดี
 *   2. ความเงียบ          — Arbor 45% ของเวลา · ตัวชี้ว่า "ไม่เร่ง"
 *   3. คำครบไหม           — ถอดเสียงกลับด้วย STT เช็คว่าคำไทยไม่หาย/ไม่เพี้ยน
 *                            (เอกสาร OpenAI เตือนเองว่าเสียงปรับมาเพื่ออังกฤษ)
 *
 * แยกขาดจากระบบ ไม่ import อะไรจาก src/ ไม่แตะ DB รันซ้ำได้
 *   node scripts/vex-openai-voice-pick.mjs           คัดทุกเสียงแล้วส่งตัวที่รอดเข้า Telegram
 *   node scripts/vex-openai-voice-pick.mjs ash,onyx  ทดสอบเฉพาะเสียงที่ระบุ
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = process.cwd();
const OUT = path.join(ROOT, ".run-logs", "voice-pick");
const REF = path.join(ROOT, ".run-logs", "voice-ref");
const FFMPEG = fs.existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";

// โหลด .env
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const OPENAI_KEY = (process.env.OPENAI_API_KEY || "").trim();
const GEMINI_KEY = (process.env.GEMINI_API_KEY || "").trim();
if (!OPENAI_KEY) {
  console.error("ยังไม่มี OPENAI_API_KEY ใน .env — ใส่ก่อนแล้วค่อยรันใหม่");
  process.exit(1);
}

const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "verse", "marin", "cedar"];
const MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";

// เป้าที่วัดได้จากคลิปต้นแบบจริง (ดู docs/vex-roadmap-2026-08.md)
const TARGET_F0 = 113;
const TARGET_SILENCE = 45;

// ประโยคทดสอบ — จงใจใส่ของยากครบ: ชื่อคน · คำอังกฤษปนไทย · ตัวเลข · คำเชื่อมแบบที่เจ้าของอยากได้
const SENTENCE =
  "อืม... จริง ๆ แล้วแบบว่า... เดือนนี้โด้ใช้ไป 12,450 บาทแล้วนะครับ... " +
  "ก้อนใหญ่สุดคือค่า Subscription กับค่าข้าว... อะไรอย่างเงี้ยครับ เนาะ";

const INSTRUCTIONS = [
  "Speak Thai naturally, like a close friend chatting casually — not a narrator, not customer service.",
  "Pace: unhurried and relaxed. Leave real pauses between sentences, around 0.6-0.7 seconds.",
  "Roughly 40% of the time should be silence. Never rush from one sentence into the next.",
  "Tone: warm, low-key, thoughtful. Low energy rather than upbeat. Never enthusiastic or salesy.",
  "Let filler words like 'อืม', 'เออ', 'อ๋อ' land naturally as thinking sounds, not as words being read.",
  "Treat '...' as a genuine pause where you stop and breathe.",
].join(" ");

// คำสำคัญที่ต้องไม่หายหลังถอดเสียงกลับ
const MUST_KEEP = ["โด้", "12,450", "บาท", "Subscription"];

async function speak(voice) {
  const t0 = Date.now();
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: MODEL, voice, input: SENTENCE, response_format: "opus",
      ...(MODEL.includes("4o") ? { instructions: INSTRUCTIONS } : {}),
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ogg = path.join(OUT, `${voice}.ogg`);
  fs.writeFileSync(ogg, buf);
  return { ogg, ms: Date.now() - t0, bytes: buf.length };
}

/** วัดระดับเสียง + สัดส่วนความเงียบ ด้วย ffmpeg (ไม่ต้องพึ่ง python) */
async function measure(ogg) {
  const wav = ogg.replace(/\.ogg$/, ".wav");
  await run(FFMPEG, ["-y", "-i", ogg, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
  const pcm = fs.readFileSync(wav).subarray(44);
  const n = Math.floor(pcm.length / 2);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = pcm.readInt16LE(i * 2) / 32768;

  // ความเงียบ: กรอบละ 20ms เทียบกับ 6% ของยอดสูงสุด
  const win = 16000 * 0.02;
  const rms = [];
  for (let i = 0; i + win <= n; i += win) {
    let acc = 0;
    for (let j = 0; j < win; j++) acc += s[i + j] ** 2;
    rms.push(Math.sqrt(acc / win));
  }
  const thr = Math.max(...rms) * 0.06;
  const silence = (rms.filter((r) => r <= thr).length / rms.length) * 100;

  // ระดับเสียง: autocorrelation หาคาบซ้ำ เอาค่ากลาง
  const f0s = [];
  const step = Math.floor(16000 * 0.03);
  for (let i = 0; i + step * 2 <= n; i += step) {
    const seg = s.subarray(i, i + step * 2);
    let e = 0;
    for (const v of seg) e += v * v;
    if (Math.sqrt(e / seg.length) < thr) continue;
    let best = 0, bestLag = 0;
    for (let lag = Math.floor(16000 / 400); lag < Math.floor(16000 / 70); lag++) {
      let acc = 0;
      for (let j = 0; j + lag < seg.length; j++) acc += seg[j] * seg[j + lag];
      if (acc > best) { best = acc; bestLag = lag; }
    }
    if (bestLag) f0s.push(16000 / bestLag);
  }
  f0s.sort((a, b) => a - b);
  const f0 = f0s.length ? f0s[Math.floor(f0s.length / 2)] : 0;

  const { stdout } = await run(FFMPEG.replace("ffmpeg", "ffprobe"), [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", ogg,
  ]).catch(() => ({ stdout: "0" }));
  fs.rmSync(wav, { force: true });
  return { f0, silence, dur: parseFloat(stdout) || 0 };
}

/** ถอดเสียงกลับ เช็คว่าคำไทยไม่หาย */
async function transcribe(ogg) {
  if (!GEMINI_KEY) return null;
  const b64 = fs.readFileSync(ogg).toString("base64");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "ถอดข้อความจากเสียงนี้ ตอบเฉพาะข้อความ" }, { inline_data: { mime_type: "audio/ogg", data: b64 } }] }],
        generationConfig: { temperature: 0 },
      }),
    },
  ).catch(() => null);
  if (!res?.ok) return null;
  const j = await res.json();
  return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
}

async function sendVoice(ogg, caption) {
  const token = (process.env.KIKI_BOT_TOKEN || "").trim();
  if (!token) return false;
  let chat = "";
  try {
    const { stdout } = await run("sqlite3", [path.join(ROOT, "prisma/changoh.db"), "SELECT value FROM Setting WHERE key='kiki_owner_id';"]);
    chat = stdout.trim();
  } catch { /* ไม่มีก็ข้าม */ }
  if (!chat) return false;
  const form = new FormData();
  form.append("chat_id", chat);
  form.append("caption", caption);
  form.append("voice", new Blob([fs.readFileSync(ogg)]), path.basename(ogg));
  const r = await fetch(`https://api.telegram.org/bot${token}/sendVoice`, { method: "POST", body: form }).catch(() => null);
  return Boolean(r?.ok);
}

// ===== เดินเครื่อง =====
fs.mkdirSync(OUT, { recursive: true });
const only = (process.argv[2] || "").split(",").map((s) => s.trim()).filter(Boolean);
const list = only.length ? VOICES.filter((v) => only.includes(v)) : VOICES;

console.log(`คัดเสียง OpenAI ${list.length} ตัว · โมเดล ${MODEL}`);
console.log(`เป้าจากคลิปต้นแบบ: ระดับเสียง ~${TARGET_F0} Hz · เงียบ ~${TARGET_SILENCE}%\n`);

const rows = [];
for (const v of list) {
  try {
    const { ogg, ms } = await speak(v);
    const m = await measure(ogg);
    const heard = await transcribe(ogg);
    const missing = heard ? MUST_KEEP.filter((w) => !heard.replace(/\s/g, "").includes(w.replace(/\s/g, ""))) : [];
    // คะแนน: ยิ่งน้อยยิ่งใกล้ต้นแบบ · คำหายคือหักหนัก เพราะพูดผิดแย่กว่าเสียงไม่เหมือน
    const score = Math.abs(m.f0 - TARGET_F0) / TARGET_F0 + Math.abs(m.silence - TARGET_SILENCE) / 100 + missing.length * 0.5;
    rows.push({ v, ...m, ms, missing, score, heard });
    console.log(
      `${v.padEnd(9)} ${m.f0.toFixed(0).padStart(4)} Hz · เงียบ ${m.silence.toFixed(0).padStart(2)}% · ` +
      `${(ms / 1000).toFixed(1)}s · ${missing.length ? `คำหาย: ${missing.join(",")}` : "คำครบ"} · คะแนน ${score.toFixed(3)}`,
    );
  } catch (e) {
    console.log(`${v.padEnd(9)} ยิงไม่ผ่าน: ${e.message.slice(0, 100)}`);
  }
}

rows.sort((a, b) => a.score - b.score);
console.log("\n=== อันดับ (ยิ่งคะแนนน้อยยิ่งใกล้ต้นแบบ) ===");
rows.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${r.v.padEnd(9)} คะแนน ${r.score.toFixed(3)}`));

const top = rows.filter((r) => !r.missing.length).slice(0, 5);
if (!top.length) {
  console.log("\nไม่มีเสียงไหนอ่านคำไทยครบเลย — ต้องพิจารณาผู้ให้บริการอื่น");
  process.exit(0);
}
console.log(`\nส่ง ${top.length} เสียงที่เข้ารอบเข้า Telegram ให้ฟัง...`);
for (const [i, r] of top.entries()) {
  const ok = await sendVoice(r.ogg, `อันดับ ${i + 1}: ${r.v} — ${r.f0.toFixed(0)} Hz · เงียบ ${r.silence.toFixed(0)}% (ต้นแบบ ${TARGET_F0} Hz · ${TARGET_SILENCE}%)`);
  console.log(`  ${r.v} ${ok ? "ส่งแล้ว" : "ส่งไม่ได้"}`);
}
console.log(`\nไฟล์ทั้งหมดอยู่ที่ ${OUT}`);
console.log(`เลือกได้แล้วสั่ง: sqlite3 prisma/changoh.db "INSERT OR REPLACE INTO Setting (key,value) VALUES ('kiki_tts_voice_openai','<ชื่อเสียง>'),('kiki_tts_provider','openai');"`);
