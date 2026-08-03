// อ่านการใช้ token จริงจากไฟล์ในเครื่อง (Claude ~/.claude, Codex ~/.codex)
// ใช้โดย scripts/status.sh — พิมพ์บรรทัดสรุปพร้อมแสดง (ภาษาไทย)
//   node scripts/usage-cli.mjs           -> บรรทัดสรุปสำหรับ dashboard
//   node scripts/usage-cli.mjs --json    -> JSON ดิบ
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// โหลด .env เฉพาะเรต/บัดเจ็ต
try {
  for (const l of fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const RATE_IN = Number(process.env.USAGE_RATE_IN || 3);
const RATE_OUT = Number(process.env.USAGE_RATE_OUT || 15);
const now = Date.now();
const SESSION = now - 5 * 3600e3;
const WEEK = now - 7 * 86400e3;
const TODAY = now - 24 * 3600e3;

function walk(dir, since) {
  const out = [];
  const st = [dir];
  while (st.length) {
    const d = st.pop();
    let es;
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) st.push(p);
      else if (e.name.endsWith(".jsonl")) {
        try { if (fs.statSync(p).mtimeMs >= since) out.push(p); } catch {}
      }
    }
  }
  return out;
}
const W = () => ({ in: 0, out: 0, cache: 0, total: 0, cost: 0, firstTs: 0 });
const cost = (w) => (w.in / 1e6) * RATE_IN + (w.out / 1e6) * RATE_OUT;

function readClaude() {
  const base = path.join(os.homedir(), ".claude", "projects");
  const session = W(), today = W(), week = W();
  let latest = { ts: 0, ctx: 0, out: 0, model: "" };
  if (fs.existsSync(base)) {
    for (const f of walk(base, WEEK)) {
      let c;
      try { c = fs.readFileSync(f, "utf8"); } catch { continue; }
      for (const line of c.split("\n")) {
        if (!line.includes('"usage"')) continue;
        let d;
        try { d = JSON.parse(line); } catch { continue; }
        const ts = Date.parse(d.timestamp || "");
        if (!Number.isFinite(ts)) continue;
        const u = d.message?.usage;
        if (!u) continue;
        const i = u.input_tokens || 0, o = u.output_tokens || 0;
        const ca = (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        const push = (w) => { w.in += i; w.out += o; w.cache += ca; if (!w.firstTs || ts < w.firstTs) w.firstTs = ts; };
        if (ts >= WEEK) push(week);
        if (ts >= SESSION) push(session);
        if (ts >= TODAY) push(today);
        if (ts > latest.ts) latest = { ts, ctx: i + ca, out: o, model: d.message?.model || "" };
      }
    }
  }
  for (const w of [session, today, week]) { w.total = w.in + w.out + w.cache; w.cost = cost(w); }
  return { provider: "claude", label: "Claude", session, today, week, latest };
}

function readCodex() {
  const base = path.join(os.homedir(), ".codex", "sessions");
  const session = W(), today = W(), week = W();
  let latest = { ts: 0, ctx: 0, out: 0, model: "" };
  if (fs.existsSync(base)) {
    for (const f of walk(base, WEEK)) {
      let c;
      try { c = fs.readFileSync(f, "utf8"); } catch { continue; }
      let best = null, lastTs = 0;
      for (const line of c.split("\n")) {
        if (!line.includes("token_usage")) continue;
        let d;
        try { d = JSON.parse(line); } catch { continue; }
        const ts = Date.parse(d.timestamp || "");
        const tu = d.payload?.info?.total_token_usage || d.payload?.total_token_usage || d.total_token_usage;
        if (!tu) continue;
        if (Number.isFinite(ts)) lastTs = Math.max(lastTs, ts);
        if (!best || (tu.total_tokens || 0) > best.total) best = { in: tu.input_tokens || 0, out: tu.output_tokens || 0, total: tu.total_tokens || 0, ctx: (tu.input_tokens || 0) };
      }
      if (best) {
        const push = (w) => { w.in += best.in; w.out += best.out; if (!w.firstTs || lastTs < w.firstTs) w.firstTs = lastTs; };
        if (lastTs >= WEEK) push(week);
        if (lastTs >= SESSION) push(session);
        if (lastTs >= TODAY) push(today);
        if (lastTs > latest.ts) latest = { ts: lastTs, ctx: best.ctx, out: best.out, model: "codex" };
      }
    }
  }
  for (const w of [session, today, week]) { w.total = w.in + w.out + w.cache; w.cost = cost(w); }
  return { provider: "codex", label: "Codex", session, today, week, latest };
}

function fmtTok(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "k";
  return String(Math.round(n));
}
function bar(frac, w = 10) {
  const f = Math.max(0, Math.min(1, frac));
  const fill = Math.round(f * w);
  return "█".repeat(fill) + "░".repeat(w - fill);
}
function resetIn(firstTs, windowMs) {
  if (!firstTs) return "—";
  const ms = firstTs + windowMs - now;
  if (ms <= 0) return "reset";
  const min = Math.floor(ms / 60000), h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function ctxWindow(model) {
  if (/\[1m\]|1m\b|-1m/i.test(model)) return 1_000_000;
  if (/gpt|codex|o[0-9]/i.test(model)) return 128_000;
  return 200_000;
}
function budget(provider, win) {
  return Number(process.env[`USAGE_${provider.toUpperCase()}_${win}_BUDGET`] || 0);
}

const providers = [readClaude(), readCodex()];

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ now, providers }, null, 2));
  process.exit(0);
}

// ---- โหมด dashboard: พิมพ์บรรทัดสรุป ----
const out = [];
for (const p of providers) {
  if (p.session.total === 0 && p.today.total === 0) continue; // no usage in this window -> skip
  const bS = budget(p.provider, "SESSION");
  const billS = p.session.in + p.session.out;
  const sPct = bS > 0 ? Math.round((billS / bS) * 100) : null;
  const sBar = bS > 0 ? bar(billS / bS) + ` ${sPct}%` : "";
  out.push(`${p.label}  Session 5h  ${sBar}  ${fmtTok(p.session.total)} tok · $${p.session.cost.toFixed(2)} · resets in ${resetIn(p.session.firstTs, 5 * 3600e3)}`);
  out.push(`        Today       ${fmtTok(p.today.total)} tok · $${p.today.cost.toFixed(2)}   (in ${fmtTok(p.today.in)} · out ${fmtTok(p.today.out)} · cache ${fmtTok(p.today.cache)})`);
  if (p.latest.ts) {
    const win = ctxWindow(p.latest.model);
    const cpct = Math.round((p.latest.ctx / win) * 100);
    const model = (p.latest.model || "").replace(/^claude-/, "").replace(/-\d{8}$/, "") || p.provider;
    out.push(`        Ctx latest  ${fmtTok(p.latest.ctx)} / ${fmtTok(win)} (${cpct}%) · out ${fmtTok(p.latest.out)} · ${model}`);
  }
}
if (!out.length) out.push("no usage data yet (no ~/.claude or ~/.codex files found)");
console.log(out.join("\n"));
