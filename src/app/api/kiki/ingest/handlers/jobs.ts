import { vexLine, askKiki, saveKikiChat } from "@/lib/kiki";
import { jobStatusReport, markUrgent, planJob, pushFocus, MAX_CONCURRENT } from "@/lib/kiki-jobs";
import { findJobByDelivered } from "@/lib/kiki-hermes";
import { isYoutubeUrl } from "@/lib/kiki";
import type { Ctx, Handler } from "../types";

/**
 * งานเบื้องหลังหลายเรื่องพร้อมกัน (สเปกข้อ 15)
 *
 * สองตัวจัดการนี้ต้องอยู่ "ก่อน" ตัวที่ลงมือทำงานยาว ๆ ในทะเบียน
 * ไม่งั้นเจ้าของจะนั่งรอ web_research/shopping/doc_summary ทำงานจนจบในคำขอเดียว
 */

/** "ที่สั่งไปถึงไหนแล้ว" — เดิมมีแต่ push ทุก 3 นาที ถามเองไม่ได้ */
export const jobStatusHandler: Handler = async (ctx) => {
  const { msgId, replyText, is, reply } = ctx;
  if (!is("job_status")) return null;
  const report = await jobStatusReport();
  if (!report) {
    // เจ้าของ reply ผลงานที่ส่งไปแล้วถามว่า "ไหนข้อมูล" = ผลอยู่ในมือเขาแล้ว ไม่ใช่ไม่มีงาน
    // เคสจริง 5 ส.ค.: ตอบไปว่า "ไม่มีงานค้าง ว่างสนิท" ทั้งที่เพิ่งส่งผลไปเมื่อกี้ — ไร้ประโยชน์สิ้นเชิง
    const src = replyText ? await findJobByDelivered(replyText) : null;
    if (src) {
      const say = await askKiki(
        `[เจ้าของ reply ผลงานที่ส่งไปแล้ว] เขาถามว่า "${ctx.text.slice(0, 200)}"\n` +
          `งานนั้นคือ: "${src.task.slice(0, 300)}"\nผลที่ส่งไปแล้วคือ:\n"""${(src.result || "").slice(0, 3000)}"""\n\n` +
          `ตอบจากผลที่มีอยู่นี้เลย — ถ้าผลไม่ได้ตอบสิ่งที่เขาถาม ให้บอกตรง ๆ ว่าผลรอบนั้นได้แค่ไหน แล้วเสนอว่าจะไปหาต่อให้ไหม\n` +
          `ห้ามบอกว่า "ไม่มีงานค้าง" เด็ดขาด`,
      ).catch(() => null);
      if (say) return reply([{ kind: "text", text: say, replyTo: msgId }]);
    }
    return reply([{ kind: "text", text: await vexLine("ตอนนี้ไม่มีงานค้างอยู่เลยครับ ว่างสนิท"), replyTo: msgId }]);
  }
  await markUrgent(); // ถามย้ำแล้ว = พอเสร็จให้พูดได้ทันที ไม่ต้องรอจังหวะ
  // ตัวเลข/ชื่องานต้องตรง แต่ให้ Vex เรียบเรียงเป็นภาษาพูดได้
  const say = await askKiki(
    `[รายงานสถานะงาน] เจ้าของถามว่างานที่สั่งไปถึงไหนแล้ว\nข้อเท็จจริง (ห้ามแต่งเพิ่ม ห้ามเปลี่ยนตัวเลข):\n${report}\n\n` +
      `ตอบเป็นภาษาพูดสั้น ๆ แบบเลขารายงาน ไม่เกิน 3 บรรทัด`,
  ).catch(() => report);
  return reply([{ kind: "text", text: say, replyTo: msgId }]);
};

/**
 * งานที่จะใช้เวลานาน → ตอบรับทันที แล้วโยนไปทำเบื้องหลัง
 * เจ้าของไม่ต้องพูดคำว่า "ฝากไว้" อีกต่อไป
 */
const LONG_INTENTS = ["web_research", "shopping", "doc_summary"];

export const autoBackgroundHandler: Handler = async (ctx: Ctx) => {
  const { text, replyText, chatId, msgId, route, is, channel, urls, reply } = ctx;
  if (!LONG_INTENTS.some((i) => is(i))) return null;

  // คลิป YouTube ห้ามฝาก Hermes เด็ดขาด — Hermes ดูคลิปไม่ได้ มันขูดหน้าเว็บแล้วเล่าจากนั้น
  // เจอตอนเทสจริง 5 ส.ค.: คลิปดัง ๆ ยังได้คำตอบถูกเพราะมีบทความให้ขูด แต่คลิปที่ไม่มีใครเขียนถึงจะพังเงียบ
  // ท่อของ Vex เอง (summarizeYoutube) ดูภาพจริง — เทสแล้วบรรยายได้ถึงสีเสื้อ/โซ่ที่ขาช้าง/ฟางแขวน
  if (urls.some(isYoutubeUrl)) return null;
  // เจ้าของสั่ง "ฝาก" เองอยู่แล้ว = ตัวจัดการ hermes รับไปก่อนหน้านี้แล้ว
  // replyText ต้องส่งเข้าไปด้วย ไม่งั้น "ไปหาใหม่หน่อย งบ 500" ออกไปโดยไม่มีคำว่า "หาอะไร" ติดไปเลย
  const plan = await planJob(text, route.intent, replyText);
  if (!plan.background) return null; // งานสั้น ให้ตัวจัดการเดิมทำสด ๆ ไป

  // งานที่ต้องใช้ข้อมูลส่วนตัว ฝาก Hermes ไม่ได้ (กฎเดิมของ kiki-hermes: ส่งไปเฉพาะโจทย์ที่พิมพ์)
  // → ปล่อยให้ตัวจัดการเดิมทำสดในคำขอนี้ ยอมช้าดีกว่าข้อมูลส่วนตัวหลุดออกนอก
  if (plan.runner === "vex") return null;

  const { kikiHermesReady, queueHermesJob } = await import("@/lib/kiki-hermes");
  if (!kikiHermesReady()) return null; // ไม่มีตัวรับงาน = ให้ตัวจัดการเดิมทำสดไป

  // ส่ง brief (โจทย์ที่สมบูรณ์ในตัว) ไม่ใช่ text ดิบ · ผูกกับงานเดิมถ้าเจ้าของ reply ผลงานเก่า
  const parent = replyText ? await findJobByDelivered(replyText) : null;
  const q = await queueHermesJob(chatId, plan.brief, parent?.id);
  await pushFocus({ kind: "job", ref: q.id, label: plan.topic });
  await saveKikiChat("assistant", `[รับงานเบื้องหลัง] ${plan.topic}`, "owner", channel);

  const wait = q.queued
    ? `ตอนนี้มีงานเต็มมืออยู่ ${MAX_CONCURRENT} เรื่อง เรื่องนี้ต่อคิวเป็นลำดับที่ ${q.ahead + 1} ครับ`
    : `น่าจะใช้เวลาราว ${Math.ceil(plan.seconds / 60)} นาที`;
  return reply([{
    kind: "text",
    text: await vexLine(`${plan.ack}\n\nเรื่อง: ${plan.topic}\n${wait} — เสร็จแล้วผมเอามาบอกเอง ระหว่างนี้สั่งเรื่องอื่นได้ปกติ`),
    replyTo: msgId,
  }]);
};
