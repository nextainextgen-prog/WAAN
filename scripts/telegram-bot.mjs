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
// สั่งเก็บไฟล์/ลิงก์เข้าคลังความรู้ (Obsidian) — "เก็บไฟล์นี้", "เพิ่มไฟล์นี้เก็บหน่อย", "เก็บลิงก์นี้เข้าคลัง"
const KNOWLEDGE_INTENT =
  /(เก็บ|บันทึก|เพิ่ม|เซฟ|save|จำ|ขยาย).{0,10}(ไฟล์|เอกสาร|ลิงก์|link|url|อันนี้|เข้าคลัง|คลังความรู้|ลงสมอง|ลง\s*obsidian|ลงคลัง|เข้าความรู้)|เก็บเข้าคลัง|เข้าคลังความรู้|เก็บความรู้/i;
// กริยา "เก็บ/บันทึก" แบบหลวม — ใช้ก็ต่อเมื่อ "มีไฟล์แนบ" (พูดอะไรก็ได้ที่สื่อว่าให้เก็บไฟล์ ไม่ต้องเป๊ะคำ)
const SAVE_VERB = /(เก็บ|บันทึก|จำ|เซฟ|save|เพิ่ม|ขยาย|จดไว้|เอาไว้|ไว้ใช้|เก็บไว้|เก็บให้|เอาเข้า|ยัดเข้า|ไว้ก่อน|เก็บไป)/i;
// ขอไฟล์/รูปจากคลังกลับมา — "ขอรูป X จากคลัง", "เอาไฟล์ที่เก็บไว้", "มีรูป Y ในคลังไหม"
const KNOWLEDGE_FETCH_INTENT =
  /(ขอ|เอา|ส่ง|หา|เปิด|ดึง|มี|อยากได้|ไหน).{0,12}(รูป|ภาพ|ไฟล์|เอกสาร|โลโก้|logo).{0,24}(คลัง|เก็บไว้|บันทึกไว้|obsidian|ที่เก็บ|ที่บันทึก|ในคลัง)|(รูป|ภาพ|ไฟล์|เอกสาร).{0,12}(ในคลัง|ที่เก็บไว้|ที่บันทึกไว้)|จากคลัง(ความรู้)?/i;
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
let dedicatedGroups = new Set(); // กลุ่มที่ประมวลผลทุกข้อความ (thunder_expiry) — ไม่ต้องขึ้นต้น "วาน"
async function refreshDedicated() {
  try {
    const r = await fetch(APP_URL + "/api/telegram/dedicated-groups", { method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL } });
    const j = await r.json();
    if (Array.isArray(j.groups)) dedicatedGroups = new Set(j.groups.map(String));
  } catch { /* ใช้ค่าเดิม */ }
}
const memoPending = {};     // chatId -> timestamp (สั่งออกเอกสารแล้วแต่ยังรอไฟล์/เนื้อหา forward ตามมา)
const knowledgePending = {}; // chatId -> timestamp (สั่งเก็บไฟล์เข้าคลังแล้วแต่ยังรอไฟล์ตามมา)
const affPending = {};      // chatId -> timestamp (สั่งตรวจเอกสาร AFF แล้วแต่ยังรอไฟล์ forward ตามมา)
const affDrafts = {};       // summaryMsgId -> {chatId,notiMsgId,threadId,summary,tag,pdfB64,filename,notiText,until} (ร่างที่รอกดอนุมัติ)
const editingAff = {};      // chatId -> {notiText,notiMsgId,threadId,until} (กด "แก้ไข" แล้วรอคำสั่งแก้)
const editingMemo = {};     // chatId -> {id, until} (กด "แก้ไข" แล้ว รอคำสั่งแก้เอกสารตัวนี้)
const lastAffNoti = {};     // chatId -> {notiText,notiMsgId,threadId,until} — noti ล่าสุดที่ทำเอกสารไป (ให้พิมพ์แก้ซ้ำได้ ไม่ต้องกดปุ่ม)
const BUFFER_TTL = 180000;  // 3 นาที
const EDIT_TTL = 300000;    // 5 นาที (รอคำสั่งแก้เอกสารหลังกดปุ่ม "แก้ไข")
const AFF_NOTI_TTL = 3 * 3600000; // 3 ชม. — แก้เอกสาร AFF ตัวเดิมได้เรื่อยๆ โดยพิมพ์คำสั่งแก้ (ไม่ต้องกด "แก้ไข" ซ้ำ)

// ข้อความที่ "ดูเป็นคำสั่งแก้เอกสาร AFF" (มีที่อยู่/ชื่อ/ยอด/ธนาคาร) — กันข้อความคุยเล่น ("รอแปปครับ") ไม่ให้ trigger
const AFF_EDIT_HINT = /ที่อยู่|แขวง|เขต|ตำบล|อำเภอ|จังหวัด|บ้านเลขที่|เลขที่|หมู่|ซอย|ซ\.|ถนน|ถ\.|กรุงเทพ|ชื่อ|นาย|นาง|น\.ส\.|ยอด|จำนวนเงิน|ธนาคาร|เลขบัญชี|บัญชี|ภาษี|วันที่|แก้/;
function looksLikeAffEdit(t) { return AFF_EDIT_HINT.test(String(t || "")); }

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
  // แท็กเจ้าของ (โด้) ให้ตรวจ+เซ็นก่อนเท่านั้น — เซ็นเสร็จบอทค่อยแท็กผู้จัดการ (พี่หนิง) ต่อ
  if (isGroup) {
    const mn = buildMention(ownerMention());
    if (mn) {
      const extra = {};
      if (mn.entity) extra.entities = [mn.entity];
      await tg("sendMessage", { chat_id: chatId, text: `${mn.prefix} ร่างเอกสารคืนเงินเสร็จแล้วค่ะ 👆 รบกวนตรวจแล้วกด “เซ็นเลย” ก่อนนะคะ เดี๋ยววานส่งต่อให้ผู้จัดการเซ็นต่อค่ะ`, ...extra });
    }
    // แจ้งเจ้าของทางแชทส่วนตัวด้วย (เผื่อไม่ได้เปิดกลุ่ม)
    if (OWNER_CHAT_ID && String(chatId) !== String(OWNER_CHAT_ID)) {
      await tg("sendMessage", { chat_id: OWNER_CHAT_ID, text: "รายงานค่ะ ออกร่างเอกสารคืนเงินในกลุ่มเสร็จแล้ว รอพี่โด้ตรวจ+เซ็นค่ะ 👀" }).catch(() => {});
    }
  }
  } finally {
    memoInFlight.delete(String(chatId));
  }
}

