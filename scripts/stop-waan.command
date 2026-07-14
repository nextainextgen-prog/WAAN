#!/bin/bash
# หยุดน้องวาน + ระบบทั้งหมด (ดับเบิลคลิกได้)
pkill -f "next dev" 2>/dev/null
pkill -f "telegram-bot.mjs" 2>/dev/null
pkill -f "drive-watch.mjs" 2>/dev/null
pkill -f "watch-folder.mjs" 2>/dev/null
pkill -f "oho-watch.mjs" 2>/dev/null
echo "✅ ปิดบริการทั้งหมดแล้ว"
