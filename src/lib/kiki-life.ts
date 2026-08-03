import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { db } from "./db";
import { askExtractor, writePersonalNote, readPersonalNote, personalHubFooter, PERSONAL_FOLDER } from "./kiki";
import { getVaultPath } from "./obsidian";
import { financeSnapshot, fmtBaht, snapshotFacts } from "./kiki-finance";

/**
 * ชีวิตประจำวันของเจ้าของ — wishlist / สมุดหนี้ / เตือนประจำ / ฟิตเนส / journal / รายงานสัปดาห์
 * ทุกตัวสั่งด้วยภาษาคน (LLM สกัด) และผูกกับข้อมูลเงินจริง
 */

// ===== เครื่องมือร่วม: LLM → JSON =====

async function llmJson<T>(system: string, prompt: string): Promise<T | null> {
  try {
    const raw = await askExtractor(prompt, { system, timeoutMs: 90_000 });
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? (JSON.parse(m[0]) as T) : null;
  } catch {
    return null;
  }
}

// ===== #2 Wishlist + ซื้อได้ไหม =====

export const WISH_RE = /อยากได้|อยากซื้อ|เล็ง(ไว้|อยู่)|wishlist|วิชลิสต์|ของที่อยากได้|เก็บเงินซื้อ|ซื้อ.{0,20}(ไหวไหม|ได้ไหม|ดีไหม)/i;

interface WishAction {
  action: "add" | "list" | "bought" | "remove" | "analyze";
  title?: string;
  price?: number;
  note?: string;
}

export async function handleWish(text: string): Promise<string> {
  const items = await db.wishItem.findMany({ where: { active: true, boughtAt: null }, orderBy: { createdAt: "asc" } });
  const table = items.map((w) => `${w.id} | ${w.title} | ${w.price ? fmtBaht(w.price) + " ฿" : "ไม่รู้ราคา"}`).join("\n") || "(ว่าง)";
  const a = await llmJson<WishAction>(
    `คุณคือระบบ wishlist ตอบ JSON เท่านั้น: {"action":"add|list|bought|remove|analyze","title":"...","price":ตัวเลขหรือ null,"note":"..."}
- "อยากได้ X ราคา Y" = add · "ซื้อ X แล้ว" = bought · "เอา X ออก/ไม่เอาแล้ว" = remove · ถามว่าซื้อไหวไหม/ดูรายการ = analyze/list
- bought/remove: title ต้องตรงกับรายการที่มี`,
    `wishlist ปัจจุบัน (id | ชื่อ | ราคา):\n${table}\n\nข้อความเจ้าของ: """${text}"""`,
  );
  if (!a) return "ยังไม่เข้าใจครับ ลองบอกว่า อยากได้อะไร ราคาเท่าไหร่";

  const snap = await financeSnapshot();
  const surplus = snap.monthIncome - snap.monthExpense; // เงินเหลือเดือนนี้ (คร่าว)
  const analyze = (title: string, price: number | null): string => {
    if (!price) return `"${title}" ยังไม่รู้ราคา — บอกราคามาเดี๋ยววิเคราะห์ให้ครับ`;
    const lines = [`${title} · ${fmtBaht(price)} ฿`];
    if (snap.safePerDay !== null) {
      const after = Math.max(0, (snap.totalBudget! - snap.monthExpense - price) / snap.daysLeft);
      lines.push(price <= (snap.totalBudget! - snap.monthExpense)
        ? `ซื้อเดือนนี้: งบยังพอ แต่จะเหลือใช้วันละ ${fmtBaht(Math.floor(after))} ฿ (จากเดิม ${fmtBaht(Math.floor(snap.safePerDay))} ฿)`
        : `ซื้อเดือนนี้: เกินงบที่เหลือ — ไม่แนะนำ`);
    }
    const daily = [100, 200, 300].map((d) => `วันละ ${d} = ${Math.ceil(price / d)} วัน`).join(" · ");
    lines.push(`ถ้าออม: ${daily}`);
    if (surplus > 0) lines.push(`เดือนนี้รับ-จ่ายเหลือ ${fmtBaht(surplus)} ฿ — เก็บครึ่งนึงต่อเดือนก็ ${Math.ceil(price / Math.max(1, surplus / 2))} เดือนถึง`);
    return lines.join("\n");
  };

  if (a.action === "add" && a.title) {
    await db.wishItem.create({ data: { title: a.title.slice(0, 100), price: a.price || null, note: a.note || null } });
    return `เข้า wishlist แล้วครับ ✅\n\n${analyze(a.title, a.price || null)}`;
  }
  if (a.action === "bought" && a.title) {
    const hit = items.find((w) => w.title.includes(a.title!) || a.title!.includes(w.title));
    if (hit) {
      await db.wishItem.update({ where: { id: hit.id }, data: { boughtAt: new Date() } });
      return `ยินดีด้วยครับ 🎯 "${hit.title}" ได้มาแล้ว — ส่งสลิป/บอกยอดมาด้วย เดี๋ยวจดรายจ่ายให้`;
    }
    return `หา "${a.title}" ใน wishlist ไม่เจอครับ`;
  }
  if (a.action === "remove" && a.title) {
    const hit = items.find((w) => w.title.includes(a.title!) || a.title!.includes(w.title));
    if (hit) {
      await db.wishItem.update({ where: { id: hit.id }, data: { active: false } });
      return `เอา "${hit.title}" ออกจาก wishlist แล้วครับ ✅`;
    }
    return `หา "${a.title}" ไม่เจอครับ`;
  }
  // list / analyze
  if (!items.length) return `wishlist ยังว่างครับ อยากได้อะไรบอกมา เดี๋ยววิเคราะห์ให้ว่าซื้อไหวไหม 💸`;
  if (a.action === "analyze" && a.title) {
    const hit = items.find((w) => w.title.includes(a.title!) || a.title!.includes(w.title));
    if (hit) return analyze(hit.title, hit.price);
  }
  return `ของที่เล็งไว้ (${items.length}):\n\n${items.map((w, i) => `${i + 1}. ${w.title}${w.price ? ` · ${fmtBaht(w.price)} ฿` : " · ยังไม่รู้ราคา"}`).join("\n")}\n\nอยากรู้ว่าตัวไหนซื้อไหวไหม ถามมาได้เลย`;
}

