#!/usr/bin/env python3
"""Import houses for one or more Texas counties from oxfordvacancies.com.

Usage:
    python3 scripts/import_oxfordvacancies.py data/dallas/houses.csv Dallas Denton Collin

- Writes name, address, city, state, zip, gender, beds (the site's capacity), house phone, lat, lng.
- Fixes listed in data/corrections.csv (wrong addresses etc. in the source) are re-applied.
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

FIELDS = ["name", "address", "city", "state", "zip", "chapter", "gender", "beds", "phone", "lat", "lng"]
GENDER = {"M": "Men", "W": "Women", "WC": "Women & Children", "MC": "Men & Children"}


def fetch_state(state="TX"):
    url = "https://oxfordvacancies.com/?" + urllib.parse.urlencode(
        {"state": state, "county": "", "gender": "", "q": "", "openOnly": "false", "handler": "mapdata"})
    req = urllib.request.Request(url, headers={"User-Agent": "oxford-chapter-map-importer/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


CORRECTIONS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "corrections.csv")


def load_corrections():
    """data/corrections.csv: name,field,wrong,right,note — fixes for errors in the source listing."""
    if not os.path.exists(CORRECTIONS):
        return []
    with open(CORRECTIONS, newline="", encoding="utf-8") as f:
        return [r for r in csv.DictReader(f) if r.get("name") and r.get("field")]


def apply_corrections(row, corrections):
    for c in corrections:
        if c["name"].strip().lower() == row["name"].lower() and \
           row.get(c["field"], "").strip().lower() == c["wrong"].strip().lower():
            row[c["field"]] = c["right"].strip()


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

    corrections = load_corrections()
    rows, seen = [], set()
    source = fetch_state()
    for h in source:
        if (h.get("c") or "").lower() not in wanted:
            continue
        m = re.match(r"^(.*?),\s*([^,]+),\s*([A-Z]{2})\s*(\d{5})?", h.get("a") or "")
        street, city, st, zip_ = m.groups() if m else (h.get("a") or "", "", "TX", "")
        row = {"name": h["n"].strip(), "address": street.strip(), "city": city.strip(), "state": st,
               "zip": zip_ or "", "chapter": "", "gender": GENDER.get(h.get("g"), h.get("g") or ""),
               "beds": h.get("cap") or "",
               "phone": h.get("p") or "", "lat": h.get("la") or "", "lng": h.get("lo") or ""}
        apply_corrections(row, corrections)
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
    # County per house (used by worksheet.html to group the list).
    county = {h["n"].strip(): h.get("c", "") for h in source if (h.get("c") or "").lower() in wanted}
    with open(os.path.join(os.path.dirname(path) or ".", "counties.json"), "w", encoding="utf-8") as f:
        json.dump({r["name"]: county.get(r["name"], "") for r in rows}, f, indent=0, sort_keys=True)

    print(f"{len(rows)} houses written to {path} "
          f"({len(rows) - len(kept)} from oxfordvacancies.com, {len(kept)} kept from existing file)")
    if kept:
        print("Kept (not currently listed on the site):", ", ".join(r["name"] for r in kept))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2:])
