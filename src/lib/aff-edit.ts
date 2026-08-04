import { parseEditSmart, parseEdit, type EditOverrides } from "./aff-make";

/**
 * ชั้นแก้ไขเอกสาร AFF ให้ "แก้แล้วได้ตามที่สั่งจริง"
 *
 * ปัญหาเดิม: แอดมินพิมพ์คำสั่งอิสระ → regex จับทั้งบรรทัดบ้าง ตีความผิดช่องบ้าง
 * แล้วออกเอกสารใหม่ทันทีโดยไม่ถาม ทำให้ประโยคคำสั่งหลุดลงไปอยู่ในเอกสาร
 *
 * ที่นี่แก้ 3 ชั้น:
 *  1) รับได้ 3 ทาง — พิมพ์อิสระ · พิมพ์ตามเลขข้อในการ์ดสรุป ("2 = นายสมชาย") · กดปุ่มเลือกช่องแล้วพิมพ์ค่าล้วน
 *  2) ตรวจค่าทุกช่องก่อนรับ (validate) — ค่าที่หน้าตาเป็น "ประโยคคำสั่ง" จะถูกปฏิเสธ ไม่ให้หลุดลงเอกสาร
 *  3) คืน diff (เดิม → ใหม่) ให้เอาไปให้แอดมินยืนยันก่อนออกเอกสารเสมอ
 */

export type FieldKey = "name" | "address" | "taxId" | "date" | "gross" | "bankAccount";

export interface FieldDef {
  key: FieldKey;
  label: string; // ป้ายปุ่ม
  ask: string; // ข้อความตอนถามค่าใหม่
  no?: number; // เลขข้อในการ์ดสรุป (ถ้ามี)
}

export const FIELDS: FieldDef[] = [
  { key: "name", label: "ชื่อผู้รับเงิน", ask: 'พิมพ์ชื่อใหม่มาได้เลย (ใส่คำนำหน้าด้วย เช่น "นายสมชาย ใจดี")', no: 2 },
  { key: "address", label: "ที่อยู่", ask: 'พิมพ์ที่อยู่ใหม่ทั้งบรรทัด เช่น "88/2 หมู่ 5 ต.บางพระ อ.ศรีราชา จ.ชลบุรี"', no: 3 },
  { key: "taxId", label: "เลขผู้เสียภาษี", ask: "พิมพ์เลขผู้เสียภาษี 13 หลัก", no: 4 },
  { key: "date", label: "วันที่ทำการถอน", ask: 'พิมพ์วันที่ เช่น "13/07/2569" หรือ "13 กรกฎาคม 2569"', no: 5 },
  { key: "gross", label: "จำนวนเงินที่ถอน", ask: 'พิมพ์ยอดเงินที่ถอน (ก่อนหัก 3%) เช่น "1500"', no: 6 },
  { key: "bankAccount", label: "ธนาคาร/เลขบัญชี", ask: 'พิมพ์ธนาคารกับเลขบัญชี เช่น "กสิกรไทย 1234567890"', no: undefined },
];

const FIELD_BY_NO = new Map<number, FieldKey>(FIELDS.filter((f) => f.no).map((f) => [f.no!, f.key]));
// ข้อในการ์ดสรุปที่แก้ที่นี่ไม่ได้ (จะได้บอกเหตุผลแทนที่จะเงียบ)
const LOCKED_NO: Record<number, string> = {
  1: "ยูสเซอร์ — ยึดตามรายการถอนในระบบ แก้ไม่ได้",
  7: "ยอดหัก 3% — ระบบคำนวณจากยอดถอนให้เอง (แก้ข้อ 6 แทน)",
  8: "ที่อยู่จัดส่งเอกสาร — ดึงจากชีตลูกค้า AFF แก้ที่ชีต",
};

const OVERRIDE_KEYS: Record<FieldKey, (keyof EditOverrides)[]> = {
  name: ["prefix", "name"],
  address: ["houseNo", "moo", "road", "tambon", "amphoe", "changwat"],
  taxId: ["taxId"],
  date: ["day", "month", "yearBE"],
  gross: ["gross"],
  bankAccount: ["bank", "account"],
};

