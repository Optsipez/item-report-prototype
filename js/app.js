/* ============================================================
   ITEM REPORT PROTOTYPE — application logic
   ------------------------------------------------------------
   ITEMS and BRANCH_BY_ITEM are defined in js/data.js, which
   loads before this file.
   ============================================================ */

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* Lifestyle codes expand to their full names on display; anything not in this
   map is shown as-is, so new codes still render without a code change. */
const LIFESTYLE_LABELS = {
  TRANS: 'Transitional',
  MIMOD: 'Minimalist Modern',
  CNMOD: 'Contemporary Modern',
  CLASC: 'Classic',
  MODRN: 'Modern (Gnrl)',
  COMMN: 'Common',
  OFICE: 'Office',
};
function lifestyleLabel(code){
  if(code === undefined || code === null || code === '') return code;
  return LIFESTYLE_LABELS[String(code).trim().toUpperCase()] || code;
}

/* Products matching any of these are internal / out of scope — drop them
   entirely on load so they never appear anywhere (grid, search, filters,
   counts). Matched on the raw Navision export values. */
const HIDDEN_PLAN_CODES = new Set(['B', 'O', 'W', 'S']);
const HIDDEN_CATG_CODES = new Set(['O', 'S', 'W']);          // Office Furniture, Services, Wall Paper & Window Décor
const HIDDEN_CATEGORIES = new Set([
  'office furniture',
  'services',
  'wall paper & window décor',
  'wall paper & window decor',
]);
function isHiddenItem(it){
  const norm = v => String(v == null ? '' : v).trim().toLowerCase();
  return HIDDEN_PLAN_CODES.has(String(it['Current Plan Code']).trim().toUpperCase())
    || HIDDEN_CATG_CODES.has(String(it['Catg Code']).trim().toUpperCase())
    || HIDDEN_CATEGORIES.has(norm(it['Category']));
}
for(let i = ITEMS.length - 1; i >= 0; i--){
  if(isHiddenItem(ITEMS[i])) ITEMS.splice(i, 1);
}

/* ============================================================
   AVG — "U-FNL AVG" demand figure
   ------------------------------------------------------------
   Ported verbatim from the Navision sales workbook. Works off a
   rolling 13-month sales window (newest first) ending at the most
   recent month that has any sale anywhere in the data.

   Each sub-average is the mean of only the *non-zero* months in
   its window, rounded (Excel ROUND, half away from zero); an
   empty window is 0. AVG is then the largest of:
     - months 2-4 average
     - months 1-3 avg  (raised to month 1 if that month is higher)
     - months 4-6 avg
     - months 7-9 avg
     - months 10-13 avg
     - months 2-7 avg   ("recent 6")
     - months 8-13 avg  ("old 6")
     - months 4-9 avg   ("middle 6")
   ============================================================ */
function excelRound(x){
  return (x < 0 ? -1 : 1) * Math.floor(Math.abs(x) + 0.5);
}
function nonZeroAvg(win){
  const count = win.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0);
  if(count === 0) return 0;
  return excelRound(win.reduce((a, b) => a + b, 0) / count);
}
function trailing13Sales(item, anchorYear, anchorMonth){
  const s = [];
  let y = anchorYear, m = anchorMonth;
  for(let i = 0; i < 13; i++){
    const yr = item.years[String(y)];
    s.push(yr ? (yr.sales[m] || 0) : 0);
    if(--m < 0){ m = 11; y--; }
  }
  return s;
}

/* Tiny inline sales-trend sparkline (last 13 months, oldest -> newest).
   Stroke colour follows the trend; the line draws itself in on render. */
function sparkSVG(item){
  const s = trailing13Sales(item, AVG_ANCHOR.year, AVG_ANCHOR.month).slice().reverse();
  if(s.every(v => v === 0)) return '<span class="spark-empty">—</span>';
  const recent = nonZeroAvg(s.slice(-4)), older = nonZeroAvg(s.slice(0, 4));
  const dir = recent > older * 1.15 ? 'up' : recent < older * 0.78 ? 'down' : 'flat';
  const W = 82, H = 22, p = 2.5;
  const max = Math.max.apply(null, s), min = Math.min.apply(null, s, 0);
  const span = (max - min) || 1;
  const pts = s.map((v, i) => {
    const x = p + i * (W - 2 * p) / (s.length - 1);
    const y = H - p - (v - min) / span * (H - 2 * p);
    return x.toFixed(1) + ' ' + y.toFixed(1);
  });
  const line = pts.join(' L');
  const lastX = (W - p).toFixed(1);
  const lastY = pts[pts.length - 1].split(' ')[1];
  return '<svg class="spark spark-' + dir + '" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H +
    '" preserveAspectRatio="none" aria-hidden="true">' +
    '<path class="spark-area" d="M' + line + ' L' + lastX + ' ' + (H - p) + ' L' + pts[0].split(' ')[0] + ' ' + (H - p) + ' Z"/>' +
    '<path class="spark-line" pathLength="1" d="M' + line + '"/>' +
    '<circle class="spark-dot" cx="' + lastX + '" cy="' + lastY + '" r="1.7"/>' +
    '</svg>';
}

/* Months-of-cover cell: value + a health bar (red <1, amber <2.5, green above). */
function coverCell(v){
  const isX = v === 'X';
  const n = parseFloat(v);
  const cls = isX ? 'cover-crit' : !isFinite(n) ? 'cover-flat' : n < 1 ? 'cover-crit' : n < 2.5 ? 'cover-warn' : 'cover-ok';
  const w = isX ? 8 : Math.max(6, Math.min(100, (n / 6) * 100));
  return '<span class="cover ' + cls + '">'
    + '<span class="cover-v">' + v + '</span>'
    + '<span class="cover-track"><span class="cover-fill" style="width:' + w.toFixed(0) + '%"></span></span>'
    + '</span>';
}
function avgFnl(item, anchor){
  const s = trailing13Sales(item, anchor.year, anchor.month);
  const base123 = nonZeroAvg([s[0], s[1], s[2]]);
  const windows = [
    s[0] > base123 ? s[0] : base123, // Avg 123M
    nonZeroAvg(s.slice(3, 6)),        // Avg 456M
    nonZeroAvg(s.slice(6, 9)),        // Avg 789M
    nonZeroAvg(s.slice(9, 13)),       // Avg 10-13M
    nonZeroAvg(s.slice(1, 7)),        // Avg 6M
    nonZeroAvg(s.slice(7, 13)),       // Avg Old 6M
    nonZeroAvg(s.slice(4, 10)),       // Mid Avg
  ];
  const recent3 = nonZeroAvg([s[1], s[2], s[3]]);
  return excelRound(Math.max(recent3, ...windows));
}
function detectAvgAnchor(){
  const years = [...new Set(ITEMS.flatMap(it => Object.keys(it.years).map(Number)))].sort((a, b) => b - a);
  for(const y of years){
    for(let m = 11; m >= 0; m--){
      if(ITEMS.some(it => it.years[String(y)] && (it.years[String(y)].sales[m] || 0) !== 0)){
        return { year: y, month: m };
      }
    }
  }
  return { year: years[0] || new Date().getFullYear(), month: 11 };
}
const AVG_ANCHOR = detectAvgAnchor();

/* ============================================================
   MONTH WINDOW — the 13-month reporting strip
   ------------------------------------------------------------
   From Book1.xlsx "Setup Mon" ("Final Item Month Link"): the anchor is
   MONTH(report date) — the CURRENT month, always, regardless of how much
   data that month has yet. Keep the months from (anchor month, prior
   year) through (anchor month, this year): a rolling 13-month window,
   e.g. run in May 2026 → May 2025 … May 2026; run in September → Sep
   2025 … Sep 2026. The "Sold by Month" / "Stock In by Month" strips
   (grid + Item Lookup) show exactly these 13 months, oldest → newest,
   as one continuous run across the year boundary.
   (Production reads the run date from the export; here it's today.)
   ============================================================ */
