import * as XLSX from "xlsx";
import { exportDriveSheet } from "./google";

/**
 * สถานะการนำส่งใบกำกับภาษี — อ่านจาก Google Sheet ตัวจริง (live ไม่ใช่สแนปช็อต)
 *
 * ทำไมอ่านสด: สแนปช็อตใน Obsidian เก็บได้แค่ ~60 แถวแรกต่อแท็บ จาก 3,000+ แถว และไม่มีอะไรซิงก์ให้
 * แอดมินถามชื่อบริษัทที่เพิ่งเพิ่มเมื่อวาน วานต้องเห็นทันที → ยิงชีตตรงทุกครั้ง (แคช 5 นาทีกัน rate-limit)
 *
 * ชีตนี้มี 4 แท็บ หัวตารางไม่เหมือนกันสักแท็บ:
 *  - Easy ส่งใบกำกับ / Easy ลิ้งข้อมูล      : ไม่มีคอลัมน์ยูสเซอร์
 *  - Thunder ส่งใบกำกับ / Thunder ลิงค์ข้อมูล : มี User/ยูสเซอร์ + ชื่อแชทลูกค้า · คอลัมน์ " บริษัท" มีเว้นวรรคนำหน้า
 *  - "ลิงค์ข้อมูล" = เอกสารหัก ณ ที่จ่าย (WT) ไม่ใช่ใบกำกับ (INV) — ค้นเจอก็ต้องบอกให้ชัดว่าคนละชนิด
 *
 * กับดักข้อมูลจริงในชีต (เจอมาแล้วทุกอัน อย่าไปสมมติว่าสะอาด):
 *  - วันที่มาได้ 3 แบบ: Excel serial (46216) · "13/07/2026" · พ.ศ. ปนมา ("29/10/2568")
 *  - ช่องเดียวใส่หลายวันที่: "15/12/2024\n15/01/2025\n16/02/2025" (ออกเอกสารหลายรอบในแถวเดียว)
 *  - ช่องนำส่งใส่ 2 วัน = ปณ. กับ อีเมล: "09/04/2026  /  23/04/2026" คู่กับช่องทาง "ไปรษณีย์, email"
 *  - ลิงค์ไฟล์แสกนบางแถวเป็น URL บางแถวเป็นแค่ชื่อไฟล์ .pdf
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

export type DocKind = "invoice" | "withholding"; // ใบกำกับภาษี (INV) | หัก ณ ที่จ่าย (WT)
export type Brand = "Easy" | "Thunder";

export interface TaxRow {
  brand: Brand;
  kind: DocKind;
  tab: string;
  sources: string[]; // แถวนี้โผล่ในแท็บไหนบ้าง (แท็บ "ลิงค์ข้อมูล" มิเรอร์ของแท็บ "ส่งใบกำกับ" ~90%)
  rowNumber: number; // เลขแถวในชีตจริง (ไว้ให้แอดมินเปิดไปดูเอง)
  notified: string; // "แจ้งแล้ว" | ""
  chatName: string; // ชื่อแชทลูกค้า (Thunder)
  username: string; // User / ยูสเซอร์ (Thunder)
  company: string;
  docNumbers: string[]; // เลขที่เอกสาร (แถวเดียวมีได้หลายใบ)
  issued: TaxDate[]; // วันที่ออกเอกสาร
  delivered: TaxDate[]; // วันที่นำส่ง (ปณ. / อีเมล)
  channel: string; // ไปรษณีย์ | email | ไปรษณีย์, email
  tracking: string;
  scanLink: string; // URL หรือชื่อไฟล์
  note: string;
}

export interface TaxDate {
  text: string; // แบบที่โชว์ให้คน: 13/07/2026
  time: number; // ไว้เรียงลำดับ (epoch ms) — 0 = แปลงไม่ได้
  raw: string; // ค่าดิบในชีต เผื่อค่าแปลก ๆ ต้องอ้างอิง
  wasBuddhist?: boolean; // แปลง พ.ศ. → ค.ศ. ให้แล้ว (ต้องบอกแอดมินว่าตีความให้)
  unparsed?: boolean; // อ่านไม่ออกจริง ๆ — ห้ามเดา ให้โชว์ค่าดิบ
}

// ===== วันที่ =====
const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

/**
 * กรอบปีที่ยอมรับว่าเป็นวันจริง — นอกกรอบ = พิมพ์ผิด (เจอมาแล้ว: 1968, 2202, 0042, 2055)
 * เพดานคือ "ปีนี้ + 2" เพราะเอกสารล่วงหน้าเกินสองปีไม่มีจริง แต่ "29/11/2055" (พิมพ์ 2025 เกิน)
 * มีจริงในชีต ถ้าปล่อยผ่านมันจะกลายเป็น "ใบล่าสุด" ตลอดกาลแล้วกลบใบจริงมิด
 * ไม่แก้ตัวเลขให้เองนะ — แค่ไม่ให้มันชนะการเรียงลำดับ แล้วติดธงบอกแอดมินว่าอ่านไม่ออก
 */
