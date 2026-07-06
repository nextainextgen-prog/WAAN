import { db } from "./db";

export function getBotToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

const API = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

// chat id ที่อนุญาต — เก็บใน DB (ผูกครั้งแรกอัตโนมัติ) หรือ env
export async function getAllowedChatId(): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key: "telegram_chat_id" } });
  return row?.value || process.env.TELEGRAM_ALLOWED_CHAT_ID?.trim() || null;
}

export async function setAllowedChatId(id: string) {
  await db.setting.upsert({
    where: { key: "telegram_chat_id" },
    update: { value: id },
    create: { key: "telegram_chat_id", value: id },
  });
}

export async function tgSendMessage(chatId: string | number, text: string, extra?: object) {
  const token = getBotToken();
  if (!token) throw new Error("ยังไม่ได้ตั้งค่า TELEGRAM_BOT_TOKEN");
  // Telegram จำกัด 4096 ตัวอักษร/ข้อความ
  const chunks = text.match(/[\s\S]{1,3900}/g) || [text];
  let last;
  for (const chunk of chunks) {
    const res = await fetch(API(token, "sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: chunk, ...extra }),
    });
    last = await res.json();
  }
  return last;
}

export async function tgSendChatAction(chatId: string | number, action = "typing") {
  const token = getBotToken();
  if (!token) return;
  await fetch(API(token, "sendChatAction"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  }).catch(() => {});
}

export async function tgSendDocument(
  chatId: string | number,
  buffer: Buffer,
  filename: string,
  caption?: string,
) {
  const token = getBotToken();
  if (!token) throw new Error("ยังไม่ได้ตั้งค่า TELEGRAM_BOT_TOKEN");
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([new Uint8Array(buffer)]), filename);
  const res = await fetch(API(token, "sendDocument"), { method: "POST", body: form });
  return res.json();
}

export async function tgAnswerCallback(callbackId: string, text?: string) {
  const token = getBotToken();
  if (!token) return;
  await fetch(API(token, "answerCallbackQuery"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, text }),
  }).catch(() => {});
}
