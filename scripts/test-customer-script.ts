// เทสตัวจัดรูป "ข้อความสำหรับตอบลูกค้า" → กล่องคัดลอกใน Telegram
import fs from "node:fs";
import path from "node:path";
for (const line of fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

async function main() {
  const { formatCustomerScript } = await import("@/lib/customer-script");
  let pass = 0, fail = 0;
  const ok = (label: string, cond: boolean, extra?: unknown) => {
    if (cond) { pass++; console.log(` ✓ ${label}`); }
    else { fail++; console.log(` ✗ ${label}`, extra !== undefined ? String(extra).slice(0, 300) : ""); }
  };

  // 1) โมเดลใส่รั้วตามกติกา
  const a = formatCustomerScript(
    "ค่า matchedAccount เป็น null ตามปกติจะหมายถึงระบบจับคู่บัญชีไม่ได้ค่ะ\n\n" +
      "```ตอบลูกค้า\nสวัสดีค่ะคุณลูกค้า เบื้องต้นค่า matchedAccount เป็น null หมายถึงระบบยังไม่สามารถจับคู่บัญชีได้ค่ะ\nรบกวนขอตัวอย่าง Response เพิ่มเติมนะคะ\n```\n\n" +
      "ถ้าจะส่งให้ Dev เช็กต่อ ควรแนบ Response ของ UOB ด้วยค่ะ",
  );
  ok("เจอรั้ว → แปลงเป็น HTML", a.found === 1 && a.parseMode === "HTML", a);
  ok("มีกล่อง <pre> ให้กดคัดลอก", a.text.includes("<pre>") && a.text.includes("</pre>"), a.text);
  ok("มีป้ายบอกว่าเป็นข้อความถึงลูกค้า", a.text.includes("ข้อความสำหรับตอบลูกค้า"), a.text);
  const inBox = a.text.match(/<pre>([\s\S]*?)<\/pre>/)?.[1] || "";
  ok("คำอธิบายสำหรับแอดมินยังอยู่นอกกล่อง", a.text.includes("ถ้าจะส่งให้ Dev") && !inBox.includes("ถ้าจะส่งให้ Dev"), inBox);
  ok("ไม่มีรั้ว ``` หลงเหลือ", !a.text.includes("```"), a.text);

  // 2) โมเดลลืมรั้ว แต่ใส่เครื่องหมายคำพูดไทย (แบบที่เจอจริงในกลุ่ม)
  const b = formatCustomerScript(
    "แนะนำตอบลูกค้าแบบปลอดภัยได้ประมาณนี้ค่ะ:\n" +
      "“สวัสดีค่ะคุณลูกค้า เบื้องต้นค่า matchedAccount เป็น null หมายถึงระบบยังไม่สามารถจับคู่บัญชีผู้รับกับบัญชีที่ตั้งค่าไว้ได้ค่ะ รบกวนขอตัวอย่าง Response / ref สลิป เพิ่มเติมให้นะคะ”\n" +
      "ถ้าจะส่งให้ Dev เช็กต่อ ควรแนบ Response ของ UOB ค่ะ",
  );
  ok("ลืมรั้ว แต่จับจากเครื่องหมายคำพูดได้", b.found === 1 && b.text.includes("<pre>"), b);
  ok("ไม่เอาเครื่องหมายคำพูดเข้าไปในกล่อง", !b.text.includes("“") && !b.text.includes("”"), b.text);

  // 3) คำตอบทั่วไปที่ไม่มีส่วนตอบลูกค้า → ห้ามแตะ
  const c = formatCustomerScript("วันนี้มีเคสค้าง 3 ราย ปิดไปแล้ว 12 ค่ะ");
  ok("ไม่มีส่วนตอบลูกค้า → ข้อความเดิมไม่เปลี่ยน", c.found === 0 && c.parseMode === undefined && c.text === "วันนี้มีเคสค้าง 3 ราย ปิดไปแล้ว 12 ค่ะ", c);

  // 4) อักขระพิเศษต้องถูก escape (ไม่งั้น Telegram ตีเป็นแท็กแล้วส่งไม่ออก)
  const d = formatCustomerScript("ดูค่า <matchedAccount> & สถานะ\n```ตอบลูกค้า\nระบบแจ้งว่า a < b & c > d ค่ะ\n```");
  ok("escape < > & ทั้งในและนอกกล่อง", d.text.includes("&lt;matchedAccount&gt;") && d.text.includes("a &lt; b &amp; c &gt; d"), d.text);

  // 5) หลายกล่องในคำตอบเดียว
  const e = formatCustomerScript("กรณีที่ 1\n```ตอบลูกค้า\nข้อความแบบที่หนึ่งค่ะ\n```\nกรณีที่ 2\n```ตอบลูกค้า\nข้อความแบบที่สองค่ะ\n```");
  ok("รองรับหลายกล่อง", e.found === 2 && (e.text.match(/<pre>/g) || []).length === 2, e);

  console.log(`\nผ่าน ${pass}/${pass + fail}`);
  if (fail) process.exitCode = 1;
}
main();
