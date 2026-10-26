"""Stock import: raw IT stock -> the app's item data.

The raw sheet ("Raw - Stock Data" layout) goes through the Stock SetUp formulas
(stocklogic.py). Only Action-FINAL = Keep-Fnl items become the app's ITEMS; the
plan code becomes the 2XL CPC correction; Lrcv Date follows U-Lrcv. Prices are
IT's own, SOH keeps the app's definitions (built in app.js from the location
columns). Sales are kept for every item: items the stock logic drops go to
SALES_ONLY_ITEMS (attributes + monthly sales) so sales totals stay complete.

usage: stock_import.py <stock.pkl> <stock sheet> <sales.pkl> <js dir> <out dir>
                       <stock as-of YYYY-MM-DD> <stock source name> <sales source name> <sales as-of YYYY-MM-DD>
                       [<PO as-of YYYY-MM-DD>]
  stock.pkl / sales.pkl: workbooks cached by dump.py. The sales workbook gives
  the Sales, GRN sheets (sales history, Lrcv Qty); PO quantities come from the
  current js/po-data.js. See README.md."""
import sys, os, json, pickle, re, datetime, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stocklogic import evaluate, t, n
from derive import derive, MON, sheet, qty_col
from pologic import status_map, logistics, po_line, iso
from salesval import sales_values

STOCK_PKL, SHEET, SALES_PKL, SRC, OUT, ASOF, STOCK_NAME, SALES_NAME, SALES_ASOF = sys.argv[1:10]
PO_ASOF = sys.argv[10] if len(sys.argv) > 10 else None   # needed when the sales cache has PO Data + Logistics Status + SetUp
dump = lambda v: json.dumps(v, separators=(',', ':'), ensure_ascii=False)
def as_num(v):
    if isinstance(v, bool): return int(v)
    if isinstance(v, (int, float)): return v
    x = n(v); return int(x) if x == int(x) else x
def ddmmyyyy(v): return v.strftime('%d-%m-%Y') if isinstance(v, (datetime.datetime, datetime.date)) else t(v)

# ---- raw stock rows ----
SD = pickle.load(open(STOCK_PKL, 'rb'))
rows = SD[SHEET]; hdr = [t(h) for h in rows[0]]
raw = [dict(zip(hdr, r)) for r in rows[1:]]
raw = [r for r in raw if t(r.get('Item Code'))]

evals = {t(r['Item Code']): evaluate(r) for r in raw}
SA = pickle.load(open(SALES_PKL, 'rb'))

# ---- POs ----
# With a Logistics Status sheet: PO lines rebuilt from the raw PO columns via
# pologic.py (logistics status, Fnl ETD/ETA, corrected CPC). Otherwise the
# current js/po-data.js is kept as it is.
po_built = 'Logistics Status' in SA and 'SetUp' in SA
if po_built:
    smap, log = status_map(SA['SetUp']), logistics(SA['Logistics Status'])
    cpc_of = {c: E['cpc'] for c, E in evals.items()}
    pix, prows = sheet(SA, 'PO Data')
    po_lines, po_created, po_ship = [], collections.defaultdict(set), {}
    for row in prows:
        r = {h: row[i] for h, i in pix.items()}
        po = t(r.get('PO No'))
        if not po: continue
        o = po_line(r, log, smap, cpc_of)
        q = n(r.get('PO Qty'))
        po_lines.append([po, t(r['Item Code']), ' '.join(t(r.get('Description')).split()), int(q) if q == int(q) else q, iso(o['fnl_eta']),
                         t(r.get('Vendor Code')), t(r.get('Department Desc')), t(r.get('Category Desc')), o['cpc']])
        if iso(r.get('PO Creation Date')): po_created[po].add(iso(r.get('PO Creation Date')))
        if po not in po_ship:
            po_ship[po] = [iso(o['fnl_etd']), None, o['status'], t(r.get('Territorry')), t(r.get('Container Size')), t(r.get('Port Origin')), t(r.get('Port Of Discharge')).upper()]
    po_created = {k: sorted(v)[0] for k, v in po_created.items()}
