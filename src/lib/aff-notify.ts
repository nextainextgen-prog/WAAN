import { db } from "./db";

/**
 * จำ noti "กำลังรออนุมัติ" ที่บอทของระบบส่งเข้ากลุ่ม (Image 26) ไว้ cross-check
 * ตอนตรวจเอกสาร → ใช้ "วันที่/ยอด" จาก noti เลือกแถวหลังบ้านให้ตรงรายการ (กันหยิบผิดแถว)
 */
export interface DateYMD {
  y: number;
  m: number;
  d: number;
}

export interface AffNoti {
  username: string;
  amount: number | null;
  bank?: string;
  account?: string; // ตัวเลขล้วน
  accountName?: string;
  date: DateYMD | null;
  dateText: string;
  raw: string;
}

const TH_MONTHS: Record<string, number> = {
  "ม.ค.": 1, มกราคม: 1, "ก.พ.": 2, กุมภาพันธ์: 2, "มี.ค.": 3, มีนาคม: 3,
  "เม.ย.": 4, เมษายน: 4, "พ.ค.": 5, พฤษภาคม: 5, "มิ.ย.": 6, มิถุนายน: 6,
  "ก.ค.": 7, กรกฎาคม: 7, "ส.ค.": 8, สิงหาคม: 8, "ก.ย.": 9, กันยายน: 9,
  "ต.ค.": 10, ตุลาคม: 10, "พ.ย.": 11, พฤศจิกายน: 11, "ธ.ค.": 12, ธันวาคม: 12,
};
const EN_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// ทำให้เป็นปี ค.ศ.: 4 หลัก >2400 = พ.ศ. (ลบ 543) · 2 หลัก = พ.ศ.ย่อ (2500+yy แล้วลบ 543)
function toCE(y: number): number {
  if (y < 100) return 2500 + y - 543; // 69 → 2569 → 2026
  return y > 2400 ? y - 543 : y;
}

// แปลงข้อความวันที่หลายรูปแบบ → {y,m,d} (ปี ค.ศ.)
// รองรับ: "19 Jun 2026, 09:07" · "19 มิ.ย. 2026" · "19/06/2569" · "19/06/69"
export function parseDateLoose(s: string): DateYMD | null {
  if (!s) return null;
  const t = s.trim();
  // dd/mm/yyyy หรือ dd/mm/yy
  const slash = t.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (slash) {
    const d = +slash[1], m = +slash[2], y = toCE(+slash[3]);
    if (m >= 1 && m <= 12) return { y, m, d };
  }
  // dd <month> yyyy (ไทย/อังกฤษ)
  const named = t.match(/(\d{1,2})\s*([ก-๙.]+|[A-Za-z]{3,})\s*(\d{4})/);
  if (named) {
    const d = +named[1];
    const monToken = named[2];
    const m = TH_MONTHS[monToken] || EN_MONTHS[monToken.slice(0, 3).toLowerCase()];
    if (m) return { y: toCE(+named[3]), m, d };
  }
  return null;
}

export function sameDay(a: DateYMD | null, b: DateYMD | null): boolean {
  return !!a && !!b && a.y === b.y && a.m === b.m && a.d === b.d;
}

// เป็นข้อความ noti "กำลังรออนุมัติ" ของบอทระบบไหม
export function isSystemNoti(text: string): boolean {
  const t = text || "";
  return /กำลังรออนุมัติ/.test(t) && /(ได้แจ้งถอนเงิน|แจ้งถอน|รายละเอียดบัญชี)/.test(t);
}

export function parseSystemNoti(text: string): AffNoti | null {
  if (!isSystemNoti(text)) return null;
  const g = (re: RegExp) => text.match(re)?.[1]?.trim();
  const username =
    g(/คุณ\s+(\S+)\s+ได้แจ้งถอน/) || g(/(?:ยูสเซอร์|ยูเซอร์|username)\s*:?\s*(\S+)/i) || "";
  const amountStr = g(/จำนวน\s*([\d,]+\.\d{2})\s*฿?/);
  const amount = amountStr ? Number(amountStr.replace(/,/g, "")) : null;
  const bank = g(/ธนาคาร\s*:\s*([^\n]+)/);
  const account = g(/เลขบัญชี\s*:\s*([\d-]+)/)?.replace(/\D/g, "");
  const accountName = g(/ชื่อบัญชี\s*:\s*([^\n]+)/);
  const dateText = g(/เวลา\s*:\s*([^\n]+)/) || "";
  return { username, amount, bank, account, accountName, date: parseDateLoose(dateText), dateText, raw: text.slice(0, 800) };
}

// ===== cache (Setting: aff_notify_cache = { "chatId:username": AffNoti }) =====
const CACHE_KEY = "aff_notify_cache";

export async function cacheNoti(chatId: string, noti: AffNoti) {
  if (!noti.username) return;
  const row = await db.setting.findUnique({ where: { key: CACHE_KEY } });
  const map: Record<string, AffNoti> = row?.value ? JSON.parse(row.value) : {};
  map[`${chatId}:${noti.username.toLowerCase()}`] = noti;
  await db.setting.upsert({
    where: { key: CACHE_KEY },
    update: { value: JSON.stringify(map) },
    create: { key: CACHE_KEY, value: JSON.stringify(map) },
  });
}

export async function getNoti(chatId: string, username: string): Promise<AffNoti | null> {
  if (!username) return null;
  const row = await db.setting.findUnique({ where: { key: CACHE_KEY } });
  if (!row?.value) return null;
  try {
    const map = JSON.parse(row.value) as Record<string, AffNoti>;
    return map[`${chatId}:${username.toLowerCase()}`] || null;
  } catch {
    return null;
  }
}
