import { db } from "./db";
import { askExtractor, getSetting } from "./kiki";
import { deleteGoogleEvent, moveGoogleEvent, thaiDate } from "./calendar";

/**
 * ระบบนัดหมายของ Vex — การ์ดนัดเดี่ยว/agenda สไตล์เดียวกับการ์ดการเงิน (ไร้อิโมจิ)
 * + เตือนหลายชั้น + แก้นัดด้วยภาษาคน + พยากรณ์อากาศ (Open-Meteo)
 */

export interface KikiEvent {
  id: string;
  date: Date;
  timeText: string | null;
  endTime?: string | null;
  title: string;
  location?: string | null;
  withWho?: string | null;
  note?: string | null;
  gcalEventId?: string | null;
  done: boolean;
}

// ===== เวลา =====

export function evStart(ev: KikiEvent): Date | null {
  if (!ev.timeText || !/^\d{1,2}:\d{2}$/.test(ev.timeText)) return null;
  const [h, m] = ev.timeText.split(":").map(Number);
  return new Date(ev.date.getFullYear(), ev.date.getMonth(), ev.date.getDate(), h, m);
}

export function evEnd(ev: KikiEvent): Date {
  const start = evStart(ev);
  if (!start) return new Date(ev.date.getFullYear(), ev.date.getMonth(), ev.date.getDate(), 23, 59);
  if (ev.endTime && /^\d{1,2}:\d{2}$/.test(ev.endTime)) {
    const [h, m] = ev.endTime.split(":").map(Number);
    return new Date(ev.date.getFullYear(), ev.date.getMonth(), ev.date.getDate(), h, m);
  }
  return new Date(start.getTime() + 2 * 3600_000);
}

