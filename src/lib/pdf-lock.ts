import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

// รหัสเปิดไฟล์ PDF (ตายตัว) — override ได้ด้วย env MEMO_PDF_PASSWORD
export const MEMO_PDF_PASSWORD = process.env.MEMO_PDF_PASSWORD || "11221122";

// หา binary qpdf — server รันผ่าน LaunchAgent ซึ่ง PATH อาจไม่มี /opt/homebrew/bin
function qpdfBin(): string {
  if (process.env.QPDF_BIN && existsSync(process.env.QPDF_BIN)) return process.env.QPDF_BIN;
  for (const p of ["/opt/homebrew/bin/qpdf", "/usr/local/bin/qpdf", "/usr/bin/qpdf"]) {
    if (existsSync(p)) return p;
  }
  return "qpdf"; // pray ว่าอยู่ใน PATH
}

// ล็อก PDF ด้วยรหัสผ่าน (AES-256, ต้องใส่รหัสตอนเปิด) — ถ้าล็อกไม่ได้จะคืนไฟล์เดิม (ไม่ทำให้ flow ล่ม)
export async function lockPdf(buf: Buffer, password: string = MEMO_PDF_PASSWORD): Promise<Buffer> {
  if (!password) return buf;
  const dir = os.tmpdir();
  const inP = path.join(dir, `memo-${randomUUID()}.pdf`);
  const outP = path.join(dir, `memo-${randomUUID()}-lock.pdf`);
  await fs.writeFile(inP, buf);
  try {
    await new Promise<void>((resolve, reject) => {
      const p = spawn(qpdfBin(), ["--encrypt", password, password, "256", "--", inP, outP]);
      let err = "";
      p.stderr.on("data", (d) => (err += d));
      p.on("error", reject);
      p.on("close", (code) => {
        // qpdf: 0 = สำเร็จ, 3 = สำเร็จแต่มี warning (ยังได้ไฟล์ออก)
        if (code === 0 || code === 3) resolve();
        else reject(new Error(`qpdf exited ${code}: ${err}`));
      });
    });
    return await fs.readFile(outP);
  } catch (e) {
    console.error("[pdf-lock] เข้ารหัส PDF ไม่สำเร็จ ส่งไฟล์แบบไม่ล็อกแทน:", e);
    return buf;
  } finally {
    await fs.rm(inP, { force: true }).catch(() => {});
    await fs.rm(outP, { force: true }).catch(() => {});
  }
}
