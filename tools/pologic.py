"""The PO Data sheet's formula columns, done in code, from the raw PO columns
plus the "Logistics Status" sheet (logistics team's per-PO status and new
ETD/ETA) and the SetUp sheet's status mapping. Each step names the workbook
column it reproduces; check_po_formulas() compares against the workbook."""
import re, datetime

def t(v): return '' if v is None else str(v).strip()
def isdate(v): return isinstance(v, (datetime.datetime, datetime.date))
def iso(v): return v.strftime('%Y-%m-%d') if isdate(v) else None

def status_map(setup_rows):
    """SetUp D:G -- logistics status ("Rems", col D) -> Re-Status (col G):
    Under Proces / Short Ship / Next Booking -> Pending, the rest unchanged."""
    m = {}
    for r in setup_rows[2:]:
        k, v = t(r[3]) if len(r) > 3 else '', t(r[6]) if len(r) > 6 else ''
        if not k: break
        m[k] = v or k
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

def po_line(r, log, smap, cpc_of):
    """One PO line -> Log STS, Status-Logstic, Fnl ETD, Fnl ETA, CPC-PO, Tot Order Cost AED.
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
    return {'log_sts': log_sts, 'status': status, 'fnl_etd': fnl_etd, 'fnl_eta': fnl_eta, 'cpc': cpc, 'cost_aed': cost}
