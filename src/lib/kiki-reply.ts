import { getSetting, setSetting, askExtractor, askKiki } from "./kiki";
import { readChat, findPeer, sendAsOwner } from "./kiki-userbot";

/**
 * ลูปตอบกลับด้วยเสียง (สเปกข้อ 9 — ส่วนที่ยากที่สุด)
 *
 * ลูปเป้าหมาย:
 *   อั๋นทักมา → Vex พูดในสาย → เจ้าของพูดตอบ "เดี๋ยวไปกินร้านกมูทะ"
 *   → Vex เรียบเรียงเป็นภาษาที่เจ้าของใช้คุยกับอั๋นจริง → ส่งในนามเจ้าของ → บอกกลับสั้น ๆ
 *
 * สองอย่างที่ทำให้มันไม่พัง:
 *  - โปรไฟล์สไตล์รายคน เรียนจากประวัติแชทจริง ไม่ให้เจ้าของมานั่งสอน
 *  - ระดับความไว้ใจรายคน เริ่มทุกคนที่ 1 (อ่านทวนให้ฟังรอบเดียวก่อนส่ง)
 */

// ===== โปรไฟล์สไตล์รายคน =====

export interface StyleProfile {
  peerId: string;
  peerName: string;
  style: string;      // สรุปวิธีที่เจ้าของคุยกับคนนี้
  samples: string[];  // ตัวอย่างข้อความจริงของเจ้าของ (ใช้เป็นตัวอย่างตอนแต่ง)
  at: number;
}

const STYLE_KEY = "vex_style_profiles";
const STYLE_TTL_MS = 7 * 24 * 60 * 60_000; // เรียนใหม่ทุกสัปดาห์ (คนเปลี่ยนวิธีคุยได้)

async function allProfiles(): Promise<Record<string, StyleProfile>> {
  try {
    return JSON.parse((await getSetting(STYLE_KEY)) || "{}") as Record<string, StyleProfile>;
  } catch {
    return {};
  }
}

/**
 * เรียนวิธีที่เจ้าของคุยกับคนนี้ จากประวัติแชทจริง
 * เจ้าของสั่งไว้: "ห้ามให้เจ้าของมานั่งสอนทีละแบบ ข้อมูลมีอยู่แล้ว ให้เรียนเอง"
 */
export async function learnStyle(peerId: string, peerName: string, force = false): Promise<StyleProfile | null> {
  const all = await allProfiles();
  const cur = all[peerId];
  if (!force && cur && Date.now() - cur.at < STYLE_TTL_MS) return cur;

  const lines = await readChat(peerId, 120).catch(() => [] as string[]);
  const mine = lines.filter((l) => l.startsWith("เจ้าของ:")).map((l) => l.replace(/^เจ้าของ:\s*/, "").trim()).filter((x) => x.length > 1);
  if (mine.length < 3) return cur || null; // ข้อมูลน้อยเกินไป อย่าเดาสไตล์

  let style = "";
  try {
    const raw = await askExtractor(
      `ข้อความที่ "เจ้าของ" เคยส่งหา ${peerName} (ล่าสุด ${mine.length} ข้อความ):\n${mine.slice(-40).map((m) => `- ${m}`).join("\n")}`,
      {
        system: `วิเคราะห์ "วิธีที่เจ้าของคุยกับคนนี้" ตอบ JSON เท่านั้น:
{"style":"สรุปเป็นคำสั่งให้คนอื่นเลียนแบบได้ 2-4 บรรทัด — ลงท้ายยังไง สรรพนามอะไร ยาวแค่ไหน สุภาพ/กันเอง/ห้วน ใช้อิโมจิไหม ใช้คำเฉพาะอะไรบ่อย"}
เอาจากของจริงที่เห็น ห้ามแต่ง ถ้าไม่ชัดให้บอกว่าไม่ชัด`,
        timeoutMs: 60_000,
      },
    );
    style = String(JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}").style || "").trim();
  } catch { /* เรียนไม่ได้ ใช้ตัวอย่างดิบแทน */ }

  const profile: StyleProfile = {
    peerId, peerName,
    style: style || "ไม่ชัดพอจะสรุป — ให้ยึดตัวอย่างข้อความจริงด้านล่างเป็นหลัก",
    samples: mine.slice(-12),
    at: Date.now(),
  };
  all[peerId] = profile;
  await setSetting(STYLE_KEY, JSON.stringify(all));
  return profile;
}

