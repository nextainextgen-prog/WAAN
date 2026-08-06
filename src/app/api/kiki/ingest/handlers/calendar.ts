import { renderHtmlToPng } from "@/lib/html-pdf";
import { extractEvents, createEvent, thaiDate } from "@/lib/calendar";
import { eventCardHtml, agendaCardHtml, weekCardHtml, editCalendar, weatherFor, evStart, type KikiEvent } from "@/lib/kiki-calendar";
import { askExtractor, getSetting, vexLine } from "@/lib/kiki";
import { vexSay, escHtml, toKikiEvent, budgetLineToday } from "../shared";
import type { Ctx, Handler } from "../types";
import { type Send } from "../types";

export const calendarEditHandler: Handler = async (ctx) => {
  const { chatId, text, replyText, msgId, is, reply } = ctx;
  // ===== ปฏิทิน: เลื่อน/ยกเลิก/เสร็จแล้ว (แก้ด้วยภาษาคน + sync Google Calendar) =====
  if (is("calendar_edit")) {
    const r = await editCalendar([replyText, text].filter(Boolean).join("\n"), chatId);
    if (!r.applied.length) {
      return reply([{ kind: "text", text: await vexLine(`ยังไม่ได้แตะนัดไหนนะครับ ⚠️ ${r.reason || "ไม่แน่ใจว่าหมายถึงนัดไหน"}\nบอกชื่อนัดชัด ๆ อีกทีได้เลย`), replyTo: msgId }]);
    }
    const t = await vexSay(
      `เพิ่งจัดการตารางนัดตามคำสั่งสำเร็จ ${r.applied.length} รายการ (sync Google Calendar ให้แล้วด้วย) — ยืนยันสั้น ๆ`,
      r.applied,
      `จัดการแล้วครับ ✅\n\n${r.applied.join("\n")}`,
    );
    return reply([{ kind: "text", text: t, replyTo: msgId }]);
  }

  return null;
};

export const calendarViewHandler: Handler = async (ctx) => {
  const { chatId, text, msgId, is, reply } = ctx;
  // ===== ปฏิทิน: ดู (วันนี้/พรุ่งนี้/สัปดาห์) =====
  if (is("calendar_view")) {
    const now = new Date();
    const travelMin = Number((await getSetting("kiki_travel_min")) || 40);
    const dayStartOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (/สัปดาห์|อาทิตย์|7\s*วัน/.test(text)) {
      const from = dayStartOf(now);
      const to = new Date(from.getTime() + 7 * 86400_000);
      const rows = await (await import("@/lib/db")).db.calendarEvent.findMany({ where: { agent: "kiki", chatId, date: { gte: from, lt: to } }, orderBy: { date: "asc" } });
      const byDay = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(from.getTime() + i * 86400_000);
        return { date: d, events: rows.filter((r) => r.date.toDateString() === d.toDateString()).map(toKikiEvent) };
      });
      try {
        const png = await renderHtmlToPng(weekCardHtml(byDay, { now }), { width: 720, height: 200 });
        return reply([
          { kind: "photo", dataBase64: png.toString("base64"), filename: "week.png" },
          { kind: "text", text: rows.length ? `สัปดาห์นี้ ${rows.length} นัดครับ รายละเอียดตามการ์ดเลย` : `สัปดาห์นี้โล่งครับ 🎯`, replyTo: msgId },
        ]);
      } catch { /* การ์ดพลาด → ตกไปตอบแบบข้อความ */ }
    }
    const tomorrow = /พรุ่งนี้/.test(text) && !/วันนี้/.test(text);
    const target = tomorrow ? new Date(dayStartOf(now).getTime() + 86400_000) : dayStartOf(now);
    const next = new Date(target.getTime() + 86400_000);
    const dbi = (await import("@/lib/db")).db;
    const rows = await dbi.calendarEvent.findMany({ where: { agent: "kiki", chatId, date: { gte: target, lt: next } }, orderBy: { date: "asc" } });
    const tomorrowRows = tomorrow ? [] : await dbi.calendarEvent.count({ where: { agent: "kiki", chatId, date: { gte: next, lt: new Date(next.getTime() + 86400_000) } } });
    try {
      const png = await renderHtmlToPng(
        agendaCardHtml(rows.map(toKikiEvent), {
          heading: tomorrow ? "พรุ่งนี้" : "วันนี้",
          now,
          travelMin,
          budgetLine: tomorrow ? null : (await budgetLineToday())?.replace("ใช้ได้อีก ", ""),
          tomorrowLine: tomorrow ? null : tomorrowRows ? `${tomorrowRows} นัด` : "ไม่มีนัด",
        }),
        { width: 720, height: 200 },
      );
      const t = rows.length ? `${tomorrow ? "พรุ่งนี้" : "วันนี้"}มี ${rows.length} นัดครับ` : `${tomorrow ? "พรุ่งนี้" : "วันนี้"}ว่างครับ ไม่มีนัด 🎯`;
      return reply([{ kind: "photo", dataBase64: png.toString("base64"), filename: "agenda.png" }, { kind: "text", text: t, replyTo: msgId }]);
    } catch {
      const t = rows.length
        ? `${rows.map((e) => `• ${e.timeText || "ทั้งวัน"} — ${e.title}${e.location ? ` (${e.location})` : ""}`).join("\n")}`
        : "ไม่มีนัดครับ";
      return reply([{ kind: "text", text: t, replyTo: msgId }]);
    }
  }
  return null;
};

