"""Build one workbook cache from sheets of several (dump.py caches) -- e.g. a
file whose Sales 2024/2025 sheets came empty takes those from an older file.
usage: merge_pkl.py <out.pkl> "<sheet>=<file.pkl>" ...
  python tools/merge_pkl.py /tmp/sales.pkl "Sales 2024=/tmp/x25.pkl" "Sales 2025=/tmp/x25.pkl" "Sales 2026=/tmp/x22.pkl" "GRN Data=/tmp/x25.pkl" "PO Data=/tmp/x25.pkl"
"""
import sys, pickle
out, specs = sys.argv[1], sys.argv[2:]
cache, D = {}, {}
for spec in specs:
    sheet, path = spec.split('=', 1)
    if path not in cache: cache[path] = pickle.load(open(path, 'rb'))
    rows = cache[path][sheet]
    if len(rows) < 2: sys.exit('"%s" in %s is empty' % (sheet, path))
    D[sheet] = rows
    print('%-12s %8d rows  from %s' % (sheet, len(rows) - 1, path))
pickle.dump(D, open(out, 'wb'))
