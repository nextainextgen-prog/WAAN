// เครื่องยนต์เด็คนำเสนอ Thunder — ใช้ระบบดีไซน์จากเทมเพลตต้นฉบับ (deck-theme.ts)
// แต่ละสไลด์ = มาร์กอัปเต็มด้านในของ .slide (ให้ Claude แต่งอิสระด้วยคลาสของดีไซน์ซิสเต็ม)
// + chart (ถ้ามี) เรนเดอร์ด้วย Chart.js จาก spec โดยแทรกที่ {{CHART}}
import { DECK_CSS, ICON_SPRITE } from "./deck-theme";

export interface DeckChartDataset {
  label?: string;
  data: number[];
  color?: string;
  type?: "bar" | "line";
}
export interface DeckChart {
  type: "bar" | "line" | "doughnut" | "pie";
  labels: string[];
  datasets?: DeckChartDataset[];
  data?: number[]; // ชุดข้อมูลเดี่ยว (ทางลัด)
  label?: string;
  indexAxis?: "x" | "y";
}
export interface DeckSlide {
  layout?: string; // ป้ายสั้นไว้ทำสารบัญ (cover/kpi/agenda/table/closing ...)
  title?: string; // ไว้ทำสารบัญ/ชื่อไฟล์
  bg?: "navy" | "accent" | "";
  cls?: string; // คลาสเสริมระดับ section เช่น "cover"
  html?: string; // เนื้อหาเต็มด้านในของ .slide (รวม .slide-inner, deco ฯลฯ)
  chart?: DeckChart;
}
export interface Deck {
  title: string;
  titleEn?: string;
  subtitle: string;
  meta?: { label: string; value: string }[];
  slides: DeckSlide[];
}

const PALETTE = ["#2B7CC9", "#22A06B", "#E5B342", "#79B0E5", "#164378", "#D9544D", "#0A2F5C", "#C8DDF1"];

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function brandMark(logo: string): string {
  return `<div class="brandmark">${logo ? `<img src="${logo}" alt=""/>` : ""}<div class="wf">THUNDER<span> SOLUTION</span></div></div>`;
}

function chartScript(id: string, c: DeckChart): string {
  const isRound = c.type === "doughnut" || c.type === "pie";
  // แปลง datasets → รูปแบบ Chart.js (รองรับหลายชุด + ชนิดผสม bar/line)
  const datasets = c.datasets && c.datasets.length
    ? c.datasets.map((d, i) => {
        const color = d.color || PALETTE[i % PALETTE.length];
        const t = d.type || (c.type === "line" ? "line" : c.type === "bar" ? "bar" : undefined);
        const line = t === "line";
        return {
          ...(t ? { type: t } : {}),
          label: d.label || "",
          data: d.data,
          backgroundColor: isRound ? PALETTE : line ? "transparent" : color,
          borderColor: color,
          borderWidth: line ? 3 : 0,
          borderRadius: isRound ? 0 : 6,
          tension: 0.35,
          fill: false,
          pointRadius: line ? 3 : 0,
        };
      })
    : [
        {
          label: c.label || "",
          data: c.data || [],
          backgroundColor: isRound ? PALETTE : PALETTE[0],
          borderColor: PALETTE[0],
          borderWidth: c.type === "line" ? 3 : 0,
          borderRadius: isRound ? 0 : 6,
          tension: 0.35,
          fill: false,
          pointRadius: c.type === "line" ? 3 : 0,
        },
      ];
  const cfg = {
    type: c.type === "line" || c.type === "bar" ? c.type : c.type,
    data: { labels: c.labels || [], datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      indexAxis: c.indexAxis || "x",
      plugins: {
        legend: { display: isRound || datasets.length > 1, position: isRound ? "right" : "bottom", labels: { boxWidth: 12, padding: 8 } },
      },
      scales: isRound
        ? {}
        : { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "#EEF3F9" } } },
    },
  };
  return `new Chart(document.getElementById(${JSON.stringify(id)}),${JSON.stringify(cfg)});`;
}

