import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { askClaude } from "./claude";
import { KIKI_GUARD, getSetting, setSetting } from "./kiki";
import { recordTxns, fmtBaht, type TxnRecord } from "./kiki-finance";

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
}

// ดึงเมลธนาคารใหม่ → บันทึกเป็น "รอระบุ" → คืนรายการให้ cron ไปถามเจ้าของ
export async function pollBankEmails(): Promise<BankTxnEvent[]> {
  if (!kikiGmailReady()) return [];

  // กันถี่เกิน: เช็คทุก >= 2 นาที
  const lastPoll = Number((await getSetting("kiki_gmail_last_poll")) || 0);
  if (Date.now() - lastPoll < 110_000) return [];
  await setSetting("kiki_gmail_last_poll", String(Date.now()));

  let mails: { subject: string; text: string; when: Date }[] = [];
  try {
    mails = await fetchNewBankMails();
  } catch {
    return []; // ต่อ IMAP ไม่ได้รอบนี้ — รอบหน้าลองใหม่
  }

  const out: BankTxnEvent[] = [];
  for (const mail of mails) {
    try {
      const raw = await askClaude(
        `เมลจากธนาคาร:\nหัวเรื่อง: ${mail.subject}\nเนื้อหา: """${mail.text}"""`,
        {
          guard: KIKI_GUARD,
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

      const recs = await recordTxns([
        {
          type: p.type,
          amount: p.amount,
          category: PENDING_CATEGORY,
          note: `${p.type === "expense" ? "โอนถึง" : "รับจาก"} ${p.counterparty || "ไม่ทราบ"} (จากเมล K PLUS)`,
          occurredAt: p.when,
        },
      ]);
      if (recs[0]) out.push({ txn: recs[0], counterparty: p.counterparty || "ไม่ทราบ" });
    } catch { /* เมลนี้อ่านไม่ได้ ข้าม */ }
  }
  return out;
}

// เจ้าของตอบว่า "ค่าอะไร" → อัปเดตรายการ "รอระบุ" ที่เก่าสุด
export async function classifyPendingTxn(answer: string): Promise<string | null> {
  const { db } = await import("./db");
  const pending = await db.financeTxn.findFirst({
    where: { category: PENDING_CATEGORY, createdAt: { gte: new Date(Date.now() - 48 * 3600_000) } },
    orderBy: { createdAt: "asc" },
  });
  if (!pending) return null;
  const raw = await askClaude(
    `รายการ: ${pending.type === "expense" ? "จ่าย" : "รับ"} ${pending.amount} บาท · ${pending.note || ""}\nเจ้าของบอกว่า: """${answer}"""`,
    {
      guard: KIKI_GUARD,
      system: `จัดหมวดรายการเงินตามที่เจ้าของบอก ตอบ JSON เท่านั้น: {"category":"...","note":"สั้น ๆ ว่าค่าอะไร"}
หมวดรายจ่าย: อาหาร | เดินทาง | ของใช้ | บันเทิง | บิล/สมาชิก | สุขภาพ | ให้คนอื่น | อื่นๆ
หมวดรายรับ: เงินเดือน | เงินเสริม | อื่นๆ`,
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
    const { rebuildLedgerMonth, ymOf } = await import("./kiki-finance");
    await rebuildLedgerMonth(ymOf(pending.occurredAt)).catch(() => {});
    return `${pending.type === "expense" ? "จ่าย" : "รับ"} ${fmtBaht(pending.amount)} ฿ → หมวด ${p.category}${p.note ? ` · ${p.note}` : ""}`;
  } catch {
    return null;
  }
}

// มีรายการรอระบุค้างไหม (ไว้เช็คใน ingest ก่อนเข้า intent อื่น)
export async function hasPendingTxn(): Promise<boolean> {
  const { db } = await import("./db");
  const n = await db.financeTxn.count({
    where: { category: PENDING_CATEGORY, createdAt: { gte: new Date(Date.now() - 48 * 3600_000) } },
  });
  return n > 0;
}
