// เปิด cloudflared quick tunnel → ดักลิงก์ trycloudflare → แจ้งเข้ากลุ่มทุกครั้งที่ URL เปลี่ยน
// รัน: node scripts/tunnel-announce.mjs  (auto-restart ถ้า tunnel ตาย → ได้ URL ใหม่ → แจ้งซ้ำ)
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

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
const INTERNAL = process.env.INTERNAL_API_TOKEN || "";
const TARGET = process.env.TUNNEL_TARGET || "http://localhost:3000";
const CF = process.env.CLOUDFLARED_BIN || "/opt/homebrew/bin/cloudflared";
const RESTART_MS = 5000;

let lastUrl = null;
let announcing = false;

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

async function announce(url) {
  if (url === lastUrl || announcing) return;
  announcing = true;
  try {
    const r = await fetch(APP_URL + "/api/tunnel/announce", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify({ url }),
    });
    const j = await r.json().catch(() => ({}));
    if (j.ok) {
      lastUrl = url;
      log("announced:", url, "→ chat", j.chatId);
    } else {
      log("announce failed:", j.error || r.status, "(จะลองใหม่เมื่อมี URL อีกครั้ง)");
    }
  } catch (e) {
    log("announce error:", e?.message || e);
  } finally {
    announcing = false;
  }
}

function runTunnel() {
  log("starting cloudflared →", TARGET);
  const cf = spawn(CF, ["tunnel", "--url", TARGET], { stdio: ["ignore", "pipe", "pipe"] });

  const onData = (buf) => {
    const s = buf.toString();
    const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) announce(m[0]);
  };
  cf.stdout.on("data", onData);
  cf.stderr.on("data", onData);

  cf.on("exit", (code) => {
    log(`cloudflared exited (code ${code}) — restart ใน ${RESTART_MS / 1000}s`);
    lastUrl = null; // บังคับแจ้งซ้ำเมื่อได้ URL ใหม่
    setTimeout(runTunnel, RESTART_MS);
  });
  cf.on("error", (e) => {
    log("spawn error:", e?.message || e, "— ตรวจว่าติดตั้ง cloudflared แล้วหรือยัง (", CF, ")");
  });
}

runTunnel();
