import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { KIKI_GUARD, vexLine } from "./kiki";

/**
 * Vex คุมเครื่อง Mac แทนเจ้าของ (สั่งผ่านแชทตอนไม่อยู่หน้าคอม)
 *  - คำสั่งด่วน (deterministic): แคปจอ / ดิสก์ / แบต / เปิดแอป-เว็บ / เพลง / วอลุ่ม
 *  - งานซับซ้อน: spawn Claude agent ("มือ" ของ Vex) รันคำสั่ง terminal แทนการพิมพ์ใน Warp,
 *    คุม Chrome/แอปผ่าน AppleScript แล้วรายงานผล + แนบภาพหลักฐาน
 */

export const MAC_RE =
  /แคป(หน้า)?จอ|screenshot|สั่งคอม|ที่คอม(พ์)?|ในคอม(พ์)?|บนเครื่อง|หน้าจอตอนนี้|ดิสก์|พื้นที่เครื่อง|แบต(เตอรี่)?|(เปิด|ปิด)(แอป|โปรแกรม|เพลง)|เปิดเว็บ|วอลุ่ม|เสียงเครื่อง|\bwarp\b|\bterminal\b|เทอร์มินัล|โครม|chrome.{0,12}(เปิด|ปิด|แท็บ)|จัดการเครื่อง|คอมเหลือ|สเปคเครื่อง|ram เหลือ/i;

const run = (cmd: string, args: string[], timeout = 20_000): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 4_000_000 }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr || err.message)) : resolve(stdout.toString()),
    );
  });

export interface MacResult {
  text: string;
  imagePaths?: string[]; // ภาพให้แนบกลับ (แคปจอ ฯลฯ)
}

// คำสั่งด่วน — จับตรง ๆ ไม่ต้องผ่าน agent (เร็ว + ชัวร์)
export async function quickMac(text: string): Promise<MacResult | null> {
  const t = text.toLowerCase();

  if (/แคป(หน้า)?จอ|screenshot|หน้าจอตอนนี้/.test(t)) {
    const p = path.join(os.tmpdir(), `vex-screen-${Date.now()}.png`);
    await run("screencapture", ["-x", p]);
    return { text: await vexLine("หน้าจอตอนนี้ครับ"), imagePaths: [p] };
  }
  if (/ดิสก์|พื้นที่เครื่อง/.test(t)) {
    const out = await run("df", ["-h", "/"]);
    const line = out.split("\n")[1]?.split(/\s+/) || [];
    return { text: await vexLine(`ดิสก์เครื่อง: ใช้ไป ${line[2] || "?"} จาก ${line[1] || "?"} (${line[4] || "?"}) เหลือว่าง ${line[3] || "?"}`) };
  }
  if (/แบต/.test(t)) {
    const out = await run("pmset", ["-g", "batt"]);
    const m = out.match(/(\d+%).*?(charging|discharging|charged|AC attached)?/i);
    return { text: await vexLine(`แบตเตอรี่ ${m?.[1] || "?"} ${/charging|AC/i.test(out) ? "เสียบสายอยู่" : "ใช้แบตอยู่"}`) };
  }
  const openApp = text.match(/เปิด(?:แอป|โปรแกรม)\s*([A-Za-zก-๙0-9 .]+)/);
  if (openApp) {
    const app = openApp[1].trim();
    await run("open", ["-a", app]);
    return { text: await vexLine(`เปิด ${app} ให้แล้ว`) };
  }
  const openWeb = text.match(/เปิดเว็บ\s*(\S+)/);
  if (openWeb) {
    const url = openWeb[1].startsWith("http") ? openWeb[1] : `https://${openWeb[1]}`;
    await run("open", [url]);
    return { text: await vexLine(`เปิด ${url} ใน Chrome ให้แล้ว`) };
  }
  if (/เปิดเพลง/.test(t)) {
    await run("osascript", ["-e", 'tell application "Music" to play']);
    return { text: await vexLine("เปิดเพลงแล้ว") };
  }
  if (/ปิดเพลง|หยุดเพลง/.test(t)) {
    await run("osascript", ["-e", 'tell application "Music" to pause']);
    return { text: await vexLine("หยุดเพลงแล้ว") };
  }
  const vol = text.match(/วอลุ่ม|เสียงเครื่อง/);
  if (vol) {
    const n = text.match(/(\d{1,3})/);
    if (n) {
      await run("osascript", ["-e", `set volume output volume ${Math.min(100, Number(n[1]))}`]);
      return { text: await vexLine(`ตั้งเสียงเครื่อง ${Math.min(100, Number(n[1]))}% แล้ว`) };
    }
  }
  return null; // ไม่เข้าคำสั่งด่วน → ส่งต่อ agent
}

