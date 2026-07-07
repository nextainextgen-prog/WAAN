// ===== ระบบดีไซน์เด็คนำเสนอ Thunder (สกัดจากเทมเพลตต้นฉบับ Presentation_CS_Weekly) =====
// สไตล์เริ่มต้นของสไลด์น้องวาน: navy CI, ฟอนต์ Archivo/IBM Plex Sans Thai, Chart.js, เลื่อนแนวนอน
// อย่าแก้ด้วยมือ — ถ้าต้องอัปเดตธีม ให้สกัดจากไฟล์ต้นฉบับใหม่

export const DECK_CSS = String.raw`:root{
  --navy:#0A2F5C; --blue:#1C5FA0; --brand:#2B7CC9; --sky:#79B0E5; --ice:#C8DDF1;
  --bg:#FFFFFF; --paper:#F4F8FD; --line:#E3ECF6; --line2:#D3E0F0;
  --ink:#0D1B2A; --muted:#5E6E84; --faint:#9AA9BC;
  --good:#22A06B; --goodbg:#E4F4EC; --warn:#E5B342; --warnbg:#FBF2DC; --bad:#D9544D; --badbg:#FBE7E5;
  --gold:#E3A93C;
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'IBM Plex Sans Thai','Archivo',sans-serif;color:var(--ink);background:var(--paper);height:100vh;overflow:hidden}
.deck{display:flex;flex-direction:row;height:100vh;width:100vw;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scroll-behavior:smooth}
.deck::-webkit-scrollbar{height:8px}.deck::-webkit-scrollbar-thumb{background:var(--line2);border-radius:4px}
h1,h2,h3,h4,h5,.display,.kicker,.num,.mono{font-family:'Archivo','IBM Plex Sans Thai',sans-serif}
.mono{font-family:'JetBrains Mono',monospace}

/* animations */
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.14);opacity:.8}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes flow{to{stroke-dashoffset:-600}}
@keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
@keyframes nudgex{0%,100%{transform:translateX(0)}50%{transform:translateX(5px)}}
@keyframes dashmove{to{stroke-dashoffset:-500}}
.arrownode{width:62px;height:62px;border-radius:50%;background:linear-gradient(140deg,#2B7CC9,#0A2F5C);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 24px rgba(43,124,201,.45);animation:nudgex 1.5s ease-in-out infinite;z-index:5;flex:none}
.arrownode .icn{font-size:28px;stroke-width:2.6}
.clickhint{display:inline-flex;align-items:center;gap:6px;font-family:'Archivo';font-weight:700;font-size:11px;color:var(--sky);margin-top:auto;padding-top:8px}
.clickhint .icn{font-size:14px}
.stable{width:100%;border-collapse:collapse;font-size:13px}
.stable th{text-align:left;font-family:'Archivo';font-weight:700;font-size:11px;letter-spacing:.03em;color:var(--muted);text-transform:uppercase;border-bottom:2px solid var(--navy);padding:8px 12px}
.stable td{padding:7px 12px;border-bottom:1px solid var(--line);color:var(--ink)}
.stable tr.hl td{background:#EAF3FC;font-weight:600;color:var(--navy)}
.stable tr:hover td{background:var(--paper)}
.roadarrow{position:absolute;top:20px;left:3%;width:94%;height:26px;overflow:visible;z-index:1}
.roadarrow line{stroke:var(--brand);stroke-width:3;stroke-dasharray:14 9;animation:dashmove 9s linear infinite;opacity:.6}
.pkgbar{display:flex;align-items:center;gap:10px;margin-bottom:9px}
.pkgbar .pn{font-family:'Archivo';font-weight:700;font-size:12px;color:var(--navy);width:78px;flex:none}
.pkgbar .track{flex:1;height:14px;background:var(--paper);border-radius:7px;overflow:hidden}
.pkgbar .track i{display:block;height:100%;border-radius:7px;animation:growbar 1.1s ease-out}
.pkgbar .pv{font-family:'JetBrains Mono';font-weight:600;font-size:11.5px;color:var(--muted);width:66px;text-align:right;flex:none}
@keyframes growbar{from{width:0 !important}}
.shine{position:relative;overflow:hidden}
.shine::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:linear-gradient(100deg,transparent 25%,rgba(255,255,255,.45) 50%,transparent 75%);
  background-size:220% 100%;animation:shimmer 2.6s linear infinite}

/* slide frame */
.slide{flex:none;width:100vw;height:100vh;scroll-snap-align:start;position:relative;display:flex;flex-direction:column;overflow:hidden;
  background:radial-gradient(1100px 560px at 10% -8%,#EAF3FD 0%,#F6FBFF 42%,#FFFFFF 100%)}
.slide-inner{flex:1;padding:4.6vh 5.2vw;display:flex;flex-direction:column;justify-content:center;position:relative;min-height:0;z-index:3}
.pageno{position:absolute;right:2.2vw;bottom:1.8vh;font-family:'Archivo';font-weight:700;font-size:12px;color:var(--faint);z-index:4}
.brandmark{position:absolute;right:2.2vw;top:2.2vh;display:flex;align-items:center;gap:8px;z-index:6}
.brandmark img{height:26px;width:26px;border-radius:24%;object-fit:cover;background:#fff;border:1px solid var(--line);box-shadow:0 2px 8px rgba(10,47,92,.1)}
.brandmark .wf{font-family:'Archivo';font-weight:800;font-size:13px;color:var(--blue)}
.brandmark .wf span{color:var(--faint);font-weight:600}
.bg-navy{background:radial-gradient(1200px 640px at 15% 8%,#164378 0%,#0A2F5C 46%,#061c3a 100%);color:#fff}
.bg-accent{background:radial-gradient(900px 520px at 85% 12%,#E7F1FC 0%,#F4F8FD 55%,#FDFEFF 100%)}
.bg-navy .h-sec{color:#fff}.bg-navy .h-sec em{color:var(--sky)}.bg-navy .kicker{color:var(--sky)}
.bg-navy .sub{color:#B7C8DE}.bg-navy .brandmark .wf{color:#fff}.bg-navy .brandmark .wf span{color:var(--sky)}
.bg-navy .pageno{color:rgba(255,255,255,.5)}

/* decorative */
.deco{position:absolute;pointer-events:none;z-index:1}
.deco.bignum{font-family:'Archivo';font-weight:900;font-size:33vh;line-height:.8;color:var(--brand);opacity:.05;right:2vw;bottom:-3vh}
.bg-navy .deco.bignum{color:#fff;opacity:.06}
.deco.dots{width:170px;height:170px;background-image:radial-gradient(var(--brand) 1.5px,transparent 1.5px);background-size:15px 15px;opacity:.13;left:-24px;top:9vh}
.bg-navy .deco.dots{background-image:radial-gradient(var(--sky) 1.5px,transparent 1.5px);opacity:.15}
.deco.blob{width:460px;height:460px;border-radius:50%;filter:blur(12px);opacity:.10;background:var(--brand);right:-150px;top:-140px;animation:floaty 9s ease-in-out infinite}
.deco.blob2{width:300px;height:300px;border-radius:50%;filter:blur(14px);opacity:.08;background:var(--sky);left:-120px;bottom:-120px;animation:floaty 11s ease-in-out infinite reverse}
.deco.ring{width:320px;height:320px;border-radius:50%;border:2px dashed var(--line2);opacity:.5;left:-110px;bottom:-110px;animation:spin 60s linear infinite}
/* moving accent line */
.liveline{position:absolute;left:0;right:0;height:60px;opacity:.5;z-index:1;pointer-events:none}
.liveline polyline{fill:none;stroke:var(--sky);stroke-width:2.5;stroke-dasharray:10 8;animation:flow 12s linear infinite}

.logo-chip{border-radius:24%;overflow:hidden;object-fit:cover;background:#fff;box-shadow:0 2px 10px rgba(10,47,92,.1);border:1px solid var(--line)}

/* icons */
.icn{width:1em;height:1em;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;display:inline-block;vertical-align:-.14em}

.kicker{font-family:'Archivo';font-weight:800;font-size:12px;letter-spacing:.08em;color:var(--brand);text-transform:uppercase;display:flex;align-items:center;gap:7px}
.kicker .icn{font-size:15px;stroke-width:2.2}
.h-sec{font-family:'Archivo';font-weight:800;font-size:clamp(23px,2.7vw,40px);color:var(--navy);line-height:1.12;letter-spacing:-.005em}
.h-sec em{font-style:normal;color:var(--brand)}
.sub{color:var(--muted);font-size:clamp(12px,.98vw,15px);font-weight:400;margin-top:8px;max-width:74ch;line-height:1.55}
.rule{height:4px;width:58px;background:var(--brand);border-radius:2px;margin:14px 0 0}
.head{margin-bottom:2.2vh}
.head .h-sec{margin-top:14px}

.tag{display:inline-flex;align-items:center;gap:6px;font-family:'Archivo';font-weight:700;font-size:11px;letter-spacing:.02em;padding:4px 10px;border-radius:6px}
.tag .icn{font-size:13px}
.tag.g{background:var(--goodbg);color:var(--good)}.tag.w{background:var(--warnbg);color:#B4841C}
.tag.b{background:var(--badbg);color:var(--bad)}.tag.n{background:#EAF1FA;color:var(--blue)}
.dot{width:9px;height:9px;border-radius:50%;flex:none}
.seemore{display:inline-flex;align-items:center;gap:5px;font-family:'Archivo';font-weight:700;font-size:11px;color:var(--brand);
  border:1px solid var(--line2);border-radius:999px;padding:4px 11px;background:#fff;cursor:pointer;transition:.15s}
.seemore:hover{background:var(--brand);color:#fff;border-color:var(--brand)}
.seemore .icn{font-size:13px}

/* COVER */
.cover .slide-inner{justify-content:center}
.cover .vtag{position:absolute;left:5.2vw;top:5.5vh}
.vlabel{writing-mode:vertical-rl;transform:rotate(180deg);font-family:'Archivo';font-weight:800;letter-spacing:.24em;font-size:13px;color:var(--faint);text-transform:uppercase}
.cover-title{font-family:'Archivo';font-weight:900;font-size:clamp(46px,7vw,102px);line-height:.92;color:var(--navy);letter-spacing:-.02em}
.cover-title em{font-style:normal;color:var(--brand)}
.cover-th{font-family:'IBM Plex Sans Thai';font-weight:700;font-size:clamp(19px,2.3vw,33px);color:var(--navy);margin-top:8px}
.cover-meta{display:flex;gap:36px;margin-top:40px;flex-wrap:wrap}
.cover-meta .m-lab{font-family:'Archivo';font-weight:800;font-size:11px;letter-spacing:.14em;color:var(--faint);text-transform:uppercase}
.cover-meta .m-val{font-size:16px;font-weight:600;color:var(--ink);margin-top:4px}
.cover-logos{position:absolute;right:5.2vw;bottom:6vh;display:flex;align-items:center;gap:15px;z-index:4}
.cover-logos img{height:58px;width:58px}
.cover-strip{position:absolute;left:0;bottom:0;height:13px;width:100%;background:linear-gradient(90deg,var(--navy),var(--brand) 60%,var(--sky));z-index:4}

/* grids */
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:2.4vw;min-height:0}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:1.5vw}
.stretch{align-items:stretch}.vcenter{align-items:center}.fill{flex:1;min-height:0}

/* agenda */
.agenda{display:flex;flex-direction:column;gap:12px;margin-top:.5vh}
.ag-row{display:flex;align-items:center;gap:18px;padding:15px 22px;border-radius:13px;background:#fff;border:1px solid var(--line);
  box-shadow:0 5px 16px rgba(10,47,92,.05);position:relative;overflow:hidden;transition:.15s}
.ag-row:hover{transform:translateX(5px);box-shadow:0 8px 22px rgba(10,47,92,.1)}
.ag-row::before{content:"";position:absolute;left:0;top:0;bottom:0;width:6px;background:var(--brand)}
.ag-row .n{font-family:'Archivo';font-weight:900;font-size:25px;color:var(--ice);min-width:40px}
.ag-row .agic{width:44px;height:44px;border-radius:11px;background:#EAF1FA;color:var(--blue);display:flex;align-items:center;justify-content:center;flex:none}
.ag-row .agic .icn{font-size:22px}
.ag-row h4{font-family:'Archivo';font-weight:800;font-size:17px;color:var(--navy)}
.ag-row p{font-size:12.5px;color:var(--muted);margin-top:2px}
.ag-row .rt{margin-left:auto}

/* big-zone branch */
.zones{display:grid;grid-template-columns:1fr 88px 1fr;gap:0;flex:1;align-items:stretch}
.zone{border-radius:20px;padding:30px 32px;display:flex;flex-direction:column;position:relative;overflow:hidden;box-shadow:0 14px 40px rgba(10,47,92,.09)}
.zone.sys{background:linear-gradient(155deg,#F0F6FD,#E1EEFB);border:1px solid #D3E4F6}
.zone.team{background:linear-gradient(155deg,#FEF8EC,#FBEFD5);border:1px solid #F2E2BE}
.zone .zic{width:74px;height:74px;border-radius:18px;display:flex;align-items:center;justify-content:center;color:#fff;margin-bottom:16px;box-shadow:0 8px 20px rgba(10,47,92,.18)}
.zone.sys .zic{background:linear-gradient(150deg,#2B7CC9,#0A2F5C)}
.zone.team .zic{background:linear-gradient(150deg,#E5B342,#C58A15)}
.zone .zic .icn{font-size:38px;stroke-width:1.7}
.zone h3{font-family:'Archivo';font-weight:900;font-size:26px;color:var(--navy);display:flex;align-items:center;justify-content:space-between}
.zone .zlist{margin-top:16px;display:flex;flex-direction:column;gap:12px}
.zone .zitem{display:flex;gap:12px;align-items:flex-start;font-size:14.5px;color:#31465e;line-height:1.4}
.zone .zitem .icn{font-size:20px;color:var(--brand);flex:none;margin-top:1px}
.zone.team .zitem .icn{color:var(--gold)}
.zone .peep{position:absolute;right:-10px;bottom:-14px;opacity:.08}
.zone .peep .icn{font-size:150px;stroke-width:1.2}
.zsplit{display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative}
.zsplit .core{background:var(--navy);color:#fff;border-radius:16px;width:82px;height:82px;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 12px 30px rgba(10,47,92,.3);z-index:2}
.zsplit .core .n{font-family:'Archivo';font-weight:900;font-size:34px;line-height:1}
.zsplit .core .t{font-size:9.5px;color:var(--sky);letter-spacing:.1em}
.zsplit::before{content:"";position:absolute;top:50%;left:0;right:0;height:2px;background:var(--line2)}

/* gantt (full) */
.gantt{margin-top:0;border-top:2px solid var(--navy);width:100%}
.gantt .days{display:grid;grid-template-columns:250px repeat(7,1fr);border-bottom:1px solid var(--line)}
.gantt .days div{font-family:'Archivo';font-weight:700;font-size:13px;color:var(--muted);text-align:center;padding:11px 0;border-left:1px solid var(--line)}
.gantt .days div:first-child{text-align:left;border-left:none;color:var(--navy);padding-left:4px}
.grow{display:grid;grid-template-columns:250px repeat(7,1fr);align-items:center;border-bottom:1px solid var(--line)}
.grow .lab{font-size:14px;color:var(--ink);font-weight:600;padding:14px 12px 14px 0;line-height:1.25;display:flex;gap:10px;align-items:center}
.grow .lab .icn{font-size:19px;color:var(--brand);flex:none}
.grow .lab small{display:block;color:var(--faint);font-weight:400;font-size:11.5px}
.track{grid-column:2 / span 7;position:relative;height:100%;display:flex;align-items:center}
.track .cell{position:absolute;top:0;bottom:0;border-left:1px solid var(--line)}
.bar{position:absolute;height:22px;border-radius:11px;display:flex;align-items:center;padding:0 12px;font-family:'Archivo';font-weight:700;font-size:11.5px;color:#fff;white-space:nowrap;box-shadow:0 3px 8px rgba(0,0,0,.12)}
.bar.g{background:linear-gradient(90deg,#2CB77E,#1E8E60)}.bar.w{background:linear-gradient(90deg,#EBC15A,#D79E28);color:#5b4409}.bar.b{background:linear-gradient(90deg,#E4675F,#C63B33)}
.bar.open::before{content:"";position:absolute;right:-2px;top:0;bottom:0;width:16px;background:repeating-linear-gradient(45deg,rgba(255,255,255,.55) 0 3px,transparent 3px 6px);border-radius:0 11px 11px 0}

/* safe zone frame */
.ext-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:1.4vw}
.ext-c{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px 18px;box-shadow:0 5px 16px rgba(10,47,92,.05);display:flex;flex-direction:column;gap:8px}
.ext-c .top{display:flex;align-items:center;gap:10px}
.ext-c .eic{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:none}
.ext-c .eic .icn{font-size:20px;color:#fff}
.ext-c .d{font-family:'Archivo';font-weight:800;font-size:12px;color:var(--muted)}
.ext-c p{font-size:12.5px;color:var(--ink);line-height:1.4}
.safeframe{margin-top:2vh;border-radius:18px;overflow:hidden;box-shadow:0 16px 40px rgba(10,47,92,.16);border:1px solid var(--line)}
.safeframe .sf-head{display:flex;justify-content:space-between;align-items:center;padding:12px 22px;background:var(--navy);color:#fff}
.safeframe .sf-head h4{font-family:'Archivo';font-weight:800;font-size:15px;display:flex;align-items:center;gap:9px}
.safeframe .sf-head .icn{font-size:19px;color:var(--sky)}
.safeframe .sf-head .mono{font-size:12px;color:#9FBBDB}
.safebar{height:96px;display:flex}
.safebar .seg{display:flex;align-items:center;gap:16px;padding:0 30px;color:#fff}
.safebar .green{background:linear-gradient(120deg,#2CB77E,#1C8A5C)}
.safebar .red{background:linear-gradient(120deg,#E0655D,#C13930);justify-content:flex-end;text-align:right}
.safebar .segic{width:52px;height:52px;border-radius:14px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;flex:none}
.safebar .segic .icn{font-size:28px}
.safebar .p{font-family:'Archivo';font-weight:900;font-size:38px;line-height:1}
.safebar .l{font-size:12.5px;opacity:.95}
.sf-foot{display:flex;gap:26px;padding:12px 22px;background:#fff;flex-wrap:wrap}
.sf-foot .fi{display:flex;align-items:center;gap:9px;font-size:12.5px;color:var(--muted)}
.sf-foot .fi .icn{font-size:18px}

/* panels — FIX text color explicitly */
.panel{border:1px solid var(--line);border-radius:16px;padding:24px 26px;background:#fff;color:var(--ink);display:flex;flex-direction:column;box-shadow:0 8px 24px rgba(10,47,92,.06)}
.panel.dark{background:linear-gradient(155deg,#15437a,#0A2F5C);color:#fff;border:none}
.panel .p-k{font-family:'Archivo';font-weight:800;font-size:12px;letter-spacing:.1em;text-transform:uppercase;display:flex;align-items:center;gap:8px}
.panel .p-k .icn{font-size:16px}
.panel h3{font-family:'Archivo';font-weight:800;font-size:22px;margin:9px 0 14px;line-height:1.18;color:inherit}
.panel .li{display:flex;gap:12px;margin-bottom:12px;font-size:14px;line-height:1.45;color:inherit}
.panel .li .ic{width:30px;height:30px;border-radius:8px;flex:none;display:flex;align-items:center;justify-content:center;background:#EAF1FA;color:var(--blue)}
.panel .li .ic .icn{font-size:17px}
.panel.dark .li .ic{background:rgba(255,255,255,.16);color:#fff}
.panel .li b{color:inherit}
.arrowflow{display:flex;align-items:center;justify-content:center;color:var(--brand)}
.arrowflow .icn{font-size:40px;stroke-width:2.4}

/* framed image */
.framed{border-radius:16px;overflow:hidden;border:1px solid var(--line);box-shadow:0 10px 30px rgba(10,47,92,.18);background:#0d1b2a}
.framed img{display:block;width:100%;height:100%;object-fit:cover}
.framed.cap{position:relative}
.framed .capbar{position:absolute;left:0;right:0;bottom:0;padding:9px 14px;background:linear-gradient(0deg,rgba(6,20,40,.9),transparent);color:#fff;font-size:12px;font-weight:600}

/* roadmap */
.roadmap{position:relative;margin-top:3vh;padding-top:8px}
.roadline{position:absolute;top:34px;left:4%;right:4%;height:3px;background:linear-gradient(90deg,var(--ice),var(--brand),var(--ice));border-radius:2px}
.rm-row{display:grid;grid-auto-flow:column;grid-auto-columns:1fr}
.rm-node{position:relative;padding:0 12px;display:flex;flex-direction:column;align-items:center;text-align:center}
.rm-node .knob{width:56px;height:56px;border-radius:16px;background:#fff;border:2px solid var(--brand);display:flex;align-items:center;justify-content:center;color:var(--brand);position:relative;z-index:2;box-shadow:0 8px 20px rgba(10,47,92,.12);margin-bottom:16px}
.rm-node .knob .icn{font-size:26px}
.rm-node .step{font-family:'Archivo';font-weight:900;font-size:12px;color:var(--brand);letter-spacing:.1em}
.rm-node h5{font-family:'Archivo';font-weight:800;font-size:15px;color:var(--navy);margin:5px 0 6px}
.rm-node p{font-size:12.5px;color:var(--muted);line-height:1.45}

/* milestones */
.miles{position:relative;margin-top:4vh}
.milesvg{position:absolute;top:6px;left:0;right:0;height:16px}
.milesvg line{stroke:var(--navy);stroke-width:2}
.milesvg .flowline{stroke:var(--brand);stroke-width:3;stroke-dasharray:14 10;animation:flow 8s linear infinite}
.ms-row{display:grid;gap:16px;grid-template-columns:repeat(4,1fr)}
.ms{position:relative;padding-top:34px}
.ms .knob{position:absolute;top:0;left:0;width:16px;height:16px;border-radius:50%;background:#fff;border:3px solid var(--brand);box-shadow:0 0 0 4px rgba(43,124,201,.16)}
.ms .logo{width:56px;height:56px;border-radius:14px;background:#fff;border:1px solid var(--line);box-shadow:0 5px 14px rgba(10,47,92,.1);object-fit:contain;padding:6px;margin-bottom:10px}
.ms .co{font-family:'Archivo';font-weight:800;font-size:15px;color:var(--navy)}
.ms .meta{font-size:11.5px;color:var(--faint);font-weight:600;margin:2px 0 6px}
.ms p{font-size:12.5px;color:var(--muted);line-height:1.4}

/* KPI */
.kpi-row{display:grid;grid-template-columns:repeat(4,1fr);border-top:2px solid var(--navy);border-bottom:1px solid var(--line)}
.kpi{padding:16px 18px;border-left:1px solid var(--line)}
.kpi:first-child{border-left:none}
.kpi .lab{font-family:'Archivo';font-weight:700;font-size:11px;letter-spacing:.03em;color:var(--muted);text-transform:uppercase;display:flex;align-items:center;gap:6px}
.kpi .lab .icn{font-size:15px;color:var(--brand)}
.kpi .val{font-family:'Archivo';font-weight:900;font-size:40px;color:var(--navy);line-height:1;margin:8px 0 4px}
.delta{font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:5px}
.delta .ar{display:inline-block;animation:bob 1.5s ease-in-out infinite}
.up{color:var(--good)}.down{color:var(--bad)}.flat{color:var(--muted)}

/* numbered cards */
.numgrid{display:grid;gap:1.3vw}
.numcard{background:#fff;color:var(--ink);border:1px solid var(--line);border-radius:15px;padding:18px;position:relative;overflow:hidden;box-shadow:0 6px 18px rgba(10,47,92,.05)}
.numcard .bignum{position:absolute;right:-4px;top:-14px;font-family:'Archivo';font-weight:900;font-size:62px;color:var(--paper);z-index:0}
.numcard>*{position:relative;z-index:1}
.numcard .ic{width:38px;height:38px;border-radius:10px;background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:center;margin-bottom:10px}
.numcard .ic img{width:30px;height:30px;border-radius:7px;object-fit:contain;background:#fff;padding:2px}
.numcard .ic .icn{font-size:20px}
.numcard h4{font-family:'Archivo';font-weight:800;font-size:15px;color:var(--navy)}
.numcard .big{font-family:'Archivo';font-weight:900;font-size:34px;color:var(--brand);line-height:1;margin:4px 0}
.numcard p{font-size:12px;color:var(--muted);line-height:1.4}

/* rings */
.rings{display:grid;grid-template-columns:1fr 1fr;gap:1.2vw;margin:8px 0}
.ring-c{display:flex;flex-direction:column;align-items:center;text-align:center;gap:7px;position:relative}
.ring-c .ringwrap{position:relative;width:120px;height:120px}
.ring-c svg{width:120px;height:120px;position:absolute;inset:0}
.ring-c .ghost{animation:spin 3.2s linear infinite;transform-origin:60px 60px}
.ring-c .rl{font-family:'Archivo';font-weight:800;font-size:13px;color:var(--navy)}
.ring-c .rs{font-size:11px;color:var(--muted)}
.ring-num{font-family:'Archivo';font-weight:900;font-size:26px;fill:var(--navy)}

/* chevron */
.chev{display:flex;gap:6px;margin-top:1vh}
.chev .sc{flex:1;background:var(--ice);color:var(--navy);padding:16px 12px 16px 30px;position:relative;clip-path:polygon(0 0,calc(100% - 18px) 0,100% 50%,calc(100% - 18px) 100%,0 100%,18px 50%)}
.chev .sc:first-child{clip-path:polygon(0 0,calc(100% - 18px) 0,100% 50%,calc(100% - 18px) 100%,0 100%);padding-left:18px}
.chev .sc.on{background:linear-gradient(120deg,#2B7CC9,#0A2F5C);color:#fff}
.chev .sc .cn{font-family:'Archivo';font-weight:900;font-size:15px;opacity:.7;display:flex;align-items:center;gap:7px}
.chev .sc .cn .icn{font-size:16px}
.chev .sc h5{font-family:'Archivo';font-weight:800;font-size:13.5px;margin-top:4px}
.chev .sc small{font-size:10.5px;opacity:.85}

/* funnel (fixed) */
.funnel{display:flex;flex-direction:column;gap:10px;margin-top:1vh}
.fn{display:grid;grid-template-columns:1fr;gap:3px}
.fn .barf{height:38px;border-radius:9px;display:flex;align-items:center;padding:0 14px;color:#fff;font-family:'Archivo';font-weight:800;font-size:13px;box-shadow:0 4px 12px rgba(10,47,92,.14);gap:8px}
.fn .barf .icn{font-size:17px}
.fn .cap{font-size:11.5px;color:#B7C8DE;padding-left:4px}
.bg-navy .fn .cap{color:#9FBBDB}

/* leaderboard */
.lb{display:flex;flex-direction:column;gap:9px}
.lb-row{display:grid;grid-template-columns:34px 1fr 120px;align-items:center;gap:14px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:11px 16px;box-shadow:0 4px 12px rgba(10,47,92,.04)}
.lb-row .medal{font-size:20px}
.lb-row .nm{font-family:'Archivo';font-weight:800;font-size:15px;color:var(--navy)}
.lb-row .nm small{display:block;font-family:'IBM Plex Sans Thai';font-weight:400;font-size:11.5px;color:var(--muted)}
.lb-bar{height:9px;background:var(--paper);border-radius:5px;overflow:hidden}
.lb-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--brand),var(--navy));border-radius:5px;animation:growbar 1.2s ease-out}

/* podium */
.podium{display:grid;grid-template-columns:1fr 1fr;gap:2vw;align-items:stretch}
.winner{background:linear-gradient(160deg,#fff,#F3F8FE);border:1px solid var(--line);border-radius:18px;padding:22px 24px;box-shadow:0 12px 32px rgba(10,47,92,.1);position:relative;overflow:hidden;display:flex;gap:18px;align-items:center}
.winner .rib{position:absolute;top:0;right:0;background:linear-gradient(120deg,var(--gold),#C58A15);color:#fff;font-family:'Archivo';font-weight:800;font-size:11px;padding:5px 30px;transform:rotate(45deg) translate(24px,-6px)}
.winner .ph{width:96px;height:96px;border-radius:16px;object-fit:cover;flex:none;border:3px solid #fff;box-shadow:0 8px 20px rgba(10,47,92,.2)}
.winner .tro{position:absolute;left:-10px;bottom:-16px;color:var(--gold);opacity:.12}
.winner .tro .icn{font-size:130px}
.winner h4{font-family:'Archivo';font-weight:900;font-size:20px;color:var(--navy);display:flex;align-items:center;gap:8px}
.winner .role{font-size:12px;color:var(--brand);font-weight:700;margin:2px 0 8px}
.winner p{font-size:12.5px;color:var(--muted);line-height:1.45}

/* modal */
.modal-bg{position:fixed;inset:0;background:rgba(6,20,40,.62);backdrop-filter:blur(3px);z-index:100;display:none;align-items:center;justify-content:center;padding:5vh 5vw}
.modal-bg.open{display:flex}
.modal{background:#fff;border-radius:16px;max-width:1000px;width:100%;max-height:88vh;overflow:auto;box-shadow:0 30px 80px rgba(6,20,40,.5)}
.modal .mh{position:sticky;top:0;background:var(--navy);color:#fff;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;z-index:2}
.modal .mh h3{font-family:'Archivo';font-weight:800;font-size:18px}
.modal .mh .x{cursor:pointer;font-family:'Archivo';font-weight:800;font-size:20px;background:rgba(255,255,255,.14);width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center}
.modal .mb{padding:20px 24px}
.modal table{width:100%;border-collapse:collapse;font-size:13px}
.modal th{text-align:left;font-family:'Archivo';font-weight:700;font-size:11px;letter-spacing:.03em;color:var(--muted);text-transform:uppercase;border-bottom:2px solid var(--navy);padding:8px 10px;position:sticky;top:64px;background:#fff}
.modal td{padding:8px 10px;border-bottom:1px solid var(--line);color:var(--ink)}
.modal tr:hover td{background:var(--paper)}
.modal .mono{color:var(--muted);font-size:12px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:7px 12px;font-size:12.5px;color:var(--ink)}
.chip b{color:var(--navy)}

/* nav */
.nav{position:fixed;right:14px;top:50%;transform:translateY(-50%);z-index:40;display:flex;flex-direction:column;gap:9px}
.nav a{width:8px;height:8px;border-radius:50%;background:var(--line2);transition:.2s}
.nav a:hover,.nav a.active{background:var(--brand);transform:scale(1.4)}
.chartbox{position:relative;flex:1;min-height:0}
@media print{.nav,.seemore{display:none}}`;

