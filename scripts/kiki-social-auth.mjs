// ล็อกอิน Facebook + X ของเจ้าของ (เก็บ session ให้ Vex อ่านฟีดสรุปข่าวรายวัน) — รันครั้งเดียว
// รัน: npm run kiki:social-auth → เบราว์เซอร์เด้ง ล็อกอินทั้ง 2 เว็บ → กลับมากด Enter ในเทอร์มินัล
import path from "node:path";
import readline from "node:readline";
import { chromium } from "playwright";

const PROFILE = process.env.KIKI_SOCIAL_PROFILE || path.join(process.cwd(), ".kiki-social-profile");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

async function main() {
  console.log("\nกำลังเปิดเบราว์เซอร์ — ล็อกอิน Facebook และ X (สลับแท็บได้) ให้เห็นฟีดทั้งสองเว็บ\n");
  // ใช้ Chrome จริงในเครื่อง + ปิดร่องรอย automation — X/FB ตรวจจับ Chromium เปล่าของ Playwright แล้วบล็อกเงียบ
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  const p1 = await context.newPage();
  await p1.goto("https://www.facebook.com/").catch(() => {});
  const p2 = await context.newPage();
  await p2.goto("https://x.com/home").catch(() => {});

  await ask("ล็อกอินครบทั้ง 2 เว็บแล้ว กด Enter เพื่อบันทึก session แล้วปิด... ");
  await context.close();
  console.log(`\n✅ เก็บ session แล้วที่ ${PROFILE}`);
  console.log("Vex จะสรุปข่าวจากฟีดให้ทุกเช้า + สั่ง \"สรุปฟีดวันนี้\" ได้ตลอด\n");
  rl.close();
  process.exit(0);
}
main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
