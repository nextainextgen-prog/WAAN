import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listSlides } from "@/lib/slide-store";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const slides = await listSlides();
  return NextResponse.json({ slides });
}