// ===== #4 สมุดหนี้/เงินยืม =====

export const DEBT_RE = /ยืม(เงิน)?|ติดเงิน|ติดค่า|เป็นหนี้|ค้าง(เงิน|ค่า)|คืนเงิน|ใช้หนี้|ใครติด|สมุดหนี้|หนี้|ผ่อน(บัตร|รถ|ของ|คืน|เดือนละ)|จ่ายงวด|งวด(บัตร|รถ)/i;

interface DebtAction {
  action: "add" | "settle" | "pay" | "list";
  direction?: "they_owe" | "i_owe";
  person?: string;
  amount?: number;
  note?: string;
  dueDate?: string; // YYYY-MM-DD กำหนดคืน
  installmentAmount?: number; // ผ่อนงวดละ
  installmentDay?: number; // ตัด/จ่ายทุกวันที่
  totalAmount?: number; // ยอดตั้งต้นทั้งก้อน
  id?: string; // ใช้กับ pay/settle เมื่อชี้ตัวได้
}

function debtLine(d: { person: string; direction: string; amount: number; note: string | null; dueDate: Date | null; installmentAmount: number | null; installmentDay: number | null; totalAmount: number | null }): string {
  const parts = [`${fmtBaht(d.amount)} ฿`];
  if (d.installmentAmount) parts.push(`ผ่อนเดือนละ ${fmtBaht(d.installmentAmount)} ฿${d.installmentDay ? ` ทุกวันที่ ${d.installmentDay}` : ""}${d.totalAmount ? ` (จากทั้งหมด ${fmtBaht(d.totalAmount)} ฿)` : ""}`);
  if (d.dueDate) parts.push(`ครบกำหนด ${d.dueDate.toLocaleDateString("th-TH-u-ca-gregory", { day: "numeric", month: "short" })}`);
  if (d.note) parts.push(d.note);
  return parts.join(" · ");
}

