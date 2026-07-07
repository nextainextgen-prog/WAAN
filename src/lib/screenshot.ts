import { chromium } from "playwright";
import { createSession, SESSION_COOKIE, type SessionUser } from "./auth";
import { db } from "./db";

// แม็ปคำถาม → หน้าเว็บที่เกี่ยวข้อง (ใช้คีย์เวิร์ด เร็ว/แม่นยำ/คุมได้)
// เรียงจากเฉพาะเจาะจง → กว้าง เพื่อให้ตรงหน้าที่สุด
const PAGE_RULES: { re: RegExp; path: string; label: string }[] = [
  { re: /ทุนไหน|รายการทุน|ตารางทุน|บอร์ดทุน|คัมบัง|kanban|จัดการทุน|ใกล้ครบ|ครบกำหนด|deadline|ดูทุน/i, path: "/grants", label: "หน้าจัดการทุนวิจัย" },
  { re: /ไทม์ไลน์|time ?line|เส้นเวลา|ปฏิทินทุน|กำหนดการ/i, path: "/timeline", label: "หน้าไทม์ไลน์" },
  { re: /เอกสาร|คืนเงิน|รอเซ็น|รออนุมัติ|ไฟล์เข้า|inbox|เซ็นเอกสาร|อนุมัติเอกสาร/i, path: "/documents", label: "หน้าจัดการเอกสาร" },
  { re: /สไลด์|slide|พรีเซนต์|เด็ค|deck|นำเสนอ/i, path: "/slides", label: "หน้าสไลด์" },
  { re: /นำเข้า|import|อัปโหลดข้อมูล|วางข้อมูล/i, path: "/import", label: "หน้านำเข้าข้อมูล" },
  { re: /ตั้งค่า|setting|โปรไฟล์|บัญชีผู้ใช้|ธีม/i, path: "/settings", label: "หน้าตั้งค่า" },
  { re: /เลขา|แชทในเว็บ|ประวัติแชท|ผู้ช่วย/i, path: "/secretary", label: "หน้าผู้ช่วยเลขา" },
  // กว้างสุด: คำถามข้อมูล/ภาพรวม/OKR → แดชบอร์ด
  { re: /ทุน|ยอด|okr|โอเคอาร์|ภาพรวม|เป้า|งบ|สรุป|dashboard|แดชบอร์ด|ความคืบหน้า|กี่บาท|เท่าไห?ร่|กี่ทุน|สถานะ/i, path: "/dashboard", label: "หน้าภาพรวม OKR" },
];

// พี่โด้พิมพ์คำพวกนี้ = แคปเต็มหน้า (ค่าเริ่มต้นแคปเฉพาะช่วงพอดีจอ)
const FULLPAGE_RE = /เต็มจอ|เต็มหน้า|ทั้งหน้า|เต็ม\s*ๆ|full\s*page|ทั้งเว็บ|ยาว\s*ๆ|scroll|เลื่อนดู/i;

export interface PagePick {
  path: string;
  label: string;
  fullPage: boolean;
}

// คืนหน้าเว็บที่ควรแคปตามคำถาม (null = ไม่เกี่ยวหน้าเว็บ เช่น ทักทาย/คุยเล่น → ไม่แคป)
export function pageForQuestion(text: string): PagePick | null {
  const t = text || "";
  const fullPage = FULLPAGE_RE.test(t);
  for (const rule of PAGE_RULES) {
    if (rule.re.test(t)) return { path: rule.path, label: rule.label, fullPage };
  }
  return null;
}

// มินต์ session cookie ให้ Playwright เข้าหน้าเว็บที่อยู่หลัง login ได้
async function sessionToken(): Promise<string> {
  const user = await db.user.findFirst();
  const su: SessionUser = user
    ? { id: user.id, email: user.email, name: user.name, role: user.role }
    : { id: "screenshot", email: "screenshot@changoh.local", name: "Changoh", role: "admin" };
  return createSession(su);
}

// แคปหน้าจอเว็บจริง (headless Chromium + cookie login) → PNG buffer
export async function captureAppPage(
  origin: string,
  path: string,
  opts: { fullPage?: boolean } = {},
): Promise<Buffer> {
  const token = await sessionToken();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      locale: "th-TH",
    });
    await context.addCookies([{ name: SESSION_COOKIE, value: token, url: origin }]);
    const page = await context.newPage();
    await page.goto(origin + path, { waitUntil: "networkidle", timeout: 30000 });
    // รอฟอนต์ + กราฟ Chart.js เรนเดอร์เสร็จ
    await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<void> } }).fonts.ready).catch(() => {});
    await page.waitForTimeout(700);
    const png = await page.screenshot({ type: "png", fullPage: opts.fullPage ?? false });
    return Buffer.from(png);
  } finally {
    await browser.close();
  }
}
