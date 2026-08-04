// Vex บน Discord — ท่อฝั่งข้อความ (เฟส 1 ของงาน "เลขาเสียงเปิดค้างทั้งวัน")
//
// หลักการเดียวกับ scripts/kiki-bot.mjs เป๊ะ: ไฟล์นี้เป็นแค่ "ท่อ"
// สมองอยู่ที่ /api/kiki/ingest ตัวเดียวกับ Telegram — ห้ามมีตรรกะตัดสินใจอะไรในนี้
// ได้อะไรมาจาก API ก็แปลงเป็นรูปแบบของ Discord แล้วส่ง เท่านั้น
//
// รัน: node scripts/kiki-discord.mjs (ต้องรัน backend คู่กัน)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, pipeline } from "node:stream";
import { spawn } from "node:child_process";
import prism from "prism-media";
import {
  Client, GatewayIntentBits, Partials, Events,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder,
} from "discord.js";
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType,
  entersState, VoiceConnectionStatus, AudioPlayerStatus, NoSubscriberBehavior, EndBehaviorType,
} from "@discordjs/voice";

function loadEnv() {
  const p = path.join(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const INTERNAL = process.env.INTERNAL_API_TOKEN;
const APP_URL = process.env.APP_URL || "http://localhost:3000";
const TEXT_CH = process.env.DISCORD_TEXT_CH_ID;
const LOG_CH = process.env.DISCORD_LOG_CH_ID;
const OWNER = process.env.DISCORD_OWNER_ID;
if (!TOKEN) { console.error("ไม่พบ DISCORD_BOT_TOKEN ใน .env"); process.exit(1); }

const DISCORD_LIMIT = 2000; // Discord รับข้อความละ 2,000 ตัวอักษร (Telegram 4,096 — ตัวจัดการตัดที่ 3,900)
const FFMPEG = fs.existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";

// ===== HTML ของ Telegram → มาร์กดาวน์ของ Discord =====
// สมองส่งข้อความมาในรูปแบบของ Telegram (sanitizeVexText แปลง **x** เป็น <b>x</b> ให้ Telegram)
// ถ้าส่งดิบ ๆ เข้า Discord จะเห็นแท็กเป็นตัวอักษร — แปลงที่ท่อ ไม่แตะฝั่งสมอง (Telegram ต้องไม่กระทบ)
function htmlToDiscord(s) {
  return String(s || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(b|strong)>/gi, "**")
    .replace(/<\/?(i|em)>/gi, "*")
    .replace(/<\/?u>/gi, "__")
    .replace(/<\/?(s|del|strike)>/gi, "~~")
    .replace(/<tg-spoiler>([\s\S]*?)<\/tg-spoiler>/gi, "||$1||")
    .replace(/<pre>([\s\S]*?)<\/pre>/gi, (_, c) => `\`\`\`\n${c}\n\`\`\``)
    .replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<\/?copy>/gi, "")
    .replace(/<[^>]+>/g, "")
    // คืน entity ที่ escape ไว้สำหรับ Telegram
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
}

// ซอยข้อความยาวโดยพยายามตัดที่ขึ้นบรรทัดใหม่ก่อน (ไม่ตัดกลางคำ)
function chunk(s, size = DISCORD_LIMIT) {
  const out = [];
  let rest = String(s);
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n", size);
    if (cut < size * 0.5) cut = rest.lastIndexOf(" ", size);
    if (cut < size * 0.5) cut = size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, "");
  }
  if (rest) out.push(rest);
  return out;
}

function rowsFrom(buttons) {
  // customId ของ Discord ยาวได้ 100 ตัว — callbackData ที่ระบบใช้สั้นกว่านั้นมาก
  return (buttons || []).slice(0, 5).map((row) =>
    new ActionRowBuilder().addComponents(
      row.slice(0, 5).map((b) =>
        new ButtonBuilder()
          .setCustomId(String(b.data).slice(0, 100))
          .setLabel(String(b.text).replace(/[\p{Extended_Pictographic}]/gu, "").trim().slice(0, 80) || "ตกลง")
          .setStyle(/ยกเลิก|ไม่|หยุด|ทิ้ง/.test(b.text) ? ButtonStyle.Secondary : ButtonStyle.Primary),
      ),
    ),
  );
}

