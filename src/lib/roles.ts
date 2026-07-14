import { db } from "./db";
import type { BrainModel } from "./brain";

/**
 * บทบาทของแต่ละ "ห้อง (topic)" ในกลุ่ม waan-agent team
 * 1 topic = 1 agent ที่มีบทบาทเดียว routing ด้วย message_thread_id
 */
export type RoleId = "lead" | "po" | "pm" | "research" | "monitor" | "chat";

export interface RoleProfile {
  id: RoleId;
  label: string;
  emoji: string;
  engine: BrainModel; // สมองที่ใช้ (hermes = agent gpt-5.5, ...)
  web: boolean; // ต้องค้นเว็บได้ไหม
  systemPrompt: string; // บริบทเฉพาะบทบาท (เติมท้าย persona หลัก)
}

export const ROLES: Record<RoleId, RoleProfile> = {
  lead: {
    id: "lead",
    label: "Lead",
    emoji: "💬",
    engine: "hermes",
    web: false,
    systemPrompt: `บทบาทห้องนี้ = "Lead" (ทิศทางรวม): รับคำสั่ง/เป้าหมายจากเจ้าของ ตัดสินใจทิศทาง มอบงานต่อให้ห้องอื่น (PO/PM/Research) น้ำเสียงอบอุ่นเป็นคนจริง ไม่ใช่ template แข็งๆ
- เวลามีทางเลือกให้เจ้าของตัดสิน ห้ามพิมพ์ตัวเลือกเป็นข้อความให้พิมพ์ตอบ ให้ปิดท้ายข้อความด้วยบรรทัดเดียวรูปแบบ:  ปุ่ม: ตัวเลือกที่1 | ตัวเลือกที่2 | ตัวเลือกที่3   (ระบบจะเปลี่ยนเป็นปุ่มจริงให้กด แล้วรอคำตอบ)
- เวลาจะส่งงานต่อไปห้องอื่น ให้ปิดท้ายด้วยบรรทัด:  ส่งต่อ: <po|pm|research> :: ข้อความ/โจทย์ที่ส่งให้`,
  },
  po: {
    id: "po",
    label: "PO (Product Owner)",
    emoji: "📝",
    engine: "hermes",
    web: false,
    systemPrompt: `บทบาทห้องนี้ = "PO (Product Owner)" — ตอบว่า "จะทำอะไร / ทำไม": นิยาม requirement, แตกเป็น backlog, จัดลำดับความสำคัญ (priority), เขียน acceptance criteria ให้ชัดเจน สรุปเป็นข้อๆ กระชับ
- เวลาจะส่งงานต่อ ให้ปิดท้ายด้วยบรรทัด:  ส่งต่อ: <lead|pm|research> :: ข้อความที่ส่งให้`,
  },
  pm: {
    id: "pm",
    label: "PM (Project Manager)",
    emoji: "💡",
    engine: "hermes",
    web: false,
    systemPrompt: `บทบาทห้องนี้ = "PM (Project Manager)" — ตอบว่า "ใคร / เมื่อไหร่ / ติดอะไร": แตกงานเป็น task ย่อยที่ไม่ทับกัน, มอบหมายผู้รับผิดชอบ (แท็ก @), ติดตามสถานะ, รายงานว่าใครทำอะไรถึงไหน ติดอะไร
- จัดการ task board ได้: สร้าง/อัปเดต/ปิด task และสรุปสถานะทีมให้เจ้าของ
- เวลาจะส่งงานต่อ ให้ปิดท้ายด้วยบรรทัด:  ส่งต่อ: <lead|po|research> :: ข้อความที่ส่งให้`,
  },
  research: {
    id: "research",
    label: "Research",
    emoji: "🔎",
    engine: "hermes",
    web: true,
    systemPrompt: `บทบาทห้องนี้ = "Research": หาข้อมูลให้ทีม เช็กความจำ/คลังความรู้ก่อน ถ้าไม่มีค่อยค้นเว็บจริงด้วย WebSearch/WebFetch แล้ววิเคราะห์เรียบเรียงมาให้ ห้ามเดา อ้างอิงแหล่งที่มาเสมอ ถ้าข้อมูลไม่พอให้บอกตรงๆ
- เวลาจะส่งผลกลับ ให้ปิดท้ายด้วยบรรทัด:  ส่งต่อ: <lead|po|pm> :: สรุปผลที่ส่งให้`,
  },
  monitor: {
    id: "monitor",
    label: "monitor",
    emoji: "📊",
    engine: "hermes",
    web: false,
    systemPrompt: `บทบาทห้องนี้ = "monitor": รายงานการใช้งาน (Usage Monitor) ของทุกบัญชี Claude/Codex ว่าใช้ token ไปเท่าไร เหลือเท่าไร และเตือนเมื่อใกล้เต็ม ตอบเฉพาะเรื่อง usage/limit`,
  },
  chat: {
    id: "chat",
    label: "แชททั่วไป",
    emoji: "💬",
    engine: "hermes",
    web: true,
    systemPrompt: "",
  },
};

