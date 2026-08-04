// เทสตัวตีความคำสั่งแก้เอกสาร AFF — เน้นเคสที่เคยพัง (ประโยคคำสั่งหลุดลงเอกสาร / แก้ผิดช่อง)
import fs from "node:fs";
import path from "node:path";
for (const line of fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const SUMMARY = [
  "1. ยูสเซอร์ : bankzmws",
  "2. ชื่อ : นายธนโชติ กมลมาตย์",
  "3. ที่อยู่ : 392/47 หมู่ 10 ต.บางพระ อ.ศรีราชา จ.ชลบุรี",
  "4. เลขผู้เสียภาษี : 1209702021941",
  "5. วันที่ทำการถอน : 13/07/69",
  "6. จำนวนเงินที่ถอน : 1,000.00 บาท",
  "7. จำนวนเงินที่ถูกหัก (3%) : 30.00 บาท",
  "8. ที่อยู่ในการจัดส่งเอกสาร : -",
].join("\n");

async function main() {
  const { interpretEdit, buildDiff, parseFieldValue, validateOverrides } = await import("@/lib/aff-edit");
  const { parseEdit } = await import("@/lib/aff-make");
  let pass = 0, fail = 0;
  const ok = (label: string, cond: boolean, extra?: unknown) => {
    if (cond) { pass++; console.log(` ✓ ${label}`); }
    else { fail++; console.log(` ✗ ${label}`, extra !== undefined ? JSON.stringify(extra) : ""); }
  };

  console.log("— เคสที่เคยพัง (regex กวาดทั้งบรรทัด) —");
  const bug1 = parseEdit("ชื่อผิดครับ แก้เป็น นายสมชาย ใจดี");
  ok('ชื่อไม่ติดประโยคคำสั่ง → "สมชาย ใจดี"', bug1.name === "สมชาย ใจดี" && bug1.prefix === "นาย", bug1);

  const bug2 = await interpretEdit("ธนาคารผิด แก้เป็น ธนาคารกสิกรไทย เลขบัญชี 1234567890 ด้วยนะครับ");
  ok("ธนาคารได้แค่ชื่อธนาคาร", bug2.overrides.bank === "ธนาคารกสิกรไทย", bug2.overrides);
  ok("เลขบัญชีถูกต้อง", bug2.overrides.account === "1234567890", bug2.overrides);

  const bug3 = await interpretEdit("แก้ชื่อหน่อยครับ พิมพ์ผิด");
  ok("คำสั่งกำกวมไม่ยัดค่าอะไรลงเอกสาร", Object.keys(bug3.overrides).length === 0, bug3);

  console.log("\n— ทางที่ 2: อ้างเลขข้อ (แก้หลายช่องพร้อมกัน) —");
  const num = await interpretEdit("2 = นายสมชาย ใจดี\n6 = 1500\n4 = 1101801099364");
  ok("ข้อ 2 → ชื่อ", num.overrides.name === "สมชาย ใจดี" && num.overrides.prefix === "นาย", num.overrides);
  ok("ข้อ 6 → ยอด 1500", num.overrides.gross === 1500, num.overrides);
  ok("ข้อ 4 → เลขภาษี", num.overrides.taxId === "1101801099364", num.overrides);

  const numAddr = await interpretEdit("3 = 88/2 หมู่ 5 ต.บางพระ อ.ศรีราชา จ.ชลบุรี");
  ok("ข้อ 3 → ที่อยู่แยกส่วนครบ",
    numAddr.overrides.houseNo === "88/2" && numAddr.overrides.moo === "5" && numAddr.overrides.tambon === "บางพระ" && numAddr.overrides.amphoe === "ศรีราชา" && numAddr.overrides.changwat === "ชลบุรี",
    numAddr.overrides);

  const locked = await interpretEdit("1 = bankzmws2\n7 = 50");
  ok("ข้อที่แก้ไม่ได้ → บอกเหตุผล ไม่แก้เงียบ", Object.keys(locked.overrides).length === 0 && locked.unsupported.length === 2, locked);

  console.log("\n— ทางที่ 3: กดปุ่มเลือกช่องแล้วพิมพ์ค่าล้วน —");
  const f1 = validateOverrides(await parseFieldValue("name", "นางสาว ปุณญณุช ศรีไชยา"));
  ok("ช่องชื่อ → แยกคำนำหน้า", f1.clean.prefix === "นางสาว" && f1.clean.name === "ปุณญณุช ศรีไชยา", f1);
  const f2 = validateOverrides(await parseFieldValue("date", "13 กรกฎาคม 2569"));
  ok("ช่องวันที่ (ไทยเต็ม)", f2.clean.day === "13" && f2.clean.month === "07" && f2.clean.yearBE === "2569", f2);
  const f3 = validateOverrides(await parseFieldValue("bankAccount", "กสิกรไทย 058-1-17503-5"));
  ok("ช่องธนาคาร/บัญชี", f3.clean.bank === "ธนาคารกสิกรไทย" && f3.clean.account === "058117503 5".replace(/\D/g, ""), f3);
  const f4 = validateOverrides(await parseFieldValue("taxId", "12097020219"));
  ok("เลขภาษีไม่ครบ 13 หลัก → ปฏิเสธ + บอกเหตุผล", !f4.clean.taxId && f4.rejected.length === 1, f4);
  const f5 = validateOverrides(await parseFieldValue("gross", "1,500 บาท"));
  ok("ยอดเงินมี comma/หน่วย", f5.clean.gross === 1500, f5);

  console.log("\n— การ์ดยืนยัน (เดิม → ใหม่) —");
  const diff = buildDiff(SUMMARY, num.overrides);
  ok("โชว์ diff ครบ 3 ช่องที่แก้", diff.length === 3, diff);
  ok("ชื่อ: เดิมถูกต้อง", diff.find((d) => d.label === "ชื่อผู้รับเงิน")?.from === "นายธนโชติ กมลมาตย์", diff);
  ok("ชื่อ: ใหม่ถูกต้อง", diff.find((d) => d.label === "ชื่อผู้รับเงิน")?.to === "นายสมชาย ใจดี", diff);
  const diffAddr = buildDiff(SUMMARY, numAddr.overrides);
  ok("ที่อยู่: โชว์ที่อยู่ใหม่เต็มบรรทัด (ผสมของเดิม)", diffAddr[0]?.to === "88/2 หมู่ 5 ต.บางพระ อ.ศรีราชา จ.ชลบุรี", diffAddr);

  console.log("\n— validate กันขยะลงเอกสาร —");
  const junk = validateOverrides({ name: "แก้เป็นชื่อใหม่หน่อยครับ", taxId: "abc", account: "12", gross: -5, tambon: "ช่วยแก้ให้หน่อยนะครับ" } as never);
  ok("ทิ้งค่าขยะทั้งหมด", Object.keys(junk.clean).length === 0, junk.clean);
  ok("บอกเหตุผลครบทุกช่องที่ทิ้ง", junk.rejected.length === 5, junk.rejected);

  console.log(`\nผ่าน ${pass}/${pass + fail}`);
  if (fail) process.exitCode = 1;
}
main();