// ===== ส่งผลลัพธ์จาก API เข้าห้อง Discord =====
async function deliver(client, defaultChannelId, sends, replyToMsg) {
  let first = replyToMsg; // ก้อนแรกตอบแบบ reply ให้เห็นว่าตอบข้อความไหน
  for (const s of sends || []) {
    const chId = s.chatId || defaultChannelId;
    let ch;
    try {
      ch = await client.channels.fetch(String(chId));
    } catch {
      // chatId ที่ไม่ใช่ห้องของ Discord (เช่น กลุ่ม Telegram ที่สมองสั่งให้ไปโพสต์) — ไม่ใช่งานของท่อนี้
      console.log(`ข้าม send ที่ chatId=${chId} (ไม่ใช่ห้อง Discord)`);
      continue;
    }
    try {
      if (s.kind === "text" && s.text) {
        const parts = chunk(htmlToDiscord(s.text));
        for (let i = 0; i < parts.length; i++) {
          const payload = { content: parts[i] };
          if (i === parts.length - 1 && s.buttons?.length) payload.components = rowsFrom(s.buttons);
          if (s.noPreview) payload.flags = 4; // SUPPRESS_EMBEDS
          if (i === 0 && first && String(chId) === String(defaultChannelId)) {
            await first.reply(payload);
            first = null;
          } else {
            await ch.send(payload);
          }
        }
      } else if (s.dataBase64) {
        const name = s.filename || (s.kind === "photo" ? "image.png" : s.kind === "voice" ? "vex.ogg" : s.kind === "video" ? "video.mp4" : "file");
        const file = new AttachmentBuilder(Buffer.from(s.dataBase64, "base64"), { name });
        const payload = { files: [file] };
        if (s.caption) payload.content = htmlToDiscord(s.caption).slice(0, DISCORD_LIMIT);
        if (s.buttons?.length) payload.components = rowsFrom(s.buttons);
        if (first && String(chId) === String(defaultChannelId)) {
          await first.reply(payload);
          first = null;
        } else {
          await ch.send(payload);
        }
      }
    } catch (e) {
      console.error(`ส่งเข้า Discord ไม่สำเร็จ (${s.kind}):`, e?.message);
    }
  }
}

// ===== เรียกสมอง =====
async function callBrain(body) {
  const waits = [0, 5000, 12000]; // เว็บอาจกำลังรีสตาร์ท (บูต ~10 วิ) — ไม่ใช่เหตุให้ทิ้งข้อความเจ้าของ
  let lastErr = null;
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) await new Promise((r) => setTimeout(r, waits[i]));
    try {
      const ctl = new AbortController();
      const killer = setTimeout(() => ctl.abort(), 250_000);
      const res = await fetch(APP_URL + "/api/kiki/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      clearTimeout(killer);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return (await res.json()).sends || [];
    } catch (e) {
      lastErr = e;
      console.error(`ingest err (รอบ ${i + 1}/${waits.length}):`, e?.message);
    }
  }
  throw lastErr;
}

// ===== ไฟล์แนบ =====
const IMG_RE = /\.(jpe?g|png|webp|gif)$/i;
const DOC_RE = /\.(pdf|docx|txt|md)$/i;
const AUD_RE = /\.(ogg|mp3|m4a|wav|webm)$/i;
const VID_RE = /\.(mp4|mov|mkv)$/i;

async function downloadAttachments(msg) {
  const out = { imageFiles: [], docFiles: [], audioFiles: [], videoFiles: [] };
  if (!msg.attachments?.size) return out;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vex-dc-"));
  for (const a of [...msg.attachments.values()].slice(0, 8)) {
    try {
      const buf = Buffer.from(await (await fetch(a.url)).arrayBuffer());
      const safe = (a.name || `file_${a.id}`).replace(/[^\w.\-ก-๙ ()]/g, "_");
      const p = path.join(dir, safe);
      fs.writeFileSync(p, buf);
      const ct = a.contentType || "";
      if (ct.startsWith("image/") || IMG_RE.test(safe)) out.imageFiles.push(p);
      else if (ct.startsWith("audio/") || AUD_RE.test(safe)) out.audioFiles.push({ path: p, mime: ct || "audio/ogg" });
      else if (ct.startsWith("video/") || VID_RE.test(safe)) out.videoFiles.push({ path: p, name: safe });
      else if (DOC_RE.test(safe)) out.docFiles.push({ path: p, name: safe });
    } catch (e) {
      console.error("โหลดไฟล์แนบไม่ได้:", e?.message);
    }
  }
  return out;
}

