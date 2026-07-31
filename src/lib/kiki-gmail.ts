import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import { askClaude } from "./claude";
import { KIKI_GUARD, getSetting, setSetting } from "./kiki";
import { recordTxns, fmtBaht, type TxnRecord } from "./kiki-finance";

/**
 * เฝ้าเมลแจ้งเตือนธนาคาร (K PLUS) จาก Gmail ส่วนตัวของเจ้าของ (sodod666@gmail.com)
 * — คนละบัญชี/คนละ token กับ Google ของระบบงาน (drive/calendar)
 * เจอเงินเข้า-ออก → บันทึกเป็นหมวด "รอระบุ" → ถามเจ้าของว่าค่าอะไร → เจ้าของตอบ → อัปเดตหมวด
 * ตั้งค่าครั้งแรก: npm run kiki:gmail-auth (ล็อกอินด้วย Gmail ส่วนตัว)
 */

export const PENDING_CATEGORY = "รอระบุ";
const TOKEN_PATH = () => process.env.KIKI_GMAIL_TOKEN_PATH || path.join(process.cwd(), ".kiki-gmail-token.json");

export function kikiGmailReady(): boolean {
  return fs.existsSync(TOKEN_PATH());
}

function getGmail() {
  const credPath = process.env.DRIVE_CREDENTIALS_PATH || path.join(process.cwd(), "credentials.json");
  if (!fs.existsSync(credPath) || !kikiGmailReady()) return null;
  const raw = JSON.parse(fs.readFileSync(credPath, "utf8"));
  const conf = raw.installed || raw.web;
  const oauth2 = new google.auth.OAuth2(conf.client_id, conf.client_secret);
  oauth2.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH(), "utf8")));
  // token refresh แล้วเก็บกลับไฟล์ (กันหมดอายุ)
  oauth2.on("tokens", (t) => {
    try {
      const cur = JSON.parse(fs.readFileSync(TOKEN_PATH(), "utf8"));
      fs.writeFileSync(TOKEN_PATH(), JSON.stringify({ ...cur, ...t }, null, 2));
    } catch { /* ข้าม */ }
  });
  return google.gmail({ version: "v1", auth: oauth2 });
}

// แกะเนื้อเมล (text/plain ก่อน ไม่มีก็ strip html)
function bodyOf(payload: { mimeType?: string | null; body?: { data?: string | null } | null; parts?: unknown[] | null } | undefined): string {
  if (!payload) return "";
  const decode = (d?: string | null) => (d ? Buffer.from(d.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : "");
  type Part = { mimeType?: string | null; body?: { data?: string | null } | null; parts?: Part[] | null };
  const walk = (p: Part, want: string): string => {
    if (p.mimeType === want && p.body?.data) return decode(p.body.data);
    for (const c of p.parts || []) {
      const r = walk(c, want);
      if (r) return r;
    }
    return "";
  };
  const plain = walk(payload as Part, "text/plain");
  if (plain) return plain;
  const html = walk(payload as Part, "text/html") || decode(payload.body?.data);
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
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
  const gmail = getGmail();
  if (!gmail) return [];

  // กันถี่เกิน: เช็คทุก >= 2 นาที
  const lastPoll = Number((await getSetting("kiki_gmail_last_poll")) || 0);
  if (Date.now() - lastPoll < 110_000) return [];
  await setSetting("kiki_gmail_last_poll", String(Date.now()));

  // ครั้งแรก: ตั้งจุดเริ่มเป็นตอนนี้ (ไม่ย้อนอ่านเมลเก่า 2 พันฉบับ)
  let lastMs = Number((await getSetting("kiki_gmail_last_ms")) || 0);
  if (!lastMs) {
    await setSetting("kiki_gmail_last_ms", String(Date.now()));
    return [];
  }

  const q = `from:(kasikornbank.com) after:${Math.floor(lastMs / 1000)}`;
  const list = await gmail.users.messages.list({ userId: "me", q, maxResults: 10 }).catch(() => null);
  const ids = list?.data.messages || [];
  if (!ids.length) return [];

  const out: BankTxnEvent[] = [];
  let maxMs = lastMs;
  for (const m of ids.reverse()) {
    try {
      const full = await gmail.users.messages.get({ userId: "me", id: m.id!, format: "full" });
      const internal = Number(full.data.internalDate || 0);
      if (internal <= lastMs) continue;
      maxMs = Math.max(maxMs, internal);
      const headers = full.data.payload?.headers || [];
      const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value || "";
      const body = bodyOf(full.data.payload || undefined).slice(0, 4000);

      const raw = await askClaude(
        `เมลจากธนาคาร:\nหัวเรื่อง: ${subject}\nเนื้อหา: """${body}"""`,
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
  if (maxMs > lastMs) await setSetting("kiki_gmail_last_ms", String(maxMs));
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