const REPORT_MONTH = (function(){
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() };
})();
const MONTH_WINDOW = (function(){
  const out = [];
  let y = REPORT_MONTH.year, m = REPORT_MONTH.month;
  for(let i = 0; i < 13; i++){
    out.push({ year: y, m: m });
    if(--m < 0){ m = 11; y--; }
  }
  return out.reverse();          // oldest first
})();
function monthColLabel(w){ return MONTHS[w.m] + "'" + String(w.year).slice(-2); }

/* Plan-code-"N" items have no useful sales history (they're new), so their AVG
   is estimated from the incoming PO Qty instead — a percentage that tapers as
   the order gets bigger. Workbook rule:
     IF(plan = "N", ROUND(PO-Qty * rate(PO-Qty)))
   rate: <100 -> 0.30, <300 -> 0.27, <700 -> 0.25, otherwise 0.22 */
function poQtyAvgRate(qty){
  if(qty < 100) return 0.30;
  if(qty < 300) return 0.27;
  if(qty < 700) return 0.25;
  return 0.22;
}
function itemAvg(item){
  if(String(item['Current Plan Code']).trim().toUpperCase() === 'N'){
    const qty = Number(item['PO-Qty']) || 0;
    return excelRound(qty * poQtyAvgRate(qty));
  }
  return avgFnl(item, AVG_ANCHOR);
}
/* Months of cover, to one decimal:
     SM = SOH    / AVG
     PM = PO Qty / AVG
   If AVG is 0 (can't divide) or the result works out to 0, show "X". */
function monthsOfCover(qty, avg){
  if(!avg) return 'X';
  const r = Math.round((qty / avg) * 10) / 10;
  return r === 0 ? 'X' : r.toFixed(1);
}
ITEMS.forEach(it => {
  it['AVG'] = itemAvg(it);
  it['SM'] = monthsOfCover(Number(it['SOH']) || 0, it['AVG']);
  it['PM'] = monthsOfCover(Number(it['PO-Qty']) || 0, it['AVG']);
});

/* ============================================================
   VIEW SWITCHING
   ============================================================ */
const navLookup = document.getElementById('navLookup');
const navAll = document.getElementById('navAll');
const railLookup = document.getElementById('railLookup');
const railAll = document.getElementById('railAll');
const viewLookup = document.getElementById('viewLookup');
const viewAll = document.getElementById('viewAll');

const layoutEl = document.querySelector('.layout');
const toggleFiltersBtn = document.getElementById('toggleFiltersBtn');
let filtersCollapsed = false;

function applyFilterRailState(isLookup){
  // The search rail must always be reachable in Item Lookup; the collapse only
  // applies to the All Products filter rail.
  const collapsed = !isLookup && filtersCollapsed;
  layoutEl.classList.toggle('filters-collapsed', collapsed);
  layoutEl.classList.toggle('view-all', !isLookup);
  toggleFiltersBtn.textContent = filtersCollapsed ? '›' : '‹'; // › / ‹
  toggleFiltersBtn.setAttribute('aria-label', filtersCollapsed ? 'Show filters' : 'Hide filters');
  toggleFiltersBtn.title = filtersCollapsed ? 'Show filters' : 'Hide filters';
}
toggleFiltersBtn.addEventListener('click', () => {
  filtersCollapsed = !filtersCollapsed;
  applyFilterRailState(false);
});

function setView(view){
  const isLookup = view === 'lookup';
  navLookup.classList.toggle('active', isLookup);
  navAll.classList.toggle('active', !isLookup);
  railLookup.classList.toggle('active', isLookup);
  railAll.classList.toggle('active', !isLookup);
  viewLookup.classList.toggle('active', isLookup);
  viewAll.classList.toggle('active', !isLookup);
  applyFilterRailState(isLookup);
  if(!isLookup) renderGrid();
}

/* ============================================================
   HISTORY-AWARE NAVIGATION
   ------------------------------------------------------------
   The current view lives in the URL hash (#products / #lookup /
   #item=<code>) so the browser Back button steps between views
   instead of leaving the page. Clicking a product in All Products
   records it as the "resume" row; Back then lands on the grid with
   that row highlighted and scrolled into view.
   Hash-only — no pushState — so it also works from a file:// open.
   ============================================================ */
let resumeCode = null;

function routeFromHash(){
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  if(h.indexOf('item=') === 0) return { view: 'lookup', code: h.slice(5) };
  if(h === 'lookup') return { view: 'lookup', code: null };
  return { view: 'all' };
}

function applyRoute(route){
  if(route.view === 'lookup'){
    if(route.code){
      const item = ITEMS.find(i => i['Item Code'] === route.code);
      if(item){
        selectedItem = item;
        searchInput.value = '';
        filtered = ITEMS.slice();
        renderResults();
        renderReport(item);
      }
    }
    setView('lookup');
  } else {
    setView('all');                       // rebuilds the grid
    if(resumeCode) flashResumeRow(resumeCode);
  }
}

function navigate(hash){
  if(location.hash === '#' + hash){ applyRoute(routeFromHash()); return; }
  location.hash = hash;                   // fires 'hashchange' -> applyRoute
}

/* Highlight the grid row the user drilled in from and scroll it clear of the
   sticky 2-row header. */
function flashResumeRow(code){
  const gs = document.querySelector('.grid-scroll');
  if(!gs) return;
  const rows = gs.querySelectorAll('tr[data-code="' + CSS.escape(code) + '"]');
  if(!rows.length) return;
  gs.querySelectorAll('tr.row-resume').forEach(r => r.classList.remove('row-resume'));
  rows.forEach(r => r.classList.add('row-resume'));
  requestAnimationFrame(() => {
    const head = gs.querySelector('thead');
    const headH = head ? head.getBoundingClientRect().height : 0;
    const delta = rows[0].getBoundingClientRect().top - gs.getBoundingClientRect().top - headH - 16;
    gs.scrollTop = Math.max(0, gs.scrollTop + delta);
  });
}

window.addEventListener('hashchange', () => applyRoute(routeFromHash()));
navLookup.addEventListener('click', () =>
  navigate(selectedItem ? 'item=' + encodeURIComponent(selectedItem['Item Code']) : 'lookup'));
navAll.addEventListener('click', () => navigate('products'));

/* ============================================================
   ITEM LOOKUP (search + report) — unchanged behaviour
   ============================================================ */
const searchInput = document.getElementById('searchInput');
const resultList = document.getElementById('resultList');
const generateBtn = document.getElementById('generateBtn');
const emptyState = document.getElementById('emptyState');
const report = document.getElementById('report');

let filtered = ITEMS.slice();
let selectedItem = null;

function fmtMoney(n, decimals){
  if(n === undefined || n === null) return '—';
  return Number(n).toLocaleString('en-US', {minimumFractionDigits: decimals ?? 2, maximumFractionDigits: decimals ?? 2});
}
function fmtInt(n){
  if(n === undefined || n === null) return '—';
  return Number(n).toLocaleString('en-US');
}
function fmtPct(n){
  if(n === undefined || n === null) return '—';
  return (n*100).toFixed(1) + '%';
}
function colorToHex(name){
  const map = {'gold':'#C6A24A','white':'#F2F1EC','silver':'#C7CBCF','antique gold':'#9C7A3B','white/gold':'#E8DFC0'};
  return map[(name||'').toLowerCase()] || '#cbd5e1';
}

