# Item Report — Inventory Intelligence (prototype)

Static prototype of the Navision item report. No build step, no server, no
dependencies — open `index.html` in a browser and it runs.

## Structure

| File | Purpose |
|------|---------|
| `index.html`     | Page markup only |
| `css/styles.css` | All styling |
| `js/data.js`     | Sample data (`ITEMS`, `BRANCH_BY_ITEM`) — from `Navision_Report_Format.xlsx` |
| `js/app.js`      | All behaviour: search, report rendering, the All Products grid, filters |

This is a straight split of the original single-file `item-report-prototype (13).html`
into separate files so it's easier to diff and review in Git. Behaviour is unchanged.

The data lives in `js/data.js` as plain JavaScript (not loaded via `fetch()`), so
the page works when opened directly from disk (`file://`) with no local server.

## Running

Double-click `index.html`, or in VS Code use "Open with Live Server". The two
views ("Item Lookup" and "All Products") are switched from the top bar.

## Updating the data

Replace the `ITEMS` array and `BRANCH_BY_ITEM` object in `js/data.js`. Keep the
same key names — `app.js` reads them directly.