export async function handleDebt(text: string): Promise<string> {
  const open = await db.debt.findMany({ where: { settledAt: null }, orderBy: { createdAt: "asc" } });
  const todayISO = new Date().toISOString().slice(0, 10);
  const table = open.map((d) => `${d.id} | ${d.direction === "they_owe" ? `${d.person} ติดเรา` : `เราติด ${d.person}`} | ${debtLine(d)}`).join("\n") || "(ว่าง)";
  const a = await llmJson<DebtAction>(
    `คุณคือระบบสมุดหนี้ วันนี้คือ ${todayISO} ตอบ JSON เท่านั้น:
{"action":"add|settle|pay|list","direction":"they_owe|i_owe","person":"...","amount":123,"note":"...","dueDate":"YYYY-MM-DD ถ้าระบุกำหนดคืน","installmentAmount":งวดละ,"installmentDay":ตัดทุกวันที่,"totalAmount":ยอดทั้งก้อน,"id":"ใช้กับ settle/pay"}
- "X ยืม 500" = add they_owe · "ผมยืม X / ผมติดเงิน X" = add i_owe
- "คืนสิ้นเดือน/คืนวันที่ 15" = ใส่ dueDate (ตีความจากวันนี้)
- ผ่อน: "ผ่อนบัตรกรุงศรี เดือนละ 3500 ตัดทุกวันที่ 25 เหลือ 42000" = add i_owe amount=42000 installmentAmount=3500 installmentDay=25 · "เพื่อนผ่อนคืนเดือนละ 500" = they_owe แบบผ่อน
- "X คืนแล้ว" = settle (เลือก id จากตาราง) · "X คืนมา 500 / จ่ายงวดบัตรแล้ว" = pay amount=ยอดที่จ่าย (เลือก id) — ระบบจะหักยอดให้
- ถามว่าใครติดบ้าง/มีหนี้อะไร = list`,
    `หนี้คงค้าง (id | ใครติดใคร | รายละเอียด):\n${table}\n\nข้อความเจ้าของ: """${text}"""`,
  );
  if (!a) return "ยังไม่เข้าใจครับ ลองบอกว่าใครยืมเท่าไหร่";

  if (a.action === "add" && a.person && a.amount) {
    const due = a.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(a.dueDate) ? new Date(`${a.dueDate}T00:00:00`) : null;
    await db.debt.create({
      data: {
        direction: a.direction || "they_owe",
        person: a.person.slice(0, 50),
        amount: a.amount,
        note: a.note || null,
        dueDate: due,
        installmentAmount: a.installmentAmount || null,
        installmentDay: a.installmentDay ? Math.min(31, Math.max(1, a.installmentDay)) : null,
        totalAmount: a.totalAmount || (a.installmentAmount ? a.amount : null),
      },
    });
    const who = a.direction === "i_owe" ? `เราติด ${a.person}` : `${a.person} ติดเรา`;
    const extra = a.installmentAmount
      ? `ผ่อนเดือนละ ${fmtBaht(a.installmentAmount)} ฿${a.installmentDay ? ` — ผมจะเตือนทุกวันที่ ${a.installmentDay}` : ""}`
      : due
        ? `ครบกำหนด ${due.toLocaleDateString("th-TH-u-ca-gregory", { day: "numeric", month: "short" })} — ถึงวันผมเตือนแน่นอน`
        : a.direction === "i_owe"
          ? "ครบกำหนดเมื่อไหร่บอกด้วย เดี๋ยวเตือนให้คืน"
          : "เดี๋ยวผมช่วยทวงให้เป็นระยะ";
    return `จดแล้วครับ ✅ ${who} ${fmtBaht(a.amount)} ฿${a.note ? ` (${a.note})` : ""}\n${extra}`;
  }
  if ((a.action === "settle" || a.action === "pay") && (a.id || a.person)) {
    const hit = open.find((d) => d.id === a.id) || open.find((d) => a.person && (d.person.includes(a.person) || a.person.includes(d.person)));
    if (!hit) return `หารายการของ "${a.person || a.id}" ไม่เจอครับ`;
    if (a.action === "pay" && a.amount && a.amount < hit.amount) {
      const left = Math.round((hit.amount - a.amount) * 100) / 100;
      await db.debt.update({ where: { id: hit.id }, data: { amount: left } });
      const pct = hit.totalAmount ? ` — ผ่อนไปแล้ว ${Math.round(((hit.totalAmount - left) / hit.totalAmount) * 100)}%` : "";
      return `รับยอดแล้วครับ ✅ ${hit.person} จ่าย ${fmtBaht(a.amount)} ฿ เหลือ ${fmtBaht(left)} ฿${pct}`;
    }
    await db.debt.update({ where: { id: hit.id }, data: { settledAt: new Date() } });
    const left = open.filter((d) => d.id !== hit.id);
    return `เคลียร์แล้วครับ ✅ ${hit.person} ${fmtBaht(hit.amount)} ฿\n${left.length ? `ยังเหลือค้าง ${left.length} รายการ` : "สมุดหนี้สะอาดเอี่ยม 🎯"}`;
  }
  if (!open.length) return `ไม่มีหนี้ค้างครับ สะอาดหมดจด 🎯`;
  const theyOwe = open.filter((d) => d.direction === "they_owe");
  const iOwe = open.filter((d) => d.direction === "i_owe");
  const lines: string[] = [];
  if (theyOwe.length) lines.push(`คนติดเรา (รวม ${fmtBaht(theyOwe.reduce((s, d) => s + d.amount, 0))} ฿):`, ...theyOwe.map((d) => `• ${d.person} — ${debtLine(d)}`));
  if (iOwe.length) lines.push(`${theyOwe.length ? "\n" : ""}เราติดเขา (รวม ${fmtBaht(iOwe.reduce((s, d) => s + d.amount, 0))} ฿):`, ...iOwe.map((d) => `• ${d.person} — ${debtLine(d)}`));
  return lines.join("\n");
}