export const LABEL: Record<string, string> = {
  prefix: "คำนำหน้า", name: "ชื่อ", taxId: "เลขผู้เสียภาษี",
  houseNo: "บ้านเลขที่", moo: "หมู่", road: "ถนน/ซอย", tambon: "ตำบล/แขวง", amphoe: "อำเภอ/เขต", changwat: "จังหวัด",
  bank: "ธนาคาร", account: "เลขบัญชี", gross: "จำนวนเงินที่ถอน", day: "วันที่", month: "เดือน", yearBE: "ปี",
};

const THAI_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
// คำที่บ่งว่าเป็น "ประโยคสั่งงาน" ไม่ใช่ค่าจริง — กันประโยคคำสั่งหลุดลงเอกสาร (บั๊กเดิม)
// ระวัง: ภาษาไทยไม่มีเว้นวรรคระหว่างคำ — ห้ามใส่คำสั้นอย่าง "ลบ"/"แก้" เดี่ยว ๆ
// (เคยทำให้ "ชลบุรี" โดนตีว่าเป็นคำสั่งเพราะมี "ลบ" อยู่ข้างใน · "แก้ว" ก็เป็นนามสกุลจริง)
const COMMAND_WORDS = /(แก้ไข|แก้เป็น|แก้ให้|เปลี่ยนเป็น|เปลี่ยนให้|ปรับเป็น|ช่วย|หน่อย|ให้ที|ด้วยนะ|ทำใหม่|ออกใหม่|ครับ|ค่ะ|คะ|ผิด)/;

export interface Rejected { key: string; value: string; why: string }

// ===== ตรวจค่าทีละช่อง (ค่าที่ไม่ผ่าน = ทิ้ง + บอกเหตุผล ไม่ปล่อยลงเอกสาร) =====
export function validateOverrides(o: EditOverrides): { clean: EditOverrides; rejected: Rejected[] } {
  const clean: EditOverrides = {};
  const rejected: Rejected[] = [];
  const keep = <K extends keyof EditOverrides>(k: K, v: EditOverrides[K]) => { (clean as Record<string, unknown>)[k] = v; };
  const drop = (k: string, v: unknown, why: string) => rejected.push({ key: LABEL[k] || k, value: String(v), why });

  for (const [k, v] of Object.entries(o) as [keyof EditOverrides, unknown][]) {
    if (v == null || v === "") continue;
    const s = String(v).trim();
    switch (k) {
      case "name":
        if (s.length > 60) drop(k, s, "ยาวผิดปกติ (น่าจะติดประโยคคำสั่งมา)");
        else if (/\d/.test(s)) drop(k, s, "ชื่อไม่ควรมีตัวเลข");
        else if (COMMAND_WORDS.test(s)) drop(k, s, "ดูเป็นประโยคคำสั่ง ไม่ใช่ชื่อ");
        else if (s.length < 2) drop(k, s, "สั้นเกินไป");
        else keep("name", s);
        break;
      case "prefix":
        if (["นาย", "นาง", "นางสาว", "น.ส."].includes(s)) keep("prefix", s);
        else drop(k, s, "คำนำหน้าไม่ถูกต้อง");
        break;
      case "taxId":
        if (/^\d{13}$/.test(s)) keep("taxId", s);
        else drop(k, s, "ต้องเป็นตัวเลข 13 หลัก");
        break;
      case "account":
        if (/^\d{6,20}$/.test(s.replace(/\D/g, ""))) keep("account", s.replace(/\D/g, ""));
        else drop(k, s, "เลขบัญชีต้องเป็นตัวเลข 6-20 หลัก");
        break;
      case "bank":
        if (s.length <= 40 && !COMMAND_WORDS.test(s) && /[ก-๙A-Za-z]/.test(s)) keep("bank", s.replace(/^ธนาคาร\s*/, "ธนาคาร"));
        else drop(k, s, "ชื่อธนาคารไม่ถูกต้อง");
        break;
      case "gross": {
        const n = Number(s.replace(/,/g, ""));
        if (Number.isFinite(n) && n > 0 && n < 10_000_000) keep("gross", n);
        else drop(k, s, "ยอดเงินต้องเป็นตัวเลขมากกว่า 0");
        break;
      }
      case "houseNo":
        if (/^[\d]{1,6}(?:[/-]\d{1,5})?$/.test(s)) keep("houseNo", s);
        else drop(k, s, 'บ้านเลขที่ควรเป็นตัวเลข เช่น "88" หรือ "88/2"');
        break;
      case "moo":
        if (/^\d{1,3}$/.test(s) || s === "-") keep("moo", s); // "-" = ที่อยู่นี้ไม่มีหมู่
        else drop(k, s, "หมู่ต้องเป็นตัวเลข");
        break;
      case "day":
        if (/^\d{1,2}$/.test(s) && +s >= 1 && +s <= 31) keep("day", String(+s));
        else drop(k, s, "วันที่ไม่ถูกต้อง");
        break;
      case "month":
        if (/^\d{1,2}$/.test(s) && +s >= 1 && +s <= 12) keep("month", String(+s).padStart(2, "0"));
        else drop(k, s, "เดือนไม่ถูกต้อง");
        break;
      case "yearBE":
        if (/^\d{4}$/.test(s) && +s >= 2400 && +s <= 2700) keep("yearBE", s);
        else drop(k, s, "ปี พ.ศ. ไม่ถูกต้อง");
        break;
      case "road":
      case "tambon":
      case "amphoe":
      case "changwat":
        if (s.length > 40) drop(k, s, "ยาวผิดปกติ (น่าจะติดประโยคคำสั่งมา)");
        else if (COMMAND_WORDS.test(s)) drop(k, s, "ดูเป็นประโยคคำสั่ง ไม่ใช่ค่าจริง");
        else keep(k, s);
        break;
      default:
        break;
    }
  }
  return { clean, rejected };
}

