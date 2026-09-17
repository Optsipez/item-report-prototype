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

/* Tiny inline 13-mo Trend cell — a mini proportional fill bar (no line/SVG
   at all): Stock (gold) fills down from the top, Sold (blue) fills up from
   the bottom, always meeting exactly at Sold's share of the two (so the bar
   is always fully coloured — no empty space unless there's truly no data).
   A fixed white reference line sits at the exact vertical centre and never
   moves, purely so a glance shows whether Sold's fill has risen past the
   halfway point (i.e. Sold > Stock) or not. Click opens the full
   period-by-period breakdown in the popup. */
function trendMiniBar(item){
  const sold = monthlySeries(item), stock = monthlyStockSeries(item);
  const stockTotal = stock.reduce((a, b) => a + b, 0);
  const soldTotal = sold.reduce((a, b) => a + b, 0);
  const clickHint = ' — click for the full 13-month breakdown';
  const denom = stockTotal + soldTotal;
  if(denom === 0) return '<span class="spark-empty" title="No stock or sales activity' + clickHint + '">—</span>';
  const sellThrough = Math.round((soldTotal / denom) * 100);
  const salePct = (soldTotal / denom * 100).toFixed(1);
  const stockPct = (100 - salePct).toFixed(1);
  const title = 'Stock ' + stockTotal.toLocaleString('en-US') + '  ·  Sold ' + soldTotal.toLocaleString('en-US') +
    '  ·  ' + sellThrough + '% sell-through (13-month total)' + clickHint;
  // A number you can actually read at a glance, plus the stacked bar as a
  // secondary visual cue — collapsed to just a thin two-colour block (no
  // label) it was unreadable; the split alone doesn't say what it's a split
  // OF without a number attached.
  return '<span class="mini-vbar" title="' + title + '">' +
    '<span class="mini-vbar-pct">' + sellThrough + '%</span>' +
    '<span class="mini-vbar-track">' +
      '<span class="mini-vbar-seg mini-vbar-seg-stock" style="width:' + stockPct + '%"></span>' +
      '<span class="mini-vbar-seg mini-vbar-seg-sale" style="width:' + salePct + '%"></span>' +
    '</span>' +
    '</span>';
}

/* 13-month trend popup — one column per period (current month, then four
   3-month periods), using all 13 months. Same proportional-fill idea as the
   mini cell above: each column is always fully coloured, Stock (gold) down
   from the top and Sold (blue) up from the bottom, meeting at Sold's actual
   share of the two that period — plus the same fixed white centre line. */
function monthlySeries(item){
  return MONTH_WINDOW.map(w => {
    const yr = item.years[String(w.year)];
    return yr ? (yr.sales[w.m] || 0) : 0;
  });
}
function monthlyStockSeries(item){
  return MONTH_WINDOW.map(w => {
    const yr = item.years[String(w.year)];
    return yr ? (yr.stock[w.m] || 0) : 0;
  });
}
/* Total Received Qty — stock received (GRN) summed over the same rolling
   13-month window as the 13-mo Trend column, not a fixed calendar year. */
function totalReceivedQty(item){
  return monthlyStockSeries(item).reduce((a, b) => a + b, 0);
}
const TREND_BUCKET_IDX = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11], [12]]; // oldest -> newest
function trendBars(item){
  const sold = monthlySeries(item), stock = monthlyStockSeries(item);
  const bars = TREND_BUCKET_IDX.map(idxs => {
    const soldTotal = idxs.reduce((a, i) => a + sold[i], 0);
    const stockTotal = idxs.reduce((a, i) => a + stock[i], 0);
    return {
      soldTotal, stockTotal, monthCount: idxs.length,
      from: MONTH_WINDOW[idxs[0]], to: MONTH_WINDOW[idxs[idxs.length - 1]],
    };
  });
  bars.reverse();   // newest -> oldest, current month first, matching the grid's month order
  return bars;
}
function buildTrendChart(item){
  const bars = trendBars(item);
  const bLabel = b => b.monthCount === 1 ? monthColLabel(b.from)
    : b.from.year === b.to.year ? monthColLabel(b.from).slice(0, 3) + '–' + monthColLabel(b.to)
    : monthColLabel(b.from) + '–' + monthColLabel(b.to);

  const legend = '<div class="tr-legend">' +
    '<span class="tr-legend-item"><span class="tr-legend-dot tr-legend-dot-stock"></span>Stock</span>' +
    '<span class="tr-legend-item"><span class="tr-legend-dot tr-legend-dot-sale"></span>Sold</span>' +
    '</div>';

  const cols = bars.map(b => {
    const denom = b.stockTotal + b.soldTotal;
    const isEmpty = denom === 0;
    const sellThrough = isEmpty ? null : Math.round((b.soldTotal / denom) * 100);
    const salePct = isEmpty ? 0 : (b.soldTotal / denom * 100).toFixed(1);
    const stockPct = isEmpty ? 0 : (100 - salePct).toFixed(1);
    const title = bLabel(b) + ': Stock ' + b.stockTotal.toLocaleString('en-US') +
      '  ·  Sold ' + b.soldTotal.toLocaleString('en-US') +
      (sellThrough == null ? '' : '  ·  ' + sellThrough + '% sell-through');
    // No stock or sales at all that period — nothing to compare, so a neutral
    // empty bar rather than a meaningless 0/0 split.
    const bar = isEmpty
      ? '<div class="tr-vbar tr-vbar-empty"></div>'
      : '<div class="tr-vbar">' +
          '<span class="tr-vbar-fill">' +
            '<span class="tr-vbar-seg tr-vbar-seg-stock" style="height:' + stockPct + '%"></span>' +
            '<span class="tr-vbar-seg tr-vbar-seg-sale" style="height:' + salePct + '%"></span>' +
          '</span>' +
          '<span class="tr-vbar-refline"></span>' +
        '</div>';
    return '<div class="tr-col-item" title="' + title + '">' +
        bar +
        '<div class="tr-col-label">' + bLabel(b) + '</div>' +
        '<div class="tr-col-vals">' +
          '<span class="tr-col-stock">' + (b.stockTotal === 0 ? '—' : b.stockTotal.toLocaleString('en-US')) + '</span>' +
          ' / ' +
          '<span class="tr-col-sale">' + (b.soldTotal === 0 ? '—' : b.soldTotal.toLocaleString('en-US')) + '</span>' +
        '</div>' +
        '<div class="tr-col-pct">' + (sellThrough == null ? '—' : sellThrough + '% sell-thru') + '</div>' +
      '</div>';
  }).join('');

  return '<div class="tr-chart">' + legend + '<div class="tr-cols">' + cols + '</div></div>';
}
let trendModalReturn = null;
function openTrendModal(item){
  if(!item) return;
  document.getElementById('trTitle').textContent = '13-month trend — ' + item['Description'];
  document.getElementById('trSub').textContent = item['Item Code'];
  document.getElementById('trBody').innerHTML = buildTrendChart(item);

  const modal = document.getElementById('trendModal');
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  trendModalReturn = document.activeElement;
  document.getElementById('trClose').focus();
}
function closeTrendModal(){
  const modal = document.getElementById('trendModal');
  if(modal.hidden) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if(trendModalReturn && trendModalReturn.focus) trendModalReturn.focus();
}
(function(){
  const modal = document.getElementById('trendModal');
  if(!modal) return;
  modal.querySelectorAll('[data-tr-close]').forEach(el => el.addEventListener('click', closeTrendModal));
  document.addEventListener('keydown', e => { if(e.key === 'Escape') closeTrendModal(); });
})();

/* Months-of-cover cell: value + a health bar (red <1, amber <2.5, green above). */
/* Colour bands for months-of-cover (SM / PM):
   X or under 3 months -> red, 3–5 -> gold, over 5 -> green. */
