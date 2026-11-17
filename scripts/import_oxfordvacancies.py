#!/usr/bin/env python3
"""Import houses for one or more Texas counties from oxfordvacancies.com.

Usage:
    python3 scripts/import_oxfordvacancies.py data/dallas/houses.csv Dallas Denton Collin

- Writes name, address, city, state, zip, gender, house phone, lat, lng.
- If the CSV already exists, chapter numbers you've entered are KEPT (matched by
  house name + street address), and any extra houses you added by hand are kept too.
- Contact-person names and personal cell numbers are deliberately not imported.
"""
import csv
import json
import os
import re
import sys
import urllib.parse
import urllib.request

FIELDS = ["name", "address", "city", "state", "zip", "chapter", "gender", "phone", "lat", "lng"]
GENDER = {"M": "Men", "W": "Women", "WC": "Women & Children", "MC": "Men & Children"}


def fetch_state(state="TX"):
    url = "https://oxfordvacancies.com/?" + urllib.parse.urlencode(
        {"state": state, "county": "", "gender": "", "q": "", "openOnly": "false", "handler": "mapdata"})
    req = urllib.request.Request(url, headers={"User-Agent": "oxford-chapter-map-importer/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def key(name, address):
    norm = lambda s: re.sub(r"[^a-z0-9]", "", (s or "").lower())
    return norm(name) + "|" + norm(address)


def main(path, counties):
    wanted = {c.lower() for c in counties}
    existing = []
    if os.path.exists(path):
        with open(path, newline="", encoding="utf-8") as f:
            existing = list(csv.DictReader(f))
    old = {key(r["name"], r["address"]): r for r in existing}

    rows, seen = [], set()
    for h in fetch_state():
        if (h.get("c") or "").lower() not in wanted:
            continue
        m = re.match(r"^(.*?),\s*([^,]+),\s*([A-Z]{2})\s*(\d{5})?", h.get("a") or "")
        street, city, st, zip_ = m.groups() if m else (h.get("a") or "", "", "TX", "")
        row = {"name": h["n"].strip(), "address": street.strip(), "city": city.strip(), "state": st,
               "zip": zip_ or "", "chapter": "", "gender": GENDER.get(h.get("g"), h.get("g") or ""),
               "phone": h.get("p") or "", "lat": h.get("la") or "", "lng": h.get("lo") or ""}
        k = key(row["name"], row["address"])
        if k in old:
            row["chapter"] = old[k].get("chapter", "")
        seen.add(k)
        rows.append(row)

    kept = [r for k, r in old.items() if k not in seen]  # hand-added / no longer listed
    rows += kept
    rows.sort(key=lambda r: (r["city"].lower(), r["name"].lower()))

    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)} houses written to {path} "
          f"({len(rows) - len(kept)} from oxfordvacancies.com, {len(kept)} kept from existing file)")
    if kept:
        print("Kept (not currently listed on the site):", ", ".join(r["name"] for r in kept))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2:])
