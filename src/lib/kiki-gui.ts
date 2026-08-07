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

/**
 * แคปหน้าจอเป็นหลักฐาน
 *
 * ใส่ `app` มาด้วยเมื่อรู้ว่ากำลังทำงานกับแอปไหน — จะแคป "เฉพาะหน้าต่างนั้น" ก่อน
 * เพราะ `screencapture` แบบเต็มจอเก็บได้แค่ Space ที่แสดงอยู่ ถ้าแอปเป้าหมายอยู่คนละ
 * เดสก์ท็อป (เจ้าของจัด Warp ไว้อีก Space) จะได้ภาพแอปอื่นมาเป็น "หลักฐาน" ทั้งใบ
 * → เคยทำให้ระบบฟันธงผิดว่า "ส่งไม่สำเร็จ" ทั้งที่คำสั่งรันจริง (5 ส.ค. 2026)
 */
export async function snap(label: string, app?: string): Promise<string | null> {
  if (app) {
    try {
      const { captureWindow } = await import("./kiki-window");
      const w = await captureWindow(app, label);
      if (w) return w;
    } catch { /* หาหน้าต่างไม่ได้ก็ถอยไปแคปทั้งจอ */ }
  }
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

  // ===== ด่านกันพิมพ์ผิดแชท (7 ส.ค. 2026) =====
  // เคสจริง: "พิมไปในแชทหน้านี้ว่า ปิดงาน" → target = "แชทหน้านี้" (คำอ้างอิง ไม่ใช่ชื่อ)
  // ระบบเอาไปค้นด้วย Cmd+K แล้วเกือบพิมพ์ลงแชทคนอื่นที่เปิดค้าง ("my darling") — ถอนไม่ได้ถ้าส่งไป
  // target กำกวม = ถือว่าไม่มี target (ห้ามเอาคำว่า "แชทหน้านี้" ไปพิมพ์ใส่ช่องค้นหา)
  const VAGUE_TARGET = /^(แช[ทต]|ห้อง|หน้า|อัน|ช่อง|ที่)?\s*(หน้า)?(นี้|นั้น|ปัจจุบัน|เดิม|ที่เปิดอยู่|ล่าสุด)\s*$/;
  const vagueTarget = !!opts.target && VAGUE_TARGET.test(opts.target.trim());
  const realTarget = vagueTarget ? "" : opts.target;

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

  // แอปแชท + ไม่รู้ชื่อแชทปลายทางแน่ ๆ = ห้ามพิมพ์เด็ดขาด (จะลงแชทที่เปิดค้างอยู่ ซึ่งอาจเป็นใครก็ไม่รู้)
  // แคปหน้าจอปัจจุบันมาถามยืนยันแทน — เจ้าของเห็นเองว่าเปิดแชทไหนอยู่ แล้วค่อยสั่งใหม่พร้อมชื่อ
  if (CHAT_APPS.has(resolved.app) && !realTarget) {
    const s0 = await snap("confirm", resolved.app);
    if (s0) shots.push({ label: "หน้าจอตอนนี้", path: s0 });
    return {
      ok: false,
      app: resolved.app,
      target: opts.target,
      sent: false,
      shots,
      problem: `ยังไม่ได้พิมพ์ — ${vagueTarget ? `"${opts.target}" ไม่ใช่ชื่อแชท ผมไม่รู้ว่าหมายถึงแชทไหนแน่` : "ไม่ได้ระบุชื่อแชทปลายทาง"} และการพิมพ์ลงแชทที่เปิดค้างอยู่เสี่ยงส่งผิดคน — ดูภาพหน้าจอที่แนบมา ถ้าแชทที่เปิดอยู่คือที่ต้องการ บอกชื่อแชทนั้นมาแล้วผมพิมพ์ให้เลย`,
    };
  }

  // สลับแท็บ Warp ด้วยเลขแท็บ (Cmd+1..9) — แม่นกว่าค้นด้วยชื่อมาก
  const tabNo = realTarget && /^\s*(\d)\s*$/.test(realTarget) ? realTarget.trim() : "";
  if (tabNo && resolved.app === "Warp") {
    try {
      await osa(`tell application "System Events" to key code ${17 + Number(tabNo)} using {command down}`);
      await wait(1200);
    } catch { /* สลับไม่ได้ก็พิมพ์ในแท็บปัจจุบัน */ }
  }

  // สลับห้อง/แท็บด้วยชื่อ (Discord = Cmd+K · Warp = Cmd+P)
  else if (realTarget && resolved.opener) {
    try {
      await pressKey(resolved.opener.key, resolved.opener.mods);
      await wait(900);
      await pasteText(realTarget);
      await wait(1400);
      await pressReturn();
      await wait(1600);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      const s = await snap("target", resolved.app);
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

  const before = await snap("before", resolved.app);
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

  const typed = await snap("typed", resolved.app);
  if (typed) shots.push({ label: opts.send ? "พิมพ์แล้ว กำลังส่ง" : "พิมพ์ค้างไว้ ยังไม่ส่ง", path: typed });

  let sent = false;
  let verified: boolean | null = null;
  if (opts.send) {
    await pressReturn(opts.sendWith === "cmd-return" ? ["command down"] : []);
    await wait(1800);
    const after = await snap("sent", resolved.app);
    if (after) {
      shots.push({ label: "หลังกดส่ง", path: after });
      // ตรวจด้วยตาว่าข้อความขึ้นในห้องจริงไหม — กดปุ่มแล้วไม่ได้แปลว่าส่งสำเร็จ
      verified = await seenOnScreen(after, opts.text, resolved.app);
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
 *
 * **กับดักที่เจอตอนเทสจริง 5 ส.ค. 2026 — ภาพหลักฐานอาจเป็นของคนละ Space**
 * `screencapture` เก็บได้แค่ Space ที่กำลังแสดงอยู่บนจอหลัก ถ้าหน้าต่างแอปเป้าหมาย
 * อยู่คนละ Space (เจ้าของจัด Warp ไว้อีกเดสก์ท็อป) ภาพที่ได้จะเป็นของแอปอื่นทั้งใบ
 * ผลคือ: **คำสั่งรันสำเร็จจริง แต่ระบบรายงานว่า "ส่งไม่สำเร็จ"** (พิสูจน์แล้วด้วยไฟล์ token)
 * → จึงต้องถามวิชันเพิ่มว่า "ภาพนี้เป็นของแอปที่เราสั่งไหม" ไม่ใช่ก็คืน null (ตรวจไม่ได้)
 *   ไม่ใช่ false — เพราะ "มองไม่เห็น" คนละเรื่องกับ "เห็นแล้วว่าไม่มี"
 */
export async function seenOnScreen(shotPath: string, text: string, app?: string): Promise<boolean | null> {
  try {
    const { askExtractor } = await import("./kiki");
    const raw = await askExtractor(
      `ดูภาพหน้าจอที่ path นี้: ${shotPath}\n\nข้อความที่เพิ่งพยายามส่งคือ: """${text.slice(0, 200)}"""\n` +
        (app ? `แอปที่ควรอยู่ในภาพคือ: ${app}\n` : "") +
        `\nตอบ JSON เท่านั้น: {"appVisible":true/false,"sent":true/false,"where":"เห็นตรงไหน หรือเหตุผลสั้น ๆ"}\n` +
        `appVisible: ในภาพเห็นหน้าต่างของแอปที่ระบุไว้ไหม (ไม่ระบุแอป = ตอบ true)\n` +
        `sent: ข้อความนั้นปรากฏเป็น "ข้อความที่ส่งไปแล้ว" ในหน้าต่างแชท/เทอร์มินัลหรือยัง (ยังค้างในช่องพิมพ์ไม่นับ)`,
      { imagePaths: [shotPath], timeoutMs: 60_000 },
    );
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]) as { sent?: boolean; appVisible?: boolean };
    // ภาพไม่มีแอปเป้าหมายอยู่เลย = ตรวจไม่ได้ ห้ามฟันธงว่าล้มเหลว
    if (app && j.appVisible === false) return null;
    return Boolean(j.sent);
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
    const s = await snap("proof", resolved.app);
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
    const s = await snap("switch", resolved.app);
    if (s) shots.push({ label: `เปิด ${target} ใน ${resolved.app} แล้ว`, path: s });
    return { ok: true, app: resolved.app, target, sent: false, shots };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    const s = await snap("switchfail", resolved.app);
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

/**
 * สั่งคำสั่งใน Warp แล้วรอผล + แคปหน้าจอ
 *
 * **เปิดแท็บใหม่เสมอถ้าเจ้าของไม่ได้ระบุแท็บ** (เจ้าของเตือนเอง 5 ส.ค. 2026)
 * เดิมพิมพ์ลงแท็บที่โฟกัสอยู่ ซึ่งบ่อยครั้งคือแท็บที่มีเซสชัน Claude กำลังทำงานอยู่
 * → คำสั่งจะกลายเป็นข้อความสั่ง Claude แทนที่จะเป็นคำสั่งเชลล์ กวนงานที่รันค้างอยู่
 * แท็บใหม่ = พื้นที่สะอาด ไม่มีอะไรให้กวน · ระบุแท็บมาเอง = เจ้าของรับผิดชอบเอง ไม่แตะ
 */
export async function runInWarp(command: string, opts: { tab?: string; waitMs?: number } = {}): Promise<GuiResult> {
  const shots: { label: string; path: string }[] = [];
  if (!opts.tab) {
    try {
      await osa(`tell application "Warp" to activate`);
      await wait(1200);
      await pressKey("t", ["command down"]); // Cmd+T = แท็บใหม่
      await wait(1500);
      const s = await snap("warpnewtab", "Warp");
      if (s) shots.push({ label: "เปิดแท็บใหม่ (ไม่แตะแท็บที่ทำงานค้างอยู่)", path: s });
    } catch {
      // เปิดแท็บใหม่ไม่ได้ = ห้ามพิมพ์ลงแท็บเดิม เสี่ยงไปกวนเซสชันที่รันอยู่
      return {
        ok: false, app: "Warp", sent: false, shots,
        problem: "เปิดแท็บใหม่ใน Warp ไม่ได้ — ไม่พิมพ์ลงแท็บเดิมเพราะอาจไปกวนงานที่รันค้างอยู่",
      };
    }
  }
  const r = await typeInApp({ app: "Warp", target: opts.tab, text: command, send: true });
  r.shots.unshift(...shots);
  if (!r.ok) return r;
  await wait(opts.waitMs ?? 4000); // รอคำสั่งทำงานก่อนแคปผล
  const s = await snap("warpresult", "Warp");
  if (s) r.shots.push({ label: "ผลหลังรันคำสั่ง", path: s });
  return r;
}