// เตือนหนี้ตามกำหนด (cron รายวัน): ครบกำหนดวันนี้/เลยกำหนด + งวดผ่อนถึงวันตัด
export async function debtDueReminders(now = new Date()): Promise<string[]> {
  const open = await db.debt.findMany({ where: { settledAt: null } });
  const out: string[] = [];
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const d of open) {
    if (d.installmentAmount && d.installmentDay === now.getDate() && d.remindedInstallmentYm !== ym) {
      await db.debt.update({ where: { id: d.id }, data: { remindedInstallmentYm: ym } }).catch(() => {});
      out.push(
        d.direction === "i_owe"
          ? `วันนี้งวด${d.person} ${fmtBaht(d.installmentAmount)} ฿ (คงเหลือ ${fmtBaht(d.amount)} ฿) — จ่ายแล้วบอกผมว่า "จ่ายงวด${d.person}แล้ว" เดี๋ยวหักยอดให้`
          : `วันนี้ถึงงวดที่ ${d.person} ต้องคืน ${fmtBaht(d.installmentAmount)} ฿ (ค้าง ${fmtBaht(d.amount)} ฿) — ได้เงินแล้วบอกผมด้วย`,
      );
    }
    if (d.dueDate && !d.installmentAmount) {
      const overdueDays = Math.floor((today0.getTime() - new Date(d.dueDate.getFullYear(), d.dueDate.getMonth(), d.dueDate.getDate()).getTime()) / 86400_000);
      if (overdueDays === 0) {
        out.push(
          d.direction === "i_owe"
            ? `วันนี้ครบกำหนดคืน ${d.person} ${fmtBaht(d.amount)} ฿${d.note ? ` (${d.note})` : ""} — อย่าลืมนะครับ`
            : `วันนี้ครบกำหนดที่ ${d.person} ต้องคืน ${fmtBaht(d.amount)} ฿${d.note ? ` (${d.note})` : ""} — ทวงได้เต็มปากแล้ว`,
        );
      } else if (overdueDays > 0 && overdueDays % 3 === 0 && overdueDays <= 15) {
        out.push(`${d.direction === "i_owe" ? `เราค้างคืน ${d.person}` : `${d.person} เลยกำหนดคืน`} ${fmtBaht(d.amount)} ฿ มา ${overdueDays} วันแล้ว`);
      }
    }
  }
  return out;
}

