// Shared state and helpers used by every screen: what is loaded, who is signed in,
// toasts, the "Saving…" pill, sliding sheets, and the lists of screens and buttons.
import { api, friendly } from './api.js';
import { $, $$, esc, plural, today, fmt, daysBetween, ico } from './util.js';

/* =====================================================================
   Words used across the app
   ===================================================================== */
export const SPECIES = { cc: 'Caretta caretta', cm: 'Chelonia mydas' };
export const SPECIES_SHORT = { cc: 'Loggerhead', cm: 'Green turtle' };
export const SPECIES_V = { cc: 'Loggerhead', cm: 'Green turtle', unk: 'Species not sure' };
export const STATUS = { notprot: 'Not protected', prot: 'Protected', hatching: 'Hatching', hatched: 'Hatched', predation: 'Predation' };
export const ACTIVE = ['notprot', 'prot', 'hatching'];
export const VISIT_TYPE = { tracks: 'Tracks only', dig: 'Dug, no eggs' };
export const VISIT_TYPE_LONG = { tracks: 'Tracks only: came ashore and went back (false crawl)', dig: 'Started digging but laid no eggs (abandoned attempt)' };

/* =====================================================================
   State
   ===================================================================== */
export const emptySeason = () => ({ nests: [], results: [], visits: [], removed: [], gear: [], patrols: [], attendance: [] });
export const S = {
  session: null, me: null,
  base: { regions: [], sectors: [], seasons: [], settings: { hatch_months: 2, soon_days: 7, heat_start: '11:00', heat_end: '16:00' }, people: [] },
  year: null, data: emptySeason(),
  view: 'map', sheets: [], nestFilter: 'all', nestQuery: '', legend: false, showVisits: false,
  patrolDay: null, levelOpen: {},
};
// Map interaction state
export const M = { mode: 'view', selSector: null, draft: [], drawFor: null, border: null, borderFor: null, selVertex: null, borderDirty: false,
  placing: null, placeInfo: null, placeText: '', placeErr: '', placeKind: 'nest', focus: null, me: null, watchId: null, view: null, patrolOpen: false };

export const isAdmin = () => !!(S.me && S.me.role === 'admin');
export const sectorById = id => S.base.sectors.find(s => s.id === id);
export const regionById = id => S.base.regions.find(r => r.id === id);
export const sectorsOf = rid => S.base.sectors.filter(s => s.region_id === rid);
export const person = uid => S.base.people.find(x => x.id === uid);
export const personName = uid => { const p = person(uid); return p ? (p.name || p.nickname) : 'someone'; };
export const firstName = uid => { const p = person(uid); return p ? (p.name ? p.name.split(/\s+/)[0] : p.nickname) : 'someone'; };
export const resultOf = nestId => S.data.results.find(r => r.nest_id === nestId);
export const hasResults = n => isAdmin() ? !!resultOf(n.id) : !!n.has_results;
export const isCurrentSeason = () => S.year === new Date().getFullYear();
export const drawn = s => (s.boundary || []).length >= 3;
export function nestCode(n) { const s = sectorById(n.sector_id), r = s && regionById(s.region_id); return n.number + '-' + (r ? r.code : '?') + '-' + (s ? s.code : '?') + '-' + fmt(n.found_on); }
export const findNest = id => S.data.nests.find(n => n.id === id) || S.data.removed.find(n => n.id === id);
export const findVisit = id => S.data.visits.find(v => v.id === id);
export const findPatrol = id => S.data.patrols.find(p => p.id === id);
export const hm = t => String(t || '').slice(0, 5);              // "06:00:00" → "06:00"
const pad = n => String(n).padStart(2, '0');
export const nowHM = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };

export function nestTiming(n) {
  if (n.status === 'hatched') return isAdmin() ? (resultOf(n.id) ? 'Hatched, results recorded' : 'Hatched, results not recorded yet') : '';
  if (n.status === 'predation') return 'Lost to predation';
  const d = daysBetween(today(), n.expected_hatch);
  if (d > 1) return 'Expected to hatch in ' + d + ' days';
  if (d === 1) return 'Expected to hatch tomorrow';
  if (d === 0) return 'Expected to hatch today';
  return plural(-d, 'day') + ' past expected hatching date';
}

/* =====================================================================
   Loading a season
   ===================================================================== */
export async function loadSeason() {
  try {
    S.data = await api.loadSeason(S.year, isAdmin());
    if (S.data.setupMissing) toast('Patrols cannot load yet: the database needs an update. ' + (isAdmin() ? 'Run database/03_part2.sql in Supabase → SQL Editor.' : 'Tell an admin.'), 9000);
  }
  catch (e) { console.error(e); S.data = emptySeason(); toast(friendly(e), 6000); }
  HOOKS.changed();
}
export async function reloadBase() {
  S.base = await api.loadBase();
  S.me = S.base.people.find(p => p.id === S.me.id) || S.me;
  HOOKS.changed();
}

/* =====================================================================
   Small UI helpers
   ===================================================================== */
