import { listPendingRefunds, fetchServiceLog, type RefundRow, type ServiceLogRow } from "./thunder-refund";
import { checkRefund, refundCardHtml, type CheckResult } from "./refund-check";
import { findRefundNoti, type RefundNoti } from "./refund-notify";
import { createCase, markSkippedNining, isKnown, saveChecks, markNotified, markFlagged } from "./refund-store";
import { listGroupsWithFunc } from "./roles";
import { listMutedChatIds } from "./mute";
import { renderHtmlToPng } from "./html-pdf";
import { tgSendPhoto } from "./telegram";
import { logActivity } from "./activity";
import { db } from "./db";

/**
 * ฟลว์เฝ้า+ตรวจ+แจ้ง คำขอคืนเครดิต (เฟส 1 — read-only ไม่แตะข้อมูลลูกค้า)
 * เรียกจาก /api/telegram/refund-poll ทุก 2 นาที (scripts/refund-watch.mjs)
 */

const SKIP_REQUESTERS = ["nining"]; // ร้องขอโดยคนนี้ = ไม่ต้องแจ้ง (โด้ระบุ)
const SESSION_WARN_KEY = "refund_session_warned"; // กันสแปมเตือน session หมดทุก 2 นาที

export interface PollSummary {
  ok: boolean;
  error?: string;
  scanned: number;
  pending: number;
  skipped: number;
  known: number;
  notified: number;
  flagged: number;
  reminded?: number;
  expired?: number;
  cases: string[];
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
const fmtBaht = (n: number | null | undefined) => (n == null ? "-" : `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

// ===== ข้อความในกลุ่ม =====
export function summaryText(o: { refund: RefundRow; log: ServiceLogRow; result: CheckResult; noti?: RefundNoti | null }): string {
  const { refund, log, result } = o;
  const soft = result.softFails.length
    ? `\n<b>ข้อควรดู</b>  ${result.softFails.map((f) => esc(f.label)).join(" · ")}`
    : "";
  return [
    `📤 <b>คำขอคืนเครดิตบริการ</b>`,
    ``,
    `<b>ผู้ขอ</b>  ${esc(refund.requestedBy)}`,
    `<b>ยูสเซอร์</b>  ${esc(refund.username)} · ${esc(log.shopName || "-")}`,
    `<b>ประวัติบริการ</b>  #${esc(refund.historyId)} · ${esc((log.type || "").toUpperCase())} · ${esc(log.packageName || "-")}`,
    `<b>ยอด</b>  ${fmtBaht(refund.amount)}`,
    `<b>เหตุผล</b>  ${esc(refund.reason)}`,
    `<b>เวลา</b>  ${esc(refund.createdAtText)} · คำขอ #${esc(refund.refundId)}`,
    ``,
    `วานตรวจแล้ว ${result.passed}/${result.total} จุด ตรงกันทั้งหมด ✅${soft}`,
    ``,
    `คืนเครดิตให้เลยไหมคะ`,
  ].join("\n");
}

export function flaggedText(o: { refund: RefundRow; log: ServiceLogRow | null; result: CheckResult | null; reason?: string }): string {
  const { refund, log, result } = o;
  const lines = result?.hardFails.length
    ? result.hardFails.map((f) => {
        const parts = [f.refund && `หน้าคืนเงิน ${esc(f.refund)}`, f.log && `ประวัติบริการ ${esc(f.log)}`, f.noti && `บอทแจ้ง ${esc(f.noti)}`].filter(Boolean);
        return `• <b>${esc(f.label)}</b> — ${parts.join(" · ") || "ข้อมูลไม่ครบ"}`;
      })
    : [`• ${esc(o.reason || "ตรวจข้อมูลไม่สำเร็จ")}`];
  return [
    `⚠️ <b>คำขอคืนเครดิตนี้ข้อมูลไม่ตรง — ยังไม่คืนให้นะคะ</b>`,
    ``,
    `<b>ผู้ขอ</b>  ${esc(refund.requestedBy)} · คำขอ #${esc(refund.refundId)}`,
    `<b>ยูสเซอร์</b>  ${esc(refund.username)}${log?.shopName ? ` · ${esc(log.shopName)}` : ""} · ยอด ${fmtBaht(refund.amount)}`,
    ``,
    `<b>จุดที่ไม่ตรง</b>`,
    ...lines,
    ``,
    `วานไม่กล้าคืนเอง ขอให้คนตรวจก่อนนะคะ`,
  ].join("\n");
}