const ROLE_KEYS: RoleId[] = ["lead", "po", "pm", "research", "monitor", "chat"];

export function isRoleId(v: string): v is RoleId {
  return (ROLE_KEYS as string[]).includes(v);
}

// เดา role จากชื่อ topic (ตอน owner สร้าง/ตั้งชื่อห้อง)
export function roleFromTopicName(name: string): RoleId | null {
  const t = (name || "").toLowerCase();
  if (/\blead\b|ทิศทาง|หัวหน้า/.test(t)) return "lead";
  if (/\bpo\b|product owner|requirement|backlog/.test(t)) return "po";
  if (/\bpm\b|project manager|มอบหมาย|ติดตาม/.test(t)) return "pm";
  if (/research|วิจัย|หาข้อมูล|ค้นคว้า/.test(t)) return "research";
  if (/monitor|usage|มอนิเตอร์|การใช้งาน/.test(t)) return "monitor";
  return null;
}

// ===== หน้าที่ของ "ทั้งกลุ่ม" (group function) — แต่ละกลุ่มทำงานไม่เหมือนกัน =====
export type GroupFunc = "aff" | "cs" | "agent" | "secretary" | "thunder_expiry";

export interface GroupFuncProfile {
  id: GroupFunc;
  label: string;
  emoji: string;
  desc: string; // เติมเข้า context ให้วานรู้ว่ากลุ่มนี้ทำหน้าที่อะไร
}

export const GROUP_FUNCS: Record<GroupFunc, GroupFuncProfile> = {
  aff: {
    id: "aff",
    label: "ตรวจเอกสาร AFF",
    emoji: "🔎",
    desc: "กลุ่มนี้ทำหน้าที่ตรวจเอกสารถอนเงิน Affiliate: เมื่อแอดมินส่ง/แท็กพร้อมไฟล์เอกสาร ให้ตรวจเทียบให้ตามปกติ เสร็จแล้ว reply ข้อความแอดมินคนนั้นว่าเอกสารถูกต้องหรือไม่ พร้อมแท็กคนที่เจ้าของกำหนด",
  },
  cs: {
    id: "cs",
    label: "ตอบลูกค้า / CS",
    emoji: "💬",
    desc: "กลุ่มนี้ทำหน้าที่ช่วยงาน CS/ตอบลูกค้า: ช่วยร่าง/เรียบเรียงข้อความตอบลูกค้า (แทนตัวว่า 'แอดมิน' เรียกลูกค้าว่า 'คุณลูกค้า')",
  },
  agent: {
    id: "agent",
    label: "ทีม Agent",
    emoji: "👥",
    desc: "กลุ่มนี้เป็นทีม agent หลายห้อง (topic): Lead/PO/PM/Research/monitor แต่ละห้องมีบทบาทของตัวเอง",
  },
  secretary: {
    id: "secretary",
    label: "เลขาทั่วไป",
    emoji: "📋",
    desc: "กลุ่มนี้ใช้คุย/สั่งงานเลขาทั่วไป: ถามข้อมูล ทำเอกสาร ทำสไลด์ หาข้อมูล งานรูทีน",
  },
  thunder_expiry: {
    id: "thunder_expiry",
    label: "ขยายวันหมดอายุ Thunder",
    emoji: "📅",
    desc: "กลุ่มนี้ทำหน้าที่เดียว: ปรับ 'วันที่บอทหมดอายุ' ในระบบหลังบ้าน Thunder (old.thunder.in.th/admin/service) เมื่อแอดมินพิมพ์ username มา ให้ค้นหา username นั้น เลือกเฉพาะแถว 'สาขาหลัก' ที่ username ตรงเป๊ะ แสดงพรีวิว+ปุ่มยืนยัน เมื่อยืนยันจึงตั้งวันหมดอายุเป็นวัน/เวลาปัจจุบันแล้วบันทึก ห้ามเปิด/ค้นเว็บอื่นเด็ดขาด",
  },
};

