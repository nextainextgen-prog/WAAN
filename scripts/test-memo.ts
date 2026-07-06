import fs from "node:fs";
import { buildRefundMemoHtml } from "../src/lib/memo.ts";
import { renderHtmlToPdf } from "../src/lib/html-pdf.ts";

const html = buildRefundMemoHtml({
  docNo: "TS-CS-RF-2569-0007",
  date: "6 กรกฎาคม 2569",
  customerName: "บริษัท ไฮเฟน พลัส จำกัด",
  serviceUser: "dev.hyphenplus@gmail.com · API",
  packageName: "Ultimate Plan",
  months: 1,
  topupDate: "25 มิถุนายน 2569",
  priceNet: 5344.82,
  paid: 5400,
  whtRefund: 154.18,
  overpay: 55.18,
  totalRefund: 209.36,
  bank: "กสิกรไทย (KASIKORNBANK)",
  accountNo: "083-3-55843-9",
  accountName: "บจก. ไฮเฟน พลัส",
  attachments: [
    { label: "หนังสือรับรองการหักภาษี ณ ที่จ่าย", imagePath: "/tmp/memo-test/wht.png" },
    { label: "สลิปโอนเงิน", imagePath: "/tmp/memo-test/slip.png" },
    { label: "ภาพถ่ายหน้าสมุดบัญชีธนาคาร (Bookbank)", imagePath: "/tmp/memo-test/bookbank.png" },
    { label: "หลักฐานการสนทนายืนยันการคืนเงิน", imagePath: "/tmp/memo-test/chat.png" },
    { label: "ใบเสนอราคา", imagePath: "/tmp/memo-test/quotation.png" },
  ],
});

fs.writeFileSync("/tmp/memo-test/memo.html", html);
const pdf = await renderHtmlToPdf(html);
fs.writeFileSync("/tmp/memo-test/memo.pdf", pdf);
console.log("memo.pdf bytes:", pdf.length);
