import { db } from "./db";
import { statusLabel, formatBaht } from "./grants";
import { formatThaiDate } from "./grants";

export type GrantEventKind = "created" | "status" | "installment" | "edited";

interface LogOpts {
  fromStatus?: string | null;
  toStatus?: string | null;
  actor?: string | null;
}

/** บันทึกความเคลื่อนไหวของทุน — เงียบเสมอ ห้ามทำให้ request หลักล้ม */
export async function logGrantEvent(
  grantId: string,
  kind: GrantEventKind,
  detail: string,
  opts: LogOpts = {},
) {
  try {
    await db.grantEvent.create({
      data: {
        grantId,
        kind,
        detail,
        fromStatus: opts.fromStatus ?? null,
        toStatus: opts.toStatus ?? null,
        actor: opts.actor ?? null,
      },
    });
  } catch (e) {
    console.error("logGrantEvent failed:", e);
  }
}

export function statusChangeDetail(from: string, to: string): string {
  return `เปลี่ยนสถานะ ${statusLabel(from)} → ${statusLabel(to)}`;
}

export function installmentReceivedDetail(label: string, amount: number, at: Date): string {
  return `รับเงิน ${label} ${formatBaht(amount)} เมื่อ ${formatThaiDate(at)}`;
}

/** วันที่ทุนเข้าสถานะปัจจุบัน (ใช้หาว่าค้างมากี่วัน) */
export async function statusSince(grantId: string, fallback: Date): Promise<Date> {
  const last = await db.grantEvent.findFirst({
    where: { grantId, kind: "status" },
    orderBy: { createdAt: "desc" },
  });
  return last?.createdAt ?? fallback;
}
