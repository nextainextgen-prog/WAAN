// เครื่องยนต์เด็คนำเสนอ HTML สไตล์ Thunder — navy CI, ไอคอน SVG, Chart.js, เลื่อนแนวนอน
export interface DeckKpi {
  label: string;
  value: string;
  unit?: string;
  tone?: "primary" | "good" | "warn" | "bad";
}
export interface DeckChart {
  type: "bar" | "line" | "doughnut";
  labels: string[];
  data: number[];
  label?: string;
}
export interface DeckBullet {
  icon?: string;
  title: string;
  text?: string;
}
export interface DeckSlide {
  layout: "cover" | "kpi" | "chart" | "table" | "bullets" | "section" | "closing";
  kicker?: string;
  title?: string;
  subtitle?: string;
  kpis?: DeckKpi[];
  chart?: DeckChart;
  columns?: string[];
  rows?: string[][];
  bullets?: DeckBullet[];
  note?: string;
}
export interface Deck {
  title: string;
  titleEn?: string;
  subtitle: string;
  meta?: { label: string; value: string }[];
  slides: DeckSlide[];
}

const ICONS: Record<string, string> = {
  chart: '<path d="M4 4v16h16M8 15l3-4 3 3 4-6"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.5" cy="9" r="2.3"/><path d="M16.5 14c2.6.2 4.5 2.3 4.5 5"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  money: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 3 2 3H5"/>',
  bolt: '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M8 12h8M8 16h6"/>',
  star: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.1 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.3l6.1-.7z"/>',
  warn: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  arrow: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  rocket: '<path d="M12 3c3 1.2 5 4.2 5 8l-1.8 3H8.8L7 11c0-3.8 2-6.8 5-8zM9.5 14l-2 4M14.5 14l2 4"/>',
};
function icon(name?: string): string {
  const p = ICONS[name || "check"] || ICONS.check;
  return `<svg class="icn" viewBox="0 0 24 24">${p}</svg>`;
}
function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

const TONE: Record<string, string> = {
  primary: "var(--brand)",
  good: "var(--good)",
  warn: "var(--warn)",
  bad: "var(--bad)",
};