else:
    po_txt = open(os.path.join(SRC, 'po-data.js'), encoding='utf8').read()
    po_lines = json.loads(re.search(r'const PO_LINES = (\[.*?\]);\n', po_txt, re.S).group(1))
    po_ship = json.loads(re.search(r'const PO_SHIP = (\{.*?\});\n', po_txt, re.S).group(1))
cancelled = {p for p, s in po_ship.items() if s[2] == 'Cancelled'}
po_qty = collections.defaultdict(float)
for l in po_lines:
    if l[0] not in cancelled: po_qty[l[1]] += l[3]        # open POs only

# ---- GRN receipts per item per day (Lrcv) ----
gix, grows = sheet(SA, 'GRN Data'); qcol = qty_col(gix)
grn_days = collections.defaultdict(lambda: collections.defaultdict(float))
for r in grows:
    d = r[gix['GRN DATE']]
    if isinstance(d, (datetime.datetime, datetime.date)): grn_days[t(r[gix['SKU']])][d.date() if isinstance(d, datetime.datetime) else d] += n(r[qcol])
# Not the transfer dates: a recent transfer would look like a fresh receipt and break the ageing.
LRCV_FALLBACK = ('U-Last Purchase Date', 'U-Last Purchase Date Old')
def last_receipt(code, r, cpc):
    """Lrcv Date, Lrcv Qty, source. 1) CPC N -> New Launch, 0. 2) GRN: the
    latest day (all that day's lines added up); if under 5 pieces, the latest
    day with 5 or more; if no day has 5, the latest. 3) No GRN: IT's U-Last
    Purchase Date, else U-Last Purchase Date Old (never the transfer dates),
    qty = the item's current SOH (filled in by the app, so None here).
    4) 01-01-2015, qty = SOH."""
    if cpc == 'N': return 'New Launch', 0, 'New Launch'
    days = grn_days.get(code)
    if days:
        ds = sorted(days, reverse=True)
        d = next((x for x in ds if days[x] >= 5), ds[0])
        return d.strftime('%d-%m-%Y'), as_num(round(days[d], 4)), 'GRN'
    for c in LRCV_FALLBACK:
        if isinstance(r.get(c), (datetime.datetime, datetime.date)): return ddmmyyyy(r.get(c)), None, c
    return '01-01-2015', None, 'Default 2015'

BR = ['SAJWH', 'DCSHJ', 'REGUS', 'MARIN', 'JUMRA', 'DALMA', 'ALNML', 'GALER', 'RAKMA', 'ZAHIA', 'PARKC', 'BRSHA', 'CLRNC', 'CL-DCSHJ', 'WEBSTR',
      'REGUS-DM', 'MARIN-DM', 'JUMRA-DM', 'DALMA-DM', 'ALNML-DM', 'GALER-DM', 'RAKMA-DM', 'ZAHIA-DM', 'PARKC-DM', 'BRSHA-DM', 'CL-JUMRA', 'CL-MARIN', 'CL-REGUS']
TEXT = {'Vendor Code': 'Vendor Code', 'Range Name': 'Range Name', 'Catg Code': 'Category Code', 'Category': 'Category Desc',
        'Department Code': 'Department Code', 'Department Desc': 'Department Desc', 'Group Code': 'Group Code', 'Group Desc': 'Group Desc',
        'Sub Group Code': 'Subgroup Code', 'Sub Group Desc': 'Subgroup Desc', 'PUDA Code': 'PUDA Code', 'PUDA Desc': 'PUDA Desc'}