function renderResults(){
  resultList.innerHTML = '';
  if(filtered.length === 0){
    resultList.innerHTML = '<div class="result-empty">No items match that search.</div>';
    return;
  }
  filtered.forEach(item => {
    const row = document.createElement('div');
    row.className = 'result-row' + (selectedItem === item ? ' selected' : '');
    row.innerHTML = `<span class="code">${item['Item Code']}</span><span class="desc">${item['Description']}</span>`;
    row.addEventListener('click', () => { openItem(item); });
    resultList.appendChild(row);
  });
}
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  filtered = ITEMS.filter(item =>
    item['Item Code'].toLowerCase().includes(q) ||
    item['Description'].toLowerCase().includes(q) ||
    item['Vendor Code'].toLowerCase().includes(q)
  );
  renderResults();
});
generateBtn.addEventListener('click', () => {
  /* Prefer an explicitly picked row, but only if it still matches the current
     search; otherwise just take the top result. */
  const pick = (selectedItem && filtered.includes(selectedItem)) ? selectedItem : filtered[0];
  if(!pick) return;
  openItem(pick);
});

function buildMatrix(wrapEl, item, key){
  // One continuous 13-month strip (oldest -> newest), spanning the year boundary.
  let total = 0;
  const cells = MONTH_WINDOW.map(w => {
    const yr = item.years[String(w.year)];
    const v = yr ? (yr[key][w.m] || 0) : 0;
    total += v;
    return { w: w, v: v };
  });
  const label = key === 'sales' ? 'Sold' : 'Received';
  let html = '<table class="matrix"><thead><tr><th></th>';
  cells.forEach(c => { html += `<th>${monthColLabel(c.w)}</th>`; });
  html += '<th>Total</th></tr></thead><tbody><tr>';
  html += `<td>${label}</td>`;
  cells.forEach(c => {
    const cls = [c.v === 0 ? 'zero' : '', key === 'sales' ? 'wk-cell' : ''].filter(Boolean).join(' ');
    html += `<td class="${cls}">${c.v === 0 ? '—' : c.v}</td>`;
  });
  html += `<td><strong>${total}</strong></td></tr></tbody></table>`;
  wrapEl.innerHTML = html;
  if(key === 'sales'){
    wrapEl.querySelectorAll('td.wk-cell').forEach(td =>
      td.addEventListener('click', () => openWeekModal(item)));
    const hint = document.getElementById('soldWeekHint');
    if(hint) hint.textContent = '  ·  click a month for the weekly breakdown';
  }
}

/* ============================================================
   WEEKLY SOLD — month-click popup breakdown  (prototype)
   ------------------------------------------------------------
   The source data is monthly totals only, so weekly figures are
   ESTIMATED: each month's total is spread across its days, weighted
   so Fri–Sun carry more (retail weekend peak) with a small stable
   per-day wobble. Weeks are Mon–Sun and cross month boundaries
   freely. The most recent week is partial (Mon → the day before the
   anchor day; skipped entirely if the anchor day is a Monday). Shows
   every week touching the last 3 calendar months; current year only.
   Swap in a real weekly/daily export later and this all goes real.
   ============================================================ */
const DAY_MS = 86400000;

/* Where "now" sits for the weekly view.
   - Live: the real date. The current week runs Mon → yesterday (today is
     still in progress, so it's left out); if today is Monday there's no
     partial week and the newest column is last week.
   - Prototype/stale: if the calendar has run past the last month we hold
     data for, clamp to that month's last day and count it as complete, so
     the popup still lands on populated weeks. Real data reaching the
     current month flips this back to the live path automatically. */
const WEEK_VIEW = (function(){
  const now = new Date();
  const y = now.getFullYear();
  let lastM = -1;
  ITEMS.forEach(it => {
    const a = it.years[String(y)];
    if(a) a.sales.forEach((v, i) => { if(v) lastM = Math.max(lastM, i); });
  });
  const dataEnd = lastM === -1 ? null : new Date(y, lastM + 1, 0);
  if(!dataEnd || now <= dataEnd){
    return { anchor: now, elapsed: (now.getDay() + 6) % 7 };          // Mon..yesterday
  }
  return { anchor: dataEnd, elapsed: ((dataEnd.getDay() + 6) % 7) + 1 }; // Mon..dataEnd
})();
const WEEK_ANCHOR = WEEK_VIEW.anchor;

function mondayOf(d){
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Mon=0 … Sun=6
  return x;
}
function fmtDay(d){ return d.getDate() + ' ' + MONTHS[d.getMonth()]; }

