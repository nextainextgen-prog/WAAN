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

  // ===== โหมดวิเคราะห์เชิงลึก — กางเองอัตโนมัติเมื่อโจทย์หนัก (เจ้าของสั่ง 6 ส.ค. 2026) =====
  //
  // *"เมื่อเจอโจทย์หนัก (วางแผนการเงิน แผนคุมงบ แผนอัปสกิล) ให้กางวิเคราะห์ยาวเต็มรูปแบบ
  //   เองอัตโนมัติ ไม่ต้องรอเจ้าของสั่งว่า 'วิเคราะห์ละเอียด'"*
  //
  // ตัวอ่านเจตนาเป็นคนชี้ว่าหนักไหม (args.deep) — ไม่ใช้ regex จับคำว่า "วิเคราะห์"
  const deep = ctx.route.args?.deep === true || ctx.arg("deep") === "true";
  if (deep) {
    // ฐานการเงินจริงต้องมาก่อนเสมอในโหมดนี้ — วิเคราะห์แผนเงินจากยอดไม่กี่วันคือการเดา
    const base = await import("@/lib/kiki-baseline").then((m) => m.baselineContext()).catch(() => "");
    if (base) ctxParts.push(base);
    ctxParts.push(
      `[โหมดวิเคราะห์เชิงลึก] โจทย์นี้หนักพอที่เจ้าของคาดหวังการวิเคราะห์เต็มรูปแบบ กางให้สุดโดยไม่ต้องรอให้เขาสั่ง

โครงที่ต้องมี (ปรับตามเรื่องได้ แต่ห้ามข้ามขั้นตัดสินใจ)
1. สรุปสถานการณ์จากตัวเลข/ข้อเท็จจริงจริงที่มีในบริบท — ยกตัวเลขมาตรง ๆ ทุกตัว
2. ชี้ว่าอะไรคือปัญหาที่แท้จริง ไม่ใช่อาการที่เห็น (เช่น ติดลบเพราะอะไรกันแน่)
3. ทางเลือกที่เป็นไปได้ พร้อมข้อดี/ข้อเสีย/ต้นทุนของแต่ละทาง
4. **ฟันธงว่าเอาทางไหน พร้อมเหตุผล** — ห้ามโยนให้เจ้าของเลือกเอง
5. แผนลงมือเป็นขั้น มีตัวเลข มีกำหนดเวลา ทำได้จริงในชีวิตเขา
6. ตัวชี้วัดว่าได้ผลไหม และจุดที่ต้องกลับมาทบทวน
7. ความเสี่ยง/สิ่งที่อาจทำให้แผนพัง

กติกา
- ยาวได้เต็มที่ ไม่ต้องรวบ (กฎ 3 ย่อหน้าไม่ใช้กับโหมดนี้) แต่ต้องมีโครง อ่านไล่ได้
- ตัวเลขทุกตัวต้องมาจากข้อมูลจริงในบริบท ไม่มีก็บอกว่าไม่มีแล้วขอเพิ่ม ห้ามสมมติตัวเลขเอง
- ถ้าฐานการเงินหลักยังขาดข้อไหน ให้วิเคราะห์เท่าที่มีก่อน แล้วปิดท้ายด้วยการขอข้อมูลที่ขาด
  พร้อมบอกว่าถ้ามีข้อมูลนั้นแล้วคำตอบจะเปลี่ยนตรงไหน
- ลิสต์เขียนบรรทัดละรายการ ห้าม markdown`,
    );
  }

  // ===== ไปหาข้อเท็จจริงมาก่อนตอบ (D1 — 5 ส.ค. 2026) =====
  //
  // เดิมตรงนี้ประกอบ prompt ก้อนใหญ่แล้วเรียกสมองรอบเดียว = ตอบจากเท่าที่ฉีดมาให้เท่านั้น
  // ไม่มีจังหวะ "เห็นผลแล้วคิดต่อ" → งานหลายขั้นทำไม่ได้ ต้องเดาหรือถามกลับ
  // ชั้นนี้ใช้เครื่องมืออ่านอย่างเดียวไปหาของจริงมาก่อน แล้วค่อยให้สมองหลักเรียบเรียง
  // (แยกสองชั้นเพราะเสียง/บุคลิกของ Vex ต้องมาจากสมองหลักเสมอ — กติกาข้อ 2)
  //
  // ข้ามเมื่อ: มีรูป/วิดีโอ (สมองหลักต้องดูภาพเอง) · เจ้าของพูดมาเป็นเสียง (ต้องตอบไว)
  if (!imageFiles.length && !videoFiles.length && !voiceNote && text.trim().length >= 6) {
    try {
      const { gatherFacts } = await import("@/lib/kiki-agent");
      const g = await gatherFacts(text, replyText ? `บริบท: เจ้าของกำลัง reply ข้อความนี้ """${replyText.slice(0, 1000)}"""` : "");
      if (g.notes) {
        ctxParts.push(
          `=== ข้อเท็จจริงที่ระบบไปหามาให้สด ๆ ก่อนตอบ (เชื่อถือได้ ใช้ตอบได้เลย) ===\n${g.notes}\n\n` +
            `ตัวเลข ราคา ลิงก์ ชื่อรุ่น ในนี้ต้องยกมาให้ครบเป๊ะ ห้ามปัด ห้ามตัดทิ้ง ห้ามแต่งเพิ่มเอง\n` +
            `ถ้าในนี้บอกว่าหาไม่เจอ/เปิดไม่ได้ ให้บอกเจ้าของตรง ๆ ห้ามเดาแทน`,
        );
      }
    } catch { /* หาไม่ได้ก็ตอบจากที่มีเหมือนเดิม ห้ามทำให้ทางเดิมพัง */ }
  }

  // เจ้าของสั่งให้ "เก็บเข้าคลัง/เข้าสมอง" มาพร้อมกับคำสั่งอื่น (6 ส.ค. 2026)
  // เคสจริงที่พัง: "ฝากโพสต์นี้ด้วย อธิบายละเอียด เสนอไอเดีย พร้อมเก็บเข้าสมอง"
  // → เข้าทาง chat (ถูกแล้ว เพราะขอหลายอย่าง) อธิบายให้ครบ แต่ไม่มีใครเก็บลิงก์ให้
  // เก็บเฉพาะที่สั่งเท่านั้น ตามกติกาข้อ 4 — ไม่สั่ง = อ่านให้ ตอบให้ แต่ไม่เขียนลงคลัง
  const wantSave = ctx.route.args?.save_link === true || ctx.arg("save_link") === "true";
  if (wantSave && urls.length) {
    const { saveLinkToPersonal } = await import("@/lib/kiki");
    const saved: string[] = [];
    for (const u of urls.slice(0, 3)) {
      const r = await saveLinkToPersonal(u, text.slice(0, 150)).catch(() => null);
      if (r) saved.push(r.title);
    }
    ctxParts.push(
      saved.length
        ? `[ระบบเก็บลิงก์เข้าคลังความรู้ส่วนตัวให้แล้วจริง: ${saved.join(" · ")} — บอกเจ้าของด้วยว่าเก็บแล้ว]`
        : `[เก็บลิงก์เข้าคลังไม่สำเร็จ — บอกเจ้าของตรง ๆ ห้ามบอกว่าเก็บแล้ว]`,
    );
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
