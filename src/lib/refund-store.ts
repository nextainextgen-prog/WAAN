import { db } from "./db";
import type { RefundRow, ServiceLogRow } from "./thunder-refund";
import type { CheckResult } from "./refund-check";

/**
 * State machine ของเคสคืนเครดิต — กันแจ้งซ้ำ (poll ทุก 2 นาที) และกันคืนซ้ำ (กดปุ่มรัว/บอทรีสตาร์ท)
 *
 * poll เจอแถว ─┬─ nining ────────→ skipped_nining (จบ)
 *              └─ pending ─[ตรวจ]─┬─ flagged (จบ · ธงแดง)
 *                                  └─ notified ─┬─ rejected | expired (จบ)
 *                                               └─ approving ─┬─ approved (จบ)
 *                                                             ├─ stale (มีคนจัดการไปแล้ว)
 *                                                             └─ failed
 */

export type RefundState =
  | "pending"
  | "notified"
  | "approving"
  | "approved"
  | "rejected"
  | "flagged"
  | "stale"
  | "failed"
  | "expired"
  | "skipped_nining";

// เวลาที่ถือว่า approving ค้าง (บอทตายกลางคัน) → reconcile ใหม่ได้
const APPROVING_STUCK_MS = 10 * 60 * 1000;

export async function getCase(refundId: string) {
  return db.refundCase.findUnique({ where: { refundId: String(refundId) } });
}

export async function isKnown(refundId: string): Promise<boolean> {
  return Boolean(await getCase(refundId));
}

// เคสใหม่จาก poll — คืน null ถ้าเคยเห็นแล้ว (กันแจ้งซ้ำ)
export async function createCase(row: RefundRow, opts: { state?: RefundState; serviceId?: string } = {}) {
  if (await isKnown(row.refundId)) return null;
  return db.refundCase.create({
    data: {
      refundId: row.refundId,
      historyId: row.historyId,
      serviceId: opts.serviceId || null,
      username: row.username,
      requestedBy: row.requestedBy,
      amount: row.amount ?? 0,
      reason: row.reason,
      serviceType: row.historyType || null,
      requestedAt: parseThaiDateTime(row.createdAtText),
      state: opts.state || "pending",
    },
  });
}

export async function markSkippedNining(row: RefundRow) {
  return createCase(row, { state: "skipped_nining" });
}

// บันทึกผลตรวจ + ข้อมูลจากหน้าประวัติบริการ
export async function saveChecks(refundId: string, log: ServiceLogRow | null, result: CheckResult) {
  return db.refundCase.update({
    where: { refundId: String(refundId) },
    data: {
      shopName: log?.shopName || null,
      packageName: log?.packageName || null,
      allOk: result.allOk,
      checks: JSON.stringify(result.rows),
      mismatches: JSON.stringify([...result.hardFails, ...result.softFails].map((r) => ({ key: r.key, label: r.label, level: r.level }))),
    },
  });
}

export async function markNotified(refundId: string, chatId: string, messageId: string | null) {
  return db.refundCase.update({
    where: { refundId: String(refundId) },
    data: { state: "notified", chatId, messageId: messageId || null, notifiedAt: new Date() },
  });
}

export async function markFlagged(refundId: string, chatId: string, messageId: string | null) {
  return db.refundCase.update({
    where: { refundId: String(refundId) },
    data: { state: "flagged", chatId, messageId: messageId || null, notifiedAt: new Date() },
  });
}

/**
 * ล็อกเคสก่อนลงมือคืน — กัน 2 คนกดพร้อมกัน
 * คืน { ok:false, reason } ถ้าล็อกไม่ได้ (มีคนกดไปแล้ว/จบไปแล้ว)
 * ใช้ updateMany + เงื่อนไข state เป็น atomic guard (แถวเดียวเพราะ refundId unique)
 */
export async function lockForApprove(
  refundId: string,
  by: { id: string; name: string },
): Promise<{ ok: boolean; reason?: "not_found" | "already_done" | "in_progress" }> {
  const cur = await getCase(refundId);
  if (!cur) return { ok: false, reason: "not_found" };

  if (cur.state === "approving") {
    // ค้างนานเกิน = บอทตายกลางคัน → ปล่อยให้ลองใหม่ได้
    const stuck = Date.now() - new Date(cur.updatedAt).getTime() > APPROVING_STUCK_MS;
    if (!stuck) return { ok: false, reason: "in_progress" };
  } else if (cur.state !== "notified" && cur.state !== "pending") {
    return { ok: false, reason: "already_done" };
  }

  const res = await db.refundCase.updateMany({
    where: { refundId: String(refundId), state: cur.state },
    data: { state: "approving", decidedBy: by.name, decidedById: by.id, decidedAt: new Date() },
  });
  if (res.count === 0) return { ok: false, reason: "in_progress" }; // มีคนชิงล็อกไปก่อน
  return { ok: true };
}

export async function markApproved(refundId: string) {
  return db.refundCase.update({ where: { refundId: String(refundId) }, data: { state: "approved", error: null } });
}

export async function markRejected(refundId: string, by: { id: string; name: string }) {
  return db.refundCase.update({
    where: { refundId: String(refundId) },
    data: { state: "rejected", decidedBy: by.name, decidedById: by.id, decidedAt: new Date() },
  });
}

export async function markState(refundId: string, state: RefundState, error?: string) {
  return db.refundCase.update({
    where: { refundId: String(refundId) },
    data: { state, ...(error ? { error: String(error).slice(0, 500) } : {}) },
  });
}

// เคสที่รอแอดมินกดอยู่ — ไว้เตือนซ้ำ / ปิดปุ่มเมื่อหมดอายุ
export async function listWaiting() {
  return db.refundCase.findMany({ where: { state: "notified" }, orderBy: { createdAt: "asc" } });
}

export async function markReminded(refundId: string) {
  return db.refundCase.update({ where: { refundId: String(refundId) }, data: { remindedAt: new Date() } });
}

// ===== วันที่ไทยจากตาราง: "16 ก.ค. 2026, 19:15" → Date =====
const TH_MONTHS: Record<string, number> = {
  "ม.ค.": 0, "ก.พ.": 1, "มี.ค.": 2, "เม.ย.": 3, "พ.ค.": 4, "มิ.ย.": 5,
  "ก.ค.": 6, "ส.ค.": 7, "ก.ย.": 8, "ต.ค.": 9, "พ.ย.": 10, "ธ.ค.": 11,
};

export function parseThaiDateTime(s: string): Date | null {
  const m = String(s || "").match(/(\d{1,2})\s*([ก-๙.]+)\s*(\d{4})[,\s]*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const mon = TH_MONTHS[m[2]];
  if (mon === undefined) return null;
  // ระบบ Thunder ใช้ปี ค.ศ. (2026) ไม่ใช่ พ.ศ. — ยืนยันแล้วจาก thunder-expiry
  const year = Number(m[3]) > 2400 ? Number(m[3]) - 543 : Number(m[3]);
  return new Date(year, mon, Number(m[1]), Number(m[4]), Number(m[5]));
}
