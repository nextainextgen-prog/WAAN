import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { getAllowedChatId, setAllowedChatId, getAllowedGroups, addAllowedGroup } from "@/lib/telegram";
import { isOwner, isAuthorized, grantMember, revokeMember, rememberMember, findMemberByName } from "@/lib/team";
import { askBrain } from "@/lib/brain";
import { saveChat } from "@/lib/secretary";
import { extractEvent, createEvent, getUpcoming, thaiDate } from "@/lib/calendar";
import { generateDeck } from "@/lib/deck-generate";
import { saveDeckFiles } from "@/lib/slide-store";
import { pageForQuestion, captureAppPage } from "@/lib/screenshot";
import { extractUrls, fetchUrlContent, saveLinkToBrain } from "@/lib/weblink";
import { previewExpiry, extractUsername } from "@/lib/thunder-expiry";
import {
  ROLES,
  isRoleId,
  roleFromTopicName,
  setTopicRole,
  getTopicRole,
  threadForRole,
  findRoleTopic,
  GROUP_FUNCS,
  getGroupFunc,
  setAffTag,
  setAffTagGlobal,
  type RoleId,
} from "@/lib/roles";

import { addTask, updateTask, listTasks, formatBoard, type TaskStatus } from "@/lib/tasks";
import { readUsage, formatMonitorCard } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 240;

interface Send {
  kind: "text" | "document" | "photo";
  text?: string;
  url?: string;
  filename?: string;
  caption?: string;
  dataBase64?: string;
  parseMode?: "HTML" | "Markdown";
  buttons?: (string | { text: string; data: string })[]; // ปุ่ม inline — string=ตัวเลือก Lead, {text,data}=callback ตรง (gfunc)
  threadId?: string; // ส่งเข้า topic ไหน (handoff ข้ามห้อง); ไม่ระบุ = ห้องเดิม
  chatId?: string; // ส่งไปแชท/กลุ่มอื่น (เช่น ไปห้อง Lead); ไม่ระบุ = แชทเดิม
  plain?: boolean; // ไม่ต้อง prepend แท็กผู้ถามในกลุ่ม (เช่น การ์ด usage/board)
}

// ปุ่มเลือกหน้าที่กลุ่ม โดยฝัง chatId ของกลุ่มเป้าหมายไว้ใน callback (กดจากห้อง Lead แล้วตั้งค่าให้กลุ่มนั้น)
function groupFuncButtons(targetChatId: string) {
  const funcs: { text: string; data: string }[] = (["aff", "cs", "agent", "secretary", "thunder_expiry"] as const).map((id) => ({
    text: `${GROUP_FUNCS[id].emoji} ${GROUP_FUNCS[id].label}`,
    data: `gfunc:${id}:${targetChatId}`,
  }));
  // ตัวเลือกพิเศษ: ตั้งกลุ่มนี้เป็นห้อง Usage Monitor (โพสต์การ์ดใช้งาน token อัตโนมัติ) — เป็น topic role ไม่ใช่ group func
  funcs.push({ text: `${ROLES.monitor.emoji} Usage Monitor`, data: `setrole:monitor:${targetChatId}` });
  // ตัวเลือกพิเศษ: ตั้งกลุ่มนี้เป็นห้อง "มอนิเตอร์แชท OHO" (เตือนแชทค้าง + แท็กแอดมินตามกะ)
  funcs.push({ text: `📟 มอนิเตอร์แชท (แท็กเวร)`, data: `ohomon:${targetChatId}` });
  return funcs;
}

// ผูกกลุ่มแล้ว: ตอบสั้นในกลุ่มนั้น + ส่งคำถามเลือกหน้าที่ (พร้อมปุ่ม) ไปที่ "ห้อง Lead" ให้เจ้าของกดตั้งค่าจากที่เดียว
async function bindGroupSends(groupChatId: string, groupThreadId: string, title: string): Promise<Send[]> {
  const sends: Send[] = [{ kind: "text", text: "รับทราบค่ะ✅", threadId: groupThreadId }];
  const name = title ? `"${title}"` : `กลุ่มนี้`;
  const lead = await findRoleTopic("lead");
  if (lead) {
    sends.push({
      kind: "text",
      chatId: lead.chatId,
      threadId: lead.threadId,
      text: `เชื่อมกลุ่ม ${name} แล้วค่ะ จะให้ทำหน้าที่อะไรดีคะ`,
      buttons: groupFuncButtons(groupChatId),
    });
  } else {
    // ยังไม่ได้ตั้งห้อง Lead → ถามในกลุ่มนี้ไปก่อน (ตอน bootstrap)
    sends.push({
      kind: "text",
      threadId: groupThreadId,
      text: `จะให้กลุ่มนี้ทำหน้าที่อะไรดีคะ`,
      buttons: groupFuncButtons(groupChatId),
    });
  }
  return sends;
}

