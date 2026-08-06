import { db } from "./db";
import { askGeminiJson, getSetting, setSetting, getKikiChatIds, vexLine, saveKikiChat } from "./kiki";
import { tgDirectSend } from "./kiki-live";

/**
 * วงจรซ่อมตัวเอง (กลุ่ม B3 — 7 ส.ค. 2026)
 *
 * ปัญหาข้อ 5 เดิม: "Vex จับบั๊กตัวเองไม่ได้ โด้ต้องเป็นคนเจอทุกรอบ"
 * ชิ้นส่วนมีครบมานานแล้ว — turnlog จับเทิร์นพัง · selfcheck รายงาน 22:00 · self_dev มี diff flow
 * แต่ไม่มีใครต่อสายถึงกัน: error เกิดแล้วก็นอนอยู่ใน DB รอโด้มาเจอเอง
 *
 * ชั้นนี้ปิดวงจร: เทิร์นพัง → นับลายเซ็น → ซ้ำถึงเกณฑ์ = วิเคราะห์ต้นตอ + ร่างสเปกแก้ →
 * ส่งเข้าแชทพร้อมปุ่ม "พัฒนาเลย" (ใช้ flow ยืนยันเดิมของ self_dev ทุกประการ) → โด้กดปุ่มเดียวจบ
 *
 * กันรำคาญ: เสนอไม่เกิน 1 เรื่อง/6 ชม. · ลายเซ็นเดิมเสนอครั้งเดียว · ปิดได้ (`vex_selfheal` = "0")
 * ระดับความอิสระ: การ "เสนอ" = ระดับ 1 · การ "แก้จริง" ยังเป็นระดับ 2 ผ่านปุ่ม+diff เหมือนเดิม
 */

const LAST_KEY = "vex_selfheal_last";  // ms ของข้อเสนอล่าสุด (คุมจังหวะ 6 ชม.)
const SEEN_KEY = "vex_selfheal_seen";  // {sig: {count, lastAt, proposedAt?}}
const THROTTLE_MS = 6 * 3600_000;
const PROPOSE_AT = 2;                  // ลายเซ็นเดิมครั้งที่ 2 = ไม่ใช่ฟลุก เสนอได้

interface Seen { count: number; lastAt: number; proposedAt?: number }

async function enabled(): Promise<boolean> {
  return (await getSetting("vex_selfheal").catch(() => null)) !== "0";
}

/** ลายเซ็นบั๊ก — ตัดตัวเลข/ไอดีทิ้งให้ error เดิมคนละครั้งจับคู่กันได้ */
function signature(intent: string, error: string): string {
  return `${intent}:${error.replace(/[0-9a-f]{8,}/gi, "#").replace(/\d+/g, "#").slice(0, 100)}`;
}

/**
 * เทิร์นพังจริง (จาก catch ใน ingest) — เรียกแบบ fire-and-forget เท่านั้น
 * ครั้งแรก = จดไว้ · ซ้ำครั้งที่ 2 ขึ้นไป + ไม่ติด throttle = วิเคราะห์แล้วเสนอสเปกแก้พร้อมปุ่ม
 */
export async function reportCrash(input: { text: string; intent: string; error: string; channel: string }): Promise<void> {
  if (!(await enabled())) return;
  const sig = signature(input.intent, input.error);

  let seen: Record<string, Seen> = {};
  try { seen = JSON.parse((await getSetting(SEEN_KEY)) || "{}") as Record<string, Seen>; } catch { /* เริ่มใหม่ */ }
  const cur: Seen = seen[sig] || { count: 0, lastAt: 0 };
  cur.count += 1;
  cur.lastAt = Date.now();
  seen[sig] = cur;
  // เก็บแค่ 30 ลายเซ็นล่าสุด กัน Setting บวม
  const keys = Object.keys(seen);
  if (keys.length > 30) {
    for (const k of keys.sort((a, b) => seen[a].lastAt - seen[b].lastAt).slice(0, keys.length - 30)) delete seen[k];
  }
  await setSetting(SEEN_KEY, JSON.stringify(seen)).catch(() => {});

  if (cur.count < PROPOSE_AT || cur.proposedAt) return;
  const last = Number((await getSetting(LAST_KEY)) || 0);
  if (Date.now() - last < THROTTLE_MS) return;

  await proposeFix({
    title: `เทิร์นพังซ้ำ ${cur.count} ครั้ง (เจตนา ${input.intent})`,
    detail: `ข้อความล่าสุดของเจ้าของ: """${input.text.slice(0, 300)}"""\nerror: ${input.error.slice(0, 500)}`,
    sig,
  });
}

/**
 * วิเคราะห์ + ร่างสเปก + ส่งข้อเสนอพร้อมปุ่ม "พัฒนาเลย" (flow ยืนยันเดิมของ self_dev)
 * ใช้ได้ทั้งจากเทิร์นพังสดและจากรอบตรวจ 22:00
 */
