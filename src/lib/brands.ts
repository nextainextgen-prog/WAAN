// แบรนด์/สตรีมแจ้งเตือนของ watcher (ตรงกับ field company ใน oho/fb/line-watch + Topic ในซูเปอร์กรุ๊ป monitor)
// ผู้ใช้พิมพ์ชื่อแบรนด์ (ไทย/อังกฤษ) → จับเป็น key เพื่อปิด/เปิด/รายงานราย "แบรนด์"
export interface BrandDef {
  key: string;
  label: string;
  re: RegExp;
}

export const BRANDS: BrandDef[] = [
  { key: "thunder", label: "Thunder", re: /thunder|ธั?นเดอร์/i },
  { key: "easyslip", label: "EasySlip", re: /easy\s*slip|อีซี่?\s*สลิป/i },
  { key: "easycrm", label: "EasyCRM", re: /easy\s*crm|อีซี่?\s*(?:ซีอาร์เอ็ม|crm)/i },
  { key: "boostsms", label: "BoostSMS", re: /boost\s*sms|บูสท์?\s*(?:เอสเอ็มเอส|sms)|บูสเอสเอ็มเอส/i },
];

export function detectBrands(text: string): BrandDef[] {
  return BRANDS.filter((b) => b.re.test(text));
}

export function brandLabel(key: string): string {
  return BRANDS.find((b) => b.key === key)?.label || key;
}
