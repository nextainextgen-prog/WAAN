import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * คุมแอปบนเครื่องแทนเจ้าของจริง ๆ (เจ้าของสั่ง 4 ส.ค. 2026 หลังเจอเคสพัง)
 *
 * เคสที่พัง: เจ้าของ reply ภาพหน้าจอ Discord แล้วบอก "พิมพ์ไปในห้องนี้หน่อย"
 *           → ระบบตีความว่า "ห้อง" = กลุ่ม Telegram แล้วไปโพสต์ผิดที่
 *
 * ที่ต้องได้: พิมพ์/ส่งข้อความในแอปที่เห็นบนจอ · สลับห้อง/แท็บตามที่บอก · สั่งคำสั่งใน Warp
 *           · ทุกครั้งที่ลงมือ ต้องแคปหน้าจอกลับมาเป็นหลักฐาน (ห้ามเคลมลอย ๆ)
 *
 * วิธีพิมพ์: ใช้คลิปบอร์ด + Cmd+V (ไม่ใช้ keystroke ตรง ๆ เพราะภาษาไทย/อิโมจิพิมพ์ไม่ออก)
 */

const run = (cmd: string, args: string[], timeout = 20_000): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 4_000_000 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).slice(0, 300))) : resolve(stdout.toString().trim()),
    );
  });

const osa = (script: string) => run("osascript", ["-e", script]);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ชื่อที่เจ้าของเรียก → ชื่อแอปจริง + ชื่อโปรเซส (Warp ใช้ชื่อโปรเซสว่า "stable")
const APPS: { keys: RegExp; app: string; procs: string[]; opener?: { mods: string[]; key: string } }[] = [
  { keys: /warp|เวิร์ป|เทอร์มินอล|terminal/i, app: "Warp", procs: ["stable", "warp"], opener: { mods: ["command down"], key: "p" } },
  { keys: /discord|ดิสคอร์ด|ดิส/i, app: "Discord", procs: ["discord"], opener: { mods: ["command down"], key: "k" } },
  { keys: /telegram|เทเลแกรม/i, app: "Telegram", procs: ["telegram"], opener: { mods: ["command down"], key: "k" } },
  { keys: /line|ไลน์/i, app: "LINE", procs: ["line"] },
  { keys: /chrome|โครม|เบราว์เซอร์/i, app: "Google Chrome", procs: ["google chrome"], opener: { mods: ["command down"], key: "l" } },
  { keys: /obsidian|โอบซิเดียน/i, app: "Obsidian", procs: ["obsidian"], opener: { mods: ["command down"], key: "o" } },
  { keys: /notion|โน๊ตชั่น|โนชั่น/i, app: "Notion", procs: ["notion"], opener: { mods: ["command down"], key: "p" } },
  { keys: /vscode|vs code|โค้ด|cursor/i, app: "Code", procs: ["code"], opener: { mods: ["command down"], key: "p" } },
];

export function resolveApp(name: string): { app: string; procs: string[]; opener?: { mods: string[]; key: string } } | null {
  const n = (name || "").trim();
  if (!n) return null;
  const hit = APPS.find((a) => a.keys.test(n));
  if (hit) return { app: hit.app, procs: hit.procs, opener: hit.opener };
  return { app: n, procs: [n.toLowerCase()] }; // แอปอื่นก็ลองเปิดตามชื่อที่บอกมา
}

export async function frontApp(): Promise<string> {
  try {
    return await osa('tell application "System Events" to get name of first application process whose frontmost is true');
  } catch {
    return "";
  }
}

