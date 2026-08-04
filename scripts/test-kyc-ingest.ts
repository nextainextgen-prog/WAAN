// เทสท่อ KYC จริง: ดึงหน้ายืนยันตัวตนจากระบบ → อ่านเลขบัตร → ทำหน้าเอกสารยืนยันตัวตน (PDF)
// ไม่เขียนทับคลังข้อมูล (เทสเฉย ๆ) — รัน: npx tsx --tsconfig tsconfig.json scripts/test-kyc-ingest.ts <username> <outDir>
import fs from "node:fs";
import path from "node:path";
for (const line of fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

async function main() {
  const username = process.argv[2] || "palmnoiinaja";
  const out = process.argv[3] || "/tmp/kyc-test";
  const { fetchKyc, readIdCard, splitKycAddress, validThaiId } = await import("@/lib/thunder-kyc");
  const { buildKycDocPdf } = await import("@/lib/aff-kyc-doc");

  const t0 = Date.now();
  const r = await fetchKyc(username);
  console.log(`fetchKyc (${((Date.now() - t0) / 1000).toFixed(1)} วิ):`, r.ok ? "สำเร็จ" : `ล้มเหลว (${r.error})`);
  if (!r.ok || !r.record) return;
  const k = r.record;
  console.log(" รายการล่าสุด: ID", k.rowId, "·", k.rowDate);
  console.log(" ชื่อ:", k.firstName, k.lastName);
  console.log(" ธนาคาร:", k.bank, "·", k.account);
  console.log(" ที่อยู่:", k.address);
  console.log(" แยกที่อยู่:", JSON.stringify(splitKycAddress(k.address)));
  console.log(" ภาพ modal:", k.modalShot.length, "bytes · รูปบัตร:", k.photo ? `${k.photo.length} bytes` : "ไม่มี");

  if (k.photo) {
    const t1 = Date.now();
    const id = await readIdCard(k.photo);
    console.log(`อ่านบัตร (${((Date.now() - t1) / 1000).toFixed(1)} วิ): เลข=${id.taxId || "อ่านไม่ได้"} · คำนำหน้า=${id.prefix || "-"} · checksum ${validThaiId(id.taxId) ? "ผ่าน" : "ไม่ผ่าน"}`);
  }

  fs.mkdirSync(out, { recursive: true });
  const doc = await buildKycDocPdf({ username, fullName: `${k.firstName} ${k.lastName}`, shot: k.modalShot, outDir: out });
  console.log("เอกสารยืนยันตัวตน:", doc.pdfPath);
}
main();
