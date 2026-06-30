/* ============================================================================
   DRHP Intelligence Dashboard — renders data/latest.json (the contract).
   No hardcoded data. Every value binds to the file the pipeline produces, and
   every filing carries clickable links to its exact SEBI page and source PDF.
   ========================================================================== */
"use strict";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* ---- inline icon set (outline, stroke = currentColor) ---- */
const I = {
  doc:'<path d="M6 2h7l5 5v15H6z"/><path d="M13 2v5h5"/>',
  trend:'<path d="M3 17l6-6 4 4 8-8"/><path d="M21 7v6h-6"/>',
  target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  bookmark:'<path d="M6 3h12v18l-6-4-6 4z"/>',
  building:'<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2"/>',
  flame:'<path d="M12 3c2 4 6 5 6 10a6 6 0 01-12 0c0-2 1-3 2-5 1 2 2 2 2 2 0-3 0-5 2-7z"/>',
  handshake:'<path d="M3 12l4-4 5 5 5-5 4 4"/><path d="M7 8l5 5 5-5"/>',
  spark:'<path d="M12 3v6M12 15v6M3 12h6M15 12h6"/>',
  chart:'<path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="7"/><rect x="13" y="7" width="3" height="11"/>',
};
const icon = (k, sz=18) =>
  `<svg viewBox="0 0 24 24" width="${sz}" height="${sz}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${I[k]||''}</svg>`;

const LINK_SVG = '<svg viewBox="0 0 24 24"><path d="M10 14a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1"/><path d="M14 10a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/></svg>';
const PDF_SVG  = '<svg viewBox="0 0 24 24"><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4"/><path d="M9 13h6M9 16h4"/></svg>';

/* ---- formatting helpers ---- */
const esc = (s) => String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function dfmt(iso){ if(!iso) return '—'; const [y,m,d]=iso.split('-').map(Number); return `${d} ${MONTHS[m-1]} ${y}`; }
function money(v){ if(v==null) return '—'; return Number(v).toLocaleString('en-IN', {maximumFractionDigits: v>=100?0:2}); }
function pct(v){ return v==null ? '—' : Number(v).toFixed(1)+'%'; }
function ratio(v){ return v==null ? '—' : Number(v).toFixed(2); }
function scoreNum(v){ return v==null ? '—' : Math.round(v); }

function cdot(mv){
  if(!mv || mv.value==null) return '';
  if(mv.source==='WEB') return `<span class="cdot web" title="Web-sourced — verify"></span>`;
  if(mv.confidence==='low') return `<span class="cdot low" title="Low confidence — verify"></span>`;
  return '';
}
function fcell(mv, kind){
  const v = mv ? mv.value : null;
  const txt = kind==='money'?money(v):kind==='ratio'?ratio(v):pct(v);
  return `${txt}${cdot(mv)}`;
}

const BUCKET = {
  'DIG DEEPER': {cls:'dig',   label:'DIG DEEPER'},
  'MONITOR':    {cls:'mon',   label:'MONITOR'},
  'WATCH':      {cls:'watch', label:'WATCH'},
  'INSUFFICIENT':{cls:'insuf',label:'NOT ENOUGH DATA'},
};
const bucketTag = (b) => { const x = BUCKET[b]||BUCKET.INSUFFICIENT; return `<span class="tag ${x.cls}">${x.label}</span>`; };

const STAMP = {
  FILED_THIS_WEEK:{cls:'week', label:'Filed This Week'},
  UPDATED:        {cls:'',     label:'Updated'},
  IPO_STAGE:      {cls:'ipo',  label:'IPO Stage'},
  PORTFOLIO_WATCH:{cls:'',     label:'Portfolio Watch'},
};
function stamps(arr){
  return (arr||[])
    .filter(s => s!=='PORTFOLIO_WATCH')   // Stage 2: only when competitor_impact populated
    .map(s => { const x=STAMP[s]; return x?`<span class="stamp ${x.cls}">${x.label}</span>`:''; }).join('');
}

