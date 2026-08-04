// เทียบเสียง TTS ให้เจ้าของเลือก (เฟส 0 ของงาน Vex-เข้า-Discord)
//
// ทำไมต้องมี: เสียงที่ Vex ใช้อยู่ (Charon) เป็นแค่ค่าดีฟอลต์ ไม่เคยถูกเลือกมา
// และเจ้าของพูดไทยปนอังกฤษ ซึ่งเป็นจุดที่เสียง TTS ส่วนใหญ่พัง (ไทยแม่น→อังกฤษเป็นสำเนียงไทย และกลับกัน)
//
// วิธี: คัดด้วยเครื่องก่อน แล้วให้คนฟังรอบสุดท้าย
//   รอบ 1  ยิงประโยคยากเข้าทุกเสียง → ถอดเสียงกลับด้วย STT → เทียบว่าคำสำคัญหายหรือเพี้ยนไหม
//   รอบ 2  เอาเสียงที่รอดมายิงครบทุกประโยค → ส่งเข้า Telegram ให้ฟังจากหูฟัง
//
// ข้อจำกัดที่ต้องรู้: การถอดเสียงกลับจับได้แค่ "คำหาย/เลขผิด/ชื่อเพี้ยน"
// มันบอกไม่ได้ว่าสำเนียงอังกฤษเพราะหรือไม่เพราะ — อันนั้นต้องหูเจ้าของตัดสิน
//
// รัน: node --env-file=.env scripts/vex-tts-bakeoff.mjs [--send] [--model=<id>] [--only=A,B]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const KEY = process.env.GEMINI_API_KEY?.trim();
if (!KEY) { console.error("ไม่มี GEMINI_API_KEY"); process.exit(1); }

const argv = process.argv.slice(2);
const SEND = argv.includes("--send");
const MODEL = (argv.find((a) => a.startsWith("--model=")) || "--model=gemini-2.5-flash-preview-tts").split("=")[1];
const ONLY = (argv.find((a) => a.startsWith("--only=")) || "").split("=")[1];
const OUT = path.join(os.homedir(), "Desktop", "vex-voice-test");
const FFMPEG = fs.existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";
const FFPROBE = fs.existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "ffprobe";

// 30 เสียงตามเอกสารทางการ (ai.google.dev/gemini-api/docs/speech-generation) + บุคลิกที่เอกสารระบุ
const VOICES = [
  ["Zephyr", "Bright"], ["Puck", "Upbeat"], ["Charon", "Informative"], ["Kore", "Firm"], ["Fenrir", "Excitable"],
  ["Leda", "Youthful"], ["Orus", "Firm"], ["Aoede", "Breezy"], ["Callirrhoe", "Easy-going"], ["Autonoe", "Bright"],
  ["Enceladus", "Breathy"], ["Iapetus", "Clear"], ["Umbriel", "Easy-going"], ["Algieba", "Smooth"], ["Despina", "Smooth"],
  ["Erinome", "Clear"], ["Algenib", "Gravelly"], ["Rasalgethi", "Informative"], ["Laomedeia", "Upbeat"], ["Achernar", "Soft"],
  ["Alnilam", "Firm"], ["Schedar", "Even"], ["Gacrux", "Mature"], ["Pulcherrima", "Forward"], ["Achird", "Friendly"],
  ["Zubenelgenubi", "Casual"], ["Vindemiatrix", "Gentle"], ["Sadachbia", "Lively"], ["Sadaltager", "Knowledgeable"], ["Sulafat", "Warm"],
];

// ประโยคทดสอบ — ไทยปนอังกฤษของจริง + ตัวเลข + ชื่อคน + คำว่า "โด้" ครบทุกประโยค
const SENTENCES = [
  {
    id: "s1",
    text: "โด้ครับ อั๋นเพิ่งทักมาใน Telegram ถามว่าเย็นนี้กินข้าวไหน แล้ว invoice ของลูกค้า EasySlip ยอด 12,450 บาท ยังไม่ได้ส่งนะครับ",
    // คำที่ต้องออกมาครบ — แต่ละตัวยอมรับได้หลายรูป เพราะ STT อาจถอดเป็นไทยหรืออังกฤษก็ได้
    must: [
      ["โด้", "โด", "Doh", "โดะ"],
      ["อั๋น", "อัน", "อั้น"],
      ["Telegram", "เทเลแกรม", "เทเลกรม", "เทเลแกรม"],
      ["invoice", "อินวอยซ์", "อินวอย"],
      ["EasySlip", "อีซี่สลิป", "อีซีสลิป", "easy slip"],
      ["12,450", "12450", "หนึ่งหมื่นสองพันสี่ร้อยห้าสิบ", "สองพันสี่ร้อยห้าสิบ"],
      ["บาท"],
    ],
  },
  {
    id: "s2",
    text: "บรีฟเช้าครับโด้ วันนี้มีนัด 2 อัน บ่ายสองที่ BNI กับหกโมงเย็นเจอทีม เมื่อวานใช้ไป 1,847 บาท เกิน budget รายวันอยู่ 340 บาท Hermes ที่ฝากไว้เมื่อคืนเสร็จแล้ว เดี๋ยวส่งไฟล์ให้ในห้อง text",
    must: [["โด้", "โด"], ["BNI", "บีเอ็นไอ"], ["1,847", "1847"], ["budget", "บัดเจ็ต", "งบ"], ["Hermes", "เฮอร์มีส", "เฮอมีส"], ["340"]],
  },
  {
    id: "s3",
    text: "ผมว่าเลื่อนไปพรุ่งนี้ดีกว่าไหมครับ วันนี้ชนกับนัดบ่ายสอง ถ้าเอาจริงต้อง reschedule แล้ว update ปฏิทินให้อั๋นรู้ด้วย",
    must: [["reschedule", "รีสเกดูล", "รีสเก"], ["update", "อัปเดต", "อัพเดท"], ["อั๋น", "อัน"], ["ปฏิทิน"]],
  },
];