function coverCell(v){
  const isX = v === 'X';
  const n = parseFloat(v);
  const cls = isX ? 'cover-crit'
    : !isFinite(n) ? 'cover-flat'
    : n < 3 ? 'cover-crit'
    : n <= 5 ? 'cover-warn'
    : 'cover-ok';
  const w = isX ? 8 : Math.max(6, Math.min(100, (n / 8) * 100));
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

/* Index of the last month in MONTH_WINDOW that any item actually sold in — i.e.
   where the elapsed part of the window ends. The trend sparkline stops here so
   it never draws a phantom drop for a month that hasn't happened yet. */
const MONTH_WINDOW_LAST_DATA = (function(){
  let last = 0;
  MONTH_WINDOW.forEach((w, i) => {
    if(ITEMS.some(it => {
      const yr = it.years[String(w.year)];
      return yr && (yr.sales[w.m] || 0) !== 0;
    })) last = i;
  });
  return last;
})();

/* Hover explainer for the 13-mo Trend column header. */
const SPARK_TIP =
  '13-month trend, ' +
  monthColLabel(MONTH_WINDOW[0]) + ' to ' + monthColLabel(MONTH_WINDOW[MONTH_WINDOW_LAST_DATA]) +
  ' — a small bar, Stock (gold) filling down from the top and Sold (blue)\n' +
  'filling up from the bottom, meeting at Sold\'s share of the two — always\n' +
  'fully coloured, never empty. A fixed white line marks the exact centre:\n' +
  'when the blue rises past it, Sold has overtaken Stock over the 13 months.\n' +
  'The actual totals and sell-through rate (Sold ÷ (Stock + Sold)) are in the tooltip.\n' +
  'Click for a full breakdown: the current month, then four 3-month periods\n' +
  'going backwards, each with its own bar, totals, and sell-through %.';

/* Hover explainer for the YTD Sold column header. */
const YTD_TIP =
  'Units sold Jan – ' + MONTHS[REPORT_MONTH.month] + ' ' + REPORT_MONTH.year +
  ' (year to date). Extends on its own as the calendar advances.';

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
/* Margin%  (was/now) = (sell − cost) / sell — margin as a share of the
   selling price.
   Margin Fct (was/now) = sell / cost — the existing "Mrg Factor" field is
   this same ratio at NOW; these are computed fresh here (rather than read
   off a raw column) so WAS gets the equivalent figure too. */
function marginPct(sell, cost){
  if(!sell) return null;
  return (sell - cost) / sell;
}
function marginFactor(sell, cost){
  if(!cost) return null;
  return sell / cost;
}
function fmtMarginFactor(v){
  return v == null || !isFinite(v) ? '—' : v.toFixed(2) + 'x';
}
function monthsOfCover(qty, avg){
  if(!avg) return 'X';
  const r = Math.round((qty / avg) * 10) / 10;
  return r === 0 ? 'X' : r.toFixed(1);
}
/* Navision Stock — Navision U-SOH + M-SOH (UAE stock on hand + Oman market
   stock), per item. Real per-item figures for the full catalog, ingested
   from "2XL Data 16-Sep-26.xlsx" (Stock Data, columns "U-SOH" and "M-SOH")
   into NAV_STK_BY_ITEM in data.js — kept as { u, m } there so the split
   stays visible. */
function navStockValue(item){
  const r = NAV_STK_BY_ITEM[item['Item Code']];
  return r ? r.u + r.m : 0;
}
function mSohValue(item){
  const r = NAV_STK_BY_ITEM[item['Item Code']];
  return r ? r.m : 0;
}
/* UAE retail stores (from the branch data / Stk Data). Excludes the Sharjah
   warehouse + DC (SAJWH, DCSHJ) and the Oman market (M-SOH). "Displayed in a
   store" = holds positive stock there. */
const UAE_STORES = ['REGUS','MARIN','JUMRA','DALMA','ALNML','GALER','RAKMA','ZAHIA','PARKC','BRSHA'];
function uaeStoreCount(item){
  const b = BRANCH_BY_ITEM[item['Item Code']] || {};
  return UAE_STORES.reduce((n, code) => n + ((b[code] || 0) > 0 ? 1 : 0), 0);
}
/* Clearance / web / click-and-collect stock, on top of the 10 UAE stores —
   still part of "everything sitting in/around a store", just not tied to one
   specific store's own bin. Source: Book2.xlsx (Sheet1). */
const SOH_EXTRA_CODES = ['CLRNC', 'CL-DCSHJ', 'WEBSTR', 'CL-JUMRA', 'CL-MARIN', 'CL-REGUS'];
/* Store stock = the 10 UAE stores' stock, their display-model ("-DM") stock,
   and the clearance/web/click-and-collect codes above — "everything sitting
   in or around a store". This used to BE the SOH column; it's now just the
   base SR Qty builds on (see below), since SOH itself is now WH SOH + SR
   Qty (see sohValue further down). Source: Book2.xlsx (Sheet1). */
function storeStockValue(item){
  const b = BRANCH_BY_ITEM[item['Item Code']] || {};
  // Each branch/extra code's own qty is floored at 0 first — a negative reading
  // at one store/code shouldn't be able to drag down the total from the rest.
  const stores = UAE_STORES.reduce((sum, code) => sum + Math.max(0, b[code] || 0) + Math.max(0, b[code + '-DM'] || 0), 0);
  const extra = SOH_EXTRA_CODES.reduce((sum, code) => sum + Math.max(0, b[code] || 0), 0);
  return stores + extra;
}
/* SR Qty = store stock (above) + Oman's M-Tot Pending Order Qty + M-MOMAN +
   M-WHOMN. The three Oman fields aren't in BRANCH_BY_ITEM (that's UAE
   store/warehouse data), so they get their own map — SR_QTY_OMAN_BY_ITEM in
   data.js, real per-item figures for the full catalog, ingested from
   "2XL Data 16-Sep-26.xlsx" (Stock Data). */
/* Header badge toggles whether the Oman fields (M-Tot Pending Order Qty,
   M-MOMAN, M-WHOMN) are folded into SR Qty, or SR Qty is just store stock. */
let srQtyInclOman = true;
function srQtyValue(item){
  const base = storeStockValue(item);
  if(!srQtyInclOman) return base;
  const r = SR_QTY_OMAN_BY_ITEM[item['Item Code']];
  const extra = r ? Math.max(0, r.pend) + Math.max(0, r.moman) + Math.max(0, r.whomn) : 0;
  return base + extra;
}
/* SOH = WH SOH (the two UAE warehouses) + SR Qty (store stock, plus Oman
   when that's toggled in). Since SR Qty's Oman badge changes SR Qty, SOH
   moves with it too — this is a live formula, not a fixed snapshot, so
   anything showing SOH needs recomputing whenever that toggle flips (see
   refreshSohDependents, called from the toggle's click handler). */
function sohValue(item){
  return whSohValue(item) + srQtyValue(item);
}

/* Units sold this calendar year so far — Jan through the current month of
   REPORT_MONTH.year. Recomputed each load, so it grows on its own as months
   pass (and picks up the current month's sales as they land). */
function ytdSold(it){
  const yr = it.years[String(REPORT_MONTH.year)];
  if(!yr) return 0;
  let t = 0;
  for(let m = 0; m <= REPORT_MONTH.month; m++) t += yr.sales[m] || 0;
  return t;
}
ITEMS.forEach(it => {
  it['SOH'] = sohValue(it);
  it['AVG'] = itemAvg(it);
  it['SM'] = monthsOfCover(Number(it['SOH']) || 0, it['AVG']);
  it['PM'] = monthsOfCover(Number(it['PO-Qty']) || 0, it['AVG']);
  it['M-SOH'] = mSohValue(it);
  it['Nav Stock'] = navStockValue(it);
  it['YTD Sold'] = ytdSold(it);
  it['Store Count'] = uaeStoreCount(it);
});
/* SOH (and SM, which is derived from it) are cached on the item rather than
   recomputed on every read — but SOH now moves with the SR Qty Oman toggle,
   so that cache goes stale the moment the toggle flips. Call this right
   after flipping srQtyInclOman, before re-rendering anything that shows
   SOH/SM (the grid, and the Item Lookup metrics band). */
function refreshSohDependents(){
  ITEMS.forEach(it => {
    it['SOH'] = sohValue(it);
    it['SM'] = monthsOfCover(Number(it['SOH']) || 0, it['AVG']);
  });
}

/* Stock held at a given warehouse/branch code (from the Stk Data / branch sheet). */
function branchQty(item, code){
  const b = BRANCH_BY_ITEM[item['Item Code']];
  const v = b && b[code] ? b[code] : 0;
  return Math.max(0, v);   // a negative branch qty (unprocessed transfer, data error, ...) contributes 0, never a deduction
}
/* WH SOH — warehouse stock on hand across the two UAE warehouses, Sajja
   (SAJWH) and DC Sharjah (DCSHJ). No toggle, no M-SOH — that's Oman stock. */
function whSohValue(item){
  return branchQty(item, 'SAJWH') + branchQty(item, 'DCSHJ');
}

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
  if(typeof syncTopbarWidth === 'function'){
    syncTopbarWidth();
    layoutEl.addEventListener('transitionend', syncTopbarWidth, { once: true });
  }
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
  if(typeof syncTopbarWidth === 'function') syncTopbarWidth();
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
    // The header's own rendered bottom edge is the row's "ideal top", whether
    // the header is currently stuck (page scrolled past it) or still in its
    // normal flow position — no need to know which, or guess the topbar's
    // height, just measure where it actually is right now.
    const idealTop = (head ? head.getBoundingClientRect().bottom : 0) + 16;
    const delta = rows[0].getBoundingClientRect().top - idealTop;
    window.scrollTo({ top: Math.max(0, window.scrollY + delta), left: window.scrollX });
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

/* Remaining stock is a running balance, anchored at 0 before Jan of the
   earliest year shown (currently 2024, which has no data yet — once real
   2024 figures land, they'll flow through this same chain automatically).
   Carries continuously across year boundaries: a month with no data at all
   contributes nothing (balance just holds), it doesn't reset to 0. Floored
   at 0 — stock can't go negative, and a month that floors carries 0 forward
   into the next month rather than the raw negative total. */
function runningBalanceMap(item){
  const map = {};
  let balance = 0;
  for(let year = REPORT_MONTH.year - 2; year <= REPORT_MONTH.year; year++){
    const yr = item.years[String(year)];
    for(let m = 0; m <= 11; m++){
      if(yr) balance += (yr.stock[m] || 0) - (yr.sales[m] || 0);
      if(balance <= 0) balance = 0;
      map[year + '-' + m] = balance;
    }
  }
  return map;
}
/* Combined Stock by month / Sold by month / Remaining stock, one shared
   table for all 3 years (current year, then back two more) — a single
   Jan-Dec header on top, with a year label row + 3 data rows per year
   below it, replacing the old separate Stock In / Sold by Month tabs (and
   the earlier version of this section that gave each year its own header).
   Every year always shows the full 12 months; a not-yet-happened month
   (e.g. Oct-Dec of the current year) just carries its already-zero data
   like any other zero month. Years with no data at all (no 2024 in this
   sample) render Stock/Sold as "—" placeholders. */
/* Click a row label ("Stock by month" / "Sold by month" / "Remaining stock")
   to regroup the whole table by that metric instead of by year: all 3
   years' rows for the clicked metric appear together first (one row per
   year, labelled by year), then all 3 years' rows for the next metric, then
   the last. Click the active one again to go back to the default grouping
   (year first, then its 3 metric rows). One shared setting across all 3
   years, kept across re-renders until changed. */
let ovSortKey = null;   // 'stock' | 'sold' | 'remaining' | null
let flipOverviewRows = false;
const OV_ROW_ORDER = ['stock', 'sold', 'remaining'];
const OV_ROW_META = {
  stock: { label: 'Stock by month', wkCell: false },
  sold: { label: 'Sold by month', wkCell: true },
  remaining: { label: 'Remaining stock', wkCell: false },
};
/* One metric's 12 month cells + Total for one year — shared by both the
   year-grouped and metric-grouped layouts below. */
function ovRowData(item, year, balances, key){
  const yr = item.years[String(year)];
  if(!yr) return { cellsHtml: MONTHS.map(() => '<td>—</td>').join(''), totalHtml: '—' };
  if(key === 'remaining'){
    const cellsHtml = MONTHS.map((_, m) => {
      const v = balances[year + '-' + m];
      return `<td class="${v < 0 ? 'neg' : ''}">${v}</td>`;
    }).join('');
    return { cellsHtml, totalHtml: '—' };
  }
  const arr = key === 'stock' ? yr.stock : yr.sales;
  const wkCell = OV_ROW_META[key].wkCell;
  let total = 0;
  const cellsHtml = MONTHS.map((_, m) => {
    const v = arr[m] || 0;
    total += v;
    const cls = [v === 0 ? 'zero' : (v < 0 ? 'neg' : ''), wkCell ? 'wk-cell' : ''].filter(Boolean).join(' ');
    const attrs = wkCell ? ` data-year="${year}" data-month="${m}"` : '';
    return `<td class="${cls}"${attrs}>${v === 0 ? '—' : v}</td>`;
  }).join('');
  return { cellsHtml, totalHtml: `<strong>${total}</strong>` };
}
function buildYearMatrices(wrapEl, item){
  const years = [REPORT_MONTH.year, REPORT_MONTH.year - 1, REPORT_MONTH.year - 2];
  const balances = runningBalanceMap(item);
  const headerCells = MONTHS.map(m => `<th>${m}</th>`).join('');

  // On a flip-driven regroup, the row-entrance animation and the FLIP slide
  // would both drive `transform` on the same rows and jitter — same fix as
  // the grid: skip the entrance (via "no-entrance") and let FLIP own it.
  let rowN = 0;
  const rowExtraCls = flipOverviewRows ? ' no-entrance' : '';
  const rowExtraAttr = () => flipOverviewRows ? '' : ` style="animation-delay:${Math.min(rowN++ * 22, 200)}ms"`;
  let body;
  if(ovSortKey){
    const order = [ovSortKey, ...OV_ROW_ORDER.filter(k => k !== ovSortKey)];
    body = order.map(key => {
      const meta = OV_ROW_META[key];
      const rows = years.map(year => {
        const { cellsHtml, totalHtml } = ovRowData(item, year, balances, key);
        return `<tr class="${rowExtraCls.trim()}" data-key="${key}" data-row-id="${key}-${year}"${rowExtraAttr()}><td class="ov-year-label">${year}</td>${cellsHtml}<td>${totalHtml}</td></tr>`;
      }).join('');
      const activeCls = key === ovSortKey ? ' ov-sorted' : '';
      return `<tr class="year-row${rowExtraCls}"${rowExtraAttr()}><td class="ov-row-label${activeCls}" data-key="${key}" colspan="14">${meta.label}</td></tr>` + rows;
    }).join('');
  } else {
    body = years.map(year => {
      const rows = OV_ROW_ORDER.map(key => {
        const meta = OV_ROW_META[key];
        const { cellsHtml, totalHtml } = ovRowData(item, year, balances, key);
        return `<tr class="${rowExtraCls.trim()}" data-key="${key}" data-row-id="${key}-${year}"${rowExtraAttr()}><td class="ov-row-label" data-key="${key}">${meta.label}</td>${cellsHtml}<td>${totalHtml}</td></tr>`;
      }).join('');
      return `<tr class="year-row${rowExtraCls}"${rowExtraAttr()}><td colspan="14">${year}</td></tr>` + rows;
    }).join('');
  }

  const oldTable = wrapEl.querySelector('table.year-matrix');
  const oldRowTops = flipOverviewRows && oldTable ? captureRowTops(oldTable, 'tr[data-row-id]', 'rowId') : null;

  wrapEl.innerHTML =
    '<div class="matrix-wrap"><table class="matrix year-matrix">' +
    '<thead><tr><th></th>' + headerCells + '<th>Total</th></tr></thead>' +
    '<tbody>' + body + '</tbody></table></div>';
  if(oldRowTops) flipRows(wrapEl.querySelector('table.year-matrix'), 'tr[data-row-id]', 'rowId', oldRowTops);
  flipOverviewRows = false;
  wrapEl.querySelectorAll('td.wk-cell').forEach(td =>
    td.addEventListener('click', e => {
      e.stopPropagation();
      openWeekModal(item, { year: +td.dataset.year, month: +td.dataset.month });
    }));
  wrapEl.querySelectorAll('td.ov-row-label').forEach(td =>
    td.addEventListener('click', () => {
      const key = td.dataset.key;
      ovSortKey = (ovSortKey === key) ? null : key;
      flipOverviewRows = true;
      buildYearMatrices(wrapEl, item);
      flashHeader('td.ov-row-label[data-key="' + key + '"]');
    }));
  // Hovering one metric's row (in any year) highlights that same metric's
  // row in every other year too, so you can trace e.g. "Sold by month"
  // across 2026/2025/2024 even when they're not adjacent (default grouping).
  wrapEl.querySelectorAll('tr[data-key]').forEach(tr => {
    const key = tr.dataset.key;
    tr.addEventListener('mouseenter', () => {
      wrapEl.querySelectorAll('tr[data-key="' + key + '"]').forEach(t => t.classList.add('ov-row-hl'));
    });
    tr.addEventListener('mouseleave', () => {
      wrapEl.querySelectorAll('tr[data-key="' + key + '"]').forEach(t => t.classList.remove('ov-row-hl'));
    });
  });
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
/* How many of the anchor day's own week have actually happened, counting
   Monday THROUGH the anchor day itself (inclusive) — Tue = 2, Wed = 3, ...,
   Sun = 7 (a genuinely full week). Monday is the one exception: on a Monday
   almost nothing has posted yet (especially on a morning run), so that
   bucket isn't shown at all rather than as a near-empty 1-day sliver. */
function partialWeekElapsed(d){
  const dow = (d.getDay() + 6) % 7;   // Monday=0 ... Sunday=6
  return dow === 0 ? 0 : dow + 1;
}
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
    return { anchor: now, elapsed: partialWeekElapsed(now) };
  }
  return { anchor: dataEnd, elapsed: partialWeekElapsed(dataEnd) };  // clamped to the last month with real data
})();
const WEEK_ANCHOR = WEEK_VIEW.anchor;