export function renderDeckHtml(deck: Deck, logoDataUri = ""): string {
  const charts: string[] = [];
  const slidesHtml = deck.slides.map((s, i) => renderSlide(s, i, deck, logoDataUri, charts)).join("\n");

  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(deck.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&family=IBM+Plex+Sans+Thai:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
:root{--navy:#0A2F5C;--blue:#1C5FA0;--brand:#2B7CC9;--sky:#79B0E5;--ice:#C8DDF1;--bg:#fff;--paper:#F4F8FD;--line:#E3ECF6;--line2:#D3E0F0;--ink:#0D1B2A;--muted:#5E6E84;--faint:#9AA9BC;--good:#22A06B;--warn:#E5B342;--bad:#D9544D}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'IBM Plex Sans Thai','Archivo',sans-serif;color:var(--ink);background:var(--paper);overflow:hidden}
.deck{display:flex;flex-direction:row;height:100vh;width:100vw;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scroll-behavior:smooth}
h1,h2,h3,h4,.kicker,.num{font-family:'Archivo','IBM Plex Sans Thai',sans-serif}
.mono{font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums}
@keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
@keyframes spin{to{transform:rotate(360deg)}}
.slide{flex:none;width:100vw;height:100vh;scroll-snap-align:start;position:relative;display:flex;flex-direction:column;overflow:hidden;background:radial-gradient(1100px 560px at 10% -8%,#EAF3FD 0%,#F6FBFF 42%,#fff 100%)}
.inner{flex:1;padding:5vh 5.5vw;display:flex;flex-direction:column;justify-content:center;position:relative;min-height:0;z-index:3}
.pageno{position:absolute;right:2.4vw;bottom:2vh;font-family:'Archivo';font-weight:700;font-size:12px;color:var(--faint);z-index:4}
.brand{position:absolute;right:2.4vw;top:2.4vh;display:flex;align-items:center;gap:8px;z-index:6;font-family:'Archivo';font-weight:800;font-size:13px;color:var(--blue)}
.brand img{height:26px}
.bg-navy{background:radial-gradient(1200px 640px at 15% 8%,#164378 0%,#0A2F5C 46%,#061c3a 100%);color:#fff}
.bg-navy .kicker{color:var(--sky)}.bg-navy .h,.bg-navy h1,.bg-navy h2{color:#fff}.bg-navy .sub{color:#B7C8DE}.bg-navy .brand{color:#fff}.bg-navy .pageno{color:rgba(255,255,255,.5)}
.deco{position:absolute;pointer-events:none;z-index:1}
.deco.blob{width:460px;height:460px;border-radius:50%;filter:blur(12px);opacity:.1;background:var(--brand);right:-150px;top:-140px;animation:floaty 9s ease-in-out infinite}
.deco.dots{width:170px;height:170px;background-image:radial-gradient(var(--brand) 1.5px,transparent 1.5px);background-size:15px 15px;opacity:.13;left:-24px;top:9vh}
.bg-navy .deco.dots{background-image:radial-gradient(var(--sky) 1.5px,transparent 1.5px);opacity:.15}
.deco.ring{width:320px;height:320px;border-radius:50%;border:2px dashed var(--line2);opacity:.5;right:-90px;bottom:-90px;animation:spin 60s linear infinite}
.icn{width:1em;height:1em;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;display:inline-block;vertical-align:-.14em}
.kicker{font-family:'Archivo';font-weight:800;font-size:13px;letter-spacing:.09em;color:var(--brand);text-transform:uppercase;display:flex;align-items:center;gap:8px;margin-bottom:14px}
.kicker .icn{font-size:16px;stroke-width:2.2}
.h{font-family:'Archivo';font-weight:800;font-size:clamp(26px,3vw,44px);color:var(--navy);line-height:1.1;letter-spacing:-.01em}
.h em{font-style:normal;color:var(--brand)}
.sub{color:var(--muted);font-size:clamp(13px,1vw,16px);margin-top:12px;max-width:80ch;line-height:1.55}
.rule{height:4px;width:60px;background:var(--brand);border-radius:2px;margin:16px 0 0}
/* cover */
.cover .inner{justify-content:center}
.cover-title{font-family:'Archivo';font-weight:900;font-size:clamp(46px,7vw,104px);line-height:.92;color:#fff;letter-spacing:-.02em}
.cover-title em{font-style:normal;color:var(--sky)}
.cover-th{font-family:'IBM Plex Sans Thai';font-weight:700;font-size:clamp(20px,2.3vw,34px);color:#fff;margin-top:10px}
.cover-meta{display:flex;gap:40px;margin-top:44px;flex-wrap:wrap}
.cover-meta .l{font-family:'Archivo';font-weight:800;font-size:11px;letter-spacing:.14em;color:var(--sky);text-transform:uppercase}
.cover-meta .v{font-size:17px;font-weight:600;color:#fff;margin-top:5px}
.strip{position:absolute;left:0;bottom:0;height:13px;width:100%;background:linear-gradient(90deg,var(--sky),var(--brand) 60%,#fff);z-index:4}
/* kpi */
.kpigrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:20px;margin-top:2vh}
.kpi{background:#fff;border:1px solid var(--line);border-radius:16px;padding:24px 22px;box-shadow:0 8px 26px rgba(10,47,92,.06);position:relative;overflow:hidden}
.kpi::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--brand)}
.kpi .kl{font-size:13.5px;color:var(--muted)}
.kpi .kv{font-family:'Archivo';font-weight:900;font-size:40px;color:var(--navy);margin-top:8px;line-height:1}
.kpi .ku{font-size:13px;color:var(--faint);font-weight:600;margin-top:4px}
/* bullets */
.blist{display:flex;flex-direction:column;gap:14px;margin-top:2vh}
.brow{display:flex;align-items:flex-start;gap:16px;padding:16px 22px;border-radius:14px;background:#fff;border:1px solid var(--line);box-shadow:0 5px 16px rgba(10,47,92,.05)}
.brow .bic{width:44px;height:44px;border-radius:11px;background:#EAF1FA;color:var(--blue);display:flex;align-items:center;justify-content:center;flex:none}
.brow .bic .icn{font-size:22px}
.brow h4{font-family:'Archivo';font-weight:800;font-size:17px;color:var(--navy)}
.brow p{font-size:13.5px;color:var(--muted);margin-top:3px;line-height:1.5}
/* table */
.stable{width:100%;border-collapse:collapse;font-size:14px;margin-top:2vh}
.stable th{text-align:left;font-family:'Archivo';font-weight:700;font-size:12px;letter-spacing:.03em;color:#fff;background:var(--navy);padding:12px 16px}
.stable td{padding:11px 16px;border-bottom:1px solid var(--line);color:var(--ink)}
.stable tr:nth-child(even) td{background:var(--paper)}
/* chart */
.chartbox{flex:1;min-height:0;margin-top:2vh;background:#fff;border:1px solid var(--line);border-radius:16px;padding:22px;box-shadow:0 8px 26px rgba(10,47,92,.06)}
/* section */
.section .inner{justify-content:center}
.section .big{font-family:'Archivo';font-weight:900;font-size:clamp(34px,4.4vw,64px);color:#fff;line-height:1.05;max-width:22ch}
/* closing */
.closing .inner{justify-content:center;align-items:flex-start}
.closing .big{font-family:'Archivo';font-weight:900;font-size:clamp(40px,5.5vw,84px);color:#fff}
@media print{.deck{display:block;height:auto;overflow:visible}.slide{page-break-after:always;width:100%;height:100vh}}
</style></head><body>
<div class="deck">
${slidesHtml}
</div>
<script>
Chart.defaults.font.family="'IBM Plex Sans Thai','Archivo',sans-serif";
Chart.defaults.color="#5E6E84";
${charts.join("\n")}
</script>
</body></html>`;
}

function brandMark(logo: string): string {
  return `<div class="brand">${logo ? `<img src="${logo}" alt=""/>` : ""}<span>THUNDER SOLUTION</span></div>`;
}

function renderSlide(s: DeckSlide, i: number, deck: Deck, logo: string, charts: string[]): string {
  const pageno = `<div class="pageno mono">${String(i + 1).padStart(2, "0")} / ${String(deck.slides.length).padStart(2, "0")}</div>`;
  const head = (dark = false) =>
    `${s.kicker ? `<div class="kicker">${icon(kickerIcon(s))} ${esc(s.kicker)}</div>` : ""}
     ${s.title ? `<div class="h">${esc(s.title)}</div>` : ""}
     ${s.title ? `<div class="rule"></div>` : ""}
     ${s.subtitle ? `<div class="sub">${esc(s.subtitle)}</div>` : ""}`;

  if (s.layout === "cover") {
    return `<section class="slide cover bg-navy">
      <span class="deco dots"></span><span class="deco blob"></span>
      ${brandMark(logo)}
      <div class="inner">
        <div class="kicker">${icon("bolt")} ${esc(s.kicker || deck.titleEn || "Report")}</div>
        <div class="cover-title">${esc(deck.titleEn || deck.title)}</div>
        <div class="cover-th">${esc(deck.title)}</div>
        <div class="cover-meta">${(deck.meta || []).map((m) => `<div><div class="l">${esc(m.label)}</div><div class="v">${esc(m.value)}</div></div>`).join("")}</div>
      </div>
      <div class="strip"></div>${pageno}</section>`;
  }
  if (s.layout === "section" || s.layout === "closing") {
    return `<section class="slide ${s.layout} bg-navy">
      <span class="deco dots"></span><span class="deco ring"></span>
      ${brandMark(logo)}
      <div class="inner">
        ${s.kicker ? `<div class="kicker">${icon("flag")} ${esc(s.kicker)}</div>` : ""}
        <div class="big">${esc(s.title)}</div>
        ${s.note ? `<div class="sub" style="margin-top:20px">${esc(s.note)}</div>` : ""}
      </div>${pageno}</section>`;
  }

  let body = "";
  if (s.layout === "kpi") {
    body = `<div class="kpigrid">${(s.kpis || []).map((k) => `<div class="kpi" style="--brand:${TONE[k.tone || "primary"]}">
      <div class="kl">${esc(k.label)}</div>
      <div class="kv">${esc(k.value)}</div>
      ${k.unit ? `<div class="ku">${esc(k.unit)}</div>` : ""}
    </div>`).join("")}</div>`;
  } else if (s.layout === "bullets") {
    body = `<div class="blist">${(s.bullets || []).map((b) => `<div class="brow">
      <div class="bic">${icon(b.icon)}</div>
      <div><h4>${esc(b.title)}</h4>${b.text ? `<p>${esc(b.text)}</p>` : ""}</div>
    </div>`).join("")}</div>`;
  } else if (s.layout === "table") {
    body = `<table class="stable"><thead><tr>${(s.columns || []).map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${(s.rows || []).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  } else if (s.layout === "chart" && s.chart) {
    const id = `c${i}`;
    body = `<div class="chartbox"><canvas id="${id}"></canvas></div>`;
    charts.push(chartScript(id, s.chart));
  }

  return `<section class="slide">
    <span class="deco dots"></span>
    ${brandMark(logo)}
    <div class="inner">${head()}${body}</div>${pageno}</section>`;
}

function kickerIcon(s: DeckSlide): string {
  if (s.layout === "kpi") return "target";
  if (s.layout === "chart") return "chart";
  if (s.layout === "table") return "doc";
  if (s.layout === "bullets") return "check";
  return "arrow";
}

function chartScript(id: string, c: DeckChart): string {
  const colors = ["#2B7CC9", "#22A06B", "#E5B342", "#79B0E5", "#164378", "#D9544D"];
  const isDoughnut = c.type === "doughnut";
  const bg = isDoughnut ? JSON.stringify(colors) : "'#2B7CC9'";
  return `new Chart(document.getElementById("${id}"),{type:"${c.type}",
    data:{labels:${JSON.stringify(c.labels)},datasets:[{label:${JSON.stringify(c.label || "")},data:${JSON.stringify(c.data)},
      backgroundColor:${bg},borderColor:"#1C5FA0",borderWidth:${c.type === "line" ? 2 : 0},borderRadius:${isDoughnut ? 0 : 8},tension:.35,fill:${c.type === "line"}}]},
    options:{responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:${isDoughnut},position:"right"}},
      scales:${isDoughnut ? "{}" : "{y:{beginAtZero:true,grid:{color:'#E3ECF6'}},x:{grid:{display:false}}}"}}});`;
}
