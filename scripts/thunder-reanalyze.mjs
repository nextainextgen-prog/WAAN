// re-analyze บทสนทนาของวันธุรกิจที่ระบุ ด้วยตัววิเคราะห์เวอร์ชันล่าสุด
import { execSync } from "node:child_process";
const biz = process.argv[2] || "";
if (!biz) { console.error("ใช้: node scripts/thunder-reanalyze.mjs 2026-07-20"); process.exit(1); }
execSync(`sqlite3 prisma/changoh.db "UPDATE ChatLog SET analyzed=0 WHERE bizDate='${biz}';"`, { stdio: "inherit" });
console.log(new Date().toISOString(), "รีเซ็ตแล้ว เริ่มวิเคราะห์ใหม่...");