/* ---- clickable sources: SEBI filing page + exact source PDF ---- */
function srcRow(f){
  const s = f.sources || {};
  const out = [];
  if(s.drhp_pdf_url) out.push(`<a class="src-link pdf" href="${esc(s.drhp_pdf_url)}" target="_blank" rel="noopener" title="Open the official source PDF">${PDF_SVG} Source PDF</a>`);
  if(s.sebi_url)     out.push(`<a class="src-link" href="${esc(s.sebi_url)}" target="_blank" rel="noopener" title="Open the SEBI filing page">${LINK_SVG} SEBI</a>`);
  return out.length ? `<div class="src">${out.join('')}</div>` : '';
}
function companyCell(f, withSources=true){
  const url = (f.sources && f.sources.sebi_url) || (f.sources && f.sources.drhp_pdf_url);
  const name = url
    ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(f.company_name)}</a>`
    : esc(f.company_name);
  return `<div class="company">${name}</div>${withSources ? srcRow(f) : ''}`;
}

function deltaPill(d){
  if(d==null) return `<div class="delta none">— first snapshot</div>`;
  if(d==='flat') return `<div class="delta flat">● flat vs last week</div>`;
  const up = d.startsWith('+');
  return `<div class="delta ${up?'up':'down'}">${up?'▲':'▼'} ${esc(d)} vs last week</div>`;
}

/* palette for charts (matches CSS) */
const PAL = {'DIG DEEPER':'#0E7A5F','MONITOR':'#D6A64B','WATCH':'#51607A','INSUFFICIENT':'#C7CDD6'};

/* ====================================================================== */
let DATA = null;

async function main(){
  try{
    const res = await fetch('./data/latest.json', {cache:'no-store'});
    if(!res.ok) throw new Error('HTTP '+res.status);
    DATA = await res.json();
  }catch(e){
    document.getElementById('app').innerHTML =
      `<div class="errbox">Couldn't load the data file (<code>data/latest.json</code>).<br>${esc(e.message)}</div>`;
    return;
  }
  renderHeader();
  renderSnapshot();
  renderMarketHeat();
  renderWatchlist();
  renderCompetitor();
  renderAppendix();
  renderFooter();
  wireNav();
}

function renderHeader(){
  const m = DATA.meta;
  document.getElementById('week-range').textContent =
    `Week of ${dfmt(m.week_start)} – ${dfmt(m.week_end)}`;
  document.getElementById('as-of').textContent = `Data as on ${dfmt(m.data_as_of)}`;
  document.getElementById('updated-badge').textContent = `Updated ${dfmt(m.run_date)}`;
}

