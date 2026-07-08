// Telegram bot (long-polling) — น้องวาน: แชทเลขา + ออกเอกสารคืนเงินจากไฟล์ที่แนบ
// รัน: node scripts/telegram-bot.mjs  (ต้องรัน backend คู่กัน)
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

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const INTERNAL = process.env.INTERNAL_API_TOKEN;
const APP_URL = process.env.APP_URL || "http://localhost:3000";
if (!TOKEN) { console.error("ไม่พบ TELEGRAM_BOT_TOKEN"); process.exit(1); }

const API = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;
let BOT_USERNAME = "";
let BOT_ID = 0;
let OWNER_CHAT_ID = ""; // แชทส่วนตัวเจ้าของ (ไว้แจ้งเตือนเมื่อทำงานเสร็จ) — ดึงตอนสตาร์ท
let ROSTER = [];        // รายชื่อทีม [{id,name,username,realName}] — ไว้แท็กตามชื่อที่พิมพ์
let MANAGER = null;     // ผู้จัดการที่ต้องแท็กเรื่องเอกสารคืนเงิน (พี่หนิง)
async function tg(method, body) {
  const res = await fetch(API(method), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}

// กด/เปลี่ยนอิโมจิรีแอคชันบนข้อความผู้ใช้ (บอทกดได้เอง ไม่ต้องสิทธิ์แอดมิน)
async function reactMsg(chatId, messageId, emoji) {
  if (!messageId || !emoji) return;
  await tg("setMessageReaction", {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: "emoji", emoji }],
  }).catch(() => {});
}

// วิเคราะห์ข้อความแล้วเลือกอิโมจิที่เหมาะ: 🔥 ชม/ตื่นเต้น · ✅ ยืนยัน/ตกลง · 👀 ตรวจ-ดู-ไฟล์ · 👌 รับงานทั่วไป
function pickReaction(text, { hasFiles = false, isAff = false, isMemo = false } = {}) {
  const t = text || "";
  if (/เก่ง|เยี่ยม|สุดยอด|เจ๋ง|ดีมาก|เท่ห์|ปัง|โคตร|ขอบคุณ|ขอบใจ|thank|ว้าว|👍|❤️|🔥|ชอบมาก|รักเลย/i.test(t)) return "🔥";
  if (/^\s*(โอเคร?|okay|ok|ตกลง|ได้เลย|ใช่|เรียบร้อย|จัดไป|รับทราบ|เยส|yes)/i.test(t) || /ถูกต้อง|ถูกแล้ว|เห็นด้วย|อนุมัติแล้ว|ผ่านเลย/.test(t)) return "✅";
  if (isAff || hasFiles || /ตรวจ|เช็ก|เช็ค|ดูให้|ดูหน่อย|อ่านให้|วิเคราะห์|สรุป(ไฟล์|เอกสาร)|เทียบ|เท่าไห?ร่|กี่|ยอด|สถานะ|คืบหน้า|deadline|ครบกำหนด/.test(t)) return "👀";
  if (isMemo || /สไลด์|slide|ทำ|สร้าง|ออกเอกสาร|ขอ|ช่วย|generate|วาด|เขียน|หา(ให้|ข้อมูล)|สรุป/i.test(t)) return "👌";
  return null; // ทักทาย/คุยเล่นสั้นๆ ไม่ต้องกด
}

const MEMO_INTENT = /คืนเงิน|หัก\s*ณ\s*ที่จ่าย|ออกเอกสาร|ส่วนต่าง|ส่วนเกิน/;
// เอกสาร Affiliate ของแอดมิน (ตรวจอัตโนมัติ): มี PDF แนบ + ข้อความสรุปแพตเทิร์นเดิม
const AFF_INTENT = /ยูสเซอร์|ยูเซอร์|user\s*name|username/i;
const AFF_INTENT2 = /จำนวนเงินที่ถอน|จำนวนเงินที่ถูกหัก|เลขผู้เสียภาษี|เลขประจำตัวผู้เสียภาษี/;
function isAffDoc(text, files) {
  const hasPdf = (files || []).some((f) => /\.pdf$/i.test(f.file_name || ""));
  return hasPdf && AFF_INTENT.test(text) && AFF_INTENT2.test(text);
}
const groups = {};          // media_group_id -> {msgs, timer, chatId}
const recentFiles = {};     // chatId -> [{file_id,file_name,ts}]
const recentTexts = {};     // chatId -> [{text,ts}] เก็บข้อความ/แคปชัน (รวมที่ forward มา) ข้าม batch
const armedUntil = {};      // chatId -> timestamp (ถูกเรียกแล้ว รอข้อความ/forward ถัดไป)
const memoPending = {};     // chatId -> timestamp (สั่งออกเอกสารแล้วแต่ยังรอไฟล์/เนื้อหา forward ตามมา)
const affPending = {};      // chatId -> timestamp (สั่งตรวจเอกสาร AFF แล้วแต่ยังรอไฟล์ forward ตามมา)
const editingMemo = {};     // chatId -> {id, until} (กด "แก้ไข" แล้ว รอคำสั่งแก้เอกสารตัวนี้)
const BUFFER_TTL = 180000;  // 3 นาที
const EDIT_TTL = 300000;    // 5 นาที (รอคำสั่งแก้เอกสารหลังกดปุ่ม "แก้ไข")

function extractFile(msg) {
  if (msg.document) return { file_id: msg.document.file_id, file_name: msg.document.file_name || `file_${msg.document.file_id}.bin` };
  if (msg.photo && msg.photo.length) { const p = msg.photo[msg.photo.length - 1]; return { file_id: p.file_id, file_name: `photo_${p.file_id}.jpg` }; }
  return null;
}

async function downloadFile(file_id, destDir, filename) {
  const gf = await tg("getFile", { file_id });
  if (!gf.ok) return null;
  const url = `https://api.telegram.org/file/bot${TOKEN}/${gf.result.file_path}`;
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const safe = filename.replace(/[^\w.\-ก-๙ ()]/g, "_");
  const p = path.join(destDir, safe);
  fs.writeFileSync(p, buf);
  return { path: p, filename: safe };
}

const memoInFlight = new Set();

