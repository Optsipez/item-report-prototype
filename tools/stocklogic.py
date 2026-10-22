"""The "Stock SetUp" sheet's formulas, done in code: from one raw IT stock row
(the "Raw - Stock Data" layout) work out the stock rollups, U-Lrcv, the
Action keep/drop and the 2XL CPC correction. Each function names the Stock
SetUp column it reproduces. Excel quirks are kept on purpose so the results
match the workbook exactly -- see check_stock_setup() in stock_import.py.
`r` is a dict: raw column header -> value."""
import datetime

def n(v):
    """Excel's (x*1): number, numeric text -> number; blank/other -> 0."""
    if isinstance(v, bool): return float(v)
    if isinstance(v, (int, float)): return float(v)
    if isinstance(v, (datetime.datetime, datetime.date)): return 1.0   # a date is a positive serial
    try: return float(str(v).strip()) if str(v).strip() else 0.0
    except ValueError: return 0.0
def t(v): return '' if v is None else str(v).strip()
pos = lambda v: max(n(v), 0.0)              # IF(x<0,0,x)

STORES = {   # Stock SetUp DU..EF: store = own stock + its clearance corner + display, negatives as 0
    'REGUS': ('REGUS', 'CL-REGUS', 'REGUS-DM'), 'MARIN': ('MARIN', 'CL-MARIN', 'MARIN-DM'), 'JUMRA': ('JUMRA', 'CL-JUMRA', 'JUMRA-DM'),
    'DALMA': ('DALMA', 'DALMA-DM'), 'ALNML': ('ALNML', 'ALNML-DM'), 'GALER': ('GALER', 'GALER-DM'), 'RAKMA': ('RAKMA', 'RAKMA-DM'),
    'ZAHIA': ('ZAHIA', 'ZAHIA-DM'), 'PARKC': ('PARKC', 'PARKC-DM'), 'BARSHA': ('BRSHA', 'BRSHA-DM'), 'WEBSTR': ('WEBSTR',), 'CLRNC': ('CLRNC', 'CL-DCSHJ'),
}
DISPLAY = ('REGUS-DM', 'MARIN-DM', 'JUMRA-DM', 'DALMA-DM', 'ALNML-DM', 'GALER-DM', 'RAKMA-DM', 'ZAHIA-DM', 'PARKC-DM', 'BRSHA-DM')
WH_OTHER = ('WRKSH', 'WRKSH-DIP', 'WRKSH-DC', 'EXSTK', 'HO-RESRV', 'PROJ-WH', 'RESRV', 'BTS-SAJ', 'TRANSIT', 'SPA-DC')

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
