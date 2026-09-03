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

/* Products on these Current Plan Codes are internal — drop them entirely on
   load so they never appear anywhere (grid, search, filters, counts). */
const HIDDEN_PLAN_CODES = new Set(['B']);
for(let i = ITEMS.length - 1; i >= 0; i--){
  if(HIDDEN_PLAN_CODES.has(String(ITEMS[i]['Current Plan Code']).trim().toUpperCase())){
    ITEMS.splice(i, 1);
  }
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

function setView(view){
  const isLookup = view === 'lookup';
  navLookup.classList.toggle('active', isLookup);
  navAll.classList.toggle('active', !isLookup);
  railLookup.classList.toggle('active', isLookup);
  railAll.classList.toggle('active', !isLookup);
  viewLookup.classList.toggle('active', isLookup);
  viewAll.classList.toggle('active', !isLookup);
  if(!isLookup) renderGrid();
}
navLookup.addEventListener('click', () => setView('lookup'));
navAll.addEventListener('click', () => setView('all'));

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
  return map[(name||'').toLowerCase()] || '#D9D4C6';
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
  const years = Object.keys(item.years).sort((a,b) => b - a);
  let html = '<table class="matrix"><thead><tr><th>Year</th>';
  MONTHS.forEach(m => html += `<th>${m}</th>`);
  html += '<th>Total</th></tr></thead><tbody>';
  years.forEach(y => {
    const vals = item.years[y][key];
    const total = vals.reduce((a,b) => a+b, 0);
    html += `<tr><td>${y}</td>`;
    vals.forEach(v => { html += `<td class="${v === 0 ? 'zero' : ''}">${v === 0 ? '—' : v}</td>`; });
    html += `<td><strong>${total}</strong></td></tr>`;
  });
  html += '</tbody></table>';
  wrapEl.innerHTML = html;
}
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
}

/** Open an item in the Item Lookup view (used by search Generate + grid row click) */
function openItem(item){
  selectedItem = item;
  searchInput.value = '';
  filtered = ITEMS.slice();
  renderResults();
  renderReport(item);
  setView('lookup');
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
      { field:'PUDA Code', label:'PUDA Code' },
      { field:'PUDA Desc', label:'PUDA Desc' } ] },
  { type:'core', field:'Current Plan Code', label:'Plan' },
  { type:'group', key:'price', title:'Pricing', short:'Pricing', cols:[
      { field:'L-Cost (Aed)', label:'L-Cost', fmt:'money2' },
      { field:'Was (Aed)', label:'Was', fmt:'money0' },
      { field:'Now (Aed)', label:'Now', fmt:'money0' },
      { field:'Disct%', label:'Disct%', fmt:'pct' },
      { field:'MRG Factor', label:'Mrg', fmt:'x2' } ] },
  { type:'core', field:'SOH', label:'SOH' },
  { type:'core', field:'PO-Qty', label:'PO Qty' },
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
      { field:'Last Sold Date', label:'Last Sold Date' },
      { field:'Last Sold Qty', label:'Last Sold Qty' } ] },
  { type:'core', field:'__Year', label:'Year' },
  { type:'group', key:'soldby', title:'Sold by Month', short:'Sold', cols: MONTHS.map(m => ({ field:'__sold_'+m, label:m })) },
  { type:'group', key:'stockin', title:'Stock In by Month', short:'Stock In', cols: MONTHS.map(m => ({ field:'__stock_'+m, label:m })) },
];

