#!/usr/bin/env python3
"""Cross-check house addresses against official/open address data.

Usage:
    python3 scripts/check_addresses.py data/fort-worth/houses.csv data/dallas/houses.csv

For every house it compares three things:
  1. The address as listed (from oxfordvacancies.com).
  2. The US Census Bureau geocoder's match for that address (official street records).
  3. The street the map pin actually sits on (OpenStreetMap reverse lookup).

Flags:
  NOT_FOUND      Census can't find the listed address at all.
  STREET_DIFF    Census matched it to a differently named street / suffix (e.g. Rd vs Dr).
  PIN_FAR        The Census location is more than 300 m from the map pin.
  PIN_STREET     The pin sits on a different street than the listed address says.

Writes a full report to address_check.csv and prints the flagged houses.
Takes a few minutes (OpenStreetMap allows 1 lookup per second).
"""
import csv
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request

UA = {"User-Agent": "oxford-chapter-map-address-check/1.0"}
FAR_M = 300

SUFFIX = {
    "drive": "dr", "road": "rd", "lane": "ln", "street": "st", "avenue": "ave", "av": "ave",
    "court": "ct", "circle": "cir", "trail": "trl", "terrace": "ter", "place": "pl",
    "boulevard": "blvd", "parkway": "pkwy", "highway": "hwy", "square": "sq", "cove": "cv",
    "point": "pt", "crossing": "xing", "ridge": "rdg", "loop": "loop", "way": "way", "run": "run",
}
DIRS = {"north": "n", "south": "s", "east": "e", "west": "w",
        "northeast": "ne", "northwest": "nw", "southeast": "se", "southwest": "sw"}


def norm_street(s):
    """'1704 Downey Rd.' -> ('1704', 'downey rd'); suffixes/directions abbreviated."""
    s = re.sub(r"[.,#]", " ", (s or "").lower())
    words = s.split()
    num = words.pop(0) if words and re.match(r"^\d+[a-z]?$", words[0]) else ""
    words = [DIRS.get(w, SUFFIX.get(w, w)) for w in words]
    return num, " ".join(words)


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def census(address):
    url = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?" + urllib.parse.urlencode(
        {"address": address, "benchmark": "Public_AR_Current", "format": "json"})
    m = get_json(url)["result"]["addressMatches"]
    if not m:
        return None
    c = m[0]["addressComponents"]
    street = " ".join(x for x in (c.get("preDirection"), c.get("preType"), c.get("streetName"),
                                  c.get("suffixType"), c.get("suffixDirection")) if x)
    return {"matched": m[0]["matchedAddress"], "street": norm_street("0 " + street)[1],
            "lat": m[0]["coordinates"]["y"], "lng": m[0]["coordinates"]["x"]}


def osm_reverse(lat, lng):
    url = "https://nominatim.openstreetmap.org/reverse?" + urllib.parse.urlencode(
        {"lat": lat, "lon": lng, "format": "json", "zoom": 18, "addressdetails": 1})
    a = get_json(url).get("address", {})
    time.sleep(1.1)  # Nominatim usage policy
    return a.get("house_number", ""), a.get("road", "")


def meters(lat1, lng1, lat2, lng2):
    R = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    return 2 * R * math.asin(math.sqrt(math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2))


def name_only(street):
    """Street name without suffix/direction, to tell 'wrong suffix' from 'wrong street'."""
    return " ".join(w for w in street.split() if w not in SUFFIX.values() and w not in DIRS.values())


def check(row):
    flags, notes = [], []
    num, listed = norm_street(row["address"])
    full = f'{row["address"]}, {row["city"]}, {row["state"]} {row["zip"]}'
    lat, lng = float(row["lat"]), float(row["lng"])

    c = None
    try:
        c = census(full)
    except Exception as e:
        notes.append(f"census error: {e}")
    if c is None:
        flags.append("NOT_FOUND")
    else:
        if c["street"] != listed:
            flags.append("STREET_DIFF")
            notes.append(f'Census: {c["matched"]}')
        d = meters(lat, lng, c["lat"], c["lng"])
        if d > FAR_M:
            flags.append("PIN_FAR")
            notes.append(f"Census location is {d:.0f} m from pin")

    pin_num, pin_road = "", ""
    try:
        pin_num, pin_road = osm_reverse(lat, lng)
    except Exception as e:
        notes.append(f"osm error: {e}")
    pin_street = norm_street("0 " + pin_road)[1] if pin_road else ""
    if pin_street and pin_street != listed:
        flags.append("PIN_STREET")
        notes.append(f"Pin is on: {pin_num + ' ' if pin_num else ''}{pin_road}")

    # Best guess at the right street address, when the evidence agrees.
    suggestion = ""
    if flags and pin_street and c and c["street"] == pin_street and name_only(pin_street) == name_only(listed):
        suggestion = f"{num} {pin_road}"
    elif flags and pin_street and name_only(pin_street) == name_only(listed) and pin_street != listed:
        suggestion = f"{num} {pin_road}"
    return flags, notes, suggestion, (c or {}).get("matched", ""), f"{pin_num} {pin_road}".strip()


def main(paths):
    out, flagged = [], []
    for path in paths:
        rows = list(csv.DictReader(open(path, newline="", encoding="utf-8")))
        print(f"Checking {len(rows)} houses in {path} …", flush=True)
        for r in rows:
            flags, notes, suggestion, census_match, pin_addr = check(r)
            rec = {"file": path, "name": r["name"], "listed": f'{r["address"]}, {r["city"]}',
                   "flags": " ".join(flags), "suggested_street": suggestion,
                   "census_match": census_match, "pin_address": pin_addr, "notes": "; ".join(notes)}
            out.append(rec)
            if flags:
                flagged.append(rec)
    with open("address_check.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0]))
        w.writeheader()
        w.writerows(out)
    print(f"\n{len(flagged)} of {len(out)} houses flagged (full report: address_check.csv)\n")
    for r in flagged:
        print(f'- {r["name"]}: {r["listed"]}  [{r["flags"]}]')
        if r["suggested_street"]:
            print(f'    suggested: {r["suggested_street"]}')
        if r["notes"]:
            print(f'    {r["notes"]}')


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
