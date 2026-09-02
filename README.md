# Item Report — Inventory Intelligence

A prototype reporting UI for merchandising / buying teams, built on a Navision
(Dynamics NAV) item export. It gives a single screen for looking at one product
in depth or scanning the whole catalogue.

No build step, no server, no dependencies. Open `index.html` in a browser and it
runs — everything is plain HTML/CSS/JS and the data is embedded as a JavaScript
file, so it works straight from disk (`file://`).

---

## The two views

Switch between them from the top bar.

### Item Lookup
Search by item code, description, or vendor code → **Generate** pulls the full
report for one product:

- **Header** — code, description, vendor, country of origin, colour swatch
- **Metrics band** — four panels: Pricing (AED), Stock & Orders, FOB Cost (USD),
  Classification
- **Tabs**
  - **Overview** — product and vendor/sourcing detail
  - **Stock In by Month** — units received, by month, for each year
  - **Sold by Month** — units sold, by month, for each year
  - **Branch Wise** — stock on hand per branch/warehouse

  > The source workbook has no branch-level *sales*, so the Branch Wise tab shows
  > branch-level *stock on hand* as a stand-in. Branch codes are shown as-is from
  > NAV (DCSHJ, MARIN, JUMRA, …).

### All Products
Every product in one grid.

- **Two rows per item** — the current year on top, the prior year beneath it. The
  current-year row is lightly shaded; the prior-year row sits clean underneath.
- **Collapsible column groups** — click a dark group header (Range, Classification,
  PUDA, Pricing, Attributes, FOB Cost, Receipts & Sales, Stock In by Month, Sold by
  Month) to collapse it to a slim label, or use **Collapse / Expand all sections**.
  The panel narrows to fit whatever's expanded.
- **Item Code stays frozen** on the left as you scroll right.
- **Colour-coded month blocks** — Stock In by Month is tinted warm, Sold by Month
  cool, so the two Jan–Dec blocks never blur together.
- **Click any row** to open that item in Item Lookup.
- **Filters** (left rail) — Category Code, Department Desc, Vendor Code, PUDA Desc,
  Current Plan Code, Range Name. Multi-select; checks within one filter are OR'd,
  filters are AND'd across each other. Category Code and Current Plan Code show
  their full master list — codes not present in the loaded data are greyed out.

---

## Business rules applied on load / display

These live in `js/app.js` near the top and are easy to extend:

| Rule | Where |
|------|-------|
| **Plan code `B` products are dropped entirely** — never shown in the grid, search, filters, or counts | `HIDDEN_PLAN_CODES` |
| **Lifestyle codes expand to full names** (TRANS → Transitional, MIMOD → Minimalist Modern, CNMOD → Contemporary Modern, CLASC → Classic, MODRN → Modern (Gnrl), COMMN → Common, OFICE → Office) — unknown codes shown as-is | `LIFESTYLE_LABELS` |
| **Category Code filter shows names** (A = Accessory, F = Furniture, K = Kids, O = Office Furniture, S = Services, W = Wall Paper) — the underlying value stays the letter | `FILTER_VALUE_LABELS` |
| **A monthly value of `0` renders as `—`** in the Stock In / Sold cells; non-zero values (incl. negatives) are unchanged | `buildGridBody` / `buildMatrix` |

---

## Project structure

| File | Purpose |
|------|---------|
| `index.html`     | Page markup only — links the CSS, loads `data.js` then `app.js` |
| `css/styles.css` | All styling; palette is CSS custom properties at the top of the file |
| `js/data.js`     | The dataset — `ITEMS` (array) and `BRANCH_BY_ITEM` (object), extracted from `Navision_Report_Format.xlsx` |
| `js/app.js`      | All behaviour — view switching, search, report rendering, the grid, filters, business rules |

The current dataset is 11 sample items covering 2025 and 2026.

---

## Updating the data

Edit `js/data.js`. Keep the key names exactly — `app.js` reads them by name.

**`ITEMS`** — one object per product. Required keys:

```
Item Code, Description, Vendor Code, Vendor Name, Range Name,
Catg Code, Category, Department Code, Department Desc,
Group Code, Group Desc, Sub Group Code, Sub Group Desc,
PUDA Code, PUDA Desc, Current Plan Code, Lifestyle,
Item Color Name, Country Of Origin, Currency Code,
L-Cost (Aed), Was (Aed), Now (Aed), Disct%, MRG Factor,
SOH, PO-Qty, First FOB, Previous FOB Cost, Latest FOB Cost,
Lrcv Date, Lrcv Qty, Last Sold Date, Last Sold Qty,
years: {
  "2026": { stock: [12 numbers, Jan–Dec], sales: [12 numbers, Jan–Dec] },
  "2025": { stock: [...], sales: [...] }
}
```

Any number of years is supported; they're sorted newest-first.

**`BRANCH_BY_ITEM`** — `{ "<Item Code>": { "<BRANCH>": <SOH number>, … }, … }`, used
by the Branch Wise tab.

---

## Running

Double-click `index.html`, or in VS Code right-click → **Open with Live Server**.
