import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";

/**
 * สะพานไป "Chrome ตัวจริงของเจ้าของ" (เจ้าของเลือกทาง A เอง 4 ส.ค. 2026)
 *
 * ทำไมต้องมี: fetch ธรรมดาอ่าน X / IG / Facebook ไม่ได้เลย (บังคับล็อกอิน) → ที่ผ่านมา Vex ได้หน้าเปล่า
 * แล้วเดาเนื้อหาเอา (เคสจริง: โพสต์ @arceyul)
 *
 * ข้อจำกัดของ Chrome เอง: ตั้งแต่ Chrome 136 ห้ามเปิด remote debugging บนโปรไฟล์ Default
 * → ใช้โปรไฟล์แยก ~/.vex-chrome (เจ้าของล็อกอินครั้งเดียว หน้าต่างจริง ใช้เองได้ตามปกติ)
 *
 * กติกาที่เจ้าของสั่ง: อ่านได้เสรี · "เขียน" (โพสต์/ตอบ/ส่ง DM) ต้องพิมพ์ค้างไว้ + แคปหน้าจอยืนยัน แล้วรอกดปุ่มเท่านั้น
 */

const PORT = Number(process.env.KIKI_CHROME_PORT || 9222);
const PROFILE = process.env.KIKI_CHROME_PROFILE || path.join(os.homedir(), ".vex-chrome");
const CHROME_BIN =
  process.env.KIKI_CHROME_BIN ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export const chromeCdpUrl = () => `http://127.0.0.1:${PORT}`;

export async function chromeAlive(): Promise<boolean> {
  try {
    const r = await fetch(`${chromeCdpUrl()}/json/version`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

/** เปิด Chrome โปรไฟล์ของ Vex (ถ้ายังไม่ได้เปิด) — หน้าต่างจริง เจ้าของเห็นและใช้ต่อได้ */
export async function ensureChrome(): Promise<{ ok: boolean; started: boolean; msg?: string }> {
  if (await chromeAlive()) return { ok: true, started: false };
  if (!fs.existsSync(CHROME_BIN)) return { ok: false, started: false, msg: `หา Chrome ไม่เจอที่ ${CHROME_BIN}` };
  try {
    fs.mkdirSync(PROFILE, { recursive: true });
    const child = spawn(
      CHROME_BIN,
      [
        `--remote-debugging-port=${PORT}`,
        `--user-data-dir=${PROFILE}`,
        "--restore-last-session",
        "--no-first-run",
        "--no-default-browser-check",
      ],
      { detached: true, stdio: "ignore" },
    );
    child.unref();
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await chromeAlive()) return { ok: true, started: true };
    }
    return { ok: false, started: false, msg: "เปิด Chrome แล้วแต่ยังต่อพอร์ตดีบักไม่ได้" };
  } catch (e) {
    return { ok: false, started: false, msg: e instanceof Error ? e.message.slice(0, 150) : "เปิด Chrome ไม่ได้" };
  }
}

async function connect(): Promise<{ browser: Browser; ctx: BrowserContext }> {
  const st = await ensureChrome();
  if (!st.ok) throw new Error(st.msg || "ต่อ Chrome ไม่ได้");
  const { chromium } = await import("playwright");
  const browser = await chromium.connectOverCDP(chromeCdpUrl(), { timeout: 15_000 });
  const ctx = browser.contexts()[0] || (await browser.newContext());
  return { browser, ctx };
}

/** ใช้แท็บใหม่ในเบราว์เซอร์จริง แล้วปิดเมื่อเสร็จ (ไม่ปิด Chrome ของเจ้าของ) */
export async function withPage<T>(fn: (page: Page) => Promise<T>, opts: { keepOpen?: boolean } = {}): Promise<T> {
  const { browser, ctx } = await connect();
  const page = await ctx.newPage();
  try {
    return await fn(page);
  } finally {
    if (!opts.keepOpen) await page.close().catch(() => {});
    await browser.close().catch(() => {}); // ตัดการเชื่อมต่อ CDP เฉย ๆ หน้าต่างจริงยังอยู่
  }
}

const LOGIN_WALL = /log in to|sign in to x|เข้าสู่ระบบเพื่อ|create an account|ยินดีต้อนรับกลับ|log into facebook/i;

export interface PageRead {
  url: string;
  title: string;
  text: string;
  shotBase64?: string;
  needLogin: boolean;
}

/** เปิดหน้าเว็บด้วยเซสชันจริงของเจ้าของ แล้วดูดข้อความ + แคปภาพเป็นหลักฐาน */
export async function readUrl(url: string, opts: { shot?: boolean; waitMs?: number; fullPage?: boolean } = {}): Promise<PageRead> {
  return withPage(async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(opts.waitMs ?? 4500);
    // เว็บโซเชียลโหลดเนื้อหาทีหลัง — รอ article/โพสต์โผล่ก่อน (ไม่มีก็ไปต่อ)
    await page.locator("article, [role='article'], main").first().waitFor({ timeout: 6000 }).catch(() => {});
    const title = await page.title().catch(() => "");
    const raw = (await page.evaluate(() => document.body?.innerText || "").catch(() => "")) as string;
    const text = raw.replace(/\n{3,}/g, "\n\n").trim();
    const shot = opts.shot === false ? undefined : await page.screenshot({ fullPage: !!opts.fullPage, timeout: 15_000 }).catch(() => null);
    return {
      url: page.url(),
      title,
      text,
      shotBase64: shot ? shot.toString("base64") : undefined,
      needLogin: text.length < 1200 && LOGIN_WALL.test(text),
    };
  });
}

