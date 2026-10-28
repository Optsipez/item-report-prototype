/* ============================================================
   DASHBOARD — the landing page after login. Built for the purchasing team:
   it answers "what do I need to do today?" before "how are we doing?".

   - A rotating personal greeting.
   - A scope picker (Department / Category / Vendor Code), remembered per
     employee, so each buyer sees their own slice instead of the whole company.
   - Four action lists, each with a count and a button that opens exactly
     those items in All Products:
       Reorder now          stock + open POs run out before a NEW order could
                            arrive (the vendor's real lead time, from past
                            receipts), ranked by monthly sales value at risk
       Out of stock, no PO  selling, none in stock, nothing on order
       Late POs             ETA already passed (vs the data date), still open
       Overstock / slow     6+ months old and 12+ months of cover (or no sales),
                            with price and margin so a markdown can be judged
   - How the scope is trading, monthly sales, rising/falling items, what is
     landing soon, POs expired, units due by month, branch sales.

   "Selling" is real sales in the last 3 complete months of data — not the
   grid's AVG column, which for brand-new items is only an estimate from the
   PO. Lead times come from js/lead-times.js (measured from past receipts,
   median per vendor). All dates are relative to DATA_AS_OF (the export date,
   in po-data.js), not today's clock. Vendor names are only shown to roles
   allowed to see them (canSeeVendorName).
   ============================================================ */
const DASH_GREETINGS = [
  n => 'Hi ' + n + ', good to see you.',
  n => 'Welcome back, ' + n + '.',
  n => 'Good ' + dashPartOfDay() + ', ' + n + '.',
  n => n + ', here’s where things stand.',
];
let dashGreetingIdx = Math.floor(Math.random() * DASH_GREETINGS.length);
// A fresh pick each time someone signs in (called from auth.js's enterApp).
function reshuffleDashGreeting(){
  dashGreetingIdx = Math.floor(Math.random() * DASH_GREETINGS.length);
  dashScope = null; dashTab = null; dashHeaderCollapsed = false;      // the next person gets their own remembered scope
  poDataScope = null; poDataVendorAmbiguous = null;
}

const DAY = 86400000;
let dashTab = null;                // which action list is open
let dashScope = null;              // { dept, cat, vendor } — loaded per employee
let dashCurrentTab = null;
// The frozen header (Show me + Needs attention tiles) can be collapsed down
// to just the greeting line, independently of it being frozen -- freeze
// and collapse are two different axes (pinned-or-not, shown-or-not), not
// a single either/or toggle.
let dashHeaderCollapsed = false;
let dashReorderMode = 'cover';     // 'cover' (SM+PM) | 'recovery' (Recovery%) -- buyer's choice of lens
let dashReorderMonths = 5;         // Cover mode's cutoff (SM+PM < this), editable in the UI
let dashReorderRecoveryPct = 30;   // Recovery mode's cutoff (Recovery% > this), editable in the UI

