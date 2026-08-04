import fs from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { askExtractor } from "./kiki";
import { getVaultPath } from "./obsidian";
import { renderHtmlToPng } from "./html-pdf";

const AUN_FOLDER = "aun"; // ตรงกับ kiki-aun.ts (ประกาศซ้ำเพื่อเลี่ยง import วน)

/**
 * โภชนาการของอั๋น — Vex อ่านรูปอาหารเอง ประเมินแคล/มาโคร แล้วรวมยอดต่อวันเป็นการ์ดภาพ
 * (เจ้าของสั่ง 4 ส.ค. 2026) ข้อมูลทั้งหมดอยู่ใน scope อั๋นเท่านั้น — ห้ามปนกับของเจ้าของ
 */

// ===== เป้าหมายจากแผนจริง (แผนลดน้ำหนัก-94-60.md · 1,300 kcal โปรตีน 52%) =====

export const AUN_TARGETS = {
  kcal: 1300,
  protein: 170, // กรัม (1.8 g/kg รักษามวลกล้ามเนื้อ)
  carb: 100, // กรัม (~400 kcal)
  fat: 25, // กรัม (~225 kcal)
  meals: 4, // เช้า · กลางวัน · ว่าง · เย็น
  waterGlasses: 14, // 3,500 ml (แก้วละ 250 ml)
  glassMl: 250,
} as const;

export const MEAL_ORDER = ["เช้า", "กลางวัน", "ว่าง", "เย็น"] as const;

// ===== ชนิดข้อมูล =====

export interface AunFoodItem {
  name: string;
  qty: string;
  kcal: number;
  protein: number;
  carb: number;
  fat: number;
}

export interface AunRead {
  kind: "food" | "scale" | "other";
  description: string; // อธิบายว่าในภาพคืออะไร (ทุกกรณี — ใช้ตอบเวลาไม่ใช่อาหารด้วย)
  mealType?: string;
  title?: string;
  items: AunFoodItem[];
  confidence?: string; // สูง | กลาง | ต่ำ
  healthNote?: string;
  weightKg?: number | null;
}

export interface AunMealRow {
  id: string;
  at: Date;
  mealType: string;
  title: string;
  items: AunFoodItem[];
  kcal: number;
  protein: number;
  carb: number;
  fat: number;
  water: number;
  confidence: string | null;
  note: string | null;
}

export interface AunDay {
  day: string; // YYYY-MM-DD
  label: string; // 4 ส.ค. 2569
  meals: AunMealRow[];
  water: number; // แก้ว
  totals: { kcal: number; protein: number; carb: number; fat: number };
  last7: { label: string; kcal: number; today: boolean }[];
}

// ===== util =====

const esc = (x: unknown) => String(x ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const num = (v: unknown, max = 5000): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
};

export function dayKey(d = new Date()): string {
  // วันตามเวลาไทย (เครื่องรันไทยอยู่แล้ว แต่ยึด offset ให้ชัด กันเคสเปลี่ยน TZ)
  const th = new Date(d.getTime() + (7 * 60 + d.getTimezoneOffset()) * 60_000);
  return `${th.getFullYear()}-${String(th.getMonth() + 1).padStart(2, "0")}-${String(th.getDate()).padStart(2, "0")}`;
}

function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("th-TH-u-ca-gregory", { day: "numeric", month: "short", year: "numeric" });
}

export function mealTypeByTime(d = new Date()): string {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h < 10.5) return "เช้า";
  if (h < 14.5) return "กลางวัน";
  if (h < 17.5) return "ว่าง";
  return "เย็น";
}

function normMealType(x: unknown, at = new Date()): string {
  const s = String(x || "").trim();
  if (/เช้า|breakfast|morning/i.test(s)) return "เช้า";
  if (/เที่ยง|กลางวัน|lunch/i.test(s)) return "กลางวัน";
  if (/เย็น|ค่ำ|dinner|มื้อดึก/i.test(s)) return "เย็น";
  if (/ว่าง|snack|ขนม/i.test(s)) return "ว่าง";
  if (/น้ำ|water/i.test(s)) return "น้ำ";
  return mealTypeByTime(at);
}

// ===== เก็บรูปอาหารถาวรในโฟลเดอร์ aun (แยกจาก vault ส่วนตัวของเจ้าของ) =====

export async function saveAunPhoto(src: string): Promise<string | null> {
  const vault = getVaultPath();
  if (!vault) return null;
  try {
    const buf = await fs.readFile(src);
    const rel = path.join(AUN_FOLDER, "food", dayKey().slice(0, 7), `${Date.now()}-${path.basename(src)}`);
    const full = path.resolve(vault, rel);
    if (!full.startsWith(path.resolve(vault, AUN_FOLDER))) return null;
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buf);
    return full;
  } catch {
    return null; // เก็บรูปไม่ได้ก็ไม่เป็นไร ตัวเลขอยู่ใน DB แล้ว
  }
}

// ===== อ่านภาพ/ข้อความ → รายการอาหาร + แคล =====