// ส่งไฟล์ร่างเอกสาร + ปุ่ม เซ็นเลย/แก้ไข (ใช้ทั้งตอนออกใหม่และตอนแก้ไข)
async function sendMemoDraft(chatId, data) {
  await tg("sendChatAction", { chat_id: chatId, action: "upload_document" });
  const pdfRes = await fetch(APP_URL + `/api/memo/${data.id}/pdf`, { headers: { "x-internal-token": INTERNAL } });
  const pdf = Buffer.from(await pdfRes.arrayBuffer());
  // เบลอข้อมูลลูกค้าใน caption (tg-spoiler) — แตะเพื่อเปิดดู เหมือนฟีเจอร์ตรวจ AFF
  const esc = (v) => String(v ?? "-").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const sp = (v) => `<tg-spoiler>${esc(v)}</tg-spoiler>`;
  const warn = data.valid ? "" : "\n\n⚠️ ขอเช็คนิดนึงค่ะ: " + esc((data.warnings || []).join("; "));
  const caption =
    `📥 ออกร่างเอกสารคืนเงินให้แล้วนะคะ (ยังไม่เซ็น)\n\n` +
    `👤 ลูกค้า: ${sp(data.serviceName || "-")}\n` +
    `📊 ยอดคืนรวม: ${sp(`${data.refund} บาท`)} (หัก ณ ที่จ่าย ${sp(data.whtAmount)} + ส่วนเกิน ${sp(data.overpay)})\n` +
    `🖼️ แนบครบ ${esc(data.attachCount)} หน้า${warn}\n\n` +
    `⏳ รบกวนดำเนินการภายใน 24 ชม. ก่อนประวัติแชทจะถูกลบค่ะ\n` +
    `🔒 ไฟล์นี้ล็อกรหัสไว้นะคะ (รหัสเปิด)\n` +
    `<pre>xxxx-xxx</pre>\n\n` +
    `✅ ถ้าโอเคกด "เซ็นเลย" เดี๋ยวเติมลายเซ็นให้\n` +
    `🚧 ถ้าอยากปรับตรงไหนกด "แก้ไข" ได้เลยค่ะ`;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  form.append("parse_mode", "HTML");
  form.append("reply_markup", JSON.stringify({ inline_keyboard: [[{ text: "เซ็นเลย", callback_data: `memo:sign:${data.id}` }, { text: "แก้ไข", callback_data: `memo:revise:${data.id}` }]] }));
  form.append("document", new Blob([new Uint8Array(pdf)]), data.filename || "คืนเงินภาษี (ร่าง).pdf");
  const sent = await fetch(API("sendDocument"), { method: "POST", body: form }).then((r) => r.json()).catch(() => null);
  // จด message → memo ไว้ให้ reply แก้ไขซ้ำได้ (เอกสารที่แก้แล้ว resend)
  const mid = sent?.result?.message_id;
  if (mid && data.id) {
    await fetch(APP_URL + "/api/memo/by-message", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify({ id: data.id, chatId: String(chatId), messageId: mid }),
    }).catch(() => {});
  }
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
async function doAffCheck(chatId, text, files, from, isGroup, msgId, threadId, replyText) {
  if (memoInFlight.has(String(chatId))) return; // กันชนกับงานออกเอกสาร
  const status = await startStatus(chatId, [
    "📥 รับเรื่องตรวจเอกสาร Affiliate แล้วค่ะ เดี๋ยวตรวจให้เลยนะคะ 🔎",
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
      body: JSON.stringify({ chatId: String(chatId), fromId: String(from?.id || ""), isGroup: !!isGroup, rawText: text, files: saved, replyText: replyText || "" }),
    });
    data = await r.json();
  } catch { await status.finishText("ระบบหลังบ้านยังไม่พร้อมค่ะ ลองใหม่อีกครั้งนะคะ"); return; }
  if (data.error === "unauthorized") { status.stop(); if (status.msgId) await tg("deleteMessage", { chat_id: chatId, message_id: status.msgId }).catch(() => {}); return; }
  if (!data.ok) { await status.finishText("ตรวจเอกสารไม่สำเร็จค่ะ: " + (data.error || "")); return; }
  await status.finishDone("✅ ตรวจเอกสารเสร็จแล้วค่ะ สรุปให้เลยนะคะ");
  await sendResultSends(chatId, data.sends || [], threadId);
  await reactMsg(chatId, msgId, data.passed ? "✅" : "⚠️");
  // ตรวจเสร็จ → reply ข้อความแอดมินที่ส่งมา + แท็ก
  //   ผ่าน   = แท็กคนที่เจ้าของกำหนด บอกว่าใช้ข้อมูลได้เลย
  //   ไม่ผ่าน = แท็กแอดมินคนที่ส่ง บอกให้ตรวจสอบอีกครั้ง
  {
    const tagPerson = data.passed ? data.tagTarget : from;
    const mn = buildMention(tagPerson);
    const base = data.passed
      ? "✅ ตรวจเอกสารเรียบร้อย ข้อมูลถูกต้องครบถ้วน ใช้ดำเนินการต่อได้เลยค่ะ"
      : "⚠️ ตรวจเอกสารแล้ว พบข้อมูลบางจุดไม่ตรง รบกวนตรวจสอบและแก้ไขอีกครั้งนะคะ (ดูจุดที่มี ❌ ในสรุปด้านบน)";
    const extra = { ...sendOpts(threadId), reply_to_message_id: msgId };
    let outText = base;
    if (mn) { outText = `${mn.prefix} ${base}`; if (mn.entity) extra.entities = [mn.entity]; }
    await tg("sendMessage", { chat_id: chatId, text: outText, ...extra }).catch(() => {});
  }
}

// วานสร้างใบสำคัญรับเงิน Affiliate เอง + ตรวจเอง เมื่อบอทระบบแจ้ง noti (กลุ่มหน้าที่ aff)
// editInstruction != "" = โหมดแก้ไข (สร้างใหม่ตามที่แก้)
async function doAffMake(chatId, notiText, from, isGroup, msgId, threadId, editInstruction = "") {
  let data;
  try {
    const r = await fetch(APP_URL + "/api/telegram/aff-make", {
      method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify({ chatId: String(chatId), notiText, isGroup: !!isGroup, threadId: threadId ? String(threadId) : "", fromId: String(from?.id || ""), editInstruction }),
    });
    data = await r.json();
  } catch { return; }
  if (!data.ok || data.skip) return; // ไม่ใช่กลุ่ม aff / อ่าน noti ไม่ได้ → เงียบ

  // สถานะ: กำลังจัดทำ (แจ้งสั้น ๆ ในกลุ่ม แล้วลบทีหลัง)
  const wip = await tg("sendMessage", { chat_id: chatId, text: "🧾 กำลังจัดทำใบสำคัญรับเงินให้อัตโนมัติค่ะ...", ...sendOpts(threadId) }).catch(() => null);
  await sendResultSends(chatId, data.sends || [], threadId);
  if (wip?.result?.message_id) await tg("deleteMessage", { chat_id: chatId, message_id: wip.result.message_id }).catch(() => {});

  await reactMsg(chatId, msgId, data.allOk ? "✅" : "⚠️");

  // สรุป (แบบ Image#42) + แท็กเจ้าของ + ปุ่ม อนุมัติ/แก้ไข (เฉพาะเคสที่ทำเอกสารได้)
  if ((data.status === "ok" || data.status === "amount_mismatch") && data.summaryCaption) {
    const mn = buildMention(data.tagTarget);
    const head = data.allOk
      ? "✅ จัดทำและตรวจเอกสารเรียบร้อย พร้อมอนุมัติค่ะ"
      : "⚠️ จัดทำเอกสารแล้ว แต่มีจุดที่ต้องตรวจ (ดูรายงานด้านบน) ค่ะ";
    const extra = { ...sendOpts(threadId), reply_markup: keyboardFromButtons([{ text: "อนุมัติ ✅", data: "aff:ok" }, { text: "แก้ไข", data: "aff:edit" }]) };
    let text = `${head}\n\n${data.summaryCaption}`;
    if (mn) { text = `${mn.prefix}\n${text}`; if (mn.entity) extra.entities = [mn.entity]; }
    const sent = await tg("sendMessage", { chat_id: chatId, text, ...extra }).catch(() => null);
    // เก็บร่างไว้ให้ปุ่ม "อนุมัติ" หยิบไปตอบ (reply เข้า noti + แนบไฟล์ + สรุป + แท็ก)
    const smId = sent?.result?.message_id;
    if (smId) {
      const doc = (data.sends || []).find((s) => s.kind === "document");
      affDrafts[smId] = {
        chatId: String(chatId), notiMsgId: msgId, threadId: threadId ? String(threadId) : "",
        summary: data.summaryCaption, tag: data.tagTarget || null,
        pdfB64: doc?.dataBase64 || null, filename: doc?.filename || "ใบสำคัญรับเงิน.pdf",
        notiText, until: Date.now() + 24 * 3600 * 1000,
      };
    }
  }
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
    await status.finishDone(`✅ ทำสไลด์ "${data.title}" (${data.slideCount} สไลด์) จากไฟล์ให้แล้วค่ะ ส่งพรีวิวทีละหน้า แล้วปิดท้ายด้วยไฟล์ให้เลยนะคะ`);
    registerDeckMsgs(chatId, data.id, await sendResultSends(chatId, buildDeckSends(data)));
    await reactMsg(chatId, msgId, "✅");
    await notifyDelivery(chatId, isGroup, from, text, mentions, `สไลด์ "${data.title}"`);
  } finally {
    memoInFlight.delete(String(chatId));
  }
}

