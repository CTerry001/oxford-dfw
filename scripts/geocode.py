#!/usr/bin/env python3
"""Fill in missing lat/lng in a houses CSV.

Usage:
    python3 scripts/geocode.py data/fort-worth/houses.csv

Only rows with an empty lat or lng are looked up, so it's safe to re-run after
adding houses. Uses the free US Census geocoder first, then OpenStreetMap
Nominatim as a fallback. The CSV is rewritten in place.
"""
import csv
import json
import sys
import time
import urllib.parse
import urllib.request

UA = {"User-Agent": "oxford-chapter-map-geocoder/1.0"}


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def census(address):
    url = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?" + urllib.parse.urlencode(
        {"address": address, "benchmark": "Public_AR_Current", "format": "json"})
    matches = get_json(url)["result"]["addressMatches"]
    if matches:
        c = matches[0]["coordinates"]
        return c["y"], c["x"]
    return None


def nominatim(address):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": address, "format": "json", "limit": 1, "countrycodes": "us"})
    hits = get_json(url)
    time.sleep(1.1)  # Nominatim usage policy: max 1 request/second
    if hits:
        return float(hits[0]["lat"]), float(hits[0]["lon"])
    return None


def main(path):
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames
        rows = list(reader)

    failed = []
    for row in rows:
        if row.get("lat", "").strip() and row.get("lng", "").strip():
            continue
        address = ", ".join(p for p in (row.get("address"), row.get("city"), row.get("state"), row.get("zip")) if p and p.strip())
        result = None
        for fn in (census, nominatim):
            try:
                result = fn(address)
            except Exception as e:  # network hiccup: try the next service
                print(f"  {fn.__name__} error for {address!r}: {e}", file=sys.stderr)
            if result:
                break
        if result:
            row["lat"], row["lng"] = f"{result[0]:.6f}", f"{result[1]:.6f}"
            print(f"OK    {row.get('name')}: {address} -> {row['lat']}, {row['lng']}")
        else:
            failed.append(row.get("name") or address)
            print(f"FAIL  {row.get('name')}: {address}")

    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    if failed:
        print(f"\n{len(failed)} address(es) could not be found. Fix them, or paste lat/lng "
              "from Google Maps (right-click the spot) into the CSV.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
