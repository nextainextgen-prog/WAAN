// ===== Thunder — งานรายงานแชทประจำวัน (in-process, ไม่พึ่ง HTTP สำหรับงานยาว) =====
// เดิมเรียก /api/thunder/daily-report ผ่าน fetch → งานวิเคราะห์ ~16 นาที ชน undici timeout 5 นาที = "fetch failed"
// เวอร์ชันนี้รัน analyze + report ใน process เดียวผ่าน tsx → ไม่มี timeout
// รัน: npx tsx --tsconfig tsconfig.json scripts/thunder-daily.ts [YYYY-MM-DD]
//      THUNDER_SKIP_READ=1 ...  ข้ามการไล่อ่าน
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { bizDateOf, prevBizDate } from "@/lib/thunder";
import { analyzePhase, generateAndSaveDailyReport, purgeOldChatLogs } from "@/lib/chat-report";
import { isMuted } from "@/lib/mute";
import { db } from "@/lib/db";

const ROOT = process.cwd();
for (const l of (() => { try { return fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n"); } catch { return []; } })()) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const INTERNAL = process.env.INTERNAL_API_TOKEN || "";
const APP_URL = process.env.CHANGOH_WEB_URL || "http://localhost:3000";
const API = (m: string) => `https://api.telegram.org/bot${TOKEN}/${m}`;
const argDate = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2]) ? process.argv[2] : null;
const stamp = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function run(args: string[], label: string): Promise<number> {
  return new Promise((resolve) => {
    console.log(stamp(), label);
    const c = spawn(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
    c.on("close", (code) => resolve(code ?? -1));
    c.on("error", () => resolve(-1));
  });
}

// แท็กที่จะใส่ต้นรายงานทุกครั้ง: พี่หนิง (manager_signer) + เจ้าของ (telegram_chat_id)
// ใช้ tg://user?id= = แท็กได้แม้ไม่มี username (ต้องเป็นสมาชิกกลุ่มถึงจะเด้งเตือน)
async function buildTagLine(): Promise<string> {
  const tags: string[] = [];
  const seen = new Set<string>();
  const add = (id?: string | null, name?: string | null) => {
    const uid = String(id || "").trim();
    if (!uid || seen.has(uid)) return;
    seen.add(uid);
    tags.push(`<a href="tg://user?id=${uid}">${(name || "").trim() || "ทีม"}</a>`);
  };
  try {
    const m = await db.setting.findUnique({ where: { key: "manager_signer" } });
    if (m?.value) { const j = JSON.parse(m.value); add(j.id, j.name || "พี่หนิง"); }
  } catch { /* ข้าม */ }
  try {
    const o = await db.setting.findUnique({ where: { key: "telegram_chat_id" } });
    add(o?.value, "พี่โด้");
  } catch { /* ข้าม */ }
  return tags.length ? `${tags.join(" ")} รายงานแชทเมื่อวานมาแล้วค่ะ 👇\n\n` : "";
}

async function reportTarget(): Promise<{ chatId: string; threadId?: string } | null> {
  const row = await db.setting.findUnique({ where: { key: "chat_report_target" } }).catch(() => null);
  if (row?.value) {
    try { const t = JSON.parse(row.value); if (t?.chatId) return { chatId: String(t.chatId), threadId: t.threadId ? String(t.threadId) : undefined }; } catch { /* ข้าม */ }
  }
  return null;
}

async function main() {
  const bizDate = argDate || prevBizDate(bizDateOf());
  console.log(stamp(), `=== รายงานแชทประจำวัน ${bizDate} ===`);

  // ห้องรายงานสั่งปิดไว้ = ปิดงานทั้งสาย — ไม่อ่าน ไม่วิเคราะห์ ไม่เก็บ ไม่ส่ง (เช็คก่อนเริ่มงานหนักทุกอย่าง)
  // เปิดกลับด้วยการพิมพ์ "เปิดแจ้งเตือน" ในห้องนั้น — มีผลรอบถัดไปทันที ไม่ต้องแก้โค้ด/รีสตาร์ท
  {
    const t = await reportTarget();
    if (t?.chatId && (await isMuted(String(t.chatId)))) {
      console.log(stamp(), `ห้องรายงาน ${t.chatId} ปิดอยู่ — ข้ามงานทั้งหมดรอบนี้ (ไม่อ่าน/ไม่วิเคราะห์/ไม่ส่ง)`);
      return;
    }
  }

  // 1) ไล่อ่านแชท (ยังใช้ .mjs เดิม — โพสต์ทีละห้อง เร็ว ไม่ชน timeout)
  if (process.env.THUNDER_SKIP_READ !== "1") {
    await run(["scripts/thunder-chat-read.mjs", "24"], "ขั้นที่ 1: ไล่อ่านแชท OHO ย้อนหลัง 24 ชม.");
  }

  // 2) วิเคราะห์ + คัดเคสเด่น (in-process — ไม่มี timeout)
  console.log(stamp(), "ขั้นที่ 2: วิเคราะห์บทสนทนา + คัดเคสเด่น");
  const { analyzed, highlights } = await analyzePhase(bizDate);
  console.log(stamp(), `วิเคราะห์ ${analyzed} เคส · เคสเด่น ${highlights.length} เคส`);

  // 3) แคปหน้าจอเคสเด่น
  const ids = highlights.map((h) => h.convId);
  if (ids.length) await run(["scripts/thunder-shots.mjs", ...ids], `ขั้นที่ 3: แคปหน้าจอ ${ids.length} เคสเด่น`);

  // 4) สร้างรายงาน (in-process — Claude เรียบเรียง, ไม่มี timeout)
  console.log(stamp(), "ขั้นที่ 4: สร้างรายงาน (Claude เรียบเรียง)");
  const { messages, markdown, html, chatCount } = await generateAndSaveDailyReport(bizDate);
  const purged = await purgeOldChatLogs(90);
  console.log(stamp(), `วันธุรกิจ ${bizDate} · ${chatCount} เคส · ลบแชทเก่า ${purged} รายการ`);

  if (!chatCount) { console.log(stamp(), "ไม่มีบทสนทนา — ไม่ส่งรายงาน"); return; }
  const target = await reportTarget();
  if (!TOKEN || !target?.chatId) { console.log(stamp(), "ยังไม่ได้ผูกห้องรายงาน (พิมพ์ 'วานตั้งห้องนี้เป็นห้องรายงานแชท')"); return; }

  // กันชนซ้ำ: เผื่อมีคำสั่งปิดเข้ามาระหว่างที่รอบนี้กำลังวิเคราะห์อยู่ (งานกินเวลาหลายนาที)
  if (await isMuted(String(target.chatId))) {
    console.log(stamp(), `ห้องรายงาน ${target.chatId} ถูกปิดระหว่างทาง — ไม่ส่งเข้ากลุ่ม`);
    return;
  }

  // 5) ส่ง — ทีละข้อความ + 2 ไฟล์ · รองรับกลุ่มอัปเกรดเป็น supergroup (id เปลี่ยน)
  let chatId = String(target.chatId);
  const threadId = target.threadId;
  const mkBase = () => ({ chat_id: chatId, ...(threadId ? { message_thread_id: threadId } : {}) });

  async function migrateIfNeeded(res: { parameters?: { migrate_to_chat_id?: number } } | null): Promise<boolean> {
    const newId = res?.parameters?.migrate_to_chat_id;
    if (!newId) return false;
    console.log(stamp(), `กลุ่มอัปเกรดเป็น supergroup — ย้าย ${chatId} → ${newId}`);
    chatId = String(newId);
    await fetch(`${APP_URL}/api/thunder/report-target`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify({ chatId, threadId: threadId || null }),
    }).catch(() => {});
    return true;
  }

  const tagLine = await buildTagLine();
  for (const [i, text] of messages.entries()) {
    const body = i === 0 ? tagLine + text : text; // แท็กพี่หนิง+พี่โด้ ที่ข้อความแรก
    const send = () => fetch(API("sendMessage"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...mkBase(), text: body, parse_mode: "HTML", disable_web_page_preview: true }),
    }).then((x) => x.json()).catch(() => null);
    let r = await send();
    if (!r?.ok && (await migrateIfNeeded(r))) r = await send();
    if (!r?.ok) console.error(stamp(), `ส่งข้อความ ${i + 1} ไม่สำเร็จ:`, r?.description);
    await sleep(700);
  }

  for (const f of [
    { name: `chat-report-${bizDate}.html`, body: html, cap: `🖼 รายงานฉบับเต็ม ${bizDate} · ${chatCount} เคส — เปิดในเบราว์เซอร์เพื่อดูภาพหน้าจอแชท` },
    { name: `chat-report-${bizDate}.md`, body: markdown, cap: `📝 ฉบับตัวหนังสือ (มีลิงก์เปิดแชททุกเคส)` },
  ]) {
    if (!f.body) continue;
    const form = new FormData();
    form.append("chat_id", chatId);
    if (threadId) form.append("message_thread_id", threadId);
    form.append("caption", f.cap);
    form.append("document", new Blob([new TextEncoder().encode(f.body)]), f.name);
    const r = await fetch(API("sendDocument"), { method: "POST", body: form }).then((x) => x.json()).catch(() => null);
    if (!r?.ok) console.error(stamp(), `ส่ง ${f.name} ไม่สำเร็จ:`, r?.description);
    await sleep(800);
  }

  console.log(stamp(), `ส่งรายงานเรียบร้อย (${messages.length} ข้อความ + ไฟล์ html/md)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(stamp(), "ผิดพลาด:", e?.message || e); process.exit(1); });