function dashPartOfDay(){
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}
function dashEsc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function dashName(){
  const first = String(CURRENT_EMPLOYEE_NAME || '').trim().split(/\s+/)[0];
  if(first) return first;
  if(CURRENT_ROLE === 'manager') return 'Manager';
  if(CURRENT_ROLE === 'ceo') return 'CEO';
  if(CURRENT_ROLE === 'admin') return 'Admin';
  return CURRENT_EMPLOYEE_ID ? 'Buyer ' + CURRENT_EMPLOYEE_ID : 'there';
}
function dashSubtitle(){
  if(CURRENT_ROLE === 'ceo' || CURRENT_ROLE === 'admin') return 'The whole business at a glance.';
  if(CURRENT_ROLE === 'manager') return 'How the range is performing, and what needs chasing.';
  return 'What needs your attention, in your area.';
}
const dashInt = n => Math.round(n).toLocaleString('en-US');
function dashCompact(n){
  const a = Math.abs(n);
  if(a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if(a >= 1e4) return Math.round(n / 1e3) + 'K';
  return dashInt(n);
}
function dashDate(iso){
  const d = new Date(iso + 'T00:00:00');
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + " '" + String(d.getFullYear()).slice(-2);
}
const dashAsOf = () => new Date(DATA_AS_OF + 'T00:00:00');
// Stock and sales/PO can come from different exports -- say both.
const dashAsOfText = () => STOCK_AS_OF === DATA_AS_OF && SALES_AS_OF === DATA_AS_OF ? 'Data as of ' + dashDate(DATA_AS_OF)
  : SALES_AS_OF === STOCK_AS_OF ? 'Stock & sales as of ' + dashDate(STOCK_AS_OF) + ' · POs to ' + dashDate(DATA_AS_OF)
  : 'Stock as of ' + dashDate(STOCK_AS_OF) + ' · sales to ' + dashDate(SALES_AS_OF) + ' · POs to ' + dashDate(DATA_AS_OF);
const dashLink = code => 'href="#item=' + encodeURIComponent(code) + '"';
const dashPOLink = po => 'href="#po=' + encodeURIComponent(po) + '"';

/* ---------- scope (per employee, remembered in this browser) ---------- */
// Same seven fields the All Products filter panel offers (FILTER_FIELD_MAP
// in app.js), so the dashboard can be scoped by anything All Products can
// be filtered by. dept/cat/vendor came first; range/group/puda/plan match
// it up to full parity.
// grp: the All / KAF / WOS range switch ('' = All), see CAT_GROUPS in app.js.
const DASH_SCOPE_DEFAULTS = { grp: '', dept: '', cat: '', vendor: '', range: '', group: '', puda: '', plan: '', event: '', life: '', pp: '' };
function dashScopeKey(){ return 'dashScope:' + (CURRENT_EMPLOYEE_ID || 'anon'); }
function dashLoadScope(){
  let s = null;
  try { s = JSON.parse(localStorage.getItem(dashScopeKey()) || 'null'); } catch(e){}
  dashScope = { ...DASH_SCOPE_DEFAULTS, ...(s || {}) };
}
function dashSaveScope(){ try { localStorage.setItem(dashScopeKey(), JSON.stringify(dashScope)); } catch(e){} }
const dashScopeIsSet = (scope = dashScope) => Object.keys(DASH_SCOPE_DEFAULTS).some(k => (scope[k] || '').length);
// PO Data keeps its own Show me filters, saved separately -- picking a Plan
// on the dashboard must not change PO Data, and vice versa.
let poDataScope = null, poDataVendorAmbiguous = null;
const poDataScopeKey = () => 'poDataScope:' + (CURRENT_EMPLOYEE_ID || 'anon');
function poDataLoadScope(){
  let s = null;
  try { s = JSON.parse(localStorage.getItem(poDataScopeKey()) || 'null'); } catch(e){}
  poDataScope = { ...DASH_SCOPE_DEFAULTS, ...(s || {}) };
}
// Each Show me bar reads/writes its own filter state through one of these.
const DASH_SLOT = {
  get: () => dashScope, set: s => { dashScope = s; dashSaveScope(); },
  getAmb: () => dashVendorAmbiguous, setAmb: a => { dashVendorAmbiguous = a; },
};
const PODATA_SLOT = {
  get: () => poDataScope, set: s => { poDataScope = s; try { localStorage.setItem(poDataScopeKey(), JSON.stringify(s)); } catch(e){} },
  getAmb: () => poDataVendorAmbiguous, setAmb: a => { poDataVendorAmbiguous = a; },
};
// PO_LINES carries only [po, item, desc, qty, eta, vendor, dept, cat] — no
// Range Name/Group Desc/PUDA Desc/Plan Code, so a PO line's own item is
// looked up here for those four.
const DASH_ITEM_BY_CODE = (() => {
  const m = {};
  ITEMS.forEach(it => { m[it['Item Code']] = it; });
  return m;
})();
// Vendor code filter accepts a typed vendor NAME too, resolved to its code
// on blur/change -- for every role, buyers included. Buyers must never see
// Vendor Name anywhere (canSeeVendorName()), so this never displays the
// name: the box always ends up showing the code, same as if they'd typed it
// directly. It's the same lookup logic Managers/CEO get, just with the name
// side of it kept invisible for buyers rather than a separate code path.
// VENDOR_CODES / VENDOR_NAME_TO_CODE are defined in app.js (loads first) --
// All Products' own Vendor Code filter search box uses the same two maps.
// "LUM" or "Ingenium" can genuinely match several DIFFERENT vendors, not
// just one -- silently picking the first (old behaviour) could quietly
// filter to the wrong company. This looks up every distinct vendor CODE
// whose name matches (exact tie, else prefix, else "contains" -- never a
// mix of tiers) and reports how many there are, so the caller can refuse to
// guess when there's more than one.
//   { type:'empty' } | { type:'code', code } -- already a real code, as-is
//   { type:'resolved', code } -- exactly one name match
//   { type:'ambiguous', codes:[...] } -- 2+ distinct vendors match
//   { type:'unmatched' } -- no code and no name matches at all
function vendorNameLookup(raw){
  const v = String(raw || '').trim();
  if(!v) return { type: 'empty' };
  if(VENDOR_CODES.has(v.toUpperCase())) return { type: 'code', code: v };
  const lower = v.toLowerCase();
  if(VENDOR_NAME_TO_CODE[lower]) return { type: 'resolved', code: VENDOR_NAME_TO_CODE[lower] };
  const names = Object.keys(VENDOR_NAME_TO_CODE);
  let hits = names.filter(n => n.startsWith(lower));
  if(!hits.length) hits = names.filter(n => n.includes(lower));
  if(!hits.length) return { type: 'unmatched' };
  const codes = [...new Set(hits.map(n => VENDOR_NAME_TO_CODE[n]))];   // same vendor, different name spellings -> not ambiguous
  return codes.length === 1 ? { type: 'resolved', code: codes[0] } : { type: 'ambiguous', codes };
}
// Set by the vendor field's change handler when a typed name matches more
// than one vendor -- { raw: what was typed, codes: [...] } or null. Read by
// dashScopeBar() to flag the box and by dashVendorAmbiguousTip() for its
// tooltip; never lists names for a buyer, only codes (canSeeVendorName()).
let dashVendorAmbiguous = null;
function dashVendorAmbiguousTip(amb = dashVendorAmbiguous){
  if(!amb) return '';
  const showNames = canSeeVendorName();
  const shown = amb.codes.slice(0, 8);
  const list = shown.map(c => {
    if(!showNames) return c;
    const it = ITEMS.find(i => i['Vendor Code'] === c);
    return it ? c + ' (' + it['Vendor Name'] + ')' : c;
  }).join(', ');
  const more = amb.codes.length > shown.length ? ', +' + (amb.codes.length - shown.length) + ' more' : '';
  return 'Matches ' + amb.codes.length + ' vendors: ' + list + more + '. Type the exact code, or more letters to narrow it down.';
}
// The visible list under the box -- the tooltip above is easy to miss since
// nothing prompts you to hover; this is the actual click-to-pick UI.
function dashVendorOptionsHtml(amb = dashVendorAmbiguous){
  if(!amb) return '';
  const showNames = canSeeVendorName();
  const shown = amb.codes.slice(0, 8);
  const more = amb.codes.length - shown.length;
  const opts = shown.map(c => {
    const it = ITEMS.find(i => i['Vendor Code'] === c);
    const label = showNames && it ? c + ' — ' + it['Vendor Name'] : c;
    return '<button type="button" class="dash-vendor-opt" data-code="' + dashEsc(c) + '">' + dashEsc(label) + '</button>';
  }).join('');
  return '<div class="dash-vendor-options">' + opts +
    (more > 0 ? '<div class="dash-vendor-more">+' + more + ' more — type more letters to narrow it down</div>' : '') +
    '</div>';
}
// A scope field is either a single string (dashboard's own Show me bar) or
// an array of selected values (the date-range popup's multi-select
// Department/Category/Plan) -- empty string/array both mean "no filter".
function scopeFieldMatch(val, selected){
  if(Array.isArray(selected)) return selected.length === 0 || selected.includes(val);
  return !selected || val === selected;
}
// scope defaults to dashScope -- the date-range popup's own "Show me" bar
// (app.js) reuses this exact matching logic with its own drScope instead.
// Range Name / Group Desc / PUDA Desc: ignore case and extra spaces. Text
// that IS one of the field's values (e.g. a picked suggestion) matches that
// value only; anything else matches every value containing it -- so typing
// "Comforter Set" finds "A.Soft Furnishing / Comforter Set".
const dashNormText = s => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
const DASH_TEXT_FIELD = { range: 'Range Name', group: 'Group Desc', puda: 'PUDA Desc' };
const dashTextValues = {};
function dashTextMatch(key, val, q){
  if(!q) return true;
  const n = dashNormText(q), v = dashNormText(val);
  if(!dashTextValues[key]) dashTextValues[key] = new Set(ITEMS.map(i => dashNormText(i[DASH_TEXT_FIELD[key]])));
  return dashTextValues[key].has(n) ? v === n : v.includes(n);
}
function dashItemInScope(it, scope){
  scope = scope || dashScope;
  const planVal = String(it['Current Plan Code'] || '').toUpperCase();
  const planSel = Array.isArray(scope.plan) ? scope.plan.map(p => String(p).toUpperCase()) : (scope.plan ? String(scope.plan).toUpperCase() : scope.plan);
  return inCatGroup(it['Catg Code'], scope.grp) &&
    scopeFieldMatch(it['Department Desc'], scope.dept) &&
    scopeFieldMatch(it['Category'], scope.cat) &&
    (!scope.vendor || String(it['Vendor Code']).toUpperCase() === scope.vendor.toUpperCase()) &&
    dashTextMatch('range', it['Range Name'], scope.range) &&
    dashTextMatch('group', it['Group Desc'], scope.group) &&
    dashTextMatch('puda', it['PUDA Desc'], scope.puda) &&
    scopeFieldMatch(planVal, planSel) &&
    scopeFieldMatch(it['Event'], scope.event) && scopeFieldMatch(it['Lifestyle'], scope.life) && scopeFieldMatch(it['Price Point'], scope.pp);
}
function dashLineInScope(l, scope = dashScope){   // a PO line: [po, item, desc, qty, eta, vendor, dept, cat]
  if(scope.grp){
    const it = DASH_ITEM_BY_CODE[l[1]];
    if(!inCatGroup(it ? it['Catg Code'] : CAT_DESC_CODE[String(l[7]).trim().toLowerCase()], scope.grp)) return false;
  }
  if(scope.range || scope.group || scope.puda || scope.plan || scope.event || scope.life || scope.pp){
    const it = DASH_ITEM_BY_CODE[l[1]];
    if(!it) return false;
    if(!dashTextMatch('range', it['Range Name'], scope.range)) return false;
    if(!dashTextMatch('group', it['Group Desc'], scope.group)) return false;
    if(!dashTextMatch('puda', it['PUDA Desc'], scope.puda)) return false;
    if(scope.plan && String(it['Current Plan Code']).toUpperCase() !== scope.plan.toUpperCase()) return false;
    if(!scopeFieldMatch(it['Event'], scope.event) || !scopeFieldMatch(it['Lifestyle'], scope.life) || !scopeFieldMatch(it['Price Point'], scope.pp)) return false;
  }
  return (!scope.dept || l[6] === scope.dept) &&
    (!scope.cat || l[7] === scope.cat) &&
    (!scope.vendor || String(l[5]).toUpperCase() === scope.vendor.toUpperCase());
}

/* ---------- lead time: the vendor's own measured median, else the overall one ---------- */
function dashLeadDays(vendorCode){
  const v = LEAD_TIMES.vendors[vendorCode];
  return v && v[1] >= LEAD_TIMES.MIN_LEAD_RECEIPTS ? v[0] : LEAD_TIMES.overall;
}
const dashDaysToMonths = d => d / 30.4;

/* ---------- months ---------- */
function dashWindows(){
  const last = MONTH_WINDOW[MONTH_WINDOW_LAST_DATA];
  const months = [];
  let y = last.year, m = last.m;
  for(let i = 0; i < 24; i++){ months.push({ year: y, m }); if(--m < 0){ m = 11; y--; } }
  months.reverse();
  const partial = last.year === REPORT_MONTH.year && last.m === REPORT_MONTH.month;   // latest month still in progress
  const complete = partial ? months.slice(0, 23) : months;
  return { partial, rate: complete.slice(-3), prior: complete.slice(-6, -3), year: complete.slice(-12), lastIdx: MONTH_WINDOW_LAST_DATA };
}
const unitsIn = (it, wins) => wins.reduce((a, mo) => { const yr = it.years[String(mo.year)]; return a + (yr ? (yr.sales[mo.m] || 0) : 0); }, 0);

/* ---------- the numbers ---------- */
/* Reorder / Out of stock / Overstock only look at these Plan Codes (CPC); the rest never show. */
const DASH_PLAN_CODES = new Set(['A', 'K', 'C', 'P']);
const dashPlan = it => String(it['Current Plan Code'] || '').trim().toUpperCase();
const dashPlanCell = it => '<td class="plan-cell dash-cpc">' + dashEsc(dashPlan(it)) + '</td>';

/* Discount bands -- the buying team's Excel formula on an item's Disct%:
   =IF(LEFT(d,1)="N","No Price",IF(d<0.104,"0-10%",IF(d<0.204,"11-20%", ...
   IF(d<0.804,"71-80%",IF(d>0.80401,"Above 80%"))))). Our data stores a
   numeric 0 instead of an "N..." text for items with no price, so "No
   Price" here is an item with neither a Now nor a Was price. The formula
   leaves 0.804-0.80401 in no band; those few go to 71-80%. */
const DASH_DISC_BANDS = ['No Price', '0-10%', '11-20%', '21-30%', '31-40%', '41-50%', '51-60%', '61-70%', '71-80%', 'Above 80%'];
function dashDiscBand(it){
  if(!(Number(it['Now (Aed)']) || 0) && !(Number(it['Was (Aed)']) || 0)) return 'No Price';
  const d = Number(it['Disct%']) || 0;
  if(d < 0.104) return '0-10%';
  if(d < 0.204) return '11-20%';
  if(d < 0.304) return '21-30%';
  if(d < 0.404) return '31-40%';
  if(d < 0.504) return '41-50%';
  if(d < 0.604) return '51-60%';
  if(d < 0.704) return '61-70%';
  if(d <= 0.80401) return '71-80%';
  return 'Above 80%';
}
function dashCompute(){
  const W = dashWindows();
  const vendorName = {};
  ITEMS.forEach(it => { vendorName[it['Vendor Code']] = it['Vendor Name']; });
  const R = {
    W, vendorName, items: 0, sold3: 0, prior3: 0, soh: 0, value: 0,
    reorder: [], oos: [], over: [], overValue: 0, movers: [],
    monthTotals: MONTH_WINDOW.map(() => 0), branch: {}, codes: new Set(),
  };
  ITEMS.forEach(it => {
    if(!dashItemInScope(it)) return;
    R.items++; R.codes.add(it['Item Code']);
    const sohRaw = Number(it['SOH']) || 0, soh = Math.max(0, sohRaw), po = Number(it['PO-Qty']) || 0;
    const cost = Number(it['L-Cost (Aed)']) || 0;
    const price = Number(it['Now (Aed)']) || Number(it['Was (Aed)']) || 0;
    const s3 = unitsIn(it, W.rate), p3 = unitsIn(it, W.prior), rate = s3 / 3;
    R.sold3 += s3; R.prior3 += p3; R.soh += soh; R.value += soh * cost;
    MONTH_WINDOW.forEach((w, i) => { R.monthTotals[i] += unitsIn(it, [w]); });
    if(DASH_PLAN_CODES.has(dashPlan(it))){
      if(rate > 0 && sohRaw <= 0 && po <= 0) R.oos.push({ it, rate, s3 });
      // Repeat-order criteria -- buyer picks the lens (dashReorderMode):
      // 'cover': combined cover -- stock (SM) plus what's already on order
      // (PM), both in months at the item's own best-average sales pace --
      // under dashReorderMonths (5 by default). AVG floored at 1 (not 0)
      // so a zero-sales item with something already on order comes out as
      // a huge, correctly-disqualifying cover number instead of a divide-
      // by-zero. avg > 0 is its own separate gate: without it, an item
      // with no sales history, no stock and nothing on order (soh=po=
      // avg=0) would read as "0 months of cover" and wrongly qualify.
      // 'recovery': Recovery% (sold since the last receipt ÷ (sold since +
      // SOH), same formula as Trip Requirement/13-mo Trend) over
      // dashReorderRecoveryPct (30 by default) -- selling fast enough to
      // be running down its cushion, regardless of cover. Both figures are
      // always computed so switching modes doesn't need a recompute pass.
      const avg = Number(it['AVG']) || 0;
      const sm = soh / Math.max(avg, 1);
      const pm = po / Math.max(avg, 1);
      const soldSinceLrcv = tripSoldSinceReceipt(it);
      const recovery = soldSinceLrcv == null ? null : sellThroughPct(soldSinceLrcv, soh);
      const qualifies = dashReorderMode === 'recovery'
        ? (recovery != null && recovery > dashReorderRecoveryPct)
        : (avg > 0 && sm + pm < dashReorderMonths);
      if(qualifies){
        R.reorder.push({ it, soh, po, avg, sm, pm, recovery, atRisk: rate * price });
      }
    }
    // Overstock: same A/K/C/P plan codes as Reorder now / Out of stock.
    const age = soh > 0 && DASH_PLAN_CODES.has(dashPlan(it)) ? stkAgeFor(it) : null;
    if(age && age.sno >= 3 && (rate === 0 || soh / rate > 12)){
      const tied = soh * cost;
      R.over.push({ it, soh, cover: rate > 0 ? soh / rate : null, age: age.label, tied, price, margin: marginPct(price, cost) });
      R.overValue += tied;
    }
    if(Math.max(s3, p3) >= 15) R.movers.push({ it, s3, p3, d: s3 - p3 });
  });
  // Sales of items not in ITEMS (dropped by the stock logic): sales only.
  SALES_ONLY_ITEMS.forEach(it => {
    if(!dashItemInScope(it)) return;
    const s3 = unitsIn(it, W.rate), p3 = unitsIn(it, W.prior);
    R.sold3 += s3; R.prior3 += p3;
    MONTH_WINDOW.forEach((w, i) => { R.monthTotals[i] += unitsIn(it, [w]); });
    if(Math.max(s3, p3) >= 15) R.movers.push({ it, s3, p3, d: s3 - p3 });
  });
  // Least cover first in cover mode (most urgent), highest Recovery% first
  // in recovery mode (recovery is never null here -- the qualifying filter
  // above already requires it in this mode).
  R.reorder.sort((a, b) => dashReorderMode === 'recovery' ? b.recovery - a.recovery : (a.sm + a.pm) - (b.sm + b.pm));
  // Buyers place orders per vendor, so also group the reorder list that way
  // -- vendor + its SKU count is the actual ask here, sorted by SKU count.
  // avgRecovery is only averaged over items that actually have one (cover
  // mode can include items with no Lrcv Date, so recovery may be null).
  const rv = {};
  R.reorder.forEach(x => {
    const v = x.it['Vendor Code'];
    const g = rv[v] = rv[v] || { vendor: v, items: 0, atRisk: 0, coverSum: 0, recoverySum: 0, recoveryCount: 0, plans: new Set() };
    g.plans.add(dashPlan(x.it));
    g.items++; g.atRisk += x.atRisk; g.coverSum += x.sm + x.pm;
    if(x.recovery != null){ g.recoverySum += x.recovery; g.recoveryCount++; }
  });
  R.reorderVendors = Object.values(rv).map(g => ({ ...g,
    avgCover: g.coverSum / g.items,
    avgRecovery: g.recoveryCount ? g.recoverySum / g.recoveryCount : null,
  })).sort((a, b) => b.items - a.items);
  R.reorderAtRisk = R.reorder.reduce((a, x) => a + x.atRisk, 0);
  R.oos.sort((a, b) => b.rate - a.rate);
  R.over.sort((a, b) => b.tied - a.tied);
  R.risers = R.movers.filter(x => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 5);
  R.fallers = R.movers.filter(x => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 5);
  R.risersAll = R.movers.filter(x => x.d > 0).sort((a, b) => b.d - a.d);
  R.fallersAll = R.movers.filter(x => x.d < 0).sort((a, b) => a.d - b.d);

  // branch sales over the last 12 complete months. Includes discontinued
  // items (they're not in ITEMS so can't be scope-checked) when no
  // dept/cat/vendor/etc filter is active; a filter falls back to live
  // items only, since a discontinued item has no attributes to match it against.
  Object.keys(BRANCH_MONTHLY_SOLD_BY_ITEM).forEach(code => {
    if(dashScopeIsSet() && !R.codes.has(code)) return;
    const byBranch = BRANCH_MONTHLY_SOLD_BY_ITEM[code];
    Object.keys(byBranch).forEach(b => {
      let t = 0;
      W.year.forEach(mo => { const a = byBranch[b][String(mo.year)]; if(a) t += a[mo.m] || 0; });
      if(t) R.branch[b] = (R.branch[b] || 0) + t;
    });
  });

  // open purchase orders in scope, grouped by PO
  const asOf = DATA_AS_OF, groups = {};
  PO_LINES.filter(l => !poCancelled(l[0]) && dashLineInScope(l)).forEach(l => {
    const g = groups[l[0]] = groups[l[0]] || { po: l[0], vendor: l[5], eta: l[4], units: 0, lines: 0, codes: new Set() };
    g.units += l[3]; g.lines++; g.codes.add(l[1]); if(l[4] < g.eta) g.eta = l[4];
  });
  const pos = Object.values(groups);
  const daysFrom = eta => Math.round((new Date(eta + 'T00:00:00') - dashAsOf()) / DAY);
  R.latePOs = pos.filter(p => p.eta < asOf).map(p => ({ ...p, late: -daysFrom(p.eta) })).sort((a, b) => b.late - a.late);
  R.soonPOs = pos.filter(p => p.eta >= asOf && daysFrom(p.eta) <= 30).map(p => ({ ...p, in: daysFrom(p.eta) })).sort((a, b) => a.in - b.in);
  R.onOrderUnits = pos.reduce((a, p) => a + p.units, 0);
  R.lateUnits = R.latePOs.reduce((a, p) => a + p.units, 0);
  R.soonUnits = R.soonPOs.reduce((a, p) => a + p.units, 0);
  // POs Expired: status "Pending" and created less than 15 days before
  // today (today's date, not the data date). Oldest first -- closest to the
  // 15-day mark. Status comes from PO_SHIP; created from PO_CREATED.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  R.expired = pos.map(p => {
    const status = String((PO_SHIP[p.po] || [])[2] || '').trim().toLowerCase();
    const created = PO_CREATED[p.po];
    const age = created ? Math.round((today - new Date(created + 'T00:00:00')) / DAY) : null;
    return { ...p, status, created, age };
  }).filter(p => p.status === 'pending' && p.age != null && p.age >= 0 && p.age < 15)
    .sort((a, b) => b.age - a.age);
  return R;
}

/* ---------- pieces of markup ---------- */
function dashBarList(rows){
  if(!rows.length) return '<p class="dash-empty">No sales in this selection.</p>';
  const max = Math.max(1, ...rows.map(r => r.value));
  return '<div class="dash-bars">' + rows.map(r =>
    '<div class="dash-bar-row"><span class="dash-bar-k" title="' + dashEsc(r.label) + '">' + dashEsc(r.label) + '</span>' +
      '<span class="dash-bar-track"><span class="dash-bar-fill" style="width:' + Math.max(2, r.value / max * 100).toFixed(1) + '%;background:' + (r.color || 'var(--stock)') + '"></span></span>' +
      '<span class="dash-bar-v">' + dashInt(r.value) + '</span></div>').join('') + '</div>';
}
// Items the stock logic dropped (sales-only.js) still count in sales figures,
// but aren't in ITEMS -- so they're listed without an Item Lookup link.
SALES_ONLY_ITEMS.forEach(it => { it._salesOnly = true; });
const dashItemCell = it => it._salesOnly ? '<td class="l" title="Not in the stock list (dropped by the Stock SetUp keep/drop rules) -- sales only"><b>' + dashEsc(it['Item Code']) + '</b> ' + dashEsc(it['Description']) + ' <small class="muted">· not in stock list</small></td>' : '<td class="l"><a ' + dashLink(it['Item Code']) + '><b>' + dashEsc(it['Item Code']) + '</b> ' + dashEsc(it['Description']) + '</a></td>';

