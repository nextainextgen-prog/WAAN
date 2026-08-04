// Vex (kiki) — บอทเลขาส่วนตัวของเจ้าของ (คนละตัว/คนละโทเค็นกับน้องวาน)
// รัน: node scripts/kiki-bot.mjs  (ต้องรัน backend คู่กัน — สมองอยู่ที่ /api/kiki/ingest)
// ทุกข้อความในแชทที่ Vex อยู่ = ประมวลผลหมด ไม่ต้องแท็ก (กลุ่มส่วนตัวของเจ้าของคนเดียว)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function loadEnv() {
  const p = path.join(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const TOKEN = process.env.KIKI_BOT_TOKEN;
const INTERNAL = process.env.INTERNAL_API_TOKEN;
const APP_URL = process.env.APP_URL || "http://localhost:3000";
if (!TOKEN) { console.error("ไม่พบ KIKI_BOT_TOKEN ใน .env"); process.exit(1); }

const API = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;
let BOT_ID = 0;
let PRIVACY_ON = false; // ยังไม่ปิด privacy mode = เห็นแต่ /คำสั่ง กับ reply — ต้องเตือนเจ้าของ
const privacyWarned = new Set();

async function tg(method, body) {
  const res = await fetch(API(method), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}

async function reactMsg(chatId, messageId, emoji) {
  if (!messageId || !emoji) return;
  await tg("setMessageReaction", { chat_id: chatId, message_id: messageId, reaction: [{ type: "emoji", emoji }] }).catch(() => {});
}

async function downloadFile(file_id, destDir, filename) {
  const gf = await tg("getFile", { file_id });
  if (!gf.ok) return null;
  const url = `https://api.telegram.org/file/bot${TOKEN}/${gf.result.file_path}`;
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const safe = filename.replace(/[^\w.\-ก-๙ ()]/g, "_");
  const p = path.join(destDir, safe);
  fs.writeFileSync(p, buf);
  return p;
}

// วิดีโอ/GIF ที่เจ้าของส่งมา (เก็บเข้าคลังได้เมื่อสั่ง)
function videoOf(msg) {
  if (msg.video) return { file_id: msg.video.file_id, file_name: msg.video.file_name || `video_${msg.video.file_id}.mp4` };
  if (msg.animation) return { file_id: msg.animation.file_id, file_name: msg.animation.file_name || `gif_${msg.animation.file_id}.mp4` };
  if (msg.document && /video\//.test(msg.document.mime_type || "")) {
    return { file_id: msg.document.file_id, file_name: msg.document.file_name || `video_${msg.document.file_id}.mp4` };
  }
  return null;
}

function fileOf(msg) {
  if (msg.photo && msg.photo.length) {
    const p = msg.photo[msg.photo.length - 1];
    return { file_id: p.file_id, file_name: `photo_${p.file_id}.jpg`, isImage: true };
  }
  if (msg.document) {
    const isImage = /image\//.test(msg.document.mime_type || "") || /\.(jpe?g|png|webp)$/i.test(msg.document.file_name || "");
    return { file_id: msg.document.file_id, file_name: msg.document.file_name || `file_${msg.document.file_id}.bin`, isImage };
  }
  return null;
}

// เสียง/วิดีโอโน้ตที่เจ้าของอัดส่งมา (สั่งงานด้วยเสียงแทนการพิมพ์)
function audioOf(msg) {
  if (msg.voice) return { file_id: msg.voice.file_id, file_name: `voice_${msg.voice.file_id}.ogg`, mime: msg.voice.mime_type || "audio/ogg" };
  if (msg.audio) return { file_id: msg.audio.file_id, file_name: msg.audio.file_name || `audio_${msg.audio.file_id}.mp3`, mime: msg.audio.mime_type || "audio/mpeg" };
  if (msg.video_note) return { file_id: msg.video_note.file_id, file_name: `vnote_${msg.video_note.file_id}.mp4`, mime: "video/mp4" };
  return null;
}

// ===== ส่งผลลัพธ์จาก API เข้าแชท =====
async function deliver(chatId, sends) {
  for (const s of sends || []) {
    const target = s.chatId || chatId;
    if (s.kind === "text" && s.text) {
      const chunks = s.text.match(/[\s\S]{1,3900}/g) || [s.text];
      for (let i = 0; i < chunks.length; i++) {
        await tg("sendMessage", {
          chat_id: target,
          text: chunks[i],
          ...(s.parseMode ? { parse_mode: s.parseMode } : {}),
          ...(s.noPreview ? { link_preview_options: { is_disabled: true } } : {}),
          ...(i === 0 && s.replyTo ? { reply_to_message_id: s.replyTo, allow_sending_without_reply: true } : {}),
          // ปุ่มกดยืนยัน (เจ้าของสั่ง 3 ส.ค.: ไม่ต้องพิมพ์ "ยืนยัน" แล้ว)
          ...(i === chunks.length - 1 && s.buttons
            ? { reply_markup: { inline_keyboard: s.buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } }
            : {}),
        }).catch((e) => console.error("send text err:", e?.message));
      }
    } else if (s.kind === "photo" && s.dataBase64) {
      await tg("sendChatAction", { chat_id: target, action: "upload_photo" }).catch(() => {});
      const form = new FormData();
      form.append("chat_id", String(target));
      if (s.caption) form.append("caption", s.caption);
      if (s.replyTo) {
        form.append("reply_to_message_id", String(s.replyTo));
        form.append("allow_sending_without_reply", "true");
      }
      form.append("photo", new Blob([new Uint8Array(Buffer.from(s.dataBase64, "base64"))]), s.filename || "image.png");
      await fetch(API("sendPhoto"), { method: "POST", body: form }).catch((e) => console.error("send photo err:", e?.message));
    } else if (s.kind === "voice" && s.dataBase64) {
      await tg("sendChatAction", { chat_id: target, action: "record_voice" }).catch(() => {});
      const form = new FormData();
      form.append("chat_id", String(target));
      if (s.caption) form.append("caption", s.caption);
      form.append("voice", new Blob([new Uint8Array(Buffer.from(s.dataBase64, "base64"))]), s.filename || "voice.ogg");
      await fetch(API("sendVoice"), { method: "POST", body: form }).catch((e) => console.error("send voice err:", e?.message));
    } else if (s.kind === "video" && s.dataBase64) {
      await tg("sendChatAction", { chat_id: target, action: "upload_video" }).catch(() => {});
      const form = new FormData();
      form.append("chat_id", String(target));
      if (s.caption) form.append("caption", s.caption);
      form.append("video", new Blob([new Uint8Array(Buffer.from(s.dataBase64, "base64"))]), s.filename || "video.mp4");
      await fetch(API("sendVideo"), { method: "POST", body: form }).catch((e) => console.error("send video err:", e?.message));
    } else if (s.kind === "document" && s.dataBase64) {
      await tg("sendChatAction", { chat_id: target, action: "upload_document" }).catch(() => {});
      const form = new FormData();
      form.append("chat_id", String(target));
      if (s.caption) form.append("caption", s.caption);
      form.append("document", new Blob([new Uint8Array(Buffer.from(s.dataBase64, "base64"))]), s.filename || "file");
      await fetch(API("sendDocument"), { method: "POST", body: form }).catch((e) => console.error("send doc err:", e?.message));
    }
  }
}

// ===== รวมอัลบั้มรูป (media_group) ก่อนค่อยประมวลผลทีเดียว =====
const albums = {}; // media_group_id -> { msgs, timer }

async function processMessage(msgs) {
  const msg = msgs[0];
  const chatId = String(msg.chat.id);
  const chatType = msg.chat.type || "private";
  const isGroup = chatType === "group" || chatType === "supergroup";
  const from = msg.from || {};
  if (from.is_bot) return;

  const text = msgs.map((m) => m.text || m.caption || "").filter(Boolean).join("\n").trim();
  const reply = msg.reply_to_message;
  const replyText = reply ? (reply.text || reply.caption || "") : "";
  // reply ใส่ "ภาพหน้าจอที่ Vex แคปมา" = คำสั่งเกี่ยวกับสิ่งที่อยู่ในภาพนั้น ไม่ใช่กลุ่มแชท
  const replyIsScreenshot = Boolean(reply && reply.photo && reply.from && reply.from.is_bot);

  // ยังไม่ปิด privacy = ข้อความปกติในกลุ่มมาไม่ถึง Vex — เตือนครั้งเดียวต่อกลุ่ม
  if (PRIVACY_ON && isGroup && !privacyWarned.has(chatId)) {
    privacyWarned.add(chatId);
    await tg("sendMessage", {
      chat_id: chatId,
      text: "⚠️ ตอนนี้ผมยังเห็นแค่ข้อความที่ขึ้นต้น / หรือ reply หาผมเท่านั้นครับ\n\nแก้ที่ @BotFather → /setprivacy → เลือกผม → Disable\nแล้วเตะผมออกจากกลุ่ม เชิญเข้าใหม่อีกรอบ ถึงจะเห็นทุกข้อความครับ",
    }).catch(() => {});
  }

  // โหลดรูปทั้งหมด (รูปตรง ๆ + เอกสารที่เป็นรูป) ให้สมองเปิดอ่าน
  const files = msgs.map(fileOf).filter(Boolean);
  const audios = msgs.map(audioOf).filter(Boolean);
  const videos = msgs.map(videoOf).filter(Boolean);
  const imageFiles = [];
  const videoFiles = [];
  // เอกสาร pdf/docx/txt/md → ส่งให้สมองสรุปเก็บเข้าคลังความรู้
  const docFiles = [];
  const audioFiles = [];
  if (files.length || audios.length || videos.length) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiki-img-"));
    for (const v of videos.slice(0, 2)) {
      try {
        const p = await downloadFile(v.file_id, dir, v.file_name);
        if (p) videoFiles.push({ path: p, name: v.file_name });
      } catch { /* ข้ามวิดีโอที่โหลดไม่ได้ */ }
    }
    for (const f of files.filter((x) => x.isImage).slice(0, 6)) {
      try {
        const p = await downloadFile(f.file_id, dir, f.file_name);
        if (p) imageFiles.push(p);
      } catch { /* ข้ามรูปที่โหลดไม่ได้ */ }
    }
    for (const a of audios.slice(0, 3)) {
      try {
        const p = await downloadFile(a.file_id, dir, a.file_name);
        if (p) audioFiles.push({ path: p, mime: a.mime });
      } catch { /* ข้ามเสียงที่โหลดไม่ได้ */ }
    }
    for (const f of files.filter((x) => !x.isImage && /\.(pdf|docx|txt|md)$/i.test(x.file_name || "")).slice(0, 3)) {
      try {
        const p = await downloadFile(f.file_id, dir, f.file_name);
        if (p) docFiles.push({ path: p, name: f.file_name });
      } catch { /* ข้ามไฟล์ที่โหลดไม่ได้ */ }
    }
  }
  if (!text && !imageFiles.length && !audioFiles.length && !docFiles.length && !videoFiles.length) return;

  await reactMsg(chatId, msg.message_id, audioFiles.length || imageFiles.length ? "👀" : null);
  await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  const typing = setInterval(() => tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {}), 4500);

  // ลองใหม่เองก่อนยอมแพ้ — เว็บอาจกำลังรีสตาร์ท (บูต ~10 วิ) ไม่ใช่เหตุให้ทิ้งข้อความเจ้าของ
  const body = JSON.stringify({
    chatId,
    text,
    fromId: String(from.id || ""),
    fromName: [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || "",
    isGroup,
    chatTitle: msg.chat.title || "",
    replyText,
    replyIsScreenshot,
    imageFiles,
    audioFiles,
    docFiles,
    videoFiles,
    msgId: msg.message_id,
  });
  const waits = [0, 5000, 12000];
  let lastErr = null;
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) await new Promise((r) => setTimeout(r, waits[i]));
    try {
      const ctl = new AbortController();
      const killer = setTimeout(() => ctl.abort(), 250000);
      const res = await fetch(APP_URL + "/api/kiki/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
        body,
        signal: ctl.signal,
      });
      clearTimeout(killer);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      clearInterval(typing);
      await deliver(chatId, data.sends || []);
      return;
    } catch (e) {
      lastErr = e;
      console.error(`ingest err (รอบ ${i + 1}/${waits.length}):`, e?.message);
    }
  }
  clearInterval(typing);
  await tg("sendMessage", { chat_id: chatId, text: "ระบบหลังบ้านไม่ตอบครับ ⚠️ (ลองไป 3 รอบแล้ว) เดี๋ยวลองพิมพ์ใหม่อีกทีนะครับ" }).catch(() => {});
}