const YEAR_MIN = 2015;
const yearMax = () => new Date().getFullYear() + 2;

/**
 * แปลงปีให้เป็น ค.ศ. ที่เชื่อถือได้ — คืน null ถ้าเป็นค่าที่เป็นไปไม่ได้
 * พ.ศ. ปนมาเยอะจริง (2568/2569 รวม ~98 แถว) ทั้งแบบพิมพ์เองและแบบ Sheets มองเป็นวันที่ปี 2568 ไปแล้ว
 */
function normalizeYear(y: number): { year: number; wasBuddhist: boolean } | null {
  const wasBuddhist = y > 2500;
  const year = wasBuddhist ? y - 543 : y;
  if (year < YEAR_MIN || year > yearMax()) return null;
  return { year, wasBuddhist };
}

function fromSerial(v: number): TaxDate | null {
  const p = XLSX.SSF.parse_date_code(v);
  if (!p || !p.y) return null;
  // Sheets เก็บ "29/10/2568" เป็น serial ของปี 2568 จริง ๆ — ต้องดึงกลับเป็น 2025 ไม่งั้นแถวนี้
  // จะกลายเป็น "ใบล่าสุด" ตลอดกาลเวลาเรียงลำดับ
  // raw = วันที่แบบที่คนกรอกเห็นในชีต ไม่ใช่ตัวเลข serial (บอกแอดมินว่า "244286" ไม่มีใครเข้าใจ)
  const raw = `${pad(p.d)}/${pad(p.m)}/${p.y}`;
  const n = normalizeYear(p.y);
  if (!n) return { text: raw, time: 0, raw, unparsed: true };
  const d = new Date(n.year, p.m - 1, p.d);
  return { text: fmt(d), time: d.getTime(), raw, ...(n.wasBuddhist ? { wasBuddhist: true } : {}) };
}

/**
 * ดึงวันที่ทุกตัวจากค่าในเซลล์ — รองรับหลายวันในช่องเดียว (คั่นด้วยขึ้นบรรทัด หรือ " / ")
 * ใช้ regex จับ dd/mm/yyyy ทั้งหมด แทนการ split ด้วย "/" (เพราะตัววันที่เองก็มี "/" อยู่แล้ว)
 */
export function parseTaxDates(v: unknown): TaxDate[] {
  return uniqueDates(parseTaxDatesRaw(v));
}

// วันเดียวกันกรอกซ้ำในช่องเดียว (มิเรอร์คนละแท็บทำให้เจอบ่อย) — โชว์ "29/10 · 29/10" ให้แอดมินไม่มีประโยชน์
function uniqueDates(ds: TaxDate[]): TaxDate[] {
  const seen = new Set<string>();
  return ds.filter((d) => (seen.has(d.text) ? false : (seen.add(d.text), true)));
}

function parseTaxDatesRaw(v: unknown): TaxDate[] {
  if (v == null || v === "") return [];
  if (typeof v === "number") {
    const d = fromSerial(v);
    return d ? [d] : [{ text: String(v), time: 0, raw: String(v), unparsed: true }];
  }
  const s = String(v).trim();
  if (!s) return [];
  const hits = [...s.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g)];
  if (!hits.length) return [{ text: s.replace(/\s+/g, " "), time: 0, raw: s, unparsed: true }];

  return hits.map((m) => {
    const day = Number(m[1]);
    const mon = Number(m[2]);
    const n = normalizeYear(Number(m[3]));
    if (!n) return { text: m[0], time: 0, raw: m[0], unparsed: true };
    const d = new Date(n.year, mon - 1, day);
    const valid = d.getDate() === day && d.getMonth() === mon - 1 && d.getFullYear() === n.year;
    return valid
      ? { text: fmt(d), time: d.getTime(), raw: m[0], ...(n.wasBuddhist ? { wasBuddhist: true } : {}) }
      : { text: m[0], time: 0, raw: m[0], unparsed: true };
  });
}

