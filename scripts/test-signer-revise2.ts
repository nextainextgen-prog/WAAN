// เทสรอบ 2: (ก) สั่งแก้เฉพาะชื่อ ไม่บอกตำแหน่ง (ข) แก้เรื่องอื่นต่อ ผู้ลงนามต้องไม่เด้งกลับ (ค) เอกสารที่ออกจากแชท (rawText)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRefundMemoFromForm, generateRefundMemo } from "@/lib/memo-generate";
import { saveMemoDraft, reviseMemo, readMemoPdf } from "@/lib/memo-store";
import type { RefundFormInput } from "@/lib/refund-slots";

function pdfText(buf: Buffer): string {
  const p = path.join(os.tmpdir(), `memo-t2-${Date.now()}.pdf`);
  fs.writeFileSync(p, buf);
  let out = "";
  try {
    out = execFileSync("pdftotext", ["-layout", p, "-"], { encoding: "utf8" });
  } catch {
    out = execFileSync("pdftotext", ["-upw", "11221122", "-layout", p, "-"], { encoding: "utf8" });
  }
  fs.unlinkSync(p);
  return out.replace(/\s+/g, " ");
}

const form: RefundFormInput = {
  brand: "thunder", docType: "general", user: "test2@mail.com", userId: "TS-2",
  companyName: "หจก. ทดสอบสอง", serviceLabel: "API", reason: "เทสรอบสอง",
  topupDate: "01/07/2569", amount: 2000, purchaseDate: "01/07/2569",
  packageName: "PRO", months: 1, netPrice: 1800, refund: 200,
  bank: "ไทยพาณิชย์", accountNo: "111-2-33333-4", accountName: "หจก. ทดสอบสอง",
};

async function main() {
  const ok: [string, boolean][] = [];

  // ===== (ก) แก้เฉพาะชื่อผู้อนุมัติ ไม่บอกตำแหน่ง =====
  const a = await createRefundMemoFromForm({ form, attachments: [], attachNote: "", date: "29 กรกฎาคม 2569" });
  const idA = await saveMemoDraft(a.data, a.pdf, undefined, form);
  await reviseMemo(idA, "ผู้อนุมัติเปลี่ยนเป็น นางสาว สมหญิง ใจดี");
  const t1 = pdfText((await readMemoPdf(idA))!);
  ok.push(["(ก) ชื่อผู้อนุมัติใหม่ขึ้นแล้ว", t1.includes("สมหญิง ใจดี")]);
  ok.push(["(ก) ตำแหน่งเดิมยังอยู่ (ไม่เดาให้)", t1.includes("ประธานเจ้าหน้าที่ฝ่ายปฏิบัติการ")]);

  // ===== (ข) แก้เรื่องอื่นต่อ ผู้ลงนามที่เพิ่งแก้ต้องไม่หาย =====
  await reviseMemo(idA, "แก้ธนาคารเป็น กรุงเทพ เลขบัญชี 999-8-77777-6");
  const t2 = pdfText((await readMemoPdf(idA))!);
  ok.push(["(ข) ธนาคารใหม่เข้าแล้ว", t2.includes("กรุงเทพ") && t2.includes("999-8-77777-6")]);
  ok.push(["(ข) ผู้อนุมัติที่แก้ไว้ยังอยู่", t2.includes("สมหญิง ใจดี")]);

  // ===== (ค) เอกสารที่ออกจากแชท (path rawText ไม่มีฟอร์ม) =====
  const rawText = [
    "ยูส chat-user@mail.com (API)",
    "โอนบัญชีธนาคาร กสิกรไทย",
    "083-5-55843-9",
    "ชื่อบัญชี บจก. แชททดสอบ",
    "ลูกค้าเติมเครดิตเพื่อต่ออายุแพ็กเกจ Ultimate plan จำนวน 1 เดือน",
    "ราคาที่ต้องชำระ 5,344.82 บาท ลูกค้าชำระไปแล้ว 5,400 บาท",
    "ลูกค้าต้องการขอคืนเงิน ส่วนต่างหัก ณ ที่จ่าย 154.18 บาท และ ยอดส่วนเกิน 55.18 บาท",
  ].join("\n");
  const c = await generateRefundMemo({ rawText, attachments: [], date: "29 กรกฎาคม 2569" });
  const idC = await saveMemoDraft(c.data, c.pdf, rawText);
  await reviseMemo(idC, "เปลี่ยนผู้ตรวจสอบเป็น นาย ตรวจ สอบดี ตำแหน่ง หัวหน้าฝ่ายตรวจสอบ");
  const t3 = pdfText((await readMemoPdf(idC))!);
  ok.push(["(ค) ผู้ตรวจสอบใหม่ขึ้นในเอกสารจากแชท", t3.includes("ตรวจ สอบดี") && t3.includes("หัวหน้าฝ่ายตรวจสอบ")]);
  ok.push(["(ค) ผู้ตรวจสอบเดิมหายไป", !t3.includes("ศิริลักษณ์ ชอบธรรม")]);
  ok.push(["(ค) ผู้อนุมัติยังเป็นค่าเริ่มต้น", t3.includes("สมพร เสริฐศรี")]);
  await reviseMemo(idC, "แก้ยอดส่วนเกินเป็น 60 บาท");
  const t4 = pdfText((await readMemoPdf(idC))!);
  ok.push(["(ค) แก้เรื่องอื่นต่อ ผู้ตรวจสอบที่แก้ไว้ยังอยู่", t4.includes("ตรวจ สอบดี")]);

  for (const [label, pass] of ok) console.log(` ${pass ? "✓" : "✗"} ${label}`);
  console.log(`\nผ่าน ${ok.filter(([, p]) => p).length}/${ok.length} · memo ${idA}, ${idC}`);
}
main();