/* Stable ±12% wobble from a string key (FNV-1a). */
function seededWobble(key){
  let h = 2166136261;
  for(let i = 0; i < key.length; i++){ h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 0.88 + ((h >>> 0) % 1000) / 1000 * 0.24;
}
/* Month total spread across its days: Fri ×1.35, Sat/Sun ×1.9, else ×1. */
function dailySales(item, year, monthIdx){
  const arr = item.years[String(year)];
  const total = arr ? (arr.sales[monthIdx] || 0) : 0;
  const days = new Date(year, monthIdx + 1, 0).getDate();
  if(total === 0) return new Array(days).fill(0);
  const w = [];
  for(let d = 1; d <= days; d++){
    const dow = new Date(year, monthIdx, d).getDay();
    const peak = dow === 5 ? 1.35 : (dow === 0 || dow === 6) ? 1.9 : 1.0;
    w.push(peak * seededWobble(item['Item Code'] + '|' + year + '|' + monthIdx + '|' + d));
  }
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map(x => total * x / sum);
}
function weekUnits(item, weekStart, dayCount, cache){
  let sum = 0;
  for(let i = 0; i < dayCount; i++){
    const d = new Date(weekStart.getTime() + i * DAY_MS);
    if(d.getFullYear() !== WEEK_ANCHOR.getFullYear()) continue;
    const ck = d.getMonth();
    if(!cache[ck]) cache[ck] = dailySales(item, d.getFullYear(), d.getMonth());
    sum += cache[ck][d.getDate() - 1] || 0;
  }
  return Math.round(sum);
}
/* Mon–Sun weeks touching the 3 calendar months ending at the anchor month,
   newest first. The current week is partial (Mon → yesterday). */
function weeklyBreakdown(item){
  const curMon = mondayOf(WEEK_ANCHOR);
  const elapsed = WEEK_VIEW.elapsed;                          // days counted in the current week
  const firstMon = mondayOf(new Date(WEEK_ANCHOR.getFullYear(), WEEK_ANCHOR.getMonth() - 2, 1));
  const cache = {};
  const weeks = [];
  for(let ws = new Date(curMon); ws >= firstMon; ws = new Date(ws.getTime() - 7 * DAY_MS)){
    const isCurrent = ws.getTime() === curMon.getTime();
    if(isCurrent && elapsed === 0) continue;                   // anchor is a Monday — skip
    const dayCount = isCurrent ? elapsed : 7;
    weeks.push({
      start: new Date(ws),
      end: new Date(ws.getTime() + (dayCount - 1) * DAY_MS),
      partial: isCurrent,
      dayCount,
      units: weekUnits(item, ws, dayCount, cache),
    });
  }
  return weeks;
}

/* Turn a Sold-by-Month cell (Item Lookup matrix or All Products grid) into a
   drill-in to the weekly popup, without triggering the grid row's own click. */
function makeWeeklyCell(td, item){
  td.classList.add('wk-cell');
  td.title = 'Weekly breakdown';
  td.addEventListener('click', e => { e.stopPropagation(); openWeekModal(item); });
}

let weekModalReturn = null;
function openWeekModal(item){
  if(!item) return;
  const weeks = weeklyBreakdown(item);
  if(!weeks.length) return;
  const total = weeks.reduce((a, w) => a + w.units, 0);
  const max = Math.max(1, ...weeks.map(w => w.units));

  document.getElementById('wkTitle').textContent = 'Weekly sales — ' + item['Description'];
  document.getElementById('wkSub').textContent =
    item['Item Code'] + '  ·  ' + fmtDay(weeks[weeks.length - 1].start) + ' – ' +
    fmtDay(weeks[0].end) + '  ·  ' + weeks.length + ' weeks';

  const cols = weeks.map(w => {
    const heat = w.units / max;
    return '<div class="wk-col' + (w.partial ? ' wk-col-partial' : '') +
        '" title="' + fmtDay(w.start) + ' – ' + fmtDay(w.end) +
        (w.partial ? ' (' + w.dayCount + ' of 7 days)' : '') + '">' +
        '<div class="wk-col-v">' + (w.units === 0 ? '—' : w.units) + '</div>' +
        '<div class="wk-col-bar"><span style="height:' + (6 + heat * 94).toFixed(0) + '%"></span></div>' +
        '<div class="wk-col-k">' + fmtDay(w.start) + '</div>' +
        (w.partial ? '<div class="wk-col-tag">' + w.dayCount + '/7 d</div>' : '') +
      '</div>';
  }).join('');

  document.getElementById('wkBody').innerHTML =
    '<div class="wk-strip">' + cols + '</div>' +
    '<div class="wk-total">Last 3 months <strong>' + total.toLocaleString('en-US') + '</strong> units</div>';

  const modal = document.getElementById('weekModal');
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  weekModalReturn = document.activeElement;
  document.getElementById('wkClose').focus();
}
function closeWeekModal(){
  const modal = document.getElementById('weekModal');
  if(modal.hidden) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if(weekModalReturn && weekModalReturn.focus) weekModalReturn.focus();
}
(function(){
  const modal = document.getElementById('weekModal');
  if(!modal) return;
  modal.querySelectorAll('[data-wk-close]').forEach(el => el.addEventListener('click', closeWeekModal));
  document.addEventListener('keydown', e => { if(e.key === 'Escape') closeWeekModal(); });
})();
function buildBranchTable(wrapEl, item){
  const branch = BRANCH_BY_ITEM[item['Item Code']];
  if(!branch){ wrapEl.innerHTML = '<p class="foot-note">No branch-level data found for this item.</p>'; return; }
  const codes = Object.keys(branch);
  const total = codes.reduce((a,c) => a + branch[c], 0);
  let html = '<table class="matrix"><thead><tr><th>Branch Code</th>';
  codes.forEach(c => html += `<th>${c}</th>`);
  html += '<th>Total</th></tr></thead><tbody><tr><td>SOH</td>';
  codes.forEach(c => {
    const v = branch[c];
    html += `<td class="${v === 0 ? 'zero' : (v < 0 ? 'neg' : '')}">${v}</td>`;
  });
  html += `<td><strong>${total}</strong></td></tr></tbody></table>`;
  wrapEl.innerHTML = html;
}

function renderReport(item){
  emptyState.style.display = 'none';
  report.classList.add('visible');

  document.getElementById('hCode').textContent = item['Item Code'];
  document.getElementById('hDesc').textContent = item['Description'];
  document.getElementById('hPlan').textContent = 'Plan ' + item['Current Plan Code'];
  document.getElementById('hVendor').textContent = item['Vendor Name'];
  document.getElementById('hOrigin').textContent = 'Made in: ' + item['Country Of Origin'];
  document.getElementById('hColor').textContent = item['Item Color Name'];
  document.getElementById('hSwatchDot').style.background = colorToHex(item['Item Color Name']);

  document.getElementById('mLCost').textContent = fmtMoney(item['L-Cost (Aed)']);
  document.getElementById('mWas').textContent = fmtMoney(item['Was (Aed)'], 0);
  document.getElementById('mNow').textContent = fmtMoney(item['Now (Aed)'], 0);
  document.getElementById('mDisct').textContent = fmtPct(item['Disct%']);
  document.getElementById('mMrg').textContent = item['MRG Factor'].toFixed(2) + 'x';

  document.getElementById('mSoh').textContent = fmtInt(item['SOH']);
  document.getElementById('mAvg').textContent = fmtInt(item['AVG']);
  document.getElementById('mSm').textContent = item['SM'];
  document.getElementById('mPm').textContent = item['PM'];
  document.getElementById('mPoQty').textContent = fmtInt(item['PO-Qty']);
  document.getElementById('mLrcvQty').textContent = fmtInt(item['Lrcv Qty']);
  document.getElementById('mLrcvDate').textContent = item['Lrcv Date'];
  document.getElementById('mLastSold').textContent = item['Last Sold Date'] + ' (' + item['Last Sold Qty'] + ')';

  document.getElementById('mFirstFob').textContent = fmtMoney(item['First FOB']);
  document.getElementById('mPrevFob').textContent = fmtMoney(item['Previous FOB Cost']);
  document.getElementById('mLatestFob').textContent = fmtMoney(item['Latest FOB Cost']);
  document.getElementById('mCurrency').textContent = item['Currency Code'];

  document.getElementById('mCategory').textContent = item['Category'] + ' (' + item['Catg Code'] + ')';
  document.getElementById('mDept').textContent = item['Department Desc'];
  document.getElementById('mGroup').textContent = item['Group Desc'];
  document.getElementById('mPlan').textContent = item['Current Plan Code'];

  document.getElementById('oColor').textContent = item['Item Color Name'];
  document.getElementById('oLifestyle').textContent = lifestyleLabel(item['Lifestyle']);
  document.getElementById('oPuda').textContent = item['PUDA Desc'] + ' (' + item['PUDA Code'] + ')';

  document.getElementById('oVendorCode').textContent = item['Vendor Code'];
  document.getElementById('oVendorName').textContent = item['Vendor Name'];
  document.getElementById('oOrigin').textContent = item['Country Of Origin'];

  buildMatrix(document.getElementById('stockMatrixWrap'), item, 'stock');
  buildMatrix(document.getElementById('soldMatrixWrap'), item, 'sales');
  buildBranchTable(document.getElementById('branchMatrixWrap'), item);

  countUpMetrics();
}

/* Roll the purely-numeric metric values up from zero when a report opens.
   A generation counter cancels any still-running roll from a previous item. */
function countUpMetrics(){
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const gen = countUpMetrics._gen = (countUpMetrics._gen || 0) + 1;
  document.querySelectorAll('#report .metric-row .v').forEach(el => {
    const finalText = el.textContent.trim();
    const m = finalText.match(/^([\d,]+(?:\.\d+)?)(%|x)?$/);
    if(!m) return;
    const target = parseFloat(m[1].replace(/,/g, ''));
    const suffix = m[2] || '';
    const dec = (m[1].split('.')[1] || '').length;
    if(!isFinite(target) || target === 0) return;
    const t0 = performance.now(), dur = 560;
    el.classList.add('counting');
    const step = now => {
      if(countUpMetrics._gen !== gen) return;
      const p = Math.max(0, Math.min(1, (now - t0) / dur));
      const val = target * (1 - Math.pow(1 - p, 3));
      el.textContent = (dec ? val.toFixed(dec) : Math.round(val).toLocaleString('en-US')) + suffix;
      if(p < 1) requestAnimationFrame(step);
      else { el.textContent = finalText; el.classList.remove('counting'); }
    };
    requestAnimationFrame(step);
  });
}

/** Open an item in the Item Lookup view (search Generate, search result, grid row).
    Routes through the hash so the browser Back button returns to where you were. */
function openItem(item){
  navigate('item=' + encodeURIComponent(item['Item Code']));
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
  });
});

