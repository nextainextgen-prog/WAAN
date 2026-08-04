/**
 * ส่งข้อความเข้า Discord ผ่าน API ของบอทโดยตรง
 *
 * ทำไมไม่ใช้การพิมพ์บนหน้าจอ: เทสจริง 4 ส.ค. 2026 — กดคีย์ใส่หน้าต่าง Discord แล้วโฟกัสหลุด
 * ไปโดนอย่างอื่น (เด้งหน้าเกมขึ้นมา) ข้อความไม่เข้าช่องพิมพ์ ทั้งที่ระบบกดปุ่มไปแล้วจริง
 * API ของบอทได้ผลตอบกลับชัดเจนว่าข้อความถูกสร้างจริงหรือไม่ — ไม่ต้องเดา
 *
 * การพิมพ์บนหน้าจอ (kiki-gui) ยังจำเป็นสำหรับแอปที่ไม่มี API เช่น Warp
 */

const API = "https://discord.com/api/v10";

const token = () => (process.env.DISCORD_BOT_TOKEN || "").trim();
const guildId = () => (process.env.DISCORD_GUILD_ID || "").trim();

export function discordApiReady(): boolean {
  return Boolean(token() && guildId());
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: number; // 0 = ห้องข้อความ · 2 = ห้องเสียง · 4 = หมวด
}

let cache: { at: number; rows: DiscordChannel[] } | null = null;

export async function listChannels(force = false): Promise<DiscordChannel[]> {
  if (!discordApiReady()) return [];
  if (!force && cache && Date.now() - cache.at < 5 * 60_000) return cache.rows;
  const res = await fetch(`${API}/guilds/${guildId()}/channels`, {
    headers: { Authorization: `Bot ${token()}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ดึงรายชื่อห้อง Discord ไม่ได้ (${res.status})`);
  const rows = ((await res.json()) as DiscordChannel[]).filter((c) => typeof c?.id === "string");
  cache = { at: Date.now(), rows };
  return rows;
}

const norm = (s: string) => (s || "").toLowerCase().replace(/[#\s_-]/g, "");

/** หาห้องจากชื่อที่เจ้าของเรียก (ไม่ต้องตรงเป๊ะ) — คืน null ถ้าไม่เจอ */
export async function resolveChannel(name: string): Promise<DiscordChannel | null> {
  const rows = (await listChannels()).filter((c) => c.type === 0);
  if (!rows.length) return null;
  const want = norm(name);
  if (!want) return null;
  return (
    rows.find((c) => norm(c.name) === want) ||
    rows.find((c) => norm(c.name).includes(want) || want.includes(norm(c.name))) ||
    null
  );
}

export interface DiscordSendResult {
  ok: boolean;
  channelName?: string;
  channelId?: string;
  messageId?: string;
  problem?: string;
}

/** ส่งข้อความเข้าห้อง (ระบุด้วยชื่อห้องหรือ id ก็ได้) */
export async function sendToChannel(nameOrId: string, text: string): Promise<DiscordSendResult> {
  if (!discordApiReady()) return { ok: false, problem: "ยังไม่ได้ตั้งค่าบอท Discord (DISCORD_BOT_TOKEN / DISCORD_GUILD_ID)" };
  let ch: DiscordChannel | null = null;
  if (/^\d{17,20}$/.test(nameOrId.trim())) {
    ch = (await listChannels()).find((c) => c.id === nameOrId.trim()) || { id: nameOrId.trim(), name: nameOrId.trim(), type: 0 };
  } else {
    ch = await resolveChannel(nameOrId);
  }
  if (!ch) {
    const names = (await listChannels()).filter((c) => c.type === 0).map((c) => c.name).join(" · ");
    return { ok: false, problem: `หาห้อง "${nameOrId}" ไม่เจอ — ห้องที่มี: ${names}` };
  }
  const res = await fetch(`${API}/channels/${ch.id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content: text.slice(0, 1900) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, channelName: ch.name, channelId: ch.id, problem: `ส่งไม่สำเร็จ (${res.status}) ${body.slice(0, 150)}` };
  }
  const j = (await res.json()) as { id?: string };
  return { ok: true, channelName: ch.name, channelId: ch.id, messageId: j.id };
}
