# Oxford House Chapter Map

A free, static web map showing Oxford House chapters and which chapter each house
belongs to. Search a house by name or address, or type any street address to find
which chapter it falls in.

No server, no database, no build step. It runs on GitHub Pages for free.

## Run it locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

(Opening `index.html` directly from disk won't work; the browser blocks loading the data files.)

## Updating the data

Everything lives in `data/`:

| File | What it is |
|---|---|
| `data/regions.json` | List of regions (Fort Worth, later Dallas): map center, chapter names and colors |
| `data/<region>/houses.csv` | One row per house: `name,address,city,state,zip,chapter,gender,lat,lng` |
| `data/<region>/chapters.geojson` | *Optional* official chapter boundary shapes |

### Adding houses

1. Add rows to `data/fort-worth/houses.csv` (you can edit it right on GitHub or in Excel/Sheets). Leave `lat` and `lng` blank.
2. Run `python3 scripts/geocode.py data/fort-worth/houses.csv` to fill in coordinates.
3. Commit and push. The site updates in about a minute.

If an address won't geocode, right-click the house in Google Maps, copy the numbers, and paste them into `lat` and `lng`.

Leave `chapter` blank for a house whose chapter you don't know yet; it shows as a gray "?" pin.

The Tarrant County house list was copied from oxfordvacancies.com (Nov 2026). It does not update automatically.

### Chapter areas

- **No boundary file (default):** every spot within 2 km of a house is shaded in the color of its *nearest* house's chapter (so chapters that share a neighborhood, like 10 and 28, split it cleanly). Address lookups use the same nearest-house rule, and the app labels the result "approximate". Change the 2 km with `TERRITORY_KM` in `js/app.js`.
- **Official boundaries:** draw them at [geojson.io](https://geojson.io), add a property `"chapter": "10"` (e.g. "10", "14", "18", "28", "41", "44") to each shape, and save the result as `data/fort-worth/chapters.geojson`. The app then uses those exact shapes, and address lookups become exact.

### Adding Dallas

1. Create `data/dallas/houses.csv` (same columns) and optionally `data/dallas/chapters.geojson`.
2. Add a Dallas entry to `regions.json` (copy the Fort Worth block and change `id`, `name`, `center`, file paths, and chapters).

A region dropdown appears automatically once there's more than one region.

## Publishing on GitHub Pages (free)

1. Create a new **public** repository on GitHub (e.g. `oxford-chapter-map`) and push this folder to it.
2. In the repo, go to **Settings → Pages**, set **Source: Deploy from a branch**, branch **main**, folder **/ (root)**, and save.
3. After a minute the site is live at `https://<your-username>.github.io/oxford-chapter-map/`.

## Sharing a house

When you click a house, the address bar updates (e.g. `?region=fort-worth&house=sample-house-3a`).
Copy that link to send someone straight to that house.

## Credits

Map data © OpenStreetMap contributors. Address lookup by OpenStreetMap Nominatim and the US Census Geocoder.
