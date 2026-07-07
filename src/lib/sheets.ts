import * as XLSX from "xlsx";
import { downloadDriveFile } from "./google";
import { writeAiNote } from "./obsidian";

export interface AffRecord {
  idCard: string;      // เลขบัตรประชาชน / เลขผู้เสียภาษี
  firstName: string;   // ชื่อจริง
  lastName: string;    // นามสกุล
  username: string;    // ชื่อผู้ใช้งาน
  address: string;     // ที่อยู่ตามบัตรประชาชน
  bank: string;        // ธนาคาร
  account: string;     // เลขบัญชี
  shipAddress?: string; // ที่อยู่จัดส่งเอกสาร (ถ้ามี)
}

// จับคอลัมน์จากหัวตาราง (ยืดหยุ่น ไม่ยึดตำแหน่งตายตัว)
function matchCol(headers: string[], ...needles: string[][]): number {
  for (const group of needles) {
    const idx = headers.findIndex((h) => group.every((n) => h.includes(n)));
    if (idx >= 0) return idx;
  }
  return -1;
}

function cell(row: unknown[], idx: number): string {
  if (idx < 0) return "";
  const v = row[idx];
  return v == null ? "" : String(v).trim();
}

// อ่านชีตลูกค้า AFF (.xlsx บน Drive) → รายการทั้งหมดในแท็บที่กำหนด
export async function loadAffRecords(): Promise<AffRecord[]> {
  const fileId = process.env.AFF_SHEET_FILE_ID?.trim();
  if (!fileId) throw new Error("ยังไม่ได้ตั้งค่า AFF_SHEET_FILE_ID");
  const tab = process.env.AFF_SHEET_TAB?.trim() || "ใช้จริง";

  const buf = await downloadDriveFile(fileId);
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[tab] || wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error(`ไม่พบแท็บ "${tab}" ในชีต`);

  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: "" });

  // หาแถวหัวตาราง (แถวที่มีคำว่า "ชื่อผู้ใช้")
  const headerIdx = rows.findIndex((r) => r.some((c) => String(c).includes("ชื่อผู้ใช้")));
  if (headerIdx < 0) throw new Error("หาหัวตารางในชีตไม่เจอ (ไม่มีคอลัมน์ 'ชื่อผู้ใช้งาน')");
  const headers = rows[headerIdx].map((c) => String(c).trim());

  const col = {
    idCard: matchCol(headers, ["เลขบัตร"], ["บัตรประชาชน"], ["ผู้เสียภาษี"]),
    firstName: matchCol(headers, ["ชื่อจริง"]),
    lastName: matchCol(headers, ["นามสกุล"]),
    username: matchCol(headers, ["ชื่อผู้ใช้"]),
    address: matchCol(headers, ["ที่อยู่ตามบัตร"], ["ที่อยู่ตาม"]),
    bank: matchCol(headers, ["ธนาคาร"]),
    account: matchCol(headers, ["เลขบัญชี"]),
    shipAddress: matchCol(headers, ["ที่อยู่", "จัดส่ง"], ["จัดส่งเอกสาร"]),
  };

  const out: AffRecord[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const username = cell(r, col.username);
    const idCard = cell(r, col.idCard);
    if (!username && !idCard) continue; // ข้ามแถวว่าง
    out.push({
      idCard,
      firstName: cell(r, col.firstName),
      lastName: cell(r, col.lastName),
      username,
      address: cell(r, col.address),
      bank: cell(r, col.bank),
      account: cell(r, col.account),
      shipAddress: cell(r, col.shipAddress) || undefined,
    });
  }
  return out;
}

// หา record ตามชื่อผู้ใช้ (case-insensitive, ตัดช่องว่าง)
export async function findAffByUsername(username: string): Promise<AffRecord | null> {
  const u = username.trim().toLowerCase();
  const all = await loadAffRecords();
  return all.find((r) => r.username.trim().toLowerCase() === u) || null;
}

// cache รายการทั้งหมดลง Obsidian (AI-Changoh/) ไว้อ้างอิง/ออฟไลน์
export async function cacheAffToObsidian(): Promise<number> {
  const all = await loadAffRecords();
  const lines = [
    "# ลูกค้า AFF (cache จาก Google Sheet)",
    "",
    "| ยูสเซอร์ | ชื่อ-สกุล | เลขบัตร/ภาษี | ธนาคาร | เลขบัญชี | ที่อยู่ |",
    "|---|---|---|---|---|---|",
    ...all.map(
      (r) =>
        `| ${r.username} | ${r.firstName} ${r.lastName} | ${r.idCard} | ${r.bank} | ${r.account} | ${r.address} |`,
    ),
  ];
  await writeAiNote("aff-customers.md", lines.join("\n"));
  return all.length;
}
