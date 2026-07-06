// Telegram bot (long-polling) — เชื่อมเลขา AI Changoh เข้ากับ Telegram
// รัน: node scripts/telegram-bot.mjs  (ต้องรัน `npm run dev` หรือ `npm start` คู่กัน)
import fs from "node:fs";
import path from "node:path";

// โหลด .env แบบง่าย
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

if (!TOKEN) {
  console.error("ไม่พบ TELEGRAM_BOT_TOKEN ใน .env");
  process.exit(1);
}

const API = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;

async function tg(method, body) {
  const res = await fetch(API(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sendDocumentFromUrl(chatId, url, filename, caption) {
  const res = await fetch(APP_URL + url, { headers: { "x-internal-token": INTERNAL } });
  if (!res.ok) {
    await tg("sendMessage", { chat_id: chatId, text: `ดึงไฟล์ไม่สำเร็จ (${res.status})` });
    return;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([new Uint8Array(buf)]), filename || "file");
  await fetch(API("sendDocument"), { method: "POST", body: form });
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  if (!text) return;

  await tg("sendChatAction", { chat_id: chatId, action: "typing" });

  let data;
  try {
    const res = await fetch(APP_URL + "/api/telegram/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify({ chatId: String(chatId), text }),
    });
    data = await res.json();
  } catch (e) {
    await tg("sendMessage", { chat_id: chatId, text: "ระบบหลังบ้านยังไม่พร้อม (ตรวจสอบว่ารัน npm run dev แล้ว)" });
    return;
  }

  for (const s of data.sends || []) {
    if (s.kind === "text") {
      await tg("sendMessage", { chat_id: chatId, text: s.text });
    } else if (s.kind === "document") {
      await tg("sendChatAction", { chat_id: chatId, action: "upload_document" });
      await sendDocumentFromUrl(chatId, s.url, s.filename, s.caption);
    }
  }
}

async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id;
  const data = cb.data || "";
  if (!chatId) return;
  let out;
  try {
    const res = await fetch(APP_URL + "/api/telegram/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify({ chatId: String(chatId), data }),
    });
    out = await res.json();
  } catch {
    out = { answer: "ระบบหลังบ้านไม่พร้อม", sends: [] };
  }
  await tg("answerCallbackQuery", { callback_query_id: cb.id, text: out.answer || "" });
  for (const s of out.sends || []) {
    if (s.kind === "text") await tg("sendMessage", { chat_id: chatId, text: s.text });
  }
}

async function main() {
  const me = await tg("getMe", {});
  if (!me.ok) {
    console.error("Token ไม่ถูกต้อง:", JSON.stringify(me));
    process.exit(1);
  }
  console.log(`Telegram bot พร้อมทำงาน: @${me.result.username}`);
  console.log(`เชื่อมต่อ app ที่ ${APP_URL}`);
  console.log("ทักบอทด้วย /start เพื่อผูกบัญชี\n");

  let offset = 0;
  // ล้าง webhook ก่อน (ถ้าเคยตั้ง) เพื่อใช้ long-polling
  await tg("deleteWebhook", { drop_pending_updates: false });

  while (true) {
    try {
      const res = await fetch(API("getUpdates"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offset, timeout: 30, allowed_updates: ["message", "callback_query"] }),
      });
      const data = await res.json();
      if (!data.ok) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      for (const u of data.result) {
        offset = u.update_id + 1;
        if (u.message) {
          handleMessage(u.message).catch((e) => console.error("handle error:", e.message));
        } else if (u.callback_query) {
          handleCallback(u.callback_query).catch((e) => console.error("callback error:", e.message));
        }
      }
    } catch (e) {
      console.error("polling error:", e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main();
