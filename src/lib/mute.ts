import { db } from "@/lib/db";

// ทะเบียนปิดแจ้งเตือน 2 ระดับ (เก็บใน Setting คนละ key):
//   muted_groups — ปิดทั้งกลุ่ม (chatId) เช่น สรุปประจำวัน/ทั้งซูเปอร์กรุ๊ป
//   muted_brands — ปิดราย "แบรนด์" (thunder/easyslip/easycrm/boostsms) = สตรีมแจ้งลูกค้าค้างของ watcher
// ปิดแล้วเงียบจนสั่งเปิด หรือถึงกำหนด until แล้วเปิดเอง (prune ตอนอ่าน)
const GROUP_KEY = "muted_groups";
const BRAND_KEY = "muted_brands";

export interface MutedEntry {
  since: string; // ISO — ปิดเมื่อไหร่
  byName: string; // ใครสั่งปิด
  title: string; // ชื่อกลุ่ม/แบรนด์ (ไว้อ้างถึง)
  until?: string; // ISO — ปิดถึงเมื่อไหร่ (ไม่มี = ปิดจนสั่งเปิด)
}
export interface MutedGroup extends MutedEntry { chatId: string; }
export interface MutedBrand extends MutedEntry { brand: string; }

type MuteMap = Record<string, MutedEntry>;

async function readMap(key: string): Promise<MuteMap> {
  const row = await db.setting.findUnique({ where: { key } });
  if (!row?.value) return {};
  try {
    return JSON.parse(row.value) as MuteMap;
  } catch {
    return {};
  }
}

async function writeMap(key: string, map: MuteMap) {
  await db.setting.upsert({
    where: { key },
    update: { value: JSON.stringify(map) },
    create: { key, value: JSON.stringify(map) },
  });
}

// ตัดรายการที่ถึงกำหนด until แล้วออก (auto-เปิด) — คืน map สะอาด + id ที่หมดอายุ
function prune(map: MuteMap): { map: MuteMap; expired: string[] } {
  const now = Date.now();
  const expired = Object.entries(map)
    .filter(([, v]) => v.until && new Date(v.until).getTime() <= now)
    .map(([id]) => id);
  if (!expired.length) return { map, expired };
  const clean = { ...map };
  for (const id of expired) delete clean[id];
  return { map: clean, expired };
}

async function isKeyMuted(setKey: string, id: string): Promise<boolean> {
  const { map, expired } = prune(await readMap(setKey));
  if (expired.length) await writeMap(setKey, map);
  return Boolean(map[String(id)]);
}

// ปิด — คืน entry เดิมถ้าปิดอยู่แล้ว (อัปเดต until ถ้าส่งมาใหม่), null ถ้าเพิ่งปิด
async function muteKey(
  setKey: string,
  id: string,
  opts: { byName?: string; title?: string; until?: string } = {},
): Promise<MutedEntry | null> {
  const k = String(id);
  const { map } = prune(await readMap(setKey));
  const existing = map[k];
  if (existing) {
    if (opts.until !== undefined && opts.until !== existing.until) {
      map[k] = { ...existing, until: opts.until, title: opts.title || existing.title };
      await writeMap(setKey, map);
    }
    return existing;
  }
  map[k] = {
    since: new Date().toISOString(),
    byName: opts.byName || "",
    title: opts.title || "",
    ...(opts.until ? { until: opts.until } : {}),
  };
  await writeMap(setKey, map);
  return null;
}

async function unmuteKey(setKey: string, id: string): Promise<boolean> {
  const k = String(id);
  const map = await readMap(setKey);
  if (!map[k]) return false;
  delete map[k];
  await writeMap(setKey, map);
  return true;
}

async function listKeys(setKey: string): Promise<[string, MutedEntry][]> {
  const { map, expired } = prune(await readMap(setKey));
  if (expired.length) await writeMap(setKey, map);
  return Object.entries(map);
}

// ===== ระดับกลุ่ม (chatId) =====
export const isMuted = (chatId: string) => isKeyMuted(GROUP_KEY, chatId);
export const muteGroup = (chatId: string, opts: { byName?: string; title?: string; until?: string } = {}) =>
  muteKey(GROUP_KEY, chatId, opts).then((e) => (e ? { chatId: String(chatId), ...e } : null));
export const unmuteGroup = (chatId: string) => unmuteKey(GROUP_KEY, chatId);
export async function listMutedGroups(): Promise<MutedGroup[]> {
  return (await listKeys(GROUP_KEY)).map(([chatId, v]) => ({ chatId, ...v }));
}
export async function listMutedChatIds(): Promise<string[]> {
  return (await listKeys(GROUP_KEY)).map(([id]) => id);
}

// ===== ระดับแบรนด์ (thunder/easyslip/easycrm/boostsms) =====
export const isBrandMuted = (brand: string) => isKeyMuted(BRAND_KEY, brand);
export const muteBrand = (brand: string, opts: { byName?: string; title?: string; until?: string } = {}) =>
  muteKey(BRAND_KEY, brand, opts);
export const unmuteBrand = (brand: string) => unmuteKey(BRAND_KEY, brand);
export async function listMutedBrands(): Promise<MutedBrand[]> {
  return (await listKeys(BRAND_KEY)).map(([brand, v]) => ({ brand, ...v }));
}
export async function listMutedBrandKeys(): Promise<string[]> {
  return (await listKeys(BRAND_KEY)).map(([id]) => id);
}