// ===== ข้อความทักทันที + แก้เป็นสถานะสด =====
// เหตุผล: ตั้งแต่เจอคำขอจนโพสต์การ์ดใช้เวลา ~20-40 วิ (เปิด 2 หน้า + เรนเดอร์การ์ด)
// ถ้าเงียบ แอดมินจะไม่รู้ว่าวานเห็นแล้วหรือหลุด → ทักก่อนทำงานเสมอ แล้วแก้ข้อความเดิมไปเรื่อยๆ
async function tgEditText(chatId: string, messageId: string, text: string) {
  const { getBotToken } = await import("./telegram");
  const token = getBotToken();
  if (!token || !messageId) return;
  await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: Number(messageId), text, parse_mode: "HTML" }),
  }).catch(() => {});
}

// บรรทัดระบุตัวคำขอ — ใส่ "ผู้ดูแล #41144" / "บริการ #56678 ชื่อร้าน" เฉพาะตอนอ่าน noti บอทได้
function ackWho(refund: RefundRow, noti?: RefundNoti | null): string {
  const admin = noti?.adminId ? `ผู้ดูแล #${esc(noti.adminId)} ${esc(refund.requestedBy)}` : `ผู้ดูแล ${esc(refund.requestedBy)}`;
  const svc = noti?.serviceId ? `\n<b>บริการ</b>  #${esc(noti.serviceId)}${noti.shopName ? ` ${esc(noti.shopName)}` : ""}` : "";
  return `<b>โดย</b>  ${admin}${svc}`;
}

async function sendAck(groups: string[], refund: RefundRow, noti?: RefundNoti | null): Promise<{ chatId: string; messageId: string } | null> {
  const { tgSendMessage } = await import("./telegram");
  const text = [
    `🔔 <b>มีคำขอคืนเครดิตเข้ามาใหม่</b>`,
    ``,
    `<b>คำขอ</b>  #${esc(refund.refundId)}`,
    ackWho(refund, noti),
    `<b>ยอด</b>  ${fmtBaht(refund.amount)} · <b>เหตุผล</b> ${esc(refund.reason)}`,
    ``,
    `⏳ ขอเวลาตรวจสอบข้อมูลข้ามหน้าสักครู่นะคะ เดี๋ยววานสรุปผล + ปุ่มกดคืนมาให้ในข้อความนี้เลยค่ะ`,
  ].join("\n");
  const chatId = groups[0];
  if (!chatId) return null;
  const res = await tgSendMessage(chatId, text, { parse_mode: "HTML" });
  const mid = (res as { result?: { message_id?: number } })?.result?.message_id;
  return mid ? { chatId, messageId: String(mid) } : null;
}

function buttons(refundId: string) {
  return {
    inline_keyboard: [
      [
        { text: "✅ คืนเลย", callback_data: `tref:ok:${refundId}` },
        { text: "❌ ไม่ต้อง", callback_data: `tref:no:${refundId}` },
      ],
      [{ text: "🔎 ดูรายละเอียด", callback_data: `tref:detail:${refundId}` }],
    ],
  };
}

// ===== เตือน session หมด (ครั้งเดียว ไม่สแปม) =====
async function warnSessionOnce(chatIds: string[], kind: string) {
  // กันเตือนผิด: ถ้า JWT ยังไม่หมดจริง แปลว่าเป็นปัญหาชั่วคราว ไม่ใช่ session หมด → ไม่ต้องปลุกโด้
  if (kind === "session_expired") {
    const { thunderSessionExpiry } = await import("./thunder-refund");
    const at = thunderSessionExpiry();
    if (at && at.getTime() > Date.now()) return;
  }
  const row = await db.setting.findUnique({ where: { key: SESSION_WARN_KEY } });
  if (row?.value === kind) return; // เตือนไปแล้ว รอจนกว่าจะกลับมาปกติ
  await db.setting.upsert({ where: { key: SESSION_WARN_KEY }, update: { value: kind }, create: { key: SESSION_WARN_KEY, value: kind } });
  const text =
    kind === "no_session"
      ? "⚠️ วานยังเข้าระบบหลังบ้าน Thunder ไม่ได้ค่ะ (ยังไม่มี session)\nรบกวนพี่โด้รัน <code>npm run thunder:auth</code> ให้หน่อยนะคะ"
      : "⚠️ session ระบบหลังบ้าน Thunder หมดอายุแล้วค่ะ วานเฝ้าคำขอคืนเครดิตต่อไม่ได้\nรบกวนพี่โด้รัน <code>npm run thunder:auth</code> ให้หน่อยนะคะ";
  for (const chatId of chatIds) await tgSendText(chatId, text);
  await logActivity({ source: "thunder", kind: "refund-session", severity: "warn", summary: `เฝ้าคำขอคืนเครดิตไม่ได้ — ${kind}` });
}

