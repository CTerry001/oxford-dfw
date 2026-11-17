// Small geometry + CSV helpers (no dependencies).
// Coordinates here are [lng, lat] to match GeoJSON.
window.Geo = (() => {
  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    const header = (rows.shift() || []).map(h => h.trim().toLowerCase());
    return rows
      .filter(r => r.some(v => v.trim()))
      .map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
  }

  function pointInRing([x, y], ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function pointInGeometry(pt, geom) {
    const polys = geom.type === 'Polygon' ? [geom.coordinates]
      : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    return polys.some(([outer, ...holes]) =>
      pointInRing(pt, outer) && !holes.some(h => pointInRing(pt, h)));
  }

  // Distance in km (haversine).
  function distanceKm([lng1, lat1], [lng2, lat2]) {
    const R = 6371, toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // "Territory" for each house: the area closer to it than to any other house
  // (a Voronoi cell), capped to a circle of radiusKm. Returns one ring per point.
  function territories(points, radiusKm = 2) {
    if (!points.length) return [];
    // Work in a local flat projection (km) around the average latitude.
    const lat0 = points.reduce((s, p) => s + p[1], 0) / points.length;
    const kx = 111.32 * Math.cos(lat0 * Math.PI / 180), ky = 110.57;
    const P = points.map(([x, y]) => [x * kx, y * ky]);
    const back = ([x, y]) => [x / kx, y / ky];

    return P.map((pi, i) => {
      let poly = [];
      for (let k = 0; k < 32; k++) {
        const a = (k / 32) * 2 * Math.PI;
        poly.push([pi[0] + radiusKm * Math.cos(a), pi[1] + radiusKm * Math.sin(a)]);
      }
      for (let j = 0; j < P.length && poly.length; j++) {
        const pj = P[j];
        if (j === i) continue;
        const dx = pj[0] - pi[0], dy = pj[1] - pi[1];
        if (dx * dx + dy * dy > 4 * radiusKm * radiusKm) continue;
        if (dx === 0 && dy === 0) { if (j < i) poly = []; continue; } // duplicate location
        // Keep the half-plane closer to pi: (p - mid) · (pj - pi) <= 0
        const mx = (pi[0] + pj[0]) / 2, my = (pi[1] + pj[1]) / 2;
        const side = p => (p[0] - mx) * dx + (p[1] - my) * dy;
        const out = [];
        for (let k = 0; k < poly.length; k++) {
          const a = poly[k], b = poly[(k + 1) % poly.length];
          const sa = side(a), sb = side(b);
          if (sa <= 0) out.push(a);
          if ((sa <= 0) !== (sb <= 0)) {
            const t = sa / (sa - sb);
            out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
          }
        }
        poly = out;
      }
      if (poly.length < 3) return null;
      const ring = poly.map(back);
      ring.push(ring[0]);
      return ring;
    });
  }

  return { parseCsv, territories, pointInGeometry, distanceKm };
})();
