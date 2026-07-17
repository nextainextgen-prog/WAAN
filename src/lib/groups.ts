import { db } from "@/lib/db";

// ทะเบียนชื่อกลุ่ม — วานจำ chatId → ชื่อกลุ่ม อัตโนมัติจากทุกข้อความที่เข้ามา
// ไว้ให้ "ศูนย์บัญชาการ" (กลุ่มหลัก) สั่งข้ามกลุ่มโดยอ้างชื่อได้ เช่น "ปิดแจ้งเตือน EasySlip"
const REG_KEY = "group_registry";

export interface GroupInfo {
  chatId: string;
  title: string;
  at: string; // ISO — เห็นล่าสุดเมื่อไหร่
}

type RegMap = Record<string, { title: string; at: string }>;

async function readMap(): Promise<RegMap> {
  const row = await db.setting.findUnique({ where: { key: REG_KEY } });
  if (!row?.value) return {};
  try {
    return JSON.parse(row.value) as RegMap;
  } catch {
    return {};
  }
}

async function writeMap(map: RegMap) {
  await db.setting.upsert({
    where: { key: REG_KEY },
    update: { value: JSON.stringify(map) },
    create: { key: REG_KEY, value: JSON.stringify(map) },
  });
}

// จำกลุ่ม (เรียกทุกข้อความกลุ่ม) — เขียนเฉพาะตอนชื่อเปลี่ยน/ยังไม่เคยเห็น กันเขียน DB ถี่
export async function rememberGroup(chatId: string, title: string): Promise<void> {
  const id = String(chatId);
  const name = (title || "").trim();
  if (!id || !name) return;
  const map = await readMap();
  if (map[id]?.title === name) return;
  map[id] = { title: name, at: new Date().toISOString() };
  await writeMap(map);
}

export async function listGroups(): Promise<GroupInfo[]> {
  const map = await readMap();
  return Object.entries(map).map(([chatId, v]) => ({ chatId, title: v.title, at: v.at }));
}

// ตัดคำสั่ง/คำเชื่อมออกก่อน แล้วหา "ชื่อกลุ่ม" ที่ผู้ใช้อ้างถึงในข้อความ
// คืนกลุ่มที่ชื่อ (หรือคำในชื่อ) ปรากฏในข้อความ — รองรับหลายกลุ่มชื่อคล้ายกัน (เช่น EasySlip 2 กลุ่ม)
export async function resolveGroups(text: string): Promise<GroupInfo[]> {
  const groups = await listGroups();
  if (!groups.length) return [];
  const t = text.toLowerCase();
  const matches = groups.filter((g) => {
    const title = g.title.toLowerCase();
    if (t.includes(title)) return true;
    // จับด้วย "คำหลัก" ในชื่อกลุ่ม (คำที่ยาว >=3 เช่น easyslip/thunder/support) เผื่อผู้ใช้พิมพ์แค่บางส่วน
    const tokens = title.split(/[\s•·\-_/|,()]+/).filter((w) => w.length >= 3);
    return tokens.some((w) => t.includes(w));
  });
  // ตัดซ้ำตาม chatId
  const seen = new Set<string>();
  return matches.filter((g) => !seen.has(g.chatId) && seen.add(g.chatId));
}
