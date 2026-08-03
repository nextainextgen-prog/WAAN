import { chromium, type Page } from "playwright";

/**
 * ติดตามพัสดุจาก track.thailandpost.co.th
 *
 * ทำไมสแครปหน้าเว็บ ไม่ใช้ API: API ทางการ (trackapi.thailandpost.co.th) ต้องสมัคร token
 * ยังไม่มีในระบบ — หน้าเว็บเปิดดูได้ตรง ๆ ไม่มี captcha (ทดสอบแล้ว 17 ก.ค. 2026)
 * ถ้าวันไหนเว็บใส่ captcha มา ต้องย้ายไป API ทางการ
 *
 * ค้นได้สูงสุด 10 เลขต่อครั้ง (คั่นด้วย comma) — เปิด browser ครั้งเดียวจบ
 */

const TRACK_URL = "https://track.thailandpost.co.th/";
const CACHE_TTL_MS = 30 * 60 * 1000; // สถานะเปลี่ยนช้า ไม่ต้องยิงทุกครั้งที่แอดมินถาม

// เลขพัสดุไทย: 2 ตัวอักษร + 9 ตัวเลข + 2 ตัวอักษร (RL404969533TH)
const TRACK_RE = /\b([A-Z]{2}\d{9}[A-Z]{2})\b/g;

export type TrackStage = 1 | 2 | 3 | 4;

export interface TrackEvent {
  at: string; // 11/07/2026 10:21
  detail: string;
}

export interface TrackResult {
  trackingNo: string;
  ok: boolean;
  error?: string;
  headline?: string; // "นำจ่ายสำเร็จ [ ที่ทำการไปรษณีย์ หางดง ]"
  recipient?: string; // ชื่อผู้รับ
  statusText?: string; // "ผู้รับได้รับสิ่งของเรียบร้อยแล้ว"
  stage?: TrackStage; // 1 รับเข้าระบบ · 2 ระหว่างขนส่ง · 3 ออกไปนำจ่าย · 4 นำจ่ายสำเร็จ
  delivered?: boolean;
  lastAt?: string;
  events?: TrackEvent[];
}

export const STAGE_LABEL: Record<TrackStage, string> = {
  1: "รับเข้าระบบ",
  2: "ระหว่างขนส่ง",
  3: "ออกไปนำจ่าย",
  4: "นำจ่ายสำเร็จ",
};

/** ดึงเลขพัสดุออกจากข้อความในชีต — ช่องนี้มีข้อความปนเยอะ ("RL286323346TH โดนตีกลับ", 2 เลขในช่องเดียว) */
export function extractTrackingNos(raw: string): string[] {
  const s = String(raw || "").toUpperCase().replace(/\s+/g, " ");
  return [...new Set([...s.matchAll(TRACK_RE)].map((m) => m[1]))];
}