// ดาวน์โหลดรูปที่ผู้ใช้ส่งมาล่าสุด (ไว้ให้ AI อ่าน/วิเคราะห์ในแชท)
async function downloadRecentImages(chatId) {
  const imgs = (recentFiles[chatId] || []).filter((f) => /^photo_|\.(jpe?g|png|webp)$/i.test(f.file_name || ""));
  if (!imgs.length) return [];
  const seen = new Set();
  const uniq = imgs.filter((f) => !seen.has(f.file_id) && seen.add(f.file_id)).slice(0, 6);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "waan-img-"));
  const paths = [];
  for (const f of uniq) {
    try { const s = await downloadFile(f.file_id, dir, f.file_name); if (s) paths.push(s.path); } catch { /* skip */ }
  }
  return paths;
}

async function doMemo(chatId, text, files, from, isGroup, msgId, mentions) {
  if (memoInFlight.has(String(chatId))) return; // กันออกเอกสารซ้ำ
  memoInFlight.add(String(chatId));
  try {
  const status = await startStatus(chatId, [
    "📥 โอเคค่ะ รับเรื่องออกเอกสารคืนเงินแล้ว เดี๋ยวจัดให้เลยนะคะ 🚀",
    "📎 กำลังอ่านไฟล์แนบ...",
    "🔍 กำลังดึงข้อมูลจากข้อความ...",
    "🧮 กำลังตรวจความถูกต้องของตัวเลข...",
    "📝 กำลังจัดรูปเอกสารตามแบบฟอร์ม...",
    "⏳ ใกล้เสร็จแล้วค่ะ...",
  ]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "waan-memo-"));
  const saved = [];
  for (const f of files) {
    try { const s = await downloadFile(f.file_id, dir, f.file_name); if (s) saved.push(s); } catch { /* skip */ }
  }

  let data;
  try {
    const r = await fetch(APP_URL + "/api/memo/generate", {
      method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify({ rawText: text, files: saved, fromId: String(from?.id || ""), chatId: String(chatId), isGroup: !!isGroup }),
    });
    data = await r.json();
  } catch { await status.finishText("ขออภัยค่ะ ระบบหลังบ้านยังไม่พร้อม ลองใหม่อีกครั้งนะคะ"); return; }
  if (data.error === "unauthorized") { status.stop(); if (status.msgId) await tg("deleteMessage", { chat_id: chatId, message_id: status.msgId }).catch(() => {}); return; }
  if (!data.ok) { await status.finishText("ออกเอกสารไม่สำเร็จค่ะ: " + (data.error || "")); return; }
  await status.finishDone("✅ ออกร่างเอกสารเสร็จแล้วค่ะ ส่งให้ตรวจเลยนะคะ");
  await sendMemoDraft(chatId, data);
  await reactMsg(chatId, msgId, "✅");
  await notifyDelivery(chatId, isGroup, from, text, mentions, "เอกสารคืนเงิน (ร่าง)", MANAGER);
  } finally {
    memoInFlight.delete(String(chatId));
  }
}

// ส่งไฟล์ร่างเอกสาร + ปุ่ม เซ็นเลย/แก้ไข (ใช้ทั้งตอนออกใหม่และตอนแก้ไข)
async function sendMemoDraft(chatId, data) {
  await tg("sendChatAction", { chat_id: chatId, action: "upload_document" });
  const pdfRes = await fetch(APP_URL + `/api/memo/${data.id}/pdf`, { headers: { "x-internal-token": INTERNAL } });
  const pdf = Buffer.from(await pdfRes.arrayBuffer());
  const warn = data.valid ? "" : "\n\n⚠️ ขอเช็คนิดนึงค่ะ: " + (data.warnings || []).join("; ");
  const caption = `📥 ออกร่างเอกสารคืนเงินให้แล้วนะคะ (ยังไม่เซ็น)\n\n👤 ลูกค้า: ${data.serviceName || "-"}\n📊 ยอดคืนรวม: ${data.refund} บาท (หัก ณ ที่จ่าย ${data.whtAmount} + ส่วนเกิน ${data.overpay})\n🖼️ แนบครบ ${data.attachCount} หน้า${warn}\n\n✅ ถ้าโอเคกด "เซ็นเลย" เดี๋ยววานเติมลายเซ็นให้\n🚧 ถ้าอยากปรับตรงไหนกด "แก้ไข" ได้เลยค่ะ`;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  form.append("reply_markup", JSON.stringify({ inline_keyboard: [[{ text: "เซ็นเลย", callback_data: `memo:sign:${data.id}` }, { text: "แก้ไข", callback_data: `memo:revise:${data.id}` }]] }));
  form.append("document", new Blob([new Uint8Array(pdf)]), data.filename || "บันทึกขอคืนเงินหัก ณ ที่จ่าย (ร่าง).pdf");
  await fetch(API("sendDocument"), { method: "POST", body: form });
}

// กด "แก้ไข" แล้วพิมพ์บอกว่าอยากแก้อะไร → ออกร่างใหม่ (id เดิม)
async function doRevise(chatId, id, instruction, from, isGroup, msgId) {
  if (memoInFlight.has(String(chatId))) return;
  memoInFlight.add(String(chatId));
  try {
    const status = await startStatus(chatId, [
      "📝 รับเรื่องแก้เอกสารแล้วค่ะ เดี๋ยวปรับให้เลยนะคะ",
      "🔍 กำลังอ่านคำสั่งแก้ไข...",
      "🖼️ กำลังอ่านไฟล์แนบเดิม/วิเคราะห์...",
      "🧮 กำลังตรวจตัวเลขและจัดรูปใหม่...",
      "⏳ ใกล้เสร็จแล้วค่ะ...",
    ]);
    let data;
    try {
      const r = await fetch(APP_URL + "/api/memo/revise", {
        method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
        body: JSON.stringify({ id, instruction, fromId: String(from?.id || ""), chatId: String(chatId), isGroup: !!isGroup }),
      });
      data = await r.json();
    } catch { await status.finishText("ขออภัยค่ะ ระบบหลังบ้านยังไม่พร้อม ลองใหม่อีกครั้งนะคะ"); return; }
    if (data.error === "unauthorized") { status.stop(); if (status.msgId) await tg("deleteMessage", { chat_id: chatId, message_id: status.msgId }).catch(() => {}); return; }
    if (!data.ok) { await status.finishText("แก้เอกสารไม่สำเร็จค่ะ: " + (data.error || "")); return; }
    await status.finishDone("✅ ปรับเอกสารให้แล้วค่ะ ส่งให้ตรวจอีกครั้งนะคะ");
    await sendMemoDraft(chatId, data);
    await reactMsg(chatId, msgId, "✅");
  } finally {
    memoInFlight.delete(String(chatId));
  }
}

