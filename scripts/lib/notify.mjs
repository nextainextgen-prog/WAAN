// ตัวช่วยส่งการ์ดแจ้งเตือนเข้า Telegram Topic (ใช้ร่วมทุก watcher: oho/fb/line)

// ทะเบียนที่ "ปิดแจ้งเตือน" — watcher เรียก refreshMuted() ทุก tick แล้วเช็ค isChatMuted()/isBrandMuted() ก่อนส่ง
let _mutedChats = new Set();
let _mutedBrands = new Set();
export async function refreshMuted(appUrl, internal) {
  try {
    const r = await fetch(appUrl + "/api/telegram/muted-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": internal },
    });
    const j = await r.json();
    if (Array.isArray(j.groups)) _mutedChats = new Set(j.groups.map(String));
    if (Array.isArray(j.brands)) _mutedBrands = new Set(j.brands.map(String));
  } catch { /* ใช้ค่าเดิม */ }
  return { chats: _mutedChats, brands: _mutedBrands };
}
export function isChatMuted(chatId) {
  return _mutedChats.has(String(chatId));
}
export function isBrandMuted(brand) {
  return brand ? _mutedBrands.has(String(brand)) : false;
}

export function esc(s) {
  return String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
export function mmss(sec) {
  if (sec >= 3600) { const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return `${h} ชม.${m ? ` ${m} นาที` : ""}`; }
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")} นาที`;
}
export function openChatButton(link) {
  return { inline_keyboard: [[{ text: "💬 เปิดแชทนี้", url: link }]] };
}
// ส่งการ์ด: มีรูป → sendPhoto, ไม่มี → sendMessage · คืน json ของ Telegram · replyTo = ตอบใต้ข้อความเดิม
export async function sendCard(token, chatId, { threadId, caption, photo, replyMarkup, replyTo } = {}) {
  if (photo) {
    const f = new FormData();
    f.append("chat_id", String(chatId));
    if (threadId) f.append("message_thread_id", String(threadId));
    if (replyTo) f.append("reply_to_message_id", String(replyTo));
    f.append("parse_mode", "HTML");
    f.append("caption", (caption || "").slice(0, 1024));
    if (replyMarkup) f.append("reply_markup", JSON.stringify(replyMarkup));
    f.append("photo", new Blob([new Uint8Array(photo)]), "chat.png");
    return fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: f }).then((x) => x.json());
  }
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_thread_id: threadId, reply_to_message_id: replyTo, parse_mode: "HTML", text: (caption || "").slice(0, 4096), reply_markup: replyMarkup }),
  }).then((x) => x.json());
}

// กล่องข้อความพร้อมก๊อป (บล็อก <pre> Telegram มีปุ่ม copy) — ส่งตามใต้การ์ดแจ้งเตือน
export function copyReplyText(reply) {
  return `📋 <b>ข้อความพร้อมส่งให้คุณลูกค้า</b> (แตะที่กล่องเพื่อก๊อป) :\n<pre>${String(reply || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</pre>`;
}