async function clearSessionWarn() {
  await db.setting.deleteMany({ where: { key: SESSION_WARN_KEY } }).catch(() => {});
}

// เตือนล่วงหน้า 12 ชม. ก่อน token หมด — เตือนครั้งเดียวต่อ 1 token (คีย์ = เวลาหมดอายุ)
const SOON_KEY = "refund_session_soon_warned";
const WARN_BEFORE_HOURS = 12;

async function warnSessionSoon(chatIds: string[]) {
  const { thunderSessionExpiringWithin } = await import("./thunder-refund");
  const { soon, at } = thunderSessionExpiringWithin(WARN_BEFORE_HOURS);
  if (!soon || !at) return;
  const key = String(at.getTime());
  const row = await db.setting.findUnique({ where: { key: SOON_KEY } });
  if (row?.value === key) return; // token นี้เตือนไปแล้ว
  await db.setting.upsert({ where: { key: SOON_KEY }, update: { value: key }, create: { key: SOON_KEY, value: key } });
  const left = Math.round((at.getTime() - Date.now()) / 3600000);
  const when = at.toLocaleString("th-TH-u-ca-gregory", { dateStyle: "medium", timeStyle: "short" });
  for (const chatId of chatIds) {
    await tgSendText(
      chatId,
      `🔑 session ระบบหลังบ้าน Thunder จะหมดอายุใน ~${left} ชม. (${esc(when)})\nรบกวนพี่โด้รัน <code>npm run thunder:auth</code> เผื่อไว้นะคะ ไม่งั้นวานจะเฝ้าคำขอคืนเครดิตต่อไม่ได้ค่ะ`,
    );
  }
  await logActivity({ source: "thunder", kind: "refund-session-soon", severity: "warn", summary: `session Thunder จะหมดใน ~${left} ชม. (${when}) — เตือนให้ re-auth ล่วงหน้า` });
}

async function tgSendText(chatId: string, text: string) {
  const { tgSendMessage } = await import("./telegram");
  return tgSendMessage(chatId, text, { parse_mode: "HTML" });
}