// สร้างชุดข้อความส่งเด็ค: รูปทุกหน้า → ปิดท้ายด้วยไฟล์ (PDF+HTML) · ฝัง #deck:id ในแคปชันไฟล์ (ไว้ reply แก้)
function buildDeckSends(data) {
  const safe = (data.title || "slides").replace(/[^\w฀-๿ ._-]/g, "").slice(0, 50) || "slides";
  const tag = `#deck:${data.id}`;
  const pageSends = (data.pages || []).map((u, i) => ({
    kind: "photo", url: u,
    ...(i === 0 ? { caption: `🖼️ ${data.title} · ${data.slideCount} สไลด์ (พรีวิวทีละหน้า)  ${tag}` } : {}),
  }));
  return [
    ...pageSends,
    { kind: "document", url: data.files.pdf, filename: `${safe}.pdf`, caption: `📄 ${data.title} (PDF)  ${tag}` },
    { kind: "document", url: data.files.html, filename: `${safe}.html`, caption: `🌐 ไฟล์เด็คเลื่อนดูได้ · อยากแก้/เพิ่มข้อมูล reply ไฟล์นี้หรือรูปไหนก็ได้ แล้วพิมพ์บอกได้เลยค่ะ  ${tag}` },
  ];
}

// เก็บไฟล์/ลิงก์เข้าคลังความรู้ (Obsidian) — วานอ่าน+ขยาย+จัดโครงสร้างเอง แล้วเก็บให้ค้นเจอทีหลัง
async function doKnowledgeSave(chatId, text, files, from, isGroup, msgId, threadId) {
  if (memoInFlight.has(String(chatId))) return;
  memoInFlight.add(String(chatId));
  try {
    const status = await startStatus(chatId, [
      "📥 รับเรื่องเก็บเข้าคลังความรู้แล้วค่ะ 🚀",
      "📎 กำลังอ่านเนื้อหาไฟล์/ลิงก์...",
      "🧠 กำลังสรุปและจัดโครงสร้างเป็นโน้ต...",
      "🗂️ กำลังบันทึกลงคลังความรู้ (Obsidian)...",
    ]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "waan-know-"));
    const saved = [];
    for (const f of files || []) {
      try { const s = await downloadFile(f.file_id, dir, f.file_name); if (s) saved.push(s); } catch { /* skip */ }
    }
    let data;
    try {
      const r = await fetch(APP_URL + "/api/telegram/knowledge", {
        method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
        body: JSON.stringify({ text: text || "", files: saved, fromId: String(from?.id || ""), chatId: String(chatId), isGroup: !!isGroup }),
      });
      data = await r.json();
    } catch { await status.finishText("ระบบหลังบ้านยังไม่พร้อมค่ะ ลองใหม่อีกครั้งนะคะ"); return; }
    if (data.error === "unauthorized") { status.stop(); if (status.msgId) await tg("deleteMessage", { chat_id: chatId, message_id: status.msgId }).catch(() => {}); return; }
    status.stop();
    if (status.msgId) await tg("deleteMessage", { chat_id: chatId, message_id: status.msgId }).catch(() => {});
    await sendResultSends(chatId, data.sends || [{ kind: "text", text: "เก็บเข้าคลังให้แล้วค่ะ" }], threadId || "");
    await reactMsg(chatId, msgId, "✅");
  } finally {
    memoInFlight.delete(String(chatId));
  }
}

// ขอไฟล์/รูปจากคลังความรู้กลับมา — ค้นในคลังแล้วส่งไฟล์จริงเข้าแชท
async function doKnowledgeFetch(chatId, query, from, isGroup, msgId, threadId) {
  await tg("sendChatAction", { chat_id: chatId, action: "upload_photo" }).catch(() => {});
  let data;
  try {
    const r = await fetch(APP_URL + "/api/telegram/knowledge", {
      method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify({ mode: "find", query, fromId: String(from?.id || ""), chatId: String(chatId), isGroup: !!isGroup }),
    });
    data = await r.json();
  } catch { await tg("sendMessage", { chat_id: chatId, text: "ระบบหลังบ้านยังไม่พร้อมค่ะ ลองใหม่อีกครั้งนะคะ" }); return; }
  if (data.error === "unauthorized") return;
  await sendResultSends(chatId, data.sends || [{ kind: "text", text: "ไม่เจอไฟล์ในคลังค่ะ" }], threadId || "");
  await reactMsg(chatId, msgId, "✅");
}

// แก้/ต่อยอดเด็คเดิม (reply เด็คแล้วสั่งแก้ หรือแนบไฟล์เพิ่มข้อมูล)
async function doSlideRevise(chatId, deckId, instruction, addFiles, from, isGroup, msgId, mentions) {
  if (memoInFlight.has(String(chatId))) return;
  memoInFlight.add(String(chatId));
  try {
    const status = await startStatus(chatId, [
      "📥 รับเรื่องแก้สไลด์แล้วค่ะ เดี๋ยวจัดให้นะคะ ✏️",
      "🔎 กำลังทบทวนเด็คเดิม + ข้อมูลที่เพิ่ม...",
      "📊 กำลังปรับสไลด์และกราฟ...",
      "🖼️ กำลังเรนเดอร์หน้าใหม่...",
      "⏳ ใกล้เสร็จแล้วค่ะ...",
    ]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "waan-slide-"));
    const saved = [];
    for (const f of addFiles || []) {
      try { const s = await downloadFile(f.file_id, dir, f.file_name); if (s) saved.push(s); } catch { /* skip */ }
    }
    let data;
    try {
      const r = await fetch(APP_URL + `/api/slides/${deckId}/revise`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
        body: JSON.stringify({ instruction: instruction || "", files: saved, fromId: String(from?.id || ""), chatId: String(chatId), isGroup: !!isGroup }),
      });
      data = await r.json();
    } catch { await status.finishText("ระบบหลังบ้านยังไม่พร้อมค่ะ ลองใหม่อีกครั้งนะคะ"); return; }
    if (data.error === "unauthorized") { status.stop(); if (status.msgId) await tg("deleteMessage", { chat_id: chatId, message_id: status.msgId }).catch(() => {}); return; }
    if (!data.ok) { await status.finishText("แก้สไลด์ไม่สำเร็จค่ะ: " + (data.error || "")); return; }
    await status.finishDone(`✅ แก้สไลด์ "${data.title}" ให้แล้วค่ะ (${data.slideCount} สไลด์) ส่งพรีวิวใหม่ทีละหน้า แล้วปิดท้ายด้วยไฟล์นะคะ`);
    registerDeckMsgs(chatId, data.id, await sendResultSends(chatId, buildDeckSends(data)));
    await reactMsg(chatId, msgId, "✅");
    await notifyDelivery(chatId, isGroup, from, instruction || "แก้สไลด์", mentions, `แก้สไลด์ "${data.title}"`);
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

