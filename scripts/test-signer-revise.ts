// เทสจริง: ออกเอกสารจากฟอร์ม → สั่งแก้ผู้ลงนาม/วันที่แบบพิมพ์ภาษาคน (เหมือน reply ในแชท) → อ่านข้อความใน PDF จริง
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRefundMemoFromForm } from "@/lib/memo-generate";
import { saveMemoDraft, reviseMemo, readMemoPdf } from "@/lib/memo-store";
import type { RefundFormInput } from "@/lib/refund-slots";

const form: RefundFormInput = {
  brand: "easyslip",
  docType: "general",
  user: "mlittlepony.999@gmail.com",
  userId: "TS-0001",
  companyName: "บริษัท ทดสอบ จำกัด",
  serviceLabel: "BoostSMS",
  reason: "ทดสอบระบบแก้ผู้ลงนามผ่านแชท",
  topupDate: "01/07/2569",
  amount: 1000,
  purchaseDate: "01/07/2569",
  packageName: "Silver",
  months: 1,
  netPrice: 900,
  refund: 100,
  bank: "กสิกรไทย",
  accountNo: "123-4-56789-0",
  accountName: "บริษัท ทดสอบ จำกัด",
};

function pdfText(buf: Buffer): string {
  const p = path.join(os.tmpdir(), `memo-test-${Date.now()}.pdf`);
  fs.writeFileSync(p, buf);
  // ไฟล์ที่เก็บในระบบถูกล็อกรหัสไว้ (รหัสเปิดเอกสารของบริษัท) → ลองแบบไม่มีรหัสก่อน ไม่ได้ค่อยใส่รหัส
  let out = "";
  try {
    out = execFileSync("pdftotext", ["-layout", p, "-"], { encoding: "utf8" });
  } catch {
    out = execFileSync("pdftotext", ["-upw", "11221122", "-layout", p, "-"], { encoding: "utf8" });
  }
  fs.unlinkSync(p);
  return out.replace(/\s+/g, " ");
}

async function main() {
const { data, pdf } = await createRefundMemoFromForm({
  form,
  attachments: [],
  attachNote: "",
  date: "29 กรกฎาคม 2569",
});
const id = await saveMemoDraft(data, pdf, undefined, form);
const before = pdfText(pdf);
console.log("ฉบับแรก:");
console.log("  ผู้อนุมัติ =", /\( *(นาย สมพร เสริฐศรี) *\)/.test(before) ? "นาย สมพร เสริฐศรี (ค่าเริ่มต้น) ✓" : "ไม่พบค่าเริ่มต้น ✗");
console.log("  วันที่ 29 กรกฎาคม 2569:", before.includes("29 กรกฎาคม 2569") ? "✓" : "✗");

const instruction =
  "เปลี่ยนผู้อนุมัติเป็น นาย ทดสอบ ระบบดี ตำแหน่ง ผู้จัดการทั่วไป และเปลี่ยนวันที่เอกสารเป็น 30 กรกฎาคม 2569";
console.log(`\nคำสั่งที่พิมพ์ (จำลอง reply ในแชท):\n  "${instruction}"\n`);
const res = await reviseMemo(id, instruction);
if (!res.ok || !res.data) throw new Error("revise ไม่สำเร็จ");
const after = pdfText((await readMemoPdf(id))!);

const checks: [string, boolean][] = [
  ["ผู้อนุมัติเปลี่ยนเป็น นาย ทดสอบ ระบบดี", after.includes("นาย ทดสอบ ระบบดี")],
  ["ตำแหน่งผู้อนุมัติเปลี่ยนเป็น ผู้จัดการทั่วไป", after.includes("ผู้จัดการทั่วไป")],
  ["วันที่เอกสารเปลี่ยนเป็น 30 กรกฎาคม 2569", after.includes("30 กรกฎาคม 2569")],
  ["ชื่อผู้อนุมัติเดิมหายไปแล้ว", !after.includes("สมพร เสริฐศรี")],
  ["ผู้จัดทำยังเป็นคนเดิม (ไม่โดนแก้ตาม)", after.includes("จิรภัทร์ ภูครองหิน")],
  ["ผู้ตรวจสอบยังเป็นคนเดิม", after.includes("ศิริลักษณ์ ชอบธรรม")],
  ["ข้อมูลลูกค้าไม่เพี้ยน (ยอดคืน 100)", after.includes("100.00")],
  ["ประเภทบริการ BoostSMS ยังอยู่", after.includes("BoostSMS")],
];
console.log("ผลหลังแก้:");
for (const [label, ok] of checks) console.log(` ${ok ? "✓" : "✗"} ${label}`);
console.log("\nค่าที่บันทึกไว้:", {
  approverName: res.data.approverName,
  approverPosition: res.data.approverPosition,
  date: res.data.date,
  makerName: res.data.makerName || "(ค่าเริ่มต้น)",
});
console.log("memo id:", id, "· ผ่าน", checks.filter(([, o]) => o).length, "/", checks.length);
}
main();