// ===== ระดับความไว้ใจรายคน =====
//
// 0 = ร่างไว้ รอสั่งส่ง (ลูกค้า/เรื่องเงิน)
// 1 = อ่านทวนให้ฟังรอบเดียว "จะตอบว่า... เอาไหมครับ" → "เอา"  ← ค่าเริ่มต้นของทุกคน
// 2 = ส่งเลย บอกทีหลัง + ถอนได้ใน 30 วินาที

const TRUST_KEY = "vex_trust_levels";

export async function trustOf(peerId: string): Promise<0 | 1 | 2> {
  try {
    const m = JSON.parse((await getSetting(TRUST_KEY)) || "{}") as Record<string, number>;
    const v = m[peerId];
    return v === 0 || v === 2 ? v : 1; // เริ่มทุกคนที่ 1 เสมอ
  } catch {
    return 1;
  }
}

export async function setTrust(peerId: string, level: 0 | 1 | 2): Promise<void> {
  const m = JSON.parse((await getSetting(TRUST_KEY)) || "{}") as Record<string, number>;
  m[peerId] = level;
  await setSetting(TRUST_KEY, JSON.stringify(m));
}

// ===== จำกัดอัตราการส่ง (userbot ส่งถี่ผิดปกติเสี่ยงโดนแบน) =====

const SEND_LOG_KEY = "vex_userbot_sends";
const MAX_PER_HOUR = 20;
const MIN_GAP_MS = 8_000;

export async function canSend(): Promise<{ ok: boolean; why?: string }> {
  const log = JSON.parse((await getSetting(SEND_LOG_KEY)) || "[]") as number[];
  const now = Date.now();
  const hour = log.filter((t) => now - t < 60 * 60_000);
  if (hour.length >= MAX_PER_HOUR) return { ok: false, why: `ส่งไปแล้ว ${hour.length} ข้อความในชั่วโมงนี้ — พักก่อนกันบัญชีโดนล็อก` };
  if (hour.length && now - hour[hour.length - 1] < MIN_GAP_MS) return { ok: false, why: "เพิ่งส่งไปเมื่อกี้ รอสักครู่" };
  return { ok: true };
}

async function noteSent(): Promise<void> {
  const log = JSON.parse((await getSetting(SEND_LOG_KEY)) || "[]") as number[];
  log.push(Date.now());
  await setSetting(SEND_LOG_KEY, JSON.stringify(log.slice(-60)));
}

// ===== ร่างข้อความในสไตล์เจ้าของ =====

