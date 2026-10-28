"""The PO Data sheet's formula columns, done in code, from the raw PO columns
plus the "Logistics Status" sheet (logistics team's per-PO status and new
ETD/ETA) and the SetUp sheet's status mapping. Each step names the workbook
column it reproduces; check_po_formulas() compares against the workbook."""
import re, datetime

def t(v): return '' if v is None else str(v).strip()
def isdate(v): return isinstance(v, (datetime.datetime, datetime.date))
def iso(v): return v.strftime('%Y-%m-%d') if isdate(v) else None

# The SetUp sheet's status table (D:H, rows 3-12 of the 22-Oct workbook), built
# in so live data needs only the raw sheets. Logistics status ("Rems", col D)
# -> (Re-Status col G, sort number col H). Change it here if SetUp changes.
SETUP_STATUS = {
    'GRN Pending':  ('GRN Pending', 0.1),
    'At Port':      ('At Port', 0.2),
    'Released':     ('Released', 0.3),
    'In Transit':   ('In Transit', 0.4),
    'Pending':      ('Pending', 0.5),
    'Under Proces': ('Pending', 0.6),
    'Hold':         ('Hold', 0.7),
    'Short Ship':   ('Pending', 0.8),
    'Cancelled':    ('Cancelled', 0.9),
    'Next Booking': ('Pending', 0.91),
}

def status_map():
    """SetUp D:G -- logistics status -> Re-Status:
    Under Proces / Short Ship / Next Booking -> Pending, the rest unchanged."""
    return {k: v[0] for k, v in SETUP_STATUS.items()}

def status_sort():
    """SetUp G:H -- Re-Status -> its sort number (GRN Pending 0.1, At Port 0.2 ...).
    First entry per status wins, as VLOOKUP does."""
    m = {}
    for g, h in SETUP_STATUS.values(): m.setdefault(g, h)
    return m

def logistics(rows):
    """Logistics Status sheet (header in row 2): A PO No, B Sataus, C New ETD,
    D New ETA, H Correction. Cleaned like its K:N formulas: PO No minus
    "Correction" trailing characters (split shipments like PO-20453-2) --
    or, when that column is blank, any "-n" suffix after PO-#####; status
    trimmed. First entry per PO wins, as VLOOKUP does."""
    out = {}
    for r in rows[2:]:
        raw = t(r[0])
        if not raw: continue
        corr = r[7] if len(r) > 7 else None
        po = raw[:len(raw) - int(corr)] if isinstance(corr, (int, float)) and corr else re.sub(r'^(PO-\d+)-\d+$', r'\1', raw)
        if po not in out: out[po] = (t(r[1]), r[2] if isdate(r[2]) else None, r[3] if isdate(r[3]) else None)
    return out

def po_month(status, fnl_eta, sort):
    """S-Yr, S-Mon, Mon-Year (PO Data H:J): open ("Pending") lines bucket by
    Fnl ETA month, every other status is its own bucket.
      S-Yr     IF(B="Pending",YEAR(D),2000)
      Mon-Year IF(B="Pending",TEXT(D,"Mmm-Yy"),B)
      S-Mon    IFERROR(VLOOKUP(J,SetUp G:H,2),VLOOKUP(J,SetUp R:Y,8))
    SetUp R:Y numbers months from Jan-95 = 1, so a month is (year-1995)*12+month.
    A Pending line with no Fnl ETA gets Excel's day 0: 1900 / Jan-00 / 61."""
    if status != 'Pending':
        return 2000, sort.get(status), status
    if not isdate(fnl_eta):
        return 1900, 61, 'Jan-00'
    return fnl_eta.year, (fnl_eta.year - 1995) * 12 + fnl_eta.month, fnl_eta.strftime('%b-%y')

def po_line(r, log, smap, cpc_of, sort=None):
    """One PO line -> Log STS, Status-Logstic, Fnl ETD, Fnl ETA, CPC-PO, Tot Order Cost AED,
    and (with sort = status_sort(...)) S-Yr / S-Mon / Mon-Year.
    r: dict header -> value from the PO Data sheet."""
    po = t(r['PO No']); L = log.get(po)
    log_sts = L[0] if L else 'Pending'                                        # Log STS: IFERROR(VLOOKUP(...),"Pending")
    status = smap.get(log_sts, log_sts)                                       # Status-Logstic: VLOOKUP(Log STS, SetUp D:G, 4)
    log_etd, log_eta = (L[1], L[2]) if L else (None, None)                     # Log-Link ETD / ETA (0 when blank)
    rev, ship = r.get('Revised Ship Date'), r.get('Ship Date')
    fnl_etd = log_etd or (rev if isdate(rev) else ship if isdate(ship) else None)   # Fnl ETD: IF(E<>0,E,IF(AJ>0,AJ,AH))
    arr = r.get('Arrival Date')
    fnl_eta = log_eta or (arr if isdate(arr) else None)                        # Fnl ETA: IF(F<>0,F,AI)
    code = t(r['Item Code'])
    cpc = cpc_of.get(code) or t(r.get('Current Plan Code'))                    # CPC-PO: the stock sheet's (corrected) CPC, else the PO's own
    fob_aed = r.get('FOB Cost LCY'); qty = r.get('PO Qty')
    cost = (fob_aed or 0) * (qty or 0) if isinstance(fob_aed, (int, float)) and isinstance(qty, (int, float)) else 0   # Tot Order Cost AED: AG*AK
    s_yr, s_mon, mon_year = po_month(status, fnl_eta, sort or {})
    return {'log_sts': log_sts, 'status': status, 'fnl_etd': fnl_etd, 'fnl_eta': fnl_eta, 'cpc': cpc, 'cost_aed': cost,
            's_yr': s_yr, 's_mon': s_mon, 'mon_year': mon_year}
