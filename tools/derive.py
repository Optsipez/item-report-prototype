"""Rebuild the app's sales/GRN/PO-derived data from a parsed workbook (pickle
from dump.py). Used to (a) check the logic reproduces the current 16-Sep data,
(b) build the 25-Sep data. Stock Data is never read here."""
import pickle, json, collections, datetime, statistics, re, sys
from stocklogic import xl_round, RAW_COLUMNS

MON = ['January','February','March','April','May','June','July','August','September','October','November','December']
def s(v): return '' if v is None else str(v).strip()
def num(v):
    try: return float(v) if v not in (None, '') else 0.0
    except: return 0.0
def iso(v): return v.strftime('%Y-%m-%d') if isinstance(v, (datetime.datetime, datetime.date)) else None

HEADER_KEYS = ('SKU', 'Item No', 'PO No', 'Item Code')
def sheet(D, name):
    """(column index by header, data rows). The header is the LAST of the first
    5 rows that names a key column -- the 22-Oct GRN sheet has a stale header
    in row 1 (different column order) above the real one in row 3."""
    rows = D[name]
    h = max((i for i, r in enumerate(rows[:5]) if any(s(x) in HEADER_KEYS for x in r)), default=0)
    ix = {}
    for i, x in enumerate(s(v) for v in rows[h]):
        if x and x not in ix: ix[x] = i
    return ix, rows[h + 1:]
def qty_col(ix):
    """GRN received quantity: "Quantity" (to 25-Sep), "Posted Quantity" (22-Oct on)."""
    return ix['Posted Quantity'] if 'Posted Quantity' in ix else ix['Quantity']

def sales_years(D):
    """Every "Sales YYYY" sheet, oldest first. History starts at 2024 (monthIdx 0)
    and stops the import on a missing or empty year, so a gap can't wipe it."""
    ys = sorted(k[6:] for k in D if re.fullmatch(r'Sales \d{4}', k))
    want = [str(y) for y in range(2024, int(ys[-1]) + 1)] if ys else ['2024']
    gone = [y for y in want if y not in ys or len(D['Sales ' + y]) < 2]
    if gone or ys != want: sys.exit('STOP: Sales sheets must run from 2024 with no gaps or empty years. Have %s, problem with %s' % (ys, gone or ys))
    return ys

SALES_COLUMNS = ('Item No', 'Year Name', 'Month Name', 'Store No', 'Tot Sold Quantity', 'Tot Sales Cost', 'Tot RSP', 'Tot NET', 'Tot Discount Amount', 'Cons. Status',
                 'Description', 'Category Code', 'Category Desc', 'Department Code', 'Department Desc', 'Group Desc', 'PUDA Desc', 'Range Name', 'Vendor Code',
                 'Current Plan Code', 'Event', 'Lifestyle')
GRN_COLUMNS = ('SKU', 'GRN DATE', 'Order Date')
PO_COLUMNS = ('PO No', 'Item Code', 'Description', 'PO Qty', 'PO Status', 'PO Creation Date', 'Ship Date', 'Revised Ship Date', 'Arrival Date', 'FOB Cost LCY', 'Current Plan Code',
              'Vendor Code', 'Department Desc', 'Category Desc', 'Territorry', 'Container Size', 'Port Origin', 'Port Of Discharge')
LOGISTICS_COLUMNS = {0: 'PO No', 1: 'Sataus', 2: 'New ETD', 3: 'New ETA', 7: 'Correction'}   # read by position in pologic.logistics, header in row 2
SALES_STORES_KNOWN = {'ALNML', 'BKOF1', 'BRSHA', 'CLRNC', 'DALMA', 'GALER', 'JUMRA', 'MARIN', 'MOMAN', 'OMNWEB', 'PARKC', 'RAKMA', 'REGUS', 'WEBSTR', 'ZAHIA'}

def check_sources(stock_header, D):
    """Stop before building anything if a sheet isn't laid out as this import expects."""
    problems = []
    def need(name, have, want):
        gone = [c for c in want if c not in have]
        if gone: problems.append('%s: missing column(s) %s' % (name, gone))
    need('Raw stock', stock_header, RAW_COLUMNS)
    new = [c for c in stock_header if c and c not in RAW_COLUMNS]
    if new: problems.append('Raw stock: unknown column(s) %s. A new store or location must be added to the stock logic, then to RAW_COLUMNS in stocklogic.py' % new)
    stores = set()
    for y in sales_years(D):
        ix, rows = sheet(D, 'Sales ' + y)
        need('Sales ' + y, ix, SALES_COLUMNS)
        if 'Store No' in ix: stores.update(s(r[ix['Store No']]) for r in rows)
    new = sorted(stores - SALES_STORES_KNOWN - {''})
    if new: problems.append('Sales: unknown store(s) %s. Decide how they count in the app, then add them to SALES_STORES_KNOWN in derive.py' % new)
    ix = sheet(D, 'GRN Data')[0]
    need('GRN Data', ix, GRN_COLUMNS)
    if 'Posted Quantity' not in ix and 'Quantity' not in ix: problems.append('GRN Data: missing "Posted Quantity" or "Quantity"')
    if 'PO Data' in D: need('PO Data', sheet(D, 'PO Data')[0], PO_COLUMNS)
    if 'Logistics Status' in D:
        h = D['Logistics Status'][1] if len(D['Logistics Status']) > 1 else ()
        moved = ['%s should be column %s' % (c, chr(65 + i)) for i, c in LOGISTICS_COLUMNS.items() if i >= len(h) or s(h[i]) != c]
        if moved: problems.append('Logistics Status (row 2): %s' % moved)
    if problems: sys.exit('STOP: nothing was built.\n  ' + '\n  '.join(problems))