// ส่งชุดผลลัพธ์ → คืน message_id ทุกข้อความที่ส่งสำเร็จ (ไว้ผูก reply กับเด็ค)
async function sendResultSends(chatId, sends, defaultThread) {
  const ids = [];
  for (const s of sends || []) {
    const tc = s.chatId || chatId;      // ส่งข้ามแชท/กลุ่มได้ (เช่น รายงานเข้าห้อง Lead)
    const thr = s.threadId || (s.chatId ? undefined : defaultThread); // ถ้าข้ามแชท ใช้ thread ของ send เท่านั้น
    let res = null;
    if (s.kind === "text") res = await tg("sendMessage", { chat_id: tc, text: s.text, ...sendOpts(thr, { ...(s.parseMode ? { parse_mode: s.parseMode } : {}), ...(s.buttons ? { reply_markup: keyboardFromButtons(s.buttons) } : {}) }) });
    else if (s.kind === "document") {
      await tg("sendChatAction", { chat_id: tc, action: "upload_document" });
      const buf = s.dataBase64 ? Buffer.from(s.dataBase64, "base64")
        : Buffer.from(await (await fetch(APP_URL + s.url, { headers: { "x-internal-token": INTERNAL } })).arrayBuffer());
      const form = new FormData();
      form.append("chat_id", String(tc));
      if (thr) form.append("message_thread_id", String(thr));
      if (s.caption) form.append("caption", s.caption);
      if (s.buttons) form.append("reply_markup", JSON.stringify(keyboardFromButtons(s.buttons)));
      form.append("document", new Blob([new Uint8Array(buf)]), s.filename || "file");
      res = await fetch(API("sendDocument"), { method: "POST", body: form }).then((x) => x.json()).catch(() => null);
    }
    else if (s.kind === "photo") {
      await tg("sendChatAction", { chat_id: tc, action: "upload_photo" });
      const buf = s.dataBase64 ? Buffer.from(s.dataBase64, "base64")
        : Buffer.from(await (await fetch(APP_URL + s.url, { headers: { "x-internal-token": INTERNAL } })).arrayBuffer());
      const form = new FormData();
      form.append("chat_id", String(tc));
      if (thr) form.append("message_thread_id", String(thr));
      if (s.caption) form.append("caption", s.caption);
      form.append("photo", new Blob([new Uint8Array(buf)]), s.filename || "screenshot.png");
      res = await fetch(API("sendPhoto"), { method: "POST", body: form }).then((x) => x.json()).catch(() => null);
    }
    // Telegram ปฏิเสธ → เดิมเงียบสนิท (เคยทำให้ปุ่มผูกกลุ่มหายไปเฉยๆ เพราะห้อง Lead ถูกปิด = TOPIC_CLOSED)
    if (!res?.ok) {
      const why = res?.description || "unknown";
      console.error(`ส่งไม่สำเร็จ (chat ${tc}${thr ? ` thread ${thr}` : ""}): ${why}`);
      // ส่งข้ามแชทไม่ได้ (ห้องปิด/ถูกเตะ/thread หาย) → ถอยมาส่งในแชทต้นทางแทน ดีกว่าเงียบหาย
      if (s.chatId && String(s.chatId) !== String(chatId)) {
        const fallbackText = s.kind === "text" ? `${s.text}\n\n(ส่งเข้าห้องเดิมไม่ได้: ${why})` : s.caption;
        const r2 = await tg("sendMessage", {
          chat_id: chatId,
          text: fallbackText || "(ส่งข้อความไม่สำเร็จ)",
          ...sendOpts(defaultThread, {
            ...(s.parseMode ? { parse_mode: s.parseMode } : {}),
            ...(s.buttons ? { reply_markup: keyboardFromButtons(s.buttons) } : {}),
          }),
        }).catch(() => null);
        if (r2?.result?.message_id) ids.push(r2.result.message_id);
      }
      continue;
    }
    if (res?.result?.message_id) ids.push(res.result.message_id);
  }
  return ids;
}

// จำว่า message ไหนเป็นของเด็คไหน (ไว้ให้ reply รูป/ไฟล์ไหนก็แก้เด็คนั้นได้ แม้รูปไม่มีแคปชัน)
const deckByMsg = {}; // `${chatId}:${msgId}` -> { deckId, ts }
function registerDeckMsgs(chatId, deckId, ids) {
  const now = Date.now();
  for (const k of Object.keys(deckByMsg)) if (now - deckByMsg[k].ts > 7 * 864e5) delete deckByMsg[k]; // prune >7 วัน
  for (const id of ids || []) deckByMsg[`${chatId}:${id}`] = { deckId, ts: now };
}
function deckIdForReply(chatId, replyMsgId, replyText) {
  const m = (replyText || "").match(/#deck:([a-f0-9]{8})/);
  if (m) return m[1];
  if (replyMsgId && deckByMsg[`${chatId}:${replyMsgId}`]) return deckByMsg[`${chatId}:${replyMsgId}`].deckId;
  return null;
}

async function postIngest(chatId, text, from, isGroup, replyTo, replyText, mentions, imageFiles, threadId, chatTitle, addressed) {
  const res = await fetch(APP_URL + "/api/telegram/ingest", {
    method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
    body: JSON.stringify({ chatId: String(chatId), text, fromId: String(from?.id || ""), fromName: from?.name || "", fromUsername: from?.username || "", isGroup: !!isGroup, threadId: threadId ? String(threadId) : "", chatTitle: chatTitle || "", replyTo: replyTo || null, replyText: replyText || "", mentions: mentions || [], imageFiles: imageFiles || [], addressed: !!addressed }),
  });
  return res.json();
}

// "ตั้งใจทำสไลด์จริงไหม" — เจตนาต้องอยู่ต้นประโยค กันประโยคยาวที่เอ่ยถึงสไลด์ลอยๆ ไปเด้งทำสไลด์ผิด
function looksLikeSlide(text) {
  const t = (text || "").replace(/^\s*(?:วาน|น้องวาน)[\s,:ๆจ]*/i, "").replace(/@\S+/g, "").trim();
  if (/^\s*(?:\/slide|สร้างสไลด์|ทำสไลด์|ขอสไลด์|สไลด์|พรีเซนต์|นำเสนอ|เด็ค|deck)/i.test(t)) return true;
  const idx = t.search(/สไลด์|slide|พรีเซนต์|นำเสนอ|เด็ค|deck/i);
  return idx >= 0 && idx <= 18 && /(ทำ|สร้าง|ขอ|ช่วย|จัด|ออกแบบ|สรุป|แปลง|generate)/i.test(t.slice(0, idx + 12));
}

// ปุ่ม inline: string → callback opt:<index> (Lead) · {text,data} → callback ตามที่กำหนด (เช่น gfunc:aff)
function keyboardFromButtons(buttons) {
  if (!buttons || !buttons.length) return undefined;
  return {
    inline_keyboard: buttons.map((b, i) =>
      typeof b === "object" && b.data
        ? [{ text: String(b.text).slice(0, 64), callback_data: String(b.data).slice(0, 64) }]
        : [{ text: String(b).slice(0, 64), callback_data: `opt:${i}` }],
    ),
  };
}
// ตัวเลือกส่งข้อความที่รองรับ topic (message_thread_id) + ปุ่ม
function sendOpts(threadId, extra = {}) {
  return { ...(threadId ? { message_thread_id: Number(threadId) } : {}), ...extra };
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

async function chatIngest(chatId, text, from, isGroup, replyTo, msgId, replyText, mentions, imagePaths, threadId, chatTitle, addressed = true) {
  const isSlide = looksLikeSlide(text);

  // งานสไลด์ = ใช้เวลานาน → แสดงสถานะเต็ม
  if (isSlide) {
    const status = await startStatus(chatId, [
      "📥 โอเคค่ะ รับเรื่องทำสไลด์แล้ว เดี๋ยวจัดให้เลยนะคะ 🚀",
      "🔎 กำลังดึงข้อมูลจริง...", "📊 กำลังจัดสไลด์และกราฟ...", "🖼️ กำลังตกแต่งให้สวย...", "⏳ ใกล้เสร็จแล้วค่ะ...",
    ]);
    let data;
    try { data = await postIngest(chatId, text, from, isGroup, replyTo, replyText, mentions, imagePaths, threadId, chatTitle, addressed); }
    catch { await status.finishText("ระบบหลังบ้านยังไม่พร้อมค่ะ ลองใหม่อีกครั้งนะคะ"); return; }
    const sends = data.sends || [];
    if (sends.length === 0) { status.stop(); if (status.msgId) await tg("deleteMessage", { chat_id: chatId, message_id: status.msgId }).catch(() => {}); return; }
    await status.finishDone("✅ ทำสไลด์เสร็จแล้วค่ะ ส่งให้เลยนะคะ");
    const dref = sends.map((s) => s.caption || "").join(" ").match(/#deck:([a-f0-9]{8})/);
    const sentIds = await sendResultSends(chatId, sends, threadId);
    if (dref) registerDeckMsgs(chatId, dref[1], sentIds);
    await reactMsg(chatId, msgId, "✅");
    await notifyDelivery(chatId, isGroup, from, text, mentions, "สไลด์");
    return;
  }

  // แชททั่วไป/ทักทาย = ตอบธรรมชาติ (โชว์ "กำลังพิมพ์" ไว้ ถ้าช้าเกิน 7 วิ ค่อยบอกว่ากำลังหา)
  await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  const typingTimer = setInterval(() => tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {}), 4000);
  let softId = null;
  const softTimer = setTimeout(async () => {
    const m = await tg("sendMessage", { chat_id: chatId, text: "🔎 กำลังหาข้อมูลให้อยู่แป๊บนะคะ...", ...sendOpts(threadId) }).catch(() => null);
    softId = m?.result?.message_id || null;
  }, 7000);

  let data;
  try { data = await postIngest(chatId, text, from, isGroup, replyTo, replyText, mentions, imagePaths, threadId, chatTitle, addressed); }
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
    const kb = keyboardFromButtons(texts[0].buttons);
    const kbExtra = kb ? { reply_markup: kb } : {};
    // ในกลุ่ม: แท็ก "คนที่ควรถูกพูดด้วย" = ถ้าผู้ส่งแท็กใครไว้ → คนนั้น (เช่น "ทักทาย Orin") ไม่งั้น → คนที่ถามเอง
    if (isGroup && msgId) {
      if (softId) await tg("deleteMessage", { chat_id: chatId, message_id: softId }).catch(() => {});
      // การ์ดระบบ (usage/board) หรือข้อความ HTML ที่จัดฟอร์แมต/แท็กมาเองแล้ว (เช่น คำทักทายตอนเพิ่มทีม)
      // → ส่งตรงด้วย parse_mode ไม่ต้องเติมชื่อนำหน้า/ใช้ entity (กัน HTML โชว์ดิบ + แท็กซ้ำ)
      if (texts[0].plain || texts[0].parseMode === "HTML") { await tg("sendMessage", { chat_id: chatId, text: texts[0].text, ...sendOpts(threadId, { ...pm, ...kbExtra }) }); return; }
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
      const extra = { ...sendOpts(threadId, kbExtra), ...((mentions && mentions.length) ? {} : { reply_to_message_id: msgId }) };
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
      await tg("editMessageText", { chat_id: chatId, message_id: softId, text: texts[0].text, ...pm, ...kbExtra }).catch(() => {});
    } else {
      await tg("sendMessage", { chat_id: chatId, text: texts[0].text, ...sendOpts(threadId, { ...pm, ...kbExtra }) });
    }
    return;
  }
  // มีรูป/ไฟล์แนบด้วย → ถ้ามีข้อความ ให้แก้ soft msg เป็นข้อความแรก (คงปุ่ม+parse_mode ไว้) แล้วส่งเฉพาะรูป/ไฟล์ที่เหลือ
  if (softId && texts.length >= 1) {
    const t0 = texts[0];
    const kb0 = keyboardFromButtons(t0.buttons);
    await tg("editMessageText", { chat_id: chatId, message_id: softId, text: t0.text, ...(t0.parseMode ? { parse_mode: t0.parseMode } : {}), ...(kb0 ? { reply_markup: kb0 } : {}) }).catch(() => {});
    await sendResultSends(chatId, sends.filter((s) => s !== t0), threadId);
    return;
  }
  if (softId) await tg("deleteMessage", { chat_id: chatId, message_id: softId }).catch(() => {});
  await sendResultSends(chatId, sends, threadId);
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
      await tg("sendMessage", { chat_id: OWNER_CHAT_ID, text: `รายงานค่ะ ทำ${label}ในกลุ่มเสร็จเรียบร้อยแล้ว${to}ค่ะ 👀` });
    }
  } catch { /* แจ้งเตือนพลาดไม่เป็นไร ไม่ให้กระทบงานหลัก */ }
}

