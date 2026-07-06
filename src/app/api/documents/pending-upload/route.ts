import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { listPendingDriveUpload } from "@/lib/documents";

export const runtime = "nodejs";

// ให้ drive-watch ดึงเอกสารที่เซ็นแล้วแต่ยังไม่อัปกลับ Drive
export async function GET(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const docs = await listPendingDriveUpload();
  return NextResponse.json({
    documents: docs.map((d) => ({
      id: d.id,
      filename: d.filename,
      driveFileId: d.driveFileId,
      signedUrl: `/api/documents/${d.id}/download?type=signed`,
    })),
  });
}
