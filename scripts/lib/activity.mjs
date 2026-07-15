// จดกิจกรรมของน้องวานลง DB ผ่าน Next API (/api/activity) — ใช้ร่วมทุก watcher (oho/fb/line)
// fire-and-forget: ยิงแล้วไม่รอ/ไม่โยน error เด็ดขาด — DB/route ล่มห้ามทำ watcher ค้างหรือล้ม
// สำคัญ: อ่าน env ตอน "เรียกจริง" ไม่ใช่ตอน import — เพราะ watcher เรียก loadEnv() หลัง import module นี้
export function logActivity(fields) {
  try {
    if (!fields || !fields.source || !fields.kind || !fields.summary) return;
    const APP_URL = process.env.APP_URL || "http://localhost:3000";
    const INTERNAL = process.env.INTERNAL_API_TOKEN || "";
    // ไม่ await — ไม่ให้บล็อกรอบ watcher; กลืน error ทั้งหมด
    fetch(APP_URL + "/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL },
      body: JSON.stringify(fields),
    }).catch(() => {});
  } catch {
    /* เงียบ */
  }
}
