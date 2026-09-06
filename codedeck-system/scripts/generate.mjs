#!/usr/bin/env node
// codedeck-system: generate - render system-map.html from system-facts.json.
// Required: --facts <system-facts.json>
// Optional: --analyses <dir> (per-service <name>/codedeck-analysis.json for the
//           drill-down detail) and repo git history for the growth tab.
// Output: a single self-contained system-map.html.
//
// Usage: node generate.mjs --facts facts.json [--analyses analysesDir] \
//         [--fleet-label "Name"] [--out system-map.html]

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';

const exec = promisify(execFile);

function parseArgs(argv) {
  const a = { facts: null, analyses: null, label: null, out: 'system-map.html' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--facts' && argv[i + 1]) a.facts = argv[i + 1];
    if (argv[i] === '--analyses' && argv[i + 1]) a.analyses = argv[i + 1];
    if (argv[i] === '--fleet-label' && argv[i + 1]) a.label = argv[i + 1];
    if (argv[i] === '--out' && argv[i + 1]) a.out = argv[i + 1];
  }
  if (!a.facts) throw new Error('usage: node generate.mjs --facts <system-facts.json> [--analyses dir] [--out system-map.html]');
  return a;
}

function compactAnalysis(snap) {
  if (!snap) return null;
  return {
    grade: snap.grade ?? null, score: snap.score ?? null, files: snap.files ?? null,
    loc: snap.loc ?? null, functions: snap.functions ?? null, connections: snap.connections ?? null,
    deadPct: snap.deadPct ?? null, godObjects: snap.godObjects ?? null,
    topBlast: snap.topBlast ? { path: snap.topBlast.path, total: snap.topBlast.total } : null,
    topLanguages: snap.topLanguages ?? []
  };
}

async function loadAnalyses(analysesDir, names) {
  const out = {};
  if (!analysesDir) return out;
  for (const name of names) {
    try {
      const p = join(resolve(analysesDir), name, 'codedeck-analysis.json');
      const r = JSON.parse(await readFile(p, 'utf8'));
      // largest files by lines from data.files
      const files = (r.data?.files || []).slice().sort((a, b) => (b.lines || 0) - (a.lines || 0)).slice(0, 6)
        .map((f) => ({ path: f.path, lines: f.lines }));
      out[name] = { ...compactAnalysis(r.snapshot), bigFiles: files };
    } catch { /* no analysis for this service */ }
  }
  return out;
}

async function gitGrowth(services) {
  const out = {};
  for (const s of services) {
    try {
      const { stdout: count } = await exec('git', ['rev-list', '--count', 'HEAD'], { cwd: s.repo });
      const { stdout: first } = await exec('git', ['log', '--reverse', '--format=%ad', '--date=short'], { cwd: s.repo });
      const { stdout: last } = await exec('git', ['log', '-1', '--format=%ad', '--date=short'], { cwd: s.repo });
      const { stdout: contrib } = await exec('git', ['shortlog', '-sn', 'HEAD'], { cwd: s.repo });
      out[s.name] = {
        commits: parseInt(count.trim(), 10) || 0,
        firstCommit: first.trim().split('\n')[0] || null,
        lastCommit: last.trim() || null,
        contributors: contrib.trim() ? contrib.trim().split('\n').length : 0
      };
    } catch { out[s.name] = null; }
  }
  return out;
}

async function main() {
  const a = parseArgs(process.argv);
  const facts = JSON.parse(await readFile(resolve(a.facts), 'utf8'));
  const serviceNames = (facts.services || []).map((s) => s.name);
  const analyses = await loadAnalyses(a.analyses, serviceNames);
  const growth = await gitGrowth(facts.services || []).catch(() => ({}));

  const data = {
    generated_at: new Date().toISOString(),
    fleet_label: a.label || resolve(a.facts).split('/').filter(Boolean).slice(-2)[0] || 'system',
    runtime_source: facts.runtime_source,
    windowMinutes: facts.windowMinutes,
    services: facts.services || [],
    runtimeOnly: facts.runtimeOnly || [],
    edges: facts.edges || [],
    classification: facts.classification || { confirmed: [], staticOnly: [], runtimeOnly: [] },
    orphans: facts.orphans || [],
    external: facts.external || [],
    analyses, growth
  };

  const html = renderHtml(data);
  await writeFile(resolve(a.out), html);
  process.stdout.write('[codedeck-system] wrote ' + a.out + ' (' + (html.length / 1024).toFixed(0) + ' KB)\n');
}