// ===== ห้องเสียง (เฟส 2) =====
//
// เจ้าของเปิดห้องเสียงค้างทั้งวันบนมือถือแล้วดับจอ
// กติกาเหล็กจากสเปก: ห้ามพูดใส่ห้องเปล่าเด็ดขาด · ต่อสายกลับเองอัตโนมัติ · พูดไม่ทับกัน

const VOICE_CH = process.env.DISCORD_VOICE_CH_ID;
const GUILD = process.env.DISCORD_GUILD_ID;

let connection = null;
const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
let speaking = false;
let ownerInVoice = false;

// เจ้าของอยู่ในห้องเสียงจริงไหม — อ่านจากสถานะจริงของห้อง ไม่ใช่เดาจาก idle time
// (สเปก: "การอยู่ในห้องเสียง = สัญญาณว่าเจ้าของฟังอยู่ แม่นกว่าเดา และได้ฟรี")
async function refreshPresence() {
  try {
    const ch = await client.channels.fetch(VOICE_CH);
    const was = ownerInVoice;
    ownerInVoice = Boolean(ch?.members?.has(OWNER));
    if (was !== ownerInVoice) console.log(ownerInVoice ? "โด้เข้าห้องเสียงแล้ว" : "โด้ออกจากห้องเสียง — หยุดพูด เก็บเรื่องไว้ในคิว");
    // ออกจากห้องกลางประโยค = หยุดทันที ไม่พูดต่อใส่ห้องเปล่า
    if (!ownerInVoice && speaking) player.stop(true);
  } catch {
    ownerInVoice = false;
  }
  return ownerInVoice;
}

async function connectVoice() {
  if (!VOICE_CH) return;
  try {
    const ch = await client.channels.fetch(VOICE_CH);
    if (!ch) { console.error(`หาห้องเสียง ${VOICE_CH} ไม่เจอ`); return; }
    if (ch.type !== 2) { console.error(`${VOICE_CH} ไม่ใช่ห้องเสียง (type ${ch.type})`); return; }
    // อ่าน guild จากตัวห้องเอง ไม่เชื่อค่าใน .env
    // (เคสจริง 4 ส.ค.: DISCORD_GUILD_ID ใน .env เป็นคนละ id → joinVoiceChannel ค้างจนหมดเวลา
    //  โดยไม่มี error บอกสาเหตุเลย เพราะ gateway ไม่ตอบ voice event ของ guild ที่บอทไม่ได้อยู่)
    if (GUILD && GUILD !== ch.guildId) {
      console.warn(`⚠️ DISCORD_GUILD_ID ใน .env (${GUILD}) ไม่ตรงกับ guild จริงของห้อง (${ch.guildId}) — ใช้ของจริง`);
    }
    connection = joinVoiceChannel({
      channelId: VOICE_CH,
      guildId: ch.guildId,
      adapterCreator: ch.guild.voiceAdapterCreator,
      selfDeaf: false, // เฟส 3: ต้องได้ยินเจ้าของพูด (Discord ไม่ส่งเสียงตัวเองกลับมาอยู่แล้ว)
      selfMute: false,
    });
    connection.subscribe(player);
    connection.on("stateChange", (o, n) => console.log(`  voice: ${o.status} → ${n.status}`));
    connection.on("error", (e) => console.error("  voice error:", e?.message));

    // ต่อกลับเอง: Discord ย้าย region หรือเน็ตสะดุด = สถานะเป็น Disconnected ชั่วคราว
    // ถ้ากลับมาเป็น Connecting/Signalling ได้ใน 5 วิ แปลว่าย้ายเซิร์ฟเวอร์ ไม่ใช่โดนเตะ
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        console.warn("หลุดจากห้องเสียง — เข้าใหม่ใน 5 วิ");
        try { connection.destroy(); } catch { /* ปิดไปแล้ว */ }
        connection = null;
        setTimeout(connectVoice, 5000);
      }
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    console.log(`เข้าห้องเสียงแล้ว: ${ch.name}`);
    attachReceiver();
    await refreshPresence();
  } catch (e) {
    console.error("เข้าห้องเสียงไม่ได้:", e?.message, "— ลองใหม่ใน 15 วิ");
    connection = null;
    setTimeout(connectVoice, 15_000);
  }
}

