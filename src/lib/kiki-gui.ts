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

/** เดาว่าเจ้าของหมายถึงแอปไหนจากข้อความ (ใช้ตอนตัวอ่านเจตนาไม่ได้กรอกชื่อแอปมา) */
export function guessAppFromText(text: string): string | null {
  const hit = APPS.find((a) => a.keys.test(text || ""));
  return hit ? hit.app : null;
}

/**
 * แอปที่อยู่หน้าจอตอนนี้ (แปลงชื่อโปรเซสเป็นชื่อแอปจริง — Warp ใช้ชื่อโปรเซสว่า "stable")
 * ใช้ตอนเจ้าของ reply ภาพหน้าจอแล้วบอกว่า "พิมพ์ในห้องนี้" โดยไม่ได้บอกชื่อแอป
 */
export async function currentAppName(): Promise<string | null> {
  const proc = (await frontApp()).toLowerCase();
  if (!proc) return null;
  const hit = APPS.find((a) => a.procs.some((p) => proc.includes(p) || p.includes(proc)));
  return hit ? hit.app : proc;
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
  await pressKey("v", ["command down"]); // key code 9 — ต้องไม่ใช้ keystroke "v" เพราะภาษาไทยจะเพี้ยน
}

/**
 * รหัสปุ่มจริงบนคีย์บอร์ด (ไม่ผูกกับภาษา)
 *
 * ทำไมต้องใช้: เทสจริง 4 ส.ค. — เจ้าของตั้งคีย์บอร์ดเป็นภาษาไทยค้างไว้
 * `keystroke "v" using {command down}` เลยไม่ใช่ Cmd+V แต่กลายเป็นการพิมพ์อักษรไทยตัวอื่น
 * ผลคือวางข้อความไม่ติด แถมเผลอพิมพ์เศษอักษรไทยส่งเข้าห้องจริง
 */
const KEY_CODES: Record<string, number> = { a: 0, x: 7, c: 8, v: 9, k: 40, l: 37, o: 31, p: 35, t: 17, w: 13, f: 3 };

/** แอปที่ "ช่องพิมพ์" เป็นกล่องข้อความเปล่า ๆ — ปลอดภัยที่จะเคาะตัวอักษรแล้วเลือกทับ */
const CHAT_APPS = new Set(["Discord", "Telegram", "LINE", "Slack"]);