function renderSlide(s: DeckSlide, i: number, total: number, logo: string, charts: string[]): string {
  const bg = s.bg === "navy" ? " bg-navy" : s.bg === "accent" ? " bg-accent" : "";
  const cls = s.cls ? ` ${s.cls.replace(/[^\w\s-]/g, "").trim()}` : "";
  const pageno = `<div class="pageno mono">${String(i + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}</div>`;
  let html = s.html || `<div class="slide-inner"><div class="h-sec">${esc(s.title || "")}</div></div>`;

  if (s.chart) {
    const id = `c${i}`;
    // ให้ความสูงแน่นอน ไม่งั้น Chart.js (maintainAspectRatio:false) จะยุบสูงเหลือนิดเดียว
    const box = `<div class="chartbox" style="flex:1;min-height:46vh"><canvas id="${id}"></canvas></div>`;
    html = html.includes("{{CHART}}") ? html.replace("{{CHART}}", box) : html.replace("</div>", `${box}</div>`);
    charts.push(chartScript(id, s.chart));
  }

  return `<section class="slide${bg}${cls}" id="s${i + 1}">
${brandMark(logo)}
${html}
${pageno}
</section>`;
}

export function renderDeckHtml(deck: Deck, logoDataUri = ""): string {
  const charts: string[] = [];
  const total = deck.slides.length;
  const slidesHtml = deck.slides.map((s, i) => renderSlide(s, i, total, logoDataUri, charts)).join("\n");

  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(deck.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&family=IBM+Plex+Sans+Thai:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>${DECK_CSS}
/* พิมพ์ PDF: แต่ละสไลด์ = 1 หน้า, หยุดแอนิเมชันให้อยู่สถานะสุดท้าย (แถบ/กราฟไม่ค้างกลางทาง) */
@media print{
  .nav,.seemore{display:none!important}
  .deck{display:block!important;height:auto!important;width:auto!important;overflow:visible!important}
  .slide{page-break-after:always;width:100vw;height:100vh}
  .slide:last-child{page-break-after:auto}
  *{animation:none!important;transition:none!important}
  .shine::after{display:none!important}
}</style></head><body>
${ICON_SPRITE}
<nav class="nav" id="nav"></nav>
<div class="deck" id="deck">
${slidesHtml}
</div>
<script>
Chart.defaults.font.family="'IBM Plex Sans Thai','Archivo',sans-serif";
Chart.defaults.color="#5E6E84";
${charts.join("\n")}
// gantt: กระจายแท่งตามคอลัมน์วัน (ใช้ data-s / data-e)
document.querySelectorAll('[data-track]').forEach(function(tr){
  for(var i=0;i<7;i++){var c=document.createElement('div');c.className='cell';c.style.left=(i/7*100)+'%';c.style.width=(100/7)+'%';tr.appendChild(c);}
  tr.querySelectorAll('.bar').forEach(function(b){var s=+b.dataset.s,e=+b.dataset.e,col=100/7;b.style.left=(s*col+col*0.08)+'%';b.style.width=((e-s+1)*col-col*0.16)+'%';});
});
// วงแหวนเปอร์เซ็นต์ (svg[data-ring])
document.querySelectorAll('svg[data-ring]').forEach(function(svg){var pct=+svg.dataset.ring,c=2*Math.PI*50,circle=svg.querySelector('.rp');if(!circle)return;circle.style.strokeDasharray=c;circle.style.strokeDashoffset=c*(1-pct/100);});
// นำทาง: จุดด้านขวา + คีย์บอร์ด + ล้อเมาส์เลื่อนแนวนอน
var deck=document.getElementById('deck'),nav=document.getElementById('nav');
var slidesArr=[].slice.call(document.querySelectorAll('.slide'));
slidesArr.forEach(function(s,i){var a=document.createElement('a');a.title='หน้า '+(i+1);a.addEventListener('click',function(){deck.scrollTo({left:i*innerWidth,behavior:'smooth'});});nav.appendChild(a);});
var dots=[].slice.call(nav.children);
slidesArr.forEach(function(s){new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){dots.forEach(function(d){d.classList.remove('active');});dots[slidesArr.indexOf(e.target)].classList.add('active');}});},{root:deck,threshold:.6}).observe(s);});
deck.addEventListener('wheel',function(e){if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){e.preventDefault();deck.scrollLeft+=e.deltaY;}},{passive:false});
document.addEventListener('keydown',function(e){
  if(['ArrowRight','ArrowDown','PageDown',' '].includes(e.key)){e.preventDefault();deck.scrollBy({left:innerWidth,behavior:'smooth'});}
  if(['ArrowLeft','ArrowUp','PageUp'].includes(e.key)){e.preventDefault();deck.scrollBy({left:-innerWidth,behavior:'smooth'});}});
</script>
</body></html>`;
}
