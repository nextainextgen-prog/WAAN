// สร้างลายเซ็นตัวอย่าง (public/signature.png) — โปร่งใส เส้นสีน้ำเงิน
// อาจารย์นำไฟล์ลายเซ็นจริงมาแทนที่ได้ (public/signature.png)
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

const W = 460, H = 150;
const px = Buffer.alloc(W * H * 4, 0); // RGBA transparent

function set(x, y, r, g, b, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}
function stroke(x, y, thick = 3) {
  const r = 29, g = 78, b = 216; // #1D4ED8
  for (let dx = -thick; dx <= thick; dx++)
    for (let dy = -thick; dy <= thick; dy++)
      if (dx * dx + dy * dy <= thick * thick) set(x + dx, y + dy, r, g, b, 255);
}

// เส้นลายเซ็นแบบคอร์ซีฟ (ผสมไซน์หลายความถี่)
for (let t = 0; t <= 1; t += 0.0006) {
  const x = 40 + t * (W - 90);
  const y =
    H / 2 +
    Math.sin(t * Math.PI * 6) * 34 * (1 - t * 0.3) +
    Math.sin(t * Math.PI * 15) * 10;
  stroke(x, y, 3);
}
// ขีดเส้นใต้
for (let x = 40; x < W - 40; x++) stroke(x, H - 26, 1.5);

// เข้ารหัส PNG
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
  return Buffer.concat([len, t, data, crc]);
}
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return c ^ 0xffffffff; }

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6; // RGBA
const raw = Buffer.alloc(H * (W * 4 + 1));
for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4); }
const idat = zlib.deflateSync(raw);
const out = Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);

const dest = path.join(process.cwd(), "public", "signature.png");
fs.writeFileSync(dest, out);
console.log("สร้างลายเซ็นตัวอย่าง:", dest, `(${out.length} bytes)`);
