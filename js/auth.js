/* ============================================================
   LOGIN GATE — employee ID + password, role-based (buyer / manager /
   ceo). This app is static (no backend — data.js ships the whole
   dataset straight to the browser), so this is NOT real security:
   anyone who opens this file or the browser's dev tools can read the
   credentials and the data regardless of login state. It's a
   lightweight gate to keep casual/wrong-department access out and
   route each role to the right view — nothing more.

   Each entry can carry a display name (shown in the top bar as
   "ID · Name"); leave it '' to show the role instead.

   EDIT EMPLOYEES BELOW with the real employee IDs and passwords
   before real use — these are placeholders. Every Buyer ID shares one
   password; Manager 1 and CEO each have their own. Role names used
   elsewhere (see activeColumnLayout() in app.js): 'buyer', 'manager',
   'ceo'.
   ============================================================ */
const EMPLOYEES = [
  { id: '3068', name: 'Dyan', password: 'Buy@4567', role: 'buyer' },
  { id: '3067', name: 'Zindy', password: 'Buy@4567', role: 'buyer' },
  { id: '3055', name: 'Manily', password: 'Buy@4567', role: 'buyer' },
  { id: '3066', name: 'Fred', password: 'Buy@4567', role: 'buyer' },
  { id: '7191', name: 'Cris', password: 'Buy@4567', role: 'buyer' },
  { id: '3065', name: 'Angel', password: 'Buy@4567', role: 'buyer' },
  { id: '7448', name: 'Priyanka', password: 'Buy@4567', role: 'buyer' },
  { id: '3014', name: 'Jenny', password: 'Buy@4567', role: 'buyer' },
  { id: '3060', name: 'Alka', password: 'Buy@4567', role: 'buyer' },
  { id: '3039', name: 'Jane', password: 'Buy@4567', role: 'buyer' },
  { id: '3035', name: 'Chell', password: 'Buy@4567', role: 'buyer' },
  { id: '3082', name: 'Marifor', password: 'Buy@4567', role: 'buyer' },
  { id: '4027', name: 'Yahya', password: 'Buy@4567', role: 'buyer' },
  // add/remove Buyer IDs here, same password as the ones above
  { id: '3111', name: 'Javaid', password: 'Jav@1113', role: 'manager' },
  { id: 'CEO', name: 'CEO', password: 'CEO', role: 'ceo' },
  { id: 'admin', name: 'Admin', password: 'Admin0306', role: 'admin' },
];

let CURRENT_ROLE = null;
let CURRENT_EMPLOYEE_ID = null;
let CURRENT_EMPLOYEE_NAME = '';

function findEmployee(id){
  const norm = String(id || '').trim().toUpperCase();
  if(!norm) return null;
  return EMPLOYEES.find(e => e.id.toUpperCase() === norm) || null;
}

function saveSession(emp){
  try { sessionStorage.setItem('empSession', JSON.stringify({ id: emp.id, name: emp.name || '', role: emp.role })); } catch(e){}
}
function clearSession(){
  try { sessionStorage.removeItem('empSession'); } catch(e){}
}
// Trusts the session for the tab's lifetime rather than re-checking
// EMPLOYEES on every load — simplest option for a gate that's explicitly
// not meant to be bypass-proof. An edited/removed ID takes effect on that
// employee's next login, not retroactively on an already-open tab.
function restoreSession(){
  let raw;
  try { raw = sessionStorage.getItem('empSession'); } catch(e){ raw = null; }
  if(!raw) return false;
  let saved;
  try { saved = JSON.parse(raw); } catch(e){ return false; }
  if(!saved || !saved.id || !saved.role) return false;
  CURRENT_ROLE = saved.role;
  CURRENT_EMPLOYEE_ID = saved.id;
  CURRENT_EMPLOYEE_NAME = saved.name || '';
  return true;
}