const KCAL_REFERENCE = `ค่าอ้างอิงอาหารไทย (ต่อหน่วยที่ระบุ — ใช้เทียบ อย่ามโนตัวเลขไกลจากนี้):
- ข้าวสวย 1 ทัพพี (60 ก.) 80 kcal · คาร์บ 18 ก. | ข้าวเหนียว 1 ปั้น (100 ก.) 180 kcal | ข้าวกล้อง 1 ทัพพี 82 kcal
- อกไก่/ไก่ย่างไม่หนัง 100 ก. 165 kcal · โปรตีน 31 ก. | ไก่ทอด 100 ก. 290 kcal | หมูสามชั้น 100 ก. 380 kcal
- หมูสับผัด 100 ก. 250 kcal · โปรตีน 20 ก. | ปลานึ่ง/ย่าง 100 ก. 130 kcal · โปรตีน 24 ก. | กุ้ง 100 ก. 99 kcal · โปรตีน 20 ก.
- ไข่ต้ม 1 ฟอง 70 kcal · โปรตีน 6.3 ก. | ไข่ดาว 1 ฟอง 110 kcal | ไข่เจียว 1 ฟอง 150 kcal
- กะเพราหมู/ไก่ราดข้าว 1 จาน 600 kcal | ผัดไทย 1 จาน 550 kcal | ข้าวมันไก่ 1 จาน 600 kcal | ข้าวขาหมู 1 จาน 700 kcal
- ก๋วยเตี๋ยวน้ำ 1 ชาม 350 kcal | ต้มยำน้ำใส 1 ถ้วย 130 kcal | แกงจืด 1 ถ้วย 90 kcal | ส้มตำไทย 1 จาน 120 kcal
- ผัดผัก 1 จาน 150 kcal | สลัดผักน้ำใส 1 จาน 90 kcal | น้ำสลัดครีม 1 ช้อนโต๊ะ 60 kcal
- น้ำอัดลม 1 กระป๋อง 140 kcal | ชานมไข่มุก 1 แก้ว 400 kcal | กาแฟเย็น 1 แก้ว 250 kcal | นมจืด 1 กล่อง 120 kcal
- ขนมปัง 1 แผ่น 80 kcal | ผลไม้ 1 จานเล็ก 60 kcal | โยเกิร์ตรสธรรมชาติ 1 ถ้วย 90 kcal
หน่วยตวง: ทัพพี ≈ 60 ก. · ช้อนโต๊ะ ≈ 15 ก. · ฝ่ามือเนื้อสัตว์ ≈ 100 ก. · กำปั้นผัก ≈ 80 ก.`;

const READ_RULES = `กติกาการประเมิน:
- ประเมินจากสิ่งที่เห็น/ที่บอกมาจริงเท่านั้น มองน้ำมัน ซอส น้ำหวาน เครื่องดื่มด้วย (คนลดน้ำหนักมักลืมนับ)
- แยกเป็นรายการย่อย (ข้าว / กับข้าว / เครื่องดื่ม / ของหวาน) พร้อมปริมาณที่ประเมินได้
- ตัวเลข kcal/protein/carb/fat เป็นตัวเลขล้วน (กรัมสำหรับมาโคร) ห้ามใส่หน่วยในตัวเลข · qty สั้น ๆ ไม่เกิน 25 ตัวอักษร (เหตุผลที่เดาให้ใส่ใน description แทน)
- ประเมินกลาง ๆ ไม่ต่ำเกินจริง — ถ้าเดาปริมาณไม่ชัดให้ confidence = "ต่ำ" แล้วบอกใน description ว่าเดาอะไรไว้
- ถ้าไม่ใช่อาหาร: kind = "other" (หรือ "scale" ถ้าเป็นตาชั่งน้ำหนัก ให้ใส่ weightKg เป็นตัวเลขบนหน้าปัด) items = []
- description = อธิบายสิ่งที่เห็นในภาพจริง ๆ 1-2 ประโยค (ต้องมีทุกกรณี)`;

const READ_SHAPE = `ตอบเป็น JSON ล้วน ไม่มีข้อความอื่น:
{"kind":"food|scale|other","description":"...","mealType":"เช้า|กลางวัน|ว่าง|เย็น","title":"ชื่อมื้อสั้น ๆ","confidence":"สูง|กลาง|ต่ำ","healthNote":"คอมเมนต์โภชนาการของมื้อนี้ 1 ประโยค","weightKg":null,"items":[{"name":"ข้าวสวย","qty":"2 ทัพพี","kcal":160,"protein":3,"carb":36,"fat":0}]}`;

function parseRead(raw: string, at = new Date()): AunRead {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("อ่านผลไม่ออก");
  const j = JSON.parse(m[0]) as Record<string, unknown>;
  const items: AunFoodItem[] = Array.isArray(j.items)
    ? (j.items as Record<string, unknown>[]).slice(0, 14).map((it) => ({
        name: String(it.name || "ไม่ระบุ").slice(0, 60),
        qty: String(it.qty || "").slice(0, 60),
        kcal: num(it.kcal, 3000),
        protein: num(it.protein, 300),
        carb: num(it.carb, 500),
        fat: num(it.fat, 300),
      }))
    : [];
  const kind = j.kind === "food" || j.kind === "scale" ? j.kind : items.length ? "food" : "other";
  return {
    kind: kind as AunRead["kind"],
    description: String(j.description || "").slice(0, 600),
    mealType: normMealType(j.mealType, at),
    title: String(j.title || "").slice(0, 80) || (items[0]?.name ?? "มื้ออาหาร"),
    items,
    confidence: ["สูง", "กลาง", "ต่ำ"].includes(String(j.confidence)) ? String(j.confidence) : "กลาง",
    healthNote: String(j.healthNote || "").slice(0, 300),
    weightKg: typeof j.weightKg === "number" && j.weightKg >= 30 && j.weightKg <= 200 ? j.weightKg : null,
  };
}