function mondayOf(d){
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Mon=0 … Sun=6
  return x;
}
function fmtDay(d){ return d.getDate() + ' ' + MONTHS[d.getMonth()]; }
function fmtDayYear(d){ return fmtDay(d) + " '" + String(d.getFullYear()).slice(-2); }

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
    const ck = d.getFullYear() + '-' + d.getMonth();
    if(!cache[ck]) cache[ck] = dailySales(item, d.getFullYear(), d.getMonth());
    sum += cache[ck][d.getDate() - 1] || 0;
  }
  return Math.round(sum);
}
/* Does this week belong to the given month — i.e. do most of its days fall
   there? A week straddling a month boundary (e.g. Mon 23 Feb – Sun 1 Mar)
   only counts for whichever side holds the majority of its days, so it
   doesn't get highlighted for a month it barely touches. Used to mark the
   weeks belonging to whichever month cell was clicked. */
function weekBelongsToMonth(weekStart, dayCount, year, month){
  let count = 0;
  for(let i = 0; i < dayCount; i++){
    const d = new Date(weekStart.getTime() + i * DAY_MS);
    if(d.getFullYear() === year && d.getMonth() === month) count++;
  }
  return count > dayCount / 2;
}
/* With no monthCtx: Mon–Sun weeks for the last 3 calendar months ending at
   the data anchor, newest first, current week partial (the original view).

   With `monthCtx` ({year, month}, 0-indexed month) — the month cell that was
   clicked — the window instead STARTS at that month and runs forward through
   the following two months, oldest (the clicked month) first, so "click
   April" reads left-to-right as April → May → June. It's capped so it never
   runs past the real data anchor; if the anchor falls inside the window,
   that week is the partial one, exactly like the default view. Weeks
   touching the clicked month come back flagged `highlight:true`. */