const norm = (s) => String(s || "").toLowerCase().replace(/[\s​]/g, "");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * ลองใหม่เมื่อชน quota (429) หรือเจอ "Model tried to generate text" ซึ่งเป็นอาการชั่วคราวของโมเดล TTS
 * ไม่ใส่ตัวนี้ = รอบคัดจะได้ผลไม่ครบทุกเสียง แล้วสรุปผิดว่าเสียงนั้นใช้ไม่ได้ (จริง ๆ แค่ยิงไม่ติด)
 */
async function withRetry(fn, label, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = e.message || "";
      const retryable = /quota|429|rate|tried to generate text|500|503|timeout/i.test(msg);
      if (!retryable || i === tries - 1) throw e;
      const wait = 8000 * (i + 1);
      console.log(`   (${label} ลองใหม่ใน ${wait / 1000}s — ${msg.slice(0, 60)})`);
      await sleep(wait);
    }
  }
  throw last;
}

async function tts(text, voice, model = MODEL) {
  const t0 = Date.now();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`, {
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
  const j = await res.json();
  if (j.error?.message) throw new Error(j.error.message.slice(0, 120));
  const b64 = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!b64) throw new Error("ไม่มีเสียงกลับมา");
  return { pcm: Buffer.from(b64, "base64"), ms: Date.now() - t0 };
}

// PCM 24k mono → OGG/Opus (ฟอร์แมตเดียวกับที่ ttsOgg คืน — Telegram sendVoice และ @discordjs/voice กินตรง ๆ)
async function toOgg(pcm, outPath) {
  const tmp = path.join(os.tmpdir(), `bakeoff-${Date.now()}-${Math.floor(Math.random() * 1e6)}.pcm`);
  fs.writeFileSync(tmp, pcm);
  await exec(FFMPEG, ["-y", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", tmp, "-c:a", "libopus", "-b:a", "48k", outPath]);
  fs.unlinkSync(tmp);
  const { stdout } = await exec(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", outPath]);
  return Number(stdout.trim()) || 0;
}

async function stt(oggPath) {
  const data = fs.readFileSync(oggPath).toString("base64");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: "audio/ogg", data } },
        { text: "ถอดเสียงในไฟล์นี้เป็นข้อความตรงตามที่พูดทุกคำ คำภาษาอังกฤษให้เขียนเป็นภาษาอังกฤษ ตัวเลขให้เขียนเป็นตัวเลข ตอบเฉพาะข้อความที่ถอดได้" },
      ] }],
      generationConfig: { temperature: 0 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const j = await res.json();
  if (j.error?.message) throw new Error(j.error.message.slice(0, 120));
  return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
}

// ระยะ Levenshtein แบบคุมหน่วยความจำ (ประโยคสั้น ใช้ได้สบาย)
function lev(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * ให้คะแนนจากทรานสคริปต์ที่ถอดกลับมา 3 สัญญาณ
 *   hit      คำสำคัญออกมาครบไหม (คำหาย = TTS กินคำ)
 *   latin    คำอังกฤษถอดกลับมาเป็น "ตัวอักษรอังกฤษ" ไหม
 *            ← นี่คือตัวชี้ว่าออกเสียงอังกฤษชัดจริง ถ้าออกเป็นสำเนียงไทย STT จะถอดเป็นไทยแทน
 *            (ตรงกับคำถามหลักของเจ้าของ: เสียงที่ไทยแม่นมักอ่านอังกฤษเป็นสำเนียงไทย)
 *   sim      ความเหมือนทั้งประโยค — จับกรณีเพี้ยนย่อย ๆ ที่คำสำคัญยังผ่าน
 */
function score(transcript, sentence) {
  const hay = norm(transcript);
  const missed = [];
  const thaified = [];
  let hit = 0, latin = 0, latinTotal = 0;
  for (const alts of sentence.must) {
    const isEnglishToken = /^[A-Za-z]/.test(alts[0]);
    if (isEnglishToken) latinTotal++;
    const idx = alts.findIndex((a) => hay.includes(norm(a)));
    if (idx < 0) { missed.push(alts[0]); continue; }
    hit++;
    if (isEnglishToken) {
      if (idx === 0) latin++;          // ถอดกลับเป็นอังกฤษ = ออกเสียงอังกฤษชัด
      else thaified.push(alts[0]);     // ถอดกลับเป็นไทย = อ่านคำอังกฤษด้วยสำเนียงไทย
    }
  }
  const sim = 1 - lev(norm(transcript), norm(sentence.text)) / Math.max(norm(sentence.text).length, 1);
  return { hit, total: sentence.must.length, missed, latin, latinTotal, thaified, sim: Math.max(0, sim) };
}

// ยิงทีละก้อนเล็ก ๆ กัน rate limit (429) — พังตัวไหนไม่ล้มทั้งรอบ
async function pool(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map((x, k) => fn(x, i + k).catch((e) => ({ error: e.message }))))));
  }
  return out;
}

async function sendText(text) {
  const token = process.env.KIKI_BOT_TOKEN;
  const chat = process.env.VEX_TEST_CHAT_ID || "7750653134";
  if (!token) return false;
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text }),
  });
  return (await r.json()).ok;
}

async function sendTelegram(oggPath, caption) {
  const token = process.env.KIKI_BOT_TOKEN;
  const chat = process.env.VEX_TEST_CHAT_ID || "7750653134";
  if (!token) return false;
  const form = new FormData();
  form.append("chat_id", chat);
  form.append("caption", caption);
  form.append("voice", new Blob([new Uint8Array(fs.readFileSync(oggPath))]), path.basename(oggPath));
  const r = await fetch(`https://api.telegram.org/bot${token}/sendVoice`, { method: "POST", body: form });
  return (await r.json()).ok;
}