/** ข้อความที่เหลือหลังตัดเลขพัสดุออก = หมายเหตุที่แอดมินพิมพ์ไว้ ("โดนตีกลับ", "รอ 50 ทวิ ฉบับจริง") */
export function trackingNote(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s
    .replace(new RegExp(TRACK_RE.source, "gi"), " ")
    .replace(/[-–—,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// วันที่บนเว็บไปรษณีย์เป็น พ.ศ. ("11/07/2569") — แปลงเป็น ค.ศ. ให้ตรงกับที่อื่นในระบบ
function toChristianYear(s: string): string {
  return s.replace(/(\d{2})\/(\d{2})\/(\d{4})/g, (_m, d, mo, y) => {
    const n = Number(y);
    return `${d}/${mo}/${n > 2500 ? n - 543 : n}`;
  });
}

// ขั้นที่ไปถึงแล้ว — ดูจากข้อความล่าสุด (เว็บไม่ได้ติดคลาส active ให้ตรง ๆ)
function stageOf(text: string): TrackStage {
  if (/นำจ่ายสำเร็จ|ผู้รับได้รับสิ่งของ|รับสิ่งของเรียบร้อย/.test(text)) return 4;
  if (/ระหว่างการนำจ่าย|ออกไปนำจ่าย|อยู่ระหว่างการนำจ่าย/.test(text)) return 3;
  if (/ส่งออกจาก|ศูนย์คัดแยก|ระหว่างขนส่ง|ถึงที่ทำการ/.test(text)) return 2;
  return 1;
}

interface Cached {
  at: number;
  res: TrackResult;
}
const cache = new Map<string, Cached>();

async function searchTracking(page: Page, nos: string[]): Promise<void> {
  await page.goto(TRACK_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  const box = page.locator("textarea, input[type=text]").first();
  await box.click({ timeout: 10000 });
  // ช่องนี้เป็น Angular — ใช้ pressSequentially เหมือนบทเรียนจาก thunder_expiry ไม่ใช้ .fill()
  await box.pressSequentially(nos.join(","), { delay: 25 });
  const btn = page.locator("button").filter({ hasText: /ค้นหา/ }).first();
  if (await btn.count().catch(() => 0)) await btn.click().catch(() => {});
  else await page.keyboard.press("Enter");
  // รอผลจริง ไม่ใช่แค่ timeout ตายตัว
  await page
    .waitForFunction(() => !!document.querySelector(".box-list-search") || /ไม่พบข้อมูล/.test(document.body.innerText), null, {
      timeout: 30000,
      polling: 500,
    })
    .catch(() => {});
  await page.waitForTimeout(1500);
}

interface RawCard {
  no: string;
  notFound: boolean;
  headline: string;
  cardText: string;
  events: TrackEvent[];
}

/**
 * อ่านผลลัพธ์ทีละพัสดุ
 *
 * โครงหน้าเว็บ: .box-list-search = กล่องรวมผลทั้งหมด (มีกล่องเดียว)
 *               .box-list-detail = หนึ่งกล่องต่อหนึ่งเลขพัสดุ  ← ตัวนี้ต่างหากที่ต้องวน
 * เคยพลาดมาแล้ว: วน .box-list-search แล้วเช็คว่ามีเลขนี้อยู่ในข้อความไหม → ทุกเลขแมตช์กล่องเดียวกันหมด
 * เลยได้สถานะของพัสดุใบแรกไปทุกใบ (เลขมั่ว ๆ ก็ยังขึ้น "นำจ่ายสำเร็จ")
 *
 * เขียน arrow function inline ส่งเข้า page.evaluate ตรง ๆ — อย่าแยกเป็น named function ข้างนอก
 * แล้วส่ง reference เข้ามา เพราะ bundler จะแปะ helper `__name` ทำให้พังในเบราว์เซอร์
 */
async function readCards(page: Page): Promise<RawCard[]> {
  return page.evaluate(() => {
    const clean = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();
    return [...document.querySelectorAll(".box-list-detail")].map((card) => {
      const text = (card as HTMLElement).innerText || "";
      const no = (text.match(/\b[A-Z]{2}\d{9}[A-Z]{2}\b/) || [""])[0];
      const notFound = /ไม่พบข้อมูล/.test(text);
      const headline = clean(card.querySelector(".title-status, .text-status, h3, h4")?.textContent);
      const events = [...card.querySelectorAll(".event-status")].map((e) => {
        const t = clean((e as HTMLElement).innerText);
        const m = t.match(/^(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})\s*น?\.?\s*([\s\S]*)$/);
        return m ? { at: m[1], detail: clean(m[2]) } : { at: "", detail: t };
      });
      return { no, notFound, headline, cardText: text, events };
    });
  });
}

/**
 * ติดตามพัสดุหลายเลขในครั้งเดียว + แคปภาพการ์ดผลลัพธ์
 * คืน shotBase64 แยกต่างหาก (ภาพเดียวครอบทุกเลขที่ค้น — ตรงกับที่โด้อยากได้)
 */
export async function trackParcels(
  trackingNos: string[],
  opts: { shot?: boolean } = {},
): Promise<{ results: TrackResult[]; shotBase64?: string; error?: string }> {
  const nos = [...new Set(trackingNos.map((n) => n.toUpperCase().trim()).filter(Boolean))].slice(0, 10);
  if (!nos.length) return { results: [] };

  // ใช้แคชถ้ายังสด และไม่ต้องการภาพ
  if (!opts.shot) {
    const hit = nos.map((n) => cache.get(n)).filter((c): c is Cached => !!c && Date.now() - c.at < CACHE_TTL_MS);
    if (hit.length === nos.length) return { results: hit.map((h) => h.res) };
  }

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 2, locale: "th-TH" });
    // bundler บางตัว (esbuild ที่ tsx ใช้) แปะ helper __name ให้ฟังก์ชันที่มีชื่อ พอโค้ดใน page.evaluate
    // ไปรันในเบราว์เซอร์เลยพัง "__name is not defined" — ใส่ shim ว่างไว้กันไว้ก่อน ไม่กระทบอะไร
    await ctx.addInitScript(() => {
      const w = window as unknown as { __name?: (f: unknown) => unknown };
      if (!w.__name) w.__name = (f: unknown) => f;
    });
    const page = await ctx.newPage();
    await searchTracking(page, nos);

    const raw = await readCards(page);

    const results: TrackResult[] = [];
    for (const n of nos) {
      const card = raw.find((c) => c.no === n);
      // ไม่พบข้อมูล = เลขผิด หรือพัสดุเก่าจนไปรษณีย์ลบข้อมูลทิ้งแล้ว (ของปี 2025 ส่วนใหญ่หายหมด)
      if (!card || card.notFound) {
        const res: TrackResult = { trackingNo: n, ok: false, error: "not_found" };
        cache.set(n, { at: Date.now(), res });
        results.push(res);
        continue;
      }
      const events = card.events.map((e) => ({ at: toChristianYear(e.at), detail: e.detail }));
      const latest = events[0]?.detail || card.headline || "";
      const stage = stageOf(latest || card.cardText);
      const recipient = card.cardText.match(/ชื่อผู้รับ\s*:\s*(.+)/)?.[1]?.split("\n")[0]?.trim();
      const statusText = card.cardText.match(/สถานะ\s*:\s*(.+)/)?.[1]?.split("\n")[0]?.trim();
      const res: TrackResult = {
        trackingNo: n,
        ok: true,
        headline: toChristianYear(card.headline || latest),
        recipient,
        statusText,
        stage,
        delivered: stage === 4,
        lastAt: events[0]?.at,
        events,
      };
      cache.set(n, { at: Date.now(), res });
      results.push(res);
    }

    let shotBase64: string | undefined;
    if (opts.shot) shotBase64 = await shotCard(page);
    return { results, shotBase64 };
  } catch (e) {
    return { results: [], error: e instanceof Error ? e.message : String(e) };
  } finally {
    await browser.close();
  }
}

