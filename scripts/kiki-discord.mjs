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
import {
  Client, GatewayIntentBits, Partials, Events,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder,
} from "discord.js";

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

// ===== เริ่มทำงาน =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Vex พร้อมทำงานบน Discord: ${c.user.tag} · app ${APP_URL}`);
  console.log(`ห้องข้อความ ${TEXT_CH} · ห้องบันทึก ${LOG_CH} · เจ้าของ ${OWNER}`);
  if (!OWNER) console.warn("⚠️ ยังไม่ได้ตั้ง DISCORD_OWNER_ID — API จะไม่รู้ว่าใครเป็นเจ้าของ");
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
