#!/usr/bin/env node
/**
 * เก็บสถานะละเอียดของ Vex — ใช้ได้ 2 ทาง
 *   import { collectVex } from "./status-vex.mjs"   → ได้ object ดิบ (scripts/status.mjs เอาไปวาดกล่อง)
 *   node scripts/status-vex.mjs                     → พิมพ์ name|STATE|detail (ของเดิม status.sh ยังใช้ได้)
 *
 * อ่านอย่างเดียว ไม่แตะข้อมูล — พังตรงไหนก็คืน null เฉพาะช่องนั้น ไม่ทำให้ทั้งจอตาย
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const TZ = 7 * 3600_000; // Asia/Bangkok

// ---------- env (อ่านเองเพราะสคริปต์นี้รันนอก Next) ----------
export const ENV = {};
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) ENV[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

// ---------- helpers ----------
export const nf = (x) => Number(x || 0).toLocaleString("en-US");
export const baht = (x) => Math.round(Number(x || 0)).toLocaleString("en-US");

export function ago(ms) {
  if (!ms) return "-";
  const d = Date.now() - Number(ms);
  const m = Math.round(Math.abs(d) / 60000);
  const s = m < 1 ? "เมื่อกี้" : m < 60 ? `${m} นาที` : m < 1440 ? `${Math.round(m / 60)} ชม.` : `${Math.round(m / 1440)} วัน`;
  if (m < 1) return s;
  return d >= 0 ? `${s}ที่แล้ว` : `อีก ${s}`;
}
export function shortAgo(ms) {
  const m = Math.round((Date.now() - Number(ms)) / 60000);
  return m < 60 ? `${m} นาที` : m < 1440 ? `${Math.round(m / 60)} ชม.` : `${Math.round(m / 1440)} วัน`;
}
const dayStart = (t = Date.now()) => Math.floor((t + TZ) / 86400_000) * 86400_000 - TZ;
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

export function collectVex() {
  let db;
  try {
    db = new Database(path.join(ROOT, "prisma", "changoh.db"), { readonly: true, fileMustExist: true });
  } catch {
    return { error: "เปิด prisma/changoh.db ไม่ได้" };
  }
  const one = (sql, ...a) => { try { return db.prepare(sql).get(...a); } catch { return null; } };
  const all = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch { return []; } };

  const S = {};
  for (const r of all("SELECT key, value FROM Setting")) S[r.key] = r.value;
  const J = (k, d = null) => { try { return S[k] ? JSON.parse(S[k]) : d; } catch { return d; } };

  const V = { error: null };

  // ===== สาย =====
  try {
    const pres = J("vex_voice_presence", {}) || {};
    const until = Number(S.vex_convo_window_until || 0);
    V.call = {
      inVoice: Boolean(pres.inVoice),
      awake: until > Date.now(),
      awakeSec: Math.max(0, Math.round((until - Date.now()) / 1000)),
      heardAt: Number(S.vex_last_heard_at || 0),
      announce: S.vex_voice_announce === "1",
      topic: clean(S.vex_session_topic),
    };
    const act = J("vex_current_activity");
    V.doing = act?.text ? { text: clean(act.text), icon: act.icon || "", at: act.at } : null;
  } catch {}

  // ===== คิวพูด / คิวโพสต์ =====
  try {
    const q = all("SELECT target, COUNT(*) c, MIN(createdAt) oldest FROM VexOutbox WHERE sentAt IS NULL GROUP BY target");
    const voice = q.filter((r) => String(r.target).includes("voice")).reduce((s, r) => s + r.c, 0);
    const total = q.reduce((s, r) => s + r.c, 0);
    V.queue = {
      voice,
      text: total - voice,
      total,
      oldest: q.length ? Math.min(...q.map((r) => r.oldest)) : 0,
      sentToday: one("SELECT COUNT(*) c FROM VexOutbox WHERE sentAt >= ?", dayStart())?.c || 0,
      err: one("SELECT COUNT(*) c FROM VexOutbox WHERE sentAt IS NULL AND error IS NOT NULL")?.c || 0,
      stuck: one("SELECT COUNT(*) c FROM VexOutbox WHERE sentAt IS NULL AND tries >= 3")?.c || 0,
    };
  } catch {}

  // ===== กองรอเล่า / เรื่องค้าง / ร่างค้าง =====
  try {
    const pile = J("vex_interrupt_pile", []) || [];
    const last = pile[pile.length - 1];
    V.pile = { n: pile.length, last: clean(last?.topic || last?.line) };
  } catch {}
  try {
    const st = J("vex_focus_stack", []) || [];
    V.focus = { n: st.length, last: clean(st[0]?.label) };
  } catch {}
  try {
    const d = J("vex_outgoing_draft");
    V.draft = d?.peerName ? { peer: clean(d.peerName), msg: clean(d.message) } : null;
  } catch {}

  // ===== กระดานงาน + Hermes =====
  try {
    V.tasks = {
      open: one("SELECT COUNT(*) c FROM KikiTask WHERE status='open'")?.c || 0,
      high: one("SELECT COUNT(*) c FROM KikiTask WHERE status='open' AND priority='high'")?.c || 0,
      due: one("SELECT COUNT(*) c FROM KikiTask WHERE status='open' AND dueDate IS NOT NULL AND dueDate < ?", dayStart() + 86400_000)?.c || 0,
      doneToday: one("SELECT COUNT(*) c FROM KikiTask WHERE doneAt >= ?", dayStart())?.c || 0,
    };
  } catch {}
  try {
    const run = all("SELECT task, startedAt FROM KikiHermesJob WHERE status='running' AND canceled=0");
    V.hermes = {
      run: run.length,
      top: run.length ? { task: clean(run[0].task), startedAt: run[0].startedAt } : null,
      pend: one("SELECT COUNT(*) c FROM KikiHermesJob WHERE status='pending'")?.c || 0,
      fail: one("SELECT COUNT(*) c FROM KikiHermesJob WHERE status='failed' AND doneAt >= ?", dayStart())?.c || 0,
      done: one("SELECT COUNT(*) c FROM KikiHermesJob WHERE status='done' AND doneAt >= ?", dayStart())?.c || 0,
    };
  } catch {}

  // ===== ความจำ =====
  try {
    V.memory = {
      facts: one("SELECT COUNT(*) c FROM OwnerFact WHERE active=1")?.c || 0,
      longterm: one("SELECT COUNT(*) c FROM KikiMemory")?.c || 0,
      chats: one("SELECT COUNT(*) c FROM KikiChat")?.c || 0,
      today: one("SELECT COUNT(*) c FROM KikiChat WHERE createdAt >= ?", dayStart())?.c || 0,
      byChannel: all("SELECT channel, COUNT(*) c FROM KikiChat GROUP BY channel ORDER BY c DESC"),
    };
  } catch {}

  // ===== คลังส่วนตัว =====
  try {
    const vault = ENV.OBSIDIAN_VAULT_PATH || "";
    const dir = vault ? path.join(vault, "AI-Personal") : "";
    let notes = 0;
    const ok = Boolean(dir && fs.existsSync(dir));
    if (ok) {
      try { for (const f of fs.readdirSync(dir, { recursive: true })) if (String(f).endsWith(".md")) notes++; } catch {}
    }
    let vec = null;
    try {
      const vdb = new Database(ENV.THUNDER_VEC_PATH || path.join(ROOT, "prisma", "thunder-vec.db"), { readonly: true, fileMustExist: true });
      // kiki_vec เป็น virtual table ของ sqlite-vec — อ่านตรงไม่ได้ถ้าไม่โหลดส่วนขยาย
      // แต่ตารางเงา kiki_vec_rowids เป็นตารางธรรมดา นับแถวได้เลย (1 แถว = 1 โน้ตที่ทำ index แล้ว)
      vec = vdb.prepare("SELECT COUNT(*) c FROM kiki_vec_rowids").get()?.c ?? null;
      vdb.close();
    } catch {}
    V.vault = { ok, notes, vec, media: one("SELECT COUNT(*) c FROM KikiMedia")?.c || 0, path: vault };
  } catch {}

  // ===== การเงิน =====
  try {
    const t0 = dayStart();
    const mStart = (() => { const d = new Date(Date.now() + TZ); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - TZ; })();
    V.money = {
      expToday: one("SELECT COALESCE(SUM(amount),0) s, COUNT(*) c FROM FinanceTxn WHERE type='expense' AND occurredAt >= ?", t0) || { s: 0, c: 0 },
      incToday: one("SELECT COALESCE(SUM(amount),0) s FROM FinanceTxn WHERE type='income' AND occurredAt >= ?", t0)?.s || 0,
      expMonth: one("SELECT COALESCE(SUM(amount),0) s FROM FinanceTxn WHERE type='expense' AND occurredAt >= ?", mStart)?.s || 0,
      budget: one("SELECT COALESCE(SUM(monthly),0) s FROM FinanceBudget")?.s || 0,
      pending: one("SELECT COUNT(*) c FROM FinanceTxn WHERE category='รอระบุ'")?.c || 0,
    };
  } catch {}

  // ===== นัด =====
  try {
    const t0 = dayStart();
    const cnt = (a, b) => one("SELECT COUNT(*) c FROM CalendarEvent WHERE agent='kiki' AND done=0 AND date >= ? AND date < ?", a, b)?.c || 0;
    const next = one("SELECT date, timeText, title FROM CalendarEvent WHERE agent='kiki' AND done=0 AND date >= ? ORDER BY date ASC, timeText ASC LIMIT 1", t0);
    V.agenda = { today: cnt(t0, t0 + 86400_000), tomorrow: cnt(t0 + 86400_000, t0 + 172800_000), next: next ? { time: next.timeText || "ทั้งวัน", title: clean(next.title) } : null };
  } catch {}

  // ===== เสียง =====
  try {
    const today = new Date(Date.now() + TZ).toISOString().slice(0, 10);
    const calls = J("vex_tts_calls", {})?.[today] || {};
    const bad = J("vex_quota_bad", {}) || {};
    V.voice = {
      name: S.kiki_tts_voice || "Charon",
      calls: Object.values(calls).reduce((a, b) => a + Number(b || 0), 0),
      models: Object.entries(calls).map(([m, c]) => `${m.replace(/^gemini-/, "").replace(/-preview.*$/, "")} ${c}`),
      quotaBad: Object.entries(bad).filter(([, at]) => Date.now() - Number(at) < 6 * 3600_000).map(([k]) => k),
    };
  } catch {}

  // ===== กุญแจ/เซสชัน =====
  try {
    const tg = ENV.KIKI_TG_SESSION_PATH || path.join(ROOT, ".kiki-tg-session");
    V.session = [
      { name: "TG userbot", ok: fs.existsSync(tg), fix: "npm run kiki:tg-auth" },
      { name: "Gmail", ok: Boolean(ENV.KIKI_GMAIL_APP_PASSWORD), fix: "ตั้ง KIKI_GMAIL_APP_PASSWORD" },
      { name: "Discord", ok: Boolean(ENV.DISCORD_BOT_TOKEN), fix: "ตั้ง DISCORD_BOT_TOKEN" },
      { name: "Gemini", ok: Boolean(ENV.GEMINI_API_KEY), fix: "ตั้ง GEMINI_API_KEY" },
    ];
  } catch {}

  db.close();
  return V;
}

// ---------- โหมด CLI เดิม (status.sh ยังเรียกได้) ----------
if (import.meta.url === `file://${process.argv[1]}`) {
  const V = collectVex();
  if (V.error) { console.log(`db|DOWN|${V.error}`); process.exit(0); }
  const out = [];
  const push = (n, s, d) => out.push(`${n}|${s}|${d}`);
  if (V.call) push("call", V.call.inVoice ? "OK" : "INFO",
    `${V.call.inVoice ? "โด้อยู่ในสาย" : "โด้ไม่อยู่ในสาย"} · ${V.call.awake ? `หน้าต่างคุยเปิดอยู่ (${V.call.awakeSec} วิ)` : "โหมดเรียกชื่อ"} · ได้ยินล่าสุด ${ago(V.call.heardAt)}`);
  if (V.doing !== undefined) push("doing", "INFO", V.doing ? `${V.doing.text} (${ago(V.doing.at)})` : "ว่าง");
  if (V.queue) push("queue", V.queue.stuck || V.queue.err ? "WARN" : "INFO",
    `รอพูด ${V.queue.voice} · รอโพสต์ ${V.queue.text} · ส่งวันนี้ ${V.queue.sentToday}${V.queue.oldest ? ` · เก่าสุด ${shortAgo(V.queue.oldest)}` : ""}`);
  if (V.pile) push("pile", V.pile.n >= 10 ? "WARN" : "INFO", V.pile.n ? `กองรอเล่า ${V.pile.n} · ล่าสุด "${V.pile.last}"` : "ไม่มีเรื่องรอเล่า");
  if (V.focus) push("focus", "INFO", V.focus.n ? `เรื่องค้าง ${V.focus.n} · ล่าสุด "${V.focus.last}"` : "ไม่มีเรื่องค้าง");
  if (V.draft !== undefined) push("draft", V.draft ? "WARN" : "INFO", V.draft ? `ร่างถึง ${V.draft.peer} รอยืนยัน` : "ไม่มีร่างค้าง");
  if (V.tasks) push("tasks", V.tasks.due ? "WARN" : "INFO", `ค้าง ${V.tasks.open} · ครบกำหนด ${V.tasks.due} · ปิดวันนี้ ${V.tasks.doneToday}`);
  if (V.hermes) push("hermes", V.hermes.fail ? "WARN" : "INFO", `รันอยู่ ${V.hermes.run} · รอคิว ${V.hermes.pend} · เสร็จวันนี้ ${V.hermes.done} · ล้มเหลว ${V.hermes.fail}`);
  if (V.memory) push("memory", "INFO", `ข้อเท็จจริง ${nf(V.memory.facts)} · บทสนทนา ${nf(V.memory.chats)} · วันนี้ ${V.memory.today}`);
  if (V.vault) push("vault", V.vault.ok ? "INFO" : "WARN", V.vault.ok ? `โน้ต ${nf(V.vault.notes)} · vector ${V.vault.vec ?? "-"} · รูป ${V.vault.media}` : "หาโฟลเดอร์ AI-Personal ไม่เจอ");
  if (V.money) push("money", V.money.pending >= 10 ? "WARN" : "INFO", `เดือนนี้จ่าย ${baht(V.money.expMonth)} ฿ · วันนี้ ${baht(V.money.expToday.s)} ฿ · รอระบุ ${V.money.pending}`);
  if (V.agenda) push("agenda", "INFO", `วันนี้ ${V.agenda.today} · พรุ่งนี้ ${V.agenda.tomorrow}${V.agenda.next ? ` · ถัดไป ${V.agenda.next.time} ${V.agenda.next.title}` : ""}`);
  if (V.voice) push("voice", V.voice.quotaBad.length ? "WARN" : "INFO", `เสียง ${V.voice.name} · TTS วันนี้ ${V.voice.calls}`);
  if (V.session) push("session", V.session.some((s) => !s.ok) ? "AUTH" : "INFO", V.session.map((s) => `${s.name} ${s.ok ? "ok" : "ขาด"}`).join(" · "));
  console.log(out.join("\n"));
}