/* ============================================================
   ALL PRODUCTS — grid with collapsible column groups + filters
   ============================================================ */

// Column layout: identifying + at-a-glance columns are pinned first (frozen
// while scrolling), then classification/pricing/sourcing detail — most of
// which is collapsible — then the monthly time series at the far right.
const COLUMN_LAYOUT = [
  { type:'core', field:'Item Code', label:'Item Code', cls:'item-code mono', fz:'fz-itemcode' },
  { type:'core', field:'Vendor Code', label:'Vendor Code' },
  { type:'group', key:'range', title:'Range', short:'Range', cols:[
      { field:'Range Name', label:'Range Name' } ] },
  { type:'group', key:'class', title:'Classification', short:'Class', cols:[
      { field:'Catg Code', label:'Catg Code' },
      { field:'Category', label:'Category' },
      { field:'Department Code', label:'Dept Code' },
      { field:'Department Desc', label:'Dept Desc' },
      { field:'Group Code', label:'Grp Code' },
      { field:'Group Desc', label:'Grp Desc' },
      { field:'Sub Group Code', label:'SubGrp Code' },
      { field:'Sub Group Desc', label:'SubGrp Desc' } ] },
  { type:'group', key:'puda', title:'PUDA', short:'PUDA', cols:[
      { field:'PUDA Code', label:'PUDA Code', groupable:true },
      { field:'PUDA Desc', label:'PUDA Desc' } ] },
  { type:'core', field:'Current Plan Code', label:'Plan', groupable:true },
  { type:'group', key:'price', title:'Pricing', short:'Pricing', cols:[
      { field:'L-Cost (Aed)', label:'L-Cost', fmt:'money2' },
      { field:'Was (Aed)', label:'Was', fmt:'money0' },
      { field:'Now (Aed)', label:'Now', fmt:'money0' },
      { field:'Disct%', label:'Disct%', fmt:'pct' },
      { field:'MRG Factor', label:'Mrg', fmt:'x2' } ] },
  { type:'core', field:'SOH', label:'SOH', sortable:true },
  { type:'core', field:'PO-Qty', label:'PO Qty', sortable:true },
  { type:'core', field:'AVG', label:'AVG', sortable:true },
  { type:'core', field:'SM', label:'SM' },
  { type:'core', field:'PM', label:'PM' },
  { type:'core', field:'__spark', label:'13-mo Trend' },
  { type:'core', field:'Description', label:'Description', left:true },
  { type:'group', key:'attrs', title:'Attributes', short:'Attrs', cols:[
      { field:'Item Color Name', label:'Color' },
      { field:'Lifestyle', label:'Lifestyle', fmt:'lifestyle' },
      { field:'Vendor Name', label:'Vendor Name' },
      { field:'Country Of Origin', label:'Origin' },
      { field:'Currency Code', label:'Currency' } ] },
  { type:'group', key:'fob', title:'FOB Cost', short:'FOB', cols:[
      { field:'First FOB', label:'First FOB', fmt:'money2' },
      { field:'Previous FOB Cost', label:'Prev FOB', fmt:'money2' },
      { field:'Latest FOB Cost', label:'Latest FOB', fmt:'money2' } ] },
  { type:'group', key:'logi', title:'Receipts &amp; Sales', short:'Rcv/Sold', cols:[
      { field:'Lrcv Date', label:'Lrcv Date' },
      { field:'Lrcv Qty', label:'Lrcv Qty' },
      { field:'Last Sold Date', label:'Last Sold Date' } ] },
  // Kept out of the collapsible group so it stays visible when Receipts & Sales
  // is collapsed.
  { type:'core', field:'Last Sold Qty', label:'Last Sold Qty', sortable:true },
  { type:'group', key:'soldby', title:'Sold by Month', short:'Sold',
    cols: MONTH_WINDOW.map((w, i) => ({ field:'__sold_'+i, label: monthColLabel(w) })) },
  { type:'group', key:'stockin', title:'Stock In by Month', short:'Stock In',
    cols: MONTH_WINDOW.map((w, i) => ({ field:'__stock_'+i, label: monthColLabel(w) })) },
];

const ALL_GROUP_KEYS = COLUMN_LAYOUT.filter(e => e.type === 'group').map(e => e.key);
let collapsedGroups = new Set(['class','attrs','fob','logi']); // sensible default: keep the essentials visible first

/* Grid ordering has two independent layers that stack:
   - GROUP (categorical): click Plan / PUDA Code to cluster rows that share a
     value, groups running A→Z. Click again to clear. A thin rule divides one
     group from the next. PUDA Code groups by its leading letter only (all
     A… together, then all F…); Plan groups by the whole code.
   - SORT (directional): click SOH / PO Qty / AVG / Last Sold Qty to cycle
     none → high→low → low→high → none.
   With both on, the group is primary and the directional sort orders rows
   inside each group; turning one on never clears the other. */
let gridSort = null;  // { field, dir: 'desc' | 'asc' }
let gridGroup = null; // { field }
/* Per-field grouping key — how much of the value defines a group. Default is
   the whole value; PUDA Code clusters on its first letter. */
const GROUP_KEY = {
  'PUDA Code': v => String(v == null ? '' : v).trim().charAt(0).toUpperCase(),
};
function groupKeyFor(field, val){
  const fn = GROUP_KEY[field];
  return fn ? fn(val) : String(val == null ? '' : val).trim().toUpperCase();
}
function cycleSort(field){
  if(!gridSort || gridSort.field !== field) gridSort = { field: field, dir: 'desc' };
  else if(gridSort.dir === 'desc') gridSort = { field: field, dir: 'asc' };
  else gridSort = null;
  renderGrid();
}
function cycleGroup(field){
  gridGroup = gridGroup && gridGroup.field === field ? null : { field: field };
  renderGrid();
}
function sortGridItems(items){
  const g = gridGroup;
  const s = gridSort;
  if(!g && !s) return items;
  const arr = items.slice();
  const origIdx = new Map(arr.map((it, i) => [it, i]));
  const groupVal = it => groupKeyFor(g.field, it[g.field]);
  const sortVal = it => Number(it[s.field]) || 0;
  const mul = s && s.dir === 'asc' ? 1 : -1;
  arr.sort((a, b) => {
    if(g){
      const ga = groupVal(a), gb = groupVal(b);
      if(ga !== gb) return ga < gb ? -1 : 1;          // groups A→Z
    }
    if(s){
      const d = (sortVal(a) - sortVal(b)) * mul;      // then directional, within group
      if(d) return d;
    }
    return origIdx.get(a) - origIdx.get(b);           // stable otherwise
  });
  return arr;
}

function fmtCell(v, fmt){
  if(v === undefined || v === null || v === '') return '—';
  if(fmt === 'money2') return fmtMoney(v, 2);
  if(fmt === 'money0') return fmtMoney(v, 0);
  if(fmt === 'pct') return fmtPct(v);
  if(fmt === 'x2') return Number(v).toFixed(2) + 'x';
  if(fmt === 'lifestyle') return lifestyleLabel(v);
  return v;
}

