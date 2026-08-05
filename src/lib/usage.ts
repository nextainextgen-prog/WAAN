import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * อ่านการใช้งาน token จริงจากไฟล์ในเครื่อง (บัญชีที่ล็อกอินในเครื่องนี้)
 *  - Claude Code: ~/.claude/projects/**\/*.jsonl  (แต่ละบรรทัดมี timestamp + message.usage)
 *  - Codex:       ~/.codex/sessions/**\/*.jsonl    (มี total_token_usage สะสมต่อ session)
 * หมายเหตุ: % ของลิมิตแพลน (session 5h / week 7d) เป็นการประเมินจาก budget ที่ตั้งใน .env
 * ถ้าอยากได้เลข % ตรงเป๊ะเท่าหน้า provider ต้องดึงจาก API ของแต่ละบัญชี (mark-ai) เพิ่ม
 */

export interface UsageWindow {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  costUsd: number;
  firstTs: number; // timestamp (ms) ของ event เก่าสุดที่ยังอยู่ในหน้าต่างนี้ — ไว้คำนวณ "รีเซ็ตใน" (0 = ไม่มีการใช้งาน)
}

export interface UsageReport {
  session: UsageWindow; // 5 ชม.ล่าสุด
  week: UsageWindow; // 7 วันล่าสุด
  today: UsageWindow; // วันนี้ (ตั้งแต่เที่ยงคืน local โดยประมาณ = 24 ชม.ล่าสุด)
}

const empty = (): UsageWindow => ({ inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0, costUsd: 0, firstTs: 0 });

// เรตประเมินราคา (USD/ล้าน token) — ปรับได้ผ่าน .env ถ้าต้องการ
const RATE_IN = Number(process.env.USAGE_RATE_IN || 3);
const RATE_OUT = Number(process.env.USAGE_RATE_OUT || 15);

function addCost(w: UsageWindow) {
  w.costUsd = (w.inputTokens / 1e6) * RATE_IN + (w.outputTokens / 1e6) * RATE_OUT;
}

/**
 * ===== ทำไมโค้ดส่วนนี้ถึงหน้าตาแบบนี้ (บทเรียน 5 ส.ค. 2026 — ห้ามรื้อกลับ) =====
 *
 * ของเดิมอ่าน log ทั้งกอง (~1,800 ไฟล์ · 1.1 GB) **ด้วย readFileSync** และอ่าน **3 รอบ**
 * (session / week / today แยกกันคนละรอบ) ทุกครั้งที่มีคนขอตัวเลข
 *   → บล็อก event loop ของเว็บ 4-32 วินาที · วัดจากของจริง: ingest ที่ใช้งานเอง 184 ms
 *     ต้องรอคิว 10.6 วินาที เพราะ loop ไม่ว่าง · เว็บถูกฆ่าทิ้งซ้ำ ๆ ทั้งเช้า
 *
 * สามอย่างที่แก้:
 *  1) อ่านไฟล์รอบเดียว แล้วโยนเข้าทั้ง 3 หน้าต่างพร้อมกัน (จาก 3 รอบ → 1 รอบ)
 *  2) แคชรายไฟล์ด้วย mtime+size — log ที่เขียนเสร็จแล้วไม่มีวันเปลี่ยน
 *     รอบต่อไปจึงอ่านใหม่เฉพาะไฟล์ที่กำลังถูกเขียนอยู่จริง ๆ (ปกติ 1-3 ไฟล์)
 *     เก็บเป็น "รายการ event" ไม่ใช่ยอดรวม เพราะหน้าต่างเลื่อนตามเวลา ยอดรวมใช้ซ้ำไม่ได้
 *  3) เปลี่ยนเป็น async I/O ทั้งหมด — ต่อให้ต้องอ่านของหนักจริง เว็บก็ยังหายใจได้
 */