// ===== ลงมือ =====
fs.mkdirSync(OUT, { recursive: true });
const s1 = SENTENCES[0];
const pickList = ONLY ? VOICES.filter(([v]) => ONLY.split(",").includes(v)) : VOICES;

console.log(`โมเดล: ${MODEL}`);
console.log(`รอบคัด: ${pickList.length} เสียง × ประโยค s1 → ถอดกลับเทียบคำสำคัญ ${s1.must.length} จุด`);
console.log(`ไฟล์ออกที่: ${OUT}\n`);

const rows = await pool(pickList, 4, async ([voice, trait]) => {
  const file = path.join(OUT, `${MODEL.includes("3.1") ? "g31" : "g25"}-${voice}-s1.ogg`);
  // ใช้ไฟล์เดิมซ้ำถ้าอัดไว้แล้ว — รอบคัดต้องรันหลายรอบเพราะชน quota ไม่ควรจ่ายค่าอัดใหม่ทุกรอบ
  let ms = 0, dur;
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) {
    const { stdout } = await exec(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    dur = Number(stdout.trim()) || 0;
  } else {
    const r = await withRetry(() => tts(s1.text, voice), voice);
    ms = r.ms;
    dur = await toOgg(r.pcm, file);
  }
  const transcript = await withRetry(() => stt(file), `${voice}/stt`);
  const sc = score(transcript, s1);
  const cps = dur > 0 ? s1.text.length / dur : 0; // ตัวอักษรต่อวินาที = ความเร็วพูด
  console.log(
    `${voice.padEnd(14)} ${trait.padEnd(14)} คำครบ ${sc.hit}/${sc.total}  ` +
    `อังกฤษชัด ${sc.latin}/${sc.latinTotal}  เหมือน ${(sc.sim * 100).toFixed(0)}%  ` +
    `${cps.toFixed(1)} ตัว/วิ` +
    (sc.missed.length ? `  หาย: ${sc.missed.join(",")}` : "") +
    (sc.thaified.length ? `  อ่านเป็นไทย: ${sc.thaified.join(",")}` : ""),
  );
  return { voice, trait, file, dur, ms, cps, transcript, ...sc };
});

const good = rows.filter((r) => !r.error);
const failed = rows.filter((r) => r.error);
if (failed.length) console.log(`\nยิงไม่ผ่าน ${failed.length} ตัว: ${failed.map((f) => f.error).join(" · ")}`);

// จัดอันดับ: คำต้องครบก่อน → อ่านอังกฤษเป็นอังกฤษ (โจทย์หลักของเจ้าของ) → เหมือนทั้งประโยค → พูดไม่เร็วเกิน
const ranked = [...good].sort(
  (a, b) => b.hit - a.hit || b.latin - a.latin || b.sim - a.sim || Math.abs(a.cps - 12) - Math.abs(b.cps - 12),
);
const top = ranked.slice(0, 5);

