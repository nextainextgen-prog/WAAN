import { saveKikiChat, vexLine } from "./kiki";

/**
 * ส่งข้อความ "นอกรอบ request" (กลุ่ม A1 — 7 ส.ค. 2026)
 *
 * ปัญหา: ท่อ Telegram (kiki-bot.mjs) ยิง ingest แล้ว "รอ" คำตอบทั้งก้อน — คำถามหนักเงียบ 60-100+ วิ
 * เจ้าของนั่งจ้องจอโดยไม่รู้ว่าระบบยังทำงานอยู่ไหม ซึ่งทำให้ดูโง่ทั้งที่คำตอบกำลังมา
 *
 * ชั้นนี้ให้เว็บส่งข้อความถึง Telegram ได้เองทันทีระหว่างที่ยังคิดไม่เสร็จ
 * (วิธีเดียวกับที่ kiki-dev-run.ts รายงานผลงานพัฒนา — ใช้ KIKI_BOT_TOKEN ตรง)
 */

export async function tgDirectSend(
  chatId: string,
  text: string,
  opts: { buttons?: { text: string; data: string }[][]; replyTo?: number | string } = {},
): Promise<boolean> {
  const token = (process.env.KIKI_BOT_TOKEN || "").trim();
  if (!token || !chatId || !text.trim()) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 3900),
        ...(opts.replyTo ? { reply_parameters: { message_id: Number(opts.replyTo) || undefined } } : {}),
        ...(opts.buttons ? { reply_markup: { inline_keyboard: opts.buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return j.ok === true;
  } catch {
    return false;
  }
}

/**
 * ตอบรับเมื่อ "ช้าจริง" — ตั้งนาฬิกาไว้ ถ้าคำตอบยังไม่เสร็จใน ackAfterMs ค่อยส่งเสียงตอบรับ
 * (ไม่ ack ทุกครั้ง — คำตอบที่มาใน 5 วิ ไม่ต้องการคำเกริ่น การ ack พร่ำเพรื่อคือสแปม)
 *
 * ผู้เรียกได้ฟังก์ชัน cancel กลับไป — เรียกเมื่อคำตอบพร้อม ถ้ายังไม่ถึงเวลา ack = เงียบไปเลย
 * ทุกอย่าง fire-and-forget: ack ล่มไม่กระทบคำตอบจริงแม้แต่นิดเดียว
 */
export function armSlowAck(input: {
  chatId: string;
  platform: string;
  channel: string;
  /** สิ่งที่กำลังทำ (ไว้ให้ vexLine แต่งประโยค) เช่น "ไล่หาข้อมูลจริงก่อนตอบ" */
  doing: string;
  /** ผูก ack กับข้อความต้นทาง — ไม่ผูกแล้วเคยหลงบริบท (ack ของคำถามเก่าไปโผล่ใต้ข้อความใหม่
   *  เจ้าของบอก "แก้ CRM เสร็จแล้ว" ระบบตอบ "กำลังรวบรวมข้อมูล" = ดูเหมือนตอบไม่ตรงคำถาม) */
  replyTo?: number | string;
  ackAfterMs?: number;
}): () => void {
  // ส่งตรงได้เฉพาะ Telegram — ช่องทางอื่นท่อไม่ได้อ่านจาก API นี้ (Discord มี outbox ของตัวเอง)
  if (input.platform !== "telegram") return () => {};
  let done = false;
  const timer = setTimeout(() => {
    if (done) return;
    void (async () => {
      const line = await vexLine(`กำลัง${input.doing}อยู่ ใช้เวลาหน่อย เดี๋ยวคำตอบเต็มตามมาครับ`, { maxLines: 1 }).catch(
        () => `กำลัง${input.doing}อยู่ครับ เดี๋ยวคำตอบเต็มตามมา`, // canned-ok: ทางถอยตอน vexLine ล่ม — ห้ามปล่อยให้ความเงียบชนะ
      );
      const sent = await tgDirectSend(input.chatId, line, { replyTo: input.replyTo });
      // บันทึกลงประวัติด้วย — ไม่งั้นเทิร์นถัดไป Vex ไม่รู้ว่าตัวเองเพิ่งบอกว่า "กำลังหา"
      if (sent) await saveKikiChat("assistant", line, "owner", input.channel).catch(() => {});
    })();
  }, input.ackAfterMs ?? 8_000);
  return () => {
    done = true;
    clearTimeout(timer);
  };
}
