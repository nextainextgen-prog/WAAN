import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

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
  amount: number | null; // คอลัมน์ "จำนวน" (ยอดจ่ายจริง — ยึดค่านี้)
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
}

function parseAmount(s: string): number | null {
  const m = s.replace(/[,\s]/g, "").match(/([\d]+\.\d{2}|\d+)/);
  return m ? Number(m[1]) : null;
}

// ดึงข้อมูลรายการถอนของยูสเซอร์จากระบบหลังบ้าน + แคปภาพแถวนั้น
export async function fetchSystemWithdraw(username: string): Promise<SystemFetchResult> {
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
    if (/\/auth\/sign-in/i.test(page.url())) {
      return { data: null, screenshot: null, error: "session_expired" };
    }

    // ค้นหาด้วยชื่อผู้ใช้ (ช่องค้นหา "ชื่อผู้ใช้")
    const search = page.locator('input').first();
    await search.fill(username).catch(() => {});
    const searchBtn = page.getByRole("button", { name: /ค้นหา/ });
    if (await searchBtn.count()) await searchBtn.first().click().catch(() => {});
    await page.waitForTimeout(2500);
    await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<void> } }).fonts.ready).catch(() => {});

    // หาแถวที่มีชื่อผู้ใช้ตรง แล้วอ่านข้อมูล
    const data = await page.evaluate((u: string) => {
      const rows = Array.from(document.querySelectorAll("tr, [role=row]"));
      for (const r of rows) {
        const txt = (r as HTMLElement).innerText || "";
        // ต้องมีคำว่ายูสเซอร์แบบตรงคำ (มีขอบเขต) เพื่อไม่จับผิดแถว
        const re = new RegExp(`(^|\\b|\\s)${u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\b|\\s|$)`);
        if (re.test(txt)) {
          const bankM = txt.match(/ธนาคาร[:\s]*([^\n\t]+)/);
          const accM = txt.match(/เลขบัญชี[:\s]*([0-9]+)/);
          const nameM = txt.match(/ชื่อบัญชี[:\s]*([^\n\t]+)/);
          const baht = txt.match(/฿\s*([\d,]+\.\d{2})/);
          const statusM = txt.match(/(รออนุมัติ|อนุมัติแล้ว|ปฏิเสธ|ยกเลิก)/);
          const dateM = txt.match(/(\d{1,2}\s*[ก-๙.]+\s*\d{4}[,\s]*\d{1,2}:\d{2})/);
          return {
            rowText: txt.slice(0, 400),
            bank: bankM ? bankM[1].trim() : "",
            account: accM ? accM[1].trim() : "",
            accountName: nameM ? nameM[1].trim() : "",
            amountRaw: baht ? baht[1] : "",
            status: statusM ? statusM[1] : "",
            createdAt: dateM ? dateM[1] : "",
          };
        }
      }
      return null;
    }, username);

    if (!data) {
      const shot = await page.screenshot({ type: "png" });
      return { data: null, screenshot: Buffer.from(shot), error: "not_found" };
    }

    const screenshot = Buffer.from(await page.screenshot({ type: "png" }));
    return {
      data: {
        username,
        amount: parseAmount(data.amountRaw),
        bank: data.bank,
        account: data.account,
        accountName: data.accountName,
        status: data.status,
        createdAt: data.createdAt,
        found: true,
      },
      screenshot,
    };
  } catch (e) {
    return { data: null, screenshot: null, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await browser.close();
  }
}