// ตรวจเอกสาร Affiliate อัตโนมัติ: อ่าน PDF + เทียบชีต + ตรวจยอด → รายงาน + ภาพยืนยัน
async function doAffCheck(chatId, text, files, from, isGroup, msgId) {
  if (memoInFlight.has(String(chatId))) return; // กันชนกับงานออกเอกสาร
  const status = await startStatus(chatId, [
    "📥 รับเรื่องตรวจเอกสาร Affiliate แล้วค่ะ เดี๋ยววานตรวจให้เลยนะคะ 🔎",
    "📎 กำลังอ่านเอกสารที่แนบ...",
    "🗂️ กำลังเทียบกับชีตลูกค้า AFF...",
    "🧮 กำลังตรวจยอดเงินและความถูกต้อง...",
    "🖼️ กำลังทำภาพยืนยัน...",
    "⏳ ใกล้เสร็จแล้วค่ะ...",
  ]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "waan-aff-"));
  const saved = [];
  for (const f of files) {
    if (!/\.pdf$/i.test(f.file_name || "")) continue;
    try { const s = await downloadFile(f.file_id, dir, f.file_name); if (s) saved.push(s); } catch { /* skip */ }
  }
  if (saved.length === 0) { await status.finishText("ขอไฟล์เอกสาร PDF ที่จะให้ตรวจด้วยนะคะ"); return; }
  let data;
  try {
    const r = await fetch(APP_URL + "/api/telegram/aff-check", {
      method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify({ chatId: String(chatId), fromId: String(from?.id || ""), isGroup: !!isGroup, rawText: text, files: saved }),
    });
    data = await r.json();
  } catch { await status.finishText("ระบบหลังบ้านยังไม่พร้อมค่ะ ลองใหม่อีกครั้งนะคะ"); return; }
  if (data.error === "unauthorized") { status.stop(); if (status.msgId) await tg("deleteMessage", { chat_id: chatId, message_id: status.msgId }).catch(() => {}); return; }
  if (!data.ok) { await status.finishText("ตรวจเอกสารไม่สำเร็จค่ะ: " + (data.error || "")); return; }
  await status.finishDone("✅ ตรวจเอกสารเสร็จแล้วค่ะ สรุปให้เลยนะคะ");
  await sendResultSends(chatId, data.sends || []);
  await reactMsg(chatId, msgId, "✅");
}