// วัดของจริง 5 ส.ค.: หน้าต่าง 7 วัน = 887 ไฟล์ · 0.59 GB · แต่มีแค่ 21,110 event
// → เก็บทุก event ไว้ตรง ๆ ได้สบาย (<1 MB) และได้ยอด "ตรงเป๊ะเท่าของเดิม" ไม่ต้องปัดเป็นถังเวลา
type Ev = { ts: number; in: number; out: number; cache: number };
type FileEntry = { mtimeMs: number; size: number; events: Ev[] };

const fileCache = new Map<string, FileEntry>();

/**
 * แคชอยู่ข้ามการรีสตาร์ทได้ — สำคัญกว่าที่คิด
 *
 * แคชในหน่วยความจำหายทุกครั้งที่เว็บขึ้นใหม่ และเว็บขึ้นใหม่บ่อยมาก
 * (watchdog รีสตาร์ทให้เอง · dev reload · เจ้าของสั่งเอง)
 * ตอนบูตคือช่วงที่เครื่องยุ่งที่สุดพอดี — วัดจริงได้ 30-41 วิ ทั้งที่เครื่องว่างใช้แค่ 6 วิ
 * → จำผลแยกไฟล์ลงดิสก์ไว้ รีสตาร์ทแล้วหยิบมาใช้ต่อได้เลย
 *
 * ไม่ใช่ฐานข้อมูลที่สอง — เป็นแค่ผลลัพธ์ที่คำนวณซ้ำได้ ลบทิ้งเมื่อไหร่ก็แค่ช้าลงรอบเดียว
 * ความถูกต้องผูกกับ mtime+size ของไฟล์ต้นทาง ไฟล์เปลี่ยนเมื่อไหร่ของเก่าใช้ไม่ได้ทันที
 */
const DISK_CACHE = path.join(process.cwd(), ".usage-cache.json");
type DiskShape = { v: number; claude: Record<string, [number, number, number[][]]>; codex: Record<string, [number, number, number, number[] | null]> };
const DISK_V = 1;
let diskLoaded = false;
let diskDirty = false;

function loadDisk() {
  if (diskLoaded) return;
  diskLoaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(DISK_CACHE, "utf8")) as DiskShape;
    if (raw?.v !== DISK_V) return;
    for (const [p, [mtimeMs, size, evs]] of Object.entries(raw.claude || {})) {
      fileCache.set(p, { mtimeMs, size, events: evs.map(([ts, i, o, c]) => ({ ts, in: i, out: o, cache: c })) });
    }
    for (const [p, [mtimeMs, size, lastTs, best]] of Object.entries(raw.codex || {})) {
      codexCache.set(p, { mtimeMs, size, lastTs, best: best ? { in: best[0], out: best[1], total: best[2] } : null });
    }
  } catch {
    /* ไม่มีไฟล์/ไฟล์เสีย = เริ่มใหม่ ไม่ใช่เรื่องใหญ่ */
  }
}

function saveDisk() {
  if (!diskDirty) return;
  diskDirty = false;
  try {
    const out: DiskShape = { v: DISK_V, claude: {}, codex: {} };
    for (const [p, e] of fileCache) out.claude[p] = [e.mtimeMs, e.size, e.events.map((x) => [x.ts, x.in, x.out, x.cache])];
    for (const [p, e] of codexCache) out.codex[p] = [e.mtimeMs, e.size, e.lastTs, e.best ? [e.best.in, e.best.out, e.best.total] : null];
    // เขียนไฟล์ชั่วคราวแล้วค่อยสลับ — เว็บถูกฆ่ากลางเขียนจะได้ไม่เหลือไฟล์พัง
    fs.writeFileSync(DISK_CACHE + ".tmp", JSON.stringify(out));
    fs.renameSync(DISK_CACHE + ".tmp", DISK_CACHE);
  } catch {
    /* เขียนไม่ได้ = แค่ช้าลงตอนบูตรอบหน้า ไม่กระทบความถูกต้อง */
  }
}

async function walkJsonl(dir: string, sinceMs: number): Promise<{ path: string; mtimeMs: number; size: number }[]> {
  const out: { path: string; mtimeMs: number; size: number }[] = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith(".jsonl")) {
        try {
          // ข้ามไฟล์ที่แก้ล่าสุดก่อนช่วงเวลา (เร็วขึ้นมาก)
          const st = await fs.promises.stat(p);
          if (st.mtimeMs >= sinceMs) out.push({ path: p, mtimeMs: st.mtimeMs, size: st.size });
        } catch {
          /* ignore */
        }
      }
    }
  }
  return out;
}