// ===== ฟลว์หลัก =====
export async function pollRefunds(): Promise<PollSummary> {
  const out: PollSummary = { ok: true, scanned: 0, pending: 0, skipped: 0, known: 0, notified: 0, flagged: 0, cases: [] };

  const allGroups = await listGroupsWithFunc("thunder_refund");
  const muted = new Set(await listMutedChatIds());
  const groups = allGroups.filter((g) => !muted.has(String(g)));
  if (!allGroups.length) return { ...out, ok: false, error: "no_group" }; // ยังไม่ได้ผูกกลุ่ม → ไม่ต้องเปิด browser

  // เตือนซ้ำ/ปิดปุ่มเคสที่ค้าง (ไม่พึ่ง browser — ทำก่อนเสมอ แม้ session หลังบ้านจะหมด)
  const sweep = await sweepWaiting().catch(() => ({ reminded: 0, expired: 0 }));
  out.reminded = sweep.reminded;
  out.expired = sweep.expired;

  // เตือนล่วงหน้าก่อน session หมด (token อายุ 3 วัน) — กันไปรู้เอาตอนมีคำขอเข้ามาแล้วทำงานไม่ได้
  await warnSessionSoon(groups);

  const list = await listPendingRefunds();
  out.scanned = list.scanned;
  if (!list.ok) {
    // เตือนให้ re-auth เฉพาะตอน token หมดจริงเท่านั้น — เปิดหน้าไม่ติดชั่วคราว (render_failed) แค่รอรอบหน้า เงียบๆ
    if (list.error === "no_session" || list.error === "session_expired") {
      await warnSessionOnce(groups, String(list.error));
    } else {
      await logActivity({
        source: "thunder",
        kind: "refund-poll-error",
        severity: "warn",
        summary: `เฝ้าคำขอคืนเครดิตรอบนี้ไม่สำเร็จ (${list.error}) — token ยังดี จะลองใหม่รอบหน้า`,
      });
    }
    return { ...out, ok: false, error: String(list.error) };
  }
  await clearSessionWarn();
  out.pending = list.pending.length;

  for (const refund of list.pending) {
    // 1) กฎ nining — ข้ามเงียบ (บันทึกไว้กัน poll หยิบซ้ำทุกรอบ)
    if (SKIP_REQUESTERS.includes(refund.requestedBy.trim().toLowerCase())) {
      if (!(await isKnown(refund.refundId))) {
        await markSkippedNining(refund);
        out.skipped++;
      }
      continue;
    }

    // 2) เคยเห็นแล้ว = เคยแจ้งแล้ว/จัดการแล้ว → ข้าม
    if (await isKnown(refund.refundId)) {
      out.known++;
      continue;
    }

    // 3) เคสใหม่
    const noti = await findRefundNoti(refund.requestedBy, refund.amount);
    const created = await createCase(refund, { serviceId: noti?.serviceId });
    if (!created) continue; // แข่งกับรอบ poll ก่อนหน้า — อีกรอบสร้างไปแล้ว
    out.cases.push(refund.refundId);

    // ทักทันทีก่อนลงมือ (ให้แอดมินเห็นว่าวานรับงานแล้ว ไม่ได้หลุด) แล้วแก้ข้อความนี้เป็นสถานะสด
    const ack = await sendAck(groups, refund, noti);

    // 4) ยืนยันข้ามที่หน้าประวัติบริการ
    if (ack)
      await tgEditText(
        ack.chatId,
        ack.messageId,
        `🔍 <b>กำลังยืนยันข้อมูลกับหน้าประวัติบริการ</b> #${esc(refund.historyId)}...\n\nคำขอ #${esc(refund.refundId)} · ${esc(refund.requestedBy)} · ${fmtBaht(refund.amount)}`,
      );
    const logRes = await fetchServiceLog(refund.historyId, { shot: false });
    if (!logRes.ok || !logRes.row) {
      const reason =
        logRes.error === "multiple_rows"
          ? `ไอดีประวัติ #${refund.historyId} ค้นแล้วเจอ ${logRes.rowCount} รายการ (ปกติต้องเจอรายการเดียว)`
          : logRes.error === "not_found"
            ? `ค้นไอดีประวัติ #${refund.historyId} ในหน้าประวัติบริการไม่เจอ`
            : `เปิดหน้าประวัติบริการไม่ได้ (${logRes.error})`;
      if (ack) await tgEditText(ack.chatId, ack.messageId, `⚠️ <b>ตรวจคำขอ #${esc(refund.refundId)} ไม่สำเร็จ</b> — รายละเอียดอยู่ข้อความถัดไป`);
      const res = await sendFlagged(groups, refund, null, null, reason);
      await markFlagged(refund.refundId, res.chatId, res.messageId);
      out.flagged++;
      continue;
    }
    const log = logRes.row;

    // 5) ตรวจ
    if (ack)
      await tgEditText(
        ack.chatId,
        ack.messageId,
        `⚙️ <b>กำลังสรุปผลการตรวจ</b>...\n\nคำขอ #${esc(refund.refundId)} · ${esc(log.username)} · ${esc(log.shopName || "-")} · ${fmtBaht(refund.amount)}`,
      );
    const result = checkRefund(refund, log, noti);
    await saveChecks(refund.refundId, log, result);

    // 6) แจ้ง
    if (!result.allOk) {
      if (ack) await tgEditText(ack.chatId, ack.messageId, `⚠️ <b>คำขอ #${esc(refund.refundId)} ข้อมูลไม่ตรง</b> — รายละเอียดอยู่ข้อความถัดไป`);
      const res = await sendFlagged(groups, refund, log, result);
      await markFlagged(refund.refundId, res.chatId, res.messageId);
      out.flagged++;
      await logActivity({
        source: "thunder",
        kind: "refund-flagged",
        severity: "warn",
        summary: `คำขอคืนเครดิต #${refund.refundId} (${refund.username} ${fmtBaht(refund.amount)}) ข้อมูลไม่ตรง: ${result.hardFails.map((f) => f.label).join(", ")}`,
        requestedBy: refund.requestedBy,
        outcome: "flagged",
      });
      continue;
    }

    if (ack)
      await tgEditText(
        ack.chatId,
        ack.messageId,
        `✅ <b>ตรวจเสร็จแล้วค่ะ</b> — สรุปอยู่ข้อความถัดไป\n\nคำขอ #${esc(refund.refundId)} · ${esc(log.username)} · ${esc(log.shopName || "-")} · ${fmtBaht(refund.amount)}`,
      );
    const res = await sendForApproval(groups, refund, log, result, noti);
    await markNotified(refund.refundId, res.chatId, res.messageId);
    out.notified++;
    await logActivity({
      source: "thunder",
      kind: "refund-ask",
      summary: `คำขอคืนเครดิต #${refund.refundId} — ${refund.username} ${fmtBaht(refund.amount)} (${refund.reason}) ตรวจผ่าน ${result.passed}/${result.total} รอแอดมินกดคืน`,
      requestedBy: refund.requestedBy,
      outcome: "waiting",
    });
  }

  return out;
}

