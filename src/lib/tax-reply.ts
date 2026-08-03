import { findTax, sortLatest, isDelivered, companiesOf, countDelivered, suggestFor, otherBrandCount, type TaxRow, type TaxDate, type Brand } from "./tax-invoice";
import { trackParcels, extractTrackingNos, trackingNote, stageBar, STAGE_LABEL, type TrackResult } from "./thailandpost";

/**
 * แปลงแถวในชีตเป็นคำตอบในแชท
 *  - บล็อกบน  = รายละเอียดครบให้แอดมินอ่าน
 *  - บล็อกล่าง = ข้อความสำหรับส่งลูกค้า อยู่ใน <pre> → Telegram ขึ้นปุ่ม copy ให้กดก็อปทั้งก้อน
 *
 * กฎที่ยึด (โด้สั่ง): ตีความข้อมูลเพี้ยนให้ แต่ต้องบอกตรง ๆ ว่าตีความอะไรไป ไม่เดาเงียบ
 */

const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
const isUrl = (s: string) => /^https?:\/\//i.test(s);

const KIND_LABEL = { invoice: "ใบกำกับภาษี", withholding: "เอกสารหัก ณ ที่จ่าย" } as const;

function dateLine(ds: TaxDate[]): string {
  return ds.map((d) => (d.unparsed ? `${esc(d.text)} (อ่านไม่ออก)` : esc(d.text))).join(" · ");
}

// ช่องทาง "ไปรษณีย์, email" + 2 วันที่ → จับคู่ให้ว่าวันไหนคือช่องทางไหน (ชีตเรียงตามลำดับช่องทาง)
function deliveryDetail(r: TaxRow): string[] {
  const out: string[] = [];
  const chans = splitChans(r.channel);
  if (chans.length > 1 && chans.length === r.delivered.length) {
    r.delivered.forEach((d, i) => out.push(`${esc(chanLabel(chans[i]))} — ${esc(d.text)}`));
  } else if (r.delivered.length) {
    out.push(`${esc(channelPhrase(r.channel) || "ไม่ระบุช่องทาง")} — ${dateLine(r.delivered)}`);
  }
  return out;
}

// ช่องทางที่แปลว่า "ยังไม่ได้ส่ง" (ชีตกรอกไว้ในคอลัมน์ช่องทางเลย ~40 แถว)
const NOT_SENT_CHAN = /ยังไม่ได้ส่ง|ยังไม่ส่ง/;

/**
 * บล็อก "การจัดส่ง" — แยกให้ชัดว่าช่องทางไหนส่งวันไหน แล้วห้อยสถานะพัสดุใต้ช่องไปรษณีย์
 * เป้าหมายคือแอดมินกวาดตาแล้วรู้ทันทีว่า อีเมลส่งไปแล้ววันไหน ไปรษณีย์ถึงไหนแล้ว
 */
function deliveryBlock(r: TaxRow, tracked: TrackResult[]): string[] {
  const lines: string[] = [`<b>การจัดส่ง</b>`];
  const chans = splitChans(r.channel);
  const paired = chans.length > 1 && chans.length === r.delivered.length;

  if (!chans.length && !r.delivered.length) lines.push(`   ยังไม่ระบุช่องทางในชีต`);

  chans.forEach((c, i) => {
    if (NOT_SENT_CHAN.test(c)) {
      lines.push(`   ⏳ <b>ยังไม่ได้ส่ง</b> — ชีตระบุไว้ว่ายังไม่ได้ส่งเอกสาร`);
      return;
    }
    const label = chanLabel(c);
    // จับคู่วันได้เมื่อจำนวนช่องทาง = จำนวนวันที่ ไม่งั้นบอกรวม ๆ ไม่เดาว่าวันไหนของช่องทางไหน
    const when = paired ? r.delivered[i]?.text : r.delivered.length ? dateLine(r.delivered) : "";
    lines.push(`   <b>${esc(label)}</b> — ${when ? `ส่งเมื่อ ${esc(when)}` : "ยังไม่ลงวันที่ในชีต"}`);
    if (/ไปรษณีย/.test(label)) lines.push(...postLines(tracked));
  });

  // ไม่มีคอลัมน์ช่องทาง แต่มีวันที่ → อย่างน้อยบอกวัน
  if (!chans.length && r.delivered.length) lines.push(`   ส่งเมื่อ ${dateLine(r.delivered)}`);
  return lines;
}

