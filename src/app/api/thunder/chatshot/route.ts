import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { isServiceRequest } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// รับภาพแคปหน้าจอแชทของเคสเด่น → เก็บไฟล์ + ผูก path ไว้กับ ChatLog
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const convId = String(b.convId || "").trim();
  const imageBase64 = String(b.imageBase64 || "");
  if (!convId || !imageBase64) return NextResponse.json({ ok: false, skip: "ไม่มี convId/ภาพ" });

  const row = await db.chatLog.findFirst({ where: { convId }, orderBy: { createdAt: "desc" } });
  if (!row) return NextResponse.json({ ok: false, skip: "ไม่พบ ChatLog" });

  const dir = path.join(process.cwd(), ".run-logs", "shots", row.bizDate);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${convId}.jpg`);
  fs.writeFileSync(file, Buffer.from(imageBase64, "base64"));

  await db.chatLog.update({ where: { id: row.id }, data: { shotPath: file } });
  return NextResponse.json({ ok: true, path: file, bytes: Buffer.byteLength(imageBase64, "base64") });
}
