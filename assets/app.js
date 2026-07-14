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
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  check:'<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
  xmark:'<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  rocket:'<path d="M12 3c3 1.5 5 5 5 9l-2 3H9l-2-3c0-4 2-7.5 5-9z"/><path d="M9 15l-2 4 3-1M15 15l2 4-3-1"/><circle cx="12" cy="9.5" r="1.4"/>',
};
/* sector → tile icon (falls back to a generic building) */
const SECTOR_ICON = {
  Consumer:'people', Financials:'bank', Healthcare:'cross', Materials:'cube',
  Industrials:'chart', Technology:'spark', Energy:'flame',
};
/* lifecycle stage → story-bar icon */
const STAGE_ICON = {
  'DRHP Filed':'doc', 'Updated/Corrected':'spark', 'Approved':'check', 'Upcoming':'clock',
  'IPO Open':'rocket', 'Listing Soon':'flame', 'Listed':'check', 'Withdrawn':'xmark',
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

function fcell(mv, kind){
  const v = mv ? mv.value : null;
  return kind==='money'?money(v):kind==='ratio'?ratio(v):pct(v);
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

function deltaPill(d, action){
  // No prior week to compare: the card is clickable, so label it by its action.
  if(d==null) return `<div class="delta action">${esc(action||'View')} <span class="da-arrow">→</span></div>`;
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
function mhReset(){ return {board:'All', stage:'All', sector:'All', reco:'All', subSector:'All', filingType:'All', issueType:'All', window:'All'}; }
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
    freshShares: iss.fresh_shares ?? null,
    ofsShares: iss.ofs_shares ?? null,
    totalShares: iss.total_shares ?? null,
    faceValue: iss.face_value ?? null,
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

/* time-window layer — keep only records active within the last N days, measured
   against the snapshot's as-of date (not the viewer's clock, so shared links stay
   stable). "Active" = the most recent lifecycle date a record carries (filing,
   issue window or listing), so drafts filter on their filing date while listed
   IPOs filter on when they listed. Anything current or upcoming is always kept. */
const MH_WINDOWS = [['All','Any time'],['30','Last 30 days'],['60','Last 60 days'],['90','Last 90 days']];
function mhWindowLabel(v){ const o = MH_WINDOWS.find(w=>w[0]===v); return o ? o[1] : v; }
function mhAsOf(){ const m = DATA && DATA.meta; return (m && (m.data_as_of || m.run_date)) || null; }
function daysSince(iso, refIso){
  const t = Date.parse(iso), r = Date.parse(refIso);
  if(isNaN(t) || isNaN(r)) return null;
  return Math.round((r - t) / 86400000);
}
/* most recent lifecycle date on a record (ISO strings sort chronologically,
   so max() naturally ignores any stale sub-date) */
function rowRecency(r){
  const c = [r.filingDate, r.issueOpen, r.issueClose, r.listingDate].filter(Boolean);
  return c.length ? c.reduce((a,b)=> a>b ? a : b) : null;
}
function mhInWindow(r){
  if(mh.window === 'All') return true;
  const asOf = mhAsOf(), ref = rowRecency(r);
  if(!asOf || !ref) return false;               // undated record → excluded once a window is set
  const d = daysSince(ref, asOf);
  return d !== null && d <= (+mh.window);        // keep current/upcoming (d<=0) and up to N days old
}

/* one record matches the current filter set, optionally ignoring one dimension
   (so a facet's own chart still shows every still-clickable option) */
function mhMatch(r, except){
  for(const d of MH_DIMS){
    if(d.key===except) continue;
    if(mh[d.key]!=='All' && d.val(r)!==mh[d.key]) return false;
  }
  if(except!=='window' && !mhInWindow(r)) return false;
  return true;
}
function mhFiltered(except){ return MARKET.filter(r=>mhMatch(r, except)); }
function mhActive(){ return MH_DIMS.some(d=>mh[d.key]!=='All') || mh.window!=='All'; }

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
  await loadScoringConfig();
  await loadPrevSnapshot();
  buildMarket();
  rescoreAll();
  renderHeader();
  renderWeekly();
  renderPipeline();
  renderArchive();
  renderFooter();
  wireNav();
  wireModalHost();
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
    {k:'doc',     cls:'kv1', label:'New DRHPs',        action:'View New DRHPs', val:s.new_drhp_count, dl:d&&d.new_drhp, fk:'stage',  fv:'DRHP'},
    {k:'trend',   cls:'kv2', label:'IPOs / Prospects', action:'View IPOs',      val:s.new_ipo_count,  dl:d&&d.new_ipo,  fk:'stage',  fv:'IPO'},
    {k:'target',  cls:'kv3', label:'Dig Deeper',       action:'View Dig Deeper',val:s.buckets.dig_deeper, dl:d&&d.dig_deeper, fk:'bucket', fv:'DIG DEEPER'},
    {k:'eye',     cls:'kv4', label:'Monitor',          action:'View Monitor',   val:s.buckets.monitor,    dl:d&&d.monitor,    fk:'bucket', fv:'MONITOR'},
    {k:'bookmark',cls:'kv5', label:'Watch',            action:'View Watch',     val:s.buckets.watch,      dl:d&&d.watch,      fk:'bucket', fv:'WATCH'},
  ];
  const isSel = c => kpiFilter && kpiFilter.kind===c.fk && kpiFilter.value===c.fv;
  document.getElementById('kpi-grid').innerHTML = kpis.map(c => `
    <div class="kpi ${c.cls} ${isSel(c)?'selected':''}" data-fk="${c.fk}" data-fv="${esc(c.fv)}" title="View ${esc(c.label)} in Market Heat">
      <div class="kpi-icon">${icon(c.k,20)}</div>
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value">${c.val}</div>
      ${deltaPill(c.dl===undefined?null:c.dl, c.action)}
    </div>`).join('');

  const st = document.getElementById('snapshot-status');
  if(st) st.innerHTML = s.deltas ? '' : `<span class="baseline-chip">Baseline week · no prior week to compare</span>`;

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
      `<div class="pending-tag">Market data is being updated.</div>`;
    return;
  }
  mhSnapshot();
  mhSelectors();
  mhSummary();
  mhBenchmark();
  mhDonut();
  mhInsightsCard();
  mhTable();
}

/* only these three dimensions appear as dropdown selectors; the rest stay
   filterable through the visuals (donut legend = recommendation, bars = sector) */
const RIBBON_KEYS = ['issueType','stage','sector'];

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
  const ribbonDims = RIBBON_KEYS.map(k=>MH_DIMS.find(d=>d.key===k)).filter(Boolean);
  /* fixed-option time window — sits in the ribbon alongside the data-driven pills */
  const windowPill = `<label class="mh-pill ${mh.window!=='All'?'on':''}">
      <span class="mh-pill-lbl">Timeframe</span>
      <select class="mh-pill-sel" data-dim="window">${
        MH_WINDOWS.map(([v,l])=>`<option value="${v}" ${mh.window===v?'selected':''}>${l}</option>`).join('')
      }</select></label>`;
  host.innerHTML = `
    <div class="mh-ribbon-pills">${ribbonDims.map(pill).join('')}${windowPill}</div>
    <button class="mh-ribbon-clear ${mhActive()?'':'hide'}">Clear all</button>`;
  host.querySelectorAll('.mh-pill-sel').forEach(s=>s.addEventListener('change',()=>{
    mh[s.dataset.dim] = s.value; mhSyncUrl(); renderMarketHeat();
  }));
  const cl = host.querySelector('.mh-ribbon-clear');
  if(cl) cl.addEventListener('click',()=>{ mh = mhReset(); mhSyncUrl(); renderMarketHeat(); });
}

/* lifecycle status — horizontal story progress bar (Filed → … → Withdrawn) */
function mhLifecycle(){
  const host = document.getElementById('mh-lifecycle'); if(!host) return;
  const rows = mhFiltered('stage');
  const counts = {};
  rows.forEach(r=>{ if(r.stage) counts[r.stage]=(counts[r.stage]||0)+1; });
  const stages = Object.keys(counts).sort((a,b)=>STAGE_ORDER.indexOf(a)-STAGE_ORDER.indexOf(b));
  if(!stages.length){ host.style.display='none'; host.innerHTML=''; return; }
  host.style.display='';
  const seg = stages.map((s,i)=>{
    const on = mh.stage===s;
    const x = STAGE[s]||{cls:'st-filed'};
    return `${i?'<span class="lc-link" aria-hidden="true"></span>':''}<button class="lc-seg ${x.cls} ${on?'on':''}" data-dim="stage" data-val="${esc(s)}" title="Filter to ${esc(stageLabel(s))}">
      <span class="lc-ic">${icon(STAGE_ICON[s]||'doc',15)}</span>
      <span class="lc-body"><span class="lc-tx">${esc(stageLabel(s))}</span><span class="lc-n">${counts[s]}</span></span>
    </button>`;
  }).join('');
  host.innerHTML = `<div class="panel-head"><h3>Lifecycle Status</h3><span class="muted tiny">Filed → Listed</span></div>
    <div class="lc-story">${seg}</div>`;
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
  const winChip = mh.window!=='All'
    ? `<button class="mh-sum-chip" data-dim="window">${esc(mhWindowLabel(mh.window))} <span class="x">✕</span></button>`
    : '';
  host.innerHTML = `<span class="mh-sum-show">Showing:</span>${chips}${winChip}<span class="mh-sum-n">${n} record${n!==1?'s':''}</span>`;
  host.querySelectorAll('.mh-sum-chip').forEach(b=>b.addEventListener('click',()=>{
    mh[b.dataset.dim]='All'; mhSyncUrl(); renderMarketHeat();
  }));
}

