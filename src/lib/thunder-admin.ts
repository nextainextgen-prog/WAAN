import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { parseDateLoose, sameDay, type DateYMD } from "./aff-notify";

const BASE = (process.env.THUNDER_ADMIN_URL || "https://old.thunder.in.th").replace(/\/$/, "");
function sessionPath(): string {
  return process.env.THUNDER_SESSION_PATH || path.join(process.cwd(), ".thunder-session.json");
}

// มี session ที่เก็บไว้ไหม (เก็บครั้งเดียวด้วย npm run thunder:auth — ผ่าน reCAPTCHA ตอน login เอง)
export function thunderSessionReady(): boolean {
  return fs.existsSync(sessionPath());
}

export interface SystemWithdraw {
  username: string;
  amount: number | null; // คอลัมน์ "จำนวน" (ยอดจ่ายจริง/สุทธิ — ยึดค่านี้)
  prevBonus: number | null; // คอลัมน์ "ยอดโบนัสก่อนหน้า" (ยอดตั้ง/ก่อนหักภาษี = เลขกลม)
  bank: string;
  account: string;
  accountName: string;
  status: string;
  createdAt: string;
  found: boolean;
}

export interface SystemFetchResult {
  data: SystemWithdraw | null;
  screenshot: Buffer | null;
  error?: "no_session" | "session_expired" | "not_found" | string;
  matchedByNoti?: boolean; // เลือกแถวได้ตรงวันที่/ยอดจาก noti ไหม
  rowCount?: number; // จำนวนรายการของยูสเซอร์นี้ในระบบ
}

function parseAmount(s: string): number | null {
  const m = s.replace(/[,\s]/g, "").match(/([\d]+\.\d{2}|\d+)/);
  return m ? Number(m[1]) : null;
}

// ดึงข้อมูลรายการถอนของยูสเซอร์จากระบบหลังบ้าน + แคปภาพแถวนั้น
// opts.expectedDate / expectedAmount = จาก noti ระบบ → เลือกแถวให้ตรงรายการ (กันหยิบผิดแถวเมื่อมีหลายรายการ)
export async function fetchSystemWithdraw(
  username: string,
  opts: { expectedDate?: DateYMD | null; expectedAmount?: number | null } = {},
): Promise<SystemFetchResult> {
  if (!thunderSessionReady()) return { data: null, screenshot: null, error: "no_session" };

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({
      storageState: sessionPath(),
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      locale: "th-TH",
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/admin/affiliate`, { waitUntil: "networkidle", timeout: 30000 });

    // ถ้าเด้งไปหน้า login = session หมดอายุ
    if (/\/auth\/sign-in|\/auth\/login/i.test(page.url())) {
      return { data: null, screenshot: null, error: "session_expired" };
    }

    // SPA โหลดแต่ไม่เรนเดอร์เนื้อหา (token หมดอายุ แม้ URL ไม่เด้ง login) → body ว่าง = ถือว่า session หมด
    await page.waitForTimeout(1800);
    const uiOk = await page
      .evaluate(() => /ค้นหา|ชื่อผู้ใช้|Affiliate|จัดการ|มีข้อมูล|ยอดโบนัส/i.test(document.body.innerText || ""))
      .catch(() => false);
    if (!uiOk) return { data: null, screenshot: null, error: "session_expired" };

    // ค้นหาด้วยชื่อผู้ใช้ (ช่องค้นหา "ชื่อผู้ใช้")
    const search = page.locator('input').first();
    await search.fill(username).catch(() => {});
    const searchBtn = page.getByRole("button", { name: /ค้นหา/ });
    if (await searchBtn.count()) await searchBtn.first().click().catch(() => {});
    await page.waitForTimeout(2500);
    await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<void> } }).fonts.ready).catch(() => {});

    // เก็บ "ทุกแถว" ที่มีชื่อผู้ใช้ตรง (มีได้หลายรายการ) แล้วค่อยเลือกแถวที่ตรงวันที่/ยอดใน Node
    const allRows = await page.evaluate((u: string) => {
      const rows = Array.from(document.querySelectorAll("tr, [role=row]"));
      const re = new RegExp(`(^|\\b|\\s)${u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\b|\\s|$)`);
      const out: Array<Record<string, string>> = [];
      for (const r of rows) {
        const txt = (r as HTMLElement).innerText || "";
        if (!re.test(txt)) continue;
        const bankM = txt.match(/ธนาคาร[:\s]*([^\n\t]+)/);
        const accM = txt.match(/เลขบัญชี[:\s]*([0-9]+)/);
        const nameM = txt.match(/ชื่อบัญชี[:\s]*([^\n\t]+)/);
        const bahts = [...txt.matchAll(/฿\s*([\d,]+\.\d{2})/g)].map((m) => m[1]); // ฿[0]=จำนวน(สุทธิ) ฿[1]=ยอดโบนัสก่อนหน้า
        const statusM = txt.match(/(รออนุมัติ|อนุมัติแล้ว|ปฏิเสธ|ยกเลิก)/);
        const dateM = txt.match(/(\d{1,2}\s*[ก-๙.]+\s*\d{4}[,\s]*\d{1,2}:\d{2})/);
        out.push({
          rowText: txt.slice(0, 400),
          bank: bankM ? bankM[1].trim() : "",
          account: accM ? accM[1].trim() : "",
          accountName: nameM ? nameM[1].trim() : "",
          amountRaw: bahts[0] || "",
          prevBonusRaw: bahts[1] || "",
          status: statusM ? statusM[1] : "",
          createdAt: dateM ? dateM[1] : "",
        });
      }
      return out;
    }, username);

    if (!allRows.length) {
      const shot = await page.screenshot({ type: "png" });
      return { data: null, screenshot: Buffer.from(shot), error: "not_found" };
    }

    // เลือกแถว: ตรง "วันที่" จาก noti ก่อน → ไม่มีก็ลองตรง "ยอด" → ไม่งั้นแถวแรก (ล่าสุด)
    let picked = opts.expectedDate
      ? allRows.find((r) => sameDay(parseDateLoose(r.createdAt), opts.expectedDate!))
      : undefined;
    if (!picked && opts.expectedAmount != null)
      picked = allRows.find((r) => parseAmount(r.amountRaw) === opts.expectedAmount);
    const data = picked || allRows[0];
    const matchedByNoti = Boolean(picked);

    const screenshot = Buffer.from(await page.screenshot({ type: "png" }));
    return {
      data: {
        username,
        amount: parseAmount(data.amountRaw),
        prevBonus: parseAmount(data.prevBonusRaw),
        bank: data.bank,
        account: data.account,
        accountName: data.accountName,
        status: data.status,
        createdAt: data.createdAt,
        found: true,
      },
      screenshot,
      matchedByNoti,
      rowCount: allRows.length,
    };
  } catch (e) {
    return { data: null, screenshot: null, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await browser.close();
  }
}