// ทำสไลด์ "จากไฟล์ที่แนบ" (เช่น reply PDF แล้วสั่งทำสไลด์) — อ่านเนื้อหาไฟล์นั้นมาทำ ไม่ใช่ดึงข้อมูลระบบ
async function doSlideFromFiles(chatId, text, files, from, isGroup, msgId, mentions) {
  if (memoInFlight.has(String(chatId))) return;
  memoInFlight.add(String(chatId));
  try {
    const status = await startStatus(chatId, [
      "📥 รับเรื่องทำสไลด์จากไฟล์แล้วค่ะ เดี๋ยวจัดให้เลยนะคะ 🚀",
      "📎 กำลังอ่านเนื้อหาในไฟล์...",
      "🔍 กำลังสรุปประเด็นและตัวเลขจากเอกสาร...",
      "📊 กำลังจัดสไลด์และกราฟ...",
      "🖼️ กำลังตกแต่งให้สวยและมืออาชีพ...",
      "⏳ ใกล้เสร็จแล้วค่ะ...",
    ]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "waan-slide-"));
    const saved = [];
    for (const f of files) {
      try { const s = await downloadFile(f.file_id, dir, f.file_name); if (s) saved.push(s); } catch { /* skip */ }
    }
    let data;
    try {
      const r = await fetch(APP_URL + "/api/slides/from-files", {
        method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
        body: JSON.stringify({ topic: text || "ทำสไลด์จากเอกสาร", files: saved, fromId: String(from?.id || ""), chatId: String(chatId), isGroup: !!isGroup }),
      });
      data = await r.json();
    } catch { await status.finishText("ระบบหลังบ้านยังไม่พร้อมค่ะ ลองใหม่อีกครั้งนะคะ"); return; }
    if (data.error === "unauthorized") { status.stop(); if (status.msgId) await tg("deleteMessage", { chat_id: chatId, message_id: status.msgId }).catch(() => {}); return; }
    if (!data.ok) { await status.finishText("ทำสไลด์จากไฟล์ไม่สำเร็จค่ะ: " + (data.error || "")); return; }
    await status.finishDone(`✅ ทำสไลด์ "${data.title}" (${data.slideCount} สไลด์) จากไฟล์ให้แล้วค่ะ ส่งทั้ง PDF และไฟล์เด็คที่เลื่อนดูได้ให้เลยนะคะ`);
    const safe = (data.title || "slides").replace(/[^\w฀-๿ ._-]/g, "").slice(0, 50) || "slides";
    await sendResultSends(chatId, [
      { kind: "document", url: data.files.pdf, filename: `${safe}.pdf`, caption: data.title },
      { kind: "document", url: data.files.html, filename: `${safe}.html` },
    ]);
    await reactMsg(chatId, msgId, "✅");
    await notifyDelivery(chatId, isGroup, from, text, mentions, `สไลด์ "${data.title}"`);
  } finally {
    memoInFlight.delete(String(chatId));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===== สถานะสด: วิเคราะห์แป๊บ (พิมพ์อยู่ 2-3 วิ) → ตอบรับ → อัปเดตว่ายังทำอยู่ =====
async function startStatus(chatId, steps) {
  // ทำเหมือนกำลังอ่าน/คิดก่อน 2-3 วิ แล้วค่อยตอบรับ (ไม่รีบตอบทันที)
  await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  await sleep(2200 + Math.floor(Math.random() * 800));
  const m = await tg("sendMessage", { chat_id: chatId, text: steps[0] });
  const msgId = m.result?.message_id;
  const t0 = Date.now();
  let i = 0;
  const timer = setInterval(async () => {
    i++;
    const sec = Math.round((Date.now() - t0) / 1000);
    const step = steps[Math.min(i, steps.length - 1)];
    const tail = sec >= 90 ? ` (${sec} วิ · ใช้เวลานานกว่าปกติ ขอโทษนะคะ กำลังเร่งให้)` : ` (${sec} วิ)`;
    if (msgId) await tg("editMessageText", { chat_id: chatId, message_id: msgId, text: step + tail }).catch(() => {});
  }, 6000);
  return {
    msgId,
    async finishText(text) { clearInterval(timer); if (msgId) await tg("editMessageText", { chat_id: chatId, message_id: msgId, text }).catch(() => {}); },
    async finishDone(text) { clearInterval(timer); if (msgId) await tg("editMessageText", { chat_id: chatId, message_id: msgId, text: text || "เรียบร้อยค่ะ" }).catch(() => {}); },
    stop() { clearInterval(timer); },
  };
}

async function sendResultSends(chatId, sends) {
  for (const s of sends || []) {
    if (s.kind === "text") await tg("sendMessage", { chat_id: chatId, text: s.text, ...(s.parseMode ? { parse_mode: s.parseMode } : {}) });
    else if (s.kind === "document") {
      await tg("sendChatAction", { chat_id: chatId, action: "upload_document" });
      const r = await fetch(APP_URL + s.url, { headers: { "x-internal-token": INTERNAL } });
      const buf = Buffer.from(await r.arrayBuffer());
      const form = new FormData();
      form.append("chat_id", String(chatId));
      if (s.caption) form.append("caption", s.caption);
      form.append("document", new Blob([new Uint8Array(buf)]), s.filename || "file");
      await fetch(API("sendDocument"), { method: "POST", body: form });
    }
    else if (s.kind === "photo") {
      await tg("sendChatAction", { chat_id: chatId, action: "upload_photo" });
      const buf = s.dataBase64 ? Buffer.from(s.dataBase64, "base64")
        : Buffer.from(await (await fetch(APP_URL + s.url, { headers: { "x-internal-token": INTERNAL } })).arrayBuffer());
      const form = new FormData();
      form.append("chat_id", String(chatId));
      if (s.caption) form.append("caption", s.caption);
      form.append("photo", new Blob([new Uint8Array(buf)]), s.filename || "screenshot.png");
      await fetch(API("sendPhoto"), { method: "POST", body: form });
    }
  }
}

async function postIngest(chatId, text, from, isGroup, replyTo, replyText, mentions, imageFiles) {
  const res = await fetch(APP_URL + "/api/telegram/ingest", {
    method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
    body: JSON.stringify({ chatId: String(chatId), text, fromId: String(from?.id || ""), fromName: from?.name || "", fromUsername: from?.username || "", isGroup: !!isGroup, replyTo: replyTo || null, replyText: replyText || "", mentions: mentions || [], imageFiles: imageFiles || [] }),
  });
  return res.json();
}

// ดึง mention/แท็กจากข้อความ (text_mention มี user.id, mention เป็น @username)
function extractMentions(msgs) {
  const out = [];
  for (const m of msgs) {
    const t = m.text || m.caption || "";
    const ents = m.entities || m.caption_entities || [];
    for (const e of ents) {
      if (e.type === "text_mention" && e.user) {
        if (e.user.id === BOT_ID || e.user.is_bot) continue; // ไม่นับการแท็กตัวบอทเอง
        out.push({ id: String(e.user.id), name: [e.user.first_name, e.user.last_name].filter(Boolean).join(" ") || e.user.username || "สมาชิก", username: e.user.username || undefined });
      } else if (e.type === "mention") {
        const uname = t.substr(e.offset, e.length).replace(/^@/, "").trim();
        if (uname && uname.toLowerCase() !== (BOT_USERNAME || "").toLowerCase()) out.push({ id: null, name: uname, username: uname });
      }
    }
  }
  return out;
}

async function chatIngest(chatId, text, from, isGroup, replyTo, msgId, replyText, mentions, imagePaths) {
  const isSlide = /สไลด์|slide|พรีเซนต์|นำเสนอ/.test(text);

  // งานสไลด์ = ใช้เวลานาน → แสดงสถานะเต็ม
  if (isSlide) {
    const status = await startStatus(chatId, [
      "📥 โอเคค่ะ รับเรื่องทำสไลด์แล้ว เดี๋ยวจัดให้เลยนะคะ 🚀",
      "🔎 กำลังดึงข้อมูลจริง...", "📊 กำลังจัดสไลด์และกราฟ...", "🖼️ กำลังตกแต่งให้สวย...", "⏳ ใกล้เสร็จแล้วค่ะ...",
    ]);
    let data;
    try { data = await postIngest(chatId, text, from, isGroup, replyTo, replyText, mentions, imagePaths); }
    catch { await status.finishText("ระบบหลังบ้านยังไม่พร้อมค่ะ ลองใหม่อีกครั้งนะคะ"); return; }
    const sends = data.sends || [];
    if (sends.length === 0) { status.stop(); if (status.msgId) await tg("deleteMessage", { chat_id: chatId, message_id: status.msgId }).catch(() => {}); return; }
    await status.finishDone("✅ ทำสไลด์เสร็จแล้วค่ะ ส่งให้เลยนะคะ");
    await sendResultSends(chatId, sends);
    await reactMsg(chatId, msgId, "✅");
    await notifyDelivery(chatId, isGroup, from, text, mentions, "สไลด์");
    return;
  }

  // แชททั่วไป/ทักทาย = ตอบธรรมชาติ (โชว์ "กำลังพิมพ์" ไว้ ถ้าช้าเกิน 7 วิ ค่อยบอกว่ากำลังหา)
  await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  const typingTimer = setInterval(() => tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {}), 4000);
  let softId = null;
  const softTimer = setTimeout(async () => {
    const m = await tg("sendMessage", { chat_id: chatId, text: "🔎 กำลังหาข้อมูลให้อยู่แป๊บนะคะ..." }).catch(() => null);
    softId = m?.result?.message_id || null;
  }, 7000);

  let data;
  try { data = await postIngest(chatId, text, from, isGroup, replyTo, replyText, mentions, imagePaths); }
  catch {
    clearInterval(typingTimer); clearTimeout(softTimer);
    const t = "ระบบหลังบ้านยังไม่พร้อมค่ะ ลองใหม่อีกครั้งนะคะ";
    if (softId) await tg("editMessageText", { chat_id: chatId, message_id: softId, text: t }).catch(() => {});
    else await tg("sendMessage", { chat_id: chatId, text: t });
    return;
  }
  clearInterval(typingTimer); clearTimeout(softTimer);

  const sends = data.sends || [];
  const texts = sends.filter((s) => s.kind === "text");
  if (sends.length === 0) { if (softId) await tg("deleteMessage", { chat_id: chatId, message_id: softId }).catch(() => {}); return; }
  // คำตอบข้อความเดี่ยว (ไม่มีไฟล์/รูปแนบ)
  if (texts.length === 1 && sends.length === 1) {
    const pm = texts[0].parseMode ? { parse_mode: texts[0].parseMode } : {};
    // ในกลุ่ม: แท็ก "คนที่ควรถูกพูดด้วย" = ถ้าผู้ส่งแท็กใครไว้ → คนนั้น (เช่น "ทักทาย Orin") ไม่งั้น → คนที่ถามเอง
    if (isGroup && msgId) {
      if (softId) await tg("deleteMessage", { chat_id: chatId, message_id: softId }).catch(() => {});
      const addressee = (mentions && mentions.length) ? mentions[0] : from;
      // ตัดคำนำหน้าที่ AI อาจเผลอใส่ (ทั้ง "@ชื่อ" และชื่อคนที่พูดด้วยล้วนๆ) กันแท็กซ้ำสองรอบ
      let body = String(texts[0].text || "").replace(/^\s*@\S+[\s,:!.\-]*/, "");
      if (addressee?.name) {
        const ne = addressee.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        body = body.replace(new RegExp("^\\s*" + ne + "[\\s,:!.\\-]*"), "");
      }
      body = body.trimStart();
      const mn = buildMention(addressee);
      // reply thread เฉพาะตอนตอบ "คนที่ถามเอง"; ถ้าพูดกับคนที่ถูกแท็ก ไม่ต้อง thread ไปที่ผู้ส่ง
      const extra = (mentions && mentions.length) ? {} : { reply_to_message_id: msgId };
      let outText = body;
      if (mn) {
        outText = `${mn.prefix} ${body}`;
        if (mn.entity) extra.entities = [mn.entity]; // ไม่มี username → ใช้ entity ให้แท็กติด (ห้ามใส่ parse_mode คู่)
        else Object.assign(extra, pm);
      } else {
        Object.assign(extra, pm);
      }
      await tg("sendMessage", { chat_id: chatId, text: outText, ...extra });
    } else if (softId) {
      await tg("editMessageText", { chat_id: chatId, message_id: softId, text: texts[0].text, ...pm }).catch(() => {});
    } else {
      await tg("sendMessage", { chat_id: chatId, text: texts[0].text, ...pm });
    }
    return;
  }
  // มีรูป/ไฟล์แนบด้วย → ถ้ามีข้อความ ให้แก้ soft msg เป็นข้อความแรก แล้วส่งเฉพาะรูป/ไฟล์ที่เหลือ
  if (softId && texts.length >= 1) {
    await tg("editMessageText", { chat_id: chatId, message_id: softId, text: texts[0].text }).catch(() => {});
    await sendResultSends(chatId, sends.filter((s) => s !== texts[0]));
    return;
  }
  if (softId) await tg("deleteMessage", { chat_id: chatId, message_id: softId }).catch(() => {});
  await sendResultSends(chatId, sends);
}