/* left column — Activity by Sector: icon · name · gradient bar · count */
function mhBenchmark(){
  const host = document.getElementById('mh-benchmark'); if(!host) return;
  const secRows = mhFiltered('sector');
  const secCounts = {};
  secRows.forEach(r=>{ if(r.sector) secCounts[r.sector]=(secCounts[r.sector]||0)+1; });
  const secArr = Object.entries(secCounts).sort((a,b)=>b[1]-a[1]);
  const maxC = Math.max(1, ...secArr.map(x=>x[1]));
  const total = secArr.reduce((a,x)=>a+x[1],0);
  const bars = secArr.length ? secArr.map(([s,n])=>`
    <div class="act-row mh-bar ${mh.sector===s?'on':''}" data-dim="sector" data-val="${esc(s)}" role="button" tabindex="0">
      <span class="act-ico">${icon(SECTOR_ICON[s]||'building',16)}</span>
      <span class="act-name">${esc(s)}</span>
      <span class="act-track"><span class="act-fill" style="width:${n/maxC*100}%"></span></span>
      <span class="act-n">${n}</span>
    </div>`).join('')
    : `<div class="subtle tiny" style="padding:14px 2px">No classified sectors in this view.</div>`;
  host.innerHTML = `
    <div class="panel-head"><h3>Activity by Sector</h3><span class="muted tiny">${total} classified</span></div>
    <div class="act-list">${bars}</div>`;
  mhWireFacets(host);
}

/* right column top — Recommendation Mix: donut + legend + coverage box */
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
    || `<div class="subtle tiny">No scored records in this view.</div>`;

  // adequate coverage = filings with enough disclosed financials to score
  const scoreable = rows.filter(r=>r.bucket).length;
  const adequate = rows.filter(r=>r.bucket && r.bucket!=='INSUFFICIENT').length;
  const covPct = scoreable ? Math.round(adequate/scoreable*100) : 0;
  const cov = scoreable
    ? `<div class="cov-box"><span class="cov-pct">${covPct}%</span><span class="cov-tx">adequate coverage — ${adequate} of ${scoreable} filings carry enough disclosed financials to score.</span></div>`
    : '';

  host.innerHTML = `
    <div class="panel-head"><h3>Recommendation Mix</h3></div>
    <div class="donut-wrap">
      <svg class="donut" width="140" height="140" viewBox="0 0 140 140">${segs}
        <text x="70" y="66" text-anchor="middle" font-family="Inter, sans-serif" font-size="27" font-weight="700" fill="#064E45">${total}</text>
        <text x="70" y="85" text-anchor="middle" font-family="Inter, sans-serif" font-size="10" fill="#9CA3AF">scored</text>
      </svg>
      <div class="legend">${legend}</div>
    </div>
    ${cov}`;
  mhWireFacets(host);
}

/* right column bottom — Quick Insights with soft colour-coded badges */
function mhInsightsCard(){
  const host = document.getElementById('mh-insights'); if(!host) return;
  const rows = mhFiltered();
  const out = [];
  const secCounts = {};
  rows.forEach(r=>{ if(r.sector) secCounts[r.sector]=(secCounts[r.sector]||0)+1; });
  const topSec = Object.entries(secCounts).sort((a,b)=>b[1]-a[1])[0];
  if(topSec) out.push({ico:'flame', tone:'gold', t:`<b>${esc(topSec[0])}</b> leads this view with <b>${topSec[1]}</b> record${topSec[1]>1?'s':''}.`});
  const open = rows.filter(r=>r.stage==='IPO Open').length;
  if(open) out.push({ico:'rocket', tone:'sage', t:`<b>${open}</b> issue${open>1?'s are':' is'} currently open for subscription.`});
  const listed = rows.filter(r=>r.stage==='Listed').length;
  if(listed) out.push({ico:'check', tone:'blue', t:`<b>${listed}</b> recent listing${listed>1?'s':''} in this view.`});
  const scored = rows.filter(r=>r.score!=null).length;
  if(scored){
    const strong = rows.filter(r=>r.score!=null && r.score>=25).length;
    out.push({ico:'chart', tone:'lavender', t:`<b>${strong} of ${scored}</b> scored record${scored>1?'s':''} clear the “Dig Deeper” bar (score ≥ 25).`});
  }
  if(!out.length) out.push({ico:'spark', tone:'sage', t:`No records match the current filters.`});
  host.innerHTML = `<div class="panel-head"><h3>Quick Insights</h3></div>
    <div class="insights">${out.slice(0,4).map(o=>`
      <div class="insight"><div class="ico tone-${o.tone}">${icon(o.ico,16)}</div><div class="it">${o.t}</div></div>`).join('')}</div>`;
}

