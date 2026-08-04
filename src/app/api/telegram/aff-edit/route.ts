import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { interpretEdit, parseFieldValue, validateOverrides, buildDiff, FIELDS, type FieldKey } from "@/lib/aff-edit";
import type { EditOverrides } from "@/lib/aff-make";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * ตีความคำสั่งแก้เอกสาร AFF → คืน overrides + ตาราง "เดิม → ใหม่" ให้บอทเอาไปให้แอดมินยืนยันก่อนออกเอกสาร
 * mode "parse" : ข้อความอิสระ หรือพิมพ์ตามเลขข้อ ("2 = นายสมชาย")
 * mode "field" : กดปุ่มเลือกช่องแล้วพิมพ์ค่าล้วน (รู้ช่องแน่นอน แม่นที่สุด)
 */
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const summary = String(b.summary || "");
  const prev = (b.overrides || {}) as EditOverrides; // ที่สะสมไว้จากรอบก่อน (แก้หลายช่องทีละรอบ)

  let fresh: EditOverrides = {};
  let rejected: { key: string; value: string; why: string }[] = [];
  let unsupported: string[] = [];

  if (b.mode === "field") {
    const field = String(b.field || "") as FieldKey;
    if (!FIELDS.some((f) => f.key === field)) return NextResponse.json({ ok: false, error: "unknown field" }, { status: 400 });
    const parsed = await parseFieldValue(field, String(b.value || ""));
    const v = validateOverrides(parsed);
    fresh = v.clean;
    rejected = v.rejected;
  } else {
    const r = await interpretEdit(String(b.text || ""));
    fresh = r.overrides;
    rejected = r.rejected;
    unsupported = r.unsupported;
  }

  const overrides: EditOverrides = { ...prev, ...fresh };
  return NextResponse.json({
    ok: true,
    overrides,
    changed: Object.keys(fresh),
    diff: buildDiff(summary, overrides),
    rejected,
    unsupported,
    fields: FIELDS.map((f) => ({ key: f.key, label: f.label, ask: f.ask, no: f.no })),
  });
}