const AGENT_SYSTEM = `คุณคือ "มือ" ของ Vex — agent ที่ทำงานบนเครื่อง Mac ของเจ้าของแทนเขา (เขาสั่งผ่านแชทมือถือ ไม่อยู่หน้าคอม)
ทำงานที่ได้รับให้เสร็จด้วยเครื่องมือที่มี (คำสั่ง shell) แล้วรายงานผลสั้น ๆ เป็นภาษาไทย

เครื่องมือ/เทคนิคบนเครื่องนี้:
- คำสั่ง terminal ทั่วไปรันได้ตรง ๆ (แทนการพิมพ์ใน Warp ให้เจ้าของ)
- คุม Google Chrome: osascript -e 'tell application "Google Chrome" to open location "URL"' · อ่านแท็บ: 'tell application "Google Chrome" to get {title, URL} of active tab of front window' · รัน JS ในแท็บ: 'tell application "Google Chrome" to execute front window's active tab javascript "..."'
- คุมแอป/พิมพ์แทนคน: osascript System Events (keystroke/click) — activate แอปก่อน
- แคปหน้าจอเป็นหลักฐาน: screencapture -x /tmp/vex-proof.png แล้วพิมพ์ path เต็มไว้ในคำตอบ (ระบบจะแนบภาพให้เจ้าของเอง)

กติกาความปลอดภัย (เด็ดขาด):
- ห้าม sudo · ห้ามลบ/เขียนทับไฟล์นอก /tmp และ ~/VexAgent · ห้ามปิดเครื่อง/รีสตาร์ท/logout · ห้ามส่งข้อมูลเครื่องออกอินเทอร์เน็ต
- งานที่ต้องลบไฟล์/แก้ของสำคัญ/จ่ายเงิน/ส่งข้อความหาคนอื่น: อย่าทำ ให้ตอบกลับว่าต้องให้เจ้าของยืนยันก่อน พร้อมบอกว่าจะทำอะไรบ้าง
- ทำไม่ได้/ติดอะไร บอกตรง ๆ ว่าติดตรงไหน`;

// งานซับซ้อน → Claude agent มี Bash เต็มมือ (ภายใต้กติกาใน system prompt)
export async function macAgent(task: string): Promise<MacResult> {
  const cliPath = process.env.CLAUDE_CLI_PATH || "claude";
  const cwd = path.join(os.homedir(), "VexAgent");
  fs.mkdirSync(cwd, { recursive: true });

  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(cliPath, ["-p", "--output-format", "text", "--strict-mcp-config", "--allowedTools", "Bash,Read,Glob,Grep,Write"], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
      env: { ...process.env, CLAUDE_DISABLE_IDE: "1" },
    });
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
    child.stdin.write(`${KIKI_GUARD}\n\n${AGENT_SYSTEM}\n\n---\n\nงานจากเจ้าของ: ${task}`);
    child.stdin.end();
  });

  // ดึง path ภาพที่ agent สร้าง (แคปหลักฐาน) มาแนบ + ซ่อน path จากข้อความ
  const imagePaths: string[] = [];
  const text = out
    .replace(/[`"]?(\/(?:tmp|private\/tmp|Users)[^\s`"'<>|]+\.(?:png|jpe?g))[`"]?/gi, (full, p) => {
      try {
        const real = fs.realpathSync(p);
        // 5 ส.ค. 2026: agent เซฟภาพไว้ที่ /tmp (= /private/tmp) แต่ os.tmpdir() บนแมคคือ /var/folders/...
        // เช็คเดิมเลยตกทุกภาพที่ agent แคปมา → เจ้าของสั่ง "แคปหน้าจอ" แล้วไม่เคยได้ภาพสักครั้ง
        const allowed = [fs.realpathSync(os.tmpdir()), "/private/tmp", "/tmp"];
        if (fs.statSync(real).isFile() && (allowed.some((dir) => real.startsWith(dir)) || real.includes("VexAgent"))) {
          if (!imagePaths.includes(real)) imagePaths.push(real);
          return "";
        }
      } catch { /* ไม่มีจริงก็ปล่อยไว้ */ }
      return full;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: text || "ทำเสร็จแล้วครับ", imagePaths };
}
