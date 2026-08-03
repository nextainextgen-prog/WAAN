import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { getCurrentUser, isServiceRequest } from "@/lib/auth";
import { isAuthorized } from "@/lib/team";
import { getAllowedGroups } from "@/lib/telegram";
import { ingestKnowledgeFile, ingestKnowledgeUrl, type KnowledgeResult } from "@/lib/knowledge";
import { findVaultFiles } from "@/lib/obsidian";
import { extractUrls } from "@/lib/weblink";

export const runtime = "nodejs";
export const maxDuration = 240;

interface Send {
  kind: "text" | "photo" | "document";
  text?: string;
  dataBase64?: string;
  filename?: string;
  caption?: string;
}

const MAX_SEND_BYTES = 25 * 1024 * 1024; // กันไฟล์ใหญ่เกินที่ Telegram รับ

// ค้นไฟล์ (รูป/เอกสาร) ในคลังความรู้แล้วส่งกลับให้ผู้ใช้ในแชท
async function handleFind(query: string): Promise<Send[]> {
  const q = query.trim();
  if (!q) return [{ kind: "text", text: "อยากได้ไฟล์อะไรจากคลังคะ บอกชื่อ/หัวข้อมาได้เลยนะคะ" }];
  const imagesOnly = /(รูป|ภาพ|image|photo|โลโก้|logo|ภาพถ่าย|screenshot|สกรีน|แคป)/i.test(q);
  const exts = imagesOnly
    ? /\.(png|jpe?g|webp|gif)$/i
    : /\.(png|jpe?g|webp|gif|pdf|docx?|pptx?|xlsx?|txt|md|csv)$/i;
  const found = await findVaultFiles(q, exts, 6);
  if (!found.length) {
    return [{ kind: "text", text: `ยังไม่เจอ${imagesOnly ? "รูป" : "ไฟล์"}ที่ตรงกับ "${q}" ในคลังเลยค่ะ ลองบอกชื่อ/คำที่เกี่ยวกับไฟล์นั้นอีกทีนะคะ` }];
  }
  const sends: Send[] = [
    { kind: "text", text: found.length === 1 ? "เจอไฟล์ในคลังค่ะ ส่งให้เลยนะคะ" : `เจอ ${found.length} ไฟล์ในคลังค่ะ ส่งให้เลยนะคะ` },
  ];
  let sent = 0;
  for (const f of found) {
    if (sent >= 4) break; // ส่งพอประมาณ กันสแปม
    let buf: Buffer;
    try {
      buf = await fs.readFile(f.path);
    } catch {
      continue;
    }
    if (buf.byteLength > MAX_SEND_BYTES) {
      sends.push({ kind: "text", text: `(${f.filename} ใหญ่เกินส่งในแชท ${(buf.byteLength / 1048576).toFixed(1)}MB)` });
      continue;
    }
    const isImg = /\.(png|jpe?g|webp|gif)$/i.test(f.filename);
    sends.push(
      isImg
        ? { kind: "photo", dataBase64: buf.toString("base64"), caption: f.filename }
        : { kind: "document", dataBase64: buf.toString("base64"), filename: f.filename, caption: f.filename },
    );
    sent++;
  }
  return sends;
}

// เก็บไฟล์/ลิงก์เข้าคลังความรู้ (Obsidian AI-Changoh/knowledge) — สั่งผ่านแชทได้เลย
// bot ดาวน์โหลดไฟล์ไว้แล้วส่ง path มา (รันเครื่องเดียวกัน) + ดึง URL จากข้อความ
export async function POST(req: Request) {
  const allowed = isServiceRequest(req) || (await getCurrentUser());
  if (!allowed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const text: string = String(body.text || "").trim();
  const files: { path: string; filename: string }[] = Array.isArray(body.files) ? body.files : [];
  const explicitUrls: string[] = Array.isArray(body.urls) ? body.urls : [];

  // ตรวจสิทธิ์ผู้สั่ง (จาก Telegram) — เหมือน endpoint สไลด์/เอกสาร
  const fromId = String(body.fromId || "");
  if (fromId) {
    if (body.isGroup) {
      const groups = await getAllowedGroups();
      if (!groups.includes(String(body.chatId)) && !(await isAuthorized(fromId))) {
        return NextResponse.json({ error: "unauthorized" }, { status: 403 });
      }
    } else if (!(await isAuthorized(fromId))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 403 });
    }
  }

  // โหมด "ขอไฟล์/รูปจากคลัง" → ค้นแล้วส่งกลับ
  if (body.mode === "find") {
    return NextResponse.json({ sends: await handleFind(String(body.query || text)) });
  }

  const urls = Array.from(new Set([...explicitUrls, ...extractUrls(text)])).slice(0, 5);
  if (!files.length && !urls.length) {
    return NextResponse.json({
      sends: [{ kind: "text", text: "ยังไม่เห็นไฟล์หรือลิงก์ที่จะเก็บเลยค่ะ แนบไฟล์ (PDF/Word/รูป/ข้อความ) หรือวางลิงก์มาได้เลยนะคะ" }],
    });
  }

  // หมายเหตุจากผู้ใช้ = ข้อความที่เหลือหลังตัดคำสั่ง/ลิงก์ออก (เอาไว้เป็นบริบทให้โน้ต)
  const userNote =
    text
      .replace(/https?:\/\/[^\s<>"')]+/gi, "")
      .replace(/(เก็บ|บันทึก|จำ|เพิ่ม|เซฟ|save|ขยาย|ลง)\s*(ไฟล์|เอกสาร|ลิงก์|อันนี้|นี้|เข้า(คลัง(ความรู้)?)?|ลงสมอง|ลง\s*obsidian)?\s*(หน่อย|ให้|ที|ด้วย|นะ)?/gi, "")
      .replace(/\s+/g, " ")
      .trim() || undefined;

  const results: KnowledgeResult[] = [];
  for (const f of files) {
    try {
      results.push(await ingestKnowledgeFile(f.path, f.filename, userNote));
    } catch (e) {
      results.push({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  for (const u of urls) {
    try {
      results.push(await ingestKnowledgeUrl(u, userNote));
    } catch (e) {
      results.push({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const ok = results.filter((r) => r.ok);
  const fail = results.filter((r) => !r.ok);

  if (!ok.length) {
    const why = fail.map((f) => f.error).filter(Boolean).join("; ") || "ไม่ทราบสาเหตุ";
    return NextResponse.json({ sends: [{ kind: "text", text: `เก็บเข้าคลังไม่สำเร็จค่ะ: ${why}` }] });
  }

  const lines: string[] = [
    ok.length === 1 ? "เก็บเข้าคลังความรู้ให้แล้วค่ะ ✅" : `เก็บเข้าคลังความรู้ให้แล้ว ${ok.length} รายการค่ะ ✅`,
  ];
  ok.forEach((r, i) => {
    lines.push("");
    lines.push(`${ok.length > 1 ? `${i + 1}. ` : "• "}${r.title || "โน้ต"}`);
    if (r.summary) lines.push(`   ${r.summary}`);
  });
  if (fail.length) {
    lines.push("");
    lines.push(`(มี ${fail.length} รายการเก็บไม่ได้: ${fail.map((f) => f.error).filter(Boolean).join("; ")})`);
  }
  lines.push("");
  lines.push("ครั้งหน้าถามถึงเรื่องนี้ได้เลย วานจะดึงเนื้อเต็มมาตอบให้ค่ะ");

  return NextResponse.json({ sends: [{ kind: "text", text: lines.join("\n") }] });
}