/* ---------------- Tab 1: Weekly Snapshot ---------------- */
function renderSnapshot(){
  const s = DATA.summary, f = DATA.filings, d = s.deltas;

  const kpis = [
    {k:'doc',     cls:'',     label:'New DRHPs',        val:s.new_drhp_count, dl:d&&d.new_drhp},
    {k:'trend',   cls:'',     label:'IPOs / Prospects', val:s.new_ipo_count,  dl:d&&d.new_ipo},
    {k:'target',  cls:'dig',  label:'Dig Deeper',       val:s.buckets.dig_deeper, dl:d&&d.dig_deeper},
    {k:'eye',     cls:'mon',  label:'Monitor',          val:s.buckets.monitor,    dl:d&&d.monitor},
    {k:'bookmark',cls:'watch',label:'Watch',            val:s.buckets.watch,      dl:d&&d.watch},
  ];
  document.getElementById('kpi-grid').innerHTML = kpis.map(c => `
    <div class="kpi ${c.cls}">
      <div class="kpi-icon">${icon(c.k,20)}</div>
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value">${c.val}</div>
      ${deltaPill(c.dl===undefined?null:c.dl)}
    </div>`).join('');

  const ranked = [...f].sort((a,b)=>(b.score.total??-1)-(a.score.total??-1)).slice(0,3);
  document.getElementById('top3').innerHTML = ranked.map(x=>`
    <tr>
      <td>${companyCell(x, false)}</td>
      <td class="subtle">${esc(x.sector||'—')}</td>
      <td class="num score-cell">${scoreNum(x.score.total)}</td>
      <td>${bucketTag(x.score.bucket)}</td>
    </tr>`).join('') || `<tr><td colspan="4" class="subtle">No filings this week.</td></tr>`;

  const alerts = [];
  f.filter(x=>(x.stamps||[]).includes('IPO_STAGE')).forEach(x=>
    alerts.push({c:'green', t:`<b>${esc(x.company_name)}</b> progressed from draft to IPO stage.`}));
  f.filter(x=>(x.stamps||[]).includes('UPDATED')).forEach(x=>
    alerts.push({c:'gold', t:`<b>${esc(x.company_name)}</b> filed an updated / corrected document.`}));
  if(ranked[0] && ranked[0].score.total!=null)
    alerts.push({c:'', t:`Highest automated score: <b>${esc(ranked[0].company_name)}</b> at ${scoreNum(ranked[0].score.total)} (${esc(ranked[0].sector||'')}).`});
  const insuf = f.filter(x=>x.score.bucket==='INSUFFICIENT').length;
  if(insuf) alerts.push({c:'grey', t:`<b>${insuf}</b> filing${insuf>1?'s':''} await disclosed financials — shown as “not enough data”.`});
  document.getElementById('alerts').innerHTML =
    (alerts.slice(0,5).map(a=>`<li><span class="alert-dot ${a.c}"></span><div>${a.t}</div></li>`).join('')
     || `<li><span class="alert-dot"></span><div class="subtle">No notable alerts this week.</div></li>`);

  const sc = [...(s.sector_concentration||[])].sort((a,b)=>b.count-a.count);
  document.getElementById('sectors').innerHTML = sc.map(x=>`
    <div class="sector-chip">
      <div class="sc-ico">${icon('building',17)}</div>
      <div class="sc-name">${esc(x.sector)}</div>
      <div class="sc-count">${x.count}</div>
    </div>`).join('') || `<div class="subtle">No sector data.</div>`;

  const total = sc.reduce((a,x)=>a+x.count,0), top2 = sc.slice(0,2);
  const note = document.getElementById('sector-note');
  if(total && top2.length){
    const share = Math.round(top2.reduce((a,x)=>a+x.count,0)/total*100);
    note.innerHTML = `${esc(top2.map(x=>x.sector).join(' and '))} together account for <b>${share}%</b> of new filing activity this week.`;
  } else { note.style.display='none'; }
}

/* ---------------- Tab 2: Market Heat ---------------- */
function renderMarketHeat(){
  const s = DATA.summary, f = DATA.filings;
  const sc = [...(s.sector_concentration||[])].sort((a,b)=>b.count-a.count);

  const maxC = Math.max(1, ...sc.map(x=>x.count));
  document.getElementById('bars-count').innerHTML = sc.map(x=>`
    <div class="bar-row"><div class="bl">${esc(x.sector)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${x.count/maxC*100}%"></div></div>
      <div class="bv">${x.count}</div></div>`).join('');

  const maxI = Math.max(...sc.map(x=>x.total_issue_cr||0));
  const issueEl = document.getElementById('bars-issue');
  if(maxI>0){
    issueEl.innerHTML = sc.map(x=>`
      <div class="bar-row"><div class="bl">${esc(x.sector)}</div>
        <div class="bar-track"><div class="bar-fill green" style="width:${(x.total_issue_cr||0)/maxI*100}%"></div></div>
        <div class="bv">${money(x.total_issue_cr)}</div></div>`).join('');
  } else {
    issueEl.innerHTML = `<div class="subtle tiny" style="padding:6px 0">Issue sizes not yet disclosed for this week's filings (draft filings often mask the amount until a price band is set).</div>`;
  }

  const counts = {
    'DIG DEEPER': f.filter(x=>x.score.bucket==='DIG DEEPER').length,
    'MONITOR':    f.filter(x=>x.score.bucket==='MONITOR').length,
    'WATCH':      f.filter(x=>x.score.bucket==='WATCH').length,
    'INSUFFICIENT': f.filter(x=>x.score.bucket==='INSUFFICIENT').length,
  };
  renderDonut(counts);

  document.getElementById('week-filings').innerHTML = f.map(x=>`
    <tr>
      <td>${companyCell(x)}</td>
      <td class="subtle">${esc(x.sector||'—')}</td>
      <td class="subtle">${dfmt(x.filing_date)}</td>
      <td>${esc(x.issue.type||'—')}</td>
      <td class="num">${money(x.issue.total_cr)}</td>
      <td class="num score-cell">${scoreNum(x.score.total)}</td>
      <td>${bucketTag(x.score.bucket)}</td>
    </tr>`).join('') || `<tr><td colspan="7" class="subtle">No filings this week.</td></tr>`;

  renderInsights(sc, f);
}