console.log(`\n=== 5 เสียงที่รอดเข้ารอบฟัง ===`);
top.forEach((r, i) =>
  console.log(
    `${i + 1}. ${r.voice} (${r.trait}) — คำครบ ${r.hit}/${r.total} · อังกฤษชัด ${r.latin}/${r.latinTotal} · ` +
    `เหมือน ${(r.sim * 100).toFixed(0)}% · ${r.cps.toFixed(1)} ตัว/วิ`,
  ),
);

// ต้นทุนจริง คิดจากความยาวเสียงที่วัดได้ (เอกสาร: audio = 25 tokens ต่อวินาที)
const avgDur = good.reduce((s, r) => s + r.dur, 0) / (good.length || 1);
const secPer1000 = (avgDur / s1.text.length) * 1000;
const PRICE = { "gemini-2.5-flash-preview-tts": 10, "gemini-2.5-pro-preview-tts": 20, "gemini-3.1-flash-tts-preview": 20 };
const usdPer1000 = (secPer1000 * 25 * (PRICE[MODEL] ?? 10)) / 1_000_000;
console.log(
  `\nต้นทุน (คิดจากเสียงจริงที่วัดได้ ${avgDur.toFixed(1)} วิ ต่อ ${s1.text.length} ตัวอักษร):\n` +
  `  1,000 ตัวอักษร ≈ ${secPer1000.toFixed(0)} วินาทีเสียง ≈ ${(secPer1000 * 25).toFixed(0)} output tokens ≈ $${usdPer1000.toFixed(4)} (~${(usdPer1000 * 36).toFixed(2)} บาท)\n` +
  `  อ้างอิงราคา ai.google.dev/gemini-api/docs/pricing — ${MODEL} output $${PRICE[MODEL] ?? 10}/1M tokens (free tier = $0)`,
);

// ===== รอบฟัง: 5 เสียงที่รอด × ครบทุกประโยค =====
if (SEND) {
  console.log(`\n=== รอบฟัง: อัด 5 เสียง × ${SENTENCES.length} ประโยค แล้วส่งเข้า Telegram ===`);
  await sendText(
    `เทียบเสียง Vex — ${top.length} เสียงที่ผ่านรอบคัดจาก ${VOICES.length} เสียง\n\n` +
    `จะส่งเสียงละ ${SENTENCES.length} ประโยค รวม ${top.length * SENTENCES.length} ไฟล์\n` +
    top.map((r, i) => `${i + 1}. ${r.voice} (${r.trait})`).join("\n") +
    `\n\nฟังแล้วบอกเบอร์ที่ชอบได้เลยครับ`,
  ).catch(() => {});
  for (const [i, r] of top.entries()) {
    for (const s of SENTENCES) {
      const file = path.join(OUT, `final-${i + 1}-${r.voice}-${s.id}.ogg`);
      try {
        if (s.id === "s1") fs.copyFileSync(r.file, file);
        else {
          const { pcm } = await tts(s.text, r.voice);
          await toOgg(pcm, file);
        }
        const okSend = await sendTelegram(file, `เสียงที่ ${i + 1}: ${r.voice} (${r.trait}) — ประโยค ${s.id}`);
        console.log(`  ${r.voice} ${s.id} ${okSend ? "ส่งเข้า Telegram แล้ว" : "อัดแล้ว (ส่งไม่ได้)"}`);
      } catch (e) {
        console.log(`  ${r.voice} ${s.id} พัง: ${e.message}`);
      }
    }
  }
}

// รวมผลกับรอบก่อน ๆ (รอบคัดต้องรันหลายรอบเพราะ quota — ถ้าเขียนทับจะเหลือผลรอบสุดท้ายรอบเดียว)
const resultPath = path.join(OUT, `ผลเทียบ-${MODEL}.json`);
let merged = [];
try { merged = JSON.parse(fs.readFileSync(resultPath, "utf8")).rows || []; } catch { /* ยังไม่มีไฟล์ */ }
for (const r of good) merged = [...merged.filter((x) => x.voice !== r.voice), r];
merged.sort((a, b) => b.hit - a.hit || b.latin - a.latin || b.sim - a.sim || Math.abs(a.cps - 12) - Math.abs(b.cps - 12));
fs.writeFileSync(resultPath, JSON.stringify({ model: MODEL, sentence: s1.text, rows: merged, top: merged.slice(0, 5).map((t) => t.voice) }, null, 2));
console.log(`\nผลรวมสะสมทั้งหมด ${merged.length}/${VOICES.length} เสียง`);
console.log(`\nเสร็จ — ไฟล์เสียงและผลอยู่ที่ ${OUT}`);
