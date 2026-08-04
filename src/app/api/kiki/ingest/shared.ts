import fs from "node:fs";
import path from "node:path";
import { renderHtmlToPng } from "@/lib/html-pdf";
import { askKiki, writePersonalBinary } from "@/lib/kiki";
import { financeSnapshot, snapshotFacts, financeCardHtml, fmtBaht, type TxnRecord } from "@/lib/kiki-finance";
import type { KikiEvent } from "@/lib/kiki-calendar";

/** ตัวช่วยที่ตัวจัดการหลายตัวใช้ร่วมกัน — แยกจาก route.ts ตอนผ่าไฟล์ 1,590 บรรทัด */

// การ์ดการเงิน → PNG (เรนเดอร์พลาด = ส่ง null ให้ fallback เป็นข้อความ)
export async function financeCardPng(justAdded?: TxnRecord[]): Promise<{ png: string | null; snapFacts: string[] }> {
  const snap = await financeSnapshot();
  const facts = snapshotFacts(snap);
  try {
    // height เตี้ยกว่าเนื้อหาจริงเสมอ → fullPage ขยายเท่าเนื้อหาพอดี (ไม่เหลือพื้นว่างท้ายภาพ)
    const png = await renderHtmlToPng(financeCardHtml(snap, { justAdded }), { width: 720, height: 200 });
    return { png: png.toString("base64"), snapFacts: facts };
  } catch {
    return { png: null, snapFacts: facts };
  }
}

// ให้ Vex แต่งคำพูดจากข้อเท็จจริงจริง (คุมสั้น) — ล่มก็มี fallback ไม่เงียบ
export async function vexSay(situation: string, facts: string[], fallback: string): Promise<string> {
  try {
    const reply = await askKiki(
      `[แต่งคำพูด] สถานการณ์: ${situation}\nข้อเท็จจริง (ห้ามแต่งตัวเลขเพิ่ม):\n${facts.map((f) => `- ${f}`).join("\n")}\n\nตอบเป็นข้อความที่จะส่งเข้าแชทเลย (สั้น อ่านง่าย เว้นบรรทัด ไม่เกิน 5 บรรทัด)`,
    );
    return reply.trim() || fallback;
  } catch {
    return fallback;
  }
}

export function escHtml(x: string): string {
  return String(x).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

// แถวใน CalendarEvent → KikiEvent (ไว้ส่งเข้าการ์ดนัด)
export function toKikiEvent(r: { id: string; date: Date; timeText: string | null; endTime: string | null; title: string; location: string | null; withWho: string | null; note: string | null; gcalEventId: string | null; done: boolean }): KikiEvent {
  return { id: r.id, date: r.date, timeText: r.timeText, endTime: r.endTime, title: r.title, location: r.location, withWho: r.withWho, note: r.note, gcalEventId: r.gcalEventId, done: r.done };
}

// "ใช้ได้อีกวันละ X ฿" สำหรับใส่ในการ์ดนัด (ไม่มีงบ = null)
export async function budgetLineToday(): Promise<string | null> {
  try {
    const snap = await financeSnapshot();
    return snap.safePerDay !== null ? `ใช้ได้อีก ${fmtBaht(Math.floor(snap.safePerDay))} ฿` : null;
  } catch {
    return null;
  }
}

// เก็บสลิปลง vault ถาวร (คืน path แรกที่เก็บได้)
export async function storeSlips(imageFiles: string[]): Promise<string | null> {
  let first: string | null = null;
  const ym = new Date().toISOString().slice(0, 7);
  for (const p of imageFiles) {
    try {
      const buf = fs.readFileSync(p);
      const saved = await writePersonalBinary(`finance/slips/${ym}/${Date.now()}-${path.basename(p)}`, buf);
      if (saved && !first) first = saved;
    } catch {
      /* เก็บไม่ได้ก็ข้าม — ข้อมูลรายการยังอยู่ใน DB */
    }
  }
  return first;
}

export const FINANCE_VERB_RE =
  /จ่าย|ซื้อ|โอน(ไป|ให้)|เสียเงิน|เติมเงิน|ค่า[ก-๙]{2,}|ได้เงิน|เงินเข้า|เงินเดือน(ออก|เข้า)|รายรับ|รายจ่าย|เงินเสริม|ถูกหวย|ขายได้|หมดไป|บาท/i;