function personOf(u) {
  if (!u) return null;
  return { id: String(u.id), name: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || "สมาชิก", username: u.username || undefined };
}

// หาผู้รับจาก "ชื่อที่พิมพ์ในข้อความ" เทียบรายชื่อทีม (เช่น "ส่งให้เนย" → พี่เนย)
// เฉพาะเมื่อมีคำสั่งฝาก/ส่งให้ และชื่อยาวพอ (กันจับ "กร" ไปตรงกับ "กสิกร")
function findRosterRecipient(text, excludeId) {
  const t = String(text || "");
  if (!/ส่งให้|ให้กับ|ฝากให้|ฝาก|แท็ก|ส่งต่อ|บอก/.test(t)) return null; // ต้องมีคำสั่งฝาก/ส่งถึงจะจับชื่อ
  for (const m of ROSTER) {
    if (String(m.id) === String(excludeId || "")) continue;
    const nick = String(m.name || "").replace(/^(พี่|น้อง|คุณ)\s*/, "").trim();
    // ชื่อเต็มมีคำนำหน้า (พี่กร) จับได้เลย · ชื่อล้วน (กร) ต้องยาว >= 3 ตัว กันชนคำอื่น
    const cands = [m.name, m.realName].filter((s) => s && String(s).length >= 2);
    if (nick.length >= 3) cands.push(nick);
    if (cands.some((c) => t.includes(c))) return { id: m.id, name: m.name, username: m.username || undefined };
  }
  return null;
}

// หลังทำงานเสร็จในกลุ่ม: แท็กผู้รับ (บังคับ/แท็กที่สั่งให้ส่ง/ชื่อในข้อความ) + แจ้งเจ้าของทางแชทส่วนตัว
async function notifyDelivery(chatId, isGroup, from, text, mentions, label, forced) {
  try {
    // ผู้รับ: บังคับ (เช่น เอกสาร→พี่หนิง) > คนที่แท็กไว้ > ชื่อที่พิมพ์ในข้อความ — ไม่นับตัวผู้สั่งเอง
    const recip =
      forced ||
      (mentions || []).find((m) => m && (m.id ? String(m.id) !== String(from?.id || "") : true)) ||
      findRosterRecipient(text, from?.id);
    if (isGroup && recip) {
      const mn = buildMention(recip);
      const body = `นี่${label}ที่ฝากให้ส่งค่ะ ไฟล์อยู่ด้านบนเลยนะคะ`;
      const extra = {};
      let outText = body;
      if (mn) { outText = `${mn.prefix} ${body}`; if (mn.entity) extra.entities = [mn.entity]; }
      await tg("sendMessage", { chat_id: chatId, text: outText, ...extra });
    }
    // แจ้งเจ้าของทางแชทส่วนตัว (เฉพาะงานที่ทำในกลุ่ม)
    if (isGroup && OWNER_CHAT_ID && String(chatId) !== String(OWNER_CHAT_ID)) {
      const to = recip ? ` และส่งให้ ${recip.name || recip.username || "ทีม"} แล้ว` : "";
      await tg("sendMessage", { chat_id: OWNER_CHAT_ID, text: `แจ้งพี่โด้ค่ะ ทำ${label}ในกลุ่มเสร็จเรียบร้อยแล้ว${to}ค่ะ 👀` });
    }
  } catch { /* แจ้งเตือนพลาดไม่เป็นไร ไม่ให้กระทบงานหลัก */ }
}

