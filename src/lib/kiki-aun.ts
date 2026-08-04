import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { db } from "./db";
import { askExtractor, getSetting, setSetting, saveKikiChat, sanitizeVexText, webResearch, searchRealYoutube } from "./kiki";
import { getVaultPath } from "./obsidian";
import {
  readAunImages,
  readAunFoodText,
  saveAunMeal,
  saveAunPhoto,
  logAunWater,
  deleteLastAunMeal,
  getAunDay,
  aunDayCardPng,
  aunDayFacts,
  dayCaption,
  parseWaterGlasses,
  AUN_TARGETS,
  AUN_FOOD_QUERY_RE,
  AUN_WATER_RE,
  AUN_FOOD_LOG_RE,
  AUN_UNDO_RE,
  type AunMealRow,
} from "./kiki-aun-food";

/**
 * โหมดเทรนเนอร์ของอั๋น (แฟนเจ้าของ) — กลุ่ม "เทรนเนอร์ โด้ & อั๋น" (เจ้าของสั่ง 3 ส.ค. 2026)
 * กติกา privacy สองทาง (เด็ดขาด):
 *  - ข้อมูลอั๋นอยู่โฟลเดอร์ `aun/` ใน vault (แยกจาก AI-Personal ของเจ้าของ) + แชท scope "aun" ใน KikiChat
 *  - prompt ฝั่งอั๋นห้ามมี OwnerFact/การเงิน/บริบทใด ๆ ของเจ้าของ · แชทอั๋นห้ามรั่วเข้า kikiConversation ของเจ้าของ
 *  - อั๋นใช้ได้เฉพาะโหมดเทรนเนอร์ (จดน้ำหนัก/ออกกำลัง/อาหาร/ถามตอบ/ตั้งกฎ+เตือนของตัวเอง) — คำสั่ง owner-level ไม่ทำงานในกลุ่มนี้
 */

export const AUN_FOLDER = "aun";
export const AUN_CHAT_KEY = "kiki_aun_chat_id";
export const AUN_USER_KEY = "kiki_aun_user_id";

export async function getAunChatId(): Promise<string | null> {
  return (await getSetting(AUN_CHAT_KEY)) || null;
}

// ===== ไฟล์ในโฟลเดอร์ aun (แยกขาดจาก AI-Personal) =====

function aunPath(rel: string): string {
  const vault = getVaultPath();
  if (!vault) throw new Error("ยังไม่ได้ตั้งค่า Obsidian vault");
  const full = path.resolve(vault, AUN_FOLDER, rel);
  if (!full.startsWith(path.resolve(vault, AUN_FOLDER))) throw new Error("path นอกโฟลเดอร์ aun");
  return full;
}