let toastTimer;
export function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, ms); }
let busyCount = 0;
export function busy(on, text = 'Saving…') { busyCount = Math.max(0, busyCount + (on ? 1 : -1)); $('#busyText').textContent = text; $('#busy').hidden = busyCount === 0; }
// Runs an action with a "Saving…" pill and turns errors into a toast; returns false on error.
export async function work(text, fn) {
  busy(true, text);
  try { const r = await fn(); return r === undefined ? true : r; }
  catch (e) { console.error(e); toast(friendly(e), 6000); return false; }
  finally { busy(false); }
}
export const statusChip = st => '<span class="chip st-' + st + '"><span class="dot"></span>' + STATUS[st] + '</span>';
export const switchHtml = (on, action, label) => '<div class="row" style="gap:8px;flex-wrap:nowrap"><span class="sw-label" aria-hidden="true">' + (on ? 'On' : 'Off') + '</span><button class="switch" role="switch" aria-checked="' + on + '" aria-label="' + esc(label) + '" data-a="' + action + '"></button></div>';
export const sectorOptions = sel => S.base.regions.map(r => '<optgroup label="' + esc(r.name) + '">' + sectorsOf(r.id).map(x => '<option value="' + x.id + '"' + (x.id === sel ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</optgroup>').join('');
export const choiceGroup = (name, options, value) => '<div class="checks" role="radiogroup">' + Object.keys(options).map(k => '<label class="check"><input type="radio" name="' + name + '" value="' + k + '"' + (k === value ? ' checked' : '') + '>' + options[k] + '</label>').join('') + '</div>';
export const radioValue = name => { const r = document.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : null; };

// Photos are private, so <img data-photo="path"> gets a short-lived link after rendering.
export async function hydratePhotos(root = document) {
  const imgs = $$('img[data-photo]', root); if (!imgs.length) return;
  const urls = await api.photoUrls(imgs.map(i => i.dataset.photo));
  imgs.forEach(i => { const u = urls[i.dataset.photo]; if (u && i.src !== u) i.src = u; });
}
export const photoImg = (path, alt, cls = '', style = '') => '<img class="' + cls + '"' + (style ? ' style="' + style + '"' : '') + ' data-photo="' + esc(path) + '" alt="' + esc(alt) + '" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">';

export const initials = t => String(t || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const AVC = ['accent', 'warn', 'info', 'pd', 'ok'];
// A person's photo, or their initials on a colour picked from their nickname.
export function avatar(p, size) {
  const st = 'width:' + size + 'px;height:' + size + 'px';
  if (!p) return '<span class="av" style="' + st + '"></span>';
  if (p.photo_path) return photoImg(p.photo_path, 'Photo of ' + (p.name || p.nickname), 'av', st);
  const c = AVC[[...p.nickname].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVC.length];
  return '<span class="av" style="' + st + ';font-size:' + Math.round(size * .36) + 'px;background:var(--' + c + '-soft);color:var(--' + c + ')" aria-hidden="true">' + esc(initials(p.name || p.nickname)) + '</span>';
}

/* =====================================================================
   Sheets (panels that slide up)
   ===================================================================== */
export const SHEETS = {};
let lastSheet = null;
export function openSheet(sh) { const top = S.sheets[S.sheets.length - 1]; if (top) top.scroll = $('#sheetBody').scrollTop; S.sheets.push(sh); renderSheet(); }
export function closeSheet() { S.sheets.pop(); if (S.sheets.length) renderSheet(); else hideSheet(); }
export function closeAllSheets() { S.sheets = []; hideSheet(); }
export function hideSheet() { $('#sheet').hidden = true; $('#scrim').hidden = true; lastSheet = null; }
export function renderSheet() {
  const sh = S.sheets[S.sheets.length - 1];
  if (!sh) return hideSheet();
  const r = SHEETS[sh.kind](sh);
  if (!r) return closeSheet();
  const body = $('#sheetBody');
  const keep = (lastSheet === sh && !$('#sheet').hidden) ? body.scrollTop : (sh.scroll || 0);
  lastSheet = sh;
  $('#sheetTitle').textContent = r.title;
  $('#sheetBack').hidden = S.sheets.length < 2;
  body.innerHTML = r.html;
  $('#sheet').hidden = false; $('#scrim').hidden = false;
  body.scrollTop = keep;
  if (r.after) r.after();
  hydratePhotos(body);
}
let pendingConfirm = null;
export function confirmSheet(title, msg, yes, danger, fn) { pendingConfirm = fn; openSheet({ kind: 'confirm', title, msg, yes, danger }); }
export function runConfirm() { const fn = pendingConfirm; pendingConfirm = null; closeSheet(); if (fn) fn(); }
SHEETS.confirm = sh => ({ title: sh.title, html: '<p style="margin:0;font-size:17px">' + sh.msg + '</p><div class="row"><button class="btn ghost" data-a="close-sheet">Cancel</button><button class="btn ' + (sh.danger ? 'danger' : 'primary') + '" data-a="confirm-yes">' + esc(sh.yes) + '</button></div>' });
SHEETS.info = sh => ({ title: sh.title, html: '<p style="margin:0;font-size:17px">' + sh.msg + '</p><div class="row"><button class="btn primary" data-a="close-sheet">OK</button></div>' });

/* =====================================================================
   Screens and buttons
   Each file adds its own: VIEWS[id] draws a page, ACTIONS[name] runs
   when a button with data-a="name" is tapped.
   ===================================================================== */
export const VIEWS = {};
export const ACTIONS = {};
export const HOOKS = { frame() {}, map() {}, changed() {} };   // filled in by app.js and control.js
export function renderAll() {
  if (!S.me) return;
  HOOKS.frame();
  HOOKS.map();
  if (S.view !== 'map' && VIEWS[S.view]) VIEWS[S.view]();
  if (S.sheets.length) renderSheet();
}
export { esc, plural, ico };