/* full-width activity snapshot strip — 4 headline metrics with dividers */
function mhSnapshot(){
  const host = document.getElementById('mh-snapshot'); if(!host) return;
  const rows = mhFiltered();
  const scoreable = rows.filter(r=>r.bucket).length;
  const adequate = rows.filter(r=>r.bucket && r.bucket!=='INSUFFICIENT').length;
  const covPct = scoreable ? Math.round(adequate/scoreable*100)+'%' : '—';
  const items = [
    {n: rows.length, l:'Total Issues'},
    {n: rows.filter(r=>r.score!=null).length, l:'Scored'},
    {n: covPct, l:'Adequate Coverage'},
    {n: rows.filter(r=>r.stage==='IPO Open').length, l:'Open for Subscription'},
  ];
  host.innerHTML = `<div class="panel-head"><h3>Overall Activity Snapshot</h3></div>
    <div class="snap-strip">${items.map((it,i)=>`${i?'<span class="snap-div"></span>':''}
      <div class="snap-cell"><div class="snap-n">${it.n}</div><div class="snap-l">${it.l}</div></div>`).join('')}</div>`;
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
      `Source: SEBI filings &amp; NSE. Listing gain/loss is shown once a stock has listed. Click any row for the full record.`;
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
    {label:'Same-sector IPOs open', n:openPeers.length, sub:m.available?'currently on NSE':'updating'},
    {label:'Same-sector recent listings', n:listedPeers.length, sub:m.available?'recent listings':'updating'},
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
      <div class="stage2-note">Portfolio-level competitor mapping is available on request.</div>
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
    {h:'Fresh Shares', num:1, val:r=>r.freshShares, cell:r=>r.freshShares==null?dash:Number(r.freshShares).toLocaleString('en-IN')},
    {h:'OFS Shares', num:1, val:r=>r.ofsShares, cell:r=>r.ofsShares==null?dash:Number(r.ofsShares).toLocaleString('en-IN')},
    {h:'Total Shares', num:1, val:r=>r.totalShares, cell:r=>r.totalShares==null?dash:Number(r.totalShares).toLocaleString('en-IN')},
    {h:'Face Value (₹)', num:1, val:r=>r.faceValue, cell:r=>r.faceValue==null?dash:money(r.faceValue)},
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

/* Company cell for the IPO Pipeline: a direct link to the SEBI document we
   hold (exact PDF preferred, else the SEBI filing page) with a matching badge;
   plain text and NO redirect when we hold nothing for that company. */
function pipelineName(rec){
  const s = rec.sources || {};
  const href = s.drhp_pdf_url || s.sebi_url || null;
  if(!href) return esc(rec.name);
  const isPdf = !!s.drhp_pdf_url;
  const badge = `<span class="ipo-doc ${isPdf?'pdf':'sebi'}">${isPdf?'PDF':'SEBI'}</span>`;
  return `<a class="ipo-co" href="${esc(href)}" target="_blank" rel="noopener" title="Open the SEBI ${isPdf?'prospectus PDF':'filing page'}">${esc(rec.name)}</a>${badge}`;
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
    businessSummary: (f && f.business_summary) || null,
    issueType: (f && f.issue && f.issue.type) || null,
    freshCr: (f && f.issue) ? f.issue.fresh_cr : null,
    ofsCr: (f && f.issue) ? f.issue.ofs_cr : null,
    marketCapCr: (f && f.issue) ? f.issue.market_cap_cr : null,
    issueToMktcapPct: (f && f.issue) ? f.issue.issue_to_mktcap_pct : null,
    freshShares: (f && f.issue) ? f.issue.fresh_shares : null,
    ofsShares: (f && f.issue) ? f.issue.ofs_shares : null,
    totalShares: (f && f.issue) ? f.issue.total_shares : null,
    faceValue: (f && f.issue) ? f.issue.face_value : null,
    leadManagers: (f && f.lead_managers && f.lead_managers.length) ? f.lead_managers : null,
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
      <div class="pending-tag">IPO market data is being updated.</div></div>`;
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
        return `<tr class="ipo-row" data-idx="${i}">
        <td class="company">${pipelineName(rec)}</td>
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
    <div class="table-foot">Source: NSE public IPO data. A company name links to its SEBI filing where available. Listing gain/loss is shown once a stock has listed.</div>
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
      <span class="pending-tag">Market data is being updated</span></div></div>`;
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
    <div class="tiny muted pulse-note">Positive / negative listing outcomes are shown once stocks have listed.</div>
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
  if(mh.window!=='All') p.set('filed', mh.window);
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
  const w = p.get('filed');
  if(['30','60','90'].includes(w)){ mh.window = w; any = true; }
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
  const sh = (n)=> Number(n).toLocaleString('en-IN');
  const issue = [
    r.issueType && row('Issue type', esc(r.issueType)),
    r.freshCr!=null && row('Fresh issue', '₹'+money(r.freshCr)+' Cr'),
    r.ofsCr!=null && row('Offer for sale', '₹'+money(r.ofsCr)+' Cr'),
    r.issueSizeCr!=null && row('Total issue size', '₹'+money(r.issueSizeCr)+' Cr'),
    r.freshShares!=null && row('Fresh shares', sh(r.freshShares)),
    r.ofsShares!=null && row('OFS shares', sh(r.ofsShares)),
    r.totalShares!=null && row('Total shares', sh(r.totalShares)),
    r.faceValue!=null && row('Face value', '₹'+money(r.faceValue)),
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
  // client-facing notes — only what matters for an investment view
  const listed = r.stage === 'Listed';
  const notes = [];
  if(!financials) notes.push('Financials not disclosed in this filing.');
  if(r.issueSizeCr==null) notes.push('Issue size not yet disclosed.');
  if(listed) notes.push('Listing gain/loss is shown once available.');

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
      ${notes.length?`<div class="dw-h">Notes</div><ul class="dw-missing">${notes.map(t=>`<li>${t}</li>`).join('')}</ul>`:''}
      <div class="dw-h">Sources</div><div class="dw-sec dw-src">${srcRec(r)}</div>
    </div>`;
  d.hidden = false; d.setAttribute('aria-hidden','false');
  ov.hidden = false;
  const c = document.getElementById('dw-close'); if(c) c.addEventListener('click', closeDrawer);
}

/* ======================================================================
   REDESIGN — Weekly Monitor · Pipeline · Archive
   Three focused views over the same dataset. Reuses the existing helpers
   and theme classes only; introduces no new colours.
   ====================================================================== */
const DASH = '<span class="subtle tiny">—</span>';
const finOf  = (r,k)=> (r.financials && r.financials[k]) ? r.financials[k] : null;
const fvalOf = (r,k)=> { const mv=finOf(r,k); return mv?mv.value:null; };

/* ---- shared: weekly-event classification (separate from Filing Type) ---- */
const EVENT = {
  'New Filing':      {rank:1, cls:'st-filed',  action:'Review'},
  'Updated Filing':  {rank:2, cls:'st-upd',    action:'Review Changes'},
  'Corrected Filing':{rank:3, cls:'st-upd',    action:'Review Changes'},
  'Stage Changed':   {rank:4, cls:'st-open',   action:'View Status'},
  'Newly Listed':    {rank:5, cls:'st-listed', action:'View Filing'},
  'Withdrawn':       {rank:6, cls:'st-wd',     action:'View Filing'},
};
/* one filing → its weekly event, derived from filing type, stamps and the ONE
   shared current-stage. Filing Type stays its own column and is never merged in. */
function weeklyEvent(f, stage){
  const st = f.stamps || [];
  if(stage==='Withdrawn') return 'Withdrawn';
  if(f.filing_type==='Corrigendum') return 'Corrected Filing';
  if(f.filing_type==='UDRHP' || st.includes('UPDATED') || stage==='Updated/Corrected') return 'Updated Filing';
  if(stage==='Listed') return 'Newly Listed';
  if(st.includes('IPO_STAGE')) return 'Stage Changed';
  return 'New Filing';
}
function eventChip(ev){ const x=EVENT[ev]||{cls:'st-filed'}; return `<span class="lc-chip ${x.cls}">${esc(ev)}</span>`; }

/* Data Status = purely factual financial-disclosure completeness (no score).
   Complete / Partial / Awaiting Financials — missing is never treated as zero */
const FIN_KEYS = ['rev_growth_pct','ebitda_margin_pct','pat_growth_pct','pat_margin_pct'];
function dataStatus(f){
  const fin = f.financials || {};
  const have = FIN_KEYS.filter(k => fin[k] && fin[k].value!=null).length;
  if(have===0) return 'Awaiting Financials';
  return have===FIN_KEYS.length ? 'Complete' : 'Partial';
}
function dsChip(status){
  const cls = status==='Complete' ? 'ok' : status==='Partial' ? 'mkt' : 'miss';
  return `<span class="ds-chip ${cls}">${esc(status)}</span>`;
}

/* ---------------- Tab 1: Weekly Monitor ---------------- */
let WM_ROWS = [];
function renderWeekly(){
  const filings = DATA.filings || [];
  const mByNorm = new Map(MARKET.map(r=>[r.norm, r]));           // shared stage source
  const stageOf = f => { const m = mByNorm.get(f.company_name_normalized); return (m && m.stage) || f.current_stage || null; };
  const byNorm = new Map();     // one row per company per week: highest-priority event wins,
  filings.forEach(f => {        // every other event is kept for that row's filing history
    const stage = stageOf(f);
    const ev = weeklyEvent(f, stage);
    const prev = byNorm.get(f.company_name_normalized);
    if(!prev){ byNorm.set(f.company_name_normalized, {f, ev, stage, others:[]}); return; }
    if(EVENT[ev].rank < EVENT[prev.ev].rank){
      byNorm.set(f.company_name_normalized, {f, ev, stage, others:[...prev.others, {f:prev.f, ev:prev.ev}]});
    } else {
      prev.others.push({f, ev});
    }
  });
  const sc = r => { const s = fscore(r.f); return (s && s.total!=null) ? s.total : -1; };
  WM_ROWS = [...byNorm.values()].sort((a,b) =>
    String(b.f.filing_date||'').localeCompare(String(a.f.filing_date||'')) ||  // 1. latest filing first
    EVENT[a.ev].rank - EVENT[b.ev].rank ||                                     // 2. event priority
    sc(b) - sc(a));                                                            // 3. score descending
  renderWmCards();
  renderWmTable();
  renderWmInsights();
}

function renderWmCards(){
  const fs = DATA.filings || [];
  const newDrhps = fs.filter(f => f.filing_type==='DRHP').length;
  const newPros  = fs.filter(f => f.filing_type==='Prospectus' || f.filing_type==='RHP').length;
  const updCorr  = fs.filter(f => f.filing_type==='UDRHP' || f.filing_type==='Corrigendum' || (f.stamps||[]).includes('UPDATED')).length;
  const dig      = WM_ROWS.filter(r => { const s=fscore(r.f); return s && s.bucket==='DIG DEEPER'; }).length;
  const deltas = (DATA.summary && DATA.summary.deltas) || null;   // only shown when a prior week exists
  const cards = [
    {k:'doc',    n:newDrhps, lab:'New DRHPs',                   d: deltas && deltas.new_drhp},
    {k:'trend',  n:newPros,  lab:'New Prospectuses',            d: deltas && deltas.new_ipo},
    {k:'spark',  n:updCorr,  lab:'Updated / Corrected Filings', d: null},
    {k:'target', n:dig,      lab:'DIG DEEPER',                  d: deltas && deltas.dig_deeper},
  ];
  document.getElementById('wm-cards').innerHTML = cards.map(c=>`
    <div class="wm-card">
      <span class="wm-ic">${icon(c.k,18)}</span>
      <div class="wm-card-body">
        <div class="wm-n">${c.n}</div>
        <div class="wm-lab">${c.lab}</div>
      </div>
      ${deltas && c.d ? `<div class="wm-delta ${String(c.d).startsWith('+')?'up':'down'}">${esc(c.d)}</div>` : ''}
    </div>`).join('');
}

function renderWmTable(){
  const head = `<thead><tr>
    <th>Company</th><th>Weekly Event</th><th>Filing Type</th><th>Filing Date</th><th>Current Stage</th>
    <th>Sector</th><th class="num">Score <button class="th-info" id="wm-score-info" title="How the composite score works" aria-label="Score explanation">i</button></th>
    <th>Recommendation</th><th>Data Status</th><th>Action</th>
  </tr></thead>`;
  const body = WM_ROWS.length ? WM_ROWS.map(({f, ev, stage}, i) => {
    const ds = dataStatus(f);
    return `<tr class="wm-row" data-idx="${i}" tabindex="0" aria-expanded="false">
      <td>${companyCell(f, false)}</td>
      <td>${eventChip(ev)}</td>
      <td class="subtle">${f.filing_type?esc(f.filing_type):DASH}</td>
      <td class="subtle">${dfmt(f.filing_date)}</td>
      <td>${stageChip(stage)||DASH}</td>
      <td class="subtle">${esc(f.sector||'—')}</td>
      <td class="num">${scoreLink(fscore(f), 'f', i)}</td>
      <td>${recoTag(fscore(f))}</td>
      <td>${dsChip(ds)}</td>
      <td><button class="wm-act" data-idx="${i}">${esc(EVENT[ev].action)} <span class="wm-caret">▾</span></button></td>
    </tr>
    <tr class="wm-detail" id="wm-detail-${i}" hidden><td colspan="10">${wmDetail(WM_ROWS[i])}</td></tr>`;
  }).join('') : `<tr><td colspan="10" class="subtle" style="padding:16px">No filings for the selected week.</td></tr>`;
  const table = document.getElementById('wm-table');
  table.innerHTML = head + `<tbody>${body}</tbody>`;
  document.getElementById('wm-foot').textContent =
    `${WM_ROWS.length} compan${WM_ROWS.length===1?'y':'ies'} · week of ${dfmt(DATA.meta.week_start)} – ${dfmt(DATA.meta.week_end)} · sorted latest filing first. Click a row for full detail; click a score for its calculation.`;
  const info = document.getElementById('wm-score-info');
  if(info) info.addEventListener('click', e=>{ e.stopPropagation(); openScoreInfo(); });
  table.querySelectorAll('.score-link').forEach(b=>b.addEventListener('click', e=>{
    e.stopPropagation();
    openScoreBreakdown(WM_ROWS[+b.dataset.idx].f);
  }));

  const toggle = i => {
    const det = document.getElementById('wm-detail-'+i);
    const row = table.querySelector(`.wm-row[data-idx="${i}"]`);
    if(!det || !row) return;
    const open = det.hidden;
    det.hidden = !open;
    row.classList.toggle('open', open);
    row.setAttribute('aria-expanded', String(open));
  };
  table.querySelectorAll('.wm-row').forEach(tr=>{
    tr.addEventListener('click', e=>{ if(e.target.closest('a')) return; toggle(+tr.dataset.idx); });
    tr.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggle(+tr.dataset.idx); } });
  });
}

