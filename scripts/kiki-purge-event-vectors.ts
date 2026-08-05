// ล้าง "เหตุการณ์เฝ้าระวัง" ออกจากคลังความจำเชิงความหมาย (รันครั้งเดียว)
// เหตุการณ์มีวันละหลายร้อยรายการ ถ้าปนอยู่ในคลัง ค้นอะไรก็เจอแต่แชทคนอื่น — ความจำจริงถูกกลบ
// รัน: npx tsx scripts/kiki-purge-event-vectors.ts
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { db } from "../src/lib/db";

async function main() {
  const rows = await db.kikiChat.findMany({ where: { scope: "owner", channel: "event" }, select: { id: true } });
  console.log(`เหตุการณ์ในประวัติ ${rows.length} แถว — กำลังถอดออกจากคลังความจำ`);
  const d = new Database(process.env.THUNDER_VEC_PATH || path.join(process.cwd(), "prisma", "thunder-vec.db"));
  sqliteVec.load(d);
  const del = d.prepare("DELETE FROM kiki_recall WHERE key = ?");
  let n = 0;
  for (const r of rows) {
    try {
      const res = del.run(`chat:${r.id}`);
      if (res.changes) n++;
    } catch { /* ไม่มีใน index ก็ข้าม */ }
  }
  const left = (d.prepare("SELECT count(*) AS c FROM kiki_recall").get() as { c: number }).c;
  console.log(`ถอดออก ${n} รายการ · เหลือในคลัง ${left} รายการ`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
