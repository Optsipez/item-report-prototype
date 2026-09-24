/* ============================================================
   DASHBOARD — the landing page after login. A rotating personal greeting,
   two doors into the data pages (All Products / Item Lookup), and a set of
   headline numbers worked out from the same data the rest of the app uses.

   Everything is computed here from ITEMS / BRANCH_MONTHLY_SOLD_BY_ITEM, so it
   stays in step with the grid. "Recent" means the 12 months ending at the
   last month that actually has sales in the data (not the calendar month, so
   it doesn't show empty trailing months as a collapse).

   Role differences: the greeting subtitle, and vendor-based panels are only
   shown to roles that may see vendor names (see canSeeVendorName in app.js).
   ============================================================ */
const DASH_GREETINGS = [
  n => 'Hi ' + n + ', good to see you.',
  n => 'Welcome back, ' + n + '.',
  n => 'Good ' + dashPartOfDay() + ', ' + n + '.',
  n => n + ', here’s where things stand.',
];
let dashGreetingIdx = Math.floor(Math.random() * DASH_GREETINGS.length);
// A fresh pick each time someone signs in (called from auth.js's enterApp).
function reshuffleDashGreeting(){ dashGreetingIdx = Math.floor(Math.random() * DASH_GREETINGS.length); }

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
  if(CURRENT_ROLE === 'manager') return 'How the range is performing across the team.';
  return 'Your catalogue at a glance.';
}
const dashInt = n => Math.round(n).toLocaleString('en-US');
function dashCompact(n){
  const a = Math.abs(n);
  if(a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if(a >= 1e4) return Math.round(n / 1e3) + 'K';
  return dashInt(n);
}

/* The 24 months ending at the last month with any sales, oldest first. */
function dashMonths(){
  const last = MONTH_WINDOW[MONTH_WINDOW_LAST_DATA];
  const out = [];
  let y = last.year, m = last.m;
  for(let i = 0; i < 24; i++){
    out.push({ year: y, m });
    if(--m < 0){ m = 11; y--; }
  }
  return out.reverse();
}
const itemMonthUnits = (it, mo) => { const yr = it.years[String(mo.year)]; return yr ? (yr.sales[mo.m] || 0) : 0; };

function dashStats(){
  const months = dashMonths();
  const recent = months.slice(12), prior = months.slice(0, 12), recent3 = months.slice(21);
  const S = {
    recent, items: ITEMS.length, soh: 0, stockValue: 0, lowCover: 0, outSelling: 0,
    agedUnits: 0, agedItems: 0, sold12: 0, soldPrior12: 0,
    monthTotals: MONTH_WINDOW.map(() => 0), byCat: {}, byVendor: {}, top: [], attention: [],
    age: {}, branch: {},
  };
  const ranked = [];
  ITEMS.forEach(it => {
    const soh = Number(it['SOH']) || 0;
    S.soh += soh;
    S.stockValue += Math.max(0, soh) * (Number(it['L-Cost (Aed)']) || 0);
    let u12 = 0;
    recent.forEach(mo => { u12 += itemMonthUnits(it, mo); });
    let u3 = 0;
    recent3.forEach(mo => { u3 += itemMonthUnits(it, mo); });
    let up = 0;
    prior.forEach(mo => { up += itemMonthUnits(it, mo); });
    S.sold12 += u12; S.soldPrior12 += up;
    MONTH_WINDOW.forEach((w, i) => { S.monthTotals[i] += itemMonthUnits(it, w); });
    if(u12 > 0){
      ranked.push({ it, u12 });
      const cat = it['Category'] || 'Other';
      S.byCat[cat] = (S.byCat[cat] || 0) + u12;
      const v = it['Vendor Name'] || 'Unknown';
      S.byVendor[v] = (S.byVendor[v] || 0) + u12;
    }
    // Genuinely selling = sold in the last 3 months of data. Cover is stock over
    // that monthly rate (the grid's AVG is a PO estimate for brand-new items).
    if(u3 > 0){
      const rate = u3 / 3, cover = soh > 0 ? soh / rate : 0;
      if(soh > 0 && cover < 3) S.lowCover++;
      if(soh <= 0) S.outSelling++;
      if(soh <= 0 || cover < 1.5) S.attention.push({ it, soh, u3, cover });
    }
    if(soh > 0){
      const a = stkAgeFor(it);
      S.age[a.label] = S.age[a.label] || { n: 0, units: 0, sno: a.sno };
      S.age[a.label].n++; S.age[a.label].units += soh;
      if(a.sno >= 5){ S.agedUnits += soh; S.agedItems++; }
    }
  });
  ranked.sort((a, b) => b.u12 - a.u12);
  S.top = ranked.slice(0, 10);
  S.attention.sort((a, b) => b.u3 - a.u3);
  S.attention = S.attention.slice(0, 8);
  // Branch sales over the same 12 months (items that are in the app only).
  const inApp = new Set(ITEMS.map(i => i['Item Code']));
  Object.keys(BRANCH_MONTHLY_SOLD_BY_ITEM).forEach(code => {
    if(!inApp.has(code)) return;
    const byBranch = BRANCH_MONTHLY_SOLD_BY_ITEM[code];
    Object.keys(byBranch).forEach(b => {
      let t = 0;
      recent.forEach(mo => { const a = byBranch[b][String(mo.year)]; if(a) t += a[mo.m] || 0; });
      if(t) S.branch[b] = (S.branch[b] || 0) + t;
    });
  });
  return S;
}

function dashBarList(rows, opts){
  opts = opts || {};
  const max = Math.max(1, ...rows.map(r => r.value));
  return '<div class="dash-bars">' + rows.map(r =>
    '<div class="dash-bar-row"' + (r.title ? ' title="' + dashEsc(r.title) + '"' : '') + '>' +
      '<span class="dash-bar-k">' + dashEsc(r.label) + '</span>' +
      '<span class="dash-bar-track"><span class="dash-bar-fill" style="width:' + Math.max(2, r.value / max * 100).toFixed(1) + '%;background:' + (r.color || 'var(--stock)') + '"></span></span>' +
      '<span class="dash-bar-v">' + dashInt(r.value) + (r.note ? '<small>' + dashEsc(r.note) + '</small>' : '') + '</span>' +
    '</div>').join('') + '</div>';
}

function dashTrend(S){
  const lastIdx = MONTH_WINDOW_LAST_DATA;
  const max = Math.max(1, ...S.monthTotals);
  return '<div class="dash-trend">' + MONTH_WINDOW.map((w, i) => {
    const v = S.monthTotals[i], noData = i > lastIdx;
    const partial = i === lastIdx && w.year === REPORT_MONTH.year && w.m === REPORT_MONTH.month;   // month still in progress
    return '<div class="dash-trend-col' + (noData ? ' nodata' : '') + (partial ? ' partial' : '') + '" title="' + dashEsc(monthColLabel(w)) + ': ' + (noData ? 'no data yet' : dashInt(v) + ' units' + (partial ? ' so far (month in progress)' : '')) + '">' +
      '<span class="dash-trend-v">' + (noData ? '' : dashCompact(v)) + '</span>' +
      '<span class="dash-trend-bar"><span style="height:' + (noData ? 0 : Math.max(3, v / max * 100)).toFixed(1) + '%"></span></span>' +
      '<span class="dash-trend-k">' + dashEsc(monthColLabel(w)) + (partial ? '<small>to date</small>' : '') + '</span></div>';
  }).join('') + '</div>';
}

function dashAge(S){
  const rows = Object.keys(S.age).map(k => ({ label: k, ...S.age[k] })).sort((a, b) => a.sno - b.sno);
  const total = rows.reduce((a, r) => a + r.units, 0) || 1;
  // Fresher stock in cool tones, older in warm ones.
  const colours = { 0: '#38bdf8', 1: '#0ea5e9', 2: '#0284c7', 3: '#6366f1', 4: '#d97706', 5: '#e11d48', 6: '#9f1239', 7: '#7f1d1d' };
  return '<div class="dash-agebar">' + rows.map(r =>
      '<span style="width:' + (r.units / total * 100).toFixed(2) + '%;background:' + (colours[r.sno] || '#94a3b8') + '" title="' + dashEsc(r.label) + ' months: ' + dashInt(r.units) + ' units"></span>').join('') + '</div>' +
    '<div class="dash-agekey">' + rows.map(r =>
      '<span><i style="background:' + (colours[r.sno] || '#94a3b8') + '"></i>' + dashEsc(r.label) + '<b>' + Math.round(r.units / total * 100) + '%</b></span>').join('') + '</div>';
}

function renderDashboard(){
  const root = document.getElementById('dashRoot');
  if(!root) return;
  const S = dashStats();
  const showVendor = canSeeVendorName();
  const name = dashEsc(dashName());
  const delta = S.soldPrior12 > 0 ? (S.sold12 - S.soldPrior12) / S.soldPrior12 * 100 : null;
  const asOf = monthColLabel(S.recent[S.recent.length - 1]);
  const sellThrough = S.sold12 + S.soh > 0 ? S.sold12 / (S.sold12 + S.soh) * 100 : 0;
  const link = code => 'href="#item=' + encodeURIComponent(code) + '"';

  const kpi = (label, value, note, tone) =>
    '<div class="dash-kpi' + (tone ? ' ' + tone : '') + '"><span class="dash-kpi-k">' + label + '</span><span class="dash-kpi-v">' + value + '</span>' +
    (note ? '<span class="dash-kpi-n">' + note + '</span>' : '') + '</div>';

  const topRows = S.top.map((r, i) =>
    '<tr><td class="rk">' + (i + 1) + '</td><td class="l"><a ' + link(r.it['Item Code']) + '><b>' + dashEsc(r.it['Item Code']) + '</b> ' + dashEsc(r.it['Description']) + '</a></td>' +
    (showVendor ? '<td class="l muted">' + dashEsc(r.it['Vendor Name']) + '</td>' : '') +
    '<td>' + dashInt(r.u12) + '</td><td>' + dashInt(Number(r.it['SOH']) || 0) + '</td></tr>').join('');
  const attnRows = S.attention.map(r =>
    '<tr><td class="l"><a ' + link(r.it['Item Code']) + '><b>' + dashEsc(r.it['Item Code']) + '</b> ' + dashEsc(r.it['Description']) + '</a></td>' +
    '<td>' + dashInt(r.soh) + '</td><td>' + dashInt(r.u3) + '</td><td class="' + (r.soh <= 0 ? 'bad' : 'warn') + '">' + (r.soh <= 0 ? 'Out' : r.cover.toFixed(1) + ' mo') + '</td></tr>').join('');

  const cats = Object.keys(S.byCat).map(k => ({ label: k, value: S.byCat[k] })).sort((a, b) => b.value - a.value).slice(0, 6);
  const branches = Object.keys(S.branch).map(k => ({ label: k, value: S.branch[k], color: 'var(--pos)' })).sort((a, b) => b.value - a.value).slice(0, 8);
  const vendors = Object.keys(S.byVendor).map(k => ({ label: k, value: S.byVendor[k], color: 'var(--primary)' })).sort((a, b) => b.value - a.value).slice(0, 8);

  root.innerHTML =
    '<div class="dash-hero"><div>' +
      '<div class="dash-date">' + dashEsc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) + '</div>' +
      '<h1 class="dash-greet">' + DASH_GREETINGS[dashGreetingIdx](name) + '</h1>' +
      '<p class="dash-sub">' + dashSubtitle() + '</p></div></div>' +

    '<div class="dash-actions">' +
      '<a class="dash-action" href="#products"><span class="dash-action-t">All Products</span><span class="dash-action-d">Browse, filter and sort all ' + dashInt(S.items) + ' items in one grid.</span><span class="dash-action-go">Open &rarr;</span></a>' +
      '<a class="dash-action" href="#lookup"><span class="dash-action-t">Item Lookup</span><span class="dash-action-d">Pull the full report for a single item, with branch and weekly sales.</span><span class="dash-action-go">Open &rarr;</span></a>' +
    '</div>' +

    '<div class="dash-kpis">' +
      kpi('Items in range', dashInt(S.items), 'active catalogue') +
      kpi('Stock on hand', dashCompact(S.soh), 'units, all locations') +
      kpi('Sold, last 12 months', dashCompact(S.sold12), delta == null ? 'to ' + asOf : (delta >= 0 ? '&#9650; ' : '&#9660; ') + Math.abs(delta).toFixed(0) + '% vs the 12 before &middot; to ' + asOf, delta == null ? '' : (delta >= 0 ? 'up' : 'down')) +
      kpi('Sell-through', sellThrough.toFixed(0) + '%', 'sold &divide; (sold + stock)') +
      kpi('Stock value', 'AED ' + dashCompact(S.stockValue), 'at landed cost') +
      kpi('Low cover', dashInt(S.lowCover), 'selling items, under 3 months of stock', S.lowCover ? 'warn' : '') +
      kpi('Out of stock, selling', dashInt(S.outSelling), 'sold in the last 3 months, none in stock', S.outSelling ? 'down' : '') +
      kpi('Aged stock', dashInt(S.agedUnits), 'units over 12 months old &middot; ' + dashInt(S.agedItems) + ' items') +
    '</div>' +

    '<div class="dash-grid">' +
      '<section class="dash-card wide"><h3>Units sold by month <span>all items</span></h3>' + dashTrend(S) + '</section>' +
      '<section class="dash-card"><h3>Top sellers <span>last 12 months</span></h3>' +
        '<table class="dash-table"><thead><tr><th></th><th class="l item">Item</th>' + (showVendor ? '<th class="l vend">Vendor</th>' : '') + '<th>Sold</th><th>Stock</th></tr></thead><tbody>' + topRows + '</tbody></table></section>' +
      '<section class="dash-card"><h3>Needs attention <span>selling fast, stock nearly gone</span></h3>' +
        (attnRows ? '<table class="dash-table"><thead><tr><th class="l item">Item</th><th>Stock</th><th>Sold (3 mo)</th><th>Cover</th></tr></thead><tbody>' + attnRows + '</tbody></table>' : '<p class="dash-empty">Nothing running short right now.</p>') + '</section>' +
      '<section class="dash-card"><h3>Sales by branch <span>last 12 months</span></h3>' + dashBarList(branches) + '</section>' +
      '<section class="dash-card"><h3>Sales by category <span>last 12 months</span></h3>' + dashBarList(cats) + '</section>' +
      '<section class="dash-card' + (showVendor ? '' : ' wide') + '"><h3>Stock age <span>share of units on hand</span></h3>' + dashAge(S) + '</section>' +
      (showVendor ? '<section class="dash-card"><h3>Top vendors <span>last 12 months</span></h3>' + dashBarList(vendors) + '</section>' : '') +
    '</div>';
}
// app.js can run its first route before this file has loaded; cover that.
if(document.getElementById('viewDash') && document.getElementById('viewDash').classList.contains('active')) renderDashboard();
