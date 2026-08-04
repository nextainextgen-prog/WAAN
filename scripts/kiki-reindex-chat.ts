// backfill: index แชทเก่าทั้งหมดเข้าคลังความจำ (ค้นย้อนหลังได้) — รันครั้งเดียว: npx tsx scripts/kiki-reindex-chat.ts
import { db } from "../src/lib/db";
import { reindexChats } from "../src/lib/kiki-memory";

async function main() {
  const n = await db.kikiChat.count({ where: { scope: "owner" } });
  console.log(`แชทของเจ้าของทั้งหมด ${n} ข้อความ — เริ่ม index`);
  const t0 = Date.now();
  const r = await reindexChats(6000);
  console.log(`index แล้ว ${r.indexed} ข้อความ (${Math.round((Date.now() - t0) / 1000)} วินาที)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