const latestTime = (ds: TaxDate[]) => ds.reduce((mx, d) => Math.max(mx, d.time), 0);
const dateList = (ds: TaxDate[]) => ds.map((d) => d.text).join(" · ");

// ===== อ่านชีต =====
function matchCol(headers: string[], ...groups: string[][]): number {
  for (const g of groups) {
    const i = headers.findIndex((h) => g.every((n) => h.includes(n)));
    if (i >= 0) return i;
  }
  return -1;
}

const clean = (v: unknown) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());

const brandOf = (tab: string): Brand => (/thunder/i.test(tab) ? "Thunder" : "Easy");

/**
 * ชนิดเอกสารดูจาก "เลขที่เอกสาร" ไม่ใช่ชื่อแท็บ
 * เพราะแท็บ "ลิงค์ข้อมูล" ที่นึกว่าเป็น WT ล้วน จริง ๆ มี INV อยู่ 876 จาก 1,014 แถว
 * (แท็บนั้นเป็นมุมมองรวม ไม่ใช่เอกสารคนละชนิด) — ยึดชื่อแท็บเมื่อไหร่ก็ตอบผิดเมื่อนั้น
 */
function kindOf(docNumbers: string[]): DocKind {
  return docNumbers.some((d) => /^WT/i.test(d)) ? "withholding" : "invoice";
}

function parseTab(ws: XLSX.WorkSheet, tab: string): TaxRow[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: "" });
  if (!rows.length) return [];
  const headers = rows[0].map((h) => clean(h));
  const brand = brandOf(tab);

  const col = {
    notified: matchCol(headers, ["แจ้งลูกค้า"]),
    chatName: matchCol(headers, ["ชื่อแชท"]),
    issued: matchCol(headers, ["วันที่ออกเอกสาร"]),
    delivered: matchCol(headers, ["วันที่นำส่ง"]),
    username: matchCol(headers, ["User"], ["ยูสเซอร์"], ["ผู้ใช้"]),
    company: matchCol(headers, ["บริษัท"]),
    docNo: matchCol(headers, ["เลขที่เอกสาร"]),
    channel: matchCol(headers, ["ช่องทาง"]),
    tracking: matchCol(headers, ["เลขที่พัสดุ"]),
    scan: matchCol(headers, ["ลิงค์ไฟล์"], ["ลิ้งไฟล์"], ["แสกน"]),
    note: matchCol(headers, ["หมายเหตุ"]),
  };

  const at = (r: unknown[], i: number) => (i >= 0 ? r[i] : "");
  const out: TaxRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const company = clean(at(r, col.company));
    const username = clean(at(r, col.username));
    if (!company && !username) continue; // แถวว่าง/แถวคั่น

    // เลขที่เอกสารก็ใส่หลายใบในช่องเดียวได้ (ขึ้นบรรทัดใหม่) เหมือนวันที่
    const docNumbers = String(at(r, col.docNo) ?? "")
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);

    out.push({
      brand,
      kind: kindOf(docNumbers),
      tab,
      sources: [tab],
      rowNumber: i + 1, // +1 เพราะแถว 1 คือหัวตาราง
      notified: clean(at(r, col.notified)),
      chatName: clean(at(r, col.chatName)),
      username,
      company,
      docNumbers,
      issued: parseTaxDates(at(r, col.issued)),
      delivered: parseTaxDates(at(r, col.delivered)),
      channel: clean(at(r, col.channel)),
      tracking: clean(at(r, col.tracking)),
      scanLink: clean(at(r, col.scan)),
      note: clean(at(r, col.note)),
    });
  }
  return out;
}

// ===== รวมแถวมิเรอร์ =====
const validDates = (ds: TaxDate[]) => ds.filter((d) => !d.unparsed && d.time > 0);
const deliveredKey = (r: TaxRow) => validDates(r.delivered).map((d) => d.text).sort().join("·");
const isSendTab = (r: TaxRow) => /ใบกำกับ/.test(r.tab); // แท็บ "ส่งใบกำกับ" = ต้นทางที่แอดมินกรอกจริง

