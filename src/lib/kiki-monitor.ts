import { db } from "./db";
import { getSetting, setSetting } from "./kiki";

/**
 * ห้องมอนิเตอร์ + ห้องเฝ้าระวัง (เจ้าของสั่ง 5 ส.ค. 2026)
 *
 * "ให้เป็นกลุ่มค่อยอัปเดตแจ้งเตือนว่ากำลังทำงานอยู่ ทำงานอยู่ รันอยู่นะครับโด้"
 *
 * แยกสองห้องเพราะหน้าที่คนละอย่าง:
 *   #มอนิเตอร์  — การ์ดใบเดียวแก้ทับตัวเอง ไม่เด้งแจ้งเตือน ดูเมื่อไหร่ก็เห็นสถานะสด
 *                 บรรทัด "ตอนนี้" เปลี่ยนตามที่ทำจริง = ตอบคำถาม "ได้ยินมั้ย" ได้อีกทาง
 *   #เฝ้าระวัง  — เงียบสนิทเมื่อปกติ มีข้อความเมื่อไหร่คือมีเรื่องต้องลงมือ
 */

const ACT_KEY = "vex_current_activity"; // JSON: { icon, text, at }
const ACT_TTL_MS = 3 * 60_000;

export const MONITOR_CH_KEY = "vex_monitor_ch";
export const WATCH_CH_KEY = "vex_watch_ch";
export const MONITOR_MSG_KEY = "vex_monitor_msg"; // ข้อความที่แก้ทับตลอด

/** บอกว่าตอนนี้กำลังทำอะไร — ท่อเอาไปโชว์ในการ์ด */
export async function setActivity(icon: string, text: string): Promise<void> {
  await setSetting(ACT_KEY, JSON.stringify({ icon, text: text.slice(0, 120), at: Date.now() }));
}

