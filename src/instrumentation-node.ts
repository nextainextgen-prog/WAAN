/**
 * ตาข่ายกันโปรเซสเว็บตาย — เฉพาะฝั่ง Node เท่านั้น (5 ส.ค. 2026)
 *
 * แยกออกมาเป็นไฟล์ต่างหากเพราะ Next.js คอมไพล์ instrumentation.ts ทั้งฝั่ง Node และ Edge
 * การเช็ค process.env.NEXT_RUNTIME ตอนรันไม่ช่วย — ตัวตรวจของ Next มองหา process.on
 * ตั้งแต่ตอนคอมไพล์ แล้วฟ้อง "A Node.js API is used which is not supported in the Edge Runtime"
 * ทำให้บิลด์พังซ้ำ ๆ · แยกไฟล์ + import แบบไดนามิก = Edge ไม่เห็นโค้ดนี้เลย
 */
const g = globalThis as typeof globalThis & { __vexGuards?: boolean };

if (!g.__vexGuards) {
  g.__vexGuards = true;

  // เซสชัน Telegram ของเจ้าของ (GramJS) หลุดแล้วโยน rejection นอก try/catch
  // → Node ฆ่าทั้งโปรเซส → คำขอที่กำลังทำงานอยู่ตายหมด ไม่ใช่แค่ของ Vex
  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
    console.error(`[กันโปรเซสตาย] unhandledRejection ที่ไม่มีใครรับ: ${msg}`);
  });

  process.on("uncaughtException", (err) => {
    console.error(`[กันโปรเซสตาย] uncaughtException: ${err?.message || err}`);
    // ข้อผิดพลาดระดับที่ทำงานต่อไม่ได้จริง ๆ ค่อยปล่อยให้ตาย (launchd รีสตาร์ทให้)
    if (/EADDRINUSE|ERR_MODULE_NOT_FOUND|heap out of memory/i.test(String(err?.message))) throw err;
  });
}

export {}; // ทำให้ไฟล์นี้เป็นโมดูล (ไม่งั้น TypeScript มองเป็นสคริปต์ global)