/** อ่านรูปที่อั๋นส่งมา (อาหาร/ตาชั่ง/อย่างอื่น) — วิชันจริง ไม่เดาจากแคปชัน */
export async function readAunImages(imagePaths: string[], caption = ""): Promise<AunRead> {
  const paths = imagePaths.slice(0, 4);
  const raw = await askExtractor(
    `คุณคือนักโภชนาการที่กำลังอ่านรูปที่ผู้หญิงคนหนึ่ง (สูง 164 ซม. 94 กก. กำลังลดน้ำหนัก) ส่งมาในแชท

รูปที่แนบมา (เปิดอ่านด้วยเครื่องมือ Read ทุกไฟล์ แล้วดูของจริงในภาพ):
${paths.map((p, i) => `${i + 1}. ${p}`).join("\n")}
${caption ? `\nข้อความที่พิมพ์มาพร้อมรูป: """${caption}"""  (ใช้เป็นตัวช่วยระบุปริมาณ/มื้อ แต่ยึดสิ่งที่เห็นในภาพเป็นหลัก)` : ""}
${paths.length > 1 ? "\nรูปทั้งหมดนี้คือมื้อเดียวกัน — รวมทุกจานเป็นรายการเดียวชุดเดียว" : ""}

${KCAL_REFERENCE}

${READ_RULES}

${READ_SHAPE}`,
    { imagePaths: paths, timeoutMs: 150_000 },
  );
  return parseRead(raw);
}

/** อั๋นพิมพ์บอกว่ากินอะไร (ไม่มีรูป) */
export async function readAunFoodText(text: string): Promise<AunRead> {
  const raw = await askExtractor(
    `คุณคือนักโภชนาการ ผู้หญิงคนหนึ่ง (164 ซม. 94 กก. กำลังลดน้ำหนัก) พิมพ์บอกว่ากินอะไรไป:
"""${text}"""

แตกเป็นรายการอาหารพร้อมประเมินแคลและมาโคร (ถ้าไม่บอกปริมาณให้ใช้ปริมาณมาตรฐาน 1 จาน/1 ที่ แล้วตั้ง confidence = "กลาง")
ถ้าข้อความไม่ได้พูดถึงอาหาร/เครื่องดื่มเลย ให้ kind = "other" items = []

${KCAL_REFERENCE}

${READ_RULES}

${READ_SHAPE}`,
    { timeoutMs: 120_000 },
  );
  return parseRead(raw);
}

// ===== บันทึก =====

export async function saveAunMeal(read: AunRead, opts: { photo?: string | null; at?: Date } = {}): Promise<AunMealRow> {
  const at = opts.at ?? new Date();
  const sum = read.items.reduce(
    (a, it) => ({ kcal: a.kcal + it.kcal, protein: a.protein + it.protein, carb: a.carb + it.carb, fat: a.fat + it.fat }),
    { kcal: 0, protein: 0, carb: 0, fat: 0 },
  );
  const row = await db.aunMeal.create({
    data: {
      day: dayKey(at),
      at,
      mealType: normMealType(read.mealType, at),
      title: read.title || "มื้ออาหาร",
      items: JSON.stringify(read.items),
      kcal: r0(sum.kcal),
      protein: r1(sum.protein),
      carb: r1(sum.carb),
      fat: r1(sum.fat),
      photo: opts.photo || null,
      confidence: read.confidence || null,
      note: read.healthNote || null,
    },
  });
  return toRow(row);
}

export async function logAunWater(glasses: number, at = new Date()): Promise<number> {
  const g = Math.max(1, Math.min(20, Math.round(glasses)));
  await db.aunMeal.create({
    data: { day: dayKey(at), at, mealType: "น้ำ", title: `ดื่มน้ำ ${g} แก้ว`, items: "[]", water: g },
  });
  const day = await getAunDay(at);
  return day.water;
}

export async function deleteLastAunMeal(): Promise<AunMealRow | null> {
  const last = await db.aunMeal.findFirst({ where: { day: dayKey() }, orderBy: { createdAt: "desc" } });
  if (!last) return null;
  await db.aunMeal.delete({ where: { id: last.id } });
  return toRow(last);
}

interface RawMeal {
  id: string;
  at: Date;
  mealType: string;
  title: string;
  items: string;
  kcal: number;
  protein: number;
  carb: number;
  fat: number;
  water: number;
  confidence: string | null;
  note: string | null;
}

function toRow(r: RawMeal): AunMealRow {
  let items: AunFoodItem[] = [];
  try {
    items = JSON.parse(r.items) as AunFoodItem[];
  } catch {
    items = [];
  }
  return { ...r, items };
}

// ===== รวมยอดต่อวัน =====

export async function getAunDay(d = new Date()): Promise<AunDay> {
  const key = dayKey(d);
  const rows = await db.aunMeal.findMany({ where: { day: key }, orderBy: { at: "asc" } });
  const meals = rows.filter((r) => r.mealType !== "น้ำ").map(toRow);
  const water = rows.filter((r) => r.mealType === "น้ำ").reduce((a, r) => a + r.water, 0);
  const totals = meals.reduce(
    (a, m) => ({ kcal: a.kcal + m.kcal, protein: a.protein + m.protein, carb: a.carb + m.carb, fat: a.fat + m.fat }),
    { kcal: 0, protein: 0, carb: 0, fat: 0 },
  );

  // 7 วันล่าสุด (รวมวันนี้) — ไว้ดูแนวโน้มบนการ์ด
  const keys: string[] = [];
  for (let i = 6; i >= 0; i--) keys.push(dayKey(new Date(d.getTime() - i * 86_400_000)));
  const hist = await db.aunMeal.findMany({ where: { day: { in: keys }, mealType: { not: "น้ำ" } }, select: { day: true, kcal: true } });
  const byDay = new Map<string, number>();
  for (const h of hist) byDay.set(h.day, (byDay.get(h.day) || 0) + h.kcal);
  const last7 = keys.map((k) => {
    const [y, m, dd] = k.split("-").map(Number);
    return {
      label: new Date(y, m - 1, dd).toLocaleDateString("th-TH-u-ca-gregory", { weekday: "narrow" }),
      kcal: r0(byDay.get(k) || 0),
      today: k === key,
    };
  });

  return {
    day: key,
    label: dayLabel(key),
    meals,
    water,
    totals: { kcal: r0(totals.kcal), protein: r1(totals.protein), carb: r1(totals.carb), fat: r1(totals.fat) },
    last7,
  };
}