// ===== ทางที่ 2: พิมพ์ตามเลขข้อในการ์ดสรุป — "2 = นายสมชาย ใจดี" (หลายบรรทัดได้) =====
export function looksNumbered(text: string): boolean {
  return /(?:^|\n)\s*(?:แก้\s*)?(?:ข้อ\s*)?[1-8]\s*[=:：]/.test(text);
}

export async function parseNumbered(text: string): Promise<{ overrides: EditOverrides; unsupported: string[] }> {
  const overrides: EditOverrides = {};
  const unsupported: string[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const m = line.match(/^\s*(?:แก้\s*)?(?:ข้อ\s*)?([1-8])\s*[=:：]\s*(.+)$/);
    if (!m) continue;
    const no = Number(m[1]);
    const value = m[2].trim();
    const field = FIELD_BY_NO.get(no);
    if (!field) { unsupported.push(`ข้อ ${no}: ${LOCKED_NO[no] || "แก้ไม่ได้"}`); continue; }
    Object.assign(overrides, await parseFieldValue(field, value));
  }
  return { overrides, unsupported };
}

// ===== ทางที่ 3: กดปุ่มเลือกช่องแล้วพิมพ์ "ค่าล้วน" — รู้อยู่แล้วว่าช่องไหน จึงไม่ต้องเดา =====
export async function parseFieldValue(field: FieldKey, raw: string): Promise<EditOverrides> {
  const v = raw.trim().replace(/^(?:แก้|เปลี่ยน|ปรับ)\s*(?:เป็น)?\s*/, "").trim();
  switch (field) {
    case "name": {
      const t = v.replace(/^ชื่อ\s*:?\s*/, "").trim();
      for (const p of ["นางสาว", "น.ส.", "นาย", "นาง"]) {
        if (t.startsWith(p)) return { prefix: p === "น.ส." ? "นางสาว" : p, name: t.slice(p.length).trim() };
      }
      return { name: t };
    }
    case "taxId":
      return { taxId: v.replace(/\D/g, "") };
    case "gross":
      return { gross: Number(v.replace(/[^\d.]/g, "")) };
    case "bankAccount": {
      const acc = v.match(/\d[\d\- ]{5,}/)?.[0]?.replace(/\D/g, "") || "";
      const bank = v.replace(/\d[\d\- ]{5,}/, "").replace(/เลขบัญชี|ธนาคาร/g, "").trim();
      const out: EditOverrides = {};
      if (acc) out.account = acc;
      if (bank) out.bank = `ธนาคาร${bank.replace(/^ธนาคาร/, "")}`;
      return out;
    }
    case "date": {
      const dm = v.match(/(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{2,4})/);
      if (dm) {
        const y = +dm[3];
        return { day: String(+dm[1]), month: String(+dm[2]).padStart(2, "0"), yearBE: String(y < 100 ? 2500 + y : y > 2400 ? y : y + 543) };
      }
      const tm = v.match(/(\d{1,2})\s*([ก-๙]+)\s*(\d{2,4})/);
      if (tm) {
        const mi = THAI_MONTHS.findIndex((m) => m.startsWith(tm[2].replace(/\./g, "").slice(0, 4)));
        if (mi >= 0) {
          const y = +tm[3];
          return { day: String(+tm[1]), month: String(mi + 1).padStart(2, "0"), yearBE: String(y < 100 ? 2500 + y : y > 2400 ? y : y + 543) };
        }
      }
      return {};
    }
    case "address": {
      // ที่อยู่ยังต้องแยกส่วน → ใช้ตัวแยกเดิม (regex ก่อน ไม่ครบค่อยให้ AI ช่วย) แต่รู้แน่ว่าเป็นที่อยู่
      const o = await parseEditSmart(`ที่อยู่ ${v}`);
      // ตัดฟิลด์ที่ไม่ใช่ที่อยู่ทิ้ง (กันหลุดไปแก้ช่องอื่นโดยไม่ได้ตั้งใจ)
      const keys = OVERRIDE_KEYS.address;
      const out: EditOverrides = {};
      for (const k of keys) { const val = (o as Record<string, unknown>)[k]; if (val != null && val !== "") (out as Record<string, unknown>)[k] = val; }
      // พิมพ์ที่อยู่มาทั้งบรรทัด = แทนที่ของเดิมทั้งชุด — ส่วนที่ไม่ได้พิมพ์มาให้ล้างเป็น "-"
      // (ไม่งั้น "หมู่ 10" ของที่อยู่เก่าจะค้างอยู่ในที่อยู่ กทม. ที่ไม่มีหมู่)
      if (out.houseNo && (out.tambon || out.amphoe)) {
        if (!out.moo) out.moo = "-";
        if (!out.road) out.road = "-";
      }
      return out;
    }
  }
}

