"""Rebuild the app's sales/GRN/PO-derived data from a parsed workbook (pickle
from dump.py). Used to (a) check the logic reproduces the current 16-Sep data,
(b) build the 25-Sep data. Stock Data is never read here."""
import pickle, json, collections, datetime, statistics

MON = ['January','February','March','April','May','June','July','August','September','October','November','December']
def s(v): return '' if v is None else str(v).strip()
def num(v):
    try: return float(v) if v not in (None, '') else 0.0
    except: return 0.0
def iso(v): return v.strftime('%Y-%m-%d') if isinstance(v, (datetime.datetime, datetime.date)) else None

def sheet(D, name):
    rows = D[name]; hdr = [s(h) for h in rows[0]]
    return {h: i for i, h in enumerate(hdr)}, rows[1:]

def derive(D, item_codes, vendor_of, retail_stores):
    R = {}
    # ---- sales ----
    pm = collections.defaultdict(lambda: collections.defaultdict(lambda: [0.0]*12))
    br = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(lambda: [0.0]*12)))
    for y in ('2024', '2025', '2026'):
        ix, rows = sheet(D, 'Sales ' + y)
        for r in rows:
            c = s(r[ix['Item No']])
            if not c or c not in item_codes: continue
            m = MON.index(s(r[ix['Month Name']])); yy = s(r[ix['Year Name']]); q = num(r[ix['Tot Sold Quantity']])
            pm[c][yy][m] += q
            br[c][s(r[ix['Store No']])][yy][m] += q
    # ---- GRN ----
    ix, rows = sheet(D, 'GRN Data')
    g = collections.defaultdict(lambda: collections.defaultdict(lambda: [0.0]*12))
    lastg = {}; leads = collections.defaultdict(list)
    for r in rows:
        c = s(r[ix['SKU']]); d = r[ix['GRN DATE']]
        if not c or not isinstance(d, (datetime.datetime, datetime.date)): continue
        q = num(r[ix['Quantity']])
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
            sales = [int(a) for a in pm[c][y]] if c in pm and y in pm[c] else [0]*12
            stock = [int(a) for a in g[c][y]] if c in g and y in g[c] else [0]*12
            if any(sales) or any(stock): ys[y] = {'stock': stock, 'sales': sales}
        years[c] = ys
    R['years'] = years
    R['lastg'] = lastg
    R['branch_monthly'] = {c: {st: {y: [int(a) if a == int(a) else a for a in arr] for y, arr in ys.items()} for st, ys in b.items()} for c, b in br.items()}
    R['branch_sold'] = {c: {st: int(sum(sum(arr) for arr in ys.values())) for st, ys in b.items() if st in retail_stores} for c, b in br.items()}
    R['branch_sold'] = {c: b for c, b in R['branch_sold'].items() if b}
    half_up = lambda m: int(m + 0.5)
    R['lead_times'] = {'overall': half_up(statistics.median([x for v in leads.values() for x in v])),
                       'vendors': {v: [half_up(statistics.median(x)), len(x)] for v, x in leads.items() if v}}
    # ---- PO ----
    ix, rows = sheet(D, 'PO Data')
    lines = []; created = collections.defaultdict(set); ship = {}
    for r in rows:
        po = s(r[ix['PO No']])
        if not po: continue
        q = num(r[ix['PO Qty']])
        lines.append([po, s(r[ix['Item Code']]), ' '.join(s(r[ix['Description']]).split()), int(q) if q == int(q) else q, iso(r[ix['Arrival Date']]),
                      s(r[ix['Vendor Code']]), s(r[ix['Department Desc']]), s(r[ix['Category Desc']])])
        d = iso(r[ix['PO Creation Date']])
        if d: created[po].add(d)
        if po not in ship:
            ship[po] = [iso(r[ix['Ship Date']]), iso(r[ix['Revised Ship Date']]), s(r[ix['PO Status']]), s(r[ix['Territorry']]),
                        s(r[ix['Container Size']]), s(r[ix['Port Origin']]), s(r[ix['Port Of Discharge']]).upper()]
    R['po_lines'] = lines; R['po_created'] = {k: sorted(v)[0] for k, v in created.items()}; R['po_ship'] = ship
    return R
