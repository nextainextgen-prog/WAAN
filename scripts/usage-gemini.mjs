#!/usr/bin/env node
/**
 * อ่านยอดโทเค็น Gemini ที่ src/lib/gemini-usage.ts จดไว้ — ใช้โดย scripts/status.mjs
 *
 *   import { collectGemini } from "./usage-gemini.mjs"   → object ดิบ
 *   node scripts/usage-gemini.mjs                        → บรรทัดสรุปสำหรับ dashboard
 *   node scripts/usage-gemini.mjs --json                 → JSON ดิบ
 *
 * เรื่องค่าเงิน: ตั้งเรตเองใน .env ถ้าไม่ตั้ง จะโชว์แค่โทเค็นกับจำนวนครั้ง (ซึ่งเป็นค่าที่วัดมาจริง)
 * ไม่เดาราคาให้ เพราะราคาเปลี่ยนบ่อยและต่างกันตามรุ่น — ดูราคาจริงที่
 * https://ai.google.dev/gemini-api/docs/pricing แล้วใส่:
 *   GEMINI_RATE_IN=...      # ดอลลาร์ต่อ 1 ล้าน input token
 *   GEMINI_RATE_OUT=...     # ดอลลาร์ต่อ 1 ล้าน output token
 *   USD_THB=36              # อัตราแลกเปลี่ยน (ไม่ใส่ = โชว์เป็นดอลลาร์)
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const TZ = 7 * 3600_000;

const ENV = {};
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) ENV[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

const RATE_IN = Number(ENV.GEMINI_RATE_IN || 0);
const RATE_OUT = Number(ENV.GEMINI_RATE_OUT || 0);
const USD_THB = Number(ENV.USD_THB || 0);
const HAS_RATE = RATE_IN > 0 || RATE_OUT > 0;

const dayKey = (offset = 0) => new Date(Date.now() + TZ - offset * 86400_000).toISOString().slice(0, 10);
const monthKey = () => dayKey().slice(0, 7);

export function fmtTok(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "k";
  return String(n);
}
const money = (usd) => (USD_THB > 0 ? `฿${(usd * USD_THB).toFixed(2)}` : `$${usd.toFixed(2)}`);
const costOf = (b) => (b.in / 1e6) * RATE_IN + (b.out / 1e6) * RATE_OUT;

/**
 * ชื่อรุ่นแบบสั้น ให้พออ่านในกล่องแคบ ๆ
 * ตัดแค่ "gemini-" / "-preview" / วันที่ท้ายชื่อ — ห้ามตัดท้ายทั้งดุ้น
 * ไม่งั้น gemini-2.5-flash กับ gemini-2.5-flash-preview-tts จะเหลือชื่อเดียวกันจนแยกไม่ออก
 */
const shortModel = (m) =>
  m.replace(/^gemini-/, "").replace(/-preview/g, "").replace(/-\d{2}-\d{2}$/, "").replace(/-latest$/, "");

export function collectGemini() {
  let db;
  try {
    db = new Database(path.join(ROOT, "prisma", "changoh.db"), { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
  let store = {};
  try {
    const r = db.prepare("SELECT value FROM Setting WHERE key='gemini_usage'").get();
    if (r?.value) store = JSON.parse(r.value);
  } catch {}
  db.close();

  const sum = (days) => {
    const acc = { calls: 0, in: 0, out: 0, total: 0, errors: 0, models: {}, tags: {}, lastAt: 0 };
    for (const d of days) {
      const b = store[d];
      if (!b) continue;
      acc.errors += b.errors || 0;
      acc.lastAt = Math.max(acc.lastAt, b.lastAt || 0);
      for (const [k, v] of Object.entries(b.models || {})) {
        const m = (acc.models[k] ||= { calls: 0, in: 0, out: 0, total: 0 });
        m.calls += v.calls; m.in += v.in; m.out += v.out; m.total += v.total;
        acc.calls += v.calls; acc.in += v.in; acc.out += v.out; acc.total += v.total;
      }
      for (const [k, v] of Object.entries(b.tags || {})) {
        const t = (acc.tags[k] ||= { calls: 0, total: 0 });
        t.calls += v.calls; t.total += v.total;
      }
    }
    return acc;
  };

  const all = Object.keys(store).sort();
  const t = sum([dayKey()]);
  const m = sum(all.filter((d) => d.startsWith(monthKey())));
  return { today: t, month: m, hasData: all.length > 0, hasRate: HAS_RATE };
}

/** บรรทัดสรุปสำหรับกล่อง AI USAGE — คืน array ของ string (ไม่มีสี) */
export function geminiLines(g) {
  if (!g) return [];
  if (!g.hasData) return ["Gemini  ยังไม่มีข้อมูล — ต้องต่อ geminiFetch() ที่จุดเรียกก่อน (ดู docs/gemini-usage-handoff.md)"];

  const t = g.today, m = g.month;
  const out = [];

  const costToday = g.hasRate ? ` · ${money(costOf(t))}` : "";
  const models = Object.entries(t.models)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 3)
    .map(([k, v]) => `${shortModel(k)} ${fmtTok(v.total)}`)
    .join(" · ");
  out.push(`Gemini  Today       ${fmtTok(t.total)} tok${costToday}   (in ${fmtTok(t.in)} · out ${fmtTok(t.out)})`);
  if (models) out.push(`        รุ่น         ${models}`);

  const tags = Object.entries(t.tags)
    .sort((a, b) => b[1].calls - a[1].calls)
    .slice(0, 4)
    .map(([k, v]) => `${k} ${v.calls}`)
    .join(" · ");
  out.push(`        เรียก        ${t.calls} ครั้ง${tags ? ` (${tags})` : ""}${t.errors ? ` · พลาด ${t.errors}` : ""}`);

  const costMonth = g.hasRate ? ` · ${money(costOf(m))}` : " · ยังไม่ได้ตั้งเรตราคา (GEMINI_RATE_IN/OUT)";
  out.push(`        เดือนนี้      ${fmtTok(m.total)} tok · ${m.calls} ครั้ง${costMonth}`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const g = collectGemini();
  if (process.argv.includes("--json")) { console.log(JSON.stringify(g, null, 2)); process.exit(0); }
  const lines = geminiLines(g);
  console.log(lines.length ? lines.join("\n") : "อ่านฐานข้อมูลไม่ได้");
}
