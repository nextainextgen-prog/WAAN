import fs from "node:fs";
import path from "node:path";
import { askClaude } from "./claude";
import { renderDeckHtml, type Deck } from "./deck-html";
import { renderDeckPdf } from "./html-pdf";
import { db } from "./db";
import { getOkrSummary } from "./data";
import { statusLabel, formatBaht, formatThaiDate, daysUntil } from "./grants";

function logoDataUri(): string {
  // ใช้โลโก้มาร์ก (ไอคอน) ก่อน ถ้าไม่มีค่อย fallback โลโก้เดิม
  for (const f of ["public/brand/thunder-mark.png", "public/brand/thunder-logo.png"]) {
    try {
      const b = fs.readFileSync(path.join(process.cwd(), f));
      return `data:image/png;base64,${b.toString("base64")}`;
    } catch {
      /* ลองตัวถัดไป */
    }
  }
  return "";
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

// ===== คู่มือให้ Claude แต่งสไลด์ด้วย "ระบบดีไซน์ Thunder" (คลาสเดียวกับเทมเพลตต้นฉบับ) =====
const SYSTEM = `คุณคือดีไซเนอร์สไลด์นำเสนอมืออาชีพของบริษัท ธันเดอร์ โซลูชั่น
สร้าง "เด็คนำเสนอ" 16:9 คุณภาพสูงจากข้อมูลจริง โดยเขียน HTML ของแต่ละสไลด์เองด้วย "ระบบดีไซน์" ที่กำหนดให้
ตอบเป็น JSON เท่านั้น ไม่มีข้อความอื่น ไม่มี \`\`\`

== โครงสร้าง JSON ==
{
  "title": "ชื่อเรื่องภาษาไทย",
  "titleEn": "TITLE EN สั้น",
  "subtitle": "คำโปรย",
  "meta": [{"label":"ช่วงเวลา","value":"..."},{"label":"จัดทำโดย","value":"..."}],
  "slides": [
    {"layout":"cover","title":"...","cls":"cover","html":"<...>"},
    {"layout":"kpi","title":"...","html":"<...>"},
    {"layout":"chart","title":"...","html":"<...{{CHART}}...>","chart":{...}},
    {"layout":"closing","title":"ขอบคุณ","bg":"navy","html":"<...>"}
  ]
}

== วิธีทำงานของ html แต่ละสไลด์ ==
- ระบบจะห่อ html ของคุณด้วย <section class='slide [bg] [cls]'> ... </section> พร้อมใส่โลโก้มุมขวาบนและเลขหน้าให้อัตโนมัติ
- คุณเขียนเฉพาะ "ข้างในสไลด์" โดยปกติคือ <div class='slide-inner'> ... </div> และแทรก <span class='deco ...'></span> ได้
- bg: เว้นว่าง = พื้นสว่าง (ค่าเริ่มต้น), "navy" = พื้นกรมท่าเข้ม (ใช้กับปก/หน้าคั่น/หน้าปิด/ไฮไลต์), "accent" = ฟ้าอ่อน
- cls: คลาสเสริม เช่น "cover" สำหรับหน้าปก
- ไอคอนใช้: <svg class='icn'><use href='#i-ชื่อ'/></svg>  (มี: gear users shield warn bolt chat doc bank ai db key check clock trophy star cap money plug cart ticket block chart rocket flag net refresh bug arrow golf)

== หัวสไลด์มาตรฐาน (ใช้เกือบทุกหน้าเนื้อหา) ==
<div class='slide-inner'><span class='deco dots'></span>
  <div class='head'>
    <div class='kicker'><svg class='icn'><use href='#i-chart'/></svg> ป้ายหมวด</div>
    <div class='h-sec'>หัวข้อ <em>เน้นคำ</em></div>
    <div class='rule'></div>
    <div class='sub'>คำอธิบายรอง</div>
  </div>
  ... เนื้อหา ...
</div>

== คลังคอมโพเนนต์ (คัดลอกแล้วปรับข้อมูลจริง) ==
1) แถบ KPI (.kpi-row):
<div class='kpi-row'><div class='kpi'><div class='lab'><svg class='icn'><use href='#i-money'/></svg> ป้าย</div><div class='val'>128</div><div class='delta up'><span class='ar'>▲</span> +12%</div></div> ...ทำ 3-4 ช่อง...</div>

2) การ์ดตัวเลข (.grid3 + .numcard):
<div class='grid3'><div class='numcard'><div class='bignum'>01</div><div class='ic'><svg class='icn'><use href='#i-doc'/></svg></div><h4>หัวข้อ</h4><div class='big'>42</div><p>คำอธิบาย</p></div> ...</div>

3) รายการวาระ (.agenda + .ag-row):
<div class='agenda'><div class='ag-row'><div class='n'>01</div><div class='agic'><svg class='icn'><use href='#i-check'/></svg></div><div><h4>หัวข้อ</h4><p>รายละเอียด</p></div><div class='rt'><span class='tag g'><svg class='icn'><use href='#i-check'/></svg> เสร็จ</span></div></div> ...</div>

4) แผงข้อมูล (.grid2 + .panel):
<div class='grid2 fill stretch'><div class='panel'><div class='p-k'><svg class='icn'><use href='#i-bolt'/></svg> หมวด</div><h3>หัวเรื่อง</h3><div class='li'><div class='ic'><svg class='icn'><use href='#i-check'/></svg></div><div>ข้อความ <b>เน้น</b></div></div> ...</div><div class='panel dark'> ...พื้นเข้ม... </div></div>

5) ตาราง (.stable): ใส่ในหัวสไลด์ปกติ
<table class='stable'><thead><tr><th>คอลัมน์</th>...</tr></thead><tbody><tr><td>...</td></tr><tr class='hl'><td>เน้นแถว</td></tr></tbody></table>

6) ป้ายสถานะ (.tag): g=เขียว w=เหลือง b=แดง n=น้ำเงิน — <span class='tag g'><svg class='icn'><use href='#i-check'/></svg> ปกติ</span>

7) กราฟ: วาง {{CHART}} ตรงที่ต้องการ แล้วใส่ฟิลด์ chart ของสไลด์นั้น เช่น
   "chart":{"type":"bar","labels":["ม.ค.","ก.พ."],"datasets":[{"label":"ปีนี้","data":[10,20]},{"label":"ปีก่อน","data":[8,15]}]}
   รองรับ type: bar/line/doughnut/pie · หลายชุดใส่ datasets · ชุดเดียวใช้ "data":[...] · แนวนอนใส่ "indexAxis":"y"
   โครง html: <div class='head'>...</div><div class='fill'>{{CHART}}</div>

8) หน้าปก (cls:"cover", bg เว้นว่าง):
<div class='slide-inner'><span class='deco dots'></span><span class='deco blob'></span>
  <div class='vtag'><div class='vlabel'>Report</div></div>
  <div style='padding-left:46px'>
    <div class='kicker' style='margin-bottom:16px'><svg class='icn'><use href='#i-bolt'/></svg> หมวด · Thunder Solution</div>
    <div class='cover-title'>TITLE<br><em>EN</em></div>
    <div class='cover-th'>ชื่อไทย</div>
    <div class='cover-meta'><div><div class='m-lab'>ช่วง</div><div class='m-val'>...</div></div> ...</div>
  </div>
</div><div class='cover-strip'></div>

9) หน้าคั่น/ปิด (bg:"navy"):
<div class='slide-inner'><span class='deco dots'></span><span class='deco ring'></span>
  <div class='kicker'><svg class='icn'><use href='#i-flag'/></svg> สรุป</div>
  <div class='h-sec' style='font-size:clamp(34px,4.4vw,64px)'>ขอบคุณค่ะ</div>
  <div class='sub' style='margin-top:18px'>บันทึกเพิ่มเติม...</div>
</div>

== คอมโพเนนต์เสริม (ใช้ผสมให้เด็คสวย "ระดับพรีเซนต์จริง" — เลือกใช้ตามเนื้อหา ไม่ต้องใช้ทุกอัน) ==
A) หน้าคั่นหมวดใหญ่ (layout:"divider", cls:"divider-slide", bg:"navy") — คั่นแต่ละหมวด/บริษัท ให้เด็คมีจังหวะ:
<div class='deco blob'></div><div class='deco dots'></div><div class='div-bignum'>01</div>
<div class='slide-inner'><div class='div-eyebrow'>SECTION 01</div><h2 class='div-title'>หัวใหญ่<br><em>เน้นคำ</em></h2><p class='div-sub'>คำโปรยยาวได้ 1-2 บรรทัด</p>
<div class='div-svc'><div class='sv'><svg class='icn'><use href='#i-bolt'/></svg><div><b>ชื่อบริการ</b><small>ตัวเลขย่อย</small></div></div> ...ใส่ 2-4 อัน...</div></div>
B) ป้ายบริการ (.svc-badge) — ชิปมีไอคอน+ชื่อ+สังกัด: <span class='svc-badge'><svg class='icn'><use href='#i-doc'/></svg><b>EasySlip</b><span class='co'>/ THUNDER</span></span>
C) สถิติแผ่น (.tiles + .tile) — การ์ดตัวเลขแถบสีซ้าย: <div class='tiles' style='grid-template-columns:1fr 1fr'><div class='tile'><div class='lab'>ป้าย</div><div class='val'>128</div><div class='sub'>คำอธิบาย</div></div> ...</div>
D) แท่งเปรียบเทียบ (.cmp + .cmp-row) — เทียบหลายรายการเห็นภาพ: <div class='cmp'><div class='cmp-row'><div class='cl'>ชื่อแถว<small>ย่อย</small></div><div class='cmp-bars'><div class='cmp-b'><span class='tag2'>A</span><div class='trk'><i style='width:70%;background:var(--brand)'></i></div><span class='vv'>70%</span></div></div></div> ...</div>
E) กล่องเน้นประเด็น (.callout · เตือน:.callout amb · ปัญหา:.callout bad) — ไฮไลต์ข้อสรุป/คำเตือน: <div class='callout amb'><b>ประเด็นสำคัญ</b> ข้อความ...</div>
F) กล่องหลักฐาน (.proof) — โชว์ข้อมูลดิบ/ตัวอย่างสั้น: <div class='proof'><b>Username</b> abc → ตรงกับ TikTok @abc</div>
- ระบบมี "auto-fit กันล้น" อยู่แล้ว → ใส่เนื้อหาให้เต็มและรวยแบบมืออาชีพได้ ไม่ต้องกลัวเนื้อหาล้นทับกัน (แต่อย่าจงใจอัดจนเกินพอดี)
- เด็คที่ดี: ควรมีหน้าคั่น divider-slide คั่นหมวดใหญ่ + ผสมคอมโพเนนต์หลากหลาย (KPI/tiles/cmp/panel/chart/table/callout) ให้แต่ละหน้าไม่ซ้ำจำเจ

== ถ้ามี "เนื้อหาจากเอกสารที่ผู้ใช้แนบมา" ==
- ให้ยึดเอกสารนั้นเป็นแหล่งข้อมูลเดียว สรุปทุกหัวข้อ/ตัวเลข/ตาราง/กราฟที่อยู่ในเอกสารออกมาเป็นสไลด์ให้ครบ
- ห้ามดึงข้อมูลระบบ/ตัวอย่างอื่นมาปน · ชื่อเรื่อง (title) ให้ตั้งตามเนื้อหาเอกสารจริง

== กติกา (ทำให้สวย ครบ มืออาชีพ) ==
- 8-12 สไลด์: cover → หน้าเนื้อหาหลากหลาย → หน้าคั่นหมวด (bg navy) อย่างน้อย 1 → closing
- "เติมทุกสไลด์ให้เต็มพื้นที่" อย่าปล่อยหน้าโล่ง: ใช้หัวสไลด์ + เนื้อหา 2-4 บล็อก (เช่น KPI row + panel คู่, กราฟ + bullet สรุปข้างๆ, ตาราง + tag สถานะ)
- ใช้คอมโพเนนต์หลากหลายอย่างน้อย 4-5 แบบทั่วทั้งเด็ค (KPI, numcard, agenda, panel, table, chart, tag) — ไม่ซ้ำจำเจ
- ทุกหน้าเนื้อหาต้องมี head (kicker + h-sec + rule) และมีอย่างน้อยหนึ่งกราฟหรือหนึ่งตารางในเด็ค
- ใช้ไอคอนให้เข้ากับความหมายทุกจุด · เน้นคำสำคัญด้วย <em> หรือ <b> · ใส่ delta/แนวโน้ม (up/down) ให้ KPI เมื่อมีข้อมูลเทียบ
- ใช้ "ตัวเลขจริง" เท่านั้น ห้ามแต่ง · ภาษาไทยทางการ กระชับ · ห้ามใส่อีโมจิ (ใช้ไอคอน SVG แทน)
- ทุกสไลด์เนื้อหาใช้ <div class='slide-inner'> ครอบ · ปิดแท็ก HTML ให้ครบทุกตัว · ใส่ layout + title สั้นๆ ทุกสไลด์

== กติกา JSON (สำคัญมาก ผิดแล้วระบบพังทั้งเด็ค) ==
- ใน html ทุกจุด แอตทริบิวต์ต้องใช้ single quote เท่านั้น เช่น <div class='kpi' style='width:70%'> — ห้ามใช้ " ในค่า html เด็ดขาด
- ห้ามขึ้นบรรทัดใหม่จริงในค่า string · ตอบ JSON ก้อนเดียวจบ ไม่มีคำอธิบายนำหรือปิดท้าย`;

function parseDeck(text: string): Deck {
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  const d = JSON.parse(t);
  if (!d.slides || !Array.isArray(d.slides) || d.slides.length === 0) throw new Error("โครงสไลด์ไม่ถูกต้อง");
  return d as Deck;
}

// เก็บคำตอบดิบไว้ดูตอนพัง (ไม่ให้ error หายไปกับสายลม)
function dumpRaw(raw: string): string {
  try {
    const dir = path.join(process.cwd(), ".generated", "deck-raw");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}.txt`);
    fs.writeFileSync(file, raw);
    return file;
  } catch {
    return "(เขียนไฟล์ raw ไม่ได้)";
  }
}

// parse เด็ค ถ้า JSON เสีย (มักเป็น " ที่ไม่ escape ใน html) ให้ Claude ซ่อมแล้วลองใหม่หนึ่งครั้ง
async function parseDeckWithRepair(raw: string): Promise<Deck> {
  try {
    return parseDeck(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const file = dumpRaw(raw);
    const fixed = await askClaude(
      `JSON ข้างล่างนี้ parse ไม่ผ่าน: ${msg}
สาเหตุที่พบบ่อยคือ double quote ที่ไม่ได้ escape ในค่าของฟิลด์ html หรือมีขึ้นบรรทัดใหม่จริงในสตริง
ซ่อมให้เป็น JSON ที่ถูกต้อง คงเนื้อหาและโครงเดิมไว้ทุกอย่าง โดยเปลี่ยนแอตทริบิวต์ใน html ให้ใช้ single quote
ตอบ JSON ก้อนเดียวเท่านั้น ไม่มีข้อความอื่น ไม่มี \`\`\`

${raw}`,
      { system: "คุณคือตัวซ่อม JSON ตอบเป็น JSON ที่ถูกต้องก้อนเดียวเท่านั้น ไม่มีข้อความอื่น", timeoutMs: 240_000 },
    );
    try {
      return parseDeck(fixed);
    } catch {
      throw new Error(`${msg} — ซ่อมอัตโนมัติแล้วยังไม่ผ่าน (คำตอบดิบ: ${file})`);
    }
  }
}

