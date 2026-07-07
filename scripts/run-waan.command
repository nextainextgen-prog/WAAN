#!/bin/bash
# เปิดน้องวาน + ระบบทั้งหมด (ดับเบิลคลิกไฟล์นี้ได้เลย) — รันถาวร ไม่ผูกกับเซสชัน Claude
cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1

echo "=== หยุดของเดิม (กันรันซ้อน) ==="
pkill -f "next dev" 2>/dev/null
pkill -f "telegram-bot.mjs" 2>/dev/null
pkill -f "drive-watch.mjs" 2>/dev/null
pkill -f "watch-folder.mjs" 2>/dev/null
sleep 2

mkdir -p .run-logs
echo "=== เริ่ม backend (เว็บ + API) ==="
nohup npm run dev > .run-logs/dev.log 2>&1 &
sleep 8

echo "=== เริ่มน้องวาน (Telegram) ==="
nohup npm run bot > .run-logs/bot.log 2>&1 &
sleep 2

echo "=== เริ่ม Google Drive watcher ==="
nohup npm run drive:watch > .run-logs/drive.log 2>&1 &
sleep 1

echo ""
echo "✅ เปิดครบแล้ว — น้องวานพร้อมทำงาน (รันอยู่เบื้องหลัง)"
echo "   log อยู่ที่โฟลเดอร์ .run-logs/"
echo "   ปิดทั้งหมด: รัน scripts/stop-waan.command"
echo ""
echo "ปิดหน้าต่างนี้ได้เลย บริการจะยังทำงานต่อ"