function visibleColumns(){
  const out = [];
  COLUMN_LAYOUT.forEach(entry => {
    if(entry.type === 'core'){ out.push(entry); return; }
    if(collapsedGroups.has(entry.key)){
      out.push({ type:'collapsed', key:entry.key, title:entry.title });
    } else {
      entry.cols.forEach(c => out.push({ type:'field', field:c.field, label:c.label, fmt:c.fmt, group:entry.key, groupable:c.groupable }));
    }
  });
  return out;
}

function toggleGroup(key){
  if(collapsedGroups.has(key)) collapsedGroups.delete(key); else collapsedGroups.add(key);
  renderGrid();
}
document.getElementById('collapseAllBtn').addEventListener('click', () => {
  collapsedGroups = new Set(ALL_GROUP_KEYS);
  renderGrid();
});
document.getElementById('expandAllBtn').addEventListener('click', () => {
  collapsedGroups = new Set();
  renderGrid();
});
document.getElementById('clearSortBtn').addEventListener('click', () => {
  gridSort = null;
  gridGroup = null;
  renderGrid();
});

/* ---- Manual column resizing ---- */
const colWidths = {};          // data-col key -> pixel width (set once resizing starts)
let colResizeActive = false;   // becomes true on the first drag; grid then uses fixed layout

function colKey(entry){
  return entry.type === 'collapsed' ? 'grp:' + entry.key : entry.field;
}
function addColResizer(th){
  const grip = document.createElement('span');
  grip.className = 'col-resizer';
  grip.addEventListener('mousedown', e => beginColResize(e, th, grip));
  grip.addEventListener('click', e => e.stopPropagation());
  th.appendChild(grip);
}
// <colgroup> drives the widths — in a fixed table layout only first-row cells (or
// <col>s) size columns, and our leaf headers live in the second header row.
function buildColGroup(cols){
  const cg = document.createElement('colgroup');
  cols.forEach(c => {
    const col = document.createElement('col');
    col.dataset.col = colKey(c);
    cg.appendChild(col);
  });
  return cg;
}
function applyColWidths(table){
  let total = 0;
  table.querySelectorAll('colgroup col').forEach(col => {
    const w = colWidths[col.dataset.col];
    if(w){ col.style.width = w + 'px'; total += w; }
  });
  if(total) table.style.width = total + 'px';
}
// Current on-screen width of a header cell, plus a couple of px of slack so
// switching to a fixed layout doesn't instantly ellipsis-clip everything.
function naturalColWidth(th){
  return Math.ceil(th.getBoundingClientRect().width) + 3;
}
// Freeze current widths and switch the grid to a fixed layout (first drag only).
function ensureColResizeMode(table){
  if(colResizeActive) return;
  table.querySelectorAll('thead th[data-col]').forEach(h => {
    colWidths[h.dataset.col] = naturalColWidth(h);
  });
  colResizeActive = true;
  table.classList.add('resizable');
  applyColWidths(table);
}

function endColDrag(grip, move, done){
  document.removeEventListener('mousemove', move);
  document.removeEventListener('mouseup', done);
  grip.classList.remove('dragging');
  document.body.classList.remove('col-resizing');
  syncStickyHeader();
}

// Drag the edge of an expanded group's header to resize the whole block — every
// column in the group scales together.
function beginGroupResize(e, grip, leafKeys){
  e.preventDefault();
  e.stopPropagation();
  const table = document.getElementById('gridTable');
  ensureColResizeMode(table);
  const starts = leafKeys.map(k => colWidths[k] || 60);
  const startTotal = starts.reduce((a, b) => a + b, 0);
  const startX = e.clientX;
  grip.classList.add('dragging');
  document.body.classList.add('col-resizing');
  function move(ev){
    const target = Math.max(leafKeys.length * 40, startTotal + (ev.clientX - startX));
    const scale = target / startTotal;
    leafKeys.forEach((k, i) => { colWidths[k] = Math.max(40, Math.round(starts[i] * scale)); });
    applyColWidths(table);
  }
  function done(){ endColDrag(grip, move, done); }
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', done);
}

function beginColResize(e, th, grip){
  e.preventDefault();
  e.stopPropagation();
  const table = document.getElementById('gridTable');
  ensureColResizeMode(table);
  const key = th.dataset.col;
  const startX = e.clientX;
  const startW = colWidths[key] || Math.round(th.getBoundingClientRect().width);
  grip.classList.add('dragging');
  document.body.classList.add('col-resizing');
  function move(ev){
    colWidths[key] = Math.max(40, startW + (ev.clientX - startX));
    applyColWidths(table);
  }
  function done(){ endColDrag(grip, move, done); }
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', done);
}

function addGroupResizer(gth, leafKeys){
  const grip = document.createElement('span');
  grip.className = 'col-resizer';
  grip.addEventListener('mousedown', e => beginGroupResize(e, grip, leafKeys));
  grip.addEventListener('click', e => e.stopPropagation());
  gth.appendChild(grip);
}

const GROUP_ICON =
  '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">' +
  '<rect x="1" y="1.4" width="10" height="2.2" rx="1"/>' +
  '<rect x="3.5" y="4.9" width="7.5" height="2.2" rx="1"/>' +
  '<rect x="3.5" y="8.4" width="7.5" height="2.2" rx="1"/></svg>';
/* Wire a header cell (core or group-field) as a group-by toggle. */
function applyGroupHeader(th, field){
  th.classList.add('groupable');
  th.title = 'Group rows by ' + th.textContent.trim();
  if(gridGroup && gridGroup.field === field){
    th.classList.add('grouped');
    const ind = document.createElement('span');
    ind.className = 'group-ind';
    ind.innerHTML = GROUP_ICON;
    th.appendChild(ind);
  }
  th.addEventListener('click', () => cycleGroup(field));
}

function buildGridHeader(){
  const groupRow = document.createElement('tr');
  groupRow.className = 'group-row';
  const fieldRow = document.createElement('tr');
  fieldRow.className = 'field-row';

  COLUMN_LAYOUT.forEach(entry => {
    if(entry.type === 'core'){
      const gth = document.createElement('th');
      gth.className = 'core' + (entry.fz ? ' ' + entry.fz : '');
      gth.rowSpan = 2;
      gth.textContent = entry.label;
      gth.dataset.col = entry.field;
      if(entry.field === 'AVG') gth.classList.add('avg-head');
      if(entry.sortable){
        gth.classList.add('sortable');
        if(gridSort && gridSort.field === entry.field){
          gth.classList.add('sorted');
          const ind = document.createElement('span');
          ind.className = 'sort-ind';
          ind.textContent = gridSort.dir === 'asc' ? '▲' : '▼';
          gth.appendChild(ind);
        }
        gth.addEventListener('click', () => cycleSort(entry.field));
      } else if(entry.groupable){
        applyGroupHeader(gth, entry.field);
      }
      addColResizer(gth);
      groupRow.appendChild(gth);
      return;
    }
    // group entry
    if(collapsedGroups.has(entry.key)){
      const gth = document.createElement('th');
      gth.className = 'collapsed';
      gth.rowSpan = 2;
      gth.innerHTML = `<span class="chev">+</span>${entry.title}`;
      gth.title = 'Click to expand: ' + entry.title;
      gth.dataset.col = 'grp:' + entry.key;
      gth.addEventListener('click', () => toggleGroup(entry.key));
      groupRow.appendChild(gth);
    } else {
      const gth = document.createElement('th');
      gth.colSpan = entry.cols.length;
      gth.innerHTML = `<span class="chev">−</span>${entry.title}`;
      gth.title = 'Click to collapse this section';
      gth.addEventListener('click', () => toggleGroup(entry.key));
      addGroupResizer(gth, entry.cols.map(c => c.field));
      groupRow.appendChild(gth);
      entry.cols.forEach((c, i) => {
        const fth = document.createElement('th');
        fth.textContent = c.label;
        fth.classList.add('grp-' + entry.key);
        if(i === 0) fth.classList.add('group-start');
        fth.dataset.col = c.field;
        if(c.groupable) applyGroupHeader(fth, c.field);
        addColResizer(fth);
        fieldRow.appendChild(fth);
      });
    }
  });

  // Where one group's divider (2px) meets the previous cell's own 1px border we
  // get a fuzzy pale seam — drop the preceding cell's right border so the
  // divider reads as one clean line.
  const fieldThs = Array.from(fieldRow.children);
  fieldThs.forEach((th, i) => {
    if(i > 0 && th.classList.contains('group-start')) fieldThs[i - 1].classList.add('group-end');
  });

  const thead = document.createElement('thead');
  thead.appendChild(groupRow);
  thead.appendChild(fieldRow);
  return thead;
}