// ทวงหนี้ประจำ (cron อาทิตย์เย็น) — คืน facts ให้ vex แต่งคำทวง
export async function debtNagFacts(): Promise<string[]> {
  const open = await db.debt.findMany({ where: { settledAt: null, direction: "they_owe" } });
  if (!open.length) return [];
  await db.debt.updateMany({ where: { id: { in: open.map((d) => d.id) } }, data: { nagCount: { increment: 1 } } });
  return open.map((d) => `${d.person} ติดเงิน ${fmtBaht(d.amount)} ฿${d.note ? ` (${d.note})` : ""} มาแล้ว ${Math.ceil((Date.now() - d.createdAt.getTime()) / 86400_000)} วัน (ทวงรอบที่ ${d.nagCount + 1})`);
}

// ===== #5 เตือนซ้ำประจำ =====

export const RECUR_RE = /เตือน(ผม)?ทุก|ทุกวัน(ที่)?\s*\d|ทุก(จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์|เช้า|เย็น)|เตือนประจำ|มีเตือน(ประจำ)?อะไร|ยกเลิกเตือน/i;

interface RecurAction {
  action: "add" | "list" | "remove";
  title?: string;
  freq?: "monthly" | "weekly" | "daily";
  day?: number;
  weekday?: number;
  timeText?: string;
}

export async function handleRecurring(text: string, chatId: string): Promise<string> {
  const rows = await db.recurring.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } });
  const ruleLabel = (r: { freq: string; day: number | null; weekday: number | null; timeText: string }) => {
    const wd = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"];
    return r.freq === "monthly" ? `ทุกวันที่ ${r.day}` : r.freq === "weekly" ? `ทุกวัน${wd[r.weekday || 0]}` : "ทุกวัน";
  };
  const table = rows.map((r) => `${r.id} | ${r.title} | ${ruleLabel(r)} ${r.timeText} น.`).join("\n") || "(ว่าง)";
  const a = await llmJson<RecurAction>(
    `คุณคือระบบเตือนประจำ ตอบ JSON เท่านั้น: {"action":"add|list|remove","title":"เตือนเรื่องอะไร","freq":"monthly|weekly|daily","day":1-31,"weekday":0-6(0=อาทิตย์),"timeText":"HH:MM"}
- "เตือนทุกวันที่ 25 จ่ายบัตร" = add monthly day=25 · "ทุกจันทร์เช้าถามน้ำหนัก" = add weekly weekday=1 timeText=08:00
- ไม่บอกเวลา = "08:00" · เช้า=08:00 เที่ยง=12:00 เย็น=18:00 ค่ำ=20:00
- "ยกเลิกเตือน X" = remove (title ตรงกับรายการ) · ถามว่ามีอะไรบ้าง = list`,
    `เตือนประจำปัจจุบัน (id | เรื่อง | รอบ):\n${table}\n\nข้อความเจ้าของ: """${text}"""`,
  );
  if (!a) return "ยังไม่เข้าใจครับ ลองบอกว่า เตือนทุกวันที่เท่าไหร่ เรื่องอะไร";

  if (a.action === "add" && a.title && a.freq) {
    await db.recurring.create({
      data: {
        chatId,
        title: a.title.slice(0, 150),
        freq: a.freq,
        day: a.freq === "monthly" ? Math.min(31, Math.max(1, a.day || 1)) : null,
        weekday: a.freq === "weekly" ? Math.min(6, Math.max(0, a.weekday ?? 1)) : null,
        timeText: /^\d{1,2}:\d{2}$/.test(a.timeText || "") ? a.timeText! : "08:00",
      },
    });
    const wd = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"];
    const when = a.freq === "monthly" ? `ทุกวันที่ ${a.day}` : a.freq === "weekly" ? `ทุกวัน${wd[a.weekday ?? 1]}` : "ทุกวัน";
    return `ตั้งเตือนประจำแล้วครับ ⏰ "${a.title}" — ${when} เวลา ${a.timeText || "08:00"} น.`;
  }
  if (a.action === "remove" && a.title) {
    const hit = rows.find((r) => r.title.includes(a.title!) || a.title!.includes(r.title));
    if (hit) {
      await db.recurring.update({ where: { id: hit.id }, data: { active: false } });
      return `ยกเลิกเตือน "${hit.title}" แล้วครับ ✅`;
    }
    return `หาเตือน "${a.title}" ไม่เจอครับ`;
  }
  return rows.length
    ? `เตือนประจำที่ตั้งไว้ (${rows.length}):\n\n${rows.map((r, i) => `${i + 1}. ${r.title} — ${ruleLabel(r)} ${r.timeText} น.`).join("\n")}`
    : `ยังไม่มีเตือนประจำครับ ตั้งได้เลย เช่น "เตือนทุกวันที่ 25 จ่ายบัตรเครดิต"`;
}

