(async () => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const map = L.map('map', { zoomControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const state = {
    region: null,
    chapters: new Map(),   // id -> { info, layer, label, feature(s), visible, markers }
    houses: [],
    usesBoundaries: false,
    layerGroup: L.layerGroup().addTo(map),
    lookupMarker: null,
    selected: null,
  };
  let activeIdx = -1, currentResults = [];  // search results state
  const UNASSIGNED = '?';
  const TERRITORY_KM = 2;

  const { regions } = await fetch('data/regions.json').then(r => r.json());
  const select = $('region-select');
  const params = new URLSearchParams(location.search);
  // Regions marked "hidden" (e.g. no chapter info yet) aren't offered in the dropdown,
  // but can still be opened directly with ?region=<id>.
  const startRegion = regions.find(r => r.id === params.get('region')) || regions.find(r => !r.hidden) || regions[0];
  const listed = regions.filter(r => !r.hidden || r === startRegion);
  select.innerHTML = listed.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  select.hidden = listed.length < 2;
  select.addEventListener('change', () => loadRegion(regions.find(r => r.id === select.value)));

  select.value = startRegion.id;
  await loadRegion(startRegion);
  if (params.get('house')) {
    const h = state.houses.find(h => h.slug === params.get('house'));
    if (h) selectHouse(h);
  }

  async function loadRegion(region) {
    state.region = region;
    state.layerGroup.clearLayers();
    state.chapters.clear();
    clearSelection();
    $('sample-banner').hidden = !region.sampleData;
    map.setView(region.center, region.zoom);

    const csv = await fetch(region.housesCsv).then(r => r.text());
    state.houses = Geo.parseCsv(csv).map(row => ({
      ...row,
      slug: slug(row.name || row.address),
      pt: [parseFloat(row.lng), parseFloat(row.lat)],
    })).filter(h => Number.isFinite(h.pt[0]) && Number.isFinite(h.pt[1]));
    // Houses whose chapter is blank (or not a known chapter) go in an "unassigned" group.
    const known = new Set(region.chapters.map(c => c.id));
    // A region can be one county of a shared house list (e.g. Dallas, Collin and Denton all use
    // data/dallas/houses.csv). Chapters that also have houses in another county get a note.
    state.spill = [];
    if (region.counties) {
      const countyOf = await fetch(region.countiesJson).then(r => r.json()).catch(() => ({}));
      const inRegion = h => region.counties.includes(countyOf[h.name]);
      const outside = {};
      for (const h of state.houses) if (!inRegion(h) && known.has(h.chapter)) {
        const k = h.chapter + '|' + countyOf[h.name];
        outside[k] = (outside[k] || 0) + 1;
      }
      state.spill = Object.entries(outside).map(([k, n]) => { const [ch, county] = k.split('|'); return { ch, county, n }; })
        .sort((a, b) => a.ch - b.ch);
      state.houses = state.houses.filter(inRegion);
    }
    for (const h of state.houses) if (!known.has(h.chapter)) h.chapter = UNASSIGNED;

    let boundaryFeatures = [];
    if (region.boundaries) {
      try {
        const gj = await fetch(region.boundaries).then(r => r.json());
        boundaryFeatures = gj.features || [];
      } catch { /* no boundaries file yet */ }
    }
    state.usesBoundaries = boundaryFeatures.length > 0;

    // Without official boundaries, each house gets a "territory": the area nearer to it
    // than to any other house (capped at TERRITORY_KM). Unassigned houses take part so
    // that a chapter's color never spreads over a house we don't know about.
    if (!state.usesBoundaries) {
      Geo.territories(state.houses.map(h => h.pt), TERRITORY_KM)
        .forEach((ring, i) => { state.houses[i].territory = ring; });
    }

    for (const info of region.chapters) {
      const houses = state.houses.filter(h => h.chapter === info.id);
      let features = boundaryFeatures.filter(f => String(f.properties?.chapter) === info.id);
      const rings = houses.map(h => h.territory).filter(Boolean);
      if (!state.usesBoundaries && rings.length) {
        features = [{ type: 'Feature', properties: { chapter: info.id },
          geometry: { type: 'MultiPolygon', coordinates: rings.map(r => [r]) } }];
      }
      const layer = L.geoJSON(features, { style: baseStyle(info), interactive: true })
        .on('click', () => focusChapter(info.id));
      const ch = { info, features, layer, houses, markers: [], visible: true, label: null };
      if (features.length && state.usesBoundaries) {
        const c = layer.getBounds().getCenter();
        ch.label = L.tooltip({ permanent: true, direction: 'center', className: 'chapter-label' })
          .setLatLng(c).setContent(`<span style="color:${info.color}">Ch ${esc(info.id)}</span>`);
      }
      state.chapters.set(info.id, ch);
    }
    const unassigned = state.houses.filter(h => h.chapter === UNASSIGNED);
    if (unassigned.length) {
      state.chapters.set(UNASSIGNED, {
        info: { id: UNASSIGNED, name: 'No chapter yet', color: '#8a8f98' },
        features: [], layer: L.geoJSON(null), houses: unassigned, markers: [], visible: true, label: null,
      });
    }

    // Draw areas first so pins sit on top.
    for (const ch of state.chapters.values()) {
      state.layerGroup.addLayer(ch.layer);
      if (ch.label) state.layerGroup.addLayer(ch.label);
    }
    for (const h of state.houses) {
      const ch = state.chapters.get(h.chapter);
      const color = ch?.info.color || '#777';
      h.marker = L.marker([h.pt[1], h.pt[0]], { icon: pinIcon(h.chapter, color), title: h.name })
        .bindPopup(popupHtml(h))
        .on('click', () => selectHouse(h, { pan: false }));
      ch?.markers.push(h.marker);
      state.layerGroup.addLayer(h.marker);
    }

    // Frame the opening view on the region itself, so a far-off house in the same
    // chapter (e.g. Wichita Falls) doesn't zoom the whole map out.
    const center = [region.center[1], region.center[0]];
    const nearby = state.houses.filter(h => Geo.distanceKm(center, h.pt) <= (region.radiusKm || 60))
      .map(h => [h.pt[1], h.pt[0]]);
    if (nearby.length) map.fitBounds(nearby, { padding: [30, 30] });

    renderLegend();
    const assignedCount = state.houses.filter(h => h.chapter !== UNASSIGNED).length;
    $('area-note').textContent = state.usesBoundaries
      ? 'Shaded areas are official chapter boundaries.'
      : assignedCount
        ? `Shaded areas are approximate: each spot is colored by its nearest house (within ${TERRITORY_KM} km).`
        : 'No houses have a chapter assigned yet, so chapter areas can’t be drawn.';
    if (state.spill.length) $('area-note').textContent += ' Also: ' + state.spill
      .map(x => `Chapter ${x.ch} has ${x.n} more house${x.n === 1 ? '' : 's'} in ${x.county} County`).join('; ') + '.';
    $('search').value = '';
    renderResults('');
  }

  function baseStyle(info) {
    // Territories are many small cells: fill only, so cell edges don't clutter the map.
    return state.usesBoundaries
      ? { color: info.color, weight: 2, fillColor: info.color, fillOpacity: 0.15, opacity: 0.8 }
      : { stroke: false, fillColor: info.color, fillOpacity: 0.22 };
  }

  function pinIcon(chapter, color, selected = false) {
    return L.divIcon({
      className: '',
      html: `<div class="pin${selected ? ' selected' : ''}" style="background:${color}">${esc(chapter)}</div>`,
      iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12],
    });
  }

  function popupHtml(h) {
    const ch = state.chapters.get(h.chapter);
    const addr = [h.address, h.city, h.state, h.zip].filter(Boolean).join(', ');
    return `<strong>${esc(h.name)}</strong><br>${esc(addr)}<br>
      <span style="color:${ch?.info.color};font-weight:700">${esc(ch?.info.name || 'Chapter ' + h.chapter)}</span>
      ${h.gender ? ' · ' + esc(h.gender) : ''}${h.beds ? ' · ' + esc(h.beds) + ' beds' : ''}
      ${h.phone ? `<br>House phone: <a href="tel:${esc(h.phone)}">${esc(h.phone)}</a>` : ''}`;
  }

  function renderLegend() {
    $('legend').innerHTML = [...state.chapters.values()].map(ch => `
      <li>
        <label>
          <input type="checkbox" data-ch="${esc(ch.info.id)}" ${ch.visible ? 'checked' : ''}>
          <span class="swatch" style="background:${ch.info.color}"></span>
          ${esc(ch.info.name)}
        </label>
        <span class="count">${chapterStats(ch)}</span>
      </li>`).join('') + regionTotals();
    $('legend').querySelectorAll('input').forEach(cb =>
      cb.addEventListener('change', () => setChapterVisible(cb.dataset.ch, cb.checked)));
  }

  function bedsOf(houses) { return houses.reduce((n, h) => n + (parseInt(h.beds, 10) || 0), 0); }
  function money(n) { return '$' + n.toLocaleString('en-US'); }

  // "11 houses · 87 beds" plus, when the chapter has a dues rate, "$35/bed = $3,045 dues".
  function chapterStats(ch) {
    const n = ch.houses.length, beds = bedsOf(ch.houses), rate = ch.info.duesPerBed;
    let out = `${n} house${n === 1 ? '' : 's'}`;
    if (beds) out += ` · ${beds} beds`;
    if (beds && rate) out += `<br>${money(rate)}/bed · <strong>${money(beds * rate)}</strong> dues`;
    return out;
  }

  function regionTotals() {
    const chs = [...state.chapters.values()];
    const beds = bedsOf(state.houses);
    if (!beds || chs.length < 2) return '';  // a one-chapter area doesn't need a total
    const dues = chs.reduce((t, ch) => t + (ch.info.duesPerBed ? bedsOf(ch.houses) * ch.info.duesPerBed : 0), 0);
    return `<li class="totals"><span>All chapters</span><span class="count">${state.houses.length} houses · ${beds} beds${
      dues ? `<br><strong>${money(dues)}</strong> dues` : ''}</span></li>`;
  }

  function setChapterVisible(id, visible) {
    const ch = state.chapters.get(id);
    ch.visible = visible;
    const layers = [ch.layer, ch.label, ...ch.markers].filter(Boolean);
    layers.forEach(l => visible ? state.layerGroup.addLayer(l) : state.layerGroup.removeLayer(l));
  }

  function highlightChapter(id) {
    for (const ch of state.chapters.values()) {
      const on = ch.info.id === id;
      ch.layer.setStyle(id == null ? baseStyle(ch.info) : {
        ...baseStyle(ch.info),
        weight: on ? 4 : 1,
        fillOpacity: on ? 0.32 : 0.05,
        opacity: on ? 1 : 0.35,
      });
      if (on) ch.layer.bringToFront();
    }
  }

  function focusChapter(id) {
    highlightChapter(id);
    const ch = state.chapters.get(id);
    if (ch?.features.length) map.fitBounds(ch.layer.getBounds(), { padding: [30, 30] });
  }

  function selectHouse(h, { pan = true } = {}) {
    if (state.selected && state.selected !== h) {
      const prev = state.selected;
      prev.marker.setIcon(pinIcon(prev.chapter, state.chapters.get(prev.chapter)?.info.color || '#777'));
    }
    state.selected = h;
    const ch = state.chapters.get(h.chapter);
    if (ch && !ch.visible) {
      setChapterVisible(h.chapter, true);
      renderLegend();
    }
    h.marker.setIcon(pinIcon(h.chapter, ch?.info.color || '#777', true));
    highlightChapter(h.chapter);
    if (pan) map.setView(h.marker.getLatLng(), Math.max(map.getZoom(), 14));
    h.marker.openPopup();
    showSelection({
      color: ch?.info.color,
      title: h.name,
      chapter: ch?.info.name || `Chapter ${h.chapter}`,
      meta: [[h.address, h.city].filter(Boolean).join(', '), h.gender, h.beds && `${h.beds} beds`].filter(Boolean).join(' · '),
    });
    const url = new URL(location.href);
    url.searchParams.set('region', state.region.id);
    url.searchParams.set('house', h.slug);
    history.replaceState(null, '', url);
  }

  function showSelection({ color, title, chapter, meta, note }) {
    const el = $('selection');
    el.hidden = false;
    el.style.borderLeftColor = color || 'var(--border)';
    el.innerHTML = `
      <div>${esc(title)}</div>
      <div class="chapter-tag" style="color:${color || 'inherit'}">${esc(chapter)}</div>
      ${meta ? `<div class="meta">${esc(meta)}</div>` : ''}
      ${note ? `<div class="meta">${esc(note)}</div>` : ''}`;
  }

  function clearSelection() {
    state.selected = null;
    $('selection').hidden = true;
    if (state.lookupMarker) { map.removeLayer(state.lookupMarker); state.lookupMarker = null; }
  }

  // ---- Search ----
  const searchInput = $('search');
  searchInput.addEventListener('input', () => renderResults(searchInput.value));
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!currentResults.length) return;
      activeIdx = (activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + currentResults.length) % currentResults.length;
      paintActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (currentResults.length) selectHouse(currentResults[Math.max(activeIdx, 0)]);
      else if (searchInput.value.trim()) lookupAddress(searchInput.value.trim());
    } else if (e.key === 'Escape') {
      searchInput.value = ''; renderResults('');
    }
  });

  function renderResults(q) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    currentResults = terms.length
      ? state.houses.filter(h => {
          const hay = `${h.name} ${h.address} ${h.city} ${h.zip} chapter ${h.chapter} ${h.gender}`.toLowerCase();
          return terms.every(t => hay.includes(t));
        }).slice(0, 12)
      : [];
    activeIdx = -1;
    $('results').innerHTML = currentResults.map((h, i) => {
      const color = state.chapters.get(h.chapter)?.info.color || '#777';
      return `<li data-i="${i}">
        <div class="pin" style="background:${color};flex:none">${esc(h.chapter)}</div>
        <div>${esc(h.name)}<small>${esc([h.address, h.city].filter(Boolean).join(', '))}</small></div>
      </li>`;
    }).join('');
    $('results').querySelectorAll('li').forEach(li =>
      li.addEventListener('click', () => selectHouse(currentResults[+li.dataset.i])));

    const btn = $('lookup-btn');
    btn.hidden = !q.trim();
    btn.textContent = `Which chapter is “${q.trim()}” in? (look up address)`;
  }

  function paintActive() {
    $('results').querySelectorAll('li').forEach((li, i) => li.classList.toggle('active', i === activeIdx));
  }

  $('lookup-btn').addEventListener('click', () => lookupAddress(searchInput.value.trim()));

  // Geocode any address with OpenStreetMap Nominatim and work out its chapter.
  async function lookupAddress(q) {
    const r = state.region;
    const btn = $('lookup-btn');
    btn.disabled = true; btn.textContent = 'Looking up…';
    try {
      const query = /\b(tx|texas)\b/i.test(q) ? q : `${q}, ${r.name}, TX`;
      const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
        q: query, format: 'json', limit: '1', countrycodes: 'us',
      });
      const [hit] = await fetch(url, { headers: { Accept: 'application/json' } }).then(res => res.json());
      if (!hit) {
        showSelection({ title: q, chapter: 'Address not found', note: 'Try adding a street number or ZIP code.' });
        return;
      }
      const pt = [parseFloat(hit.lon), parseFloat(hit.lat)];
      const { id, nearest, note } = chapterForPoint(pt);
      const ch = id && state.chapters.get(id);

      if (state.lookupMarker) map.removeLayer(state.lookupMarker);
      state.lookupMarker = L.marker([pt[1], pt[0]]).addTo(map)
        .bindPopup(`<strong>${esc(hit.display_name.split(',').slice(0, 3).join(','))}</strong><br>` +
          (ch ? `<span style="color:${ch.info.color};font-weight:700">${esc(ch.info.name)}</span>` : 'No chapter found'))
        .openPopup();
      map.setView([pt[1], pt[0]], 14);
      highlightChapter(id || null);

      showSelection({
        color: ch?.info.color,
        title: hit.display_name.split(',').slice(0, 3).join(','),
        chapter: ch ? ch.info.name
          : nearest?.chapter === UNASSIGNED ? 'Chapter unknown'
          : 'Outside all chapter areas',
        note,
      });
    } catch (err) {
      showSelection({ title: q, chapter: 'Lookup failed', note: 'Check your connection and try again.' });
      console.error(err);
    } finally {
      btn.disabled = false;
      renderResults(searchInput.value);
    }
  }

  function chapterForPoint(pt) {
    if (state.usesBoundaries) {
      for (const ch of state.chapters.values()) {
        if (ch.features.some(f => Geo.pointInGeometry(pt, f.geometry))) return { id: ch.info.id };
      }
      return { id: null };
    }
    // No official boundaries: use the nearest house (same rule the shading uses).
    let best = null;
    for (const h of state.houses) {
      const km = Geo.distanceKm(pt, h.pt);
      if (!best || km < best.km) best = { km, name: h.name, chapter: h.chapter };
    }
    if (!best) return { id: null, note: 'No houses loaded.' };
    const where = `${best.name} (${best.km.toFixed(1)} km away)`;
    if (best.chapter === UNASSIGNED) {
      return { id: null, nearest: best, note: `Nearest house is ${where}, which has no chapter assigned yet.` };
    }
    if (best.km > TERRITORY_KM) {
      const name = state.chapters.get(best.chapter)?.info.name;
      return { id: null, nearest: best, note: `No house within ${TERRITORY_KM} km. Nearest is ${where}, ${name}.` };
    }
    return { id: best.chapter, nearest: best, note: `Approximate: nearest house is ${where}.` };
  }
})();