export function isGroupFunc(v: string): v is GroupFunc {
  return ["aff", "cs", "agent", "secretary", "thunder_expiry"].includes(v);
}

const FUNC_KEY = "group_functions";

export async function setGroupFunc(chatId: string, fn: GroupFunc) {
  const row = await db.setting.findUnique({ where: { key: FUNC_KEY } });
  const map: Record<string, GroupFunc> = row?.value ? JSON.parse(row.value) : {};
  map[chatId] = fn;
  await db.setting.upsert({
    where: { key: FUNC_KEY },
    update: { value: JSON.stringify(map) },
    create: { key: FUNC_KEY, value: JSON.stringify(map) },
  });
}

// รายชื่อ chatId ที่ตั้งหน้าที่ = fn (ไว้ให้บอทรู้ว่ากลุ่มไหน "dedicated" ประมวลผลทุกข้อความ)
export async function listGroupsWithFunc(fn: GroupFunc): Promise<string[]> {
  const row = await db.setting.findUnique({ where: { key: FUNC_KEY } });
  if (!row?.value) return [];
  try {
    const map = JSON.parse(row.value) as Record<string, GroupFunc>;
    return Object.entries(map).filter(([, v]) => v === fn).map(([k]) => k);
  } catch {
    return [];
  }
}

export async function getGroupFunc(chatId: string): Promise<GroupFuncProfile | null> {
  const row = await db.setting.findUnique({ where: { key: FUNC_KEY } });
  if (!row?.value) return null;
  try {
    const map = JSON.parse(row.value) as Record<string, GroupFunc>;
    const fn = map[chatId];
    return fn && GROUP_FUNCS[fn] ? GROUP_FUNCS[fn] : null;
  } catch {
    return null;
  }
}

// ===== คนที่ต้องแท็กเมื่อตรวจเอกสาร AFF เสร็จ (ต่อกลุ่ม) =====
export interface TagPerson {
  id?: string;
  name?: string;
  username?: string;
}
const AFF_TAG_KEY = "aff_tag_targets";

export async function setAffTag(chatId: string, person: TagPerson) {
  const row = await db.setting.findUnique({ where: { key: AFF_TAG_KEY } });
  const map: Record<string, TagPerson> = row?.value ? JSON.parse(row.value) : {};
  map[chatId] = person;
  await db.setting.upsert({
    where: { key: AFF_TAG_KEY },
    update: { value: JSON.stringify(map) },
    create: { key: AFF_TAG_KEY, value: JSON.stringify(map) },
  });
}

export async function getAffTag(chatId: string): Promise<TagPerson | null> {
  const row = await db.setting.findUnique({ where: { key: AFF_TAG_KEY } });
  if (!row?.value) return null;
  try {
    return (JSON.parse(row.value) as Record<string, TagPerson>)[chatId] || null;
  } catch {
    return null;
  }
}