items, branch, nav, sroman, attrs, dropped, outcomes = [], {}, {}, {}, {}, {}, collections.Counter()
for r in raw:
    code = t(r['Item Code']); E = evals[code]; outcomes[E['action3']] += 1
    if E['final'] != 'Keep-Fnl':
        dropped[code] = r; continue
    lc, was, now = n(r.get('U-Landede Unit Cost (Aed)')), n(r.get('U-WAS Unit Price (Aed)')), n(r.get('U-Now Unit Price (Aed)'))
    ld, lq, lsrc = last_receipt(code, r, E['cpc'])
    it = {k: t(r.get(c)) for k, c in TEXT.items()}
    it.update({
        'Current Plan Code': E['cpc'],                       # the 2XL CPC correction (shown as "CPC")
        'L-Cost (Aed)': round(lc, 2), 'Was (Aed)': as_num(r.get('U-WAS Unit Price (Aed)')), 'Now (Aed)': as_num(r.get('U-Now Unit Price (Aed)')),
        'Disct%': round((was - now) / was, 4) if was else 0, 'MRG Factor': round(now / lc, 4) if lc else 0,
        'PO-Qty': as_num(po_qty.get(code, 0)),
        'Item Code': code, 'Description': t(r.get('Description')), 'Item Color Name': t(r.get('Item Color Name')),
        'Lifestyle': t(r.get('Lifestyle')), 'Event': t(r.get('Event')).upper(),   # IT mixes 'Common'/'COMMON'
        'Vendor Name': t(r.get('Vendor Name')), 'Country Of Origin': t(r.get('Country Of Origin')),
        'Currency Code': t(r.get('Currency Code')), 'First FOB': as_num(r.get('First FOB')), 'Previous FOB Cost': as_num(r.get('Previous FOB Cost')),
        'Latest FOB Cost': as_num(r.get('Latest FOB Cost')),
        'Lrcv Date': ld, 'Lrcv Qty': lq, 'Lrcv Src': lsrc,
    })
    items.append(it)
    branch[code] = {b: int(n(r.get(b))) for b in BR}
    nav[code] = {'u': int(n(r.get('U-SOH'))), 'm': int(n(r.get('M-SOH')))}
    sroman[code] = {'pend': int(n(r.get('M-Tot Pending Order Qty'))), 'moman': int(n(r.get('M-MOMAN'))), 'whomn': int(n(r.get('M-WHOMN')))}
    a = [t(r.get('Size Master')), t(r.get('Fabric')), t(r.get('Price Point'))]
    if any(a): attrs[code] = a

kept = {it['Item Code'] for it in items}
# ---- sales: kept items get full history; every other item that ever sold becomes sales-only ----
sales_codes = set()
sales_attr = {}
for y in ('2024', '2025', '2026'):
    rs = SA.get('Sales ' + y) or []
    if not rs: continue
    six = {t(h): i for i, h in enumerate(rs[0])}
    for r in rs[1:]:
        c = t(r[six['Item No']])
        if not c: continue
        sales_codes.add(c)
        if c not in kept and c not in dropped:   # never in the stock sheet: describe it from its sales lines
            sales_attr[c] = {'Item Code': c, 'Description': t(r[six['Description']]), 'Catg Code': t(r[six['Category Code']]),
                             'Category': t(r[six['Category Desc']]), 'Department Desc': t(r[six['Department Desc']]), 'Group Desc': t(r[six['Group Desc']]),
                             'PUDA Desc': t(r[six['PUDA Desc']]), 'Range Name': t(r[six['Range Name']]), 'Vendor Code': t(r[six['Vendor Code']]),
                             'Current Plan Code': t(r[six['Current Plan Code']])}
only_codes = sales_codes - kept
vend_all = {t(r['Item Code']): t(r.get('Vendor Code')) for r in raw}   # lead times use every item's receipts
retail = {'ALNML', 'BRSHA', 'DALMA', 'GALER', 'JUMRA', 'MARIN', 'PARKC', 'RAKMA', 'REGUS', 'ZAHIA'}
R = derive(SA, kept | only_codes, vend_all, retail)
for it in items:
    ys = R['years'][it['Item Code']]; it['years'] = ys
    last = None
    for y in sorted(ys):
        for m, q in enumerate(ys[y]['sales']):
            if q != 0: last = (y, m, q)
    it['Last Sold Date'] = MON[last[1]] + ' ' + last[0] if last else ''
    it['Last Sold Qty'] = last[2] if last else 0
sales_only = []
for c in sorted(only_codes):
    ys = {y: {'sales': v['sales']} for y, v in R['years'][c].items() if any(v['sales'])}
    if not ys: continue
    r = dropped.get(c)
    a = ({'Item Code': c, 'Description': t(r.get('Description')), 'Catg Code': t(r.get('Category Code')), 'Category': t(r.get('Category Desc')),
          'Department Desc': t(r.get('Department Desc')), 'Group Desc': t(r.get('Group Desc')), 'PUDA Desc': t(r.get('PUDA Desc')),
          'Range Name': t(r.get('Range Name')), 'Vendor Code': t(r.get('Vendor Code')), 'Current Plan Code': t(r.get('Current Plan Code'))}
         if r else sales_attr[c])
    a['years'] = ys
    sales_only.append(a)
