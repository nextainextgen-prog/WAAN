import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * แคปหน้าต่างข้าม Space (5 ส.ค. 2026)
 *
 * ปัญหาที่เจอจากการเทสจริง: `screencapture` เก็บได้แค่ Space ที่กำลังแสดงบนจอหลัก
 * เจ้าของจัด Warp ไว้อีกเดสก์ท็อป → ภาพ "หลักฐาน" ที่ Vex แนบไปเป็นภาพ Chrome ทั้งใบ
 * ทั้งที่คำสั่งรันสำเร็จจริง (พิสูจน์ด้วยไฟล์ token) แล้วตัวตรวจด้วยวิชันก็เลยฟันธงผิดว่า
 * "ส่งไม่สำเร็จ" — หลักฐานที่ผิดฝั่งแย่กว่าไม่มีหลักฐาน เพราะมันดูน่าเชื่อ
 *
 * ทางแก้: หา window id จาก CGWindowListCopyWindowInfo (เห็นทุก Space)
 * แล้วแคปด้วย `screencapture -l <id>` ซึ่งข้าม Space ได้
 */

const run = (cmd: string, args: string[], timeoutMs = 20_000): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.toString().slice(0, 300) || err.message));
      else resolve(stdout.toString());
    });
  });

export interface MacWindow {
  id: number;
  app: string;
  name: string;
  w: number;
  h: number;
}

function projectRoot(): string {
  return process.env.CHANGOH_ROOT?.trim() || process.cwd();
}

const SRC = () => path.join(projectRoot(), "scripts/mac/winlist.c");
const BIN = () => path.join(projectRoot(), ".vex-bin/winlist");

/** คอมไพล์ตัวช่วยครั้งแรก (หรือเมื่อซอร์สใหม่กว่าไบนารี) — ต้องมี clang จาก Command Line Tools */
async function ensureHelper(): Promise<string | null> {
  const src = SRC();
  const bin = BIN();
  if (!fs.existsSync(src)) return null;
  try {
    const needBuild = !fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(src).mtimeMs;
    if (needBuild) {
      fs.mkdirSync(path.dirname(bin), { recursive: true });
      await run("clang", ["-O2", "-framework", "ApplicationServices", "-o", bin, src], 120_000);
    }
    return fs.existsSync(bin) ? bin : null;
  } catch {
    return null; // ไม่มี clang / คอมไพล์ไม่ผ่าน = ถอยไปแคปทั้งจอเหมือนเดิม
  }
}

export async function listWindows(): Promise<MacWindow[]> {
  const bin = await ensureHelper();
  if (!bin) return [];
  try {
    return JSON.parse(await run(bin, [])) as MacWindow[];
  } catch {
    return [];
  }
}

/**
 * หาหน้าต่างของแอปที่ต้องการ — เอาใบที่ใหญ่ที่สุด (หน้าต่างหลัก ไม่ใช่ป๊อปอัป)
 * ชื่อ owner ที่ CoreGraphics คืนมาเป็นชื่อแอปจริง ("Warp") ไม่ใช่ชื่อโปรเซส ("stable")
 */
export async function findWindow(app: string): Promise<MacWindow | null> {
  const key = app.trim().toLowerCase();
  if (!key) return null;
  const wins = (await listWindows()).filter((w) => {
    const a = (w.app || "").toLowerCase();
    return a === key || a.includes(key) || key.includes(a);
  });
  if (!wins.length) return null;
  return wins.sort((x, y) => y.w * y.h - x.w * x.h)[0];
}

/**
 * แคปเฉพาะหน้าต่างของแอปนั้น (ข้าม Space ได้)
 * คืน null = หาไม่เจอ/แคปไม่ได้ → ให้ผู้เรียกถอยไปแคปทั้งจอ
 */
export async function captureWindow(app: string, label: string): Promise<string | null> {
  const win = await findWindow(app);
  if (!win) return null;
  const p = path.join(os.tmpdir(), `vex-${label}-${Date.now()}.png`);
  try {
    // -o = ไม่เอาเงาหน้าต่าง · -l <id> = เจาะจงหน้าต่าง (ข้าม Space)
    await run("screencapture", ["-x", "-o", "-l", String(win.id), p], 30_000);
    return fs.existsSync(p) && fs.statSync(p).size > 2000 ? p : null;
  } catch {
    return null;
  }
}
