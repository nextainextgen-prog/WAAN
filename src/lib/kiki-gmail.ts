import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { askExtractor, getSetting, setSetting } from "./kiki";
import { recordTxns, fmtBaht, findMerchant, learnMerchant, isOwnAccount, type TxnRecord } from "./kiki-finance";

/**
 * เฝ้าเมลแจ้งเตือนธนาคาร (K PLUS) จาก Gmail ส่วนตัวของเจ้าของ (sodod666@gmail.com)
 * — ใช้ IMAP + App Password (ไม่ใช้ OAuth: โปรเจกต์ Google Cloud เดิมไม่มีสิทธิ์เข้า console)
 * ตั้งค่า: .env → KIKI_GMAIL_USER + KIKI_GMAIL_APP_PASSWORD (สร้างที่ myaccount.google.com/apppasswords)
 * เจอเงินเข้า-ออก → บันทึกหมวด "รอระบุ" → ถามเจ้าของว่าค่าอะไร → ตอบแล้วจัดหมวดให้
 */

export const PENDING_CATEGORY = "รอระบุ";

export function kikiGmailReady(): boolean {
  return Boolean(process.env.KIKI_GMAIL_APP_PASSWORD?.trim());
}

// ดึงเมลธนาคารที่ใหม่กว่า watermark (uid ล่าสุดที่เคยเห็น) — ครั้งแรกตั้ง watermark = ตอนนี้ ไม่ย้อนเมลเก่า
async function fetchNewBankMails(): Promise<{ subject: string; text: string; when: Date }[]> {
  const user = process.env.KIKI_GMAIL_USER?.trim() || "sodod666@gmail.com";
  const pass = (process.env.KIKI_GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
  const out: { subject: string; text: string; when: Date }[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mb = client.mailbox;
      const uidNext = typeof mb === "object" && mb ? Number(mb.uidNext || 1) : 1;
      const lastUid = Number((await getSetting("kiki_imap_last_uid")) || 0);
      if (!lastUid) {
        await setSetting("kiki_imap_last_uid", String(uidNext));
        return [];
      }
      if (uidNext > lastUid) {
        const uids = ((await client.search({ uid: `${lastUid}:*`, from: "kasikornbank.com" }, { uid: true })) || []) as number[];
        for (const uid of uids.slice(0, 10)) {
          if (uid < lastUid) continue;
          const msg = (await client.fetchOne(String(uid), { source: true }, { uid: true })) as { source?: Buffer } | false | undefined;
          if (!msg || !msg.source) continue;
          const parsed = await simpleParser(msg.source);
          const text = (parsed.text || String(parsed.html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").slice(0, 4000);
          out.push({ subject: parsed.subject || "", text, when: parsed.date || new Date() });
        }
        await setSetting("kiki_imap_last_uid", String(uidNext));
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => { client.close(); });
  }
  return out;
}

interface BankMailParse {
  relevant: boolean;
  type?: "income" | "expense";
  amount?: number;
  counterparty?: string;
  when?: string; // ISO
}

export interface BankTxnEvent {
  txn: TxnRecord;
  counterparty: string;
  autoCategory?: string; // ร้านประจำ — จัดหมวดให้เองแล้ว (ไม่ต้องถาม)
}

export interface OwnTransferEvent {
  amount: number;
  counterparty: string;
  when: Date;
}

// ดึงเมลธนาคารใหม่ → บันทึกเป็น "รอระบุ" → คืนรายการให้ cron ไปถามเจ้าของ
export async function pollBankEmails(): Promise<{ txns: BankTxnEvent[]; ownTransfers: OwnTransferEvent[] }> {
  const empty = { txns: [], ownTransfers: [] };
  if (!kikiGmailReady()) return empty;

  // กันถี่เกิน: เช็คทุก >= 2 นาที
  const lastPoll = Number((await getSetting("kiki_gmail_last_poll")) || 0);
  if (Date.now() - lastPoll < 110_000) return empty;
  await setSetting("kiki_gmail_last_poll", String(Date.now()));

  let mails: { subject: string; text: string; when: Date }[] = [];
  try {
    mails = await fetchNewBankMails();
  } catch {
    return empty; // ต่อ IMAP ไม่ได้รอบนี้ — รอบหน้าลองใหม่
  }

  const out: BankTxnEvent[] = [];
  const ownTransfers: OwnTransferEvent[] = [];
  for (const mail of mails) {
    try {
      const raw = await askExtractor(
        `เมลจากธนาคาร:\nหัวเรื่อง: ${mail.subject}\nเนื้อหา: """${mail.text}"""`,
        {
          system: `คุณคือระบบอ่านเมลแจ้งเตือนธนาคารไทย (K PLUS/กสิกร) ตอบ JSON เท่านั้น:
{"relevant":true/false,"type":"income|expense","amount":123.45,"counterparty":"ชื่อบัญชี/ธนาคารปลายทางหรือต้นทาง","when":"YYYY-MM-DDTHH:mm"}
- โอนเงินออก/จ่ายบิล/ถอน = expense · เงินเข้า/รับโอน = income
- เมลที่ไม่ใช่รายการเงินจริง (โฆษณา/OTP/แจ้งเตือนล็อกอิน/สรุปยอด) = {"relevant":false}`,
          timeoutMs: 90_000,
        },
      );
      const jm = raw.match(/\{[\s\S]*\}/);
      if (!jm) continue;
      const p = JSON.parse(jm[0]) as BankMailParse;
      if (!p.relevant || !p.type || !p.amount || p.amount <= 0) continue;
      const cp = p.counterparty || "ไม่ทราบ";

      // โอนเข้าบัญชีตัวเอง = ย้ายเงิน ไม่ใช่รายจ่าย — ไม่บันทึก (เจ้าของสั่ง 3 ส.ค.)
      if (await isOwnAccount(cp)) {
        ownTransfers.push({ amount: p.amount, counterparty: cp, when: p.when ? new Date(p.when) : mail.when });
        continue;
      }

      // ร้านประจำที่เคยตอบแล้ว = จัดหมวดเองเลย ไม่ถามซ้ำ
      const known = p.type === "expense" ? await findMerchant(cp) : null;
      const recs = await recordTxns([
        {
          type: p.type,
          amount: p.amount,
          category: known ? known.category : PENDING_CATEGORY,
          note: known
            ? `${known.note || known.category} · ${cp}`
            : `${p.type === "expense" ? "โอนถึง" : "รับจาก"} ${cp} (จากเมล K PLUS)`,
          merchant: cp,
          occurredAt: p.when,
        },
      ]);
      if (recs[0]) {
        if (known) await import("./db").then(({ db }) => db.kikiMerchant.update({ where: { id: known.id }, data: { hits: { increment: 1 } } }).catch(() => {}));
        out.push({ txn: recs[0], counterparty: cp, autoCategory: known?.category });
      }
    } catch { /* เมลนี้อ่านไม่ได้ ข้าม */ }
  }
  return { txns: out, ownTransfers };
}

const PENDING_WINDOW_MS = 7 * 86400_000; // เคยใช้ 48 ชม. — รายการที่ค้างนานกว่านั้นหลุดจากการถาม-ตอบถาวร

export interface ClassifyResult {
  ok: boolean; // true = จัดหมวดสำเร็จ · false = จับคู่รายการไม่ได้ (msg อธิบายตรง ๆ ห้ามเดาตัวอื่นแทน)
  msg: string;
}

// เจ้าของตอบว่า "ค่าอะไร" → อัปเดตรายการ "รอระบุ"
// replyText = ข้อความที่เจ้าของกด reply (โครง 🔴 เงินออก X ฿) — ใช้ยอด+ทิศทางชี้ตัวรายการตรง ๆ
// (เคยพัง: หยิบตัวเก่าสุดเสมอ ไม่สนว่า reply ใส่ข้อความไหน — reply ที่รายการ 60 ฿ แต่ไปแก้รายการ 10 ฿ คนละตัว)
export async function classifyPendingTxn(answer: string, replyText?: string): Promise<ClassifyResult | null> {
  const { db } = await import("./db");
  const all = await db.financeTxn.findMany({
    where: { category: PENDING_CATEGORY, createdAt: { gte: new Date(Date.now() - PENDING_WINDOW_MS) } },
    orderBy: { createdAt: "asc" },
  });
  if (!all.length) return null;
  let pending = all[0];
  let answer2 = answer;
  // เจ้าของพิมพ์ยอดนำหน้าเอง เช่น "319 ค่าตั๋วหนัง" — จับคู่รายการจากยอดโดยไม่ต้อง reply
  const inline = answer.match(/^\s*([\d,]+(?:\.\d+)?)\s+(.{2,})$/);
  if (inline) {
    const amt = Number(inline[1].replace(/,/g, ""));
    const hit = [...all].reverse().find((p) => Math.abs(p.amount - amt) < 0.005);
    if (hit) {
      pending = hit;
      answer2 = inline[2];
    }
  }
  if (replyText) {
    const m = replyText.match(/เงิน(ออก|เข้า)\s*([\d,]+(?:\.\d+)?)\s*฿/);
    if (m) {
      const amt = Number(m[2].replace(/,/g, ""));
      const typ = m[1] === "ออก" ? "expense" : "income";
      const hit = [...all].reverse().find((p) => p.type === typ && Math.abs(p.amount - amt) < 0.005);
      if (!hit) {
        return {
          ok: false,
          msg: `รายการ${m[1] === "ออก" ? "จ่าย" : "รับ"} ${fmtBaht(amt)} ฿ ตัวนั้นไม่ได้ค้าง "รอระบุ" แล้วครับ (น่าจะจัดหมวดไปก่อนหน้านี้) — พิมพ์ "ขอดูการเงิน" เช็คได้เลย`,
        };
      }
      pending = hit;
    }
  }
  const raw = await askExtractor(
    `รายการ: ${pending.type === "expense" ? "จ่าย" : "รับ"} ${pending.amount} บาท · ${pending.note || ""}\nเจ้าของบอกว่า: """${answer2}"""`,
    {
      system: `จัดหมวดรายการเงินตามที่เจ้าของบอก ตอบ JSON เท่านั้น: {"category":"...","note":"สั้น ๆ ว่าค่าอะไร"}
หมวดรายจ่าย: อาหาร | เดินทาง | ของใช้ | บันเทิง | บิล/สมาชิก | สุขภาพ | ให้คนอื่น | อื่นๆ
หมวดรายรับ: เงินเดือน | เงินเสริม | อื่นๆ
กติกา note: เก็บเฉพาะ "สิ่งที่เจ้าของบอกว่าเป็นค่าอะไร" ห้ามใส่ตัวเลข/ยอดเงินใน note เอง (ยอดจริงระบบมีแล้ว ห้ามเดาเพิ่ม)`,
      timeoutMs: 60_000,
    },
  );
  const jm = raw.match(/\{[\s\S]*\}/);
  if (!jm) return null;
  try {
    const p = JSON.parse(jm[0]) as { category?: string; note?: string };
    if (!p.category) return null;
    await db.financeTxn.update({
      where: { id: pending.id },
      data: { category: String(p.category).slice(0, 30), note: p.note ? String(p.note).slice(0, 200) : pending.note },
    });
    // จำร้านประจำ: ครั้งหน้าโอนร้านเดิม = จัดหมวดเองไม่ถาม (1.1 — เจ้าของสั่ง 3 ส.ค.)
    if (pending.merchant && pending.type === "expense") await learnMerchant(pending.merchant, String(p.category), p.note);
    const { rebuildLedgerMonth, ymOf } = await import("./kiki-finance");
    await rebuildLedgerMonth(ymOf(pending.occurredAt)).catch(() => {});
    const learned = pending.merchant && pending.type === "expense" ? `\nจำไว้แล้ว: ${pending.merchant} = ${p.category} — ครั้งหน้าไม่ถามซ้ำ` : "";
    return { ok: true, msg: `${pending.type === "expense" ? "จ่าย" : "รับ"} ${fmtBaht(pending.amount)} ฿ → หมวด ${p.category}${p.note ? ` · ${p.note}` : ""}${learned}` };
  } catch {
    return null;
  }
}

// มีรายการรอระบุค้างไหม (ไว้เช็คใน ingest ก่อนเข้า intent อื่น)
export async function hasPendingTxn(): Promise<boolean> {
  const { db } = await import("./db");
  const n = await db.financeTxn.count({
    where: { category: PENDING_CATEGORY, createdAt: { gte: new Date(Date.now() - PENDING_WINDOW_MS) } },
  });
  return n > 0;
}
