# Item Report — Inventory Intelligence

A prototype reporting UI for merchandising / buying teams, built on a Navision
(Dynamics NAV) item export. One screen for looking at a single product in depth,
or scanning the whole catalogue.

No build step, no server, no dependencies. Open `index.html` in a browser and it
runs — everything is plain HTML/CSS/JS and the dataset is embedded as a
JavaScript file, so it works straight from disk (`file://`).

---

## The two views

The app opens on **All Products**. Switch views from the top bar.

### All Products

Every product in one grid, two rows per item — the **current year on top
(shaded), the prior year clean underneath**. The pair always stays together.

- **Column groups** — related columns sit under a dark header: Range,
  Classification, PUDA, Pricing, Attributes, FOB Cost, Receipts & Sales,
  **Sold by Month**, then **Stock In by Month**. Click a group header to collapse
  it to a slim vertical label; **Collapse / Expand all sections** does the lot.
  The grid narrows to fit whatever is open.
- **Colour-coded month blocks** — Sold by Month is tinted cool green, Stock In by
  Month warm peach, so the two Jan–Dec blocks never blur together. A monthly
  value of `0` shows as `—`.
- **Item Code stays frozen** on the left as you scroll right. **Last Sold Qty**
  is pulled out as its own always-visible column so it survives collapsing
  Receipts & Sales.
- **Resize any column** — drag the right edge of a header, spreadsheet-style.
  Drag an expanded group's header bar to scale every column in that group at
  once. Content that no longer fits is trimmed with an ellipsis.
- **Click any row** to open that item in Item Lookup.
- **Collapsible filter rail** — the chevron tab on the rail's edge hides the
  filters and lets the grid take the full width; click it again to bring them
  back.

### Item Lookup

Search by item code, description, or vendor code. **Generate** — or just clicking
a result row — pulls the full report for one product:

- **Header** — code, description, a plan-code pill, vendor, country of origin,
  colour swatch
- **Metrics band** — four panels: Pricing (AED), Stock & Orders, FOB Cost (USD),
  Classification
- **Tabs**
  - **Overview** — Colour / Lifestyle / PUDA, and Vendor Code / Vendor Name /
    Country of Origin
  - **Stock In by Month** — units received, by month, for each year
  - **Sold by Month** — units sold, by month, for each year
  - **Branch Wise** — stock on hand per branch / warehouse

  > The source workbook has no branch-level *sales*, so Branch Wise shows
  > branch-level *stock on hand* as a stand-in. Branch codes are shown as-is from
  > NAV (DCSHJ, MARIN, JUMRA, …).

---

## Filters (All Products)

Left rail: **Category Code, Department Desc, Vendor Code, PUDA Desc, Current Plan
Code, Range Name**. Multi-select — checks within one filter are OR'd, filters are
AND'd across each other.

- **Faceted** — once any filter is active, every *other* filter drops the options
  that would return nothing. With no filter active, Category Code and Current
  Plan Code show their full master list with unused codes greyed out.
- **Searchable** — Vendor Code, PUDA Desc, and Range Name each have a search box
  for long lists.
- **PUDA Desc** options show just the product name (the part after the `/`); the
  value still matches on the full string.

---

## Business rules applied on load / display

These live near the top of `js/app.js` and are easy to extend:

| Rule | Where |
|------|-------|
| **Products are dropped entirely on load** — never shown in the grid, search, filters, or counts — when their **Current Plan Code** is `B`, `O`, `W`, or `S`, or their **Category** is Office Furniture / Services / Wall Paper & Window Décor (Catg Code `O` / `S` / `W`) | `isHiddenItem`, `HIDDEN_PLAN_CODES`, `HIDDEN_CATG_CODES`, `HIDDEN_CATEGORIES` |
| **Lifestyle codes expand to full names** — TRANS → Transitional, MIMOD → Minimalist Modern, CNMOD → Contemporary Modern, CLASC → Classic, MODRN → Modern (Gnrl), COMMN → Common, OFICE → Office; unknown codes shown as-is | `LIFESTYLE_LABELS` |
| **Category Code filter shows names** — A = Accessory, F = Furniture, K = Kids; the stored value stays the letter | `FILTER_VALUE_LABELS` |
| **A monthly value of `0` renders as `—`** in the Stock In / Sold cells; non-zero values (including negatives) are unchanged | `buildGridBody` / `buildMatrix` |

---

## Project structure

| File | Purpose |
|------|---------|
| `index.html`     | Page markup only — links the CSS, loads `data.js` then `app.js` |
| `css/styles.css` | All styling; the palette is CSS custom properties at the top of the file |
| `js/data.js`     | The dataset — `ITEMS` (array) and `BRANCH_BY_ITEM` (object), extracted from `Navision_Report_Format.xlsx` |
| `js/app.js`      | All behaviour — view switching, search, report rendering, the grid, resizing, filters, business rules |

The bundled dataset is 11 sample items covering 2025 and 2026.

---

## Updating the data

Edit `js/data.js`. Keep the key names exactly — `app.js` reads them by name.

**`ITEMS`** — one object per product:

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

**`BRANCH_BY_ITEM`** — `{ "<Item Code>": { "<BRANCH>": <SOH number>, … }, … }`,
used by the Branch Wise tab.

---

## Running

Double-click `index.html`, or in VS Code right-click → **Open with Live Server**.
