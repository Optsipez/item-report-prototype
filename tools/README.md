# Data import

Rebuilds the app's data files in `js/` from a "2XL Data" workbook. Not loaded by the app.

| Script | What it does |
|---|---|
| `dump.py` | Reads every sheet of a workbook into a `.pkl` cache. This is the slow step, about 10 min per file. |
| `derive.py` | Builds the GRN, PO and sales-derived data: monthly sold/received, branch sales, PO lines/dates/shipping, lead times. |
| `salesval.py` | Builds the sales values for Discount Banding: qty, COGS, RSP, net and discount per item, month, actual discount band and consignment flag. |
| `build_js.py` | Writes `data.js`, `branch-monthly.js`, `po-data.js`, `lead-times.js` and `sales-values.js`. |

**Stock Data is never re-read.** Every stock field already in `js/data.js` (item list, prices, SOH, branch stock, Lrcv, PO-Qty, …) is kept as it is. A workbook with a new Stock sheet needs its own stock import, which doesn't exist yet. `item-attrs.js` is also stock-derived and is not touched.

`derive.py` was checked to reproduce the 16-Sep data exactly. The rules it encodes:
- Monthly sales: whole units per month (fractions dropped).
- Lead times: only receipts 7–400 days after the order; medians rounded half up.
- PO descriptions: double spaces collapsed.
- Ports: uppercase.

## Refresh

Needs Python 3 with `openpyxl`. Run from the project root, and keep the `.pkl` files outside the project (they're large).

```sh
# 1. cache the new workbook (and the workbook the stock comes from, if it isn't cached already)
python tools/dump.py "../2XL Data 25-Sep-26.xlsm" /tmp/x25.pkl
python tools/dump.py "../2XL Data 16-Sep-26.xlsx" /tmp/x16.pkl

# 2. build into a scratch folder:
#    new workbook, current js dir, out dir, as-of date, source name, stock workbook
mkdir /tmp/out
python tools/build_js.py /tmp/x25.pkl js /tmp/out 2026-09-25 "2XL Data 25-Sep-26.xlsm" /tmp/x16.pkl

# 3. check the printed counts, then copy over and test the app
cp /tmp/out/*.js js/
```

`build_js.py` prints the counts: items, sales-values items, last sales month, consignment items, PO lines and lead-time vendors. A sudden drop in any of them means the workbook's columns changed.

Column names it relies on:
- **Sales:** `Item No`, `Year Name`, `Month Name`, `Store No`, `Territorry`, `Tot Sold Quantity`, `Tot Sales Cost`, `Tot RSP`, `Tot NET`, `Tot Discount Amount`, `Cons. Status`
- **GRN:** `SKU`, `GRN DATE`, `Order Date`, `Quantity`
- **PO:** see `derive.py`