// แยกบรรทัด "ปุ่ม: a | b | c" ออกจากคำตอบ → คืน options ให้ทำปุ่มจริง
function parseButtons(reply: string): { text: string; buttons?: string[] } {
  const m = reply.match(/^\s*(?:ปุ่ม|ตัวเลือก|options?|buttons?)\s*[:：]\s*(.+)$/im);
  if (!m) return { text: reply };
  const opts = m[1]
    .split(/\s*[|｜/]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
  if (opts.length < 2) return { text: reply };
  const text = reply.replace(m[0], "").trim();
  return { text, buttons: opts };
}

// แยกบรรทัด "ส่งต่อ: <role> :: ข้อความ" → รายการ handoff ข้ามห้อง
function parseHandoffs(reply: string): { text: string; handoffs: { role: RoleId; msg: string }[] } {
  const handoffs: { role: RoleId; msg: string }[] = [];
  const lines = reply.split("\n");
  const keep: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*(?:ส่งต่อ|handoff|forward)\s*[:：]\s*([a-z]+)\s*(?:::|→|->|:)\s*(.+)$/i);
    if (m && isRoleId(m[1].toLowerCase())) {
      handoffs.push({ role: m[1].toLowerCase() as RoleId, msg: m[2].trim() });
    } else {
      keep.push(line);
    }
  }
  return { text: keep.join("\n").trim(), handoffs };
}

function escHtml(s: string): string {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

// กลุ่มขยายวันหมดอายุ Thunder: สกัด username → พรีวิว (ค้นหา+แคปช่องวันหมดอายุปัจจุบัน) → ปุ่มยืนยันก่อนปรับจริง
// เงื่อนไข: username ตรงเป๊ะ + เฉพาะสาขาหลัก (ทำทุกสาขาหลัก) — ปลอดภัยจากการแตะ record ผิด
async function handleThunderExpiry(text: string, threadId: string, fromUsername: string, fromName: string): Promise<Send[]> {
  const thr = threadId || undefined;
  const tag = fromUsername ? `@${fromUsername} ` : fromName ? `${fromName} ` : "";
  const username = extractUsername(text);
  if (!username) {
    return [{ kind: "text", text: `${tag}พิมพ์ username ที่จะปรับวันหมดอายุมาได้เลยค่ะ เช่น "preechapanit101 ปรับวันหมดอายุให้หน่อย"`, threadId: thr }];
  }
  const pv = await previewExpiry(username);
  if (!pv.ok) {
    const msg =
      pv.error === "no_session" || pv.error === "session_expired"
        ? "ระบบหลังบ้าน Thunder ต้องล็อกอินใหม่ค่ะ (session หมดอายุ) รบกวนพี่โด้รัน `npm run thunder:auth` แล้วสั่งใหม่นะคะ"
        : pv.error === "not_found"
          ? `ไม่พบยูสเซอร์ "${username}" ในระบบหลังบ้านค่ะ ลองตรวจชื่ออีกครั้งนะคะ`
          : pv.error === "no_main_branch"
            ? `เจอ "${username}" แต่ไม่มีแถวที่เป็น "สาขาหลัก" ค่ะ (มี ${pv.otherCount} แถวที่เป็นสาขาย่อย/ชื่อไม่ตรง) ยังไม่ปรับให้นะคะ`
            : `ตรวจสอบระบบหลังบ้านไม่สำเร็จค่ะ (${pv.error || "unknown"})`;
    const sends: Send[] = [{ kind: "text", text: `${tag}${msg}`, threadId: thr }];
    if (pv.screenshotBase64) sends.push({ kind: "photo", dataBase64: pv.screenshotBase64, caption: "หน้าจอระบบหลังบ้าน", threadId: thr });
    return sends;
  }
  const now = new Date();
  const nowStr = now.toLocaleString("th-TH-u-ca-gregory", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const list = pv.mainRows
    .map((r, i) => `${i + 1}. ${r.shopName || "-"} (id ${r.serviceId || "-"}) · เดิม: ${r.currentExpiry || "-"}`)
    .join("\n");
  const caption =
    `${tag}📅 ยืนยันปรับวันหมดอายุ?\n` +
    `👤 ยูสเซอร์: ${username} · ${pv.mainRows.length} สาขาหลัก\n${list}\n` +
    `➡️ จะตั้งวันหมดอายุใหม่เป็น ${nowStr} (วัน/เวลาปัจจุบัน)` +
    (pv.otherCount ? `\n(ข้าม ${pv.otherCount} แถวสาขาย่อย/ชื่อไม่ตรง)` : "");
  const buttons = [
    { text: "✅ ยืนยันปรับ", data: `texp:ok:${username}`.slice(0, 64) },
    { text: "❌ ยกเลิก", data: "texp:cancel" },
  ];
  const sends: Send[] = [{ kind: "text", text: caption, threadId: thr, buttons }];
  if (pv.screenshotBase64) sends.push({ kind: "photo", dataBase64: pv.screenshotBase64, caption: `ช่องวันหมดอายุปัจจุบันของ ${username}`, threadId: thr });
  return sends;
}

// ===== แนบไฟล์ที่ agent (hermes) สร้างในเครื่อง แทนการพ่น path ให้ผู้ใช้ =====
// ปลอดภัย: แนบเฉพาะไฟล์ที่ "มีจริง" และอยู่ใน workspace ชั่วคราวของ agent (tmp / waan-hermes-cwd)
function isSafeAgentFile(p: string): boolean {
  try {
    const real = fs.realpathSync(p);
    if (!fs.statSync(real).isFile()) return false;
    const tmpReal = fs.realpathSync(os.tmpdir());
    return real.startsWith(tmpReal) || real.includes("waan-hermes-cwd");
  } catch {
    return false;
  }
}

// ดึง path ไฟล์ (ที่มีจริง+ปลอดภัย) ออกจากคำตอบ แล้วคืนข้อความที่ตัด path ทิ้งแล้ว + รายการไฟล์
function extractAgentFiles(reply: string): { text: string; files: string[] } {
  const files: string[] = [];
  const seen = new Set<string>();
  const cleaned = reply.replace(/[`"]?(\/[^\s`"'<>|]+)[`"]?/g, (full, raw) => {
    const p = String(raw).replace(/[.,;:)\]]+$/, ""); // ตัดเครื่องหมายวรรคตอนท้าย
    if (!/\.(pdf|docx?|pptx?|xlsx?|csv|txt|md|json|zip|png|jpe?g|gif|webp)$/i.test(p)) return full;
    if (!isSafeAgentFile(p)) return full;
    if (!seen.has(p)) {
      seen.add(p);
      files.push(p);
    }
    return ""; // ซ่อน path จากข้อความที่ผู้ใช้เห็น
  });
  // ถ้ามีไฟล์แนบจริง → ตัดประโยคขอโทษ/แจ้งตำแหน่งไฟล์ (LLM มักบอกว่า "แนบไฟล์ไม่ได้ เลยแจ้ง path") ทิ้ง
  let body = cleaned;
  if (files.length) {
    body = cleaned
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        if (/(แนบ|ส่ง|เปิด)ไฟล์.{0,20}(ไม่ได้|ไม่ได้จริง)/.test(t)) return false;
        if (/(แจ้ง|บอก).{0,8}(ตำแหน่ง|path|พาธ|ที่อยู่).{0,8}ไฟล์/.test(t)) return false;
        return true;
      })
      .join("\n");
  }
  const text = body
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, files };
}

