// ปีงบประมาณไทย — 1 ต.ค. ถึง 30 ก.ย.
// ปีงบ 2026 (พ.ศ. 2569) = 1 ต.ค. 2025 ถึง 30 ก.ย. 2026
// เก็บเป็น ค.ศ. ในฐานข้อมูล แสดงผลเป็น พ.ศ. เสมอ

// เดือนที่ปีงบเริ่ม (1-12) — ตั้งค่าได้ผ่าน env เผื่อหน่วยงานใช้ปีปฏิทิน (ตั้ง 1)
// ใช้ NEXT_PUBLIC_ เพราะไฟล์นี้ถูกเรียกทั้งฝั่ง server และ client ต้องได้ค่าเดียวกันไม่งั้น hydrate ไม่ตรง
export const FISCAL_START_MONTH = (() => {
  const n = Number(process.env.NEXT_PUBLIC_FISCAL_START_MONTH);
  return n >= 1 && n <= 12 ? n : 10;
})();

/** ปีงบ (ค.ศ.) ของวันที่หนึ่ง ๆ */
export function fiscalYearOf(d: Date | string = new Date()): number {
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return new Date().getFullYear();
  // เดือนตั้งแต่เดือนเริ่มปีงบขึ้นไป = นับเป็นปีงบถัดไป
  return date.getMonth() + 1 >= FISCAL_START_MONTH ? date.getFullYear() + 1 : date.getFullYear();
}

/** ช่วงวันของปีงบ [start, end) — end คือเที่ยงคืนวันแรกของปีงบถัดไป */
export function fiscalRange(fy: number): { start: Date; end: Date } {
  const start = new Date(fy - 1, FISCAL_START_MONTH - 1, 1);
  const end = new Date(fy, FISCAL_START_MONTH - 1, 1);
  return { start, end };
}

/** วันที่นี้อยู่ในปีงบนี้ไหม */
export function inFiscalYear(d: Date | string | null | undefined, fy: number): boolean {
  if (!d) return false;
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return false;
  const { start, end } = fiscalRange(fy);
  return date >= start && date < end;
}

/** ป้ายปีงบเป็น พ.ศ. เช่น 2026 -> "2569" */
export function fiscalLabel(fy: number): string {
  return String(fy + 543);
}

/**
 * สัดส่วนของปีงบที่ผ่านไปแล้ว (0-1) ณ วันที่กำหนด
 * ใช้คำนวณเส้น pace — "ณ วันนี้ควรได้เงินเท่าไหร่แล้ว"
 */
export function fiscalProgress(fy: number, now: Date = new Date()): number {
  const { start, end } = fiscalRange(fy);
  const total = end.getTime() - start.getTime();
  const passed = now.getTime() - start.getTime();
  if (passed <= 0) return 0;
  if (passed >= total) return 1;
  return passed / total;
}

/** จำนวนวันที่เหลือของปีงบ (0 ถ้าจบแล้ว) */
export function fiscalDaysLeft(fy: number, now: Date = new Date()): number {
  const { end } = fiscalRange(fy);
  const ms = end.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

/** รายการปีงบให้เลือกบนหน้าจอ (ย้อนหลัง 2 ปี ถึงล่วงหน้า 1 ปี) */
export function fiscalYearOptions(now: Date = new Date()): number[] {
  const cur = fiscalYearOf(now);
  return [cur - 2, cur - 1, cur, cur + 1];
}