export async function snap(label: string): Promise<string | null> {
  try {
    const p = path.join(os.tmpdir(), `vex-${label}-${Date.now()}.png`);
    await run("screencapture", ["-x", p]);
    return fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

async function pasteText(text: string): Promise<void> {
  // คลิปบอร์ดรองรับไทย/อิโมจิ ต่างจาก keystroke ที่พิมพ์ไทยไม่ออก
  await new Promise<void>((resolve, reject) => {
    const child = execFile("pbcopy", [], (err) => (err ? reject(err) : resolve()));
    child.stdin?.end(text);
  });
  await wait(250);
  await osa('tell application "System Events" to keystroke "v" using {command down}');
}

async function pressKey(key: string, mods: string[] = []): Promise<void> {
  const m = mods.length ? ` using {${mods.join(", ")}}` : "";
  await osa(`tell application "System Events" to keystroke "${key}"${m}`);
}

async function pressReturn(mods: string[] = []): Promise<void> {
  const m = mods.length ? ` using {${mods.join(", ")}}` : "";
  await osa(`tell application "System Events" to key code 36${m}`); // 36 = Return
}

const ACCESS_DENIED = /not allowed|assistive|1719|1728|25211|accessibility/i;

export interface GuiResult {
  ok: boolean;
  app: string;
  target?: string;
  typed?: string;
  sent: boolean;
  shots: { label: string; path: string }[];
  problem?: string;
}

/**
 * พิมพ์ (และส่ง) ข้อความในแอปบนเครื่อง — มีหลักฐานภาพทุกขั้น
 * ตรวจก่อนพิมพ์เสมอว่าแอปที่อยู่หน้าสุดคือแอปที่สั่งจริง ไม่ตรง = ไม่พิมพ์ (กันพิมพ์ลงผิดหน้าต่าง)
 */
export async function typeInApp(opts: {
  app: string;
  target?: string; // ห้อง/แท็บ/ช่อง ที่ต้องสลับไปก่อน
  text: string;
  send?: boolean;
  sendWith?: "return" | "cmd-return";
}): Promise<GuiResult> {
  const resolved = resolveApp(opts.app);
  const shots: { label: string; path: string }[] = [];
  if (!resolved) return { ok: false, app: opts.app, sent: false, shots, problem: "ไม่รู้ว่าให้พิมพ์ในแอปไหน" };

  try {
    await osa(`tell application "${resolved.app}" to activate`);
  } catch (e) {
    return { ok: false, app: resolved.app, sent: false, shots, problem: `เปิดแอป ${resolved.app} ไม่ได้ (${e instanceof Error ? e.message.slice(0, 120) : "error"})` };
  }
  await wait(1400);

  const front = (await frontApp()).toLowerCase();
  if (front && !resolved.procs.some((p) => front.includes(p) || p.includes(front))) {
    const s = await snap("wrongapp");
    if (s) shots.push({ label: "หน้าจอตอนนี้", path: s });
    return { ok: false, app: resolved.app, sent: false, shots, problem: `สลับไป ${resolved.app} ไม่สำเร็จ (หน้าสุดตอนนี้คือ "${front}")` };
  }

  // สลับห้อง/แท็บก่อน (Discord = Cmd+K ค้นห้อง · Warp = Cmd+P ค้นแท็บ)
  if (opts.target && resolved.opener) {
    try {
      await pressKey(resolved.opener.key, resolved.opener.mods);
      await wait(900);
      await pasteText(opts.target);
      await wait(1400);
      await pressReturn();
      await wait(1600);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      const s = await snap("target");
      if (s) shots.push({ label: "หน้าจอตอนนี้", path: s });
      return {
        ok: false,
        app: resolved.app,
        target: opts.target,
        sent: false,
        shots,
        problem: ACCESS_DENIED.test(msg)
          ? "ระบบไม่ได้รับสิทธิ์ควบคุมเครื่อง — เปิดให้ที่ System Settings → Privacy & Security → Accessibility"
          : `สลับไปที่ "${opts.target}" ไม่สำเร็จ (${msg.slice(0, 120)})`,
      };
    }
  }

  const before = await snap("before");
  if (before) shots.push({ label: opts.target ? `ก่อนพิมพ์ (อยู่ที่ ${opts.target})` : "ก่อนพิมพ์", path: before });

  try {
    await pasteText(opts.text);
    await wait(600);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return {
      ok: false,
      app: resolved.app,
      target: opts.target,
      sent: false,
      shots,
      problem: ACCESS_DENIED.test(msg)
        ? "ระบบไม่ได้รับสิทธิ์ควบคุมเครื่อง — เปิดให้ที่ System Settings → Privacy & Security → Accessibility แล้วสั่งใหม่"
        : `พิมพ์ไม่สำเร็จ (${msg.slice(0, 120)})`,
    };
  }

  const typed = await snap("typed");
  if (typed) shots.push({ label: opts.send ? "พิมพ์แล้ว กำลังส่ง" : "พิมพ์ค้างไว้ ยังไม่ส่ง", path: typed });

  let sent = false;
  if (opts.send) {
    await pressReturn(opts.sendWith === "cmd-return" ? ["command down"] : []);
    await wait(1500);
    sent = true;
    const after = await snap("sent");
    if (after) shots.push({ label: "หลังกดส่ง", path: after });
  }

  return { ok: true, app: resolved.app, target: opts.target, typed: opts.text, sent, shots };
}

/** สลับห้อง/แท็บอย่างเดียว (ไม่พิมพ์อะไร) */
export async function switchTo(app: string, target: string): Promise<GuiResult> {
  const resolved = resolveApp(app);
  const shots: { label: string; path: string }[] = [];
  if (!resolved) return { ok: false, app, sent: false, shots, problem: "ไม่รู้ว่าแอปไหน" };
  try {
    await osa(`tell application "${resolved.app}" to activate`);
    await wait(1400);
    if (resolved.opener) {
      await pressKey(resolved.opener.key, resolved.opener.mods);
      await wait(900);
      await pasteText(target);
      await wait(1400);
      await pressReturn();
      await wait(1600);
    }
    const s = await snap("switch");
    if (s) shots.push({ label: `เปิด ${target} ใน ${resolved.app} แล้ว`, path: s });
    return { ok: true, app: resolved.app, target, sent: false, shots };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    const s = await snap("switchfail");
    if (s) shots.push({ label: "หน้าจอตอนนี้", path: s });
    return {
      ok: false,
      app: resolved.app,
      target,
      sent: false,
      shots,
      problem: ACCESS_DENIED.test(msg) ? "ระบบไม่ได้รับสิทธิ์ควบคุมเครื่อง (Accessibility)" : msg.slice(0, 150),
    };
  }
}

/** สั่งคำสั่งใน Warp แล้วรอผล + แคปหน้าจอ */
export async function runInWarp(command: string, opts: { tab?: string; waitMs?: number } = {}): Promise<GuiResult> {
  const r = await typeInApp({ app: "Warp", target: opts.tab, text: command, send: true });
  if (!r.ok) return r;
  await wait(opts.waitMs ?? 4000); // รอคำสั่งทำงานก่อนแคปผล
  const s = await snap("warpresult");
  if (s) r.shots.push({ label: "ผลหลังรันคำสั่ง", path: s });
  return r;
}