const ALL_GROUP_KEYS = COLUMN_LAYOUT.filter(e => e.type === 'group').map(e => e.key);
let collapsedGroups = new Set(['class','attrs','fob','logi']); // sensible default: keep the essentials visible first

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
      entry.cols.forEach(c => out.push({ type:'field', field:c.field, label:c.label, fmt:c.fmt, group:entry.key }));
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
      gth.addEventListener('click', () => toggleGroup(entry.key));
      groupRow.appendChild(gth);
    } else {
      const gth = document.createElement('th');
      gth.colSpan = entry.cols.length;
      gth.innerHTML = `<span class="chev">−</span>${entry.title}`;
      gth.title = 'Click to collapse this section';
      gth.addEventListener('click', () => toggleGroup(entry.key));
      groupRow.appendChild(gth);
      entry.cols.forEach((c, i) => {
        const fth = document.createElement('th');
        fth.textContent = c.label;
        fth.classList.add('grp-' + entry.key);
        if(i === 0) fth.classList.add('group-start');
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

function cellValueForYearRow(item, field, yearKey){
  if(field === '__Year') return yearKey;
  if(field.startsWith('__stock_')){
    const idx = MONTHS.indexOf(field.replace('__stock_',''));
    return item.years[yearKey] ? item.years[yearKey].stock[idx] : null;
  }
  if(field.startsWith('__sold_')){
    const idx = MONTHS.indexOf(field.replace('__sold_',''));
    return item.years[yearKey] ? item.years[yearKey].sales[idx] : null;
  }
  return item[field];
}

function buildGridBody(items, cols){
  const tbody = document.createElement('tbody');
  // First column of each expanded group gets a visual divider so adjacent
  // groups (e.g. Stock In / Sold by Month, both Jan–Dec) aren't ambiguous.
  const groupStartIdx = new Set();
  cols.forEach((col, i) => {
    if(col.type === 'field' && (i === 0 || cols[i-1].group !== col.group)) groupStartIdx.add(i);
  });
  // The cell just before a divider drops its own right border so the 2px
  // divider is a single crisp line, not a doubled-up pale seam.
  const groupEndIdx = new Set();
  groupStartIdx.forEach(i => { if(i > 0) groupEndIdx.add(i - 1); });

  items.forEach(item => {
    const years = Object.keys(item.years).sort((a,b) => b-a);
    years.forEach((yr, idx) => {
      const tr = document.createElement('tr');
      tr.className = idx === 0 ? 'row-primary' : 'row-secondary';
      tr.title = 'Open ' + item['Item Code'] + ' in Item Lookup';
      tr.addEventListener('click', () => openItem(item));
      cols.forEach((col, ci) => {
        const td = document.createElement('td');
        if(groupStartIdx.has(ci)) td.classList.add('group-start');
        if(groupEndIdx.has(ci)) td.classList.add('group-end');
        if(col.type === 'collapsed'){
          td.textContent = '';
          td.style.background = idx === 0 ? '#F2F0EA' : '#FFFFFF';
        } else if(col.type === 'core'){
          const v = idx === 0 ? cellValueForYearRow(item, col.field, yr) : (col.field === '__Year' ? yr : '');
          td.textContent = (v === undefined || v === null || v === '') ? (idx === 0 ? '—' : '') : v;
          if(col.cls) td.className = col.cls;
          if(col.fz) td.classList.add(col.fz);
          if(col.left) td.classList.add('left');
        } else {
          td.classList.add('grp-' + col.group);
          const isMonthly = col.field.startsWith('__stock_') || col.field.startsWith('__sold_');
          const v = isMonthly ? cellValueForYearRow(item, col.field, yr) : (idx === 0 ? item[col.field] : '');
          if(isMonthly){
            const num = v === null || v === undefined ? 0 : v;
            td.textContent = num === 0 ? '—' : num;
            if(num === 0) td.classList.add('zero');
            if(num < 0) td.classList.add('neg');
          } else {
            td.textContent = fmtCell(v, col.fmt);
          }
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  });
  return tbody;
}

function getFilteredItems(){
  return ITEMS.filter(item => {
    for(const key of Object.keys(activeFilters)){
      const selected = activeFilters[key];
      if(selected.size === 0) continue;
      if(!selected.has(String(item[FILTER_FIELD_MAP[key]]))) return false;
    }
    return true;
  });
}

function renderGrid(){
  const items = getFilteredItems();
  const cols = visibleColumns();
  const table = document.getElementById('gridTable');
  table.innerHTML = '';
  const thead = buildGridHeader();
  table.appendChild(thead);
  table.appendChild(buildGridBody(items, cols));
  document.getElementById('gridRowCount').textContent = items.length + ' of ' + ITEMS.length + ' items';
  // The second header row's sticky offset must equal the first row's actual
  // rendered height (which varies with how tall the rotated collapsed labels
  // are) — measure it after layout instead of guessing a fixed number.
  const groupRow = thead.querySelector('tr.group-row');
  const fieldRow = thead.querySelector('tr.field-row');
  if(groupRow && fieldRow){
    const h = groupRow.getBoundingClientRect().height;
    fieldRow.querySelectorAll('th').forEach(th => { th.style.top = h + 'px'; });
  }
}

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
  'Category Code': ['A','F','K','O','S','W'],
  'Current Plan Code': ['A','C','D','H','K','M','N','O','R','S','U','W'],
};
// Per-filter display names for coded values. The checkbox value stays the raw
// code (that's what the item data holds); only the visible label changes.
const FILTER_VALUE_LABELS = {
  'Category Code': {
    A: 'Accessory',
    F: 'Furniture',
    K: 'Kids',
    O: 'Office Furniture',
    S: 'Services',
    W: 'Wall Paper',
  },
};
// Filters that get a text box to search within their (often long) option list.
const FILTER_SEARCHABLE = new Set(['Vendor Code', 'PUDA Desc']);
function filterValueLabel(label, val){
  // PUDA Desc comes in as "A.Tabletop / Charger Plate" — show only the part
  // after the slash (the product name).
  if(label === 'PUDA Desc'){
    const i = String(val).indexOf('/');
    if(i !== -1) return String(val).slice(i + 1).trim();
  }
  const map = FILTER_VALUE_LABELS[label];
  return (map && map[val]) || val;
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
      const isPresent = present.has(val);
      const row = document.createElement('label');
      row.className = 'filter-opt' + (isPresent ? '' : ' disabled');
      row.innerHTML = `<input type="checkbox" data-filter="${label}" value="${val}"${isPresent ? '' : ' disabled'}><span class="lbl">${filterValueLabel(label, val)}</span>`;
      if(!isPresent) row.title = 'No items with this code in the current data';
      const cb = row.querySelector('input');
      cb.addEventListener('change', () => {
        if(cb.checked) activeFilters[label].add(val); else activeFilters[label].delete(val);
        row.classList.toggle('checked', cb.checked);
        updateFilterCounts();
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
}
function updateFilterCounts(){
  document.querySelectorAll('[data-count-for]').forEach(el => {
    const label = el.dataset.countFor;
    const n = activeFilters[label].size;
    el.textContent = n > 0 ? n + ' selected' : '';
  });
}
document.getElementById('clearFiltersBtn').addEventListener('click', () => {
  Object.keys(activeFilters).forEach(k => activeFilters[k].clear());
  document.querySelectorAll('.filter-opt input').forEach(cb => { cb.checked = false; cb.closest('.filter-opt').classList.remove('checked'); });
  updateFilterCounts();
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

/* Land on All Products */
setView('all');