/**
 * แท็บ "ลิงค์ข้อมูล" ซ้ำกับแท็บ "ส่งใบกำกับ" ~90% (เอกสารใบเดียวกันเป๊ะ) ถ้าไม่รวมให้
 * แอดมินจะเห็นใบเดิมโผล่ซ้ำสองครั้งทุกครั้งที่ถาม
 *
 * แต่ระวัง: ใบเดียวกันส่ง 2 รอบจริง ๆ ก็มี (เช่น ซีเอ็มพี ออล INV202507150001 ส่ง 25/07 แล้วส่งอีกที 13/08)
 * → คีย์รวมต้องมี "วันที่นำส่ง" ด้วย ไม่งั้นจะกลืนการส่งรอบที่สองหายไป
 *
 * กติกา:
 *  1. จัดกลุ่มด้วย แบรนด์ + บริษัท + เลขที่เอกสาร
 *  2. ในกลุ่ม แยกตามชุดวันที่นำส่ง — คนละวัน = คนละการส่งจริง เก็บแยก
 *  3. แถวที่ยังไม่กรอกวันนำส่ง ถ้ามีพี่น้องที่กรอกแล้ว = มิเรอร์ที่ยังไม่อัปเดต ทิ้งได้
 *  4. ที่เหลือรวมเป็นแถวเดียว ยึดแท็บ "ส่งใบกำกับ" เป็นหลัก แล้วเติมช่องว่างจากอีกแท็บ
 */
