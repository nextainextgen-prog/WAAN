import fs from "node:fs";
import path from "node:path";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { getSetting, setSetting, setPendingFor, getPendingFor, type PendingRead } from "./kiki";

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
  const q0 = query.trim().toLowerCase().replace(/^@/, "");
  // ชื่อเรียกที่เจ้าของตั้งเอง มาก่อนชื่อจริงเสมอ ("อั๋น" = แฟน ไม่ต้องจำชื่อแชท)
  const aliases = await getAliases();
  const aHits = aliases.filter((a) => {
    const al = a.alias.toLowerCase();
    return al === q0 || al.includes(q0) || q0.includes(al);
  });
  if (aHits.length) return aHits.map((a) => ({ id: a.peerId, name: `${a.peerName}${a.note ? ` — ${a.note}` : ""}`, isGroup: false }));
  const c = await client();
  const q = q0;
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

export const PENDING_DM_KEY = "kiki_pending_dm";

/** ร่างข้อความรอยืนยัน — ผูกกับช่องทางที่สั่ง ยืนยันข้ามช่องทางไม่ได้ (กันส่งผิดตัวในนามเจ้าของ) */
export async function setPendingDm(p: PendingDm | null, channel = "telegram"): Promise<void> {
  await setPendingFor(PENDING_DM_KEY, channel, p);
}

export async function getPendingDm(channel = "telegram"): Promise<PendingRead<PendingDm> | null> {
  const r = await getPendingFor<PendingDm>(PENDING_DM_KEY, channel);
  return r?.data ? r : null;
}

// ===== ลิสต์รายชื่อแชท + ชื่อเรียกส่วนตัว (alias) =====

// รายชื่อแชทล่าสุดในบัญชีเจ้าของ (user = เฉพาะคน ไม่เอากลุ่ม/บอท)
export async function listDialogs(kind: "user" | "group" | "all" = "all", limit = 40): Promise<PeerHit[]> {
  const c = await client();
  const dialogs = await c.getDialogs({ limit: 200 });
  const out: PeerHit[] = [];
  for (const d of dialogs) {
    const isGroup = Boolean(d.isGroup || d.isChannel);
    if (kind === "user" && isGroup) continue;
    if (kind === "group" && !isGroup) continue;
    const ent = d.entity as { username?: string; bot?: boolean } | undefined;
    if (kind === "user" && ent?.bot) continue; // ไม่นับบอท
    const name = d.title || d.name || ent?.username || "";
    if (!name) continue;
    out.push({ id: String(d.id), name, username: ent?.username, isGroup });
    if (out.length >= limit) break;
  }
  return out;
}

// ชื่อเรียกที่เจ้าของตั้งเอง — "อั๋น" = แชทชื่อจริงอะไรก็ได้ (เก็บใน Setting)
export interface TgAlias {
  alias: string;
  peerId: string;
  peerName: string;
  note?: string;
}

export async function getAliases(): Promise<TgAlias[]> {
  try {
    return JSON.parse((await getSetting("kiki_tg_aliases")) || "[]") as TgAlias[];
  } catch {
    return [];
  }
}

export async function setAlias(a: TgAlias): Promise<void> {
  const all = (await getAliases()).filter((x) => x.alias !== a.alias);
  all.push(a);
  await setSetting("kiki_tg_aliases", JSON.stringify(all));
}

// ===== สร้างกลุ่มใหม่ในนามเจ้าของ (เจ้าของ = ผู้สร้างกลุ่มโดยอัตโนมัติ) + ดึงบอท Vex เข้า =====

export async function createOwnerGroup(title: string): Promise<{ chatId: string; title: string; botAdded: boolean }> {
  const c = await client();
  const res = await c.invoke(
    new Api.channels.CreateChannel({ title: title.slice(0, 120), about: "สร้างโดย Vex เลขาส่วนตัว", megagroup: true }),
  );
  const chats = (res as unknown as { chats?: { id: { toString(): string } }[] }).chats || [];
  const chat = chats[0];
  if (!chat) throw new Error("สร้างกลุ่มแล้วแต่อ่านผลลัพธ์ไม่ได้");
  const chatId = `-100${chat.id.toString()}`; // supergroup id ฝั่ง Bot API
  const botUsername = process.env.KIKI_BOT_USERNAME || "kiki_lekha_bot";
  let botAdded = false;
  try {
    await c.invoke(new Api.channels.InviteToChannel({ channel: chat as unknown as Api.TypeInputChannel, users: [botUsername] }));
    botAdded = true;
  } catch {
    // ดึงบอทเข้าไม่ได้ (โดนจำกัดสิทธิ์ ฯลฯ) — กลุ่มสร้างแล้ว ให้เจ้าของเชิญเองได้
  }
  return { chatId, title, botAdded };
}
