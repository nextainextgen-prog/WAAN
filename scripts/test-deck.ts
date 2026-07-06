import fs from "node:fs";
import { generateDeck } from "../src/lib/deck-generate.ts";
import { db } from "../src/lib/db.ts";

async function main() {
  // ใส่ข้อมูลตัวอย่างชั่วคราว
  await db.grant.deleteMany({});
  await db.grant.createMany({
    data: [
      { projectName: "การพัฒนาระบบวิเคราะห์ข้อมูลธุรกิจด้วย AI", source: "บพข", amount: 1200000, status: "in_progress", nextDeadline: new Date("2026-07-10") },
      { projectName: "นวัตกรรมการสอนดิจิทัล", source: "สกสว", amount: 2400000, status: "reporting", nextDeadline: new Date("2026-07-20") },
      { projectName: "การศึกษาพฤติกรรมผู้บริโภคยุคใหม่", source: "งบมหาวิทยาลัย", amount: 650000, status: "approved" },
      { projectName: "แพลตฟอร์มเรียนรู้ออนไลน์", source: "TRF", amount: 1800000, status: "in_progress", nextDeadline: new Date("2026-08-05") },
    ],
  });

  const { deck, html, pdf } = await generateDeck("สรุปสถานะทุนวิจัยและความคืบหน้า OKR ประจำไตรมาส");
  fs.writeFileSync("/tmp/memo-test/deck.html", html);
  fs.writeFileSync("/tmp/memo-test/deck.pdf", pdf);
  console.log("deck:", deck.title, "|", deck.slides.length, "สไลด์");
  console.log("layouts:", deck.slides.map((s) => s.layout).join(", "));
  console.log("pdf bytes:", pdf.length);

  await db.grant.deleteMany({});
  await db.$disconnect();
}
main();