/* ---------- the four action lists ---------- */
function dashActions(R){
  const showVendor = canSeeVendorName();
  const vname = c => showVendor ? (R.vendorName[c] || c) : c;
  const poTable = rows => '<table class="dash-table"><thead><tr><th class="l vcode">Vendor code</th><th class="l po">PO</th><th class="l vend">Vendor</th><th>Lines</th><th>Units</th><th>ETA</th><th>Late by</th></tr></thead><tbody>' +
    rows.map(p =>
      '<tr><td class="l vcode mono">' + dashEsc(p.vendor) + '</td><td class="l po"><a ' + dashPOLink(p.po) + ' title="Open this PO"><b class="mono">' + dashEsc(p.po) + '</b></a></td><td class="l muted" title="' + dashEsc(vname(p.vendor)) + '">' + dashEsc(vname(p.vendor)) + '</td>' +
      '<td>' + p.lines + '</td><td>' + dashInt(p.units) + '</td><td>' + dashEsc(dashDate(p.eta)) + '</td><td class="bad">' + p.late + ' d</td></tr>').join('') + '</tbody></table>';

  const lateCodes = new Set(); R.latePOs.forEach(p => p.codes.forEach(c => lateCodes.add(c)));
  const tabs = [
    { id: 'reorder', title: 'Reorder now', n: R.reorder.length, sub: R.reorderVendors.length + ' vendors \u00b7 AED ' + dashCompact(R.reorderAtRisk) + '/mo sales at risk', tone: 'warn',
      note: dashReorderMode === 'recovery'
        ? 'Selling items (Plan Codes A, K, C and P only) with Recovery % (sold since the last receipt ÷ (sold since + SOH)) over ' + dashReorderRecoveryPct + '% (adjustable below; 30 is the default). Ranked by Recovery%, highest first. Buyers order per vendor; click a vendor to open its items in All Products.'
        : 'Selling items (Plan Codes A, K, C and P only) whose combined cover — stock (SM) plus what’s already on order (PM), both in months at the item’s own best-average sales pace — is under ' + dashReorderMonths + ' months (adjustable below; 5 is the default). Ranked by combined cover, least first. Buyers order per vendor; click a vendor to open its items in All Products.',
      table: '<table class="dash-table"><thead><tr><th class="l item">Item</th><th>CPC</th><th class="l vend">Vendor</th><th>' + (dashReorderMode === 'recovery' ? 'Recovery%' : 'Cover') + '</th><th>Sales at risk / mo</th></tr></thead><tbody>' +
          R.reorder.map(x => '<tr>' + dashItemCell(x.it) + dashPlanCell(x.it) + '<td class="l muted">' + dashEsc(vname(x.it['Vendor Code'])) + '</td><td>' + (dashReorderMode === 'recovery' ? (x.recovery == null ? '—' : Math.round(x.recovery) + '%') : (x.sm + x.pm).toFixed(1) + ' mo') + '</td><td><b>AED ' + dashCompact(x.atRisk) + '</b></td></tr>').join('') + '</tbody></table>',
      codes: R.reorder.map(x => x.it['Item Code']), vendors: dashVendorsOf(R.reorder), sort: null },
    { id: 'oos', title: 'Out of stock, no PO', n: R.oos.length, sub: 'selling, none on hand, nothing on order', tone: 'bad',
      note: 'Sold in the last 3 months, no stock, and no open PO: the items losing sales right now. Plan Codes A, K, C and P only.',
      table: '<table class="dash-table"><thead><tr><th class="l item">Item</th><th>CPC</th><th class="l vend">Vendor</th><th>Sold / mo</th><th>Sold (3 mo)</th><th>Lead time</th></tr></thead><tbody>' +
        R.oos.map(x => '<tr>' + dashItemCell(x.it) + dashPlanCell(x.it) + '<td class="l muted">' + dashEsc(vname(x.it['Vendor Code'])) + '</td><td>' + x.rate.toFixed(1) + '</td><td>' + dashInt(x.s3) + '</td><td>' + dashInt(dashLeadDays(x.it['Vendor Code'])) + ' d</td></tr>').join('') + '</tbody></table>',
      codes: R.oos.map(x => x.it['Item Code']), sort: null },
    { id: 'late', title: 'Late POs', n: R.latePOs.length, sub: dashInt(R.lateUnits) + ' units past ETA', tone: 'bad',
      note: 'Open POs whose ETA was before ' + dashDate(DATA_AS_OF) + ' (the data date) and are still not received.',
      table: poTable(R.latePOs), codes: [...lateCodes], sort: null },
    { id: 'over', title: 'Overstock / slow', n: R.over.length, sub: 'AED ' + dashCompact(R.overValue) + ' tied up', tone: '',
      note: 'Plan Codes A, K, C and P only: stock 6+ months old with over 12 months of cover at the recent pace, or no sales at all. Largest first. Margin = (price − landed cost) ÷ price at today’s price, so it is also roughly how deep a markdown can go before selling at cost.',
      table: '<table class="dash-table"><thead><tr><th class="l item">Item</th><th>Stock</th><th>Cover</th><th>Age</th><th>Tied up (AED)</th><th>Price</th><th>Margin</th></tr></thead><tbody>' +
        R.over.slice(0, 10).map(x => '<tr>' + dashItemCell(x.it) + '<td>' + dashInt(x.soh) + '</td><td>' + (x.cover == null ? 'no sales' : x.cover.toFixed(0) + ' mo') + '</td><td>' + dashEsc(x.age) + '</td><td><b>' + dashInt(x.tied) + '</b></td><td>' + (x.price ? dashInt(x.price) : '—') + '</td><td class="' + (x.margin != null && x.margin < 0.15 ? 'bad' : '') + '">' + (x.margin == null ? '—' : Math.round(x.margin * 100) + '%') + '</td></tr>').join('') + '</tbody></table>',
      codes: R.over.map(x => x.it['Item Code']), vendors: dashVendorsOf(R.over), sort: [{ field: 'SOH', dir: 'desc' }] },
  ];
  if(!tabs.some(t => t.id === dashTab)) dashTab = (tabs.find(t => t.n > 0) || tabs[0]).id;
  const cur = tabs.find(t => t.id === dashTab);
  dashCurrentTab = cur;
  // Split in two -- the tiles sit inside the dashboard's frozen header band
  // (see .dash-sticky in renderDashboard()), but the detail card below them
  // scrolls normally, same as any other section.
  const tilesHtml = '<div class="dash-tiles">' + tabs.map(t =>
      '<button type="button" class="dash-tile' + (t.id === dashTab ? ' on' : '') + (t.n && t.tone ? ' ' + t.tone : '') + '" data-tab="' + t.id + '">' +
        '<span class="dash-tile-k">' + t.title + '</span><span class="dash-tile-v">' + dashInt(t.n) + '</span><span class="dash-tile-n">' + dashEsc(t.sub) + '</span></button>').join('') + '</div>';
  const detailHtml = '<section class="dash-card dash-detail"><div class="dash-detail-head"><h3>' + cur.title + ' <span>' + (cur.id === 'reorder' ? dashInt(R.reorderVendors.length) + ' vendors, ' + dashInt(cur.n) + ' items' : dashInt(cur.n) + (cur.id === 'late' ? ' POs' : ' items') + (cur.id === 'over' && cur.n > 10 ? ', top 10 shown' : '')) + '</span></h3>' +
      (cur.id === 'reorder' ? '<div class="dash-seg" id="dashReorderModeSeg">' +
          '<button type="button" data-mode="cover" class="' + (dashReorderMode === 'cover' ? 'on' : '') + '">Cover</button>' +
          '<button type="button" data-mode="recovery" class="' + (dashReorderMode === 'recovery' ? 'on' : '') + '">Recovery%</button>' +
        '</div>' +
        (dashReorderMode === 'recovery'
          ? '<label class="page-jump" title="Items qualify when Recovery% is over this. Default is 30.">Over<input type="number" id="dashReorderRecoveryInput" min="0" max="100" step="1" value="' + dashReorderRecoveryPct + '">%</label>'
          : '<label class="page-jump" title="Items qualify when combined SM+PM cover is under this many months. Default is 5.">Under<input type="number" id="dashReorderMonthsInput" min="0.5" step="0.5" value="' + dashReorderMonths + '">months</label>') : '') +
      (cur.n ? '<button type="button" class="dash-btn" id="dashOpenAll">Open ' + (cur.id === 'late' ? 'their ' + dashInt(cur.codes.length) + ' items' : 'all ' + dashInt(cur.n)) + ' in All Products &rarr;</button>' : '') +
      (cur.n && cur.vendors ? '<button type="button" class="dash-btn ghost" id="dashOpenVendors" title="Every item from the vendors on this list, not just the flagged ones">All items from these ' + dashInt(cur.vendors.length) + ' vendors &rarr;</button>' : '') + '</div>' +
      '<p class="dash-note">' + dashEsc(cur.note) + '</p>' +
      (cur.n ? (cur.id === 'over' ? cur.table : '<div class="dash-table-scroll">' + cur.table + '</div>') : '<p class="dash-empty">Nothing here for this selection. Good.</p>') + '</section>';
  return { tilesHtml, detailHtml };
}

const dashVendorsOf = list => [...new Set(list.map(x => x.it['Vendor Code']))];
const dashPOCodes = pos => { const s = new Set(); pos.forEach(p => p.codes.forEach(c => s.add(c))); return s; };
function dashMoverTable(rows, up, total){
  if(!rows.length) return '<p class="dash-empty">No big movers.</p>';
  return '<table class="dash-table"><thead><tr><th class="l item">Item</th><th>Before</th><th>Now</th><th>Change</th></tr></thead><tbody>' +
    rows.map(x => '<tr>' + dashItemCell(x.it) + '<td>' + dashInt(x.p3) + '</td><td>' + dashInt(x.s3) + '</td><td class="' + (up ? 'good' : 'bad') + '">' + (up ? '+' : '') + dashInt(x.d) + '</td></tr>').join('') + '</tbody></table>' +
    '<button type="button" class="dash-btn ghost dash-more" data-movers="' + (up ? 'up' : 'down') + '">See all ' + dashInt(total) + ' ' + (up ? 'rising' : 'falling') + ' items &rarr;</button>';
}

/* PO money: Total = PO qty x the item's Latest FOB Cost, in that FOB's own
   currency (USD or EUR today). Summed per currency, never across them -- a
   total spanning two currencies shows each one side by side. Shared by the
   PO detail and PO Data pages. */
const dashFmtMoney = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dashAddMoney = (acc, cur, v) => { if(cur) acc[cur] = (acc[cur] || 0) + v; };
const dashFob = it => ({ fob: it ? Number(it['Latest FOB Cost']) || 0 : 0, cur: it ? String(it['Currency Code'] || '') : '' });
function dashMoneyCells(acc){
  const curs = Object.keys(acc).sort();
  if(!curs.length) return '<td>—</td><td>—</td>';
  if(curs.length === 1) return '<td class="c"><b>' + dashEsc(curs[0]) + '</b></td><td><b>' + dashFmtMoney(acc[curs[0]]) + '</b></td>';
  return '<td class="c"><b>Mixed</b></td><td><b>' + curs.map(k => dashEsc(k) + ' ' + dashFmtMoney(acc[k])).join(' · ') + '</b></td>';
}

/* ---------- PO detail page (reached via #po=<PO No>, e.g. a Late POs row)
   ----------
   PO_LINES carries [po, item, desc, qty, eta, vendor, dept, cat]; the
   per-PO shipment fields (Ship Date, Revised Ship, Status, ports, Container
   Size, Territory) come from PO_SHIP and the create date from PO_CREATED,
   all in po-data.js. Category/Department come straight off the PO line;
   PUDA/Plan Code/FOB are item attributes, joined in via DASH_ITEM_BY_CODE. */
function renderPOPage(poNo){
  const root = document.getElementById('poRoot');
  if(!root) return;
  const lines = PO_LINES.filter(l => l[0] === poNo);
  if(!lines.length){
    root.innerHTML = '<p class="dash-empty">PO ' + dashEsc(poNo) + ' not found.</p>';
    return;
  }
  const [, , , , eta, vendorCode] = lines[0];
  const vendorName = canSeeVendorName() ? VENDOR_CODE_TO_NAME[vendorCode] : null;
  let totalQty = 0;
  const totalMoney = {};
  // The 6 shipment columns are the same for every line on a PO, so -- like
  // the reference sheet's merged cells -- they only print once, on the
  // first row, spanning every line via rowspan.
  const poInfo = { eta, ...poShipInfo(poNo) };
  const shipCells = poShipCells(poInfo, lines.length);
  const rowsHtml = lines.map((l, i) => {
    const [, code, desc, qty, , , dept, cat] = l;
    const it = DASH_ITEM_BY_CODE[code];
    const puda = it ? it['PUDA Desc'] : '';
    const plan = l[8] || (it ? dashPlan(it) : '');
    const { fob, cur } = dashFob(it);
    const value = fob * qty;
    totalQty += qty;
    if(fob) dashAddMoney(totalMoney, cur, value);
    return '<tr>' + (i === 0 ? shipCells : '') + dashItemCell({ 'Item Code': code, Description: desc }) +
      '<td class="l">' + dashEsc(cat) + '</td><td class="l">' + dashEsc(dept) + '</td><td class="l puda">' + dashEsc(puda || '—') + '</td>' +
      '<td class="plan-cell dash-cpc">' + dashEsc(plan || '—') + '</td><td>' + dashInt(qty) + '</td>' + (i === 0 ? poContainerCell(poInfo, lines.length) : '') +
      '<td class="c">' + dashEsc(cur || '—') + '</td><td>' + (fob && cur ? dashFmtMoney(value) : '—') + '</td></tr>';
  }).join('');
  root.innerHTML =
    '<div class="item-header">' +
      '<span class="code mono">' + dashEsc(poNo) + '</span>' +
      (vendorName ? '<span class="desc">' + dashEsc(vendorName) + '</span>' : '') +
      '<span class="tag mono">' + dashEsc(vendorCode) + '</span>' +
    '</div>' +
    '<div class="dash-detail-head"><h3>Items on this PO <span>' + dashInt(lines.length) + ' lines</span></h3>' +
      '<button type="button" class="dash-btn" id="poOpenAll">Open in All Products &rarr;</button></div>' +
    '<div class="po-table-wrap"><table class="dash-table po-sheet"><thead>' +
      '<tr class="po-grp"><th colspan="5" class="po-ship-end">Shipment</th><th colspan="5">Product</th><th colspan="4">Order</th></tr><tr>' +
      '<th class="c">Fnl ETD</th><th class="c">Fnl ETA</th><th class="c">Status</th><th class="c">Port Of Origin</th><th class="c po-ship-end">Discharge Port</th>' +
      '<th class="l item">Item</th><th class="l">Category</th><th class="l">Department</th><th class="l">PUDA</th><th>CPC</th><th>Order Qty</th><th>Container Size</th><th class="c">Currency</th><th title="Order Qty × Latest FOB Cost">Total</th>' +
    '</tr></thead><tbody>' +
      rowsHtml +
    '</tbody><tfoot><tr class="po-total-row"><td class="l" colspan="10"><b>' + dashEsc(poNo) + ' Total</b></td><td><b>' + dashInt(totalQty) + '</b></td><td></td>' + dashMoneyCells(totalMoney) + '</tr></tfoot></table></div>';
  const openAll = document.getElementById('poOpenAll');
  if(openAll) openAll.addEventListener('click', () => openGridFocus(poNo, lines.map(l => l[1]), null));
}