// ===== สรุปว่า "วันนี้ครบไหม" — ตัวเลขล้วน ไม่ผ่าน LLM =====

export interface AunVerdict {
  status: "ยังไม่เริ่ม" | "กำลังไปได้ดี" | "ต้องระวัง" | "เกินเป้า";
  headline: string;
  lines: string[]; // ข้อสรุปรายข้อ (ใช้ทั้งบนการ์ดและเป็นข้อเท็จจริงให้ Vex พูดต่อ)
  missing: string[]; // สิ่งที่ยังขาด
}

export function aunVerdict(day: AunDay): AunVerdict {
  const t = AUN_TARGETS;
  const left = t.kcal - day.totals.kcal;
  const pct = Math.round((day.totals.kcal / t.kcal) * 100);
  const proteinLeft = t.protein - day.totals.protein;
  const mealsDone = day.meals.length;
  const waterLeft = t.waterGlasses - day.water;
  const lines: string[] = [];
  const missing: string[] = [];

  lines.push(`กินไปแล้ว ${r0(day.totals.kcal)} kcal จากเป้า ${t.kcal} kcal (${pct}%)`);
  lines.push(left >= 0 ? `เหลือกินได้อีก ${r0(left)} kcal` : `เกินเป้ามาแล้ว ${r0(-left)} kcal`);
  lines.push(`โปรตีน ${r1(day.totals.protein)}/${t.protein} ก. · คาร์บ ${r1(day.totals.carb)}/${t.carb} ก. · ไขมัน ${r1(day.totals.fat)}/${t.fat} ก.`);
  lines.push(`มื้อที่บันทึกแล้ว ${mealsDone}/${t.meals} มื้อ · น้ำ ${day.water}/${t.waterGlasses} แก้ว (${day.water * t.glassMl} ml)`);

  if (proteinLeft > 5) missing.push(`โปรตีนขาดอีก ${r1(proteinLeft)} ก.`);
  if (mealsDone < t.meals) missing.push(`ยังไม่ได้บันทึก ${t.meals - mealsDone} มื้อ`);
  if (waterLeft > 0) missing.push(`น้ำขาดอีก ${waterLeft} แก้ว (${waterLeft * t.glassMl} ml)`);
  // เป้าไขมัน/คาร์บของแผนต่ำมาก (25 ก. / 100 ก.) — เตือนเฉพาะตอนเกินจริงจัง ไม่งั้นขึ้นทุกมื้อจนกลายเป็นเสียงรบกวน
  if (day.totals.fat > t.fat * 1.6) missing.push(`ไขมันเกินเป้า ${r1(day.totals.fat - t.fat)} ก.`);
  if (day.totals.carb > t.carb * 1.4) missing.push(`คาร์บเกินเป้า ${r1(day.totals.carb - t.carb)} ก.`);

  const status: AunVerdict["status"] =
    mealsDone === 0 && day.water === 0
      ? "ยังไม่เริ่ม"
      : left < -100
        ? "เกินเป้า"
        : left < 0 || day.totals.fat > t.fat * 2.2
          ? "ต้องระวัง"
          : "กำลังไปได้ดี";

  const headline =
    status === "ยังไม่เริ่ม"
      ? "วันนี้ยังไม่มีบันทึกเลย"
      : status === "เกินเป้า"
        ? `วันนี้เกินเป้ามา ${r0(-left)} kcal`
        : status === "ต้องระวัง"
          ? "เหลือโควตาไม่มากแล้ว ระวังมื้อถัดไป"
          : `ยังอยู่ในเป้า เหลืออีก ${r0(left)} kcal`;

  return { status, headline, lines, missing };
}

/** ข้อความสรุปสั้น ๆ ไว้เป็นแคปชันของการ์ด (deterministic — ไม่ผ่าน LLM) */
export function dayCaption(day: AunDay, justAdded?: AunMealRow): string {
  const v = aunVerdict(day);
  const head = justAdded
    ? `บันทึกแล้ว ✅ มื้อ${justAdded.mealType} · ${justAdded.title} · ${r0(justAdded.kcal)} kcal`
    : `สรุปการกินวันนี้ (${day.label})`;
  return [head, v.lines[0], v.lines[1], v.lines[3], v.missing.length ? `ยังขาด: ${v.missing.join(" · ")}` : "ครบตามเป้าทุกอย่างแล้ว 🎯"].join("\n");
}

// ===== การ์ดภาพสีชมพู =====

function ringStyle(pct: number): string {
  const p = Math.max(0, Math.min(100, pct));
  return `background:conic-gradient(#fff 0 ${p}%, rgba(255,255,255,.30) ${p}% 100%)`;
}

