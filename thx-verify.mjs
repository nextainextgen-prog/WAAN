import fs from "node:fs"; import path from "node:path"; import { chromium } from "playwright";
const CWD=process.cwd();
for(const line of fs.readFileSync(path.join(CWD,".env"),"utf8").split("\n")){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2];}
const BASE=(process.env.THUNDER_ADMIN_URL||"https://old.thunder.in.th").replace(/\/$/,"");
const TH=["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const b=await chromium.launch({args:["--no-sandbox"]});
const ctx=await b.newContext({storageState:path.join(CWD,".thunder-session.json"),viewport:{width:1700,height:1000},locale:"th-TH"});
const page=await ctx.newPage();
await page.goto(`${BASE}/admin/service`,{waitUntil:"domcontentloaded"}); await page.waitForTimeout(5000);
const box=page.getByPlaceholder(/9bomeiei/i).first();
await box.click(); await box.pressSequentially("mongdu",{delay:60}); await page.waitForTimeout(300);
await page.getByRole("button",{name:/ค้นหา/}).first().click(); await page.waitForTimeout(4500);
// เปิด popup แก้ไข (คอลัมน์วันหมดอายุ)
const heads=await page.evaluate(()=>[...document.querySelectorAll("table thead th")].map(e=>e.textContent.replace(/\s+/g," ").trim()));
const ei=heads.findIndex(h=>/วันที่บอทหมดอายุ/.test(h));
await page.locator("table tbody tr").first().locator("td").nth(ei).locator("button").first().click(); await page.waitForTimeout(1000);
const dlg=page.locator('[class*=Modal],[role=dialog]').filter({hasText:/แก้ไขวันหมดอายุ/}).first();
// ===== pickToday ที่แก้แล้ว =====
const now=new Date(); const target=`${TH[now.getMonth()]} ${now.getFullYear()}`;
await dlg.locator("input[readonly]").first().click().catch(()=>{});
const headerBtn=page.locator("button").filter({hasText:new RegExp(`^(${TH.join("|")})\\s*\\d{4}$`)}).first();
await headerBtn.waitFor({state:"visible",timeout:6000}).catch(()=>{});
for(let i=0;i<30;i++){const cur=(await headerBtn.textContent({timeout:3000}).catch(()=>""))?.trim()||"";if(!cur||cur===target)break;const[mN,yS]=cur.split(/\s+/);const ci=TH.indexOf(mN)+(+yS)*12,ti=now.getMonth()+now.getFullYear()*12;await page.locator(`button[data-direction="${ci<ti?"next":"previous"}"]`).first().click({timeout:3000}).catch(()=>{});await page.waitForTimeout(350);}
const reached=(await headerBtn.textContent({timeout:3000}).catch(()=>""))?.trim()||"";
console.log("ปฏิทันไปถึงเดือน:",reached,"| target:",target,"| ตรง:",reached===target);
if(reached===target){await page.locator(`button[class*=DatePicker-day]:not([data-outside])`).filter({hasText:new RegExp(`^${now.getDate()}$`)}).first().click({timeout:4000}).catch(()=>{});await page.waitForTimeout(500);}
const shown=(await dlg.locator("input[readonly]").first().inputValue().catch(()=>""))||"";
console.log("date input หลังเลือก:",shown);
// >>> ยกเลิก ไม่บันทึก <<<
await page.getByRole("button",{name:/^ยกเลิก$/}).first().click().catch(()=>{});
console.log(">>> กดยกเลิก ไม่ save");
await b.close();