const WELCOME = `สวัสดีค่ะ พร้อมช่วยงานแล้วค่ะ

สั่งงานผ่านแชทนี้ได้เลยนะคะ เช่น
- ถามข้อมูล/สรุปงาน
- ออกเอกสาร: ส่งรายละเอียด+ไฟล์แนบมาได้เลย
- สร้างสไลด์: "สร้างสไลด์ สรุปเดือนนี้"
- หาข้อมูล/ทำงานรูทีนต่างๆ`;

const SLIDE_FALLBACK = "สรุปสถานะทุนวิจัยและความคืบหน้า OKR ล่าสุด";
function isSlideCommand(text: string): string | null {
  // ขึ้นต้นด้วยคำสั่งสไลด์
  const m = text.match(/^\s*(?:\/slide|สร้างสไลด์|ทำสไลด์|ขอสไลด์|สไลด์|พรีเซนต์|นำเสนอ)\s*[:：]?\s*(.*)$/i);
  if (m) return m[1].trim() || SLIDE_FALLBACK;
  // มีคำว่า สไลด์/slide/พรีเซนต์/นำเสนอ + กริยาสั่งทำ อยู่ตรงไหนก็ได้ (เช่น "ช่วยทำสไลด์ Weekly", "จัดสไลด์ให้หน่อย")
  if (/(สไลด์|slide|พรีเซนต์|นำเสนอ|เด็ค|deck)/i.test(text) && /(ทำ|สร้าง|ขอ|ช่วย|จัด|ออกแบบ|generate)/i.test(text)) {
    return text.replace(/^\s*วาน[\s,:ๆจ]*/i, "").trim() || SLIDE_FALLBACK;
  }
  return null;
}