/* inline expandable detail — filing info + history, business & issue, full financials.
   Missing values render as "—"; nothing is ever coerced to zero. */
function wmDetail(row){
  const f = row.f;
  const fin = f.financials || {}, iss = f.issue || {};
  const kv = (k,v)=> `<div class="wd-row"><span class="wd-k">${k}</span><span class="wd-v">${v}</span></div>`;
  const frow = (lab,mv,kind)=> kv(lab, (mv && mv.value!=null) ? fcell(mv,kind) : '—');
  const mCr = v => v!=null ? '₹'+money(v)+' Cr' : '—';
  const filingInfo = [
    kv('Company', esc(f.company_name)),
    kv('Filing date', dfmt(f.filing_date)),
    kv('Filing type', f.filing_type?esc(f.filing_type):'—'),
    kv('Current stage', row.stage?esc(row.stage):'—'),
  ].join('');
  const history = [
    kv(dfmt(f.filing_date), `${esc(f.filing_type||'Filing')} · ${esc(row.ev)}`),
    ...row.others.map(o => kv(dfmt(o.f.filing_date), `${esc(o.f.filing_type||'Filing')} · ${esc(o.ev)}`)),
    (PREV_SNAPSHOT && PREV_SNAPSHOT.byNorm[f.company_name_normalized])
      ? kv(`Week of ${dfmt(PREV_SNAPSHOT.week_end)}`, `${esc(PREV_SNAPSHOT.byNorm[f.company_name_normalized].current_stage||'Tracked')} (prior week)`)
      : '',
  ].filter(Boolean).join('');
  const business = [
    kv('Sector', f.sector?esc(f.sector):'—'),
    kv('Sub-sector', f.sub_sector?esc(f.sub_sector):'—'),
    kv('Issue type', iss.type?esc(iss.type):'—'),
    kv('Fresh issue', mCr(iss.fresh_cr)),
    kv('OFS', mCr(iss.ofs_cr)),
    kv('Total issue size', mCr(iss.total_cr)),
    kv('Market cap', mCr(iss.market_cap_cr)),
    kv('Lead managers', (f.lead_managers && f.lead_managers.length)?esc(f.lead_managers.join(', ')):'—'),
  ].join('');
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
    frow('Debt/Equity', fin.debt_equity, 'ratio'),
    frow('Asset base', fin.asset_base_cr, 'money'),
    frow('Promoter holding', fin.promoter_hold_pct, 'pct'),
  ].join('');
  return `<div class="wd-grid">
    <div class="wd-col">
      <div class="wd-h">Filing information</div>${filingInfo}
      <div class="wd-h">Filing history</div>${history}
      <div class="wd-h">Sources</div>${srcRow(f)||DASH}
    </div>
    <div class="wd-col">
      <div class="wd-h">Business &amp; issue</div>${business}
      <div class="wd-h">Business model</div>
      <p class="wd-biz">${f.business_summary?esc(f.business_summary):'<span class="subtle">Not disclosed in this filing.</span>'}</p>
    </div>
    <div class="wd-col">
      <div class="wd-h">Financials (from the filing)</div>
      ${financials}
    </div>
  </div>`;
}

function renderWmInsights(){
  const out = [];
  // 1. highest-scoring new filing (computed with the active scoring model)
  const news = WM_ROWS.filter(r => r.ev==='New Filing' && fscore(r.f) && fscore(r.f).total!=null);
  if(news.length){
    const top = news.reduce((a,b)=> fscore(b.f).total > fscore(a.f).total ? b : a);
    const s = fscore(top.f);
    out.push({k:'trend', t:`Highest-scoring new filing: <b>${esc(top.f.company_name)}</b> — ${s.total} / ${SCORING.active.max_total} (${esc(recoLabel(s.bucket))}).`});
  }
  // 2. material score change after an updated / corrected filing (needs the prior snapshot)
  if(PREV_SNAPSHOT){
    WM_ROWS.filter(r => r.ev==='Updated Filing' || r.ev==='Corrected Filing').forEach(r=>{
      const prev = PREV_SNAPSHOT.byNorm[r.f.company_name_normalized];
      const now = fscore(r.f);
      if(prev && prev.score && prev.score.total!=null && now && now.total!=null && Math.abs(now.total - prev.score.total) >= 5){
        const d = now.total - prev.score.total;
        out.push({k:'spark', t:`<b>${esc(r.f.company_name)}</b>'s score moved ${d>0?'+':''}${Math.round(d*10)/10} to ${now.total} after its ${r.ev==='Corrected Filing'?'corrected':'updated'} filing.`});
      }
    });
  }
  // 3. current-week DIG DEEPER count
  const dig = WM_ROWS.filter(r => { const s=fscore(r.f); return s && s.bucket==='DIG DEEPER'; });
  if(dig.length) out.push({k:'target', t:`<b>${dig.length}</b> compan${dig.length>1?'ies':'y'} this week score${dig.length>1?'':'s'} into <b>DIG DEEPER</b> (≥ ${SCORING.active.thresholds.dig_deeper_min} points).`});
  // 4. companies awaiting sufficient financial data
  const wait = WM_ROWS.filter(r => { const s=fscore(r.f); return !s || s.total==null; });
  if(wait.length) out.push({k:'clock', t:`<b>${wait.length}</b> compan${wait.length>1?'ies':'y'} awaiting sufficient financial data to score (${wait.map(r=>esc(r.f.company_name)).join(', ')}).`});

  const host = document.getElementById('wm-insights');
  if(!out.length){ host.innerHTML=''; return; }
  host.innerHTML = `<div class="card wm-ins-card">
    <div class="panel-head"><h3>Weekly Insights</h3></div>
    <ul class="wm-ins-list">${out.slice(0,3).map(o=>`<li><span class="wm-ins-ic">${icon(o.k,15)}</span><span>${o.t}</span></li>`).join('')}</ul>
  </div>`;
}

