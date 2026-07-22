// แปลงจำนวนเงินเป็นข้อความภาษาไทย เช่น 5344.82 -> "ห้าพันสามร้อยสี่สิบสี่บาทแปดสิบสองสตางค์"
// ไฟล์นี้ pure (ไม่ import อะไร) — ใช้ได้ทั้งฝั่ง client (พรีวิวสด) และ server
export function bahtText(amount: number): string {
  if (amount == null || isNaN(amount)) return "";
  const neg = amount < 0;
  const fixed = Math.abs(Math.round(amount * 100) / 100).toFixed(2);
  const [intStr, satStr] = fixed.split(".");
  const digits = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
  const units = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];
  const readChunk = (s: string): string => {
    let out = "";
    const len = s.length;
    for (let i = 0; i < len; i++) {
      const d = +s[i];
      const pos = len - 1 - i; // 0 = หลักหน่วย
      if (d === 0) continue;
      if (pos === 0 && d === 1 && len > 1) out += "เอ็ด";
      else if (pos === 1 && d === 1) out += "สิบ";
      else if (pos === 1 && d === 2) out += "ยี่สิบ";
      else out += digits[d] + units[pos];
    }
    return out;
  };
  const readInt = (s: string): string => {
    s = s.replace(/^0+/, "");
    if (s === "") return "ศูนย์";
    if (s.length <= 6) return readChunk(s);
    const head = s.slice(0, s.length - 6);
    const tail = s.slice(s.length - 6);
    return readInt(head) + "ล้าน" + (tail === "000000" ? "" : readChunk(tail));
  };
  let txt = readInt(intStr) + "บาท";
  txt += satStr === "00" ? "ถ้วน" : readChunk(satStr) + "สตางค์";
  return (neg ? "ลบ" : "") + txt;
}