/* ---------- PO Data page (reached via #podata, the "PO Data" nav button)
   ----------
   Every open PO, grouped Vendor -> PO No, matching the PO Approval Ship Dt
   sheet's actual merged-cell look -- Vendor and PO No (+ its 6 shipment
   columns) use real rowspan, same as the single-PO page already does for
   shipment fields, just nested one level deeper: PO's rowspan covers only
   its own item rows (its own total row gets its own fresh cells, same as
   the single-PO page); Vendor's rowspan covers its item rows PLUS every
   one of its own POs' total rows (that's genuinely "inside" the vendor),
   stopping right before the vendor's own total row. Territory merges all
   the way across the whole table, down to and including the grand total
   row -- every PO is UAE today; it reads "Mixed" if that ever changes. */
let poDataHeaderCollapsed = false;
// Items that appear on at least one open PO -- the option pool for PO Data's filters.
let poDataItemsCache = null;
const poDataItems = () => poDataItemsCache || (poDataItemsCache = [...new Set(PO_LINES.map(l => l[1]))].map(c => DASH_ITEM_BY_CODE[c]).filter(Boolean));
// PO Data's three dates -- PO Create Date, Revised ETD, ETA -- one date
// each (Date at local midnight, or null), plus one Backward/Forward choice
// shared by all three. Backward keeps POs whose date is on or before the
// picked date, Forward on or after; every date that's set must pass, and a
// PO with no value for a set date drops out. Same DD-MMM-YY typing +
// calendar as All Products' From/To (parseDMY/formatDMY in app.js).
const PO_DATE_FIELDS = [
  { key: 'created', label: 'PO Create Date' },
  { key: 'etd',     label: 'Fnl ETD' },
  { key: 'eta',     label: 'Fnl ETA' },
];
const poDataDates = { created: null, etd: null, eta: null };
let poDateDir = 'back';   // 'back' (on or before) | 'fwd' (on or after)
const poDatesSet = () => PO_DATE_FIELDS.some(f => poDataDates[f.key]);
// A PO's value for each date column, as YYYY-MM-DD: Revised ETD is the
// revised ship date when there is one, otherwise the original ship date.
function poDateValue(key, po, eta){
  if(key === 'created') return PO_CREATED[po] || null;
  if(key === 'etd') return (PO_SHIP[po] || [])[0] || null;
  return eta || null;
}
function poDatesMatch(po, eta){
  return PO_DATE_FIELDS.every(f => {
    const d = poDataDates[f.key];
    if(!d) return true;
    const v = poDateValue(f.key, po, eta), pick = dateToISO(d);
    return !!v && (poDateDir === 'back' ? v <= pick : v >= pick);
  });
}
const PO_CAL_ICON = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/></svg>';
function poDateBar(){
  return '<div class="po-dates">' +
    '<label class="po-date-dir" title="Backward shows POs on or before the dates you pick; Forward shows them on or after">' +
      '<select id="poDateDir"><option value="back"' + (poDateDir === 'back' ? ' selected' : '') + '>Backward</option>' +
      '<option value="fwd"' + (poDateDir === 'fwd' ? ' selected' : '') + '>Forward</option></select></label>' +
    PO_DATE_FIELDS.map(f => {
      const v = poDataDates[f.key];
      const tip = f.label + ': type DD-MMM-YY (for example 05-Mar-26) or pick from the calendar';
      return '<div class="date-field' + (v ? ' dsf-active' : '') + '" data-dk="' + f.key + '" title="' + tip + '">' +
        '<span class="dsf-label">' + f.label + '</span>' +
        '<input type="text" class="date-text" placeholder="DD-MMM-YY" maxlength="11" autocomplete="off" spellcheck="false" aria-label="' + tip + '" value="' + (v ? formatDMY(v) : '') + '">' +
        '<button type="button" class="cal-btn" aria-label="Open calendar" title="Pick from a calendar">' + PO_CAL_ICON + '</button>' +
        '<input type="date" class="cal-native" tabindex="-1" aria-hidden="true">' +
      '</div>';
    }).join('') +
  '</div>';
}
const poDateChips = () => PO_DATE_FIELDS.filter(f => poDataDates[f.key]).map(f => dashChip('data-dk="' + f.key + '"', f.label, (poDateDir === 'back' ? 'on/before ' : 'on/after ') + formatDMY(poDataDates[f.key]))).join('');
function poWireDateBar(root){
  const dir = root.querySelector('#poDateDir');
  if(dir) dir.addEventListener('change', () => { poDateDir = dir.value; renderPOData(); });
  // Registered before the Show me bar's own reset handler (which re-renders),
  // so "Show everything" clears the dates too.
  const reset = root.querySelector('#dashReset');
  if(reset) reset.addEventListener('click', () => PO_DATE_FIELDS.forEach(f => { poDataDates[f.key] = null; }));
  root.querySelectorAll('.dash-chips .chip[data-dk]').forEach(chip => chip.addEventListener('click', () => { poDataDates[chip.dataset.dk] = null; renderPOData(); }));
  root.querySelectorAll('.po-dates .date-field').forEach(box => {
    const key = box.dataset.dk;
    const text = box.querySelector('.date-text'), btn = box.querySelector('.cal-btn'), native = box.querySelector('.cal-native');
    // red on a bad date, brass when set
    // A bad date just turns the box red; a real change re-filters the table.
    const commit = result => {
      if(result.error){ box.classList.add('invalid'); return; }
      const before = poDataDates[key];
      poDataDates[key] = result.date || null;
      if((before && before.getTime()) !== (poDataDates[key] && poDataDates[key].getTime())) renderPOData();
      else text.value = result.date ? formatDMY(result.date) : '';
    };
    const fromText = () => commit(parseDMY(text.value));
    text.addEventListener('blur', fromText);
    text.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); fromText(); } });
    text.addEventListener('input', () => box.classList.remove('invalid'));
    btn.addEventListener('click', () => {
      try { native.showPicker(); } catch(e){ try { native.focus(); native.click(); } catch(e2){} }
    });
    native.addEventListener('change', () => {
      const v = native.value;
      if(!v){ commit({ empty: true }); return; }
      const [y, mo, d] = v.split('-').map(Number);
      commit({ date: new Date(y, mo - 1, d) });
    });
    if(poDataDates[key]) native.value = dateToISO(poDataDates[key]);
  });
}
// Shipment status order, from the buying team's status key.
// SetUp sheet order (its 0.1, 0.2 ... series).
const PO_STATUS_ORDER = ['GRN Pending', 'At Port', 'Released', 'In Transit', 'Pending', 'Hold', 'Cancelled'];
// Cancelled POs stay listed (PO Data, PO page) but are not open orders.
const poCancelled = po => (PO_SHIP[po] || [])[2] === 'Cancelled';
// Sort for PO Data: null (Vendor then PO No) or { key: 'created'|'eta'|'etd'|'status', dir: 1|-1 }.
// Clicking a sortable header cycles ascending -> descending -> off.
let poDataSort = null;
// Per-PO shipment fields (PO_SHIP in po-data.js): ship = Fnl ETD (logistics
// New ETD, else Revised Ship Date, else Ship Date), status = logistics status.
function poShipInfo(po){
  const s = PO_SHIP[po] || [];
  return { ship: s[0] || null, revShip: s[1] || null, status: s[2] || null, territory: s[3] || null, container: s[4] || null, origin: s[5] || null, discharge: s[6] || null };
}
// The 6 merged shipment cells, shared by the PO detail and PO Data pages.
function poShipCells(g, rowspan){
  const d = v => v ? dashDate(v) : '—', t = v => v ? dashEsc(v) : '—';
  return [d(g.ship), d(g.eta), t(g.status), t(g.origin), t(g.discharge)]
    .map((v, i, arr) => '<td class="po-ship' + (i === arr.length - 1 ? ' po-ship-end' : '') + '" rowspan="' + rowspan + '">' + v + '</td>').join('');
}
const poContainerCell = (g, rowspan) => '<td class="po-ship c" rowspan="' + rowspan + '">' + (g.container ? dashEsc(g.container) : '—') + '</td>';
const poEtd = g => g.ship || null;   // PO_SHIP[0] is already the Fnl ETD
function poSortValue(g, key){
  if(key === 'eta') return g.eta || null;
  if(key === 'created') return g.created || null;
  if(key === 'etd') return poEtd(g);
  if(key === 'status'){ const i = PO_STATUS_ORDER.indexOf(g.status); return g.status ? (i < 0 ? PO_STATUS_ORDER.length : i) : null; }
  return null;
}
// Ascending or descending, but blanks always last.
function poCompare(a, b, dir){
  if(a === b) return 0;
  if(a === null) return 1;
  if(b === null) return -1;
  return (a < b ? -1 : 1) * dir;
}
function renderPOData(){
  const root = document.getElementById('poDataRoot');
  if(!root) return;
  const showVendor = canSeeVendorName();
  const vname = c => showVendor ? (VENDOR_CODE_TO_NAME[c] || c) : c;
  if(!poDataScope) poDataLoadScope();
  const lines = PO_LINES.filter(l => dashLineInScope(l, poDataScope) && poDatesMatch(l[0], l[4]));

  const byVendor = {};
  lines.forEach(l => {
    const po = l[0], vendor = l[5];
    if(!byVendor[vendor]) byVendor[vendor] = {};
    if(!byVendor[vendor][po]) byVendor[vendor][po] = { po, eta: l[4], created: PO_CREATED[po] || null, lines: [], ...poShipInfo(po) };
    byVendor[vendor][po].lines.push(l);
  });
  // Sorted: POs order by the chosen field inside each vendor, and vendors
  // order by their first PO under that same sort (ties fall back to code).
  const s = poDataSort;
  const sortedPOs = v => Object.keys(byVendor[v]).sort((a, b) =>
    (s ? poCompare(poSortValue(byVendor[v][a], s.key), poSortValue(byVendor[v][b], s.key), s.dir) : 0) || (a < b ? -1 : a > b ? 1 : 0));
  const vendorCodes = Object.keys(byVendor).sort((a, b) =>
    (s ? poCompare(poSortValue(byVendor[a][sortedPOs(a)[0]], s.key), poSortValue(byVendor[b][sortedPOs(b)[0]], s.key), s.dir) : 0) || (a < b ? -1 : a > b ? 1 : 0));
  const poCount = vendorCodes.reduce((n, v) => n + Object.keys(byVendor[v]).length, 0);
  // Territory is blank for literally every row in the whole file (never
  // imported), so it merges once across the entire table rather than
  // per-vendor -- a single "—" instead of ~4,900 repeats of the same
  // placeholder. Covers every row this function emits, including the
  // grand total row at the very end.
  const territoryRowSpan = lines.length + poCount + vendorCodes.length + 1;
  let territoryCellDone = false;
  // One merged Territory cell for the whole table (every PO is UAE today);
  // if the shown POs ever span several territories it reads "Mixed".
  const terrs = new Set(); vendorCodes.forEach(v => Object.values(byVendor[v]).forEach(g => terrs.add(g.territory || '—')));
  const territoryLabel = terrs.size === 1 ? [...terrs][0] : 'Mixed';

  let grandQty = 0, bodyHtml = '';
  const grandMoney = {};
  vendorCodes.forEach(vendor => {
    const pos = byVendor[vendor];
    const poNos = sortedPOs(vendor);
    // +1 per PO so the vendor's own merge covers that PO's own total row
    // too (still "inside" the vendor), not just its item lines.
    const vendorRowSpan = poNos.reduce((n, po) => n + pos[po].lines.length + 1, 0);
    let vendorQty = 0, vendorCellDone = false;
    const vendorMoney = {};
    poNos.forEach(po => {
      const group = pos[po];
      const poRowSpan = group.lines.length;
      let poQty = 0;
      const poMoney = {};
      group.lines.forEach((l, i) => {
        const [, code, desc, qty] = l;
        const it = DASH_ITEM_BY_CODE[code];
        const puda = it ? it['PUDA Desc'] : '';
        const plan = l[8] || (it ? dashPlan(it) : '');
        const range = it ? it['Range Name'] : '';
        const cat = l[7], dept = l[6];
        const fob = it ? Number(it['Latest FOB Cost']) || 0 : 0;
        const cur = it ? String(it['Currency Code'] || '') : '';
        const value = fob * qty;
        poQty += qty;
        if(fob) [poMoney, vendorMoney, grandMoney].forEach(acc => dashAddMoney(acc, cur, value));
        let row = '<tr>';
        if(!territoryCellDone){
          row += '<td class="terr" rowspan="' + territoryRowSpan + '">' + dashEsc(territoryLabel) + '</td>';
          territoryCellDone = true;
        }
        if(!vendorCellDone){
          row += '<td class="l mono po-ship" rowspan="' + vendorRowSpan + '">' + dashEsc(vendor) + '</td>';
          vendorCellDone = true;
        }
        if(i === 0){
          row += '<td class="po-ship" rowspan="' + poRowSpan + '">' + (group.created ? dashDate(group.created) : '—') + '</td>' +
            '<td class="l po po-ship" rowspan="' + poRowSpan + '"><a ' + dashPOLink(po) + ' title="Open this PO"><b class="mono">' + dashEsc(po) + '</b></a></td>' +
            poShipCells(group, poRowSpan);
        }
        row += dashItemCell({ 'Item Code': code, Description: desc }) +
          '<td class="l">' + dashEsc(cat) + '</td><td class="l">' + dashEsc(dept) + '</td><td class="l">' + dashEsc(puda || '—') + '</td><td class="l">' + dashEsc(range || '—') + '</td>' +
          '<td class="plan-cell dash-cpc">' + dashEsc(plan || '—') + '</td><td>' + dashInt(qty) + '</td>' + (i === 0 ? poContainerCell(group, poRowSpan) : '') +
          '<td class="c">' + dashEsc(cur || '—') + '</td><td>' + (fob && cur ? dashFmtMoney(value) : '—') + '</td></tr>';
        bodyHtml += row;
      });
      vendorQty += poQty;
      // Territory and Vendor are both covered by active rowspans from
      // above -- this row's own cells start at PO Create Date.
      bodyHtml += '<tr class="po-total-row"><td class="l" colspan="13"><b>' + dashEsc(po) + ' Total</b></td><td><b>' + dashInt(poQty) + '</b></td><td></td>' + dashMoneyCells(poMoney) + '</tr>';
    });
    grandQty += vendorQty;
    const vendorLabel = dashEsc(vendor) + (showVendor ? ' — ' + dashEsc(vname(vendor)) : '');
    // Vendor's own rowspan has ended by here, but Territory's table-wide
    // one hasn't -- this row's own cells still start at Vendor.
    bodyHtml += '<tr class="vendor-total-row"><td class="l" colspan="14"><b>' + vendorLabel + ' · Total</b></td><td><b>' + dashInt(vendorQty) + '</b></td><td></td>' + dashMoneyCells(vendorMoney) + '</tr>';
  });
  // Territory's rowspan reaches all the way down to here too, so this
  // row's own span starts one column later than it would otherwise.
  const grandTotalRow = '<tr class="grand-total-row"><td class="l" colspan="14"><b>Grand Total</b></td><td><b>' + dashInt(grandQty) + '</b></td><td></td>' + dashMoneyCells(grandMoney) + '</tr>';

  const sortTh = (key, label, tip) => {
    const on = s && s.key === key;
    return '<th class="c po-sortable' + (on ? ' sorted' : '') + '" data-sort="' + key + '" title="Sort by ' + dashEsc(tip) + ' (click again to reverse, a third time to clear)">' +
      label + (on ? ' <span class="po-sort-ind">' + (s.dir === 1 ? '&#9650;' : '&#9660;') + '</span>' : '') + '</th>';
  };
  root.innerHTML =
    '<div class="dash-sticky">' +
    '<div class="dash-hero">' +
      '<div class="dash-hero-line">' +
        '<span class="dash-date">PO Data</span>' +
        '<h1 class="dash-greet">Every open PO</h1>' +
        '<p class="dash-sub">' + dashInt(lines.length) + ' lines across ' + dashInt(poCount) + ' POs, ' + dashInt(vendorCodes.length) + ' vendors — grouped by vendor, then PO.</p>' +
      '</div>' +
      '<div class="dash-links"><button type="button" class="dash-btn ghost" id="poDataHeaderToggle">' + (poDataHeaderCollapsed ? 'Expand &#9662;' : 'Collapse &#9652;') + '</button></div>' +
    '</div>' +
    (poDataHeaderCollapsed ? '' : dashScopeBar(poDataScope, poDataVendorAmbiguous, { headless: true, extra: poDateBar(), chips: poDateChips(), listPrefix: 'po', anySet: poDatesSet(), baseItems: poDataItems() })) +
    '</div>' +
    (lines.length ? '' : '<p class="dash-empty">No open PO lines match these filters and dates.</p>') +
    (!lines.length ? '' : '<div class="dash-table-scroll podata-scroll"><table class="dash-table po-sheet"><thead>' +
      '<tr class="po-grp"><th colspan="4">Purchase Order</th><th colspan="5" class="po-ship-end">Shipment</th><th colspan="6">Product</th><th colspan="4">Order</th></tr><tr>' +
      '<th class="c terr">Territory</th><th class="l">Vendor</th>' + sortTh('created', 'PO Create Date', 'PO creation date') + '<th class="l">PO No</th>' +
      sortTh('etd', 'Fnl ETD', 'Logistics New ETD, else Revised Ship Date, else Ship Date') + sortTh('eta', 'Fnl ETA', 'Logistics New ETA, else Arrival Date') +
      sortTh('status', 'Status', 'In order: ' + PO_STATUS_ORDER.join(', ')) + '<th class="c">Port Of Origin</th><th class="c po-ship-end">Discharge Port</th>' +
      '<th class="l item">Item</th><th class="l">Category</th><th class="l">Department</th><th class="l">PUDA</th><th class="l">Range Name</th><th>CPC</th><th>Order Qty</th><th>Container Size</th><th class="c">Currency</th><th title="Order Qty × Latest FOB Cost">Total</th>' +
    '</tr></thead><tbody>' + bodyHtml + grandTotalRow + '</tbody></table></div>');
  if(!poDataHeaderCollapsed){ poWireDateBar(root); dashWireScopeBar(root, renderPOData, PODATA_SLOT); }
  root.querySelector('#poDataHeaderToggle').addEventListener('click', () => { poDataHeaderCollapsed = !poDataHeaderCollapsed; renderPOData(); });
  root.querySelectorAll('th.po-sortable').forEach(th => th.addEventListener('click', () => {
    const key = th.dataset.sort;
    poDataSort = !poDataSort || poDataSort.key !== key ? { key, dir: 1 } : poDataSort.dir === 1 ? { key, dir: -1 } : null;
    renderPOData();
  }));
}