function weeklyBreakdown(item, monthCtx){
  const anchorMon = mondayOf(WEEK_ANCHOR);
  const cache = {};
  const isAnchorWeek = ws => ws.getTime() === anchorMon.getTime();
  const weekEntry = ws => {
    const isCurrent = isAnchorWeek(ws);
    const dayCount = isCurrent ? WEEK_VIEW.elapsed : 7;
    return {
      start: new Date(ws),
      end: new Date(ws.getTime() + (dayCount - 1) * DAY_MS),
      partial: isCurrent,
      dayCount,
      units: weekUnits(item, ws, dayCount, cache),
      highlight: monthCtx ? weekBelongsToMonth(ws, dayCount, monthCtx.year, monthCtx.month) : false,
    };
  };

  const weeks = [];
  if(!monthCtx){
    const firstMon = mondayOf(new Date(WEEK_ANCHOR.getFullYear(), WEEK_ANCHOR.getMonth() - 2, 1));
    for(let ws = new Date(anchorMon); ws >= firstMon; ws = new Date(ws.getTime() - 7 * DAY_MS)){
      if(isAnchorWeek(ws) && WEEK_VIEW.elapsed === 0) continue;      // anchor is a Monday — skip
      weeks.push(weekEntry(ws));
    }
    return weeks;
  }

  let ws = mondayOf(new Date(monthCtx.year, monthCtx.month, 1));
  const nominalEnd = new Date(monthCtx.year, monthCtx.month + 3, 0);   // clicked month + the next 2
  const cappedEnd = nominalEnd < WEEK_ANCHOR ? nominalEnd : WEEK_ANCHOR;
  const lastMon = mondayOf(cappedEnd);
  if(ws > lastMon) ws = lastMon;         // clicked month is entirely beyond the data anchor
  for(; ws <= lastMon; ws = new Date(ws.getTime() + 7 * DAY_MS)){
    if(isAnchorWeek(ws) && WEEK_VIEW.elapsed === 0) continue;
    weeks.push(weekEntry(ws));
  }
  return weeks;
}

/* Turn a Sold-by-Month cell (Item Lookup matrix or All Products grid) into a
   drill-in to the weekly popup, without triggering the grid row's own click.
   `monthCtx` ({year, month}), when the cell represents one specific month,
   re-anchors the popup there and highlights that month's weeks. */
function makeWeeklyCell(td, item, monthCtx){
  td.classList.add('wk-cell');
  td.title = monthCtx ? 'Weekly breakdown, starting ' + MONTHS[monthCtx.month] + ' ' + monthCtx.year : 'Weekly breakdown';
  td.addEventListener('click', e => { e.stopPropagation(); openWeekModal(item, monthCtx); });
}