// เช็คว่ารอบไหนถึงเวลายิง (cron เรียกทุกนาที) — คืนรายการที่ต้องเตือนตอนนี้
export async function dueRecurrings(now = new Date()): Promise<{ id: string; chatId: string; title: string }[]> {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const rows = await db.recurring.findMany({ where: { active: true, NOT: { lastFiredDate: today } } });
  const out: { id: string; chatId: string; title: string }[] = [];
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  for (const r of rows) {
    const dayMatch =
      r.freq === "daily" ||
      (r.freq === "weekly" && now.getDay() === (r.weekday ?? -1)) ||
      (r.freq === "monthly" && now.getDate() === Math.min(r.day ?? -1, lastDay)); // เดือนสั้น: วันที่ 31 → วันสุดท้าย
    if (!dayMatch) continue;
    const [h, m] = r.timeText.split(":").map(Number);
    const fireAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
    if (now >= fireAt) {
      await db.recurring.update({ where: { id: r.id }, data: { lastFiredDate: today } }).catch(() => {});
      out.push({ id: r.id, chatId: r.chatId, title: r.title });
    }
  }
  return out;
}

// ===== #14 ฟิตเนส =====

export const FITNESS_RE = /ยิม|ฟิตเนส|ออกกำลัง|เล่นเวท|เวทเทรนนิ่ง|คาร์ดิโอ|วิ่ง(มา|ไป|เสร็จ)|น้ำหนัก\s*\d|โปรแกรมเล่น|เล่นอะไรดี|ท่าเล่น|เซ็ต|โค้ช/i;

// อ่านคลังโค้ช 7966 ใน vault (อ่านอย่างเดียว) เป็นบริบทให้ Vex เป็นโค้ช
export async function fitnessCoachContext(): Promise<string> {
  const vault = getVaultPath();
  if (!vault) return "";
  const dir = path.resolve(vault, "7966");
  if (!existsSync(dir)) return "";
  const chunks: string[] = [];
  let used = 0;
  async function walk(d: string) {
    if (used > 24_000) return;
    let entries: import("node:fs").Dirent[] = [];
    try { entries = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (used > 24_000) break;
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith(".md")) {
        try {
          const c = (await fs.readFile(full, "utf8")).slice(0, 3000);
          chunks.push(`### 7966/${path.relative(dir, full)}\n${c}`);
          used += c.length;
        } catch { /* ข้าม */ }
      }
    }
  }
  await walk(dir);
  if (!chunks.length) return "";
  return `=== คลังโค้ชฟิตเนส (7966 — ใช้เป็นความรู้ตอนเป็นโค้ชให้เจ้าของ) ===\n${chunks.join("\n\n")}`;
}

interface FitAction {
  logs?: { kind: "weight" | "workout" | "food" | "sleep" | "other"; value?: number; note?: string }[];
}

