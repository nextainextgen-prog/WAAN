import fs from "node:fs";
import path from "node:path";
import { vexLine, askKiki } from "@/lib/kiki";
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

  const { typeInApp, switchTo, runInWarp, guessAppFromText, currentAppName } = await import("@/lib/kiki-gui");
  // ตัวอ่านเจตนาบางรอบกรอก args ไม่ครบ (ใช้ชื่อคีย์อื่น/ไม่ใส่ชื่อแอป) — เดาต่อเองแทนที่จะถามกลับ
  // ลำดับ: ที่สั่งมาตรง ๆ → Warp (ถ้าเป็นคำสั่งเทอร์มินัล) → เดาจากคำพูด → แอปที่อยู่บนจอ (ตอน reply ภาพหน้าจอ)
  const said = arg("app");
  const appName =
    (/^(unknown|ไม่ทราบ|-)$/i.test(said) ? "" : said) ||
    (is("warp_cmd") ? "Warp" : "") ||
    guessAppFromText(`${ctx.text} ${ctx.replyText}`) ||
    (ctx.replyIsScreenshot ? (await currentAppName()) || "" : "");
  const target = arg("target") || arg("tab") || arg("channel") || arg("room");
  const message = arg("message") || arg("command") || arg("text");

  // Discord มี API ของบอทอยู่แล้ว → ส่งผ่าน API ชัวร์กว่าการกดคีย์บนหน้าจอมาก
  // (เทสจริง: กดคีย์ใส่หน้าต่าง Discord แล้วโฟกัสหลุด ข้อความไม่เข้าช่องพิมพ์)
  // แล้วค่อยแคปหน้าจอ Discord แนบเป็นหลักฐานตามที่เจ้าของสั่ง
  if (/discord/i.test(appName) && !is("gui_switch") && message) {
    const { discordApiReady, sendToChannel, resolveChannel } = await import("@/lib/kiki-discord-api");
    if (discordApiReady()) {
      // ปลายทางต้องเป็น "ห้องใน Discord" จริง ๆ เท่านั้น
      // เคยพลาด 5 ส.ค.: เจ้าของยืนยันจะตอบแฟน ระบบดันเอาชื่อคนไปหาเป็นห้อง Discord แล้วตอบว่าหาห้องไม่เจอ
      if (target && !(await resolveChannel(target).catch(() => null))) return null;
      const sent = await sendToChannel(target || process.env.DISCORD_TEXT_CH_ID || "", message);
      const shots: { label: string; path: string }[] = [];
      if (sent.ok) {
        // แค่เปิด Discord ขึ้นมาแล้วแคป — ไม่กดคีย์สลับห้อง (เคยทำแล้วป๊อปอัปค้างบนจอเจ้าของ)
        const { showApp } = await import("@/lib/kiki-gui");
        shots.push(...(await showApp("Discord").catch(() => [])));
      }
      const sends: Send[] = [];
      for (const shot of shots) {
        try {
          sends.push({ kind: "photo", dataBase64: fs.readFileSync(shot.path).toString("base64"), filename: path.basename(shot.path), caption: "หน้าจอ Discord หลังส่ง" });
        } catch { /* ภาพหาย ข้าม */ }
      }
      sends.push({
        kind: "text",
        text: await vexLine(
          sent.ok
            ? `ส่งเข้าห้อง #${sent.channelName} ใน Discord แล้ว\nข้อความ: ${message.slice(0, 300)}\nยืนยันจากระบบ Discord แล้วว่าข้อความถูกสร้างจริง${sends.length ? " และแคปหน้าจอแนบมาให้" : ""}`
            : `ส่งเข้า Discord ไม่สำเร็จ: ${sent.problem || "ไม่ทราบสาเหตุ"}`,
        ),
        replyTo: msgId,
      });
      return reply(sends);
    }
  }

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
      // ไม่รู้ว่าแอปไหน + ไม่มีคำสั่งพิมพ์ชัดเจน = น่าจะอ่านเจตนาผิด ปล่อยให้เส้นทางอื่นรับไป
      // (ดีกว่าถามกลับมั่ว ๆ ตอนเจ้าของแค่พิมพ์ว่า "ยืนยัน")
      if (!/พิมพ์|เขียน|ส่งข้อความ|ตอบใน|คีย์|ก็อป/.test(`${ctx.text} ${ctx.replyText}`)) return null;
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

  // ===== สั่งให้ "ไปดู" = ต้องเล่าได้ว่าบนจอมีอะไร (6 ส.ค. 2026) =====
  // เจ้าของถาม "ไปดูแท็บนั้นหน่อย มีอัปเดทมั้ย" แล้วได้แค่ภาพกับคำว่า "สลับให้แล้ว" = ไม่ตอบคำถาม
  // เขาถามว่า "มีอัปเดทมั้ย" ต้องอ่านจอแล้วตอบ
  if (is("gui_switch") && r.ok && r.shots.length) {
    const shot = r.shots[r.shots.length - 1].path;
    const seen = await askKiki(
      `[เจ้าของสั่งให้ไปดูหน้าจอแล้วรายงาน] เขาพูดว่า: """${ctx.text.slice(0, 300)}"""\n` +
        `ระบบเปิด ${r.app}${r.target ? ` ไปที่ "${r.target}"` : ""} แล้วแคปหน้าจอมาให้ที่ path นี้: ${shot}\n\n` +
        `เปิดภาพอ่านด้วยเครื่องมือ Read แล้วเล่าว่าบนจอมีอะไร โดยตอบ "คำถามที่เขาถาม" เป็นหลัก\n` +
        `ถ้าถามว่ามีอัปเดทมั้ย = ดูว่ามีอะไรคืบหน้า/จบแล้ว/ค้างอยู่ตรงไหน แล้วตอบตรง ๆ\n` +
        `อ่านไม่ออกให้บอกตรง ๆ ห้ามเดาว่าจอมีอะไร`,
    ).catch(() => "");
    if (seen) {
      sends.push({ kind: "text", text: seen, replyTo: msgId });
      return reply(sends);
    }
  }

  // รายงานตามหลักฐานจริงเท่านั้น — "กดปุ่มส่งแล้ว" ไม่เท่ากับ "ข้อความขึ้นในห้องแล้ว"
  const facts = r.ok
    ? [
        `แอป: ${r.app}${r.target ? ` · ${r.target}` : ""}`,
        r.typed ? `พิมพ์: ${r.typed.slice(0, 300)}` : "",
        r.sent && r.verified === true
          ? "ส่งขึ้นในห้องแล้ว (ตรวจจากภาพหน้าจอแล้วเห็นจริง)"
          : r.sent && r.verified === null
            ? "กดส่งแล้ว แต่ตรวจภาพยืนยันไม่ได้ — ช่วยดูภาพให้หน่อยว่าขึ้นจริงไหม"
            : r.typed
              ? "พิมพ์ค้างไว้ ยังไม่กดส่ง"
              : "",
        sends.length ? `แนบภาพหน้าจอ ${sends.length} รูปเป็นหลักฐาน` : "แคปหน้าจอไม่สำเร็จ เลยไม่มีหลักฐานภาพรอบนี้",
      ].filter(Boolean)
    : [`ทำไม่สำเร็จ: ${r.problem || "ไม่ทราบสาเหตุ"}`];

  sends.push({ kind: "text", text: await vexLine(facts.join("\n")), replyTo: msgId });
  return reply(sends);
};
