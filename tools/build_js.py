"""Write the app's data files from a parsed workbook: sales/GRN/PO-derived parts
are rebuilt, everything from Stock Data is kept as it is in the current files.
usage: build_js.py <workbook.pkl> <src js dir> <out js dir> <as-of YYYY-MM-DD> <source file name> <stock workbook.pkl>
See README.md in this folder."""
import sys, json, pickle, re, os
PKL, SRC, OUT, ASOF, NAME, STOCKPKL = sys.argv[1:7]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from derive import derive, MON, sheet, s
from salesval import sales_values, BANDS

D = pickle.load(open(PKL, 'rb'))
dump = lambda v: json.dumps(v, separators=(',', ':'), ensure_ascii=False)

def split_consts(text):
    """[(prefix_text, name, literal)] + tail, literal = text between 'const NAME = ' and the ';\\n' ending it."""
    parts = []; pos = 0
    for m in re.finditer(r'^const ([A-Z_]+) = ', text, re.M):
        start = m.end()
        end = text.index(';\n', start)
        parts.append([text[pos:m.start()], m.group(1), text[start:end]])
        pos = end
    return parts, text[pos:]
def join_consts(parts, tail):
    return ''.join(p + 'const ' + n + ' = ' + lit for p, n, lit in parts) + tail
def stamp(text, old, new): return text.replace(old, new)

data_txt = open(os.path.join(SRC, 'data.js'), encoding='utf8').read()
parts, tail = split_consts(data_txt)
lit = {n: i for i, (_, n, _) in enumerate(parts)}
items = json.loads(parts[lit['ITEMS']][2])
codes = {it['Item Code'] for it in items}
vend = {it['Item Code']: it['Vendor Code'] for it in items}
retail = {st for b in json.loads(parts[lit['BRANCH_SOLD_BY_ITEM']][2]).values() for st in b}
R = derive(D, codes, vend, retail)

for it in items:
    ys = R['years'][it['Item Code']]
    it['years'] = ys
    last = None
    for y in sorted(ys):
        for m, q in enumerate(ys[y]['sales']):
            if q != 0: last = (y, m, q)
    it['Last Sold Date'] = MON[last[1]] + ' ' + last[0] if last else ''
    it['Last Sold Qty'] = last[2] if last else 0
parts[lit['ITEMS']][2] = dump(items)
parts[lit['BRANCH_SOLD_BY_ITEM']][2] = dump(R['branch_sold'])
out = join_consts(parts, tail)
src_name = re.search(r'"(2XL Data [^"]+)"', data_txt).group(1)
out = out.replace('FULL DATA — ingested from "' + src_name + '"',
                  'FULL DATA — stock from "' + src_name + '"; GRN, PO and sales from "' + NAME + '"') if NAME not in src_name else out
open(os.path.join(OUT, 'data.js'), 'w', encoding='utf8', newline='\n').write(out)

def rewrite(fname, values, header_from=None):
    t = open(os.path.join(SRC, fname), encoding='utf8').read()
    p, tl = split_consts(t)
    for row in p:
        if row[1] in values: row[2] = values[row[1]]
    t = join_consts(p, tl)
    t = re.sub(r'"2XL Data [^"]+"', '"' + NAME + '"', t, count=1)
    open(os.path.join(OUT, fname), 'w', encoding='utf8', newline='\n').write(t)

rewrite('branch-monthly.js', {'BRANCH_MONTHLY_SOLD_BY_ITEM': dump(R['branch_monthly'])})
rewrite('po-data.js', {'DATA_AS_OF': "'" + ASOF + "'", 'PO_LINES': dump(R['po_lines']), 'PO_CREATED': dump(R['po_created']), 'PO_SHIP': dump(R['po_ship'])})
lt = R['lead_times']
rewrite('lead-times.js', {'LEAD_TIMES': '{ overall: ' + str(lt['overall']) + ', MIN_LEAD_RECEIPTS: 3, vendors: ' + dump(lt['vendors']) + ' }'})

# sales values + consignment items (Cons. Status from the stock workbook's Stock Data)
sv, last_month = sales_values(D, codes)
SD = pickle.load(open(STOCKPKL, 'rb'))
ix, rows = sheet(SD, 'Stock Data')
cons_items = sorted({s(r[ix['Item Code']]) for r in rows if s(r[ix['Cons. Status']]).lower() == 'yes'} & codes)
open(os.path.join(OUT, 'sales-values.js'), 'w', encoding='utf8', newline='\n').write(
    '/* ============================================================\n'
    '   SALES VALUES -- from the Sales 2024/2025/2026 sheets of "' + NAME + '",\n'
    '   for the Dashboard\'s Discount Banding. Per item, one row per\n'
    '   (month, discount band, consignment) group of sales lines:\n'
    '   [monthIdx, band, cons, qty, cost, rsp, net, disc]\n'
    '   monthIdx = (year - 2024) * 12 + month (0 = Jan 2024). band = index into\n'
    '   DASH_DISC_BANDS, from each sales line\'s own Tot Discount Amount / Tot RSP\n'
    '   (the discount it actually sold at; RSP 0 = No Price). cons = 1 when the\n'
    '   line\'s Cons. Status is Yes. cost = Tot Sales Cost (COGS), rsp = Tot RSP,\n'
    '   net = Tot NET (after discount, before VAT), disc = Tot Discount Amount.\n'
    '   SALES_LAST_MONTH: monthIdx of the latest month on file -- the rolling\n'
    '   3M/6M/... windows end there.\n'
    '   CONS_ITEMS: item codes whose Stock Data Cons. Status is Yes (stock side).\n'
    '   ============================================================ */\n'
    'const SALES_LAST_MONTH = ' + str(last_month) + ';\n'
    'const CONS_ITEMS = new Set(' + dump(cons_items) + ');\n'
    'const SALES_VALUES = ' + dump(sv) + ';\n')
print('items', len(items), 'sales-values items', len(sv), 'last month', last_month, 'cons items', len(cons_items),
      'po lines', len(R['po_lines']), 'lead vendors', len(lt['vendors']), 'overall', lt['overall'])