/**
 * พูดข้อความออกลำโพง — คืน true เมื่อพูดจบจริง
 * TTS ของระบบคืน OGG/Opus อยู่แล้ว = ป้อนเข้า Discord ได้ตรง ๆ ไม่ต้องเข้ารหัสใหม่
 */
async function speak(oggBuffer) {
  if (!connection || !ownerInVoice) return false;
  if (speaking) return false; // พูดทับกันไม่ได้ (ตัวเรียกจะเอาเข้าคิวรอรอบหน้า)
  speaking = true;
  try {
    const resource = createAudioResource(Readable.from(oggBuffer), { inputType: StreamType.OggOpus });
    player.play(resource);
    await entersState(player, AudioPlayerStatus.Playing, 10_000);
    await entersState(player, AudioPlayerStatus.Idle, 5 * 60_000);
    return true;
  } catch (e) {
    console.error("เล่นเสียงไม่สำเร็จ:", e?.message);
    return false;
  } finally {
    speaking = false;
  }
}

player.on("error", (e) => console.error("player error:", e?.message));

// ===== เสียงขาเข้า (เฟส 3) =====
//
// ด่านกรองซ้อนกัน 4 ชั้น กันทั้งค่าใช้จ่ายและการแทรกผิดจังหวะ:
//   1. Discord VAD  — เงียบ = ไม่มีเสียงส่งมาเลย ฟรี ไม่กิน CPU ไม่กินเงิน
//   2. ตัดประโยคเมื่อเงียบ 900ms — ได้ประโยคเป็นก้อน ๆ ไม่ใช่สายยาวไม่รู้จบ
//   3. ตัวกรองความยาว — สั้นกว่า 0.6 วิ = เสียงกระแทก/ไอ/เสียงรบกวน ทิ้ง
//   4. เพดานจำนวนต่อนาที — กันเสียงทีวี/คลิปเปิดค้างแล้วยิง STT รัว ๆ
//
// ที่เหลือ (คำปลุก โหมด กรองว่าพูดกับใคร) ตัดสินที่ฝั่งสมอง ไม่ใช่ที่นี่

const MIN_UTTER_MS = 600;
const SILENCE_MS = 900;
const MAX_STT_PER_MIN = 25;
let sttWindow = [];
const listening = new Set();
let lastCueAt = 0;

function sttBudgetOk() {
  const now = Date.now();
  sttWindow = sttWindow.filter((t) => now - t < 60_000);
  if (sttWindow.length >= MAX_STT_PER_MIN) return false;
  sttWindow.push(now);
  return true;
}

/** เสียงสัญญาณสั้น ๆ — สร้างครั้งเดียวแล้วใช้ซ้ำ (ตอบรับต้องทันที ไม่ทันรอ TTS) */
const cues = {};
function makeCue(name, spec) {
  return new Promise((resolve) => {
    const args = ["-y", "-f", "lavfi", "-i", spec, "-c:a", "libopus", "-b:a", "48k", "-f", "ogg", "pipe:1"];
    const ff = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks = [];
    ff.stdout.on("data", (d) => chunks.push(d));
    ff.on("close", () => { cues[name] = Buffer.concat(chunks); resolve(); });
    ff.on("error", () => resolve());
  });
}
async function buildCues() {
  // ตุ๊บเบา ๆ ตอนถูกเรียก · สองโทนขึ้น = เปิดโหมด · สองโทนลง = ปิดโหมด (สเปกข้อ 6)
  await makeCue("wake", "sine=frequency=880:duration=0.09,volume=0.25");
  await makeCue("mode-on", "sine=frequency=660:duration=0.1,volume=0.3[a];sine=frequency=990:duration=0.1,volume=0.3[b];[a][b]concat=n=2:v=0:a=1");
  await makeCue("mode-off", "sine=frequency=990:duration=0.1,volume=0.3[a];sine=frequency=560:duration=0.1,volume=0.3[b];[a][b]concat=n=2:v=0:a=1");
  console.log(`เสียงสัญญาณพร้อม: ${Object.keys(cues).filter((k) => cues[k]?.length).join(", ")}`);
}