// ===== ปุ่มในกลุ่ม =====
// เฟส 1: "คืนเลย" ยังไม่ต่อ write path (ยังไม่กดอนุมัติจริงในระบบ) — เฟส 2 ค่อยเปิด
export interface ButtonResult {
  answer: string;
  sends: { kind: string; text?: string; parseMode?: string; dataBase64?: string; caption?: string }[];
}

export async function handleRefundButton(
  action: "ok" | "no" | "detail",
  refundId: string,
  by: { id: string; name: string },
): Promise<ButtonResult> {
  const { getCase, markRejected, lockForApprove, markState, markApproved } = await import("./refund-store");
  const c = await getCase(refundId);
  if (!c) return { answer: "ไม่พบเคสนี้", sends: [{ kind: "text", text: `ไม่พบคำขอ #${esc(refundId)} ในระบบของวานค่ะ` }] };

  if (action === "detail") {
    const rows: CheckRowLite[] = c.checks ? JSON.parse(c.checks) : [];
    const lines = rows.map((r) => {
      const mark = r.ok === true ? "✅" : r.ok === false ? "❌" : "—";
      const vals = [r.refund && `คืนเงิน: ${esc(r.refund)}`, r.log && `ประวัติ: ${esc(r.log)}`, r.noti && `บอท: ${esc(r.noti)}`].filter(Boolean);
      return `${mark} <b>${esc(r.label)}</b>${vals.length ? `\n     ${vals.join(" · ")}` : ""}`;
    });
    return {
      answer: "",
      sends: [
        {
          kind: "text",
          parseMode: "HTML",
          text: [
            `🔎 <b>รายละเอียดการตรวจ คำขอ #${esc(c.refundId)}</b>`,
            `ยูสเซอร์ ${esc(c.username)} · ${esc(c.shopName || "-")} · ${fmtBaht(c.amount)}`,
            `ร้องขอโดย ${esc(c.requestedBy)} · ไอดีประวัติ #${esc(c.historyId)}`,
            ``,
            ...lines,
          ].join("\n"),
        },
      ],
    };
  }

  if (action === "no") {
    if (c.state !== "notified" && c.state !== "pending") {
      return { answer: "เคสนี้จัดการไปแล้ว", sends: [{ kind: "text", text: `คำขอ #${esc(c.refundId)} จัดการไปแล้วค่ะ (สถานะ: ${esc(stateLabel(c.state))})` }] };
    }
    await markRejected(refundId, by);
    await logActivity({
      source: "thunder",
      kind: "refund-reject",
      summary: `${by.name || "แอดมิน"} สั่งไม่คืนเครดิตคำขอ #${c.refundId} (${c.username} ${fmtBaht(c.amount)})`,
      requestedBy: c.requestedBy,
      outcome: "rejected",
    });
    return {
      answer: "รับทราบค่ะ",
      sends: [{ kind: "text", parseMode: "HTML", text: `รับทราบค่ะ — <b>ไม่คืน</b>เครดิตคำขอ #${esc(c.refundId)} (${esc(c.username)} · ${fmtBaht(c.amount)})\nถ้าเปลี่ยนใจ กดคืนในระบบเองได้เลยนะคะ` }],
    };
  }

  // ===== action === "ok" — ลงมือคืนจริง =====
  const lock = await lockForApprove(refundId, by);
  if (!lock.ok) {
    const msg =
      lock.reason === "in_progress"
        ? "กำลังดำเนินการอยู่ค่ะ รอสักครู่นะคะ"
        : `คำขอ #${esc(c.refundId)} จัดการไปแล้วค่ะ (สถานะ: ${esc(stateLabel(c.state))})`;
    return { answer: "มีคนกดไปแล้ว", sends: [{ kind: "text", text: msg }] };
  }

  const { approveRefund, shotRefundRow } = await import("./thunder-refund");
  const res = await approveRefund(refundId, { username: c.username, amount: c.amount, historyId: c.historyId });

  if (!res.ok) {
    // stale = มีคนจัดการไปแล้วในระบบระหว่างรอกด — ไม่ใช่ error ของเรา
    if (res.error === "stale") {
      await markState(refundId, "stale");
      await logActivity({
        source: "thunder",
        kind: "refund-stale",
        severity: "warn",
        summary: `คำขอ #${c.refundId} ถูกจัดการในระบบไปแล้วก่อนที่ ${by.name || "แอดมิน"} จะกดคืน (สถานะ ${res.statusBefore})`,
        requestedBy: c.requestedBy,
        outcome: "stale",
      });
      return {
        answer: "มีคนจัดการไปแล้ว",
        sends: [
          {
            kind: "text",
            parseMode: "HTML",
            text: `คำขอ #${esc(c.refundId)} มีคนจัดการในระบบไปแล้วค่ะ (ตอนนี้สถานะ <b>${esc(res.statusBefore || "-")}</b>) วานเลยไม่ได้กดซ้ำให้นะคะ`,
          },
        ],
      };
    }

    await markState(refundId, "failed", String(res.error));
    await logActivity({
      source: "thunder",
      kind: "refund-failed",
      severity: "error",
      summary: `คืนเครดิตคำขอ #${c.refundId} (${c.username} ${fmtBaht(c.amount)}) ไม่สำเร็จ: ${res.error}`,
      requestedBy: c.requestedBy,
      outcome: `failed:${res.error}`,
    });
    const ownerId = await (await import("./telegram")).getAllowedChatId();
    const tag = ownerId ? `\n<a href="tg://user?id=${ownerId}">พี่โด้</a> รบกวนดูให้หน่อยค่ะ` : "";
    return { answer: "ไม่สำเร็จ", sends: [{ kind: "text", parseMode: "HTML", text: `❌ วานคืนเครดิตคำขอ #${esc(c.refundId)} ไม่สำเร็จค่ะ\n<b>สาเหตุ</b> ${esc(failLabel(res.error))}\n\nยังไม่มีการคืนเกิดขึ้น รบกวนกดในระบบเองนะคะ${tag}` }] };
  }

  // สำเร็จ — ระบบยืนยันสถานะเป็น "อนุมัติแล้ว" จริงแล้ว
  await markApproved(refundId);
  await logActivity({
    source: "thunder",
    kind: "refund-approved",
    summary: `คืนเครดิตคำขอ #${c.refundId} ให้ ${c.username} (${c.shopName || "-"}) ${fmtBaht(c.amount)} เหตุผล ${c.reason} — ${by.name || "แอดมิน"} เป็นคนกดอนุมัติ`,
    requestedBy: c.requestedBy,
    customer: c.username,
    admin: by.name || undefined,
    outcome: "approved",
  });

  const shot = await shotRefundRow(refundId);
  const who = await mentionRequester(c.requestedBy);
  const now = new Date().toLocaleString("th-TH-u-ca-gregory", { dateStyle: "medium", timeStyle: "short" });
  const text = [
    `✅ <b>คืนเครดิตเรียบร้อยแล้วค่ะ</b>`,
    ``,
    `<b>คำขอ</b>  #${esc(c.refundId)} · ${esc(c.username)} · ${esc(c.shopName || "-")}`,
    `<b>ยอด</b>  ${fmtBaht(c.amount)} · เหตุผล ${esc(c.reason)}`,
    `<b>สถานะในระบบ</b>  รออนุมัติ → อนุมัติแล้ว`,
    `<b>อนุมัติโดย</b>  ${esc(by.name || "แอดมิน")} · ${esc(now)}`,
    ``,
    `${who} คืนเครดิตให้เรียบร้อยแล้วนะคะ`,
  ].join("\n");

  const sends: ButtonResult["sends"] = [{ kind: "text", parseMode: "HTML", text }];
  if (shot.shotBase64) sends.push({ kind: "photo", dataBase64: shot.shotBase64, caption: `คำขอ #${c.refundId} — อนุมัติแล้ว` });
  return { answer: "คืนเรียบร้อย ✅", sends };
}

