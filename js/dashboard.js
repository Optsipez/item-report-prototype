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
     landing soon, which vendors to chase, units due by month, branch sales.

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
  dashScope = null; dashTab = null;      // the next person gets their own remembered scope
}

const DAY = 86400000;
let dashTab = null;                // which action list is open
let dashScope = null;              // { dept, cat, vendor } — loaded per employee
let dashCurrentTab = null;
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
const dashLink = code => 'href="#item=' + encodeURIComponent(code) + '"';

/* ---------- scope (per employee, remembered in this browser) ---------- */
// Same seven fields the All Products filter panel offers (FILTER_FIELD_MAP
// in app.js), so the dashboard can be scoped by anything All Products can
// be filtered by. dept/cat/vendor came first; range/group/puda/plan match
// it up to full parity.
const DASH_SCOPE_DEFAULTS = { dept: '', cat: '', vendor: '', range: '', group: '', puda: '', plan: '' };
function dashScopeKey(){ return 'dashScope:' + (CURRENT_EMPLOYEE_ID || 'anon'); }
function dashLoadScope(){
  let s = null;
  try { s = JSON.parse(localStorage.getItem(dashScopeKey()) || 'null'); } catch(e){}
  dashScope = { ...DASH_SCOPE_DEFAULTS, ...(s || {}) };
}
function dashSaveScope(){ try { localStorage.setItem(dashScopeKey(), JSON.stringify(dashScope)); } catch(e){} }
const dashScopeIsSet = () => Object.keys(DASH_SCOPE_DEFAULTS).some(k => dashScope[k]);
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
function dashVendorAmbiguousTip(){
  if(!dashVendorAmbiguous) return '';
  const showNames = canSeeVendorName();
  const shown = dashVendorAmbiguous.codes.slice(0, 8);
  const list = shown.map(c => {
    if(!showNames) return c;
    const it = ITEMS.find(i => i['Vendor Code'] === c);
    return it ? c + ' (' + it['Vendor Name'] + ')' : c;
  }).join(', ');
  const more = dashVendorAmbiguous.codes.length > shown.length ? ', +' + (dashVendorAmbiguous.codes.length - shown.length) + ' more' : '';
  return 'Matches ' + dashVendorAmbiguous.codes.length + ' vendors: ' + list + more + '. Type the exact code, or more letters to narrow it down.';
}
// The visible list under the box -- the tooltip above is easy to miss since
// nothing prompts you to hover; this is the actual click-to-pick UI.
function dashVendorOptionsHtml(){
  if(!dashVendorAmbiguous) return '';
  const showNames = canSeeVendorName();
  const shown = dashVendorAmbiguous.codes.slice(0, 8);
  const more = dashVendorAmbiguous.codes.length - shown.length;
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
function dashItemInScope(it, scope){
  scope = scope || dashScope;
  const planVal = String(it['Current Plan Code'] || '').toUpperCase();
  const planSel = Array.isArray(scope.plan) ? scope.plan.map(p => String(p).toUpperCase()) : (scope.plan ? String(scope.plan).toUpperCase() : scope.plan);
  return scopeFieldMatch(it['Department Desc'], scope.dept) &&
    scopeFieldMatch(it['Category'], scope.cat) &&
    (!scope.vendor || String(it['Vendor Code']).toUpperCase() === scope.vendor.toUpperCase()) &&
    (!scope.range || it['Range Name'] === scope.range) &&
    (!scope.group || it['Group Desc'] === scope.group) &&
    (!scope.puda || it['PUDA Desc'] === scope.puda) &&
    scopeFieldMatch(planVal, planSel);
}
function dashLineInScope(l){   // a PO line: [po, item, desc, qty, eta, vendor, dept, cat]
  if(dashScope.range || dashScope.group || dashScope.puda || dashScope.plan){
    const it = DASH_ITEM_BY_CODE[l[1]];
    if(!it) return false;
    if(dashScope.range && it['Range Name'] !== dashScope.range) return false;
    if(dashScope.group && it['Group Desc'] !== dashScope.group) return false;
    if(dashScope.puda && it['PUDA Desc'] !== dashScope.puda) return false;
    if(dashScope.plan && String(it['Current Plan Code']).toUpperCase() !== dashScope.plan.toUpperCase()) return false;
  }
  return (!dashScope.dept || l[6] === dashScope.dept) &&
    (!dashScope.cat || l[7] === dashScope.cat) &&
    (!dashScope.vendor || String(l[5]).toUpperCase() === dashScope.vendor.toUpperCase());
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
/* Reorder / Out of stock only look at these Plan Codes (CPC); the rest never show. */
const DASH_PLAN_CODES = new Set(['A', 'K', 'C', 'P']);
const dashPlan = it => String(it['Current Plan Code'] || '').trim().toUpperCase();
const dashPlanCell = it => '<td class="plan-cell dash-cpc">' + dashEsc(dashPlan(it)) + '</td>';

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
    const age = soh > 0 ? stkAgeFor(it) : null;
    if(age && age.sno >= 3 && (rate === 0 || soh / rate > 12)){
      const tied = soh * cost;
      R.over.push({ it, soh, cover: rate > 0 ? soh / rate : null, age: age.label, tied, price, margin: marginPct(price, cost) });
      R.overValue += tied;
    }
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
  PO_LINES.filter(dashLineInScope).forEach(l => {
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
  // vendors with the most late stock — who to chase
  const chase = {};
  R.latePOs.forEach(p => {
    const c = chase[p.vendor] = chase[p.vendor] || { vendor: p.vendor, pos: 0, units: 0, worst: 0 };
    c.pos++; c.units += p.units; c.worst = Math.max(c.worst, p.late);
  });
  R.chase = Object.values(chase).sort((a, b) => b.units - a.units);
  // units due per month, from the data date forward, next 6 months
  const start = dashAsOf();
  R.inbound = [];
  for(let i = 0; i < 6; i++){
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    R.inbound.push({ label: MONTHS[d.getMonth()] + "'" + String(d.getFullYear()).slice(-2), key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), units: 0 });
  }
  pos.forEach(p => { const b = R.inbound.find(x => x.key === p.eta.slice(0, 7)); if(b) b.units += p.units; });
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
function dashColumns(items){   // vertical bars: [{label, value, partial, nodata, title, color}]
  const max = Math.max(1, ...items.map(x => x.value));
  return '<div class="dash-trend">' + items.map(x =>
    '<div class="dash-trend-col' + (x.nodata ? ' nodata' : '') + (x.partial ? ' partial' : '') + '" title="' + dashEsc(x.title || x.label) + '">' +
      '<span class="dash-trend-v">' + (x.nodata ? '' : dashCompact(x.value)) + '</span>' +
      '<span class="dash-trend-bar"><span style="height:' + (x.nodata ? 0 : Math.max(3, x.value / max * 100)).toFixed(1) + '%;' + (x.color ? 'background:' + x.color : '') + '"></span></span>' +
      '<span class="dash-trend-k">' + dashEsc(x.label) + (x.partial ? '<small>to date</small>' : '') + '</span></div>').join('') + '</div>';
}
const dashItemCell = it => '<td class="l"><a ' + dashLink(it['Item Code']) + '><b>' + dashEsc(it['Item Code']) + '</b> ' + dashEsc(it['Description']) + '</a></td>';

/* ---------- the four action lists ---------- */
function dashActions(R){
  const showVendor = canSeeVendorName();
  const vname = c => showVendor ? (R.vendorName[c] || c) : c;
  const poTable = rows => '<table class="dash-table"><thead><tr><th class="l po">PO</th><th class="l vend">Vendor</th><th>Lines</th><th>Units</th><th>ETA</th><th>Late by</th></tr></thead><tbody>' +
    rows.map(p =>
      '<tr><td class="l po"><b class="mono">' + dashEsc(p.po) + '</b></td><td class="l muted" title="' + dashEsc(vname(p.vendor)) + '">' + dashEsc(vname(p.vendor)) + '</td>' +
      '<td>' + p.lines + '</td><td>' + dashInt(p.units) + '</td><td>' + dashEsc(dashDate(p.eta)) + '</td><td class="bad">' + p.late + ' d</td></tr>').join('') + '</tbody></table>';

  const lateCodes = new Set(); R.latePOs.forEach(p => p.codes.forEach(c => lateCodes.add(c)));
  const tabs = [
    { id: 'reorder', title: 'Reorder now', n: R.reorder.length, sub: R.reorderVendors.length + ' vendors \u00b7 AED ' + dashCompact(R.reorderAtRisk) + '/mo sales at risk', tone: 'warn',
      note: dashReorderMode === 'recovery'
        ? 'Selling items (Plan Codes A, K, C and P only) with Recovery % (sold since the last receipt ÷ (sold since + SOH)) over ' + dashReorderRecoveryPct + '% (adjustable below; 30 is the default). Ranked by Recovery%, highest first. Buyers order per vendor; click a vendor to open its items in All Products.'
        : 'Selling items (Plan Codes A, K, C and P only) whose combined cover — stock (SM) plus what’s already on order (PM), both in months at the item’s own best-average sales pace — is under ' + dashReorderMonths + ' months (adjustable below; 5 is the default). Ranked by combined cover, least first. Buyers order per vendor; click a vendor to open its items in All Products.',
      table: '<table class="dash-table"><thead><tr><th class="l item">Item</th><th>CPC</th><th class="l vend">Vendor</th><th>' + (dashReorderMode === 'recovery' ? 'Recovery%' : 'Cover') + '</th><th>Sales at risk / mo</th></tr></thead><tbody>' +
          R.reorder.map(x => '<tr>' + dashItemCell(x.it) + dashPlanCell(x.it) + '<td class="l muted">' + dashEsc(vname(x.it['Vendor Code'])) + '</td><td>' + (dashReorderMode === 'recovery' ? (x.recovery == null ? '—' : Math.round(x.recovery) + '%') : (x.sm + x.pm).toFixed(1) + ' mo') + '</td><td><b>AED ' + dashCompact(x.atRisk) + '</b></td></tr>').join('') + '</tbody></table>',
      codes: R.reorder.map(x => x.it['Item Code']), sort: null },
    { id: 'oos', title: 'Out of stock, no PO', n: R.oos.length, sub: 'selling, none on hand, nothing on order', tone: 'bad',
      note: 'Sold in the last 3 months, no stock, and no open PO: the items losing sales right now. Plan Codes A, K, C and P only.',
      table: '<table class="dash-table"><thead><tr><th class="l item">Item</th><th>CPC</th><th class="l vend">Vendor</th><th>Sold / mo</th><th>Sold (3 mo)</th><th>Lead time</th></tr></thead><tbody>' +
        R.oos.map(x => '<tr>' + dashItemCell(x.it) + dashPlanCell(x.it) + '<td class="l muted">' + dashEsc(vname(x.it['Vendor Code'])) + '</td><td>' + x.rate.toFixed(1) + '</td><td>' + dashInt(x.s3) + '</td><td>' + dashInt(dashLeadDays(x.it['Vendor Code'])) + ' d</td></tr>').join('') + '</tbody></table>',
      codes: R.oos.map(x => x.it['Item Code']), sort: null },
    { id: 'late', title: 'Late POs', n: R.latePOs.length, sub: dashInt(R.lateUnits) + ' units past ETA', tone: 'bad',
      note: 'Open POs whose ETA was before ' + dashDate(DATA_AS_OF) + ' (the data date) and are still not received.',
      table: poTable(R.latePOs), codes: [...lateCodes], sort: null },
    { id: 'over', title: 'Overstock / slow', n: R.over.length, sub: 'AED ' + dashCompact(R.overValue) + ' tied up', tone: '',
      note: 'Stock 6+ months old with over 12 months of cover at the recent pace, or no sales at all. Largest first. Margin = (price − landed cost) ÷ price at today’s price, so it is also roughly how deep a markdown can go before selling at cost.',
      table: '<table class="dash-table"><thead><tr><th class="l item">Item</th><th>Stock</th><th>Cover</th><th>Age</th><th>Tied up (AED)</th><th>Price</th><th>Margin</th></tr></thead><tbody>' +
        R.over.slice(0, 10).map(x => '<tr>' + dashItemCell(x.it) + '<td>' + dashInt(x.soh) + '</td><td>' + (x.cover == null ? 'no sales' : x.cover.toFixed(0) + ' mo') + '</td><td>' + dashEsc(x.age) + '</td><td><b>' + dashInt(x.tied) + '</b></td><td>' + (x.price ? dashInt(x.price) : '—') + '</td><td class="' + (x.margin != null && x.margin < 0.15 ? 'bad' : '') + '">' + (x.margin == null ? '—' : Math.round(x.margin * 100) + '%') + '</td></tr>').join('') + '</tbody></table>',
      codes: R.over.map(x => x.it['Item Code']), sort: [{ field: 'SOH', dir: 'desc' }] },
  ];
  if(!tabs.some(t => t.id === dashTab)) dashTab = (tabs.find(t => t.n > 0) || tabs[0]).id;
  const cur = tabs.find(t => t.id === dashTab);
  dashCurrentTab = cur;
  return '<div class="dash-tiles">' + tabs.map(t =>
      '<button type="button" class="dash-tile' + (t.id === dashTab ? ' on' : '') + (t.n && t.tone ? ' ' + t.tone : '') + '" data-tab="' + t.id + '">' +
        '<span class="dash-tile-k">' + t.title + '</span><span class="dash-tile-v">' + dashInt(t.n) + '</span><span class="dash-tile-n">' + dashEsc(t.sub) + '</span></button>').join('') + '</div>' +
    '<section class="dash-card dash-detail"><div class="dash-detail-head"><h3>' + cur.title + ' <span>' + (cur.id === 'reorder' ? dashInt(R.reorderVendors.length) + ' vendors, ' + dashInt(cur.n) + ' items' : dashInt(cur.n) + (cur.id === 'late' ? ' POs' : ' items') + (cur.id === 'over' && cur.n > 10 ? ', top 10 shown' : '')) + '</span></h3>' +
      (cur.id === 'reorder' ? '<div class="dash-seg" id="dashReorderModeSeg">' +
          '<button type="button" data-mode="cover" class="' + (dashReorderMode === 'cover' ? 'on' : '') + '">Cover</button>' +
          '<button type="button" data-mode="recovery" class="' + (dashReorderMode === 'recovery' ? 'on' : '') + '">Recovery%</button>' +
        '</div>' +
        (dashReorderMode === 'recovery'
          ? '<label class="page-jump" title="Items qualify when Recovery% is over this. Default is 30.">Over<input type="number" id="dashReorderRecoveryInput" min="0" max="100" step="1" value="' + dashReorderRecoveryPct + '">%</label>'
          : '<label class="page-jump" title="Items qualify when combined SM+PM cover is under this many months. Default is 5.">Under<input type="number" id="dashReorderMonthsInput" min="0.5" step="0.5" value="' + dashReorderMonths + '">months</label>') : '') +
      (cur.n ? '<button type="button" class="dash-btn" id="dashOpenAll">Open ' + (cur.id === 'late' ? 'their ' + dashInt(cur.codes.length) + ' items' : 'all ' + dashInt(cur.n)) + ' in All Products &rarr;</button>' : '') + '</div>' +
      '<p class="dash-note">' + dashEsc(cur.note) + '</p>' +
      (cur.n ? (cur.id === 'over' ? cur.table : '<div class="dash-table-scroll">' + cur.table + '</div>') : '<p class="dash-empty">Nothing here for this selection. Good.</p>') + '</section>';
}

const dashPOCodes = pos => { const s = new Set(); pos.forEach(p => p.codes.forEach(c => s.add(c))); return s; };
function dashMoverTable(rows, up, total){
  if(!rows.length) return '<p class="dash-empty">No big movers.</p>';
  return '<table class="dash-table"><thead><tr><th class="l item">Item</th><th>Before</th><th>Now</th><th>Change</th></tr></thead><tbody>' +
    rows.map(x => '<tr>' + dashItemCell(x.it) + '<td>' + dashInt(x.p3) + '</td><td>' + dashInt(x.s3) + '</td><td class="' + (up ? 'good' : 'bad') + '">' + (up ? '+' : '') + dashInt(x.d) + '</td></tr>').join('') + '</tbody></table>' +
    '<button type="button" class="dash-btn ghost dash-more" data-movers="' + (up ? 'up' : 'down') + '">See all ' + dashInt(total) + ' ' + (up ? 'rising' : 'falling') + ' items &rarr;</button>';
}

function dashScopeBar(){
  const uniq = f => [...new Set(ITEMS.map(i => i[f]).filter(Boolean))].sort();
  const opt = (arr, cur) => '<option value="">All</option>' + arr.map(v => '<option' + (v === cur ? ' selected' : '') + '>' + dashEsc(v) + '</option>').join('');
  // Range Name / Group Desc / PUDA Desc run into the hundreds or thousands of
  // values (matching FILTER_SEARCHABLE in app.js) — a plain <select> with
  // that many options is unusable, so these get the same searchable
  // text+datalist combo as Vendor code instead of a dropdown list.
  const search = (id, field, label) => '<label>' + label + '<input id="' + id + '" list="' + id + 'List" value="' + dashEsc(dashScope[field]) + '" placeholder="All" autocomplete="off"></label>' +
    '<datalist id="' + id + 'List">' + uniq(field === 'range' ? 'Range Name' : field === 'group' ? 'Group Desc' : 'PUDA Desc').map(v => '<option value="' + dashEsc(v) + '">').join('') + '</datalist>';
  return '<div class="dash-scope"><div class="dash-scope-head"><span class="dash-scope-t">Show me</span>' +
    (dashScopeIsSet() ? '<button type="button" class="dash-btn ghost filters-active-btn" id="dashReset">Show everything</button>' : '') + '</div>' +
    '<label>Department<select id="dashDept">' + opt(uniq('Department Desc'), dashScope.dept) + '</select></label>' +
    '<label>Category<select id="dashCat">' + opt(uniq('Category'), dashScope.cat) + '</select></label>' +
    '<label class="dash-vendor-field">Vendor code<input id="dashVendor" list="dashVendorList" class="' + (dashVendorAmbiguous ? 'dash-vendor-ambiguous' : '') + '" value="' +
      dashEsc(dashVendorAmbiguous ? dashVendorAmbiguous.raw : dashScope.vendor) + '" title="' + dashEsc(dashVendorAmbiguousTip()) + '" placeholder="All" autocomplete="off">' +
      dashVendorOptionsHtml() + '</label>' +
    '<datalist id="dashVendorList">' + uniq('Vendor Code').map(v => '<option value="' + dashEsc(v) + '">').join('') + '</datalist>' +
    search('dashRange', 'range', 'Range Name') +
    search('dashGroup', 'group', 'Group Desc') +
    search('dashPuda', 'puda', 'PUDA Desc') +
    '<label>Plan<select id="dashPlan">' + opt(uniq('Current Plan Code'), dashScope.plan) + '</select></label>' +
    '</div>';
}

function renderDashboard(){
  const root = document.getElementById('dashRoot');
  if(!root) return;
  if(!dashScope) dashLoadScope();
  const R = dashCompute(), W = R.W;
  const showVendor = canSeeVendorName();
  const vname = c => showVendor ? (R.vendorName[c] || c) : c;
  const delta = R.prior3 > 0 ? (R.sold3 - R.prior3) / R.prior3 * 100 : null;
  const cover = R.sold3 > 0 ? R.soh / (R.sold3 / 3) : null;
  const typicalLead = dashDaysToMonths(LEAD_TIMES.overall);
  const winLabel = monthColLabel(W.rate[0]) + '–' + monthColLabel(W.rate[2]);
  const kpi = (k, v, n, tone) => '<div class="dash-kpi' + (tone ? ' ' + tone : '') + '"><span class="dash-kpi-k">' + k + '</span><span class="dash-kpi-v">' + v + '</span><span class="dash-kpi-n">' + n + '</span></div>';

  const inbound = R.inbound.map(b => ({ label: b.label, value: b.units, color: 'var(--stock)', title: b.label + ': ' + dashInt(b.units) + ' units due' }));

  const scopeParts = [
    dashScope.dept, dashScope.cat, dashScope.vendor && 'Vendor ' + dashScope.vendor,
    dashScope.range, dashScope.group, dashScope.puda, dashScope.plan && 'Plan ' + dashScope.plan,
  ].filter(Boolean);
  const scopeLine = (scopeParts.length ? scopeParts.join(' · ') + ' · ' : 'All ') + dashInt(R.items) + ' items';

  root.innerHTML =
    '<div class="dash-hero"><div>' +
      '<div class="dash-date">' + dashEsc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) + '</div>' +
      '<h1 class="dash-greet">' + DASH_GREETINGS[dashGreetingIdx](dashEsc(dashName())) + '</h1>' +
      '<p class="dash-sub">' + dashSubtitle() + ' <span class="dash-asof">Data as of ' + dashEsc(dashDate(DATA_AS_OF)) + '.</span></p></div>' +
      '<div class="dash-links"><a class="dash-btn' + (dashScopeIsSet() ? ' filters-active-btn' : '') + '" href="#products">All Products &rarr;</a><a class="dash-btn ghost' + (dashScopeIsSet() ? ' filters-active-btn' : '') + '" href="#lookup">Item Lookup &rarr;</a></div></div>' +
    dashScopeBar() +
    '<h2 class="dash-h">Needs attention <span>' + dashEsc(scopeLine) + '</span></h2>' + dashActions(R) +
    '<h2 class="dash-h">How it’s trading <span>last 3 complete months (' + dashEsc(winLabel) + ') vs the 3 before</span></h2>' +
    '<div class="dash-kpis">' +
      kpi('Units sold', dashCompact(R.sold3), delta == null ? 'no prior period' : (delta >= 0 ? '&#9650; ' : '&#9660; ') + Math.abs(delta).toFixed(0) + '% vs the 3 before', delta == null ? '' : (delta >= 0 ? 'up' : 'down')) +
      kpi('Stock cover', cover == null ? '—' : cover.toFixed(1) + ' mo', 'vs ' + typicalLead.toFixed(1) + ' mo typical vendor lead time', cover != null && cover < typicalLead ? 'down' : '') +
      kpi('On order', dashCompact(R.onOrderUnits), dashInt(R.soonUnits) + ' due within 30 days', '') +
      kpi('Late on order', dashCompact(R.lateUnits), dashInt(R.latePOs.length) + ' POs past ETA', R.lateUnits ? 'warn' : '') +
    '</div>' +
    '<div class="dash-grid">' +
      '<section class="dash-card"><h3>Rising <span>units vs the 3 months before</span></h3>' + dashMoverTable(R.risers, true, R.risersAll.length) + '</section>' +
      '<section class="dash-card"><h3>Falling <span>units vs the 3 months before</span></h3>' + dashMoverTable(R.fallers, false, R.fallersAll.length) + '</section>' +
      '<section class="dash-card"><h3>Landing soon <span>next 30 days, ' + dashInt(R.soonUnits) + ' units</span></h3>' +
        (R.soonPOs.length ? '<div class="dash-table-scroll"><table class="dash-table"><thead><tr><th class="l po">PO</th><th class="l vend">Vendor</th><th>Units</th><th>ETA</th></tr></thead><tbody>' +
          R.soonPOs.map(p => '<tr class="dash-pick dash-po" data-po="' + dashEsc(p.po) + '" title="Show the items on this PO"><td class="l po"><b class="mono">' + dashEsc(p.po) + '</b></td><td class="l muted">' + dashEsc(vname(p.vendor)) + '</td><td>' + dashInt(p.units) + '</td><td>' + dashEsc(dashDate(p.eta)) + ' <small>(' + p.in + ' d)</small></td></tr>').join('') + '</tbody></table></div>' +
            '<button type="button" class="dash-btn ghost dash-more" data-list="soon">See all ' + dashInt(R.soonPOs.length) + ' POs (' + dashInt(dashPOCodes(R.soonPOs).size) + ' items) &rarr;</button>'
          : '<p class="dash-empty">No POs due in the next 30 days.</p>') + '</section>' +
      '<section class="dash-card"><h3>Vendors to chase <span>most late units, click to filter</span></h3>' +
        (R.chase.length ? '<div class="dash-table-scroll"><table class="dash-table"><thead><tr><th class="l vend">Vendor</th><th>Late POs</th><th>Late units</th><th>Worst</th><th>Usual lead</th></tr></thead><tbody>' +
          R.chase.map(c => '<tr class="dash-pick" data-vendor="' + dashEsc(c.vendor) + '" data-goto="late" title="Show only this vendor"><td class="l"><b>' + dashEsc(vname(c.vendor)) + '</b></td><td>' + c.pos + '</td><td>' + dashInt(c.units) + '</td><td class="bad">' + c.worst + ' d</td><td>' + dashInt(dashLeadDays(c.vendor)) + ' d</td></tr>').join('') + '</tbody></table></div>' +
            '<button type="button" class="dash-btn ghost dash-more" data-list="chase">See all ' + dashInt(R.chase.length) + ' vendors (' + dashInt(dashPOCodes(R.latePOs).size) + ' items) &rarr;</button>'
          : '<p class="dash-empty">No late POs. Good.</p>') + '</section>' +
      '<section class="dash-card"><h3>Units due by month <span>all open POs</span></h3>' + dashColumns(inbound) + '</section>' +
    '</div>';

  // wiring
  const $ = id => document.getElementById(id);
  root.querySelectorAll('.dash-tile').forEach(b => b.addEventListener('click', () => { dashTab = b.dataset.tab; renderDashboard(); }));
  root.querySelectorAll('.dash-po').forEach(tr => tr.addEventListener('click', () => {
    const p = R.soonPOs.find(x => x.po === tr.dataset.po);
    if(p) openGridFocus(p.po, p.codes, null);
  }));
  root.querySelectorAll('.dash-pick:not(.dash-po)').forEach(tr => tr.addEventListener('click', () => {
    dashScope = { ...dashScope, vendor: tr.dataset.vendor }; dashSaveScope();
    dashTab = tr.dataset.goto || 'late';
    renderDashboard();
  }));
  root.querySelectorAll('.dash-more').forEach(b => b.addEventListener('click', () => {
    const suffix = scopeParts.length ? ' – ' + scopeParts.join(' · ') : '';
    if(b.dataset.list){
      const soon = b.dataset.list === 'soon';
      openGridFocus((soon ? 'Landing soon' : 'Late vendors') + suffix, dashPOCodes(soon ? R.soonPOs : R.latePOs), null);
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
  const open = $('dashOpenAll');
  if(open) open.addEventListener('click', () => {
    const c = dashCurrentTab;
    openGridFocus(c.title + (scopeParts.length ? ' – ' + scopeParts.join(' · ') : ''), c.codes, c.sort);
  });
  const change = () => {
    const raw = $('dashVendor').value;
    const lookup = vendorNameLookup(raw);
    let vendor = '';
    if(lookup.type === 'code') vendor = raw.trim();
    else if(lookup.type === 'resolved'){ vendor = lookup.code; $('dashVendor').value = vendor; }   // box shows the code, never the typed name
    else if(lookup.type === 'unmatched') vendor = raw.trim();   // leave as typed -- filters to nothing, same as before
    // 'ambiguous' and 'empty' both leave vendor === '' (don't guess which of several matches was meant)
    dashVendorAmbiguous = lookup.type === 'ambiguous' ? { raw, codes: lookup.codes } : null;
    dashScope = {
      dept: $('dashDept').value, cat: $('dashCat').value, vendor,
      range: $('dashRange').value.trim(), group: $('dashGroup').value.trim(),
      puda: $('dashPuda').value.trim(), plan: $('dashPlan').value,
    };
    dashSaveScope(); renderDashboard();
  };
  ['dashDept', 'dashCat', 'dashPlan'].forEach(id => $(id).addEventListener('change', change));
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
        dashVendorAmbiguous = lookup.type === 'ambiguous' ? { raw, codes: lookup.codes } : null;
        vendorInput.classList.toggle('dash-vendor-ambiguous', !!dashVendorAmbiguous);
        vendorInput.title = dashVendorAmbiguousTip();
        const field = vendorInput.closest('.dash-vendor-field');
        const old = field.querySelector('.dash-vendor-options');
        if(old) old.remove();
        field.insertAdjacentHTML('beforeend', dashVendorOptionsHtml());
        field.querySelectorAll('.dash-vendor-opt').forEach(btn => btn.addEventListener('click', () => {
          vendorInput.value = btn.dataset.code;
          change();
        }));
      } else {
        const pos = vendorInput.selectionStart;
        change();
        refocusCaret('dashVendor', pos);
      }
    });
  })();
  const reset = $('dashReset');
  if(reset) reset.addEventListener('click', () => { dashScope = { ...DASH_SCOPE_DEFAULTS }; dashSaveScope(); renderDashboard(); });
}
// app.js can run its first route before this file has loaded; cover that.
if(document.getElementById('viewDash') && document.getElementById('viewDash').classList.contains('active')) renderDashboard();