/** เล่นเสียงสัญญาณแทรกได้ทันที ไม่ต้องเข้าคิว (ต้องตอบรับภายในเสี้ยววินาที) */
async function playCue(name) {
  const buf = cues[name];
  if (!buf?.length || !connection || !ownerInVoice) return;
  if (Date.now() - lastCueAt < 400) return;
  lastCueAt = Date.now();
  try {
    player.play(createAudioResource(Readable.from(buf), { inputType: StreamType.OggOpus }));
  } catch { /* เสียงสัญญาณพลาดไม่เป็นไร */ }
}

/** Opus จาก Discord → PCM → OGG ที่ Gemini อ่านได้ (ไม่มีตัวมัด Ogg ใน prism 1.x เลยถอดแล้วเข้ารหัสใหม่) */
function opusToOgg(opusStream, outPath) {
  return new Promise((resolve, reject) => {
    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
    const ff = spawn(FFMPEG, [
      "-y", "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", "pipe:0",
      "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", outPath,
    ], { stdio: ["pipe", "ignore", "ignore"] });
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error("ffmpeg exit " + code))));
    ff.on("error", reject);
    pipeline(opusStream, decoder, ff.stdin, (err) => { if (err) ff.kill("SIGKILL"); });
  });
}

/** ส่งประโยคที่ได้ยินไปให้สมองตัดสิน แล้วทำตามที่มันสั่ง */
async function handleUtterance(oggPath) {
  try {
    const res = await fetch(APP_URL + "/api/kiki/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify({ path: oggPath, speaking }),
      signal: AbortSignal.timeout(240_000),
    });
    if (!res.ok) return;
    const { action, heard } = await res.json();
    if (heard) console.log(`  ได้ยิน: "${heard}"${action.do === "ignore" ? ` → ข้าม (${action.why})` : ""}`);
    switch (action.do) {
      case "stop":
        player.stop(true);
        console.log("  → สั่งหยุด หยุดพูดทันที");
        break;
      case "undo":
        console.log("  → สั่งถอน");
        await fetch(APP_URL + "/api/kiki/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
          body: JSON.stringify({ chatId: TEXT_CH, text: "ถอนข้อความที่เพิ่งส่ง", fromId: OWNER, platform: "discord", channel: "discord-voice", msgId: String(Date.now()) }),
        }).catch(() => {});
        break;
      case "cue":
        await playCue(action.cue);
        if (action.mode) {
          console.log(`  → เปลี่ยนโหมดเป็น "${action.label}"`);
          renameVoiceChannel(action.label);
        }
        break;
      case "say": {
        const ogg = await tts(action.text);
        if (ogg) await speak(ogg);
        break;
      }
    }
  } catch (e) {
    console.error("  ประมวลผลเสียงพลาด:", e?.message);
  }
}

/**
 * ชื่อห้องบอกโหมดปัจจุบัน — เห็นจากมือถือทันทีโดยไม่ต้องถาม (สเปกข้อ 6)
 * Discord จำกัดการเปลี่ยนชื่อห้องไว้ 2 ครั้ง/10 นาที เกินแล้วคำขอจะค้าง
 * เลยหน่วงไว้ และถือว่าเสียงสัญญาณเป็นตัวบอกหลัก ชื่อห้องเป็นตัวเสริม
 */
let lastRename = 0;
let pendingRename = null;
async function renameVoiceChannel(label) {
  pendingRename = label;
  const wait = Math.max(0, 5 * 60_000 - (Date.now() - lastRename));
  setTimeout(async () => {
    if (!pendingRename) return;
    const name = `สาย · ${pendingRename}`;
    pendingRename = null;
    lastRename = Date.now();
    try {
      const ch = await client.channels.fetch(VOICE_CH);
      if (ch && ch.name !== name) await ch.setName(name);
    } catch (e) {
      console.warn("เปลี่ยนชื่อห้องไม่ได้ (Discord จำกัด 2 ครั้ง/10 นาที):", e?.message);
    }
  }, wait);
}