// ===== โหมดเขียน: พิมพ์ค้างไว้ + แคปยืนยัน แล้วรอเจ้าของกดส่ง =====

export type SocialPlatform = "x" | "facebook" | "instagram" | "unknown";

export function platformOf(url: string): SocialPlatform {
  if (/(^|\/\/)(www\.)?(x|twitter)\.com/i.test(url)) return "x";
  if (/facebook\.com|fb\.com/i.test(url)) return "facebook";
  if (/instagram\.com/i.test(url)) return "instagram";
  return "unknown";
}

// ช่องพิมพ์ของแต่ละแพลตฟอร์ม (ไล่ทีละตัวจนกว่าจะเจอ — DOM เปลี่ยนบ่อย เลยเผื่อไว้หลายชั้น)
const REPLY_BOXES: Record<SocialPlatform, string[]> = {
  x: ['[data-testid="tweetTextarea_0"]', 'div[role="textbox"][contenteditable="true"]'],
  facebook: ['div[contenteditable="true"][role="textbox"]', 'form div[contenteditable="true"]'],
  instagram: ['textarea[aria-label*="omment" i]', 'textarea[placeholder*="omment" i]', 'div[contenteditable="true"][role="textbox"]'],
  unknown: ['div[contenteditable="true"]', "textarea"],
};

// ตัวชี้ว่า "ล็อกอินอยู่จริง" — ต้องเจอก่อนถึงจะยอมพิมพ์
// (เทส 4 ส.ค.: หน้า compose ของ X ตอนไม่ได้ล็อกอินก็มีช่อง textbox ให้พิมพ์ ระบบเลยเคลมว่าพิมพ์สำเร็จทั้งที่ไม่ได้เข้าโพสต์จริง)
const LOGGED_IN_PROBE: Record<SocialPlatform, string> = {
  x: '[data-testid="SideNav_AccountSwitcher_Button"], [data-testid="AppTabBar_Home_Link"], [data-testid="tweetButtonInline"], [data-testid="tweetButton"]',
  facebook: '[aria-label="Your profile"], [aria-label="บัญชีของคุณ"], div[role="feed"], [aria-label="Account"]',
  instagram: 'a[href="/explore/"], svg[aria-label="Home"], a[href*="/direct/inbox"]',
  unknown: "",
};

const SEND_BUTTONS: Record<SocialPlatform, string[]> = {
  x: ['[data-testid="tweetButtonInline"]', '[data-testid="tweetButton"]'],
  facebook: ['div[aria-label="Comment"]', 'div[aria-label="ความคิดเห็น"]'],
  instagram: ['div[role="button"]:has-text("Post")', 'button:has-text("Post")', 'button:has-text("โพสต์")'],
  unknown: [],
};

export interface DraftResult {
  ok: boolean;
  url: string;
  platform: SocialPlatform;
  typed: string;
  shotBase64?: string;
  msg: string;
}

