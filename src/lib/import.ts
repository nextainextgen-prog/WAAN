import { GRANT_STATUSES, type GrantStatus } from "./grants";

// แปลงจำนวนเงินจากข้อมูลดิบ ("1,850,000 บาท", "฿850000", "1.2M")
export function normalizeAmount(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (v == null) return 0;
  let s = String(v).trim().toLowerCase().replace(/[,\s฿]/g, "").replace(/บาท/g, "");
  let mult = 1;
  if (/ล้าน|m$/.test(s)) {
    mult = 1_000_000;
    s = s.replace(/ล้าน|m$/g, "");
  } else if (/k$/.test(s)) {
    mult = 1_000;
    s = s.replace(/k$/g, "");
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n * mult;
}

const STATUS_SYNONYMS: Record<GrantStatus, string[]> = {
  submitted: ["ยื่น", "ขอทุน", "เสนอ", "proposal", "submit", "รอพิจารณา", "รออนุมัติ"],
  approved: ["อนุมัติ", "approve", "ผ่าน", "accepted"],
  first_disbursement: ["เบิก", "งวดแรก", "งวด 1", "disburse", "advance"],
  in_progress: ["ดำเนินการ", "กำลัง", "progress", "ongoing", "active", "ระหว่าง"],
  reporting: ["รายงาน", "report", "ส่งรายงาน", "ความก้าวหน้า"],
  closed: ["ปิด", "สำเร็จ", "เสร็จ", "closed", "done", "complete", "จบ"],
};

// แปลงข้อความสถานะดิบ → key (เดาให้ดีที่สุด default = submitted)
export function normalizeStatus(v: unknown): GrantStatus {
  if (v == null) return "submitted";
  const s = String(v).trim().toLowerCase();
  if (!s) return "submitted";
  // ตรงกับ key/label ตรงๆ
  for (const meta of GRANT_STATUSES) {
    if (s === meta.key || s === meta.label.toLowerCase()) return meta.key;
  }
  for (const [key, words] of Object.entries(STATUS_SYNONYMS)) {
    if (words.some((w) => s.includes(w.toLowerCase()))) return key as GrantStatus;
  }
  return "submitted";
}

// แปลงวันที่จากข้อมูลดิบ (Date, Excel serial, ISO, dd/mm/yyyy, พ.ศ.)
export function normalizeDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    // Excel serial date (วันที่ 0 = 1899-12-30)
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(v).trim();
  // dd/mm/yyyy หรือ dd-mm-yyyy
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yyyy] = m;
    let year = parseInt(yyyy, 10);
    if (year > 2500) year -= 543; // พ.ศ. → ค.ศ.
    if (year < 100) year += 2000;
    const d = new Date(year, parseInt(mm, 10) - 1, parseInt(dd, 10));
    return isNaN(d.getTime()) ? null : d;
  }
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export const IMPORT_FIELDS = [
  { key: "projectName", label: "ชื่อโครงการ", required: true, synonyms: ["โครงการ", "ชื่อ", "project", "title", "งานวิจัย"] },
  { key: "ownerName", label: "เจ้าของทุน", required: false, synonyms: ["อาจารย์", "เจ้าของ", "หัวหน้า", "owner", "pi", "ผู้วิจัย"] },
  { key: "source", label: "แหล่งทุน", required: false, synonyms: ["แหล่ง", "ทุน", "source", "fund", "sponsor", "งบ"] },
  { key: "amount", label: "มูลค่าทุน", required: false, synonyms: ["มูลค่า", "จำนวน", "เงิน", "amount", "budget", "งบประมาณ", "บาท"] },
  { key: "status", label: "สถานะ", required: false, synonyms: ["สถานะ", "status", "state", "ขั้น"] },
  { key: "nextDeadline", label: "กำหนดส่ง", required: false, synonyms: ["deadline", "กำหนด", "วันที่", "date", "ครบกำหนด", "due"] },
  { key: "note", label: "หมายเหตุ", required: false, synonyms: ["หมายเหตุ", "note", "remark", "comment", "รายละเอียด"] },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];

// เดา mapping จากชื่อ header อัตโนมัติ
export function autoGuessMapping(headers: string[]): Record<ImportFieldKey, string | null> {
  const result = {} as Record<ImportFieldKey, string | null>;
  const used = new Set<string>();
  for (const field of IMPORT_FIELDS) {
    let match: string | null = null;
    for (const h of headers) {
      if (used.has(h)) continue;
      const hl = h.toLowerCase();
      if (field.synonyms.some((syn) => hl.includes(syn.toLowerCase()))) {
        match = h;
        break;
      }
    }
    if (match) used.add(match);
    result[field.key] = match;
  }
  return result;
}