function macroBar(label: string, val: number, target: number, cls: string): string {
  const pct = Math.round((val / target) * 100); // เปอร์เซ็นต์จริง (เกิน 100 ได้ — ต้องเห็นว่าเกิน)
  const over = val > target * 1.15;
  return `<div class="mrow">
    <div class="mlab">${esc(label)}</div>
    <div class="mtrack"><div class="mfill ${cls}${over ? " over" : ""}" style="width:${Math.max(2, Math.min(100, pct))}%"></div></div>
    <div class="mval"><b>${r1(val)}</b><span class="unit"> / ${target} ก.</span> <span class="pc${over ? " warn" : ""}">${pct}%</span></div>
  </div>`;
}

export function aunDayCardHtml(day: AunDay, opts: { justAdded?: AunMealRow } = {}): string {
  const t = AUN_TARGETS;
  const v = aunVerdict(day);
  const pct = Math.min(999, Math.round((day.totals.kcal / t.kcal) * 100));
  const left = t.kcal - day.totals.kcal;

  const added = opts.justAdded;
  const addedHtml = added
    ? `<div class="card just">
        <div class="jhead"><span class="chip">มื้อ${esc(added.mealType)}</span><span class="jtitle">${esc(added.title)}</span><span class="jkcal">${r0(added.kcal)} <span class="unit">kcal</span></span></div>
        <div class="jitems">${
          added.items.length
            ? added.items
                .map(
                  (it) => `<div class="jitem">
                    <span class="dot"></span>
                    <span class="iname">${esc(it.name)}</span>
                    <span class="iqty">${esc(it.qty)}</span>
                    <span class="imac">P ${r1(it.protein)} · C ${r1(it.carb)} · F ${r1(it.fat)}</span>
                    <span class="ikcal">${r0(it.kcal)}</span>
                  </div>`,
                )
                .join("")
            : `<div class="jitem"><span class="iname">${esc(added.title)}</span></div>`
        }</div>
        ${added.confidence ? `<div class="jnote">ความมั่นใจในการประเมิน: <b>${esc(added.confidence)}</b>${added.note ? ` · ${esc(added.note)}` : ""}</div>` : ""}
      </div>`
    : "";

  const mealsHtml = day.meals.length
    ? day.meals
        .map((m) => {
          const time = m.at.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
          return `<div class="meal">
            <span class="mtime">${esc(time)}</span>
            <span class="mtype">${esc(m.mealType)}</span>
            <span class="mname">${esc(m.title)}</span>
            <span class="mmac">P ${r1(m.protein)}</span>
            <span class="mkcal">${r0(m.kcal)} <span class="unit">kcal</span></span>
          </div>`;
        })
        .join("")
    : `<div class="empty">ยังไม่มีมื้อไหนถูกบันทึกวันนี้ — ส่งรูปอาหารมาได้เลย เดี๋ยวคำนวณให้</div>`;

  const pips = Array.from({ length: t.waterGlasses }, (_, i) => `<span class="pip${i < day.water ? " on" : ""}"></span>`).join("");

  const maxDay = Math.max(t.kcal, ...day.last7.map((d) => d.kcal));
  const targetLinePct = Math.round((t.kcal / maxDay) * 100); // เส้นเป้าวาดในรางทุกวัน (ตำแหน่งตรงกันเป๊ะ)
  const chart = day.last7
    .map((d) => {
      const h = Math.round((d.kcal / maxDay) * 100);
      const over = d.kcal > t.kcal;
      return `<div class="bcol">
        <div class="bval">${d.kcal ? r0(d.kcal) : ""}</div>
        <div class="btrack">
          <div class="bfill${d.today ? " today" : ""}${over ? " over" : ""}" style="height:${d.kcal ? Math.max(5, h) : 0}%"></div>
          <div class="tline" style="bottom:${Math.min(97, targetLinePct)}%"></div>
        </div>
        <div class="blab${d.today ? " now" : ""}">${esc(d.label)}</div>
      </div>`;
    })
    .join("");

  const missHtml = v.missing.length
    ? `<div class="misslist">${v.missing.map((m) => `<div class="miss"><span class="x"></span>${esc(m)}</div>`).join("")}</div>`
    : `<div class="misslist"><div class="miss ok"><span class="ck"></span>ครบตามเป้าทุกอย่างแล้ว เก่งมากครับ</div></div>`;

  return `<!doctype html><html lang="th"><head><meta charset="utf-8"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:760px; background:linear-gradient(180deg,#fff2f7 0%,#fff7fa 40%,#ffffff 100%); color:#4a2b39;
         font-family:"Noto Sans Thai","Sarabun","Prompt","Helvetica Neue",Arial,sans-serif; padding:22px 22px 26px; -webkit-font-smoothing:antialiased; }
  .unit { font-size:.62em; font-weight:600; opacity:.7; }
  .card { background:#fff; border:1.5px solid #ffd8e7; border-radius:20px; padding:16px 18px; box-shadow:0 6px 18px rgba(255,105,160,.10); margin-top:12px; }
  .sect { font-size:14.5px; font-weight:800; color:#e2497f; margin-bottom:10px; display:flex; align-items:center; gap:7px; }
  .sect:before { content:""; width:9px; height:9px; border-radius:50%; background:linear-gradient(135deg,#ff6fa5,#ffb3d1); }

  /* หัวการ์ด */
  .hero { position:relative; background:linear-gradient(135deg,#ff5f9e 0%,#ff86b8 55%,#ffa8cc 100%); border-radius:24px; padding:22px 24px;
          color:#fff; display:flex; align-items:center; justify-content:space-between; box-shadow:0 10px 26px rgba(255,95,158,.28); overflow:hidden; }
  .hero:after { content:""; position:absolute; right:-40px; top:-60px; width:220px; height:220px; border-radius:50%; background:rgba(255,255,255,.13); }
  .hero:before { content:""; position:absolute; left:-30px; bottom:-70px; width:150px; height:150px; border-radius:50%; background:rgba(255,255,255,.10); }
  .htext { position:relative; z-index:1; }
  .htitle { font-size:24px; font-weight:800; letter-spacing:.2px; }
  .hsub { font-size:13.5px; opacity:.92; margin-top:4px; }
  .hline { font-size:14.5px; font-weight:700; margin-top:12px; background:rgba(255,255,255,.20); border-radius:999px; padding:6px 14px; display:inline-block; }
  .ring { position:relative; z-index:1; width:132px; height:132px; border-radius:50%; display:flex; align-items:center; justify-content:center; }
  .ring .hole { width:104px; height:104px; border-radius:50%; background:linear-gradient(135deg,#ff5f9e,#ff92c0); display:flex; flex-direction:column; align-items:center; justify-content:center; }
  .ring .big { font-size:27px; font-weight:800; line-height:1.05; }
  .ring .cap { font-size:11px; opacity:.9; margin-top:2px; letter-spacing:.3px; }

  /* ไทล์ตัวเลข */
  .tiles { display:flex; gap:11px; margin-top:13px; }
  .tile { flex:1; background:#fff; border:1.5px solid #ffdcea; border-radius:18px; padding:12px 14px; box-shadow:0 4px 12px rgba(255,105,160,.08); }
  .tile .k { font-size:11.5px; color:#c77b98; font-weight:700; }
  .tile .v { font-size:22px; font-weight:800; color:#e2497f; margin-top:3px; }
  .tile .v.small { font-size:19px; }
  .tile .s { font-size:11px; color:#b98aa0; margin-top:2px; }

  /* มื้อที่เพิ่งบันทึก */
  .just { background:linear-gradient(180deg,#fff6fa,#fff); }
  .jhead { display:flex; align-items:center; gap:10px; }
  .chip { background:linear-gradient(135deg,#ff6fa5,#ffa1c8); color:#fff; font-size:12px; font-weight:800; border-radius:999px; padding:4px 12px; }
  .jtitle { font-size:16.5px; font-weight:800; flex:1; }
  .jkcal { font-size:21px; font-weight:800; color:#e2497f; }
  .jitems { margin-top:10px; display:flex; flex-direction:column; gap:5px; }
  .jitem { display:flex; align-items:center; gap:9px; background:#fff5f9; border-radius:12px; padding:7px 12px; font-size:13px; }
  .dot { width:7px; height:7px; border-radius:50%; background:#ff8fbb; flex:0 0 auto; }
  .iname { font-weight:700; flex:1; }
  .iqty { color:#b1738e; font-size:12.5px; }
  .imac { color:#c78ea5; font-size:11.5px; min-width:132px; text-align:right; }
  .ikcal { font-weight:800; color:#e2497f; min-width:52px; text-align:right; }
  .jnote { margin-top:9px; font-size:12.5px; color:#a9718a; }

  /* มาโคร */
  .mrow { display:flex; align-items:center; gap:11px; margin:8px 0; }
  .mlab { flex:0 0 78px; font-size:13px; font-weight:700; color:#a9556f; background:#fff0f6; border-radius:9px; padding:6px 8px; text-align:center; }
  .mtrack { position:relative; flex:1; height:20px; border-radius:999px; background:#ffeaf2; overflow:hidden; }
  .mfill { position:absolute; inset:0 auto 0 0; border-radius:999px; }
  .mfill.p { background:linear-gradient(90deg,#ff4f95,#ff85b9); }
  .mfill.c { background:linear-gradient(90deg,#ff9a5a,#ffc38f); }
  .mfill.f { background:linear-gradient(90deg,#b57bff,#d6b0ff); }
  .mfill.over { background:linear-gradient(90deg,#ff3b6b,#ff7a94); }
  .mval { flex:0 0 150px; text-align:right; font-size:13px; color:#7c4358; }
  .mval b { font-size:15px; color:#e2497f; }
  .pc { font-weight:800; color:#c77b98; }
  .pc.warn { color:#ff3b6b; }

  /* รายการมื้อ */
  .meal { display:flex; align-items:center; gap:10px; background:#fff5f9; border-radius:14px; padding:9px 13px; font-size:13.5px; margin-bottom:6px; }
  .mtime { font-weight:800; color:#e2497f; font-size:12.5px; min-width:44px; }
  .mtype { background:#ffe1ee; color:#c93c74; font-size:11.5px; font-weight:800; border-radius:999px; padding:3px 10px; }
  .mname { flex:1; font-weight:600; }
  .mmac { color:#b1738e; font-size:12px; }
  .mkcal { font-weight:800; color:#e2497f; min-width:74px; text-align:right; }
  .empty { background:#fff5f9; border:1.5px dashed #ffc9de; border-radius:14px; padding:16px; text-align:center; color:#c07f9a; font-size:13px; }

  /* น้ำ */
  .waterwrap { display:flex; align-items:center; gap:12px; }
  .pips { display:flex; gap:6px; flex:1; flex-wrap:wrap; }
  .pip { width:22px; height:28px; border-radius:6px 6px 11px 11px; background:#ffeaf2; border:1.5px solid #ffd3e5; }
  .pip.on { background:linear-gradient(180deg,#7fd8ff,#3fb6f0); border-color:#5fc4f5; }
  .wtext { font-size:13.5px; color:#7c4358; font-weight:700; white-space:nowrap; }
  .wtext b { color:#2e9fd8; font-size:16px; }

  /* กราฟ 7 วัน */
  .chart { display:flex; gap:9px; position:relative; padding-top:4px; }
  .bcol { flex:1; display:flex; flex-direction:column; align-items:center; gap:4px; }
  .bval { height:14px; font-size:10.5px; font-weight:800; color:#c77b98; }
  .btrack { position:relative; width:100%; height:88px; border-radius:9px; background:#fff0f6; border:1.5px solid #ffe1ee; overflow:hidden; }
  .bfill { position:absolute; left:0; right:0; bottom:0; border-radius:8px 8px 0 0; background:linear-gradient(180deg,#ffa8cc,#ff7bb0); }
  .bfill.today { background:linear-gradient(180deg,#ff5f9e,#e2497f); }
  .bfill.over { background:linear-gradient(180deg,#ff7a94,#ff3b6b); }
  .blab { font-size:11px; color:#c07f9a; font-weight:700; }
  .blab.now { color:#e2497f; }
  .tline { position:absolute; left:0; right:0; border-top:2px dashed #ff9ec5; z-index:2; }
  .note { font-size:11.5px; color:#c07f9a; font-weight:600; margin-left:auto; }

  /* สรุปครบไหม */
  .verdict { background:linear-gradient(135deg,#fff0f6,#fff8fb); border:1.5px solid #ffd8e7; }
  .vhead { display:flex; align-items:center; gap:10px; }
  .vbadge { font-size:12px; font-weight:800; color:#fff; border-radius:999px; padding:5px 13px; background:linear-gradient(135deg,#ff6fa5,#ffa1c8); }
  .vbadge.warn { background:linear-gradient(135deg,#ff8b3d,#ffb372); }
  .vbadge.bad { background:linear-gradient(135deg,#ff3b6b,#ff7a94); }
  .vbadge.idle { background:linear-gradient(135deg,#c9a2b4,#e2c6d3); }
  .vline { font-size:15.5px; font-weight:800; color:#c93c74; }
  .facts { margin-top:10px; display:flex; flex-direction:column; gap:4px; }
  .fact { font-size:13px; color:#7c4358; }
  .misslist { margin-top:11px; display:flex; flex-wrap:wrap; gap:7px; }
  .miss { display:flex; align-items:center; gap:7px; background:#fff; border:1.5px solid #ffdcea; border-radius:999px; padding:6px 13px; font-size:12.5px; font-weight:700; color:#c93c74; }
  .miss.ok { color:#12a26b; border-color:#bdeedb; background:#f2fdf8; }
  .x { width:14px; height:14px; border-radius:50%; background:#ffdcea; position:relative; }
  .x:before, .x:after { content:""; position:absolute; left:3px; top:6px; width:8px; height:2px; background:#e2497f; border-radius:2px; transform:rotate(45deg); }
  .x:after { transform:rotate(-45deg); }
  .ck { width:14px; height:14px; border-radius:50%; background:#12a26b; position:relative; }
  .ck:before { content:""; position:absolute; left:4px; top:6px; width:6px; height:2px; background:#fff; border-radius:2px; transform:rotate(45deg); }
  .ck:after { content:""; position:absolute; left:6px; top:5px; width:9px; height:2px; background:#fff; border-radius:2px; transform:rotate(-50deg); }
  .foot { margin-top:12px; text-align:center; font-size:11.5px; color:#cf9ab1; }
</style></head><body>

  <div class="hero">
    <div class="htext">
      <div class="htitle">สรุปแคลวันนี้ของอั๋น</div>
      <div class="hsub">${esc(day.label)} · เป้าวันละ ${t.kcal} kcal · โปรตีน ${t.protein} ก.</div>
      <div class="hline">${esc(v.headline)}</div>
    </div>
    <div class="ring" style="${ringStyle(pct)}">
      <div class="hole">
        <div class="big">${r0(day.totals.kcal)}</div>
        <div class="cap">kcal · ${pct}%</div>
      </div>
    </div>
  </div>

  <div class="tiles">
    <div class="tile"><div class="k">กินไปแล้ว</div><div class="v">${r0(day.totals.kcal)}</div><div class="s">จาก ${t.kcal} kcal</div></div>
    <div class="tile"><div class="k">${left >= 0 ? "เหลือกินได้อีก" : "เกินเป้ามาแล้ว"}</div><div class="v">${r0(Math.abs(left))}</div><div class="s">kcal</div></div>
    <div class="tile"><div class="k">มื้อวันนี้</div><div class="v small">${day.meals.length} / ${t.meals}</div><div class="s">มื้อที่บันทึก</div></div>
    <div class="tile"><div class="k">น้ำดื่ม</div><div class="v small">${day.water} / ${t.waterGlasses}</div><div class="s">แก้ว (${day.water * t.glassMl} ml)</div></div>
  </div>

  ${addedHtml}

  <div class="card">
    <div class="sect">มาโครวันนี้</div>
    ${macroBar("โปรตีน", day.totals.protein, t.protein, "p")}
    ${macroBar("คาร์บ", day.totals.carb, t.carb, "c")}
    ${macroBar("ไขมัน", day.totals.fat, t.fat, "f")}
  </div>

  <div class="card">
    <div class="sect">มื้ออาหารวันนี้</div>
    ${mealsHtml}
  </div>

  <div class="card">
    <div class="sect">น้ำดื่ม</div>
    <div class="waterwrap">
      <div class="pips">${pips}</div>
      <div class="wtext"><b>${day.water}</b> / ${t.waterGlasses} แก้ว</div>
    </div>
  </div>

  <div class="card">
    <div class="sect">แคล 7 วันล่าสุด<span class="note">เส้นประ = เป้า ${t.kcal} kcal/วัน</span></div>
    <div class="chart">${chart}</div>
  </div>

  <div class="card verdict">
    <div class="vhead">
      <span class="vbadge${v.status === "เกินเป้า" ? " bad" : v.status === "ต้องระวัง" ? " warn" : v.status === "ยังไม่เริ่ม" ? " idle" : ""}">${esc(v.status)}</span>
      <span class="vline">วันนี้ครบหรือยัง</span>
    </div>
    <div class="facts">${v.lines.map((l) => `<div class="fact">${esc(l)}</div>`).join("")}</div>
    ${missHtml}
  </div>

  <div class="foot">Vex · เทรนเนอร์ส่วนตัวของอั๋น — ตัวเลขเป็นค่าประเมินจากรูป/ข้อความที่ส่งมา</div>
</body></html>`;
}