def derive(D, item_codes, vendor_of, retail_stores):
    R = {}
    # ---- sales ----
    pm = collections.defaultdict(lambda: collections.defaultdict(lambda: [0.0]*12))
    br = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(lambda: [0.0]*12)))
    for y in sales_years(D):
        ix, rows = sheet(D, 'Sales ' + y)
        for r in rows:
            c = s(r[ix['Item No']])
            if not c or c not in item_codes: continue
            m = MON.index(s(r[ix['Month Name']])); yy = s(r[ix['Year Name']]); q = num(r[ix['Tot Sold Quantity']])
            pm[c][yy][m] += q
            br[c][s(r[ix['Store No']])][yy][m] += q
    # ---- GRN ----
    ix, rows = sheet(D, 'GRN Data'); qc = qty_col(ix)
    g = collections.defaultdict(lambda: collections.defaultdict(lambda: [0.0]*12))
    lastg = {}; leads = collections.defaultdict(list)
    for r in rows:
        c = s(r[ix['SKU']]); d = r[ix['GRN DATE']]
        if not c or not isinstance(d, (datetime.datetime, datetime.date)): continue
        q = num(r[qc])
        if c in item_codes: g[c][str(d.year)][d.month - 1] += q
        k = iso(d)
        if c not in lastg or k > lastg[c][0]: lastg[c] = [k, q]
        elif k == lastg[c][0]: lastg[c][1] += q
        od = r[ix['Order Date']]
        if isinstance(od, (datetime.datetime, datetime.date)) and c in vendor_of and 7 <= (d - od).days <= 400:
            leads[vendor_of[c]].append((d - od).days)
    years = {}
    for c in item_codes:
        ys = {}
        for y in sorted(set(pm.get(c, {})) | set(g.get(c, {}))):
            sales = [xl_round(a) for a in pm[c][y]] if c in pm and y in pm[c] else [0]*12
            stock = [xl_round(a) for a in g[c][y]] if c in g and y in g[c] else [0]*12
            if any(sales) or any(stock): ys[y] = {'stock': stock, 'sales': sales}
        years[c] = ys
    R['years'] = years
    R['lastg'] = lastg
    R['branch_monthly'] = {c: {st: {y: [xl_round(a) for a in arr] for y, arr in ys.items()} for st, ys in b.items()} for c, b in br.items()}
    R['branch_sold'] = {c: {st: xl_round(sum(sum(arr) for arr in ys.values())) for st, ys in b.items() if st in retail_stores} for c, b in br.items()}
    R['branch_sold'] = {c: b for c, b in R['branch_sold'].items() if b}
    half_up = lambda m: int(m + 0.5)
    R['lead_times'] = {'overall': half_up(statistics.median([x for v in leads.values() for x in v])),
                       'vendors': {v: [half_up(statistics.median(x)), len(x)] for v, x in leads.items() if v}}
    # ---- PO ----
    ix, rows = sheet(D, 'PO Data') if 'PO Data' in D else ({}, [])
    lines = []; created = collections.defaultdict(set); ship = {}
    for r in rows:
        po = s(r[ix['PO No']])
        if not po: continue
        q = num(r[ix['PO Qty']])
        lines.append([po, s(r[ix['Item Code']]), ' '.join(s(r[ix['Description']]).split()), xl_round(q), iso(r[ix['Arrival Date']]),
                      s(r[ix['Vendor Code']]), s(r[ix['Department Desc']]), s(r[ix['Category Desc']])])
        d = iso(r[ix['PO Creation Date']])
        if d: created[po].add(d)
        if po not in ship:
            ship[po] = [iso(r[ix['Ship Date']]), iso(r[ix['Revised Ship Date']]), s(r[ix['PO Status']]), s(r[ix['Territorry']]),
                        s(r[ix['Container Size']]), s(r[ix['Port Origin']]), s(r[ix['Port Of Discharge']]).upper()]
    R['po_lines'] = lines; R['po_created'] = {k: sorted(v)[0] for k, v in created.items()}; R['po_ship'] = ship
    return R