export const calendarCreateHandler: Handler = async (ctx) => {
  const { chatId, text, fromId, fromName, msgId, is, reply } = ctx;
  // ===== ปฏิทิน: ลงนัด =====
  if (is("calendar_create")) {
    try {
      const parsedList = await extractEvents(text, askExtractor);
      if (parsedList.length) {
        const now = new Date();
        const travelMin = Number((await getSetting("kiki_travel_min")) || 40);
        const budgetLine = await budgetLineToday();
        const sends: Send[] = [];
        const lines: string[] = [];
        const links: string[] = [];
        const createdList: { id: string; date: Date; timeText: string | null; title: string }[] = [];
        let authFailed = false;
        const dbi = (await import("@/lib/db")).db;
        for (const parsed of parsedList) {
          const ev = await createEvent({ chatId, parsed, createdById: fromId, creatorName: fromName || undefined, agent: "kiki" });
          if (ev.gcalError === "need_auth") authFailed = true;
          const kev: KikiEvent = { id: ev.id, date: ev.date, timeText: ev.timeText, endTime: parsed.endTime || null, title: ev.title, location: parsed.location || null, withWho: parsed.withWho || null, note: parsed.note || null, done: false };
          createdList.push({ id: ev.id, date: ev.date, timeText: ev.timeText, title: ev.title });
          lines.push(`${ev.title} — ${thaiDate(ev.date)}${ev.timeText ? ` ${ev.timeText}${parsed.endTime ? `–${parsed.endTime}` : ""} น.` : " (ทั้งวัน)"}${parsed.location ? ` ที่${parsed.location}` : ""}`);
          if (ev.gcalLink) links.push(ev.gcalLink);
          try {
            const st = evStart(kev);
            const weather = await weatherFor(ev.date, st ? st.getHours() - 1 : undefined, st ? Math.min(23, st.getHours() + 4) : undefined);
            const dayStartOf = new Date(ev.date.getFullYear(), ev.date.getMonth(), ev.date.getDate());
            const dayRows = await dbi.calendarEvent.findMany({ where: { agent: "kiki", chatId, date: { gte: dayStartOf, lt: new Date(dayStartOf.getTime() + 86400_000) } } });
            const png = await renderHtmlToPng(
              eventCardHtml(kev, { mode: "created", now, weather, budgetLine, travelMin, dayEvents: dayRows.map(toKikiEvent) }),
              { width: 720, height: 200 },
            );
            sends.push({ kind: "photo", dataBase64: png.toString("base64"), filename: "event.png" });
          } catch { /* ภาพพลาดไม่เป็นไร ข้อความยังครบ */ }
        }
        // B4 (7 ส.ค. 2026): ลงนัดแล้วเช็คชนทันที — นัดวันเดียวกันห่างกันไม่ถึง 90 นาที = ทักในคำตอบเดิม
        // (เชิงรุกแบบ in-reply: เจ้าของกำลังคุยอยู่แล้ว ไม่ใช่การพูดแทรก — ไม่ต้องรอสวิตช์)
        const clashNotes: string[] = [];
        try {
          const toMin = (tt: string | null | undefined): number | null => {
            if (!tt) return null;
            const m = tt.match(/^(\d{1,2})[:.](\d{2})/);
            return m ? Number(m[1]) * 60 + Number(m[2]) : null;
          };
          for (const created of createdList) {
            const newMin = toMin(created.timeText);
            if (newMin === null) continue;
            const d0 = new Date(created.date.getFullYear(), created.date.getMonth(), created.date.getDate());
            const sameDay = await dbi.calendarEvent.findMany({
              where: { agent: "kiki", chatId, done: false, date: { gte: d0, lt: new Date(d0.getTime() + 86400_000) } },
            });
            for (const other of sameDay) {
              if (other.id === created.id) continue; // ตัวมันเอง
              const oMin = toMin(other.timeText);
              if (oMin === null) continue;
              const gap = Math.abs(oMin - newMin);
              if (gap < 90) {
                clashNotes.push(`"${created.title}" (${created.timeText}) กับ "${other.title}" (${other.timeText}) ห่างกันแค่ ${gap} นาที`);
              }
            }
          }
        } catch { /* เช็คไม่ได้ก็ลงนัดตามปกติ */ }

        let t = await vexSay(
          `เพิ่งลงนัดให้เจ้าของ ${parsedList.length} รายการ (การ์ดรายละเอียดส่งไปแล้ว) — ยืนยันสั้นมาก 1-2 บรรทัด + บอกว่าจะเตือนเย็นก่อนวันนัด เช้าวันนัด และก่อนถึงเวลา 1 ชม.` +
            (clashNotes.length ? `\nสำคัญ: นัดใหม่ชนกับนัดเดิม — ${clashNotes.join(" · ")} — ต้องทักให้เห็นชัด ๆ พร้อมเสนอว่าจะเลื่อนตัวไหนดี` : ""),
          [...lines, ...clashNotes.map((c) => `⚠️ ${c}`)],
          `ลงนัดแล้วครับ ✅ ${lines.join(" · ")}\n${clashNotes.length ? `⚠️ นัดชนกัน: ${clashNotes.join(" · ")}\n` : ""}เดี๋ยวผมเตือนเป็นระยะเอง`,
        );
        if (authFailed) t += `\n\n⚠️ ลงในระบบแล้ว แต่ Google Calendar ยังไม่เชื่อม — รัน npm run drive:auth แล้วสั่งใหม่นะครับ`;
        let html = escHtml(t);
        if (links.length) html += `\n\n${links.map((l, i) => `<a href="${l}">เปิดใน Google Calendar${links.length > 1 ? ` (${i + 1})` : ""}</a>`).join(" · ")}`;
        sends.push({ kind: "text", text: html, parseMode: "HTML", noPreview: true, replyTo: msgId });
        return reply(sends);
      }
    } catch { /* แยกไม่ได้ → คุยปกติให้ถามต่อ */ }
  }

  return null;
};