// opts.headless: no "Show me" heading line -- the reset button sits inline
// after the fields instead (PO Data). opts.extra: HTML for a full-width row
// inside the same card (PO Data's dates). opts.anySet: show the reset button
// even when no Show me field is set (PO Data's dates count too).
// opts.noReset: leave the reset button out -- the caller places it (the
// dashboard puts it in its greeting row).
// One removable chip per set Show me field (same chips as All Products).
// opts.chips: extra chip HTML (PO Data's dates).
const DASH_CHIP_LABELS = [['cat', 'Category'], ['dept', 'Department'], ['vendor', 'Vendor code'], ['range', 'Range Name'], ['group', 'Group Desc'], ['puda', 'PUDA Desc'], ['plan', 'Plan'], ['event', 'Event'], ['life', 'Lifestyle'], ['pp', 'Price Point']];
const dashChip = (attr, k, v) => '<button type="button" class="chip" ' + attr + ' title="Remove this filter"><span class="chip-k">' + k + '</span><span class="chip-v">' + dashEsc(v) + '</span><span class="chip-x">&times;</span></button>';
// opts.multiPlan: Plan as tick boxes (several codes at once; scope.plan is
// then an array) -- Trip Requirement. Only one such bar exists, so one open
// flag; a click anywhere outside closes it.
let dashPlanOpen = false, dashPlanRerender = null;
document.addEventListener('click', e => {
  if(dashPlanOpen && !e.target.closest('.dr-ms-field')){ dashPlanOpen = false; if(dashPlanRerender) dashPlanRerender(); }
});
function dashScopeBar(scope = dashScope, amb = dashVendorAmbiguous, opts = {}){
  // a multi-pick Plan gets one chip per code
  const chips = DASH_CHIP_LABELS.flatMap(([k, l]) => [].concat(scope[k] || []).map(v => dashChip('data-k="' + k + '" data-v="' + dashEsc(v) + '"', l, k === 'life' ? lifestyleLabel(v) : v))).join('') + (opts.chips || '');

  const reset = dashScopeIsSet(scope) || opts.anySet ? '<button type="button" class="dash-btn ghost filters-active-btn' + (opts.headless ? ' dash-scope-reset' : '') + '" id="dashReset">Show everything</button>' : '';
  // Cascading options: each field lists only the values found among the items
  // that pass every OTHER field's filter (so Category = Furniture narrows
  // Department, Vendor, Range... and vice versa). opts.baseItems limits the
  // pool (PO Data: only items on an open PO). A value that's currently picked
  // always stays in its own list, so it never silently vanishes while still
  // filtering.
  const base = opts.baseItems || ITEMS;
  // Suggestion lists get a per-page id prefix: the Dashboard and PO Data bars
  // are both in the DOM at once, and list="id" resolves document-wide.
  const lp = opts.listPrefix || '';
  const uniq = (key, f) => {
    const others = { ...scope, [key]: '' };
    const vals = new Set(base.filter(it => dashItemInScope(it, others)).map(i => i[f]).filter(Boolean));
    [].concat(scope[key] || []).forEach(v => vals.add(v));
    return [...vals].sort();
  };
  const opt = (arr, cur) => '<option value="">All</option>' + arr.map(v => '<option' + (v === cur ? ' selected' : '') + '>' + dashEsc(v) + '</option>').join('');
  // Range Name / Group Desc / PUDA Desc run into the hundreds or thousands of
  // values (matching FILTER_SEARCHABLE in app.js) — a plain <select> with
  // that many options is unusable, so these get the same searchable
  // text+datalist combo as Vendor code instead of a dropdown list.
  const search = (id, field, label) => '<label>' + label + '<input id="' + id + '" list="' + lp + id + 'List" value="' + dashEsc(scope[field]) + '" placeholder="All" autocomplete="off"></label>' +
    '<datalist id="' + lp + id + 'List">' + uniq(field, field === 'range' ? 'Range Name' : field === 'group' ? 'Group Desc' : 'PUDA Desc').map(v => '<option value="' + dashEsc(v) + '">').join('') + '</datalist>';
  const planSel = [].concat(scope.plan || []);
  const planField = !opts.multiPlan
    ? '<label>Plan<select id="dashPlan">' + opt(uniq('plan', 'Current Plan Code'), scope.plan) + '</select></label>'
    : '<label class="dash-vendor-field dr-ms-field">Plan' +
      '<button type="button" id="dashPlanBtn" class="dr-ms-btn' + (planSel.length ? ' dr-ms-active' : '') + '">' +
        dashEsc(!planSel.length ? 'All' : planSel.length === 1 ? planSel[0] : planSel.length + ' selected') + '<span class="dr-ms-caret">▾</span></button>' +
      (dashPlanOpen ? '<div class="dr-ms-panel" id="dashPlanPanel">' +
        (planSel.length ? '<button type="button" class="dr-ms-clear" id="dashPlanClear">Clear</button>' : '') +
        uniq('plan', 'Current Plan Code').map(v => '<label class="dr-ms-opt' + (planSel.includes(v) ? ' dr-ms-checked' : '') + '"><input type="checkbox" value="' + dashEsc(v) + '"' + (planSel.includes(v) ? ' checked' : '') + '><span class="dr-ms-lbl">' + dashEsc(v) + '</span></label>').join('') +
      '</div>' : '') + '</label>';
  return '<div class="dash-scope dash-scope-grid">' + (opts.headless ? '' : '<div class="dash-scope-head"><span class="dash-scope-t">Show me</span>' + reset + '</div>') +
    // Range toggle spans both rows on the left; the 10 filters fill a 5 + 5 grid beside it:
    // Category, Department, Group, Vendor, PUDA on top; Plan, Range Name, Event, Lifestyle, Price Point below.
    '<div class="dash-grp-field"><span class="dash-grp-k">Display Filter</span>' + catGroupSeg('dashGrpSeg', scope.grp) + '</div>' +
    '<label>Category<select id="dashCat">' + opt(uniq('cat', 'Category'), scope.cat) + '</select></label>' +
    '<label>Department<select id="dashDept">' + opt(uniq('dept', 'Department Desc'), scope.dept) + '</select></label>' +
    search('dashGroup', 'group', 'Group Desc') +
    '<label class="dash-vendor-field">Vendor code<input id="dashVendor" list="' + lp + 'dashVendorList" class="' + (amb ? 'dash-vendor-ambiguous' : '') + '" value="' +
      dashEsc(amb ? amb.raw : scope.vendor) + '" title="' + dashEsc(dashVendorAmbiguousTip(amb)) + '" placeholder="All" autocomplete="off">' +
      dashVendorOptionsHtml(amb) + '</label>' +
    '<datalist id="' + lp + 'dashVendorList">' + uniq('vendor', 'Vendor Code').map(v => '<option value="' + dashEsc(v) + '">').join('') + '</datalist>' +
    search('dashPuda', 'puda', 'PUDA Desc') +
    planField +
    search('dashRange', 'range', 'Range Name') +
    '<label>Event<select id="dashEvent">' + opt(uniq('event', 'Event'), scope.event) + '</select></label>' +
    '<label>Lifestyle<select id="dashLife"><option value="">All</option>' + uniq('life', 'Lifestyle').map(v => '<option value="' + dashEsc(v) + '"' + (v === scope.life ? ' selected' : '') + '>' + dashEsc(lifestyleLabel(v)) + '</option>').join('') + '</select></label>' +
    '<label>Price Point<select id="dashPP">' + opt(uniq('pp', 'Price Point'), scope.pp) + '</select></label>' +
    (opts.extra ? '<span class="dash-scope-break"></span>' + opts.extra : '') + (opts.headless && !opts.noReset ? reset : '') +
    (chips ? '<div class="filter-chips dash-chips">' + chips + '</div>' : '') +
    '</div>';
}

/* ---------- Discount banding (Stock ↔ Sales, and by stock age) ----------
   Stock side: every in-scope item's units on hand at L-Cost / Was / Now,
   banded by its current Was-vs-Now discount (dashDiscBand).
   Sales side: SALES_VALUES (sales-values.js), banded by the discount each
   sale actually went out at, over the chosen period: rolling 3/6/9/12
   months or everything on record, ending at the latest month on file
   (SALES_LAST_MONTH), or a custom From/To month range.
   Consignment (Cons. Status = Yes) is kept out of every band, total and
   margin -- its value shows on a separate line instead, so it can't skew
   the margins.
     Discount %     = 1 - Now / Was                (sales: discount / RSP)
     Margin factor  = Now / Cost                   (sales: net / COGS)
     Margin %       = (Now - Cost) / Now           (sales: (net - COGS) / net)
     Contribution % = band's share of total stock at cost (sales: of net sales)
   Bands use the existing DASH_DISC_BANDS boundaries (0-10% means up to 10%). */
