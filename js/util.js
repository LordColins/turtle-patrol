// Small helpers shared by the whole app: text, dates, coordinates, geometry, photos.

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const plural = (n, word, many) => n + ' ' + (n === 1 ? word : (many || word + 's'));

/* ---------- dates (always the phone's local calendar day) ---------- */
const pad = n => String(n).padStart(2, '0');
export const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const today = () => iso(new Date());
export const fmt = s => { if (!s) return '—'; const [y, m, d] = s.slice(0, 10).split('-'); return d + '/' + m + '/' + y; };
export const fmtStamp = s => { const d = new Date(s); return fmt(iso(d)) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
export function addMonths(s, n) {
  const d = parseISO(s), day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return iso(d);
}
const WD = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
const MON = new Intl.DateTimeFormat('en-GB', { month: 'short' });
export const weekday = s => WD.format(parseISO(s));
export const monthShort = s => MON.format(parseISO(s));
export const longDate = s => WD.format(parseISO(s)) + ' ' + parseISO(s).getDate() + ' ' + MON.format(parseISO(s)) + ' ' + s.slice(0, 4);
export const dayMonth = s => parseISO(s).getDate() + ' ' + MON.format(parseISO(s));

/* ---------- coordinates ---------- */
export const CY = { latMin: 34.45, latMax: 35.75, lngMin: 32.2, lngMax: 34.65 };
export const fmtLL = (lat, lng) => (+lat).toFixed(5) + ', ' + (+lng).toFixed(5);

// Reads "35.14294, 33.93160", "(35.14294 , 33.93160)", "35,14294; 33,93160",
// "35°08'34.6"N 33°55'53.8"E" and "35.14294° N, 33.93160° E".
export function parseCoords(str) {
  const s = String(str || '').trim();
  const example = 'For example: 35.14294, 33.93160';
  if (!s) return { ok: false, err: 'Enter the coordinates as latitude, longitude. ' + example };
  let lat, lng;
  if (/[°'′’"″”]|\d\s*[NSEWnsew]\b/.test(s)) {
    let vals = [], m;
    const reDeg = /(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′’]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:["″”]|['′’]{2})\s*)?([NSEWnsew])?/g;
    while ((m = reDeg.exec(s))) vals.push({ v: +m[1] + (m[2] ? +m[2] / 60 : 0) + (m[3] ? +m[3] / 3600 : 0), h: (m[4] || '').toUpperCase() });
    if (vals.length !== 2) { vals = []; const reH = /(\d+(?:\.\d+)?)\s*([NSEWnsew])\b/g; while ((m = reH.exec(s))) vals.push({ v: +m[1], h: m[2].toUpperCase() }); }
    if (vals.length !== 2) return { ok: false, err: 'Could not read these coordinates. ' + example };
    let [a, b] = vals;
    if ((a.h === 'E' || a.h === 'W') && (b.h === 'N' || b.h === 'S')) [a, b] = [b, a];
    lat = a.v * (a.h === 'S' ? -1 : 1); lng = b.v * (b.h === 'W' ? -1 : 1);
  } else {
    let t = s.replace(/[()\[\]]/g, ' ');
    if (!t.includes('.') && /\d,\d/.test(t)) t = t.replace(/(\d),(\d)/g, '$1.$2');
    const nums = t.match(/-?\d+(?:\.\d+)?/g) || [];
    if (nums.length !== 2) return { ok: false, err: 'Could not find two numbers. Write latitude first, then longitude. ' + example };
    lat = +nums[0]; lng = +nums[1];
  }
  const inLat = v => v >= CY.latMin && v <= CY.latMax, inLng = v => v >= CY.lngMin && v <= CY.lngMax;
  if (!inLat(lat) || !inLng(lng)) {
    if (inLat(lng) && inLng(lat)) return { ok: false, err: 'These look swapped. Latitude comes first: try ' + fmtLL(lng, lat) + '.' };
    if (!inLat(lat)) return { ok: false, err: 'Latitude ' + lat + ' is outside Cyprus. It should be between 34.5 and 35.7.' };
    return { ok: false, err: 'Longitude ' + lng + ' is outside Cyprus. It should be between 32.2 and 34.6.' };
  }
  return { ok: true, lat: +lat.toFixed(5), lng: +lng.toFixed(5) };
}

/* ---------- geometry on a flat projection around Cyprus (distances in km) ---------- */
const KX = 111.32 * Math.cos(35.2 * Math.PI / 180), KY = 110.57;
const xy = ([lat, lng]) => [lng * KX, lat * KY];
export function pointInPoly(ll, poly) {
  const [x, y] = xy(ll); let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = xy(poly[i]), [xj, yj] = xy(poly[j]);
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
export const NEAR_KM = 3;
// The sector a point is in, or the closest one, with the distance in km.
export function nearestSector(ll, sectors) {
  const drawn = sectors.filter(s => (s.boundary || []).length >= 3);
  const inside = drawn.find(s => pointInPoly(ll, s.boundary));
  if (inside) return { s: inside, km: 0, inside: true };
  const p = xy(ll); let best = null, bd = Infinity;
  drawn.forEach(s => { const ps = s.boundary.map(xy); ps.forEach((a, i) => { const d = segDist(p, a, ps[(i + 1) % ps.length]); if (d < bd) { bd = d; best = s; } }); });
  return best ? { s: best, km: bd, inside: false } : null;
}
export const kmText = km => km < 1 ? Math.max(10, Math.round(km * 100) * 10) + ' m' : km.toFixed(1) + ' km';
export function polyCenter(poly) {
  const n = poly.length; return [poly.reduce((a, p) => a + p[0], 0) / n, poly.reduce((a, p) => a + p[1], 0) / n];
}

/* ---------- photos ---------- */
// Shrinks to at most 1280 px and re-saves as JPEG. Re-saving also drops the hidden GPS data phones store in pictures.
export function resizePhoto(file, max = 1280) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file chosen.'));
    if (!file.type.startsWith('image/')) return reject(new Error('Choose an image file, like a JPG or PNG.'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? resolve(b) : reject(new Error('That photo could not be prepared. Try another one.')), 'image/jpeg', 0.8);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image could not be read. Try another photo.')); };
    img.src = url;
  });
}
export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

/* ---------- icons (outline, 24px grid) ---------- */
const I = {
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
  nest: '<path d="M12 3c3.6 0 6.5 5.6 6.5 10.3a6.5 6.5 0 0 1-13 0C5.5 8.6 8.4 3 12 3Z"/><path d="M9 14.5c.4 1.4 1.5 2.3 3 2.5"/>',
  tracks: '<path d="M8 3v18M16 3v18"/><path d="M4 6l4 1.5M4 11l4 1.5M4 16l4 1.5M20 8.5 16 10M20 13.5 16 15M20 18.5 16 20"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', right: '<path d="m9 6 6 6-6 6"/>', left: '<path d="m15 6-6 6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  loc: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>', sensor: '<circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
};
export const ico = (name, cls = '') => '<svg class="ico ' + cls + '" viewBox="0 0 24 24" aria-hidden="true">' + I[name] + '</svg>';
