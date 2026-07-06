// แปลงภาพลายเซ็นพื้นขาว → PNG โปร่งใส (คีย์สีขาวออก เก็บเส้นหมึก)
// ใช้: node scripts/convert-signature.mjs <ไฟล์ต้นฉบับ>  → public/signature.png
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.error("ไม่พบไฟล์ต้นฉบับ:", src);
  process.exit(1);
}

const png = PNG.sync.read(fs.readFileSync(src));
const { width, height, data } = png;

let minX = width, minY = height, maxX = 0, maxY = 0;

for (let i = 0; i < data.length; i += 4) {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const srcA = data[i + 3];
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  // รองรับทั้งพื้นขาวทึบ และพื้นโปร่งใส:
  // ทึบเมื่อ "มีหมึก (เข้ม)" และ "พิกเซลนั้นทึบในต้นฉบับ"
  let alpha = (srcA / 255) * (255 - lum);
  if (alpha < 24) alpha = 0; // ตัด noise พื้นหลัง
  data[i] = 12; data[i + 1] = 22; data[i + 2] = 34; // หมึกสีเข้ม (#0C1622)
  data[i + 3] = Math.max(0, Math.min(255, Math.round(alpha)));

  if (alpha > 0) {
    const px = (i / 4) % width, py = Math.floor((i / 4) / width);
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
}

// ครอปขอบว่างรอบลายเซ็น (เว้น margin เล็กน้อย)
const m = 12;
minX = Math.max(0, minX - m); minY = Math.max(0, minY - m);
maxX = Math.min(width - 1, maxX + m); maxY = Math.min(height - 1, maxY + m);
const cw = maxX - minX + 1, ch = maxY - minY + 1;

const out = new PNG({ width: cw, height: ch });
for (let y = 0; y < ch; y++) {
  for (let x = 0; x < cw; x++) {
    const si = ((minY + y) * width + (minX + x)) * 4;
    const di = (y * cw + x) * 4;
    out.data[di] = data[si];
    out.data[di + 1] = data[si + 1];
    out.data[di + 2] = data[si + 2];
    out.data[di + 3] = data[si + 3];
  }
}

const dest = path.join(process.cwd(), "public", "signature.png");
fs.writeFileSync(dest, PNG.sync.write(out));
console.log(`สร้างลายเซ็นโปร่งใส: ${dest} (${cw}x${ch})`);