// ===== ทางที่ 1: พิมพ์อิสระ (ใช้ตัวแยกเดิม แต่ผ่าน validate เสมอ) =====
export async function parseFreeText(text: string): Promise<EditOverrides> {
  return parseEditSmart(text);
}

// ===== อ่านค่าปัจจุบันจาก "การ์ดสรุป 8 ข้อ" ที่วานส่งไปแล้ว (ไม่ต้อง scrape ระบบซ้ำ) =====
export interface CurrentValues {
  username?: string; name?: string; address?: string; taxId?: string; date?: string; gross?: string; ship?: string;
}
export function parseSummary(summary: string): CurrentValues {
  const g = (re: RegExp) => summary.match(re)?.[1]?.trim();
  return {
    username: g(/^\s*1\.[^:]*:\s*(.+)$/m),
    name: g(/^\s*2\.[^:]*:\s*(.+)$/m),
    address: g(/^\s*3\.[^:]*:\s*(.+)$/m),
    taxId: g(/^\s*4\.[^:]*:\s*(.+)$/m),
    date: g(/^\s*5\.[^:]*:\s*(.+)$/m),
    gross: g(/^\s*6\.[^:]*:\s*(.+)$/m),
    ship: g(/^\s*8\.[^:]*:\s*(.+)$/m),
  };
}