export async function getActivity(): Promise<{ icon: string; text: string } | null> {
  try {
    const raw = await getSetting(ACT_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as { icon: string; text: string; at: number };
    if (Date.now() - a.at > ACT_TTL_MS) return null; // ค้างนานไป = ไม่ใช่ของจริงแล้ว
    return { icon: a.icon, text: a.text };
  } catch {
    return null;
  }
}

export interface MonitorCard {
  text: string;
  healthy: boolean;
}

/** ประกอบการ์ดสถานะ — ท่อเรียกทุก 30 วิแล้วแก้ข้อความเดิมทับ */
export async function buildCard(input: {
  services: Record<string, boolean>;
  inVoice: boolean;
  voiceConnected: boolean;
}): Promise<MonitorCard> {
  const now = new Date();
  const hhmm = now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

  const svcLine = Object.entries(input.services)
    .map(([k, ok]) => `${k} ${ok ? "🟢" : "🔴"}`)
    .join(" · ");

  const { mode, session, lastHeard } = await voiceState();
  const act = await getActivity();
  const jobs = await jobLine();
  const quota = await quotaLine();

  const healthy = Object.values(input.services).every(Boolean) && input.voiceConnected;
  const head = healthy ? "🟢 Vex ทำงานอยู่ครับโด้" : "🟡 Vex ทำงานอยู่ แต่มีบางส่วนติดขัด";

  const lines = [
    `${head} · ${hhmm}`,
    "",
    `💻 เซอร์วิส    ${svcLine}`,
    `🎙️ ห้องเสียง   ${input.voiceConnected ? "เข้าห้องแล้ว" : "🔴 ยังไม่ได้เข้า"} · ${input.inVoice ? "โด้อยู่ในห้อง" : "โด้ไม่อยู่"} · โหมด${mode}${session ? " · กำลังคุยกันอยู่" : ""}`,
    `🧠 ตอนนี้      ${act ? `${act.icon} ${act.text}` : `ว่าง${lastHeard ? ` (ได้ยินล่าสุด ${lastHeard})` : ""}`}`,
    `⚙️ งาน         ${jobs}`,
    `🌐 โควตา       ${quota}`,
    "",
    ...(await tokenBlock()),
  ];
  return { text: lines.join("\n"), healthy };
}

/**
 * โทเค็นที่ใช้ไป (เจ้าของขอ 5 ส.ค.: "มอนิเตอร์ข้อมูลโทเค็นอย่างละเอียด")
 * ใช้ของเดิมที่น้องวานมีอยู่แล้ว (src/lib/usage.ts อ่านจากไฟล์ log ในเครื่อง) ไม่สร้างตัวใหม่
 * งบต่อหน้าต่างอ่านจาก .env — ไม่ตั้ง = โชว์แค่จำนวน token ไม่โชว์ %
 */
async function tokenBlock(): Promise<string[]> {
  try {
    const u = await import("./usage");
    const now = Date.now();
    const usages = u.readUsage(now);
    const out: string[] = ["📊 โทเค็นที่ใช้"];
    let todayTok = 0;
    let todayCost = 0;
    for (const p of usages) {
      const icon = p.provider === "claude" ? "🔷" : "🟢";
      const rows: string[] = [];
      for (const [name, w, key] of [
        ["5 ชม.", p.report.session, "SESSION"],
        ["7 วัน", p.report.week, "WEEK"],
      ] as const) {
        const b = u.budget(p.provider, key);
        const reset = u.resetSuffix(w.firstTs, u.WINDOW_MS[key], now);
        if (b > 0) {
          const frac = u.billable(w) / b;
          const pct = Math.round(frac * 100);
          const warn = frac >= 0.9 ? " ⚠️" : frac >= 0.75 ? " 🟡" : "";
          rows.push(`   ${name}  ${u.bar(frac, 10)} ${String(pct).padStart(3)}%  ${u.fmtTokens(w.totalTokens)} · ${reset}${warn}`);
        } else {
          rows.push(`   ${name}  ${u.fmtTokens(w.totalTokens)} tokens · ${reset}`);
        }
      }
      out.push(`${icon} ${p.label}`, ...rows);
      todayTok += p.report.today.totalTokens;
      todayCost += p.report.today.costUsd;
    }
    out.push(`💰 วันนี้รวม ${u.fmtTokens(todayTok)} tokens · ~$${todayCost.toFixed(2)} (~${Math.round(todayCost * 36)} บาท)`);
    return out;
  } catch {
    return ["📊 โทเค็น    อ่านไม่ได้"];
  }
}

async function voiceState() {
  const [m, sess, heard] = await Promise.all([
    getSetting("vex_listen_mode"),
    getSetting("vex_session_until"),
    getSetting("vex_last_heard_at"),
  ]);
  const label: Record<string, string> = { wake: "เรียกชื่อ", open: "อิสระ", silent: "ฟังเงียบ", muted: "ปิดปาก" };
  let lastHeard = "";
  if (heard) {
    const mins = Math.round((Date.now() - Number(heard)) / 60_000);
    lastHeard = mins < 1 ? "เมื่อกี้" : mins < 60 ? `${mins} นาทีที่แล้ว` : `${Math.round(mins / 60)} ชม.ที่แล้ว`;
  }
  return { mode: label[m || "wake"] || "เรียกชื่อ", session: Date.now() < Number(sess || 0), lastHeard };
}

async function jobLine(): Promise<string> {
  try {
    const [running, pending, outbox] = await Promise.all([
      db.kikiHermesJob.count({ where: { status: "running", canceled: false } }),
      db.kikiHermesJob.count({ where: { status: "pending" } }),
      db.vexOutbox.count({ where: { sentAt: null } }),
    ]);
    if (!running && !pending && !outbox) return "ไม่มีค้าง";
    const parts = [];
    if (running) parts.push(`กำลังทำ ${running}`);
    if (pending) parts.push(`รอคิว ${pending}`);
    if (outbox) parts.push(`รอส่ง ${outbox}`);
    return parts.join(" · ");
  } catch {
    return "อ่านไม่ได้";
  }
}

async function quotaLine(): Promise<string> {
  // โควตาเสียงพูดของ Gemini เป็น "คำขอต่อวันต่อโมเดล" (Tier 1 = 100/วัน) ไม่ใช่เรื่องยอดเงิน
  // แต่ละโมเดลนับแยก ระบบจึงสลับตัวเองได้ — โชว์ให้เห็นว่าเหลือเท่าไหร่จะได้ไม่ตันแบบไม่รู้ตัว
  let ttsLine = "เสียงพูด 🟢";
  try {
    const { ttsCallsToday } = await import("./tts");
    const calls = await ttsCallsToday();
    const used = Object.values(calls).reduce((a, b) => a + b, 0);
    const models = Object.keys(calls).length || 1;
    const cap = 100 * Math.max(models, 1);
    const left = Math.max(0, cap - used);
    const icon = left > 40 ? "🟢" : left > 10 ? "🟡" : "🔴";
    ttsLine = `เสียงพูด ${icon} ใช้ไป ${used} คำขอ (เหลือ ~${left} วันนี้)`;
  } catch { /* อ่านไม่ได้ก็โชว์แบบเดิม */ }

  const bad = await getSetting("vex_quota_bad");
  const list = bad ? (JSON.parse(bad) as Record<string, number>) : {};
  const fresh = Object.entries(list).filter(([, at]) => Date.now() - at < 6 * 60 * 60_000);
  if (!fresh.length) return `สมอง 🟢 · ถอดเสียง 🟢 · ${ttsLine}`;
  return `🟡 ${fresh.map(([k]) => k).join(" · ")} ตันโควตา (สลับตัวสำรองแล้ว) · ${ttsLine}`;
}

/** จดว่าบริการไหนโดนจำกัดโควตา — ให้การ์ดกับห้องเฝ้าระวังรู้ */
export async function noteQuotaHit(service: string): Promise<boolean> {
  try {
    const raw = await getSetting("vex_quota_bad");
    const list = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    const first = !list[service] || Date.now() - list[service] > 6 * 60 * 60_000;
    list[service] = Date.now();
    await setSetting("vex_quota_bad", JSON.stringify(list));
    return first; // true = เพิ่งหมดครั้งแรก ควรแจ้งห้องเฝ้าระวัง
  } catch {
    return false;
  }
}

// ===== ห้องเฝ้าระวัง =====

export type Severity = "ok" | "warn" | "bad" | "down";
const SEV_ICON: Record<Severity, string> = { ok: "🟢", warn: "🟡", bad: "🔴", down: "💥" };

const ALERT_SEEN_KEY = "vex_alert_seen";
const ALERT_QUIET_MS = 30 * 60_000; // เรื่องเดิมไม่แจ้งซ้ำใน 30 นาที

/** ตั้งเรื่องเข้าห้องเฝ้าระวัง — คืน false ถ้าเพิ่งแจ้งเรื่องเดิมไป */
export async function raiseAlert(key: string, sev: Severity, text: string): Promise<boolean> {
  try {
    const raw = await getSetting(ALERT_SEEN_KEY);
    const seen = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    const now = Date.now();
    for (const k of Object.keys(seen)) if (now - seen[k] > ALERT_QUIET_MS) delete seen[k];
    if (seen[key]) return false;
    seen[key] = now;
    await setSetting(ALERT_SEEN_KEY, JSON.stringify(seen));
    const hhmm = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    const { queueOut } = await import("./kiki-outbox");
    await queueOut({ target: "discord-watch", topic: key, text: `${SEV_ICON[sev]} ${hhmm}  ${text}`, priority: sev === "down" ? 5 : 3 });
    return true;
  } catch {
    return false;
  }
}