// แท็กแอดมินที่ยื่นคำร้อง: หาใน roster ก่อน (ได้ลิงก์แท็กจริง) ไม่เจอค่อยใช้ @username ตรงๆ
async function mentionRequester(requestedBy: string): Promise<string> {
  try {
    const { findMemberByName } = await import("./team");
    const m = await findMemberByName(requestedBy);
    if (m?.id) return `<a href="tg://user?id=${m.id}">${esc(m.name || requestedBy)}</a>`;
  } catch {
    /* ไม่มีใน roster ก็ไม่เป็นไร */
  }
  return `@${esc(requestedBy)}`;
}

function failLabel(e?: string): string {
  return (
    {
      no_session: "session ระบบหลังบ้านหมดอายุ (ต้องรัน npm run thunder:auth)",
      session_expired: "session ระบบหลังบ้านหมดอายุ (ต้องรัน npm run thunder:auth)",
      not_found: "หาคำขอนี้ในระบบไม่เจอ",
      multiple_rows: "ค้นแล้วเจอหลายรายการ (ผิดปกติ)",
      wrong_row: "ข้อมูลในระบบไม่ตรงกับตอนที่วานแจ้ง — วานเลยไม่กล้ากด",
      menu_not_found: "กดปุ่มสถานะแล้วเมนูไม่ขึ้น",
      approve_item_not_found: "ไม่เจอปุ่ม 'อนุมัติ' ในเมนู",
      status_unchanged: "กดอนุมัติแล้วแต่สถานะในระบบยังไม่เปลี่ยน",
    }[e || ""] || e || "ไม่ทราบสาเหตุ"
  );
}