// แยกที่อยู่ปัจจุบัน (string) → ส่วนประกอบ ไว้ประกอบที่อยู่ใหม่ให้เห็นเต็มบรรทัดตอนยืนยัน
function splitAddr(s: string) {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return {
    houseNo: t.match(/^(\d+(?:\/\d+)?)/)?.[1] || "",
    moo: t.match(/หมู่(?:ที่)?\s*(\d+)/)?.[1] || "",
    road: t.match(/(?:ถนน|ถ\.|ซ\.|ซอย)\s*(\S+)/)?.[1] || "",
    tambon: t.match(/(?:ตำบล|ต\.|แขวง)\s*([ก-๙]+)/)?.[1] || "",
    amphoe: t.match(/(?:อำเภอ|อ\.|เขต)\s*([ก-๙]+)/)?.[1] || "",
    changwat: t.match(/(?:จังหวัด|จ\.)\s*([ก-๙]+)/)?.[1] || "",
  };
}
function joinAddr(a: ReturnType<typeof splitAddr>): string {
  const road = a.road && a.road !== "-" ? (/^(?:ซ\.|ซอย|ถ\.|ถนน)/.test(a.road) ? ` ${a.road}` : ` ถนน ${a.road}`) : "";
  const moo = a.moo && a.moo !== "-" ? ` หมู่ ${a.moo}` : "";
  return `${a.houseNo}${moo}${road} ต.${a.tambon} อ.${a.amphoe} จ.${a.changwat}`.replace(/\s+/g, " ").trim();
}

export interface DiffRow { label: string; from: string; to: string }

// สร้างตาราง "เดิม → ใหม่" ให้แอดมินตรวจก่อนกดยืนยัน
export function buildDiff(summary: string, o: EditOverrides): DiffRow[] {
  const cur = parseSummary(summary || "");
  const rows: DiffRow[] = [];
  if (o.name || o.prefix) {
    const to = `${o.prefix || (cur.name || "").match(/^(นางสาว|นาย|นาง|น\.ส\.)/)?.[1] || ""}${o.name || (cur.name || "").replace(/^(นางสาว|นาย|นาง|น\.ส\.)/, "")}`;
    rows.push({ label: "ชื่อผู้รับเงิน", from: cur.name || "-", to });
  }
  const addrKeys = OVERRIDE_KEYS.address.filter((k) => (o as Record<string, unknown>)[k]);
  if (addrKeys.length) {
    const merged = { ...splitAddr(cur.address || "") };
    for (const k of addrKeys) (merged as Record<string, string>)[k] = String((o as Record<string, unknown>)[k]);
    rows.push({ label: "ที่อยู่", from: cur.address || "-", to: joinAddr(merged) });
  }
  if (o.taxId) rows.push({ label: "เลขผู้เสียภาษี", from: cur.taxId || "-", to: o.taxId });
  if (o.day || o.month || o.yearBE) {
    const [cd, cm, cy] = (cur.date || "").split("/");
    const yy = (o.yearBE || cy || "").slice(-2);
    rows.push({ label: "วันที่ทำการถอน", from: cur.date || "-", to: `${o.day || cd || "?"}/${o.month || cm || "?"}/${yy || "?"}` });
  }
  if (o.gross != null) rows.push({ label: "จำนวนเงินที่ถอน", from: cur.gross || "-", to: `${o.gross.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท` });
  if (o.bank) rows.push({ label: "ธนาคาร", from: "(ตามระบบ)", to: o.bank });
  if (o.account) rows.push({ label: "เลขบัญชี", from: "(ตามระบบ)", to: o.account });
  return rows;
}

// ตีความคำสั่ง 1 ข้อความ (พิมพ์อิสระ / เลขข้อ) → overrides ที่ผ่านการตรวจแล้ว + สิ่งที่ทิ้ง
export async function interpretEdit(text: string): Promise<{ overrides: EditOverrides; rejected: Rejected[]; unsupported: string[] }> {
  const numbered = looksNumbered(text);
  const raw = numbered ? await parseNumbered(text) : { overrides: await parseFreeText(text), unsupported: [] as string[] };
  const { clean, rejected } = validateOverrides(raw.overrides);
  return { overrides: clean, rejected, unsupported: raw.unsupported };
}

export { parseEdit };