// สถานะพัสดุใต้ช่อง "ไปรษณีย์"
function postLines(tracked: TrackResult[]): string[] {
  const out: string[] = [];
  for (const t of tracked) {
    if (!t.ok) {
      out.push(
        `      เลขพัสดุ <code>${esc(t.trackingNo)}</code>`,
        `      <i>ไปรษณีย์ไทยไม่มีข้อมูลเลขนี้แล้ว (พัสดุเก่าเกิน หรือเลขไม่ถูกต้อง)</i>`,
      );
      continue;
    }
    const done = t.delivered ? " ✅" : "";
    out.push(
      `      เลขพัสดุ <code>${esc(t.trackingNo)}</code>`,
      `      ${stageBar(t.stage!)}  <b>${esc(STAGE_LABEL[t.stage!])}</b>${done}`,
    );
    if (t.lastAt) out.push(`      ล่าสุด ${esc(t.lastAt)} — ${esc((t.events?.[0]?.detail || "").slice(0, 90))}`);
    if (t.delivered && t.recipient) out.push(`      ผู้รับ ${esc(t.recipient)}`);
  }
  return out;
}

// แปลงช่องทาง "ทีละตัว" เท่านั้น — ห้ามโยนทั้งสตริงมา ไม่งั้น "ไปรษณีย์, email" จะกลายเป็น "อีเมล" เฉย ๆ
function chanLabel(c: string): string {
  if (/mail|เมล/i.test(c)) return "อีเมล";
  if (/ปณ|ไปรษณีย/.test(c)) return "ไปรษณีย์";
  return c.trim();
}

const splitChans = (c: string) => c.split(/[,/]/).map((s) => s.trim()).filter(Boolean);