export function fmtCountdown(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `${d} วัน ${h} ชม.`;
  if (h > 0) return `${h} ชม. ${String(m).padStart(2, "0")} นาที`;
  return `${m} นาที`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function timeRangeLabel(ev: KikiEvent): string {
  if (!ev.timeText) return "ทั้งวัน";
  const dur = ev.endTime ? "" : "";
  const range = ev.endTime ? `${ev.timeText} – ${ev.endTime} น.` : `${ev.timeText} น.`;
  const s = evStart(ev), e = evEnd(ev);
  if (s && ev.endTime) {
    const min = Math.round((e.getTime() - s.getTime()) / 60000);
    if (min > 0) return `${range} (${min >= 60 ? `${Math.floor(min / 60)} ชม.${min % 60 ? ` ${min % 60} นาที` : ""}` : `${min} นาที`})`;
  }
  return range + dur;
}

// ===== พยากรณ์อากาศ (Open-Meteo ฟรี ไม่ต้องมี key) =====

const weatherCache = new Map<string, { at: number; val: string | null }>();

export async function weatherFor(date: Date, fromHour?: number, toHour?: number): Promise<string | null> {
  try {
    // ไกลเกิน 7 วัน = พยากรณ์ไม่น่าเชื่อ ไม่ต้องโชว์
    const days = Math.round((date.getTime() - Date.now()) / 86400_000);
    if (days < 0 || days > 6) return null;
    const latlon = (await getSetting("kiki_home_latlon")) || "16.4419,102.8360"; // default ขอนแก่น
    const [lat, lon] = latlon.split(",").map((x) => x.trim());
    const dISO = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const key = `${dISO}:${fromHour ?? "all"}`;
    const hit = weatherCache.get(key);
    if (hit && Date.now() - hit.at < 30 * 60_000) return hit.val;

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation_probability,temperature_2m&timezone=Asia%2FBangkok&start_date=${dISO}&end_date=${dISO}`;
    const j = (await (await fetch(url, { signal: ctl.signal })).json()) as {
      hourly?: { time: string[]; precipitation_probability: number[]; temperature_2m: number[] };
    };
    clearTimeout(timer);
    if (!j.hourly?.time?.length) return null;
    const f = fromHour ?? 8, t = toHour ?? 20;
    let rainMax = 0, tempMin = 99, tempMax = -99;
    j.hourly.time.forEach((iso, i) => {
      const h = Number(iso.slice(11, 13));
      if (h < f || h > t) return;
      rainMax = Math.max(rainMax, j.hourly!.precipitation_probability[i] ?? 0);
      const tp = j.hourly!.temperature_2m[i];
      if (typeof tp === "number") { tempMin = Math.min(tempMin, tp); tempMax = Math.max(tempMax, tp); }
    });
    const temp = tempMax > -99 ? `${Math.round(tempMin)}–${Math.round(tempMax)}°` : "";
    const rain = rainMax >= 50 ? `โอกาสฝน ${rainMax}% พกร่มด้วย` : rainMax >= 25 ? `โอกาสฝน ${rainMax}%` : `ฝนไม่น่ามี (${rainMax}%)`;
    const val = [rain, temp].filter(Boolean).join(" · ");
    weatherCache.set(key, { at: Date.now(), val });
    return val;
  } catch {
    return null;
  }
}

// ===== การ์ด =====

function esc(s: string): string {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

const CARD_CSS = `
* { margin:0; padding:0; box-sizing:border-box; }
body { width:720px; background:#161b22; color:#e6edf3; font-family:"Noto Sans Thai","Sarabun","Helvetica Neue",Arial,sans-serif; padding:26px 30px 22px; -webkit-font-smoothing:antialiased; }
.kicker { font-size:12.5px; font-weight:700; color:#f0b429; letter-spacing:.4px; margin-bottom:6px; }
.title { font-size:24px; font-weight:800; line-height:1.25; }
.h2 { font-size:20px; font-weight:800; }
.muted { color:#8b949e; }
.h2 .muted { font-weight:600; }
.sub { color:#8b949e; font-size:13.5px; margin-top:4px; }
.hr { height:1px; background:#2d333b; margin:16px 0; }
.grid { display:flex; flex-direction:column; gap:9px; }
.row { display:flex; align-items:flex-start; gap:12px; }
.chip { flex:0 0 96px; font-size:12.5px; font-weight:600; color:#adbac7; background:#21262d; border-radius:6px; padding:6px 8px; text-align:center; }
.val { font-size:15px; padding-top:4px; }
.val b { font-weight:700; }
.val .muted { font-size:13px; }
.count { margin-top:14px; background:#1f2a1f; border:1px solid #2ea04326; border-radius:10px; padding:12px 16px; font-size:15px; }
.count b { color:#3fb950; font-size:17px; }
.count.warn { background:#2a1f1f; border-color:#e5534b26; }
.count.warn b { color:#ff7b72; }
.sect { font-size:13.5px; font-weight:700; margin:18px 0 10px; color:#adbac7; }
.tl { position:relative; height:64px; background:#1b2129; border-radius:10px; overflow:hidden; }
.tl .hourline { position:absolute; top:0; bottom:0; width:1px; background:#262c34; }
.tl .hlab { position:absolute; bottom:5px; font-size:10.5px; color:#6e7681; transform:translateX(-50%); }
.tl .ev { position:absolute; top:9px; height:30px; border-radius:6px; background:linear-gradient(90deg,#4b78ff,#7d9bff); font-size:12px; font-weight:700; color:#fff; padding:6px 10px; white-space:nowrap; overflow:hidden; }
.tl .ev.hot { background:linear-gradient(90deg,#f0b429,#ffd166); color:#3b2f00; }
.tl .nowline { position:absolute; top:0; bottom:0; width:2px; background:#ff7b72; }
.tl .nowdot { position:absolute; top:-1px; width:8px; height:8px; border-radius:50%; background:#ff7b72; transform:translateX(-3px); }
.aev { display:flex; gap:14px; padding:12px 0; border-bottom:1px solid #21262d; }
.aev:last-of-type { border-bottom:none; }
.tchip { flex:0 0 96px; align-self:flex-start; font-size:13px; font-weight:700; color:#adbac7; font-family:"SF Mono",ui-monospace,Menlo,"Noto Sans Thai",monospace; background:#21262d; border-radius:6px; padding:6px 8px; text-align:center; }
.tchip.next { background:#3b2f00; color:#ffd166; }
.tchip.done { color:#586069; text-decoration:line-through; }
.abody { flex:1; }
.ename { font-size:16px; font-weight:700; }
.ename.done { color:#586069; text-decoration:line-through; }
.edetail { font-size:13px; color:#8b949e; margin-top:3px; line-height:1.5; }
.badge { display:inline-block; font-size:11.5px; font-weight:700; border-radius:5px; padding:2px 8px; margin-left:8px; vertical-align:2px; }
.badge.next { background:#3b2f00; color:#ffd166; }
.badge.done { background:#1f2a1f; color:#3fb950; }
.eta { flex:0 0 auto; font-size:12.5px; color:#8b949e; align-self:flex-start; padding-top:8px; text-align:right; }
.eta b { color:#e6edf3; font-size:13.5px; }
.strip { margin-top:14px; background:#1b2129; border-radius:10px; padding:12px 16px; display:flex; justify-content:space-between; font-size:13px; }
.strip .k { color:#8b949e; }
.strip b { color:#3fb950; }
.dayhead { font-size:13.5px; font-weight:700; color:#f0b429; margin:16px 0 2px; }
.dayhead .muted { font-weight:600; color:#8b949e; }
.empty { color:#6e7681; font-size:13px; background:#1b2129; border:1px dashed #2d333b; border-radius:8px; padding:14px; text-align:center; }
.foot { border-top:1px solid #2d333b; margin-top:18px; padding-top:12px; font-size:12px; color:#6e7681; display:flex; justify-content:space-between; }
`;

const footNow = (now: Date) =>
  `<div class="foot"><span>${esc(now.toLocaleString("th-TH-u-ca-gregory", { dateStyle: "short", timeStyle: "short" }))}</span><span>Vex</span></div>`;

export interface EventCardOpts {
  mode: "created" | "eve" | "morning" | "hour" | "day";
  now?: Date;
  weather?: string | null;
  budgetLine?: string | null; // "ใช้ได้อีก 446 ฿"
  travelMin?: number; // นาทีเผื่อเดินทาง (ไว้คำนวณเวลาออกจากบ้าน)
  dayEvents?: KikiEvent[]; // นัดอื่นในวันเดียวกัน (วาดไทม์ไลน์)
}

// การ์ดนัดเดี่ยว — ตอนลงนัด / เตือนล่วงหน้า / เตือนใกล้ถึงเวลา
export function eventCardHtml(ev: KikiEvent, opts: EventCardOpts): string {
  const now = opts.now || new Date();
  const start = evStart(ev);
  const kicker =
    opts.mode === "created" ? "นัดใหม่ · ลงปฏิทินแล้ว"
    : opts.mode === "eve" ? "เตือนล่วงหน้า · พรุ่งนี้มีนัด"
    : opts.mode === "morning" ? "วันนี้มีนัด"
    : opts.mode === "day" ? "เตือนนัด · วันนี้ (ทั้งวัน)"
    : start ? `เตือนนัด · อีก ${fmtCountdown(start.getTime() - now.getTime())}` : "เตือนนัด";

  const rows: string[] = [];
  rows.push(`<div class="row"><div class="chip">เวลา</div><div class="val"><b>${esc(timeRangeLabel(ev))}</b></div></div>`);
  if (ev.location) rows.push(`<div class="row"><div class="chip">สถานที่</div><div class="val">${esc(ev.location)}</div></div>`);
  if (ev.withWho) rows.push(`<div class="row"><div class="chip">กับใคร</div><div class="val">${esc(ev.withWho)}</div></div>`);
  if (ev.note) rows.push(`<div class="row"><div class="chip">โน้ต</div><div class="val">${esc(ev.note)}</div></div>`);
  if (opts.weather) rows.push(`<div class="row"><div class="chip">อากาศ</div><div class="val">${esc(opts.weather)}</div></div>`);
  if (opts.budgetLine) rows.push(`<div class="row"><div class="chip">งบวันนี้</div><div class="val">${esc(opts.budgetLine)}</div></div>`);

  // แถบ countdown + เวลาควรออกจากบ้าน (เฉพาะนัดมีเวลา และยังไม่ถึง)
  let count = "";
  if (start && start.getTime() > now.getTime()) {
    const leave = opts.travelMin && ev.location ? new Date(start.getTime() - opts.travelMin * 60000) : null;
    const soon = start.getTime() - now.getTime() < 90 * 60000;
    count = `<div class="count${soon ? "" : ""}">เหลืออีก <b>${fmtCountdown(start.getTime() - now.getTime())}</b>${leave ? ` — ควรออกเดินทางประมาณ ${hhmm(leave)} น.` : ""}</div>`;
  } else if (!start && opts.mode !== "created") {
    count = `<div class="count">นัดทั้งวัน — จัดเวลาได้ตามสะดวก</div>`;
  }

  // ไทม์ไลน์ของวัน (เฉพาะนัดมีเวลา): หน้าต่าง = ก่อนเริ่ม 2 ชม. ถึง หลังจบ 1.5 ชม.
  let tl = "";
  if (start) {
    const end = evEnd(ev);
    const winStart = new Date(start.getTime() - 2 * 3600_000);
    const winEnd = new Date(end.getTime() + 1.5 * 3600_000);
    const span = winEnd.getTime() - winStart.getTime();
    const px = (d: Date) => Math.min(100, Math.max(0, ((d.getTime() - winStart.getTime()) / span) * 100));
    const hours: string[] = [];
    const cur = new Date(winStart);
    cur.setMinutes(0, 0, 0);
    if (cur < winStart) cur.setHours(cur.getHours() + 1);
    while (cur <= winEnd) {
      const x = px(cur);
      if (x <= 96) hours.push(`<div class="hourline" style="left:${x}%"></div><div class="hlab" style="left:${x}%${x < 4 ? "; margin-left:14px" : ""}">${hhmm(cur)}</div>`);
      else hours.push(`<div class="hourline" style="left:${x}%"></div>`);
      cur.setHours(cur.getHours() + 1);
    }
    const evs = (opts.dayEvents || []).filter((e) => e.id !== ev.id && evStart(e));
    const others = evs
      .map((e) => {
        const s2 = evStart(e)!;
        const e2 = evEnd(e);
        if (e2 < winStart || s2 > winEnd) return "";
        return `<div class="ev" style="left:${px(s2)}%; width:${Math.max(6, px(e2) - px(s2))}%">${esc(e.title)}</div>`;
      })
      .join("");
    const nowMark = now >= winStart && now <= winEnd ? `<div class="nowline" style="left:${px(now)}%"></div><div class="nowdot" style="left:${px(now)}%"></div>` : "";
    tl = `<div class="sect">ไทม์ไลน์วันนัด · ${hhmm(winStart)} – ${hhmm(winEnd)}</div>
    <div class="tl">${hours.join("")}${nowMark}${others}<div class="ev hot" style="left:${px(start)}%; width:${Math.max(8, px(end) - px(start))}%">${esc(ev.title)}</div></div>`;
  }

  return `<!doctype html><html lang="th"><head><meta charset="utf-8"/><style>${CARD_CSS}</style></head><body>
  <div class="kicker">${esc(kicker)}</div>
  <div class="title">${esc(ev.title)}</div>
  <div class="sub">${esc(thaiDate(ev.date))}${ev.date.toLocaleDateString("th-TH-u-ca-gregory", { weekday: "long" }) ? ` · ${esc(ev.date.toLocaleDateString("th-TH-u-ca-gregory", { weekday: "long" }))}` : ""}</div>
  <div class="hr"></div>
  <div class="grid">${rows.join("")}</div>
  ${count}
  ${tl}
  ${footNow(now)}
</body></html>`;
}

// การ์ดตารางทั้งวัน (agenda)
export function agendaCardHtml(
  events: KikiEvent[],
  opts: { heading?: string; now?: Date; budgetLine?: string | null; tomorrowLine?: string | null; travelMin?: number },
): string {
  const now = opts.now || new Date();
  const heading = opts.heading || "วันนี้";
  const sorted = [...events].sort((a, b) => (evStart(a)?.getTime() ?? a.date.getTime()) - (evStart(b)?.getTime() ?? b.date.getTime()));
  const nextEv = sorted.find((e) => !e.done && evEnd(e).getTime() > now.getTime());
  const passedCount = sorted.filter((e) => e.done || evEnd(e).getTime() <= now.getTime()).length;

  const rowsHtml = sorted.length
    ? sorted
        .map((e) => {
          const s = evStart(e);
          const passed = e.done || evEnd(e).getTime() <= now.getTime();
          const isNext = nextEv?.id === e.id;
          const chipCls = passed ? " done" : isNext ? " next" : "";
          const details = [
            [e.location, e.timeText ? timeRangeLabel(e) : "ทั้งวัน"].filter(Boolean).join(" · "),
            [e.withWho ? `กับ${e.withWho}` : "", e.note || ""].filter(Boolean).join(" · "),
          ].filter(Boolean);
          let eta = "";
          if (passed) eta = `<span class="badge done">${e.done ? "เสร็จแล้ว" : "ผ่านแล้ว"}</span>`;
          else if (isNext && s) {
            if (s.getTime() <= now.getTime()) {
              eta = `<span class="badge next">กำลังอยู่ในนัด</span>`;
            } else {
              const leave = opts.travelMin && e.location ? `<br/>ออกเดินทาง ~${hhmm(new Date(s.getTime() - opts.travelMin * 60000))}` : "";
              eta = `อีก <b>${fmtCountdown(s.getTime() - now.getTime())}</b>${leave}`;
            }
          }
          return `<div class="aev">
            <div class="tchip${chipCls}">${e.timeText || "ทั้งวัน"}</div>
            <div class="abody"><div class="ename${passed ? " done" : ""}">${esc(e.title)}${isNext && !passed ? '<span class="badge next">นัดถัดไป</span>' : ""}</div>
            ${details.length ? `<div class="edetail">${details.map(esc).join("<br/>")}</div>` : ""}</div>
            ${eta ? `<div class="eta">${eta}</div>` : ""}
          </div>`;
        })
        .join("")
    : `<div class="empty">วันนี้ว่าง ไม่มีนัด</div>`;

  const nextStart = nextEv ? evStart(nextEv) : null;
  const nextLabel = nextStart
    ? nextStart.getTime() > now.getTime()
      ? ` · นัดถัดไปอีก ${fmtCountdown(nextStart.getTime() - now.getTime())}`
      : ` · กำลังอยู่ในนัดตอนนี้`
    : "";
  const sub = sorted.length
    ? `${sorted.length} นัด${passedCount ? ` · ผ่านแล้ว ${passedCount}` : ""}${nextLabel}`
    : "ตารางโล่ง";

  const strip = opts.budgetLine || opts.tomorrowLine
    ? `<div class="strip"><span>${opts.budgetLine ? `<span class="k">งบวันนี้ใช้ได้อีก</span> <b>${esc(opts.budgetLine)}</b>` : ""}</span><span>${opts.tomorrowLine ? `<span class="k">พรุ่งนี้</span> ${esc(opts.tomorrowLine)}` : ""}</span></div>`
    : "";

  return `<!doctype html><html lang="th"><head><meta charset="utf-8"/><style>${CARD_CSS}</style></head><body>
  <div class="h2">${esc(heading)} <span class="muted">· ${esc(now.toLocaleDateString("th-TH-u-ca-gregory", { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}</span></div>
  <div class="sub">${esc(sub)}</div>
  <div class="hr"></div>
  ${rowsHtml}
  ${strip}
  ${footNow(now)}
</body></html>`;
}

// การ์ดสัปดาห์ — 7 วันข้างหน้า จัดกลุ่มตามวัน
export function weekCardHtml(byDay: { date: Date; events: KikiEvent[] }[], opts: { now?: Date } = {}): string {
  const now = opts.now || new Date();
  const total = byDay.reduce((s, d) => s + d.events.length, 0);
  const blocks = byDay
    .map((d) => {
      const label = d.date.toLocaleDateString("th-TH-u-ca-gregory", { weekday: "long", day: "numeric", month: "short" });
      const isToday = d.date.toDateString() === now.toDateString();
      const evs = d.events.length
        ? d.events
            .map((e) => `<div class="aev"><div class="tchip">${e.timeText || "ทั้งวัน"}</div><div class="abody"><div class="ename">${esc(e.title)}</div>${e.location ? `<div class="edetail">${esc(e.location)}</div>` : ""}</div></div>`)
            .join("")
        : `<div class="edetail" style="padding:6px 0 2px">— ว่าง</div>`;
      return `<div class="dayhead">${esc(label)}${isToday ? ' <span class="muted">(วันนี้)</span>' : ""}</div>${evs}`;
    })
    .join("");
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"/><style>${CARD_CSS}</style></head><body>
  <div class="h2">สัปดาห์นี้ <span class="muted">· ${total} นัดใน 7 วัน</span></div>
  <div class="hr"></div>
  ${blocks}
  ${footNow(now)}
</body></html>`;
}

// ===== แก้นัดด้วยภาษาคน (เลื่อน/ยกเลิก/เสร็จแล้ว) =====

const CAL_EDIT_SYSTEM = `คุณคือระบบแก้ไขตารางนัด ตอบ JSON เท่านั้น ไม่มีข้อความอื่น
โครงสร้าง: {"actions":[{"action":"cancel","id":"..."},{"action":"done","id":"..."},{"action":"move","id":"...","date":"YYYY-MM-DD","timeText":"HH:MM หรือว่าง","endTime":"HH:MM หรือว่าง"}],"reason":"สั้น ๆ"}
กติกา: เลือก id จากตารางเท่านั้น · "เลื่อน" = move ไปวัน/เวลาที่เจ้าของบอก (ไม่บอกเวลาใหม่ = คงเวลาเดิม) · "ยกเลิก/ลบนัด" = cancel · "เสร็จแล้ว/ไปมาแล้ว" = done · ไม่แน่ใจว่านัดไหน = actions ว่าง + บอกใน reason`;

export interface EditCalResult {
  applied: string[];
  reason: string;
}

export async function editCalendar(command: string, chatId: string): Promise<EditCalResult> {
  const from = new Date();
  from.setDate(from.getDate() - 2);
  from.setHours(0, 0, 0, 0);
  const rows = await db.calendarEvent.findMany({
    where: { agent: "kiki", chatId, date: { gte: from } },
    orderBy: { date: "asc" },
    take: 30,
  });
  if (!rows.length) return { applied: [], reason: "ไม่มีนัดในระบบช่วงนี้" };
  const todayISO = new Date().toISOString().slice(0, 10);
  const table = rows
    .map((r) => `${r.id} | ${r.date.toISOString().slice(0, 10)} | ${r.timeText || "ทั้งวัน"}${r.endTime ? `-${r.endTime}` : ""} | ${r.title} | ${r.location || "-"} | ${r.done ? "เสร็จแล้ว" : "ยังไม่เสร็จ"}`)
    .join("\n");
  const raw = await askExtractor(
    `วันนี้คือ ${todayISO}\nคำสั่งจากเจ้าของ: """${command}"""\n\nตารางนัด (id | วันที่ | เวลา | ชื่อนัด | สถานที่ | สถานะ):\n${table}`,
    { system: CAL_EDIT_SYSTEM, timeoutMs: 90_000 },
  );
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { applied: [], reason: "อ่านคำสั่งไม่ออก" };
  let actions: { action: string; id: string; date?: string; timeText?: string; endTime?: string }[] = [];
  let reason = "";
  try {
    const j = JSON.parse(m[0]);
    actions = Array.isArray(j.actions) ? j.actions : [];
    reason = String(j.reason || "");
  } catch {
    return { applied: [], reason: "อ่านคำสั่งไม่ออก" };
  }

  const applied: string[] = [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const a of actions.slice(0, 8)) {
    const row = byId.get(String(a.id));
    if (!row) continue;
    if (a.action === "cancel") {
      await db.calendarEvent.delete({ where: { id: row.id } }).catch(() => null);
      if (row.gcalEventId) await deleteGoogleEvent(row.gcalEventId);
      applied.push(`ยกเลิก: ${row.title} (${thaiDate(row.date)})`);
    } else if (a.action === "done") {
      await db.calendarEvent.update({ where: { id: row.id }, data: { done: true } }).catch(() => null);
      applied.push(`ติ๊กเสร็จ: ${row.title}`);
    } else if (a.action === "move" && a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date)) {
      const [y, mo, d] = a.date.split("-").map(Number);
      const newDate = new Date(y, mo - 1, d);
      const timeText = a.timeText && /^\d{1,2}:\d{2}$/.test(a.timeText) ? a.timeText : row.timeText;
      const endTime = a.endTime && /^\d{1,2}:\d{2}$/.test(a.endTime) ? a.endTime : row.endTime;
      await db.calendarEvent
        .update({ where: { id: row.id }, data: { date: newDate, timeText, endTime, notified: false, remindedEve: false, remindedHour: false, followedUp: false } })
        .catch(() => null);
      if (row.gcalEventId) await moveGoogleEvent(row.gcalEventId, a.date, timeText, endTime);
      applied.push(`เลื่อน: ${row.title} → ${thaiDate(newDate)}${timeText ? ` ${timeText} น.` : ""}`);
    }
  }
  return { applied, reason };
}
