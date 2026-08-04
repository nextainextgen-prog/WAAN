import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";

/**
 * น้องวานคุมเครื่อง Mac ของพี่โด้ (สั่งผ่านแชทตอนไม่อยู่หน้าคอม)
 *  - คำสั่งด่วน (deterministic): แคปจอ / ดิสก์ / แบต / เปิดแอป-เว็บ / วอลุ่ม
 *  - งานซับซ้อน: spawn Claude agent เป็น "มือ" ของวาน — รันคำสั่ง terminal + คุม Chrome ผ่าน osascript
 *    แล้วรายงานผลพร้อมแนบภาพหลักฐาน
 *
 * แยกไฟล์จาก kiki-mac.ts (ของ Vex) โดยตั้งใจ — คนละบอท คนละ persona คนละขอบเขตข้อมูล
 * ห้าม import ข้ามฝั่ง (ข้อมูลงานฝั่งวานต้องไม่ไหลเข้าแชทส่วนตัวของ Vex)
 *
 * ทุกทางเข้าของไฟล์นี้ "ต้อง" ถูกเรียกหลังเช็คแล้วว่าเป็นเจ้าของ (Telegram id ตัวเลข) เท่านั้น
 */

export const MAC_RE =
  /แคป(หน้า)?จอ|screenshot|สั่งคอม|ที่คอม(พ์)?|ในคอม(พ์)?|บนเครื่อง|หน้าจอตอนนี้|ดิสก์|พื้นที่เครื่อง|แบต(เตอรี่)?|(เปิด|ปิด)(แอป|โปรแกรม|เพลง)|เปิดเว็บ|วอลุ่ม|เสียงเครื่อง|\bterminal\b|เทอร์มินัล|โครม|chrome.{0,12}(เปิด|ปิด|แท็บ)|จัดการเครื่อง|คอมเหลือ|สเปคเครื่อง|ram เหลือ/i;

const run = (cmd: string, args: string[], timeout = 20_000): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 4_000_000 }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr || err.message)) : resolve(stdout.toString()),
    );
  });

export interface MacResult {
  text: string;
  imagePaths?: string[]; // ภาพให้แนบกลับ (แคปจอ/หลักฐาน)
}

