import path from "node:path";
import fs from "node:fs";
import { vexList } from "@/lib/kiki-format";
import { findPersonalImages, vexLine } from "@/lib/kiki";
import type { Ctx, Handler } from "../types";
import { type Send } from "../types";

export const imageSaveHandler: Handler = async (ctx) => {
  const { text, imageFiles, videoFiles, msgId, is, reply } = ctx;
  // ===== เก็บรูปเข้าคลัง (เจ้าของสั่ง "เก็บรูปนี้") — เช็คก่อนเรื่องเงิน =====
  if ((imageFiles.length || videoFiles.length) && is("image_save")) {
    const { saveMedia } = await import("@/lib/kiki-media");
    const label = text.replace(/เก็บ|เซฟ|บันทึก|save|รูป(นี้|พวกนี้)?|ภาพ(นี้|พวกนี้)?|วิดีโอ|คลิป(นี้)?|ไว้|ให้(หน่อย|ที)?|ด้วย|นะ|ครับ|หน่อย/gi, " ").replace(/\s+/g, " ").trim();
    const saved: { what: string; desc: string }[] = [];
    for (const p of imageFiles) {
      const r = await saveMedia(p, "image", label || undefined);
      if (r) saved.push({ what: "รูป", desc: r.description });
    }
    for (const v of videoFiles) {
      const r = await saveMedia(v.path, "video", label || v.name);
      if (r) saved.push({ what: "วิดีโอ", desc: r.description || v.name });
    }
    if (!saved.length) return reply([{ kind: "text", text: await vexLine("เก็บไม่สำเร็จครับ ⚠️ ลองส่งใหม่อีกทีนะครับ"), replyTo: msgId }]);
    const block = vexList({
      title: `เก็บเข้าคลังแล้ว ${saved.length} ไฟล์`,
      items: saved.map((x) => ({ main: `${x.what}${label ? ` — ${label}` : ""}`, sub: x.desc.slice(0, 160) || undefined })),
      note: 'ขอคืนได้ทุกเมื่อ พูดธรรมดาเลย เช่น "ขอรูปที่เก็บเรื่อง..." ผมค้นจากสิ่งที่อยู่ในรูปได้ด้วย',
    });
    return reply([{ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId }]);
  }

  return null;
};

export const imageFindHandler: Handler = async (ctx) => {
  const { text, imageFiles, msgId, is, reply } = ctx;
  // ===== ขอรูปที่เคยเก็บกลับ =====
  if (!imageFiles.length && is("image_find")) {
    const { findMedia } = await import("@/lib/kiki-media");
    const hits = await findMedia(text).catch(() => []);
    const sends: Send[] = [];
    for (const h of hits) {
      try {
        const b64 = fs.readFileSync(h.abs).toString("base64");
        const cap = `${h.label || h.description.slice(0, 120)} · ${h.createdAt.toLocaleDateString("th-TH-u-ca-gregory", { day: "numeric", month: "short" })}`;
        sends.push({ kind: h.kind === "video" ? "video" : "photo", dataBase64: b64, filename: path.basename(h.abs), caption: cap.slice(0, 200) });
      } catch { /* ไฟล์เสีย ข้าม */ }
    }
    if (sends.length) {
      sends.unshift({ kind: "text", text: await vexLine(`เจอ ${sends.length} ไฟล์ครับ`), replyTo: msgId });
      return reply(sends);
    }
    // ระบบเก่า (รูปที่เก็บก่อนมีตาราง KikiMedia)
    const found = await findPersonalImages(text);
    if (found.length) {
      const old: Send[] = [{ kind: "text", text: await vexLine(`เจอในคลังเก่าครับ ${found.length} รูป`), replyTo: msgId }];
      for (const f of found) {
        try {
          old.push({ kind: "photo", dataBase64: fs.readFileSync(f.path).toString("base64"), filename: path.basename(f.path), caption: f.label || undefined });
        } catch { /* ข้าม */ }
      }
      if (old.length > 1) return reply(old);
    }
    return reply([{ kind: "text", text: await vexLine("หาไม่เจอครับ — ผมเก็บเฉพาะไฟล์ที่พี่สั่งให้เก็บเท่านั้น (ส่งมาเฉย ๆ ผมดูให้แต่ไม่ได้เก็บ)"), replyTo: msgId }]);
  }

  return null;
};
