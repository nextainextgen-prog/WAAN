import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { db } from "./db";
import { askExtractor, getSetting, setSetting, saveKikiChat, sanitizeVexText } from "./kiki";
import { getVaultPath } from "./obsidian";

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

สิ่งที่อั๋นสั่งได้ (บอกเธอเมื่อถาม): จดน้ำหนัก ("น้ำหนัก 92.5") · จดออกกำลัง/อาหาร (พิมพ์บอกเฉย ๆ) · ถามแผน/เมนู/ท่าออกกำลัง · ตั้งเตือน ("เตือนทุกวัน 6 โมงเย็นให้ไปเดิน") · ปรับนิสัยผม ("อยากให้รายงานแบบ..." / "สอนว่า...")`;

// ===== บริบทแผน + log =====

async function aunContext(): Promise<string> {
  const [plan, wlog, exlog, profile] = await Promise.all([
    readAunFile("แผนลดน้ำหนัก-94-60.md", 6000),
    readAunFile("log-น้ำหนัก.md", 1500),
    readAunFile("log-ออกกำลังกาย.md", 1500),
    readAunFile("โปรไฟล์.md", 1200),
  ]);
  const rules = await getAunRules();
  return [
    plan ? `=== แผนลดน้ำหนักของอั๋น (ตัวจริง) ===\n${plan}` : "",
    profile ? `=== โปรไฟล์อั๋น ===\n${profile}` : "",
    wlog ? `=== บันทึกน้ำหนักล่าสุด ===\n${wlog}` : "",
    exlog ? `=== บันทึกออกกำลังกายล่าสุด ===\n${exlog}` : "",
    rules.length ? `=== กฎ/ความชอบที่อั๋นสั่งไว้ (ทำตามเคร่งครัด) ===\n${rules.map((r) => `- ${r}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

// ===== ตัวจัดการหลักของกลุ่มเทรนเนอร์ =====

export interface TrainerReply {
  text: string;
}

export async function handleTrainerChat(text: string, fromName: string, isOwner: boolean): Promise<TrainerReply> {
  const today = new Date().toLocaleDateString("th-TH-u-ca-gregory", { day: "numeric", month: "short", year: "2-digit" });
  const who = isOwner ? "พี่โด้" : "อั๋น";
  await saveKikiChat("user", `${who}: ${text}`, "aun");

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