interface CheckRowLite {
  label: string;
  refund: string;
  log: string;
  noti: string;
  ok: boolean | null;
}

function stateLabel(s: string): string {
  return (
    {
      pending: "รอตรวจ",
      notified: "รอแอดมินกด",
      approving: "กำลังคืน",
      approved: "คืนแล้ว",
      rejected: "สั่งไม่คืน",
      flagged: "ข้อมูลไม่ตรง",
      stale: "มีคนจัดการไปแล้ว",
      failed: "คืนไม่สำเร็จ",
      expired: "หมดเวลา",
      skipped_nining: "ข้าม (nining)",
    }[s] || s
  );
}

// ===== เคสที่แอดมินยังไม่กด — เตือนซ้ำ 1 ครั้งที่ 30 นาที · ปิดปุ่มที่ 6 ชม. =====
// เรียกทุกรอบ poll (กลุ่มนี้ auto-delete 1 วัน ปุ่มค้างข้ามวันไม่มีประโยชน์)
const REMIND_AFTER_MS = 30 * 60 * 1000;
const EXPIRE_AFTER_MS = 6 * 60 * 60 * 1000;

export async function sweepWaiting(): Promise<{ reminded: number; expired: number }> {
  const { listWaiting, markReminded, markState } = await import("./refund-store");
  const { tgSendMessage } = await import("./telegram");
  const out = { reminded: 0, expired: 0 };
  const waiting = await listWaiting();
  const now = Date.now();

  for (const c of waiting) {
    const since = now - new Date(c.notifiedAt || c.createdAt).getTime();
    if (!c.chatId) continue;

    if (since > EXPIRE_AFTER_MS) {
      await markState(c.refundId, "expired");
      await clearButtons(c.chatId, c.messageId);
      await tgSendMessage(
        c.chatId,
        `⏰ คำขอ #${esc(c.refundId)} (${esc(c.username)} · ${fmtBaht(c.amount)}) ไม่มีใครกดเกิน 6 ชั่วโมง วานปิดปุ่มไปก่อนนะคะ\nถ้ายังต้องการคืน กดในระบบเองได้เลยค่ะ`,
        { parse_mode: "HTML" },
      );
      out.expired++;
      await logActivity({
        source: "thunder",
        kind: "refund-expired",
        severity: "warn",
        summary: `คำขอคืนเครดิต #${c.refundId} (${c.username} ${fmtBaht(c.amount)}) ไม่มีใครกดเกิน 6 ชม. — ปิดปุ่ม`,
        requestedBy: c.requestedBy,
        outcome: "expired",
      });
      continue;
    }

    if (since > REMIND_AFTER_MS && !c.remindedAt) {
      await tgSendMessage(
        c.chatId,
        `🔔 ยังมีคำขอคืนเครดิตรออยู่นะคะ — #${esc(c.refundId)} · ${esc(c.username)} · ${fmtBaht(c.amount)} (${esc(c.reason)})\nรอมา ${Math.round(since / 60000)} นาทีแล้วค่ะ`,
        { parse_mode: "HTML", ...(c.messageId ? { reply_to_message_id: Number(c.messageId) } : {}) },
      );
      await markReminded(c.refundId);
      out.reminded++;
    }
  }
  return out;
}

