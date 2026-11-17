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

When the real data is in, delete the sample rows and set `"sampleData": false` in `regions.json` to hide the yellow banner.

### Chapter areas

- **No boundary file (default):** each chapter's shaded area is drawn automatically around its houses. Address lookups use the nearest house's chapter, and the app labels the result "approximate".
- **Official boundaries:** draw them at [geojson.io](https://geojson.io), add a property `"chapter": "1"` (etc.) to each shape, and save the result as `data/fort-worth/chapters.geojson`. The app then uses those exact shapes, and address lookups become exact.

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
