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
async function tg(method, body) {
  const res = await fetch(API(method), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}

const MEMO_INTENT = /คืนเงิน|หัก\s*ณ\s*ที่จ่าย|ออกเอกสาร|ส่วนต่าง|ส่วนเกิน/;
const groups = {};          // media_group_id -> {msgs, timer, chatId}
const recentFiles = {};     // chatId -> [{file_id,file_name,ts}]

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

async function doMemo(chatId, text, files, from, isGroup) {
  const status = await startStatus(chatId, [
    "รับเรื่องแล้วค่ะ ⚡ กำลังออกเอกสารคืนเงินให้...",
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
  await tg("sendChatAction", { chat_id: chatId, action: "upload_document" });

  const pdfRes = await fetch(APP_URL + `/api/memo/${data.id}/pdf`, { headers: { "x-internal-token": INTERNAL } });
  const pdf = Buffer.from(await pdfRes.arrayBuffer());
  const warn = data.valid ? "" : "\n\nขอเช็คนิดนึงค่ะ: " + (data.warnings || []).join("; ");
  const caption = `ออกร่างเอกสารคืนเงินให้แล้วค่ะ (ยังไม่เซ็น)\n\nลูกค้า: ${data.serviceName || "-"}\nยอดคืนรวม: ${data.refund} บาท (หัก ณ ที่จ่าย ${data.whtAmount} + ส่วนเกิน ${data.overpay})\nแนบ ${data.attachCount} หน้า${warn}\n\nลองเปิดดูก่อนได้เลยค่ะ ถ้าโอเคกด "เซ็นเลย" เดี๋ยววานเติมลายเซ็นให้ ถ้าอยากปรับตรงไหนกด "แก้ไข" ได้ค่ะ`;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  form.append("reply_markup", JSON.stringify({ inline_keyboard: [[{ text: "เซ็นเลย", callback_data: `memo:sign:${data.id}` }, { text: "แก้ไข", callback_data: `memo:revise:${data.id}` }]] }));
  form.append("document", new Blob([new Uint8Array(pdf)]), "เอกสารคืนเงิน_ดราฟ.pdf");
  await fetch(API("sendDocument"), { method: "POST", body: form });
}

// ===== สถานะสด: ตอบรับทันที + อัปเดตว่ายังทำอยู่ (แก้ข้อความเดิม ไม่สแปม) =====
async function startStatus(chatId, steps) {
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
    if (s.kind === "text") await tg("sendMessage", { chat_id: chatId, text: s.text });
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
  }
}

async function chatIngest(chatId, text, from, isGroup, replyTo) {
  const isSlide = /สไลด์|slide|พรีเซนต์|นำเสนอ/.test(text);
  const steps = isSlide
    ? ["รับเรื่องแล้วค่ะ ⚡ กำลังทำสไลด์ให้...", "🔎 กำลังดึงข้อมูลจริง...", "📊 กำลังจัดสไลด์และกราฟ...", "🎨 กำลังตกแต่งให้สวย...", "⏳ ใกล้เสร็จแล้วค่ะ..."]
    : ["รับเรื่องแล้วค่ะ ⚡ รับทราบ เดี๋ยวหาให้นะคะ", "🔎 กำลังค้นข้อมูลจากระบบ...", "⚙️ กำลังประมวลผล...", "📝 กำลังเรียบเรียงคำตอบ...", "⏳ ใกล้เสร็จแล้วค่ะ..."];
  const status = await startStatus(chatId, steps);
  let data;
  try {
    const res = await fetch(APP_URL + "/api/telegram/ingest", {
      method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify({ chatId: String(chatId), text, fromId: String(from?.id || ""), isGroup: !!isGroup, replyTo: replyTo || null }),
    });
    data = await res.json();
  } catch {
    await status.finishText("ระบบหลังบ้านยังไม่พร้อมค่ะ ลองใหม่อีกครั้งนะคะ");
    return;
  }
  const sends = data.sends || [];
  const texts = sends.filter((s) => s.kind === "text");
  const docs = sends.filter((s) => s.kind === "document");
  // ถ้าเป็นคำตอบข้อความเดี่ยว → รวมเข้าข้อความสถานะเลย (สะอาด ไม่มีข้อความค้าง)
  if (texts.length === 1 && docs.length === 0) {
    await status.finishText(texts[0].text);
    return;
  }
  if (sends.length === 0) { status.stop(); if (status.msgId) await tg("deleteMessage", { chat_id: chatId, message_id: status.msgId }).catch(() => {}); return; }
  await status.finishDone("✅ เรียบร้อยค่ะ ส่งให้เลยนะคะ");
  await sendResultSends(chatId, sends);
}

function personOf(u) {
  if (!u) return null;
  return { id: String(u.id), name: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || "สมาชิก", username: u.username || undefined };
}

async function processBatch(chatId, msgs) {
  const chatType = msgs[0]?.chat?.type || "private";
  const isGroup = chatType === "group" || chatType === "supergroup";
  const from = personOf(msgs[0]?.from);
  const replyMsg = msgs.find((m) => m.reply_to_message)?.reply_to_message;
  const replyTo = replyMsg ? personOf(replyMsg.from) : null;
  let text = msgs.map((m) => m.text || m.caption || "").filter(Boolean).join("\n").trim();

  // ในกลุ่ม: ตอบเฉพาะเมื่อถูกเรียก (มีชื่อ "น้องวาน" ที่ไหนก็ได้, ขึ้นต้น "วาน", @mention, หรือ reply บอท)
  if (isGroup) {
    const repliedToBot = msgs.some((m) => m.reply_to_message?.from?.id === BOT_ID);
    const mentioned = BOT_USERNAME && text.toLowerCase().includes("@" + BOT_USERNAME.toLowerCase());
    const calledByName = /น้องวาน/.test(text);          // เรียกชื่อที่ไหนก็ได้
    const namePrefix = /^\s*วาน[\s,:ๆจ]/i.test(text);   // ขึ้นต้นด้วย "วาน"
    if (!repliedToBot && !mentioned && !calledByName && !namePrefix) return; // ไม่ได้ถูกเรียก — เงียบ
    // ตัดคำเรียก/mention ออก เหลือเนื้อความ
    text = text
      .replace(/น้องวาน/g, "")
      .replace(/^\s*วาน[\s,:ๆจ]*/i, "")
      .replace(new RegExp("@" + BOT_USERNAME, "gi"), "")
      .trim();
    if (!text || text.length < 2) text = "สวัสดี";
  }

  const files = msgs.map(extractFile).filter(Boolean);
  const now = Date.now();
  recentFiles[chatId] = (recentFiles[chatId] || []).filter((f) => now - f.ts < 180000);
  for (const f of files) recentFiles[chatId].push({ ...f, ts: now });

  // ออกเอกสารจากไฟล์แนบ — ทำได้ทั้งแชทส่วนตัวและกลุ่ม (ตรวจสิทธิ์ที่ backend)
  if (text && MEMO_INTENT.test(text)) {
    const seen = new Set();
    const all = recentFiles[chatId].filter((f) => !seen.has(f.file_id) && seen.add(f.file_id));
    recentFiles[chatId] = [];
    await doMemo(chatId, text, all, from, isGroup);
    return;
  }
  if (text) { await chatIngest(chatId, text, from, isGroup, replyTo); return; }
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
  let out;
  try {
    const res = await fetch(APP_URL + "/api/telegram/callback", {
      method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify({ chatId: String(chatId), data: cb.data || "" }),
    });
    out = await res.json();
  } catch { out = { answer: "ระบบหลังบ้านไม่พร้อม", sends: [] }; }
  await tg("answerCallbackQuery", { callback_query_id: cb.id, text: out.answer || "" });
  for (const s of out.sends || []) {
    if (s.kind === "text") await tg("sendMessage", { chat_id: chatId, text: s.text });
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
  }
}

async function main() {
  const me = await tg("getMe", {});
  if (!me.ok) { console.error("Token ไม่ถูกต้อง:", JSON.stringify(me)); process.exit(1); }
  BOT_USERNAME = me.result.username;
  BOT_ID = me.result.id;
  console.log(`น้องวานพร้อมทำงาน: @${BOT_USERNAME} (id ${BOT_ID}) · app ${APP_URL}`);
  await tg("deleteWebhook", { drop_pending_updates: false });
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