sv, last_month = sales_values(SA, kept | only_codes)
cons_yes = {t(r['Item Code']) for r in raw if t(r.get('Cons. Status')) == 'Yes'}
cons_items = sorted(kept & cons_yes)

# ---- write ----
os.makedirs(OUT, exist_ok=True)
w = lambda f, s: open(os.path.join(OUT, f), 'w', encoding='utf8', newline='\n').write(s)
w('data.js', '/* ============================================================\n'
  '   ITEMS -- stock from "' + STOCK_NAME + '" (raw IT stock run through the\n'
  '   Stock SetUp logic in tools/stocklogic.py: only Keep-Fnl items, plan code =\n'
  '   2XL CPC correction, Lrcv Date = U-Lrcv); sales and GRN history from\n'
  '   "' + SALES_NAME + '". Built by tools/stock_import.py.\n'
  '   Globals: ITEMS, BRANCH_BY_ITEM, BRANCH_SOLD_BY_ITEM, NAV_STK_BY_ITEM,\n'
  '   SR_QTY_OMAN_BY_ITEM, STOCK_AS_OF.\n'
  '   ============================================================ */\n\n'
  "const STOCK_AS_OF = '" + ASOF + "';\n\n"
  'const ITEMS = ' + dump(items) + ';\n\n'
  'const BRANCH_BY_ITEM = ' + dump(branch) + ';\n\n'
  'const BRANCH_SOLD_BY_ITEM = ' + dump({c: b for c, b in R['branch_sold'].items() if c in kept}) + ';\n\n'
  'const NAV_STK_BY_ITEM = ' + dump(nav) + ';\n\n'
  'const SR_QTY_OMAN_BY_ITEM = ' + dump(sroman) + ';\n')
w('item-attrs.js', '/* ============================================================\n'
  '   ITEM ATTRIBUTES -- Size Master, Fabric, Price Point per item, from the raw\n'
  '   stock of "' + STOCK_NAME + '". Shape: { itemCode: [sizeMaster, fabric, pricePoint] }.\n'
  '   Items with all three blank are left out. Merged onto ITEMS by app.js.\n'
  '   ============================================================ */\n'
  'const ITEM_ATTRS = ' + dump(attrs) + ';\n')
w('branch-monthly.js', '/* ============================================================\n'
  '   BRANCH-LEVEL MONTHLY SOLD -- from the Sales sheets of "' + SALES_NAME + '",\n'
  '   per item x branch x year as a 12-slot Jan..Dec array (same shape as an\n'
  '   item\'s years[year].sales). Covers ITEMS only. See branchMonthlySold() in app.js.\n'
  '   ============================================================ */\n'
  'const BRANCH_MONTHLY_SOLD_BY_ITEM = ' + dump({c: b for c, b in R['branch_monthly'].items() if c in kept}) + ';\n')
w('sales-only.js', '/* ============================================================\n'
  '   SALES-ONLY ITEMS -- items that sold but are not in ITEMS (dropped by the\n'
  '   Stock SetUp keep/drop logic, or not in the stock sheet at all). The keep/\n'
  '   drop rule is for stock only, so their sales still count in every sales\n'
  '   figure. Each: the attributes the filters use + years[year].sales.\n'
  '   Built by tools/stock_import.py.\n'
  '   ============================================================ */\n'
  'const SALES_ONLY_ITEMS = ' + dump(sales_only) + ';\n')