/** แยกทีละบรรทัด → รายการ event (ไฟล์ที่เขียนจบแล้วให้ผลเดิมเสมอ = แคชได้) */
function parseEvents(content: string, parse: (line: string) => Ev | null): Ev[] {
  const out: Ev[] = [];
  for (const line of content.split("\n")) {
    const ev = parse(line);
    if (ev) out.push(ev);
  }
  return out;
}

const parseClaudeLine = (line: string): Ev | null => {
  if (!line.includes('"usage"')) return null;
  let d: any;
  try {
    d = JSON.parse(line);
  } catch {
    return null;
  }
  const ts = Date.parse(d.timestamp || "");
  const u = d.message?.usage;
  if (!Number.isFinite(ts) || !u) return null;
  return {
    ts,
    in: u.input_tokens || 0,
    out: u.output_tokens || 0,
    cache: (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
  };
};

/** รวม event ของไฟล์เดียวเข้าหน้าต่างที่กำหนด — เงื่อนไข ts >= sinceMs เหมือนของเดิมเป๊ะ */
function foldInto(w: UsageWindow, events: Ev[], sinceMs: number) {
  for (const e of events) {
    if (e.ts < sinceMs) continue;
    w.inputTokens += e.in;
    w.outputTokens += e.out;
    w.cacheTokens += e.cache;
    if (!w.firstTs || e.ts < w.firstTs) w.firstTs = e.ts;
  }
}

function seal(w: UsageWindow): UsageWindow {
  w.totalTokens = w.inputTokens + w.outputTokens + w.cacheTokens;
  addCost(w);
  return w;
}

// Claude: ทุกบรรทัดคือ event เพิ่มยอด → บวกสะสมได้ตรง ๆ
async function readClaude(nowMs: number): Promise<UsageReport> {
  const base = path.join(os.homedir(), ".claude", "projects");
  const report: UsageReport = { session: empty(), week: empty(), today: empty() };
  const weekSince = nowMs - 7 * 86400_000;
  if (!fs.existsSync(base)) return report;

  loadDisk();
  const seen = new Set<string>();
  for (const f of await walkJsonl(base, weekSince)) {
    seen.add(f.path);
    let entry = fileCache.get(f.path);
    // ไฟล์เดิมขนาดเดิม เวลาแก้เดิม = เนื้อในเดิม ไม่ต้องอ่านซ้ำ
    if (!entry || entry.mtimeMs !== f.mtimeMs || entry.size !== f.size) {
      diskDirty = true;
      let content: string;
      try {
        content = await fs.promises.readFile(f.path, "utf8");
      } catch {
        continue;
      }
      entry = { mtimeMs: f.mtimeMs, size: f.size, events: parseEvents(content, parseClaudeLine) };
      fileCache.set(f.path, entry);
    }
    foldInto(report.session, entry.events, nowMs - 5 * 3600_000);
    foldInto(report.week, entry.events, weekSince);
    foldInto(report.today, entry.events, nowMs - 24 * 3600_000);
  }
  // ไฟล์ที่หลุดหน้าต่าง 7 วันไปแล้ว = ปล่อยแคชทิ้ง ไม่งั้นบวมไปเรื่อย ๆ
  for (const k of fileCache.keys()) if (!seen.has(k) && k.startsWith(base)) { fileCache.delete(k); diskDirty = true; }

  return { session: seal(report.session), week: seal(report.week), today: seal(report.today) };
}

// Codex: total_token_usage เป็นยอด "สะสมทั้ง session" ไม่ใช่ต่อ event
// → ต้องเอาค่าสูงสุดของไฟล์ ไม่ใช่บวกทุกบรรทัด (บวกแล้วยอดจะพองเป็นสิบเท่า)
type CodexEntry = { mtimeMs: number; size: number; best: { in: number; out: number; total: number } | null; lastTs: number };
const codexCache = new Map<string, CodexEntry>();

async function readCodex(nowMs: number): Promise<UsageReport> {
  const base = path.join(os.homedir(), ".codex", "sessions");
  const report: UsageReport = { session: empty(), week: empty(), today: empty() };
  const weekSince = nowMs - 7 * 86400_000;
  if (!fs.existsSync(base)) return report;

  loadDisk();
  const seen = new Set<string>();
  for (const f of await walkJsonl(base, weekSince)) {
    seen.add(f.path);
    let entry = codexCache.get(f.path);
    if (!entry || entry.mtimeMs !== f.mtimeMs || entry.size !== f.size) {
      diskDirty = true;
      let content: string;
      try {
        content = await fs.promises.readFile(f.path, "utf8");
      } catch {
        continue;
      }
      let best: { in: number; out: number; total: number } | null = null;
      let lastTs = 0;
      for (const line of content.split("\n")) {
        if (!line.includes("token_usage")) continue;
        let d: any;
        try {
          d = JSON.parse(line);
        } catch {
          continue;
        }
        const ts = Date.parse(d.timestamp || "");
        const tu = d.payload?.info?.total_token_usage || d.payload?.total_token_usage || d.total_token_usage;
        if (!tu) continue;
        if (Number.isFinite(ts)) lastTs = Math.max(lastTs, ts);
        if (!best || (tu.total_tokens || 0) > best.total) {
          best = { in: tu.input_tokens || 0, out: tu.output_tokens || 0, total: tu.total_tokens || 0 };
        }
      }
      entry = { mtimeMs: f.mtimeMs, size: f.size, best, lastTs };
      codexCache.set(f.path, entry);
    }
    if (!entry.best) continue;
    for (const [w, since] of [
      [report.session, nowMs - 5 * 3600_000],
      [report.week, weekSince],
      [report.today, nowMs - 24 * 3600_000],
    ] as const) {
      if (entry.lastTs < since) continue;
      w.inputTokens += entry.best.in;
      w.outputTokens += entry.best.out;
      if (!w.firstTs || entry.lastTs < w.firstTs) w.firstTs = entry.lastTs;
    }
  }
  for (const k of codexCache.keys()) if (!seen.has(k) && k.startsWith(base)) { codexCache.delete(k); diskDirty = true; }

  return { session: seal(report.session), week: seal(report.week), today: seal(report.today) };
}

export interface ProviderUsage {
  provider: "claude" | "codex";
  label: string;
  report: UsageReport;
}

export async function readUsage(nowMs: number): Promise<ProviderUsage[]> {
  const [claude, codex] = await Promise.all([readClaude(nowMs), readCodex(nowMs)]);
  saveDisk();
  return [
    { provider: "claude", label: "Claude", report: claude },
    { provider: "codex", label: "Codex", report: codex },
  ];
}

/**
 * ทางเข้าเดียวที่ทุกคนควรใช้ — แคชร่วม + singleflight
 *
 * เดิมมีคนอ่านของหนักนี้ 2 ทางแยกกัน (การ์ดมอนิเตอร์ กับตัวเช็คโทเค็นใกล้เต็ม)
 * ต่างคนต่างมีนาฬิกาของตัวเอง เลยสแกนซ้ำกันคนละรอบ · ตอนนี้เหลือทางเดียว
 * singleflight สำคัญตอนเว็บเพิ่งขึ้น: การ์ดกับตัวเช็คยิงมาพร้อมกัน จะได้สแกนครั้งเดียว
 */
const USAGE_TTL_MS = 60_000;
let usageCache: { at: number; data: ProviderUsage[] } | null = null;
let usageInFlight: Promise<ProviderUsage[]> | null = null;

export async function readUsageCached(nowMs: number): Promise<ProviderUsage[]> {
  if (usageCache && nowMs - usageCache.at < USAGE_TTL_MS) return usageCache.data;
  if (usageInFlight) return usageInFlight;
  usageInFlight = readUsage(nowMs)
    .then((data) => {
      usageCache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      usageInFlight = null;
    });
  // อ่านไม่ได้ก็ยังคืนของเก่าดีกว่าโยน error ใส่การ์ด
  return usageInFlight.catch(() => usageCache?.data ?? []);
}

// bar แบบ text (เหมือนในภาพ) จาก 0..1
export function bar(frac: number, width = 12): string {
  const f = Math.max(0, Math.min(1, frac));
  const filled = Math.round(f * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function fmtTokens(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "k";
  return String(n);
}

// budget ต่อ session/week (token) จาก .env — ไว้คำนวณ % ใกล้เต็ม (ไม่ตั้ง = ไม่โชว์ %)
export function budget(provider: string, win: "SESSION" | "WEEK"): number {
  return Number(process.env[`USAGE_${provider.toUpperCase()}_${win}_BUDGET`] || 0);
}

// ฐานคิด % = input+output จริง (ตัด cache read/creation ที่พุ่งเป็นพันล้านออก — ไม่งั้น % เพี้ยน)
// budget ใน .env จึงตั้งเป็น "จำนวน input+output token" ต่อ window
export function billable(w: UsageWindow): number {
  return w.inputTokens + w.outputTokens;
}

const DIVIDER = "━━━━━━━━━━━━━━━━━━━━";
const ICON: Record<string, string> = { claude: "🔷", codex: "🟢" };

export function formatMonitorCard(usages: ProviderUsage[], nowLabel: string): { text: string; alerts: string[] } {
  const alerts: string[] = [];
  const lines: string[] = ["📊 Usage Monitor", DIVIDER];
  for (const u of usages) {
    lines.push(`${ICON[u.provider] || "▪️"} ${u.label}`);
    for (const [win, w, key] of [
      ["Session 5h", u.report.session, "SESSION"],
      ["Week 7d  ", u.report.week, "WEEK"],
    ] as const) {
      const b = budget(u.provider, key);
      if (b > 0) {
        const frac = billable(w) / b;
        const pct = Math.round(frac * 100);
        const warn = frac >= 0.9 ? " ⚠️" : "";
        lines.push(`  ${win}  ${bar(frac, 10)}  ${pct}% · ${fmtTokens(w.totalTokens)}${warn}`);
        if (frac >= 0.9) alerts.push(`${u.label} ${win.trim()} ใช้ไป ${pct}% ใกล้เต็มแล้ว`);
      } else {
        lines.push(`  ${win}  ${fmtTokens(w.totalTokens)} tokens`);
      }
    }
    lines.push(`  📅 วันนี้ ${fmtTokens(u.report.today.totalTokens)} tokens · ~$${u.report.today.costUsd.toFixed(2)}`);
    lines.push("");
  }
  lines.push(DIVIDER, `🕐 ${nowLabel}`);
  return { text: lines.join("\n"), alerts };
}

// ===== การ์ดภาพ (เรนเดอร์ HTML→PNG) สไตล์หลอด progress =====
export const WINDOW_MS = { SESSION: 5 * 3600_000, WEEK: 7 * 86400_000 } as const;

// "รีเซ็ตใน …" จากหน้าต่าง rolling: event เก่าสุดจะหลุดหน้าต่างเมื่อ firstTs + ช่วงเวลา
export function resetSuffix(firstTs: number, windowMs: number, nowMs: number): string {
  if (!firstTs) return "—"; // ไม่มีการใช้งานในหน้าต่างนี้
  const ms = firstTs + windowMs - nowMs;
  if (ms <= 0) return "รีเซ็ตแล้ว";
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const dur = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return `รีเซ็ตใน ${dur}`;
}

function esc(s: string): string {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

// สร้าง HTML การ์ด Usage Monitor (ไว้ส่งเข้า renderHtmlToPng)
export function monitorCardHtml(usages: ProviderUsage[], nowLabel: string, nowMs: number): string {
  const rowHtml = (label: string, w: UsageWindow, provider: string, key: "SESSION" | "WEEK") => {
    const b = budget(provider, key);
    const pct = b > 0 ? Math.min(100, Math.round((billable(w) / b) * 100)) : 0;
    const value = b > 0 ? `${pct}%` : `${fmtTokens(w.totalTokens)}`;
    const reset = resetSuffix(w.firstTs, WINDOW_MS[key], nowMs);
    const warn = b > 0 && pct >= 90;
    return `
      <div class="row">
        <div class="wlabel">${esc(label)}</div>
        <div class="track"><div class="fill${warn ? " warn" : ""}" style="width:${pct}%"></div></div>
        <div class="wval">${esc(value)} · <span class="muted">${esc(reset)}</span></div>
      </div>`;
  };

  const blocks = usages
    .map((u) => {
      const icon = ICON[u.provider] || "▪️";
      const sub = u.provider === "claude" ? "บัญชีนี้ · ประเมินจากไฟล์ในเครื่อง" : "ประเมินจากไฟล์ในเครื่อง";
      return `
      <div class="prov">
        <div class="phead"><span class="picon">${icon}</span> ${esc(u.label)} <span class="psub">(${esc(sub)})</span></div>
        ${rowHtml("Session 5h", u.report.session, u.provider, "SESSION")}
        ${rowHtml("Week 7d", u.report.week, u.provider, "WEEK")}
      </div>`;
    })
    .join("");

  const todayTokens = usages.reduce((s, u) => s + u.report.today.totalTokens, 0);
  const todayCost = usages.reduce((s, u) => s + u.report.today.costUsd, 0);

  return `<!doctype html><html lang="th"><head><meta charset="utf-8"/>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      width: 720px;
      background: #161b22;
      color: #e6edf3;
      font-family: "Noto Sans Thai","Sarabun","Helvetica Neue",Arial,sans-serif;
      padding: 26px 30px 22px;
      -webkit-font-smoothing: antialiased;
    }
    .title { font-size: 20px; font-weight: 800; letter-spacing:.2px; }
    .title .em { color:#f0b429; }
    .hr { height:1px; background:#2d333b; margin:14px 0 18px; }
    .prov { margin-bottom: 20px; }
    .phead { font-size: 17px; font-weight: 700; margin-bottom: 12px; }
    .picon { font-size: 16px; }
    .psub { font-size: 12.5px; font-weight: 500; color:#8b949e; }
    .row { display:flex; align-items:center; gap: 12px; margin: 7px 0; }
    .wlabel {
      flex: 0 0 96px; font-size: 13px; font-weight:600; color:#adbac7;
      font-family: "SF Mono",ui-monospace,Menlo,monospace;
      background:#21262d; border-radius:6px; padding:5px 8px; text-align:center;
    }
    .track {
      position: relative; flex: 1; height: 22px; border-radius: 6px;
      background-color: #262c34;
      background-image: radial-gradient(rgba(255,255,255,.16) 1.3px, transparent 1.4px);
      background-size: 9px 9px; overflow: hidden;
    }
    .fill {
      position:absolute; top:0; left:0; bottom:0; height:100%;
      border-radius:6px; background: linear-gradient(90deg,#4b78ff,#7d9bff); min-width: 0;
    }
    .fill.warn { background: linear-gradient(90deg,#e5534b,#ff7b72); }
    .wval { flex: 0 0 auto; min-width: 150px; font-size: 13.5px; font-weight:600; text-align:right; }
    .wval .muted { color:#8b949e; font-weight:500; }
    .foot { border-top:1px solid #2d333b; margin-top: 6px; padding-top: 14px; font-size: 15px; font-weight:700; }
    .foot .cost { color:#3fb950; }
    .ts { margin-top: 8px; font-size:12px; color:#6e7681; }
  </style></head>
  <body>
    <div class="title">📊 Usage Monitor</div>
    <div class="hr"></div>
    ${blocks}
    <div class="foot">วันนี้ใช้ ${fmtTokens(todayTokens)} tokens · <span class="cost">$${todayCost.toFixed(2)}</span></div>
    <div class="ts">🕐 ${esc(nowLabel)}</div>
  </body></html>`;
}