async function pressKey(key: string, mods: string[] = []): Promise<void> {
  const m = mods.length ? ` using {${mods.join(", ")}}` : "";
  const code = KEY_CODES[key.toLowerCase()];
  if (code === undefined) {
    await osa(`tell application "System Events" to keystroke "${key}"${m}`);
    return;
  }
  await osa(`tell application "System Events" to key code ${code}${m}`);
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
  /** ตรวจด้วยตาแล้วเห็นข้อความขึ้นจริงไหม — true=เห็น · false=ไม่เห็น · null=ตรวจไม่ได้ */
  verified?: boolean | null;
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

  // สลับแท็บ Warp ด้วยเลขแท็บ (Cmd+1..9) — แม่นกว่าค้นด้วยชื่อมาก
  const tabNo = opts.target && /^\s*(\d)\s*$/.test(opts.target) ? opts.target.trim() : "";
  if (tabNo && resolved.app === "Warp") {
    try {
      await osa(`tell application "System Events" to key code ${17 + Number(tabNo)} using {command down}`);
      await wait(1200);
    } catch { /* สลับไม่ได้ก็พิมพ์ในแท็บปัจจุบัน */ }
  }

  // สลับห้อง/แท็บด้วยชื่อ (Discord = Cmd+K · Warp = Cmd+P)
  else if (opts.target && resolved.opener) {
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
    // ต้องโฟกัสช่องพิมพ์ก่อน ไม่งั้น Cmd+V ตกไปที่อื่น (เทสจริง 4 ส.ค.: สลับห้อง Discord ถูก
    // แต่ข้อความไม่ลงช่องพิมพ์ แล้วระบบดันรายงานว่าส่งแล้ว)
    // วิธี: ปิดป๊อปอัปที่ค้าง → เคาะตัวอักษรหนึ่งตัวให้เคอร์เซอร์เข้าช่องพิมพ์ → เลือกทั้งหมด → วางทับ
    // เฉพาะ "แอปแชท" เท่านั้นที่ใช้ท่าเคาะตัวอักษรแล้วเลือกทับ เพื่อดันเคอร์เซอร์เข้าช่องพิมพ์
    // ห้ามใช้กับแอปเอกสาร/เอดิเตอร์เด็ดขาด — Cmd+A จะเลือกทั้งไฟล์แล้ววางทับของเดิมหาย
    // (เทสจริง 4 ส.ค. เผลอทับเนื้อหาไฟล์ที่ TextEdit เปิดค้างไว้ ต้องกด Undo กู้คืน)
    if (CHAT_APPS.has(resolved.app)) {
      await osa("tell application \"System Events\" to key code 53"); // Escape ปิดป๊อปอัปที่ค้าง
      await wait(400);
      await pressKey("x"); // เคาะหนึ่งตัวให้เคอร์เซอร์เข้าช่องพิมพ์
      await wait(400);
      await pressKey("a", ["command down"]); // เลือกเฉพาะตัวที่เพิ่งเคาะในช่องพิมพ์ แล้ววางทับ
      await wait(250);
    }
    await pasteText(opts.text);
    await wait(700);
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
  let verified: boolean | null = null;
  if (opts.send) {
    await pressReturn(opts.sendWith === "cmd-return" ? ["command down"] : []);
    await wait(1800);
    const after = await snap("sent");
    if (after) {
      shots.push({ label: "หลังกดส่ง", path: after });
      // ตรวจด้วยตาว่าข้อความขึ้นในห้องจริงไหม — กดปุ่มแล้วไม่ได้แปลว่าส่งสำเร็จ
      verified = await seenOnScreen(after, opts.text);
    }
    sent = verified !== false;
  }

  return {
    ok: opts.send ? verified !== false : true,
    app: resolved.app,
    target: opts.target,
    typed: opts.text,
    sent,
    verified,
    shots,
    problem: verified === false ? "กดส่งแล้วแต่ยังไม่เห็นข้อความขึ้นในหน้าจอ — อาจโฟกัสไม่เข้าช่องพิมพ์ ลองสั่งใหม่หรือบอกห้องให้ชัดกว่านี้" : undefined,
  };
}

/**
 * ตรวจด้วยวิชันว่าข้อความที่เพิ่งส่งขึ้นบนหน้าจอจริงไหม
 * (เจ้าของสั่งไว้ตั้งแต่ต้น: ห้ามเคลมว่าทำแล้วถ้าไม่มีหลักฐาน — กดคีย์ไม่เท่ากับส่งสำเร็จ)
 * คืน null = ตรวจไม่ได้ (ถือว่าไม่ยืนยัน แต่ไม่ฟันธงว่าล้มเหลว)
 */
export async function seenOnScreen(shotPath: string, text: string): Promise<boolean | null> {
  try {
    const { askExtractor } = await import("./kiki");
    const raw = await askExtractor(
      `ดูภาพหน้าจอที่ path นี้: ${shotPath}\n\nข้อความที่เพิ่งพยายามส่งคือ: """${text.slice(0, 200)}"""\n\nข้อความนี้ปรากฏเป็น "ข้อความที่ส่งไปแล้ว" ในหน้าต่างแชท/เทอร์มินัลบนภาพหรือยัง (ไม่นับกรณีที่ยังค้างอยู่ในช่องพิมพ์)\nตอบ JSON เท่านั้น: {"sent":true/false,"where":"เห็นตรงไหน หรือเหตุผลสั้น ๆ"}`,
      { imagePaths: [shotPath], timeoutMs: 60_000 },
    );
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return Boolean((JSON.parse(m[0]) as { sent?: boolean }).sent);
  } catch {
    return null;
  }
}

/**
 * เปิดแอปขึ้นมาหน้าสุดแล้วแคปหน้าจอเฉย ๆ (ไม่แตะคีย์บอร์ด)
 * ใช้เป็น "หลักฐานภาพ" หลังทำงานผ่าน API — ปลอดภัยกว่าการกดคีย์สลับห้อง
 */
export async function showApp(app: string): Promise<{ label: string; path: string }[]> {
  const resolved = resolveApp(app);
  if (!resolved) return [];
  try {
    await osa(`tell application "${resolved.app}" to activate`);
    await wait(1600);
    const s = await snap("proof");
    return s ? [{ label: `หน้าจอ ${resolved.app} ตอนนี้`, path: s }] : [];
  } catch {
    return [];
  }
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