// ปุ่มถูกกด → ตอบรับทันที (หยุดวงหมุน) แล้วส่งเข้า ingest เป็น callbackData
async function handleCallback(cq) {
  await tg("answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {});
  const msg = cq.message;
  if (!msg) return;
  const chatId = String(msg.chat.id);
  const body = JSON.stringify({
    chatId,
    text: "",
    callbackData: String(cq.data || ""),
    fromId: String(cq.from?.id || ""),
    fromName: [cq.from?.first_name, cq.from?.last_name].filter(Boolean).join(" ") || cq.from?.username || "",
    msgId: msg.message_id,
  });
  try {
    const res = await fetch(APP_URL + "/api/kiki/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body,
    });
    const data = await res.json();
    // เอาปุ่มออกจากข้อความเดิม กันกดซ้ำ
    await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    await deliver(chatId, data.sends || []);
  } catch (e) {
    console.error("callback err:", e?.message);
  }
}

function handleMessage(msg) {
  const gid = msg.media_group_id;
  if (!gid) return processMessage([msg]);
  // อัลบั้ม: บัฟเฟอร์ 1.5 วิ รอรูปมาครบก่อน
  const a = albums[gid] || (albums[gid] = { msgs: [] });
  a.msgs.push(msg);
  if (a.timer) clearTimeout(a.timer);
  a.timer = setTimeout(() => {
    const msgs = a.msgs;
    delete albums[gid];
    processMessage(msgs).catch((e) => console.error("album err:", e?.message));
  }, 1500);
}

