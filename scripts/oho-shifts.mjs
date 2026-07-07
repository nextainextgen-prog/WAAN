// ตารางเวรทีม Support → ใครต้องถูกแท็กตอนนี้ (แท็กด้วย Telegram ID เพราะไม่มี @username)
// แก้ ID/ตารางที่นี่ได้เลย

const A = {
  ning: { id: "6702570636", name: "พี่หนิง" }, // ผู้จัดการ
  nong: { id: "8437007458", name: "พี่น้อง" },
  noey: { id: "8254095362", name: "เนย" },
  prae: { id: "8171020139", name: "พี่แพร" },
  korn: { id: "6382364836", name: "พี่กร" },
};
const OWNER = { id: "7750653134", name: "พี่โด้" };
const MANAGER = A.ning;

// เวลาปัจจุบันโซนไทย
function bkkParts(date) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = p.hour === "24" ? 0 : Number(p.hour);
  return { day: dayMap[p.weekday], hour, min: Number(p.minute), hm: hour * 60 + Number(p.minute) };
}

// คืนแอดมินเวรตามวัน/เวลา (โซนไทย)
function shiftAdmins({ day, hour }) {
  const weekday = day >= 1 && day <= 5;
  const weekend = day === 0 || day === 6;
  // กะดึกวันธรรมดา 17:00–02:00 (คาบเกี่ยวเข้าวันถัดไป จ.-ศ. ตอนดึก / อ.-ส. ตอนเช้ามืด)
  if ((weekday && hour >= 17) || (day >= 2 && day <= 6 && hour < 2)) return [A.korn, A.prae];
  // กะเช้าวันธรรมดา 08:00–17:00
  if (weekday && hour >= 8 && hour < 17) return [A.nong, A.noey];
  // กะดึกเสาร์-อาทิตย์ 16:00–00:00
  if (weekend && hour >= 16) return [A.korn, A.prae];
  // กะเช้าเสาร์-อาทิตย์ 08:00–16:00
  if (weekend && hour >= 8 && hour < 16) return [A.nong, A.noey];
  return []; // นอกเวลาทำการ
}

// ช่วงพัก (สลับกันพัก) — เช้า 11:30–13:30, ดึก 20:30–22:30
function onBreak({ hm }) {
  return (hm >= 11 * 60 + 30 && hm < 13 * 60 + 30) || (hm >= 20 * 60 + 30 && hm < 22 * 60 + 30);
}

// สรุปคนที่ต้องแท็กตอนนี้: เวร + ผจก.หนิง + พี่โด้ (เสมอ) — ไม่ซ้ำ
export function getTaggees(date) {
  const parts = bkkParts(date);
  const shift = shiftAdmins(parts);
  const off = shift.length === 0;
  const seen = new Set();
  const list = [];
  for (const p of [...shift, MANAGER, OWNER]) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      list.push(p);
    }
  }
  return { taggees: list, shift, offHours: off, onBreak: onBreak(parts) };
}

// สร้างสตริงแท็ก HTML (tg://user?id=) — ใช้กับ parse_mode HTML
export function formatTags(taggees) {
  return taggees.map((p) => `<a href="tg://user?id=${p.id}">${p.name}</a>`).join(" ");
}