// แคปหน้าจอเครื่อง — ใช้ซ้ำได้จากที่อื่น (เช่น รายงานผลหลังรันคำสั่ง)
export async function captureScreen(tag = "waan"): Promise<string | null> {
  try {
    const p = path.join(os.tmpdir(), `${tag}-screen-${process.pid}-${Math.random().toString(36).slice(2, 8)}.png`);
    await run("screencapture", ["-x", p]);
    return fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

// คำสั่งด่วน — จับตรง ๆ ไม่ต้องผ่าน agent (เร็ว + ผลแน่นอน)
export async function quickMac(text: string): Promise<MacResult | null> {
  const t = text.toLowerCase();

  if (/แคป(หน้า)?จอ|screenshot|หน้าจอตอนนี้/.test(t)) {
    const p = await captureScreen();
    if (!p) return { text: "แคปหน้าจอไม่สำเร็จค่ะ" };
    return { text: "หน้าจอตอนนี้ค่ะ", imagePaths: [p] };
  }
  if (/ดิสก์|พื้นที่เครื่อง/.test(t)) {
    const out = await run("df", ["-h", "/"]);
    const line = out.split("\n")[1]?.split(/\s+/) || [];
    return { text: `ดิสก์เครื่องค่ะ 💻\n\nใช้ไป ${line[2] || "?"} จาก ${line[1] || "?"} (${line[4] || "?"})\nเหลือว่าง ${line[3] || "?"}` };
  }
  if (/แบต/.test(t)) {
    const out = await run("pmset", ["-g", "batt"]);
    const m = out.match(/(\d+%)/);
    return { text: `แบตเตอรี่ ${m?.[1] || "?"} ${/charging|AC/i.test(out) ? "· เสียบสายอยู่ ⬆️" : "· ใช้แบตอยู่"}` };
  }
  const openApp = text.match(/เปิด(?:แอป|โปรแกรม)\s*([A-Za-zก-๙0-9 .]+)/);
  if (openApp) {
    const app = openApp[1].trim();
    await run("open", ["-a", app]);
    return { text: `เปิด ${app} ให้แล้วค่ะ ✅` };
  }
  const openWeb = text.match(/เปิดเว็บ\s*(\S+)/);
  if (openWeb) {
    const url = openWeb[1].startsWith("http") ? openWeb[1] : `https://${openWeb[1]}`;
    await run("open", [url]);
    return { text: `เปิด ${url} ให้แล้วค่ะ ✅` };
  }
  if (/วอลุ่ม|เสียงเครื่อง/.test(t)) {
    const n = text.match(/(\d{1,3})/);
    if (n) {
      const v = Math.min(100, Number(n[1]));
      await run("osascript", ["-e", `set volume output volume ${v}`]);
      return { text: `ตั้งเสียงเครื่อง ${v}% แล้วค่ะ ✅` };
    }
  }
  return null; // ไม่เข้าคำสั่งด่วน → ส่งต่อ agent
}

const AGENT_SYSTEM = `คุณคือ "มือ" ของน้องวาน — agent ที่ทำงานบนเครื่อง Mac ของพี่โด้แทนเขา (เขาสั่งผ่านแชทมือถือ ไม่อยู่หน้าคอม)
ทำงานที่ได้รับให้เสร็จด้วยเครื่องมือที่มี (คำสั่ง shell) แล้วรายงานผลสั้น ๆ เป็นภาษาไทย ลงท้าย "ค่ะ"

เครื่องมือ/เทคนิคบนเครื่องนี้:
- คำสั่ง terminal ทั่วไปรันได้ตรง ๆ
- คุม Google Chrome: osascript -e 'tell application "Google Chrome" to open location "URL"' · อ่านแท็บ: 'tell application "Google Chrome" to get {title, URL} of active tab of front window' · รัน JS ในแท็บ: 'tell application "Google Chrome" to execute front window's active tab javascript "..."'
- คุมแอป/พิมพ์แทนคน: osascript System Events (keystroke/click) — activate แอปก่อน
- แคปหน้าจอเป็นหลักฐาน: screencapture -x /tmp/waan-proof.png แล้วพิมพ์ path เต็มไว้ในคำตอบ (ระบบจะแนบภาพให้เอง)

กติกาความปลอดภัย (เด็ดขาด ห้ามยกเว้น):
- ห้าม sudo · ห้ามลบไฟล์ (rm/unlink/trash) ไม่ว่าที่ไหน · ห้ามเขียนทับไฟล์นอก /tmp และ ~/WaanAgent
- ห้ามปิดเครื่อง/รีสตาร์ท/logout · ห้ามแก้ไฟล์ตั้งค่าระบบ · ห้ามส่งข้อมูลในเครื่องออกอินเทอร์เน็ต
- ห้ามแตะไฟล์/โฟลเดอร์ที่ขึ้นต้นด้วย kiki หรือ .kiki (ของเลขาส่วนตัว คนละระบบ) และห้ามอ่านไฟล์ .env/session/credential ใด ๆ ออกมาแสดง
- งานที่ต้องลบไฟล์/แก้ของสำคัญ/จ่ายเงิน/ส่งข้อความหาคนอื่น: อย่าทำ ให้ตอบกลับว่าต้องให้พี่โด้ยืนยันก่อน พร้อมบอกว่าจะทำอะไรบ้าง
- ทำไม่ได้/ติดอะไร บอกตรง ๆ ว่าติดตรงไหน ห้ามเดาผลลัพธ์`;

// งานซับซ้อน → Claude agent มี Bash (ภายใต้กติกาใน system prompt)
export async function macAgent(task: string): Promise<MacResult> {
  const cliPath = process.env.CLAUDE_CLI_PATH || "claude";
  const cwd = path.join(os.homedir(), "WaanAgent");
  fs.mkdirSync(cwd, { recursive: true });

  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      cliPath,
      ["-p", "--output-format", "text", "--strict-mcp-config", "--allowedTools", "Bash,Read,Glob,Grep,Write"],
      { stdio: ["pipe", "pipe", "pipe"], cwd, env: { ...process.env, CLAUDE_DISABLE_IDE: "1" } },
    );
    let stdout = "";
    let stderr = "";
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill("SIGTERM");
      reject(new Error("agent ใช้เวลานานเกินไป (3 นาที)"));
    }, 180_000);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `exit ${code}`));
    });
    child.stdin.write(`${AGENT_SYSTEM}\n\n---\n\nงานจากพี่โด้: ${task}`);
    child.stdin.end();
  });

  // ดึง path ภาพที่ agent สร้าง (แคปหลักฐาน) มาแนบ + ซ่อน path จากข้อความ
  const imagePaths: string[] = [];
  const text = out
    .replace(/[`"]?(\/(?:tmp|private\/tmp|Users)[^\s`"'<>|]+\.(?:png|jpe?g))[`"]?/gi, (full, p) => {
      try {
        const real = fs.realpathSync(p);
        if (fs.statSync(real).isFile() && (real.startsWith(fs.realpathSync(os.tmpdir())) || real.includes("WaanAgent"))) {
          if (!imagePaths.includes(real)) imagePaths.push(real);
          return "";
        }
      } catch { /* ไม่มีจริงก็ปล่อยไว้ */ }
      return full;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: text || "ทำเสร็จแล้วค่ะ", imagePaths };
}