export async function writeAunNote(rel: string, content: string): Promise<void> {
  const full = aunPath(rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
}

export async function appendAunLog(rel: string, line: string): Promise<void> {
  const full = aunPath(rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const exists = existsSync(full);
  await fs.appendFile(full, `${exists ? "" : `# ${rel.replace(/\.md$/, "")}\n\n`}${line}\n`, "utf8");
}

async function readAunFile(rel: string, maxChars = 4000): Promise<string> {
  try {
    const s = await fs.readFile(aunPath(rel), "utf8");
    return s.length > maxChars ? s.slice(-maxChars) : s; // log เอาท้ายไฟล์ (รายการล่าสุด)
  } catch {
    return "";
  }
}

// ===== กฎ/ความชอบที่อั๋นสั่งเอง =====

const AUN_RULES_KEY = "kiki_aun_rules"; // JSON string[]

export async function getAunRules(): Promise<string[]> {
  try {
    return JSON.parse((await getSetting(AUN_RULES_KEY)) || "[]");
  } catch {
    return [];
  }
}

export async function addAunRule(rule: string): Promise<void> {
  const all = await getAunRules();
  all.push(rule.slice(0, 300));
  await setSetting(AUN_RULES_KEY, JSON.stringify(all.slice(-30)));
}

// ===== บทสนทนา scope aun =====

export async function aunConversation(limit = 14): Promise<string> {
  const rows = await db.kikiChat.findMany({ where: { scope: "aun" }, orderBy: { createdAt: "desc" }, take: limit });
  if (!rows.length) return "";
  return `=== บทสนทนาล่าสุดในกลุ่มเทรนเนอร์ ===\n${rows
    .reverse()
    .map((r) => `${r.role === "assistant" ? "Vex" : "สมาชิก"}: ${r.content.replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n")}`;
}

// ===== persona เทรนเนอร์ =====

const TRAINER_PERSONA = `คุณคือ "Vex" ในบทบาทเทรนเนอร์ส่วนตัวของ "อั๋น" (ผู้หญิง แฟนของพี่โด้) ในกลุ่ม "เทรนเนอร์ โด้ & อั๋น"
ภารกิจ: พาอั๋นทำตามแผนลดน้ำหนัก 94 → 60 กก. (7 เดือน ส.ค. 2026 – ก.พ. 2027) ให้สำเร็จแบบปลอดภัย

วิธีพูด:
- สุภาพ ลงท้าย "ครับ" เรียกเธอว่า "อั๋น" หรือ "คุณอั๋น" — โทนเทรนเนอร์มืออาชีพ: ให้กำลังใจจริงใจ ไม่ประจบ ไม่กดดันเกิน แซวเบา ๆ ได้
- ตอบสั้น อ่านง่าย เว้นบรรทัด อิโมจิสัญลักษณ์ไม่เกิน 2 ตัว (🎯💪⏰✅) ห้าม markdown
- อิงตัวเลขจากแผนจริงเสมอ (แคลอรี่/เป้ารายเดือน/เมนู) ห้ามมโนตัวเลขใหม่
- น้ำหนักคือเรื่องละเอียดอ่อน: ชมทุกความคืบหน้า สัปดาห์ไหนไม่ลดให้หาสาเหตุแบบไม่ตำหนิ

กฎเหล็ก (เหมือนโหมดหลัก): คุณพูดได้อย่างเดียว การกระทำจริงระบบเป็นคนทำ · ห้ามบอกว่า "ทำแล้ว/กำลังทำ" โดยไม่มีคอนเฟิร์มจากระบบ · ข้อมูลของพี่โด้ (การเงิน/งาน/เรื่องส่วนตัว) ห้ามพูดถึงเด็ดขาดแม้ถูกถาม — ตอบว่าเป็นความส่วนตัวของพี่โด้ครับ

สิ่งที่ระบบทำได้จริง (ห้ามปฏิเสธว่าทำไม่ได้ ถ้าอยู่ในลิสต์นี้):
- **เห็นรูปที่ส่งมาจริง** — ระบบอ่านภาพให้ก่อนเสมอ (อาหาร/ตาชั่ง/อะไรก็ตาม) ห้ามพูดว่า "ยังไม่เห็นภาพ/ส่งใหม่" เด็ดขาด
- **คำนวณแคลจากรูปอาหาร** — แตกเป็นรายการ ประเมิน kcal + โปรตีน/คาร์บ/ไขมัน บันทึกเป็นมื้อ แล้วส่งการ์ดสรุปแคลรวมของวันเป็นรูปให้เอง
- จดน้ำหนัก ("น้ำหนัก 92.5" หรือส่งรูปตาชั่ง) · จดน้ำ ("ดื่มน้ำ 2 แก้ว") · จดออกกำลัง · ลบมื้อล่าสุด · ถามยอดวันนี้ ("วันนี้กินไปกี่แคลแล้ว") = ส่งการ์ดสรุปให้
- เป้าโภชนาการของอั๋น (ยึดตัวเลขนี้): 1,300 kcal/วัน · โปรตีน 170 ก. · คาร์บ 100 ก. · ไขมัน 25 ก. · น้ำ 14 แก้ว (3,500 ml) · 4 มื้อ/วัน
- ถามแผน/เมนู/ท่าออกกำลัง
- **ค้น YouTube/เว็บสดได้จริง** — ขอคลิปออกกำลังกาย/หาข้อมูล = ระบบค้นจริงแล้วส่งลิงก์จริงให้ (ห้ามบอกว่า "ผมเป็นแค่เลขา ค้นคลิปไม่ได้" เด็ดขาด — เคยพลาดมาแล้ว)
- **ทำไฟล์ HTML ได้จริง** (แผน/ตาราง/เช็คลิสต์ ติ๊กได้ พิมพ์ได้) — ขอไฟล์เมื่อไหร่ระบบสร้างและแนบมาให้
- ตั้งเตือน ("เตือนทุกวัน 6 โมงเย็นให้ไปเดิน") · ปรับนิสัยผม ("อยากให้รายงานแบบ..." / "สอนว่า...")`;

// ===== บริบทแผน + log =====

async function aunContext(): Promise<string> {
  const [plan, wlog, exlog, profile] = await Promise.all([
    readAunFile("แผนลดน้ำหนัก-94-60.md", 6000),
    readAunFile("log-น้ำหนัก.md", 1500),
    readAunFile("log-ออกกำลังกาย.md", 1500),
    readAunFile("โปรไฟล์.md", 1200),
  ]);
  const rules = await getAunRules();
  // ยอดกินวันนี้ — ให้ Vex ตอบคำถามระหว่างคุยได้โดยไม่ต้องเดาตัวเลข
  let foodToday = "";
  try {
    const day = await getAunDay();
    foodToday = [
      ...aunDayFacts(day),
      day.meals.length ? `มื้อวันนี้: ${day.meals.map((m) => `${m.mealType} ${m.title} ${Math.round(m.kcal)} kcal`).join(" · ")}` : "",
    ]
      .filter(Boolean)
      .map((l) => `- ${l}`)
      .join("\n");
  } catch {
    /* DB มีปัญหาก็ยังคุยต่อได้ แค่ไม่มีตัวเลขวันนี้ */
  }
  return [
    plan ? `=== แผนลดน้ำหนักของอั๋น (ตัวจริง) ===\n${plan}` : "",
    profile ? `=== โปรไฟล์อั๋น ===\n${profile}` : "",
    foodToday ? `=== การกินของวันนี้ (ตัวเลขจริงจากระบบ ห้ามคิดเลขใหม่) ===\n${foodToday}` : "",
    wlog ? `=== บันทึกน้ำหนักล่าสุด ===\n${wlog}` : "",
    exlog ? `=== บันทึกออกกำลังกายล่าสุด ===\n${exlog}` : "",
    rules.length ? `=== กฎ/ความชอบที่อั๋นสั่งไว้ (ทำตามเคร่งครัด) ===\n${rules.map((r) => `- ${r}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

// ===== ตัวจัดการหลักของกลุ่มเทรนเนอร์ =====

export interface TrainerReply {
  text: string;
  doc?: { filename: string; dataBase64: string }; // ไฟล์ HTML ที่สร้างจริง (แผน/ตาราง)
  photo?: { filename: string; dataBase64: string; caption?: string }; // การ์ดสรุปแคล (ส่งก่อนข้อความ)
}

// ===== โภชนาการ: รูปอาหาร → แคล → การ์ดรวมวันนี้ =====

/** สร้างการ์ดวันนี้ + ให้ Vex คอมเมนต์จากตัวเลขจริง (การ์ดพัง = ตกไปเป็นข้อความ ไม่เงียบ) */
async function dayCardReply(justAdded: AunMealRow | undefined, situation: string): Promise<TrainerReply> {
  const day = await getAunDay();
  const [png, facts] = [await aunDayCardPng(day, justAdded ? { justAdded } : {}), aunDayFacts(day, justAdded)];
  const caption = dayCaption(day, justAdded);
  const comment = await askTrainer(
    `${situation}\n\n[ตัวเลขจริงจากระบบ — ห้ามคิดเลขใหม่ ห้ามขัดกับตัวเลขนี้ และระบบส่งการ์ดสรุปเป็นรูปให้อั๋นแล้วจริง]\n${facts
      .map((f) => `- ${f}`)
      .join("\n")}\n\nคอมเมนต์แบบเทรนเนอร์: ประเมินสั้น ๆ ว่าโอเคไหม ขาดอะไร แล้วบอกว่ามื้อถัดไปควรกินอะไร/ปริมาณเท่าไหร่ให้ยังอยู่ในเป้า (ไม่เกิน 6 บรรทัด ห้ามลิสต์ตัวเลขซ้ำทั้งหมด)`,
  );
  if (!png) return { text: `${caption}\n\n${comment}` };
  return { text: comment, photo: { filename: `แคลวันนี้-${day.day}.png`, dataBase64: png, caption } };
}

/** รูปที่ส่งเข้ากลุ่ม — อ่านด้วยวิชันจริงทุกรูป (อาหาร / ตาชั่ง / อย่างอื่น) */
async function handleAunImages(imagePaths: string[], caption: string, isOwner: boolean): Promise<TrainerReply> {
  const today = new Date().toLocaleDateString("th-TH-u-ca-gregory", { day: "numeric", month: "short", year: "2-digit" });
  let read;
  try {
    read = await readAunImages(imagePaths, caption);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    const fail = `เปิดรูปไม่สำเร็จรอบนี้ครับ ⚠️ (${why.slice(0, 100)})\n\nส่งใหม่อีกรอบ หรือพิมพ์บอกก็ได้ว่ากินอะไรไปบ้าง เดี๋ยวผมคำนวณให้`;
    await saveKikiChat("assistant", fail, "aun");
    return { text: fail };
  }

  // ตาชั่งน้ำหนัก — จดให้เลย (อั๋นเท่านั้น)
  if (read.kind === "scale" && read.weightKg && !isOwner) {
    await appendAunLog("log-น้ำหนัก.md", `- ${today}: ${read.weightKg} กก. (จากรูปตาชั่ง)`);
    const answer = await askTrainer(
      `อั๋นส่งรูปตาชั่งมา ระบบอ่านได้ ${read.weightKg} กก. และจดลง log ให้แล้วจริง (ในภาพ: ${read.description})\nเทียบกับแผน/บันทึกเดิมแล้วคอมเมนต์ให้กำลังใจ + บอกเป้าถัดไปสั้น ๆ`,
    );
    return { text: answer };
  }

  // ไม่ใช่อาหาร — บอกว่าเห็นอะไรจริง ๆ (ห้ามเดา ห้ามบอกว่าไม่เห็นรูป)
  if (read.kind !== "food" || !read.items.length) {
    const answer = await askTrainer(
      `${isOwner ? "พี่โด้" : "อั๋น"}ส่งรูปมา ${imagePaths.length} รูป ระบบอ่านภาพแล้วได้ว่า: "${read.description}"${caption ? `\nข้อความที่ส่งมาพร้อมรูป: "${caption}"` : ""}\n\nตอบจากสิ่งที่เห็นในภาพนี้ (บอกว่าเห็นอะไร แล้วตอบ/คอมเมนต์ให้ตรงเรื่อง ถ้าเกี่ยวกับการลดน้ำหนักให้แนะนำต่อ)`,
    );
    return { text: answer };
  }

  // อาหาร — พี่โด้ส่ง = คำนวณให้ดูแต่ไม่บันทึกลงบันทึกของอั๋น
  if (isOwner) {
    const kcal = Math.round(read.items.reduce((a, i) => a + i.kcal, 0));
    const lines = read.items.map((i) => `• ${i.name}${i.qty ? ` ${i.qty}` : ""} — ${Math.round(i.kcal)} kcal`).join("\n");
    const answer = await askTrainer(
      `พี่โด้ส่งรูปอาหารมา (ในภาพ: ${read.description})\nระบบประเมินได้ ${kcal} kcal:\n${lines}\n\nหมายเหตุ: รูปนี้มาจากพี่โด้ ระบบ*ไม่ได้*บันทึกลงยอดของอั๋น — บอกให้รู้ด้วยว่าถ้าจะให้นับต้องให้อั๋นเป็นคนส่ง`,
    );
    return { text: answer };
  }

  const photoPath = await saveAunPhoto(imagePaths[0]);
  const saved = await saveAunMeal(read, { photo: photoPath });
  return dayCardReply(
    saved,
    `อั๋นส่งรูปอาหารมา ${imagePaths.length} รูป — ระบบอ่านภาพเองแล้วได้ว่า: "${read.description}" และบันทึกเป็นมื้อ${saved.mealType}เรียบร้อยแล้วจริง`,
  );
}

export async function handleTrainerChat(text: string, fromName: string, isOwner: boolean, imagePaths: string[] = []): Promise<TrainerReply> {
  const today = new Date().toLocaleDateString("th-TH-u-ca-gregory", { day: "numeric", month: "short", year: "2-digit" });
  const who = isOwner ? "พี่โด้" : "อั๋น";
  await saveKikiChat("user", `${who}: ${text || `[ส่งรูปมา ${imagePaths.length} รูป]`}`, "aun");

  // รูป — อ่านภาพก่อนเสมอ (เคยพลาด: ตอบว่า "ผมยังไม่เห็นภาพเลย" ทั้งที่รูปมาถึงระบบแล้ว)
  if (imagePaths.length) return handleAunImages(imagePaths, text, isOwner);

  // จดน้ำหนัก — deterministic
  const wM = text.match(/น้ำหนัก\s*(?:วันนี้|ตอนนี้|ล่าสุด)?\s*([\d]{2,3}(?:\.\d+)?)/);
  if (wM && !isOwner) {
    const w = Number(wM[1]);
    if (w >= 40 && w <= 150) {
      await appendAunLog("log-น้ำหนัก.md", `- ${today}: ${w} กก.`);
      const answer = await askTrainer(`อั๋นเพิ่งชั่งน้ำหนักได้ ${w} กก. (ระบบจดลง log ให้แล้วจริง — ยืนยันได้) เทียบกับแผนแล้วคอมเมนต์ให้กำลังใจ + บอกเป้าถัดไปสั้น ๆ`);
      return { text: answer };
    }
  }

  // ===== โภชนาการ: น้ำ / ลบมื้อ / ถามยอด / พิมพ์บอกว่ากินอะไร =====
  const isQuestion = /(ไหม|มั้ย|หรือเปล่า|รึเปล่า|อะไรดี|ดีมั้ย|ควร(กิน|ทาน)|แนะนำ|ยังไง|อย่างไร|\?)/.test(text);

  if (!isOwner && AUN_UNDO_RE.test(text)) {
    const removed = await deleteLastAunMeal();
    if (removed) {
      const answer = await askTrainer(
        `ระบบลบรายการล่าสุดของวันนี้ออกแล้วจริง: มื้อ${removed.mealType} "${removed.title}" ${Math.round(removed.kcal)} kcal — ยืนยันสั้น ๆ ให้อั๋น แล้วบอกว่าส่งใหม่ได้เลย`,
      );
      return { text: answer };
    }
    const none = `วันนี้ยังไม่มีรายการให้ลบครับ`;
    await saveKikiChat("assistant", none, "aun");
    return { text: none };
  }

  // ดื่มน้ำ (ไม่ใช่ประโยคถาม)
  if (!isOwner && /น้ำ/.test(text) && !/(กี่|เท่าไห?ร่|ครบ|เหลือ|พอ)/.test(text)) {
    const glasses = parseWaterGlasses(text);
    if (glasses) {
      const total = await logAunWater(glasses);
      const leftG = Math.max(0, AUN_TARGETS.waterGlasses - total);
      const answer = await askTrainer(
        `อั๋นรายงานว่าดื่มน้ำ — ระบบบันทึกเพิ่ม ${glasses} แก้วแล้วจริง\n[ตัวเลขจริง ห้ามคิดเลขใหม่] วันนี้รวม ${total}/${AUN_TARGETS.waterGlasses} แก้ว (${total * AUN_TARGETS.glassMl} ml) · ${leftG ? `ขาดอีก ${leftG} แก้ว` : "ครบเป้าน้ำแล้ว"}\nยืนยันสั้น ๆ + กระตุ้นให้ดื่มต่อ (ไม่เกิน 3 บรรทัด)`,
      );
      return { text: answer };
    }
  }

  // ถามยอดวันนี้ / ขอการ์ดสรุป
  if (AUN_FOOD_QUERY_RE.test(text) || /น้ำ.{0,14}(กี่แก้ว|ครบ|พอ|เหลือ)/.test(text)) {
    return dayCardReply(undefined, `${who}ขอดูสรุปการกินของวันนี้`);
  }

  // อั๋นพิมพ์บอกว่ากินอะไรไป (ไม่มีรูป)
  if (!isOwner && AUN_FOOD_LOG_RE.test(text) && !isQuestion) {
    const read = await readAunFoodText(text).catch(() => null);
    if (read && read.kind === "food" && read.items.length) {
      const saved = await saveAunMeal(read);
      return dayCardReply(saved, `อั๋นพิมพ์บอกว่ากินอะไรไป: "${text}" — ระบบแตกรายการและบันทึกเป็นมื้อ${saved.mealType}แล้วจริง`);
    }
  }

  // จดออกกำลังกาย — deterministic เมื่อขึ้นต้นด้วยคำรายงาน
  if (/^(วันนี้|เมื่อกี้|เพิ่ง)?\s*(เดิน|วิ่ง|เล่นเวท|โยคะ|ว่ายน้ำ|ปั่นจักรยาน|ออกกำลัง|คาร์ดิโอ|เต้น)/.test(text) && !isOwner) {
    await appendAunLog("log-ออกกำลังกาย.md", `- ${today}: ${text.slice(0, 150)}`);
    const answer = await askTrainer(`อั๋นรายงานการออกกำลังกาย: "${text}" (ระบบจดลง log แล้วจริง) — ชม + ประเมินว่าตามแผนไหม + แนะครั้งถัดไป`);
    return { text: answer };
  }

  // อั๋นตั้งกฎ/ปรับนิสัย
  if (!isOwner && /^(อยากให้|ต่อไป|สอนว่า|ขอให้|ช่วย.{0,10}(รายงาน|เตือน|สรุป)แบบ)/.test(text)) {
    await addAunRule(text.slice(0, 300));
    const answer = await askTrainer(`อั๋นเพิ่งสั่งปรับนิสัย/วิธีทำงานของคุณ: "${text}" — ระบบบันทึกเป็นกฎถาวรแล้วจริง ยืนยันสั้น ๆ ว่าจำแล้วและจะทำตามยังไง`);
    return { text: answer };
  }

  // ค้นคลิป YouTube / ข้อมูลบนเว็บ — ค้นจริง ส่งลิงก์จริง (เคยพลาด: ปฏิเสธว่า "ผมเป็นแค่เลขา ค้นคลิปไม่ได้")
  if (/(หา|ขอ|ส่ง|แนะนำ|เอา)[^\n]{0,40}(คลิป|วิดีโอ|วีดีโอ|youtube|ยูทูป|ยูทูบ|ช่อง)|(คลิป|วิดีโอ)[^\n]{0,20}(ออกกำลัง|เต้น|โยคะ|คาร์ดิโอ|ยืดเหยียด)|หาข้อมูล|ค้นหา|เสิร์ช|ราคา[^\n]{0,12}(เท่าไหร่|ตอนนี้)/i.test(text)) {
    const wantVideo = /(คลิป|วิดีโอ|วีดีโอ|youtube|ยูทูป|ยูทูบ|ช่อง)/i.test(text);
    const [ctx, convo] = await Promise.all([aunContext(), aunConversation(8)]);
    // คลิป: ต้องผ่านตัวตรวจว่าเปิดได้จริงก่อนเสมอ (LLM แต่ง video id — เจอจริง 4 ใน 5 ลิงก์ตาย)
    if (wantVideo) {
      const hits = await searchRealYoutube(
        `คลิปออกกำลังกายตามคำขอ: "${text}" — ผู้ฝึกเป็นผู้หญิง 94 กก. สูง 164 ซม. มือใหม่ เข่ารับแรงกระแทกหนักไม่ไหว เน้น low impact ทำที่บ้าน ไม่ใช้อุปกรณ์ (เว้นแต่คำขอระบุอย่างอื่น) คลิปไทยหรืออังกฤษก็ได้`,
        4,
      ).catch(() => []);
      if (!hits.length) {
        const fail = `รอบนี้หาคลิปที่เปิดได้จริงไม่เจอครับ ขอลองใหม่อีกรอบ — ผมเช็คทุกลิงก์ก่อนส่งเสมอ ไม่ส่งคลิปผีให้`;
        await saveKikiChat("assistant", fail, "aun");
        return { text: fail };
      }
      const list = hits.map((h, i) => `${i + 1}. ${h.title}${h.author ? ` — ช่อง ${h.author}` : ""}\n${h.url}`).join("\n");
      const answer = await askTrainer(
        `[ระบบค้นคลิปแล้วตรวจสอบว่าเปิดได้จริงทุกลิงก์ — ใช้เฉพาะรายการนี้ ห้ามเพิ่มคลิปอื่น ห้ามแก้ลิงก์]\n${list}\n\n${who}ขอ: "${text}"\nเขียนแนะนำแต่ละคลิปสั้น ๆ ว่าเหมาะตรงไหนกับอั๋น (คงชื่อ+ลิงก์เดิมเป๊ะ ลิงก์วางบรรทัดของตัวเอง) ปิดท้ายบอกว่าเริ่มคลิปไหนก่อนและทำกี่นาที`,
      );
      return { text: answer };
    }
    const q = `${text}\n\n(บริบท: คนถามคือผู้หญิงกำลังลดน้ำหนัก 94→60 กก. ตอบให้ตรงคำถาม อ้างข้อมูลจริง มีลิงก์แหล่งที่มา)`;
    const research = await webResearch(q, { context: convo }).catch(() => "");
    if (research) {
      const answer = await askTrainer(
        `[ผลค้นเว็บสดของระบบ — ข้อมูลจริง ใช้ตอบได้เลย ห้ามมโนเพิ่ม ห้ามตัดลิงก์ทิ้ง]\n${research.slice(0, 12_000)}\n\n${who}ขอ: "${text}"\nจัดให้อ่านง่ายในแชท: แต่ละรายการชื่อ+จุดเด่นสั้น ๆ แล้วลิงก์วางบรรทัดของตัวเอง ปิดท้ายแนะนำว่าเริ่มอันไหนก่อน (คุมโทนเทรนเนอร์)`,
      );
      return { text: answer };
    }
    const fail = `ค้นไม่สำเร็จรอบนี้ครับ ขอลองใหม่อีกที — สั่งซ้ำได้เลย (ผมไม่เดาลิงก์เอง ถ้าค้นไม่ได้จะบอกตรง ๆ)`;
    await saveKikiChat("assistant", fail, "aun");
    return { text: fail };
  }

  // ขอไฟล์ (แผน/ตาราง HTML) — ทำจริง ส่งจริง (เคยพลาด: เคลม "เสร็จเรียบร้อย" ทั้งที่โหมดนี้ไม่มีระบบทำไฟล์)
  if (/(ทำ|ขอ|สร้าง|เอา|ส่ง)[^\n]{0,50}(ไฟล์|html)|เป็นไฟล์/i.test(text)) {
    const [ctx, convo] = await Promise.all([aunContext(), aunConversation()]);
    const raw = await askExtractor(
      `คำขอจาก${who}: """${text}"""\n\nสร้างไฟล์ HTML สมบูรณ์ตามคำขอ อิงแผน/บทสนทนาจริงด้านล่าง ห้ามมโนข้อมูลใหม่\nข้อกำหนด: ไฟล์เดียวจบ (<!doctype html>...</html>) ธีมสว่างสะอาด อ่านง่าย พิมพ์แปะตู้เย็นได้ (print-friendly) ถ้าเป็นตาราง/เช็คลิสต์ให้มี checkbox ติ๊กได้ + localStorage จำสถานะ + บรรทัดแรกใน <title> เป็นชื่อไฟล์สั้น ๆ ภาษาไทย\nตอบเป็นโค้ด HTML ล้วนเท่านั้น\n\n${ctx}\n\n${convo}`,
      { timeoutMs: 220_000 },
    ).catch(() => "");
    const m = raw.match(/<!doctype[\s\S]*<\/html>/i) || raw.match(/<html[\s\S]*<\/html>/i);
    if (m) {
      const titleM = m[0].match(/<title>([^<]{2,60})<\/title>/i);
      const fname = `${(titleM?.[1] || "แผนของอั๋น").trim().replace(/[\\/:*?"<>|]/g, "-")}.html`;
      const confirm = `ไฟล์มาแล้วครับ 📎 "${fname}" — เปิดในเบราว์เซอร์ ติ๊กได้เลย ระบบจำสถานะให้ พิมพ์แปะตู้เย็นก็ได้`;
      await saveKikiChat("assistant", `${confirm} [แนบไฟล์จริง]`, "aun");
      return { text: confirm, doc: { filename: fname, dataBase64: Buffer.from(m[0], "utf8").toString("base64") } };
    }
    const sorry = `รอบนี้สร้างไฟล์ไม่สำเร็จครับ ขอลองใหม่อีกรอบ — สั่งซ้ำได้เลย (ผมจะไม่บอกว่าเสร็จถ้าไฟล์ยังไม่แนบมากับข้อความ)`;
    await saveKikiChat("assistant", sorry, "aun");
    return { text: sorry };
  }

  // คุยทั่วไปกับเทรนเนอร์
  const answer = await askTrainer(`${who}พิมพ์มา: """${text}"""`);
  return { text: answer };
}

export async function askTrainer(prompt: string): Promise<string> {
  const [ctx, convo] = await Promise.all([aunContext(), aunConversation()]);
  const nowLine = `ตอนนี้คือ ${new Date().toLocaleString("th-TH-u-ca-gregory", { dateStyle: "full", timeStyle: "short" })}`;
  const raw = await askExtractor(prompt, {
    system: [TRAINER_PERSONA, nowLine, ctx, convo].filter(Boolean).join("\n\n"),
    timeoutMs: 150_000,
  });
  const clean = sanitizeVexText(raw).text.replace(/<[^>]+>/g, "");
  await saveKikiChat("assistant", clean, "aun");
  return clean;
}