// Primary dashboard / launcher — role-gated front door, shown full-screen
// (nothing of the app visible underneath) right after sign-in and
// reopenable via the topbar's Menu button. Laid out as a showroom-style
// directory: the state of the business as one sentence, then each
// destination as a row. Every role gets every view for now; restrict one
// later by trimming its `roles` array.
const PRIMARY_VIEWS = [
  { label: 'Dashboard',        desc: 'Sales, stock cover and what needs attention', hash: 'dashboard', roles: ['buyer', 'manager', 'ceo', 'admin'] },
  { label: 'All Products',     desc: 'Every item with its stock, sales and pricing', hash: 'products',  roles: ['buyer', 'manager', 'ceo', 'admin'] },
  { label: 'Trip Requirement', desc: 'Plan the next order with a vendor',            hash: 'trip',      roles: ['buyer', 'manager', 'ceo', 'admin'] },
  { label: 'Item Lookup',      desc: 'Everything about a single item',               hash: 'lookup',    roles: ['buyer', 'manager', 'ceo', 'admin'] },
  { label: 'PO Data',          desc: 'Every open purchase order, by vendor',         hash: 'podata',    roles: ['buyer', 'manager', 'ceo', 'admin'] },
];
function renderPrimaryOverlay(){
  const grid = document.getElementById('primaryGrid');
  if(!grid) return;
  grid.innerHTML = PRIMARY_VIEWS.filter(v => v.roles.includes(CURRENT_ROLE)).map(v =>
    '<button type="button" class="primary-row" data-hash="' + v.hash + '">' +
      '<span class="primary-row-name">' + v.label + '</span>' +
      '<span class="primary-row-desc">' + v.desc + '</span>' +
      '<span class="primary-row-stat" data-stat="' + v.hash + '"></span>' +
    '</button>'
  ).join('');
  fillPrimaryStats();
  grid.querySelectorAll('.primary-row').forEach(btn => btn.addEventListener('click', () => {
    hidePrimaryOverlay();
    // This overlay shows before the 38MB data.js and app.js have finished
    // downloading. Clicked that early, navigate() doesn't exist yet -- set
    // the hash anyway so the first route applied on load picks it up.
    if(typeof navigate === 'function') navigate(btn.dataset.hash);
    else location.hash = btn.dataset.hash;
  }));
  const greet = document.getElementById('primaryGreeting');
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  if(greet) greet.textContent = part + (CURRENT_EMPLOYEE_NAME ? ', ' + CURRENT_EMPLOYEE_NAME : '') + '.';
  const date = document.getElementById('primaryDate');
  if(date) date.textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const user = document.getElementById('primaryUser');
  if(user){
    const roleLabel = CURRENT_ROLE === 'ceo' ? 'CEO' : CURRENT_ROLE === 'manager' ? 'Manager' : CURRENT_ROLE === 'admin' ? 'Admin' : 'Buyer';
    user.textContent = CURRENT_EMPLOYEE_NAME || roleLabel;
    user.title = 'Signed in as ' + CURRENT_EMPLOYEE_ID;
  }
}
// The lede sentence and row figures. The overlay can show before the 38MB
// data.js has loaded, so this no-ops until ITEMS/PO_LINES exist (the lede
// says "Loading today's figures…" meanwhile) and runs again from the end of
// dashboard.js once everything is in.
let primaryStats = null;
function fillPrimaryStats(){
  if(typeof ITEMS === 'undefined' || typeof PO_LINES === 'undefined') return;
  if(!primaryStats){
    const n = v => v.toLocaleString('en-US');
    const compact = v => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'K' : String(Math.round(v));
    const vendors = new Set(ITEMS.map(i => i['Vendor Code'])).size;
    const stock = ITEMS.reduce((s, i) => s + Math.max(0, Number(i['SOH']) || 0) * (Number(i['L-Cost (Aed)']) || 0), 0);
    const pos = new Set(PO_LINES.map(l => l[0])).size;
    const late = new Set(PO_LINES.filter(l => l[4] < DATA_AS_OF).map(l => l[0])).size;
    const b = v => '<b>' + v + '</b>';
    primaryStats = {
      lede: b('AED ' + compact(stock)) + ' in stock. ' + b(n(pos)) + ' purchase orders open, ' + b(n(late)) + ' of them running late.',
      products: n(ITEMS.length) + ' items',
      trip: n(vendors) + ' vendors',
      podata: n(pos) + ' open',
      foot: 'Figures as of ' + new Date(DATA_AS_OF + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    };
  }
  document.querySelectorAll('#primaryGrid [data-stat]').forEach(el => { el.textContent = primaryStats[el.dataset.stat] || ''; });
  const lede = document.getElementById('primaryLede');
  if(lede) lede.innerHTML = primaryStats.lede;
  const foot = document.getElementById('primaryFoot');
  if(foot) foot.textContent = primaryStats.foot;
}

function showPrimaryOverlay(){
  renderPrimaryOverlay();
  const overlay = document.getElementById('primaryOverlay');
  if(overlay) overlay.hidden = false;
}
function hidePrimaryOverlay(){
  const overlay = document.getElementById('primaryOverlay');
  if(overlay) overlay.hidden = true;
}

function showLoginOverlay(msg){
  const overlay = document.getElementById('loginOverlay');
  if(!overlay) return;
  overlay.hidden = false;
  const err = document.getElementById('loginError');
  if(err) err.textContent = msg || '';
  // Only on an actual rejection (msg set), not the plain "show the login
  // screen" call at page load. Clearing + refocusing the password field
  // avoids a confusing case: typing over a rejected password without
  // first selecting it all inserts new characters into the old ones
  // instead of replacing them, so the retry silently fails too and shows
  // the exact same error text -- looking exactly like nothing happened.
  if(msg){
    const pwField = document.getElementById('loginPassword');
    if(pwField){ pwField.value = ''; pwField.focus(); }
  }
}
function hideLoginOverlay(){
  const overlay = document.getElementById('loginOverlay');
  if(overlay) overlay.hidden = true;
}
// Lets CSS hide role-restricted bits (see .vendor-name-only in styles.css).
function applyRoleClass(){ document.body.classList.toggle('role-buyer', CURRENT_ROLE === 'buyer'); }
function updateTopbarUser(){
  const label = document.getElementById('topbarUserLabel');
  if(!label || !CURRENT_ROLE) return;
  const roleLabel = CURRENT_ROLE === 'ceo' ? 'CEO' : CURRENT_ROLE === 'manager' ? 'Manager' : CURRENT_ROLE === 'admin' ? 'Admin' : 'Buyer';
  // Shows the person's name when one is set in EMPLOYEES, else their role.
  label.textContent = CURRENT_EMPLOYEE_ID + ' · ' + (CURRENT_EMPLOYEE_NAME || roleLabel);
}
// Applies a successful login WITHOUT reloading the page. Used to reload
// here and rely on restoreSession() picking the session back up from
// sessionStorage on the fresh load — but some browsers/security
// extensions block Web Storage entirely, which silently turned every
// correct login into a loop straight back to the login screen (the
// reload happened, then restoreSession() found nothing and re-showed the
// overlay). Applying the role in place, live in the already-loaded page,
// works regardless of whether storage is available. saveSession() is
// still called (best-effort) purely so a later *manual* refresh can skip
// the login screen on browsers where storage does work.
function enterApp(emp){
  CURRENT_ROLE = emp.role;
  CURRENT_EMPLOYEE_ID = emp.id;
  CURRENT_EMPLOYEE_NAME = emp.name || '';
  hideLoginOverlay();
  updateTopbarUser();
  applyRoleClass();
  showPrimaryOverlay();
  // app.js already ran its first render before login happened (with
  // CURRENT_ROLE still null, which activeColumnLayout() treats as
  // full access) — re-render now that the real role is known, so e.g.
  // a Buyer's hidden Vendor Name column actually takes effect.
  // Only the view that is actually showing needs redrawing (the dashboard
  // is the default landing page; the grid is only built when opened).
  if(typeof reshuffleDashGreeting === 'function') reshuffleDashGreeting();
  if(typeof renderDashboard === 'function' && document.getElementById('viewDash').classList.contains('active')) renderDashboard();
  if(typeof renderGrid === 'function' && document.getElementById('viewAll').classList.contains('active')) renderGrid();
  // The Item Lookup report may already be showing (e.g. a #item= link).
  if(typeof selectedItem !== 'undefined' && selectedItem && typeof renderReport === 'function') renderReport(selectedItem);
}

(function initAuth(){
  if(restoreSession()){
    hideLoginOverlay();
    updateTopbarUser();
    applyRoleClass();
    showPrimaryOverlay();
  } else {
    showLoginOverlay();
  }

  const openPrimaryBtn = document.getElementById('openPrimaryBtn');
  if(openPrimaryBtn) openPrimaryBtn.addEventListener('click', showPrimaryOverlay);

  const form = document.getElementById('loginForm');
  if(form){
    form.addEventListener('submit', e => {
      e.preventDefault();
      const idVal = document.getElementById('loginId').value;
      const pwVal = document.getElementById('loginPassword').value;
      const emp = findEmployee(idVal);
      if(!emp || emp.password !== pwVal){
        showLoginOverlay('Incorrect employee ID or password.');
        return;
      }
      saveSession(emp);
      enterApp(emp);
    });
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if(logoutBtn){
    logoutBtn.addEventListener('click', () => {
      clearSession();
      // Drop the #item=... / #lookup part of the address too, otherwise the
      // next person to sign in lands on whatever product the last one left.
      try { history.replaceState(null, '', location.pathname + location.search); } catch(e){}
      location.reload();
    });
  }
})();
