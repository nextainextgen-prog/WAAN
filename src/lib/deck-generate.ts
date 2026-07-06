import fs from "node:fs";
import path from "node:path";
import { askClaude } from "./claude";
import { renderDeckHtml, type Deck } from "./deck-html";
import { renderDeckPdf } from "./html-pdf";
import { db } from "./db";
import { getOkrSummary } from "./data";
import { statusLabel, formatBaht, formatThaiDate, daysUntil } from "./grants";

function logoDataUri(): string {
  try {
    const b = fs.readFileSync(path.join(process.cwd(), "public/brand/thunder-logo.png"));
    return `data:image/png;base64,${b.toString("base64")}`;
  } catch {
    return "";
  }
}

async function buildContext(): Promise<string> {
  const [okr, grants] = await Promise.all([getOkrSummary(), db.grant.findMany({ orderBy: { nextDeadline: "asc" } })]);
  const gl =
    grants.length === 0
      ? "(ยังไม่มีข้อมูลทุนในระบบ)"
      : grants
          .map((g) => {
            const d = daysUntil(g.nextDeadline);
            return `- ${g.projectName} | ${g.source || "-"} | ${formatBaht(g.amount)} | ${statusLabel(g.status)} | ${g.nextDeadline ? formatThaiDate(g.nextDeadline) + (d !== null ? ` (อีก ${d} วัน)` : "") : "ไม่ระบุ"}`;
          })
          .join("\n");
  const ss = okr.byStatus.map((s) => `- ${s.label}: ${s.count} ทุน (${formatBaht(s.amount)})`).join("\n");
  return `[OKR ปี ${okr.year + 543}] เป้า ${formatBaht(okr.target)} | ผลจริง ${formatBaht(okr.actual)} | บรรลุ ${okr.percent}% | ${okr.totalGrants} ทุน
[สรุปตามสถานะ]
${ss}
[รายการทุน]
${gl}`;
}

const SYSTEM = `คุณคือผู้ออกแบบสไลด์นำเสนอมืออาชีพของบริษัท ธันเดอร์ โซลูชั่น
สร้าง "เด็คนำเสนอ" จากข้อมูลจริงที่ให้ ตอบเป็น JSON เท่านั้น ไม่มีข้อความอื่น ไม่มี \`\`\`

โครงสร้าง JSON:
{
  "title": "ชื่อเรื่องภาษาไทย",
  "titleEn": "TITLE EN (สั้น ตัวใหญ่)",
  "subtitle": "คำบรรยายรอง",
  "meta": [{"label":"ช่วงเวลา","value":"..."},{"label":"จัดทำโดย","value":"..."}],
  "slides": [
    {"layout":"cover"},
    {"layout":"kpi","kicker":"ภาพรวม","title":"...","kpis":[{"label":"...","value":"10 ล้าน","unit":"บาท","tone":"primary"}]},
    {"layout":"chart","kicker":"แนวโน้ม","title":"...","chart":{"type":"bar","labels":["ม.ค.","ก.พ."],"data":[10,20],"label":"มูลค่า"}},
    {"layout":"bullets","kicker":"ประเด็นสำคัญ","title":"...","bullets":[{"icon":"check","title":"...","text":"..."}]},
    {"layout":"table","kicker":"รายละเอียด","title":"...","columns":["โครงการ","สถานะ","มูลค่า"],"rows":[["...","...","..."]]},
    {"layout":"section","kicker":"...","title":"หัวข้อคั่น","note":"..."},
    {"layout":"closing","title":"ขอบคุณค่ะ","note":"..."}
  ]
}

กติกา:
- 6-9 สไลด์ เริ่มด้วย cover ปิดด้วย closing
- ใช้ตัวเลขจริงจากข้อมูล ห้ามแต่ง
- tone ใช้ได้: primary/good/warn/bad · icon ใช้ได้: check,clock,target,money,users,chart,flag,bolt,doc,star,warn,rocket
- ภาษาไทยทางการ ไม่ใส่อีโมจิ`;

function parseDeck(text: string): Deck {
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  const d = JSON.parse(t);
  if (!d.slides || !Array.isArray(d.slides)) throw new Error("โครงสไลด์ไม่ถูกต้อง");
  if (!d.slides.some((s: { layout: string }) => s.layout === "cover")) d.slides.unshift({ layout: "cover" });
  return d as Deck;
}

export interface GeneratedDeck {
  deck: Deck;
  html: string;
  pdf: Buffer;
}

export async function generateDeck(topic: string): Promise<GeneratedDeck> {
  const context = await buildContext();
  const prompt = `หัวข้อ: ${topic}\n\n=== ข้อมูลจริง ===\n${context}\n\nสร้างเด็คตามข้อมูล ตอบ JSON เท่านั้น`;
  const raw = await askClaude(prompt, { system: SYSTEM, timeoutMs: 150_000 });
  const deck = parseDeck(raw);
  const html = renderDeckHtml(deck, logoDataUri());
  const pdf = await renderDeckPdf(html);
  return { deck, html, pdf };
}
