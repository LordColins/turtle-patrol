// The map: satellite or street view, regions, beach sectors, nests, visits, your position,
// and the drawing tools admins use for sector borders. Built on Leaflet (window.L).
import { CONFIG } from './config.js';
import { esc, plural, polyCenter } from './util.js';

const Z_SECTORS = 11;   // from this zoom: sector shapes instead of region pins
const Z_DOTS = 14;      // from this zoom: individual nests instead of counts

function satelliteLayer() {
  const attribution = 'Imagery © Esri, Maxar, Earthstar Geographics';
  if (CONFIG.esriKey) {
    return L.tileLayer('https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/arcgis/imagery/static/tile/{z}/{y}/{x}?token=' + encodeURIComponent(CONFIG.esriKey),
      { tileSize: 512, zoomOffset: -1, maxNativeZoom: 19, maxZoom: 20, attribution });
  }
  return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxNativeZoom: 18, maxZoom: 20, attribution });
}
function streetLayer() {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxNativeZoom: 19, maxZoom: 20, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
}

export function createMapView(el, on) {
  const map = L.map(el, {
    zoomControl: false, attributionControl: true, minZoom: 8, maxZoom: 20,
    maxBounds: [[33.9, 31.6], [36.3, 35.4]], maxBoundsViscosity: 0.8, zoomSnap: 0.5,
  }).setView([35.13, 33.43], 9);
  map.attributionControl.setPrefix(false);
  const bases = { satellite: satelliteLayer(), streets: streetLayer() };
  let base = 'satellite'; bases.satellite.addTo(map);

  const layer = {};
  ['sectors', 'labels', 'nests', 'visits', 'focus', 'me', 'edit', 'place'].forEach(k => layer[k] = L.layerGroup().addTo(map));
  let state = null;
  let dragging = false;

  map.on('click', e => on.mapTap([+e.latlng.lat.toFixed(5), +e.latlng.lng.toFixed(5)]));
  map.on('zoomend', () => { if (state && !dragging) render(state); on.zoomChanged && on.zoomChanged(map.getZoom()); });

  const icon = (cls, html, size = [0, 0], anchor) => L.divIcon({ className: cls, html, iconSize: size, iconAnchor: anchor || [size[0] / 2, size[1] / 2] });

  function regionCenter(r, sectors) {
    const pts = sectors.filter(s => s.region_id === r.id && (s.boundary || []).length >= 3).flatMap(s => s.boundary);
    if (pts.length) {
      const lats = pts.map(p => p[0]), lngs = pts.map(p => p[1]);
      return [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2];
    }
    const c = CONFIG.regionCenters[r.code];
    return c ? [c.lat, c.lng] : null;
  }

  function render(st) {
    state = st;
    Object.values(layer).forEach(g => g.clearLayers());
    const z = map.getZoom();
    const quiet = st.mode === 'place' || st.mode === 'draw' || st.mode === 'border';   // taps go to the map, not to shapes
    const drawn = st.sectors.filter(s => (s.boundary || []).length >= 3);

    if (z < Z_SECTORS && !quiet && st.mode !== 'edit') {
      // Region pins. Nearby regions (İskele and Bafra are 5 km apart) would cover each other's labels,
      // so labels are stacked in a column with a short line back to their pin.
      const W = map.getSize().x;
      const items = st.regions.map(r => {
        const c = regionCenter(r, st.sectors); if (!c) return null;
        const n = st.nests.filter(x => st.sectors.some(s => s.id === x.sector_id && s.region_id === r.id)).length;
        return { r, c, n, pt: map.latLngToContainerPoint(c) };
      }).filter(Boolean);
      [true, false].forEach(left => {
        const grp = items.filter(it => (it.pt.x > W * 0.55) === left).sort((a, b) => a.pt.y - b.pt.y);
        let last = -Infinity;
        grp.forEach(it => { it.left = left; it.y = Math.max(it.pt.y, last + 42); last = it.y; });
        const shift = grp.length ? grp.reduce((a, it) => a + it.y - it.pt.y, 0) / grp.length : 0;
        grp.forEach(it => { it.dy = Math.round(it.y - it.pt.y - shift); });
      });
      items.forEach(({ r, c, n, left, dy }) => {
        const lead = Math.abs(dy) > 6 ? '<span class="lead" style="width:' + Math.round(Math.hypot(14, dy)) + 'px;transform:rotate(' + (Math.atan2(dy, left ? -14 : 14) * 180 / Math.PI).toFixed(1) + 'deg)"></span>' : '';
        L.marker(c, { icon: icon('m-region', lead + '<span class="pin"></span><span class="txt' + (left ? ' left' : '') + '" style="top:' + (dy - 17) + 'px"><b>' + esc(r.name) + '</b><small>' + plural(n, 'nest') + '</small></span>'), keyboard: false })
          .on('click', () => on.regionTap(r.id)).addTo(layer.labels);
      });
    } else {
      drawn.forEach(s => {
        const sel = st.selSectorId === s.id && (st.mode === 'edit' || st.mode === 'border');
        if (st.mode === 'border' && sel) return;   // drawn by the editor instead
        const poly = L.polygon(s.boundary, {
          className: 'm-sector ' + (st.sectorClass ? st.sectorClass(s) : '') + (sel ? ' sel' : ''),
          interactive: !quiet, bubblingMouseEvents: false, weight: 2,
        }).addTo(layer.sectors);
        if (!quiet) poly.on('click', () => on.sectorTap(s.id));
        const n = st.nests.filter(x => x.sector_id === s.id).length;
        const v = st.visits ? st.visits.filter(x => x.sector_id === s.id).length : 0;
        poly.bindTooltip('<b>' + esc(s.name) + '</b>' + (z >= 12 ? '<small>' + plural(n, 'nest') + (st.visits ? ' · ' + plural(v, 'visit') : '') + '</small>' : ''),
          { permanent: true, direction: 'right', className: 'm-label', offset: [14, 0], interactive: false });
        if (z < Z_DOTS && n && !quiet) {
          L.marker(polyCenter(s.boundary), { icon: icon('m-count', '<span>' + n + '</span>', [26, 26]), keyboard: false })
            .on('click', () => on.sectorTap(s.id)).addTo(layer.labels);
        }
      });
    }

    if (z >= Z_DOTS && st.mode !== 'draw' && st.mode !== 'border') {
      if (st.visits) st.visits.forEach(v => {
        L.marker([v.lat, v.lng], { icon: icon('m-visit', '<span></span>', [20, 20]), interactive: !quiet, keyboard: false })
          .on('click', () => on.visitTap(v.id)).addTo(layer.visits);
      });
      st.nests.forEach(n => {
        L.circleMarker([n.lat, n.lng], { radius: 8, className: 'm-nest st-' + n.status, interactive: !quiet, bubblingMouseEvents: false, weight: 2.5, fillOpacity: 1 })
          .on('click', () => on.nestTap(n.id)).addTo(layer.nests);
      });
      const f = st.focusId && (st.nests.find(n => n.id === st.focusId) || (st.visits || []).find(v => v.id === st.focusId));
      if (f) {
        L.circleMarker([f.lat, f.lng], { radius: 15, className: 'm-focus', interactive: false, fill: false }).addTo(layer.focus);
        L.circleMarker([f.lat, f.lng], { radius: 20, className: 'm-focus pulse', interactive: false, fill: false }).addTo(layer.focus);
      }
    }

    if (st.me) {
      L.circle([st.me.lat, st.me.lng], { radius: Math.max(5, st.me.acc), className: 'm-me-acc', interactive: false, weight: 1 }).addTo(layer.me);
      L.circleMarker([st.me.lat, st.me.lng], { radius: 9, className: 'm-me', interactive: false, weight: 3.5, fillOpacity: 1 }).addTo(layer.me);
    }

    if (st.mode === 'place' && st.placing) {
      L.marker(st.placing, { icon: icon('m-pin', '<span></span>', [26, 26]), interactive: false }).addTo(layer.place);
    }

    if (st.mode === 'draw' && st.draft.length) {
      (st.draft.length >= 3 ? L.polygon(st.draft, { className: 'm-draft', interactive: false, weight: 2.5 })
                            : L.polyline(st.draft, { className: 'm-draft', interactive: false, weight: 2.5 })).addTo(layer.edit);
      st.draft.forEach(p => L.circleMarker(p, { radius: 6, className: 'm-vtx-dot', interactive: false, fillOpacity: 1 }).addTo(layer.edit));
    }

    if (st.mode === 'border' && st.border) drawBorderEditor(st);
  }

  function drawBorderEditor(st) {
    const pts = st.border;
    const poly = L.polygon(pts, { className: 'm-draft', interactive: false, weight: 2.5 }).addTo(layer.edit);
    const mids = [];
    const midOf = i => { const a = pts[i], b = pts[(i + 1) % pts.length]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
    pts.forEach((p, i) => {
      const m = L.marker(midOf(i), { icon: icon('m-mid', '<span></span>', [26, 26]), keyboard: false })
        .on('click', () => on.midTap(i)).addTo(layer.edit);
      mids.push(m);
    });
    pts.forEach((p, i) => {
      const v = L.marker(p, { icon: icon('m-vtx' + (st.selVertex === i ? ' sel' : ''), '<span></span>', [34, 34]), draggable: true, keyboard: false, autoPan: true });
      v.on('dragstart', () => { dragging = true; });
      v.on('drag', e => {
        const ll = e.target.getLatLng(); pts[i] = [+ll.lat.toFixed(5), +ll.lng.toFixed(5)];
        poly.setLatLngs(pts); mids[i].setLatLng(midOf(i)); mids[(i - 1 + pts.length) % pts.length].setLatLng(midOf((i - 1 + pts.length) % pts.length));
      });
      v.on('dragend', () => { dragging = false; on.borderChanged(); });
      v.on('click', () => on.vertexTap(i));
      v.addTo(layer.edit);
    });
  }

  return {
    map, render,
    rerender() { if (state) render(state); },
    setBase(name) { if (name === base) return; map.removeLayer(bases[base]); bases[name].addTo(map); base = name; },
    get base() { return base; },
    zoomIn() { map.zoomIn(); }, zoomOut() { map.zoomOut(); },
    fitPoints(pts, maxZoom = 16) {
      if (!pts.length) return false;
      map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom }); return true;
    },
    fitCyprus() { map.fitBounds([[34.55, 32.25], [35.7, 34.6]], { padding: [10, 10] }); },
    // Opening view: the project's regions, close enough to tell them apart.
    fitHome(regions, sectors) {
      const pts = regions.map(r => regionCenter(r, sectors)).filter(Boolean);
      if (!pts.length) return this.fitCyprus();
      map.fitBounds(L.latLngBounds(pts), { padding: [70, 70], maxZoom: 10 });
    },
    regionView(r, sectors) {
      const pts = sectors.filter(s => s.region_id === r.id && (s.boundary || []).length >= 3).flatMap(s => s.boundary);
      if (pts.length) return this.fitPoints(pts, 16);
      const c = CONFIG.regionCenters[r.code];
      if (c) { map.setView([c.lat, c.lng], c.zoom); return true; }
      return false;
    },
    flyTo(ll, zoom) { map.setView(ll, Math.max(zoom || 17, map.getZoom())); },
    center(ll, zoom) { map.setView(ll, zoom ?? map.getZoom()); },
    zoom() { return map.getZoom(); },
    invalidate() { map.invalidateSize(); },
  };
}