/** การ์ดวันนี้เป็น PNG base64 (เรนเดอร์พลาด = null ให้ผู้เรียก fallback เป็นข้อความ) */
export async function aunDayCardPng(day: AunDay, opts: { justAdded?: AunMealRow } = {}): Promise<string | null> {
  try {
    const png = await renderHtmlToPng(aunDayCardHtml(day, opts), { width: 760, height: 200 });
    return png.toString("base64");
  } catch {
    return null;
  }
}

/** ข้อเท็จจริงให้ Vex เอาไปพูดต่อ (ห้ามให้ LLM คิดตัวเลขเอง) */
export function aunDayFacts(day: AunDay, justAdded?: AunMealRow): string[] {
  const v = aunVerdict(day);
  const facts = [...v.lines];
  if (justAdded) {
    facts.unshift(
      `เพิ่งบันทึกมื้อ${justAdded.mealType}: ${justAdded.title} = ${r0(justAdded.kcal)} kcal (โปรตีน ${r1(justAdded.protein)} ก. คาร์บ ${r1(justAdded.carb)} ก. ไขมัน ${r1(justAdded.fat)} ก.)`,
    );
    if (justAdded.items.length) facts.push(`รายการในมื้อนี้: ${justAdded.items.map((i) => `${i.name} ${i.qty} ${r0(i.kcal)} kcal`).join(" · ")}`);
    if (justAdded.confidence) facts.push(`ความมั่นใจในการประเมินมื้อนี้: ${justAdded.confidence}`);
    if (justAdded.note) facts.push(`ข้อสังเกตโภชนาการของมื้อนี้: ${justAdded.note}`);
  }
  if (v.missing.length) facts.push(`ยังขาด: ${v.missing.join(" · ")}`);
  else facts.push("วันนี้ครบตามเป้าทุกอย่างแล้ว");
  return facts;
}