async function main() {
  const me = await tg("getMe", {});
  if (!me.ok) { console.error("KIKI_BOT_TOKEN ไม่ถูกต้อง:", JSON.stringify(me)); process.exit(1); }
  BOT_ID = me.result.id;
  PRIVACY_ON = !me.result.can_read_all_group_messages;
  console.log(`Vex พร้อมทำงาน: @${me.result.username} (id ${BOT_ID}) · app ${APP_URL}`);
  if (PRIVACY_ON) console.warn("⚠️ privacy mode ยังเปิดอยู่ — Vex จะไม่เห็นข้อความกลุ่มปกติ (แก้ที่ BotFather /setprivacy → Disable แล้วเชิญเข้ากลุ่มใหม่)");
  await tg("deleteWebhook", { drop_pending_updates: false });

  // งานตามเวลา (เตือนนัด/สรุปเช้า/สรุปสิ้นเดือน) — เช็คทุก 1 นาที
  const cron = async () => {
    try {
      const r = await fetch(APP_URL + "/api/kiki/cron", {
        method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      });
      const j = await r.json();
      for (const s of j.sends || []) await deliver(s.chatId, [s]);
    } catch { /* รอบหน้าลองใหม่ */ }
  };
  setTimeout(cron, 20000);
  setInterval(cron, 60 * 1000);

  let offset = 0;
  while (true) {
    try {
      const res = await fetch(API("getUpdates"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offset, timeout: 30, allowed_updates: ["message", "callback_query"] }),
      });
      const data = await res.json();
      if (!data.ok) { await new Promise((r) => setTimeout(r, 3000)); continue; }
      for (const u of data.result) {
        offset = u.update_id + 1;
        if (u.message) handleMessage(u.message);
        if (u.callback_query) handleCallback(u.callback_query);
      }
    } catch (e) { console.error("poll err:", e.message); await new Promise((r) => setTimeout(r, 3000)); }
  }
}
main();