// แคปเฉพาะการ์ดผลลัพธ์ (ตัดแบนเนอร์โฆษณา/เมนูทิ้ง) — ตรงกับส่วนที่โด้ชี้ให้แคป
async function shotCard(page: Page): Promise<string | undefined> {
  const clip = await page.evaluate(() => {
    const card = document.querySelector(".box-list-search") as HTMLElement | null;
    if (!card) return null;
    card.scrollIntoView({ block: "start" });
    window.scrollBy(0, -16);
    const r = card.getBoundingClientRect();
    return {
      x: Math.max(0, Math.floor(r.left) - 8),
      y: Math.max(0, Math.floor(r.top) - 8),
      width: Math.ceil(Math.min(r.width + 16, window.innerWidth - Math.max(0, r.left - 8))),
      height: Math.ceil(Math.min(r.height + 16, window.innerHeight - Math.max(0, r.top - 8))),
    };
  });
  await page.waitForTimeout(300);
  const buf =
    clip && clip.width > 40 && clip.height > 40
      ? await page.screenshot({ type: "png", clip }).catch(() => null)
      : await page.screenshot({ type: "png" }).catch(() => null);
  return buf?.toString("base64");
}

// แถบความคืบหน้าแบบข้อความ: ●━●━○━○
export function stageBar(stage: TrackStage): string {
  return ([1, 2, 3, 4] as TrackStage[]).map((s) => (s <= stage ? "●" : "○")).join("━");
}
