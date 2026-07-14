/**
 * Bootstrap: อ่านกองสำเนาลูกค้าเก่า (<username>.pdf, หน้า1=ใบเสร็จ หน้า2=เอกสารแนบ)
 *  → สกัดโปรไฟล์ (positional label-segment จากฟอร์มเดียวกัน) + แยกหน้า2 เป็น attachment
 *  → เก็บลง Obsidian (AI-Changoh/aff-customers/<username>/)
 * ใช้: npx tsx scripts/aff-ingest.ts <โฟลเดอร์ที่มี username.pdf>
 */
import fs from "node:fs";
import path from "node:path";

// โหลด .env เอง (สคริปต์ไม่ได้ผ่าน Next)
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const SRC = process.argv[2] ||
  "/private/tmp/claude-501/-Users-mx-Projects-AITransformation/72164e5d-3fef-418e-8725-897b3c02409c/scratchpad/cust-src";
const TMP = "/private/tmp/claude-501/-Users-mx-Projects-AITransformation/72164e5d-3fef-418e-8725-897b3c02409c/scratchpad/ingest-tmp";

interface Item { s: string; x: number; y: number; }
interface Extracted {
  prefix: string; name: string; taxId: string;
  houseNo: string; moo: string; road: string;
  tambon: string; amphoe: string; changwat: string;
  bank: string; account: string;
}

const isDot = (s: string) => /^[….\s]+$/.test(s);
const PREFIXES = ["นางสาว", "นาย", "นาง", "น.ส."];
const ALL_LABELS = ["ที่", "วันที่", "เดือน", "พ.ศ", "ข้าพเจ้า", "เลขประจำตัวผู้เสียภาษี", "อยู่", "อยู่บ้านเลขที่",
  "บ้านเลขที่", "หมู่", "ถนน", "ตำบล", "อำเภอ", "จังหวัด", "ได้รับเงินจาก", "รับเงินโดย", "เงินสด",
  "โอนเข้าบัญชี", "เช็คธนาคาร"];

// ตัด จุด/…/ช่องว่างนำหน้า แล้วเอาช่องว่างออก (label บางตัวมี "." นำ เช่น ".อำเภอ")
const clean = (s: string) => s.replace(/^[.…\s]+/, "").replace(/\s+/g, "");
const isLabelStr = (s: string) => {
  const c = clean(s);
  return ALL_LABELS.some((l) => { const lc = clean(l); return c.startsWith(lc) && c.length <= lc.length + 1; });
};

async function page1Items(pdfPath: string): Promise<Item[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  return tc.items
    .filter((it: any) => it.str.trim() && !isDot(it.str))
    .map((it: any) => ({ s: it.str, x: +it.transform[4].toFixed(1), y: +it.transform[5].toFixed(1) }));
}

const rowOf = (items: Item[], y: number, tol = 9) => items.filter((it) => Math.abs(it.y - y) <= tol);
function findLabel(items: Item[], label: string): Item | undefined {
  const lc = clean(label);
  return items.find((it) => clean(it.s).startsWith(lc) && clean(it.s).length <= lc.length + 2);
}
// value items ในช่วง x [x1,x2) ที่ไม่ใช่ label — join ด้วยช่องว่าง
function seg(rowItems: Item[], x1: number, x2: number): string {
  return rowItems.filter((it) => it.x >= x1 && it.x < x2 && !isLabelStr(it.s) && it.s !== "/")
    .sort((a, b) => a.x - b.x).map((it) => it.s).join(" ").replace(/\s+/g, " ").trim();
}

