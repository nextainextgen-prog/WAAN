// ตรวจว่ามี "ข้อความสำเร็จรูป" หลุดกลับมาในทางตอบของ Vex ไหม
// เจ้าของสั่ง 4 ส.ค. 2026: "ถ้ามีอะไรที่ตั้งฟิกไม่เอา และอย่าให้เกิดเหตุการณ์นี้ขึ้นอีก"
//   (เคส: ถาม "รู้จักผมมั้ย" 3 แบบ ได้ลิสต์ข้อความเดียวกันเป๊ะทั้ง 3 ครั้ง)
//
// กติกา: ข้อความที่ส่งหาเจ้าของต้องผ่านตัวใดตัวหนึ่งเสมอ
//   vexLine() = พูดใจความเดิมด้วยคำใหม่ทุกครั้ง (ใช้กับข้อความยืนยัน/ทางตัน/ข้อผิดพลาด)
//   askKiki() / vexSay() = ตอบคำถามด้วยสมองจริง
//   vexList() / vexSections() = ลิสต์ข้อมูลที่ต้องเป็นระเบียบ (ตัวเลข/รายการ ห้ามให้ AI แต่ง)
// ยกเว้นได้เมื่อจำเป็นจริง โดยเติมคอมเมนต์ `canned-ok:` พร้อมเหตุผลไว้บรรทัดเดียวกันหรือบรรทัดบน
//
// รัน: npm run kiki:check

import fs from "node:fs";
import path from "node:path";

// ไล่ทุกไฟล์ในโฟลเดอร์ ingest (route + types + shared + handlers/*) — อย่าลิสต์ทีละไฟล์
// เคยพลาด 4 ส.ค. 2026: ผ่า route.ts ออกเป็น handlers/ แล้วตัวตรวจไม่รู้จัก
// กฎเลยหยุดบังคับใช้เงียบ ๆ (จาก 16 จุดที่เฝ้าอยู่ เหลือ 2)
function walkTs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walkTs(p) : e.name.endsWith(".ts") ? [p] : [];
  });
}

const FILES = [
  ...walkTs("src/app/api/kiki"),
  ...fs.readdirSync("src/lib").filter((f) => /^kiki.*\.ts$/.test(f)).map((f) => path.join("src/lib", f)),
];

const WRAPPED = /vexLine\(|vexSay\(|askKiki\(|vexList\(|vexSections\(|itemizedText\(|\.text\b/;
const THAI = /[ก-๙]/;

let bad = 0;
let okSkipped = 0;

for (const file of FILES) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const m = line.match(/text:\s*(`[^`]{20,}`|"[^"]{20,}"|'[^']{20,}')/);
    if (!m || !THAI.test(m[1])) return;
    // ในไฟล์ lib ให้ตรวจเฉพาะข้อความที่ส่งเข้าแชทจริง (ไม่ใช่ prompt ที่ส่งให้โมเดล)
    if (file.startsWith("src/lib") && !/kind: "text"|return \{ text:/.test(line)) return;
    if (WRAPPED.test(line)) return;
    const prev = lines[i - 1] || "";
    if (/canned-ok/.test(line) || /canned-ok/.test(prev)) { okSkipped++; return; }
    bad++;
    console.log(`${file}:${i + 1}\n    ${line.trim().slice(0, 150)}`);
  });
}

console.log(
  bad
    ? `\nเจอข้อความสำเร็จรูปที่ยังไม่ได้ครอบ ${bad} จุด — ครอบด้วย vexLine() หรือใส่คอมเมนต์ canned-ok: <เหตุผล>`
    : `ผ่าน — ไม่มีข้อความสำเร็จรูปตกค้าง (ยกเว้นที่อนุญาตไว้ ${okSkipped} จุด)`,
);
process.exit(bad ? 1 : 0);
