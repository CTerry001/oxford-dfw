# Oxford House Chapter Map

A free, static map (GitHub Pages) showing which Oxford House **chapter** each house belongs to,
built for the owner's Oxford House community. Live at **https://oxfordchapters.com/** (custom domain,
registered at Porkbun; DNS points at GitHub Pages). Old address cterry001.github.io/oxford-dfw redirects there.
Repo `CTerry001/oxford-dfw`, branch `main`, root; the `CNAME` file holds the domain, so don't delete it.
Pushing to `main` redeploys in ~1 minute.

No build step: `index.html` + `js/app.js` + `js/geo.js` + `css/style.css`, data in `data/`.
Test locally with `python3 -m http.server` (opening the file directly won't load the data).

## The owner's standing decisions — follow these

**Map defaults**
- The site must open on **Fort Worth only**. Do not change the default region.
- Dallas / Denton / Collin is live (un-hidden 2026-11-21, owner's request) and appears in the region
  dropdown; Fort Worth stays first in `regions.json`, so it's still the default. Its chapters (2, 3, 4,
  16, 22, 23, 24, 34, 35, 39, 42, 43) came from a meetup sheet the owner collected. Hillcrest Oaks is
  confirmed to be in no chapter. Dallas dues rates are unknown, so none are shown.
- A region can be hidden with `"hidden": true` (no dropdown entry; opens only via `?region=<id>`). Use
  that for any new area until the owner supplies its chapters, and un-hide only when they say so.
- `meetup.html?region=<id>&text=<phone>` prints a one-page names-only sheet with chapter boxes for
  meetups. Never commit the owner's phone number; it goes only in the link.

**Chapter data**
- Chapter numbers come **only from the owner**. Never guess or infer a house's chapter.
  Fort Worth chapters: 10, 14, 18, 28, 41, 44. Chapters can share a neighborhood (10 and 28 both
  cover the southwest), and a chapter can include a distant house (41 includes Big Bend, Wichita Falls).
- A house with no chapter yet stays blank in the CSV (it shows as a gray "?" pin).
- Without official boundaries, shaded areas are "nearest house within 2 km" territories, not convex hulls.

**Beds and dues**
- Each house's `beds` column is the bed count from oxfordvacancies.com's capacity (`cap`) field; the
  importer fills it on every re-import.
- Each chapter's dues rate is `duesPerBed` in `data/regions.json`, given by the owner (Fort Worth:
  41 = $45, 18 = $40, 10/14/28/44 = $35). Chapter dues = beds × rate. The owner didn't say the period
  (monthly etc.), so don't label one. Never guess a rate for a chapter the owner hasn't given.
- The map's chapter list and the handout show houses, beds, and dues per chapter; the handout lists each
  house's bed count before its M/W tag.

**Addresses**
- oxfordvacancies.com (the source) has address errors, e.g. Downey is 1704 Downey **Dr**, listed as Rd.
- After importing houses, run `scripts/check_addresses.py` (Census geocoder + OpenStreetMap
  pin check). Fix only what Census and the map pin both confirm; ask the owner about conflicts.
- Record every fix in `data/corrections.csv`. `scripts/import_oxfordvacancies.py` re-applies
  them on every re-import, so never hand-edit an address without also adding a correction row.
- Import only house name, address, gender, **house** phone and coordinates. Do not import contact
  people's names or personal cell numbers.

**Printable handout** (`print.html` → `handouts/fort-worth-chapters.pdf` + `.png`)
- One US Letter page: header, map of the whole region, then one card per chapter listing its houses,
  footer with a QR code to the live site.
- Each house line is **name · street address · ZIP · beds · M/W/W+C tag**. No city, because cities got cut off.
  Street types and directions use USPS abbreviations (Drive→Dr, Northeast→NE), but only for the
  street type and direction, so names like "Trail Lake Dr" stay intact.
- **Nothing may be cut off.** Cards auto-shrink street text slightly to fit. After regenerating, check
  `data-truncated` is empty (`chromium --headless --dump-dom …/print.html | grep data-truncated`),
  the PDF is exactly 1 page, and the QR decodes (`zbarimg`).
- Keep it pretty: the owner cares about clean, aligned formatting.
- Regenerate the handout whenever house data, chapters or addresses change.

**Dallas chapter worksheet** (`worksheet.html?region=dallas` → `handouts/dallas-chapter-worksheet.pdf`)
- A paper form for Dallas leadership: page 1 has a numbered map and instructions, then a numbered house
  list grouped by county and city with a "Ch." box. Close-up maps come from `closeups` in `regions.json`.
- Same rules as the handout: nothing cut off (`data-truncated` empty), clean formatting.
- The online equivalent is a Google Sheet in the owner's Drive (link in Claude's memory, not in this public
  repo). When the owner says it's filled in, read it, update `data/dallas/houses.csv`, check the
  notes for address fixes, preview at `?region=dallas`, and un-hide only with the owner's OK.

**How to work with the owner**
- The owner is not a developer. Explain in plain language and avoid jargon.
- When they say "just planning" or "make no changes", give a plan and change nothing.
- Pushing to GitHub publishes publicly. Ask before pushing unless they've said to push.
- Keep it free: GitHub Pages, OpenStreetMap tiles, no paid APIs. Prefer privacy-friendly choices,
  because visitors are people in recovery (no tracking cookies, no IP-geolocation services).

## Open items (decided against or still pending)
- Region by visitor IP: decided against (inaccurate at Fort Worth vs. Dallas distance, privacy cost).
  Suggested instead: a "Near me" button (browser location), remembering the last region, per-region links.
- Mass-texting house contacts for chapter info: advised against (unsolicited automated SMS rules,
  poor fit). Better: ask the Texas state association or chapter officers for a roster, or add an
  opt-in "report your chapter" form.
- Traffic stats: not set up. If added, use a cookie-free tool (GoatCounter or Cloudflare Web Analytics).
- Custom domain: oxfordchapters.com, bought Nov 2026 (Porkbun). Hosting stays on GitHub Pages (free);
  AWS was considered and isn't needed for a static site.

## Useful commands
```sh
python3 scripts/import_oxfordvacancies.py data/dallas/houses.csv Dallas Denton Collin   # refresh houses, keeps chapters + corrections
python3 scripts/check_addresses.py data/fort-worth/houses.csv data/dallas/houses.csv    # ~5 min, writes address_check.csv
python3 scripts/geocode.py data/<region>/houses.csv                                     # fill missing lat/lng for hand-added houses
```