function extract(items: Item[]): Extracted {
  const e: Extracted = { prefix: "", name: "", taxId: "", houseNo: "", moo: "", road: "-", tambon: "", amphoe: "", changwat: "", bank: "", account: "" };

  // ---- ชื่อ (ข้าพเจ้า) ----
  const dl = findLabel(items, "ข้าพเจ้า");
  if (dl) {
    let full = seg(rowOf(items, dl.y), dl.x + 1, 9999);
    for (const p of PREFIXES) {
      if (clean(full).startsWith(clean(p))) {
        e.prefix = p;
        full = full.replace(new RegExp(`^\\s*${p}\\s*`), "").trim();
        break;
      }
    }
    e.name = full;
  }

  // ---- เลขภาษี / บ้านเลขที่ / หมู่ ----
  const tx = findLabel(items, "เลขประจำตัวผู้เสียภาษี");
  if (tx) {
    const row = rowOf(items, tx.y);
    const xHouse = (findLabel(row, "บ้านเลขที่")?.x ?? findLabel(row, "อยู่")?.x) ?? 9999;
    const xMoo = findLabel(row, "หมู่")?.x ?? 9999;
    e.taxId = seg(row, tx.x + 1, xHouse).replace(/\D/g, "");
    e.houseNo = seg(row, xHouse + 1, xMoo).replace(/[^0-9/]/g, "");
    e.moo = seg(row, xMoo + 1, 9999).replace(/[^0-9/]/g, "");
  }

  // ---- ถนน / ตำบล / อำเภอ / จังหวัด ----
  const rd = findLabel(items, "ถนน");
  if (rd) {
    const row = rowOf(items, rd.y);
    const xT = findLabel(row, "ตำบล")?.x ?? 9999;
    const xA = findLabel(row, "อำเภอ")?.x ?? 9999;
    const xC = findLabel(row, "จังหวัด")?.x ?? 9999;
    e.road = seg(row, rd.x + 1, xT) || "-";
    e.tambon = seg(row, xT + 1, xA);
    e.amphoe = seg(row, xA + 1, xC);
    e.changwat = seg(row, xC + 1, 9999);
  }

  // ---- ธนาคาร / เลขบัญชี (หา item ที่ขึ้นต้นชื่อธนาคาร แล้วอ่านทั้งแถว) ----
  const bItem = items.find((it) =>
    /^(ธนาคาร|กสิกร|ไทยพาณิช|กรุงไทย|กรุงศรี|ออมสิน|ธนชาต|ทหารไทย|ยูโอบี|ซีไอเอ็ม|เกียรตินาคิน)/.test(clean(it.s)) &&
    !isLabelStr(it.s));
  if (bItem) {
    const row = rowOf(items, bItem.y, 6);
    const acct = row.filter((it) => /^\d[\d-]{5,}$/.test(it.s.replace(/\s/g, ""))).sort((a, b) => a.x - b.x)[0];
    e.account = acct ? acct.s.replace(/\D/g, "") : "";
    const hi = acct && acct.x > bItem.x ? acct.x : 9999; // ชื่อธนาคารอยู่ก่อนเลขบัญชี → ตัด "เช็คธนาคาร" ที่อยู่ขวาออก
    e.bank = row.filter((it) => it.x >= bItem.x - 1 && it.x < hi && /[ก-๙]/.test(it.s) && !isLabelStr(it.s) && !/^\d/.test(clean(it.s)))
      .sort((a, b) => a.x - b.x).map((it) => it.s).join("").replace(/\s+/g, "").replace(/(เช็ค)?ธนาคาร$/, (m) => (m === "ธนาคาร" ? "ธนาคาร" : "")).trim();
  }

  return e;
}

// kimukimi: หน้า 1 เป็นฟอร์มเปล่า (เอกสารเก่าสุด) → ตั้งค่าจากข้อมูลจริง (Image#34/#46)
const OVERRIDE: Record<string, Extracted> = {
  kimukimi: {
    prefix: "นาย", name: "เอกราช เกียรติมโนพิศุทธิ์", taxId: "1809900078714",
    houseNo: "12/102", moo: "1", road: "-", tambon: "รัษฎา", amphoe: "เมืองภูเก็ต", changwat: "ภูเก็ต",
    bank: "ธนาคารกรุงศรีอยุธยา", account: "4761083346",
  },
};

async function main() {
  const { pdfFileToPngs } = await import("../src/lib/pdf-to-images.ts");
  const { saveProfile, saveAttachment } = await import("../src/lib/aff-profile.ts");
  fs.mkdirSync(TMP, { recursive: true });

  const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".pdf")).sort();
  console.log(`ingest ${files.length} files from ${SRC}\n`);
  const rows: string[] = [];
  for (const f of files) {
    const username = path.basename(f, ".pdf");
    const pdfPath = path.join(SRC, f);
    try {
      const e = OVERRIDE[username] || extract(await page1Items(pdfPath));
      const pages = await pdfFileToPngs(pdfPath, path.join(TMP, username), { maxPages: 2, scale: 2 });
      const attachPng = pages[1] ? fs.readFileSync(pages[1]) : null;

      await saveProfile({ username, ...e, updatedAt: new Date().toISOString().slice(0, 10) });
      if (attachPng) await saveAttachment(username, attachPng);

      const bad = !e.name || !e.taxId || !e.tambon ? "  ⚠️ตรวจ" : "";
      rows.push(`✓ ${username.padEnd(13)}| ${e.prefix}${e.name} | ${e.taxId} | ${e.houseNo} ม.${e.moo} ต.${e.tambon} อ.${e.amphoe} จ.${e.changwat} | ${e.bank} ${e.account} | แนบ:${attachPng ? "y" : "N"}${bad}`);
    } catch (err) {
      rows.push(`✗ ${username}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(rows.join("\n"));
}
main();