// ---------------- HTML rendering ----------------
function renderHtml(data) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Embed data as a JS literal; escape '<' so a repo/service name can never
  // close the script tag early.
  const jsonStr = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>System Map — ${esc(data.fleet_label)}</title><style>
:root{--bg:#0d1117;--panel:#151b23;--panel2:#1c2530;--line:#2a3542;--text:#e6ebf2;--muted:#96a2b0;
 --accent:#7aa2ff;--good:#4fd18b;--warn:#e6b450;--bad:#e06c75;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);
 font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1120px;margin:0 auto;padding:24px 20px 80px}
header h1{margin:0;font-size:24px}.sub{color:var(--muted);font-size:13px}
.badges{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
.badge{background:var(--panel2);border:1px solid var(--line);border-radius:20px;padding:2px 10px;font-size:12px;color:var(--muted)}
.badge b{color:var(--text)}
nav{position:sticky;top:0;background:var(--bg);padding:10px 0;display:flex;gap:6px;flex-wrap:wrap;z-index:5}
nav button{background:transparent;border:1px solid transparent;color:var(--muted);padding:7px 13px;border-radius:8px;cursor:pointer;font-size:14px}
nav button.active{background:var(--panel2);color:var(--text);border-color:var(--line)}
section{display:none;margin-top:10px}section.active{display:block;animation:fade .2s}
@keyframes fade{from{opacity:0;transform:translateY(3px)}to{opacity:1}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin:14px 0}
h2{font-size:17px;margin:0 0 2px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:12px}
.stat{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:11px}
.stat .v{font-size:22px;font-weight:700;font-family:var(--mono)}.stat .k{color:var(--muted);font-size:12px}
.tag{display:inline-block;font-size:11px;padding:1px 8px;border-radius:20px;margin-left:6px;vertical-align:2px;white-space:nowrap}
.good{background:rgba(79,209,139,.15);color:var(--good)}.warn{background:rgba(230,180,80,.15);color:var(--warn)}
.bad{background:rgba(224,108,117,.16);color:var(--bad)}.mid{background:rgba(122,162,255,.15);color:var(--accent)}
.row{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:7px 2px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.row:last-child{border-bottom:0}.mono{font-family:var(--mono);font-size:12px}
.file{font-family:var(--mono);font-size:12px;color:var(--accent);word-break:break-all}
.svc-card{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px;margin:10px 0}
.svc-card h3{margin:0;font-size:15px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.metric{display:flex;flex-wrap:wrap;gap:14px;margin-top:8px;color:var(--muted);font-size:12.5px}
.metric b{color:var(--text);font-family:var(--mono);font-weight:600}
details{border:1px solid var(--line);border-radius:8px;margin:6px 0;background:var(--panel)}
summary{cursor:pointer;padding:8px 12px;font-family:var(--mono);font-size:12.5px}
details .inner{padding:2px 12px 12px;color:var(--muted);font-size:13px}
svg{width:100%;height:auto;background:var(--panel2);border:1px solid var(--line);border-radius:10px}
.legend{display:flex;gap:14px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin-top:8px}
.legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px}
footer{color:var(--muted);font-size:12px;margin-top:26px;text-align:center}
@media print{nav{display:none}}
</style></head><body><div class="wrap">
<header><h1>${esc(data.fleet_label)} <span id="hdrBadge"></span></h1>
<div class="badges" id="hdrBadges"></div></header>
<nav>
 <button data-tab="overview" class="active">Overview</button>
 <button data-tab="topology">Topology</button>
 <button data-tab="inventory">Services</button>
 <button data-tab="risk">Cross-service risk</button>
 <button data-tab="growth">Growth</button>
 <button data-tab="detail">Drill-down</button>
</nav>
<section id="tab-overview" class="active"></section>
<section id="tab-topology"></section>
<section id="tab-inventory"></section>
<section id="tab-risk"></section>
<section id="tab-growth"></section>
<section id="tab-detail"></section>
<footer>codedeck-system &middot; static facts (CodeFlow + edge scan) + runtime facts (New Relic) &middot; generated <span id="genTime"></span></footer>
</div>
<script>
const DATA=${jsonStr};
const $=id=>document.getElementById(id);
const fmt=n=>n==null?'–':Number.isInteger(n)?n.toLocaleString():n;
const gradeClass=g=>g==='A'?'good':g==='B'?'warn':'bad';
const healthColor=v=>!v?{}:{c:v.errorRatePct>=8||v.apdex<0.6?'var(--bad)':v.errorRatePct>=3||v.apdex<0.85?'var(--warn)':'var(--good)'};
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function nodeDot(n,edges){return {in:edges.filter(e=>e.target===n).length,out:edges.filter(e=>e.source===n).length}}

// header
(function(){
 const svcs=(DATA.services||[]).filter(s=>s.vitals);
 const deg=svcs.filter(s=>s.vitals.errorRatePct>=8||s.vitals.apdex<0.6).length;
 $('hdrBadge').innerHTML='<span class="tag mid">runtime: '+(DATA.runtime_source||'off')+'</span>';
 $('hdrBadges').innerHTML=
  '<span class="badge"><b>'+(DATA.services||[]).length+'</b> repos analyzed</span>'+
  '<span class="badge"><b>'+svcs.length+'</b> live in New Relic</span>'+
  '<span class="badge"><b>'+(DATA.edges||[]).length+'</b> cross-service edges</span>'+
  (deg?'<span class="badge"><b style="color:var(--bad)">'+deg+'</b> degrading</span>':'')+
  '<span class="badge">window '+(DATA.windowMinutes||'-')+'m</span>';
})();

// overview
(function(){const d=DATA;
 const svcs=d.services||[], ro=d.runtimeOnly||[], ed=d.edges||[];
 const withLive=svcs.filter(s=>s.vitals).length;
 const confirmed=d.classification.confirmed.length, sonly=d.classification.staticOnly.length, ronly=d.classification.runtimeOnly.length;
 const gA=svcs.filter(s=>s.staticHealth&&s.staticHealth.grade==='A').length;
 const gB=svcs.filter(s=>s.staticHealth&&s.staticHealth.grade==='B').length;
 const gOther=svcs.filter(s=>s.staticHealth&&s.staticHealth.grade&&s.staticHealth.grade!=='A'&&s.staticHealth.grade!=='B').length;
 const deg=svcs.filter(s=>s.vitals&&(s.vitals.errorRatePct>=8||s.vitals.apdex<0.6));
 let html='<div class="card"><h2>Fleet overview</h2><p class="sub">A folder of independent service repos, reconciled against production. '+d.runtime_source+'</p>';
 html+='<div class="grid">';
 html+='<div class="stat"><div class="v">'+svcs.length+'</div><div class="k">repos / services</div></div>';
 html+='<div class="stat"><div class="v">'+withLive+'/'+svcs.length+'</div><div class="k">live in New Relic</div></div>';
 html+='<div class="stat"><div class="v">'+ed.length+'</div><div class="k">cross-service edges</div></div>';
 html+='<div class="stat"><div class="v">'+ro.length+'</div><div class="k">runtime-only services</div></div>';
 html+='<div class="stat"><div class="v" style="color:var(--good)">'+confirmed+'</div><div class="k">edges confirmed</div></div>';
 html+='<div class="stat"><div class="v" style="color:var(--warn)">'+sonly+'</div><div class="k">static-only edges</div></div>';
 html+='<div class="stat"><div class="v" style="color:var(--bad)">'+ronly+'</div><div class="k">runtime-only edges</div></div>';
 html+='<div class="stat"><div class="v">'+fmt(d.orphans.length)+'</div><div class="k">orphan topics</div></div>';
 html+='</div></div>';
 html+='<div class="card"><h2>Static health mix <span class="sub">CodeFlow grade per repo</span></h2>';
 html+='<div class="row"><span>A</span><div class="tag good">'+gA+'</div></div><div class="row"><span>B</span><div class="tag warn">'+gB+'</div></div><div class="row"><span>below B / n/a</span><div class="tag bad">'+gOther+'</div></div></div>';
 if(deg.length){html+='<div class="card"><h2>Degrading in production</h2>'+deg.map(s=>'<div class="row"><span class="file">'+esc(s.name)+'</span><span class="tag bad">err '+(s.vitals.errorRatePct||0)+'% · apdex '+(s.vitals.apdex||0)+'</span></div>').join('')+'</div>';}
 html+='<div class="card"><h2>How to read this</h2><p class="sub">Three fact sources are reconciled per edge: <b>static</b> (what service code shows — CodeFlow + cross-service call scan), <b>runtime</b> (what New Relic observes in production). An edge is <span class="tag good">confirmed</span> when both agree, <span class="tag warn">static-only</span> when your code suggests a call production never makes, and <span class="tag bad">runtime-only</span> when production makes a call your code folder does not explain (missing repo or external dependency).</p></div>';
 $('tab-overview').innerHTML=html;
})();

// topology (SVG ring layout)
(function(){const d=DATA;
 const ed=(d.edges||[]).filter(e=>e.classification!=='static-only'); // show real + confirmed; static-only shown separately in risk
 const nodes=new Set();
 (d.services||[]).forEach(s=>nodes.add(s.name));
 (d.runtimeOnly||[]).forEach(s=>nodes.add(s.nrName));
 // only include nodes involved in an edge or all services
 const involved=new Set(ed.flatMap(e=>[e.source,e.target]));
 const list=[...(d.services||[]).map(s=>s.name),...(d.runtimeOnly||[]).map(s=>s.nrName)].filter(n=>nodes.has(n));
 const order=ed.flatMap(e=>[e.source,e.target]);
 const center=order.length? order.filter((v,i,a)=>a.indexOf(v)===i):list;
 const nodeColor=n=>{
   const ours=(d.services||[]).find(s=>s.name===n);
   if(ours&&ours.vitals){const h=healthColor(ours.vitals);return h.c||'var(--accent)';}
   if(ours)return 'var(--accent)';
   return '#8892a6'; // runtime-only
 };
 const isRO=n=>!(d.services||[]).some(s=>s.name===n);
 const N=center.length;
 const R=Math.max(150,N*46);
 const W=Math.max(620,R*2+200),H=R*2+160;const cx=W/2,cy=H/2;
 const pos={};center.forEach((n,i)=>{const a=-Math.PI/2+(i/N)*Math.PI*2;pos[n]={x:cx+R*Math.cos(a),y:cy+R*Math.sin(a)};});
 let svg='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="service topology">'+
 '<defs><marker id="ar" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--muted)"/></marker></defs>';
 svg+=ed.map(e=>{const a=pos[e.source],b=pos[e.target];if(!a||!b)return '';
  const cls=e.classification==='runtime-only'?'var(--bad)':e.classification==='static-only'?'var(--warn)':'var(--good)';
  const mx=(a.x+b.x)/2+( (b.y-a.y)? -80:0 );
  return '<path d="M'+a.x+','+a.y+' Q'+mx+','+((a.y+b.y)/2)+' '+b.x+','+b.y+'" fill="none" stroke="'+cls+'" stroke-width="1.6" opacity="0.85" marker-end="url(#ar)"/>';}).join('');
 svg+=center.map(n=>{const p=pos[n];if(!p)return '';
  const r=isRO(n)?13:16;
  return '<circle cx="'+p.x+'" cy="'+p.y+'" r="'+r+'" fill="'+nodeColor(n)+'" fill-opacity="0.18" stroke="'+nodeColor(n)+'" stroke-width="2.4"/>'+
   '<text x="'+p.x+'" y="'+(p.y-24)+'" text-anchor="middle" font-size="12" fill="var(--text)" style="font-family:var(--mono)">'+esc(n)+'</text>';}).join('');
 svg+='</svg>';
 svg+='<div class="legend"><span><i style="background:var(--good)"></i>confirmed (static+runtime)</span><span><i style="background:var(--warn)"></i>static-only</span><span><i style="background:var(--bad)"></i>runtime-only</span><span><i style="background:#8892a6"></i>runtime-only service (no repo)</span></div>';
 $('tab-topology').innerHTML='<div class="card"><h2>Live topology</h2><p class="sub">Edges from New Relic where available. Node color reflects live health.</p>'+svg+'</div>';
})();

// inventory
(function(){const d=DATA;
 const rows=(d.services||[]).map(s=>{
  const sh=s.staticHealth||{}; const v=s.vitals;
  const hc=v?healthColor(v).c:null;
  let html='<div class="svc-card"><h3><span>'+esc(s.name)+'</span>'+
   (s.matched?'':'<span class="tag warn">no NR entity</span>')+
   (sh.grade?'<span class="tag '+gradeClass(sh.grade)+'">code '+sh.grade+(sh.score!=null?'/'+sh.score:'')+'</span>':'')+
   (v&&hc?'<span class="tag" style="color:'+hc+';border-color:'+hc+'">err '+(v.errorRatePct??0)+'% · apdex '+(v.apdex??0)+'</span>':'')+
   (v&&!hc?'<span class="tag good">healthy live</span>':'')+
   '</h3><div class="metric">';
  if(s.repo)html+='<span>repo <b>'+esc(s.repo.split('/').slice(-1)[0])+'</b></span>';
  if(sh.files!=null)html+='<span>code files <b>'+fmt(sh.files)+'</b></span>';
  if(v)html+='<span>p95 <b>'+(v.latencyP95Ms??0)+'ms</b></span><span>rpm <b>'+fmt(v.throughputRpm)+'</b></span>';
  html+='</div></div>';
  return html;
}).join('');
 $('tab-inventory').innerHTML='<div class="card"><h2>Service inventory</h2><p class="sub">Each repo, its static code health, and its live vitals.</p>'+rows+
   ((d.runtimeOnly||[]).length?'<h2 style="margin-top:18px">In production but no repo in this folder</h2>'+(d.runtimeOnly||[]).map(s=>'<div class="svc-card"><h3>'+esc(s.nrName)+'<span class="tag mid">runtime-only</span></h3><div class="metric">'+(s.vitals?'<span>err <b>'+(s.vitals.errorRatePct??0)+'%</b></span><span>apdex <b>'+(s.vitals.apdex??0)+'</b></span><span>p95 <b>'+(s.vitals.latencyP95Ms??0)+'ms</b></span>':'')+'</div></div>').join(''):'')+
   '</div>';
})();

// risk
(function(){const d=DATA;
 const classNote={confirmed:'<span class="tag good">confirmed</span> both your code and New Relic agree',
  'static-only':'<span class="tag warn">static-only</span> coded but not observed in production (dead path? not deployed? scan false-positive?)',
  'runtime-only':'<span class="tag bad">runtime-only</span> production makes this call, your repo folder does not explain it (missing repo or external dependency)'};
 function edgeRows(c){return (d.edges||[]).filter(e=>e.classification===c).map(e=>{
   const st=e.static?e.static.types.join('+'):'';const rt=e.runtime?'samples '+fmt(e.runtime.samples):'';
   return '<div class="row"><span class="file">'+esc(e.source)+' → '+esc(e.target)+'</span><span class="mono">'+esc(st+(st&&rt?' · ':'')+rt)+'</span></div>';}).join('')||'<p class="sub">none</p>';}
 let html='<div class="card"><h2>Declared vs reality</h2><p class="sub">Every cross-service call, classified by which fact sources saw it.</p>';
 for(const c of ['confirmed','static-only','runtime-only']){html+='<h2 style="margin-top:16px">'+classNote[c]+'</h2>'+edgeRows(c);}
 html+='<div class="card"><h2>Orphan topics</h2><p class="sub">Published in code, no in-fleet consumer found statically.</p>'+
   ((d.orphans||[]).map(o=>'<div class="row"><span class="file">'+esc(o.topic)+'</span><span class="mono">published by '+esc(o.producer)+'</span></div>').join('')||'<p class="sub">none</p>')+'</div>';
 html+='<div class="card"><h2>Fan in / fan out</h2>'+
   (function(){const names=(d.services||[]).map(s=>s.name);
    return names.map(n=>{const e=(d.edges||[]).filter(x=>x.source===n||x.target===n);
      const inn=e.filter(x=>x.target===n).length,out=e.filter(x=>x.source===n).length;
      return '<div class="row"><span class="file">'+esc(n)+'</span><span class="mono">'+(out?'calls '+out:'leaf')+' · '+(inn?'called by '+inn:'no callers')+'</span></div>';}).join('');})()
   +'</div></div>';
 $('tab-risk').innerHTML=html;
})();

// growth
(function(){const d=DATA;const g=d.growth||{};
 const rows=(d.services||[]).map(s=>{const gg=g[s.name];if(!gg)return '<div class="row"><span class="file">'+esc(s.name)+'</span><span class="mono">no git data</span></div>';
  return '<div class="row"><span class="file">'+esc(s.name)+'</span><span class="mono">'+fmt(gg.commits)+' commits · '+fmt(gg.contributors)+' contributors · '+esc(gg.firstCommit||'?')+' → '+esc(gg.lastCommit||'?')+'</span></div>';}).join('');
 $('tab-growth').innerHTML='<div class="card"><h2>Change &amp; maturity</h2><p class="sub">Per-repo git history. A slow-moving, small-footprint service next to a churning one says something about ownership.</p>'+rows+'</div>';
})();

// drill-down
(function(){const d=DATA;const an=d.analyses||{};
 const cards=(d.services||[]).map(s=>{
  const a=an[s.name]; const v=s.vitals;
  let inner='';
  if(v){inner+='<div class="metric"><span>live: err <b>'+fmt(v.errorRatePct)+'%</b></span><span>apdex <b>'+(v.apdex??0)+'</b></span><span>p95 <b>'+(v.latencyP95Ms??0)+'ms</b></span><span>rpm <b>'+fmt(v.throughputRpm)+'</b></span></div>';}
  if(a){inner+='<div class="metric">';
   if(a.files!=null)inner+='<span>files <b>'+fmt(a.files)+'</b></span>';
   if(a.loc!=null)inner+='<span>loc <b>'+fmt(a.loc)+'</b></span>';
   if(a.functions!=null)inner+='<span>functions <b>'+fmt(a.functions)+'</b></span>';
   if(a.connections!=null)inner+='<span>call edges <b>'+fmt(a.connections)+'</b></span>';
   if(a.deadPct!=null)inner+='<span>dead fn <b>'+a.deadPct+'%</b></span>';
   if(a.godObjects!=null)inner+='<span>god objects <b>'+a.godObjects+'</b></span>';
   inner+='</div>';
   if(a.topBlast)inner+='<p class="sub" style="margin:6px 0 0">Blast radius: change <span class="file">'+esc(a.topBlast.path)+'</span> → <b>'+fmt(a.topBlast.total)+'</b> files affected.</p>';
   if(a.bigFiles&&a.bigFiles.length){inner+='<p class="sub" style="margin:8px 0 2px">Largest files:</p>'+a.bigFiles.map(f=>'<div class="row"><span class="file">'+esc(f.path)+'</span><span class="mono">'+fmt(f.lines)+' lines</span></div>').join('');}
  } else {inner+='<p class="sub">No deep analysis captured (re-run analyze-all for this service).</p>';}
  return '<details><summary>'+esc(s.name)+' '+(a&&a.grade?'['+a.grade+']':'')+(v?' · live':'')+'</summary><div class="inner">'+inner+'</div></details>';
 }).join('');
 $('tab-detail').innerHTML='<div class="card"><h2>Per-service drill-down</h2><p class="sub">Expand for the analyzer detail behind each service. (Full single-repo deep dashboards come from the sibling codedeck skill.)</p>'+cards+'</div>';
})();

// tabs
document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>{
 document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));
 document.querySelectorAll('section').forEach(x=>x.classList.remove('active'));
 b.classList.add('active');const t=$('tab-'+b.dataset.tab);if(t)t.classList.add('active');
}));
$('genTime').textContent=new Date(DATA.generated_at).toLocaleString();
</script></body></html>`;
}

main().catch((e) => { console.error('generate error:', e.stack || e.message); process.exitCode = 1; });
