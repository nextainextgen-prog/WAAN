// จำแนกแชท OHO → Product / บริษัท / Topic / อิโมจิ + โหลด thread ID ของแต่ละ Topic
import fs from "node:fs";
import path from "node:path";

const TOPICS = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts", "topics.json"), "utf8"));
export function topicId(key) { return TOPICS[key]; }

// อิโมจิแบรนด์ต่อบริษัท + สีแพลตฟอร์ม (FB/LINE ต่างสีตามแบรนด์) + Topic ปิดแชท
const BRAND = {
  thunder: { emoji: "⚡️", fb: "🔵", line: "🟢", closeKey: "closeThunder" },
  easyslip: { emoji: "🧑🏻‍💻", fb: "🟣", line: "🟢", closeKey: "closeEasyslip" },
  easycrm: { emoji: "📇", fb: "🔵", line: "🟢", closeKey: null },
  boostsms: { emoji: "📣", fb: "🔵", line: "🟢", closeKey: null },
};
export function brandOf(company) { return BRAND[company] || null; }

// ชื่อแพลตฟอร์มไทย + อิโมจิสีตามบริษัท
export function platformLabel(platform) {
  return platform === "fb" ? "เพจ Facebook" : platform === "line" ? "LINE OA" : "";
}
export function platformEmoji(company, platform) {
  const b = BRAND[company];
  if (!b) return "";
  return platform === "fb" ? b.fb : platform === "line" ? b.line : "";
}

// จำแนกจากชื่อช่องทาง OHO (.channel-name) → { product, company, topicKey, title }  (ไม่รู้จัก = null)
// Thunder: มี BOT = Bot ("THUNDER / BOT+API"), มี API แต่ไม่มี BOT = API ("THUNDER / API"), "THUNDER SOLUTION" = Bot
// EasySlip: ทั้ง "EASYSLIP" และ "EASYSLIP / BOT+API" → รวม Topic เดียว
export function classifyOho(channel) {
  const c = (channel || "").toUpperCase();
  if (c.includes("THUNDER")) {
    if (c.includes("API") && !c.includes("BOT"))
      return { product: "thunderApi", company: "thunder", topicKey: "thunderApi", title: "Thunder API" };
    return { product: "thunderBot", company: "thunder", topicKey: "thunderBot", title: "Thunder Bot" };
  }
  if (c.includes("EASYSLIP"))
    return { product: "easyslip", company: "easyslip", topicKey: "easyslip", title: "EasySlip" };
  return null;
}
