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
const DASH_BUFFER_MONTHS = 1;      // safety stock on top of the lead time when suggesting a quantity
let dashTab = null;                // which action list is open
let dashScope = null;              // { dept, cat, vendor } — loaded per employee
let dashCurrentTab = null;
let dashReorderView = 'vendor';   // 'vendor' (who to order from) or 'item'

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
function dashScopeKey(){ return 'dashScope:' + (CURRENT_EMPLOYEE_ID || 'anon'); }
function dashLoadScope(){
  let s = null;
  try { s = JSON.parse(localStorage.getItem(dashScopeKey()) || 'null'); } catch(e){}
  dashScope = { dept: '', cat: '', vendor: '', ...(s || {}) };
}
function dashSaveScope(){ try { localStorage.setItem(dashScopeKey(), JSON.stringify(dashScope)); } catch(e){} }
const dashScopeIsSet = () => !!(dashScope.dept || dashScope.cat || dashScope.vendor);
function dashItemInScope(it){
  return (!dashScope.dept || it['Department Desc'] === dashScope.dept) &&
    (!dashScope.cat || it['Category'] === dashScope.cat) &&
    (!dashScope.vendor || String(it['Vendor Code']).toUpperCase() === dashScope.vendor.toUpperCase());
}
function dashLineInScope(l){   // a PO line: [po, item, desc, qty, eta, vendor, dept, cat]
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
    if(rate > 0){
      if(sohRaw <= 0 && po <= 0) R.oos.push({ it, rate, s3 });
      else {
        // Runs out before a fresh order could land? Stock + what's already on order,
        // against the vendor's real lead time.
        const leadDays = dashLeadDays(it['Vendor Code']), leadMo = dashDaysToMonths(leadDays);
        const coverPO = (soh + po) / rate;
        if(coverPO < leadMo){
          R.reorder.push({ it, rate, soh, po, coverPO, leadDays, atRisk: rate * price,
            order: rate * (leadMo + DASH_BUFFER_MONTHS) - (soh + po) });
        }
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
  R.reorder.sort((a, b) => b.atRisk - a.atRisk);
  // Buyers place orders per vendor, so also group the reorder list that way.
  const rv = {};
  R.reorder.forEach(x => {
    const v = x.it['Vendor Code'];
    const g = rv[v] = rv[v] || { vendor: v, items: 0, atRisk: 0, units: 0, leadDays: x.leadDays };
    g.items++; g.atRisk += x.atRisk; g.units += Math.max(0, x.order);
  });
  R.reorderVendors = Object.values(rv).sort((a, b) => b.atRisk - a.atRisk);
  R.reorderAtRisk = R.reorder.reduce((a, x) => a + x.atRisk, 0);
  R.oos.sort((a, b) => b.rate - a.rate);
  R.over.sort((a, b) => b.tied - a.tied);
  R.risers = R.movers.filter(x => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 5);
  R.fallers = R.movers.filter(x => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 5);
  R.risersAll = R.movers.filter(x => x.d > 0).sort((a, b) => b.d - a.d);
  R.fallersAll = R.movers.filter(x => x.d < 0).sort((a, b) => a.d - b.d);

  // branch sales over the last 12 complete months, for items in scope
  Object.keys(BRANCH_MONTHLY_SOLD_BY_ITEM).forEach(code => {
    if(!R.codes.has(code)) return;
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
    rows.slice(0, 10).map(p =>
      '<tr><td class="l po"><b class="mono">' + dashEsc(p.po) + '</b></td><td class="l muted" title="' + dashEsc(vname(p.vendor)) + '">' + dashEsc(vname(p.vendor)) + '</td>' +
      '<td>' + p.lines + '</td><td>' + dashInt(p.units) + '</td><td>' + dashEsc(dashDate(p.eta)) + '</td><td class="bad">' + p.late + ' d</td></tr>').join('') + '</tbody></table>';

  const lateCodes = new Set(); R.latePOs.forEach(p => p.codes.forEach(c => lateCodes.add(c)));
  const overallMo = dashDaysToMonths(LEAD_TIMES.overall);
  const tabs = [
    { id: 'reorder', title: 'Reorder now', n: R.reorder.length, sub: R.reorderVendors.length + ' vendors \u00b7 AED ' + dashCompact(R.reorderAtRisk) + '/mo sales at risk', tone: 'warn',
      note: 'Selling items whose stock plus open POs will run out sooner than the vendor’s lead time (measured from past receipts; ' + Math.round(overallMo * 10) / 10 + ' months typical). Ranked by monthly sales value at risk. Order now = quantity to cover the lead time plus ' + DASH_BUFFER_MONTHS + ' month of safety stock. Buyers order per vendor, so the vendor view shows who to order from first; click a vendor to see its items.',
      table: dashReorderView === 'vendor'
        ? '<table class="dash-table"><thead><tr><th class="l vend">Vendor</th><th>Items to order</th><th>Lead time</th><th>Units to order</th><th>Sales at risk / mo</th></tr></thead><tbody>' +
          R.reorderVendors.slice(0, 10).map(g => '<tr class="dash-pick" data-vendor="' + dashEsc(g.vendor) + '" data-goto="reorder" title="Show this vendor\u2019s items"><td class="l"><b>' + dashEsc(vname(g.vendor)) + '</b></td><td>' + g.items + '</td><td>' + dashInt(g.leadDays) + ' d</td><td>' + dashInt(g.units) + '</td><td><b>AED ' + dashCompact(g.atRisk) + '</b></td></tr>').join('') + '</tbody></table>'
        : '<table class="dash-table"><thead><tr><th class="l item">Item</th><th>Sold / mo</th><th>Stock</th><th>On PO</th><th>Cover</th><th>Lead time</th><th>Order now</th><th>At risk / mo</th></tr></thead><tbody>' +
        R.reorder.slice(0, 10).map(x => '<tr>' + dashItemCell(x.it) + '<td>' + x.rate.toFixed(1) + '</td><td>' + dashInt(x.soh) + '</td><td>' + dashInt(x.po) + '</td><td class="warn">' + x.coverPO.toFixed(1) + ' mo</td><td>' + dashInt(x.leadDays) + ' d</td><td><b>' + dashInt(Math.max(0, x.order)) + '</b></td><td>AED ' + dashCompact(x.atRisk) + '</td></tr>').join('') + '</tbody></table>',
      codes: R.reorder.map(x => x.it['Item Code']), sort: null },
    { id: 'oos', title: 'Out of stock, no PO', n: R.oos.length, sub: 'selling, none on hand, nothing on order', tone: 'bad',
      note: 'Sold in the last 3 months, no stock, and no open PO: the items losing sales right now.',
      table: '<table class="dash-table"><thead><tr><th class="l item">Item</th><th class="l vend">Vendor</th><th>Sold / mo</th><th>Sold (3 mo)</th><th>Lead time</th></tr></thead><tbody>' +
        R.oos.slice(0, 10).map(x => '<tr>' + dashItemCell(x.it) + '<td class="l muted">' + dashEsc(vname(x.it['Vendor Code'])) + '</td><td>' + x.rate.toFixed(1) + '</td><td>' + dashInt(x.s3) + '</td><td>' + dashInt(dashLeadDays(x.it['Vendor Code'])) + ' d</td></tr>').join('') + '</tbody></table>',
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
    '<section class="dash-card dash-detail"><div class="dash-detail-head"><h3>' + cur.title + ' <span>' + (cur.id === 'reorder' && dashReorderView === 'vendor' ? dashInt(R.reorderVendors.length) + ' vendors, ' + dashInt(cur.n) + ' items' + (R.reorderVendors.length > 10 ? ', top 10 vendors shown' : '') : dashInt(cur.n) + (cur.id === 'late' ? ' POs' : ' items') + (cur.n > 10 ? ', top 10 shown' : '')) + '</span></h3>' +
      (cur.id === 'reorder' && cur.n ? '<span class="dash-seg"><button type="button" data-rv="vendor" class="' + (dashReorderView === 'vendor' ? 'on' : '') + '">By vendor</button><button type="button" data-rv="item" class="' + (dashReorderView === 'item' ? 'on' : '') + '">By item</button></span>' : '') +
      (cur.n ? '<button type="button" class="dash-btn" id="dashOpenAll">Open ' + (cur.id === 'late' ? 'their ' + dashInt(cur.codes.length) + ' items' : 'all ' + dashInt(cur.n)) + ' in All Products &rarr;</button>' : '') + '</div>' +
      '<p class="dash-note">' + dashEsc(cur.note) + '</p>' +
      (cur.n ? cur.table : '<p class="dash-empty">Nothing here for this selection. Good.</p>') + '</section>';
}

function dashMoverTable(rows, up, total){
  if(!rows.length) return '<p class="dash-empty">No big movers.</p>';
  return '<table class="dash-table"><thead><tr><th class="l item">Item</th><th>Before</th><th>Now</th><th>Change</th></tr></thead><tbody>' +
    rows.map(x => '<tr>' + dashItemCell(x.it) + '<td>' + dashInt(x.p3) + '</td><td>' + dashInt(x.s3) + '</td><td class="' + (up ? 'good' : 'bad') + '">' + (up ? '+' : '') + dashInt(x.d) + '</td></tr>').join('') + '</tbody></table>' +
    '<button type="button" class="dash-btn ghost dash-more" data-movers="' + (up ? 'up' : 'down') + '">See all ' + dashInt(total) + ' ' + (up ? 'rising' : 'falling') + ' items &rarr;</button>';
}

function dashScopeBar(){
  const uniq = f => [...new Set(ITEMS.map(i => i[f]).filter(Boolean))].sort();
  const opt = (arr, cur) => '<option value="">All</option>' + arr.map(v => '<option' + (v === cur ? ' selected' : '') + '>' + dashEsc(v) + '</option>').join('');
  return '<div class="dash-scope"><span class="dash-scope-t">Show me</span>' +
    '<label>Department<select id="dashDept">' + opt(uniq('Department Desc'), dashScope.dept) + '</select></label>' +
    '<label>Category<select id="dashCat">' + opt(uniq('Category'), dashScope.cat) + '</select></label>' +
    '<label>Vendor code<input id="dashVendor" list="dashVendorList" value="' + dashEsc(dashScope.vendor) + '" placeholder="All" autocomplete="off"></label>' +
    '<datalist id="dashVendorList">' + uniq('Vendor Code').map(v => '<option value="' + dashEsc(v) + '">').join('') + '</datalist>' +
    (dashScopeIsSet() ? '<button type="button" class="dash-btn ghost" id="dashReset">Show everything</button>' : '') + '</div>';
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

  const trend = MONTH_WINDOW.map((w, i) => {
    const nodata = i > W.lastIdx, partial = i === W.lastIdx && W.partial;
    return { label: monthColLabel(w), value: R.monthTotals[i], nodata, partial, title: monthColLabel(w) + ': ' + (nodata ? 'no data yet' : dashInt(R.monthTotals[i]) + ' units' + (partial ? ' so far (month in progress)' : '')) };
  });
  const inbound = R.inbound.map(b => ({ label: b.label, value: b.units, color: 'var(--stock)', title: b.label + ': ' + dashInt(b.units) + ' units due' }));
  const branches = Object.keys(R.branch).map(k => ({ label: k, value: R.branch[k], color: 'var(--pos)' })).sort((a, b) => b.value - a.value).slice(0, 8);

  const scopeParts = [dashScope.dept, dashScope.cat, dashScope.vendor && 'Vendor ' + dashScope.vendor].filter(Boolean);
  const scopeLine = (scopeParts.length ? scopeParts.join(' · ') + ' · ' : 'All ') + dashInt(R.items) + ' items';

  root.innerHTML =
    '<div class="dash-hero"><div>' +
      '<div class="dash-date">' + dashEsc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) + '</div>' +
      '<h1 class="dash-greet">' + DASH_GREETINGS[dashGreetingIdx](dashEsc(dashName())) + '</h1>' +
      '<p class="dash-sub">' + dashSubtitle() + ' <span class="dash-asof">Data as of ' + dashEsc(dashDate(DATA_AS_OF)) + '.</span></p></div>' +
      '<div class="dash-links"><a class="dash-btn" href="#products">All Products &rarr;</a><a class="dash-btn ghost" href="#lookup">Item Lookup &rarr;</a></div></div>' +
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
      '<section class="dash-card wide"><h3>Units sold by month <span>' + dashEsc(scopeLine) + '</span></h3>' + dashColumns(trend) + '</section>' +
      '<section class="dash-card"><h3>Rising <span>units vs the 3 months before</span></h3>' + dashMoverTable(R.risers, true, R.risersAll.length) + '</section>' +
      '<section class="dash-card"><h3>Falling <span>units vs the 3 months before</span></h3>' + dashMoverTable(R.fallers, false, R.fallersAll.length) + '</section>' +
      '<section class="dash-card"><h3>Landing soon <span>next 30 days, ' + dashInt(R.soonUnits) + ' units</span></h3>' +
        (R.soonPOs.length ? '<table class="dash-table"><thead><tr><th class="l po">PO</th><th class="l vend">Vendor</th><th>Units</th><th>ETA</th></tr></thead><tbody>' +
          R.soonPOs.slice(0, 8).map(p => '<tr><td class="l po"><b class="mono">' + dashEsc(p.po) + '</b></td><td class="l muted">' + dashEsc(vname(p.vendor)) + '</td><td>' + dashInt(p.units) + '</td><td>' + dashEsc(dashDate(p.eta)) + ' <small>(' + p.in + ' d)</small></td></tr>').join('') + '</tbody></table>'
          : '<p class="dash-empty">No POs due in the next 30 days.</p>') + '</section>' +
      '<section class="dash-card"><h3>Vendors to chase <span>most late units, click to filter</span></h3>' +
        (R.chase.length ? '<table class="dash-table"><thead><tr><th class="l vend">Vendor</th><th>Late POs</th><th>Late units</th><th>Worst</th><th>Usual lead</th></tr></thead><tbody>' +
          R.chase.slice(0, 8).map(c => '<tr class="dash-pick" data-vendor="' + dashEsc(c.vendor) + '" data-goto="late" title="Show only this vendor"><td class="l"><b>' + dashEsc(vname(c.vendor)) + '</b></td><td>' + c.pos + '</td><td>' + dashInt(c.units) + '</td><td class="bad">' + c.worst + ' d</td><td>' + dashInt(dashLeadDays(c.vendor)) + ' d</td></tr>').join('') + '</tbody></table>'
          : '<p class="dash-empty">No late POs. Good.</p>') + '</section>' +
      '<section class="dash-card"><h3>Units due by month <span>all open POs</span></h3>' + dashColumns(inbound) + '</section>' +
      '<section class="dash-card"><h3>Sales by branch <span>last 12 months</span></h3>' + dashBarList(branches) + '</section>' +
    '</div>';

  // wiring
  const $ = id => document.getElementById(id);
  root.querySelectorAll('.dash-tile').forEach(b => b.addEventListener('click', () => { dashTab = b.dataset.tab; renderDashboard(); }));
  root.querySelectorAll('.dash-pick').forEach(tr => tr.addEventListener('click', () => {
    dashScope = { ...dashScope, vendor: tr.dataset.vendor }; dashSaveScope();
    dashTab = tr.dataset.goto || 'late';
    if(dashTab === 'reorder') dashReorderView = 'item';   // now that one vendor is picked, show its items
    renderDashboard();
  }));
  root.querySelectorAll('.dash-seg button').forEach(b => b.addEventListener('click', () => { dashReorderView = b.dataset.rv; renderDashboard(); }));
  root.querySelectorAll('.dash-more').forEach(b => b.addEventListener('click', () => {
    const up = b.dataset.movers === 'up', list = up ? R.risersAll : R.fallersAll;
    openGridFocus((up ? 'Rising' : 'Falling') + (scopeParts.length ? ' – ' + scopeParts.join(' · ') : ''), list.map(x => x.it['Item Code']), null);
  }));
  const open = $('dashOpenAll');
  if(open) open.addEventListener('click', () => {
    const c = dashCurrentTab;
    openGridFocus(c.title + (scopeParts.length ? ' – ' + scopeParts.join(' · ') : ''), c.codes, c.sort);
  });
  const change = () => { dashScope = { dept: $('dashDept').value, cat: $('dashCat').value, vendor: $('dashVendor').value.trim() }; dashSaveScope(); renderDashboard(); };
  $('dashDept').addEventListener('change', change);
  $('dashCat').addEventListener('change', change);
  $('dashVendor').addEventListener('change', change);
  const reset = $('dashReset');
  if(reset) reset.addEventListener('click', () => { dashScope = { dept: '', cat: '', vendor: '' }; dashSaveScope(); renderDashboard(); });
}
// app.js can run its first route before this file has loaded; cover that.
if(document.getElementById('viewDash') && document.getElementById('viewDash').classList.contains('active')) renderDashboard();
