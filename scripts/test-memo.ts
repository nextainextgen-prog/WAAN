import fs from "node:fs";
import { buildRefundMemoHtml } from "../src/lib/memo.ts";
import { renderHtmlToPdf } from "../src/lib/html-pdf.ts";

// ข้อมูลตรงกับต้นฉบับ สยามมิตรภาพ (ไว้เทียบ layout)
async function main() {
const html = buildRefundMemoHtml({
  docNo: "TS-CS-RF-2568-0001",
  date: "15 ตุลาคม 2568",
  subject: "คืนเงินลูกค้าหัก ณ ที่จ่าย",
  topupDate: "2 ตุลาคม พ.ศ. 2568",
  topupTime: "13.16",
  user: "Natchayafasai",
  serviceName: "สยามมิตรภาพ",
  packageName: "Verify Slip Basic",
  months: 12,
  amount: 2149.2,
  whtRate: 3,
  whtAmount: 60.26,
  overpay: 0,
  refund: 60.26,
  bank: "ไทยพาณิชย์",
  accountNo: "432-1255-926",
  accountName: "บริษัท สยามมิตรภาพ จำกัด",
  attachments: [
    { label: "หนังสือรับรองการหักภาษี ณ ที่จ่าย", imagePath: "/tmp/memo-test/wht.png" },
    { label: "สลิปโอนเงิน", imagePath: "/tmp/memo-test/slip.png" },
  ],
});

fs.writeFileSync("/tmp/memo-test/memo.html", html);
const pdf = await renderHtmlToPdf(html);
fs.writeFileSync("/tmp/memo-test/memo.pdf", pdf);
console.log("memo.pdf bytes:", pdf.length);
}
main();