// ช่องทางทั้งช่อง → ข้อความอ่านรู้เรื่อง: "ไปรษณีย์, email" → "ไปรษณีย์และอีเมล"
function channelPhrase(c: string): string {
  const parts = splitChans(c).map(chanLabel);
  if (!parts.length) return "";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(" ")}และ${parts[parts.length - 1]}`;
}

// เตือนเรื่องข้อมูลที่วานตีความให้ — โปร่งใสว่าแตะอะไรไปบ้าง
function caveats(rows: TaxRow[]): string[] {
  const c: string[] = [];
  const bud = rows.flatMap((r) => [...r.issued, ...r.delivered]).filter((d) => d.wasBuddhist);
  if (bud.length) c.push(`ชีตกรอกปี พ.ศ. ไว้ (${esc(bud[0].raw)}) วานแปลงเป็น ค.ศ. ให้แล้ว`);
  const bad = rows.flatMap((r) => [...r.issued, ...r.delivered]).filter((d) => d.unparsed);
  if (bad.length) c.push(`มีช่องวันที่ที่อ่านไม่ออก (${esc(bad[0].raw)}) วานไม่เดาให้นะคะ`);
  return c;
}

function scanLine(r: TaxRow): string {
  if (!r.scanLink) return "";
  return isUrl(r.scanLink)
    ? `<b>ไฟล์สแกน</b>  <a href="${esc(r.scanLink)}">เปิดไฟล์</a>`
    : `<b>ไฟล์สแกน</b>  ${esc(r.scanLink)} <i>(ชีตกรอกเป็นชื่อไฟล์ ยังไม่มีลิงก์)</i>`;
}

// ===== ข้อความสำหรับส่งลูกค้า (กระชับ เป็นกันเอง) =====
export function customerMessage(r: TaxRow, tracked: TrackResult[] = []): string {
  const kind = KIND_LABEL[r.kind];
  const docs = r.docNumbers.length ? r.docNumbers.join(", ") : "";

  if (!isDelivered(r)) {
    return [
      `สวัสดีค่ะ ${kind}${docs ? ` เลขที่ ${docs}` : ""} ทางเราออกเอกสารเรียบร้อยแล้วค่ะ`,
      `อยู่ระหว่างดำเนินการจัดส่ง ส่งเมื่อไหร่จะแจ้งให้ทราบอีกครั้งนะคะ 🙏`,
    ].join("\n");
  }

  const lines: string[] = [`สวัสดีค่ะ ${kind}${docs ? ` เลขที่ ${docs}` : ""} ทางเราจัดส่งให้เรียบร้อยแล้วค่ะ`];
  const chans = splitChans(r.channel);

  if (chans.length > 1 && chans.length === r.delivered.length) {
    r.delivered.forEach((d, i) => lines.push(`• ส่งทาง${chanLabel(chans[i])} วันที่ ${d.text}`));
  } else {
    const ch = r.channel ? `ทาง${channelPhrase(r.channel)}` : "";
    lines.push(`• ส่ง${ch} วันที่ ${r.delivered.map((d) => d.text).join(" และ ")}`);
  }
  // เลขพัสดุ + สถานะจริงจากไปรษณีย์ — ลูกค้าจะได้ไม่ต้องไปเช็คเอง
  for (const t of tracked) {
    if (!t.ok) { lines.push(`• เลขพัสดุ ${t.trackingNo}`); continue; }
    lines.push(
      t.delivered
        ? `• เลขพัสดุ ${t.trackingNo} — จัดส่งสำเร็จแล้ว${t.lastAt ? ` เมื่อ ${t.lastAt}` : ""}`
        : `• เลขพัสดุ ${t.trackingNo} — สถานะล่าสุด ${STAGE_LABEL[t.stage!]}${t.lastAt ? ` (${t.lastAt})` : ""}`,
    );
  }
  if (!tracked.length && extractTrackingNos(r.tracking).length)
    lines.push(`• เลขพัสดุ ${extractTrackingNos(r.tracking).join(", ")} (ตรวจสอบได้ที่ track.thailandpost.co.th)`);
  lines.push("", "รบกวนตรวจสอบอีกครั้งนะคะ หากยังไม่ได้รับแจ้งกลับได้เลยค่ะ 🙏");
  return lines.join("\n");
}

// ===== คำตอบเต็มให้แอดมิน =====
export interface TaxReply {
  text: string;
  parseMode: "HTML";
  photos?: { dataBase64: string; caption: string }[]; // ภาพแคปหน้าติดตามพัสดุจากไปรษณีย์ไทย
}

export async function answerTaxStatus(query: string, brand?: Brand): Promise<TaxReply> {
  const match = await findTax(query, { brand });
  const scope = brand ? ` (เฉพาะฝั่ง ${brand})` : "";

  if (!match) {
    // ระบุแบรนด์มาแล้วไม่เจอ แต่อีกแบรนด์มี — บอกให้รู้ ดีกว่าปล่อยให้คิดว่าไม่มีเอกสารเลย
    if (brand) {
      const cross = await findTax(query);
      if (cross?.label) {
        return {
          parseMode: "HTML",
          text:
            `ฝั่ง <b>${esc(brand)}</b> ไม่มีเอกสารของ "<b>${esc(cross.label)}</b>" ค่ะ\n` +
            `แต่ฝั่ง <b>${esc(cross.rows[0].brand)}</b> มีอยู่ ${cross.rows.length} ใบ — ให้วานดูฝั่งนั้นให้ไหมคะ`,
        };
      }
    }
    // ชื่อบริษัทพิมพ์ผิดตัวเดียวก็หาไม่เจอแล้ว — เดาชื่อใกล้เคียงให้ก่อนจะบอกว่าไม่มี
    const near = await suggestFor(query);
    if (near.length === 1) {
      const alt = await findTax(near[0].company, { brand });
      if (alt?.label) {
        const body = await answerTaxStatus(near[0].company, brand);
        return {
          parseMode: "HTML",
          text: `ไม่เจอชื่อ "<b>${esc(query)}</b>" เป๊ะ ๆ ค่ะ แต่เจอ "<b>${esc(near[0].company)}</b>" ที่ใกล้เคียงมาก วานเดาว่าหมายถึงเจ้านี้นะคะ\n\n${body.text}`,
        };
      }
    }
    const list = near.length
      ? `\n\nใกล้เคียงที่สุดในชีตคือ\n${near.map((n) => `• ${esc(n.company)}`).join("\n")}\nใช่เจ้าไหนไหมคะ`
      : `\n\nลองส่งชื่อบริษัทเต็ม ๆ หรือยูสเซอร์มาอีกครั้งได้ไหมคะ · ถ้าเพิ่งเพิ่มในชีตเมื่อกี้ รอสัก 5 นาทีแล้วถามใหม่นะคะ (วานแคชไว้กันยิงชีตถี่)`;
    return { parseMode: "HTML", text: `หา "<b>${esc(query)}</b>" ในชีตสถานะการนำส่งใบกำกับภาษี${esc(scope)}ไม่เจอเลยค่ะ${list}` };
  }

  // คำค้นกว้างไป โดนหลายบริษัท → ถามกลับ ไม่เดาให้
  if (!match.label) {
    const list = companiesOf(match.rows).slice(0, 8);
    return {
      parseMode: "HTML",
      text:
        `"<b>${esc(query)}</b>" ตรงกับหลายบริษัทค่ะ หมายถึงเจ้าไหนคะ\n\n` +
        list.map((c) => `• ${esc(c)}`).join("\n") +
        (companiesOf(match.rows).length > list.length ? `\n<i>…และอีก ${companiesOf(match.rows).length - list.length} ราย</i>` : ""),
    };
  }

  const sorted = sortLatest(match.rows);
  const r = sorted[0];
  const kind = KIND_LABEL[r.kind];
  const sent = isDelivered(r) && !splitChans(r.channel).every((c) => NOT_SENT_CHAN.test(c));
  const head = sent ? "✅ ส่งแล้วค่ะ" : "⏳ ยังไม่ได้ส่งค่ะ";

  // ยิงไปรษณีย์ไทยเฉพาะตอนที่มีเลขพัสดุจริง — ช้า ~7 วิ ไม่ต้องเสียเวลากับแถวที่ส่งอีเมลอย่างเดียว
  const nos = extractTrackingNos(r.tracking);
  let tracked: TrackResult[] = [];
  let shotBase64: string | undefined;
  if (nos.length) {
    const t = await trackParcels(nos, { shot: true }).catch(() => ({ results: [] as TrackResult[], shotBase64: undefined }));
    tracked = t.results;
    shotBase64 = t.shotBase64;
  }

  const lines: string[] = [
    `<b>${esc(r.company || match.label)}</b>`,
    `${head} — ${esc(kind)} · ${esc(r.brand)}`,
    ``,
  ];

  if (r.username) lines.push(`<b>ยูสเซอร์</b>  ${esc(r.username)}`);
  if (r.docNumbers.length) lines.push(`<b>เลขที่เอกสาร</b>  ${esc(r.docNumbers.join(", "))}`);
  if (r.issued.length) lines.push(`<b>วันที่ออกเอกสาร</b>  ${dateLine(r.issued)}`);

  lines.push(``, ...deliveryBlock(r, tracked));

  const scan = scanLine(r);
  if (scan) lines.push(``, scan);
  if (r.notified) lines.push(`<b>แจ้งลูกค้า</b>  ${esc(r.notified)}`);

  // หมายเหตุ: รวมของ 2 ที่ — คอลัมน์หมายเหตุ + ข้อความที่แอดมินพิมพ์ปนไว้ในช่องเลขพัสดุ
  // (72 แถวใส่ข้อความล้วน เช่น "รอ 50 ทวิ ฉบับจริง" · 16 แถวใส่ปนกับเลข เช่น "RL... โดนตีกลับ")
  const notes = [trackingNote(r.tracking), r.note].map((s) => String(s || "").trim()).filter(Boolean);
  if (notes.length) lines.push(`<b>หมายเหตุ</b>  ${esc([...new Set(notes)].join(" · "))}`);
  lines.push(`<i>แท็บ ${esc(r.tab)} แถว ${r.rowNumber}</i>`);

  const cav = caveats([r]);
  if (cav.length) lines.push(``, ...cav.map((c) => `⚠️ ${c}`));

  // ไม่ได้ระบุแบรนด์ แต่ลูกค้ารายนี้มีเอกสารอีกฝั่งด้วย (มี 11 บริษัทแบบนี้ และวันที่ล่าสุดมักคนละฝั่ง)
  // → บอกไว้ ไม่งั้นแอดมินได้ใบของอีกแบรนด์ไปโดยไม่รู้ตัว
  if (!brand) {
    const n = await otherBrandCount(r.company, r.brand);
    if (n) lines.push(``, `ℹ️ รายนี้มีเอกสารฝั่ง <b>${r.brand === "Thunder" ? "Easy" : "Thunder"}</b> อีก ${n} ใบ · ถ้าจะดูฝั่งนั้น พิมพ์ชื่อแบรนด์มาด้วยได้เลยค่ะ`);
  }

  // ใบอื่นของลูกค้ารายนี้ — ให้แอดมินเห็นว่ามีประวัติอะไรอีก
  const others = sorted.slice(1, 4);
  if (others.length) {
    lines.push(``, `<b>ใบก่อนหน้าของรายนี้</b>`);
    for (const o of others) {
      const when = o.delivered.length ? `ส่ง ${dateLine(o.delivered)}` : "ยังไม่ส่ง";
      lines.push(`• ${esc(o.docNumbers.join(", ") || "-")} · ${when} · <i>${esc(KIND_LABEL[o.kind])}</i>`);
    }
    if (sorted.length > 4) lines.push(`<i>…รวมทั้งหมด ${sorted.length} รายการ</i>`);
  }

  // ข้อความให้ลูกค้า — <pre> ทำให้ Telegram ขึ้นปุ่ม copy กดก็อปได้ทั้งก้อน
  lines.push(``, `<b>ข้อความแจ้งลูกค้า</b> (กดปุ่ม copy ได้เลย)`, `<pre>${esc(customerMessage(r, tracked))}</pre>`);

  const photos = shotBase64
    ? [{ dataBase64: shotBase64, caption: `สถานะพัสดุ ${nos.join(", ")} — ไปรษณีย์ไทย` }]
    : undefined;
  return { parseMode: "HTML", text: lines.join("\n"), photos };
}

// ===== จับว่าแอดมินกำลังถามเรื่องใบกำกับหรือเปล่า =====
export type TaxIntent =
  | { kind: "count"; day: Date; label: string; brand?: Brand }
  | { kind: "status"; query: string; brand?: Brand }
  | null;

/**
 * แอดมินพิมพ์ชื่อแบรนด์มา = ตั้งใจถามฝั่งนั้น ให้ค้นเฉพาะแท็บของแบรนด์นั้น
 * ระวัง: ห้ามจับคำว่า "ธันเดอร์/Thunder" ที่เป็น "ส่วนหนึ่งของชื่อบริษัทลูกค้า" มาเป็นตัวกรอง
 * (เช่น ชื่อไฟล์สแกนขึ้นต้น "บริษัท ธันเดอร์ โซลูชั่น จำกัด_INV..." = ชื่อบริษัทเราเอง ไม่ใช่คำสั่งกรอง)
 * เลยจับเฉพาะตอนที่คำนั้นยืนเดี่ยว ๆ หรือมีคำบอกทิศทางอย่าง "ของ/ฝั่ง/แท็บ" นำหน้า
 */
export function detectBrand(text: string): Brand | undefined {
  const t = text.toLowerCase();
  const thunder = /(^|\s|ของ|ฝั่ง|แท็บ|แทบ)\s*(thunder|ธันเดอร์|ธันเดอร)/i.test(t);
  const easy = /(^|\s|ของ|ฝั่ง|แท็บ|แทบ)\s*(easy|อีซี่|อีซี)/i.test(t);
  if (thunder && !easy) return "Thunder";
  if (easy && !thunder) return "Easy";
  return undefined; // ไม่ระบุ หรือระบุทั้งคู่ → ค้นทั้งหมดเหมือนเดิม
}

// ตัดชื่อแบรนด์ออกจากคำค้น ไม่งั้น "ธันเดอร์" จะกลายเป็นส่วนหนึ่งของชื่อบริษัทที่ต้องหา
const stripBrand = (s: string) => s.replace(/(thunder|ธันเดอร์|ธันเดอร|easy|อีซี่|อีซี)/gi, " ").replace(/\s+/g, " ").trim();

// สะกดได้หลายแบบจริง ๆ ในกลุ่ม: ใบกำกับ / ใบกํากับ (ไม้ไต่คู้คนละตัว) / ใบกำกับภาษี
const TAX_WORD = /ใบก[ำํ]?ากับ|ใบกำกับ|ใบกํากับ/;

/**
 * ตัดคำถามทิ้งให้เหลือแต่ "ชื่อลูกค้า"
 * ข้อความจริงจากกลุ่ม: "บริษัท ริช โกลบ์ 168 จำกัด ส่งใบกำกับภาษีหรือยัง @nong_waan_bot"
 */
function extractTarget(text: string): string {
  return text
    .replace(/@[\w_]+/g, " ") // แท็กบอท
    .replace(TAX_WORD, " ")
    .replace(/ภาษี/g, " ")
    // ลบทีละคำ ไม่ผูกกันเป็นวลี — เพราะพอตัด "ใบกำกับ" ออกไปแล้ว คำที่เคยติดกันจะมีช่องว่างคั่น
    .replace(/(แล้ว)?(หรือ)?ยัง(ครับ|คะ|ค่ะ)?/g, " ")
    .replace(/(จัดส่ง|นำส่ง|ส่งให้|ส่ง)/g, " ")
    // เรียงคำยาวไว้ก่อนคำสั้นเสมอ — regex เลือกตัวแรกที่แมตช์ ถ้า "ขอ" มาก่อน "ของ"
    // คำว่า "ของ" จะโดนกินเหลือ "ง" ค้างอยู่ในชื่อบริษัท
    .replace(/(ตรวจสอบ|เช็ค|ตรวจ|สอบถาม|ให้หน่อย|สถานะ|รายการ|ของ|ฝั่ง|แท็บ|แทบ|ถาม|ดู|ขอ|หา|status|หน่อย|ด้วย|ที)/g, " ")
    // คำถามความรู้ทั่วไป ("ใบกำกับภาษีคืออะไร") ต้องไม่กลายเป็นชื่อลูกค้า
    .replace(/(คืออะไร|คือ|อะไร|ยังไง|อย่างไร|ทำไม|เมื่อไห?ร่|ที่ไหน)/g, " ")
    .replace(/[?？]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTaxIntent(text: string): TaxIntent {
  const t = text.trim();
  if (!TAX_WORD.test(t)) return null;
  const brand = detectBrand(t);

  // ถามจำนวน: "วันนี้มีส่งรายการใบกำกับภาษีเท่าไหร่" / "เมื่อวานส่งใบกำกับกี่รายการ"
  const asksCount = /(เท่า\s*ไห?ร่|กี่\s*(รายการ|ใบ)|มีกี่|จำนวน|ทั้งหมดกี่)/.test(t);
  if (asksCount) {
    const today = new Date();
    if (/เมื่อวาน/.test(t)) {
      const d = new Date(today);
      d.setDate(d.getDate() - 1);
      return { kind: "count", day: d, label: "เมื่อวาน", brand };
    }
    const explicit = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (explicit) {
      let y = Number(explicit[3]);
      if (y > 2500) y -= 543;
      return { kind: "count", day: new Date(y, Number(explicit[2]) - 1, Number(explicit[1])), label: `วันที่ ${explicit[0]}`, brand };
    }
    return { kind: "count", day: today, label: "วันนี้", brand };
  }

  /**
   * ต้องมีรูปประโยค "ถามสถานะ" จริง ๆ ไม่ใช่แค่เอ่ยคำว่าใบกำกับ
   *
   * ในกลุ่ม dedicated วานได้ยินทุกข้อความ ถ้าไม่บังคับข้อนี้ ประโยคอย่าง
   * "ใบกำกับภาษีนี่ออกยากจัง" จะถูกตีเป็นชื่อบริษัท แล้ววานจะเด้งมาตอบ
   * "หาบริษัท 'นี่ออกยากจัง' ไม่เจอ" กลางวงที่ทีมคุยกันเอง
   */
  const asksStatus = /(หรือยัง|รึยัง|แล้วยัง|ยัง\s*(ครับ|คะ|ค่ะ)?\s*[?？]?\s*$|[?？]|เช็ค|ตรวจ|สถานะ|ถึงไหน|ส่งไปยัง|ได้รับยัง)/.test(t);
  if (!asksStatus) return null;

  const query = stripBrand(extractTarget(t));
  if (query.length < 2) return null; // เอ่ยถึงใบกำกับลอย ๆ ไม่ได้ถามถึงใคร → ไม่ใช่งานของวาน
  return { kind: "status", query, brand };
}

export async function answerTaxIntent(intent: NonNullable<TaxIntent>): Promise<TaxReply> {
  return intent.kind === "count"
    ? answerTaxDayCount(intent.day, intent.label, intent.brand)
    : answerTaxStatus(intent.query, intent.brand);
}

// ===== "วันนี้ส่งกี่รายการ" =====
export async function answerTaxDayCount(day: Date, label = "วันนี้", brand?: Brand): Promise<TaxReply> {
  const c = await countDelivered(day, brand);
  const scope = brand ? ` · เฉพาะฝั่ง ${brand}` : "";
  if (!c.total) {
    return { parseMode: "HTML", text: `${esc(label)} (${esc(c.date)})${esc(scope)} ยังไม่มีรายการนำส่งเอกสารในชีตเลยค่ะ` };
  }
  const lines = [`<b>${esc(label)} (${esc(c.date)})${esc(scope)} นำส่งทั้งหมด ${c.total} รายการ</b>`, ``];
  for (const t of c.byTab) {
    lines.push(`<b>${esc(t.tab)}</b> — ${t.count} รายการ`);
    for (const r of t.rows.slice(0, 12)) {
      const doc = r.docNumbers.join(", ") || "-";
      lines.push(`• ${esc(r.company)} · ${esc(doc)}${r.tracking ? ` · ${esc(r.tracking)}` : ""}`);
    }
    if (t.rows.length > 12) lines.push(`<i>…และอีก ${t.rows.length - 12} รายการ</i>`);
    lines.push(``);
  }
  return { parseMode: "HTML", text: lines.join("\n").trim() };
}
