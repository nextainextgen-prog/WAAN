import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { askBrain, type BrainModel } from "@/lib/brain";
import { saveChat, getChatHistory } from "@/lib/secretary";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const message: string = (body.message || "").trim();
  if (!message) return NextResponse.json({ error: "empty message" }, { status: 400 });

  const requestedModel: BrainModel | undefined = body.model;

  await saveChat("user", message);

  const history = await getChatHistory(10);
  const convo = history
    .slice(0, -1) // ไม่รวมข้อความล่าสุดที่เพิ่งบันทึก (จะใส่เป็นคำถามหลัก)
    .map((m) => `${m.role === "user" ? "อาจารย์" : "เลขา AI"}: ${m.content}`)
    .join("\n");

  const extraContext = convo ? `=== บทสนทนาก่อนหน้า ===\n${convo}` : undefined;

  try {
    const { reply, model } = await askBrain(message, { model: requestedModel, extraContext });
    await saveChat("assistant", reply);
    return NextResponse.json({ reply, model });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const fallback = `ขออภัยครับ ตอนนี้เชื่อมต่อสมอง AI ไม่ได้ (${detail})`;
    await saveChat("assistant", fallback);
    return NextResponse.json({ error: detail, reply: fallback }, { status: 200 });
  }
}
