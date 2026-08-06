import { handleWish, handleDebt, handleRecurring, handleFitnessLog, fitnessCoachContext, saveJournal } from "@/lib/kiki-life";
import { askKiki, vexLine } from "@/lib/kiki";
import type { Ctx, Handler } from "../types";

export const wishHandler: Handler = async (ctx) => {
  const { text, msgId, is, reply } = ctx;
  // ===== Wishlist: อยากได้/ซื้อไหวไหม (ยกเว้นสั่งหาสินค้า — อันนั้นไปทางค้นเว็บ) =====
  if (is("wish")) {
    const t = await handleWish(text);
    return reply([{ kind: "text", text: t, replyTo: msgId }]);
  }

  return null;
};

export const debtHandler: Handler = async (ctx) => {
  const { text, replyText, msgId, is, reply } = ctx;
  // ===== สมุดหนี้/เงินยืม =====
  if (is("debt")) {
    const t = await handleDebt([replyText, text].filter(Boolean).join("\n"));
    return reply([{ kind: "text", text: t, replyTo: msgId }]);
  }

  return null;
};

export const recurringHandler: Handler = async (ctx) => {
  const { chatId, text, msgId, is, reply } = ctx;
  // ===== เตือนซ้ำประจำ (ต้องมาก่อนปฏิทิน — "เตือนทุกวันที่ 25" ไม่ใช่นัดครั้งเดียว) =====
  if (is("recurring")) {
    const t = await handleRecurring(text, chatId);
    return reply([{ kind: "text", text: t, replyTo: msgId }]);
  }

  return null;
};

export const fitnessHandler: Handler = async (ctx) => {
  const { text, msgId, is, reply } = ctx;
  // ===== ฟิตเนส: จดบันทึก + Vex เป็นโค้ช (ใช้คลัง 7966) =====
  if (is("fitness")) {
    const { logged, recentContext } = await handleFitnessLog(text);
    const coach = await fitnessCoachContext();
    const answer = await askKiki(
      text,
      [
        "[โหมดโค้ชฟิตเนส] ตอบแบบโค้ชส่วนตัว: แนะนำท่า/เซ็ต/จำนวนครั้ง/พักได้จริงจัง อิงคลังโค้ชกับบันทึกจริงของเจ้าของ ถ้าเจ้าของเพิ่งรายงานผล ให้คอมเมนต์ผลด้วย",
        logged.length ? `ระบบเพิ่งจดให้แล้ว: ${logged.join(" · ")} (ยืนยันในคำตอบด้วย)` : "",
        coach,
        recentContext,
      ].filter(Boolean).join("\n\n"),
    );
    return reply([{ kind: "text", text: answer, replyTo: msgId }]);
  }

  return null;
};

export const diaryHandler: Handler = async (ctx) => {
  const { text, msgId, is, reply } = ctx;
  // ===== จดไดอารี่ตรง ๆ =====
  const diaryM = text.match(/^\s*(?:จดไดอารี่|บันทึกวันนี้|ไดอารี่)\s*[:：]?\s*([\s\S]+)/);
  // เจตนา journal ไม่เคยมีตัวรับ — เล่าเรื่องวันนี้ยาว ๆ โดยไม่ขึ้นต้นว่า "จดไดอารี่" แล้วไม่ได้ถูกบันทึก
  // (ซ่อม 4 ส.ค. 2026 — ต้องมีเนื้อพอสมควรถึงจดจริง กันประโยคสั้น ๆ กลายเป็นไดอารี่)
  if (!diaryM && is("journal") && text.trim().length >= 20) {
    await saveJournal(text.trim());
    return reply([{ kind: "text", text: await vexLine("จดลงไดอารี่ให้แล้วครับ สิ้นเดือนผมสรุปภาพรวมให้"), replyTo: msgId }]);
  }
  if (diaryM && diaryM[1].trim().length >= 5) {
    await saveJournal(diaryM[1].trim());
    return reply([{ kind: "text", text: await vexLine("จดลงไดอารี่แล้วครับ ✅ สิ้นเดือนผมสรุปภาพรวมให้"), replyTo: msgId }]);
  }

  return null;
};
