"""Sales values per item x month x actual-discount band x consignment, from a
parsed workbook. Band = Tot Discount Amount / Tot RSP on each sales line, using
the same thresholds as the Dashboard's DASH_DISC_BANDS (dashDiscBand)."""
import collections
from derive import sheet, s, num, MON

BANDS = ['No Price', '0-10%', '11-20%', '21-30%', '31-40%', '41-50%', '51-60%', '61-70%', '71-80%', 'Above 80%']
def band(disc, rsp):
    if rsp == 0: return 0
    d = disc / rsp   # a return has negative RSP and discount: same ratio as the sale it reverses
    for i, cut in enumerate((0.104, 0.204, 0.304, 0.404, 0.504, 0.604, 0.704)):
        if d < cut: return i + 1
    return 8 if d <= 0.80401 else 9

def sales_values(D, item_codes):
    agg = collections.defaultdict(lambda: [0.0, 0.0, 0.0, 0.0, 0.0])   # (item, ym, band, cons) -> qty, cost, rsp, net, disc
    last_month = 0
    for y in ('2024', '2025', '2026'):
        ix, rows = sheet(D, 'Sales ' + y)
        for r in rows:
            c = s(r[ix['Item No']])
            if not c or c not in item_codes: continue
            ym = (int(s(r[ix['Year Name']])) - 2024) * 12 + MON.index(s(r[ix['Month Name']]))
            rsp = num(r[ix['Tot RSP']])
            k = (c, ym, band(num(r[ix['Tot Discount Amount']]), rsp), 1 if s(r[ix['Cons. Status']]).lower() == 'yes' else 0)
            a = agg[k]
            a[0] += num(r[ix['Tot Sold Quantity']]); a[1] += num(r[ix['Tot Sales Cost']]); a[2] += rsp; a[3] += num(r[ix['Tot NET']]); a[4] += num(r[ix['Tot Discount Amount']])
            last_month = max(last_month, ym)
    out = collections.defaultdict(list)
    for (c, ym, b, cons), a in agg.items():
        out[c].append([ym, b, cons] + [round(v, 2) for v in a])
    return out, last_month