/** เริ่มฟังเจ้าของ — เรียกใหม่ทุกครั้งที่เขาเริ่มพูด */
function listenTo(userId, receiver) {
  if (listening.has(userId)) return;
  listening.add(userId);
  const started = Date.now();
  const outPath = path.join(os.tmpdir(), `vex-hear-${started}-${Math.floor(Math.random() * 1e6)}.ogg`);
  // ตอน Vex กำลังพูด ให้ตัดประโยคไวขึ้น — คำสั่ง "Vex พอ" ต้องถึงเร็วที่สุด
  const silence = speaking ? 500 : SILENCE_MS;
  const opus = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: silence } });
  opusToOgg(opus, outPath)
    .then(async () => {
      listening.delete(userId);
      const ms = Date.now() - started;
      if (ms < MIN_UTTER_MS) { await fs.promises.rm(outPath, { force: true }).catch(() => {}); return; }
      if (!sttBudgetOk()) {
        console.warn("  เกินเพดานถอดเสียงต่อนาที — ข้ามประโยคนี้");
        await fs.promises.rm(outPath, { force: true }).catch(() => {});
        return;
      }
      await handleUtterance(outPath);
    })
    .catch(async () => {
      listening.delete(userId);
      await fs.promises.rm(outPath, { force: true }).catch(() => {});
    });
}

function attachReceiver() {
  if (!connection?.receiver) return;
  const receiver = connection.receiver;
  receiver.speaking.removeAllListeners("start");
  receiver.speaking.on("start", (userId) => {
    if (OWNER && userId !== OWNER) return; // ในเซิร์ฟเวอร์มีแค่เจ้าของกับบอท แต่กันไว้
    listenTo(userId, receiver);
  });
  console.log("เริ่มฟังเสียงในห้องแล้ว");
}

// ===== วนหยิบงานจากกล่องขาออกของเว็บ =====
// เว็บไม่รู้ว่าเจ้าของอยู่ในสายไหม (คนละโปรเซส) — ท่อนี้เป็นคนบอก แล้วรับงานกลับมาส่ง
let pollBusy = false;
async function pollOutbox() {
  if (pollBusy) return;
  pollBusy = true;
  const done = [];
  try {
    await refreshPresence();
    const res = await fetch(APP_URL + "/api/kiki/outbox", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify({ inVoice: ownerInVoice, done: pendingAck.splice(0) }),
    });
    if (!res.ok) return;
    const { items } = await res.json();
    for (const it of items || []) {
      try {
        if (it.target === "discord-voice") {
          if (!ownerInVoice) continue; // ออกจากห้องระหว่างทาง = ปล่อยค้างไว้ในกล่อง รอรอบหน้า
          const ogg = await tts(it.speak);
          if (!ogg) { done.push({ id: it.id, error: "แปลงเป็นเสียงไม่ได้" }); continue; }
          const spoke = await speak(ogg);
          if (spoke) done.push({ id: it.id });
        } else {
          const ch = await client.channels.fetch(TEXT_CH);
          const head = it.topic ? `**${it.topic}**\n` : "";
          for (const part of chunk(head + htmlToDiscord(it.text || ""))) await ch.send(part);
          done.push({ id: it.id });
        }
      } catch (e) {
        done.push({ id: it.id, error: e?.message?.slice(0, 200) || "error" });
      }
    }
  } catch { /* รอบหน้าลองใหม่ */ } finally {
    pendingAck.push(...done);
    pollBusy = false;
  }
}
const pendingAck = [];

// ขอไฟล์เสียงจากเว็บ (สมองเป็นคนเลือกเจ้า/เสียงตามค่าตั้งค่า ท่อไม่ต้องรู้จักโมเดลอะไร)
async function tts(text) {
  try {
    const res = await fetch(APP_URL + "/api/kiki/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null;
    const { ogg } = await res.json();
    return ogg ? Buffer.from(ogg, "base64") : null;
  } catch {
    return null;
  }
}

// ===== เริ่มทำงาน =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates, // รู้ว่าใครอยู่ในห้องเสียง (ไม่ใช่ intent ที่ต้องขออนุญาต)
  ],
  partials: [Partials.Channel],
});

client.on(Events.VoiceStateUpdate, () => { refreshPresence().catch(() => {}); });

