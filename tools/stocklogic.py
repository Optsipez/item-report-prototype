"""The "Stock SetUp" sheet's formulas, done in code: from one raw IT stock row
(the "Raw - Stock Data" layout) work out the stock rollups, U-Lrcv, the
Action keep/drop and the 2XL CPC correction. Each function names the Stock
SetUp column it reproduces. Excel quirks are kept on purpose so the results
match the workbook exactly.
`r` is a dict: raw column header -> value."""
import datetime, decimal, collections

def n(v):
    """Excel's (x*1): number, numeric text -> number; blank/other -> 0."""
    if isinstance(v, bool): return float(v)
    if isinstance(v, (int, float)): return float(v)
    if isinstance(v, (datetime.datetime, datetime.date)): return 1.0   # a date is a positive serial
    try: return float(str(v).strip()) if str(v).strip() else 0.0
    except ValueError: return 0.0
def xl_round(v, d=0):
    """Excel's ROUND: .5 goes away from zero. Whole results stay ints."""
    x = decimal.Decimal(repr(n(v))).quantize(decimal.Decimal(1).scaleb(-d), rounding=decimal.ROUND_HALF_UP)
    return int(x) if x == x.to_integral_value() else float(x)
def t(v): return '' if v is None else str(v).strip()
pos = lambda v: max(n(v), 0.0)              # IF(x<0,0,x)

STORES = {   # Stock SetUp DU..EF: store = own stock + its clearance corner + display, negatives as 0
    'REGUS': ('REGUS', 'CL-REGUS', 'REGUS-DM'), 'MARIN': ('MARIN', 'CL-MARIN', 'MARIN-DM'), 'JUMRA': ('JUMRA', 'CL-JUMRA', 'JUMRA-DM'),
    'DALMA': ('DALMA', 'DALMA-DM'), 'ALNML': ('ALNML', 'ALNML-DM'), 'GALER': ('GALER', 'GALER-DM'), 'RAKMA': ('RAKMA', 'RAKMA-DM'),
    'ZAHIA': ('ZAHIA', 'ZAHIA-DM'), 'PARKC': ('PARKC', 'PARKC-DM'), 'BARSHA': ('BRSHA', 'BRSHA-DM'), 'WEBSTR': ('WEBSTR',), 'CLRNC': ('CLRNC', 'CL-DCSHJ'),
}
DISPLAY = ('REGUS-DM', 'MARIN-DM', 'JUMRA-DM', 'DALMA-DM', 'ALNML-DM', 'GALER-DM', 'RAKMA-DM', 'ZAHIA-DM', 'PARKC-DM', 'BRSHA-DM')
WH_OTHER = ('WRKSH', 'WRKSH-DIP', 'WRKSH-DC', 'EXSTK', 'HO-RESRV', 'PROJ-WH', 'RESRV', 'BTS-SAJ', 'TRANSIT', 'SPA-DC')
# The raw sheet's whole layout (22-Oct-26). The import stops on any difference: a
# renamed column would read as 0 and a new store is a new column nothing adds up.
RAW_COLUMNS = (
    'Item Code', 'Description', 'Supp Item Code', 'Sup. Desc', 'Category Code', 'Category Desc', 'Department Code', 'Department Desc', 'Group Code', 'Group Desc',
    'Subgroup Code', 'Subgroup Desc', 'Range Name', 'Item Color Code', 'Item Color Name', 'Secondary Colour', 'Option Rem', 'PUDA Code', 'PUDA Desc', 'Price Point',
    'Product Info', 'Lifestyle', 'Event', 'Vendor Code', 'Vendor Name', 'Current Plan Code', 'Country Of Origin', 'Currency Code', 'First FOB', 'Previous FOB Cost',
    'Latest FOB Cost', 'Inner UOM', 'Outer UOM', 'CBM', 'Cons. Status', 'Material Details', 'Available Colors', 'Available Sizes', 'Feature 1', 'Feature 2',
    'Feature 3', 'Feature 4', 'QR CODE', 'Item Creation Date', 'U-Landede Unit Cost (Aed)', 'U-WAS Unit Price (Aed)', 'U-Now Unit Price (Aed)', 'U-SOH',
    'U-Last Purchase Date', 'U-Last Purchase Date Old', 'U-First Transfer Date', 'U-Last Transfer Date', 'U-UOM', 'U-Tot Pending Order Qty', 'U-Purchase Quantity',
    'U-Last Sold Date', 'U-Tot Sold Qty', 'U-Item Family', 'U-Offer No.', 'M-Landede Unit Cost (OM)', 'M-WAS Unit Price (OM)', 'M-Now Unit Price (OM)', 'M-SOH',
    'M-Last Purchase Date', 'M-Last Purchase Date Old', 'M-First Transfer Date', 'M-Last Transfer Date', 'M-Tot Pending Order Qty', 'M-Purchase Quantity',
    'M-Last Sold Date', 'M-Tot Sold Qty', 'M-MOMAN', 'M-MOMAN-DG', 'M-WHOMN', 'M-WHOMN-DG', 'SAJWH', 'DCSHJ', 'REGUS', 'MARIN', 'JUMRA', 'DALMA', 'ALNML', 'GALER',
    'RAKMA', 'ZAHIA', 'PARKC', 'BRSHA', 'CLRNC', 'CL-DCSHJ', 'WEBSTR', 'SAJWH-DG', 'DG-DCSHJ', 'REGUS-DG', 'MARIN-DG', 'JUMRA-DG', 'DALMA-DG', 'ALNML-DG', 'GALER-DG',
    'RAKMA-DG', 'ZAHIA-DG', 'PARKC-DG', 'BRSHA-DG', 'AJMWH-DG', 'DIPWH-DG', 'WRKSH', 'WRKSH-DIP', 'WRKSH-DC', 'CL-JUMRA', 'CL-MARIN', 'CL-REGUS', 'EXSTK', 'HO-RESRV',
    'PROJ-WH', 'RESRV', 'BTS-SAJ', 'TRANSIT', 'NRDMG-DIP', 'NRDMG-AJM', 'SPA-DC', 'U-B1G1 No.', 'REGUS-DM', 'MARIN-DM', 'JUMRA-DM', 'DALMA-DM', 'ALNML-DM', 'GALER-DM',
    'RAKMA-DM', 'ZAHIA-DM', 'PARKC-DM', 'BRSHA-DM', 'Size Master', 'Fabric', 'Scond Mtrl',
)

