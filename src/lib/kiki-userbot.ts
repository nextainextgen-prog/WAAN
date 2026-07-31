import fs from "node:fs";
import path from "node:path";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { getSetting, setSetting } from "./kiki";

/**
 * Userbot — บัญชี Telegram "จริง" ของเจ้าของ (MTProto/GramJS)
 * Vex ส่งข้อความในนามเจ้าของหาใครก็ได้ + อ่าน/สรุปแชทที่เจ้าของอยู่
 * ตั้งค่า: npm run kiki:tg-auth (เบอร์ + OTP ครั้งเดียว) → session เก็บที่ .kiki-tg-session
 * ความปลอดภัย: ทุกการส่งต้องผ่านขั้น "ยืนยัน" ในแชทก่อนเสมอ (กัน AI ส่งมั่วในนามเจ้าของ)
 */

const SESSION_PATH = () => process.env.KIKI_TG_SESSION_PATH || path.join(process.cwd(), ".kiki-tg-session");

export function userbotReady(): boolean {
  return fs.existsSync(SESSION_PATH()) && Boolean(process.env.KIKI_TG_API_ID && process.env.KIKI_TG_API_HASH);
}

let _client: TelegramClient | null = null;

async function client(): Promise<TelegramClient> {
  if (_client?.connected) return _client;
  const apiId = Number(process.env.KIKI_TG_API_ID);
  const apiHash = String(process.env.KIKI_TG_API_HASH || "");
  const session = new StringSession(fs.readFileSync(SESSION_PATH(), "utf8").trim());
  const c = new TelegramClient(session, apiId, apiHash, { connectionRetries: 3 });
  await c.connect();
  if (!(await c.isUserAuthorized())) throw new Error("session หมดอายุ — รัน npm run kiki:tg-auth ใหม่");
  _client = c;
  return c;
}

export interface PeerHit {
  id: string;
  name: string;
  username?: string;
  isGroup: boolean;
}

// หาแชท/คนจากชื่อที่เจ้าของพูดถึง (เทียบชื่อใน dialogs ล่าสุด + @username)
export async function findPeer(query: string): Promise<PeerHit[]> {
  const c = await client();
  const q = query.trim().toLowerCase().replace(/^@/, "");
  const dialogs = await c.getDialogs({ limit: 150 });
  const hits: PeerHit[] = [];
  for (const d of dialogs) {
    const title = (d.title || d.name || "").toLowerCase();
    const ent = d.entity as { username?: string; firstName?: string; lastName?: string } | undefined;
    const uname = (ent?.username || "").toLowerCase();
    if (!title && !uname) continue;
    if (title.includes(q) || uname === q || `${ent?.firstName || ""} ${ent?.lastName || ""}`.toLowerCase().includes(q)) {
      hits.push({ id: String(d.id), name: d.title || d.name || uname, username: ent?.username, isGroup: Boolean(d.isGroup || d.isChannel) });
    }
    if (hits.length >= 5) break;
  }
  return hits;
}

// ส่งข้อความในนามเจ้าของ (เรียกหลังผ่านขั้นยืนยันแล้วเท่านั้น)
export async function sendAsOwner(peerId: string, message: string): Promise<void> {
  const c = await client();
  await c.sendMessage(peerId.startsWith("-") || /^\d+$/.test(peerId) ? (isNaN(Number(peerId)) ? peerId : Number(peerId)) : peerId, { message });
}

// อ่านข้อความล่าสุดของแชท (ไว้สรุป)
export async function readChat(peerId: string, limit = 60): Promise<string[]> {
  const c = await client();
  const msgs = await c.getMessages(isNaN(Number(peerId)) ? peerId : Number(peerId), { limit });
  const out: string[] = [];
  for (const m of msgs.reverse()) {
    const from = (m.sender as { firstName?: string; username?: string; title?: string } | undefined);
    const who = m.out ? "เจ้าของ" : from?.firstName || from?.title || from?.username || "อีกฝั่ง";
    const text = (m.message || "").replace(/\s+/g, " ").trim();
    if (text) out.push(`${who}: ${text.slice(0, 300)}`);
  }
  return out;
}

// ===== ขั้นยืนยันก่อนส่ง (กัน AI ส่งมั่วในนามเจ้าของ) =====

export interface PendingDm {
  peerId: string;
  peerName: string;
  message: string;
}

export async function setPendingDm(p: PendingDm | null): Promise<void> {
  await setSetting("kiki_pending_dm", p ? JSON.stringify(p) : "");
}

export async function getPendingDm(): Promise<PendingDm | null> {
  try {
    const v = await getSetting("kiki_pending_dm");
    return v ? (JSON.parse(v) as PendingDm) : null;
  } catch {
    return null;
  }
}
