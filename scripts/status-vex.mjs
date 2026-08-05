#!/usr/bin/env node
/**
 * แผงสถานะละเอียดของ Vex — ป้อนให้ scripts/status.sh โซนล่าง
 *
 * พิมพ์บรรทัดละแถว รูปแบบ  name|STATE|detail
 *   STATE = OK | WARN | AUTH | DOWN | INFO   (INFO = แค่บอกข้อมูล ไม่ใช่ปัญหา)
 *
 * อ่านอย่างเดียว ไม่แตะข้อมูล — ล่มตรงไหนก็ข้ามแถวนั้น ไม่ทำให้มอนิเตอร์ทั้งจอตาย
 * usage: node scripts/status-vex.mjs
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const TZ = 7 * 3600_000; // Asia/Bangkok

// ---------- env (อ่านเองเพราะสคริปต์นี้รันนอก Next) ----------
const ENV = {};
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) ENV[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

// ---------- helpers ----------
const rows = [];
const add = (name, state, detail) => rows.push(`${name}|${state}|${detail}`);
const n = (x) => Number(x || 0).toLocaleString("en-US");
const baht = (x) => Math.round(Number(x || 0)).toLocaleString("en-US");

function ago(ms) {
  if (!ms) return "-";
  const d = Date.now() - Number(ms);
  if (d < 0) return "อีก " + ago(Date.now() * 2 - Number(ms));
  const m = Math.round(d / 60000);
  if (m < 1) return "เมื่อกี้";
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ชม.ที่แล้ว`;
  return `${Math.round(h / 24)} วันที่แล้ว`;
}
function mins(ms) {
  const m = Math.round((Date.now() - Number(ms)) / 60000);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}
const dayStart = (t = Date.now()) => Math.floor((t + TZ) / 86400_000) * 86400_000 - TZ;
const cut = (s, k) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > k ? t.slice(0, k - 1) + "…" : t;
};

// ---------- db ----------
let db = null;
try {
  db = new Database(path.join(ROOT, "prisma", "changoh.db"), { readonly: true, fileMustExist: true });
} catch {
  console.log("db|DOWN|เปิด prisma/changoh.db ไม่ได้ — แผง Vex อ่านค่าไม่ได้");
  process.exit(0);
}
const one = (sql, ...a) => {
  try {
    return db.prepare(sql).get(...a);
  } catch {
    return null;
  }
};
const many = (sql, ...a) => {
  try {
    return db.prepare(sql).all(...a);
  } catch {
    return [];
  }
};

// settings ทั้งชุดทีเดียว (ถูกกว่าไล่ query ทีละคีย์)
const S = {};
for (const r of many("SELECT key, value FROM Setting")) S[r.key] = r.value;
const J = (k, d = null) => {
  try {
    return S[k] ? JSON.parse(S[k]) : d;
  } catch {
    return d;
  }
};

// ===== 1) สาย — อยู่ในห้องเสียงไหม + โหมดไหน =====
try {
  const pres = J("vex_voice_presence", {});
  const inVoice = Boolean(pres?.inVoice);
  const windowUntil = Number(S.vex_convo_window_until || 0);
  const awake = windowUntil > Date.now();
  const mode = awake ? `หน้าต่างคุยเปิดอยู่ (อีก ${Math.max(1, Math.round((windowUntil - Date.now()) / 1000))} วิ)` : "โหมดเรียกชื่อ";
  const heard = Number(S.vex_last_heard_at || 0);
  const detail = [
    inVoice ? "โด้อยู่ในสาย" : "โด้ไม่อยู่ในสาย",
    mode,
    heard ? `ได้ยินล่าสุด ${ago(heard)}` : "ยังไม่เคยได้ยินเสียง",
    S.vex_voice_announce === "1" ? "ประกาศเสียง: เปิด" : "ประกาศเสียง: ปิด",
  ].join(" · ");
  add("call", inVoice ? "OK" : "INFO", detail);
} catch {}

// ===== 2) กำลังทำอะไรอยู่ =====
try {
  const act = J("vex_current_activity");
  if (act?.text) add("doing", "INFO", `${act.icon || ""} ${act.text} (${ago(act.at)})`.trim());
  else add("doing", "INFO", "ว่าง");
} catch {}

// ===== 3) คิวพูด/คิวโพสต์ (VexOutbox) =====
try {
  const q = many(
    "SELECT target, COUNT(*) c, MIN(createdAt) oldest FROM VexOutbox WHERE sentAt IS NULL GROUP BY target",
  );
  const err = one("SELECT COUNT(*) c FROM VexOutbox WHERE sentAt IS NULL AND error IS NOT NULL")?.c || 0;
  const stuck = one("SELECT COUNT(*) c FROM VexOutbox WHERE sentAt IS NULL AND tries >= 3")?.c || 0;
  const total = q.reduce((s, r) => s + r.c, 0);
  const oldest = q.length ? Math.min(...q.map((r) => r.oldest)) : 0;
  const voice = q.find((r) => String(r.target).includes("voice"))?.c || 0;
  const text = total - voice;
  const sent = one("SELECT COUNT(*) c FROM VexOutbox WHERE sentAt >= ?", dayStart())?.c || 0;
  const parts = [`รอพูด ${voice} · รอโพสต์ ${text}`];
  if (oldest) parts.push(`เก่าสุด ${mins(oldest)}`);
  parts.push(`ส่งไปแล้ววันนี้ ${sent}`);
  if (err) parts.push(`ผิดพลาด ${err}`);
  add("queue", stuck > 0 ? "WARN" : err > 0 ? "WARN" : "INFO", parts.join(" · ") + (stuck ? ` · ค้างลองซ้ำ ${stuck}` : ""));
} catch {}

// ===== 4) กองเรื่องที่รอเล่า (นโยบายขัดจังหวะสั่งให้เก็บไว้ก่อน) =====
try {
  const pile = J("vex_interrupt_pile", []) || [];
  const last = pile[pile.length - 1];
  add(
    "pile",
    pile.length >= 10 ? "WARN" : "INFO",
    pile.length ? `กองรอเล่า ${pile.length} เรื่อง · ล่าสุด "${cut(last?.topic || last?.line, 40)}"` : "ไม่มีเรื่องค้างรอเล่า",
  );
} catch {}

// ===== 5) เรื่องที่ค้างอยู่ (focus stack) + ร่างที่รอยืนยัน =====
try {
  const fs2 = J("vex_focus_stack", []) || [];
  const top = fs2[0];
  add("focus", "INFO", fs2.length ? `เรื่องค้าง ${fs2.length} · ล่าสุด "${cut(top?.label, 46)}"` : "ไม่มีเรื่องค้าง");
} catch {}
try {
  const d = J("vex_outgoing_draft");
  if (d?.peerName) add("draft", "WARN", `ร่างถึง ${cut(d.peerName, 24)} รอยืนยัน · "${cut(d.message, 34) || "(ยังไม่มีเนื้อความ)"}"`);
  else add("draft", "INFO", "ไม่มีร่างค้างรอส่ง");
} catch {}

// ===== 6) กระดานงาน =====
try {
  const open = one("SELECT COUNT(*) c FROM KikiTask WHERE status='open'")?.c || 0;
  const high = one("SELECT COUNT(*) c FROM KikiTask WHERE status='open' AND priority='high'")?.c || 0;
  const due = one("SELECT COUNT(*) c FROM KikiTask WHERE status='open' AND dueDate IS NOT NULL AND dueDate < ?", dayStart() + 86400_000)?.c || 0;
  const doneToday = one("SELECT COUNT(*) c FROM KikiTask WHERE doneAt >= ?", dayStart())?.c || 0;
  add(
    "tasks",
    due > 0 ? "WARN" : "INFO",
    `ค้าง ${open}${high ? ` (ด่วน ${high})` : ""} · ครบกำหนดถึงวันนี้ ${due} · ปิดวันนี้ ${doneToday}`,
  );
} catch {}

// ===== 7) งานเบื้องหลัง Hermes =====
try {
  const run = many("SELECT task, startedAt, progressText FROM KikiHermesJob WHERE status='running' AND canceled=0");
  const pend = one("SELECT COUNT(*) c FROM KikiHermesJob WHERE status='pending'")?.c || 0;
  const fail = one("SELECT COUNT(*) c FROM KikiHermesJob WHERE status='failed' AND doneAt >= ?", dayStart())?.c || 0;
  const done = one("SELECT COUNT(*) c FROM KikiHermesJob WHERE status='done' AND doneAt >= ?", dayStart())?.c || 0;
  let d = `รันอยู่ ${run.length} · รอคิว ${pend} · เสร็จวันนี้ ${done}${fail ? ` · ล้มเหลว ${fail}` : ""}`;
  if (run.length) d += ` · "${cut(run[0].task, 28)}" ${mins(run[0].startedAt)}`;
  add("hermes", fail > 0 ? "WARN" : "INFO", d);
} catch {}

// ===== 8) ความจำ =====
try {
  const facts = one("SELECT COUNT(*) c FROM OwnerFact WHERE active=1")?.c || 0;
  const chats = one("SELECT COUNT(*) c FROM KikiChat")?.c || 0;
  const byCh = many("SELECT channel, COUNT(*) c FROM KikiChat GROUP BY channel ORDER BY c DESC");
  const chTxt = byCh.map((r) => `${r.channel} ${n(r.c)}`).join(" · ");
  const today = one("SELECT COUNT(*) c FROM KikiChat WHERE createdAt >= ?", dayStart())?.c || 0;
  const mem = one("SELECT COUNT(*) c FROM KikiMemory")?.c || 0;
  add("memory", "INFO", `ข้อเท็จจริง ${n(facts)} · สรุปยาว ${n(mem)} · บทสนทนา ${n(chats)} (${chTxt}) · วันนี้ ${today}`);
} catch {}

// ===== 9) คลังส่วนตัว (Obsidian + vector) =====
try {
  const vault = ENV.OBSIDIAN_VAULT_PATH || "";
  let notes = 0;
  let vaultOk = false;
  if (vault) {
    const dir = path.join(vault, "AI-Personal");
    if (fs.existsSync(dir)) {
      vaultOk = true;
      try {
        for (const f of fs.readdirSync(dir, { recursive: true })) if (String(f).endsWith(".md")) notes++;
      } catch {}
    }
  }
  let vec = "-";
  try {
    const vdb = new Database(ENV.THUNDER_VEC_PATH || path.join(ROOT, "prisma", "thunder-vec.db"), { readonly: true, fileMustExist: true });
    const sv = await import("sqlite-vec");
    sv.load(vdb);
    vec = n(vdb.prepare("SELECT COUNT(*) c FROM kiki_vec").get()?.c || 0);
    vdb.close();
  } catch {}
  const media = one("SELECT COUNT(*) c FROM KikiMedia")?.c || 0;
  add(
    "vault",
    vaultOk ? "INFO" : "WARN",
    vaultOk
      ? `AI-Personal · โน้ต ${n(notes)} ไฟล์ · vector ${vec} · รูป/วิดีโอ ${n(media)}`
      : `หาโฟลเดอร์ AI-Personal ไม่เจอ (OBSIDIAN_VAULT_PATH=${vault || "ไม่ได้ตั้ง"})`,
  );
} catch {}

// ===== 10) การเงิน =====
try {
  const t0 = dayStart();
  const inc = one("SELECT COALESCE(SUM(amount),0) s, COUNT(*) c FROM FinanceTxn WHERE type='income' AND occurredAt >= ?", t0);
  const exp = one("SELECT COALESCE(SUM(amount),0) s, COUNT(*) c FROM FinanceTxn WHERE type='expense' AND occurredAt >= ?", t0);
  const pend = one("SELECT COUNT(*) c FROM FinanceTxn WHERE category='รอระบุ'")?.c || 0;
  const monthStart = (() => {
    const d = new Date(Date.now() + TZ);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - TZ;
  })();
  const mExp = one("SELECT COALESCE(SUM(amount),0) s FROM FinanceTxn WHERE type='expense' AND occurredAt >= ?", monthStart)?.s || 0;
  const budget = one("SELECT COALESCE(SUM(monthly),0) s FROM FinanceBudget")?.s || 0;
  const left = budget ? ` · งบเดือนเหลือ ${baht(budget - mExp)} ฿` : " · ยังไม่ได้ตั้งงบเดือน";
  add(
    "money",
    pend >= 10 ? "WARN" : "INFO",
    `วันนี้ จ่าย ${exp?.c || 0} รายการ ${baht(exp?.s)} ฿ · รับ ${baht(inc?.s)} ฿ · เดือนนี้จ่าย ${baht(mExp)} ฿${left}${pend ? ` · รอระบุ ${pend}` : ""}`,
  );
} catch {}

// ===== 11) ตารางนัด =====
try {
  const t0 = dayStart();
  const today = one("SELECT COUNT(*) c FROM CalendarEvent WHERE agent='kiki' AND done=0 AND date >= ? AND date < ?", t0, t0 + 86400_000)?.c || 0;
  const tmr = one("SELECT COUNT(*) c FROM CalendarEvent WHERE agent='kiki' AND done=0 AND date >= ? AND date < ?", t0 + 86400_000, t0 + 172800_000)?.c || 0;
  const next = one("SELECT date, timeText, title FROM CalendarEvent WHERE agent='kiki' AND done=0 AND date >= ? ORDER BY date ASC, timeText ASC LIMIT 1", t0);
  const nx = next ? ` · ถัดไป ${next.timeText || "ทั้งวัน"} ${cut(next.title, 26)}` : " · ไม่มีนัดข้างหน้า";
  add("agenda", "INFO", `วันนี้ ${today} · พรุ่งนี้ ${tmr}${nx}`);
} catch {}

// ===== 12) เสียง (TTS/โควตา) =====
try {
  const voice = S.kiki_tts_voice || "Charon";
  const calls = J("vex_tts_calls", {})?.[new Date(Date.now() + TZ).toISOString().slice(0, 10)] || {};
  const total = Object.values(calls).reduce((a, b) => a + Number(b || 0), 0);
  const byModel = Object.entries(calls)
    .map(([m, c]) => `${m.replace(/^gemini-/, "").replace(/-preview.*$/, "")} ${c}`)
    .join(" · ");
  const bad = J("vex_quota_bad", {}) || {};
  const badNow = Object.entries(bad).filter(([, at]) => Date.now() - Number(at) < 6 * 3600_000).map(([k]) => k);
  add(
    "voice",
    badNow.length ? "WARN" : "INFO",
    `เสียง ${voice} · เรียก TTS วันนี้ ${total}${byModel ? ` (${byModel})` : ""}${badNow.length ? ` · โควตาตัน: ${badNow.join(", ")}` : ""}`,
  );
} catch {}

// ===== 13) เซสชัน/กุญแจที่หมดอายุได้ =====
try {
  const bits = [];
  const tgSession = ENV.KIKI_TG_SESSION_PATH || path.join(ROOT, ".kiki-tg-session");
  bits.push(fs.existsSync(tgSession) ? "TG userbot ok" : "TG userbot ขาด → npm run kiki:tg-auth");
  bits.push(ENV.KIKI_GMAIL_APP_PASSWORD ? "Gmail ok" : "Gmail ขาด");
  bits.push(ENV.DISCORD_BOT_TOKEN ? "Discord token ok" : "Discord token ขาด");
  bits.push(ENV.GEMINI_API_KEY ? "Gemini ok" : "Gemini key ขาด");
  const miss = bits.filter((b) => b.includes("ขาด")).length;
  add("session", miss ? "AUTH" : "INFO", bits.join(" · "));
} catch {}

db.close();
console.log(rows.join("\n"));