// ===== ตัวจับคำสั่ง =====

export const AUN_FOOD_QUERY_RE =
  /(วันนี้|เมื่อกี้|ตอนนี้)?\s*(กินไป|กินอะไร|ได้)?\s*(กี่แคล|แคลอ?รี่?|กี่ kcal|kcal)|สรุป.{0,12}(การกิน|อาหาร|มื้อ|แคล)|กินครบ|ครบยัง|โปรตีน.{0,12}(เท่าไห?ร่|กี่กรัม|ครบ|พอ)|เหลือกินได้|การ์ดแคล|ดูแคล/i;

export const AUN_WATER_RE = /(ดื่ม|กิน|เติม|ซัด)\s*น้ำ\s*(?:ไป)?\s*(\d+(?:\.\d+)?)?\s*(แก้ว|ขวด|ml|มล|ลิตร)?/i;

export const AUN_FOOD_LOG_RE =
  /(มื้อ(เช้า|เที่ยง|กลางวัน|เย็น|ค่ำ|ดึก)|ของว่าง|เพิ่ง(กิน|ทาน|ดื่ม)|กินไป|เมื่อกี้กิน|วันนี้กิน|ทานไป|แดกไป|กิน[ก-๙a-z]{2,})/i;

export const AUN_UNDO_RE = /(ลบ|เอาออก|ยกเลิก).{0,12}(มื้อ|รายการ|ที่บันทึก|ล่าสุด)/i;

/** แปลง "ดื่มน้ำ 2 แก้ว / 1 ขวด / 500 ml" → จำนวนแก้ว (250 ml) */
export function parseWaterGlasses(text: string): number | null {
  const m = text.match(AUN_WATER_RE);
  if (!m) return null;
  const n = m[2] ? Number(m[2]) : 1;
  const unit = (m[3] || "แก้ว").toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return null;
  if (/ml|มล/.test(unit)) return Math.max(1, Math.round(n / AUN_TARGETS.glassMl));
  if (/ลิตร/.test(unit)) return Math.max(1, Math.round((n * 1000) / AUN_TARGETS.glassMl));
  if (/ขวด/.test(unit)) return Math.max(1, Math.round((n * 600) / AUN_TARGETS.glassMl)); // ขวดน้ำ 600 ml
  return Math.min(20, Math.round(n));
}
