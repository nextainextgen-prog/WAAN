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

function walkJsonl(dir: string, sinceMs: number): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith(".jsonl")) {
        try {
          // ข้ามไฟล์ที่แก้ล่าสุดก่อนช่วงเวลา (เร็วขึ้นมาก)
          if (fs.statSync(p).mtimeMs >= sinceMs) out.push(p);
        } catch {
          /* ignore */
        }
      }
    }
  }
  return out;
}

// รวม Claude usage ในช่วง since..now
function readClaude(sinceMs: number): UsageWindow {
  const base = path.join(os.homedir(), ".claude", "projects");
  const w = empty();
  if (!fs.existsSync(base)) return w;
  for (const file of walkJsonl(base, sinceMs)) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      if (!line.includes('"usage"')) continue;
      let d: any;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      const ts = Date.parse(d.timestamp || "");
      if (!Number.isFinite(ts) || ts < sinceMs) continue;
      const u = d.message?.usage;
      if (!u) continue;
      w.inputTokens += u.input_tokens || 0;
      w.outputTokens += u.output_tokens || 0;
      w.cacheTokens += (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
      if (!w.firstTs || ts < w.firstTs) w.firstTs = ts;
    }
  }
  w.totalTokens = w.inputTokens + w.outputTokens + w.cacheTokens;
  addCost(w);
  return w;
}

// รวม Codex usage: total_token_usage เป็นยอดสะสมต่อ session → ใช้ค่าสูงสุดต่อไฟล์ที่ active ในช่วง
function readCodex(sinceMs: number): UsageWindow {
  const base = path.join(os.homedir(), ".codex", "sessions");
  const w = empty();
  if (!fs.existsSync(base)) return w;
  for (const file of walkJsonl(base, sinceMs)) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf8");
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
    if (best && lastTs >= sinceMs) {
      w.inputTokens += best.in;
      w.outputTokens += best.out;
      if (!w.firstTs || lastTs < w.firstTs) w.firstTs = lastTs;
    }
  }
  w.totalTokens = w.inputTokens + w.outputTokens + w.cacheTokens;
  addCost(w);
  return w;
}

export interface ProviderUsage {
  provider: "claude" | "codex";
  label: string;
  report: UsageReport;
}

export function readUsage(nowMs: number): ProviderUsage[] {
  const sessionSince = nowMs - 5 * 3600_000;
  const weekSince = nowMs - 7 * 86400_000;
  const todaySince = nowMs - 24 * 3600_000;
  const build = (fn: (s: number) => UsageWindow): UsageReport => ({
    session: fn(sessionSince),
    week: fn(weekSince),
    today: fn(todaySince),
  });
  return [
    { provider: "claude", label: "Claude", report: build(readClaude) },
    { provider: "codex", label: "Codex", report: build(readCodex) },
  ];
}

// bar แบบ text (เหมือนในภาพ) จาก 0..1
export function bar(frac: number, width = 12): string {
  const f = Math.max(0, Math.min(1, frac));
  const filled = Math.round(f * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function fmtTokens(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "k";
  return String(n);
}

// budget ต่อ session/week (token) จาก .env — ไว้คำนวณ % ใกล้เต็ม (ไม่ตั้ง = ไม่โชว์ %)
function budget(provider: string, win: "SESSION" | "WEEK"): number {
  return Number(process.env[`USAGE_${provider.toUpperCase()}_${win}_BUDGET`] || 0);
}

// ฐานคิด % = input+output จริง (ตัด cache read/creation ที่พุ่งเป็นพันล้านออก — ไม่งั้น % เพี้ยน)
// budget ใน .env จึงตั้งเป็น "จำนวน input+output token" ต่อ window
function billable(w: UsageWindow): number {
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
const WINDOW_MS = { SESSION: 5 * 3600_000, WEEK: 7 * 86400_000 } as const;

// "รีเซ็ตใน …" จากหน้าต่าง rolling: event เก่าสุดจะหลุดหน้าต่างเมื่อ firstTs + ช่วงเวลา
function resetSuffix(firstTs: number, windowMs: number, nowMs: number): string {
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
