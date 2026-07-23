// ตารางราคาแพ็กเกจ (pure — ใช้ทั้ง client/server) · ราคา = ราคา 1 เดือน (รวม VAT 7% แล้ว)
// ยังไม่รวมหักภาษี ณ ที่จ่าย 3% · ค่าที่คำนวณ = ราคาที่ลูกค้าจ่ายจริง (netPrice / จำนวนเงินที่ซื้อบริการ)
export interface Pkg {
  name: string;
  price: number; // ราคา 1 เดือน
  yearlyOff?: number; // (แบบ API) ส่วนลดรายปี ใช้เฉพาะ 12 เดือน — ถ้าไม่มี = ใช้ส่วนลดตามจำนวนเดือน (แบบ BOT)
}

// Thunder BOT (บอทตรวจสลิป) — ส่วนลดตามจำนวนเดือน (เท่ากันทุกแพ็กเกจ)
export const THUNDER_BOT_PACKAGES: Pkg[] = [
  { name: "Start", price: 99 },
  { name: "Basic", price: 199 },
  { name: "Starter", price: 349 },
  { name: "Beginner", price: 599 },
  { name: "Silver", price: 799 },
  { name: "Gold", price: 1599 },
  { name: "Diamond", price: 2499 },
  { name: "Premium-1", price: 3000 },
  { name: "Premium-2", price: 5000 },
  { name: "Premium-3", price: 10000 },
  { name: "Premium-4", price: 14000 },
];

// Thunder API — ส่วนลดรายปีต่อแพ็กเกจ (ใช้เฉพาะ 12 เดือน · รายเดือนไม่มีส่วนลด)
export const THUNDER_API_PACKAGES: Pkg[] = [
  { name: "MINI", price: 159, yearlyOff: 0.2 },
  { name: "LITE", price: 449, yearlyOff: 0.2 },
  { name: "STANDARD", price: 899, yearlyOff: 0.2 },
  { name: "PRO", price: 1399, yearlyOff: 0.15 },
  { name: "EXPERT", price: 1799, yearlyOff: 0.15 },
  { name: "MASTER", price: 3599, yearlyOff: 0.15 },
  { name: "ULTIMATE", price: 5499, yearlyOff: 0.1 },
  { name: "SUPREME", price: 12999, yearlyOff: 0.1 },
  { name: "ELITE", price: 49999, yearlyOff: 0.1 },
];

// ส่วนลดตามจำนวนเดือน (แบบ BOT): 1 เดือน 0% · 3 เดือน −3% · 6 เดือน −7% · 12 เดือน −10%
export const MONTH_DISCOUNT: Record<number, number> = { 1: 0, 3: 0.03, 6: 0.07, 12: 0.1 };

// ราคาที่ลูกค้าจ่ายจริง = ราคา/เดือน × จำนวนเดือน × (1 − ส่วนลด)
export function packagePrice(pkg: Pkg, months: number): number {
  let total: number;
  if (pkg.yearlyOff != null) {
    // API: ส่วนลดรายปีเฉพาะ 12 เดือน · เดือนอื่นไม่มีส่วนลด
    const disc = months >= 12 ? pkg.yearlyOff : 0;
    total = pkg.price * months * (1 - disc);
  } else {
    // BOT: ส่วนลดตามจำนวนเดือน
    total = pkg.price * months * (1 - (MONTH_DISCOUNT[months] ?? 0));
  }
  return Math.round(total * 100) / 100;
}

// รายการแพ็กเกจตามแบรนด์ + ประเภทบริการ (ตอนนี้มีแค่ Thunder · EasySlip ไว้เพิ่มภายหลัง)
export function getPackages(brand: string, serviceLabel: string): Pkg[] {
  if (brand !== "thunder") return [];
  if (serviceLabel === "BOT") return THUNDER_BOT_PACKAGES;
  if (serviceLabel === "API") return THUNDER_API_PACKAGES;
  return [];
}

// ตัวเลือกจำนวนเดือน: API = 1/12 เท่านั้น · อื่น ๆ = 1/3/6/12
export function getMonthOptions(serviceLabel: string): string[] {
  return serviceLabel === "API" ? ["1", "12"] : ["1", "3", "6", "12"];
}
