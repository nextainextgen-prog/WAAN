// สถานะทุนวิจัย (Grant Pipeline) — key เดียวใช้ทั้งระบบ
export type GrantStatus =
  | "submitted"
  | "approved"
  | "first_disbursement"
  | "in_progress"
  | "reporting"
  | "closed";

export interface StatusMeta {
  key: GrantStatus;
  label: string; // ป้ายภาษาไทย
  // สีสถานะ (ใช้กับ badge / column accent) — โทน Trust & Authority
  dot: string;
  accent: string;
}

export const GRANT_STATUSES: StatusMeta[] = [
  { key: "submitted", label: "ยื่นขอทุน", dot: "bg-slate-400", accent: "text-slate-600" },
  { key: "approved", label: "อนุมัติ", dot: "bg-blue-500", accent: "text-blue-600" },
  { key: "first_disbursement", label: "เบิกงวดแรก", dot: "bg-indigo-500", accent: "text-indigo-600" },
  { key: "in_progress", label: "กำลังดำเนินการ", dot: "bg-amber-500", accent: "text-amber-600" },
  { key: "reporting", label: "ส่งรายงาน", dot: "bg-violet-500", accent: "text-violet-600" },
  { key: "closed", label: "ปิดงวด / สำเร็จ", dot: "bg-emerald-500", accent: "text-emerald-600" },
];

export const STATUS_MAP: Record<string, StatusMeta> = Object.fromEntries(
  GRANT_STATUSES.map((s) => [s.key, s]),
);

export function statusLabel(key: string): string {
  return STATUS_MAP[key]?.label ?? key;
}

// สถานะที่ถือว่า "นับเป็นผลงาน OKR" (เงินที่เข้าจริง/ผูกพันแล้ว)
export const OKR_COUNTED_STATUSES: GrantStatus[] = [
  "approved",
  "first_disbursement",
  "in_progress",
  "reporting",
  "closed",
];

const bahtFmt = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  maximumFractionDigits: 0,
});

export function formatBaht(n: number): string {
  return bahtFmt.format(n || 0);
}

// ย่อจำนวนเงินใหญ่ เช่น 5,800,000 -> 5.8 ล้าน
export function formatBahtShort(n: number): string {
  if (!n) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("th-TH", { maximumFractionDigits: 2 })} ล้าน`;
  if (n >= 1_000) return `${(n / 1_000).toLocaleString("th-TH", { maximumFractionDigits: 1 })} พัน`;
  return n.toLocaleString("th-TH");
}

const dateFmt = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function formatThaiDate(d: Date | string | null | undefined): string {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "-";
  return dateFmt.format(date);
}

// จำนวนวันจากวันนี้ถึง deadline (ลบ = เลยกำหนด)
export function daysUntil(d: Date | string | null | undefined): number | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return null;
  const now = new Date();
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const b = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}