let dashBandPeriod = { mode: '3', from: null, to: null };
const dashBandOpenAges = new Set();
const DASH_BAND_LABEL = { 'No Price': 'No price', '0-10%': '0–10%', 'Above 80%': 'Above 80%' };
const dashBandLabel = b => DASH_BAND_LABEL[b] || b.replace('-', '–');
const dashMonthLabel = i => MONTHS[i % 12] + " '" + String(2024 + Math.floor(i / 12)).slice(-2);
function dashBandRange(){
  const last = SALES_LAST_MONTH, p = dashBandPeriod;
  if(p.mode === 'custom'){
    const from = p.from == null ? Math.max(0, last - 2) : p.from, to = p.to == null ? last : p.to;
    return from <= to ? [from, to] : [to, from];
  }
  return p.mode === 'all' ? [0, last] : [Math.max(0, last - Number(p.mode) + 1), last];
}
const DASH_AGE_SALES_ONLY = 'Not in stock list';
function dashBanding(){
  const [from, to] = dashBandRange();
  const blank = () => ({ items: 0, units: 0, cost: 0, was: 0, now: 0, sItems: 0, sUnits: 0, cogs: 0, rsp: 0, net: 0, disc: 0, codes: new Set(), sCodes: new Set() });
  const bands = DASH_DISC_BANDS.map(blank), cons = blank();
  const ages = {};   // age label -> { sno, bands: [...] }
  // ITEMS give stock and sales; SALES_ONLY_ITEMS (dropped from stock) only
  // sales, under their own 'Not in stock list' row in the age table.
  ITEMS.concat(SALES_ONLY_ITEMS).forEach(it => {
    if(!dashItemInScope(it)) return;
    const code = it['Item Code'], isCons = CONS_ITEMS.has(code), salesOnly = it._salesOnly;
    const soh = Math.max(0, Number(it['SOH']) || 0);
    const bi = DASH_DISC_BANDS.indexOf(dashDiscBand(it));
    const age = salesOnly ? { label: DASH_AGE_SALES_ONLY, sno: 99 } : stkAgeFor(it);
    const A = ages[age.label] || (ages[age.label] = { sno: age.sno, bands: DASH_DISC_BANDS.map(blank) });
    const stock = (b) => {
      b.items++; b.units += soh; b.codes.add(code);
      b.cost += soh * (Number(it['L-Cost (Aed)']) || 0); b.was += soh * (Number(it['Was (Aed)']) || 0); b.now += soh * (Number(it['Now (Aed)']) || 0);
    };
    if(salesOnly){} else if(isCons) stock(cons); else { stock(bands[bi]); stock(A.bands[bi]); }
    (SALES_VALUES[code] || []).forEach(r => {
      if(r[0] < from || r[0] > to) return;
      const add = b => { b.sUnits += r[3]; b.cogs += r[4]; b.rsp += r[5]; b.net += r[6]; b.disc += r[7]; b.sCodes.add(code); };
      if(r[2] || isCons) add(cons); else { add(bands[r[1]]); add(A.bands[r[1]]); }
    });
  });
  const total = arr => arr.reduce((t, b) => {
    for(const k in t) if(typeof t[k] === 'number') t[k] += b[k];
    b.codes.forEach(c => t.codes.add(c)); b.sCodes.forEach(c => t.sCodes.add(c));
    return t;
  }, blank());
  [...bands, cons].forEach(b => { b.sItems = b.sCodes.size; });
  Object.values(ages).forEach(A => A.bands.forEach(b => { b.sItems = b.sCodes.size; }));
  const T = total(bands); T.sItems = T.sCodes.size; T.items = T.codes.size;
  return { from, to, bands, cons, total: T,
    ages: Object.entries(ages).sort((a, b) => a[1].sno - b[1].sno).map(([label, A]) => ({ label, bands: A.bands, total: total(A.bands) })) };
}
const dashPct = (v, t) => t ? v / t * 100 : null;
const dashFmtPct = (p, d = 1) => p == null || !isFinite(p) ? '—' : p.toFixed(d) + '%';
const dashFmtX = v => v == null || !isFinite(v) || !v ? '—' : v.toFixed(2) + 'x';
const dashAed = v => '<span title="AED ' + dashInt(v) + '">' + dashCompact(v) + '</span>';
function dashBandCells(b, T, excluded){
  const shareBar = (p, cls) => '<td class="dash-band-share">' + (p == null ? '—' : '<span class="dash-band-bar ' + cls + '"><i style="width:' + Math.max(0, Math.min(100, p)).toFixed(1) + '%"></i></span><span class="dash-band-pct">' + p.toFixed(1) + '%</span>') + '</td>';
  const view = (n, side) => n ? '<button type="button" class="dash-band-view" data-side="' + side + '" title="Show these items in All Products">' + dashInt(n) + '</button>' : '0';
  const m = (a, b2) => excluded ? '<td class="muted">—</td>' : '<td>' + a + '</td>';
  return '<td>' + view(b.items, 'stock') + '</td><td>' + dashInt(b.units) + '</td><td>' + dashAed(b.cost) + '</td><td>' + dashAed(b.was) + '</td><td>' + dashAed(b.now) + '</td>' +
    (excluded ? '<td class="muted">—</td>' : shareBar(dashPct(b.cost, T.cost), 'stock')) +
    m(dashFmtPct(b.was ? (1 - b.now / b.was) * 100 : null)) + m(dashFmtX(b.cost ? b.now / b.cost : null)) + m(dashFmtPct(b.now ? (b.now - b.cost) / b.now * 100 : null)) +
    '<td class="band-split">' + view(b.sItems, 'sales') + '</td><td>' + dashInt(b.sUnits) + '</td><td>' + dashAed(b.cogs) + '</td><td>' + dashAed(b.rsp) + '</td><td>' + dashAed(b.net) + '</td>' +
    (excluded ? '<td class="muted">—</td>' : shareBar(dashPct(b.net, T.net), 'sold')) +
    m(dashFmtPct(b.rsp ? b.disc / b.rsp * 100 : null)) + m(dashFmtX(b.cogs ? b.net / b.cogs : null)) + m(dashFmtPct(b.net ? (b.net - b.cogs) / b.net * 100 : null));
}
function dashBandPeriodBar(B){
  const opt = (v, l) => '<option value="' + v + '"' + (dashBandPeriod.mode === v ? ' selected' : '') + '>' + l + '</option>';
  const months = (sel, id) => '<select id="' + id + '">' + Array.from({ length: SALES_LAST_MONTH + 1 }, (_, i) => '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + dashMonthLabel(i) + '</option>').join('') + '</select>';
  return '<div class="band-period"><label>Sales period<select id="dashBandMode">' + opt('3', 'Last 3 months') + opt('6', 'Last 6 months') + opt('9', 'Last 9 months') + opt('12', 'Last 12 months') + opt('all', 'All on record') + opt('custom', 'Custom…') + '</select></label>' +
    (dashBandPeriod.mode === 'custom' ? '<label>From' + months(B.from, 'dashBandFrom') + '</label><label>To' + months(B.to, 'dashBandTo') + '</label>' : '') +
    '<span class="band-period-note">' + dashEsc(dashMonthLabel(B.from) + ' – ' + dashMonthLabel(B.to)) + (B.to === SALES_LAST_MONTH ? ' (sales to ' + dashEsc(dashDate(SALES_AS_OF)) + ')' : '') + '</span></div>';
}
function dashBandTables(){
  const B = dashBanding(), T = B.total, per = dashMonthLabel(B.from) + ' – ' + dashMonthLabel(B.to);
  const head = '<thead><tr class="band-grp"><th></th><th colspan="9">Stock on hand (today)</th><th colspan="9" class="band-split">Sales · ' + dashEsc(per) + '</th></tr><tr><th class="l">Discount band</th>' +
    '<th>Items</th><th>Units</th><th>At cost</th><th>At Was</th><th>At Now</th><th>% of stock</th><th>Disc %</th><th>Margin factor</th><th>Margin %</th>' +
    '<th class="band-split">Items</th><th>Units</th><th>COGS</th><th>RSP</th><th>Net sale</th><th>% of sales</th><th>Disc %</th><th>Margin factor</th><th>Margin %</th></tr></thead>';
  const row = (b, i) => '<tr data-band="' + i + '"><td class="l"><b>' + dashBandLabel(DASH_DISC_BANDS[i]) + '</b></td>' + dashBandCells(b, T) + '</tr>';
  const main = '<section class="dash-card wide tone-warn dash-bands"><h3>Stock ↔ Sales discount banding <span>consignment excluded from bands and margins</span></h3>' +
    dashBandPeriodBar(B) +
    '<div class="band-wrap"><table class="dash-table band-table">' + head + '<tbody>' + B.bands.map(row).join('') +
    '<tr class="band-total" data-band="total"><td class="l"><b>Total</b></td>' + dashBandCells(T, T) + '</tr>' +
    '<tr class="band-cons" data-band="cons"><td class="l">Consignment <small>(excluded from margin)</small></td>' + dashBandCells(B.cons, T, true) + '</tr>' +
    '</tbody></table></div></section>';
  // consolidated: per stock-age bracket, the bands' share of all stock (at cost) vs of all net sales
  const share = (v, t) => dashFmtPct(dashPct(v, t));
  const ageRow = (b, label, cls, attrs) => '<tr class="' + cls + '"' + attrs + '><td class="l">' + label + '</td><td>' + (b.codes.size || b.items ? '<button type="button" class="dash-band-view" data-side="stock">' + dashInt(b.codes.size || b.items) + '</button>' : '0') + '</td><td>' + dashInt(b.units) + '</td><td>' + dashAed(b.cost) + '</td><td class="band-pct">' + share(b.cost, T.cost) + '</td>' +
    '<td class="band-split">' + dashInt(b.sUnits) + '</td><td>' + dashAed(b.net) + '</td><td class="band-pct">' + share(b.net, T.net) + '</td></tr>';
  const ageBody = B.ages.map((A, ai) => {
    const open = dashBandOpenAges.has(A.label);
    return ageRow(A.total, '<button type="button" class="band-age-toggle" aria-expanded="' + open + '">' + (open ? '&#9662;' : '&#9656;') + '</button><b>' + dashEsc(A.label === '24 Above' ? '24+ months' : /^New/.test(A.label) || A.label === DASH_AGE_SALES_ONLY ? A.label : A.label + ' months') + '</b>', 'band-age', ' data-age="' + ai + '"') +
      (open ? A.bands.map((b, i) => (b.items || b.sUnits) ? ageRow(b, dashBandLabel(DASH_DISC_BANDS[i]), 'band-age-band', ' data-age="' + ai + '" data-band="' + i + '"') : '').join('') : '');
  }).join('');
  const aging = '<section class="dash-card wide tone-stock dash-bands"><h3>Discount banding by stock age <span>share of all stock (at cost) vs share of net sales, ' + dashEsc(per) + '</span></h3>' +
    '<div class="band-age-tools"><button type="button" class="dash-btn ghost" id="dashBandAgesAll">' + (dashBandOpenAges.size === B.ages.length ? 'Collapse all' : 'Expand all') + '</button></div>' +
    '<div class="band-wrap"><table class="dash-table band-table band-age-table"><thead><tr class="band-grp"><th></th><th colspan="4">Stock on hand</th><th colspan="3" class="band-split">Sales · ' + dashEsc(per) + '</th></tr>' +
    '<tr><th class="l">Stock age / discount band</th><th>Items</th><th>Units</th><th>At cost</th><th>% of stock</th><th class="band-split">Units</th><th>Net sale</th><th>% of sales</th></tr></thead><tbody>' + ageBody +
    '<tr class="band-total"><td class="l"><b>Total</b></td><td>' + dashInt(T.items) + '</td><td>' + dashInt(T.units) + '</td><td>' + dashAed(T.cost) + '</td><td class="band-pct">100%</td><td class="band-split">' + dashInt(T.sUnits) + '</td><td>' + dashAed(T.net) + '</td><td class="band-pct">100%</td></tr>' +
    '</tbody></table></div></section>';
  return { html: main + aging, B };
}
/* ---------- SIM PIM Summary (its own page, #simpim) ----------
   For the items in this page's own Show me scope, one row per value of the
   next filter not yet picked (bar order: Category, Department, Group,
   Vendor, PUDA, Plan, Range, Event, Lifestyle, Price Point; all picked ->
   items). Clicking a row picks it and drills one level down.
     Stock    SOH units, and at L-Cost
     On order open PO qty and PO Cost (Tot Order Cost AED from the PO file;
              cancelled POs left out)
     Avg      units and COGS sold per month over the last 3/6/9/12 complete
              months (a month still in progress would drag the average down)
     SIM      stock / avg (Qty: units, Value: cost / COGS), in months
     PIM      on order / avg, the same two ways
   Items dropped from the stock list (SALES_ONLY_ITEMS) still count in sales. */
let simScope = null, simVendorAmbiguous = null, simMonths = 3, simHeaderCollapsed = false;
const simScopeKey = () => 'simScope:' + (CURRENT_EMPLOYEE_ID || 'anon');
const SIM_SLOT = {
  get: () => simScope, set: s => { simScope = s; try { localStorage.setItem(simScopeKey(), JSON.stringify(s)); } catch(e){} },
  getAmb: () => simVendorAmbiguous, setAmb: a => { simVendorAmbiguous = a; },
};
const SIM_LEVELS = [
  ['cat', 'Category', it => it['Category']], ['dept', 'Department', it => it['Department Desc']], ['group', 'Group Desc', it => it['Group Desc']],
  ['vendor', 'Vendor', it => it['Vendor Code']], ['puda', 'PUDA Desc', it => it['PUDA Desc']], ['plan', 'Plan', it => dashPlan(it)],
  ['range', 'Range Name', it => it['Range Name']], ['event', 'Event', it => it['Event']], ['life', 'Lifestyle', it => it['Lifestyle']], ['pp', 'Price Point', it => it['Price Point']],
];
let simPoByItem = null;   // item code -> { qty, cost } on open POs
function simPO(){
  if(simPoByItem) return simPoByItem;
  simPoByItem = {};
  PO_LINES.forEach(l => {
    if(poCancelled(l[0])) return;
    const r = simPoByItem[l[1]] || (simPoByItem[l[1]] = { qty: 0, cost: 0 });
    r.qty += l[3]; r.cost += l[9] || 0;
  });
  return simPoByItem;
}
const dashMonthEnd = i => new Date(Date.UTC(2024 + Math.floor(i / 12), i % 12 + 1, 0)).toISOString().slice(0, 10);
function simMonthRange(){
  const done = SALES_AS_OF >= dashMonthEnd(SALES_LAST_MONTH) ? SALES_LAST_MONTH : SALES_LAST_MONTH - 1;
  return [Math.max(0, done - simMonths + 1), done];
}
function simCompute(){
  const level = SIM_LEVELS.find(([k]) => !(simScope[k] || '').length);
  const [from, to] = simMonthRange(), po = simPO();
  const keyOf = level ? level[2] : it => it['Item Code'];
  const rows = {}, T = { units: 0, cost: 0, poQty: 0, poCost: 0, sUnits: 0, cogs: 0 };
  ITEMS.concat(SALES_ONLY_ITEMS).forEach(it => {
    if(!dashItemInScope(it, simScope)) return;
    const k = keyOf(it) || '', r = rows[k] || (rows[k] = { k, it, units: 0, cost: 0, poQty: 0, poCost: 0, sUnits: 0, cogs: 0 });
    if(!it._salesOnly){
      const soh = Math.max(0, Number(it['SOH']) || 0), p = po[it['Item Code']];
      r.units += soh; r.cost += soh * (Number(it['L-Cost (Aed)']) || 0);
      if(p){ r.poQty += p.qty; r.poCost += p.cost; }
    }
    (SALES_VALUES[it['Item Code']] || []).forEach(s => { if(s[0] >= from && s[0] <= to){ r.sUnits += s[3]; r.cogs += s[4]; } });
  });
  const list = Object.values(rows).filter(r => r.units || r.poQty || r.sUnits).sort((a, b) => b.cost - a.cost || String(a.k).localeCompare(String(b.k)));
  list.forEach(r => { for(const f in T) T[f] += r[f]; });
  return { level, list, T, from, to, n: to - from + 1 };
}
function renderSimPim(){
  const root = document.getElementById('simRoot');
  if(!root) return;
  if(!simScope){
    let s = null;
    try { s = JSON.parse(localStorage.getItem(simScopeKey()) || 'null'); } catch(e){}
    simScope = { ...DASH_SCOPE_DEFAULTS, ...(s || {}) };
  }
  const C = simCompute(), T = C.T, n = C.n;
  const per = dashMonthLabel(C.from) + (C.from === C.to ? '' : ' – ' + dashMonthLabel(C.to));
  const months = v => v == null || !isFinite(v) ? '—' : v.toFixed(1);
  // more than a year of stock reads red, under 2 months amber
  const tone = v => v == null || !isFinite(v) ? '' : v > 12 ? ' bad' : v < 2 ? ' warn' : '';
  const bar = (p, cls) => '<td class="dash-band-share' + (cls === 'stock' ? ' band-split' : '') + '">' + (p == null ? '—' : '<span class="dash-band-bar ' + cls + '"><i style="width:' + Math.max(0, Math.min(100, p)).toFixed(1) + '%"></i></span><span class="dash-band-pct">' + p.toFixed(1) + '%</span>') + '</td>';
  const cells = r => {
    const aU = r.sUnits / n, aC = r.cogs / n;
    const sq = aU > 0 ? r.units / aU : null, sv = aC > 0 ? r.cost / aC : null, pq = aU > 0 ? r.poQty / aU : null, pv = aC > 0 ? r.poCost / aC : null;
    return '<td>' + dashInt(r.units) + '</td><td>' + dashAed(r.cost) + '</td>' +
      '<td class="band-split">' + dashInt(r.poQty) + '</td><td>' + dashAed(r.poCost) + '</td>' +
      '<td class="band-split">' + dashInt(aU) + '</td><td>' + dashAed(aC) + '</td>' +
      '<td class="band-split sim-m' + tone(sq) + '">' + months(sq) + '</td><td class="sim-m' + tone(sv) + '">' + months(sv) + '</td>' +
      '<td class="band-split sim-m">' + months(pq) + '</td><td class="sim-m">' + months(pv) + '</td>' +
      bar(dashPct(r.cost, T.cost), 'stock') + bar(dashPct(r.cogs, T.cogs), 'sold');
  };
  const L = C.level, label = L ? L[1] : 'Item';
  const next = L ? (SIM_LEVELS[SIM_LEVELS.indexOf(L) + 1] || [, 'items'])[1] : '';
  const rowName = r => !L ? '<b class="mono">' + dashEsc(r.k) + '</b> ' + dashEsc(r.it['Description'] || '') :
    '<b>' + dashEsc(L[0] === 'life' ? lifestyleLabel(r.k) : L[0] === 'vendor' && canSeeVendorName() && VENDOR_CODE_TO_NAME[r.k] ? r.k + ' — ' + VENDOR_CODE_TO_NAME[r.k] : r.k || '(blank)') + '</b>';
  const body = C.list.map(r => '<tr' + (L && r.k ? ' class="dash-pick" data-v="' + dashEsc(r.k) + '" title="Show the ' + dashEsc(next) + ' inside this"' : '') + '><td class="l">' + rowName(r) + '</td>' + cells(r) + '</tr>').join('');
  const seg = [3, 6, 9, 12].map(m => '<button type="button" data-m="' + m + '" class="' + (m === simMonths ? 'on' : '') + '">' + m + ' months</button>').join('');
  root.innerHTML =
    '<div class="dash-sticky">' +
    '<div class="dash-hero">' +
      '<div class="dash-hero-line">' +
        '<span class="dash-date">SIM PIM Summary</span>' +
        '<h1 class="dash-greet">Stock &amp; orders in months of sales</h1>' +
        '<p class="dash-sub">Pick a filter, or click a row, to drill down. <span class="dash-asof">' + dashEsc(dashAsOfText()) + '.</span></p>' +
      '</div>' +
      '<div class="dash-links"><button type="button" class="dash-btn ghost" id="simHeaderToggle">' + (simHeaderCollapsed ? 'Expand &#9662;' : 'Collapse &#9652;') + '</button></div>' +
    '</div>' +
    (simHeaderCollapsed ? '' : dashScopeBar(simScope, simVendorAmbiguous, { headless: true, listPrefix: 'sim' })) +
    '</div>' +
    '<section class="dash-card wide tone-pos dash-bands"><h3>By ' + dashEsc(label) + ' <span>SIM = stock ÷ avg monthly sales · PIM = on order ÷ avg monthly sales, in months</span></h3>' +
    '<div class="band-period"><div class="dash-seg" id="simMonthsSeg">' + seg + '</div><span class="band-period-note">Average over ' + dashEsc(per) + ' (complete months)</span></div>' +
    (C.list.length ? '<div class="band-wrap"><table class="dash-table band-table sim-table"><thead><tr class="band-grp"><th></th><th colspan="2">Stock</th><th colspan="2" class="band-split">On order</th><th colspan="2" class="band-split">Avg sales / month</th><th colspan="2" class="band-split">SIM (months)</th><th colspan="2" class="band-split">PIM (months)</th><th colspan="2" class="band-split">Contribution</th></tr>' +
      '<tr><th class="l">' + dashEsc(label) + '</th><th>Qty</th><th>Cost</th><th class="band-split">Qty</th><th>PO Cost</th><th class="band-split">Qty</th><th>COGS</th><th class="band-split">Qty</th><th>Value</th><th class="band-split">Qty</th><th>Value</th><th class="band-split">% of stock</th><th>% of sales</th></tr></thead><tbody>' +
      body + '<tr class="band-total"><td class="l"><b>Total</b></td>' + cells(T) + '</tr></tbody></table></div>'
      : '<p class="dash-empty">Nothing matches these filters.</p>') +
    '</section>';
  if(!simHeaderCollapsed) dashWireScopeBar(root, renderSimPim, SIM_SLOT);
  root.querySelector('#simHeaderToggle').addEventListener('click', () => { simHeaderCollapsed = !simHeaderCollapsed; renderSimPim(); });
  root.querySelectorAll('#simMonthsSeg button').forEach(b => b.addEventListener('click', () => { simMonths = Number(b.dataset.m); renderSimPim(); }));
  if(L) root.querySelectorAll('.sim-table tr.dash-pick').forEach(tr => tr.addEventListener('click', () => {
    SIM_SLOT.set({ ...simScope, [L[0]]: tr.dataset.v });
    renderSimPim();
    window.scrollTo({ top: 0 });
  }));
}
function dashWireBands(root, B, scopeSuffix){
  const $ = id => root.querySelector('#' + id);
  const mode = $('dashBandMode');
  if(mode) mode.addEventListener('change', () => {
    dashBandPeriod = { ...dashBandPeriod, mode: mode.value };
    if(mode.value === 'custom' && dashBandPeriod.from == null){ dashBandPeriod.from = B.from; dashBandPeriod.to = B.to; }
    renderDashboard();
  });
  ['From', 'To'].forEach(k => { const el = $('dashBand' + k); if(el) el.addEventListener('change', () => { dashBandPeriod = { ...dashBandPeriod, [k.toLowerCase()]: Number(el.value) }; renderDashboard(); }); });
  const all = $('dashBandAgesAll');
  if(all) all.addEventListener('click', () => {
    if(dashBandOpenAges.size === B.ages.length) dashBandOpenAges.clear(); else B.ages.forEach(A => dashBandOpenAges.add(A.label));
    renderDashboard();
  });
  root.querySelectorAll('.band-age-toggle').forEach(btn => btn.addEventListener('click', () => {
    const A = B.ages[btn.closest('tr').dataset.age];
    if(dashBandOpenAges.has(A.label)) dashBandOpenAges.delete(A.label); else dashBandOpenAges.add(A.label);
    renderDashboard();
  }));
  const per = dashMonthLabel(B.from) + '–' + dashMonthLabel(B.to);
  root.querySelectorAll('.dash-band-view').forEach(btn => btn.addEventListener('click', () => {
    const tr = btn.closest('tr'), side = btn.dataset.side, band = tr.dataset.band, ageI = tr.dataset.age;
    const A = ageI != null ? B.ages[ageI] : null;
    const b = band === 'total' ? B.total : band === 'cons' ? B.cons : band != null ? (A ? A.bands[band] : B.bands[band]) : A.total;
    const what = band === 'total' ? 'All bands' : band === 'cons' ? 'Consignment' : band != null ? 'Discount ' + dashBandLabel(DASH_DISC_BANDS[band]) : 'All bands';
    const label = (A ? 'Age ' + A.label + ' · ' : '') + what + (side === 'sales' ? ' · sold ' + per : ' · in stock') + scopeSuffix;
    openGridFocus(label, [...(side === 'sales' ? b.sCodes : b.codes)], null);
  }));
}
function renderDashboard(){
  const root = document.getElementById('dashRoot');
  if(!root) return;
  if(!dashScope) dashLoadScope();
  const R = dashCompute(), W = R.W;
  const showVendor = canSeeVendorName();
  const vname = c => showVendor ? (R.vendorName[c] || c) : c;
  const vcodeName = c => c + (showVendor && R.vendorName[c] ? ' — ' + R.vendorName[c] : '');
  const delta = R.prior3 > 0 ? (R.sold3 - R.prior3) / R.prior3 * 100 : null;
  const cover = R.sold3 > 0 ? R.soh / (R.sold3 / 3) : null;
  const typicalLead = dashDaysToMonths(LEAD_TIMES.overall);
  const winLabel = monthColLabel(W.rate[0]) + '–' + monthColLabel(W.rate[2]);
  const kpi = (k, v, n, tone) => '<div class="dash-kpi' + (tone ? ' ' + tone : '') + '"><span class="dash-kpi-k">' + k + '</span><span class="dash-kpi-v">' + v + '</span><span class="dash-kpi-n">' + n + '</span></div>';


  const scopeParts = [
    dashScope.grp, dashScope.dept, dashScope.cat, dashScope.vendor && 'Vendor ' + dashScope.vendor,
    dashScope.range, dashScope.group, dashScope.puda, dashScope.plan && 'Plan ' + dashScope.plan,
    dashScope.event, dashScope.life && lifestyleLabel(dashScope.life), dashScope.pp && 'Price point ' + dashScope.pp,
  ].filter(Boolean);
  const scopeLine = (scopeParts.length ? scopeParts.join(' · ') + ' · ' : 'All ') + dashInt(R.items) + ' items';

  const actions = dashActions(R);
  const bandT = dashBandTables();
  root.innerHTML =
    '<div class="dash-sticky">' +
    '<div class="dash-hero">' +
      '<div class="dash-hero-line">' +
        '<span class="dash-date">' + dashEsc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) + '</span>' +
        '<h1 class="dash-greet">' + DASH_GREETINGS[dashGreetingIdx](dashEsc(dashName())) + '</h1>' +
        '<p class="dash-sub">' + dashSubtitle() + ' <span class="dash-asof">' + dashEsc(dashAsOfText()) + '.</span>' + (dashHeaderCollapsed ? '' : ' <span class="dash-note">These filters apply to the whole dashboard.</span>') + '</p>' +
      '</div>' +
      '<div class="dash-links">' + (!dashHeaderCollapsed && (dashScopeIsSet() || dashBandPeriod.mode !== '3') ? '<button type="button" class="dash-btn ghost filters-active-btn" id="dashReset">Show everything</button>' : '') + '<a class="dash-btn' + (dashScopeIsSet() ? ' filters-active-btn' : '') + '" href="#products">All Products &rarr;</a><a class="dash-btn ghost' + (dashScopeIsSet() ? ' filters-active-btn' : '') + '" href="#lookup">Item Lookup &rarr;</a>' +
        '<button type="button" class="dash-btn ghost" id="dashHeaderToggle" title="' + (dashHeaderCollapsed ? 'Show the Show me bar and Needs attention tiles' : 'Hide the Show me bar and Needs attention tiles, keep just this line') + '">' + (dashHeaderCollapsed ? 'Expand &#9662;' : 'Collapse &#9652;') + '</button>' +
      '</div></div>' +
    (dashHeaderCollapsed ? '' : dashScopeBar(dashScope, dashVendorAmbiguous, { headless: true, noReset: true }) +
      '<h2 class="dash-h">Needs attention <span>' + dashEsc(scopeLine) + '</span> <span class="dash-note">Click the boxes below to switch between the 4 tables.</span></h2>' + actions.tilesHtml) +
    '</div>' +
    actions.detailHtml +
    '<h2 class="dash-h">How it’s trading <span>last 3 complete months (' + dashEsc(winLabel) + ') vs the 3 before</span></h2>' +
    '<div class="dash-kpis">' +
      kpi('Units sold', dashCompact(R.sold3), delta == null ? 'no prior period' : (delta >= 0 ? '&#9650; ' : '&#9660; ') + Math.abs(delta).toFixed(0) + '% vs the 3 before', delta == null ? '' : (delta >= 0 ? 'up' : 'down')) +
      kpi('Stock cover', cover == null ? '—' : cover.toFixed(1) + ' mo', 'vs ' + typicalLead.toFixed(1) + ' mo typical vendor lead time', cover != null && cover < typicalLead ? 'down' : '') +
      kpi('On order', dashCompact(R.onOrderUnits), dashInt(R.soonUnits) + ' due within 30 days', '') +
      kpi('Late on order', dashCompact(R.lateUnits), dashInt(R.latePOs.length) + ' POs past ETA', R.lateUnits ? 'warn' : '') +
    '</div>' +
    '<div class="dash-grid">' +
      '<section class="dash-card tone-pos"><h3>Rising <span>units vs the 3 months before</span></h3>' + dashMoverTable(R.risers, true, R.risersAll.length) + '</section>' +
      '<section class="dash-card tone-neg"><h3>Falling <span>units vs the 3 months before</span></h3>' + dashMoverTable(R.fallers, false, R.fallersAll.length) + '</section>' +
      '<section class="dash-card tone-stock"><h3>Landing soon <span>next 30 days, ' + dashInt(R.soonUnits) + ' units</span></h3>' +
        (R.soonPOs.length ? '<div class="dash-table-scroll"><table class="dash-table"><thead><tr><th class="l po">PO</th><th class="l vend">Vendor</th><th>Units</th><th>ETA</th></tr></thead><tbody>' +
          R.soonPOs.map(p => '<tr class="dash-pick dash-po" data-po="' + dashEsc(p.po) + '" title="Show the items on this PO"><td class="l po"><b class="mono">' + dashEsc(p.po) + '</b></td><td class="l muted">' + dashEsc(vname(p.vendor)) + '</td><td>' + dashInt(p.units) + '</td><td>' + dashEsc(dashDate(p.eta)) + ' <small>(' + p.in + ' d)</small></td></tr>').join('') + '</tbody></table></div>' +
            '<button type="button" class="dash-btn ghost dash-more" data-list="soon">See all ' + dashInt(R.soonPOs.length) + ' POs (' + dashInt(dashPOCodes(R.soonPOs).size) + ' items) &rarr;</button>'
          : '<p class="dash-empty">No POs due in the next 30 days.</p>') + '</section>' +
      '<section class="dash-card tone-warn"><h3>POs Expired <span>status Pending, created under 15 days ago</span></h3>' +
        (R.expired.length ? '<div class="dash-table-scroll"><table class="dash-table"><thead><tr><th class="l po">PO</th><th class="l vend">Vendor</th><th>Created</th><th>Days</th><th>Units</th></tr></thead><tbody>' +
          R.expired.map(p => '<tr class="dash-pick dash-po" data-po="' + dashEsc(p.po) + '" title="Show the items on this PO"><td class="l po"><b class="mono">' + dashEsc(p.po) + '</b></td><td class="l">' + dashEsc(vcodeName(p.vendor)) + '</td><td>' + dashEsc(dashDate(p.created)) + '</td><td class="bad">' + p.age + ' d</td><td>' + dashInt(p.units) + '</td></tr>').join('') + '</tbody></table></div>' +
            '<button type="button" class="dash-btn ghost dash-more" data-list="expired">See all ' + dashInt(R.expired.length) + ' POs (' + dashInt(dashPOCodes(R.expired).size) + ' items) &rarr;</button>'
          : '<p class="dash-empty">No pending POs created in the last 15 days.</p>') + '</section>' +
      bandT.html +
    '</div>';

  // wiring
  const $ = id => document.getElementById(id);
  root.querySelectorAll('.dash-tile').forEach(b => b.addEventListener('click', () => { dashTab = b.dataset.tab; renderDashboard(); }));
  root.querySelectorAll('.dash-po').forEach(tr => tr.addEventListener('click', () => {
    const p = R.soonPOs.concat(R.expired).find(x => x.po === tr.dataset.po);
    if(p) openGridFocus(p.po, p.codes, null);
  }));
  root.querySelectorAll('.dash-pick:not(.dash-po)').forEach(tr => tr.addEventListener('click', () => {
    dashScope = { ...dashScope, vendor: tr.dataset.vendor }; dashSaveScope();
    dashTab = tr.dataset.goto || 'late';
    renderDashboard();
  }));
  dashWireBands(root, bandT.B, scopeParts.length ? ' – ' + scopeParts.join(' · ') : '');
  root.querySelectorAll('.dash-more').forEach(b => b.addEventListener('click', () => {
    const suffix = scopeParts.length ? ' – ' + scopeParts.join(' · ') : '';
    if(b.dataset.list){
      const soon = b.dataset.list === 'soon';
      openGridFocus((soon ? 'Landing soon' : 'POs Expired') + suffix, dashPOCodes(soon ? R.soonPOs : R.expired), null);
      return;
    }
    const up = b.dataset.movers === 'up', list = up ? R.risersAll : R.fallersAll;
    openGridFocus((up ? 'Rising' : 'Falling') + suffix, list.map(x => x.it['Item Code']), null);
  }));
  // Reorder now's lens (Cover vs Recovery%) and its threshold -- the
  // threshold field uses the same blur + Enter commit pattern as the
  // grid's own "Go to page" number field, not live-as-you-type (a full
  // dashboard recompute on every keystroke would both be wasteful and keep
  // kicking focus out of the field mid-type).
  const reorderModeSeg = $('dashReorderModeSeg');
  if(reorderModeSeg) reorderModeSeg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    dashReorderMode = b.dataset.mode;
    renderDashboard();
  }));
  const reorderMonthsInput = $('dashReorderMonthsInput');
  if(reorderMonthsInput){
    const commitReorderMonths = () => {
      const v = Number(reorderMonthsInput.value);
      dashReorderMonths = v > 0 ? v : 5;
      renderDashboard();
    };
    reorderMonthsInput.addEventListener('blur', commitReorderMonths);
    reorderMonthsInput.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); commitReorderMonths(); } });
  }
  const reorderRecoveryInput = $('dashReorderRecoveryInput');
  if(reorderRecoveryInput){
    const commitReorderRecovery = () => {
      const v = Number(reorderRecoveryInput.value);
      dashReorderRecoveryPct = v >= 0 ? v : 30;
      renderDashboard();
    };
    reorderRecoveryInput.addEventListener('blur', commitReorderRecovery);
    reorderRecoveryInput.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); commitReorderRecovery(); } });
  }
  // Every item (any plan code still shown in the app, ignoring Show me)
  // from the vendors behind the current list.
  const openVendors = $('dashOpenVendors');
  if(openVendors) openVendors.addEventListener('click', () => {
    const c = dashCurrentTab, vs = new Set(c.vendors);
    const codes = ITEMS.filter(it => vs.has(it['Vendor Code'])).map(it => it['Item Code']);
    openGridFocus('All items from ' + dashInt(vs.size) + ' ' + c.title + ' vendors', codes, null);
  });
  const open = $('dashOpenAll');
  if(open) open.addEventListener('click', () => {
    const c = dashCurrentTab;
    openGridFocus(c.title + (scopeParts.length ? ' – ' + scopeParts.join(' · ') : ''), c.codes, c.sort);
  });
  // The whole Show me bar is absent from the DOM when the header's
  // collapsed (see dashHeaderCollapsed above) -- every lookup in this
  // block assumes its field exists, so skip it entirely rather than
  // guarding each one. Without this, the first collapse-triggered
  // re-render throws partway through (e.g. $('dashDept').addEventListener
  // on null) and never reaches the toggle's own re-wiring below it,
  // silently breaking the second click.
  // Show everything also puts the banding period back to the last 3 months --
  // registered first, since the scope bar's own reset handler re-renders.
  const resetBtn = $('dashReset');
  if(resetBtn) resetBtn.addEventListener('click', () => { dashBandPeriod = { mode: '3', from: null, to: null }; });
  if(!dashHeaderCollapsed) dashWireScopeBar(root, renderDashboard, DASH_SLOT);
  const headerToggle = $('dashHeaderToggle');
  if(headerToggle) headerToggle.addEventListener('click', () => { dashHeaderCollapsed = !dashHeaderCollapsed; renderDashboard(); });
}

