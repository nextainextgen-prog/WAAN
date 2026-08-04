// สำรวจ modal ของหน้า KYC (Mantine Modal) — หา container + ค่าในช่อง + รูป
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

for (const line of fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const BASE = (process.env.THUNDER_ADMIN_URL || "https://old.thunder.in.th").replace(/\/$/, "");
const USER = process.argv[2] || "palmnoiinaja";
const OUT = process.argv[3] || "/tmp/kyc-explore";
fs.mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const ctx = await b.newContext({ storageState: ".thunder-session.json", viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 2, locale: "th-TH" });
const page = await ctx.newPage();
await page.goto(`${BASE}/admin/kyc`, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1500);
await page.locator("input").nth(1).fill(USER);
await page.getByRole("button", { name: /ค้นหา/ }).first().click();
await page.waitForTimeout(2500);
await page.getByRole("button", { name: /ดูข้อมูล/ }).first().click();
await page.waitForTimeout(3000);

const info = await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"], .mantine-Modal-content, [class*="Modal-content"]');
  if (!dlg) return { err: "ไม่เจอ dialog", classes: Array.from(document.querySelectorAll("div")).map((d) => d.className?.toString()).filter((c) => /Modal/i.test(c || "")).slice(0, 10) };
  const r = dlg.getBoundingClientRect();
  const fields = [];
  dlg.querySelectorAll("input,textarea").forEach((i) => {
    // หา label ที่ใกล้ที่สุด
    const wrap = i.closest("div");
    const lb = wrap?.parentElement?.querySelector("label")?.innerText?.trim() || wrap?.previousElementSibling?.textContent?.trim() || "";
    fields.push({ label: lb, value: i.value, tag: i.tagName });
  });
  const labels = Array.from(dlg.querySelectorAll("label")).map((l) => l.innerText.trim());
  const imgs = Array.from(dlg.querySelectorAll("img")).map((i) => ({ src: i.src.slice(0, 150), w: i.naturalWidth, h: i.naturalHeight }));
  return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, fields, labels, imgs, text: dlg.innerText.slice(0, 300) };
});
console.log(JSON.stringify(info, null, 1));

const dlg = page.locator('[role="dialog"], [class*="Modal-content"]').first();
if (await dlg.count()) {
  await dlg.screenshot({ path: path.join(OUT, "modal-only.png") }).catch((e) => console.log("shot err", e.message));
  console.log("แคป modal แล้ว:", path.join(OUT, "modal-only.png"));
}
await b.close();
