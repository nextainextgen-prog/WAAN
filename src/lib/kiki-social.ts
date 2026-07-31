import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

/**
 * อ่านฟีด Facebook / X ของเจ้าของ (playwright + โปรไฟล์ล็อกอินถาวร)
 * ตั้งค่า: npm run kiki:social-auth (ล็อกอินทั้งสองเว็บครั้งเดียว)
 * เทคนิค: ดูด innerText ทั้งหน้า แล้วให้สมองสกัดโพสต์/ข่าวเอา — ทน DOM เปลี่ยนกว่า selector เจาะจง
 */

const PROFILE = () => process.env.KIKI_SOCIAL_PROFILE || path.join(process.cwd(), ".kiki-social-profile");

export function socialReady(): boolean {
  return fs.existsSync(PROFILE());
}

export interface FeedGrab {
  fb?: string;
  x?: string;
  issues: string[];
}

async function grabPage(context: import("playwright").BrowserContext, url: string, name: string, issues: string[]): Promise<string | undefined> {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(6000); // รอฟีดโหลด
    // เลื่อน 2 รอบให้โพสต์เข้ามาเพิ่ม
    for (let i = 0; i < 2; i++) {
      await page.mouse.wheel(0, 2500);
      await page.waitForTimeout(2500);
    }
    const text = (await page.evaluate(() => document.body.innerText)) || "";
    const t = text.replace(/\n{3,}/g, "\n\n").slice(0, 9000);
    // เจอหน้า login = session หลุด
    if (/log ?in|เข้าสู่ระบบ|sign ?in to x|create account/i.test(t.slice(0, 600)) && t.length < 3000) {
      issues.push(`${name}: session หลุด — รัน npm run kiki:social-auth ใหม่`);
      return undefined;
    }
    return t;
  } catch (e) {
    issues.push(`${name}: เปิดไม่สำเร็จ (${e instanceof Error ? e.message.slice(0, 80) : "error"})`);
    return undefined;
  } finally {
    await page.close().catch(() => {});
  }
}

export async function grabFeeds(): Promise<FeedGrab> {
  const issues: string[] = [];
  if (!socialReady()) return { issues: ["ยังไม่ได้ล็อกอิน — รัน npm run kiki:social-auth"] };
  // Chrome จริง + ปิดร่องรอย automation (เหมือนตอน auth) — ไม่งั้น X บล็อก/เด้ง login ทั้งที่ session ยังดี
  let context: import("playwright").BrowserContext;
  try {
    context = await chromium.launchPersistentContext(PROFILE(), {
      headless: true,
      channel: "chrome",
      viewport: { width: 1280, height: 900 },
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
      ignoreDefaultArgs: ["--enable-automation"],
    });
  } catch (e) {
    const locked = e instanceof Error && /ProcessSingleton|SingletonLock/i.test(e.message);
    return { issues: [locked ? "โปรไฟล์ถูกใช้อยู่ — ปิดหน้าต่าง auth (กด Enter ใน Warp) ก่อนครับ" : `เปิดเบราว์เซอร์ไม่ได้ (${e instanceof Error ? e.message.slice(0, 80) : "error"})`] };
  }
  try {
    const fb = await grabPage(context, "https://www.facebook.com/", "Facebook", issues);
    const x = await grabPage(context, "https://x.com/home", "X", issues);
    return { fb, x, issues };
  } finally {
    await context.close().catch(() => {});
  }
}

// ===== โหมดแคปโพสต์: ดึงโพสต์ทีละอัน (ข้อความ + ภาพแคปจริง) — เจ้าของขอ "แคปหน้าฟีดมาทุกโพสต์ที่พูดถึง" =====

export interface FeedPost {
  source: "เฟส" | "X";
  text: string;
  shotBase64?: string;
}

export async function grabFeedPosts(perSite = 4): Promise<{ posts: FeedPost[]; issues: string[] }> {
  const issues: string[] = [];
  if (!socialReady()) return { posts: [], issues: ["ยังไม่ได้ล็อกอิน — รัน npm run kiki:social-auth"] };
  let context: import("playwright").BrowserContext;
  try {
    context = await chromium.launchPersistentContext(PROFILE(), {
      headless: true,
      channel: "chrome",
      viewport: { width: 1280, height: 900 },
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
      ignoreDefaultArgs: ["--enable-automation"],
    });
  } catch (e) {
    const locked = e instanceof Error && /ProcessSingleton|SingletonLock/i.test(e.message);
    return { posts: [], issues: [locked ? "โปรไฟล์ถูกใช้อยู่ — ปิดหน้าต่าง auth ก่อนครับ" : "เปิดเบราว์เซอร์ไม่ได้"] };
  }
  const posts: FeedPost[] = [];
  const collect = async (url: string, selectors: string[], source: "เฟส" | "X", name: string) => {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(6000);
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(2500);
      const body = ((await page.evaluate(() => document.body.innerText)) || "").slice(0, 800);
      if (/log ?in|เข้าสู่ระบบ|sign ?in to x|create account/i.test(body) && body.length < 700) {
        issues.push(`${name}: session หลุด — รัน npm run kiki:social-auth ใหม่`);
        return;
      }
      for (const sel of selectors) {
        const els = page.locator(sel);
        const n = Math.min(await els.count().catch(() => 0), perSite * 3);
        let got = 0;
        for (let i = 0; i < n && got < perSite; i++) {
          const el = els.nth(i);
          try {
            const txt = ((await el.innerText({ timeout: 3000 })) || "").replace(/\n{2,}/g, "\n").trim();
            if (txt.length < 40) continue; // ข้ามกล่องเปล่า/ปุ่ม
            await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
            const shot = await el.screenshot({ timeout: 6000 }).catch(() => null);
            posts.push({ source, text: txt.slice(0, 1200), shotBase64: shot ? shot.toString("base64") : undefined });
            got++;
          } catch { /* โพสต์นี้เก็บไม่ได้ ข้าม */ }
        }
        if (got > 0) break; // selector แรกที่ได้ผล พอแล้ว
      }
    } catch (e) {
      issues.push(`${name}: เปิดไม่สำเร็จ (${e instanceof Error ? e.message.slice(0, 60) : "error"})`);
    } finally {
      await page.close().catch(() => {});
    }
  };
  try {
    await collect("https://www.facebook.com/", ['div[role="feed"] > div', 'div[role="article"]'], "เฟส", "Facebook");
    await collect("https://x.com/home", ["article"], "X", "X");
  } finally {
    await context.close().catch(() => {});
  }
  return { posts, issues };
}