/* ---------------- Tab 2: Pipeline ---------------- */
let plFilter = {board:'All', stage:'All', sector:'All', period:'All', q:'', metrics:false};
const plRecency = r => r.filingDate || r.issueOpen || r.listingDate || null;
function renderPipeline(){
  const host = document.getElementById('pl-controls');
  if(!host.dataset.wired){ buildPlControls(host); host.dataset.wired='1'; }
  renderPlRows();
}
function buildPlControls(host){
  const opt = (dim,label,opts,disp)=>{
    const o=[`<option value="All">All</option>`].concat(opts.map(v=>`<option value="${esc(v)}">${esc(disp?disp(v):v)}</option>`)).join('');
    return `<label class="mh-pill" data-pill="${dim}"><span class="mh-pill-lbl">${label}</span><select class="mh-pill-sel" data-f="${dim}">${o}</select></label>`;
  };
  const boards  = [...new Set(MARKET.map(r=>r.board).filter(Boolean))].sort();
  const stages  = [...new Set(MARKET.map(r=>r.stage).filter(Boolean))].sort((a,b)=>STAGE_ORDER.indexOf(a)-STAGE_ORDER.indexOf(b));
  const sectors = [...new Set(MARKET.map(r=>r.sector).filter(Boolean))].sort();
  host.innerHTML = `
    ${opt('board','Board',boards)}
    ${opt('stage','Stage',stages,stageLabel)}
    ${opt('sector','Sector',sectors)}
    ${opt('period','Filing period',['30','60','90'],v=>'Last '+v+' days')}
    <label class="ctl-search"><input type="search" id="pl-q" placeholder="Search company…"></label>
    <label class="ctl-toggle"><input type="checkbox" id="pl-metrics"> Review Metrics</label>
    <button class="fchip hide" id="pl-reset">Reset</button>`;
  host.querySelectorAll('select[data-f]').forEach(s=>s.addEventListener('change',()=>{
    plFilter[s.dataset.f]=s.value;
    s.closest('.mh-pill').classList.toggle('on', s.value!=='All');
    renderPlRows();
  }));
  const q = host.querySelector('#pl-q'); q.addEventListener('input',()=>{ plFilter.q=q.value; renderPlRows(); });
  const mt = host.querySelector('#pl-metrics'); mt.addEventListener('change',()=>{ plFilter.metrics=mt.checked; renderPlRows(); });
  host.querySelector('#pl-reset').addEventListener('click',()=>{
    plFilter={board:'All',stage:'All',sector:'All',period:'All',q:'',metrics:plFilter.metrics};
    host.querySelectorAll('select[data-f]').forEach(s=>{ s.value='All'; s.closest('.mh-pill').classList.remove('on'); });
    q.value=''; renderPlRows();
  });
}
function renderPlRows(){
  const asOf = (DATA.meta && (DATA.meta.data_as_of || DATA.meta.run_date)) || null;
  const daysAgo = iso => { if(!iso||!asOf) return null; const d=(Date.parse(asOf)-Date.parse(iso))/86400000; return isNaN(d)?null:d; };
  const q = plFilter.q.toLowerCase();
  const rows = MARKET.filter(r=>
    (plFilter.board==='All'  || r.board===plFilter.board) &&
    (plFilter.stage==='All'  || r.stage===plFilter.stage) &&
    (plFilter.sector==='All' || r.sector===plFilter.sector) &&
    (q==='' || (r.name||'').toLowerCase().includes(q)) &&
    (plFilter.period==='All' || (()=>{ const d=daysAgo(plRecency(r)); return d!=null && d<=+plFilter.period; })()));
  const m = plFilter.metrics;
  const head = `<thead><tr>
    <th>Company</th><th>Board</th><th>Sector</th><th>Filing Type</th><th>Filing Date</th><th>Current Stage</th>
    <th>Open</th><th>Close</th><th>Listing</th><th>Price Band</th><th class="num">Issue Size</th><th class="num">Subscription</th>
    ${m?'<th class="num">Score</th><th>Recommendation</th>':''}
  </tr></thead>`;
  const body = rows.length ? rows.map(r=>`<tr>
    <td class="company">${pipelineName(r)}</td>
    <td>${boardChip(r.board)}</td>
    <td class="subtle">${r.sector?esc(r.sector):DASH}</td>
    <td class="subtle">${r.filingType?esc(r.filingType):DASH}</td>
    <td class="subtle">${r.filingDate?dfmt(r.filingDate):DASH}</td>
    <td>${stageChip(r.stage)||DASH}</td>
    <td class="subtle">${r.issueOpen?dfmt(r.issueOpen):DASH}</td>
    <td class="subtle">${r.issueClose?dfmt(r.issueClose):DASH}</td>
    <td class="subtle">${r.listingDate?dfmt(r.listingDate):DASH}</td>
    <td class="subtle">${r.priceBand?esc(r.priceBand):DASH}</td>
    <td class="num">${r.issueSizeCr==null?DASH:money(r.issueSizeCr)}</td>
    <td class="num">${subx(r.subscriptionX)}</td>
    ${m?`<td class="num">${scoreLink(rscore(r), 'r', MARKET.indexOf(r))}</td><td>${recoTag(rscore(r))}</td>`:''}
  </tr>`).join('') : `<tr><td colspan="${m?14:12}" class="subtle" style="padding:16px">No companies match these filters.</td></tr>`;
  const plt = document.getElementById('pl-table');
  plt.innerHTML = head + `<tbody>${body}</tbody>`;
  plt.querySelectorAll('.score-link').forEach(b=>b.addEventListener('click', e=>{
    e.stopPropagation();
    const rec = MARKET[+b.dataset.idx];
    if(rec) openScoreBreakdown({company_name: rec.name, financials: rec.financials});
  }));
  document.getElementById('pl-foot').textContent =
    `${rows.length} of ${MARKET.length} companies · one shared lifecycle stage across the dashboard.${m?' Scores use the active scoring model — click a score for its calculation.':''}`;
  const active = plFilter.board!=='All'||plFilter.stage!=='All'||plFilter.sector!=='All'||plFilter.period!=='All'||plFilter.q!=='';
  document.getElementById('pl-reset').classList.toggle('hide', !active);
}

