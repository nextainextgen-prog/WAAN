// ===== Thunder Ingestion =====
// อ่านความจำที่มีอยู่ (BotActivity) → สร้าง/อัปเดต Customer + CustomerIdentity + CustomerFact
// + ฝัง (embed) ThunderKnowledge ที่ยังไม่มีเวกเตอร์ ลง sqlite-vec
// รันซ้ำได้ (idempotent): npx tsx --tsconfig tsconfig.json scripts/thunder-ingest.ts
import { db } from "@/lib/db";
import { embedReady, embedText } from "@/lib/embeddings";
import { upsertKnowledgeVector, vectorCount } from "@/lib/vector";

const TH = 7 * 3600_000;
const MONITOR_KINDS = ["waiting-alert", "close-remind", "watch-close", "session-expired"];

function norm(s: string | null | undefined): string {
  return (s || "").trim();
}
function peakHourLabel(hours: number[]): string {
  if (!hours.length) return "-";
  const c: Record<number, number> = {};
  for (const h of hours) c[h] = (c[h] || 0) + 1;
  const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  const h = Number(top[0]);
  const part = h < 6 ? "กลางคืน" : h < 12 ? "เช้า" : h < 17 ? "บ่าย" : h < 20 ? "เย็น" : "ค่ำ";
  return `${part} (${String(h).padStart(2, "0")}:00-${String((h + 1) % 24).padStart(2, "0")}:00) บ่อยสุด`;
}

async function ingestCustomers() {
  const rows = await db.botActivity.findMany({
    where: { kind: { in: MONITOR_KINDS }, customer: { not: null } },
    select: { customer: true, channel: true, company: true, platform: true, admin: true, kind: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  type Agg = {
    name: string; brand: string; platforms: Set<string>; admins: Record<string, number>;
    hours: number[]; count: number; waiting: number; first: number; last: number;
  };
  const map = new Map<string, Agg>();
  for (const r of rows) {
    const name = norm(r.customer);
    if (name.length < 2) continue;
    const brand = norm(r.channel) || norm(r.company) || "ไม่ระบุ";
    const key = `${brand}||${name}`;
    let a = map.get(key);
    if (!a) { a = { name, brand, platforms: new Set(), admins: {}, hours: [], count: 0, waiting: 0, first: Infinity, last: 0 }; map.set(key, a); }
    if (r.platform) a.platforms.add(r.platform);
    if (r.admin) a.admins[r.admin] = (a.admins[r.admin] || 0) + 1;
    const ms = r.createdAt.getTime();
    a.hours.push(new Date(ms + TH).getUTCHours());
    a.count++;
    if (r.kind === "waiting-alert") a.waiting++;
    a.first = Math.min(a.first, ms);
    a.last = Math.max(a.last, ms);
  }

  let created = 0, updated = 0, factCount = 0;
  for (const a of map.values()) {
    const platform = [...a.platforms][0] || "line";
    const topAdmin = Object.entries(a.admins).sort((x, y) => y[1] - x[1])[0]?.[0] || null;

    // upsert Customer (คีย์ = brand+name)
    let cust = await db.customer.findFirst({ where: { company: a.brand, name: a.name } });
    if (!cust) {
      cust = await db.customer.create({
        data: { name: a.name, company: a.brand, status: "active", lastSeenAt: new Date(a.last),
          note: `ลูกค้า ${a.brand} · ทัก/ถูกดูแล ${a.count} ครั้ง` },
      });
      created++;
    } else {
      await db.customer.update({ where: { id: cust.id }, data: { lastSeenAt: new Date(a.last), status: "active" } });
      updated++;
    }

    // identity (กันชนข้ามแบรนด์ด้วย handle = brand:name)
    const handle = `${a.brand}:${a.name}`;
    await db.customerIdentity.upsert({
      where: { platform_handle: { platform, handle } },
      update: { displayName: a.name, customerId: cust.id },
      create: { platform, handle, displayName: a.name, customerId: cust.id },
    });

    // rebuild facts (ล้างของเดิมแล้วใส่ใหม่ — idempotent)
    await db.customerFact.deleteMany({ where: { customerId: cust.id, source: "botactivity" } });
    const facts: { key: string; value: string }[] = [
      { key: "แบรนด์", value: a.brand },
      { key: "ช่องทางหลัก", value: [...a.platforms].join(", ") || platform },
      { key: "จำนวนครั้งที่พบ", value: String(a.count) },
      { key: "แนวการทัก (ช่วงเวลา)", value: peakHourLabel(a.hours) },
    ];
    if (topAdmin) facts.push({ key: "แอดมินที่ดูแลบ่อย", value: topAdmin });
    if (a.waiting > 0) facts.push({ key: "เคยแชทค้างรอ", value: `${a.waiting} ครั้ง` });
    for (const f of facts) {
      await db.customerFact.create({ data: { customerId: cust.id, key: f.key, value: f.value, source: "botactivity", confidence: 0.8 } });
      factCount++;
    }
  }
  return { total: map.size, created, updated, factCount };
}

async function embedPendingKnowledge() {
  const ready = await embedReady();
  if (!ready.ok) return { ok: false, reason: ready.reason, embedded: 0 };
  const rows = await db.thunderKnowledge.findMany({ select: { id: true, question: true, answer: true } });
  let embedded = 0;
  for (const r of rows) {
    const text = `${r.question}\n${r.answer}`.slice(0, 2000);
    const vec = await embedText(text);
    if (vec && upsertKnowledgeVector(r.id, vec)) embedded++;
  }
  return { ok: true, embedded, total: rows.length };
}

(async () => {
  console.log("=== Thunder Ingestion เริ่ม ===");
  const c = await ingestCustomers();
  console.log(`ลูกค้า: ${c.total} คน (ใหม่ ${c.created} · อัปเดต ${c.updated}) · facts ${c.factCount} ข้อ`);
  const k = await embedPendingKnowledge();
  if (k.ok) console.log(`ความรู้ embed: ${k.embedded}/${k.total} แถว · เวกเตอร์ในคลังรวม ${vectorCount()}`);
  else console.log(`ความรู้: ข้าม embed (${k.reason})`);
  console.log("=== เสร็จ ===");
  process.exit(0);
})();