w('sales-values.js', '/* ============================================================\n'
  '   SALES VALUES -- from the Sales sheets of "' + SALES_NAME + '", for every\n'
  '   item that sold (ITEMS and SALES_ONLY_ITEMS). Per item, one row per\n'
  '   (month, discount band, consignment) group of sales lines:\n'
  '   [monthIdx, band, cons, qty, cost, rsp, net, disc]\n'
  '   monthIdx = (year - 2024) * 12 + month (0 = Jan 2024). band = index into\n'
  '   DASH_DISC_BANDS, from each sales line\'s own Tot Discount Amount / Tot RSP\n'
  '   (the discount it actually sold at; RSP 0 = No Price). cons = 1 when the\n'
  '   line\'s Cons. Status is Yes. cost = Tot Sales Cost (COGS), rsp = Tot RSP,\n'
  '   net = Tot NET (after discount, before VAT), disc = Tot Discount Amount.\n'
  '   SALES_LAST_MONTH: monthIdx of the latest month on file; SALES_AS_OF: the\n'
  '   date the sales run to (that month may be partial).\n'
  '   CONS_ITEMS: ITEMS whose stock Cons. Status is Yes (stock side).\n'
  '   ============================================================ */\n'
  'const SALES_LAST_MONTH = ' + str(last_month) + ';\n'
  "const SALES_AS_OF = '" + SALES_ASOF + "';\n"
  'const CONS_ITEMS = new Set(' + dump(cons_items) + ');\n'
  'const SALES_VALUES = ' + dump(sv) + ';\n')
if po_built:
    w('po-data.js', '/* ============================================================\n'
      '   OPEN PURCHASE ORDERS -- from the PO Data + Logistics Status sheets of\n'
      '   "' + SALES_NAME + '", worked out by tools/pologic.py (the PO Data\n'
      '   sheet\'s formulas). One row per PO line:\n'
      '   [PO No, Item Code, Description, PO Qty, Fnl ETA, Vendor Code, Department,\n'
      '    Category, CPC]\n'
      '   Fnl ETA = logistics\' New ETA, else the Arrival Date. CPC = the item\'s\n'
      '   corrected stock CPC (2XL CPC correction), else the PO\'s own.\n'
      '   DATA_AS_OF is the PO export date -- a PO whose Fnl ETA is before it and\n'
      '   is still listed here is late. See dashboard.js.\n'
      '   ============================================================ */\n'
      "const DATA_AS_OF = '" + PO_ASOF + "';\n"
      'const PO_LINES = ' + dump(po_lines) + ';\n'
      '/* PO Creation Date per PO (earliest if a PO has several). */\n'
      'const PO_CREATED = ' + dump(po_created) + ';\n'
      '/* Per PO: [Fnl ETD, (unused), Status, Territory, Container Size, Port Origin,\n'
      '   Port Of Discharge]. Fnl ETD = logistics\' New ETD, else Revised Ship Date,\n'
      '   else Ship Date. Status = logistics status mapped through SetUp (Under\n'
      '   Proces / Short Ship / Next Booking -> Pending; no logistics entry ->\n'
      '   Pending). Cancelled POs stay listed but are not counted as open. */\n'
      'const PO_SHIP = ' + dump(po_ship) + ';\n')
    print('PO lines', len(po_lines), 'POs', len(po_ship), 'status', dict(collections.Counter(s[2] for s in po_ship.values())), 'cancelled', len(cancelled))
lt = R['lead_times']
w('lead-times.js', '/* ============================================================\n'
  '   SUPPLIER LEAD TIMES -- from the GRN Data sheet of "' + SALES_NAME + '": for\n'
  '   every receipt 7-400 days after its order date, days from order to GRN,\n'
  '   median per vendor (vendor = each SKU\'s Vendor Code in the raw stock, all\n'
  '   items, kept or not). vendors: { VendorCode: [median days, receipts measured] }.\n'
  '   overall: median across every receipt, used when a vendor has too few\n'
  '   (under MIN_LEAD_RECEIPTS) to trust. See dashboard.js.\n'
  '   ============================================================ */\n'
  'const LEAD_TIMES = { overall: ' + str(lt['overall']) + ', MIN_LEAD_RECEIPTS: 3, vendors: ' + dump(lt['vendors']) + ' };\n')
print('lead-time vendors', len(lt['vendors']), 'overall', lt['overall'])
print('raw items', len(raw), '| kept', len(items), '| dropped', len(dropped), '| sales-only', len(sales_only),
      '| Action-3', dict(outcomes.most_common()), '| sales last month', last_month)