async function clearButtons(chatId: string, messageId: string | null) {
  if (!messageId) return;
  const { getBotToken } = await import("./telegram");
  const token = getBotToken();
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: Number(messageId), reply_markup: { inline_keyboard: [] } }),
  }).catch(() => {});
}

async function renderCard(refund: RefundRow, log: ServiceLogRow, result: CheckResult): Promise<Buffer | null> {
  try {
    return await renderHtmlToPng(refundCardHtml({ refund, log, result }), { width: 1180, height: 700 });
  } catch {
    return null;
  }
}

async function sendForApproval(
  groups: string[],
  refund: RefundRow,
  log: ServiceLogRow,
  result: CheckResult,
  noti: RefundNoti | null,
): Promise<{ chatId: string; messageId: string | null }> {
  const { tgSendMessage } = await import("./telegram");
  const text = summaryText({ refund, log, result, noti });
  const card = await renderCard(refund, log, result);
  const kb = { parse_mode: "HTML" as const, reply_markup: buttons(refund.refundId) };
  let first: { chatId: string; messageId: string | null } = { chatId: groups[0] || "", messageId: null };
  for (const chatId of groups) {
    // การ์ดเรนเดอร์ไม่ได้ → ส่งข้อความอย่างเดียว แต่ต้องมีปุ่มเสมอ
    const res = card
      ? await tgSendPhoto(chatId, card, text, `refund-${refund.refundId}.png`, kb)
      : await tgSendMessage(chatId, text, kb);
    const mid = (res as { result?: { message_id?: number } })?.result?.message_id;
    if (chatId === groups[0]) first = { chatId, messageId: mid ? String(mid) : null };
  }
  return first;
}

async function sendFlagged(
  groups: string[],
  refund: RefundRow,
  log: ServiceLogRow | null,
  result: CheckResult | null,
  reason?: string,
): Promise<{ chatId: string; messageId: string | null }> {
  const { tgSendMessage, getAllowedChatId } = await import("./telegram");
  // แท็กโด้ด้วย tg://user?id= (แบบเดียวกับ callback route) — ใช้ chat id เจ้าของที่ผูกไว้ ไม่พึ่ง env ที่ไม่มีจริง
  const ownerId = await getAllowedChatId();
  const mention = ownerId ? `\n<a href="tg://user?id=${ownerId}">พี่โด้</a> รบกวนดูให้หน่อยค่ะ` : "";
  const text = flaggedText({ refund, log, result, reason }) + mention;
  const card = log && result ? await renderCard(refund, log, result) : null;
  let first: { chatId: string; messageId: string | null } = { chatId: groups[0] || "", messageId: null };
  for (const chatId of groups) {
    const res = card
      ? await tgSendPhoto(chatId, card, text, `refund-${refund.refundId}.png`, { parse_mode: "HTML" })
      : await tgSendMessage(chatId, text, { parse_mode: "HTML" });
    const mid = (res as { result?: { message_id?: number } })?.result?.message_id;
    if (chatId === groups[0]) first = { chatId, messageId: mid ? String(mid) : null };
  }
  return first;
}
