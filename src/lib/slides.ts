import { db } from "./db";
import { askClaude } from "./claude";
import { getOkrSummary } from "./data";
import { statusLabel, formatBaht, formatThaiDate, daysUntil } from "./grants";

export interface Slide {
  layout: "title" | "stats" | "bullets" | "table";
  title?: string;
  subtitle?: string;
  bullets?: string[];
  stats?: { label: string; value: string }[];
  columns?: string[];
  rows?: string[][];
}

export interface SlideDoc {
  title: string;
  subtitle: string;
  slides: Slide[];
}

export async function loadStyleMemory(): Promise<string> {
  const s = await db.styleMemory.findFirst({ where: { label: "default" }, orderBy: { updatedAt: "desc" } });
  return s?.content || "สไลด์ทางการ มืออาชีพ โทนน้ำเงิน หัวข้อชัดเจน หนึ่งประเด็นต่อสไลด์";
}

export async function saveStyleMemory(content: string) {
  const existing = await db.styleMemory.findFirst({ where: { label: "default" } });
  if (existing) {
    await db.styleMemory.update({ where: { id: existing.id }, data: { content } });
  } else {
    await db.styleMemory.create({ data: { label: "default", content } });
  }
}

// สร้างบริบทข้อมูลจริงสำหรับทำสไลด์
async function buildSlideData(): Promise<string> {
  const [okr, grants] = await Promise.all([
    getOkrSummary(),
    db.grant.findMany({ orderBy: [{ status: "asc" }, { amount: "desc" }] }),
  ]);
  const grantLines = grants
    .map((g) => {
      const d = daysUntil(g.nextDeadline);
      return `- "${g.projectName}" | ${g.ownerName || "-"} | ${g.source || "-"} | ${formatBaht(g.amount)} | ${statusLabel(g.status)} | ${g.nextDeadline ? formatThaiDate(g.nextDeadline) + (d !== null ? ` (อีก ${d} วัน)` : "") : "ไม่ระบุ"}`;
    })
    .join("\n");
  const statusSummary = okr.byStatus
    .map((s) => `- ${s.label}: ${s.count} ทุน (${formatBaht(s.amount)})`)
    .join("\n");

  return `[เป้า OKR ปี ${okr.year + 543}]
เป้าหมาย ${formatBaht(okr.target)} | ผลงานจริง ${formatBaht(okr.actual)} | บรรลุ ${okr.percent}% | รวม ${okr.totalGrants} ทุน

[สรุปตามสถานะ]
${statusSummary}

[รายการทุน]
${grantLines || "(ยังไม่มีข้อมูลทุน)"}`;
}

const JSON_INSTRUCTION = `คุณคือผู้ช่วยสร้างสไลด์นำเสนอสำหรับผู้บริหารมหาวิทยาลัย
สร้างโครงสไลด์จากข้อมูลจริงที่ให้ และจัดตามสไตล์ที่กำหนด
ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอก JSON ห้ามใส่ \`\`\`

โครงสร้าง JSON:
{
  "title": "หัวข้อหลักของชุดสไลด์",
  "subtitle": "คำบรรยายรอง เช่น ช่วงเวลา",
  "slides": [
    { "layout": "title", "title": "...", "subtitle": "..." },
    { "layout": "stats", "title": "...", "stats": [ { "label": "เป้าหมาย", "value": "10 ล้านบาท" } ] },
    { "layout": "bullets", "title": "...", "bullets": ["ประเด็น 1", "ประเด็น 2"] },
    { "layout": "table", "title": "...", "columns": ["โครงการ","สถานะ","มูลค่า"], "rows": [["...","...","..."]] }
  ]
}

กติกา:
- 5-8 สไลด์ กระชับ หนึ่งประเด็นต่อสไลด์
- ใช้ตัวเลขจริงจากข้อมูล ห้ามแต่งเอง
- bullets สั้น ไม่เกิน 5 ข้อต่อสไลด์
- ภาษาไทยทางการ ไม่ใส่อีโมจิ`;

function extractJson(text: string): SlideDoc {
  let t = text.trim();
  // ตัด code fence ถ้ามี
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  const parsed = JSON.parse(t);
  if (!parsed.slides || !Array.isArray(parsed.slides)) throw new Error("โครงสไลด์ไม่ถูกต้อง");
  return parsed as SlideDoc;
}

export async function generateSlideDoc(topic: string): Promise<SlideDoc> {
  const [data, style] = await Promise.all([buildSlideData(), loadStyleMemory()]);
  const system = `${JSON_INSTRUCTION}\n\n=== สไตล์ที่อาจารย์กำหนด ===\n${style}\n\n=== ข้อมูลจริง ===\n${data}`;
  const prompt = `หัวข้อที่ต้องการ: ${topic}\n\nสร้างโครงสไลด์ตามข้อมูลและสไตล์ข้างต้น ตอบเป็น JSON เท่านั้น`;

  const raw = await askClaude(prompt, { system, timeoutMs: 150_000 });
  try {
    return extractJson(raw);
  } catch {
    // fallback: ลองอีกครั้งแบบเข้มงวด
    const retry = await askClaude(
      "แปลงเป็น JSON ตามโครงสร้างที่กำหนดเท่านั้น ไม่มีข้อความอื่น:\n\n" + raw,
      { system: JSON_INSTRUCTION, timeoutMs: 120_000 },
    );
    return extractJson(retry);
  }
}