export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const chatId = String(body.chatId || "");
  const text = String(body.text || "").trim();
  const fromId = String(body.fromId || "");
  const isGroup = Boolean(body.isGroup);
  const threadId = String(body.threadId || ""); // topic id (forum) — ไว้ routing role + ตอบเข้าห้องเดิม
  const chatTitle = String(body.chatTitle || ""); // ชื่อกลุ่ม (ไว้อ้างถึงตอนรายงานเข้าห้อง Lead)
  const replyTo = body.replyTo as { id?: string; name?: string; username?: string } | undefined;
  const replyText = String(body.replyText || "").trim(); // ข้อความที่ผู้ใช้ reply อ้างถึง (บริบทต่อเนื่อง)
  const mentions = (body.mentions as { id?: string; name?: string; username?: string }[] | undefined) || [];
  const fromName = String(body.fromName || "").trim();       // ชื่อผู้ที่ส่งข้อความนี้ (ไม่ใช่เจ้าของเสมอไป)
  const fromUsername = String(body.fromUsername || "").trim();
  const imageFiles = (body.imageFiles as string[] | undefined) || []; // path รูปที่ผู้ใช้ส่งมา (ให้ AI อ่าน/วิเคราะห์)
  if (!chatId || !text) return NextResponse.json({ sends: [] });

  const owner = await getAllowedChatId();
  const ownerHere = await isOwner(fromId);

  // ผูกกลุ่ม: เจ้าของสั่ง = ผูกกลุ่มนั้น → ตอบสั้นในกลุ่ม แล้วไปถามหน้าที่ที่ห้อง Lead (คุมจากที่เดียว)
  if (isGroup && ownerHere && /แนะนำตัว|introduce|เริ่มงาน|พร้อมรับ|เชื่อมกลุ่ม/i.test(text)) {
    await addAllowedGroup(chatId);
    return NextResponse.json({ sends: await bindGroupSends(chatId, threadId, chatTitle) });
  }

  // ===== คำสั่งของเจ้าของ: อนุญาต/ยกเลิก/จดจำ ทีมงาน (reply ข้อความของคนนั้น หรือ แท็ก/mention ชื่อคนนั้น) =====
  const grantTarget = replyTo?.id ? replyTo : mentions.find((m) => m.id);
  if (ownerHere && grantTarget?.id) {
    // ชื่อจริงที่เขาใช้ใน Telegram (ใช้แท็ก) — ไม่ตั้งชื่อใหม่ให้เขา
    const realName = grantTarget.name || "สมาชิก";
    // ชื่อเล่นที่พี่โด้บอก เช่น "ชื่อเติ้ล" (ตัดสั้นถึงคำว่า "เป็น"/ช่องว่าง กันกินยาว) — ไว้เก็บ/เรียกในประโยค
    const nick = (text.match(/ชื่อ(?:เล่น)?\s*([ก-๙a-zA-Z]+?)(?=เป็น|\s|,|$)/)?.[1] || "").trim();
    const person = { id: String(grantTarget.id), name: nick || realName, username: grantTarget.username };
    if (/อนุญาต|ให้ตอบ|ให้ใช้|ใช้บอทได้|เป็นผู้ช่วย|ผู้ช่วยผม|เป็นแอดมิน|เพิ่ม.*ทีม|allow/i.test(text)) {
      await grantMember(person, { notes: `เจ้าของแนะนำให้เป็นผู้ช่วย/ทีมงาน${nick ? ` (ชื่อเล่น ${nick})` : ""}` });
      // แท็กด้วยชื่อจริงที่เขาใช้ (username ถ้ามี, ไม่งั้นชื่อ Telegram จริง) — ไม่ใช่ชื่อเล่นที่เพิ่งตั้ง
      const tag = person.username
        ? `@${person.username}`
        : `<a href="tg://user?id=${person.id}">${escHtml(realName)}</a>`;
      const greet = `สวัสดีค่ะ ${tag} ต่อไปนี้ ${tag} สั่งงานหรือถามอะไรได้เลยนะคะ ยินดีที่ได้รู้จักค่ะ`;
      return NextResponse.json({ sends: [{ kind: "text", text: greet, parseMode: "HTML" }] as Send[] });
    }
    if (/ห้าม|ยกเลิกสิทธิ์|ถอดสิทธิ์|revoke/i.test(text)) {
      await revokeMember(person.id);
      return NextResponse.json({ sends: [{ kind: "text", text: `ยกเลิกสิทธิ์ของ ${person.name} แล้วค่ะ` }] as Send[] });
    }
    if (/จำ|นี่คือ|แนะนำ|ตำแหน่ง|เป็น(คน|ทีม|ฝ่าย)|profile|ประวัติ/i.test(text)) {
      await rememberMember(person, { notes: text });
      return NextResponse.json({ sends: [{ kind: "text", text: `จำ ${person.name} (${nick || person.name}) ไว้แล้วค่ะ` }] as Send[] });
    }
  }

  if (isGroup) {
    // เจ้าของผูกกลุ่ม
    if (/^\s*(ผูกกลุ่ม|bind)/i.test(text)) {
      if (!ownerHere) return NextResponse.json({ sends: [{ kind: "text", text: "ขอโทษค่ะ ต้องให้เจ้าของเป็นคนผูกกลุ่มนะคะ" }] as Send[] });
      await addAllowedGroup(chatId);
      return NextResponse.json({ sends: await bindGroupSends(chatId, threadId, chatTitle) });
    }
    const groups = await getAllowedGroups();
    const groupOk = groups.includes(chatId) || ownerHere;
    if (!groupOk) return NextResponse.json({ sends: [] }); // กลุ่มยังไม่ผูก — เงียบ
    // ตอบเฉพาะเจ้าของ (และคนที่เจ้าของอนุญาตไว้) — คนอื่นเงียบสนิท ไม่ตอบ (เงื่อนไข 2/3)
    if (!(await isAuthorized(fromId))) {
      return NextResponse.json({ sends: [] });
    }
    // กลุ่ม "ขยายวันหมดอายุ Thunder" → จัดการเฉพาะทาง (ไม่ส่งเข้า agent ที่เปิดเว็บมั่ว)
    const gfEarly = await getGroupFunc(chatId);
    if (gfEarly?.id === "thunder_expiry") {
      return NextResponse.json({ sends: await handleThunderExpiry(text, threadId, fromUsername, fromName) });
    }
  } else {
    // แชทส่วนตัว
    if (!owner) {
      await setAllowedChatId(chatId);
      return NextResponse.json({ sends: [{ kind: "text", text: `เชื่อมต่อสำเร็จ (chat id: ${chatId})\n\n${WELCOME}` }] as Send[] });
    }
    if (!(await isAuthorized(fromId))) {
      return NextResponse.json({ sends: [{ kind: "text", text: "ขออภัย บอทนี้ผูกกับบัญชีอื่นแล้ว" }] as Send[] });
    }
  }

  // /start หรือทักทาย
  if (/^\/start$/i.test(text)) {
    return NextResponse.json({ sends: [{ kind: "text", text: WELCOME }] as Send[] });
  }

  // ===== ตั้งบทบาทของห้อง (topic) — เจ้าของเท่านั้น =====
  const roleCmd = text.match(/^\s*(?:ตั้งห้องนี้เป็น|ห้องนี้คือ|set\s*role|บทบาท)\s*[:：]?\s*([a-zA-Z]+)/i);
  if (isGroup && ownerHere && roleCmd) {
    const r = roleCmd[1].toLowerCase();
    if (isRoleId(r)) {
      await setTopicRole(chatId, threadId, r as RoleId);
      return NextResponse.json({ sends: [{ kind: "text", text: `ตั้งห้องนี้เป็น "${ROLES[r as RoleId].label}" แล้วค่ะ`, threadId }] as Send[] });
    }
    return NextResponse.json({ sends: [{ kind: "text", text: `บทบาทที่รองรับ: lead, po, pm, research, monitor, chat`, threadId }] as Send[] });
  }

  // ===== ตั้งคนที่จะแท็กเมื่อตรวจเอกสาร AFF เสร็จ — เจ้าของเท่านั้น =====
  if (isGroup && ownerHere && /ตรวจเสร็จ.*แท็ก|เวลาตรวจ.*แท็ก|แท็ก.*ตรวจเสร็จ|ให้แท็ก.*ตลอด/i.test(text)) {
    const mentioned = mentions.find((m) => m.username || m.id);
    const token = (text.match(/แท็ก\s*@?([ก-๙a-zA-Z0-9_.]+)/)?.[1] || "").trim();
    const target =
      (replyTo?.id ? { id: replyTo.id, name: replyTo.name, username: replyTo.username } : null) ||
      (mentioned ? { id: mentioned.id || undefined, name: mentioned.name, username: mentioned.username } : null) ||
      (token ? await findMemberByName(token) : null);
    if (target && (target.id || target.username)) {
      const person = { id: target.id || undefined, name: target.name, username: target.username };
      const fn = await getGroupFunc(chatId);
      const perGroup = fn?.id === "aff"; // ตั้งในกลุ่ม AFF = จำเฉพาะกลุ่มนั้น, ที่อื่น = ใช้ทุกกลุ่ม AFF
      if (perGroup) await setAffTag(chatId, person);
      else await setAffTagGlobal(person);
      const tag = person.username ? `@${person.username}` : person.name || "คนที่ระบุ";
      const where = perGroup ? "ในกลุ่มนี้" : "ในทุกกลุ่มตรวจ AFF";
      return NextResponse.json({ sends: [{ kind: "text", text: `รับทราบค่ะ✅ ตรวจเอกสาร AFF เสร็จเมื่อไหร่ จะแท็ก ${tag} ${where} ให้ทุกครั้งค่ะ`, threadId }] as Send[] });
    }
    return NextResponse.json({ sends: [{ kind: "text", text: "ขอชื่อคนที่จะแท็กแบบที่ระบบแท็กได้นะคะ — พิมพ์ @ แล้วเลือกชื่อจากรายการ (เช่น @Pop) หรือ reply ข้อความคนนั้นค่ะ", threadId }] as Send[] });
  }

  // ===== ดู Usage Monitor ทันที =====
  if (/^\s*(usage|monitor|สรุปการใช้งาน|การใช้งาน|ใช้ไปเท่าไห?ร่)\s*$/i.test(text)) {
    const nowMs = Date.now();
    const card = formatMonitorCard(readUsage(nowMs), new Date(nowMs).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }));
    return NextResponse.json({ sends: [{ kind: "text", text: card.text, threadId, plain: true }] as Send[] });
  }

  // ===== Task board (PM) =====
  const now = new Date().toISOString();
  if (/^\s*(?:บอร์ด|board|สรุปงาน|task\s*board|งานทั้งหมด)\s*$/i.test(text)) {
    const board = formatBoard(await listTasks());
    return NextResponse.json({ sends: [{ kind: "text", text: board, threadId }] as Send[] });
  }
  const addTaskCmd = text.match(/^\s*(?:\+task|เพิ่มงาน|เพิ่ม\s*task|ลงงาน)\s*[:：]?\s*(.+)$/i);
  if (addTaskCmd) {
    const t = await addTask({ title: addTaskCmd[1].trim(), now });
    return NextResponse.json({ sends: [{ kind: "text", text: `เพิ่มงาน ${t.id}: ${t.title} แล้วค่ะ`, threadId }] as Send[] });
  }
  const updTaskCmd = text.match(/^\s*(?:อัปเดต|update|ปิดงาน|เสร็จ)\s*(T\d+)\s*[:：]?\s*(.*)$/i);
  if (updTaskCmd) {
    const id = updTaskCmd[1];
    const rest = (updTaskCmd[2] || "").trim();
    const statusMap: Record<string, TaskStatus> = { รอเริ่ม: "todo", กำลังทำ: "doing", รอตรวจ: "review", เสร็จ: "done", ติด: "blocked", done: "done", doing: "doing", blocked: "blocked" };
    let status: TaskStatus | undefined;
    for (const k of Object.keys(statusMap)) if (new RegExp(k, "i").test(text)) { status = statusMap[k]; break; }
    const t = await updateTask(id, status ? { status } : { note: rest }, now);
    return NextResponse.json({ sends: [{ kind: "text", text: t ? `อัปเดต ${t.id} แล้วค่ะ (${t.status})` : `ไม่พบงาน ${id} ค่ะ`, threadId }] as Send[] });
  }

  // คำสั่งสร้างสไลด์
  const slideTopic = isSlideCommand(text);
  if (slideTopic) {
    try {
      const { deck, html, pdf } = await generateDeck(slideTopic);
      const meta = await saveDeckFiles(
        { title: deck.title, subtitle: deck.subtitle, slideCount: deck.slides.length },
        slideTopic,
        html,
        pdf,
      );
      const safe = deck.title.replace(/[^\p{L}\p{N}ก-๙\s_-]/gu, "").slice(0, 50) || "slides";
      return NextResponse.json({
        sends: [
          { kind: "text", text: `ทำสไลด์ "${deck.title}" (${deck.slides.length} สไลด์) ให้แล้วค่ะ ส่งทั้ง PDF และไฟล์เด็คที่เลื่อนดูได้ให้เลยนะคะ` },
          { kind: "document", url: `/api/slides/${meta.id}/pdf`, filename: `${safe}.pdf`, caption: deck.title },
          { kind: "document", url: `/api/slides/${meta.id}/html`, filename: `${safe}.html` },
        ] as Send[],
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ sends: [{ kind: "text", text: `สร้างสไลด์ไม่สำเร็จค่ะ: ${detail}` }] as Send[] });
    }
  }

  // ===== ปฏิทิน/ตารางงาน =====
  // ดูตารางที่จะถึง
  if (/(ดู|เช็ก|เช็ค|ขอดู|มีอะไร).{0,8}(ตาราง(งาน)?|ปฏิทิน|calendar|คิว|นัด)|(วันนี้|พรุ่งนี้|สัปดาห์นี้).{0,6}(มีอะไร|ทำอะไร|ต้องทำ)|ตารางงาน(วันนี้|พรุ่งนี้)?/i.test(text)) {
    const ups = await getUpcoming(chatId, 12);
    const reply = ups.length
      ? `ตารางงานที่จะถึงค่ะ\n${ups.map((e) => `• ${thaiDate(e.date)}${e.timeText ? ` ${e.timeText}` : ""} — ${e.title}${e.emoji ? ` ${e.emoji}` : ""}`).join("\n")}`
      : "ตอนนี้ยังไม่มีงานในปฏิทินเลยค่ะ ถ้าอยากให้ลงอะไรบอกได้เลยนะคะ";
    await saveChat("user", text);
    await saveChat("assistant", reply);
    return NextResponse.json({ sends: [{ kind: "text", text: reply }] as Send[] });
  }
  // ลงตารางงาน/ปฏิทิน
  if (/(ลง|ใส่|จด|บันทึก|เพิ่ม).{0,8}(ปฏิทิน|calendar|ตาราง(งาน)?|คิว|นัด(หมาย)?)|นัดหมาย|เตือน.{0,24}(ว่า|วันที่|พรุ่งนี้|มะรืน|วันนี้|จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์|สิ้นเดือน)/i.test(text)) {
    try {
      const parsed = await extractEvent(text);
      const ev = await createEvent({ chatId, parsed, createdById: fromId, creatorName: fromName || undefined });
      const when = `${thaiDate(ev.date)}${ev.timeText ? ` เวลา ${ev.timeText}` : ""}`;
      const em = ev.emoji ? ` ${ev.emoji}` : "";
      const reply = `ลง "${ev.title}" ${when} ให้เรียบร้อยแล้วค่ะ${em}\nถึงวันน้องวานจะแจ้งเตือนอีกทีนะคะ`;
      await saveChat("user", text);
      await saveChat("assistant", reply);
      return NextResponse.json({ sends: [{ kind: "text", text: reply }] as Send[] });
    } catch {
      /* แยกวัน/งานไม่ได้ → ตกไปคุยปกติให้ AI ถามรายละเอียดเพิ่ม */
    }
  }

  // แชทปกติ → สมอง AI
  await saveChat("user", text);
  try {
    const ctxParts: string[] = [];
    // ผู้ที่ถามในตอนนี้เป็น "ใคร" — ให้ตอบถึงคนนั้นโดยตรง ไม่ใช่เหมารวมว่าเป็นพี่โด้เสมอ
    const addressee = mentions.find((m) => m.name || m.username); // คนที่ผู้ส่ง "แท็ก/ระบุถึง" ในข้อความ
    if (addressee) {
      const an = addressee.name || addressee.username || "";
      const who = ownerHere ? "เจ้าของ" : fromName || "ผู้ใช้";
      ctxParts.push(
        `ข้อความนี้ "${who}" เป็นผู้ส่ง และได้แท็ก/ระบุถึง "${an}" — ผู้ส่งต้องการให้คุณ "พูด/ทักทาย/สื่อสารกับ ${an}" โดยตรง ` +
          `ให้ตอบโดยพูดกับ ${an} (เช่น ทักทาย ${an}) ไม่ใช่พูดกับผู้ส่ง ห้ามเรียกใครด้วยชื่อ/คำนำหน้า จะอ้างถึงใครให้แท็ก @ เท่านั้น` +
          `${isGroup ? ` (ระบบจะแท็ก ${an} ให้อัตโนมัติที่ต้นข้อความ ไม่ต้องพิมพ์ "@" หรือชื่อซ้ำตอนขึ้นต้นเอง)` : ""}`,
      );
    } else if (ownerHere) {
      ctxParts.push(`ผู้ที่ส่งข้อความนี้คือ "เจ้าของ" — ตอบได้ตามปกติแบบเป็นกันเอง ห้ามเรียกด้วยชื่อ/คำนำหน้า`);
    } else {
      const display = fromName || fromUsername || "สมาชิกทีม";
      ctxParts.push(
        `ผู้ที่ส่งข้อความนี้คือ "${display}"${fromUsername ? ` (@${fromUsername})` : ""} ซึ่ง "ไม่ใช่เจ้าของ" — ให้ตอบถึงคนนี้โดยตรง ` +
          `ห้ามเรียกใครด้วยชื่อ/คำนำหน้า จะอ้างถึง/เรียกใครให้แท็ก @ เท่านั้น` +
          `${isGroup ? ` (ระบบจะแท็กชื่อผู้ถามให้อัตโนมัติที่ต้นข้อความ คุณไม่ต้องพิมพ์ "@" หรือชื่อซ้ำตอนขึ้นต้นเอง ตอบเนื้อหาได้เลย)` : ""}`,
      );
    }
    // รูปที่ผู้ใช้ส่งมา → ให้ AI เปิดอ่านด้วยตา (vision) แล้ววิเคราะห์/ตอบ
    if (imageFiles.length) {
      ctxParts.push(
        `ผู้ใช้ส่ง "รูปภาพ" มาด้วย ${imageFiles.length} รูป — เปิดอ่านด้วยเครื่องมือ Read ทุกไฟล์ตาม path ด้านล่าง แล้ววิเคราะห์/อธิบายว่าคืออะไร และตอบคำถามจากเนื้อหาในรูปได้เลย (ห้ามบอกว่ายังไม่เห็นรูป):\n${imageFiles
          .map((p, i) => `${i + 1}. ${p}`)
          .join("\n")}`,
      );
    }
    // ถ้าผู้ใช้ reply ข้อความก่อนหน้า → แนบเป็นบริบทให้ตอบตรงเรื่องที่อ้างถึง
    if (replyText) {
      ctxParts.push(
        `ผู้ใช้กำลังตอบกลับ (reply) ข้อความนี้ ให้ตอบโดยอ้างอิงเนื้อหานี้เป็นหลัก อย่าเปลี่ยนไปเรื่องอื่น:\n"""\n${replyText.slice(0, 2000)}\n"""`,
      );
    }
    // ถ้ามีลิงก์ในข้อความ/ข้อความที่ reply → เปิดอ่านเนื้อหาจริง + เก็บลงสมอง (ถ้าสั่งบันทึก)
    const urls = [...extractUrls(text), ...extractUrls(replyText)].slice(0, 3);
    if (urls.length) {
      const saveIntent = /บันทึก|เก็บ|จำ|save|เซฟ|จดไว้|เก็บไว้|ลงสมอง|ลงความจำ/i.test(text);
      const dateStr = new Date().toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
      const fetched: string[] = [];
      for (const u of urls) {
        try {
          const c = await fetchUrlContent(u);
          if (saveIntent) await saveLinkToBrain(c, dateStr, text.slice(0, 200));
          fetched.push(`### ${c.title} (${c.url})\n${c.text.slice(0, 8000)}`);
        } catch (err) {
          fetched.push(`### ${u}\n(เปิดลิงก์ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)})`);
        }
      }
      ctxParts.push(
        `${saveIntent ? "ผู้ใช้ให้บันทึกลิงก์นี้ลงความจำ (อ่านและบันทึกลงสมองให้แล้ว) ให้ยืนยันสั้นๆ แล้วสรุปประเด็นสำคัญจากเนื้อหาให้ด้วย" : "เนื้อหาจากลิงก์ที่ผู้ใช้ส่ง (เปิดอ่านจริงให้แล้ว ใช้ตอบ/สรุปได้เลย)"}:\n${fetched.join("\n\n")}`,
      );
    }
    // หน้าที่ของกลุ่ม (group function) → วานรู้ว่าอยู่กลุ่มไหน ทำหน้าที่อะไร
    const gfunc = isGroup ? await getGroupFunc(chatId) : null;
    if (gfunc) ctxParts.push(`[หน้าที่ของกลุ่มนี้] ${gfunc.desc}`);
    if (gfunc?.id === "aff") {
      ctxParts.push(
        `[ข้อจำกัดกลุ่ม AFF — สำคัญที่สุด ห้ามฝ่าฝืน] กลุ่มนี้ทำเฉพาะ "ตรวจ/จัดทำเอกสาร Affiliate" เท่านั้น` +
          ` ห้ามเปิด/เข้า/ดูเว็บหรือหน้าแอดมินใดๆ เด็ดขาด (เช่น BoostSMS Admin, ระบบหลังบ้าน, หน้าผู้ใช้งาน ฯลฯ) และห้ามค้นเว็บ/เปิดเบราว์เซอร์.` +
          ` ข้อมูลระบบหลังบ้าน (ธนาคาร/เลขบัญชี/ยอด/สถานะ) ระบบจะดึงให้อัตโนมัติเฉพาะตอน "ตรวจเอกสาร" จากไฟล์ที่แนบเข้ามาเท่านั้น เธอห้ามไปเปิดดูเอง.\n` +
          `- ถ้าถูกขอให้ "ตรวจสอบใหม่/ตรวจซ้ำ" โดยไม่มีไฟล์แนบ: ให้ตอบอ้างอิง "ผลตรวจล่าสุด" ในประวัติสนทนา (บรรทัดที่ขึ้นต้น "[ผลตรวจเอกสาร Affiliate ที่เพิ่งทำ]") — ห้ามเปิดเว็บ. ถ้าต้องตรวจกับระบบใหม่จริง ให้ขอแอดมินส่งไฟล์เอกสาร (PDF) เข้ามาใหม่ แล้วระบบจะตรวจเทียบระบบหลังบ้านให้เอง.`,
      );
    }
    // บทบาทของห้อง (topic) → เติม system prompt เฉพาะบทบาท + เลือก engine ตาม role
    const role = isGroup && threadId ? await getTopicRole(chatId, threadId) : null;
    if (role?.systemPrompt) ctxParts.push(role.systemPrompt);
    // การจัดการไฟล์: ให้บอก path ของไฟล์ที่สร้าง (ระบบจะแนบไฟล์เข้าแชทให้เอง + ซ่อน path จากผู้ใช้)
    ctxParts.push(
      `[การส่งไฟล์] ถ้าเธอสร้างไฟล์ (PDF/เอกสาร/รูป/ฯลฯ) ให้พิมพ์ path เต็มของไฟล์นั้นไว้ในคำตอบด้วย ระบบจะแนบไฟล์จริงเข้าแชทให้อัตโนมัติและซ่อน path ออกจากข้อความเอง — ห้ามขอโทษว่าแนบไฟล์ไม่ได้ เพราะแนบได้ ให้บอกสั้นๆ ว่าทำไฟล์อะไรเสร็จแล้ว`,
    );
    const extraContext = ctxParts.length ? ctxParts.join("\n\n") : undefined;
    // self-repair: ลองสมองหลักก่อน ถ้าล่มสลับไปโหมด auto (codex→claude→gemini) อัตโนมัติ
    let rawReply: string;
    try {
      rawReply = (await askBrain(text, { extraContext, model: role?.engine })).reply;
    } catch {
      rawReply = (await askBrain(text, { extraContext, model: "auto" })).reply;
    }

    // แยกปุ่ม (Lead) และ handoff ข้ามห้อง ออกจากคำตอบ
    const ho = parseHandoffs(rawReply);
    const btn = parseButtons(ho.text);
    let reply = btn.text || ho.text || rawReply;
    // แนบไฟล์ที่ agent สร้างในเครื่อง (ถ้ามี) เป็นไฟล์จริง แล้วซ่อน path ออกจากข้อความ
    const af = extractAgentFiles(reply);
    reply = af.text;
    await saveChat("assistant", reply);
    const sends: Send[] = [];
    if (reply) sends.push({ kind: "text", text: reply, threadId: threadId || undefined, buttons: btn.buttons });
    for (const fp of af.files) {
      try {
        const b64 = fs.readFileSync(fp).toString("base64");
        const name = path.basename(fp);
        sends.push(
          /\.(png|jpe?g|gif|webp)$/i.test(name)
            ? { kind: "photo", dataBase64: b64, caption: name, threadId: threadId || undefined }
            : { kind: "document", dataBase64: b64, filename: name, threadId: threadId || undefined },
        );
      } catch {
        // อ่านไฟล์ไม่ได้ → ใส่ path กลับเป็นข้อความ (fallback กันข้อมูลหาย)
        if (sends.length === 0) sends.push({ kind: "text", text: `ไฟล์: ${fp}`, threadId: threadId || undefined });
      }
    }
    if (sends.length === 0) sends.push({ kind: "text", text: reply || "ทำเรียบร้อยแล้วค่ะ", threadId: threadId || undefined, buttons: btn.buttons });
    // ส่งงานต่อไปห้องอื่นตามที่ role สั่ง (ส่งต่อ: <role> :: ...)
    for (const h of ho.handoffs) {
      const target = await threadForRole(chatId, h.role);
      if (target) sends.push({ kind: "text", text: `[จาก ${role?.label || "วาน"}] ${h.msg}`, threadId: target });
    }
    // แคปหน้าเว็บแนบคำตอบ — ปิดไว้ก่อน (เปิดด้วย ENABLE_WEB_SCREENSHOT=1) เพราะเน้นตอบเรื่อง Thunder
    if (process.env.ENABLE_WEB_SCREENSHOT === "1") {
      const pick = pageForQuestion(text);
      if (pick) {
        try {
          const origin = new URL(req.url).origin;
          const png = await captureAppPage(origin, pick.path, { fullPage: pick.fullPage });
          sends.push({ kind: "photo", dataBase64: png.toString("base64"), caption: `${pick.label}ในระบบค่ะ` });
        } catch (err) {
          console.error("[ingest] screenshot failed:", err);
        }
      }
    }
    return NextResponse.json({ sends });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ sends: [{ kind: "text", text: `ขออภัย เชื่อมต่อสมอง AI ไม่ได้ (${detail})` }] as Send[] });
  }
}