// สร้างการแท็กที่ "ติดจริง": มี username → @username (auto-link) · ไม่มี → text_mention entity (คลิกได้แม้ไม่มี username)
function buildMention(from) {
  if (!from) return null;
  if (from.username) return { prefix: `@${from.username}`, entity: null };
  const name = String(from.name || "").trim();
  const uid = Number(from.id);
  if (!name || !Number.isFinite(uid) || uid <= 0) return null;
  return { prefix: name, entity: { type: "text_mention", offset: 0, length: name.length, user: { id: uid } } };
}

async function processBatch(chatId, msgs) {
  const chatType = msgs[0]?.chat?.type || "private";
  const isGroup = chatType === "group" || chatType === "supergroup";
  const from = personOf(msgs[0]?.from);
  const replyMsg = msgs.find((m) => m.reply_to_message)?.reply_to_message;
  const replyTo = replyMsg ? personOf(replyMsg.from) : null;
  const replyText = replyMsg ? (replyMsg.text || replyMsg.caption || "") : "";
  const mentions = extractMentions(msgs);
  const triggerMsgId = msgs[msgs.length - 1]?.message_id;
  let text = msgs.map((m) => m.text || m.caption || "").filter(Boolean).join("\n").trim();
  const files = msgs.map(extractFile).filter(Boolean);
  // ถ้า reply ไปที่ข้อความที่มีไฟล์ (เช่น reply PDF เก่าแล้วสั่งทำสไลด์) → ดึงไฟล์นั้นมาด้วยเสมอ
  // ไม่ต้องพึ่งบัฟเฟอร์เวลา ทำให้ "reply ไฟล์ไหน = อ่านไฟล์นั้น" ได้แม้ไฟล์ส่งมานานแล้ว
  const replyFile = replyMsg ? extractFile(replyMsg) : null;
  if (replyFile && !files.some((f) => f.file_id === replyFile.file_id)) files.push(replyFile);
  const now = Date.now();
  recentFiles[chatId] = (recentFiles[chatId] || []).filter((f) => now - f.ts < BUFFER_TTL);
  // ไฟล์ชุดใหม่มาหลังเว้นช่วงนาน (>45 วิ) = คนละเคส → ทิ้งไฟล์/ข้อความเก่าที่ค้าง กันเอกสารปนข้ามเคส (เช่น PDF Affiliate ค้างไปโผล่ในเอกสารคืนเงิน)
  if (files.length && recentFiles[chatId].length) {
    const lastTs = Math.max(...recentFiles[chatId].map((f) => f.ts));
    if (now - lastTs > 45000) {
      recentFiles[chatId] = [];
      recentTexts[chatId] = [];
    }
  }
  for (const f of files) recentFiles[chatId].push({ ...f, ts: now });
  // เก็บ "ข้อความ/แคปชัน" ของ batch นี้ไว้ด้วย (ก่อนตัด trigger) เพื่อไม่ให้เนื้อหาที่ forward มาหาย
  // เมื่อคำสั่งกับเนื้อหา forward มาคนละ batch — เดิมเก็บแต่ไฟล์ ทำให้ rawText ตอนออกเอกสารว่าง
  recentTexts[chatId] = (recentTexts[chatId] || []).filter((t) => now - t.ts < BUFFER_TTL);
  if (text) recentTexts[chatId].push({ text, ts: now });

  // ตรวจเอกสาร Affiliate อัตโนมัติ — แอดมินแนบ PDF + ข้อความแพตเทิร์นเดิม (หรือสั่งตรวจไว้แล้ว forward ไฟล์ตามมา)
  // (backend ตรวจสิทธิ์: กลุ่มที่ผูกแล้ว หรือแชทเจ้าของ)
  const affActive = affPending[chatId] && now < affPending[chatId];
  const hasPdfNow = files.some((f) => /\.pdf$/i.test(f.file_name || ""));
  if (isAffDoc(text, files) || (affActive && hasPdfNow)) {
    delete affPending[chatId];
    // รวมข้อความที่ buffer ไว้ (คำสั่ง + รายละเอียดที่ forward มา) เป็น rawText กันข้อมูลตกหล่น
    const seenT = new Set();
    const affText =
      (recentTexts[chatId] || [])
        .map((t) => t.text)
        .filter((t) => t && !seenT.has(t) && seenT.add(t))
        .join("\n") || text;
    recentFiles[chatId] = [];
    recentTexts[chatId] = [];
    await reactMsg(chatId, triggerMsgId, "👀"); // เห็นเอกสารแล้ว กำลังตรวจ
    await doAffCheck(chatId, affText, files, from, isGroup, triggerMsgId);
    return;
  }

  // ในกลุ่ม: ตอบเฉพาะเมื่อถูกเรียก หรือ "เปิดหูรอ" อยู่ (หลังถูกแท็ก รอข้อความ/forward ถัดไป)
  if (isGroup) {
    const repliedToBot = msgs.some((m) => m.reply_to_message?.from?.id === BOT_ID);
    const mentioned = BOT_USERNAME && text.toLowerCase().includes("@" + BOT_USERNAME.toLowerCase());
    const calledByName = /น้องวาน/.test(text);
    const namePrefix = /^\s*วาน[\s,:ๆจ]/i.test(text);
    const triggered = repliedToBot || mentioned || calledByName || namePrefix;
    const armed = armedUntil[chatId] && now < armedUntil[chatId];
    const memoWaiting = memoPending[chatId] && now < memoPending[chatId];
    const haveFiles = (recentFiles[chatId] || []).length > 0;
    const editingNow = editingMemo[chatId] && now < editingMemo[chatId].until;
    // ถ้ากำลังรอออกเอกสาร/รอคำสั่งแก้เอกสารอยู่ → รับไว้แม้ไม่ถูกแท็ก (เช่น forward/พิมพ์ต่อ)
    if (!triggered && !armed && !(memoWaiting && haveFiles) && !editingNow) return; // ไม่ได้ถูกเรียก/เปิดหูรอ — เงียบ
    if (triggered) {
      text = text
        .replace(/น้องวาน/g, "")
        .replace(/^\s*วาน[\s,:ๆจ]*/i, "")
        .replace(new RegExp("@" + BOT_USERNAME, "gi"), "")
        .trim();
    }
    if (armed && !triggered) delete armedUntil[chatId]; // ใช้สิทธิ์เปิดหูรอกับข้อความนี้

    // ถูกเรียกเฉยๆ ยังไม่มีเนื้อหา/ไฟล์ → เปิดหูรอข้อความ/forward ถัดไป 90 วิ
    const seenNow = new Set();
    const bufferedNow = (recentFiles[chatId] || []).filter((f) => !seenNow.has(f.file_id) && seenNow.add(f.file_id));
    if (triggered && text.length < 2 && bufferedNow.length === 0) {
      armedUntil[chatId] = now + 90000;
      await tg("sendMessage", { chat_id: chatId, text: "ค่ะพี่โด้ ว่ามาได้เลยค่ะ 👀 พิมพ์ แนบไฟล์ หรือฟอร์เวิร์ดข้อความมาได้เลยนะคะ" });
      return;
    }
    if (!text) text = "สวัสดี";
  }

  // กดอิโมจิรีแอคชันบนข้อความสั่ง (วิเคราะห์เนื้อหา) เป็นการรับรู้ทันที ก่อนลงมือทำ
  const haveFilesNow = (recentFiles[chatId] || []).length > 0;
  await reactMsg(chatId, triggerMsgId, pickReaction(text, { hasFiles: haveFilesNow, isMemo: MEMO_INTENT.test(text) }));

  // โหมดแก้เอกสาร: กด "แก้ไข" แล้วพิมพ์บอกว่าอยากแก้อะไร → ออกร่างใหม่ตัวเดิม (ไม่หลุดไปแชททั่วไป)
  const editing = editingMemo[chatId] && now < editingMemo[chatId].until;
  const isSlideish = /สไลด์|slide|พรีเซนต์|นำเสนอ/.test(text);
  if (editing && text && !MEMO_INTENT.test(text) && !isSlideish) {
    const memoId = editingMemo[chatId].id;
    delete editingMemo[chatId];
    await doRevise(chatId, memoId, text, from, isGroup, triggerMsgId);
    return;
  }

  // ออกเอกสารจากไฟล์แนบ — ทำได้ทั้งแชทส่วนตัวและกลุ่ม (ตรวจสิทธิ์ที่ backend)
  const memoWaiting = memoPending[chatId] && now < memoPending[chatId];
  const memoIntent = !!(text && MEMO_INTENT.test(text));
  const seen = new Set();
  const all = (recentFiles[chatId] || []).filter((f) => !seen.has(f.file_id) && seen.add(f.file_id));

  // สั่งตรวจเอกสาร AFF แต่ยังไม่มีไฟล์ → เปิดหูรอไฟล์ (ไม่ตอบแชทซ้ำ/ไม่ตอบเรื่องอื่น)
  const affReqIntent = /ตรวจ(สอบ)?\s*(เอกสาร|aff|affiliate|รายการ|การถอน|ถอน)|(เช็ก|เช็ค)\s*(เอกสาร|aff)/i.test(text);
  if (affReqIntent && all.length === 0) {
    affPending[chatId] = now + BUFFER_TTL;
    armedUntil[chatId] = now + BUFFER_TTL;
    await reactMsg(chatId, triggerMsgId, "👀");
    await tg("sendMessage", { chat_id: chatId, text: "รับเรื่องตรวจเอกสาร AFF ค่ะ ส่งไฟล์เอกสาร (PDF) + รายละเอียดของรายการมาได้เลยนะคะ" });
    return;
  }

  // สั่งทำสไลด์ + มีไฟล์แนบ (เช่น reply PDF) → อ่านเนื้อหาไฟล์นั้นมาทำสไลด์ ไม่ใช่ดึงข้อมูลระบบ
  if (isSlideish && all.length > 0) {
    recentFiles[chatId] = [];
    recentTexts[chatId] = [];
    await doSlideFromFiles(chatId, text, all, from, isGroup, triggerMsgId, mentions);
    return;
  }

  // สั่งออกเอกสาร (มี intent) หรือกำลังรอออกเอกสารอยู่แล้วไฟล์เพิ่งมาถึง
  if (memoIntent || (memoWaiting && all.length > 0)) {
    // ยังไม่แนบไฟล์ → อย่าเพิ่งออกเอกสารเปล่า เปิดหูรอไฟล์/เนื้อหา forward แล้วถามขอก่อน
    if (all.length === 0) {
      memoPending[chatId] = now + BUFFER_TTL;
      armedUntil[chatId] = now + BUFFER_TTL;
      await chatIngest(chatId, text, from, isGroup, replyTo, triggerMsgId, replyText, mentions);
      return;
    }
    // มีไฟล์แล้ว → รวมข้อความที่ buffer ไว้ทั้งหมด (คำสั่ง + เนื้อหาที่ forward มา) เป็น rawText
    // กันเคสคำสั่งกับรายละเอียดมาคนละข้อความ (เดิมส่งแต่ text ของ batch ล่าสุด → ข้อมูลว่าง)
    const seenT = new Set();
    const memoText =
      (recentTexts[chatId] || [])
        .map((t) => t.text)
        .filter((t) => t && !seenT.has(t) && seenT.add(t))
        .join("\n\n")
        .trim() || text;
    recentFiles[chatId] = [];
    recentTexts[chatId] = [];
    delete memoPending[chatId];
    await doMemo(chatId, memoText, all, from, isGroup, triggerMsgId, mentions);
    return;
  }
  if (text) {
    const imgPaths = await downloadRecentImages(chatId); // ถ้ามีรูปที่ส่งมา → ให้ AI อ่าน/วิเคราะห์
    await chatIngest(chatId, text, from, isGroup, replyTo, triggerMsgId, replyText, mentions, imgPaths);
    return;
  }
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  if (msg.media_group_id) {
    const g = groups[msg.media_group_id] || (groups[msg.media_group_id] = { msgs: [], chatId });
    g.msgs.push(msg);
    clearTimeout(g.timer);
    g.timer = setTimeout(() => { const grp = groups[msg.media_group_id]; delete groups[msg.media_group_id]; processBatch(chatId, grp.msgs); }, 1600);
    return;
  }
  await processBatch(chatId, [msg]);
}