function renderDonut(counts){
  const total = Object.values(counts).reduce((a,b)=>a+b,0);
  const r=52, c=2*Math.PI*r; let off=0, segs='';
  if(total>0){
    for(const [k,v] of Object.entries(counts)){
      if(!v) continue;
      const len=v/total*c;
      segs += `<circle cx="70" cy="70" r="${r}" fill="none" stroke="${PAL[k]}" stroke-width="18"
        stroke-dasharray="${len} ${c-len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"/>`;
      off += len;
    }
  } else { segs = `<circle cx="70" cy="70" r="${r}" fill="none" stroke="#EDEFF2" stroke-width="18"/>`; }
  const legend = Object.entries(counts).map(([k,v])=>`
    <div class="li"><span class="sw" style="background:${PAL[k]}"></span>${BUCKET[k].label} <b>${v}</b></div>`).join('');
  document.getElementById('donut').innerHTML = `
    <div class="donut-wrap">
      <svg class="donut" width="140" height="140" viewBox="0 0 140 140">${segs}
        <text x="70" y="66" text-anchor="middle" font-family="Inter, sans-serif" font-size="27" font-weight="700" fill="#064E45">${total}</text>
        <text x="70" y="85" text-anchor="middle" font-family="Inter, sans-serif" font-size="10" fill="#9CA3AF">filings</text>
      </svg>
      <div class="legend">${legend}</div>
    </div>`;
}

function renderInsights(sc, f){
  const out = [];
  if(sc.length) out.push({ico:'flame', t:`<b>${esc(sc[0].sector)}</b> leads this week with <b>${sc[0].count}</b> new filing${sc[0].count>1?'s':''}.`});
  const issues = f.map(x=>x.issue.total_cr).filter(v=>v!=null);
  if(issues.length){
    const avg = issues.reduce((a,b)=>a+b,0)/issues.length;
    out.push({ico:'chart', t:`Average disclosed issue size: <b>₹${money(avg)} Cr</b> across ${issues.length} filing${issues.length>1?'s':''}.`});
  } else {
    out.push({ico:'chart', t:`Issue sizes are <b>not yet disclosed</b> — typical for draft filings before a price band is set.`});
  }
  const scored = f.filter(x=>x.score.total!=null).length;
  const strong = f.filter(x=>x.score.total!=null && x.score.total>=25).length;
  if(scored) out.push({ico:'target', t:`<b>${strong} of ${scored}</b> scored filing${scored>1?'s':''} clear the “Dig Deeper” bar (score ≥ 25).`});
  const insuf = f.filter(x=>x.score.bucket==='INSUFFICIENT').length;
  if(insuf) out.push({ico:'spark', t:`<b>${insuf}</b> filing${insuf>1?'s':''} lack disclosed financials and are held as “not enough data”.`});
  document.getElementById('insights').innerHTML = out.slice(0,4).map(o=>`
    <div class="insight"><div class="ico">${icon(o.ico,17)}</div><div class="it">${o.t}</div></div>`).join('');
}