export async function draftInOwnerStyle(peerId: string, peerName: string, gist: string, incoming?: string): Promise<string> {
  const p = await learnStyle(peerId, peerName).catch(() => null);
  const styleBlock = p
    ? `วิธีที่เจ้าของคุยกับ ${peerName} (เรียนมาจากแชทจริง):\n${p.style}\n\nตัวอย่างข้อความจริงของเจ้าของ:\n${p.samples.map((s) => `- ${s}`).join("\n")}`
    : `ยังไม่มีประวัติพอจะเรียนสไตล์ — เขียนแบบเป็นกันเองสุภาพ สั้น ๆ`;
  const out = await askKiki(
    `[ร่างข้อความในนามเจ้าของ] ส่งหา: ${peerName}\n` +
      (incoming ? `เขาเพิ่งทักมาว่า: """${incoming.slice(0, 500)}"""\n` : "") +
      `ใจความที่เจ้าของสั่งให้ตอบ: """${gist}"""\n\n${styleBlock}\n\n` +
      `เขียน "ข้อความที่จะส่งจริง" ในนามเจ้าของ เลียนสไตล์ข้างบนให้เหมือนที่สุด\n` +
      `ห้ามแนะนำตัว ห้ามมีคำนำ ห้ามอธิบาย ตอบเฉพาะตัวข้อความเท่านั้น`,
  );
  return out.replace(/<[^>]+>/g, "").replace(/^["'“”]|["'“”]$/g, "").trim().slice(0, 900);
}

// ===== ร่างที่รอส่ง (พร้อมหน้าต่างถอน) =====

const OUTGOING_KEY = "vex_outgoing_draft";
export const UNDO_WINDOW_MS = 30_000;

export interface OutgoingDraft {
  peerId: string;
  peerName: string;
  message: string;
  sentAt?: number;   // ส่งไปแล้วเมื่อไหร่ (ระดับ 2 — ถอนได้ใน 30 วิ)
  channel: string;
}

export async function setOutgoing(d: OutgoingDraft | null): Promise<void> {
  await setSetting(OUTGOING_KEY, d ? JSON.stringify(d) : "");
}

export async function getOutgoing(): Promise<OutgoingDraft | null> {
  try {
    const v = await getSetting(OUTGOING_KEY);
    return v ? (JSON.parse(v) as OutgoingDraft) : null;
  } catch {
    return null;
  }
}

/** ส่งจริงในนามเจ้าของ — ผ่านตัวจำกัดอัตราเสมอ */
export async function sendNow(peerId: string, message: string): Promise<{ ok: boolean; msg: string }> {
  const gate = await canSend();
  if (!gate.ok) return { ok: false, msg: gate.why || "ส่งไม่ได้ตอนนี้" };
  try {
    await sendAsOwner(peerId, message);
    await noteSent();
    return { ok: true, msg: "ส่งแล้ว" };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message.slice(0, 150) : "ส่งไม่สำเร็จ" };
  }
}

/**
 * ถอนข้อความที่เพิ่งส่ง — Telegram ลบข้อความของตัวเองได้ภายในเวลาที่กำหนด
 * ถ้าเลยหน้าต่างแล้วบอกตรง ๆ ว่าถอนไม่ได้ ห้ามเคลมว่าถอนให้แล้ว
 */
export async function undoLastSend(): Promise<{ ok: boolean; msg: string }> {
  const d = await getOutgoing();
  if (!d?.sentAt) return { ok: false, msg: "ไม่มีข้อความที่เพิ่งส่งให้ถอนครับ" };
  if (Date.now() - d.sentAt > UNDO_WINDOW_MS) {
    return { ok: false, msg: `เลย 30 วินาทีแล้วครับ ถอนไม่ทัน — ข้อความถึง ${d.peerName} ไปแล้ว` };
  }
  try {
    const { deleteLastOwnMessage } = await import("./kiki-userbot");
    const done = await deleteLastOwnMessage(d.peerId, d.message);
    await setOutgoing(null);
    return done
      ? { ok: true, msg: `ถอนข้อความที่ส่งหา ${d.peerName} แล้วครับ` }
      : { ok: false, msg: `ลบไม่สำเร็จครับ ข้อความยังอยู่ในแชทของ ${d.peerName}` };
  } catch (e) {
    return { ok: false, msg: `ถอนไม่สำเร็จครับ (${e instanceof Error ? e.message.slice(0, 80) : "error"})` };
  }
}

/** หาคนจากชื่อที่เจ้าของพูด — คืน null ถ้ากำกวม (ห้ามเดาแล้วส่งผิดคน) */
export async function resolvePeer(name: string): Promise<{ id: string; name: string } | null> {
  const hits = await findPeer(name).catch(() => []);
  return hits.length === 1 ? { id: hits[0].id, name: hits[0].name } : null;
}