// สร้างการแท็กที่ "ติดจริง": มี username → @username (auto-link) · ไม่มี → text_mention entity (คลิกได้แม้ไม่มี username)
// เจ้าของ (โด้) เป็น mention — ใช้ id จากแชทส่วนตัว (= user id) + ชื่อจากรายชื่อทีม
function ownerMention() {
  if (!OWNER_CHAT_ID) return null;
  const r = (ROSTER || []).find((m) => String(m.id) === String(OWNER_CHAT_ID));
  return { id: OWNER_CHAT_ID, name: (r && r.name) || "พี่โด้", username: r && r.username };
}

function buildMention(from) {
  if (!from) return null;
  if (from.username) return { prefix: `@${from.username}`, entity: null };
  const name = String(from.name || "").trim();
  const uid = Number(from.id);
  if (!name || !Number.isFinite(uid) || uid <= 0) return null;
  return { prefix: name, entity: { type: "text_mention", offset: 0, length: name.length, user: { id: uid } } };
}

const privateDeclined = new Set(); // จำแชทส่วนตัวที่ไม่ใช่เจ้าของ — แจ้งปฏิเสธครั้งเดียวพอ

async function processBatch(chatId, msgs) {
  let addressedNow = true; // แชทส่วนตัว = คุยกับวานตรง ๆ อยู่แล้ว · ในกลุ่มจะคำนวณใหม่ด้านล่าง
  const chatType = msgs[0]?.chat?.type || "private";
  const isGroup = chatType === "group" || chatType === "supergroup";
  const threadId = msgs[0]?.message_thread_id ? String(msgs[0].message_thread_id) : "";
  const chatTitle = msgs[0]?.chat?.title || "";
  const from = personOf(msgs[0]?.from);

  // แชทส่วนตัว: ใช้ได้เฉพาะเจ้าของ (โด้) เท่านั้น — คนอื่น DM มา บอทไม่ตอบ (แจ้งปฏิเสธครั้งเดียว)
  // fail-open ถ้ายังโหลด OWNER_CHAT_ID ไม่ได้ กันล็อกเจ้าของออกเอง
  if (!isGroup && OWNER_CHAT_ID && String(from?.id || "") !== String(OWNER_CHAT_ID)) {
    if (!privateDeclined.has(String(chatId))) {
      privateDeclined.add(String(chatId));
      await tg("sendMessage", { chat_id: chatId, text: "ขออภัยค่ะ บอทนี้เป็นผู้ช่วยส่วนตัวของผู้ดูแลระบบ ใช้งานได้เฉพาะเจ้าของค่ะ 🙏" }).catch(() => {});
    }
    console.log(`ปฏิเสธแชทส่วนตัวจาก ${from?.name || from?.id} (ไม่ใช่เจ้าของ)`);
    return;
  }
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

  // reply เด็คเดิม (รูป/ไฟล์ไหนก็ได้ของเด็คนั้น) + พิมพ์คำสั่ง/แนบไฟล์เพิ่ม → แก้/ต่อยอดเด็คนั้น (คงบริบทเดิม)
  const replyDeckId = deckIdForReply(chatId, replyMsg?.message_id, replyText);
  if (replyDeckId && (text || files.length)) {
    const addFiles = msgs.map(extractFile).filter(Boolean); // เฉพาะไฟล์ที่แนบมาในข้อความนี้ (ไม่รวมไฟล์เด็คเดิมที่ถูก reply)
    recentFiles[chatId] = [];
    recentTexts[chatId] = [];
    await reactMsg(chatId, triggerMsgId, "👀");
    await doSlideRevise(chatId, replyDeckId, text, addFiles, from, isGroup, triggerMsgId, mentions).catch((e) => console.error("slideRevise err:", e.message));
    return;
  }

  // noti "กำลังรออนุมัติ" จากบอทระบบ → จำข้อมูล (ยูสเซอร์/วันที่/ยอด) ไว้ cross-check + กดรีแอครับทราบ
  // ยังไม่ตรวจ รอแอดมินส่งไฟล์ + แท็กเอง แล้วค่อยตรวจ
  // บอทระบบแจ้ง "อนุมัติเรียบร้อย" (เงินออกสำเร็จ) → กดหัวใจรับทราบ ไม่ต้องทำเอกสาร
  if (/(อนุมัติเรียบร้อย|อนุมัติแล้ว)/.test(text) && !/กำลังรออนุมัติ/.test(text) && /(ได้แจ้งถอนเงิน|รายละเอียดบัญชี)/.test(text)) {
    await reactMsg(chatId, triggerMsgId, "❤️");
    return;
  }

  if (/กำลังรออนุมัติ/.test(text) && /(ได้แจ้งถอนเงิน|รายละเอียดบัญชี)/.test(text)) {
    await reactMsg(chatId, triggerMsgId, "👀");
    try {
      await fetch(APP_URL + "/api/telegram/aff-notify", {
        method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
        body: JSON.stringify({ chatId: String(chatId), text }),
      });
    } catch { /* จำไม่ได้ก็ยังตรวจได้จากวันที่ในเอกสาร */ }
    // ใหม่: ถ้ากลุ่มนี้ทำหน้าที่ aff → วานจัดทำใบสำคัญรับเงินเอง + ตรวจเอง แล้วรอเจ้าของกดอนุมัติ
    await doAffMake(chatId, text, from, isGroup, triggerMsgId, threadId).catch((e) => console.error("affMake err:", e.message));
    // จำ noti นี้ไว้ → แอดมินพิมพ์คำสั่งแก้ทีหลังได้เลย ไม่ต้องกดปุ่ม "แก้ไข" (แก้ปัญหา flow ล็อค/ขอไฟล์)
    lastAffNoti[chatId] = { notiText: text, notiMsgId: triggerMsgId, threadId: threadId ? String(threadId) : "", until: Date.now() + AFF_NOTI_TTL };
    return;
  }

  // noti "ขอคืนเครดิตบริการ" จากบอทระบบ ([#REQUEST_REFUND_SERVICE]) → จำ ไอดีบริการ/ชื่อร้าน ไว้ตรวจเพิ่ม
  // เป็นแค่ "ตัวเร่ง" — ระบบหลักเฝ้าหน้า /admin/refund เองอยู่แล้ว (Telegram อาจไม่ส่งข้อความบอทตัวอื่นให้เรา)
  if (/#REQUEST_REFUND_SERVICE/.test(text) || (/ขอคืนเครดิตบริการ/.test(text) && /ได้ยื่นคำร้องขอคืนเครดิต/.test(text))) {
    await reactMsg(chatId, triggerMsgId, "👀");
    try {
      await fetch(APP_URL + "/api/telegram/refund-notify", {
        method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
        body: JSON.stringify({ chatId: String(chatId), text }),
      });
    } catch { /* จำไม่ได้ก็ยังตรวจได้จากหน้าหลังบ้าน */ }
    return;
  }

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
    await doAffCheck(chatId, affText, files, from, isGroup, triggerMsgId, threadId, replyText);
    return;
  }

  // ในกลุ่ม: ตอบเฉพาะเมื่อถูกเรียก หรือ "เปิดหูรอ" อยู่ (หลังถูกแท็ก รอข้อความ/forward ถัดไป)
  if (isGroup) {
    const repliedToBot = msgs.some((m) => m.reply_to_message?.from?.id === BOT_ID);
    const mentioned = BOT_USERNAME && text.toLowerCase().includes("@" + BOT_USERNAME.toLowerCase());
    const calledByName = /น้องวาน/.test(text);
    // ขึ้นต้นด้วย "วาน" = เรียกน้องวาน (ติดคำถัดไปก็ได้ เช่น "วานเชื่อมกลุ่ม") ยกเว้น วานนี้/วานซืน/วานซาน (=เมื่อวาน)
    const namePrefix = /^\s*วาน(?!นี้|ซืน|ซาน)/i.test(text);
    // คำสั่งตั้งค่า/แอดมิน — พิมพ์ตรงๆ ได้ ไม่ต้องมี "วาน" นำ (สะดวกตอนตั้งห้อง/ผูกกลุ่ม/ดู usage)
    const setupCmd = /^\s*(ตั้งห้องนี้เป็น|ห้องนี้คือ|บทบาท|set\s*role|ผูกกลุ่ม|bind|แนะนำตัว|เชื่อมกลุ่ม|เริ่มงาน|บอร์ด|board|สรุปงาน|เพิ่มงาน|\+task|ลงงาน|อัปเดต\s*T\d|ปิดงาน\s*T\d|ตรวจเสร็จให้แท็ก|usage|monitor|สรุปการใช้งาน|การใช้งาน)/i.test(text);
    // กลุ่ม dedicated (เช่น ขยายวันหมดอายุ Thunder) = ประมวลผลทุกข้อความ ไม่ต้องขึ้นต้น "วาน"
    const isDedicated = dedicatedGroups.has(String(chatId));
    // เรียกวานตรง ๆ (แท็ก/ชื่อ/reply) ≠ กลุ่ม dedicated ที่รับทุกข้อความอยู่แล้ว
    // กลุ่มหน้าที่เดียวบางกลุ่ม (เช่น สถานะใบกำกับ) ต้องแยกให้ออก จะได้เงียบตอนทีมคุยกันเอง
    addressedNow = repliedToBot || mentioned || calledByName || namePrefix || setupCmd;
    const triggered = addressedNow || isDedicated;
    const armed = armedUntil[chatId] && now < armedUntil[chatId];
    const memoWaiting = memoPending[chatId] && now < memoPending[chatId];
    const haveFiles = (recentFiles[chatId] || []).length > 0;
    const editingNow = editingMemo[chatId] && now < editingMemo[chatId].until;
    // ถ้ากำลังรอออกเอกสาร/รอคำสั่งแก้เอกสารอยู่ → รับไว้แม้ไม่ถูกแท็ก (เช่น forward/พิมพ์ต่อ)
    if (!triggered && !armed && !(memoWaiting && haveFiles) && !editingNow) return; // ไม่ได้ถูกเรียก/เปิดหูรอ — เงียบ
    if (triggered) {
      text = text
        .replace(/น้องวาน/g, "")
        .replace(/^\s*วาน(?!นี้|ซืน|ซาน)[\s,:ๆจ]*/i, "")
        .replace(new RegExp("@" + BOT_USERNAME, "gi"), "")
        .trim();
    }
    if (armed && !triggered) delete armedUntil[chatId]; // ใช้สิทธิ์เปิดหูรอกับข้อความนี้

    // ถูกเรียกเฉยๆ ยังไม่มีเนื้อหา/ไฟล์ → เปิดหูรอข้อความ/forward ถัดไป 90 วิ
    const seenNow = new Set();
    const bufferedNow = (recentFiles[chatId] || []).filter((f) => !seenNow.has(f.file_id) && seenNow.add(f.file_id));
    if (triggered && text.length < 2 && bufferedNow.length === 0) {
      armedUntil[chatId] = now + 90000;
      await tg("sendMessage", { chat_id: chatId, text: "ค่ะ ว่ามาได้เลยค่ะ 👀 พิมพ์ แนบไฟล์ หรือฟอร์เวิร์ดข้อความมาได้เลยนะคะ" });
      return;
    }
    if (!text) text = "สวัสดี";
  }

  // กดอิโมจิรีแอคชันบนข้อความสั่ง (วิเคราะห์เนื้อหา) เป็นการรับรู้ทันที ก่อนลงมือทำ
  const haveFilesNow = (recentFiles[chatId] || []).length > 0;
  await reactMsg(chatId, triggerMsgId, pickReaction(text, { hasFiles: haveFilesNow, isMemo: MEMO_INTENT.test(text) }));

  // reply ไฟล์ "เอกสารคืนเงิน" (จากเว็บ/บอท) แล้วพิมพ์คำสั่ง → แก้ไขเอกสารตัวนั้นเลย (patch ฟิลด์ผ่าน AI)
  if (replyMsg?.message_id && text) {
    try {
      const r = await fetch(APP_URL + `/api/memo/by-message?chatId=${encodeURIComponent(String(chatId))}&msgId=${replyMsg.message_id}`, {
        headers: { "x-internal-token": INTERNAL },
      });
      const j = await r.json().catch(() => ({}));
      if (j.id) {
        await reactMsg(chatId, triggerMsgId, "👀");
        await doRevise(chatId, j.id, text, from, isGroup, triggerMsgId);
        return;
      }
    } catch { /* ไม่ใช่ memo หรือ backend ไม่พร้อม → ปล่อยให้ flow อื่นทำต่อ */ }
  }

  // โหมดแก้ใบสำคัญรับเงิน AFF: กด "แก้ไข" แล้วพิมพ์ หรือ พิมพ์คำสั่งแก้ในกลุ่มที่เพิ่งทำเอกสาร (ไม่ต้องกดปุ่มซ้ำ)
  // รับเฉพาะข้อความที่ "ดูเป็นคำสั่งแก้" (มีที่อยู่/ชื่อ/ยอด) — ข้อความคุยเล่น ("รอแปปครับ") ไม่กิน คง state ไว้
  const editingAffNow = editingAff[chatId] && now < editingAff[chatId].until;
  const lastAffNow = lastAffNoti[chatId] && now < lastAffNoti[chatId].until;
  if ((editingAffNow || lastAffNow) && text && looksLikeAffEdit(text)) {
    const ctx = (editingAffNow ? editingAff[chatId] : null) || lastAffNoti[chatId];
    delete editingAff[chatId];
    delete armedUntil[chatId];
    // ไม่ลบ lastAffNoti — แก้ซ้ำได้หลายครั้งใน 3 ชม.
    await reactMsg(chatId, triggerMsgId, "👀");
    await doAffMake(chatId, ctx.notiText, from, isGroup, ctx.notiMsgId, ctx.threadId, text);
    return;
  }

  // โหมดแก้เอกสาร: กด "แก้ไข" แล้วพิมพ์บอกว่าอยากแก้อะไร → ออกร่างใหม่ตัวเดิม (ไม่หลุดไปแชททั่วไป)
  const editing = editingMemo[chatId] && now < editingMemo[chatId].until;
  const isSlideish = looksLikeSlide(text);
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

  // ขอไฟล์/รูปจากคลังความรู้กลับมา (คำสั่งข้อความล้วน ไม่ต้องมีไฟล์แนบ) — เช็คก่อนโหมดเก็บ
  if (text && all.length === 0 && KNOWLEDGE_FETCH_INTENT.test(text) && !MEMO_INTENT.test(text) && !isSlideish) {
    await reactMsg(chatId, triggerMsgId, "👀");
    await doKnowledgeFetch(chatId, text, from, isGroup, triggerMsgId, threadId);
    return;
  }

  // สั่งเก็บไฟล์/ลิงก์เข้าคลังความรู้ (Obsidian) — "เก็บไฟล์นี้", "เพิ่มไฟล์นี้เก็บหน่อย" หรือพูดหลวม ๆ ที่สื่อว่าเก็บ (ตราบใดที่มีไฟล์)
  const knowledgeWaiting = knowledgePending[chatId] && now < knowledgePending[chatId];
  const knowledgeIntent = !!(
    text &&
    (KNOWLEDGE_INTENT.test(text) || (SAVE_VERB.test(text) && all.length > 0)) &&
    !MEMO_INTENT.test(text) &&
    !isSlideish &&
    !affReqIntent
  );
  const hasUrlNow = /https?:\/\//i.test(text) || /https?:\/\//i.test(replyText || "");
  if (knowledgeIntent || (knowledgeWaiting && all.length > 0)) {
    // มีไฟล์แนบ หรือมีลิงก์ในข้อความ/ที่ reply → เก็บได้เลย
    if (all.length > 0 || hasUrlNow) {
      const saveText = [text, replyText].filter(Boolean).join("\n"); // รวม reply เผื่อลิงก์อยู่ในข้อความที่ reply
      recentFiles[chatId] = [];
      recentTexts[chatId] = [];
      delete knowledgePending[chatId];
      await doKnowledgeSave(chatId, saveText, all, from, isGroup, triggerMsgId, threadId);
      return;
    }
    // ยังไม่มีไฟล์/ลิงก์ → เปิดหูรอไฟล์ถัดไป
    knowledgePending[chatId] = now + BUFFER_TTL;
    armedUntil[chatId] = now + BUFFER_TTL;
    await reactMsg(chatId, triggerMsgId, "👀");
    await tg("sendMessage", { chat_id: chatId, text: "รับเรื่องเก็บเข้าคลังความรู้ค่ะ ส่งไฟล์ (PDF/Word/รูป/ข้อความ) หรือวางลิงก์มาได้เลยนะคะ" });
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
      await chatIngest(chatId, text, from, isGroup, replyTo, triggerMsgId, replyText, mentions, null, threadId, chatTitle, addressedNow);
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
    await chatIngest(chatId, text, from, isGroup, replyTo, triggerMsgId, replyText, mentions, imgPaths, threadId, chatTitle, addressedNow);
    return;
  }
}