/**
 * เปิดโพสต์ → พิมพ์ข้อความค้างไว้ในช่องตอบ → แคปหน้าจอ → "ไม่กดส่ง"
 * แท็บถูกเปิดค้างไว้ในเบราว์เซอร์จริง เพื่อให้กดส่งทีหลังได้ (หรือเจ้าของแก้เองในจอ)
 */
/**
 * เปิดแท็บด้วย Chrome เอง (ไม่ใช่ผ่าน Playwright)
 * สำคัญ: แท็บที่ Playwright สร้าง จะถูกปิดทิ้งตอนตัดการเชื่อมต่อ CDP (เทสเจอจริง 4 ส.ค.)
 * → ร่างที่พิมพ์ค้างไว้จะหายก่อนเจ้าของกดยืนยัน ต้องให้เบราว์เซอร์เป็นเจ้าของแท็บเอง
 */
async function newBrowserTab(url: string): Promise<void> {
  const r = await fetch(`${chromeCdpUrl()}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`เปิดแท็บใน Chrome ไม่ได้ (${r.status})`);
}

function samePage(a: string, b: string): boolean {
  const norm = (u: string) => u.split("?")[0].replace(/\/$/, "").toLowerCase();
  return norm(a) === norm(b) || norm(a).startsWith(norm(b)) || norm(b).startsWith(norm(a));
}

export async function draftReply(url: string, message: string): Promise<DraftResult> {
  const platform = platformOf(url);
  const st = await ensureChrome();
  if (!st.ok) throw new Error(st.msg || "ต่อ Chrome ไม่ได้");
  await newBrowserTab(url);
  const { browser, ctx } = await connect();
  try {
    // รอให้แท็บโหลด แล้วหาให้เจอ (โซเชียลชอบ redirect ระหว่างโหลด)
    let page: Page | undefined;
    for (let i = 0; i < 12 && !page; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const cand = ctx.pages().filter((p) => samePage(p.url(), url));
      page = cand[cand.length - 1];
    }
    if (!page) {
      return { ok: false, url, platform, typed: "", msg: "เปิดแท็บแล้วแต่หาไม่เจอใน Chrome (ลองใหม่อีกทีครับ)" };
    }
    return await (async () => {
      await page.waitForTimeout(3500);
      // ต้องล็อกอินจริงก่อน ไม่งั้นพิมพ์ลงช่องมั่ว แล้วรายงานผิดว่าสำเร็จ
      const probe = LOGGED_IN_PROBE[platform];
      if (probe) {
        const seen = await page.locator(probe).first().count().catch(() => 0);
        if (!seen) {
          const shot = await page.screenshot({ timeout: 15_000 }).catch(() => null);
          await page.close().catch(() => {});
          return {
            ok: false,
            url,
            platform,
            typed: "",
            shotBase64: shot ? shot.toString("base64") : undefined,
            msg: `ยังไม่ได้ล็อกอิน ${platform.toUpperCase()} ในโปรไฟล์ Chrome ของผมครับ — ล็อกอินในหน้าต่าง Chrome ที่ผมเปิดไว้ก่อน แล้วสั่งใหม่อีกที`,
          };
        }
      }
      let box = null;
      for (const sel of REPLY_BOXES[platform]) {
        const l = page.locator(sel).first();
        if (await l.count().catch(() => 0)) {
          try {
            await l.scrollIntoViewIfNeeded({ timeout: 4000 });
            await l.click({ timeout: 6000 });
            box = l;
            break;
          } catch { /* ตัวถัดไป */ }
        }
      }
      if (!box) {
        const shot = await page.screenshot({ timeout: 15_000 }).catch(() => null);
        return {
          ok: false,
          url: page.url(),
          platform,
          typed: "",
          shotBase64: shot ? shot.toString("base64") : undefined,
          msg: "เปิดโพสต์ได้ แต่หาช่องพิมพ์ตอบไม่เจอ (อาจต้องล็อกอิน หรือโพสต์ปิดคอมเมนต์)",
        };
      }
      // พิมพ์แบบคนจริง (หน่วงต่อตัว) — กันโดนระบบมองว่าเป็นบอท
      await page.keyboard.type(message, { delay: 25 });
      await page.waitForTimeout(800);
      const shot = await page.screenshot({ timeout: 15_000 }).catch(() => null);
      return {
        ok: true,
        url: page.url(),
        platform,
        typed: message,
        shotBase64: shot ? shot.toString("base64") : undefined,
        msg: "พิมพ์ค้างไว้แล้ว รอกดส่ง",
      };
    })();
  } finally {
    await browser.close().catch(() => {}); // ตัด CDP เฉย ๆ — แท็บที่ Chrome เป็นเจ้าของยังเปิดค้างไว้
  }
}

/** กดส่งข้อความที่พิมพ์ค้างไว้ในแท็บเดิม (เรียกหลังเจ้าของกดปุ่มยืนยันเท่านั้น) */
export async function sendDraft(url: string): Promise<{ ok: boolean; msg: string; shotBase64?: string }> {
  const platform = platformOf(url);
  const { browser, ctx } = await connect();
  try {
    const pages = ctx.pages();
    const matches = pages.filter((p) => samePage(p.url(), url));
    const page = matches[matches.length - 1];
    if (!page) return { ok: false, msg: "หาแท็บที่พิมพ์ค้างไว้ไม่เจอแล้ว (อาจถูกปิดไป) — สั่งร่างใหม่อีกทีครับ" };
    let clicked = false;
    for (const sel of SEND_BUTTONS[platform]) {
      const b = page.locator(sel).first();
      if (await b.count().catch(() => 0)) {
        try {
          await b.click({ timeout: 8000 });
          clicked = true;
          break;
        } catch { /* ลองตัวถัดไป */ }
      }
    }
    if (!clicked) {
      // ทางลัดมาตรฐานของ X/FB: Ctrl+Enter (mac ใช้ Meta+Enter ก็ได้)
      await page.keyboard.press("Control+Enter").catch(() => {});
      await page.waitForTimeout(700);
      await page.keyboard.press("Meta+Enter").catch(() => {});
    }
    await page.waitForTimeout(3500);
    const shot = await page.screenshot({ timeout: 15_000 }).catch(() => null);
    await page.close().catch(() => {});
    return { ok: true, msg: clicked ? "กดส่งแล้ว" : "กดส่งด้วยคีย์ลัดแล้ว", shotBase64: shot ? shot.toString("base64") : undefined };
  } finally {
    await browser.close().catch(() => {});
  }
}

/** ยกเลิกร่าง: ปิดแท็บที่เปิดค้าง */
export async function discardDraft(url: string): Promise<void> {
  const { browser, ctx } = await connect().catch(() => ({ browser: null, ctx: null }) as { browser: Browser | null; ctx: BrowserContext | null });
  if (!browser || !ctx) return;
  try {
    for (const p of ctx.pages()) if (samePage(p.url(), url)) await p.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }
}

/** เช็คสถานะล็อกอินของแต่ละแพลตฟอร์ม (ไว้บอกเจ้าของว่าต้องไปล็อกอินอันไหน) */
export async function socialLoginStatus(): Promise<{ site: string; loggedIn: boolean }[]> {
  const sites: { site: string; url: string; probe: string }[] = [
    { site: "X", url: "https://x.com/home", probe: '[data-testid="SideNav_AccountSwitcher_Button"], [data-testid="AppTabBar_Home_Link"]' },
    { site: "Facebook", url: "https://www.facebook.com/", probe: '[aria-label="Your profile"], [role="navigation"] [aria-label*=" profile" i], div[role="feed"]' },
    { site: "Instagram", url: "https://www.instagram.com/", probe: 'a[href="/explore/"], svg[aria-label="Home"], a[href*="/direct/inbox"]' },
  ];
  const out: { site: string; loggedIn: boolean }[] = [];
  for (const s of sites) {
    try {
      const ok = await withPage(async (page) => {
        await page.goto(s.url, { waitUntil: "domcontentloaded", timeout: 40_000 });
        // โซเชียลโหลดช้า — รอจนเจอตัวชี้ว่าล็อกอิน สูงสุด 15 วิ (เคยตอบผิดว่า "ยังไม่ล็อกอิน" เพราะรอแค่ 3.5 วิ)
        for (let i = 0; i < 15; i++) {
          if ((await page.locator(s.probe).first().count().catch(() => 0)) > 0) return true;
          await page.waitForTimeout(1000);
        }
        return false;
      });
      out.push({ site: s.site, loggedIn: ok });
    } catch {
      out.push({ site: s.site, loggedIn: false });
    }
  }
  return out;
}