// tag แบบทั่วไป (global) — ตั้งจากห้อง Lead ได้ ใช้กับทุกกลุ่ม AFF ที่ไม่ได้ตั้งเฉพาะ
const AFF_TAG_GLOBAL_KEY = "aff_tag_global";
export async function setAffTagGlobal(person: TagPerson) {
  await db.setting.upsert({
    where: { key: AFF_TAG_GLOBAL_KEY },
    update: { value: JSON.stringify(person) },
    create: { key: AFF_TAG_GLOBAL_KEY, value: JSON.stringify(person) },
  });
}
export async function getAffTagGlobal(): Promise<TagPerson | null> {
  const row = await db.setting.findUnique({ where: { key: AFF_TAG_GLOBAL_KEY } });
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as TagPerson;
  } catch {
    return null;
  }
}
// ใช้ตอนตรวจ AFF: per-group ก่อน ไม่มีค่อย global
export async function resolveAffTag(chatId: string): Promise<TagPerson | null> {
  return (await getAffTag(chatId)) || (await getAffTagGlobal());
}

// ===== กลุ่มเป้าหมายสำหรับ "มอนิเตอร์แชท OHO" (เตือนแชทค้าง + แท็กเวร) — ตั้งผ่านปุ่มห้อง Lead =====
const OHO_ALERT_KEY = "oho_alert_chat";
export async function setOhoAlertChat(chatId: string) {
  await db.setting.upsert({
    where: { key: OHO_ALERT_KEY },
    update: { value: chatId },
    create: { key: OHO_ALERT_KEY, value: chatId },
  });
}
export async function getOhoAlertChat(): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key: OHO_ALERT_KEY } });
  return row?.value || null;
}

// ===== ที่เก็บ mapping topic -> role (ใน Setting table เป็น JSON) =====
const STORE_KEY = "topic_roles";

async function loadMap(): Promise<Record<string, RoleId>> {
  const row = await db.setting.findUnique({ where: { key: STORE_KEY } });
  if (!row?.value) return {};
  try {
    return JSON.parse(row.value) as Record<string, RoleId>;
  } catch {
    return {};
  }
}

async function saveMap(map: Record<string, RoleId>) {
  await db.setting.upsert({
    where: { key: STORE_KEY },
    update: { value: JSON.stringify(map) },
    create: { key: STORE_KEY, value: JSON.stringify(map) },
  });
}

function keyOf(chatId: string, threadId?: string | number | null): string {
  return `${chatId}:${threadId ?? "0"}`;
}

export async function setTopicRole(chatId: string, threadId: string | number | null, role: RoleId) {
  const map = await loadMap();
  map[keyOf(chatId, threadId)] = role;
  await saveMap(map);
}

export async function getTopicRole(
  chatId: string,
  threadId?: string | number | null,
): Promise<RoleProfile | null> {
  const map = await loadMap();
  const id = map[keyOf(chatId, threadId)];
  return id && ROLES[id] ? ROLES[id] : null;
}

export async function listTopicRoles(chatId: string): Promise<{ threadId: string; role: RoleId }[]> {
  const map = await loadMap();
  const prefix = `${chatId}:`;
  return Object.entries(map)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, role]) => ({ threadId: k.slice(prefix.length), role }));
}

// หา thread ของ role ที่ต้องการในกลุ่มนี้ (ไว้ส่งงานข้ามห้อง)
export async function threadForRole(chatId: string, role: RoleId): Promise<string | null> {
  const map = await loadMap();
  const prefix = `${chatId}:`;
  for (const [k, r] of Object.entries(map)) {
    if (k.startsWith(prefix) && r === role) return k.slice(prefix.length);
  }
  return null;
}

// หา topic ของ role ทั่วทุกกลุ่ม (เช่น monitor) — คืน chatId + threadId แรกที่เจอ
export async function findRoleTopic(role: RoleId): Promise<{ chatId: string; threadId: string } | null> {
  const map = await loadMap();
  for (const [k, r] of Object.entries(map)) {
    if (r === role) {
      const [chatId, threadId] = k.split(":");
      return { chatId, threadId };
    }
  }
  return null;
}
