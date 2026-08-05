// ตาของ Vex — ตัวดักข้อความขาเข้าในบัญชี Telegram จริงของเจ้าของ (เฟส 4)
//
// เดิม Vex อ่านแชทได้เมื่อถูกสั่ง แต่ไม่มีใครบอกมันว่ามีอะไรเข้ามาใหม่
// ตัวนี้เฝ้าอยู่ตลอด แล้วยิงทุกเหตุการณ์เข้า "ท่อเหตุการณ์กลาง" (/api/kiki/event)
//
// กติกาเหล็ก: ไฟล์นี้ห้ามตัดสินใจว่าจะพูดหรือไม่พูดเด็ดขาด
// ตัวให้คะแนนขัดจังหวะฝั่งเว็บเป็นคนตัดสินคนเดียว (สเปกข้อ 8)
//
// รัน: node scripts/vex-eyes.mjs

import fs from "node:fs";
import path from "node:path";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import { execSync } from "node:child_process";

function loadEnv() {
  const p = path.join(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const APP_URL = process.env.APP_URL || "http://localhost:3000";
const INTERNAL = process.env.INTERNAL_API_TOKEN;
const SESSION_PATH = process.env.KIKI_TG_SESSION_PATH || path.join(process.cwd(), ".kiki-tg-session");

if (!fs.existsSync(SESSION_PATH)) {
  console.error("ยังไม่ได้เชื่อมบัญชี Telegram — รัน npm run kiki:tg-auth ก่อน");
  process.exit(1);
}

// ห้องที่ไม่ต้องเฝ้า
const IGNORE_RE = /telegram|spam|proxy|บอท|bot$/i;

/**
 * รายชื่อแชทที่ให้เฝ้า — อ่านสดจาก DB ทุกข้อความ (เปลี่ยนได้โดยไม่ต้องรีสตาร์ท)
 *
 * เจ้าของสั่งปิด 5 ส.ค. 2026: "ระบบที่จับข้อความตอนนี้ปิดรับไปก่อน
 * ถ้าจะให้จับข้อความไหนเดี๋ยวผมบอกอีกที"
 *
 *   ว่าง / ไม่มีค่า = ปิดสนิท ไม่จับอะไรเลย (ค่าเริ่มต้นตอนนี้)
 *   ["*"]           = จับทุกแชท
 *   ["อั๋น","แม่"]  = จับเฉพาะที่ชื่อตรงกับในรายการ
 */
function watchList() {
  try {
    const v = execSync(`sqlite3 "${path.join(process.cwd(), "prisma/changoh.db")}" "SELECT value FROM Setting WHERE key='vex_eyes_watch' LIMIT 1;"`, { encoding: "utf8" }).trim();
    return v ? JSON.parse(v) : [];
  } catch {
    return [];
  }
}

function shouldWatch(list, chatName, fromName) {
  if (!list.length) return false;               // ปิดอยู่
  if (list.includes("*")) return true;          // เปิดหมด
  const hay = `${chatName} ${fromName}`.toLowerCase();
  return list.some((w) => hay.includes(String(w).toLowerCase()));
}

async function main() {
  const session = new StringSession(fs.readFileSync(SESSION_PATH, "utf8").trim());
  const client = new TelegramClient(session, Number(process.env.KIKI_TG_API_ID), String(process.env.KIKI_TG_API_HASH), {
    connectionRetries: 20, // เน็ตหลุดต้องต่อกลับเอง ไม่ต้องมีคนไปสั่ง
    autoReconnect: true,
  });
  await client.connect();
  if (!(await client.isUserAuthorized())) {
    console.error("session หมดอายุ — รัน npm run kiki:tg-auth ใหม่");
    process.exit(1);
  }
  const me = await client.getMe();
  const list = watchList();
  console.log(`ตาของ Vex ต่อบัญชี ${me.firstName || ""} (${me.id}) แล้ว`);
  console.log(
    list.length
      ? `  รายการที่เฝ้า: ${list.includes("*") ? "ทุกแชท" : list.join(" · ")}`
      : `  ยังไม่เฝ้าแชทไหนเลย (ปิดอยู่) — สั่งเปิดผ่านแชทได้ เช่น "เฝ้าแชทอั๋น" หรือ "เฝ้าทุกแชท"`,
  );

  client.addEventHandler(async (event) => {
    try {
      const msg = event.message;
      if (!msg || msg.out) return;              // ข้อความที่เจ้าของส่งเอง ไม่ต้องแจ้ง
      const text = (msg.message || "").trim();
      if (!text) return;                        // สติกเกอร์/รูปเปล่า ๆ ยังไม่รับในเฟสนี้

      const chat = await msg.getChat().catch(() => null);
      const sender = await msg.getSender().catch(() => null);
      const isGroup = Boolean(chat?.className === "Channel" || chat?.className === "Chat");
      const fromName =
        [sender?.firstName, sender?.lastName].filter(Boolean).join(" ") ||
        sender?.username || chat?.title || "ไม่ทราบชื่อ";
      const chatName = chat?.title || fromName;
      if (IGNORE_RE.test(chatName)) return;

      // ปิดอยู่ / ไม่อยู่ในรายการที่สั่งให้เฝ้า = ไม่แตะเลย ไม่เปลืองอะไรทั้งนั้น
      const list = watchList();
      if (!shouldWatch(list, chatName, fromName)) return;

      const peerId = String(chat?.id ?? sender?.id ?? "");
      const res = await fetch(APP_URL + "/api/kiki/event", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
        body: JSON.stringify({
          source: "telegram",
          fromName: isGroup ? `${fromName} ใน ${chatName}` : fromName,
          peerId,
          text,
          isGroup,
          dedupKey: `tg:${peerId}:${msg.id}`,
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const j = await res.json().catch(() => ({}));
      console.log(`  ${isGroup ? "[กลุ่ม] " : ""}${fromName}: ${text.slice(0, 60)} → ระดับ ${j.level ?? "-"} (${j.why || ""})`);
    } catch (e) {
      console.error("จัดการข้อความเข้าไม่ได้:", e?.message);
    }
  }, new NewMessage({}));

  // อยู่ยาว — GramJS ต่อกลับเองเมื่อเน็ตหลุด
  setInterval(() => {
    if (!client.connected) {
      console.warn("หลุดการเชื่อมต่อ — พยายามต่อใหม่");
      client.connect().catch((e) => console.error("ต่อใหม่ไม่ได้:", e?.message));
    }
  }, 60_000);
}

main().catch((e) => {
  console.error("ตาของ Vex ล้ม:", e?.message);
  process.exit(1);
});