client.once(Events.ClientReady, async (c) => {
  console.log(`Vex พร้อมทำงานบน Discord: ${c.user.tag} · app ${APP_URL}`);
  console.log(`ห้องข้อความ ${TEXT_CH} · ห้องบันทึก ${LOG_CH} · ห้องเสียง ${VOICE_CH} · เจ้าของ ${OWNER}`);
  if (!OWNER) console.warn("⚠️ ยังไม่ได้ตั้ง DISCORD_OWNER_ID — API จะไม่รู้ว่าใครเป็นเจ้าของ");
  await buildCues();
  // ตั้งตัววนหยิบงานก่อนเข้าห้องเสียง — ถ้าห้องเสียงต่อไม่ได้ ฝั่งข้อความต้องยังทำงานได้ปกติ
  // (เคยพลาด: connectVoice ค้างรอสถานะ Ready 20 วิ แล้วบล็อกไม่ให้ตัววนหยิบงานเริ่มเลย)
  setInterval(pollOutbox, 5000);
  await connectVoice();
  setInterval(() => {
    if (!connection) connectVoice().catch(() => {});
    refreshPresence().catch(() => {});
  }, 30_000);
});

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return;
  // ด่านชั้นแรกที่ท่อ (ชั้นจริงอยู่ที่ประตูเจ้าของใน API) — คนอื่นพิมพ์มา ไม่ต้องเปลืองเรียกสมอง
  if (OWNER && msg.author.id !== OWNER) return;
  // ห้องบันทึกเป็นที่เก็บล็อก ไม่ใช่ที่คุย
  if (LOG_CH && msg.channelId === LOG_CH) return;

  const files = await downloadAttachments(msg);
  const text = (msg.content || "").trim();
  if (!text && !files.imageFiles.length && !files.audioFiles.length && !files.docFiles.length && !files.videoFiles.length) return;

  let replyText = "";
  if (msg.reference?.messageId) {
    try {
      const ref = await msg.channel.messages.fetch(msg.reference.messageId);
      replyText = ref?.content || "";
    } catch { /* ข้อความที่ reply ถึงถูกลบไปแล้ว */ }
  }

  // แสดงว่ากำลังคิดอยู่ (Discord โชว์ "กำลังพิมพ์" ~10 วิต่อครั้ง ต้องต่ออายุระหว่างรอ)
  msg.channel.sendTyping().catch(() => {});
  const typing = setInterval(() => msg.channel.sendTyping().catch(() => {}), 8000);

  try {
    const sends = await callBrain({
      chatId: msg.channelId,
      text,
      fromId: msg.author.id,
      fromName: msg.author.globalName || msg.author.username || "",
      platform: "discord",
      channel: "discord",
      isGroup: false,
      chatTitle: msg.channel?.name || "",
      replyText,
      ...files,
      msgId: msg.id,
    });
    clearInterval(typing);
    await deliver(client, msg.channelId, sends, msg);
  } catch (e) {
    clearInterval(typing);
    console.error("ตอบไม่ได้:", e?.message);
    await msg.reply("ระบบหลังบ้านไม่ตอบครับ (ลองไป 3 รอบแล้ว) เดี๋ยวลองพิมพ์ใหม่อีกทีนะครับ").catch(() => {});
  }
});

// ปุ่มถูกกด → ตอบรับทันทีกันวงหมุน แล้วส่ง customId เข้าสมองเป็น callbackData
client.on(Events.InteractionCreate, async (itx) => {
  if (!itx.isButton()) return;
  if (OWNER && itx.user.id !== OWNER) {
    await itx.reply({ content: "ปุ่มนี้ไม่ใช่ของคุณครับ", ephemeral: true }).catch(() => {});
    return;
  }
  await itx.deferUpdate().catch(() => {});
  // เอาปุ่มออกจากข้อความเดิม กันกดซ้ำ (เหมือนฝั่ง Telegram)
  await itx.message.edit({ components: [] }).catch(() => {});
  try {
    const sends = await callBrain({
      chatId: itx.channelId,
      text: "",
      callbackData: itx.customId,
      fromId: itx.user.id,
      fromName: itx.user.globalName || itx.user.username || "",
      platform: "discord",
      channel: "discord",
      msgId: itx.message.id,
    });
    await deliver(client, itx.channelId, sends, null);
  } catch (e) {
    console.error("ปุ่มพัง:", e?.message);
  }
});

client.on(Events.Error, (e) => console.error("discord error:", e?.message));
client.on(Events.ShardDisconnect, (_, id) => console.warn(`shard ${id} หลุด — discord.js จะต่อกลับเอง`));
client.on(Events.ShardReconnecting, (id) => console.log(`shard ${id} กำลังต่อกลับ`));

client.login(TOKEN);
