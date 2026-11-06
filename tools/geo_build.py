"""Builds the sign-in location lookup that access.php reads, from DB-IP's free
"IP to City Lite" file (CC BY 4.0, https://db-ip.com, free for business use,
new file monthly):

    python tools/geo_build.py dbip-city-lite-YYYY-MM.csv.gz OUT_DIR

Writes OUT_DIR/ipv4.bin (6 bytes a range: first address, big-endian uint32;
place number, uint16) and OUT_DIR/locs.json ([[country code, emirate/state], ...]).
IPv4 only, city detail dropped and touching ranges with the same place merged.
Upload both to /home/a2xlmec/2xlpurchase-geo/ on the server (outside the
web folder): scp OUT_DIR/* cpanel-2xl:2xlpurchase-geo/"""
import csv, gzip, io, ipaddress, json, os, struct, sys

def build(src, out):
    locs, index, ranges = [], {}, []   # ranges: [start, end, place]
    with gzip.open(src, 'rt', encoding='utf-8', newline='') as f:
        for row in csv.reader(f):
            if ':' in row[0]: continue   # IPv6
            place = (row[3], row[4])
            if place not in index: index[place] = len(locs); locs.append(list(place))
            a, b, p = int(ipaddress.IPv4Address(row[0])), int(ipaddress.IPv4Address(row[1])), index[place]
            if ranges and ranges[-1][2] == p and ranges[-1][1] + 1 == a: ranges[-1][1] = b
            else: ranges.append([a, b, p])
    assert len(locs) < 65536, len(locs)
    assert all(ranges[i][0] > ranges[i - 1][1] for i in range(1, len(ranges))), 'ranges must be sorted'
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, 'ipv4.bin'), 'wb') as f:
        f.write(b''.join(struct.pack('>IH', a, p) for a, _, p in ranges))
    with open(os.path.join(out, 'locs.json'), 'w', encoding='utf-8') as f:
        json.dump(locs, f, ensure_ascii=False, separators=(',', ':'))
    return ranges, locs

def lookup(ranges, locs, ip):   # same search as access.php, for the check below
    n, lo, hi = int(ipaddress.IPv4Address(ip)), 0, len(ranges) - 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if ranges[mid][0] <= n: lo = mid
        else: hi = mid - 1
    return locs[ranges[lo][2]]

if __name__ == '__main__':
    ranges, locs = build(sys.argv[1], sys.argv[2])
    print(len(ranges), 'ranges,', len(locs), 'places')
    print('1.178.20.5 ->', lookup(ranges, locs, '1.178.20.5'), '| 8.8.8.8 ->', lookup(ranges, locs, '8.8.8.8'))
