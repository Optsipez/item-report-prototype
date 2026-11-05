// All Products' PO Unit Cost rule, from the real app.js: node tools/test_po_unit_cost.js
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const code = src.slice(src.indexOf('const FX_TO_AED'), src.indexOf("it['PO Unit Cost'] = poUnitCost(it)"));
const { poUnitCost, round2 } = new Function(code.slice(0, code.lastIndexOf('ITEMS.forEach')) + 'return { poUnitCost, round2 };')();
const it = (lc, latest, prev, first, cur, vendorCur) => ({ 'L-Cost (Aed)': lc, 'Latest FOB Cost': latest, 'Previous FOB Cost': prev, 'First FOB': first, 'Currency Code': cur, 'Vendor Currency': vendorCur });
assert.strictEqual(poUnitCost(it(50, 9, 9, 9, 'USD')), 50);              // landed wins, no factor
assert.strictEqual(poUnitCost(it(0, 218, 9, 9, 'USD')), 1001.17);        // 218 x 3.674 x 1.25 = 1001.165
assert.strictEqual(poUnitCost(it(0, 0, 10, 9, 'EUR')), 50);              // previous
assert.strictEqual(poUnitCost(it(0, 0, 0, 8, 'AED')), 10);               // first
assert.strictEqual(poUnitCost(it(0, 0, 0, 0, 'USD')), 0);                // all 0
assert.strictEqual(poUnitCost(it(0, 5, 0, 0, '')), null);                // no rate: blank, not a guess
assert.strictEqual(poUnitCost(it(0, 8, 0, 0, '', 'EUR')), 40);           // no currency: the vendor's
assert.strictEqual(poUnitCost(it(0, 8, 0, 0, 'AED', 'EUR')), 10);         // its own currency comes first
assert.strictEqual(round2(1.005), 1.01);
console.log('ok');
