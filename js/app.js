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

  const { regions } = await fetch('data/regions.json').then(r => r.json());
  const select = $('region-select');
  select.innerHTML = regions.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  select.hidden = regions.length < 2;
  select.addEventListener('change', () => loadRegion(regions.find(r => r.id === select.value)));

  const params = new URLSearchParams(location.search);
  const startRegion = regions.find(r => r.id === params.get('region')) || regions[0];
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
    for (const h of state.houses) if (!known.has(h.chapter)) h.chapter = UNASSIGNED;

    let boundaryFeatures = [];
    if (region.boundaries) {
      try {
        const gj = await fetch(region.boundaries).then(r => r.json());
        boundaryFeatures = gj.features || [];
      } catch { /* no boundaries file yet */ }
    }
    state.usesBoundaries = boundaryFeatures.length > 0;

    for (const info of region.chapters) {
      const houses = state.houses.filter(h => h.chapter === info.id);
      let features = boundaryFeatures.filter(f => String(f.properties?.chapter) === info.id);
      if (!state.usesBoundaries && houses.length) {
        features = [{ type: 'Feature', properties: { chapter: info.id },
          geometry: { type: 'Polygon', coordinates: [Geo.paddedHull(houses.map(h => h.pt))] } }];
      }
      const layer = L.geoJSON(features, { style: baseStyle(info), interactive: true })
        .on('click', () => focusChapter(info.id));
      const ch = { info, features, layer, houses, markers: [], visible: true, label: null };
      if (features.length) {
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

    const all = state.houses.map(h => [h.pt[1], h.pt[0]]);
    if (all.length) map.fitBounds(all, { padding: [30, 30] });

    renderLegend();
    const assignedCount = state.houses.filter(h => h.chapter !== UNASSIGNED).length;
    $('area-note').textContent = state.usesBoundaries
      ? 'Shaded areas are official chapter boundaries.'
      : assignedCount
        ? 'Shaded areas are approximate — drawn around each chapter’s houses.'
        : 'No houses have a chapter assigned yet, so chapter areas can’t be drawn.';
    $('search').value = '';
    renderResults('');
  }

  function baseStyle(info) {
    return { color: info.color, weight: 2, fillColor: info.color, fillOpacity: 0.15, opacity: 0.8 };
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
      ${h.gender ? ' · ' + esc(h.gender) : ''}
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
        <span class="count">${ch.houses.length} house${ch.houses.length === 1 ? '' : 's'}</span>
      </li>`).join('');
    $('legend').querySelectorAll('input').forEach(cb =>
      cb.addEventListener('change', () => setChapterVisible(cb.dataset.ch, cb.checked)));
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
      meta: [[h.address, h.city].filter(Boolean).join(', '), h.gender].filter(Boolean).join(' · '),
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
      const { id, approx, nearest } = chapterForPoint(pt);
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
          : state.houses.some(h => h.chapter !== UNASSIGNED) || state.usesBoundaries
            ? 'Outside all chapter areas' : 'Chapters not set up yet',
        note: approx && nearest
          ? `Approximate — nearest house is ${nearest.name} (${nearest.km.toFixed(1)} km away).`
          : approx ? 'Approximate — based on nearby houses.' : '',
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
    for (const ch of state.chapters.values()) {
      if (state.usesBoundaries && ch.features.some(f => Geo.pointInGeometry(pt, f.geometry))) {
        return { id: ch.info.id, approx: false };
      }
    }
    // No official boundary contains it: fall back to the nearest house's chapter.
    let best = null;
    for (const h of state.houses) {
      if (h.chapter === UNASSIGNED) continue;
      const km = Geo.distanceKm(pt, h.pt);
      if (!best || km < best.km) best = { km, name: h.name, chapter: h.chapter };
    }
    if (state.usesBoundaries) return { id: null, approx: false };
    return best ? { id: best.chapter, approx: true, nearest: best } : { id: null };
  }
})();