// Wires a dashScopeBar() rendered inside `root`. Shared by the Dashboard and
// PO Data pages, each with its own filter state (`slot`: DASH_SLOT or
// PODATA_SLOT). Both keep their markup in the DOM at once, so lookups are
// scoped to root rather than document-wide (the ids repeat).
function dashWireScopeBar(root, rerender, slot){
  const $ = id => root.querySelector('#' + id);
  const change = () => {
    const raw = $('dashVendor').value;
    const lookup = vendorNameLookup(raw);
    let vendor = '';
    if(lookup.type === 'code') vendor = raw.trim();
    else if(lookup.type === 'resolved'){ vendor = lookup.code; $('dashVendor').value = vendor; }   // box shows the code, never the typed name
    else if(lookup.type === 'unmatched') vendor = raw.trim();   // leave as typed -- filters to nothing, same as before
    // 'ambiguous' and 'empty' both leave vendor === '' (don't guess which of several matches was meant)
    slot.setAmb(lookup.type === 'ambiguous' ? { raw, codes: lookup.codes } : null);
    slot.set({
      grp: slot.get().grp || '', dept: $('dashDept').value, cat: $('dashCat').value, vendor,
      range: $('dashRange').value.trim(), group: $('dashGroup').value.trim(),
      puda: $('dashPuda').value.trim(),
      plan: $('dashPlan') ? $('dashPlan').value : slot.get().plan,
      event: $('dashEvent').value, life: $('dashLife').value, pp: $('dashPP').value,
    });
    rerender();
  };
  ['dashDept', 'dashCat', 'dashPlan', 'dashEvent', 'dashLife', 'dashPP'].forEach(id => { if($(id)) $(id).addEventListener('change', change); });
  root.querySelectorAll('#dashGrpSeg button').forEach(b => b.addEventListener('click', e => {
    e.preventDefault();
    slot.set({ ...slot.get(), grp: b.dataset.g });
    rerender();
  }));
  const planBtn = $('dashPlanBtn');
  if(planBtn){
    dashPlanRerender = rerender;
    const setPlan = plan => { slot.set({ ...slot.get(), plan }); rerender(); };
    planBtn.addEventListener('click', e => { e.stopPropagation(); dashPlanOpen = !dashPlanOpen; rerender(); });
    const panel = $('dashPlanPanel');
    if(panel){
      panel.addEventListener('click', e => e.stopPropagation());
      panel.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', () =>
        setPlan([...panel.querySelectorAll('input:checked')].map(x => x.value))));
      const clear = $('dashPlanClear');
      if(clear) clear.addEventListener('click', () => setPlan([]));
    }
  }
  root.querySelectorAll('.dash-vendor-opt').forEach(btn => btn.addEventListener('click', () => {
    $('dashVendor').value = btn.dataset.code;
    change();
  }));
  // The 4 free-text fields (esp. Vendor code, since it silently rewrites
  // whatever you typed into a code) can't rely on 'change' alone -- a
  // script-set value doesn't always carry the "dirty" flag browsers use to
  // decide whether blur should fire it, and datalist-backed inputs are
  // inconsistent about this across browsers. blur + Enter fire regardless,
  // same as the From/To date fields already do above.
  ['dashVendor', 'dashRange', 'dashGroup', 'dashPuda'].forEach(id => {
    const el = $(id);
    el.addEventListener('blur', change);
    // Picking a suggestion applies it straight away (typing still waits for
    // blur/Enter) -- the browser marks a datalist pick as replacement text.
    if(id !== 'dashVendor') el.addEventListener('input', e => { if(e.inputType === 'insertReplacementText' || !e.inputType) change(); });
    el.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); change(); } });
  });
  // Live, as-you-type narrowing for Vendor code -- while a typed name is
  // still ambiguous or matches nothing yet, just refresh the floating
  // options list in place (cheap -- renderDashboard() rebuilds the whole
  // page, which would otherwise drop focus out of the field on every
  // keystroke). Only once it resolves to one vendor or a real code does it
  // commit via the full change()/re-render, same as blur always did, with
  // its focus/caret restored right after (see refocusCaret() in app.js).
  (() => {
    const vendorInput = $('dashVendor');
    vendorInput.addEventListener('input', () => {
      const raw = vendorInput.value;
      const lookup = vendorNameLookup(raw);
      if(lookup.type === 'ambiguous' || lookup.type === 'empty' || lookup.type === 'unmatched'){
        slot.setAmb(lookup.type === 'ambiguous' ? { raw, codes: lookup.codes } : null);
        vendorInput.classList.toggle('dash-vendor-ambiguous', !!slot.getAmb());
        vendorInput.title = dashVendorAmbiguousTip(slot.getAmb());
        const field = vendorInput.closest('.dash-vendor-field');
        const old = field.querySelector('.dash-vendor-options');
        if(old) old.remove();
        field.insertAdjacentHTML('beforeend', dashVendorOptionsHtml(slot.getAmb()));
        field.querySelectorAll('.dash-vendor-opt').forEach(btn => btn.addEventListener('click', () => {
          vendorInput.value = btn.dataset.code;
          change();
        }));
      } else {
        const pos = vendorInput.selectionStart;
        change();
        const el = $('dashVendor');
        if(el){ el.focus(); try { el.setSelectionRange(pos, pos); } catch(e){} }
      }
    });
  })();
  const reset = $('dashReset');
  if(reset) reset.addEventListener('click', () => { slot.set({ ...DASH_SCOPE_DEFAULTS }); rerender(); });
  root.querySelectorAll('.dash-chips .chip[data-k]').forEach(chip => chip.addEventListener('click', () => {
    const k = chip.dataset.k, cur = slot.get()[k];
    if(k === 'vendor') slot.setAmb(null);
    slot.set({ ...slot.get(), [k]: Array.isArray(cur) ? cur.filter(v => v !== chip.dataset.v) : '' });
    rerender();
  }));
}
// Restore whatever the URL points at -- here rather than in app.js because
// this is the last script to load, so every view's renderer now exists.
applyRoute(routeFromHash());
// The launcher may already be up showing "Loading data…" -- fill its counts.
fillPrimaryStats();