function dedupe(all: TaxRow[]): TaxRow[] {
  const groups = new Map<string, TaxRow[]>();
  for (const r of all) {
    const k = `${r.brand}|${key(r.company)}|${r.docNumbers.join(",")}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  const out: TaxRow[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    const hasDelivered = group.some((r) => validDates(r.delivered).length > 0);
    // ทิ้งมิเรอร์ที่ยังไม่กรอกวันส่ง (หรือกรอกพัง) เมื่อมีพี่น้องที่ข้อมูลครบกว่า
    const usable = hasDelivered ? group.filter((r) => validDates(r.delivered).length > 0) : group;

    const variants = new Map<string, TaxRow[]>();
    for (const r of usable) {
      const k = deliveredKey(r);
      if (!variants.has(k)) variants.set(k, []);
      variants.get(k)!.push(r);
    }
    for (const rows of variants.values()) out.push(mergeRows(rows));
  }
  return adoptBlankDocRows(out);
}

/**
 * เก็บตกใบที่แท็บหนึ่งลืมกรอกเลขที่เอกสาร
 *
 * เคสจริง: เอริช ซัคเซสฟูล — แท็บ "ส่งใบกำกับ" เว้นช่องเลขที่เอกสารไว้ แต่แท็บ "ลิงค์ข้อมูล" กรอก INV2026070030
 * คีย์รวมมีเลขที่เอกสารอยู่ ใบเดียวกันเลยแตกเป็นสองแถว แอดมินเห็นใบซ้ำ
 *
 * จับคู่แบบแคบ ๆ เท่านั้น: บริษัทเดียวกัน + แบรนด์เดียวกัน + วันออกและวันส่งตรงกันเป๊ะ
 * และฝั่งที่มีเลขต้องมีใบเดียวเท่านั้น — ถ้าวันเดียวกันมีหลายใบ (ส่งพร้อมกันหลายใบ ซึ่งมีจริง)
 * แปลว่าเดาไม่ได้ว่าใบไหน ก็ปล่อยไว้ ไม่มั่วให้
 */
function adoptBlankDocRows(rows: TaxRow[]): TaxRow[] {
  const blanks = rows.filter((r) => !r.docNumbers.length);
  if (!blanks.length) return rows;
  const drop = new Set<TaxRow>();

  for (const b of blanks) {
    const cand = rows.filter(
      (r) =>
        r !== b &&
        r.docNumbers.length &&
        r.brand === b.brand &&
        key(r.company) === key(b.company) &&
        deliveredKey(r) === deliveredKey(b) &&
        issuedKey(r) === issuedKey(b),
    );
    if (cand.length !== 1) continue; // 0 = ไม่ใช่มิเรอร์ · >1 = กำกวม ไม่เดา
    const target = cand[0];
    target.sources = [...new Set([...target.sources, ...b.sources])];
    target.username ||= b.username;
    target.chatName ||= b.chatName;
    target.scanLink ||= b.scanLink;
    target.tracking ||= b.tracking;
    target.channel ||= b.channel;
    target.notified ||= b.notified;
    drop.add(b);
  }
  return rows.filter((r) => !drop.has(r));
}

const issuedKey = (r: TaxRow) => validDates(r.issued).map((d) => d.text).sort().join("·");

// รวมแถวที่เป็นใบเดียวกัน: ยึดแท็บส่งใบกำกับเป็นฐาน แล้วเติมเฉพาะช่องที่ฐานว่าง
function mergeRows(rows: TaxRow[]): TaxRow {
  if (rows.length === 1) return rows[0];
  const base = { ...(rows.find(isSendTab) || rows[0]) };
  base.sources = [...new Set(rows.flatMap((r) => r.sources))];
  for (const r of rows) {
    if (r === base) continue;
    base.username ||= r.username;
    base.chatName ||= r.chatName;
    base.channel ||= r.channel;
    base.tracking ||= r.tracking;
    base.scanLink ||= r.scanLink;
    base.note ||= r.note;
    base.notified ||= r.notified;
    if (!base.issued.length) base.issued = r.issued;
    if (!validDates(base.delivered).length && validDates(r.delivered).length) base.delivered = r.delivered;
  }
  return base;
}

let cache: { at: number; rows: TaxRow[] } | null = null;

export async function loadTaxRows(opts: { fresh?: boolean } = {}): Promise<TaxRow[]> {
  if (!opts.fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
  const fileId = process.env.TAX_SHEET_FILE_ID?.trim();
  if (!fileId) throw new Error("ยังไม่ได้ตั้งค่า TAX_SHEET_FILE_ID ใน .env");
  const buf = await exportDriveSheet(fileId);
  const wb = XLSX.read(buf, { type: "buffer" });
  const raw = wb.SheetNames.flatMap((n) => parseTab(wb.Sheets[n], n));
  const rows = dedupe(raw);
  cache = { at: Date.now(), rows };
  return rows;
}

export function clearTaxCache() {
  cache = null;
}

// ===== ค้นหา =====
// ตัดคำนำหน้าที่ทุกบริษัทมีเหมือนกัน เพื่อไม่ให้ "บริษัท" ไปแมตช์ทั้งชีต
const STOP = /(บริษัท|จำกัด|มหาชน|\(สำนักงานใหญ่\)|สำนักงานใหญ่|หจก\.?|ห้างหุ้นส่วน(จำกัด)?)/g;
const key = (s: string) =>
  s.replace(STOP, " ").replace(/[\s.\-_()]+/g, "").toLowerCase();

export interface TaxMatch {
  rows: TaxRow[];
  matchedBy: "username" | "company" | "chatName";
  label: string; // ชื่อที่ใช้เรียกลูกค้ารายนี้
}

// ===== เผื่อพิมพ์ชื่อผิดนิดหน่อย =====
// เคสจริง: แอดมินถาม "บริษัท ริช โกลบ์ 168 จำกัด" แต่ในชีตคือ "บริษัท ริช โกลว์ 168 จำกัด"
// ต่างกันตัวเดียว ("บ" vs "ว") การค้นแบบ contains เลยพลาดสนิท ทั้งที่ข้อมูลมีอยู่
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export interface TaxSuggestion {
  company: string;
  distance: number;
}

// ชื่อที่ใกล้เคียงที่สุด — ยอมให้ต่างได้ ~25% ของความยาว (พอสำหรับพิมพ์ผิด 1-3 ตัว แต่ไม่มั่วไปหาคนละบริษัท)
export function suggestCompanies(query: string, rows: TaxRow[], max = 3): TaxSuggestion[] {
  const qk = key(query);
  if (qk.length < 3) return [];
  const seen = new Map<string, TaxSuggestion>();
  for (const r of rows) {
    if (!r.company) continue;
    const ck = key(r.company);
    if (!ck || seen.has(ck)) continue;
    const d = editDistance(qk, ck);
    if (d <= Math.max(2, Math.floor(Math.max(qk.length, ck.length) * 0.25))) {
      seen.set(ck, { company: r.company, distance: d });
    }
  }
  return [...seen.values()].sort((a, b) => a.distance - b.distance).slice(0, max);
}

export async function suggestFor(query: string): Promise<TaxSuggestion[]> {
  return suggestCompanies(query, await loadTaxRows());
}

/**
 * หาลูกค้าจากคำที่แอดมินพิมพ์มา — ยูสเซอร์ก่อน (ตรงตัวกว่า) แล้วค่อยชื่อบริษัท
 * คืนทุกแถวของลูกค้ารายนั้น (ทุกแท็บ) ให้ชั้นบนเป็นคนเลือกว่าจะโชว์ใบล่าสุดใบไหน
 */
export async function findTax(query: string, opts: { brand?: Brand } = {}): Promise<TaxMatch | null> {
  const q = query.trim();
  if (q.length < 2) return null;
  const all = await loadTaxRows();
  // แอดมินระบุแบรนด์มา = ตั้งใจถามฝั่งนั้น — 11 บริษัทมีเอกสารทั้ง Easy และ Thunder
  // และวันที่ล่าสุดคนละฝั่งกัน ถ้าไม่กรองจะตอบใบของอีกแบรนด์ให้เขาโดยไม่รู้ตัว
  const rows = opts.brand ? all.filter((r) => r.brand === opts.brand) : all;
  const qk = key(q);
  if (!qk) return null;

  // 1) ยูสเซอร์ตรงเป๊ะ
  const byUser = rows.filter((r) => r.username && r.username.toLowerCase() === q.toLowerCase());
  if (byUser.length) return { rows: byUser, matchedBy: "username", label: byUser[0].company || byUser[0].username };

  // 2) ชื่อบริษัท — ตรงเป๊ะก่อน แล้วค่อยแบบมีคำนั้นอยู่ข้างใน
  const exact = rows.filter((r) => r.company && key(r.company) === qk);
  if (exact.length) return { rows: exact, matchedBy: "company", label: exact[0].company };

  const partial = rows.filter((r) => r.company && (key(r.company).includes(qk) || qk.includes(key(r.company))));
  if (partial.length) {
    // นับ "คนละบริษัท" ด้วยชื่อที่ normalize แล้ว ไม่ใช่ข้อความดิบ — ไม่งั้น
    // "บริษัท แมทช์เดย์ ฮับ จำกัด" กับ "บริษัท แมทช์เดย์ ฮับ จำกัด (สำนักงานใหญ่)" จะนับเป็นคนละเจ้า
    // แล้ววานถามกลับทั้งที่เป็นลูกค้ารายเดียวกัน
    const distinct = [...new Set(partial.map((r) => key(r.company)))];
    if (distinct.length === 1) {
      // เลือกชื่อที่ยาวสุดมาโชว์ (มักเป็นชื่อเต็มที่มีสำนักงานใหญ่ระบุไว้)
      const label = partial.map((r) => r.company).sort((a, b) => b.length - a.length)[0];
      return { rows: partial, matchedBy: "company", label };
    }
    return { rows: partial, matchedBy: "company", label: "" }; // label ว่าง = กำกวมจริง ให้ชั้นบนถามกลับ
  }

  // 3) ชื่อแชท (เผื่อแอดมินก็อปชื่อห้องแชทมา)
  const byChat = rows.filter((r) => r.chatName && key(r.chatName) === qk);
  if (byChat.length) return { rows: byChat, matchedBy: "chatName", label: byChat[0].company || byChat[0].chatName };

  return null;
}

// เรียงใหม่→เก่า ตามวันนำส่ง ถ้าไม่มีก็ใช้วันออกเอกสาร (แถวที่ยังไม่ส่งจะลอยขึ้นบนสุด = สิ่งที่แอดมินต้องรู้ก่อน)
export function sortLatest(rows: TaxRow[]): TaxRow[] {
  return [...rows].sort((a, b) => {
    const at = Math.max(latestTime(a.delivered), latestTime(a.issued));
    const bt = Math.max(latestTime(b.delivered), latestTime(b.issued));
    return bt - at;
  });
}

export const isDelivered = (r: TaxRow) => r.delivered.length > 0;

// ลูกค้ารายนี้มีเอกสารของอีกแบรนด์ด้วยไหม — ไว้เตือนแอดมินตอนที่เขาไม่ได้ระบุแบรนด์มา
export async function otherBrandCount(company: string, exclude: Brand): Promise<number> {
  const rows = await loadTaxRows();
  const ck = key(company);
  return rows.filter((r) => r.brand !== exclude && key(r.company) === ck).length;
}

export function companiesOf(rows: TaxRow[]): string[] {
  return [...new Set(rows.map((r) => r.company).filter(Boolean))];
}

// ===== นับรายการตามวัน =====
export interface DayCount {
  date: string;
  total: number;
  byTab: { tab: string; count: number; rows: TaxRow[] }[];
}

export async function countDelivered(day: Date, brand?: Brand): Promise<DayCount> {
  const all = await loadTaxRows();
  const rows = brand ? all.filter((r) => r.brand === brand) : all;
  const target = fmt(day);
  const hit = rows.filter((r) => r.delivered.some((d) => d.text === target));
  const byTab = [...new Set(hit.map((r) => r.tab))].map((tab) => ({
    tab,
    count: hit.filter((r) => r.tab === tab).length,
    rows: hit.filter((r) => r.tab === tab),
  }));
  return { date: target, total: hit.length, byTab };
}
