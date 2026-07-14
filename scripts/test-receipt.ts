import fs from "node:fs";
import { buildReceiptPdf, bahtText, type ReceiptData } from "../src/lib/aff-receipt.ts";

const OUT = "/private/tmp/claude-501/-Users-mx-Projects-AITransformation/72164e5d-3fef-418e-8725-897b3c02409c/scratchpad";

async function main() {
  for (const n of [1775.1, 3686, 1164, 21, 100011, 0.5]) console.log(`${n} ->`, bahtText(n));

  // ตัวอย่าง massang (Image#40/#41)
  const d: ReceiptData = {
    day: "1", month: "05", yearBE: "2569",
    prefix: "นาย", name: "นพวินทร์ อัครเอกนิธิภัทร์",
    taxId: "1449900290369",
    houseNo: "18", moo: "12", road: "-",
    tambon: "สร้างแซ่ง", amphoe: "ยางสีสุราช", changwat: "มหาสารคาม",
    items: [{ desc: "ค่าคอมมิชชั่นจากการแนะนำผู้ใช้", amount: 1830 }],
    gross: 1830, whtRate: 3, wht: 54.9, net: 1775.1,
  };

  const pdf = await buildReceiptPdf(d);
  fs.writeFileSync(`${OUT}/receipt-preview.pdf`, pdf);
  console.log("wrote receipt-preview.pdf", pdf.length, "bytes");
}
main();
