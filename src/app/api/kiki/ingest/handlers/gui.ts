import fs from "node:fs";
import path from "node:path";
import { vexLine } from "@/lib/kiki";
import type { Handler, Send } from "../types";

/**
 * คุมแอปบนเครื่องแทนเจ้าของ: พิมพ์/ส่งข้อความ · สลับห้อง-แท็บ · สั่งคำสั่งใน Warp
 *
 * เคสที่พัง (4 ส.ค. 2026): เจ้าของ reply ภาพหน้าจอ Discord แล้วบอก "พิมพ์ไปในห้องนี้หน่อย"
 * → ระบบตีความว่า "ห้อง" = กลุ่ม Telegram แล้วไปโพสต์ผิดที่
 *
 * กติกาของเส้นทางนี้: ลงมือแล้วต้องมี "ภาพหน้าจอ" เป็นหลักฐานเสมอ และให้ระบบเป็นคนสรุปผล
 * จากสิ่งที่เกิดขึ้นจริง (มีไฟล์ภาพ/พิมพ์สำเร็จ/กดส่งแล้ว) ไม่ใช่ให้โมเดลเคลมเอง
 */
export const guiHandler: Handler = async (ctx) => {
  const { msgId, route, is, arg, reply } = ctx;
  if (!is("gui_type") && !is("gui_switch") && !is("warp_cmd")) return null;

  const { typeInApp, switchTo, runInWarp } = await import("@/lib/kiki-gui");
  const appName = arg("app") || (is("warp_cmd") ? "Warp" : "");
  const target = arg("target") || arg("tab");
  const message = arg("message") || arg("command");

  let r;
  if (is("gui_switch")) {
    if (!appName || !target) {
      return reply([{ kind: "text", text: await vexLine("บอกด้วยครับว่าให้เปิดแอปไหน ห้องหรือแท็บชื่ออะไร"), replyTo: msgId }]);
    }
    r = await switchTo(appName, target);
  } else {
    if (!message) {
      return reply([{ kind: "text", text: await vexLine("บอกข้อความที่จะให้พิมพ์มาด้วยครับ"), replyTo: msgId }]);
    }
    if (!appName) {
      return reply([{ kind: "text", text: await vexLine("บอกด้วยครับว่าให้พิมพ์ในแอปไหน เช่น Discord, Warp, LINE"), replyTo: msgId }]);
    }
    // คำสั่งใน Warp = กดส่งเสมอ (มันคือคำสั่ง) · แอปแชท = ส่งเมื่อสั่งให้ส่ง
    const wantSend = is("warp_cmd") ? true : route.args?.send !== false;
    r = is("warp_cmd")
      ? await runInWarp(message, { tab: target || undefined })
      : await typeInApp({ app: appName, target: target || undefined, text: message, send: wantSend });
  }

  const sends: Send[] = [];
  for (const shot of r.shots) {
    try {
      sends.push({
        kind: "photo",
        dataBase64: fs.readFileSync(shot.path).toString("base64"),
        filename: path.basename(shot.path),
        caption: shot.label,
      });
    } catch { /* ภาพหาย ข้าม */ }
  }

  const facts = r.ok
    ? [
        `แอป: ${r.app}${r.target ? ` · ${r.target}` : ""}`,
        r.typed ? `พิมพ์: ${r.typed.slice(0, 300)}` : "",
        r.sent ? "กดส่งแล้ว" : r.typed ? "พิมพ์ค้างไว้ ยังไม่กดส่ง" : "",
        sends.length ? `แนบภาพหน้าจอ ${sends.length} รูปเป็นหลักฐาน` : "แคปหน้าจอไม่สำเร็จ เลยไม่มีหลักฐานภาพรอบนี้",
      ].filter(Boolean)
    : [`ทำไม่สำเร็จ: ${r.problem || "ไม่ทราบสาเหตุ"}`];

  sends.push({ kind: "text", text: await vexLine(facts.join("\n")), replyTo: msgId });
  return reply(sends);
};