let weekModalReturn = null;
function openWeekModal(item, monthCtx){
  if(!item) return;
  const weeks = weeklyBreakdown(item, monthCtx);
  if(!weeks.length) return;
  const total = weeks.reduce((a, w) => a + w.units, 0);
  const max = Math.max(1, ...weeks.map(w => w.units));

  // Endpoints found by min/max rather than array position, since the default
  // (newest-first) and month-anchored (oldest-first) views order weeks
  // opposite ways.
  const rangeStart = weeks.reduce((min, w) => w.start < min ? w.start : min, weeks[0].start);
  const rangeEnd = weeks.reduce((max, w) => w.end > max ? w.end : max, weeks[0].end);
  document.getElementById('wkTitle').textContent = 'Weekly sales — ' + item['Description'];
  document.getElementById('wkSub').textContent =
    item['Item Code'] + '  ·  ' + fmtDayYear(rangeStart) + ' – ' +
    fmtDayYear(rangeEnd) + '  ·  ' + weeks.length + ' weeks';

  // The forward-anchored window can cross a calendar-year boundary (e.g. a
  // click near the end of the year runs into the next one) — the compact
  // per-column label only needs the year stamped where it actually changes,
  // whichever direction the weeks are ordered in.
  let lastYearSeen = null;
  const cols = weeks.map(w => {
    const heat = w.units / max;
    const cls = ['wk-col', w.partial ? 'wk-col-partial' : '', w.highlight ? 'wk-col-hl' : ''].filter(Boolean).join(' ');
    const yearChanged = lastYearSeen !== null && lastYearSeen !== w.start.getFullYear();
    lastYearSeen = w.start.getFullYear();
    const label = yearChanged ? fmtDayYear(w.start) : fmtDay(w.start);
    return '<div class="' + cls +
        '" title="' + fmtDayYear(w.start) + ' – ' + fmtDayYear(w.end) +
        (w.partial ? ' (' + w.dayCount + ' of 7 days)' : '') + '">' +
        '<div class="wk-col-v">' + (w.units === 0 ? '—' : w.units) + '</div>' +
        '<div class="wk-col-bar"><span style="height:' + (6 + heat * 94).toFixed(0) + '%"></span></div>' +
        '<div class="wk-col-k">' + label + '</div>' +
        (w.partial ? '<div class="wk-col-tag">' + w.dayCount + '/7 d</div>' : '') +
      '</div>';
  }).join('');

  // Only a month-anchored view has anything to distinguish — the default
  // (no cell clicked) view has no highlighted weeks to explain.
  const legend = monthCtx ?
    '<div class="wk-legend">' +
      '<span class="wk-legend-item"><span class="wk-legend-dot wk-legend-dot-hl"></span>' +
        MONTHS[monthCtx.month] + ' ' + monthCtx.year + '</span>' +
      '<span class="wk-legend-item"><span class="wk-legend-dot"></span>Surrounding weeks</span>' +
    '</div>' : '';

  document.getElementById('wkBody').innerHTML =
    legend +
    '<div class="wk-strip">' + cols + '</div>' +
    '<div class="wk-total">' + weeks.length + '-week total <strong>' + total.toLocaleString('en-US') + '</strong> units</div>';

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
/* Real per-branch SOLD figures — ingested from "2XL Data 16-Sep-26.xlsx"
   (the Sales sheets' Store No column), keyed by item code the same way as
   BRANCH_BY_ITEM (e.g. {"103641": {"SAJWH": 12, "REGUS": 3, ...}}). Defined
   in data.js; only the 10 UAE retail stores are covered (same scope as
   BRANCH_BY_ITEM's own "which store" concept), so a store or an item with
   no branch-level sales just isn't a key here. */
function buildBranchTable(wrapEl, item){
  const branch = BRANCH_BY_ITEM[item['Item Code']];
  if(!branch){ wrapEl.innerHTML = '<p class="foot-note">No branch-level data found for this item.</p>'; return; }
  const codes = Object.keys(branch);
  const sold = BRANCH_SOLD_BY_ITEM[item['Item Code']];

  let html = '<table class="matrix"><thead><tr><th>Branch Code</th>';
  codes.forEach(c => html += `<th>${c}</th>`);
  html += '<th>Total</th></tr></thead><tbody>';

  const sohTotal = codes.reduce((a, c) => a + branch[c], 0);
  html += '<tr><td>SOH</td>';
  codes.forEach(c => {
    const v = branch[c];
    html += `<td class="${v === 0 ? 'zero' : (v < 0 ? 'neg' : '')}">${v}</td>`;
  });
  html += `<td><strong>${sohTotal}</strong></td></tr>`;

  html += '<tr><td>Sold</td>';
  codes.forEach(c => {
    const v = sold ? sold[c] : null;
    html += v == null
      ? '<td class="zero" title="Awaiting branch-level sales data">—</td>'
      : `<td class="${v === 0 ? 'zero' : (v < 0 ? 'neg' : '')}">${v}</td>`;
  });
  const soldTotal = sold ? codes.reduce((a, c) => a + (sold[c] || 0), 0) : null;
  html += `<td><strong>${soldTotal == null ? '—' : soldTotal}</strong></td></tr>`;

  html += '</tbody></table>';
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

  const cost = Number(item['L-Cost (Aed)']) || 0;
  const was = Number(item['Was (Aed)']) || 0;
  const now = Number(item['Now (Aed)']) || 0;
  document.getElementById('mMrgPctWas').textContent = fmtPct(marginPct(was, cost));
  document.getElementById('mMrgPctNow').textContent = fmtPct(marginPct(now, cost));
  document.getElementById('mMrgFctWas').textContent = fmtMarginFactor(marginFactor(was, cost));
  document.getElementById('mMrgFctNow').textContent = fmtMarginFactor(marginFactor(now, cost));

  document.getElementById('mSoh').textContent = fmtInt(item['SOH']);
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

  buildYearMatrices(document.getElementById('yearMatrices'), item);
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
  { type:'core', field:'Item Code', label:'Item Code', cls:'item-code mono', fz:'fz-itemcode', stack:true },
  { type:'core', field:'Description', label:'Description', left:true, fz:'fz-desc' },
  { type:'core', field:'Vendor Code', label:'Vendor Code', fz:'fz-vendor' },
  { type:'core', field:'Range Name', label:'Range Name', fz:'fz-range' },
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
  { type:'core', field:'Nav Stock', label:'Navision Stock', sortable:true, stack:true,
    tip:'Navision Stock = Navision U-SOH + M-SOH (UAE stock on hand + Oman market stock).\nCurrently sourced from Book2.xlsx; moves to the live Navision feed later.' },
  { type:'core', field:'SOH', label:'SOH', sortable:true,
    tip:'SOH = WH SOH + SR Qty (store stock, plus Oman when the SR Qty badge has it toggled in).' },
  { type:'core', field:'__whsoh', label:'WH SOH', sortable:true },
  { type:'core', field:'SR Qty', label:'SR QTY', sortable:true, stack:true },
  { type:'core', field:'PO-Qty', label:'PO Qty', sortable:true },
  { type:'core', field:'AVG', label:'AVG', sortable:true },
  { type:'core', field:'SM', label:'SM' },
  { type:'core', field:'PM', label:'PM' },
  { type:'group', key:'sr', title:'SR', short:'SR', cols:[
      { field:'Store Count', label:'SR',
        tip:'SR display — how many of the ' + UAE_STORES.length + ' UAE stores currently hold stock of this item.' } ] },
  { type:'core', field:'__spark', label:'13-mo Trend', tip: SPARK_TIP },
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
  { type:'core', field:'YTD Sold', label:'YTD Sold', sortable:true, tip: YTD_TIP },
  { type:'core', field:'__totalRcvd', label:'Total Received Qty', sortable:true, stack:true,
    tip:'Total Received Qty = stock received (GRN), summed over the same rolling 13-month window as the 13-mo Trend column.' },
  // Displayed current month first, then backwards (newest -> oldest); MONTH_WINDOW
  // itself stays oldest -> newest internally since the trend sparkline / YTD
  // math depend on that order. field:'__sold_'+i still points at the right
  // MONTH_WINDOW entry regardless of the display order below.
  { type:'group', key:'soldby', title:'Sold by Month', short:'Sold',
    cols: MONTH_WINDOW.map((w, i) => ({ field:'__sold_'+i, label: monthColLabel(w) })).reverse() },
  { type:'group', key:'stockin', title:'Stock In by Month', short:'Stock In',
    cols: MONTH_WINDOW.map((w, i) => ({ field:'__stock_'+i, label: monthColLabel(w) })).reverse() },
];

const ALL_GROUP_KEYS = COLUMN_LAYOUT.filter(e => e.type === 'group').map(e => e.key);
let collapsedGroups = new Set(['class','attrs','fob','logi']); // sensible default: keep the essentials visible first

/* Grid ordering has two independent layers that stack:
   - GROUP (categorical): click Plan / PUDA Code to cluster rows that share a
     value, groups running A→Z. Click again to clear. A thin rule divides one
     group from the next. PUDA Code groups by its leading letter only (all
     A… together, then all F…); Plan groups by the whole code.
   - SORT (directional): click SOH / PO Qty / AVG / Total Received Qty to cycle
     none → high→low → low→high → none.
   With both on, the group is primary and the directional sort orders rows
   inside each group; turning one on never clears the other. */
let gridSort = null;  // { field, dir: 'desc' | 'asc' }
let gridGroup = null; // { field }
/* Pagination — with the full ingested catalog (11,000+ visible rows), building
   every row into the DOM at once froze the tab for real users. Only one
   page's worth of rows is ever built; the rest of the filtered/sorted set
   just isn't in the DOM until you page to it. Resets to page 0 whenever the
   underlying filtered/sorted query actually changes (tracked via a cheap
   signature) — but not when Prev/Next themselves trigger the re-render. */
const GRID_PAGE_SIZE = 200;
let gridPage = 0;
let gridTotalPages = 1;   // kept in sync by renderGrid; used to clamp the "Go to page" input
let lastGridQuerySig = null;
function gridQuerySignature(){
  const filters = Object.keys(activeFilters).sort().map(k => k + ':' + Array.from(activeFilters[k]).sort().join(',')).join('|');
  const sort = gridSort ? gridSort.field + gridSort.dir : '';
  const group = gridGroup ? gridGroup.field : '';
  const dept = DEPT_STOCK_MIN_GROUPS.map(g => g.inputId + '=' + (deptStockMin[g.inputId] ?? '')).join(',');
  return [filters, sort, group, dept, srQtyInclOman].join('~~');
}
/* Per-field grouping key — how much of the value defines a group. Default is
   the whole value; PUDA Code clusters on its first letter. */
const GROUP_KEY = {
  'PUDA Code': v => String(v == null ? '' : v).trim().charAt(0).toUpperCase(),
};
function groupKeyFor(field, val){
  const fn = GROUP_KEY[field];
  return fn ? fn(val) : String(val == null ? '' : val).trim().toUpperCase();
}
/* FLIP reorder animation (First-Last-Invert-Play): capture each row's
   screen position keyed by a stable id before the DOM rebuilds, then after
   the rebuild give the matching row (same id, new position) an inverted
   transform back to where it used to be and transition it to zero — so
   rows visibly slide into their new spot instead of just popping there.
   Used for both the grid's sort/group and the Overview metric regroup. */
function captureRowTops(container, selector, keyAttr){
  const map = new Map();
  container.querySelectorAll(selector).forEach(el => {
    const key = el.dataset[keyAttr];
    if(key) map.set(key, el.getBoundingClientRect().top);
  });
  return map;
}
function flipRows(container, selector, keyAttr, oldTops){
  if(!oldTops) return;
  // Movers are staggered by how far up the final list they land — the row
  // that jumps to the very top leads, the rest cascade in just behind it —
  // instead of the whole table snapping into motion in frozen unison.
  const movers = [];
  container.querySelectorAll(selector).forEach(el => {
    const key = el.dataset[keyAttr];
    const oldTop = key ? oldTops.get(key) : null;
    if(oldTop == null) return;
    const newTop = el.getBoundingClientRect().top;
    const dy = oldTop - newTop;
    if(!dy) return;
    movers.push({ el, dy, newTop });
  });
  movers.sort((a, b) => a.newTop - b.newTop);
  movers.forEach(({ el, dy }, i) => {
    const dist = Math.abs(dy);
    const duration = Math.min(560, 300 + dist * 0.55);   // farther jumps run a touch longer
    const delay = Math.min(i * 18, 160);                 // gentle top-to-bottom cascade
    el.style.transition = 'none';
    el.style.transform = 'translateY(' + dy + 'px)';
    el.classList.add('flip-glow');
    requestAnimationFrame(() => {
      el.style.transition = 'transform ' + duration + 'ms cubic-bezier(.3,1.4,.55,1) ' + delay + 'ms';
      el.style.transform = '';
    });
    const cleanup = () => { el.style.transition = ''; el.style.transform = ''; el.classList.remove('flip-glow'); };
    el.addEventListener('transitionend', cleanup, { once: true });
    setTimeout(cleanup, duration + delay + 120);   // safety net if transitionend never fires
  });
}
/* Brief highlight flash on the header that was just clicked, so a sort/group
   change reads as an action you took, not just a table that silently
   changed. Re-triggerable: forces a reflow so clicking the same header
   again (e.g. cycling desc -> asc) restarts the flash instead of no-op'ing. */
function flashHeader(selector){
  const el = document.querySelector(selector);
  if(!el) return;
  el.classList.remove('sort-flash');
  void el.offsetWidth;
  el.classList.add('sort-flash');
}
let flipGridRows = false;
function cycleSort(field){
  if(!gridSort || gridSort.field !== field) gridSort = { field: field, dir: 'desc' };
  else if(gridSort.dir === 'desc') gridSort = { field: field, dir: 'asc' };
  else gridSort = null;
  flipGridRows = true;
  renderGrid();
  flashHeader('#gridTable thead th[data-col="' + field + '"]');
}
function cycleGroup(field){
  gridGroup = gridGroup && gridGroup.field === field ? null : { field: field };
  flipGridRows = true;
  renderGrid();
  flashHeader('#gridTable thead [data-col="' + field + '"]');
}
/* Standing default order — Range Name, then Vendor Code, then PUDA Code —
   active from page load with nothing clicked, exactly like a real sort/group
   would be. The moment the user picks any column sort or group this steps
   aside for that; clearing it (gridSort/gridGroup both back to null, e.g.
   via Clear Sort) brings this straight back. Never shown as "active" on any
   column header — it's a background default, not a user selection. */
function defaultSortedItems(items){
  // lowercased so e.g. "Aaji" and "ALVAA" interleave alphabetically instead
  // of all-caps range names clustering separately from mixed-case ones.
  // PUDA Code sorts by its last 3 digits (e.g. "A03096" -> "096"), not the
  // whole code — every real PUDA Code is a letter + 3 digits + that 3-digit
  // suffix, and the suffix is what actually distinguishes them.
  const key = it => [
    String(it['Range Name'] || '').toLowerCase(),
    String(it['Vendor Code'] || '').toLowerCase(),
    String(it['PUDA Code'] || '').toLowerCase().slice(-3),
  ];
  return items.slice().sort((a, b) => {
    const ka = key(a), kb = key(b);
    for(let i = 0; i < ka.length; i++){
      if(ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    }
    return 0;
  });
}
function sortGridItems(items){
  const g = gridGroup;
  const s = gridSort;
  if(!g && !s) return defaultSortedItems(items);
  const arr = items.slice();
  const origIdx = new Map(arr.map((it, i) => [it, i]));
  const groupVal = it => groupKeyFor(g.field, it[g.field]);
  const sortVal = it => s.field === '__whsoh' ? whSohValue(it) : s.field === 'SR Qty' ? srQtyValue(it) : s.field === '__totalRcvd' ? totalReceivedQty(it) : (Number(it[s.field]) || 0);
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
/* Scroll the page (vertically only) so the grid's top edge is back in view —
   used whenever changing pages should return you to row 1 of the new page.
   .grid-scroll has no scroll position of its own to reset (rows scroll with
   the page now, see .grid-scroll in styles.css). */
function scrollGridIntoView(){
  const gs = document.querySelector('.grid-scroll');
  if(!gs) return;
  const top = gs.getBoundingClientRect().top;
  if(top < 56) window.scrollTo({ top: Math.max(0, window.scrollY + top - 76), left: window.scrollX });
}
/* "Go to page" — the only way to change pages now (no more Prev/Next
   arrows). Enter or blur jumps; the typed number is clamped to whatever the
   current filtered/sorted set's page range actually is. */
function jumpToPage(){
  const el = document.getElementById('gridPageJump');
  const n = parseInt(el.value, 10);
  if(!isFinite(n)){ el.value = ''; return; }
  gridPage = Math.max(0, Math.min(n - 1, gridTotalPages - 1));
  renderGrid();
  scrollGridIntoView();
  el.value = '';
  el.blur();
}
document.getElementById('gridPageJump').addEventListener('keydown', e => {
  if(e.key === 'Enter') jumpToPage();
});
document.getElementById('gridPageJump').addEventListener('blur', () => {
  if(document.getElementById('gridPageJump').value !== '') jumpToPage();
});
/* Shared by the visible Prev/Next buttons, the Left/Right arrow-key
   shortcut, and anything else that just wants to step one page. */
function stepGridPage(dir){
  const next = gridPage + dir;
  if(next < 0 || next > gridTotalPages - 1) return;
  gridPage = next;
  renderGrid();
  scrollGridIntoView();
}
document.getElementById('gridPrevBtn').addEventListener('click', () => stepGridPage(-1));
document.getElementById('gridNextBtn').addEventListener('click', () => stepGridPage(1));
/* Left/Right arrow keys also step a page at a time — only while the grid
   itself is the active view, and never while typing in an input/textarea
   (so normal text-cursor movement in the filter search boxes, the page-jump
   box, etc. is untouched). */
document.addEventListener('keydown', e => {
  if(e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const tag = document.activeElement && document.activeElement.tagName;
  if(tag === 'INPUT' || tag === 'TEXTAREA') return;
  if(!document.getElementById('viewAll').classList.contains('active')) return;
  stepGridPage(e.key === 'ArrowLeft' ? -1 : 1);
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
      if(entry.stack){
        // force one word per line (e.g. ITEM / CODE) so the column can be narrow
        entry.label.split(' ').forEach((word, i) => {
          if(i) gth.appendChild(document.createElement('br'));
          gth.appendChild(document.createTextNode(word));
        });
      } else {
        gth.textContent = entry.label;
      }
      gth.dataset.col = entry.field;
      if(entry.field === 'AVG') gth.classList.add('avg-head');
      if(entry.field === 'SOH') gth.classList.add('soh-head');
      if(entry.field === 'Nav Stock') gth.classList.add('navstock-head');
      if(entry.field === 'Current Plan Code') gth.classList.add('plan-head');
      if(entry.tip) gth.title = entry.tip;
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
      if(entry.field === '__whsoh'){
        gth.classList.add('whsoh-head');
        gth.title = 'Warehouse stock = SAJWH (Sajja) + DCSHJ (DC Sharjah), the two UAE warehouses.\nClick the header to sort.';
      }
      if(entry.field === 'SR Qty'){
        // header click sorts (via the sortable path above); the +OM / −OM
        // badge toggles whether Oman's fields are folded into the total.
        gth.classList.add('sroty-head');
        gth.classList.toggle('incl-om', srQtyInclOman);
        const badge = document.createElement('span');
        badge.className = 'sroty-ind';
        badge.textContent = srQtyInclOman ? '+OM' : '-OM';
        badge.title = srQtyInclOman
          ? 'Oman (M-Tot Pending Order Qty + M-MOMAN + M-WHOMN) is in the total — click to drop it (store stock only)'
          : 'Oman is excluded — click to add it back';
        badge.addEventListener('click', e => {
          e.stopPropagation();
          srQtyInclOman = !srQtyInclOman;
          refreshSohDependents();
          renderGrid();
          if(selectedItem) renderReport(selectedItem);
        });
        gth.appendChild(badge);
        gth.title = (srQtyInclOman
          ? 'SR Qty = store stock + Oman (M-Tot Pending Order Qty + M-MOMAN + M-WHOMN).'
          : 'SR Qty = store stock only (Oman excluded).')
          + '\nSOH = WH SOH + SR Qty, so it moves with this toggle too.'
          + '\nClick the badge to toggle Oman; click the header to sort.';
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
      gth.classList.add('grp-bar-' + entry.key);
      gth.innerHTML = `<span class="chev">−</span>${entry.title}`;
      gth.title = 'Click to collapse this section';
      gth.addEventListener('click', () => toggleGroup(entry.key));
      addGroupResizer(gth, entry.cols.map(c => c.field));
      groupRow.appendChild(gth);
      entry.cols.forEach((c, i) => {
        const fth = document.createElement('th');
        // Month columns ("Sep'26") stack onto two lines — the month, then the
        // year — so each column only needs to be as wide as "Sep" rather than
        // the whole "Sep'26", letting the Stock/Sold by Month strips shrink.
        const monthSplit = c.label.indexOf("'");
        if(monthSplit >= 0){
          fth.appendChild(document.createTextNode(c.label.slice(0, monthSplit)));
          fth.appendChild(document.createElement('br'));
          fth.appendChild(document.createTextNode(c.label.slice(monthSplit)));
        } else {
          fth.textContent = c.label;
        }
        fth.classList.add('grp-' + entry.key);
        if(i === 0) fth.classList.add('group-start');
        fth.dataset.col = c.field;
        if(c.tip) fth.title = c.tip;
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
    // The FLIP slide (below) drives `transform` on this same element for this
    // render — the CSS entrance animation would fight it over that property
    // and cause a visible jitter, so skip the entrance here and let FLIP own it.
    if(flipGridRows) tr.classList.add('no-entrance');
    else tr.style.animationDelay = Math.min(itemIdx * 12, 200) + 'ms';

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
          td.classList.add('spark-cell', 'left', 'wk-cell');
          td.innerHTML = trendMiniBar(item);
          td.addEventListener('click', e => { e.stopPropagation(); openTrendModal(item); });
        } else if(col.field === 'SM' || col.field === 'PM'){
          td.classList.add('cover-cell', 'left');
          td.innerHTML = coverCell(item[col.field]);
        } else if(col.field === '__whsoh'){
          td.classList.add('whsoh-cell');
          td.textContent = fmtInt(whSohValue(item));
        } else if(col.field === '__totalRcvd'){
          td.textContent = fmtInt(totalReceivedQty(item));
        } else if(col.field === 'SR Qty'){
          td.classList.add('srqty-cell');
          td.textContent = fmtInt(srQtyValue(item));
        } else if(col.field === 'Nav Stock'){
          td.classList.add('navstock-cell');
          td.textContent = fmtInt(navStockValue(item));
        } else {
          const v = cellValueForItem(item, col.field);
          td.textContent = (v === undefined || v === null || v === '') ? '—' : v;
          if(col.cls) td.className = col.cls;
          if(col.fz) td.classList.add(col.fz);
          if(col.left) td.classList.add('left');
          if(col.field === 'AVG') td.classList.add('avg-cell');
          if(col.field === 'SOH') td.classList.add('soh-cell');
          if(col.field === 'Current Plan Code') td.classList.add('plan-cell');
          if(col.field === 'Item Code'){
            // Only this cell opens the item — everywhere else in the row stays
            // plain text so values can be selected and copied.
            td.title = 'Open ' + item['Item Code'] + ' in Item Lookup';
            td.addEventListener('click', e => { e.stopPropagation(); resumeCode = item['Item Code']; openItem(item); });
          }
        }
      } else {
        td.classList.add('grp-' + col.group);
        const isMonthly = col.field.startsWith('__stock_') || col.field.startsWith('__sold_');
        if(isMonthly){
          const raw = cellValueForItem(item, col.field);
          const num = raw === null || raw === undefined ? 0 : raw;
          // Furniture/Accessory boxes: a month that DID have stock, just less
          // than what was typed, displays as a red "0" — flagged as
          // below-minimum rather than genuinely empty (which stays a plain
          // dash, unrelated "zero" styling, untouched).
          const min = col.field.startsWith('__stock_') ? deptStockMinForItem(item) : undefined;
          const belowMin = min !== undefined && num > 0 && num < min;
          if(belowMin){
            td.textContent = '0';
            td.classList.add('below-min');
            td.title = 'Actual stock received: ' + num + ' — below the minimum of ' + min;
          } else {
            td.textContent = num === 0 ? '—' : num;
            if(num === 0) td.classList.add('zero');
            if(num < 0) td.classList.add('neg');
          }
          if(col.group === 'soldby'){
            const w = MONTH_WINDOW[+col.field.slice(7)];
            makeWeeklyCell(td, item, w ? { year: w.year, month: w.m } : undefined);
          }
        } else {
          td.textContent = fmtCell(item[col.field], col.fmt);
          if(col.field === 'L-Cost (Aed)') td.classList.add('cell-lcost');
          else if(col.field === 'Now (Aed)') td.classList.add('cell-now');
        }
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  return tbody;
}

/* Per-department minimum-stock filters (toolbar, next to Collapse/Expand all).
   Each box only ever looks at items in its own fixed set of department
   codes — a row in neither list is never touched by either box. Checked
   against "Stock by month" (same rolling 13-month window as the 13-mo Trend
   column and Total Received Qty), not the total SOH: if ANY of those 13
   monthly values is below what's typed, the item is hidden. */
const DEPT_STOCK_MIN_GROUPS = [
  { inputId: 'minStockFurniture', codes: ['10', '11', '12', '13', '14', '15', '17'] },
  { inputId: 'minStockAccessory', codes: ['01', '02', '03', '04', '05', '06', '07', '08', '09', '18', '19', '20'] },
];
const deptStockMin = {};   // inputId -> number, or absent when that box is empty
function parseDeptStockMin(raw){
  const n = Number(raw);
  return raw === '' || !isFinite(n) ? null : n;
}
DEPT_STOCK_MIN_GROUPS.forEach(group => {
  const el = document.getElementById(group.inputId);
  if(!el) return;
  el.addEventListener('input', () => {
    const n = parseDeptStockMin(el.value);
    if(n === null) delete deptStockMin[group.inputId]; else deptStockMin[group.inputId] = n;
    el.closest('.dept-stock-filter').classList.toggle('dsf-active', n !== null);
    renderGrid();
  });
});

/* The Furniture/Accessory boxes no longer remove rows at all — see
   applyDeptStockMin below, which instead zeroes out and reddens the specific
   below-threshold month cells in the grid's own Stock by Month columns. */
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
/* Is this item's Department Code covered by one of the Furniture/Accessory
   boxes, and does that box currently have a number typed in? Returns the
   threshold to check against, or undefined if neither applies. */
function deptStockMinForItem(item){
  const group = DEPT_STOCK_MIN_GROUPS.find(g => g.codes.includes(item['Department Code']));
  return group ? deptStockMin[group.inputId] : undefined;
}

/* Splits the (already filtered/sorted) item list into pages, WITHOUT ever
   letting a run of consecutive same-Vendor-Code rows straddle a page break —
   applies to whatever order is currently showing, sorted/grouped or not.
   A page is normally `pageSize` rows. If that cutoff would land inside a
   vendor run, the break instead moves back to where that run started, so
   the whole run defers to the next page (this page ends short). The one
   exception: a run that starts right at the top of a page and is itself
   longer than `pageSize` can't be deferred any further — that page just
   grows to fit the whole run instead of splitting it. */
function computeGridPages(items, pageSize){
  const pages = [];
  let start = 0;
  while(start < items.length){
    let end = Math.min(start + pageSize, items.length);
    if(end < items.length && items[end]['Vendor Code'] === items[end - 1]['Vendor Code']){
      const vendor = items[end]['Vendor Code'];
      let runStart = end - 1;
      while(runStart > start && items[runStart - 1]['Vendor Code'] === vendor) runStart--;
      if(runStart > start){
        end = runStart;                 // defer the whole run to the next page
      } else {
        while(end < items.length && items[end]['Vendor Code'] === vendor) end++;  // oversized run — let this page grow
      }
    }
    pages.push({ start, end });
    start = end;
  }
  return pages.length ? pages : [{ start: 0, end: 0 }];
}

function renderGrid(){
  const oldTbody = document.querySelector('#gridTable tbody');
  const oldRowTops = flipGridRows && oldTbody ? captureRowTops(oldTbody, 'tr[data-code]', 'code') : null;

  const items = sortGridItems(getFilteredItems());

  const sig = gridQuerySignature();
  if(sig !== lastGridQuerySig) gridPage = 0;
  lastGridQuerySig = sig;
  const pages = computeGridPages(items, GRID_PAGE_SIZE);
  const totalPages = pages.length;
  gridPage = Math.max(0, Math.min(gridPage, totalPages - 1));
  const { start: pageStart, end: pageEnd } = pages[gridPage];
  const pageItems = items.slice(pageStart, pageEnd);

  const cols = visibleColumns();
  const table = document.getElementById('gridTable');
  table.innerHTML = '';
  table.style.width = '';
  table.classList.remove('resizable');
  const thead = buildGridHeader();
  table.appendChild(buildColGroup(cols));
  table.appendChild(thead);
  table.appendChild(buildGridBody(pageItems, cols));
  const rangeEnd = Math.min(items.length, pageStart + pageItems.length);
  gridTotalPages = totalPages;
  document.getElementById('gridRowCount').textContent = items.length === 0 ? '0 of ' + ITEMS.length + ' items'
    : (pageStart + 1) + '–' + rangeEnd + ' of ' + items.length + (items.length !== ITEMS.length ? ' (of ' + ITEMS.length + ')' : '');
  const jumpEl = document.getElementById('gridPageJump');
  jumpEl.max = String(totalPages);
  jumpEl.placeholder = (gridPage + 1) + '/' + totalPages;
  document.getElementById('gridPrevBtn').disabled = gridPage <= 0;
  document.getElementById('gridNextBtn').disabled = gridPage >= totalPages - 1;
  document.getElementById('clearSortBtn').hidden = !gridSort && !gridGroup;
  if(oldRowTops) flipRows(table.querySelector('tbody'), 'tr[data-code]', 'code', oldRowTops);
  flipGridRows = false;
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
  syncTopbarWidth();
  // On the very first render web fonts may still be loading; the rotated
  // collapsed-group labels change height once they swap in, which throws the
  // measurement below off until the next re-render. Re-measure after paint and
  // once fonts settle so the two header rows always sit flush.
  requestAnimationFrame(() => { syncStickyHeader(); syncTopbarWidth(); });
  if(document.fonts && document.fonts.ready){
    document.fonts.ready.then(() => requestAnimationFrame(() => { syncStickyHeader(); syncTopbarWidth(); }));
  }
}

/* When a wide grid pushes the page into horizontal scroll, stretch the dark
   top bar to the full scroll width so scrolling right never exposes blank
   page above the grid. Release the bar's own width first, then measure the
   page, so a stale wide bar can't hold the measurement open. */
function syncTopbarWidth(){
  const topbar = document.querySelector('.topbar');
  if(!topbar) return;
  topbar.style.width = '';
  const de = document.documentElement;
  const need = de.scrollWidth;                    // forced reflow — pure content width
  topbar.style.width = need > de.clientWidth ? need + 'px' : '';
}
window.addEventListener('resize', syncTopbarWidth);


// The second header row's sticky offset must equal the first row's actual
// rendered height (it varies with how tall the rotated collapsed labels are) —
// measure it after layout instead of guessing a fixed number. +56 for the
// dark .topbar, which both header rows now stick underneath (see .grid-scroll).
function syncStickyHeader(){
  const thead = document.querySelector('#gridTable thead');
  if(!thead) return;
  const groupRow = thead.querySelector('tr.group-row');
  const fieldRow = thead.querySelector('tr.field-row');
  if(!groupRow || !fieldRow) return;
  const h = groupRow.getBoundingClientRect().height;
  fieldRow.querySelectorAll('th').forEach(th => { th.style.top = (56 + h) + 'px'; });
}
window.addEventListener('resize', syncStickyHeader);

/* ---- Filters ---- */
// Ordered to match the grid's own column order left-to-right (Vendor Code,
// Range Name, then Classification's Catg Code / Department Desc / Group Desc,
// then PUDA Desc, then Plan) rather than an arbitrary order.
const FILTER_FIELD_MAP = {
  'Vendor Code': 'Vendor Code',
  'Range Name': 'Range Name',
  'Category Code': 'Catg Code',
  'Department Desc': 'Department Desc',
  'Group Desc': 'Group Desc',
  'PUDA Desc': 'PUDA Desc',
  'Current Plan Code': 'Current Plan Code',
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
const FILTER_SEARCHABLE = new Set(['Vendor Code', 'PUDA Desc', 'Group Desc', 'Range Name']);
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
// Lets a "<X> Desc" filter's search box also match by "<X> Code", without
// ever showing the code itself in the filter list (PUDA Desc / PUDA Code,
// Group Desc / Group Code).
const DESC_CODE_PAIRS = { 'PUDA Desc': 'PUDA Code', 'Group Desc': 'Group Code' };
const DESC_TO_CODES = (() => {
  const out = {};
  Object.entries(DESC_CODE_PAIRS).forEach(([descField, codeField]) => {
    const map = {};
    ITEMS.forEach(it => {
      const desc = it[descField], code = it[codeField];
      (map[desc] || (map[desc] = new Set())).add(code);
    });
    out[descField] = map;
  });
  return out;
})();
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

// One small glyph per filter category — plain geometric shapes (no
// hand-drawn paths to typo), masked to a single gold tone so they read as a
// matched set rather than a rainbow of category colors.
const FILTER_ICONS = {
  'Vendor Code': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><polygon points="8,1 15,7 1,7"/><rect x="3" y="7" width="10" height="8"/></svg>',
  'Range Name': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><polygon points="1,1 9,1 15,7 9,13 1,13"/></svg>',
  'Category Code': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="1" y="1" width="6" height="6"/><rect x="9" y="1" width="6" height="6"/><rect x="1" y="9" width="6" height="6"/><rect x="9" y="9" width="6" height="6"/></svg>',
  'Department Desc': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="3"/><rect x="1" y="7" width="10" height="3"/><rect x="1" y="12" width="6" height="3"/></svg>',
  'Group Desc': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="6" cy="7" r="4.2"/><circle cx="11" cy="7" r="3.4"/></svg>',
  'PUDA Desc': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="6" r="5"/><polygon points="4,9 12,9 8,15"/></svg>',
  'Current Plan Code': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="2" y="1" width="2" height="14"/><polygon points="4,2 14,2 11,6 14,10 4,10"/></svg>',
};
function filterIconUrl(label){
  const svg = FILTER_ICONS[label];
  return svg ? 'data:image/svg+xml,' + encodeURIComponent(svg) : '';
}

function renderFilterBlocks(){
  const wrap = document.getElementById('filterBlocks');
  wrap.innerHTML = '';
  Object.entries(FILTER_FIELD_MAP).forEach(([label, field]) => {
    const block = document.createElement('div');
    block.className = 'filter-block';
    const h3 = document.createElement('h3');
    const iconUrl = filterIconUrl(label);
    const icon = iconUrl ? `<span class="ico" style="-webkit-mask-image:url('${iconUrl}');mask-image:url('${iconUrl}')"></span>` : '';
    h3.innerHTML = `<span class="lbl-wrap">${icon}<span class="lbl-text">${label}</span></span><span class="n" data-count-for="${label}"></span>`;
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
          let hay = (row.textContent + ' ' + (cb ? cb.value : '')).toLowerCase();
          if(DESC_TO_CODES[label] && cb){
            const codes = DESC_TO_CODES[label][cb.value];
            if(codes) hay += ' ' + Array.from(codes).join(' ').toLowerCase();
          }
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
  snapFilterOptsHeights();
}
/* Each filter's option list gets an equal flex share of the rail's height,
   which almost never divides evenly into whole rows — left alone, the last
   visible row is sliced off mid-height, which reads as broken rather than
   "scroll for more". Cap each list's height at a whole number of rows
   instead: the leftover sliver becomes a bit of blank space at the bottom of
   that block rather than a cut-off row. Never makes anything taller than its
   already-allotted flex share, so it can't reintroduce page-level scrolling. */
function snapFilterOptsHeights(){
  document.querySelectorAll('.filter-opts').forEach(el => {
    el.style.maxHeight = '';
    const row = el.querySelector('.filter-opt');
    if(!row) return;
    const rowH = row.getBoundingClientRect().height;
    if(rowH <= 0) return;
    const rows = Math.max(1, Math.floor(el.clientHeight / rowH));
    el.style.maxHeight = (rows * rowH) + 'px';
  });
}
let snapFilterOptsResizeT = null;
window.addEventListener('resize', () => {
  clearTimeout(snapFilterOptsResizeT);
  snapFilterOptsResizeT = setTimeout(snapFilterOptsHeights, 120);
});
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
  // Also clear whatever's typed into each filter's own search box (Vendor
  // Code, PUDA Desc, etc.) and re-show whatever rows that search had hidden —
  // otherwise "Clear all" resets the checkboxes but leaves the option list
  // still narrowed down to a stale search term.
  document.querySelectorAll('.filter-search').forEach(input => {
    input.value = '';
    input.dispatchEvent(new Event('input'));
  });
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

/* Shadow the sticky header/frozen columns once scrolled — both axes scroll
   on the page itself now (see .grid-scroll), not inside .grid-scroll. */
(function(){
  const gs = document.querySelector('.grid-scroll');
  if(!gs) return;
  const onScroll = () => {
    gs.classList.toggle('scrolled-y', window.scrollY > 1);
    gs.classList.toggle('scrolled-x', window.scrollX > 1);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
})();

/* Restore whatever the URL points at (All Products by default) */
applyRoute(routeFromHash());