// กลุ่มอัปเกรดเป็น supergroup → id เปลี่ยน (migrate_to/from_chat_id): คัดลอก config เก่า→ใหม่ กันหน้าที่กลุ่มหลุด
async function migrateGroup(oldId, newId) {
  try {
    const r = await fetch(APP_URL + "/api/telegram/migrate-group", {
      method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify({ oldId: String(oldId), newId: String(newId) }),
    });
    const j = await r.json();
    console.log(`ย้าย config กลุ่ม ${oldId} → ${newId}:`, j.ok ? (j.changed || []).join(", ") || "(ไม่มีอะไรต้องย้าย)" : "ล้มเหลว");
    await refreshDedicated(); // เผื่อกลุ่มนั้นเป็น dedicated (thunder_expiry)
  } catch (e) { console.error("migrateGroup err:", e.message); }
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  // กลุ่มถูกอัปเกรดเป็น supergroup → คัดลอกการตั้งค่ากลุ่มไป id ใหม่ (ทำครั้งเดียวแล้วจบ)
  if (msg.migrate_to_chat_id) { await migrateGroup(chatId, msg.migrate_to_chat_id); return; }
  if (msg.migrate_from_chat_id) { await migrateGroup(msg.migrate_from_chat_id, chatId); return; }
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
  // กดปุ่มเลือก "หน้าที่กลุ่ม" (gfunc:<id>[:<targetChatId>]) — เจ้าของเท่านั้น
  const gf = String(cb.data || "").match(/^gfunc:[a-z_]+/);
  if (gf) {
    const thr = cb.message?.message_thread_id ? String(cb.message.message_thread_id) : "";
    let out;
    try {
      const res = await fetch(APP_URL + "/api/telegram/callback", {
        method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
        body: JSON.stringify({ chatId: String(chatId), fromId: String(cb.from?.id || ""), data: cb.data || "" }),
      });
      out = await res.json();
    } catch { out = { answer: "ระบบหลังบ้านไม่พร้อม", sends: [] }; }
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: out.answer || "" }).catch(() => {});
    await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    await sendResultSends(chatId, out.sends || [], thr);
    return;
  }
  // กดปุ่มตั้งบทบาทห้อง (setrole:<role>[:<targetChatId>]) เช่น ตั้งกลุ่มเป็นห้อง Usage Monitor — เจ้าของเท่านั้น
  const srb = String(cb.data || "").match(/^setrole:[a-z]+/);
  if (srb) {
    const thr = cb.message?.message_thread_id ? String(cb.message.message_thread_id) : "";
    let out;
    try {
      const res = await fetch(APP_URL + "/api/telegram/callback", {
        method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
        body: JSON.stringify({ chatId: String(chatId), fromId: String(cb.from?.id || ""), data: cb.data || "" }),
      });
      out = await res.json();
    } catch { out = { answer: "ระบบหลังบ้านไม่พร้อม", sends: [] }; }
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: out.answer || "" }).catch(() => {});
    await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    await sendResultSends(chatId, out.sends || [], thr);
    return;
  }
  // กดปุ่มตั้งกลุ่มเป็นห้องมอนิเตอร์แชท OHO (ohomon[:<targetChatId>]) — เจ้าของเท่านั้น
  const omb = String(cb.data || "").match(/^ohomon/);
  if (omb) {
    const thr = cb.message?.message_thread_id ? String(cb.message.message_thread_id) : "";
    let out;
    try {
      const res = await fetch(APP_URL + "/api/telegram/callback", {
        method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
        body: JSON.stringify({ chatId: String(chatId), fromId: String(cb.from?.id || ""), data: cb.data || "" }),
      });
      out = await res.json();
    } catch { out = { answer: "ระบบหลังบ้านไม่พร้อม", sends: [] }; }
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: out.answer || "" }).catch(() => {});
    await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    await sendResultSends(chatId, out.sends || [], thr);
    return;
  }
  // กดปุ่มยืนยัน/ยกเลิก ปรับวันหมดอายุ Thunder (texp:ok:<username> | texp:cancel) — เจ้าของ/ทีมที่อนุญาต
  const texpb = String(cb.data || "").match(/^texp:/);
  if (texpb) {
    const thr = cb.message?.message_thread_id ? String(cb.message.message_thread_id) : "";
    const fromName = [cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(" ") || cb.from?.username || "";
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: /cancel/.test(cb.data) ? "ยกเลิกแล้ว" : "กำลังปรับให้ค่ะ รอสักครู่..." }).catch(() => {});
    await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    let out;
    try {
      const res = await fetch(APP_URL + "/api/telegram/callback", {
        method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
        body: JSON.stringify({ chatId: String(chatId), fromId: String(cb.from?.id || ""), fromName, data: cb.data || "" }),
      });
      out = await res.json();
    } catch { out = { sends: [{ kind: "text", text: "ระบบหลังบ้านไม่พร้อมค่ะ" }] }; }
    await sendResultSends(chatId, out.sends || [], thr);
    return;
  }
  // กดปุ่มคำขอคืนเครดิต Thunder (tref:ok|no|detail:<refundId>)
  const trefb = String(cb.data || "").match(/^tref:(ok|no|detail):/);
  if (trefb) {
    const thr = cb.message?.message_thread_id ? String(cb.message.message_thread_id) : "";
    const fromName = [cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(" ") || cb.from?.username || "";
    const act = trefb[1];
    const ack = act === "ok" ? "กำลังคืนให้ค่ะ รอสักครู่..." : act === "no" ? "รับทราบค่ะ" : "";
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: ack }).catch(() => {});
    // "ดูรายละเอียด" ต้องเหลือปุ่มไว้ให้กดคืนต่อได้ — ปิดปุ่มเฉพาะตอนตัดสินใจแล้ว
    if (act !== "detail") {
      await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    }
    let out;
    try {
      const res = await fetch(APP_URL + "/api/telegram/callback", {
        method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
        body: JSON.stringify({ chatId: String(chatId), fromId: String(cb.from?.id || ""), fromName, data: cb.data || "" }),
      });
      out = await res.json();
    } catch { out = { sends: [{ kind: "text", text: "ระบบหลังบ้านไม่พร้อมค่ะ" }] }; }
    await sendResultSends(chatId, out.sends || [], thr);
    return;
  }
  // กดปุ่มอนุมัติ/แก้ไข ใบสำคัญรับเงินที่วานจัดทำ (aff:ok | aff:edit)
  const affCb = String(cb.data || "").match(/^aff:(ok|edit)$/);
  if (affCb) {
    const thr = cb.message?.message_thread_id ? String(cb.message.message_thread_id) : "";
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: affCb[1] === "ok" ? "อนุมัติแล้ว ✅" : "รับทราบ จะแก้ให้ค่ะ" }).catch(() => {});
    await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    const d = affDrafts[cb.message.message_id];
    if (affCb[1] === "edit") {
      // จำว่ากำลังแก้เคสไหน + เปิดหูรอคำสั่งแก้ถัดไป (แม้ไม่แท็ก)
      if (d) {
        editingAff[chatId] = { notiText: d.notiText, notiMsgId: d.notiMsgId, threadId: d.threadId, until: Date.now() + EDIT_TTL };
        armedUntil[chatId] = Date.now() + EDIT_TTL;
      }
      await tg("sendMessage", { chat_id: chatId, text: "รับทราบค่ะ อยากให้แก้ตรงไหน พิมพ์บอกได้เลยนะคะ\n(เช่น \"วันที่ 7/07/69\" · \"ยอด 1420\" · \"ธนาคาร: กสิกรไทย เลขบัญชี: 1234567890\" · \"ที่อยู่ บ้านเลขที่ 12 หมู่ 3 ต.X อ.Y จ.Z\")", ...sendOpts(thr), reply_to_message_id: cb.message.message_id }).catch(() => {});
      return;
    }
    // อนุมัติ: Reply เข้าข้อความ noti บอทระบบ + แนบไฟล์ + สรุป (ชุด reply เดียว) แล้ว "อนุมัติแล้วค่ะ✅ + แท็ก"
    if (d && d.pdfB64) {
      const form = new FormData();
      form.append("chat_id", d.chatId);
      if (d.threadId) form.append("message_thread_id", d.threadId);
      form.append("reply_to_message_id", String(d.notiMsgId));
      form.append("caption", d.summary);
      form.append("document", new Blob([Buffer.from(d.pdfB64, "base64")]), d.filename);
      await fetch(API("sendDocument"), { method: "POST", body: form }).catch(() => {});
      const mn = buildMention(d.tag);
      const extra = { ...sendOpts(d.threadId), reply_to_message_id: Number(d.notiMsgId) };
      let text = "อนุมัติแล้วค่ะ✅";
      if (mn) { text = `${mn.prefix} ${text}`; if (mn.entity) extra.entities = [{ ...mn.entity, offset: 0 }]; }
      await tg("sendMessage", { chat_id: d.chatId, text, ...extra }).catch(() => {});
      delete affDrafts[cb.message.message_id];
    } else {
      await tg("sendMessage", { chat_id: chatId, text: "✅ อนุมัติแล้วค่ะ เอกสารพร้อมนำไปใช้ได้เลย", ...sendOpts(thr), reply_to_message_id: cb.message.message_id }).catch(() => {});
    }
    return;
  }
  // กดปุ่มตัวเลือกของ Lead (opt:<index>) → เอา label ปุ่มนั้นเป็นคำตอบของเจ้าของ แล้วเดินเรื่องต่อในห้องเดิม
  const optM = String(cb.data || "").match(/^opt:(\d+)$/);
  if (optM) {
    const idx = Number(optM[1]);
    const kb = (cb.message?.reply_markup?.inline_keyboard || []).flat();
    const choice = kb[idx]?.text || "";
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: choice ? `เลือก: ${choice}` : "" }).catch(() => {});
    await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    if (choice) {
      const chatType = cb.message?.chat?.type || "group";
      const isGroup = chatType === "group" || chatType === "supergroup";
      const thr = cb.message?.message_thread_id ? String(cb.message.message_thread_id) : "";
      await chatIngest(chatId, choice, personOf(cb.from), isGroup, null, cb.message.message_id, "", [], null, thr);
    }
    return;
  }
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

  // Usage Monitor — โพสต์การ์ดเข้าห้อง monitor + เตือนเจ้าของเมื่อใกล้เต็ม
  const monitorMinutes = Number(process.env.USAGE_MONITOR_MINUTES || 60);
  const runMonitor = async () => {
    try {
      const r = await fetch(APP_URL + "/api/monitor/usage", { method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL } });
      const j = await r.json();
      if (j.target && j.target.chatId) {
        if (j.imageBase64) {
          // การ์ดภาพ (หลอด progress) — ถ้าเรนเดอร์ได้ ส่งเป็นรูป
          await sendResultSends(j.target.chatId, [{ kind: "photo", dataBase64: j.imageBase64, filename: "usage-monitor.png" }], j.target.threadId).catch(() => {});
        } else if (j.text) {
          // เรนเดอร์ภาพไม่ได้ → ส่ง text สำรอง
          await tg("sendMessage", { chat_id: j.target.chatId, text: j.text, ...sendOpts(j.target.threadId) }).catch(() => {});
        }
      }
      if (Array.isArray(j.alerts) && j.alerts.length && j.ownerChatId) {
        await tg("sendMessage", { chat_id: j.ownerChatId, text: "เตือนการใช้งานค่ะ\n- " + j.alerts.join("\n- ") }).catch(() => {});
      }
    } catch { /* รอบหน้าลองใหม่ */ }
  };
  setTimeout(runMonitor, 30000);
  setInterval(runMonitor, monitorMinutes * 60 * 1000);

  // โหลดรายชื่อกลุ่ม dedicated (thunder_expiry) + รีเฟรชทุก 3 นาที
  await refreshDedicated();
  setInterval(refreshDedicated, 3 * 60 * 1000);

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