/* ---------------- Tab 3: Score Watchlist ---------------- */
function renderWatchlist(){
  const f = [...DATA.filings].sort((a,b)=>(b.score.total??-1)-(a.score.total??-1));
  document.getElementById('watchlist').innerHTML = f.map((x,i)=>{
    const fin=x.financials;
    return `<tr>
      <td class="num subtle">${i+1}</td>
      <td>${companyCell(x)}<div>${stamps(x.stamps)}</div></td>
      <td class="subtle">${esc(x.sector||'—')}${x.sub_sector?` · ${esc(x.sub_sector)}`:''}</td>
      <td class="num">${fcell(fin.revenue_fy25,'money')}</td>
      <td class="num">${fcell(fin.rev_growth_pct,'pct')}</td>
      <td class="num">${fcell(fin.pat_margin_pct,'pct')}</td>
      <td class="num">${fcell(fin.roe_pct,'pct')}</td>
      <td class="num score-cell">${scoreNum(x.score.total)}</td>
      <td>${bucketTag(x.score.bucket)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" class="subtle">No filings this week.</td></tr>`;
}

/* ---------------- Tab 4: Competitor Watch ---------------- */
function renderCompetitor(){
  const hasData = DATA.filings.some(x=>x.competitor_impact);
  document.getElementById('competitor').innerHTML = hasData ? '' : `
    <div class="empty-state">
      <div class="es-ico">${icon('handshake',28)}</div>
      <h3>Competitor &amp; portfolio-impact mapping</h3>
      <p>This view links each new filing to companies in your portfolio — direct competitors, sector overlaps, and notes on potential impact. It activates once your portfolio list is connected.</p>
      <span class="es-badge">COMING IN STAGE 2</span>
    </div>`;
}

/* ---------------- Tab 5: Tracker Appendix ---------------- */
function renderAppendix(){
  document.getElementById('appendix').innerHTML = DATA.filings.map(x=>{
    const fin=x.financials;
    const lm = (x.lead_managers&&x.lead_managers.length)?esc(x.lead_managers.join(', ')):'—';
    return `<tr>
      <td>${companyCell(x)}</td>
      <td class="subtle">${esc(x.filing_type)}</td>
      <td class="subtle">${dfmt(x.filing_date)}</td>
      <td class="subtle">${esc(x.sector||'—')}</td>
      <td class="subtle">${esc(x.sub_sector||'—')}</td>
      <td>${esc(x.issue.type||'—')}</td>
      <td class="num">${money(x.issue.total_cr)}</td>
      <td class="num">${fcell(fin.revenue_fy25,'money')}</td>
      <td class="num">${fcell(fin.pat_fy25,'money')}</td>
      <td class="num">${fcell(fin.ebitda_margin_pct,'pct')}</td>
      <td class="num">${fcell(fin.roe_pct,'pct')}</td>
      <td class="num">${fcell(fin.roce_pct,'pct')}</td>
      <td class="subtle">${lm}</td>
      <td class="num score-cell">${scoreNum(x.score.total)}</td>
      <td>${bucketTag(x.score.bucket)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="15" class="subtle">No filings this week.</td></tr>`;
}

function renderFooter(){
  document.getElementById('foot-meta').textContent =
    `Generated ${dfmt(DATA.meta.run_date)} · snapshot ${DATA.meta.snapshot_id} · source: SEBI public filings`;
}

/* ---------------- Navigation (sidebar + pills, synced) ---------------- */
function wireNav(){
  const navBtns = [...document.querySelectorAll('.snav, .pill')];
  const panels = [...document.querySelectorAll('.tab-panel')];
  function activate(id){
    navBtns.forEach(b => b.classList.toggle('active', b.dataset.target===id));
    panels.forEach(p => p.hidden = (p.id!==id));
    document.querySelector('.content').scrollIntoView({block:'start', behavior:'smooth'});
  }
  navBtns.forEach(b => b.addEventListener('click', () => activate(b.dataset.target)));
}

document.addEventListener('DOMContentLoaded', main);
