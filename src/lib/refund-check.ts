import fs from "node:fs";
import path from "node:path";
import type { RefundRow, ServiceLogRow } from "./thunder-refund";
import type { RefundNoti } from "./refund-notify";

/**
 * เทียบข้อมูลคำขอคืนเครดิต 3 ทาง: หน้าจัดการขอคืนเงิน ↔ หน้าประวัติบริการ ↔ noti บอท (ถ้าอ่านได้)
 * hard ไม่ผ่านแม้จุดเดียว = ไม่มีปุ่มคืน (ธงแดง แท็กโด้)
 * soft ไม่ผ่าน = ยังมีปุ่ม แต่ติดธงเหลืองเตือนในการ์ด
 */

export type CheckLevel = "hard" | "soft";

export interface CheckRow {
  key: string;
  label: string;
  refund: string; // ค่าที่หน้าจัดการขอคืนเงิน
  log: string; // ค่าที่หน้าประวัติบริการ
  noti: string; // ค่าที่บอทแจ้ง ("" = ไม่มี)
  ok: boolean | null; // null = ไม่มีข้อมูลให้เทียบ (ไม่นับตก)
  level: CheckLevel;
}

export interface CheckResult {
  rows: CheckRow[];
  hardFails: CheckRow[];
  softFails: CheckRow[];
  allOk: boolean; // hard ผ่านหมด
  passed: number;
  total: number; // จำนวนจุดที่เทียบได้จริง
}

const norm = (s: string) => String(s || "").replace(/\s+/g, " ").trim();
const eqNum = (a: number | null | undefined, b: number | null | undefined) => a != null && b != null && Math.abs(a - b) < 0.005;
const fmtBaht = (n: number | null | undefined) => (n == null ? "-" : `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

// ชื่อร้าน: เทียบแบบผ่อน — ตัดช่องว่างซ้ำแล้วเท่ากัน หรือฝั่งหนึ่งอยู่ในอีกฝั่ง (บอทตัดชื่อยาวบ้าง)
function sameShop(a: string, b: string): boolean {
  const x = norm(a).toLowerCase();
  const y = norm(b).toLowerCase();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export function checkRefund(refund: RefundRow, log: ServiceLogRow, noti?: RefundNoti | null): CheckResult {
  const rows: CheckRow[] = [];
  const add = (r: CheckRow) => rows.push(r);

  // 1) ไอดีประวัติ — กุญแจโยง 2 หน้า ต้องตรงเป๊ะ
  add({
    key: "historyId",
    label: "ไอดีประวัติบริการ",
    refund: `#${refund.historyId || "-"}`,
    log: `#${log.historyId || "-"}`,
    noti: "",
    ok: !!refund.historyId && refund.historyId === log.historyId,
    level: "hard",
  });

  // 2) ยูสเซอร์ผู้รับเครดิต
  add({
    key: "username",
    label: "ยูสเซอร์",
    refund: refund.username || "-",
    log: log.username || "-",
    noti: "",
    ok: !!refund.username && norm(refund.username).toLowerCase() === norm(log.username).toLowerCase(),
    level: "hard",
  });

  // 3) ยอดเงิน — คอลัมน์ "จำนวน" ต้องเท่าราคาจริงในประวัติ (และเท่า noti ถ้ามี)
  const amountOk = eqNum(refund.amount, log.price) && (noti?.amount == null || eqNum(refund.amount, noti.amount));
  add({
    key: "amount",
    label: "ยอดเงิน",
    refund: fmtBaht(refund.amount),
    log: fmtBaht(log.price),
    noti: noti?.amount != null ? fmtBaht(noti.amount) : "",
    ok: amountOk,
    level: "hard",
  });

  // 4) ยอดในลิงก์ประวัติบริการ ต้องเท่าคอลัมน์จำนวน (กันแถวลิงก์ชี้ผิดรายการ)
  add({
    key: "historyAmount",
    label: "ยอดในลิงก์ประวัติ",
    refund: fmtBaht(refund.historyAmount),
    log: fmtBaht(log.price),
    noti: "",
    ok: eqNum(refund.historyAmount, refund.amount) && eqNum(refund.historyAmount, log.price),
    level: "hard",
  });

  // 5) สถานะต้องยัง "รออนุมัติ" (ยังไม่มีใครจัดการ)
  add({
    key: "status",
    label: "สถานะคำขอ",
    refund: refund.status || "-",
    log: "",
    noti: "",
    ok: /รออนุมัติ/.test(refund.status || ""),
    level: "hard",
  });

  // 6) ชื่อร้านค้า — เทียบได้เมื่อมี noti (หน้า refund ไม่มีคอลัมน์นี้)
  add({
    key: "shopName",
    label: "ชื่อร้านค้า",
    refund: "",
    log: log.shopName || "-",
    noti: noti?.shopName || "",
    ok: noti?.shopName ? sameShop(log.shopName, noti.shopName) : null,
    level: "hard",
  });

  // 7) ประเภทรายการ vs เหตุผล — soft (เหตุผล "ต่ออายุผิด" ควรคู่กับ renew)
  const reason = norm(refund.reason);
  const type = norm(log.type).toLowerCase();
  const typeOk = /ต่ออายุ/.test(reason) ? type === "renew" : /ซื้อ|แพ็?กเกจ/.test(reason) ? type === "buy" : null;
  add({
    key: "type",
    label: "ประเภทรายการ",
    refund: reason || "-",
    log: (log.type || "-").toUpperCase(),
    noti: "",
    ok: typeOk,
    level: "soft",
  });

  // 8) ไอดีบริการปิดลูป — ทำได้เมื่อมี noti (ยืนยันว่า noti ใบนี้ = รายการนี้จริง)
  add({
    key: "serviceId",
    label: "ไอดีบริการ (จาก noti)",
    refund: "",
    log: "",
    noti: noti?.serviceId ? `#${noti.serviceId}` : "",
    ok: noti?.serviceId ? null : null, // เฟส 2: ค้น logs ด้วยไอดีบริการแล้วยืนยันว่าชี้มาที่ historyId เดียวกัน
    level: "soft",
  });

  const graded = rows.filter((r) => r.ok !== null);
  const hardFails = rows.filter((r) => r.level === "hard" && r.ok === false);
  const softFails = rows.filter((r) => r.level === "soft" && r.ok === false);
  return {
    rows,
    hardFails,
    softFails,
    allOk: hardFails.length === 0,
    passed: graded.filter((r) => r.ok === true).length,
    total: graded.length,
  };
}

