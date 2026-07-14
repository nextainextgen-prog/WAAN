import { db } from "./db";
import { getAllowedChatId } from "./telegram";

export interface PersonRef {
  id: string;
  name: string;
  username?: string;
}

export async function isOwner(userId: string): Promise<boolean> {
  const owner = await getAllowedChatId();
  return Boolean(owner && String(userId) === String(owner));
}

// อนุญาตให้ผู้ใช้ใช้บอทได้ (+ จดจำ)
export async function grantMember(p: PersonRef, extra?: { role?: string; notes?: string }) {
  await db.teamMember.upsert({
    where: { telegramUserId: p.id },
    update: {
      name: p.name,
      username: p.username || null,
      canUseBot: true,
      ...(extra?.role ? { role: extra.role } : {}),
      ...(extra?.notes ? { notes: extra.notes } : {}),
    },
    create: {
      telegramUserId: p.id,
      name: p.name,
      username: p.username || null,
      role: extra?.role || null,
      notes: extra?.notes || null,
      canUseBot: true,
    },
  });
}

// จดจำ/อัปเดตข้อมูลทีม (ไม่บังคับให้สิทธิ์)
export async function rememberMember(p: PersonRef, extra?: { role?: string; notes?: string }) {
  const cur = await db.teamMember.findUnique({ where: { telegramUserId: p.id } });
  const mergedNotes = extra?.notes
    ? cur?.notes
      ? `${cur.notes}\n${extra.notes}`
      : extra.notes
    : cur?.notes;
  await db.teamMember.upsert({
    where: { telegramUserId: p.id },
    update: { name: p.name, username: p.username || null, role: extra?.role ?? cur?.role, notes: mergedNotes ?? null },
    create: {
      telegramUserId: p.id,
      name: p.name,
      username: p.username || null,
      role: extra?.role || null,
      notes: extra?.notes || null,
      canUseBot: false,
    },
  });
}

export async function revokeMember(userId: string) {
  await db.teamMember.updateMany({ where: { telegramUserId: userId }, data: { canUseBot: false } });
}

export async function isAuthorized(userId: string): Promise<boolean> {
  if (await isOwner(userId)) return true;
  const m = await db.teamMember.findUnique({ where: { telegramUserId: userId } });
  return Boolean(m?.canUseBot);
}

export async function listMembers() {
  return db.teamMember.findMany({ orderBy: { createdAt: "asc" } });
}

// หาสมาชิกทีมจากชื่อ/ชื่อเล่น/username ที่พิมพ์ (ไว้ resolve คนที่จะแท็ก)
export async function findMemberByName(token: string): Promise<PersonRef | null> {
  const t = token.replace(/^@/, "").trim();
  if (t.length < 2) return null;
  const members = await db.teamMember.findMany();
  const norm = (s: string) => (s || "").replace(/^(พี่|น้อง|คุณ)\s*/, "").toLowerCase();
  const nt = norm(t);
  const hit =
    members.find((m) => (m.username || "").toLowerCase() === t.toLowerCase()) ||
    members.find((m) => norm(m.name) === nt) ||
    members.find((m) => nt.length >= 2 && (norm(m.name).includes(nt) || nt.includes(norm(m.name))));
  return hit ? { id: hit.telegramUserId, name: hit.name, username: hit.username || undefined } : null;
}

// ข้อความรายชื่อทีม สำหรับใส่ใน context ของน้องวาน
export async function teamRoster(): Promise<string> {
  const members = await listMembers();
  if (members.length === 0) return "";
  const lines = members.map(
    (m) =>
      `- ${m.name}${m.username ? ` (@${m.username})` : ""}${m.role ? ` — ${m.role}` : ""}${m.canUseBot ? " [ใช้บอทได้]" : ""}${m.notes ? ` · ${m.notes.replace(/\n/g, " ")}` : ""}`,
  );
  return `=== ทีมงานที่รู้จัก (แท็กด้วย @username ได้) ===\n${lines.join("\n")}`;
}