async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id;
  if (!chatId) return;
  // กด "แก้ไข" → จำว่ากำลังแก้เอกสารตัวไหน + เปิดหูรอคำสั่งถัดไป (แม้ไม่แท็กชื่อ)
  const rev = String(cb.data || "").match(/^memo:revise:(.+)$/);
  if (rev) {
    const now = Date.now();
    editingMemo[chatId] = { id: rev[1], until: now + EDIT_TTL };
    armedUntil[chatId] = now + EDIT_TTL;
  }
  let out;
  try {
    const res = await fetch(APP_URL + "/api/telegram/callback", {
      method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify({ chatId: String(chatId), fromId: String(cb.from?.id || ""), data: cb.data || "" }),
    });
    out = await res.json();
  } catch { out = { answer: "ระบบหลังบ้านไม่พร้อม", sends: [] }; }
  await tg("answerCallbackQuery", { callback_query_id: cb.id, text: out.answer || "" });
  for (const s of out.sends || []) {
    if (s.kind === "text") {
      const { text, entities } = applyMention(s.text, s.mention);
      await tg("sendMessage", { chat_id: chatId, text, ...(entities ? { entities } : {}), ...(s.parseMode && !entities ? { parse_mode: s.parseMode } : {}) });
    } else if (s.kind === "document") {
      await tg("sendChatAction", { chat_id: chatId, action: "upload_document" });
      const r = await fetch(APP_URL + s.url, { headers: { "x-internal-token": INTERNAL } });
      const buf = Buffer.from(await r.arrayBuffer());
      const form = new FormData();
      form.append("chat_id", String(chatId));
      if (s.caption) {
        const { text, entities } = applyMention(s.caption, s.mention);
        form.append("caption", text);
        if (entities) form.append("caption_entities", JSON.stringify(entities));
      }
      form.append("document", new Blob([new Uint8Array(buf)]), s.filename || "file");
      await fetch(API("sendDocument"), { method: "POST", body: form });
    }
  }
}