// จดบันทึก (ถ้ามีข้อมูลใหม่) + คืนบริบทล่าสุดให้ตอบแบบโค้ช
export async function handleFitnessLog(text: string): Promise<{ logged: string[]; recentContext: string }> {
  const a = await llmJson<FitAction>(
    `คุณคือระบบจดบันทึกฟิตเนส ตอบ JSON เท่านั้น: {"logs":[{"kind":"weight|workout|food|sleep|other","value":ตัวเลขหรือ null,"note":"..."}]}
- "น้ำหนัก 72.5" = weight value=72.5 · "วันนี้เล่นอก 4 ท่า" = workout note=... · "นอน 6 ชม." = sleep value=6
- เจ้าของแค่ถาม/ขอคำแนะนำ ไม่มีข้อมูลใหม่ให้จด = {"logs":[]}`,
    `ข้อความเจ้าของ: """${text}"""`,
  );
  const logged: string[] = [];
  for (const l of a?.logs || []) {
    if (!l.kind) continue;
    await db.fitnessLog.create({ data: { kind: l.kind, value: typeof l.value === "number" ? l.value : null, note: l.note || null } });
    logged.push(`${l.kind === "weight" ? `น้ำหนัก ${l.value} กก.` : l.note || l.kind}`);
  }
  const recent = await db.fitnessLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
  const recentContext = recent.length
    ? `=== บันทึกฟิตเนสล่าสุดของเจ้าของ ===\n${recent
        .map((r) => `${r.createdAt.toLocaleDateString("th-TH-u-ca-gregory")} · ${r.kind}${r.value ? ` ${r.value}` : ""}${r.note ? ` · ${r.note}` : ""}`)
        .join("\n")}`
    : "";
  return { logged, recentContext };
}

// ===== #13 Journal + mood =====

export async function saveJournal(text: string, now = new Date()): Promise<void> {
  const mood = await llmJson<{ mood: string }>(
    `จับอารมณ์จากบันทึกประจำวัน ตอบ JSON: {"mood":"ดีมาก|ดี|เฉยๆ|เหนื่อย|เครียด|แย่"}`,
    `บันทึก: """${text.slice(0, 1000)}"""`,
  );
  const dISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const rel = `journal/${dISO.slice(0, 7)}.md`;
  const cur = await readPersonalNote(rel);
  const entry = `\n## ${dISO} · อารมณ์: ${mood?.mood || "ไม่ระบุ"}\n\n${text.trim()}\n`;
  if (!cur) {
    await writePersonalNote(
      rel,
      `---\ntype: journal\ntags: [ส่วนตัว, journal]\nmonth: ${dISO.slice(0, 7)}\n---\n\n# บันทึกประจำวัน ${dISO.slice(0, 7)}\n${entry}${personalHubFooter()}`,
    );
  } else {
    const idx = cur.indexOf("\n\n---\n🔗");
    if (idx >= 0) await writePersonalNote(rel, cur.slice(0, idx) + entry + cur.slice(idx));
    else await writePersonalNote(rel, cur + entry);
  }
}

// ===== #6 รายงานสัปดาห์ (ข้อมูลจริงให้ LLM เขียน HTML) =====

