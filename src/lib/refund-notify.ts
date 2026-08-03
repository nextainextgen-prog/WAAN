import { db } from "./db";

/**
 * แยกข้อมูลจากข้อความ noti ของบอทระบบ Thunder ([#REQUEST_REFUND_SERVICE])
 *
 * ตัวอย่าง:
 *   ### 🪙 ขอคืนเครดิตบริการ 🪙 ###
 *   โดย kornalone1
 *   [#REQUEST_REFUND_SERVICE]
 *   ----------------------------------------
 *   ผู้ดูแล #591 kornalone1 ได้ยื่นคำร้องขอคืนเครดิต
 *
 *   บริการ #12550 โรงงานลูกชิ้นยายทอง
 *   จำนวน 1,599฿
 *   เหตุผล ต่ออายุผิด
 *   ----------------------------------------
 *   เวลา: 16 ก.ค. 2026, 19:15
 *
 * หมายเหตุสำคัญ: Telegram ไม่ส่งข้อความของ "บอทตัวอื่น" ให้บอทเรา ถ้า Thunder Notify เป็น bot
 * วานจะไม่เห็นข้อความนี้เลย → ระบบหลักจึงยึด poll หน้า /admin/refund ไฟล์นี้เป็นแค่ "ตัวเร่ง"
 * (ถ้าอ่านได้: แจ้งเร็วขึ้น + ได้ ไอดีบริการ/ชื่อร้าน มาตรวจเพิ่ม 2 จุด)
 */

export interface RefundNoti {
  requestedBy: string; // kornalone1
  adminId?: string; // 591
  serviceId?: string; // 12550 (ไอดีบริการ — คนละตัวกับไอดีประวัติ)
  shopName?: string; // โรงงานลูกชิ้นยายทอง
  amount: number | null; // 1599
  reason?: string; // ต่ออายุผิด
  timeText?: string; // 16 ก.ค. 2026, 19:15
  raw: string;
}

export function isRefundNoti(text: string): boolean {
  const t = String(text || "");
  return /#REQUEST_REFUND_SERVICE/.test(t) || (/ขอคืนเครดิตบริการ/.test(t) && /ได้ยื่นคำร้องขอคืนเครดิต/.test(t));
}

export function parseRefundNoti(text: string): RefundNoti | null {
  if (!isRefundNoti(text)) return null;
  const t = String(text);
  const g = (re: RegExp, i = 1) => t.match(re)?.[i]?.trim();

  const requestedBy = g(/^โดย\s+(\S+)/m) || g(/ผู้ดูแล\s*#\d+\s+(\S+)\s+ได้ยื่น/) || "";
  const adminId = g(/ผู้ดูแล\s*#(\d+)/);
  // "บริการ #12550 โรงงานลูกชิ้นยายทอง" — ชื่อร้าน = ที่เหลือทั้งบรรทัด
  const svc = t.match(/บริการ\s*#(\d+)\s*(.*)$/m);
  const amountStr = g(/จำนวน\s*([\d,]+(?:\.\d{2})?)\s*฿/);
  const reason = g(/เหตุผล\s+(.+)$/m);
  const timeText = g(/เวลา\s*:\s*(.+)$/m);

  return {
    requestedBy,
    adminId,
    serviceId: svc?.[1],
    shopName: svc?.[2]?.trim() || undefined,
    amount: amountStr ? Number(amountStr.replace(/,/g, "")) : null,
    reason,
    timeText,
    raw: t.slice(0, 800),
  };
}

// ===== cache: เก็บ noti ไว้รอ poll มาจับคู่ =====
// จับคู่ด้วย requestedBy + amount (คีย์) — พี่โด้ยืนยันว่าเคสต่อเคส แทบไม่มีชนกัน
const CACHE_KEY = "refund_noti_cache";
const TTL_MS = 24 * 60 * 60 * 1000;

type CacheMap = Record<string, RefundNoti & { at: number }>;
const cacheKey = (requestedBy: string, amount: number | null) => `${requestedBy.toLowerCase()}:${amount ?? "?"}`;

async function readCache(): Promise<CacheMap> {
  const row = await db.setting.findUnique({ where: { key: CACHE_KEY } });
  if (!row?.value) return {};
  try {
    return JSON.parse(row.value) as CacheMap;
  } catch {
    return {};
  }
}

export async function cacheRefundNoti(noti: RefundNoti): Promise<void> {
  if (!noti.requestedBy) return;
  const map = await readCache();
  // ล้างของเก่าเกิน 1 วันไปด้วย (กัน Setting บวม)
  const now = Date.now();
  for (const [k, v] of Object.entries(map)) if (now - (v.at || 0) > TTL_MS) delete map[k];
  map[cacheKey(noti.requestedBy, noti.amount)] = { ...noti, at: now };
  await db.setting.upsert({
    where: { key: CACHE_KEY },
    update: { value: JSON.stringify(map) },
    create: { key: CACHE_KEY, value: JSON.stringify(map) },
  });
}

export async function findRefundNoti(requestedBy: string, amount: number | null): Promise<RefundNoti | null> {
  if (!requestedBy) return null;
  const map = await readCache();
  const hit = map[cacheKey(requestedBy, amount)];
  if (!hit) return null;
  if (Date.now() - (hit.at || 0) > TTL_MS) return null;
  return hit;
}