// แทนที่ {{MENTION}} ด้วยชื่อผู้จัดการ + สร้าง text_mention entity ให้แท็กติดจริง (แม้ไม่มี @username)
function applyMention(text, mention) {
  const src = String(text || "");
  const ph = "{{MENTION}}";
  const idx = src.indexOf(ph);
  if (idx < 0) return { text: src, entities: undefined };
  const name = (mention && mention.name) || "ผู้จัดการ";
  const out = src.slice(0, idx) + name + src.slice(idx + ph.length);
  const uid = mention && Number(mention.id);
  const entities = uid && Number.isFinite(uid) && uid > 0
    ? [{ type: "text_mention", offset: idx, length: name.length, user: { id: uid } }]
    : undefined;
  return { text: out, entities };
}

async function main() {
  const me = await tg("getMe", {});
  if (!me.ok) { console.error("Token ไม่ถูกต้อง:", JSON.stringify(me)); process.exit(1); }
  BOT_USERNAME = me.result.username;
  BOT_ID = me.result.id;
  console.log(`น้องวานพร้อมทำงาน: @${BOT_USERNAME} (id ${BOT_ID}) · app ${APP_URL}`);
  // ดึงแชทส่วนตัวเจ้าของ ไว้แจ้งเตือนเมื่อทำงานเสร็จ
  try {
    const r = await fetch(APP_URL + "/api/telegram/config", { method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL } });
    const c = await r.json();
    OWNER_CHAT_ID = String(c.ownerChatId || "");
    MANAGER = c.managerSigner && c.managerSigner.id ? c.managerSigner : null;
    if (OWNER_CHAT_ID) console.log(`แชทเจ้าของ: ${OWNER_CHAT_ID}`);
    if (MANAGER) console.log(`ผู้จัดการ (แท็กเรื่องเอกสาร): ${MANAGER.name} (${MANAGER.id})`);
  } catch { /* ดึงไม่ได้ก็ข้ามการแจ้งเตือนเจ้าของ */ }
  // ดึงรายชื่อทีม ไว้แท็กตามชื่อที่พิมพ์
  const loadRoster = async () => {
    try {
      const r = await fetch(APP_URL + "/api/telegram/roster", { method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL } });
      const j = await r.json();
      if (Array.isArray(j.members)) { ROSTER = j.members; console.log(`รายชื่อทีม: ${ROSTER.length} คน`); }
    } catch { /* ดึงไม่ได้ก็ข้าม */ }
  };
  await loadRoster();
  setInterval(loadRoster, 10 * 60 * 1000); // รีเฟรชรายชื่อทุก 10 นาที
  await tg("deleteWebhook", { drop_pending_updates: false });

  // ตรวจงานปฏิทินที่ถึงกำหนดทุก 5 นาที → แจ้งเตือนเข้าแชท (ไม่ต้องพึ่ง cron ภายนอก)
  const checkCalendar = async () => {
    try {
      await fetch(APP_URL + "/api/telegram/calendar-due", {
        method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      });
    } catch { /* เดี๋ยวรอบหน้าลองใหม่ */ }
  };
  setTimeout(checkCalendar, 15000);
  setInterval(checkCalendar, 5 * 60 * 1000);
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
        if (u.message) handleMessage(u.message).catch((e) => console.error("msg err:", e.message));
        else if (u.callback_query) handleCallback(u.callback_query).catch((e) => console.error("cb err:", e.message));
      }
    } catch (e) { console.error("poll err:", e.message); await new Promise((r) => setTimeout(r, 3000)); }
  }
}
main();
