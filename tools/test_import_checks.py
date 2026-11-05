"""The import's safety checks on small made-up sheets: python tools/test_import_checks.py"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from derive import check_sources, sales_years, SALES_COLUMNS, GRN_COLUMNS, PO_COLUMNS, LOGISTICS_COLUMNS
from salesval import sales_values
from stocklogic import RAW_COLUMNS, vendor_currencies

def sales_sheet(year, store='REGUS'):
    row = {'Item No': '1', 'Year Name': year, 'Month Name': 'January', 'Store No': store, 'Tot Sold Quantity': 2, 'Tot Sales Cost': 10, 'Tot RSP': 20, 'Tot NET': 20, 'Tot Discount Amount': 0, 'Cons. Status': 'No'}
    return [list(SALES_COLUMNS), [row.get(c, '') for c in SALES_COLUMNS]]
def good():
    log = [[''] * 8, [LOGISTICS_COLUMNS.get(i, '') for i in range(8)]]
    return {'Sales 2024': sales_sheet('2024'), 'Sales 2025': sales_sheet('2025'), 'Sales 2026': sales_sheet('2026'), 'Sales 2027': sales_sheet('2027'),
            'GRN Data': [list(GRN_COLUMNS) + ['Posted Quantity']], 'PO Data': [list(PO_COLUMNS)], 'Logistics Status': log}
def stops(hdr, D, text):
    try: check_sources(hdr, D)
    except SystemExit as e:
        assert text in str(e), str(e)
        return
    raise AssertionError('should have stopped: ' + text)

HDR = list(RAW_COLUMNS)
check_sources(HDR, good())
stops([c for c in HDR if c != 'SAJWH'], good(), "missing column(s) ['SAJWH']")
stops(HDR + ['NEWST'], good(), "unknown column(s) ['NEWST']")
for name, col in (('Sales 2026', 'Tot NET'), ('GRN Data', 'GRN DATE'), ('PO Data', 'FOB Cost LCY')):
    D = good(); D[name][0][D[name][0].index(col)] = 'renamed'
    stops(HDR, D, name + ": missing column(s) ['" + col + "']")
D = good(); D['Logistics Status'][1][2], D['Logistics Status'][1][3] = 'New ETA', 'New ETD'
stops(HDR, D, 'New ETD should be column C')
D = good(); D['Sales 2027'] = sales_sheet('2027', 'NEWST')
stops(HDR, D, "unknown store(s) ['NEWST']")
D = good(); del D['Sales 2025']
stops(HDR, D, 'no gaps or empty years')
D = good(); D['Sales 2027'] = D['Sales 2027'][:1]
stops(HDR, D, 'no gaps or empty years')
assert sales_years(good()) == ['2024', '2025', '2026', '2027']
out, last = sales_values(good(), {'1'})
assert last == 36 and [r[0] for r in out['1']] == [0, 12, 24, 36], (last, out)   # Jan 2027 is month 36
V = lambda v, c: {'Vendor Code': v, 'Currency Code': c}
assert vendor_currencies([V('A', ''), V('A', 'USD'), V('A', 'USD'), V('A', 'EUR'), V('B', '')]) == {'A': 'USD'}   # most used; B has none
print('ok')
