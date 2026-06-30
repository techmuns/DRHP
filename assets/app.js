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
  people:'<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0111 0"/><path d="M16 5.5a3 3 0 010 5.6M20.5 20a5.5 5.5 0 00-3.5-5.1"/>',
  bank:'<path d="M3 9l9-5 9 5"/><path d="M4 9h16"/><path d="M6 9v8M10 9v8M14 9v8M18 9v8"/><path d="M3 20h18"/>',
  cross:'<path d="M10 3.5h4a1 1 0 011 1V9h4.5a1 1 0 011 1v4a1 1 0 01-1 1H15v4.5a1 1 0 01-1 1h-4a1 1 0 01-1-1V15H4.5a1 1 0 01-1-1v-4a1 1 0 011-1H9V4.5a1 1 0 011-1z"/>',
  cube:'<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
};
/* sector → tile icon (falls back to a generic building) */
const SECTOR_ICON = {
  Consumer:'people', Financials:'bank', Healthcare:'cross', Materials:'cube',
  Industrials:'chart', Technology:'spark', Energy:'flame',
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

/* ---- IPO lifecycle helpers ---- */
const STAGE = {
  'DRHP Filed':       {cls:'st-filed',  label:'Filed'},
  'Updated/Corrected':{cls:'st-upd',    label:'Updated'},
  'Approved':         {cls:'st-appr',   label:'Approved'},
  'Upcoming':         {cls:'st-upc',    label:'Upcoming'},
  'IPO Open':         {cls:'st-open',   label:'IPO Open'},
  'Listing Soon':     {cls:'st-soon',   label:'Listing Soon'},
  'Listed':           {cls:'st-listed', label:'Listed'},
  'Withdrawn':        {cls:'st-wd',     label:'Withdrawn'},
};
function stageChip(s){ if(!s) return ''; const x=STAGE[s]||{cls:'st-filed',label:s}; return `<span class="lc-chip ${x.cls}">${esc(x.label)}</span>`; }
function boardChip(b, dash=true){ if(!b) return dash?'<span class="subtle tiny">—</span>':''; return `<span class="board-chip ${b==='SME'?'sme':'mb'}">${esc(b)}</span>`; }
function dataStatusChip(f){ const ok = f.score && f.score.bucket!=='INSUFFICIENT'; return `<span class="ds-chip ${ok?'ok':'miss'}">${ok?'Complete':'Missing financials'}</span>`; }
function subx(v){ return v==null ? '—' : Number(v).toFixed(2)+'×'; }
function ipoMarket(){ return DATA.ipo_market || {available:false}; }

let apxFilter = {board:'All', stage:'All', sector:'All', bucket:'All'};
let ipoFilter = {board:'All', stage:'All'};   // IPO Pipeline tracker's own filters
let kpiFilter = null;   // legacy: KPI clicks now navigate to Market Heat, so this stays null

function passKpi(f){
  if(!kpiFilter) return true;
  if(kpiFilter.kind === 'bucket') return f.score && f.score.bucket === kpiFilter.value;
  if(kpiFilter.kind === 'stage')  return f.stage === kpiFilter.value;
  return true;
}
function filteredFilings(){ return (DATA.filings || []).filter(passKpi); }

/* ====================================================================== */
/* Market Heat — one shared filter state + one merged dataset             */
/* ====================================================================== */
let MARKET = [];   // every IPO-lifecycle record, merged from filings + NSE
function mhReset(){ return {board:'All', stage:'All', sector:'All', reco:'All', subSector:'All', filingType:'All', issueType:'All'}; }
let mh = mhReset();

/* canonical lifecycle order (used to sort the Lifecycle selector) */
const STAGE_ORDER = ['DRHP Filed','Updated/Corrected','Approved','Upcoming','IPO Open','Listing Soon','Listed','Withdrawn'];
const STAGE_KEYS = {'DRHP Filed':'FILED','Updated/Corrected':'UPDATED','Approved':'APPROVED','Upcoming':'UPCOMING','IPO Open':'IPO_OPEN','Listing Soon':'LISTING_SOON','Listed':'LISTED','Withdrawn':'WITHDRAWN'};
const RECO_KEYS  = {'DIG DEEPER':'DIG_DEEPER','MONITOR':'MONITOR','WATCH':'WATCH','INSUFFICIENT':'INSUFFICIENT'};
const RECO_DISP  = {'DIG DEEPER':'Dig Deeper','MONITOR':'Monitor','WATCH':'Watch','INSUFFICIENT':'Not Enough Data'};
const RECO_ORDER = ['DIG DEEPER','MONITOR','WATCH','INSUFFICIENT'];
const stageLabel = (s)=> (STAGE[s]||{label:s}).label;
const invert = (o) => Object.fromEntries(Object.entries(o).map(([k,v])=>[v,k]));

/* the filter dimensions that drive Market Heat — shared by the ribbon, the
   facet counts, the summary chips and the URL. Add one here and it works
   everywhere. */
const MH_DIMS = [
  {key:'board',     label:'Board',          urlk:'board',      val:r=>r.board},
  {key:'stage',     label:'Lifecycle',      urlk:'stage',      val:r=>r.stage,      disp:stageLabel, order:s=>STAGE_ORDER.indexOf(s), keymap:STAGE_KEYS},
  {key:'reco',      label:'Recommendation', urlk:'reco',       val:r=>r.bucket,     disp:b=>RECO_DISP[b]||b, order:b=>RECO_ORDER.indexOf(b), keymap:RECO_KEYS},
  {key:'sector',    label:'Sector',         urlk:'sector',     val:r=>r.sector},
  {key:'subSector', label:'Sub-sector',     urlk:'subsector',  val:r=>r.subSector},
  {key:'filingType',label:'Filing Type',    urlk:'filingtype', val:r=>r.filingType},
  {key:'issueType', label:'Issue Type',     urlk:'issuetype',  val:r=>r.issueType},
];

/* strip legal suffixes the same way the Python pipeline does, so a SEBI filing
   and its NSE row collapse onto one record */
function normalizeName(s){
  return String(s||'').toLowerCase()
    .replace(/&/g,' and ')
    .replace(/\b(private|pvt|limited|ltd|llp)\b/g,' ')
    .replace(/[^a-z0-9 ]/g,' ')
    .replace(/\s+/g,' ').trim();
}

/* one SEBI filing → the shared record shape (carries every tracker field) */
function filingToRec(f){
  const iss = f.issue || {};
  return {
    norm: f.company_name_normalized || normalizeName(f.company_name),
    name: f.company_name,
    board: f.board || null,
    sector: f.sector || null,
    subSector: f.sub_sector || null,
    stage: f.current_stage || null,
    filingStage: f.stage || null,
    filingType: f.filing_type || null,
    filingDate: f.filing_date || null,
    issueType: iss.type || null,
    freshCr: iss.fresh_cr ?? null,
    ofsCr: iss.ofs_cr ?? null,
    issueSizeCr: iss.total_cr ?? null,
    marketCapCr: iss.market_cap_cr ?? null,
    issueToMktcapPct: iss.issue_to_mktcap_pct ?? null,
    issueOpen: null, issueClose: null, listingDate: null,
    subscriptionX: null, issuePrice: null, currentPrice: null, gainPct: null,
    priceBand: null, symbol: null,
    businessSummary: f.business_summary || null,
    leadManagers: (f.lead_managers && f.lead_managers.length) ? f.lead_managers : null,
    score: f.score ? f.score.total : null,
    bucket: f.score ? f.score.bucket : null,
    sources: f.sources || null,
    financials: f.financials || null,
    origin: 'filing',
  };
}

function buildMarket(){
  const m = ipoMarket();
  const fByNorm = new Map();
  const out = [];
  (DATA.filings||[]).forEach(f=>{
    const rec = filingToRec(f);
    fByNorm.set(rec.norm, rec);
    out.push(rec);
  });
  const mergeNse = (r)=>{
    const norm = normalizeName(r.company_name);
    const ex = fByNorm.get(norm);
    if(ex && !ex._nse){
      ex._nse = true; ex.origin = 'both';
      ex.board = ex.board || r.board || null;
      ex.sector = ex.sector || r.sector || null;
      ex.stage = r.stage || ex.stage;            // NSE stage is the more-advanced truth
      ex.issueOpen = r.issue_open || ex.issueOpen;
      ex.issueClose = r.issue_close || ex.issueClose;
      ex.listingDate = r.listing_date || ex.listingDate;
      if(ex.issueSizeCr == null) ex.issueSizeCr = r.issue_size_cr;
      if(ex.subscriptionX == null) ex.subscriptionX = r.subscription_x;
      if(ex.issuePrice == null) ex.issuePrice = r.issue_price;
      ex.priceBand = ex.priceBand || r.price_band;
      ex.symbol = r.symbol;
      return;
    }
    out.push({
      norm, name: r.company_name, board: r.board || null, sector: r.sector || null, subSector: null,
      stage: r.stage || null, filingStage: null, filingType: null, filingDate: null,
      issueType: null, freshCr: null, ofsCr: null,
      issueSizeCr: r.issue_size_cr, marketCapCr: null, issueToMktcapPct: null,
      issueOpen: r.issue_open || null, issueClose: r.issue_close || null, listingDate: r.listing_date || null,
      subscriptionX: r.subscription_x, issuePrice: r.issue_price,
      currentPrice: r.current_price, gainPct: r.gain_pct, priceBand: r.price_band, symbol: r.symbol,
      businessSummary: null, leadManagers: null,
      score: null, bucket: null, sources: null, financials: null, origin: 'nse',
    });
  };
  if(m.available){
    (m.open_upcoming||[]).forEach(mergeNse);
    (m.recent_listings||[]).forEach(mergeNse);
  }
  MARKET = out;
}

/* one record matches the current filter set, optionally ignoring one dimension
   (so a facet's own chart still shows every still-clickable option) */
function mhMatch(r, except){
  for(const d of MH_DIMS){
    if(d.key===except) continue;
    if(mh[d.key]!=='All' && d.val(r)!==mh[d.key]) return false;
  }
  return true;
}
function mhFiltered(except){ return MARKET.filter(r=>mhMatch(r, except)); }
function mhActive(){ return MH_DIMS.some(d=>mh[d.key]!=='All'); }

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
  buildMarket();
  const fromUrl = mhFromUrl();
  renderHeader();
  renderSnapshot();
  renderPulse();
  renderMarketHeat();
  renderWatchlist();
  renderCompetitor();
  renderAppendix();
  renderFooter();
  wireNav();
  wireKpiSelect();
  wireCrossNav();
  wireDrawer();
  if(fromUrl) activateTab('tab-heat');
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
    {k:'doc',     cls:'kv1', label:'New DRHPs',        val:s.new_drhp_count, dl:d&&d.new_drhp, fk:'stage',  fv:'DRHP'},
    {k:'trend',   cls:'kv2', label:'IPOs / Prospects', val:s.new_ipo_count,  dl:d&&d.new_ipo,  fk:'stage',  fv:'IPO'},
    {k:'target',  cls:'kv3', label:'Dig Deeper',       val:s.buckets.dig_deeper, dl:d&&d.dig_deeper, fk:'bucket', fv:'DIG DEEPER'},
    {k:'eye',     cls:'kv4', label:'Monitor',          val:s.buckets.monitor,    dl:d&&d.monitor,    fk:'bucket', fv:'MONITOR'},
    {k:'bookmark',cls:'kv5', label:'Watch',            val:s.buckets.watch,      dl:d&&d.watch,      fk:'bucket', fv:'WATCH'},
  ];
  const isSel = c => kpiFilter && kpiFilter.kind===c.fk && kpiFilter.value===c.fv;
  document.getElementById('kpi-grid').innerHTML = kpis.map(c => `
    <div class="kpi ${c.cls} ${isSel(c)?'selected':''}" data-fk="${c.fk}" data-fv="${esc(c.fv)}" title="Filter to ${esc(c.label)}">
      <div class="kpi-icon">${icon(c.k,20)}</div>
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value">${c.val}</div>
      ${deltaPill(c.dl===undefined?null:c.dl)}
    </div>`).join('');

  const fbar = document.getElementById('kpi-filter-bar');
  if(fbar){
    if(kpiFilter){
      const lab = kpis.find(c=>c.fk===kpiFilter.kind && c.fv===kpiFilter.value);
      const n = filteredFilings().length;
      fbar.innerHTML = `<span class="kpi-filter-note">Filtered to <b>${lab?esc(lab.label):esc(kpiFilter.value)}</b> · ${n} filing${n!==1?'s':''}</span><button class="kpi-clear">Clear ✕</button>`;
    } else { fbar.innerHTML = ''; }
  }

  const ranked = filteredFilings().sort((a,b)=>(b.score.total??-1)-(a.score.total??-1)).slice(0,3);
  document.getElementById('top3').innerHTML = ranked.map((x,i)=>`
    <div class="rank-row ${i===0?'lead':''}">
      <span class="rank-no">${i+1}</span>
      <div class="rank-body">
        <div class="rank-name">${companyCell(x, false)}</div>
        <div class="rank-meta">
          <span class="rank-sec">${esc(x.sector||'—')}</span>
          <span class="rank-stats"><span class="rank-score">${scoreNum(x.score.total)}</span>${bucketTag(x.score.bucket)}</span>
        </div>
      </div>
    </div>`).join('') || `<div class="subtle tiny" style="padding:10px 2px">No filings this week.</div>`;

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
    <div class="sector-chip clickable" data-sector="${esc(x.sector)}" role="button" tabindex="0" title="Explore ${esc(x.sector)} in Market Heat">
      <span class="sc-ico">${icon(SECTOR_ICON[x.sector]||'building',16)}</span>
      <span class="sc-name">${esc(x.sector)}</span>
      <span class="sc-count">${x.count}</span>
    </div>`).join('') || `<div class="subtle">No sector data.</div>`;

  const total = sc.reduce((a,x)=>a+x.count,0), top2 = sc.slice(0,2);
  const note = document.getElementById('sector-note');
  if(total && top2.length){
    const share = Math.round(top2.reduce((a,x)=>a+x.count,0)/total*100);
    note.style.display='';
    note.innerHTML = `<span class="cn-ico">${icon('chart',16)}</span><span class="cn-tx">${esc(top2.map(x=>x.sector).join(' and '))} together account for <b>${share}%</b> of new filing activity this week.</span>`;
  } else { note.style.display='none'; }
}

/* ---------------- Tab 2: Market Heat (unified explorer) ---------------- */
function renderMarketHeat(){
  if(!document.getElementById('mh-selectors')) return;
  if(!ipoMarket().available && MARKET.length===0){
    document.getElementById('mh-selectors').innerHTML = '';
    document.getElementById('mh-table-card').innerHTML =
      `<div class="pending-tag">Pending source — market data not reached this run.</div>`;
    return;
  }
  mhSelectors();
  mhLifecycle();
  mhSummary();
  mhBenchmark();
  mhDonut();
  mhTable();
}

/* compact control ribbon — one dropdown pill per dimension + Clear all */
function mhSelectors(){
  const host = document.getElementById('mh-selectors'); if(!host) return;
  const pill = (d)=>{
    let opts = [...new Set(MARKET.map(d.val).filter(Boolean))];
    opts = d.order ? opts.sort((a,b)=>d.order(a)-d.order(b)) : opts.sort();
    if(!opts.length) return '';   // hide a dimension that has no values at all
    const cur = mh[d.key];
    const o = [`<option value="All" ${cur==='All'?'selected':''}>All</option>`]
      .concat(opts.map(v=>`<option value="${esc(v)}" ${cur===v?'selected':''}>${esc(d.disp?d.disp(v):v)}</option>`)).join('');
    return `<label class="mh-pill ${cur!=='All'?'on':''}">
      <span class="mh-pill-lbl">${d.label}</span>
      <select class="mh-pill-sel" data-dim="${d.key}">${o}</select></label>`;
  };
  host.innerHTML = `
    <div class="mh-ribbon-pills">${MH_DIMS.map(pill).join('')}</div>
    <button class="mh-ribbon-clear ${mhActive()?'':'hide'}">Clear all</button>`;
  host.querySelectorAll('.mh-pill-sel').forEach(s=>s.addEventListener('change',()=>{
    mh[s.dataset.dim] = s.value; mhSyncUrl(); renderMarketHeat();
  }));
  const cl = host.querySelector('.mh-ribbon-clear');
  if(cl) cl.addEventListener('click',()=>{ mh = mhReset(); mhSyncUrl(); renderMarketHeat(); });
}

/* lifecycle guidance strip — compact chips with counts; click to set stage */
function mhLifecycle(){
  const host = document.getElementById('mh-lifecycle'); if(!host) return;
  const rows = mhFiltered('stage');
  const counts = {};
  rows.forEach(r=>{ if(r.stage) counts[r.stage]=(counts[r.stage]||0)+1; });
  const stages = Object.keys(counts).sort((a,b)=>STAGE_ORDER.indexOf(a)-STAGE_ORDER.indexOf(b));
  if(!stages.length){ host.innerHTML=''; return; }
  const chips = stages.map((s,i)=>`${i?'<span class="mh-lc-arrow">→</span>':''}<button class="mh-lc-chip ${mh.stage===s?'on':''}" data-dim="stage" data-val="${esc(s)}">${esc(stageLabel(s))} <b>${counts[s]}</b></button>`).join('');
  host.innerHTML = `<span class="mh-lc-lab">Lifecycle</span><div class="mh-lc-track">${chips}</div>`;
  mhWireFacets(host);
}

/* small active-filter summary, shown only when filters are applied */
function mhSummary(){
  const host = document.getElementById('mh-summary'); if(!host) return;
  if(!mhActive()){ host.innerHTML = ''; return; }
  const n = mhFiltered().length;
  const chips = MH_DIMS.filter(d=>mh[d.key]!=='All').map(d=>{
    const txt = d.disp ? d.disp(mh[d.key]) : mh[d.key];
    return `<button class="mh-sum-chip" data-dim="${d.key}">${esc(txt)} <span class="x">✕</span></button>`;
  }).join('');
  host.innerHTML = `<span class="mh-sum-show">Showing:</span>${chips}<span class="mh-sum-n">${n} record${n!==1?'s':''}</span>`;
  host.querySelectorAll('.mh-sum-chip').forEach(b=>b.addEventListener('click',()=>{
    mh[b.dataset.dim]='All'; mhSyncUrl(); renderMarketHeat();
  }));
}

/* left card — sector activity bars, which also act as a sector filter */
function mhBenchmark(){
  const host = document.getElementById('mh-benchmark'); if(!host) return;
  const secRows = mhFiltered('sector');
  const secCounts = {};
  secRows.forEach(r=>{ if(r.sector) secCounts[r.sector]=(secCounts[r.sector]||0)+1; });
  const secArr = Object.entries(secCounts).sort((a,b)=>b[1]-a[1]);
  const maxC = Math.max(1, ...secArr.map(x=>x[1]));
  const bars = secArr.length ? secArr.map(([s,n])=>`
    <div class="bar-row mh-bar ${mh.sector===s?'on':''}" data-dim="sector" data-val="${esc(s)}" role="button" tabindex="0">
      <div class="bl">${esc(s)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${n/maxC*100}%"></div></div>
      <div class="bv">${n}</div></div>`).join('')
    : `<div class="subtle tiny" style="padding:6px 0">No classified sectors in this view. Sector is disclosed on the SEBI filing — NSE-only listings stay unclassified.</div>`;
  host.innerHTML = `
    <div class="panel-head"><h3>Activity by Sector</h3></div>
    <div class="bars">${bars}</div>`;
  mhWireFacets(host);
}

/* right card — recommendation donut + quick insights */
function mhDonut(){
  const host = document.getElementById('mh-donut'); if(!host) return;
  const rows = mhFiltered('reco');
  const counts = {};
  ['DIG DEEPER','MONITOR','WATCH','INSUFFICIENT'].forEach(b=>{
    const n = rows.filter(r=>r.bucket===b).length; if(n) counts[b]=n;
  });
  const total = Object.values(counts).reduce((a,b)=>a+b,0);
  const r=52, c=2*Math.PI*r; let off=0, segs='';
  if(total>0){
    for(const [k,v] of Object.entries(counts)){
      const len=v/total*c;
      segs += `<circle cx="70" cy="70" r="${r}" fill="none" stroke="${PAL[k]}" stroke-width="18"
        stroke-dasharray="${len} ${c-len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"/>`;
      off += len;
    }
  } else { segs = `<circle cx="70" cy="70" r="${r}" fill="none" stroke="#EDEFF2" stroke-width="18"/>`; }
  const legend = Object.entries(counts).map(([k,v])=>`
    <button class="li mh-leg ${mh.reco===k?'on':''}" data-dim="reco" data-val="${esc(k)}">
      <span class="sw" style="background:${PAL[k]}"></span>${BUCKET[k].label} <b>${v}</b></button>`).join('')
    || `<div class="subtle tiny">No scored records in this view — recommendations need disclosed financials.</div>`;

  host.innerHTML = `
    <div class="panel-head"><h3>Recommendation Mix</h3></div>
    <div class="donut-wrap">
      <svg class="donut" width="140" height="140" viewBox="0 0 140 140">${segs}
        <text x="70" y="66" text-anchor="middle" font-family="Inter, sans-serif" font-size="27" font-weight="700" fill="#064E45">${total}</text>
        <text x="70" y="85" text-anchor="middle" font-family="Inter, sans-serif" font-size="10" fill="#9CA3AF">scored</text>
      </svg>
      <div class="legend">${legend}</div>
    </div>
    <div class="panel-divider"></div>
    <div class="panel-head"><h3>Quick Insights</h3></div>
    <div class="insights">${mhInsights()}</div>`;
  mhWireFacets(host);
}

function mhInsights(){
  const rows = mhFiltered();
  const out = [];
  const secCounts = {};
  rows.forEach(r=>{ if(r.sector) secCounts[r.sector]=(secCounts[r.sector]||0)+1; });
  const topSec = Object.entries(secCounts).sort((a,b)=>b[1]-a[1])[0];
  if(topSec) out.push({ico:'flame', t:`<b>${esc(topSec[0])}</b> leads this view with <b>${topSec[1]}</b> record${topSec[1]>1?'s':''}.`});
  const open = rows.filter(r=>r.stage==='IPO Open').length;
  if(open) out.push({ico:'trend', t:`<b>${open}</b> issue${open>1?'s are':' is'} currently open for subscription.`});
  const listed = rows.filter(r=>r.stage==='Listed').length;
  if(listed) out.push({ico:'target', t:`<b>${listed}</b> recent listing${listed>1?'s':''} in view — listing gain/loss is held pending (no live price feed).`});
  const scored = rows.filter(r=>r.score!=null).length;
  if(scored){
    const strong = rows.filter(r=>r.score!=null && r.score>=25).length;
    out.push({ico:'chart', t:`<b>${strong} of ${scored}</b> scored record${scored>1?'s':''} clear the “Dig Deeper” bar (score ≥ 25).`});
  }
  if(!out.length) out.push({ico:'spark', t:`No records match the current filters.`});
  return out.slice(0,4).map(o=>`<div class="insight"><div class="ico">${icon(o.ico,17)}</div><div class="it">${o.t}</div></div>`).join('');
}

/* shared wiring for clickable bars / stage chips / donut legend */
function mhWireFacets(host){
  host.querySelectorAll('[data-dim][data-val]').forEach(el=>{
    const act = ()=>{ const d=el.dataset.dim, v=el.dataset.val; mh[d]=(mh[d]===v)?'All':v; mhSyncUrl(); renderMarketHeat(); };
    el.addEventListener('click', act);
    el.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); act(); } });
  });
}

/* the one unified table; columns with no data anywhere in view are hidden */
let MH_VIEW = [];   // current filtered rows, for drawer lookup
function mhTable(){
  const rows = mhFiltered();
  MH_VIEW = rows;
  const blank = '<span class="subtle tiny">—</span>';
  const pend  = '<span class="pending-cell">Pending</span>';
  const has = (v)=> v!=null && v!=='';
  const COLS = [
    {k:'name',   h:'Company',    always:1, cell:r=>companyCellRec(r)},
    {k:'board',  h:'Board',      val:r=>r.board,  cell:r=>boardChip(r.board,false)||blank},
    {k:'sector', h:'Sector',     val:r=>r.sector, cell:r=>r.sector?esc(r.sector):blank, cls:'subtle'},
    {k:'sub',    h:'Sub-sector', val:r=>r.subSector, cell:r=>r.subSector?esc(r.subSector):blank, cls:'subtle'},
    {k:'ftype',  h:'Filing Type', val:r=>r.filingType, cell:r=>r.filingType?esc(r.filingType):blank, cls:'subtle'},
    {k:'stage',  h:'Current Stage', always:1, cell:r=>stageChip(r.stage)||blank},
    {k:'fdate',  h:'Filing Date', val:r=>r.filingDate, cell:r=>r.filingDate?dfmt(r.filingDate):blank, cls:'subtle'},
    {k:'idate',  h:'Issue Date',  val:r=>r.issueOpen, cell:r=>r.issueOpen?dfmt(r.issueOpen):blank, cls:'subtle'},
    {k:'ldate',  h:'Listing Date',val:r=>r.listingDate, cell:r=>r.listingDate?dfmt(r.listingDate):blank, cls:'subtle'},
    {k:'itype',  h:'Issue Type',  val:r=>r.issueType, cell:r=>r.issueType?esc(r.issueType):blank, cls:'subtle'},
    {k:'fresh',  h:'Fresh (₹ Cr)',num:1, val:r=>r.freshCr, cell:r=>r.freshCr==null?blank:money(r.freshCr)},
    {k:'ofs',    h:'OFS (₹ Cr)',  num:1, val:r=>r.ofsCr, cell:r=>r.ofsCr==null?blank:money(r.ofsCr)},
    {k:'size',   h:'Total Issue (₹ Cr)',num:1, val:r=>r.issueSizeCr, cell:r=>r.issueSizeCr==null?blank:money(r.issueSizeCr)},
    {k:'sub_x',  h:'Subscription',num:1, val:r=>r.subscriptionX, cell:r=>r.subscriptionX==null?blank:subx(r.subscriptionX)},
    {k:'iprice', h:'Issue Price', num:1, val:r=>r.issuePrice, cell:r=>r.issuePrice==null?blank:'₹'+money(r.issuePrice)},
    {k:'cprice', h:'Current Price',num:1, val:r=>r.currentPrice, cell:r=>r.currentPrice==null?pend:'₹'+money(r.currentPrice)},
    {k:'gain',   h:'Gain / Loss', num:1, val:r=>r.gainPct, cell:r=>r.gainPct==null?pend:pct(r.gainPct)},
    {k:'score',  h:'Score',       num:1, val:r=>r.score, cell:r=>r.score==null?blank:scoreNum(r.score), cls:'score-cell'},
    {k:'reco',   h:'Reco.',       val:r=>r.bucket, cell:r=>r.bucket?bucketTag(r.bucket):blank},
    {k:'ds',     h:'Data Status', always:1, cell:r=>dsRec(r)},
    {k:'src',    h:'Source',      always:1, cell:r=>srcRec(r)},
  ];
  const cols = COLS.filter(c=>c.always || rows.some(r=>has(c.val(r))));
  const thead = `<thead><tr>${cols.map(c=>`<th class="${c.num?'num':''}">${c.h}</th>`).join('')}</tr></thead>`;
  const body = rows.map((r,i)=>`<tr class="mh-row" data-idx="${i}">${
      cols.map(c=>`<td class="${c.cls||''} ${c.num?'num':''}">${c.cell(r)}</td>`).join('')
    }</tr>`).join('');
  const table = document.getElementById('mh-table');
  if(rows.length){
    table.innerHTML = thead + `<tbody>${body}</tbody>`;
    document.getElementById('mh-foot').innerHTML =
      `Current price &amp; listing gain/loss are held pending — NSE’s price feed is unavailable (never estimated). Click any row for the full record.`;
  } else {
    table.innerHTML = `<tbody><tr><td class="mh-empty">
      <div class="mh-empty-box">No records match these filters.
      <button class="mh-clear-inline">Clear filters</button></div></td></tr></tbody>`;
    document.getElementById('mh-foot').innerHTML = '';
    const cl = table.querySelector('.mh-clear-inline');
    if(cl) cl.addEventListener('click',()=>{ mh = mhReset(); mhSyncUrl(); renderMarketHeat(); });
  }
  document.getElementById('mh-count').textContent = `${rows.length} of ${MARKET.length} records`;
  table.querySelectorAll('.mh-row').forEach(tr=>tr.addEventListener('click', e=>{
    if(e.target.closest('a')) return;       // let source links work normally
    openDrawer(MH_VIEW[+tr.dataset.idx]);
  }));
}

/* record-aware versions of the company / source / data-status cells */
function companyCellRec(r){
  const url = r.sources && (r.sources.sebi_url || r.sources.drhp_pdf_url);
  const name = url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name);
  return `<div class="company">${name}</div>`;
}
function srcRec(r){
  const s = r.sources || {};
  const out = [];
  if(s.drhp_pdf_url) out.push(`<a class="src-link pdf" href="${esc(s.drhp_pdf_url)}" target="_blank" rel="noopener">${PDF_SVG} PDF</a>`);
  if(s.sebi_url)     out.push(`<a class="src-link" href="${esc(s.sebi_url)}" target="_blank" rel="noopener">${LINK_SVG} SEBI</a>`);
  if(!out.length && (r.origin==='nse'||r.origin==='both')) return `<span class="src-tag">NSE</span>`;
  return out.length ? `<div class="src">${out.join('')}</div>` : '<span class="subtle tiny">—</span>';
}
function dsRec(r){
  if(r.bucket && r.bucket!=='INSUFFICIENT') return `<span class="ds-chip ok">Complete</span>`;
  if(r.origin==='nse') return `<span class="ds-chip mkt">Market data</span>`;
  return `<span class="ds-chip miss">Awaiting financials</span>`;
}

/* ---------------- Tab 3: Score Watchlist ---------------- */
let WATCH_VIEW = [];
function renderWatchlist(){
  const f = filteredFilings().sort((a,b)=>(b.score.total??-1)-(a.score.total??-1));
  WATCH_VIEW = f;
  document.getElementById('watchlist').innerHTML = f.map((x,i)=>{
    const fin=x.financials;
    const bm = x.business_summary
      ? `<span class="bizclamp" title="${esc(x.business_summary)}">${esc(x.business_summary)}</span>`
      : '<span class="subtle tiny">—</span>';
    return `<tr class="wl-row" data-idx="${i}">
      <td class="num subtle">${i+1}</td>
      <td>${companyCell(x)}<div class="row-chips">${boardChip(x.board,false)}${stageChip(x.current_stage)}${dataStatusChip(x)}${stamps(x.stamps)}</div></td>
      <td class="subtle">${esc(x.sector||'—')}${x.sub_sector?` · ${esc(x.sub_sector)}`:''}</td>
      <td>${bm}</td>
      <td class="num">${money(x.issue.total_cr)}</td>
      <td class="num">${fcell(fin.rev_growth_pct,'pct')}</td>
      <td class="num">${fcell(fin.ebitda_margin_pct,'pct')}</td>
      <td class="num">${fcell(fin.pat_growth_pct,'pct')}</td>
      <td class="num">${fcell(fin.pat_margin_pct,'pct')}</td>
      <td class="num score-cell">${scoreNum(x.score.total)}</td>
      <td>${bucketTag(x.score.bucket)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="11" class="subtle">No filings this week.</td></tr>`;
  document.querySelectorAll('#watchlist .wl-row').forEach(tr=>tr.addEventListener('click', e=>{
    if(e.target.closest('a')) return;
    openDrawer(filingToRec(WATCH_VIEW[+tr.dataset.idx]));
  }));
}

/* ---------------- Tab 4: Competitor Watch ---------------- */
function renderCompetitor(){
  const host = document.getElementById('competitor');
  const f = DATA.filings || [], m = ipoMarket();
  const bySector = {};
  f.forEach(x => { const s = x.sector || 'Unclassified'; (bySector[s] = bySector[s] || []).push(x); });
  const clusters = Object.entries(bySector).filter(([, a]) => a.length >= 2);
  const sectorsThisWeek = new Set(f.map(x => x.sector).filter(Boolean));
  const openPeers = (m.open_upcoming || []).filter(r => r.sector && sectorsThisWeek.has(r.sector));
  const listedPeers = (m.recent_listings || []).filter(r => r.sector && sectorsThisWeek.has(r.sector));

  const cards = [
    {label:'New DRHPs this week', n:f.filter(x=>x.stage==='DRHP').length, sub:`across ${sectorsThisWeek.size} sectors`},
    {label:'Same-sector IPOs open', n:openPeers.length, sub:m.available?'from NSE pipeline':'pending source'},
    {label:'Same-sector recent listings', n:listedPeers.length, sub:m.available?'last 120 days':'pending source'},
  ];
  const ins = [];
  clusters.forEach(([s,a]) => ins.push(`<b>${esc(s)}</b> is clustering — ${a.length} companies entered the primary market this week.`));
  if(openPeers.length) ins.push(`${openPeers.length} same-sector IPO${openPeers.length>1?'s are':' is'} currently open on NSE.`);
  if(!ins.length) ins.push('No same-sector clustering detected in this week’s filings.');

  // same-sector comparison: business model + financials + issue structure,
  // with entirely-empty columns (e.g. Market Cap) hidden automatically
  const dash = '<span class="subtle tiny">—</span>';
  const peers = filteredFilings();
  const fv = (x,k)=> x.financials && x.financials[k] ? x.financials[k] : null;
  const CC = [
    {h:'Company', always:1, cell:x=>`<span class="company">${esc(x.company_name)}</span>`},
    {h:'Sector', always:1, cls:'subtle', cell:x=>esc(x.sector||'—')},
    {h:'Sub-sector', cls:'subtle', get:x=>x.sub_sector, cell:x=>x.sub_sector?esc(x.sub_sector):dash},
    {h:'Business Model', get:x=>x.business_summary, cell:x=>x.business_summary?`<span class="bizclamp" title="${esc(x.business_summary)}">${esc(x.business_summary)}</span>`:dash},
    {h:'Revenue FY25', num:1, get:x=>fv(x,'revenue_fy25')&&fv(x,'revenue_fy25').value, cell:x=>fcell(fv(x,'revenue_fy25'),'money')},
    {h:'Rev Growth', num:1, get:x=>fv(x,'rev_growth_pct')&&fv(x,'rev_growth_pct').value, cell:x=>fcell(fv(x,'rev_growth_pct'),'pct')},
    {h:'EBITDA Margin', num:1, get:x=>fv(x,'ebitda_margin_pct')&&fv(x,'ebitda_margin_pct').value, cell:x=>fcell(fv(x,'ebitda_margin_pct'),'pct')},
    {h:'PAT Margin', num:1, get:x=>fv(x,'pat_margin_pct')&&fv(x,'pat_margin_pct').value, cell:x=>fcell(fv(x,'pat_margin_pct'),'pct')},
    {h:'Issue (₹ Cr)', num:1, get:x=>x.issue.total_cr, cell:x=>x.issue.total_cr!=null?money(x.issue.total_cr):dash},
    {h:'Market Cap (₹ Cr)', num:1, get:x=>x.issue.market_cap_cr, cell:x=>x.issue.market_cap_cr!=null?money(x.issue.market_cap_cr):dash},
    {h:'Issue/MktCap', num:1, get:x=>x.issue.issue_to_mktcap_pct, cell:x=>x.issue.issue_to_mktcap_pct!=null?pct(x.issue.issue_to_mktcap_pct):dash},
  ];
  const has = g => peers.some(x=>{ const v=g(x); return v!=null && v!==''; });
  const cc = CC.filter(c=>c.always || (c.get && has(c.get)));
  const cthead = `<thead><tr>${cc.map(c=>`<th class="${c.num?'num':''}">${c.h}</th>`).join('')}</tr></thead>`;
  const crows = peers.map(x=>`<tr>${cc.map(c=>`<td class="${c.cls||''} ${c.num?'num':''}">${c.cell(x)}</td>`).join('')}</tr>`).join('')
    || `<tr><td colspan="${cc.length}" class="subtle">No filings this week.</td></tr>`;

  host.innerHTML = `
    <div class="kpi-grid block" style="grid-template-columns:repeat(3,1fr)">
      ${cards.map(c=>`<div class="kpi"><div class="kpi-label">${c.label}</div><div class="kpi-value">${c.n}</div><div class="tiny muted" style="margin-top:6px">${c.sub}</div></div>`).join('')}
    </div>
    <div class="card block">
      <div class="panel-head"><h3>Same-Sector Comparison</h3><span class="muted tiny">Compare business model, growth and margins within a sector</span></div>
      <div class="table-wrap"><table>${cthead}<tbody>${crows}</tbody></table></div>
    </div>
    <div class="card block">
      <div class="panel-head"><h3>Why this matters</h3></div>
      <ul class="alert-list">${ins.map(t=>`<li><span class="alert-dot green"></span><div>${t}</div></li>`).join('')}</ul>
      <div class="stage2-note">Portfolio-specific competitor mapping (your holdings vs each filing) activates in Stage 2 once your portfolio list is connected.</div>
    </div>`;
}

/* ---------------- Tab 5: Tracker Appendix ---------------- */
function renderAppendix(){
  const f = DATA.filings || [];
  const sectors = [...new Set(f.map(x=>x.sector).filter(Boolean))].sort();
  const stages = [...new Set(f.map(x=>x.current_stage).filter(Boolean))];
  const buckets = ['DIG DEEPER','MONITOR','WATCH','INSUFFICIENT'];
  const sel = (id,label,opts) => `<label class="apx-f"><span>${label}</span><select data-f="${id}">
    <option value="All">All</option>${opts.map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select></label>`;
  const tb = document.getElementById('appendix-filters');
  if(tb && !tb.dataset.wired){
    tb.innerHTML = `<span class="apx-title">Filters</span>
      ${sel('board','Board',['Mainboard','SME'])}${sel('stage','Stage',stages)}
      ${sel('sector','Sector',sectors)}${sel('bucket','Reco.',buckets)}
      <button class="fchip" id="apx-reset">Reset</button>`;
    tb.dataset.wired = '1';
    tb.querySelectorAll('select').forEach(s=>s.addEventListener('change',()=>{apxFilter[s.dataset.f]=s.value; renderAppendixRows();}));
    tb.querySelector('#apx-reset').addEventListener('click',()=>{
      apxFilter={board:'All',stage:'All',sector:'All',bucket:'All'};
      tb.querySelectorAll('select').forEach(s=>s.value='All'); renderAppendixRows();
    });
  }
  renderAppendixRows();
  renderCoverage();
  renderIpoPipeline();
}

let APX_VIEW = [];
function renderAppendixRows(){
  const dash = '<span class="subtle tiny">—</span>';
  const recs = (DATA.filings||[]).map(filingToRec).filter(r=>
    (apxFilter.board==='All'  || r.board===apxFilter.board) &&
    (apxFilter.stage==='All'  || r.stage===apxFilter.stage) &&
    (apxFilter.sector==='All' || r.sector===apxFilter.sector) &&
    (apxFilter.bucket==='All' || r.bucket===apxFilter.bucket));
  APX_VIEW = recs;
  const fin  = (r,k)=> r.financials && r.financials[k] ? r.financials[k] : null;
  const fval = (r,k)=> { const mv=fin(r,k); return mv?mv.value:null; };
  const biz  = (s)=> `<span class="bizclamp" title="${esc(s)}">${esc(s)}</span>`;
  const COLS = [
    {h:'Company', always:1, cell:r=>companyCellRec(r)},
    {h:'Board', val:r=>r.board, cell:r=>boardChip(r.board,false)||dash},
    {h:'Stage', always:1, cell:r=>stageChip(r.stage)||dash},
    {h:'SEBI Filing Date', cls:'subtle', val:r=>r.filingDate, cell:r=>r.filingDate?dfmt(r.filingDate):dash},
    {h:'Filing Type', cls:'subtle', val:r=>r.filingType, cell:r=>r.filingType?esc(r.filingType):dash},
    {h:'Sector', cls:'subtle', val:r=>r.sector, cell:r=>r.sector?esc(r.sector):dash},
    {h:'Sub-sector', cls:'subtle', val:r=>r.subSector, cell:r=>r.subSector?esc(r.subSector):dash},
    {h:'Business Model', val:r=>r.businessSummary, cell:r=>r.businessSummary?biz(r.businessSummary):dash},
    {h:'Issue Type', cls:'subtle', val:r=>r.issueType, cell:r=>r.issueType?esc(r.issueType):dash},
    {h:'Fresh (₹ Cr)', num:1, val:r=>r.freshCr, cell:r=>r.freshCr==null?dash:money(r.freshCr)},
    {h:'OFS (₹ Cr)', num:1, val:r=>r.ofsCr, cell:r=>r.ofsCr==null?dash:money(r.ofsCr)},
    {h:'Total Issue (₹ Cr)', num:1, val:r=>r.issueSizeCr, cell:r=>r.issueSizeCr==null?dash:money(r.issueSizeCr)},
    {h:'Market Cap (₹ Cr)', num:1, val:r=>r.marketCapCr, cell:r=>r.marketCapCr==null?dash:money(r.marketCapCr)},
    {h:'Issue/MktCap', num:1, val:r=>r.issueToMktcapPct, cell:r=>r.issueToMktcapPct==null?dash:pct(r.issueToMktcapPct)},
    {h:'Revenue FY25', num:1, val:r=>fval(r,'revenue_fy25'), cell:r=>fcell(fin(r,'revenue_fy25'),'money')},
    {h:'Revenue FY24', num:1, val:r=>fval(r,'revenue_fy24'), cell:r=>fcell(fin(r,'revenue_fy24'),'money')},
    {h:'Rev Growth', num:1, val:r=>fval(r,'rev_growth_pct'), cell:r=>fcell(fin(r,'rev_growth_pct'),'pct')},
    {h:'EBITDA FY25', num:1, val:r=>fval(r,'ebitda_fy25'), cell:r=>fcell(fin(r,'ebitda_fy25'),'money')},
    {h:'EBITDA Margin', num:1, val:r=>fval(r,'ebitda_margin_pct'), cell:r=>fcell(fin(r,'ebitda_margin_pct'),'pct')},
    {h:'PAT FY25', num:1, val:r=>fval(r,'pat_fy25'), cell:r=>fcell(fin(r,'pat_fy25'),'money')},
    {h:'PAT FY24', num:1, val:r=>fval(r,'pat_fy24'), cell:r=>fcell(fin(r,'pat_fy24'),'money')},
    {h:'PAT Growth', num:1, val:r=>fval(r,'pat_growth_pct'), cell:r=>fcell(fin(r,'pat_growth_pct'),'pct')},
    {h:'PAT Margin', num:1, val:r=>fval(r,'pat_margin_pct'), cell:r=>fcell(fin(r,'pat_margin_pct'),'pct')},
    {h:'ROE', num:1, val:r=>fval(r,'roe_pct'), cell:r=>fcell(fin(r,'roe_pct'),'pct')},
    {h:'ROCE', num:1, val:r=>fval(r,'roce_pct'), cell:r=>fcell(fin(r,'roce_pct'),'pct')},
    {h:'Debt/Equity', num:1, val:r=>fval(r,'debt_equity'), cell:r=>fcell(fin(r,'debt_equity'),'ratio')},
    {h:'Asset Base (₹ Cr)', num:1, val:r=>fval(r,'asset_base_cr'), cell:r=>fcell(fin(r,'asset_base_cr'),'money')},
    {h:'Promoter Hold', num:1, val:r=>fval(r,'promoter_hold_pct'), cell:r=>fcell(fin(r,'promoter_hold_pct'),'pct')},
    {h:'Lead Managers', cls:'subtle', val:r=>r.leadManagers, cell:r=>r.leadManagers?esc(r.leadManagers.join(', ')):dash},
    {h:'Score', num:1, cls:'score-cell', always:1, cell:r=>scoreNum(r.score)},
    {h:'Reco.', always:1, cell:r=>r.bucket?bucketTag(r.bucket):dash},
    {h:'Source', always:1, cell:r=>srcRec(r)},
  ];
  const cols = COLS.filter(c=>c.always || recs.some(r=>{ const v=c.val(r); return v!=null && v!==''; }));
  const table = document.getElementById('appendix-table');
  if(!recs.length){
    table.innerHTML = `<tbody><tr><td class="subtle" style="padding:14px">No DRHP filings match these filters — see the IPO Pipeline (NSE) below for board/stage data.</td></tr></tbody>`;
    return;
  }
  const thead = `<thead><tr>${cols.map(c=>`<th class="${c.num?'num':''}">${esc(c.h)}</th>`).join('')}</tr></thead>`;
  const body = recs.map((r,i)=>`<tr class="apx-row" data-idx="${i}">${
      cols.map(c=>`<td class="${c.cls||''} ${c.num?'num':''}">${c.cell(r)}</td>`).join('')}</tr>`).join('');
  table.innerHTML = thead + `<tbody>${body}</tbody>`;
  table.querySelectorAll('.apx-row').forEach(tr=>tr.addEventListener('click', e=>{
    if(e.target.closest('a')) return;
    openDrawer(APX_VIEW[+tr.dataset.idx]);
  }));
}

/* Field Coverage audit — confirms nothing in the tracker is silently dropped */
function renderCoverage(){
  const host = document.getElementById('coverage'); if(!host) return;
  const fl = DATA.filings || [], N = fl.length;
  const present = (v)=> v!=null && v!=='';
  const fv = (f,k)=> f.financials[k] ? f.financials[k].value : null;
  const fields = [
    {name:'SEBI Filing Date', get:f=>f.filing_date},
    {name:'Filing Type', get:f=>f.filing_type},
    {name:'Sector', get:f=>f.sector},
    {name:'Sub-sector / Industry Tag', get:f=>f.sub_sector},
    {name:'Business Model Summary', get:f=>f.business_summary},
    {name:'Issue Type', get:f=>f.issue.type},
    {name:'Fresh Issue (₹ Cr)', get:f=>f.issue.fresh_cr},
    {name:'OFS (₹ Cr)', get:f=>f.issue.ofs_cr},
    {name:'Total Issue Size (₹ Cr)', get:f=>f.issue.total_cr},
    {name:'Market Cap (₹ Cr)', get:f=>f.issue.market_cap_cr},
    {name:'Issue / Market Cap', get:f=>f.issue.issue_to_mktcap_pct},
    {name:'Revenue FY25', get:f=>fv(f,'revenue_fy25'), score:1},
    {name:'Revenue FY24', get:f=>fv(f,'revenue_fy24')},
    {name:'Revenue Growth', get:f=>fv(f,'rev_growth_pct'), score:1},
    {name:'EBITDA FY25', get:f=>fv(f,'ebitda_fy25')},
    {name:'EBITDA Margin', get:f=>fv(f,'ebitda_margin_pct')},
    {name:'PAT FY25', get:f=>fv(f,'pat_fy25')},
    {name:'PAT FY24', get:f=>fv(f,'pat_fy24')},
    {name:'PAT Growth', get:f=>fv(f,'pat_growth_pct'), score:1},
    {name:'PAT Margin', get:f=>fv(f,'pat_margin_pct'), score:1},
    {name:'ROE', get:f=>fv(f,'roe_pct'), score:1},
    {name:'ROCE', get:f=>fv(f,'roce_pct'), score:1},
    {name:'Debt / Equity', get:f=>fv(f,'debt_equity')},
    {name:'Asset Base (₹ Cr)', get:f=>fv(f,'asset_base_cr')},
    {name:'Promoter Holding', get:f=>fv(f,'promoter_hold_pct')},
    {name:'Lead Managers', get:f=>(f.lead_managers&&f.lead_managers.length)?'y':null},
    {name:'Score', get:f=>f.score.total, score:1},
    {name:'Recommendation', get:f=>f.score.bucket},
    {name:'Source (SEBI / PDF)', get:f=>f.sources&&(f.sources.sebi_url||f.sources.drhp_pdf_url)},
  ];
  const rows = fields.map(fd=>{
    const avail = fl.filter(f=>present(fd.get(f))).length;
    const inDash = avail>0 ? '<span class="cov-yes">Yes</span>' : '<span class="cov-no">Hidden — no data</span>';
    return `<tr>
      <td>${esc(fd.name)}</td>
      <td class="num">${avail}/${N}</td>
      <td class="num">${N-avail}</td>
      <td>${inDash}</td>
      <td>${fd.score?'<span class="cov-yes">Yes</span>':'<span class="subtle">—</span>'}</td>
    </tr>`;
  }).join('');
  host.innerHTML = `<div class="card">
    <div class="panel-head"><h3>Field Coverage</h3><span class="muted tiny">Audit across ${N} filing${N!==1?'s':''} this week</span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Field</th><th class="num">Available</th><th class="num">Missing</th><th>In Dashboard</th><th>In Score</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="table-foot">“Available” counts filings where the field is disclosed. A column with 0 available is hidden in the tables above but tracked here, so no tracker field is silently dropped.</div>
  </div>`;
}

/* Turn one NSE pipeline row into the shared drawer record, folding in a matched
   SEBI filing's sources/financials/score when we happen to hold them. */
function nseToRec(r){
  const f = (DATA.filings||[]).find(x => x.company_name_normalized === normalizeName(r.company_name));
  return {
    name: r.company_name,
    board: r.board || (f && f.board) || null,
    sector: r.sector || (f && f.sector) || null,
    subSector: (f && f.sub_sector) || null,
    stage: r.stage || null,
    filingType: (f && f.filing_type) || null,
    filingDate: (f && f.filing_date) || null,
    issueOpen: r.issue_open || null, issueClose: r.issue_close || null, listingDate: r.listing_date || null,
    issueSizeCr: r.issue_size_cr, subscriptionX: r.subscription_x, issuePrice: r.issue_price,
    currentPrice: r.current_price, gainPct: r.gain_pct, priceBand: r.price_band, symbol: r.symbol,
    score: f && f.score ? f.score.total : null,
    bucket: f && f.score ? f.score.bucket : null,
    sources: f ? f.sources : null,
    financials: f ? f.financials : null,
    origin: f ? 'both' : 'nse',
  };
}

let IPO_VIEW = [];   // current pipeline rows as drawer records, for click lookup
function renderIpoPipeline(){
  const host = document.getElementById('ipo-pipeline'); if(!host) return;
  const m = ipoMarket();
  if(!m.available){
    host.innerHTML = `<div class="card"><div class="panel-head"><h3>IPO Pipeline (NSE)</h3></div>
      <div class="pending-tag">Pending source — NSE IPO data not reached this run.</div></div>`;
    return;
  }
  const allRows = [...(m.open_upcoming||[]), ...(m.recent_listings||[])];
  const total = allRows.length;
  const stagesPresent = [...new Set(allRows.map(r=>r.stage).filter(Boolean))]
    .sort((a,b)=>STAGE_ORDER.indexOf(a)-STAGE_ORDER.indexOf(b));
  const all = allRows.filter(r =>
    (ipoFilter.board==='All' || r.board===ipoFilter.board) &&
    (ipoFilter.stage==='All' || r.stage===ipoFilter.stage));
  const active = ipoFilter.board!=='All' || ipoFilter.stage!=='All';
  const note = active ? `${all.length} of ${total} · filtered` : `${total} issues`;
  IPO_VIEW = all.map(nseToRec);
  const pill = (dim, label, opts, disp)=>{
    const cur = ipoFilter[dim];
    const o = [`<option value="All" ${cur==='All'?'selected':''}>All</option>`]
      .concat(opts.map(v=>`<option value="${esc(v)}" ${cur===v?'selected':''}>${esc(disp?disp(v):v)}</option>`)).join('');
    return `<label class="mh-pill ${cur!=='All'?'on':''}"><span class="mh-pill-lbl">${label}</span><select class="mh-pill-sel" data-f="${dim}">${o}</select></label>`;
  };
  host.innerHTML = `<div class="card">
    <div class="panel-head ipo-head">
      <h3>IPO Pipeline — Full Tracker (NSE)</h3>
      <div class="ipo-filters">
        ${pill('board','Board',['Mainboard','SME'])}
        ${pill('stage','Stage',stagesPresent, stageLabel)}
        <button class="mh-ribbon-clear ${active?'':'hide'}" id="ipo-clear">Clear</button>
        <span class="muted tiny ipo-note">${note} · as of ${dfmt(m.as_of)}</span>
      </div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Company</th><th>Board</th><th>Stage</th><th>Open</th><th>Close</th><th>Listed</th><th>Price Band</th><th class="num">Size (₹ Cr)</th><th class="num">Sub.</th><th class="num">Gain/Loss</th></tr></thead>
      <tbody>${all.map((r,i)=>{
        const rec = IPO_VIEW[i];
        const badge = rec.sources && rec.sources.drhp_pdf_url ? `<span class="ipo-doc pdf" title="Exact prospectus PDF on file">PDF</span>`
                    : rec.sources && rec.sources.sebi_url ? `<span class="ipo-doc sebi" title="SEBI filing page on file">SEBI</span>` : '';
        return `<tr class="ipo-row" data-idx="${i}">
        <td class="company">${esc(r.company_name)}${badge}</td>
        <td>${boardChip(r.board)}</td>
        <td>${stageChip(r.stage)}</td>
        <td class="subtle">${r.issue_open?dfmt(r.issue_open):'—'}</td>
        <td class="subtle">${r.issue_close?dfmt(r.issue_close):'—'}</td>
        <td class="subtle">${r.listing_date?dfmt(r.listing_date):'—'}</td>
        <td class="subtle">${r.price_band?esc(r.price_band):'—'}</td>
        <td class="num">${r.issue_size_cr==null?'—':money(r.issue_size_cr)}</td>
        <td class="num">${subx(r.subscription_x)}</td>
        <td class="num"><span class="pending-cell">Pending</span></td></tr>`;}).join('')
        || `<tr><td colspan="10" class="subtle">No IPO issues match these filters — <button class="mh-clear-inline" id="ipo-clear-inline">Clear filters</button></td></tr>`}</tbody>
    </table></div>
    <div class="table-foot">Click any row for the full record we hold — dates, price band, issue size, subscription and source. Where we’ve scraped the SEBI filing, the panel links to the exact document (PDF/SEBI badge). Current price &amp; listing gain/loss aren’t in NSE’s feed — shown as pending, never estimated.</div>
  </div>`;
  host.querySelectorAll('.mh-pill-sel').forEach(s=>s.addEventListener('change',()=>{ ipoFilter[s.dataset.f]=s.value; renderIpoPipeline(); }));
  const reset = ()=>{ ipoFilter={board:'All',stage:'All'}; renderIpoPipeline(); };
  const cl = host.querySelector('#ipo-clear'); if(cl) cl.addEventListener('click', reset);
  const cli = host.querySelector('#ipo-clear-inline'); if(cli) cli.addEventListener('click', reset);
  host.querySelectorAll('.ipo-row').forEach(tr=>tr.addEventListener('click', e=>{
    if(e.target.closest('a')) return;
    openDrawer(IPO_VIEW[+tr.dataset.idx]);
  }));
}

function renderFooter(){
  document.getElementById('foot-meta').textContent =
    `Generated ${dfmt(DATA.meta.run_date)} · snapshot ${DATA.meta.snapshot_id} · source: SEBI public filings`;
}

/* ---------------- Weekly Snapshot: Primary Issuance Pulse ---------------- */
function renderPulse(){
  const el = document.getElementById('pulse-strip'); if(!el) return;
  const m = ipoMarket();
  if(!m.available){
    el.innerHTML = `<div class="pulse-card"><div class="pulse-head"><span class="eyebrow">Primary Issuance Pulse</span>
      <span class="pending-tag">Pending source — NSE not reached this run</span></div></div>`;
    return;
  }
  const p = m.pulse||{};
  const items = [
    {k:'drhp_filed',  label:'DRHP Filed',   cls:'slate', stage:'DRHP Filed'},
    {k:'updated',     label:'Updated',      cls:'gold',  stage:'Updated/Corrected'},
    {k:'ipo_open',    label:'IPO Open',     cls:'green', stage:'IPO Open'},
    {k:'listing_soon',label:'Listing Soon', cls:'gold',  stage:'Listing Soon'},
    {k:'listed',      label:'Listed',       cls:'teal',  stage:'Listed'},
    {k:'positive_listing', label:'Positive', cls:'green'},
    {k:'negative_listing', label:'Negative', cls:'red'},
  ];
  el.innerHTML = `<div class="pulse-card">
    <div class="pulse-head"><span class="eyebrow">Primary Issuance Pulse</span>
      <span class="muted tiny">Lifecycle · NSE as of ${dfmt(m.as_of)}</span></div>
    <div class="pulse-row">${items.map(it=>{
      const v=p[it.k]; const na=(v==null);
      const nav = it.stage ? ` clickable" data-pstage="${esc(it.stage)}" role="button" tabindex="0` : '';
      return `<div class="pulse-item${nav}"><span class="pulse-dot ${it.cls}"></span>
        <span class="pulse-val ${na?'na':''}">${na?'—':v}</span><span class="pulse-lab">${it.label}</span></div>`;
    }).join('<span class="pulse-sep">›</span>')}</div>
    <div class="tiny muted pulse-note">Positive / Negative listing need listing-day price — pending source.</div>
  </div>`;
}

/* ---------------- Navigation (sidebar tabs) ---------------- */
function activateTab(id){
  document.querySelectorAll('.snav, .pill').forEach(b => b.classList.toggle('active', b.dataset.target===id));
  document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id!==id));
  const c = document.querySelector('.content'); if(c) c.scrollIntoView({block:'start', behavior:'smooth'});
}
function wireNav(){
  document.querySelectorAll('.snav, .pill').forEach(b => b.addEventListener('click', () => activateTab(b.dataset.target)));
}

/* ---------------- Connected navigation into Market Heat ---------------- */
function goMarketHeat(presets){
  mh = {...mhReset(), ...presets};
  activateTab('tab-heat');
  mhSyncUrl();
  renderMarketHeat();
}
/* keep the URL shareable: ?board=SME&sector=Consumer&stage=IPO_OPEN&reco=DIG_DEEPER */
function mhSyncUrl(){
  const p = new URLSearchParams();
  MH_DIMS.forEach(d=>{
    if(mh[d.key]!=='All') p.set(d.urlk, d.keymap ? (d.keymap[mh[d.key]]||mh[d.key]) : mh[d.key]);
  });
  const qs = p.toString();
  history.replaceState(null, '', qs ? ('?'+qs) : location.pathname);
}
function mhFromUrl(){
  const p = new URLSearchParams(location.search);
  if(![...p.keys()].length) return false;
  let any = false;
  MH_DIMS.forEach(d=>{
    const raw = p.get(d.urlk);
    if(raw){ mh[d.key] = d.keymap ? (invert(d.keymap)[raw]||raw) : raw; any=true; }
  });
  return any;
}

/* KPI cards and landing-page chips funnel into the Market Heat explorer */
function wireKpiSelect(){
  const grid = document.getElementById('kpi-grid');
  if(!grid) return;
  grid.addEventListener('click', e => {
    const k = e.target.closest('.kpi[data-fk]'); if(!k) return;
    const fk = k.dataset.fk, fv = k.dataset.fv;
    if(fk==='bucket') goMarketHeat({reco: fv});
    else if(fk==='stage') goMarketHeat({stage: fv==='DRHP' ? 'DRHP Filed' : 'IPO Open'});
  });
}
function wireCrossNav(){
  const sec = document.getElementById('sectors');
  const onSec = e => { const c = e.target.closest('[data-sector]'); if(c){ e.preventDefault(); goMarketHeat({sector: c.dataset.sector}); } };
  if(sec){ sec.addEventListener('click', onSec); sec.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' ') onSec(e); }); }
  const pulse = document.getElementById('pulse-strip');
  const onPulse = e => { const it = e.target.closest('[data-pstage]'); if(it){ e.preventDefault(); goMarketHeat({stage: it.dataset.pstage}); } };
  if(pulse){ pulse.addEventListener('click', onPulse); pulse.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' ') onPulse(e); }); }
}

/* ---------------- Row detail drawer ---------------- */
function wireDrawer(){
  const ov = document.getElementById('mh-drawer-overlay');
  if(ov) ov.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeDrawer(); });
}
function closeDrawer(){
  const d = document.getElementById('mh-drawer'), ov = document.getElementById('mh-drawer-overlay');
  if(d){ d.hidden = true; d.setAttribute('aria-hidden','true'); }
  if(ov) ov.hidden = true;
}
function openDrawer(r){
  if(!r) return;
  const d = document.getElementById('mh-drawer'), ov = document.getElementById('mh-drawer-overlay');
  const row = (lab, val)=> `<div class="dw-row"><span class="dw-k">${lab}</span><span class="dw-v">${val}</span></div>`;
  const dates = [
    r.filingDate && row('Filing date', dfmt(r.filingDate)),
    (r.issueOpen||r.issueClose) && row('Issue window', `${r.issueOpen?dfmt(r.issueOpen):'—'}${r.issueClose?' – '+dfmt(r.issueClose):''}`),
    r.listingDate && row('Listing date', dfmt(r.listingDate)),
  ].filter(Boolean).join('');
  const issue = [
    r.issueType && row('Issue type', esc(r.issueType)),
    r.freshCr!=null && row('Fresh issue', '₹'+money(r.freshCr)+' Cr'),
    r.ofsCr!=null && row('Offer for sale', '₹'+money(r.ofsCr)+' Cr'),
    r.issueSizeCr!=null && row('Total issue size', '₹'+money(r.issueSizeCr)+' Cr'),
    r.marketCapCr!=null && row('Market cap', '₹'+money(r.marketCapCr)+' Cr'),
    r.issueToMktcapPct!=null && row('Issue / market cap', pct(r.issueToMktcapPct)),
    r.priceBand && row('Price band', esc(r.priceBand)),
    r.subscriptionX!=null && row('Subscription', subx(r.subscriptionX)),
    r.issuePrice!=null && row('Issue price', '₹'+money(r.issuePrice)),
  ].filter(Boolean).join('');
  const market = [
    row('Current price', '<span class="pending-cell">Pending</span>'),
    row('Listing gain / loss', '<span class="pending-cell">Pending</span>'),
  ].join('');
  const fin = r.financials || {};
  const frow = (lab, mv, kind)=> (mv && mv.value!=null) ? row(lab, fcell(mv, kind)) : '';
  const financials = [
    frow('Revenue FY25', fin.revenue_fy25, 'money'),
    frow('Revenue FY24', fin.revenue_fy24, 'money'),
    frow('Revenue growth', fin.rev_growth_pct, 'pct'),
    frow('EBITDA FY25', fin.ebitda_fy25, 'money'),
    frow('EBITDA margin', fin.ebitda_margin_pct, 'pct'),
    frow('PAT FY25', fin.pat_fy25, 'money'),
    frow('PAT FY24', fin.pat_fy24, 'money'),
    frow('PAT growth', fin.pat_growth_pct, 'pct'),
    frow('PAT margin', fin.pat_margin_pct, 'pct'),
    frow('ROE', fin.roe_pct, 'pct'),
    frow('ROCE', fin.roce_pct, 'pct'),
    frow('Debt / equity', fin.debt_equity, 'ratio'),
    frow('Asset base', fin.asset_base_cr, 'money'),
    frow('Promoter holding', fin.promoter_hold_pct, 'pct'),
  ].filter(Boolean).join('');
  // honest "what's missing" notes
  const missing = [];
  missing.push('Current price &amp; listing gain/loss: pending — NSE’s live price feed is unavailable, never estimated.');
  if(!financials) missing.push('Financials: not disclosed in the filing (or no SEBI document) — shown as awaiting data, never assumed.');
  if(!r.sector) missing.push('Sector: unclassified — NSE-only listings don’t carry a sector tag.');
  if(r.issueSizeCr==null) missing.push('Issue size: not yet disclosed (common for draft filings before a price band is set).');

  d.innerHTML = `
    <div class="dw-head">
      <div>
        <div class="dw-title">${esc(r.name)}</div>
        <div class="dw-chips">${boardChip(r.board,false)}${stageChip(r.stage)}${r.bucket?bucketTag(r.bucket):''}${dsRec(r)}</div>
      </div>
      <button class="dw-close" id="dw-close" aria-label="Close">✕</button>
    </div>
    <div class="dw-body">
      <div class="dw-sec">
        ${row('Sector', r.sector?esc(r.sector):'<span class="subtle">Unclassified</span>')}
        ${r.subSector?row('Sub-sector', esc(r.subSector)):''}
        ${r.filingType?row('Document', esc(r.filingType)):''}
        ${r.symbol?row('NSE symbol', esc(r.symbol)):''}
        ${r.leadManagers?row('Lead managers', esc(r.leadManagers.join(', '))):''}
        ${r.score!=null?row('Automated score', scoreNum(r.score)):''}
      </div>
      ${r.businessSummary?`<div class="dw-h">Business model</div><div class="dw-biz">${esc(r.businessSummary)}</div>`:''}
      ${dates?`<div class="dw-h">Timeline</div><div class="dw-sec">${dates}</div>`:''}
      ${issue?`<div class="dw-h">Issue structure</div><div class="dw-sec">${issue}</div>`:''}
      <div class="dw-h">Market &amp; listing</div><div class="dw-sec">${market}</div>
      ${financials?`<div class="dw-h">Financials (from the filing)</div><div class="dw-sec">${financials}</div>`:''}
      <div class="dw-h">Sources</div><div class="dw-sec dw-src">${srcRec(r)}</div>
      <div class="dw-h">What’s missing &amp; why</div>
      <ul class="dw-missing">${missing.map(t=>`<li>${t}</li>`).join('')}</ul>
    </div>`;
  d.hidden = false; d.setAttribute('aria-hidden','false');
  ov.hidden = false;
  const c = document.getElementById('dw-close'); if(c) c.addEventListener('click', closeDrawer);
}

document.addEventListener('DOMContentLoaded', main);
