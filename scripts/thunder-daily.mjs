// ===== Thunder — งานรายงานแชทประจำวัน (รัน 06:00 ทุกเช้า) =====
// 1) ไล่อ่านแชททั้งวัน  2) วิเคราะห์ + คัดเคสเด่น  3) แคปหน้าจอเคสเด่น
// 4) สร้างรายงานเต็ม  5) ส่ง 4 ข้อความ + ไฟล์ .md เข้าห้องที่ผูกไว้
// รันเอง: npm run thunder:daily            (เมื่อวาน)
//         npm run thunder:daily -- 2026-07-20   (ระบุวัน)
//         THUNDER_SKIP_READ=1 ...              (ข้ามการไล่อ่าน ใช้ข้อมูลเดิม)
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
try {
  for (const l of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* ใช้ค่าที่ส่งมา */ }

const APP_URL = process.env.CHANGOH_WEB_URL || "http://localhost:3000";
const INTERNAL = process.env.INTERNAL_API_TOKEN || "";
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const API = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;
const bizArg = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2]) ? process.argv[2] : null;
const stamp = () => new Date().toISOString();

function run(args, label) {
  return new Promise((resolve) => {
    console.log(stamp(), label);
    const c = spawn(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
    c.on("close", (code) => resolve(code));
    c.on("error", () => resolve(-1));
  });
}
async function callApi(body, tries = 4) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${APP_URL}/api/thunder/daily-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => "")}`);
      return await res.json();
    } catch (e) {
      // web dev server สะดุด/รีคอมไพล์ชั่วคราว → รอแล้วลองใหม่ (งานวิเคราะห์ idempotent อยู่แล้ว)
      lastErr = e;
      console.error(stamp(), `เรียก API รอบ ${i + 1}/${tries} ไม่สำเร็จ (${e?.message || e}) — รอ 15 วิ แล้วลองใหม่`);
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
  throw lastErr;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(stamp(), "=== รายงานแชทประจำวัน", bizArg || "(เมื่อวาน)", "===");

  // 1) ไล่อ่านแชททั้งวัน
  if (process.env.THUNDER_SKIP_READ !== "1") {
    await run(["scripts/thunder-chat-read.mjs", "24"], "ขั้นที่ 1: ไล่อ่านแชท OHO ย้อนหลัง 24 ชม.");
  }

  // 2) วิเคราะห์ + คัดเคสเด่น
  console.log(stamp(), "ขั้นที่ 2: วิเคราะห์บทสนทนา + คัดเคสเด่น (ใช้เวลาสักครู่)");
  const a = await callApi({ ...(bizArg ? { bizDate: bizArg } : {}), phase: "analyze" });
  console.log(stamp(), `วิเคราะห์ ${a.analyzed} เคส · เคสเด่น ${a.highlights?.length || 0} เคส`);

  // 3) แคปหน้าจอเคสเด่น
  const ids = (a.highlights || []).map((h) => h.convId);
  if (ids.length) await run(["scripts/thunder-shots.mjs", ...ids], `ขั้นที่ 3: แคปหน้าจอ ${ids.length} เคสเด่น`);

  // 4) สร้างรายงานเต็ม
  console.log(stamp(), "ขั้นที่ 4: สร้างรายงาน (Claude เรียบเรียง)");
  const j = await callApi({ bizDate: a.bizDate, phase: "report" });
  console.log(stamp(), `วันธุรกิจ ${j.bizDate} · ${j.chatCount} เคส · ลบแชทเก่า ${j.purged} รายการ`);

  if (!j.chatCount) { console.log(stamp(), "ไม่มีบทสนทนา — ไม่ส่งรายงาน"); return; }
  if (!TOKEN || !j.target?.chatId) { console.log(stamp(), "ยังไม่ได้ผูกห้องรายงาน (พิมพ์ 'วานตั้งห้องนี้เป็นห้องรายงานแชท')"); return; }

  // 5) ส่งเข้ากลุ่ม — ทีละข้อความ เว้นจังหวะกัน Telegram rate limit
  let { chatId } = j.target;
  const { threadId } = j.target;
  const mkBase = () => ({ chat_id: String(chatId), ...(threadId ? { message_thread_id: String(threadId) } : {}) });
  const messages = Array.isArray(j.messages) ? j.messages : [];

  // กลุ่มธรรมดาถูกอัปเกรดเป็น supergroup → chat id เปลี่ยน Telegram ส่ง id ใหม่มาใน error
  // ต้องย้ายให้อัตโนมัติ ไม่งั้นรายงานเงียบหายทุกวันโดยไม่มีใครรู้
  async function migrateIfNeeded(res) {
    const newId = res?.parameters?.migrate_to_chat_id;
    if (!newId) return false;
    console.log(stamp(), `กลุ่มถูกอัปเกรดเป็น supergroup — ย้าย chat id ${chatId} → ${newId}`);
    chatId = String(newId);
    await fetch(`${APP_URL}/api/thunder/report-target`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify({ chatId: String(newId), threadId: threadId || null }),
    }).catch(() => {});
    return true;
  }

  for (const [i, text] of messages.entries()) {
    const send = () => fetch(API("sendMessage"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...mkBase(), text, parse_mode: "HTML", disable_web_page_preview: true }),
    }).then((x) => x.json()).catch(() => null);
    let r = await send();
    if (!r?.ok && (await migrateIfNeeded(r))) r = await send(); // ย้ายแล้วลองใหม่
    if (!r?.ok) console.error(stamp(), `ส่งข้อความที่ ${i + 1} ไม่สำเร็จ:`, r?.description);
    await sleep(700);
  }

  // ไฟล์เต็ม 2 แบบ:
  //  .html = เห็นภาพหน้าจอแชทจริง (โปรแกรมอ่าน .md ส่วนใหญ่ไม่ render base64 → เคยออกมาเป็นข้อความขยะ)
  //  .md   = ตัวหนังสือล้วน อ่านง่าย
  const files = [
    { name: `chat-report-${j.bizDate}.html`, body: j.html, cap: `🖼 รายงานฉบับเต็ม ${j.bizDate} · ${j.chatCount} เคส — เปิดในเบราว์เซอร์เพื่อดูภาพหน้าจอแชท` },
    { name: `chat-report-${j.bizDate}.md`, body: j.markdown, cap: `📝 ฉบับตัวหนังสือ (มีลิงก์เปิดแชททุกเคส)` },
  ];
  for (const f of files) {
    if (!f.body) continue;
    const form = new FormData();
    form.append("chat_id", String(chatId)); // ใช้ id หลังย้าย supergroup แล้ว (ถ้ามี)
    if (threadId) form.append("message_thread_id", String(threadId));
    form.append("caption", f.cap);
    form.append("document", new Blob([new TextEncoder().encode(f.body)]), f.name);
    const r2 = await fetch(API("sendDocument"), { method: "POST", body: form }).then((x) => x.json()).catch(() => null);
    if (!r2?.ok) console.error(stamp(), `ส่ง ${f.name} ไม่สำเร็จ:`, r2?.description);
    await sleep(800);
  }

  console.log(stamp(), `ส่งรายงานเรียบร้อย (${messages.length} ข้อความ + ไฟล์ html/md)`);
}

main().catch((e) => { console.error(stamp(), "ผิดพลาด:", e?.message || e); process.exit(1); });
