// ===== Thunder — ชั้นความจำกลางของน้องวาน =====
// รวมข้อมูลจากทุกระบบไว้ที่เดียว (ตอนนี้ = เหตุการณ์มอนิเตอร์ใน BotActivity)
// ระบบใหม่ในอนาคตเขียนเข้ามาที่เดิม แล้วดึงออกมารายงานได้ผ่านที่นี่
import { db } from "@/lib/db";
import { embedText } from "@/lib/embeddings";

const TH = 7 * 3600_000; // offset UTC+7 (ms)

// ---------- ตัวช่วยเวลา (คิดเป็นเวลาไทยเสมอ) ----------
function startOfDayTH(ms: number): number {
  const d = new Date(ms + TH);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - TH;
}
function startOfWeekTH(ms: number): number {
  // สัปดาห์เริ่มวันจันทร์
  const sod = startOfDayTH(ms);
  const dow = new Date(sod + TH).getUTCDay(); // 0=อา..6=ส
  const fromMon = (dow + 6) % 7;
  return sod - fromMon * 86400_000;
}
function startOfMonthTH(ms: number): number {
  const d = new Date(ms + TH);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - TH;
}
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
function fmtDateTH(ms: number): string {
  const d = new Date(ms + TH);
  return `${d.getUTCDate()} ${TH_MONTHS[d.getUTCMonth()]} ${(d.getUTCFullYear() + 543) % 100}`;
}
function fmtDayKeyTH(ms: number): string {
  const d = new Date(ms + TH);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---------- วันธุรกิจ (business day) — เริ่ม 06:00 ถึง 06:00 วันถัดไป ----------
// ทีมทำงาน ~08:00 ถึงตี 2 → ยกให้เป็น "วันเดียวกัน" แล้วรายงานตอน 06:00 เช้าถัดไป
export const BIZ_START_HOUR = 6;
export function bizDateOf(ms: number = Date.now()): string {
  const shifted = new Date(ms + TH - BIZ_START_HOUR * 3600_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}
export function bizDateRange(bizDate: string): { startMs: number; endMs: number } {
  const [y, m, d] = bizDate.split("-").map(Number);
  const startUtc = Date.UTC(y, m - 1, d, BIZ_START_HOUR, 0, 0) - TH;
  return { startMs: startUtc, endMs: startUtc + 86400_000 };
}
export function bizDateLabel(bizDate: string): string {
  const { startMs } = bizDateRange(bizDate);
  return fmtDateTH(startMs);
}
// "เมื่อวาน" ของรายงาน = วันธุรกิจก่อนหน้าวันธุรกิจปัจจุบัน
export function prevBizDate(bizDate: string): string {
  const { startMs } = bizDateRange(bizDate);
  return bizDateOf(startMs - 12 * 3600_000);
}

// ---------- แปลงภาษาคน → ช่วงเวลา ----------
export interface RangeSpec {
  sinceMs: number;
  untilMs: number;
  label: string;
}
// แปลงวันที่ไทย 1 ตัว → epoch ms (ต้นวัน เวลาไทย). รองรับ:
//  "1/7", "1/7/69", "1/7/2569", "1 ก.ค.", "1 ก.ค. 69", เลขล้วน "1" (=เดือน/ปีปัจจุบัน)
function parseOneThaiDate(s: string, refMs: number): number | null {
  const ref = new Date(refMs + TH);
  const refY = ref.getUTCFullYear(), refM = ref.getUTCMonth();
  const mk = (y: number, m: number, d: number) => Date.UTC(y, m, d, 0, 0, 0) - TH;
  // 1/7 หรือ 1/7/69 หรือ 1-7-2569
  let m = s.match(/(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?/);
  if (m) {
    const d = +m[1], mo = +m[2] - 1;
    let y = m[3] ? +m[3] : refY + 543;
    y = y < 100 ? 2500 + y : y > 2400 ? y : y + 543; // → พ.ศ.
    if (mo >= 0 && mo <= 11 && d >= 1 && d <= 31) return mk(y - 543, mo, d);
  }
  // 1 ก.ค. หรือ 1 ก.ค. 69 (เดือนแบบย่อไทย)
  m = s.match(/(\d{1,2})\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(\d{2,4})?/);
  if (m) {
    const d = +m[1], mo = TH_MONTHS.indexOf(m[2]);
    let y = m[3] ? +m[3] : refY + 543;
    y = y < 100 ? 2500 + y : y > 2400 ? y : y + 543;
    if (mo >= 0 && d >= 1 && d <= 31) return mk(y - 543, mo, d);
  }
  // เลขล้วน "1" = วันที่ในเดือน/ปีปัจจุบัน
  m = s.match(/^\s*(\d{1,2})\s*$/);
  if (m) { const d = +m[1]; if (d >= 1 && d <= 31) return mk(refY, refM, d); }
  return null;
}

export function parseThaiRange(text: string, nowMs: number = Date.now()): RangeSpec {
  const t = text.toLowerCase();
  const todayStart = startOfDayTH(nowMs);

  // ระบุช่วงเอง: "X ถึง Y" / "X - Y" / "ตั้งแต่ X ถึง Y" (ตรวจก่อนคำอื่น)
  const rangeM = t.match(/(?:ตั้งแต่\s*)?([\d]{1,2}(?:[/.\-]\d{1,2}(?:[/.\-]\d{2,4})?)?(?:\s*(?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)(?:\s*\d{2,4})?)?)\s*(?:ถึง|จนถึง|-|–|ถึงวันที่)\s*([\d]{1,2}(?:[/.\-]\d{1,2}(?:[/.\-]\d{2,4})?)?(?:\s*(?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)(?:\s*\d{2,4})?)?)/);
  if (rangeM) {
    const a = parseOneThaiDate(rangeM[1], nowMs);
    let b = parseOneThaiDate(rangeM[2], nowMs);
    if (a != null && b != null) {
      // ถ้าปลายทางไม่ระบุเดือน (เลขล้วน) แต่ต้นทางระบุ → ใช้เดือน/ปีของต้นทาง
      if (/^\s*\d{1,2}\s*$/.test(rangeM[2]) && /[/.\-ก-๙]/.test(rangeM[1])) {
        const da = new Date(a + TH), db = new Date(b + TH);
        b = Date.UTC(da.getUTCFullYear(), da.getUTCMonth(), db.getUTCDate(), 0, 0, 0) - TH;
      }
      const since = Math.min(a, b);
      const until = Math.max(a, b) + 86400_000; // รวมวันสุดท้ายทั้งวัน
      return { sinceMs: since, untilMs: until, label: `${fmtDateTH(since)} – ${fmtDateTH(Math.max(a, b))}` };
    }
  }

  if (/เมื่อวาน|เมื่อวานนี้|yesterday/.test(t))
    return { sinceMs: todayStart - 86400_000, untilMs: todayStart, label: "เมื่อวาน" };
  if (/วันนี้|today/.test(t))
    return { sinceMs: todayStart, untilMs: nowMs, label: "วันนี้" };
  if (/สัปดาห์ที่แล้ว|อาทิตย์ที่แล้ว|สัปดาห์ก่อน|อาทิตย์ก่อน|last week/.test(t)) {
    const thisWeek = startOfWeekTH(nowMs);
    return { sinceMs: thisWeek - 7 * 86400_000, untilMs: thisWeek, label: "สัปดาห์ที่แล้ว" };
  }
  if (/สัปดาห์นี้|อาทิตย์นี้|this week/.test(t))
    return { sinceMs: startOfWeekTH(nowMs), untilMs: nowMs, label: "สัปดาห์นี้" };
  if (/เดือนที่แล้ว|เดือนก่อน|last month/.test(t)) {
    const thisMonth = startOfMonthTH(nowMs);
    const prev = startOfMonthTH(thisMonth - 86400_000);
    return { sinceMs: prev, untilMs: thisMonth, label: "เดือนที่แล้ว" };
  }
  if (/เดือนนี้|this month/.test(t))
    return { sinceMs: startOfMonthTH(nowMs), untilMs: nowMs, label: "เดือนนี้" };
  const nDays = t.match(/(\d+)\s*วัน/);
  if (nDays) {
    const n = Math.min(90, Math.max(1, Number(nDays[1])));
    return { sinceMs: nowMs - n * 86400_000, untilMs: nowMs, label: `${n} วันล่าสุด` };
  }
  // วันที่เดี่ยว "23 ก.ค." หรือ "23/7" → วันนั้นทั้งวัน
  const oneM = t.match(/(\d{1,2}\s*(?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)(?:\s*\d{2,4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/);
  if (oneM) {
    const d = parseOneThaiDate(oneM[1], nowMs);
    if (d != null) return { sinceMs: d, untilMs: d + 86400_000, label: fmtDateTH(d) };
  }
  // ค่าเริ่มต้น = 7 วันล่าสุด
  return { sinceMs: nowMs - 7 * 86400_000, untilMs: nowMs, label: "7 วันล่าสุด" };
}

// ---------- นิยามเหตุการณ์มอนิเตอร์ ----------
const METRICS = {
  waiting: { kinds: ["waiting-alert"], emoji: "🟠", label: "แชทค้าง (ยังไม่มีคนรับ)" },
  forgot: { kinds: ["close-remind"], emoji: "🟡", label: "ลืมปิดแชท" },
  dropped: { kinds: ["session-expired"], emoji: "🔴", label: "ระบบเฝ้าหลุด (session)" },
  handled: { kinds: ["watch-close"], emoji: "🟢", label: "รับเคส/กำลังดูแล" },
} as const;
type MetricKey = keyof typeof METRICS;
const ALL_KINDS = Object.values(METRICS).flatMap((m) => m.kinds as readonly string[]);
function metricOf(kind: string): MetricKey | null {
  for (const k of Object.keys(METRICS) as MetricKey[]) if ((METRICS[k].kinds as readonly string[]).includes(kind)) return k;
  return null;
}

export interface MonitorReport {
  title: string;
  short: string; // ข้อความย่อสำหรับส่งใน Telegram
  markdown: string; // รายงานเต็ม (ไฟล์ .md)
  count: number; // จำนวน event ในช่วง
  big: boolean; // ควรส่งเป็นไฟล์ไหม
}

// ---------- สร้างรายงานมอนิเตอร์ ----------
export async function buildMonitorReport(range: RangeSpec): Promise<MonitorReport> {
  const rows = await db.botActivity.findMany({
    where: { kind: { in: ALL_KINDS }, createdAt: { gte: new Date(range.sinceMs), lt: new Date(range.untilMs) } },
    orderBy: { createdAt: "asc" },
    take: 20000,
  });

  const total: Record<MetricKey, number> = { waiting: 0, forgot: 0, dropped: 0, handled: 0 };
  const byBrand: Record<string, Record<MetricKey, number>> = {};
  const byPlatform: Record<string, Record<MetricKey, number>> = {};
  const forgotByAdmin: Record<string, number> = {};
  const byDay: Record<string, Record<MetricKey, number>> = {};
  let maxWait = { sec: 0, customer: "", brand: "", admin: "" };

  const blank = (): Record<MetricKey, number> => ({ waiting: 0, forgot: 0, dropped: 0, handled: 0 });

  for (const r of rows) {
    const m = metricOf(r.kind);
    if (!m) continue;
    total[m]++;
    const brand = (r.channel || r.company || "ไม่ระบุ").trim();
    const plat = (r.platform || "-").trim();
    (byBrand[brand] ||= blank())[m]++;
    (byPlatform[plat] ||= blank())[m]++;
    const dayKey = fmtDayKeyTH(r.createdAt.getTime());
    (byDay[dayKey] ||= blank())[m]++;
    if (m === "forgot" && r.admin) forgotByAdmin[r.admin] = (forgotByAdmin[r.admin] || 0) + 1;
    if (m === "waiting" && (r.waitSec || 0) > maxWait.sec) {
      maxWait = { sec: r.waitSec || 0, customer: r.customer || "-", brand, admin: r.admin || "-" };
    }
  }

  const count = rows.length;
  const period = `${fmtDateTH(range.sinceMs)} – ${fmtDateTH(range.untilMs - 1)}`;
  const title = `รายงานมอนิเตอร์ · ${range.label}`;

  // ----- ข้อความย่อ (inline) -----
  const shortLines = [
    `📊 <b>${title}</b>`,
    `ช่วง ${period}`,
    "",
    `${METRICS.dropped.emoji} ระบบเฝ้าหลุด: <b>${total.dropped}</b> ครั้ง`,
    `${METRICS.waiting.emoji} แชทค้างไม่มีคนรับ: <b>${total.waiting}</b> ครั้ง`,
    `${METRICS.forgot.emoji} ลืมปิดแชท: <b>${total.forgot}</b> ครั้ง`,
    `${METRICS.handled.emoji} รับเคส/ดูแล: <b>${total.handled}</b> ครั้ง`,
  ];
  // แบรนด์ที่มีปัญหา (ค้าง+ลืมปิด) มากสุด 3 อันดับ
  const brandRank = Object.entries(byBrand)
    .map(([b, v]) => [b, v.waiting + v.forgot] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (brandRank.length) {
    shortLines.push("", "แบรนด์ที่ต้องดูแล (ค้าง+ลืมปิด):");
    for (const [b, n] of brandRank) shortLines.push(`• ${b}: ${n} ครั้ง`);
  }
  const forgotRank = Object.entries(forgotByAdmin).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (forgotRank.length) {
    shortLines.push("", "ลืมปิดแชทบ่อยสุด:");
    for (const [a, n] of forgotRank) shortLines.push(`• ${a}: ${n} ครั้ง`);
  }

  // ----- Markdown เต็ม -----
  const md: string[] = [];
  md.push(`# ${title}`);
  md.push(`ช่วงเวลา: **${period}**  ·  รวม ${count.toLocaleString()} เหตุการณ์`);
  md.push("");
  md.push("## สรุปรวม");
  md.push("| เหตุการณ์ | จำนวน |");
  md.push("|---|---|");
  md.push(`| ${METRICS.dropped.emoji} ระบบเฝ้าหลุด (session) | ${total.dropped} |`);
  md.push(`| ${METRICS.waiting.emoji} แชทค้างไม่มีคนรับ | ${total.waiting} |`);
  md.push(`| ${METRICS.forgot.emoji} ลืมปิดแชท | ${total.forgot} |`);
  md.push(`| ${METRICS.handled.emoji} รับเคส/กำลังดูแล | ${total.handled} |`);
  md.push("");

  const brandRows = Object.entries(byBrand).sort((a, b) => b[1].waiting + b[1].forgot - (a[1].waiting + a[1].forgot));
  if (brandRows.length) {
    md.push("## แยกตามแบรนด์");
    md.push("| แบรนด์ | ค้าง | ลืมปิด | หลุด | ดูแล |");
    md.push("|---|---|---|---|---|");
    for (const [b, v] of brandRows) md.push(`| ${b} | ${v.waiting} | ${v.forgot} | ${v.dropped} | ${v.handled} |`);
    md.push("");
  }
  const platRows = Object.entries(byPlatform).sort((a, b) => b[1].waiting + b[1].forgot - (a[1].waiting + a[1].forgot));
  if (platRows.length) {
    md.push("## แยกตามแพลตฟอร์ม");
    md.push("| แพลตฟอร์ม | ค้าง | ลืมปิด | หลุด | ดูแล |");
    md.push("|---|---|---|---|---|");
    for (const [p, v] of platRows) md.push(`| ${p} | ${v.waiting} | ${v.forgot} | ${v.dropped} | ${v.handled} |`);
    md.push("");
  }
  const forgotRows = Object.entries(forgotByAdmin).sort((a, b) => b[1] - a[1]);
  if (forgotRows.length) {
    md.push("## ลืมปิดแชทบ่อยสุด (รายแอดมิน)");
    md.push("| แอดมิน | ครั้ง |");
    md.push("|---|---|");
    for (const [a, n] of forgotRows) md.push(`| ${a} | ${n} |`);
    md.push("");
  }
  const dayRows = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]));
  if (dayRows.length) {
    md.push("## รายวัน");
    md.push("| วันที่ | ค้าง | ลืมปิด | หลุด | ดูแล |");
    md.push("|---|---|---|---|---|");
    for (const [d, v] of dayRows) md.push(`| ${d} | ${v.waiting} | ${v.forgot} | ${v.dropped} | ${v.handled} |`);
    md.push("");
  }
  if (maxWait.sec > 0) {
    md.push("## แชทค้างนานสุด");
    md.push(`- ${maxWait.customer} (${maxWait.brand}) ค้าง ${Math.round(maxWait.sec / 60)} นาที`);
    md.push("");
  }
  md.push("---");
  md.push(`_สร้างโดย Thunder · น้องวาน · ${fmtDateTH(Date.now())}_`);

  const markdown = md.join("\n");
  const big = count > 40 || markdown.length > 1600;

  return { title, short: shortLines.join("\n"), markdown, count, big };
}

// ===== คลังความรู้ (semantic) — สอน/ค้น/ตอบ =====

// สอนคำถาม-คำตอบใหม่เข้าคลัง แล้ว embed ลง sqlite-vec
export async function teachKnowledge(
  question: string,
  answer: string,
  opts: { scope?: string; source?: string; tags?: string } = {}
): Promise<{ id: string; embedded: boolean }> {
  const row = await db.thunderKnowledge.create({
    data: { question: question.trim(), answer: answer.trim(), scope: opts.scope || "general", source: opts.source || null, tags: opts.tags || null },
  });
  let embedded = false;
  const vec = await embedText(`${question}\n${answer}`);
  if (vec) {
    const { upsertKnowledgeVector } = await import("@/lib/vector");
    embedded = upsertKnowledgeVector(row.id, vec);
  }
  return { id: row.id, embedded };
}

export interface KnowledgeAnswer {
  id: string;
  question: string;
  answer: string;
  scope: string;
  status: string;
  distance: number;
  confident: boolean; // ใกล้พอที่จะตอบเองไหม
}

// ค้นคลังด้วยความหมาย แล้วคืนคำตอบที่ใกล้สุด (distance = cosine 0..2, ยิ่งน้อยยิ่งใกล้)
// เวกเตอร์อยู่คนละ DB → ค้น id ก่อน แล้ว join เนื้อหาผ่าน Prisma
export async function thunderAnswer(query: string, k = 3, opts: { includeCandidate?: boolean } = {}): Promise<KnowledgeAnswer[]> {
  const vec = await embedText(query);
  if (!vec) return [];
  const { searchVectors } = await import("@/lib/vector");
  const hits = searchVectors(vec, k);
  if (!hits.length) return [];
  const rows = await db.thunderKnowledge.findMany({ where: { id: { in: hits.map((h) => h.id) } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return hits
    .map((h) => {
      const r = byId.get(h.id);
      if (!r) return null;
      if (!opts.includeCandidate && r.status !== "active") return null;
      return { id: r.id, question: r.question, answer: r.answer, scope: r.scope, status: r.status, distance: h.distance, confident: h.distance < 0.4 };
    })
    .filter((x): x is KnowledgeAnswer => x !== null);
}

// เก็บ "คำถาม/ปัญหาใหม่" จากแชท — ถ้าเคยมีเรื่องคล้ายกันแล้วให้นับซ้ำแทน (ไม่เก็บซ้ำ)
// คืน "new" = เรื่องใหม่จริง | "dup" = เคยมีแล้ว (นับ askCount เพิ่ม) | "skip" = embed ไม่ได้
// คำถามกว้างเกินจนไร้ประโยชน์ (แมตช์กับทุกเรื่อง) — ห้ามเก็บเข้าคลัง
const VAGUE_Q = /^(ลูกค้า)?(ต้องการ|อยาก|ขอ|สอบถาม|ถาม)?\s*(แก้ไข|แก้)?\s*(ปัญหา|เรื่อง|ข้อมูล|ความช่วยเหลือ|บริการ)(ที่เกิดขึ้น|ต่างๆ|ทั่วไป)?\s*$/;
// คำตอบที่เป็นแค่คำทักทาย/ขอบคุณ/ขอโทษ — ไม่ใช่คำตอบจริง
const FILLER_A = /^(ขอบคุณ|ขออภัย|ต้องขออภัย|สวัสดี|ยินดี|รับทราบ|ได้เลย|สักครู่|รอสักครู่|โอเค)/;

export async function captureFaqCandidate(
  question: string,
  answer: string,
  opts: { scope?: string; source?: string; dupDistance?: number } = {}
): Promise<{ result: "new" | "dup" | "skip"; id?: string }> {
  const q = question.trim();
  const a = answer.trim();
  // คัดคุณภาพก่อนเก็บ — คลังต้องมีแต่ของใช้ได้จริง ไม่งั้นไปกวนการค้นทั้งระบบ
  if (q.length < 8 || VAGUE_Q.test(q)) return { result: "skip" };
  if (a.length < 15 || (FILLER_A.test(a) && a.length < 40)) return { result: "skip" };
  const vec = await embedText(q);
  if (!vec) return { result: "skip" };
  const { searchVectors, upsertKnowledgeVector } = await import("@/lib/vector");
  const near = searchVectors(vec, 1);
  const limit = opts.dupDistance ?? 0.25; // ใกล้กว่านี้ = ถือว่าเรื่องเดิม
  if (near.length && near[0].distance < limit) {
    const exist = await db.thunderKnowledge.findUnique({ where: { id: near[0].id } });
    if (exist) {
      await db.thunderKnowledge.update({
        where: { id: exist.id },
        data: { askCount: { increment: 1 }, lastAskedAt: new Date() },
      });
      return { result: "dup", id: exist.id };
    }
  }
  const row = await db.thunderKnowledge.create({
    data: {
      question: q, answer: a.slice(0, 2000),
      scope: opts.scope || "general", source: opts.source || "อ่านจากแชท",
      status: "candidate", askCount: 1, lastAskedAt: new Date(),
    },
  });
  upsertKnowledgeVector(row.id, vec);
  return { result: "new", id: row.id };
}

// ===== ฉีดความจำ Thunder เข้าบริบท AI — ให้ถามอะไรก็ตอบได้จากข้อมูลจริง =====
// เลือกเฉพาะส่วนที่เกี่ยวกับคำถาม (ไม่ยัดทั้งหมด) เพื่อไม่ให้ prompt บวม
export async function getThunderContext(question: string): Promise<string | null> {
  const t = (question || "").trim();
  if (t.length < 3) return null;
  const parts: string[] = [];

  // 1) คลังความรู้ที่ใกล้เคียงคำถาม (รวม candidate ที่เก็บจากแชทจริง)
  try {
    const hits = await thunderAnswer(t, 3, { includeCandidate: true });
    const useful = hits.filter((h) => h.distance < 0.35); // แคบพอที่เรื่องไม่เกี่ยวจะไม่ถูกดึงมา
    if (useful.length) {
      parts.push(
        "[คลังความรู้ Thunder — คำถามที่เคยเจอและแนวคำตอบจริงจากแชท]\n" +
          useful
            .map((h) => `• (${h.scope}${h.status === "candidate" ? " · ยังไม่ยืนยัน" : ""}) ถาม: ${h.question}\n  ตอบ: ${h.answer}`)
            .join("\n"),
      );
    }
  } catch { /* ไม่มีก็ข้าม */ }

  // 2) ลูกค้าที่ถูกเอ่ยชื่อในคำถาม
  try {
    const custs = await db.customer.findMany({ select: { id: true, name: true, company: true }, take: 500 });
    const hit = custs.find((c) => c.name && c.name.length >= 3 && t.includes(c.name));
    if (hit) {
      const facts = await db.customerFact.findMany({ where: { customerId: hit.id }, take: 12 });
      if (facts.length) {
        parts.push(
          `[ความจำลูกค้า: ${hit.name}${hit.company ? ` · ${hit.company}` : ""}]\n` +
            facts.map((f) => `• ${f.key}: ${f.value}`).join("\n"),
        );
      }
    }
  } catch { /* ข้าม */ }

  // 3) รายงานแชทล่าสุด (ถ้าถามเรื่องแชท/ลูกค้า/รายงาน/สรุป)
  if (/แชท|ลูกค้า|รายงาน|สรุป|แอดมิน|ต่ออายุ|ติดตั้ง|ปัญหา|เคส/.test(t)) {
    try {
      const rep = await db.dailyReport.findFirst({ orderBy: { bizDate: "desc" } });
      if (rep) parts.push(`[รายงานแชทล่าสุด ${rep.bizDate} · ${rep.chatCount} เคส]\n${rep.shortText.replace(/<[^>]+>/g, "")}`);
    } catch { /* ข้าม */ }
  }

  // 4) สถิติมอนิเตอร์ 7 วัน (ถ้าถามเรื่องค้าง/ลืมปิด/หลุด/มอนิเตอร์)
  if (/ค้าง|ลืมปิด|หลุด|มอนิเตอร์|monitor|เฝ้า/.test(t)) {
    try {
      const rep = await buildMonitorReport(parseThaiRange("7 วัน"));
      parts.push(`[สถิติมอนิเตอร์ 7 วันล่าสุด]\n${rep.short.replace(/<[^>]+>/g, "")}`);
    } catch { /* ข้าม */ }
  }

  if (!parts.length) return null;
  return (
    "===== ความจำ Thunder (ข้อมูลจริงจากระบบ ใช้ตอบได้เลย ห้ามเดาเกินจากนี้) =====\n" +
    parts.join("\n\n") +
    "\n===== จบความจำ ====="
  );
}

// ค้นลูกค้าจากชื่อ (+ facts) — ตอบ "ลูกค้าคนนี้เป็นใคร คุยแนวไหน"
export async function customerLookup(name: string): Promise<string | null> {
  const q = name.trim();
  if (q.length < 2) return null;
  const custs = await db.customer.findMany({
    where: { OR: [{ name: { contains: q } }, { identities: { some: { handle: { contains: q } } } }] },
    include: { facts: true },
    take: 3,
    orderBy: { lastSeenAt: "desc" },
  });
  if (!custs.length) return null;
  const lines: string[] = [];
  for (const c of custs) {
    lines.push(`👤 <b>${c.name}</b>${c.company ? ` · ${c.company}` : ""}`);
    for (const f of c.facts) lines.push(`   • ${f.key}: ${f.value}`);
    if (c.lastSeenAt) lines.push(`   • คุยล่าสุด: ${fmtDateTH(c.lastSeenAt.getTime())}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}