export interface GeneratedDeck {
  deck: Deck;
  html: string;
  pdf: Buffer;
}

// แก้/ต่อยอดเด็คเดิม (reply เด็คแล้วสั่งแก้/เพิ่มข้อมูล) — คงสไตล์เดิม จำบริบทที่ผ่านมา
export async function reviseDeck(
  prev: { topic: string; sourceText: string; images: string[]; history: string[]; deck: Deck },
  instruction: string,
  add?: { text?: string; images?: string[] },
): Promise<GeneratedDeck & { source: { topic: string; sourceText: string; images: string[]; history: string[]; deck: Deck } }> {
  const sourceText = [prev.sourceText, add?.text].filter(Boolean).join("\n\n----- (ข้อมูลที่เพิ่มภายหลัง) -----\n\n");
  const images = [...(prev.images || []), ...((add?.images) || [])];
  const history = [...prev.history, instruction];
  const dataBlock = sourceText
    ? `=== เนื้อหาต้นฉบับ (แหล่งข้อมูล) ===\n${sourceText}`
    : `=== (เด็คนี้สร้างจากหัวข้อ ไม่มีเอกสารต้นฉบับ) ===`;
  const prevDeckBlock = `=== เด็คเดิม (JSON) ที่ต้องแก้ต่อยอด — คงโครง/สไตล์ที่ดีอยู่แล้วไว้ ===\n${JSON.stringify(prev.deck)}`;
  const instrBlock = `=== คำสั่งแก้/เพิ่ม (สะสมตามลำดับ ข้อล่าสุดสำคัญสุด) ===\n${history.map((h, i) => `${i + 1}. ${h}`).join("\n")}`;
  const prompt = `หัวข้อ: ${prev.topic}\n\n${dataBlock}\n\n${prevDeckBlock}\n\n${instrBlock}\n\nแก้/ต่อยอดเด็คเดิมตามคำสั่งข้างบนให้ครบ คงธีม/สไตล์/ดีไซน์เดิมไว้ (ห้ามเปลี่ยนแนวถ้าไม่ได้สั่ง) เปลี่ยนเฉพาะที่สั่ง ส่งเด็คฉบับเต็มที่แก้แล้วกลับมา ตอบ JSON เท่านั้น`;
  const raw = await askClaude(prompt, { system: SYSTEM, timeoutMs: 240_000 });
  const deck = await parseDeckWithRepair(raw);
  const html = renderDeckHtml(deck, logoDataUri());
  const pdf = await renderDeckPdf(html);
  return { deck, html, pdf, source: { topic: prev.topic, sourceText, images, history, deck } };
}