// ===== การ์ดเทียบข้อมูล (HTML → PNG ผ่าน renderHtmlToPng) — สไตล์เดียวกับการ์ด AFF =====
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function logoDataUri(): string {
  try {
    return `data:image/png;base64,${fs.readFileSync(path.join(process.cwd(), "public/brand/thunder-mark.png")).toString("base64")}`;
  } catch {
    return "";
  }
}

export function refundCardHtml(o: {
  refund: RefundRow;
  log: ServiceLogRow;
  result: CheckResult;
}): string {
  const { refund, log, result } = o;
  const logo = logoDataUri();
  // ไม่มี noti (อ่านข้อความบอทไม่ได้) → ซ่อนคอลัมน์ไปเลย ไม่ต้องโชว์ขีดว่างทั้งแถว
  const hasNoti = result.rows.some((r) => !!r.noti);
  const verdict = result.allOk
    ? `<span class="v ok">${result.softFails.length ? "ผ่าน · มีข้อควรดู" : "พร้อมอนุมัติ"}</span>`
    : `<span class="v no">พบข้อผิดพลาด</span>`;

  const cell = (v: string, ok: boolean | null) => {
    if (!v) return `<td class="src na">—</td>`;
    const chip = ok === true ? `<span class="chip ok">ตรง</span>` : ok === false ? `<span class="chip no">ไม่ตรง</span>` : "";
    return `<td class="src ${ok === true ? "good" : ok === false ? "bad" : ""}">${esc(v)}${chip}</td>`;
  };

  // แถวที่มีค่าฝั่งเดียว (เช่น สถานะคำขอ) — ติด chip ที่ฝั่งที่มีค่า ไม่งั้นตกไม่เห็นว่าตกตรงไหน
  const docCell = (r: CheckRow) => {
    if (!r.refund) return `<td class="src na">—</td>`;
    const lone = !r.log && !r.noti;
    const chip = lone && r.ok === false ? `<span class="chip no">ไม่ตรง</span>` : lone && r.ok === true ? `<span class="chip ok">ตรง</span>` : "";
    return `<td class="doc ${r.ok === false && lone ? "bad" : ""}">${esc(r.refund)}${chip}</td>`;
  };

  const rowHtml = (r: CheckRow) => `
    <tr class="${r.ok === true ? "ok" : r.ok === false ? "bad" : ""}">
      <td class="lbl">${esc(r.label)}${r.level === "soft" ? `<span class="auth">เตือน</span>` : ""}</td>
      ${docCell(r)}
      ${cell(r.log, r.refund || r.noti ? r.ok : null)}
      ${hasNoti ? cell(r.noti, r.ok) : ""}
    </tr>`;

  return `<!doctype html><html lang="th"><head><meta charset="utf-8"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:"Noto Sans Thai","Sarabun",system-ui,sans-serif;background:#eef4fd;padding:34px}
  .card{background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 10px 40px rgba(20,50,100,.10)}
  .head{display:flex;align-items:center;justify-content:space-between;padding:22px 26px;background:#f4f9ff;border-bottom:1px solid #e0eaf9}
  .head .l{display:flex;align-items:center;gap:16px}
  .head img{width:52px;height:52px;border-radius:12px;object-fit:contain}
  h1{font-size:22px;color:#0f2547;font-weight:800}
  .head p{font-size:13px;color:#4a6ea3;margin-top:4px}
  .v{font-size:13px;font-weight:800;padding:8px 16px;border-radius:999px}
  .v.ok{background:#dcfce7;color:#15803d}
  .v.no{background:#fee2e2;color:#b91c1c}
  table{width:100%;border-collapse:collapse}
  thead th{background:#1e50a0;color:#fff;font-size:13px;font-weight:700;text-align:left;padding:12px 18px}
  thead th.h-doc{background:#17418a}
  tbody td{padding:13px 18px;font-size:15px;border-top:1px solid #eef3fb;border-left:1px solid #eef3fb;vertical-align:middle}
  tbody td:first-child{border-left:none}
  tbody tr:nth-child(even){background:#f7faff}
  td.lbl{color:#4a6ea3;font-weight:600;width:22%}
  td.lbl .auth{display:inline-block;margin-left:8px;font-size:11px;font-weight:700;color:#92660e;background:#fdf0d5;padding:1px 8px;border-radius:999px}
  td.doc{color:#0f2547;font-weight:700;background:#fbfdff}
  td.doc.bad{color:#b91c1c;background:#fff5f5}
  td.src{color:#334e78;font-weight:600}
  td.src.good{color:#15803d}
  td.src.bad{color:#b91c1c;background:#fff5f5}
  td.src.na{color:#b6c4da;text-align:center}
  .chip{display:inline-block;margin-left:8px;font-size:11px;font-weight:700;padding:1px 8px;border-radius:999px;vertical-align:middle}
  .chip.ok{background:#dcfce7;color:#15803d}
  .chip.no{background:#fee2e2;color:#b91c1c}
  tr.ok td:first-child{box-shadow:inset 4px 0 0 #22c55e}
  tr.bad td:first-child{box-shadow:inset 4px 0 0 #ef4444}
  .foot{padding:14px 26px;background:#f4f8ff;border-top:1px solid #e0eaf9;font-size:13px;color:#4a6ea3}
</style></head><body>
  <div class="card">
    <div class="head">
      <div class="l">
        ${logo ? `<img src="${logo}" alt="Thunder"/>` : ""}
        <div class="t"><h1>สรุปเปรียบเทียบคำขอคืนเครดิต</h1>
        <p>คำขอ #${esc(refund.refundId)} · ยูสเซอร์ ${esc(refund.username)} · ${esc(log.shopName || "-")} · ร้องขอโดย ${esc(refund.requestedBy)}</p></div>
      </div>
      ${verdict}
    </div>
    <table>
      <thead><tr><th>ข้อมูล</th><th class="h-doc">หน้าจัดการขอคืนเงิน</th><th>หน้าประวัติบริการ</th>${hasNoti ? "<th>บอทแจ้งเตือน</th>" : ""}</tr></thead>
      <tbody>${result.rows.map(rowHtml).join("")}</tbody>
    </table>
    <div class="foot">ตรวจผ่าน ${result.passed}/${result.total} จุด · ยึดหน้าจัดการขอคืนเงินเป็นหลัก แล้วยืนยันข้ามด้วยไอดีประวัติ #${esc(refund.historyId)}</div>
  </div>
</body></html>`;
}
