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

async function doMemo(chatId, text, files) {
  await tg("sendMessage", { chat_id: chatId, text: "รับเรื่องแล้วค่ะ กำลังออกร่างเอกสารคืนเงินให้ ประมาณ 1 นาทีเดี๋ยวส่งให้นะคะ" });
  await tg("sendChatAction", { chat_id: chatId, action: "upload_document" });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "waan-memo-"));
  const saved = [];
  for (const f of files) {
    try { const s = await downloadFile(f.file_id, dir, f.file_name); if (s) saved.push(s); } catch { /* skip */ }
  }

  let data;
  try {
    const r = await fetch(APP_URL + "/api/memo/generate", {
      method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify({ rawText: text, files: saved }),
    });
    data = await r.json();
  } catch { await tg("sendMessage", { chat_id: chatId, text: "ขออภัยค่ะ ระบบหลังบ้านยังไม่พร้อม ลองใหม่อีกครั้งนะคะ" }); return; }
  if (!data.ok) { await tg("sendMessage", { chat_id: chatId, text: "ออกเอกสารไม่สำเร็จค่ะ: " + (data.error || "") }); return; }

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

async function chatIngest(chatId, text) {
  await tg("sendChatAction", { chat_id: chatId, action: "typing" });
  let data;
  try {
    const res = await fetch(APP_URL + "/api/telegram/ingest", {
      method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify({ chatId: String(chatId), text }),
    });
    data = await res.json();
  } catch { await tg("sendMessage", { chat_id: chatId, text: "ระบบหลังบ้านยังไม่พร้อมค่ะ (เช็คว่ารัน npm run dev แล้วนะคะ)" }); return; }
  for (const s of data.sends || []) {
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

async function processBatch(chatId, msgs) {
  const text = msgs.map((m) => m.text || m.caption || "").filter(Boolean).join("\n").trim();
  const files = msgs.map(extractFile).filter(Boolean);
  const now = Date.now();
  recentFiles[chatId] = (recentFiles[chatId] || []).filter((f) => now - f.ts < 180000);
  for (const f of files) recentFiles[chatId].push({ ...f, ts: now });

  if (text && MEMO_INTENT.test(text)) {
    const seen = new Set();
    const all = recentFiles[chatId].filter((f) => !seen.has(f.file_id) && seen.add(f.file_id));
    recentFiles[chatId] = [];
    await doMemo(chatId, text, all);
    return;
  }
  if (text) { await chatIngest(chatId, text); return; }
  // ไฟล์อย่างเดียว (ยังไม่มีคำสั่ง) — เก็บไว้ในบัฟเฟอร์ รอข้อความสั่งงาน
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
  console.log(`น้องวานพร้อมทำงาน: @${me.result.username} · app ${APP_URL}`);
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