export async function generateDeck(
  topic: string,
  source?: { text?: string; images?: string[] },
): Promise<GeneratedDeck> {
  const hasSource = !!(source && (source.text || (source.images && source.images.length)));
  let dataBlock: string;
  let instruction: string;
  if (hasSource) {
    // ทำสไลด์ "จากเอกสารที่ผู้ใช้แนบมา" — ห้ามเอาข้อมูลระบบมาปน
    dataBlock = `=== เนื้อหาจากเอกสารที่ผู้ใช้แนบมา (แหล่งข้อมูลหลัก ใช้อันนี้เท่านั้น) ===\n${
      source!.text || "(ไม่มีข้อความในไฟล์ — อ่านจากรูปหน้าเอกสารที่ให้ path ด้านล่าง)"
    }`;
    if (source!.images && source!.images.length) {
      dataBlock += `\n\nรูปหน้าเอกสาร (เปิดอ่านด้วยเครื่องมือ Read ทุกไฟล์ เพื่อดึงตาราง/กราฟ/ตัวเลขที่อยู่ในรูป):\n${source!.images
        .map((p, i) => `${i + 1}. ${p}`)
        .join("\n")}`;
    }
    instruction =
      "สร้างเด็คสรุป/นำเสนอ 'จากเนื้อหาเอกสารนี้' ทั้งหมด — ดึงหัวข้อ ตัวเลข ประเด็น ตาราง กราฟจากเอกสารจริง จัดเป็นสไลด์ให้ครบถ้วนและอ่านง่าย ห้ามนำข้อมูลอื่นนอกเอกสารมาใส่ ห้ามแต่งตัวเลข";
  } else {
    dataBlock = `=== ข้อมูลจริงจากระบบ ===\n${await buildContext()}`;
    instruction = "ออกแบบเด็คจากข้อมูลจริงในระบบ ใช้ตัวเลขจริง";
  }
  const prompt = `หัวข้อ: ${topic}\n\n${dataBlock}\n\n${instruction} ตอบ JSON เท่านั้น`;
  const raw = await askClaude(prompt, { system: SYSTEM, timeoutMs: 240_000 });
  const deck = await parseDeckWithRepair(raw);
  const html = renderDeckHtml(deck, logoDataUri());
  const pdf = await renderDeckPdf(html);
  return { deck, html, pdf };
}