export const ICON_SPRITE = String.raw`<svg style="display:none" xmlns="http://www.w3.org/2000/svg">
<symbol id="i-gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M16.9 16.9l2.1 2.1M19.1 4.9l-2.1 2.1M7 17l-2.1 2.1"/></symbol>
<symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.5" cy="9" r="2.3"/><path d="M16.5 14c2.6.2 4.5 2.3 4.5 5"/></symbol>
<symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></symbol>
<symbol id="i-warn" viewBox="0 0 24 24"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/></symbol>
<symbol id="i-bolt" viewBox="0 0 24 24"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></symbol>
<symbol id="i-chat" viewBox="0 0 24 24"><path d="M4 5h16v11H9l-4 3v-3H4z"/></symbol>
<symbol id="i-doc" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M8 12h8M8 16h6"/></symbol>
<symbol id="i-bank" viewBox="0 0 24 24"><path d="M3 9l9-5 9 5M4 10v8M9 10v8M15 10v8M20 10v8M3 21h18"/></symbol>
<symbol id="i-ai" viewBox="0 0 24 24"><rect x="5" y="8" width="14" height="11" rx="2.5"/><path d="M12 4v4M8.5 13h.01M15.5 13h.01M9 16h6"/><circle cx="12" cy="4" r="1.2"/></symbol>
<symbol id="i-db" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></symbol>
<symbol id="i-key" viewBox="0 0 24 24"><circle cx="8" cy="8" r="4"/><path d="M11 11l9 9M17 17l2-2M19 19l2-2"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></symbol>
<symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></symbol>
<symbol id="i-trophy" viewBox="0 0 24 24"><path d="M8 4h8v5a4 4 0 01-8 0zM8 6H5v1a3 3 0 003 3M16 6h3v1a3 3 0 01-3 3M10 15h4M9 20h6M12 15v5"/></symbol>
<symbol id="i-star" viewBox="0 0 24 24"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.1 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.3l6.1-.7z"/></symbol>
<symbol id="i-cap" viewBox="0 0 24 24"><path d="M2 8l10-4 10 4-10 4z"/><path d="M6 10v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/></symbol>
<symbol id="i-money" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9h.01M18 15h.01"/></symbol>
<symbol id="i-plug" viewBox="0 0 24 24"><path d="M9 2v6M15 2v6M6 8h12v2a6 6 0 01-12 0zM12 16v6"/></symbol>
<symbol id="i-cart" viewBox="0 0 24 24"><circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2l2.4 12h11l1.8-8H6.2"/></symbol>
<symbol id="i-ticket" viewBox="0 0 24 24"><path d="M3 8a2 2 0 012-2h14a2 2 0 012 2 2 2 0 000 4 2 2 0 000 4 2 2 0 01-2 2H5a2 2 0 01-2-2 2 2 0 000-4 2 2 0 000-4z"/></symbol>
<symbol id="i-block" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></symbol>
<symbol id="i-chart" viewBox="0 0 24 24"><path d="M4 4v16h16M8 15l3-4 3 3 4-6"/></symbol>
<symbol id="i-rocket" viewBox="0 0 24 24"><path d="M12 3c3 1.2 5 4.2 5 8l-1.8 3H8.8L7 11c0-3.8 2-6.8 5-8zM9.5 14l-2 4M14.5 14l2 4M12 8h.01"/></symbol>
<symbol id="i-flag" viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 3 2 3H5"/></symbol>
<symbol id="i-net" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M12 7l-6 9M12 7l6 9M7 18h10"/></symbol>
<symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20 11a8 8 0 00-14-4M4 5v3h3M4 13a8 8 0 0014 4M20 19v-3h-3"/></symbol>
<symbol id="i-bug" viewBox="0 0 24 24"><rect x="8" y="8" width="8" height="10" rx="4"/><path d="M12 4v3M9 6L7 4M15 6l2-2M5 11H3M21 11h-2M5 16H3M21 16h-2M9 18l-2 2M15 18l2 2"/></symbol>
<symbol id="i-arrow" viewBox="0 0 24 24"><path d="M4 12h15M13 6l6 6-6 6"/></symbol>
<symbol id="i-golf" viewBox="0 0 24 24"><path d="M12 3v13M12 3l7 3-7 3M6 21h12M9 18a3 3 0 006 0"/></symbol>
</svg>`;

export const ICON_IDS = ["i-gear","i-users","i-shield","i-warn","i-bolt","i-chat","i-doc","i-bank","i-ai","i-db","i-key","i-check","i-clock","i-trophy","i-star","i-cap","i-money","i-plug","i-cart","i-ticket","i-block","i-chart","i-rocket","i-flag","i-net","i-refresh","i-bug","i-arrow","i-golf"];
