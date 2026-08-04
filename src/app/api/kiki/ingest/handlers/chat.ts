import { getUpcoming, thaiDate } from "@/lib/calendar";
import { saveJournal } from "@/lib/kiki-life";
import { askKiki, setSetting, retrievePersonalNotes, getSetting, ttsOgg } from "@/lib/kiki";
import { financeSnapshot, snapshotFacts } from "@/lib/kiki-finance";
import type { Ctx, Handler } from "../types";
import { type Send } from "../types";

export const chatFallbackHandler: Handler = async (ctx) => {
  const { chatId, text, replyText, imageFiles, videoFiles, msgId, voiceNote, is, urls, reply } = ctx;
  // ===== คุยปกติ — สมอง Vex เต็มรูปแบบ =====
  const ctxParts: string[] = [];
  if (voiceNote) ctxParts.push(`เจ้าของ "อัดเสียงพูดมา" (ระบบถอดเสียงให้แล้ว ข้อความคือคำพูดจริงของเขา) — ตอบเหมือนคุยกันปกติ`);
  if (replyText) ctxParts.push(`เจ้าของกำลัง reply ข้อความนี้ ให้ตอบอ้างอิงเนื้อหานี้เป็นหลัก:\n"""${replyText.slice(0, 2000)}"""`);
  if (videoFiles.length) {
    ctxParts.push(
      `เจ้าของส่งวิดีโอมา ${videoFiles.length} ไฟล์ (${videoFiles.map((v) => v.name).join(", ")}) — ระบบยังไม่ได้เก็บเข้าคลัง (เก็บเฉพาะที่สั่ง) ถ้าอยากให้เก็บบอกได้`,
    );
  }
  if (imageFiles.length) {
    ctxParts.push(`เจ้าของส่งรูปมา ${imageFiles.length} รูป — เปิดอ่านด้วยเครื่องมือ Read ตาม path แล้วตอบจากเนื้อหาจริงในรูป (ห้ามบอกว่าไม่เห็นรูป):\n${imageFiles.map((p, i) => `${i + 1}. ${p}`).join("\n")}`);
  }
  // ลิงก์ที่ส่งมา: อ่านให้ลึกจริง (fetch → เบราว์เซอร์ของเจ้าของถ้าเว็บบังคับล็อกอิน) + แคปหน้าจอเป็นหลักฐาน
  const linkShots: { b64: string; caption: string }[] = [];
  if (urls.length) {
    const { readAnyUrl } = await import("@/lib/kiki-read");
    for (const u of urls.slice(0, 2)) {
      const r = await readAnyUrl(u, { shot: true, note: text.slice(0, 200) }).catch(() => null);
      if (!r) { ctxParts.push(`[อ่านลิงก์ ${u} ไม่สำเร็จ — บอกเจ้าของตรง ๆ ว่าเปิดไม่ได้ ห้ามเดาเนื้อหา]`); continue; }
      if (r.shotBase64 && r.via === "browser") linkShots.push({ b64: r.shotBase64, caption: `${r.title || u}`.slice(0, 200) });
      if (r.ok) {
        ctxParts.push(
          `เนื้อหาจากลิงก์ที่ส่งมา (ระบบเปิดอ่านให้จริงแล้ว${r.via === "browser" ? " ผ่านเบราว์เซอร์ที่ล็อกอินอยู่" : r.via === "youtube" ? " โดยดูคลิปจริง" : ""} — ใช้ตอบได้เลย):\n### ${r.title}\n${r.text.slice(0, 12_000)}`,
        );
      } else {
        ctxParts.push(`[เปิดลิงก์ ${u} ไม่สำเร็จ: ${r.problem || "ไม่ทราบสาเหตุ"} — บอกเจ้าของตรง ๆ ตามนี้ ห้ามเดาว่าในลิงก์เขียนอะไร]`);
      }
    }
  }
  if (is("think")) {
    ctxParts.push(
      `[โหมดคิด/เสนอ] เจ้าของขอให้คิด เสนอ ตั้งชื่อ ร่าง หรือช่วยตัดสินใจ — ลงมือเสนอของจริงทันที ห้ามถามกลับก่อนโดยไม่จำเป็น
ให้ตัวเลือกหลายอัน (3-6 อัน) แต่ละอันมีคำอธิบายว่าทำไมถึงเสนอ/ความหมาย/โทนที่ได้ แล้วปิดท้ายด้วยตัวที่แนะนำที่สุดพร้อมเหตุผล
เขียนบรรทัดละตัวเลือก ยาวได้ ไม่ต้องรวบสั้น`,
    );
  }
  const notes = await retrievePersonalNotes(text).catch(() => "");
  if (notes) ctxParts.push(`=== คลังความรู้/บันทึกส่วนตัวที่เกี่ยวข้อง (ใช้ตอบได้เลย ถ้าอยู่ในนี้อย่าบอกว่าไม่รู้) ===\n${notes}`);
  try {
    const snap = await financeSnapshot();
    if (snap.txnCount > 0) ctxParts.push(`=== การเงินเดือนนี้ (ย่อ) ===\n${snapshotFacts(snap).join("\n")}`);
  } catch { /* ไม่มีข้อมูลเงินก็ข้าม */ }
  try {
    const ups = await getUpcoming(chatId, 5);
    if (ups.length) ctxParts.push(`=== นัดที่จะถึง ===\n${ups.map((e) => `• ${thaiDate(e.date)}${e.timeText ? ` ${e.timeText}` : ""} — ${e.title}`).join("\n")}`);
  } catch { /* ข้าม */ }

  // เมื่อคืน Vex ถามไถ่วันนี้ไว้ → ข้อความเล่ายาว ๆ = บันทึกลง journal ให้เลย
  const today0 = new Date().toISOString().slice(0, 10);
  const journalPending = (await getSetting("kiki_journal_pending")) === today0;
  if (journalPending && text.length >= 20 && !imageFiles.length) {
    await setSetting("kiki_journal_pending", "");
    await saveJournal(text);
    ctxParts.push("[เจ้าของเพิ่งเล่าว่าวันนี้เป็นยังไง ตอบที่ Vex ถามไว้ — ระบบบันทึกลงไดอารี่แล้ว ตอบรับแบบเพื่อนคุยกัน สั้น ๆ อบอุ่น/แซวได้ ไม่ต้องบอกขั้นตอนระบบ]");
  }

  const answer = await askKiki(text || "(เจ้าของส่งรูปมาโดยไม่มีข้อความ — ดูรูปแล้วตอบตามเนื้อหา)", ctxParts.join("\n\n") || undefined);
  const outSends: Send[] = [
    ...linkShots.map((s0) => ({ kind: "photo" as const, dataBase64: s0.b64, filename: "page.png", caption: s0.caption })),
    { kind: "text" as const, text: answer.slice(0, 3900), replyTo: msgId },
  ];
  // สั่งด้วยข้อความว่า "อ่านให้ฟัง/ตอบเสียง" → อ่านข้อความที่ reply ถึง (หรือคำตอบ) เป็นเสียง
  // (กรณีเจ้าของพูดมาเป็นเสียง reply() แนบเสียงให้อยู่แล้ว ไม่ต้องซ้ำ)
  if (!voiceNote && /อ่านให้ฟัง|ตอบเสียง|พูดให้ฟัง/.test(text)) {
    const ogg = await ttsOgg(/อ่านให้ฟัง|พูดให้ฟัง/.test(text) && replyText ? replyText : answer);
    if (ogg) outSends.push({ kind: "voice", dataBase64: ogg.toString("base64"), filename: "vex.ogg" });
  }
  return reply(outSends);
};
