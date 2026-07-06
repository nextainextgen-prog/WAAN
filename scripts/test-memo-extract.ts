import fs from "node:fs";
import { generateRefundMemo } from "../src/lib/memo-generate.ts";

const adminText = `รบกวนออกเอกสารคืนเงินส่วนต่างหัก ณ ที่จ่าย และ ยอดส่วนเกินให้ลูกค้าค่ะ
ยูส dev.hyphenplus@gmail.com (API)
โอนบัญชีธนาคาร กสิกรไทย
083-3-55843-9
ชื่อบัญชี บจก. ไฮเฟน พลัส
ลูกค้าเติมเครดิตเพื่อต่ออายุแพ็กเกจ Ultimate plan จำนวน 1 เดือน ราคาที่ต้องชำระ 5,344.82 บาท ลูกค้าชำระไปแล้ว 5,400 บาท ลูกค้าต้องการขอคืนเงิน ส่วนต่างหัก ณ ที่จ่าย 154.18 บาท และ ยอดส่วนเกิน 55.18 บาทค่ะ`;

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

console.log("=== ข้อมูลที่ Claude ดึงได้ ===");
console.log("ลูกค้า:", res.data.customerName);
console.log("บริการ:", res.data.serviceUser);
console.log("แพ็กเกจ:", res.data.packageName, "|", res.data.months, "เดือน");
console.log("สุทธิ:", res.data.priceNet, "| ชำระ:", res.data.paid);
console.log("คืน WHT:", res.data.whtRefund, "| ส่วนเกิน:", res.data.overpay, "| รวมคืน:", res.data.totalRefund);
console.log("บัญชี:", res.data.bank, res.data.accountNo, res.data.accountName);
console.log("ตรวจเลข:", res.validation.ok ? "ผ่าน" : "เตือน: " + res.validation.warnings.join("; "));
fs.writeFileSync("/tmp/memo-test/memo-final.pdf", res.pdf);
console.log("PDF:", res.pdf.length, "bytes");
}
main();