function cellValueForItem(item, field){
  if(field.startsWith('__stock_')){
    const w = MONTH_WINDOW[+field.slice(8)];
    const yr = w && item.years[String(w.year)];
    return yr ? yr.stock[w.m] : null;
  }
  if(field.startsWith('__sold_')){
    const w = MONTH_WINDOW[+field.slice(7)];
    const yr = w && item.years[String(w.year)];
    return yr ? yr.sales[w.m] : null;
  }
  return item[field];
}

function buildGridBody(items, cols){
  const tbody = document.createElement('tbody');
  // First column of each expanded group gets a visual divider so adjacent
  // groups (e.g. Sold by Month / Stock In by Month, same 13-month strip) aren't ambiguous.
  const groupStartIdx = new Set();
  cols.forEach((col, i) => {
    if(col.type === 'field' && (i === 0 || cols[i-1].group !== col.group)) groupStartIdx.add(i);
  });
  // The cell just before a divider drops its own right border so the 2px
  // divider is a single crisp line, not a doubled-up pale seam.
  const groupEndIdx = new Set();
  groupStartIdx.forEach(i => { if(i > 0) groupEndIdx.add(i - 1); });

  const gField = gridGroup ? gridGroup.field : null;
  let prevGroupVal = null;
  items.forEach((item, itemIdx) => {
    const groupVal = gField ? groupKeyFor(gField, item[gField]) : null;
    const newGroup = gField && itemIdx > 0 && groupVal !== prevGroupVal;
    prevGroupVal = groupVal;

    const tr = document.createElement('tr');
    tr.className = 'row-item';
    tr.dataset.code = item['Item Code'];
    if(newGroup) tr.classList.add('group-break');
    tr.title = 'Open ' + item['Item Code'] + ' in Item Lookup';
    tr.addEventListener('click', () => { resumeCode = item['Item Code']; openItem(item); });

    cols.forEach((col, ci) => {
      const td = document.createElement('td');
      if(groupStartIdx.has(ci)) td.classList.add('group-start');
      if(groupEndIdx.has(ci)) td.classList.add('group-end');
      if(col.type === 'collapsed'){
        td.textContent = '';
        td.classList.add('collapsed-cell');
        if(col.key === 'soldby') makeWeeklyCell(td, item);
      } else if(col.type === 'core'){
        if(col.field === '__spark'){
          td.classList.add('spark-cell', 'left');
          td.innerHTML = sparkSVG(item);
        } else if(col.field === 'SM' || col.field === 'PM'){
          td.classList.add('cover-cell', 'left');
          td.innerHTML = coverCell(item[col.field]);
        } else {
          const v = cellValueForItem(item, col.field);
          td.textContent = (v === undefined || v === null || v === '') ? '—' : v;
          if(col.cls) td.className = col.cls;
          if(col.fz) td.classList.add(col.fz);
          if(col.left) td.classList.add('left');
          if(col.field === 'AVG') td.classList.add('avg-cell');
        }
      } else {
        td.classList.add('grp-' + col.group);
        const isMonthly = col.field.startsWith('__stock_') || col.field.startsWith('__sold_');
        if(isMonthly){
          const raw = cellValueForItem(item, col.field);
          const num = raw === null || raw === undefined ? 0 : raw;
          td.textContent = num === 0 ? '—' : num;
          if(num === 0) td.classList.add('zero');
          if(num < 0) td.classList.add('neg');
          if(col.group === 'soldby') makeWeeklyCell(td, item);
        } else {
          td.textContent = fmtCell(item[col.field], col.fmt);
        }
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  return tbody;
}

function getFilteredItems(){
  return ITEMS.filter(item => {
    for(const key of Object.keys(activeFilters)){
      const selected = activeFilters[key];
      if(selected.size === 0) continue;
      if(!selected.has(filterKey(key, item[FILTER_FIELD_MAP[key]]))) return false;
    }
    return true;
  });
}

function renderGrid(){
  const items = sortGridItems(getFilteredItems());
  const cols = visibleColumns();
  const table = document.getElementById('gridTable');
  table.innerHTML = '';
  table.style.width = '';
  table.classList.remove('resizable');
  const thead = buildGridHeader();
  table.appendChild(buildColGroup(cols));
  table.appendChild(thead);
  table.appendChild(buildGridBody(items, cols));
  document.getElementById('gridRowCount').textContent = items.length + ' of ' + ITEMS.length + ' items';
  document.getElementById('clearSortBtn').hidden = !gridSort && !gridGroup;
  if(colResizeActive){
    // capture the natural width of any column shown for the first time (grid is
    // still auto-laid-out here), then lock it to fixed widths.
    table.querySelectorAll('thead th[data-col]').forEach(th => {
      if(colWidths[th.dataset.col] == null) colWidths[th.dataset.col] = naturalColWidth(th);
    });
    table.classList.add('resizable');
    applyColWidths(table);
  }
  syncStickyHeader();
  // On the very first render web fonts may still be loading; the rotated
  // collapsed-group labels change height once they swap in, which throws the
  // measurement below off until the next re-render. Re-measure after paint and
  // once fonts settle so the two header rows always sit flush.
  requestAnimationFrame(syncStickyHeader);
  if(document.fonts && document.fonts.ready){
    document.fonts.ready.then(() => requestAnimationFrame(syncStickyHeader));
  }
}

// The second header row's sticky offset must equal the first row's actual
// rendered height (it varies with how tall the rotated collapsed labels are) —
// measure it after layout instead of guessing a fixed number.
function syncStickyHeader(){
  const thead = document.querySelector('#gridTable thead');
  if(!thead) return;
  const groupRow = thead.querySelector('tr.group-row');
  const fieldRow = thead.querySelector('tr.field-row');
  if(!groupRow || !fieldRow) return;
  const h = groupRow.getBoundingClientRect().height;
  fieldRow.querySelectorAll('th').forEach(th => { th.style.top = h + 'px'; });
}
window.addEventListener('resize', syncStickyHeader);

/* ---- Filters ---- */
const FILTER_FIELD_MAP = {
  'Category Code': 'Catg Code',
  'Department Desc': 'Department Desc',
  'Vendor Code': 'Vendor Code',
  'PUDA Desc': 'PUDA Desc',
  'Current Plan Code': 'Current Plan Code',
  'Range Name': 'Range Name',
};
// Some fields have a known master list of codes that's bigger than whatever
// happens to be in the current sample data — show the full list and grey
// out codes that aren't present yet, rather than only listing what's loaded.
const FULL_VALUE_LISTS = {
  // O / S / W items are dropped on load (see HIDDEN_CATG_CODES), so they're not
  // offered here either.
  'Category Code': ['A','F','K'],
  'Current Plan Code': ['A','C','D','H','K','M','N','R','U'],
};
// Per-filter display names for coded values. The checkbox value stays the raw
// code (that's what the item data holds); only the visible label changes.
const FILTER_VALUE_LABELS = {
  'Category Code': {
    A: 'Accessory',
    F: 'Furniture',
    K: 'Kids',
  },
};
// Filters that get a text box to search within their (often long) option list.
const FILTER_SEARCHABLE = new Set(['Vendor Code', 'PUDA Desc', 'Range Name']);
function filterValueLabel(label, val){
  const map = FILTER_VALUE_LABELS[label];
  return (map && map[val]) || val;
}

// Some filters group by a normalised key rather than the raw field value.
// PUDA Desc reads "<area> / <product>" — the option shows the full string but
// filtering is by the product name (everything after the "/").
function pudaProductName(v){
  const s = String(v);
  const i = s.indexOf('/');
  return i === -1 ? s.trim() : s.slice(i + 1).trim();
}
const FILTER_MATCH_KEY = { 'PUDA Desc': pudaProductName };
function filterKey(label, val){
  const fn = FILTER_MATCH_KEY[label];
  return fn ? fn(val) : String(val);
}
const activeFilters = {};
Object.keys(FILTER_FIELD_MAP).forEach(k => activeFilters[k] = new Set());

function uniqueValues(field){
  const set = new Set(ITEMS.map(i => String(i[field])));
  return Array.from(set).sort();
}

function renderFilterBlocks(){
  const wrap = document.getElementById('filterBlocks');
  wrap.innerHTML = '';
  Object.entries(FILTER_FIELD_MAP).forEach(([label, field]) => {
    const block = document.createElement('div');
    block.className = 'filter-block';
    const h3 = document.createElement('h3');
    h3.innerHTML = `<span>${label}</span><span class="n" data-count-for="${label}"></span>`;
    block.appendChild(h3);
    const optsWrap = document.createElement('div');
    optsWrap.className = 'filter-opts';

    const present = new Set(uniqueValues(field));
    const master = FULL_VALUE_LISTS[label];
    const values = master ? master : Array.from(present).sort();

    values.forEach(val => {
      const row = document.createElement('label');
      row.className = 'filter-opt';
      row.innerHTML = `<input type="checkbox" data-filter="${label}" value="${val}"><span class="lbl">${filterValueLabel(label, val)}</span>`;
      const cb = row.querySelector('input');
      cb.addEventListener('change', () => {
        const k = filterKey(label, val);
        if(cb.checked) activeFilters[label].add(k); else activeFilters[label].delete(k);
        row.classList.toggle('checked', cb.checked);
        updateFilterCounts();
        updateFilterAvailability();
        renderFilterChips();
        renderGrid();
      });
      optsWrap.appendChild(row);
    });

    if(FILTER_SEARCHABLE.has(label)){
      const search = document.createElement('input');
      search.type = 'text';
      search.className = 'filter-search';
      search.placeholder = 'Search ' + label + '…';
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        optsWrap.querySelectorAll('.filter-opt').forEach(row => {
          const cb = row.querySelector('input');
          const hay = (row.textContent + ' ' + (cb ? cb.value : '')).toLowerCase();
          row.classList.toggle('nomatch', q !== '' && !hay.includes(q));
        });
      });
      block.appendChild(search);
    }

    block.appendChild(optsWrap);
    wrap.appendChild(block);
  });
  updateFilterCounts();
  updateFilterAvailability();
}
function updateFilterCounts(){
  document.querySelectorAll('[data-count-for]').forEach(el => {
    const label = el.dataset.countFor;
    const n = activeFilters[label].size;
    el.textContent = n > 0 ? n + ' selected' : '';
  });
}

/* Active-filter chips above the grid — one per ticked option, click to remove. */
function renderFilterChips(){
  const wrap = document.getElementById('filterChips');
  if(!wrap) return;
  const checked = [...document.querySelectorAll('.filter-opt input:checked')];
  wrap.innerHTML = '';
  checked.forEach(cb => {
    const opt = cb.closest('.filter-opt');
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.innerHTML = '<span class="chip-k">' + cb.dataset.filter + '</span>'
      + '<span class="chip-v"></span><span class="chip-x" aria-hidden="true">&times;</span>';
    chip.querySelector('.chip-v').textContent = opt.querySelector('.lbl').textContent;
    chip.title = 'Remove filter';
    chip.addEventListener('click', () => { cb.checked = false; cb.dispatchEvent(new Event('change')); });
    wrap.appendChild(chip);
  });
  if(checked.length > 1){
    const clr = document.createElement('button');
    clr.type = 'button';
    clr.className = 'chip chip-clear';
    clr.textContent = 'Clear all';
    clr.addEventListener('click', () => document.getElementById('clearFiltersBtn').click());
    wrap.appendChild(clr);
  }
  wrap.hidden = checked.length === 0;
}

// Faceted filtering: an option stays enabled only if choosing it would still
// return rows given every OTHER filter's current selection. A filter ignores
// its own selection so you can keep multi-selecting within it. Already-checked
// options never get disabled.
function itemsMatchingFiltersExcept(exceptLabel){
  return ITEMS.filter(item => {
    for(const key of Object.keys(activeFilters)){
      if(key === exceptLabel) continue;
      const sel = activeFilters[key];
      if(sel.size === 0) continue;
      if(!sel.has(filterKey(key, item[FILTER_FIELD_MAP[key]]))) return false;
    }
    return true;
  });
}
function updateFilterAvailability(){
  Object.entries(FILTER_FIELD_MAP).forEach(([label, field]) => {
    // Only *hide* options once some OTHER filter is narrowing things down.
    // With nothing else selected we keep the old look: full list, with codes
    // that simply aren't in the loaded data greyed out.
    const drivenByOthers = Object.keys(activeFilters).some(k => k !== label && activeFilters[k].size > 0);
    const available = new Set(itemsMatchingFiltersExcept(label).map(i => filterKey(label, i[field])));
    document.querySelectorAll('.filter-opt input[data-filter="' + label + '"]').forEach(cb => {
      const row = cb.closest('.filter-opt');
      const ok = available.has(filterKey(label, cb.value)) || cb.checked;
      row.classList.toggle('unavail', !ok && drivenByOthers);
      row.classList.toggle('disabled', !ok && !drivenByOthers);
      cb.disabled = !ok && !drivenByOthers;
      row.title = (!ok && !drivenByOthers) ? 'No items with this code in the current data' : '';
    });
  });
}
document.getElementById('clearFiltersBtn').addEventListener('click', () => {
  Object.keys(activeFilters).forEach(k => activeFilters[k].clear());
  document.querySelectorAll('.filter-opt input').forEach(cb => { cb.checked = false; cb.closest('.filter-opt').classList.remove('checked'); });
  updateFilterCounts();
  updateFilterAvailability();
  renderFilterChips();
  renderGrid();
});

/* ============================================================
   INIT
   ============================================================ */
renderResults();
selectedItem = ITEMS[0];
renderResults();
if(selectedItem) renderReport(selectedItem);
renderFilterBlocks();
renderFilterChips();

/* Grid scroll → shadow the sticky header / frozen column only when scrolled */
(function(){
  const gs = document.querySelector('.grid-scroll');
  if(!gs) return;
  const onScroll = () => {
    gs.classList.toggle('scrolled-y', gs.scrollTop > 1);
    gs.classList.toggle('scrolled-x', gs.scrollLeft > 1);
  };
  gs.addEventListener('scroll', onScroll, { passive: true });
})();

/* Restore whatever the URL points at (All Products by default) */
applyRoute(routeFromHash());