export async function proposeFix(input: { title: string; detail: string; sig?: string }): Promise<boolean> {
  if (!(await enabled())) return false;
  const mainChat = (await getKikiChatIds().catch(() => []))[0];
  if (!mainChat) return false;

  // วิเคราะห์ต้นตอ + ร่างสเปกที่วิศวกร (dev job) เอาไปทำต่อได้จริง
  const j = await askGeminiJson<{ analysis?: string; spec?: string }>(
    `คุณคือส่วนวิเคราะห์บั๊กของเลขา AI ชื่อ Vex (Next.js + Prisma โค้ดอยู่ src/lib/kiki*.ts, src/app/api/kiki/**)
อาการที่เกิดซ้ำจนต้องแก้:
${input.title}
${input.detail}

ตอบ JSON เท่านั้น:
{"analysis":"ต้นตอที่น่าจะเป็น 1-2 ประโยค ภาษาคนอ่านรู้เรื่อง",
 "spec":"สเปกงานแก้สำหรับวิศวกร: อาการ + จุดที่น่าจะต้องดู + เกณฑ์ว่าแก้เสร็จ (3-6 บรรทัด ไม่ต้องเดาชื่อไฟล์ถ้าไม่แน่ใจ)"}`,
    "",
    30_000,
  ).catch(() => null);
  if (!j?.spec?.trim()) return false;

  const { setPendingDev } = await import("./kiki-dev");
  await setPendingDev(`[แก้บั๊กที่ระบบจับได้เอง] ${input.title}\n\n${j.spec.trim()}`, "telegram");

  const head = await vexLine(
    `ผมจับบั๊กของตัวเองได้: ${input.title} — วิเคราะห์แล้วต้นตอน่าจะคือ ${j.analysis || "ยังไม่ชัด ต้องไล่โค้ด"} ` +
      `ร่างสเปกแก้ไว้ให้แล้ว ถ้าให้ลงมือกดปุ่มได้เลย (ผมจะแก้ แล้วเอา diff มาให้ดูก่อน push เหมือนเดิม)`,
  ).catch(() => "");
  const body = `${head}\n\nสเปกที่จะส่งให้วิศวกร:\n${j.spec.trim().slice(0, 800)}`;
  const sent = await tgDirectSend(mainChat, body, {
    buttons: [[{ text: "🔧 พัฒนาเลย", data: "kiki:dev:yes" }, { text: "❌ ไม่เอา", data: "kiki:dev:no" }]],
  });
  if (!sent) return false;

  await saveKikiChat("assistant", body, "owner", "cron").catch(() => {});
  await setSetting(LAST_KEY, String(Date.now())).catch(() => {});
  if (input.sig) {
    try {
      const seen = JSON.parse((await getSetting(SEEN_KEY)) || "{}") as Record<string, Seen>;
      if (seen[input.sig]) {
        seen[input.sig].proposedAt = Date.now();
        await setSetting(SEEN_KEY, JSON.stringify(seen));
      }
    } catch { /* ข้าม */ }
  }
  return true;
}

/**
 * รอบตรวจ 22:00 (ต่อจาก selfCheckReport เดิม): อาการเดิมซ้ำ ≥ 3 ครั้งใน 24 ชม. = เสนอแก้เลย
 * ไม่ใช่แค่รายงานให้อ่านแล้วผ่านไป — คืน true เมื่อเสนอไปแล้ว (กันรายงานซ้ำซ้อน)
 */
export async function proposeFromSuspects(): Promise<boolean> {
  if (!(await enabled())) return false;
  const last = Number((await getSetting(LAST_KEY)) || 0);
  if (Date.now() - last < THROTTLE_MS) return false;

  const { findSuspects } = await import("./kiki-turnlog");
  const suspects = await findSuspects(24).catch(() => []);
  if (!suspects.length) return false;

  // จับกลุ่มตามเจตนา+อาการ (ตัดเลขทิ้งแบบเดียวกับลายเซ็น error)
  const groups = new Map<string, { n: number; sample: string; why: string }>();
  for (const s of suspects) {
    const key = `${s.intent}:${s.why.replace(/\d+/g, "#").slice(0, 60)}`;
    const g = groups.get(key) || { n: 0, sample: s.text, why: s.why };
    g.n += 1;
    groups.set(key, g);
  }
  const worst = [...groups.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  if (!worst || worst[1].n < 3) return false;

  return proposeFix({
    title: `อาการเดิมซ้ำ ${worst[1].n} ครั้งใน 24 ชม. (${worst[0].split(":")[0]})`,
    detail: `อาการ: ${worst[1].why}\nตัวอย่างข้อความเจ้าของ: """${worst[1].sample}"""`,
  });
}
