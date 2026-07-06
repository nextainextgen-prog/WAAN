import { generateRefundMemo } from "../src/lib/memo-generate.ts";
import { saveMemoDraft, memoFilename } from "../src/lib/memo-store.ts";

const TOKEN = "8608153015:AAF6Ce2i3-yN7EZyorut94H3zSZH-GzOEJg";
const CHAT = "7750653134";

const adminText = `รบกวนออกเอกสารคืนเงินส่วนต่างหัก ณ ที่จ่าย และ ยอดส่วนเกินให้ลูกค้าค่ะ
ยูส dev.hyphenplus@gmail.com (API) บริการ ไฮเฟน พลัส
โอนบัญชีธนาคาร กสิกรไทย 083-3-55843-9 ชื่อบัญชี บจก. ไฮเฟน พลัส
ลูกค้าเติมเครดิตเพื่อต่ออายุแพ็กเกจ Ultimate plan จำนวน 1 เดือน โอนเข้ามา 5,400 บาท เมื่อ 25 มิถุนายน 2569 เวลา 08.17 น. ราคาที่ต้องชำระ 5,344.82 บาท ขอคืนส่วนต่างหัก ณ ที่จ่าย 3% 154.18 บาท และยอดส่วนเกิน 55.18 บาทค่ะ`;

async function main() {
  const res = await generateRefundMemo({
    rawText: adminText,
    date: "6 กรกฎาคม 2569",
    attachments: [
      { label: "หนังสือรับรองการหักภาษี ณ ที่จ่าย", imagePath: "/tmp/memo-test/wht.png" },
      { label: "สลิปโอนเงิน", imagePath: "/tmp/memo-test/slip.png" },
      { label: "ภาพถ่ายหน้าสมุดบัญชีธนาคาร (Bookbank)", imagePath: "/tmp/memo-test/bookbank.png" },
      { label: "หลักฐานการสนทนายืนยันการคืนเงิน", imagePath: "/tmp/memo-test/chat.png" },
      { label: "ใบเสนอราคา", imagePath: "/tmp/memo-test/quotation.png" },
    ],
  });
  const id = await saveMemoDraft(res.data, res.pdf);
  console.log("draft id:", id, "| refund:", res.data.refund, "| valid:", res.validation.ok);

  const caption = `ออกร่างเอกสารคืนเงินให้แล้วนะคะ (ยังไม่เซ็น)

ลูกค้า: ${res.data.serviceName}
ยอดคืนรวม: ${res.data.refund.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท (หัก ณ ที่จ่าย ${res.data.whtAmount} + ส่วนเกิน ${res.data.overpay})
แนบครบ ${res.data.attachments.length} ไฟล์

ลองเปิดดูก่อนได้เลยค่ะ ถ้าโอเคกด "เซ็นเลย" วานจะเติมลายเซ็นให้ ถ้าอยากปรับตรงไหนกด "แก้ไข" ได้เลยค่ะ`;
  const markup = JSON.stringify({
    inline_keyboard: [[
      { text: "เซ็นเลย", callback_data: `memo:sign:${id}` },
      { text: "แก้ไข", callback_data: `memo:revise:${id}` },
    ]],
  });

  const form = new FormData();
  form.append("chat_id", CHAT);
  form.append("caption", caption);
  form.append("reply_markup", markup);
  form.append("document", new Blob([new Uint8Array(res.pdf)]), memoFilename(res.data, false));
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendDocument`, { method: "POST", body: form });
  const j = await r.json();
  console.log("telegram:", j.ok ? "sent" : JSON.stringify(j).slice(0, 200));
}
main();