def vendor_currencies(rows):
    """Vendor Code -> its Currency Code across every raw item, kept or not, for a
    FOB with no currency of its own. A vendor with several is left out, not guessed."""
    seen = collections.defaultdict(set)
    for r in rows:
        if t(r.get('Currency Code')): seen[t(r.get('Vendor Code'))].add(t(r.get('Currency Code')))
    return {v: next(iter(c)) for v, c in seen.items() if len(c) == 1}

def rollups(r):
    u_wh = 0.0 if n(r.get('DCSHJ')) < 0 else n(r.get('DCSHJ')) + pos(r.get('SAJWH'))         # DO: IF(DCSHJ<0,0,DCSHJ+IF(SAJWH<0,0,SAJWH))
    u_stores = sum(pos(r.get(c)) for cols in STORES.values() for c in cols)                  # DP = SUM(DU:EF)
    u_po = pos(r.get('U-Tot Pending Order Qty'))                                             # DQ
    u_wh_other = next((n(r.get(c)) for c in WH_OTHER if n(r.get(c)) > 0), 0.0)                # DR: FIRST positive bucket (nested IF), not a sum
    u_display = sum(n(r.get(c)) for c in DISPLAY if n(r.get(c)) > 0)                          # DT
    m_wh, m_store, m_po = pos(r.get('M-WHOMN')), pos(r.get('M-MOMAN')), pos(r.get('M-Tot Pending Order Qty'))   # DJ, DK, DL
    soh_tot = m_wh + m_store + m_po + u_wh + u_stores + u_display                           # GQ (Qatar/KSA columns are empty)
    return {'u_wh': u_wh, 'u_stores': u_stores, 'u_po': u_po, 'u_wh_other': u_wh_other, 'u_display': u_display,
            'soh_tot': soh_tot, 'stock_po': soh_tot + u_po}                                    # GR

def u_lrcv(r, R):
    """BN U-Lrcv: last purchase date, else the old one, else the first transfer
    date when total stock (WH + stores + PO + other WH) is under 5, else
    'New' (Plan N) / 'No-Stk' (no stock) / 01-Jan-2015."""
    for c in ('U-Last Purchase Date', 'U-Last Purchase Date Old'):
        if n(r.get(c)) > 0: return r.get(c)
    total = R['u_wh'] + R['u_stores'] + R['u_po'] + R['u_wh_other']
    if n(r.get('U-First Transfer Date')) > 0 and total < 5: return r.get('U-First Transfer Date')
    if t(r.get('Current Plan Code')) == 'N': return 'New'
    if total <= 0: return 'No-Stk'
    return datetime.datetime(2015, 1, 1)

def cpc_correction(r, R):
    """GX "2XL CPC: Corrections For the Day"."""
    plan = t(r.get('Current Plan Code'))
    if plan == 'N' and R['soh_tot'] > 0: return 'A'
    if plan == 'B' and R['soh_tot'] > 0: return 'U'
    if plan == 'U' and R['soh_tot'] > 0: return 'U'
    if plan == 'D' and R['stock_po'] <= 0: return 'B'
    return plan

def actions(r, R, cpc):
    """GV Action-1, GU Action-2, GT Action-3, GW Action- FINAL."""
    plan, catg, sp = t(r.get('Current Plan Code')), t(r.get('Category Code')), R['stock_po']
    a1 = 'Out-N-0' if plan == 'N' and sp <= 0 else 'Out-MR' if plan in ('M', 'R') else 'Keep-1' if catg in ('A', 'F', 'K') else 'WOS'
    a2 = a1 if a1 != 'WOS' else ('Keep-WOS' if sp > 0 else 'Out-WOS')
    if t(r.get('Cons. Status')) == 'Yes': a3 = 'Out-Consgn'
    elif a2 in ('Out-N-0', 'Out-WOS', 'Keep-WOS'): a3 = a2
    elif a1 == 'Out-MR': a3 = 'Out-MR'
    elif a1 == 'Keep-1' and plan in ('B', 'U') and sp < 1: a3 = 'Out-BU-0'
    elif cpc in ('B', 'D', 'U', 'H') and sp <= 0: a3 = 'Out-BDU-0'
    else: a3 = 'Keep-1'
    return a1, a2, a3, ('Keep-Fnl' if a3.startswith('Keep') else 'Out-Rst')

def evaluate(r):
    R = rollups(r)
    cpc = cpc_correction(r, R)
    a1, a2, a3, fin = actions(r, R, cpc)
    return dict(R, cpc=cpc, lrcv=u_lrcv(r, R), action1=a1, action2=a2, action3=a3, final=fin)