export async function weeklyReportFacts(now = new Date()): Promise<string> {
  const day = now.getDay(); // 0=อาทิตย์
  const thisMon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((day + 6) % 7));
  const lastMon = new Date(thisMon.getTime() - 7 * 86400_000);
  const [thisWeek, lastWeek] = await Promise.all([
    db.financeTxn.findMany({ where: { occurredAt: { gte: thisMon } }, orderBy: { occurredAt: "asc" } }),
    db.financeTxn.findMany({ where: { occurredAt: { gte: lastMon, lt: thisMon } } }),
  ]);
  const sum = (rows: { type: string; amount: number }[], t: string) => rows.filter((r) => r.type === t).reduce((s, r) => s + r.amount, 0);
  const byCat = (rows: { type: string; amount: number; category: string }[]) => {
    const m = new Map<string, number>();
    for (const r of rows.filter((x) => x.type === "expense")) m.set(r.category, (m.get(r.category) || 0) + r.amount);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c} ${fmtBaht(v)}฿`).join(", ") || "-";
  };
  const snap = await financeSnapshot(now);
  const debts = await db.debt.findMany({ where: { settledAt: null } });
  return [
    `สัปดาห์นี้ (ตั้งแต่จันทร์): จ่าย ${fmtBaht(sum(thisWeek, "expense"))} ฿ · รับ ${fmtBaht(sum(thisWeek, "income"))} ฿ (${thisWeek.length} รายการ)`,
    `รายหมวดสัปดาห์นี้: ${byCat(thisWeek)}`,
    `สัปดาห์ที่แล้ว: จ่าย ${fmtBaht(sum(lastWeek, "expense"))} ฿ · รายหมวด: ${byCat(lastWeek)}`,
    `รายการสัปดาห์นี้:\n${thisWeek.map((r) => `- ${r.occurredAt.toLocaleDateString("th-TH-u-ca-gregory")} ${r.type === "income" ? "+" : "-"}${fmtBaht(r.amount)} ${r.category} ${r.note || ""}`).join("\n") || "-"}`,
    ...snapshotFacts(snap),
    debts.length ? `หนี้คงค้าง: ${debts.map((d) => `${d.person} ${d.direction === "they_owe" ? "ติดเรา" : "เราติด"} ${fmtBaht(d.amount)}฿`).join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

// ===== จำเองไม่ต้องสั่ง (C — เจ้าของสั่ง 3 ส.ค.) =====
// ทุกคืนไล่อ่านบทสนทนาของวัน สกัดข้อเท็จจริงส่วนตัวใหม่ → OwnerFact อัตโนมัติ + รายงานให้ตรวจ

export async function autoRememberFromToday(now = new Date()): Promise<string[]> {
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const chats = await db.kikiChat.findMany({
    where: { role: "user", createdAt: { gte: day0 } },
    orderBy: { createdAt: "asc" },
    take: 120,
  });
  if (chats.length < 3) return [];
  const existing = await db.ownerFact.findMany({ where: { active: true }, select: { fact: true }, take: 200 });
  const convo = chats.map((c) => c.content).join("\n").slice(0, 9000);
  const r = await llmJson<{ facts: { fact: string; category: string }[] }>(
    `คุณคือระบบสกัด "ข้อเท็จจริงถาวรเกี่ยวกับเจ้าของ" จากบทสนทนา ตอบ JSON เท่านั้น: {"facts":[{"fact":"...","category":"ความชอบ|ไม่ชอบ|นิสัย|สุขภาพ|คนรอบตัว|ของสำคัญ|ทั่วไป"}]}
กติกาเข้มงวด:
- เอาเฉพาะข้อมูลที่ "คงอยู่ระยะยาว" (ชอบ/ไม่ชอบ ความสัมพันธ์ นิสัย สุขภาพ ของที่ใช้) — สูงสุด 5 ข้อ
- ห้ามเก็บ: ตัวเลขเงิน/รายจ่าย (มีระบบบัญชีแล้ว) · เรื่องชั่วคราว (วันนี้กินอะไร ไปไหน) · คำสั่งงาน · สิ่งที่อยู่ในรายการเดิมแล้ว
- เขียน fact เป็นประโยคสั้น จบในตัว เช่น "แฟนชื่ออั๋น" ไม่ใช่ "เขาบอกว่า..."
- ไม่มีอะไรใหม่ = {"facts":[]}`,
    `ข้อเท็จจริงที่จำไว้แล้ว (ห้ามซ้ำ):\n${existing.map((f) => `- ${f.fact}`).join("\n") || "(ว่าง)"}\n\nบทสนทนาของเจ้าของวันนี้:\n"""${convo}"""`,
  );
  const facts = (r?.facts || []).filter((f) => f?.fact && f.fact.length >= 5).slice(0, 5);
  const saved: string[] = [];
  for (const f of facts) {
    const dup = existing.some((e) => e.fact.includes(f.fact.slice(0, 15)) || f.fact.includes(e.fact.slice(0, 15)));
    if (dup) continue;
    await db.ownerFact.create({
      data: { fact: f.fact.slice(0, 300), category: f.category?.slice(0, 20) || "ทั่วไป", source: "จำอัตโนมัติจากบทสนทนา" },
    });
    saved.push(f.fact);
  }
  return saved;
}
