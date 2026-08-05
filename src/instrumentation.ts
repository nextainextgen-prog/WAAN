/**
 * ตัวติดตั้งตาข่ายกันโปรเซสเว็บตาย
 *
 * โค้ดจริงอยู่ใน instrumentation-node.ts และโหลดแบบไดนามิกเฉพาะตอนรันบน Node
 * เพราะ Next.js คอมไพล์ไฟล์นี้ทั้งฝั่ง Node และ Edge — ถ้าเขียน process.on ตรงนี้
 * ตัวตรวจจะฟ้องตอนคอมไพล์ว่า Edge Runtime ไม่รองรับ แล้วทำให้บิลด์พัง (เจอจริง 5 ส.ค.)
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await import("./instrumentation-node");
}