/* ---------------- Tab 3: Archive ---------------- */
let arFilter = {q:'', board:'All', stage:'All', sector:'All', ftype:'All', from:'', to:''};
const AR_COLS = [
  {h:'Company', sticky:1, cell:r=>pipelineName(r), get:r=>r.name},
  {h:'Board', cell:r=>boardChip(r.board)||DASH, get:r=>r.board},
  {h:'Stage', cell:r=>stageChip(r.stage)||DASH, get:r=>r.stage},
  {h:'Sector', cls:'subtle', cell:r=>r.sector?esc(r.sector):DASH, get:r=>r.sector},
  {h:'Sub-sector', cls:'subtle', cell:r=>r.subSector?esc(r.subSector):DASH, get:r=>r.subSector},
  {h:'Business Model', cell:r=>r.businessSummary?`<span class="bizclamp" title="${esc(r.businessSummary)}">${esc(r.businessSummary)}</span>`:DASH, get:r=>r.businessSummary},
  {h:'Filing Type', cls:'subtle', cell:r=>r.filingType?esc(r.filingType):DASH, get:r=>r.filingType},
  {h:'Filing Date', cls:'subtle', cell:r=>r.filingDate?dfmt(r.filingDate):DASH, get:r=>r.filingDate},
  {h:'Issue Type', cls:'subtle', cell:r=>r.issueType?esc(r.issueType):DASH, get:r=>r.issueType},
  {h:'Fresh (₹ Cr)', num:1, cell:r=>r.freshCr==null?DASH:money(r.freshCr), get:r=>r.freshCr},
  {h:'OFS (₹ Cr)', num:1, cell:r=>r.ofsCr==null?DASH:money(r.ofsCr), get:r=>r.ofsCr},
  {h:'Total Issue (₹ Cr)', num:1, cell:r=>r.issueSizeCr==null?DASH:money(r.issueSizeCr), get:r=>r.issueSizeCr},
  {h:'Fresh Shares', num:1, cell:r=>r.freshShares==null?DASH:Number(r.freshShares).toLocaleString('en-IN'), get:r=>r.freshShares},
  {h:'OFS Shares', num:1, cell:r=>r.ofsShares==null?DASH:Number(r.ofsShares).toLocaleString('en-IN'), get:r=>r.ofsShares},
  {h:'Total Shares', num:1, cell:r=>r.totalShares==null?DASH:Number(r.totalShares).toLocaleString('en-IN'), get:r=>r.totalShares},
  {h:'Face Value (₹)', num:1, cell:r=>r.faceValue==null?DASH:money(r.faceValue), get:r=>r.faceValue},
  {h:'Market Cap (₹ Cr)', num:1, cell:r=>r.marketCapCr==null?DASH:money(r.marketCapCr), get:r=>r.marketCapCr},
  {h:'Revenue FY25 (₹ Cr)', num:1, cell:r=>fcell(finOf(r,'revenue_fy25'),'money'), get:r=>fvalOf(r,'revenue_fy25')},
  {h:'EBITDA FY25 (₹ Cr)', num:1, cell:r=>fcell(finOf(r,'ebitda_fy25'),'money'), get:r=>fvalOf(r,'ebitda_fy25')},
  {h:'PAT FY25 (₹ Cr)', num:1, cell:r=>fcell(finOf(r,'pat_fy25'),'money'), get:r=>fvalOf(r,'pat_fy25')},
  {h:'Rev Growth', num:1, cell:r=>fcell(finOf(r,'rev_growth_pct'),'pct'), get:r=>fvalOf(r,'rev_growth_pct')},
  {h:'EBITDA Margin', num:1, cell:r=>fcell(finOf(r,'ebitda_margin_pct'),'pct'), get:r=>fvalOf(r,'ebitda_margin_pct')},
  {h:'PAT Growth', num:1, cell:r=>fcell(finOf(r,'pat_growth_pct'),'pct'), get:r=>fvalOf(r,'pat_growth_pct')},
  {h:'PAT Margin', num:1, cell:r=>fcell(finOf(r,'pat_margin_pct'),'pct'), get:r=>fvalOf(r,'pat_margin_pct')},
  {h:'ROE', num:1, cell:r=>fcell(finOf(r,'roe_pct'),'pct'), get:r=>fvalOf(r,'roe_pct')},
  {h:'ROCE', num:1, cell:r=>fcell(finOf(r,'roce_pct'),'pct'), get:r=>fvalOf(r,'roce_pct')},
  {h:'Debt/Equity', num:1, cell:r=>fcell(finOf(r,'debt_equity'),'ratio'), get:r=>fvalOf(r,'debt_equity')},
  {h:'Asset Base (₹ Cr)', num:1, cell:r=>fcell(finOf(r,'asset_base_cr'),'money'), get:r=>fvalOf(r,'asset_base_cr')},
  {h:'Promoter Holding', num:1, cell:r=>fcell(finOf(r,'promoter_hold_pct'),'pct'), get:r=>fvalOf(r,'promoter_hold_pct')},
  {h:'Lead Managers', cls:'subtle', cell:r=>(r.leadManagers&&r.leadManagers.length)?esc(r.leadManagers.join(', ')):DASH, get:r=>r.leadManagers?r.leadManagers.join('; '):null},
  {h:'Open', cls:'subtle', cell:r=>r.issueOpen?dfmt(r.issueOpen):DASH, get:r=>r.issueOpen},
  {h:'Close', cls:'subtle', cell:r=>r.issueClose?dfmt(r.issueClose):DASH, get:r=>r.issueClose},
  {h:'Listing', cls:'subtle', cell:r=>r.listingDate?dfmt(r.listingDate):DASH, get:r=>r.listingDate},
  {h:'Price Band', cls:'subtle', cell:r=>r.priceBand?esc(r.priceBand):DASH, get:r=>r.priceBand},
  {h:'Subscription', num:1, cell:r=>subx(r.subscriptionX), get:r=>r.subscriptionX},
  {h:'Listing Gain', num:1, cell:r=>r.gainPct==null?DASH:pct(r.gainPct), get:r=>r.gainPct},
  {h:'Score', num:1, cell:(r,i)=>scoreLink(rscore(r),'r',i), get:r=>{ const s=rscore(r); return s&&s.total!=null?s.total:null; }},
  {h:'Recommendation', cell:r=>recoTag(rscore(r)), get:r=>{ const s=rscore(r); return s?recoLabel(s.bucket):''; }},
  {h:'Source', cell:r=>srcRec(r), get:r=>{ const s=r.sources||{}; return s.drhp_pdf_url||s.sebi_url||''; }},
];
function arFiltered(){
  const q = arFilter.q.toLowerCase();
  return MARKET.filter(r=>
    (q==='' || (r.name||'').toLowerCase().includes(q)) &&
    (arFilter.board==='All'  || r.board===arFilter.board) &&
    (arFilter.stage==='All'  || r.stage===arFilter.stage) &&
    (arFilter.sector==='All' || r.sector===arFilter.sector) &&
    (arFilter.ftype==='All'  || r.filingType===arFilter.ftype) &&
    (arFilter.from==='' || (r.filingDate && r.filingDate>=arFilter.from)) &&
    (arFilter.to===''   || (r.filingDate && r.filingDate<=arFilter.to)));
}
function renderArchive(){
  const host = document.getElementById('ar-controls');
  if(!host.dataset.wired){ buildArControls(host); host.dataset.wired='1'; }
  renderArRows();
}
function buildArControls(host){
  const opt = (dim,label,opts)=>{
    const o=[`<option value="All">All</option>`].concat(opts.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`)).join('');
    return `<label class="mh-pill" data-pill="${dim}"><span class="mh-pill-lbl">${label}</span><select class="mh-pill-sel" data-f="${dim}">${o}</select></label>`;
  };
  const boards  = [...new Set(MARKET.map(r=>r.board).filter(Boolean))].sort();
  const stages  = [...new Set(MARKET.map(r=>r.stage).filter(Boolean))].sort((a,b)=>STAGE_ORDER.indexOf(a)-STAGE_ORDER.indexOf(b));
  const sectors = [...new Set(MARKET.map(r=>r.sector).filter(Boolean))].sort();
  const ftypes  = [...new Set(MARKET.map(r=>r.filingType).filter(Boolean))].sort();
  host.innerHTML = `
    <label class="ctl-search"><input type="search" id="ar-q" placeholder="Search company…"></label>
    ${opt('board','Board',boards)}
    ${opt('stage','Stage',stages)}
    ${opt('sector','Sector',sectors)}
    ${opt('ftype','Filing type',ftypes)}
    <label class="ctl-date"><span>From</span><input type="date" id="ar-from"></label>
    <label class="ctl-date"><span>To</span><input type="date" id="ar-to"></label>
    <button class="fchip" id="ar-reset">Reset</button>
    <button class="fchip" id="ar-csv">Export CSV</button>
    <button class="fchip" id="ar-print">Print / PDF</button>`;
  host.querySelectorAll('select[data-f]').forEach(s=>s.addEventListener('change',()=>{
    arFilter[s.dataset.f]=s.value; s.closest('.mh-pill').classList.toggle('on', s.value!=='All'); renderArRows();
  }));
  const q = host.querySelector('#ar-q'); q.addEventListener('input',()=>{ arFilter.q=q.value; renderArRows(); });
  const from = host.querySelector('#ar-from'); from.addEventListener('change',()=>{ arFilter.from=from.value; renderArRows(); });
  const to = host.querySelector('#ar-to'); to.addEventListener('change',()=>{ arFilter.to=to.value; renderArRows(); });
  host.querySelector('#ar-reset').addEventListener('click',()=>{
    arFilter={q:'',board:'All',stage:'All',sector:'All',ftype:'All',from:'',to:''};
    host.querySelectorAll('select[data-f]').forEach(s=>{ s.value='All'; s.closest('.mh-pill').classList.remove('on'); });
    q.value=''; from.value=''; to.value=''; renderArRows();
  });
  host.querySelector('#ar-csv').addEventListener('click', arExportCsv);
  host.querySelector('#ar-print').addEventListener('click', ()=>window.print());
}
let AR_VIEW = [];
function renderArRows(){
  const recs = arFiltered();
  AR_VIEW = recs;
  const head = `<thead><tr>${AR_COLS.map(c=>`<th class="${c.num?'num':''}${c.sticky?' ar-sticky':''}">${esc(c.h)}</th>`).join('')}</tr></thead>`;
  const body = recs.length
    ? recs.map((r,i)=>`<tr>${AR_COLS.map(c=>`<td class="${c.cls||''}${c.num?' num':''}${c.sticky?' ar-sticky':''}">${c.cell(r,i)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${AR_COLS.length}" class="subtle" style="padding:16px">No records match these filters.</td></tr>`;
  const art = document.getElementById('ar-table');
  art.innerHTML = head + `<tbody>${body}</tbody>`;
  art.querySelectorAll('.score-link').forEach(b=>b.addEventListener('click', e=>{
    e.stopPropagation();
    const rec = AR_VIEW[+b.dataset.idx];
    if(rec) openScoreBreakdown({company_name: rec.name, financials: rec.financials});
  }));
  document.getElementById('ar-foot').textContent = `${recs.length} of ${MARKET.length} records · SEBI public filings & NSE. “—” = not disclosed. Scores use the active scoring model.`;
}
function arExportCsv(){
  const recs = arFiltered();
  const q = v => { const s=(v==null?'':String(v)); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const lines = [AR_COLS.map(c=>q(c.h)).join(',')];
  recs.forEach(r=> lines.push(AR_COLS.map(c=>q(c.get(r))).join(',')));
  const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `drhp-full-tracker-${(DATA.meta&&DATA.meta.snapshot_id)||'export'}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

/* ======================================================================
   SCORING — one centralized configuration + one compute path.
   The published config lives in data/scoring_config.json (also read by the
   Python pipeline and the Excel export). A locally-published override is
   kept in localStorage until it is committed to the repo file.
   ====================================================================== */
const LS_PUB = 'drhp_scoring_published', LS_DRAFT = 'drhp_scoring_draft';
const SCORING = {
  repo: null,    // config as committed in the repo (pipeline + Excel use this)
  active: null,  // config the dashboard scores with (repo, unless locally published)
  /* frozen v1.0 fallback — identical to data/scoring_config.json and scoring.py */
  FALLBACK: {
    version:'1.0', published_date:'2026-06-30', published_by:'drhp-pipeline (source email)',
    change_summary:'Initial scoring model', previous_version:null,
    max_total:100, min_coverage_weight:30, missing_value_behaviour:'exclude',
    components:{
      rev_growth:   {label:'Revenue Growth', input:'rev_growth_pct', unit:'%',    weight:20, floor:0, saturation:30},
      pat_margin:   {label:'PAT Margin',     input:'pat_margin_pct', unit:'%',    weight:20, floor:0, saturation:20},
      roe:          {label:'ROE',            input:'roe_pct',        unit:'%',    weight:15, floor:0, saturation:25},
      roce:         {label:'ROCE',           input:'roce_pct',       unit:'%',    weight:15, floor:0, saturation:25},
      pat_growth:   {label:'PAT Growth',     input:'pat_growth_pct', unit:'%',    weight:15, floor:0, saturation:40},
      revenue_scale:{label:'Revenue Scale',  input:'revenue_fy25',   unit:'₹ Cr', weight:15, floor:0, saturation:5000},
    },
    thresholds:{dig_deeper_min:25, monitor_min:10},
  },
};
const clone = o => JSON.parse(JSON.stringify(o));

async function loadScoringConfig(){
  try{
    const res = await fetch('./data/scoring_config.json', {cache:'no-store'});
    if(res.ok) SCORING.repo = await res.json();
  }catch(e){ /* fall through to the identical built-in default */ }
  if(!SCORING.repo || !SCORING.repo.components) SCORING.repo = clone(SCORING.FALLBACK);
  let pub = null;
  try{ pub = JSON.parse(localStorage.getItem(LS_PUB) || 'null'); }catch(e){}
  SCORING.active = (pub && pub.components) ? pub : SCORING.repo;
}

/* prior snapshot — enables "material score change" insights + history notes */
let PREV_SNAPSHOT = null;
async function loadPrevSnapshot(){
  const id = DATA.meta && DATA.meta.previous_snapshot_id;
  if(!id) return;
  try{
    const res = await fetch(`./data/snapshots/${id}.json`, {cache:'no-store'});
    if(!res.ok) return;
    const d = await res.json();
    const byNorm = {};
    (d.filings||[]).forEach(f => { byNorm[f.company_name_normalized] = f; });
    PREV_SNAPSHOT = {week_end: d.meta && d.meta.week_end, byNorm};
  }catch(e){ /* insights that need the prior week simply don't show */ }
}

/* Python-identical rounding (banker's / half-to-even), so dashboard scores
   match the pipeline and Excel export digit-for-digit. */
function pyRound(x, nd){
  const m = Math.pow(10, nd);
  const y = x * m;
  const fl = Math.floor(y);
  if(Math.abs(y - fl - 0.5) < 1e-9) return ((fl % 2 === 0) ? fl : fl + 1) / m;
  return Math.round(y) / m;
}

/* THE score computation — mirrors drhp_pipeline/scoring.py exactly:
   linear band floor→saturation onto [0, weight]; missing inputs stay null
   (never zero); coverage below min_coverage_weight → no score (AWAITING DATA). */
function computeScore(fin, cfg){
  cfg = cfg || SCORING.active;
  const comps = {};
  let coverage = 0, total = 0;
  for(const [k, c] of Object.entries(cfg.components)){
    const mv = fin && fin[c.input];
    const v = (mv && mv.value!=null) ? mv.value : null;
    if(v==null || c.saturation==null || c.weight==null){ comps[k] = {value:v, points:null, max:c.weight}; continue; }
    const span = c.saturation - (c.floor||0);
    let frac = span>0 ? (v-(c.floor||0))/span : 0;
    frac = Math.max(0, Math.min(1, frac));
    const pts = pyRound(frac*c.weight, 2);
    comps[k] = {value:v, points:pts, max:c.weight};
    coverage += c.weight; total += pts;
  }
  if(coverage < cfg.min_coverage_weight) return {total:null, components:comps, bucket:'INSUFFICIENT', coverage};
  total = pyRound(total, 1);
  const th = cfg.thresholds;
  const bucket = total>=th.dig_deeper_min ? 'DIG DEEPER' : total>=th.monitor_min ? 'MONITOR' : 'WATCH';
  return {total, components:comps, bucket, coverage};
}
function fscore(f){ if(!f._score) f._score = computeScore(f.financials); return f._score; }
function rscore(r){ if(!r._score) r._score = computeScore(r.financials); return r._score; }
function rescoreAll(){
  (DATA.filings||[]).forEach(f => { f._score = computeScore(f.financials); });
  MARKET.forEach(r => { r._score = computeScore(r.financials); });
  const tag = document.getElementById('wm-model-tag');
  if(tag) tag.textContent = `Scoring model v${SCORING.active.version}`;
}
function rerenderAll(){ rescoreAll(); renderWeekly(); renderPipeline(); renderArchive(); }

/* score + recommendation presentation (reuses the existing tag colours) */
const RECO_CLS = {'DIG DEEPER':'dig', 'MONITOR':'mon', 'WATCH':'watch', 'INSUFFICIENT':'insuf'};
function recoLabel(bucket){ return bucket==='INSUFFICIENT' ? 'AWAITING DATA' : (bucket||'AWAITING DATA'); }
function recoTag(s){
  const b = s ? s.bucket : 'INSUFFICIENT';
  return `<span class="tag ${RECO_CLS[b]||'insuf'}">${esc(recoLabel(b))}</span>`;
}
function scoreLink(s, kind, idx){
  const txt = (s && s.total!=null) ? `<span class="score-cell">${s.total}</span>` : '<span class="subtle">—</span>';
  return `<button class="score-link" data-kind="${kind}" data-idx="${idx}" title="Show how this score is calculated">${txt}</button>`;
}
const fmtVal = (v, unit) => v==null ? '—' : (unit==='₹ Cr' ? '₹'+money(v)+' Cr' : pct(v));
function ruleText(c){
  if(c.saturation==null || c.weight==null) return 'Component scoring rule unavailable';
  const lo = fmtVal(c.floor||0, c.unit), hi = fmtVal(c.saturation, c.unit);
  return `0 pts at ≤ ${lo} · full ${c.weight} pts at ≥ ${hi} · linear in between`;
}

/* ---------------- shared modal host ---------------- */
function wireModalHost(){
  const ov = document.getElementById('md-overlay');
  if(ov) ov.addEventListener('click', closeModal);
  document.addEventListener('keydown', e => { if(e.key==='Escape') closeModal(); });
  const gear = document.getElementById('wm-settings-btn');
  if(gear) gear.addEventListener('click', openScoringSettings);
}
function openModal(html, cls){
  const box = document.getElementById('md-box'), ov = document.getElementById('md-overlay');
  if(!box) return;
  box.className = 'md-box no-print ' + (cls||'');
  box.innerHTML = html;
  box.hidden = false; ov.hidden = false;
  box.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModal));
}
function closeModal(){
  const box = document.getElementById('md-box'), ov = document.getElementById('md-overlay');
  if(box) box.hidden = true;
  if(ov) ov.hidden = true;
}

/* ---------------- composite score explanation (ⓘ) ---------------- */
function openScoreInfo(){
  const cfg = SCORING.active;
  const rows = Object.values(cfg.components).map(c =>
    `<div class="wd-row"><span class="wd-k">${esc(c.label)}</span><span class="wd-v">maximum ${c.weight} points</span></div>`).join('');
  openModal(`
    <div class="md-head"><h3>Composite Score — maximum ${cfg.max_total} points</h3><button class="dw-close" data-close aria-label="Close">✕</button></div>
    <div class="md-body">
      ${rows}
      <div class="wd-row md-total"><span class="wd-k">Total maximum</span><span class="wd-v">${cfg.max_total} points</span></div>
      <p class="md-note">Higher scores indicate stronger disclosed growth, profitability, returns and revenue scale.
      The score is a screening tool, not an investment recommendation. A company whose available inputs cover less than
      ${cfg.min_coverage_weight} of the ${cfg.max_total} weight points is shown as AWAITING DATA rather than scored.</p>
      <p class="md-note">Recommendations: <b>DIG DEEPER</b> ≥ ${cfg.thresholds.dig_deeper_min} · <b>MONITOR</b> ≥ ${cfg.thresholds.monitor_min} · <b>WATCH</b> &lt; ${cfg.thresholds.monitor_min} · <b>AWAITING DATA</b> when the score cannot be calculated.</p>
      <div class="md-foot">
        <span class="wm-model-tag">Scoring model v${esc(String(cfg.version))}</span>
        <span class="md-foot-btns">
          <button class="fchip" id="md-open-settings">Scoring Settings</button>
          <button class="fchip" data-close>Close</button>
        </span>
      </div>
    </div>`, 'md-info');
  const b = document.getElementById('md-open-settings');
  if(b) b.addEventListener('click', openScoringSettings);
}

/* ---------------- per-company score breakdown ---------------- */
function openScoreBreakdown(f){
  const cfg = SCORING.active;
  const s = computeScore(f.financials, cfg);
  const rows = Object.entries(cfg.components).map(([k,c])=>{
    const comp = s.components[k] || {};
    return `<tr class="${comp.points==null?'md-missing':''}">
      <td>${esc(c.label)}</td>
      <td class="num">${fmtVal(comp.value, c.unit)}</td>
      <td class="num">${comp.points==null?'—':comp.points}</td>
      <td class="num">${c.weight}</td>
      <td class="subtle md-rule">${esc(ruleText(c))}</td>
    </tr>`;
  }).join('');
  const earned = Object.entries(cfg.components)
    .map(([k,c]) => ({label:c.label, pts:(s.components[k]||{}).points}))
    .filter(x => x.pts!=null);
  const equation = earned.length
    ? `${earned.map(x=>`${x.pts} <span class="subtle">(${esc(x.label)})</span>`).join(' + ')} = <b>${s.total!=null?s.total:'—'}</b>`
    : '<span class="subtle">No scorable components available.</span>';
  const verdict = s.total!=null
    ? `<div class="md-verdict"><b>${s.total} / ${cfg.max_total}</b> → ${recoTag(s)}</div>`
    : `<div class="md-verdict">${recoTag(s)} <span class="md-note-inline">available component weight ${s.coverage} of ${cfg.max_total} is below the minimum ${cfg.min_coverage_weight} required to score.</span></div>`;
  openModal(`
    <div class="md-head"><h3>Score Breakdown — ${esc(f.company_name)}</h3><button class="dw-close" data-close aria-label="Close">✕</button></div>
    <div class="md-body">
      <div class="table-wrap"><table class="md-table">
        <thead><tr><th>Metric</th><th class="num">Actual Value</th><th class="num">Points Earned</th><th class="num">Maximum Points</th><th>Applied Rule</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="md-eq"><span class="md-eq-k">Composite Score =</span> ${equation}</div>
      ${verdict}
      <p class="md-note">Missing inputs are excluded from the composite — they are never counted as zero.</p>
      <div class="md-foot">
        <span class="wm-model-tag">Scoring model v${esc(String(cfg.version))}</span>
        <span class="md-foot-btns">
          <button class="fchip" id="md-open-settings2">Scoring Settings</button>
          <button class="fchip" data-close>Close</button>
        </span>
      </div>
    </div>`, 'md-breakdown');
  const b = document.getElementById('md-open-settings2');
  if(b) b.addEventListener('click', openScoringSettings);
}

/* ---------------- Scoring Settings (editor · preview · publish) ---------------- */
let SC_WORK = null;   // working copy being edited
function bumpVersion(v){
  const m = String(v||'1.0').match(/^(\d+)\.(\d+)$/);
  return m ? `${m[1]}.${+m[2]+1}` : '1.1';
}
function scValidate(W){
  const errs = [];
  const comps = Object.values(W.components);
  const sum = comps.reduce((a,c)=>a+(+c.weight||0), 0);
  if(sum !== W.max_total) errs.push(`Component maximums must total ${W.max_total} (currently ${sum}).`);
  comps.forEach(c=>{
    if(!(+c.weight>0)) errs.push(`${c.label}: maximum points must be a positive number.`);
    if(!(+c.saturation > +(c.floor||0))) errs.push(`${c.label}: full-points value must be above the zero-points value.`);
  });
  const th = W.thresholds;
  if(!(+th.dig_deeper_min > +th.monitor_min)) errs.push('DIG DEEPER threshold must be above the MONITOR threshold.');
  if(!(+th.monitor_min >= 0)) errs.push('MONITOR threshold cannot be negative.');
  if(!(+W.min_coverage_weight>=0 && +W.min_coverage_weight<=W.max_total)) errs.push(`Minimum coverage must be between 0 and ${W.max_total}.`);
  return errs;
}
function scPreviewRows(W){
  return WM_ROWS.map(r=>{
    const oldS = computeScore(r.f.financials, SCORING.active);
    const newS = computeScore(r.f.financials, W);
    const moved = recoLabel(oldS.bucket)!==recoLabel(newS.bucket);
    return {name:r.f.company_name, oldS, newS, moved};
  });
}
function openScoringSettings(){
  closeModal();
  let loadedDraft = false;
  try{
    const d = JSON.parse(localStorage.getItem(LS_DRAFT)||'null');
    if(d && d.components){ SC_WORK = d; loadedDraft = true; }
  }catch(e){}
  if(!SC_WORK || !loadedDraft) SC_WORK = clone(SCORING.active);
  renderScoringSettings(loadedDraft ? 'Loaded your saved draft.' : '');
}
function renderScoringSettings(note){
  const W = SC_WORK, cfg = SCORING.active;
  const compRows = Object.entries(W.components).map(([k,c])=>`
    <tr>
      <td>${esc(c.label)} <span class="subtle tiny">(${esc(c.unit)})</span></td>
      <td class="num"><input class="sc-in" type="number" step="1" data-k="${k}" data-f="weight" value="${c.weight}"></td>
      <td class="num"><input class="sc-in" type="number" step="any" data-k="${k}" data-f="floor" value="${c.floor||0}"></td>
      <td class="num"><input class="sc-in" type="number" step="any" data-k="${k}" data-f="saturation" value="${c.saturation}"></td>
      <td class="subtle">Linear between the two; missing value → excluded (never zero)</td>
    </tr>`).join('');
  const errs = scValidate(W);
  const prev = scPreviewRows(W);
  const movedN = prev.filter(p=>p.moved).length;
  const prevRows = prev.map(p=>`
    <tr class="${p.moved?'sc-moved':''}">
      <td>${esc(p.name)}</td>
      <td class="num">${p.oldS.total!=null?p.oldS.total:'—'}</td>
      <td>${esc(recoLabel(p.oldS.bucket))}</td>
      <td class="num">${p.newS.total!=null?p.newS.total:'—'}</td>
      <td>${esc(recoLabel(p.newS.bucket))}</td>
    </tr>`).join('');
  openModal(`
    <div class="md-head"><h3>Scoring Settings</h3><button class="dw-close" data-close aria-label="Close">✕</button></div>
    <div class="md-body">
      ${note?`<div class="sc-note">${esc(note)}</div>`:''}
      <div class="wd-h">Component weights &amp; point rules</div>
      <div class="table-wrap"><table class="md-table sc-table">
        <thead><tr><th>Component</th><th class="num">Max Points</th><th class="num">0 pts at ≤</th><th class="num">Full pts at ≥</th><th>Rule</th></tr></thead>
        <tbody>${compRows}</tbody>
      </table></div>
      <div class="wd-h">Recommendation thresholds</div>
      <div class="sc-thresholds">
        <label>DIG DEEPER ≥ <input class="sc-in" type="number" step="1" data-th="dig_deeper_min" value="${W.thresholds.dig_deeper_min}"></label>
        <label>MONITOR ≥ <input class="sc-in" type="number" step="1" data-th="monitor_min" value="${W.thresholds.monitor_min}"></label>
        <span class="subtle">WATCH &lt; ${W.thresholds.monitor_min}</span>
        <label>AWAITING DATA when available weight &lt; <input class="sc-in" type="number" step="1" data-cov="1" value="${W.min_coverage_weight}"></label>
      </div>
      ${errs.length?`<ul class="sc-errors">${errs.map(e=>`<li>${esc(e)}</li>`).join('')}</ul>`:''}
      <div class="wd-h">Live preview — current week under this model (${movedN} compan${movedN===1?'y':'ies'} would change classification)</div>
      <div class="table-wrap"><table class="md-table">
        <thead><tr><th>Company</th><th class="num">Old Score</th><th>Old Reco</th><th class="num">New Score</th><th>New Reco</th></tr></thead>
        <tbody>${prevRows}</tbody>
      </table></div>
      <div class="wd-h">Publish</div>
      <div class="sc-pub">
        <label>Published by <input class="sc-in sc-in-wide" type="text" id="sc-by" placeholder="Name"></label>
        <label>Change summary <input class="sc-in sc-in-wide" type="text" id="sc-summary" placeholder="What changed and why"></label>
      </div>
      <div class="md-foot">
        <span class="wm-model-tag">Active: v${esc(String(cfg.version))} · Draft base: v${esc(String(W.version))}</span>
        <span class="md-foot-btns">
          <button class="fchip" id="sc-restore" ${cfg.previous&&cfg.previous.components?'':'disabled'}>Restore Previous Version</button>
          <button class="fchip" id="sc-reset">Reset to Default</button>
          <button class="fchip" id="sc-draft">Save as Draft</button>
          <button class="fchip" data-close>Cancel</button>
          <button class="fchip sc-publish" id="sc-publish" ${errs.length?'disabled':''}>Publish</button>
        </span>
      </div>
    </div>`, 'md-settings');
  const box = document.getElementById('md-box');
  box.querySelectorAll('.sc-in[data-k]').forEach(inp=>inp.addEventListener('change',()=>{
    const c = SC_WORK.components[inp.dataset.k];
    c[inp.dataset.f] = +inp.value;
    renderScoringSettings('');
  }));
  box.querySelectorAll('.sc-in[data-th]').forEach(inp=>inp.addEventListener('change',()=>{
    SC_WORK.thresholds[inp.dataset.th] = +inp.value;
    renderScoringSettings('');
  }));
  const cov = box.querySelector('.sc-in[data-cov]');
  if(cov) cov.addEventListener('change',()=>{ SC_WORK.min_coverage_weight = +cov.value; renderScoringSettings(''); });
  box.querySelector('#sc-reset').addEventListener('click',()=>{ SC_WORK = clone(SCORING.repo); renderScoringSettings('Reset to the default (repo) configuration.'); });
  box.querySelector('#sc-draft').addEventListener('click',()=>{
    localStorage.setItem(LS_DRAFT, JSON.stringify(SC_WORK));
    renderScoringSettings('Draft saved on this device.');
  });
  const restore = box.querySelector('#sc-restore');
  if(restore) restore.addEventListener('click',()=>{
    const prevCfg = SCORING.active.previous;
    if(!prevCfg || !prevCfg.components) return;
    SCORING.active = prevCfg;
    if(String(prevCfg.version)===String(SCORING.repo.version)) localStorage.removeItem(LS_PUB);
    else localStorage.setItem(LS_PUB, JSON.stringify(prevCfg));
    localStorage.removeItem(LS_DRAFT); SC_WORK = null;
    closeModal(); rerenderAll();
  });
  box.querySelector('#sc-publish').addEventListener('click',()=>{
    const errs2 = scValidate(SC_WORK);
    if(errs2.length){ renderScoringSettings('Fix the validation errors before publishing.'); return; }
    const by = box.querySelector('#sc-by').value.trim();
    const summary = box.querySelector('#sc-summary').value.trim();
    if(!by || !summary){ renderScoringSettings('“Published by” and a change summary are required to publish.'); return; }
    publishScoring(by, summary);
  });
}
function scRulesOf(c){ return JSON.stringify({c:c.components, t:c.thresholds, m:c.min_coverage_weight}); }
function publishScoring(by, summary){
  const prevActive = clone(SCORING.active);
  delete prevActive.previous;                      // keep exactly one level of undo
  const newCfg = clone(SC_WORK);
  newCfg.version = bumpVersion(SCORING.active.version);
  newCfg.published_date = new Date().toISOString().slice(0,10);
  newCfg.published_by = by;
  newCfg.change_summary = summary;
  newCfg.previous_version = String(SCORING.active.version);
  newCfg.previous = prevActive;
  const differsFromRepo = scRulesOf(newCfg) !== scRulesOf(SCORING.repo);
  const finish = ()=>{
    localStorage.setItem(LS_PUB, JSON.stringify(newCfg));
    localStorage.removeItem(LS_DRAFT);
    SCORING.active = newCfg; SC_WORK = null;
    closeModal(); rerenderAll();
  };
  if(!differsFromRepo){ finish(); return; }
  // Excel / pipeline consistency warning — never publish an inconsistency silently
  openModal(`
    <div class="md-head"><h3>Before you publish v${esc(newCfg.version)}</h3><button class="dw-close" data-close aria-label="Close">✕</button></div>
    <div class="md-body">
      <p class="md-note"><b>The Python pipeline and the Excel tracker export still score with v${esc(String(SCORING.repo.version))}</b>
      (from <code>data/scoring_config.json</code> in the repository). Publishing here updates this dashboard immediately,
      but dashboard and Excel scores will differ until the updated configuration file is committed to the repository.</p>
      <p class="md-note">Download the configuration below and commit it as <code>data/scoring_config.json</code> to keep every output consistent.</p>
      <div class="md-foot">
        <span class="md-foot-btns">
          <button class="fchip" id="sc-dl">Download scoring_config.json</button>
          <button class="fchip" data-close>Go back</button>
          <button class="fchip sc-publish" id="sc-confirm">Publish anyway (dashboard only)</button>
        </span>
      </div>
    </div>`, 'md-warn');
  document.getElementById('sc-dl').addEventListener('click',()=>{
    const fileCfg = clone(newCfg); delete fileCfg.previous;
    const blob = new Blob([JSON.stringify(fileCfg, null, 2)+'\n'], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'scoring_config.json';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  });
  document.getElementById('sc-confirm').addEventListener('click', finish);
}

document.addEventListener('DOMContentLoaded', main);
