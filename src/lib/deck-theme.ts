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
@media print{.nav,.seemore{display:none}}

/* ===== ADDITIONS FOR W28 COMBINED DECK ===== */
.divider-slide .slide-inner{justify-content:center;align-items:flex-start}
.div-eyebrow{font-family:'Archivo';font-weight:800;font-size:13px;letter-spacing:.3em;color:var(--sky);text-transform:uppercase}
.div-title{font-family:'Archivo';font-weight:900;font-size:clamp(52px,7.5vw,110px);line-height:.9;color:#fff;letter-spacing:-.02em;margin-top:10px}
.div-title em{font-style:normal;color:var(--sky)}
.div-sub{color:#B7C8DE;font-size:17px;margin-top:16px;max-width:62ch;line-height:1.6}
.div-svc{display:flex;gap:12px;margin-top:34px;flex-wrap:wrap}
.div-svc .sv{background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:12px 18px;display:flex;align-items:center;gap:11px;backdrop-filter:blur(4px)}
.div-svc .sv img{width:30px;height:30px;border-radius:8px;object-fit:contain;background:#fff;padding:3px}
.div-svc .sv .icn{font-size:22px;color:var(--sky)}
.div-svc .sv b{font-family:'Archivo';font-weight:800;font-size:15px;color:#fff;display:block}
.div-svc .sv small{font-size:11px;color:var(--sky);font-family:'JetBrains Mono'}
.div-bignum{position:absolute;right:4vw;top:50%;transform:translateY(-50%);font-family:'Archivo';font-weight:900;font-size:30vh;color:#fff;opacity:.05;line-height:.8;z-index:1}

.svc-badge{display:inline-flex;align-items:center;gap:9px;background:#fff;border:1px solid var(--line2);border-radius:999px;padding:5px 15px 5px 5px;box-shadow:0 3px 10px rgba(10,47,92,.07)}
.svc-badge img{width:26px;height:26px;border-radius:50%;object-fit:contain;background:#fff;border:1px solid var(--line)}
.svc-badge .icn{font-size:18px;color:var(--brand);margin-left:6px}
.svc-badge b{font-family:'Archivo';font-weight:800;font-size:12.5px;color:var(--navy)}
.svc-badge .co{font-size:10.5px;color:var(--faint);font-family:'Archivo';font-weight:700}
.bg-navy .svc-badge{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.2)}
.bg-navy .svc-badge b{color:#fff}.bg-navy .svc-badge .co{color:var(--sky)}

/* comparison bars */
.cmp{display:flex;flex-direction:column;gap:13px}
.cmp-row{display:grid;grid-template-columns:150px 1fr;gap:14px;align-items:center}
.cmp-row .cl{font-family:'Archivo';font-weight:700;font-size:12px;color:var(--navy);text-align:right;line-height:1.25}
.cmp-row .cl small{display:block;font-family:'IBM Plex Sans Thai';font-weight:400;font-size:10.5px;color:var(--faint)}
.cmp-bars{display:flex;flex-direction:column;gap:5px}
.cmp-b{display:flex;align-items:center;gap:9px}
.cmp-b .tag2{font-family:'Archivo';font-weight:800;font-size:9.5px;width:58px;flex:none;letter-spacing:.04em}
.cmp-b .trk{flex:1;height:17px;background:var(--paper);border-radius:9px;overflow:hidden;position:relative}
.cmp-b .trk i{display:block;height:100%;border-radius:9px;animation:growbar 1.2s ease-out}
.cmp-b .vv{font-family:'JetBrains Mono';font-weight:600;font-size:11.5px;width:74px;text-align:right;flex:none}
.bg-navy .cmp-row .cl{color:#fff}.bg-navy .cmp-row .cl small{color:var(--sky)}
.bg-navy .cmp-b .trk{background:rgba(255,255,255,.12)}
.bg-navy .cmp-b .vv{color:#DCE8F6}

/* stat tiles */
.tiles{display:grid;gap:1.1vw}
.tile{background:#fff;border:1px solid var(--line);border-radius:14px;padding:15px 17px;box-shadow:0 5px 16px rgba(10,47,92,.05);position:relative;overflow:hidden;display:flex;flex-direction:column;gap:3px}
.tile::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--brand)}
.tile.gd::before{background:var(--good)}.tile.wn::before{background:var(--warn)}.tile.bd::before{background:var(--bad)}
.tile .tl{font-family:'Archivo';font-weight:700;font-size:10.5px;letter-spacing:.04em;color:var(--muted);text-transform:uppercase;display:flex;align-items:center;gap:6px}
.tile .tl .icn{font-size:14px;color:var(--brand)}
.tile .tv{font-family:'Archivo';font-weight:900;font-size:30px;color:var(--navy);line-height:1.05}
.tile .tv small{font-size:14px;color:var(--muted);font-weight:700}
.tile .tn{font-size:11px;color:var(--muted);line-height:1.35}
.bg-navy .tile{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.14)}
.bg-navy .tile .tv{color:#fff}.bg-navy .tile .tn{color:#B7C8DE}.bg-navy .tile .tl{color:var(--sky)}

/* customer card */
.ccard{background:#fff;border:1px solid var(--line);border-radius:15px;padding:16px 18px;box-shadow:0 6px 20px rgba(10,47,92,.06);display:flex;flex-direction:column;gap:8px;position:relative;overflow:hidden;transition:.16s}
.ccard:hover{transform:translateY(-3px);box-shadow:0 12px 30px rgba(10,47,92,.13)}
.ccard .ch{display:flex;align-items:flex-start;gap:11px}
.ccard .cic{width:42px;height:42px;border-radius:11px;background:linear-gradient(150deg,#2B7CC9,#0A2F5C);color:#fff;display:flex;align-items:center;justify-content:center;flex:none;box-shadow:0 5px 14px rgba(43,124,201,.3)}
.ccard .cic .icn{font-size:22px}
.ccard.gold .cic{background:linear-gradient(150deg,#E5B342,#C58A15);box-shadow:0 5px 14px rgba(229,179,66,.35)}
.ccard h4{font-family:'Archivo';font-weight:800;font-size:15.5px;color:var(--navy);line-height:1.2}
.ccard .cs{font-size:11px;color:var(--brand);font-weight:600;margin-top:2px}
.ccard .cmeta{display:flex;flex-wrap:wrap;gap:5px}
.emlchip{display:flex;align-items:center;gap:6px;background:rgba(43,124,201,.07);border:1px solid var(--ice);border-radius:8px;padding:4px 9px;margin-top:4px;font-family:'JetBrains Mono',monospace;font-size:9.5px;color:var(--blue);font-weight:600;overflow:hidden;flex-shrink:0}
.emlchip svg{font-size:12px;color:var(--brand);flex-shrink:0}
.emlchip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.emlchip.wrap{align-items:flex-start}
.emlchip.wrap span{white-space:normal;overflow-wrap:anywhere;text-overflow:clip;line-height:1.35}
.emlchip.sm{font-size:8.3px;padding:3px 7px;gap:4px}
.emlchip.sm svg{font-size:10px}
.emlchip .eml-l{color:var(--faint);font-weight:500;font-family:'Archivo';font-size:8.5px;letter-spacing:.04em;flex-shrink:0}
.ccard p{font-size:11.5px;color:var(--muted);line-height:1.45}
.ccard .clink{display:inline-flex;align-items:center;gap:5px;font-family:'Archivo';font-weight:700;font-size:10.5px;color:var(--brand);text-decoration:none;border:1px solid var(--line2);border-radius:999px;padding:3px 9px;background:#fff;transition:.14s}
.ccard .clink:hover{background:var(--brand);color:#fff;border-color:var(--brand)}
.ccard .clink .icn{font-size:12px}
.ccard .conf{position:absolute;right:12px;top:12px;font-family:'Archivo';font-weight:800;font-size:9.5px;padding:3px 8px;border-radius:5px}
.conf.hi{background:var(--goodbg);color:var(--good)}.conf.md{background:var(--warnbg);color:#B4841C}

/* insight callout */
.callout{border-radius:14px;padding:15px 18px;display:flex;gap:13px;align-items:flex-start;border-left:5px solid}
.callout.red{background:var(--badbg);border-color:var(--bad)}
.callout.amb{background:var(--warnbg);border-color:var(--warn)}
.callout.grn{background:var(--goodbg);border-color:var(--good)}
.callout.blu{background:#EAF1FA;border-color:var(--brand)}
.callout .coic{flex:none;margin-top:1px}
.callout .coic .icn{font-size:22px}
.callout.red .coic{color:var(--bad)}.callout.amb .coic{color:#B4841C}.callout.grn .coic{color:var(--good)}.callout.blu .coic{color:var(--brand)}
.callout h5{font-family:'Archivo';font-weight:800;font-size:13.5px;color:var(--navy);margin-bottom:3px}
.callout p{font-size:12px;color:#31465e;line-height:1.5}
.bg-navy .callout{background:rgba(255,255,255,.08)}
.bg-navy .callout h5{color:#fff}.bg-navy .callout p{color:#C7D8EC}

/* proof block */
.proof{background:#0D1B2A;border-radius:11px;padding:12px 15px;font-family:'JetBrains Mono';font-size:11px;color:#9FE8C4;line-height:1.7;overflow-x:auto;white-space:pre;border:1px solid #1d3049}
.proof b{color:#79B0E5;font-weight:600}
.proof .hi2{color:#FFD98A}

/* linkchip */
.lk{display:inline-flex;align-items:center;gap:5px;font-family:'Archivo';font-weight:700;font-size:11px;color:var(--brand);text-decoration:none;padding:3px 9px;border:1px solid var(--line2);border-radius:7px;background:#fff;transition:.14s}
.lk:hover{background:var(--brand);color:#fff;border-color:var(--brand);transform:translateY(-1px)}
.lk .icn{font-size:12px}
.modal .lk{margin:1px}

/* mini pill row */
.pills{display:flex;flex-wrap:wrap;gap:6px}
.pill{font-family:'Archivo';font-weight:700;font-size:10.5px;padding:4px 10px;border-radius:999px;background:var(--paper);border:1px solid var(--line);color:var(--navy)}
.pill.on{background:var(--navy);color:#fff;border-color:var(--navy)}
.pill.gd{background:var(--goodbg);color:var(--good);border-color:#BFE6D3}
.pill.bd{background:var(--badbg);color:var(--bad);border-color:#F3C9C6}
.bg-navy .pill{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.2);color:#fff}

/* vs split */
.vs{display:grid;grid-template-columns:1fr 74px 1fr;align-items:stretch;gap:0}
.vs .side{border-radius:18px;padding:22px 24px;display:flex;flex-direction:column;box-shadow:0 12px 34px rgba(10,47,92,.09);position:relative;overflow:hidden}
.vs .side.th{background:linear-gradient(155deg,#EAF3FD,#D9EAFB);border:1px solid #C6DEF5}
.vs .side.es{background:linear-gradient(155deg,#FDF3EC,#FAE6D6);border:1px solid #F2D9C0}
.vs .side .sh{display:flex;align-items:center;gap:11px;margin-bottom:14px}
.vs .side .sh img{width:44px;height:44px;border-radius:11px;object-fit:contain;background:#fff;padding:5px;border:1px solid rgba(0,0,0,.05);box-shadow:0 4px 12px rgba(10,47,92,.1)}
.vs .side .sh b{font-family:'Archivo';font-weight:900;font-size:21px;color:var(--navy);display:block;line-height:1.1}
.vs .side .sh small{font-size:11px;color:var(--muted)}
.vs .mid{display:flex;align-items:center;justify-content:center;position:relative}
.vs .mid .vsdot{width:56px;height:56px;border-radius:50%;background:var(--navy);color:#fff;font-family:'Archivo';font-weight:900;font-size:17px;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 26px rgba(10,47,92,.35);z-index:2}
.vs .mid::before{content:"";position:absolute;top:8%;bottom:8%;left:50%;width:2px;background:var(--line2)}

/* timeline discovery */
.disc{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;position:relative}
.disc-c{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px 18px;box-shadow:0 6px 18px rgba(10,47,92,.06);position:relative}
.disc-c .dh{font-family:'Archivo';font-weight:800;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--brand);display:flex;align-items:center;gap:7px;margin-bottom:9px}
.disc-c .dh .icn{font-size:15px}
.disc-c .dv{font-family:'JetBrains Mono';font-size:12px;color:var(--ink);line-height:1.75}
.disc-c .dv b{color:var(--navy)}
.disc-c.match{border:2px solid var(--good);background:linear-gradient(160deg,#fff,#F0FAF5)}

/* onboarding steps */
.obs{display:flex;flex-direction:column;gap:8px}
.ob{display:grid;grid-template-columns:44px 1fr 100px 118px;gap:12px;align-items:center;background:#fff;border:1px solid var(--line);border-radius:11px;padding:11px 15px;box-shadow:0 4px 12px rgba(10,47,92,.04)}
.ob.late{border-color:#F3C9C6;background:linear-gradient(100deg,#FEF4F3,#fff)}
.ob .obn{font-family:'Archivo';font-weight:900;font-size:16px;color:var(--ice)}
.ob.late .obn{color:var(--bad)}
.ob h5{font-family:'Archivo';font-weight:800;font-size:14px;color:var(--navy)}
.ob h5 small{display:block;font-family:'IBM Plex Sans Thai';font-weight:400;font-size:11px;color:var(--muted);margin-top:1px}
.ob .obd{font-family:'JetBrains Mono';font-size:11.5px;color:var(--muted);text-align:center}
.ob.late .obd{color:var(--bad);font-weight:600}

.mini-note{font-size:11px;color:var(--faint);margin-top:6px;display:flex;align-items:center;gap:6px}
.mini-note .icn{font-size:13px}
.bg-navy .mini-note{color:#8FA8C4}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--muted)}
.legend i{width:11px;height:11px;border-radius:3px;display:inline-block;margin-right:5px;vertical-align:-1px}
.bg-navy .legend{color:#B7C8DE}

/* ================= W28 FIX PACK ================= */

/* 1) แก้สีตัด — ตารางไฮไลต์บนพื้นน้ำเงิน */
.bg-navy .stable th{color:var(--sky);border-bottom-color:var(--sky)}
.bg-navy .stable td{color:#E4EEF9;border-bottom-color:rgba(255,255,255,.12)}
.bg-navy .stable td b{color:#fff}
.bg-navy .stable tr.hl td{background:rgba(121,176,229,.20);color:#fff;font-weight:600}
.bg-navy .stable tr:hover td{background:rgba(255,255,255,.07)}
.bg-navy .stable .mono{color:#B7C8DE}
.bg-navy .panel .stable tr.hl td{background:rgba(121,176,229,.20);color:#fff}

/* 2) ฟอนต์ไม่ห่าง — เลิกใช้ mono กับข้อความสั้นในชิป */
.div-svc .sv small{font-family:'IBM Plex Sans Thai',sans-serif;font-size:11.5px;letter-spacing:-.005em;font-weight:500;white-space:nowrap}
.svc-badge .co{letter-spacing:0}
.tile .tn,.ccard .cs{letter-spacing:0}
.mono{letter-spacing:-.03em}
.stable .mono,.modal .mono{letter-spacing:-.02em}
.proof{letter-spacing:-.02em}
.pill{letter-spacing:0}

/* 3) หน้าปก — ป้ายแนวตั้งไม่ทับหัวเรื่อง */
.cover .slide-inner{padding-left:9.4vw}
.cover .vtag{left:3.4vw}
.cover-title{font-size:clamp(40px,6vw,88px)}
.cover-meta{gap:30px;margin-top:32px}

/* 4) กันข้อความยาวดันกล่องแตก */
.proof{white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%}
.ccard p,.callout p,.tile .tn,.panel .li{overflow-wrap:anywhere}
.ccard{min-width:0}
.grid2>*,.grid3>*,.numgrid>*{min-width:0}
.stable td,.stable th{overflow-wrap:anywhere}

/* 5) ลดความหนาแน่นหน้าที่แน่น */
.slide-inner{padding:3.8vh 4.6vw}
.head{margin-bottom:1.6vh}
.head .h-sec{margin-top:10px}
.h-sec{font-size:clamp(20px,2.35vw,34px)}
.sub{font-size:clamp(11px,.92vw,13.5px);margin-top:6px;line-height:1.5}
.rule{margin-top:10px;height:3px;width:48px}
.kpi .val{font-size:34px;margin:6px 0 3px}
.kpi{padding:12px 15px}
.agenda{gap:9px}
.ag-row{padding:12px 18px}
.ag-row h4{font-size:15.5px}
.ag-row p{font-size:11.5px}
.ag-row .n{font-size:21px;min-width:34px}
.ag-row .agic{width:38px;height:38px}
.callout{padding:12px 15px}
.callout h5{font-size:12.5px}
.callout p{font-size:11.5px;line-height:1.45}
.panel{padding:18px 20px}
.panel h3{font-size:19px;margin:7px 0 11px}
.panel .li{font-size:12.5px;margin-bottom:9px}
.ccard{padding:14px 16px;gap:6px}
.ccard h4{font-size:14.5px}
.ccard p{font-size:11px;line-height:1.4}
.tile{padding:12px 14px}
.tile .tv{font-size:26px}
.vs .side{padding:18px 20px}
.vs .side .sh{margin-bottom:11px}
.vs .side .sh b{font-size:19px}
.numcard{padding:15px}
.numcard .big{font-size:28px}
.numcard p{font-size:11.5px}
.ms p{font-size:11.5px}
.ob{padding:9px 13px}
.ob h5{font-size:13px}
.disc-c{padding:13px 15px}
.disc-c .dv{font-size:11.5px;line-height:1.65}
.stable th{padding:6px 10px;font-size:10.5px}
.stable td{padding:5.5px 10px;font-size:12px}
.div-title{font-size:clamp(44px,6.4vw,92px)}
.div-sub{font-size:15px;margin-top:12px}
.div-svc{margin-top:26px;gap:10px}
.div-svc .sv{padding:10px 15px}
.ring-c .ringwrap,.ring-c svg{width:104px;height:104px}
.ring-num{font-size:23px}


/* 7) ROOT CAUSE ของข้อความซ้อนทับ — flex บีบลูกจนเนื้อหาล้นทับกัน */
.ccard>*{flex-shrink:0}
.panel>*{flex-shrink:0}
.panel>.chartbox{flex:1 1 auto;min-height:0}
.vs .side>*{flex-shrink:0}
.zone>*{flex-shrink:0}
.tile>*{flex-shrink:0}
.numcard>*{flex-shrink:0}
.disc-c>*{flex-shrink:0}
.callout>*{flex-shrink:0}
.callout>div:last-child{flex-shrink:1;min-width:0}
.slide-inner>.fill{min-height:0}

/* 8) การ์ดที่มีตาราง/proof ข้างในต้องไม่ถูกบีบ */
.ccard .stable,.ccard .proof,.ccard .grid2{flex-shrink:0}
.ccard .grid2{gap:.9vw}


/* 9) กระชับเพิ่มสำหรับหน้าที่เนื้อหาแน่นจัด */
#s30 .stable td,#s30 .stable th{padding:4px 7px;font-size:11px}
#s30 .callout p{font-size:10.5px}
#s21 .ccard p{font-size:10.5px}
#s21 .proof{font-size:9px;padding:7px 9px}
#s25 .ccard p{font-size:10.5px}
#s14 .ccard p{font-size:10.5px}
#s23 .stable td,#s23 .stable th{padding:4px 8px}
.numcard p{font-size:11px;line-height:1.35}
.chartbox{min-height:120px}


/* 10) โหมดกระชับสำหรับหน้าที่เนื้อหาสูงมาก — ลดระยะห่าง ไม่ลดเนื้อหา */
#s26 .slide-inner, #s26b .slide-inner{padding-top:3vh;padding-bottom:2.4vh}
#s26 .head, #s26b .head{margin-bottom:1vh}
#s26 .head .sub,#s26b .head .sub{font-size:11px;line-height:1.4;margin-top:5px;max-width:none}
#s26 .h-sec, #s26b .h-sec{font-size:clamp(18px,2.05vw,29px)}
#s26 .rule, #s26b .rule{margin-top:7px}
#s26 .grid2,#s26b .grid2{gap:1.7vw}
#s26 .ccard,#s26b .ccard{padding:12px 14px;gap:5px}
#s26 .panel,#s26b .panel{padding:14px 15px}
#s26 .callout,#s26b .callout{padding:9px 11px}
#s26 .callout h5,#s26b .callout h5{font-size:11.5px;margin-bottom:2px}
#s26 .callout p,#s26b .callout p{font-size:10.5px;line-height:1.4}
#s26 .stable td,#s26 .stable th,#s26b .stable td,#s26b .stable th{padding:3.5px 8px;font-size:11px}
#s26b .ob{padding:7px 11px;grid-template-columns:36px 1fr 84px 104px}
#s26b .ob h5{font-size:12px}
#s26b .ob h5 small{font-size:10px}
#s26b .obs{gap:6px}
#s26 .p-k,#s26b .p-k{font-size:11px}

/* หน้าปิดท้าย */

/* หน้าแผนงาน */


/* ================= หน้า 4 : การ์ดเปรียบเทียบระดับมืออาชีพ + ลูกเล่น ================= */
#s4 .vs .side{position:relative;border:none;box-shadow:0 18px 50px rgba(10,47,92,.14);overflow:hidden}
#s4 .vs .side.th{background:linear-gradient(158deg,#0E3A6B 0%,#164378 45%,#0A2F5C 100%)}
#s4 .vs .side.es{background:linear-gradient(158deg,#7A3E12 0%,#A9571B 45%,#6B3410 100%)}
/* แถบสีด้านบนการ์ด */
#s4 .vs .side::before{content:"";position:absolute;left:0;right:0;top:0;height:4px;z-index:3}
#s4 .vs .side.th::before{background:linear-gradient(90deg,#2B7CC9,#79B0E5,#2B7CC9);background-size:200% 100%;animation:shimmer 3.2s linear infinite}
#s4 .vs .side.es::before{background:linear-gradient(90deg,#E5B342,#FFD98A,#E5B342);background-size:200% 100%;animation:shimmer 3.2s linear infinite}
/* แสงเรืองมุมการ์ด */
#s4 .vs .side::after{content:"";position:absolute;width:280px;height:280px;border-radius:50%;filter:blur(60px);opacity:.4;right:-70px;top:-90px;pointer-events:none;animation:floaty 8s ease-in-out infinite}
#s4 .vs .side.th::after{background:#2B7CC9}
#s4 .vs .side.es::after{background:#E5B342}
#s4 .vs .side>*{position:relative;z-index:2}
#s4 .vs .side .sh b{color:#fff}
#s4 .vs .side .sh small{color:rgba(255,255,255,.62)}
#s4 .vs .side .sh img{background:#fff;box-shadow:0 6px 18px rgba(0,0,0,.3)}
/* กล่องตัวเลข */
#s4 .vs .tile{background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.16);backdrop-filter:blur(8px);box-shadow:none}
#s4 .vs .tile::before{background:rgba(255,255,255,.5)}
#s4 .vs .tile .tl{color:rgba(255,255,255,.72)}
#s4 .vs .tile .tl .icn{color:#fff}
#s4 .vs .tile .tv{color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.25)}
#s4 .vs .side.th .tile.wn::before{background:linear-gradient(180deg,#FFD98A,#E5B342)}
#s4 .vs .side.es .tile.gd::before{background:linear-gradient(180deg,#7BE8B0,#22A06B)}
/* callout ในการ์ด — โปร่งแสง อ่านง่าย */
#s4 .vs .callout{background:rgba(255,255,255,.10)!important;border-left-width:4px;backdrop-filter:blur(6px);transition:.2s}
#s4 .vs .callout:hover{background:rgba(255,255,255,.17)!important;transform:translateX(4px)}
#s4 .vs .callout h5{color:#fff}
#s4 .vs .callout p{color:rgba(255,255,255,.78)}
#s4 .vs .callout.bd,#s4 .vs .callout.red{border-color:#FF8A82}
#s4 .vs .callout.grn{border-color:#7BE8B0}
#s4 .vs .callout.red .coic,#s4 .vs .callout.bd .coic{color:#FF8A82}
#s4 .vs .callout.grn .coic{color:#7BE8B0}
/* ตรงกลาง VS — วงหมุน */
#s4 .vs .mid .vsdot{background:linear-gradient(140deg,#2B7CC9,#0A2F5C);border:2px solid rgba(255,255,255,.25);box-shadow:0 12px 34px rgba(43,124,201,.5)}
#s4 .vs .mid::after{content:"";position:absolute;width:88px;height:88px;border-radius:50%;border:2px dashed rgba(43,124,201,.45);animation:spin 14s linear infinite}
#s4 .vs .mid::before{background:linear-gradient(180deg,transparent,var(--line2),transparent)}


/* ================= หน้า 32 : การ์ดลูกค้าพร้อมโลโก้ + เส้นโยงขยับ ================= */
.leadrow{display:grid;grid-template-columns:repeat(3,1fr);gap:1.3vw;position:relative}
.leadline{position:absolute;top:-13px;left:4%;width:92%;height:4px;overflow:visible;z-index:0}
.leadline line{stroke:var(--sky);stroke-width:2.5;stroke-dasharray:9 7;opacity:.55;animation:dashmove 5s linear infinite}
.lead{position:relative;display:flex;gap:12px;align-items:flex-start;padding:13px 15px;border-radius:16px;
  background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(6px);
  box-shadow:0 8px 26px rgba(0,0,0,.22);transition:.2s;overflow:hidden}
.lead:hover{transform:translateY(-4px);background:rgba(255,255,255,.12);box-shadow:0 16px 38px rgba(0,0,0,.32)}
.lead::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;border-radius:16px 0 0 16px}
.lead.urgent::before{background:linear-gradient(180deg,#FF8A82,#D9544D)}
.lead.warn::before{background:linear-gradient(180deg,#FFD98A,#E5B342)}
.lead.gold::before{background:linear-gradient(180deg,#FFD98A,#C58A15)}
.lead.sky::before{background:linear-gradient(180deg,#9ECBF2,#2B7CC9)}
.lead.grn::before{background:linear-gradient(180deg,#7BE8B0,#22A06B)}
/* จุดหัวการ์ด — เชื่อมกับเส้นโยง */
.lead .knobtop{position:absolute;top:-19px;left:24px;width:12px;height:12px;border-radius:50%;background:#0A2F5C;z-index:2}
.lead-logo{width:56px;height:56px;border-radius:14px;background:#fff;flex:none;display:flex;align-items:center;justify-content:center;
  overflow:hidden;border:2px solid rgba(255,255,255,.85);box-shadow:0 6px 18px rgba(0,0,0,.3);position:relative}
.lead-logo img{width:100%;height:100%;object-fit:cover;display:block}
.lead-logo::after{content:"";position:absolute;inset:0;border-radius:12px;
  background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.5) 50%,transparent 70%);
  background-size:220% 100%;animation:shimmer 3.4s linear infinite;pointer-events:none}
.lead-body{min-width:0;flex:1}
.lead-nm{font-family:'Archivo';font-weight:800;font-size:14.5px;color:#fff;line-height:1.2;display:flex;flex-wrap:wrap;align-items:center;gap:7px}
.lead-tagline{font-family:'Archivo';font-weight:800;font-size:9px;letter-spacing:.05em;padding:2px 7px;border-radius:5px;
  background:rgba(229,179,66,.22);color:#FFD98A;border:1px solid rgba(229,179,66,.35)}
.lead-tagline.sky2{background:rgba(43,124,201,.25);color:#9ECBF2;border-color:rgba(121,176,229,.4)}
.lead-tagline.grn2{background:rgba(34,160,107,.22);color:#7BE8B0;border-color:rgba(123,232,176,.35)}
.lead-due{font-family:'Archivo';font-weight:700;font-size:10.5px;margin:4px 0 5px;display:flex;align-items:center;gap:5px}
.lead-due .icn{font-size:12px}
.lead-due.bad{color:#FF9E96}
.lead-due.warn2{color:#FFD98A}
.lead-tel{display:inline-flex;align-items:center;gap:5px;font-family:'JetBrains Mono';font-weight:600;font-size:10.5px;
  color:#DCE8F6;text-decoration:none;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.16);
  border-radius:999px;padding:2px 9px;margin:0 4px 4px 0;transition:.15s;letter-spacing:-.02em}
.lead-tel:hover{background:var(--sky);color:#062038;border-color:var(--sky)}
.lead-tel .icn{font-size:11px}
.lead-body p{font-size:10.5px;color:rgba(255,255,255,.76);line-height:1.45;margin-top:3px}
.lead-body p b{color:#fff}


/* ================= โลโก้ในการ์ดลูกค้าน่าสนใจ ================= */
.ccard .cic.logo{background:#fff;padding:0;overflow:hidden;position:relative;border:2px solid rgba(255,255,255,.9);
  box-shadow:0 6px 18px rgba(10,47,92,.22)}
.ccard .cic.logo img{width:100%;height:100%;object-fit:cover;display:block;border-radius:9px}
.ccard .cic.logo::after{content:"";position:absolute;inset:0;
  background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.55) 50%,transparent 70%);
  background-size:220% 100%;animation:shimmer 3.6s linear infinite;pointer-events:none}
/* กรอบการ์ดลูกค้า — โค้งมนขึ้น + เส้นขอบเรืองแสงตอน hover */
.ccard{border-radius:18px}
.ccard::after{content:"";position:absolute;inset:0;border-radius:18px;pointer-events:none;
  border:1.5px solid transparent;transition:.25s}
.ccard:hover::after{border-color:rgba(43,124,201,.45);box-shadow:inset 0 0 22px rgba(43,124,201,.12)}
.ccard.gold:hover::after{border-color:rgba(229,179,66,.5);box-shadow:inset 0 0 22px rgba(229,179,66,.14)}
/* เส้นโยงขยับเหนือแถวการ์ดลูกค้า */
.leadconn{position:absolute;left:2%;right:2%;top:-10px;height:3px;overflow:visible;z-index:0;pointer-events:none}
.leadconn line{stroke:var(--brand);stroke-width:2.5;stroke-dasharray:9 7;opacity:.4;animation:dashmove 5.5s linear infinite}

/* 6) SAFETY NET — auto-fit กันล้นทุกหน้า */
.slide-inner{overflow:hidden}
.fitwrap{width:100%;transform-origin:top center;will-change:transform}

/* ============ MONITOR CHAT (mc1 / mc2) ============ */
#mc1 .slide-inner{padding-top:3.2vh;padding-bottom:2.2vh;justify-content:flex-start}
#mc2 .slide-inner{padding-top:3.2vh;padding-bottom:2.2vh;justify-content:center}
#mc1 .h-sec,#mc2 .h-sec{font-size:clamp(18px,2.05vw,29px)}
#mc1 .rule,#mc2 .rule{margin-top:6px}
.mc-stats{display:flex;gap:7px;flex-wrap:wrap;margin:.9vh 0 1.3vh}
.mc-stat{display:flex;align-items:center;gap:7px;background:#fff;border:1px solid var(--line);border-radius:9px;padding:5px 11px;box-shadow:0 3px 10px rgba(10,47,92,.05)}
.mc-stat .icn{font-size:14px;color:var(--brand);flex-shrink:0}
.mc-stat b{font-family:'Archivo';font-weight:800;font-size:13px;color:var(--navy)}
.mc-stat span{font-size:10.5px;color:var(--muted)}
.mc-sec{font-family:'Archivo';font-weight:800;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--brand);display:flex;align-items:center;gap:7px;margin-bottom:.7vh}
.mc-sec .icn{font-size:14px}
.mc-sec i{font-style:normal;color:var(--faint);font-family:'IBM Plex Sans Thai';font-weight:500;letter-spacing:0;text-transform:none;font-size:10.5px}
.mc-a{display:grid;grid-template-columns:repeat(4,1fr);gap:.85vw}
.mc-tile{background:#fff;border:1px solid var(--line);border-radius:13px;padding:11px 13px;box-shadow:0 5px 16px rgba(10,47,92,.05);position:relative;overflow:hidden;display:flex;gap:10px;align-items:flex-start}
.mc-tile .ti{width:31px;height:31px;border-radius:9px;background:linear-gradient(150deg,var(--brand),var(--blue));display:flex;align-items:center;justify-content:center;flex-shrink:0}
.mc-tile .ti .icn{font-size:16px;color:#fff}
.mc-tile h5{font-family:'Archivo','IBM Plex Sans Thai',sans-serif;font-weight:700;font-size:12.5px;color:var(--navy);margin-bottom:2px}
.mc-tile p{font-size:10px;color:var(--muted);line-height:1.4}
.mc-step{display:flex;gap:9px;align-items:flex-start;padding:6px 0;border-bottom:1px dashed var(--line)}
.mc-step:last-child{border-bottom:none}
.mc-step .sn{width:21px;height:21px;border-radius:6px;background:var(--navy);color:#fff;font-family:'Archivo';font-weight:800;font-size:10.5px;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.mc-step h6{font-family:'Archivo','IBM Plex Sans Thai',sans-serif;font-weight:700;font-size:11.5px;color:var(--navy);margin-bottom:1px}
.mc-step p{font-size:10px;color:var(--muted);line-height:1.4}
.mc-kb{background:linear-gradient(160deg,#FFF9EC,#FFFDF8);border:1.5px solid #F0D9A4;border-radius:14px;padding:13px 15px;box-shadow:0 6px 20px rgba(227,169,60,.13)}
.mc-kb .mc-sec{color:var(--gold)}
.mc-layer{display:flex;gap:8px;align-items:flex-start;padding:5px 0}
.mc-layer .ln{width:19px;height:19px;border-radius:5px;background:var(--gold);color:#fff;font-family:'Archivo';font-weight:800;font-size:9.5px;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.mc-layer p{font-size:10px;color:var(--muted);line-height:1.4}
.mc-layer p b{color:var(--navy)}
.mc-cmd{background:#0D1B2A;border:1px solid #1d3049;border-radius:12px;padding:11px 13px}
.mc-cmd .mc-sec{color:var(--sky)}
.mc-cmd .cl{display:flex;gap:8px;align-items:flex-start;padding:3.5px 0}
.mc-cmd .cq{font-family:'JetBrains Mono',monospace;font-size:9.5px;color:#9FE8C4;background:rgba(159,232,196,.09);border-radius:5px;padding:2px 6px;white-space:nowrap;flex-shrink:0}
.mc-cmd .cd{font-size:9.5px;color:#8FA6C0;line-height:1.4}
.mc-res{display:grid;grid-template-columns:repeat(4,1fr);gap:.7vw;margin-top:1.1vh}
.mc-r{display:flex;align-items:center;gap:8px;background:var(--goodbg,#E8F7F0);border:1px solid rgba(34,160,107,.25);border-radius:10px;padding:8px 11px}
.mc-r .icn{font-size:15px;color:var(--good);flex-shrink:0}
.mc-r b{font-family:'Archivo','IBM Plex Sans Thai',sans-serif;font-weight:700;font-size:11.5px;color:var(--navy);display:block}
.mc-r span{font-size:9.5px;color:var(--muted)}
.mc-note{display:flex;gap:8px;align-items:flex-start;background:rgba(43,124,201,.06);border-left:3px solid var(--brand);border-radius:0 8px 8px 0;padding:7px 10px;margin-top:5px}
.mc-note .icn{font-size:14px;color:var(--brand);flex-shrink:0;margin-top:1px}
.mc-note p{font-size:9.8px;color:var(--muted);line-height:1.45}
.mc-note p b{color:var(--navy)}

/* ---- mc2 flow ---- */
.mc-flow{display:grid;grid-template-columns:1.22fr 26px .82fr 26px .92fr 26px 1.3fr 26px .92fr 26px 1.15fr;align-items:stretch;gap:0;margin-top:.4vh}
.mc-node{background:#fff;border:1px solid var(--line);border-radius:13px;padding:11px 12px;box-shadow:0 6px 18px rgba(10,47,92,.06);display:flex;flex-direction:column;gap:5px;position:relative;min-width:0}
.mc-node.dark{background:linear-gradient(160deg,#15437A,#0A2F5C);border-color:#1d3049;box-shadow:0 8px 24px rgba(10,47,92,.22)}
.mc-node.dark h5,.mc-node.dark .nn{color:#fff}
.mc-node.dark p{color:#B7C8DE}
.mc-node.dark .ni{background:rgba(255,255,255,.14)}
.mc-node .nh{display:flex;align-items:center;gap:8px}
.mc-node .ni{width:28px;height:28px;border-radius:8px;background:linear-gradient(150deg,var(--brand),var(--blue));display:flex;align-items:center;justify-content:center;flex-shrink:0}
.mc-node .ni .icn{font-size:15px;color:#fff}
.mc-node .nn{font-family:'Archivo';font-weight:800;font-size:9px;letter-spacing:.08em;color:var(--faint);text-transform:uppercase}
.mc-node h5{font-family:'Archivo','IBM Plex Sans Thai',sans-serif;font-weight:700;font-size:12.5px;color:var(--navy);line-height:1.2}
.mc-node p{font-size:9.5px;color:var(--muted);line-height:1.42}
.mc-node p b{color:var(--navy)}
.mc-node.dark p b{color:var(--sky)}
.mc-arrow{display:flex;align-items:center;justify-content:center;color:var(--brand);position:relative}
.mc-arrow::before{content:"";position:absolute;left:0;right:0;top:50%;height:2px;background:repeating-linear-gradient(90deg,var(--sky) 0 5px,transparent 5px 10px);opacity:.75;animation:dashmove 4.5s linear infinite}
.mc-arrow .icn{font-size:17px;position:relative;z-index:2;background:var(--paper);border-radius:50%;padding:1px;stroke-width:2.6}
.mc-plat{display:flex;flex-direction:column;gap:4px;margin-top:2px}
.mc-plat .pf{display:flex;align-items:center;gap:6px;background:var(--paper);border:1px solid var(--line);border-radius:7px;padding:4px 7px}
.mc-plat .pf .icn{font-size:12px;color:var(--brand);flex-shrink:0}
.mc-plat .pf b{font-family:'Archivo';font-weight:800;font-size:10px;color:var(--navy)}
.mc-plat .pf span{font-size:8.8px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-cond{display:flex;gap:6px;align-items:flex-start;background:#FFF6F5;border:1px solid rgba(217,84,77,.22);border-radius:7px;padding:5px 7px}
.mc-cond.amb{background:#FFFBF0;border-color:rgba(227,169,60,.3)}
.mc-cond .icn{font-size:12px;color:var(--bad);flex-shrink:0;margin-top:1px}
.mc-cond.amb .icn{color:var(--gold)}
.mc-cond p{font-size:9.3px;line-height:1.35}
.mc-topic{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16);border-radius:7px;padding:3.5px 7px}
.mc-topic .icn{font-size:11px;color:var(--sky);flex-shrink:0}
.mc-topic span{font-size:9.3px;color:#D7E4F2}
.mc-topic.warn{background:rgba(227,169,60,.16);border-color:rgba(227,169,60,.35)}
.mc-topic.warn .icn{color:var(--gold)}
.mc-flow{align-items:start}
.mc-flow>.mc-node{height:100%}
.mc-node{justify-content:flex-start}
/* แถวล่าง: ใช้ grid คอลัมน์ชุดเดียวกับ .mc-flow → ลูกศรจะตรงกับกล่องที่มันชี้จริง */
.mc-loop{display:grid;grid-template-columns:1.22fr 26px .82fr 26px .92fr 26px 1.3fr 26px .92fr 26px 1.15fr;align-items:start;margin-top:1.1vh}
.mc-up{display:flex;flex-direction:column;align-items:center;gap:1px;padding-bottom:2px}
.mc-upline{width:0;height:14px;border-left:2px dashed var(--gold);opacity:.85}
.mc-up .icn{font-size:15px;color:var(--gold);transform:rotate(-90deg);margin-top:-3px}
.mc-uplbl{font-family:'Archivo','IBM Plex Sans Thai',sans-serif;font-weight:700;font-size:8.5px;color:var(--gold);text-align:center;line-height:1.2;margin-top:1px}
.mc-kbfeed{background:linear-gradient(150deg,#FFFBF0,#FFFDF9);border:1.5px dashed #E3A93C;border-radius:12px;padding:10px 12px;display:flex;gap:9px;align-items:flex-start}
.mc-kbfeed>.icn{font-size:17px;color:var(--gold);flex-shrink:0;margin-top:1px}
.mc-kbfeed b{font-family:'Archivo','IBM Plex Sans Thai',sans-serif;font-weight:700;font-size:10.5px;color:var(--navy);display:block;margin-bottom:2px}
.mc-kbl{display:flex;align-items:center;gap:5px;font-size:9px;color:var(--muted);padding:1px 0}
.mc-kbl i{font-style:normal;width:13px;height:13px;border-radius:4px;background:var(--gold);color:#fff;font-family:'Archivo';font-weight:800;font-size:7.5px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.mc-loopbox{background:linear-gradient(150deg,#FFFBF0,#FFFDF9);border:1.5px dashed #E3A93C;border-radius:12px;padding:10px 12px;display:flex;gap:9px;align-items:flex-start}
.mc-loopbox>.li2{width:26px;height:26px;border-radius:7px;background:var(--gold);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.mc-loopbox>.li2 .icn{font-size:14px;color:#fff}
.mc-loopbox h6{font-family:'Archivo','IBM Plex Sans Thai',sans-serif;font-weight:700;font-size:10.5px;color:var(--navy);margin-bottom:3px}
.mc-loopbox .cmdl{display:flex;align-items:center;gap:6px;padding:1.5px 0}
.mc-loopbox .cq2{font-family:'JetBrains Mono',monospace;font-size:8.5px;color:var(--navy);background:rgba(227,169,60,.16);border-radius:4px;padding:1.5px 5px;white-space:nowrap}
.mc-loopbox .cd2{font-size:8.8px;color:var(--muted)}
.mc-legend{display:flex;flex-direction:column;gap:5px;padding-top:2px}
.mc-lg{display:flex;align-items:center;gap:7px;font-size:9px;color:var(--muted)}
.mc-lg .sw{width:22px;height:0;border-top:2px dashed var(--gold);flex-shrink:0}
.mc-lg .sw.blue{border-top:2px dashed var(--sky)}
.mc-lg b{color:var(--navy);font-weight:700}
.mc-admin{display:flex;align-items:center;gap:9px;margin-top:1.2vh;background:#fff;border:1px solid var(--line);border-radius:11px;padding:8px 13px;box-shadow:0 4px 14px rgba(10,47,92,.05)}
.mc-admin .lbl{font-family:'Archivo';font-weight:800;font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--faint);flex-shrink:0}
.mc-admin .ac{display:flex;align-items:center;gap:6px;background:var(--paper);border:1px solid var(--line);border-radius:20px;padding:4px 11px}
.mc-admin .ac .icn{font-size:12px;color:var(--good)}
.mc-admin .ac span{font-size:10px;color:var(--navy);font-weight:600}

/* ============ BACKSTAGE SYSTEMS (ex/af/rf) — reuse mc-* + extras ============ */
.sysbadge{display:inline-flex;align-items:center;gap:9px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:6px 14px 6px 7px;box-shadow:0 4px 14px rgba(10,47,92,.06);margin-bottom:8px}
.sysbadge .si{width:31px;height:31px;border-radius:8px;background:linear-gradient(150deg,var(--brand),var(--blue));display:flex;align-items:center;justify-content:center;flex-shrink:0}
.sysbadge .si .icn{font-size:16px;color:#fff}
.sysbadge .st{line-height:1.1}
.sysbadge .st b{font-family:'Archivo','IBM Plex Sans Thai',sans-serif;font-weight:800;font-size:14px;color:var(--navy);display:block}
.sysbadge .st span{font-family:'Archivo';font-weight:700;font-size:8.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--faint)}
.sysbadge .stp{margin-left:6px;font-family:'Archivo';font-weight:800;font-size:10px;letter-spacing:.02em;padding:3px 9px;border-radius:20px;background:var(--paper);border:1px solid var(--line);color:var(--muted)}
/* หัวข้อโซน/แทร็ก */
.zlabel{display:inline-flex;align-items:center;gap:7px;font-family:'Archivo','IBM Plex Sans Thai',sans-serif;font-weight:800;font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:3px 11px;border-radius:20px;margin-bottom:6px}
.zlabel .icn{font-size:13px}
.zlabel.blue{background:var(--ice);color:var(--blue)}
.zlabel.dark{background:rgba(255,255,255,.16);color:#fff}
.zlabel.gold{background:#FBEFD3;color:#9A6B12}
.zlabel.green{background:var(--goodbg,#E8F7F0);color:var(--good)}
/* flow แถวยืดหยุ่น (ไม่แตะ .mc-flow เดิม) */
.flowrow{display:flex;align-items:stretch}
.flowrow>.mc-node{flex:1 1 0;min-width:0}
.flowrow>.mc-arrow{flex:0 0 26px}
.mc-zone{border:1.5px solid var(--ice);border-radius:15px;padding:11px 13px;background:linear-gradient(165deg,#F6FAFF,#fff)}
.mc-zone.dark{background:linear-gradient(160deg,#15437A,#0A2F5C);border-color:#1d3049}
.mc-zone.dark .mc-node{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.14)}
.mc-zone.dark .mc-node h5{color:#fff}.mc-zone.dark .mc-node p{color:#C7D8EC}
.mc-zone.dark .mc-node .nn{color:var(--sky)}
.mc-zone.dark .mc-node .ni{background:rgba(255,255,255,.16)}
.mc-zone.dark .mc-arrow{color:var(--sky)}
.mc-zone.dark .mc-arrow .icn{background:#123E72}
.mc-zone.dark .mc-arrow::before{background:repeating-linear-gradient(90deg,var(--sky) 0 5px,transparent 5px 10px)}
/* จุดตัดสินใจ (ยืนยัน) */
.mc-dec{display:flex;align-items:center;gap:13px;background:#FFFBF0;border:1.5px dashed var(--gold);border-radius:13px;padding:9px 15px;margin:1vh 0}
.mc-dec .di{width:32px;height:32px;transform:rotate(45deg);background:var(--gold);border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 12px rgba(227,169,60,.3)}
.mc-dec .di .icn{transform:rotate(-45deg);font-size:16px;color:#fff}
.mc-dec h6{font-family:'Archivo','IBM Plex Sans Thai',sans-serif;font-weight:700;font-size:12px;color:var(--navy)}
.mc-dec .opts{display:flex;gap:8px;margin-left:auto;flex-wrap:wrap}
.mc-dec .opt{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:600;padding:4px 11px;border-radius:20px;white-space:nowrap}
.mc-dec .opt.no{background:#FDECEA;color:var(--bad)}
.mc-dec .opt.yes{background:var(--goodbg,#E8F7F0);color:var(--good)}
.mc-dec .opt .icn{font-size:12px}
/* ลูกศรลง (ระหว่างโซน) */
.mc-vdown{display:flex;justify-content:center;align-items:center;gap:9px;color:var(--gold);padding:3px 0}
.mc-vdown .icn{font-size:18px;transform:rotate(90deg)}
.mc-vdown span{font-family:'Archivo','IBM Plex Sans Thai',sans-serif;font-weight:700;font-size:9.5px;color:var(--muted)}
/* ตารางเทียบ 3 แหล่ง / คอลัมน์ */
.srctbl{width:100%;border-collapse:collapse;font-size:10.5px}
.srctbl th{font-family:'Archivo','IBM Plex Sans Thai',sans-serif;font-weight:700;font-size:10px;color:var(--faint);text-align:left;padding:5px 8px;border-bottom:1.5px solid var(--line);text-transform:uppercase;letter-spacing:.03em}
.srctbl td{padding:6px 8px;border-bottom:1px solid var(--line);color:var(--muted);vertical-align:top;line-height:1.4}
.srctbl tr:last-child td{border-bottom:none}
.srctbl .sname{font-weight:700;color:var(--navy);white-space:nowrap}
.srctbl .auth{display:inline-block;font-family:'Archivo';font-weight:800;font-size:9px;padding:2px 7px;border-radius:5px;background:var(--ice);color:var(--blue);white-space:nowrap}
.srctbl .auth.gold{background:#FBEFD3;color:#9A6B12}
/* กลุ่มไอคอนตัวเลข (5 กลุ่ม / ทีละแถว) */
.mc-chk{display:flex;align-items:center;gap:9px;background:#fff;border:1px solid var(--line);border-radius:11px;padding:9px 12px;box-shadow:0 4px 12px rgba(10,47,92,.04)}
.mc-chk .ci{width:30px;height:30px;border-radius:8px;background:var(--ice);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.mc-chk .ci .icn{font-size:15px;color:var(--blue)}
.mc-chk b{font-family:'Archivo','IBM Plex Sans Thai',sans-serif;font-weight:700;font-size:12px;color:var(--navy);display:block}
.mc-chk span{font-size:9.5px;color:var(--muted)}
.mc-chk .pct{margin-left:auto;font-family:'Archivo';font-weight:800;font-size:15px;color:var(--brand);flex-shrink:0}
/* ป้าย ✅/❌ เป็นจุดสี ไม่ใช่อิโมจิ */
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot.g{background:var(--good)}.dot.r{background:var(--bad)}.dot.y{background:var(--gold)}
/* แถบ blur ข้อมูลอ่อนไหว */
.blurpill{display:inline-flex;align-items:center;gap:5px;background:repeating-linear-gradient(90deg,#DDE7F2 0 6px,#E9F0F8 6px 12px);border:1px solid var(--line);border-radius:6px;padding:2px 9px;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--faint);letter-spacing:.1em}
.blurpill .icn{font-size:11px;color:var(--muted)}
/* กล่องเซ็น 2 ชั้น */
.signrow{display:flex;align-items:stretch;gap:0;margin-top:.4vh}
.signbox{flex:1;background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px 12px;text-align:center;box-shadow:0 4px 12px rgba(10,47,92,.05);position:relative}
.signbox .snum{font-family:'Archivo';font-weight:800;font-size:9px;letter-spacing:.08em;color:var(--faint);text-transform:uppercase}
.signbox .sicon{width:32px;height:32px;border-radius:9px;margin:5px auto 6px;display:flex;align-items:center;justify-content:center}
.signbox .sicon.g{background:var(--goodbg,#E8F7F0)}.signbox .sicon.g .icn{color:var(--good)}
.signbox .sicon.gold{background:#FBEFD3}.signbox .sicon.gold .icn{color:var(--gold)}
.signbox .sicon.b{background:var(--ice)}.signbox .sicon.b .icn{color:var(--blue)}
.signbox h6{font-family:'Archivo','IBM Plex Sans Thai',sans-serif;font-weight:700;font-size:11.5px;color:var(--navy);margin-bottom:2px}
.signbox p{font-size:9px;color:var(--muted);line-height:1.35}
.signbox .sicon .icn{font-size:17px}
.signarr{flex:0 0 30px;display:flex;align-items:center;justify-content:center;color:var(--gold)}
.signarr .icn{font-size:17px}


.cover .slide-inner,.divider-slide .slide-inner{overflow:visible}
`;

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
