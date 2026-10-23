# Data import

Rebuilds the app's data files in `js/` from a "2XL Data" workbook. Not loaded by the app.

## Stock (raw IT stock → app), `stock_import.py` + `stocklogic.py`

`stocklogic.py` is the workbook's **Stock SetUp** sheet done in code. From one raw IT stock row (the "Raw - Stock Data" layout) it works out:
- the stock rollups: U-WH Stk, U-Stores, U-PO, U-WH (Prj+Rvs+Exta), display, SOH TOT and Stock+PO Total
- **U-Lrcv**
- **Action-1/2/3/FINAL**
- the **2XL CPC correction**

Excel's quirks are kept on purpose; for example, the projects/reserve bucket takes the *first* positive location, not the sum. It was checked against every value Stock SetUp calculated, for all 29,514 items of the 22-Oct workbook, with no differences.

`stock_import.py` turns the raw stock into the app's items:
- **Which items:** only items with Action-FINAL = Keep-Fnl exist in the app (`ITEMS`).
- **Plan code:** "Current Plan Code" is the CPC correction, shown as **CPC**.
- **Lrcv Date:** U-Lrcv: a date, `New`, `No-Stk`, or 01-01-2015.
- **Lrcv Qty:** the GRN quantity on that date, otherwise IT's U-Purchase Quantity.
- **Prices:** IT's own values. **SOH:** built in app.js from the location columns, as before.
- **PO-Qty:** the total from the current `js/po-data.js`.
- **Sales:** taken from the sales workbook for **every** item. Items the stock rules drop still sell, so they go to `SALES_ONLY_ITEMS` (`sales-only.js`): attributes plus monthly sales. Dashboard sales figures add them in; stock figures don't.

It writes `data.js`, `item-attrs.js`, `branch-monthly.js`, `sales-values.js`, `sales-only.js` and `lead-times.js` (from GRN). `po-data.js` is left alone. GRN: the header row is found automatically (the 22-Oct sheet has a stale header in row 1) and the quantity is "Posted Quantity" (or "Quantity" in older files). "Actual P.O Qty" equals Posted Quantity on every 2024+ row and is not used.

```sh
python tools/dump.py "../2XL Data 22-Oct-26.xlsm" /tmp/x22.pkl     # newest workbook
python tools/dump.py "../2XL Data 25-Sep-26.xlsm" /tmp/x25.pkl     # older one (has Sales 2024/2025)
# one sales source: sheets can come from different workbooks (22-Oct's Sales 2024/2025 are empty)
python tools/merge_pkl.py /tmp/sales.pkl "Sales 2024=/tmp/x25.pkl" "Sales 2025=/tmp/x25.pkl" "Sales 2026=/tmp/x22.pkl" "GRN Data=/tmp/x22.pkl" "PO Data=/tmp/x25.pkl"
python tools/stock_import.py /tmp/x22.pkl "Raw - Stock Data" /tmp/sales.pkl js /tmp/out 2026-10-22 "2XL Data 22-Oct-26.xlsm" "22-Oct (Sales 2026, GRN) + 25-Sep (Sales 2024-25)" 2026-10-22
cp /tmp/out/*.js js/
```

Arguments, in order:
1. stock cache and sheet
2. sales cache
3. current `js/` folder (for PO quantities)
4. output folder
5. stock date
6. stock source name
7. sales source name
8. sales date

The sales date becomes `SALES_AS_OF`. The app shows it separately from the stock date (`STOCK_AS_OF`) and the PO date (`DATA_AS_OF`).

`merge_pkl.py` stops with an error if a sheet you name is empty, so an empty sheet can't silently wipe history.

**Lrcv Date / Qty** (replaces U-Lrcv). Each step applies only if the one before found nothing:
1. **CPC N:** `New Launch`, qty 0.
2. **GRN:** the latest day an item was received (all that day's lines added up). If that day is under 5 pieces, use the latest day with 5 or more. If no day has 5, use the latest day.
3. **No GRN record:** IT's U-Last Purchase Date, else U-Last Purchase Date Old. The transfer dates are never used, because a recent transfer would look like a fresh receipt and break the ageing. The qty is the item's current SOH, set by the app.
4. **Nothing at all:** 01-01-2015, qty = SOH.

`Lrcv Src` records the source. The app colours steps 3 and 4 (`lrcv-est`), since those dates aren't real GRN receipts.

**POs** (`pologic.py`, the PO Data sheet's formulas) are rebuilt when the sales cache also has **PO Data, Logistics Status and SetUp**. Otherwise `js/po-data.js` is kept as it is.
- **Status:** the Logistics Status entry (PO numbers cleaned of split-shipment suffixes like PO-20453-2), mapped through SetUp D:G (Under Proces / Short Ship / Next Booking → Pending; no entry → Pending).
- **Fnl ETD:** logistics' New ETD, else Revised Ship Date, else Ship Date.
- **Fnl ETA:** logistics' New ETA, else Arrival Date.
- **CPC:** the corrected stock CPC, else the PO's own.

Checked against all 4,185 lines of the 22-Oct workbook: identical, except 7 lines whose CPC is deliberately the corrected one (N → A). Cancelled POs stay listed, but don't count as open PO quantity. The PO date is the last (10th) argument.

```sh
python tools/merge_pkl.py /tmp/sales.pkl "Sales 2024=/tmp/x25.pkl" "Sales 2025=/tmp/x25.pkl" "Sales 2026=/tmp/x22.pkl" "GRN Data=/tmp/x22.pkl" "PO Data=/tmp/x22.pkl" "Logistics Status=/tmp/x22.pkl" "SetUp=/tmp/x22.pkl"
python tools/stock_import.py /tmp/x22.pkl "Raw - Stock Data" /tmp/sales.pkl js /tmp/out 2026-10-22 "2XL Data 22-Oct-26.xlsm" "2XL Data 22-Oct-26.xlsm (Sales 2024-25 from 25-Sep)" 2026-10-22 2026-10-22
```

It prints the counts: kept, dropped, sales-only, and the Action-3 breakdown. Compare them with the workbook's own pivot.

**Note:** `build_js.py` (below) predates this. It rewrites `data.js` from the *current* items, so for a sales or PO refresh run `stock_import.py` again with the new sales workbook rather than `build_js.py`'s data.js. `build_js.py` is still the way to rebuild `po-data.js` / `lead-times.js`.

## Sales, GRN and PO (older full refresh), `build_js.py`

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
