// Turtle Patrol: the app screens. Data comes from api.js, the map from map.js.
import { CONFIG } from './config.js';
import { api, friendly } from './api.js';
import { createMapView } from './map.js';
import {
  $, $$, esc, plural, today, fmt, fmtStamp, daysBetween, addMonths, longDate, dayMonth, weekday, monthShort, parseISO,
  fmtLL, parseCoords, nearestSector, NEAR_KM, kmText, resizePhoto, ico,
} from './util.js';

/* =====================================================================
   State
   ===================================================================== */
const SPECIES = { cc: 'Caretta caretta', cm: 'Chelonia mydas' };
const SPECIES_SHORT = { cc: 'Loggerhead', cm: 'Green turtle' };
const SPECIES_V = { cc: 'Loggerhead', cm: 'Green turtle', unk: 'Species not sure' };
const STATUS = { notprot: 'Not protected', prot: 'Protected', hatching: 'Hatching', hatched: 'Hatched', predation: 'Predation' };
const ACTIVE = ['notprot', 'prot', 'hatching'];
const VISIT_TYPE = { tracks: 'Tracks only', dig: 'Dug, no eggs' };
const VISIT_TYPE_LONG = { tracks: 'Tracks only: came ashore and went back (false crawl)', dig: 'Started digging but laid no eggs (abandoned attempt)' };

const S = {
  session: null, me: null,
  base: { regions: [], sectors: [], seasons: [], settings: { hatch_months: 2, soon_days: 7 }, people: [] },
  year: null, data: { nests: [], results: [], visits: [], removed: [] },
  view: 'map', sheets: [], nestFilter: 'all', nestQuery: '', legend: false, showVisits: false, started: false,
};
// Map interaction state
const M = { mode: 'view', selSector: null, draft: [], drawFor: null, border: null, borderFor: null, selVertex: null, borderDirty: false,
  placing: null, placeInfo: null, placeText: '', placeErr: '', placeKind: 'nest', focus: null, me: null, watchId: null, view: null };

const isAdmin = () => S.me && S.me.role === 'admin';
const sectorById = id => S.base.sectors.find(s => s.id === id);
const regionById = id => S.base.regions.find(r => r.id === id);
const sectorsOf = rid => S.base.sectors.filter(s => s.region_id === rid);
const personName = uid => { const p = S.base.people.find(x => x.id === uid); return p ? (p.name || p.nickname) : 'someone'; };
const resultOf = nestId => S.data.results.find(r => r.nest_id === nestId);
const isCurrentSeason = () => S.year === new Date().getFullYear();
const drawn = s => (s.boundary || []).length >= 3;
function nestCode(n) { const s = sectorById(n.sector_id), r = s && regionById(s.region_id); return n.number + '-' + (r ? r.code : '?') + '-' + (s ? s.code : '?') + '-' + fmt(n.found_on); }
const findNest = id => S.data.nests.find(n => n.id === id) || S.data.removed.find(n => n.id === id);
const findVisit = id => S.data.visits.find(v => v.id === id);

/* =====================================================================
   Small UI helpers
   ===================================================================== */
let toastTimer;
function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, ms); }
let busyCount = 0;
function busy(on, text = 'Saving…') { busyCount = Math.max(0, busyCount + (on ? 1 : -1)); $('#busyText').textContent = text; $('#busy').hidden = busyCount === 0; }
async function work(text, fn) {   // runs an action with a "Saving…" pill and turns errors into a toast; returns false on error
  busy(true, text);
  try { const r = await fn(); return r === undefined ? true : r; }
  catch (e) { console.error(e); toast(friendly(e), 6000); return false; }
  finally { busy(false); }
}
const statusChip = st => '<span class="chip st-' + st + '"><span class="dot"></span>' + STATUS[st] + '</span>';

// Photos are private, so <img data-photo="path"> gets a short-lived link after rendering.
async function hydratePhotos(root = document) {
  const imgs = $$('img[data-photo]', root); if (!imgs.length) return;
  const urls = await api.photoUrls(imgs.map(i => i.dataset.photo));
  imgs.forEach(i => { const u = urls[i.dataset.photo]; if (u && i.src !== u) i.src = u; });
}
const photoImg = (path, alt, cls = '') => '<img class="' + cls + '" data-photo="' + esc(path) + '" alt="' + esc(alt) + '" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">';

/* =====================================================================
   Sheets (panels that slide up)
   ===================================================================== */
const SHEETS = {};
let lastSheet = null;
function openSheet(sh) { const top = S.sheets[S.sheets.length - 1]; if (top) top.scroll = $('#sheetBody').scrollTop; S.sheets.push(sh); renderSheet(); }
function closeSheet() { S.sheets.pop(); if (S.sheets.length) renderSheet(); else hideSheet(); }
function closeAllSheets() { S.sheets = []; hideSheet(); }
function hideSheet() { $('#sheet').hidden = true; $('#scrim').hidden = true; lastSheet = null; }
function renderSheet() {
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
function confirmSheet(title, msg, yes, danger, fn) { pendingConfirm = fn; openSheet({ kind: 'confirm', title, msg, yes, danger }); }
SHEETS.confirm = sh => ({ title: sh.title, html: '<p style="margin:0;font-size:17px">' + sh.msg + '</p><div class="row"><button class="btn ghost" data-a="close-sheet">Cancel</button><button class="btn ' + (sh.danger ? 'danger' : 'primary') + '" data-a="confirm-yes">' + esc(sh.yes) + '</button></div>' });
SHEETS.info = sh => ({ title: sh.title, html: '<p style="margin:0;font-size:17px">' + sh.msg + '</p><div class="row"><button class="btn primary" data-a="close-sheet">OK</button></div>' });

/* =====================================================================
   Sign in, create account, reset password
   ===================================================================== */
const LOGO = '<img src="img/emu-sagem-logo.webp" alt="EMU SAGEM Underwater Research and Imaging Center logo">';
const WATERMARK = '<img class="watermark" src="img/emu-sagem-logo.webp" alt="" aria-hidden="true">';
const NICK_RE = /^[A-Za-z0-9_.çğıöşüÇĞİÖŞÜ-]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function showAuth(which, msg = '') {
  $('#boot').hidden = true; $('#app').hidden = true; $('#auth').hidden = false; closeAllSheets();
  const card = $('#authCard');
  const head = WATERMARK + '<div class="brand">' + LOGO + '<span>Turtle Patrol</span></div>';
  if (which === 'login') {
    card.innerHTML = head + '<h1>Sign in</h1>' +
      '<form id="loginForm" novalidate>' +
      '<label class="field"><span>Nickname</span><input class="line-input" id="li-nick" autocomplete="username" autocapitalize="none" spellcheck="false"></label>' +
      '<label class="field"><span>Password</span><input class="line-input" id="li-pass" type="password" autocomplete="current-password"></label>' +
      '<div class="err" id="li-err" role="alert">' + esc(msg) + '</div>' +
      '<div><button type="button" class="link" data-a="auth-forgot">Forgot your password?</button></div>' +
      '<div class="auth-actions"><button class="btn primary" type="submit" id="li-go">Sign in</button></div></form>' +
      '<div class="auth-foot"><div class="row" style="justify-content:space-between"><span class="muted">No account yet?</span><button class="btn" data-a="auth-create">Create an account</button></div></div>';
    $('#loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      const nick = $('#li-nick').value.trim(), pass = $('#li-pass').value, err = $('#li-err'), go = $('#li-go');
      if (!nick || !pass) { err.textContent = 'Enter your nickname and password.'; return; }
      go.disabled = true; go.textContent = 'Signing in…'; err.textContent = '';
      try { await api.signIn(nick, pass); }
      catch (ex) { err.textContent = friendly(ex); go.disabled = false; go.textContent = 'Sign in'; }
    });
  } else if (which === 'create') {
    card.innerHTML = head + '<h1>Create an account</h1>' +
      '<form id="createForm" novalidate>' +
      '<label class="field"><span>Nickname (what you sign in with)</span><input class="line-input" id="ca-nick" autocapitalize="none" autocomplete="username" spellcheck="false"></label>' +
      '<label class="field"><span>Email (needed to reset your password)</span><input class="line-input" id="ca-email" type="email" autocomplete="email"></label>' +
      '<label class="field"><span>Password (at least 8 characters)</span><input class="line-input" id="ca-pass" type="password" autocomplete="new-password"></label>' +
      '<label class="field"><span>Repeat password</span><input class="line-input" id="ca-pass2" type="password" autocomplete="new-password"></label>' +
      '<div class="err" id="ca-err" role="alert"></div>' +
      '<p class="hint" style="margin:0">New accounts start as members. Members can ask an admin for admin access from their account menu.</p>' +
      '<div class="auth-actions" style="justify-content:space-between"><button type="button" class="btn ghost" data-a="auth-login">Back</button><button class="btn primary" type="submit" id="ca-go">Create account</button></div></form>';
    $('#createForm').addEventListener('submit', async e => {
      e.preventDefault();
      const nick = $('#ca-nick').value.trim(), email = $('#ca-email').value.trim(), p1 = $('#ca-pass').value, p2 = $('#ca-pass2').value, err = $('#ca-err'), go = $('#ca-go');
      if (!NICK_RE.test(nick)) { err.textContent = 'Choose a nickname of 3 to 20 letters or numbers, without spaces.'; return; }
      if (!EMAIL_RE.test(email)) { err.textContent = 'Enter a valid email address. It is needed for password resets.'; return; }
      if (p1.length < 8) { err.textContent = 'Use a password of at least 8 characters.'; return; }
      if (p1 !== p2) { err.textContent = 'The two passwords do not match.'; return; }
      go.disabled = true; go.textContent = 'Creating…'; err.textContent = '';
      try {
        if (!(await api.nicknameFree(nick))) throw new Error('That nickname is taken. Try another one.');
        const data = await api.signUp({ nickname: nick, email, password: p1 });
        if (!data.session) showAuth('login', 'Account created. Open the link in the email we sent you, then sign in.');
      } catch (ex) { err.textContent = friendly(ex); go.disabled = false; go.textContent = 'Create account'; }
    });
  } else if (which === 'forgot') {
    card.innerHTML = head + '<h1>Reset your password</h1>' +
      '<form id="forgotForm" novalidate><p style="margin:0">Enter the email on your account. You will get a link to choose a new password.</p>' +
      '<label class="field"><span>Email</span><input class="line-input" id="fp-email" type="email" autocomplete="email"></label>' +
      '<div class="err" id="fp-err" role="alert"></div>' +
      '<div class="auth-actions" style="justify-content:space-between"><button type="button" class="btn ghost" data-a="auth-login">Back</button><button class="btn primary" type="submit" id="fp-go">Send reset link</button></div></form>';
    $('#forgotForm').addEventListener('submit', async e => {
      e.preventDefault();
      const v = $('#fp-email').value.trim(), err = $('#fp-err');
      if (!EMAIL_RE.test(v)) { err.textContent = 'Enter a valid email address, like name@uni.edu.'; return; }
      $('#fp-go').disabled = true;
      try { await api.sendReset(v); err.innerHTML = '<span style="color:var(--ok)">If an account uses this email, a reset link is on its way. Check your inbox and spam folder.</span>'; }
      catch (ex) { err.textContent = friendly(ex); $('#fp-go').disabled = false; }
    });
  } else if (which === 'recovery') {
    card.innerHTML = head + '<h1>Choose a new password</h1>' +
      '<form id="recForm" novalidate>' +
      '<label class="field"><span>New password (at least 8 characters)</span><input class="line-input" id="rc-pass" type="password" autocomplete="new-password"></label>' +
      '<label class="field"><span>Repeat new password</span><input class="line-input" id="rc-pass2" type="password" autocomplete="new-password"></label>' +
      '<div class="err" id="rc-err" role="alert"></div>' +
      '<div class="auth-actions"><button class="btn primary" type="submit" id="rc-go">Save password</button></div></form>';
    $('#recForm').addEventListener('submit', async e => {
      e.preventDefault();
      const p1 = $('#rc-pass').value, p2 = $('#rc-pass2').value, err = $('#rc-err');
      if (p1.length < 8) { err.textContent = 'Use a password of at least 8 characters.'; return; }
      if (p1 !== p2) { err.textContent = 'The two passwords do not match.'; return; }
      $('#rc-go').disabled = true;
      try { await api.setPassword(p1); S.recovery = false; toast('Password saved. You are signed in.'); await enterApp(await api.session()); }
      catch (ex) { err.textContent = friendly(ex); $('#rc-go').disabled = false; }
    });
  }
}

/* =====================================================================
   Loading data
   ===================================================================== */
let entering = null;
function enterApp(session) {   // one load at a time, even if Supabase reports the sign-in twice
  if (!entering) entering = doEnter(session).finally(() => { entering = null; });
  return entering;
}
async function doEnter(session) {
  if (!session) return showAuth('login');
  S.session = session;
  try {
    S.me = await api.me(session.user.id);
    S.base = await api.loadBase();
  } catch (e) {
    console.error(e);
    S.me = null;
    $('#auth').hidden = true; $('#app').hidden = true; $('#boot').hidden = false;
    $('#bootCard').innerHTML = '<h1 style="font-size:22px;margin:0 0 10px">Turtle Patrol could not load your data</h1><p style="margin:0">' + esc(friendly(e)) + '</p>' +
      '<div class="row" style="margin-top:16px"><button class="btn primary" data-a="reload">Try again</button><button class="btn ghost" data-a="sign-out">Sign out</button></div>';
    return;
  }
  const years = S.base.seasons.map(s => s.year), now = new Date().getFullYear();
  if (!years.includes(S.year)) S.year = years.includes(now) ? now : (years.filter(y => y <= now).pop() || years[years.length - 1] || now);
  await loadSeason();
  if (S.recovery) return showAuth('recovery');
  $('#boot').hidden = true; $('#auth').hidden = true; $('#app').hidden = false;
  if (!M.view) {
    M.view = createMapView($('#map'), mapHandlers);
    new ResizeObserver(() => M.view.invalidate()).observe($('#view-map'));
    M.view.fitHome(S.base.regions, S.base.sectors);
  }
  renderAll();
  requestAnimationFrame(() => M.view.invalidate());
}
async function loadSeason() {
  try { S.data = await api.loadSeason(S.year, isAdmin()); }
  catch (e) { console.error(e); S.data = { nests: [], results: [], visits: [], removed: [] }; toast(friendly(e), 6000); }
}
async function reloadAll() { S.base = await api.loadBase(); S.me = S.base.people.find(p => p.id === S.me.id) || S.me; await loadSeason(); renderAll(); }
async function reloadSeason() { await loadSeason(); renderAll(); }

/* =====================================================================
   Frame: top bar, tabs, views
   ===================================================================== */
const TABS = [
  { id: 'map', label: 'Map', ic: 'map' },
  { id: 'nests', label: 'Nests', ic: 'nest' },
  { id: 'visits', label: 'Visits', ic: 'tracks', admin: true },
];
function renderTabs() {
  $('#tabs').innerHTML = TABS.filter(t => !t.admin || isAdmin()).map(t =>
    '<button class="tab" data-a="tab" data-view="' + t.id + '"' + (S.view === t.id ? ' aria-current="page"' : '') + '>' + ico(t.ic) + '<span>' + t.label + '</span></button>').join('');
}
function renderTop() {
  $('#yearLabel').textContent = S.year;
  const b = $('#avatarBtn');
  b.innerHTML = S.me.photo_path ? photoImg(S.me.photo_path, '') : esc((S.me.name || S.me.nickname).split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase());
  hydratePhotos(b);
}
function showView() {
  $$('.view').forEach(v => v.hidden = v.dataset.view !== S.view);
  if (S.view === 'map') requestAnimationFrame(() => M.view && M.view.invalidate());
}
function renderAll() {
  if (!S.me) return;
  if (S.view === 'visits' && !isAdmin()) S.view = 'map';
  renderTop(); renderTabs(); showView();
  renderMap();
  if (S.view === 'nests') renderNests();
  if (S.view === 'visits') renderVisits();
  if (S.sheets.length) renderSheet();
}

/* =====================================================================
   Map view
   ===================================================================== */
const visitsOnMap = () => isAdmin() && S.showVisits;
function mapState() {
  return {
    regions: S.base.regions, sectors: S.base.sectors, nests: S.data.nests,
    visits: visitsOnMap() ? S.data.visits : null,
    mode: M.mode, selSectorId: M.selSector, draft: M.draft, border: M.border, selVertex: M.selVertex,
    placing: M.placing, focusId: M.focus, me: M.me,
  };
}
function renderMap() {
  if (!M.view) return;
  M.view.render(mapState());
  $('#map').classList.toggle('placing', M.mode === 'place' || M.mode === 'draw');
  renderMapChrome();
}
const mapHandlers = {
  mapTap(ll) {
    if (M.mode === 'draw') { M.draft.push(ll); renderMap(); return; }
    if (M.mode === 'place') { setPlace(ll, false); return; }
    if (M.mode === 'border') { if (M.selVertex !== null) { M.selVertex = null; renderMap(); } return; }
    if (M.mode === 'edit') { if (M.selSector) { M.selSector = null; renderMap(); } return; }
    if (M.focus || S.legend) { M.focus = null; S.legend = false; renderMap(); }
  },
  sectorTap(id) {
    if (M.mode === 'edit') { M.selSector = id; renderMap(); return; }
    if (M.mode === 'view') { M.focus = null; renderMapChrome(); openSheet({ kind: 'sector', id }); }
  },
  regionTap(id) { const r = regionById(id); if (r) M.view.regionView(r, S.base.sectors); },
  nestTap(id) { if (M.mode !== 'view') return; M.focus = id; S.legend = false; renderMap(); },
  visitTap(id) { if (M.mode !== 'view') return; M.focus = id; S.legend = false; renderMap(); },
  vertexTap(i) { M.selVertex = M.selVertex === i ? null : i; renderMap(); },
  midTap(i) { const p = M.border[i], q = M.border[(i + 1) % M.border.length]; M.border.splice(i + 1, 0, [+((p[0] + q[0]) / 2).toFixed(5), +((p[1] + q[1]) / 2).toFixed(5)]); M.borderDirty = true; M.selVertex = null; renderMap(); },
  borderChanged() { M.borderDirty = true; renderEditBar(); },
};

function renderMapChrome() {
  const admin = isAdmin();
  // Region chips
  $('#regionChips').innerHTML = [['cy', 'Cyprus']].concat(S.base.regions.map(r => [r.id, r.name]))
    .map(([id, name]) => '<button class="map-chip" data-a="fit-region" data-id="' + id + '">' + esc(name) + '</button>').join('');
  // Side buttons
  $('#mapSide').innerHTML =
    '<button class="icon-btn" data-a="zoom-in" aria-label="Zoom in">' + ico('plus') + '</button>' +
    '<button class="icon-btn" data-a="zoom-out" aria-label="Zoom out">' + ico('minus') + '</button>' +
    '<button class="icon-btn" data-a="locate" aria-pressed="' + (!!M.me) + '" aria-label="Show my position">' + ico('loc') + '</button>' +
    '<button class="icon-btn" data-a="toggle-base" aria-label="Switch between satellite and street map">' + ico('layers') + '</button>' +
    '<button class="icon-btn" data-a="toggle-legend" aria-pressed="' + S.legend + '" aria-label="Map key">' + ico('info') + '</button>' +
    (admin ? '<button class="icon-btn" data-a="toggle-edit" aria-pressed="' + (M.mode === 'edit' || M.mode === 'draw' || M.mode === 'border') + '" aria-label="Edit beach sectors">' + ico('edit') + '</button>' : '');
  // Legend
  const L = $('#legend'); L.hidden = !S.legend || M.mode !== 'view';
  if (!L.hidden) {
    const dot = c => '<i class="c" style="background:' + c + '"></i>';
    L.innerHTML = '<div class="eyebrow">Nests (zoom in to see)</div>' +
      [['notprot', '#E5533F'], ['prot', '#19A08F'], ['hatching', '#E9A23B'], ['hatched', '#8C99A6'], ['predation', '#9B7BD0']].map(([k, c]) => '<div class="row">' + dot(c) + STATUS[k] + '</div>').join('') +
      '<div class="row">' + dot('#2A7BE4') + 'You are here</div>' +
      (visitsOnMap() ? '<div class="row"><span class="lg-diamond"></span>Visit (came ashore, no nest)</div>' : '') +
      '<div class="hint" style="max-width:230px">Map: ' + (M.view.base === 'satellite' ? 'satellite' : 'streets') + '. The layers button switches it.' + (admin ? '' : ' Coordinates are visible to admins only.') + '</div>';
  }
  // Banner for an empty season, or sectors without borders
  const b = $('#mapBanner');
  const noBorders = S.base.sectors.length && !S.base.sectors.some(drawn);
  if (M.mode === 'view' && noBorders) { b.hidden = false; b.textContent = admin ? 'Draw the beach sectors: tap the pencil' : 'Beach sectors are not drawn yet'; }
  else if (M.mode === 'view' && !S.data.nests.length) { b.hidden = false; b.textContent = 'No nests logged for ' + S.year + ' yet'; }
  else b.hidden = true;
  $('#visitPill').hidden = !visitsOnMap() || M.mode !== 'view';
  $('#fab').hidden = M.mode !== 'view' || !!M.focus;
  renderEditBar(); renderMapCard();
}

function renderEditBar() {
  const bar = $('#editbar');
  bar.classList.toggle('list-mode', M.mode === 'edit' && !M.selSector);
  if (M.mode === 'view') { bar.hidden = true; return; }
  bar.hidden = false;
  if (M.mode === 'edit') {
    const sel = M.selSector && sectorById(M.selSector);
    const row = s => '<div class="sec-row"><div><b>' + esc(s.name) + '</b>' +
      '<span class="hint">' + esc(regionById(s.region_id)?.name || '') + ' · ' + (drawn(s) ? 'border drawn' : 'no border yet') + '</span></div><div class="row" style="gap:6px">' +
      (drawn(s) ? '<button class="btn small" data-a="border-start" data-id="' + s.id + '">Move border</button>' : '<button class="btn small primary" data-a="draw-start" data-id="' + s.id + '">Draw border</button>') +
      '<button class="icon-btn" data-a="sector-form" data-id="' + s.id + '" aria-label="Settings for ' + esc(s.name) + '" title="Name, code and usual need">' + ico('edit', 'sm') + '</button></div></div>';
    bar.innerHTML = '<div class="spread"><div class="title">' + (sel ? 'Sector: ' + esc(sel.name) : 'Editing beach sectors') + '</div><button class="btn small primary" data-a="toggle-edit">Done</button></div>' +
      (sel ? row(sel) + '<div class="row"><button class="btn small ghost" data-a="edit-deselect">Show all sectors</button><button class="btn small danger" data-a="sector-delete" data-id="' + sel.id + '">' + ico('trash', 'sm') + 'Delete sector</button></div>'
        : '<div class="hint">Tap a sector on the map or pick one below. Zoom in close to the beach before drawing.</div>' +
          S.base.regions.map(r => sectorsOf(r.id).map(row).join('')).join('') +
          '<div class="row" style="margin-top:4px"><button class="btn small" data-a="draw-start">' + ico('plus', 'sm') + 'New sector</button></div>');
  } else if (M.mode === 'draw') {
    const s = M.drawFor && sectorById(M.drawFor);
    bar.innerHTML = '<div class="title">' + (s ? 'Border of ' + esc(s.name) + ': tap the corners' : 'New sector: tap the corners') + '</div>' +
      '<div class="hint">Tap along the beach to mark each corner. ' + plural(M.draft.length, 'point') + ' so far; use at least 3.</div>' +
      '<div class="row"><button class="btn small" data-a="draw-undo"' + (M.draft.length ? '' : ' disabled') + '>' + ico('undo', 'sm') + 'Undo</button><button class="btn small ghost" data-a="draw-cancel">Cancel</button>' +
      '<button class="btn small primary" data-a="draw-finish"' + (M.draft.length >= 3 ? '' : ' disabled') + '>' + (s ? 'Save border' : 'Next') + '</button></div>';
  } else if (M.mode === 'border') {
    const s = sectorById(M.borderFor);
    bar.innerHTML = '<div class="title">Moving the border of ' + esc(s ? s.name : '') + '</div>' +
      '<div class="hint">Drag the white points. Tap a small dark point to add a corner there. Tap a white point, then Remove point, to delete it.</div>' +
      '<div class="row">' + (M.selVertex !== null && M.border.length > 3 ? '<button class="btn small danger" data-a="vertex-delete">' + ico('trash', 'sm') + 'Remove point</button>' : '') +
      '<button class="btn small ghost" data-a="border-cancel">Cancel</button><button class="btn small primary" data-a="border-save"' + (M.borderDirty ? '' : ' disabled') + '>Save border</button></div>';
  } else if (M.mode === 'place') {
    const info = M.placeInfo, ok = M.placing && info && info.km <= NEAR_KM;
    const msg = M.placeErr ? '<span class="err">' + esc(M.placeErr) + '</span>' : M.placing ? placeInfoHtml(info)
      : 'Paste coordinates from another app, use your position, or zoom in and tap the spot on the map.';
    bar.innerHTML = '<div class="spread"><div class="title">' + (M.placeKind === 'visit' ? 'New visit: where were the tracks?' : 'New nest: where is it?') + '</div><button class="btn small ghost" data-a="place-cancel">Cancel</button></div>' +
      '<form id="plForm" class="coord-row" novalidate><input class="input mono" id="pl-coords" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Latitude, longitude" aria-label="Coordinates: latitude, longitude" value="' + esc(M.placeText) + '"><button class="btn" type="submit">Set</button></form>' +
      '<div class="row" style="gap:8px"><button class="btn small" data-a="place-gps">' + ico('loc', 'sm') + 'Use my location</button><span class="hint">or tap the map</span></div>' +
      '<div class="hint" id="pl-msg" role="status">' + msg + '</div>' +
      '<button class="btn primary block" data-a="place-continue"' + (ok ? '' : ' disabled') + '>Continue</button>';
    const f = $('#plForm'), inp = $('#pl-coords');
    inp.addEventListener('input', () => { M.placeText = inp.value; });
    f.addEventListener('submit', e => {
      e.preventDefault();
      const r = parseCoords(inp.value);
      if (!r.ok) { M.placeErr = r.err; M.placeText = inp.value; $('#pl-msg').innerHTML = '<span class="err">' + esc(r.err) + '</span>'; return; }
      inp.blur(); setPlace([r.lat, r.lng], true);
    });
  }
}
function placeInfoHtml(info) {
  if (!info) return '<span class="err">No beach sector has a border yet. An admin needs to draw one first.</span>';
  const r = regionById(info.s.region_id);
  if (info.inside) return 'In <b>' + esc(info.s.name) + '</b> · ' + esc(r?.name || '');
  if (info.km <= NEAR_KM) return 'Nearest sector: <b>' + esc(info.s.name) + '</b> · ' + esc(r?.name || '') + ', ' + kmText(info.km) + ' away';
  return '<span class="err">No beach sector within ' + NEAR_KM + ' km. The nearest is ' + esc(info.s.name) + ', ' + kmText(info.km) + ' away. Check the coordinates.</span>';
}
function setPlace(ll, center) {
  M.placing = ll; M.placeInfo = nearestSector(ll, S.base.sectors); M.placeText = fmtLL(ll[0], ll[1]); M.placeErr = '';
  if (center) M.view.center(ll, Math.max(M.view.zoom(), 17));
  renderMap();
}
function startPlace(kind) {
  M.placeKind = kind === 'visit' ? 'visit' : 'nest'; M.mode = 'place';
  M.placing = null; M.placeInfo = null; M.placeText = ''; M.placeErr = ''; M.focus = null; S.legend = false;
}

function renderMapCard() {
  const el = $('#mapCard');
  if (!M.focus || M.mode !== 'view') { el.hidden = true; return; }
  const admin = isAdmin();
  const v = findVisit(M.focus), n = !v && S.data.nests.find(x => x.id === M.focus);
  if (!v && !n) { M.focus = null; el.hidden = true; return; }
  const item = v || n, s = sectorById(item.sector_id), ll = fmtLL(item.lat, item.lng);
  const thumb = item.photo_path ? photoImg(item.photo_path, 'Photo', 'thumb') : '<div class="thumb">' + ico(v ? 'tracks' : 'cam') + '</div>';
  el.innerHTML = '<div class="spread" style="align-items:flex-start;flex-wrap:nowrap"><div class="row" style="gap:12px;flex-wrap:nowrap;min-width:0">' + thumb +
    '<div style="min-width:0"><div class="eyebrow">' + (v ? 'Visit · no nest' : 'Nest') + '</div><div class="card-num">' + (v ? dayMonth(v.seen_on) : '#' + n.number) + '</div>' +
    '<div class="hint">' + esc(s?.name || '') + ' · ' + esc(regionById(s?.region_id)?.name || '') + '</div>' +
    (v ? '<div class="hint">' + VISIT_TYPE[v.type || v.kind] + ' · ' + SPECIES_V[v.species] + '</div>' : (item.photo_path ? '' : '<div class="hint">No photo yet</div>')) + '</div></div>' +
    '<button class="icon-btn" data-a="close-card" aria-label="Close">' + ico('x') + '</button></div>' +
    (admin && n ? '<div class="row" style="gap:6px 10px">' + statusChip(n.status) + '<span class="hint">' + esc(nestTiming(n)) + '</span></div>' : '') +
    (admin ? '<div class="coordbox" style="padding:8px 10px"><span class="coords" id="card-coords">' + ll + '</span><button class="btn small" data-a="copy-coords" data-v="' + ll + '" data-t="card-coords">' + ico('copy', 'sm') + 'Copy</button></div>' : '') +
    '<button class="btn block" data-a="' + (v ? 'open-visit' : 'open-nest') + '" data-id="' + item.id + '">Open ' + (v ? 'visit' : 'nest') + ' details</button>';
  el.hidden = false; $('#fab').hidden = true;
  hydratePhotos(el);
}

/* GPS: the blue dot follows the phone once switched on */
function startGps(onFirst) {
  if (!navigator.geolocation) { toast('This browser cannot share your location.'); return; }
  let first = true;
  const ok = p => {
    M.me = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: p.coords.accuracy || 10, at: Date.now() };
    if (first) { first = false; onFirst && onFirst(M.me); }
    renderMap();
  };
  const fail = e => {
    const msg = e.code === 1 ? 'Location is blocked for this site. Allow it in your browser settings, then try again.'
      : e.code === 3 ? 'Your position could not be found in time. Step outside or wait a moment, then try again.'
      : 'Your position is not available right now.';
    toast(msg, 6000);
  };
  if (M.watchId === null) M.watchId = navigator.geolocation.watchPosition(ok, fail, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  else if (M.me && Date.now() - M.me.at < 30000) { onFirst && onFirst(M.me); }
  else navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: true, timeout: 20000 });
}

/* =====================================================================
   Nests
   ===================================================================== */
function nestTiming(n) {
  if (n.status === 'hatched') return isAdmin() ? (resultOf(n.id) ? 'Hatched, results recorded' : 'Hatched, results not recorded yet') : '';
  if (n.status === 'predation') return 'Lost to predation';
  const d = daysBetween(today(), n.expected_hatch);
  if (d > 1) return 'Expected to hatch in ' + d + ' days';
  if (d === 1) return 'Expected to hatch tomorrow';
  if (d === 0) return 'Expected to hatch today';
  return plural(-d, 'day') + ' past expected hatching date';
}
function nestItem(n) {
  return '<button class="item" data-a="open-nest" data-id="' + n.id + '"><span class="nest-no">' + n.number + '</span>' +
    '<span class="meta"><span class="mono">' + esc(nestCode(n)) + '</span><span class="row" style="gap:4px 8px;margin:2px 0">' + statusChip(n.status) + '<span class="l2">' + esc(nestTiming(n)) + '</span></span>' +
    '<span class="l2">Found ' + fmt(n.found_on) + ' · ' + SPECIES_SHORT[n.species] + '</span></span>' +
    (n.photo_path ? photoImg(n.photo_path, '', 'thumb-sm') : '<span class="chev">' + ico('right', 'sm') + '</span>') + '</button>';
}
function renderNests() {
  const all = S.data.nests, admin = isAdmin(), q = S.nestQuery.trim().toLowerCase();
  const list = all.filter(n => (S.nestFilter === 'all' || n.status === S.nestFilter) &&
    (!q || nestCode(n).toLowerCase().includes(q) || (sectorById(n.sector_id)?.name || '').toLowerCase().includes(q) || String(n.number) === q));
  let h = '<div class="page"><div class="page-head"><div><div class="eyebrow">Season ' + S.year + '</div><h2>Nests</h2></div><button class="btn primary" data-a="add-nest-from-list">' + ico('plus', 'sm') + 'Add nest</button></div>';
  if (!all.length) {
    h += '<div class="card empty"><h3>No nests logged for ' + S.year + '</h3><p style="margin:0">Use Add nest to log one. Older seasons can be typed in after switching the Season button.</p></div>';
  } else {
    const res = S.data.results.filter(r => all.some(n => n.id === r.nest_id));
    const eggs = res.reduce((a, r) => a + r.total_eggs, 0), hatched = res.reduce((a, r) => a + r.hatched, 0);
    h += '<div class="stat-row">' +
      '<div class="stat"><b>' + all.length + '</b><span>nests</span></div>' +
      '<div class="stat"><b>' + all.filter(n => n.species === 'cc').length + ' / ' + all.filter(n => n.species === 'cm').length + '</b><span>loggerhead / green</span></div>' +
      '<div class="stat"><b>' + all.filter(n => ACTIVE.includes(n.status)).length + '</b><span>still incubating</span></div>' +
      (admin ? '<div class="stat"><b>' + (eggs ? (hatched / eggs * 100).toFixed(1) + '%' : '—') + '</b><span>hatching success</span></div>'
             : '<div class="stat"><b>' + all.filter(n => n.status === 'hatched').length + '</b><span>hatched</span></div>') + '</div>';
    h += '<label class="field"><span>Search</span><input class="input" id="nestSearch" placeholder="Nest number, sector or ID" value="' + esc(S.nestQuery) + '"></label>';
    h += '<div class="filter-row" role="group" aria-label="Filter by status">' + [['all', 'All']].concat(Object.entries(STATUS)).map(([k, l]) =>
      '<button class="fchip" data-a="nest-filter" data-id="' + k + '" aria-pressed="' + (S.nestFilter === k) + '">' + l + ' <span class="muted num">' + (k === 'all' ? all.length : all.filter(n => n.status === k).length) + '</span></button>').join('') + '</div>';
    let any = false;
    S.base.regions.forEach(r => {
      const secs = sectorsOf(r.id).map(s => [s, list.filter(n => n.sector_id === s.id).sort((a, b) => a.number - b.number)]).filter(x => x[1].length);
      if (!secs.length) return; any = true;
      h += '<div class="group-h"><h3>' + esc(r.name) + '</h3><span class="muted">' + plural(secs.reduce((a, x) => a + x[1].length, 0), 'nest') + '</span></div>';
      secs.forEach(([s, ns]) => { h += '<div class="list"><div class="list-sub"><span>' + esc(s.name) + '</span><span class="muted">' + plural(ns.length, 'nest') + '</span></div>' + ns.map(nestItem).join('') + '</div>'; });
    });
    if (!any) h += '<div class="card empty"><h3>No nests match</h3><p style="margin:0">Try another status or clear the search.</p></div>';
  }
  if (admin && S.data.removed.length) {
    h += '<details class="list"><summary class="list-sub" style="cursor:pointer">Removed nests <span class="muted">' + S.data.removed.length + '</span></summary>' +
      S.data.removed.map(n => '<div class="item" style="cursor:default"><span class="nest-no">' + n.number + '</span><span class="meta"><span class="mono">' + esc(nestCode(n)) + '</span></span><span class="end"><button class="btn small" data-a="nest-restore" data-id="' + n.id + '">Restore</button></span></div>').join('') + '</details>';
  }
  $('#view-nests').innerHTML = h + '</div>';
  const inp = $('#nestSearch');
  if (inp) inp.addEventListener('input', () => { S.nestQuery = inp.value; const pos = inp.selectionStart; renderNests(); const i2 = $('#nestSearch'); i2.focus(); i2.setSelectionRange(pos, pos); });
  hydratePhotos($('#view-nests'));
}

/* =====================================================================
   Visits (admins only)
   ===================================================================== */
const switchHtml = (on, action, label) => '<div class="row" style="gap:8px;flex-wrap:nowrap"><span class="sw-label" aria-hidden="true">' + (on ? 'On' : 'Off') + '</span><button class="switch" role="switch" aria-checked="' + on + '" aria-label="' + esc(label) + '" data-a="' + action + '"></button></div>';
function visitItem(v) {
  const d = parseISO(v.seen_on);
  return '<button class="item" data-a="open-visit" data-id="' + v.id + '"><span class="vdate"><b>' + d.getDate() + '</b><span>' + monthShort(v.seen_on) + '</span></span>' +
    '<span class="meta"><span class="row" style="gap:6px"><span class="chip' + (v.kind === 'dig' ? ' lv-low' : '') + '">' + VISIT_TYPE[v.kind] + '</span><span class="l2">' + SPECIES_V[v.species] + '</span></span>' +
    (v.notes ? '<span class="l2" style="color:var(--ink)">' + esc(v.notes) + '</span>' : '') + '<span class="l2">Logged by ' + esc(personName(v.created_by)) + '</span></span>' +
    (v.photo_path ? photoImg(v.photo_path, '', 'thumb-sm') : '<span class="chev">' + ico('right', 'sm') + '</span>') + '</button>';
}
function renderVisits() {
  const el = $('#view-visits');
  if (!isAdmin()) { el.innerHTML = '<div class="page"><div class="card empty"><h3>Admins only</h3><p style="margin:0">Visits are visible to admins.</p></div></div>'; return; }
  const all = S.data.visits, nests = S.data.nests.length, emerg = nests + all.length;
  let h = '<div class="page"><div class="page-head"><div><div class="eyebrow">Season ' + S.year + ' · admins only</div><h2>Visits</h2></div><button class="btn primary" data-a="add-visit-from-list">' + ico('plus', 'sm') + 'Add visit</button></div>';
  h += '<p class="hint" style="margin:0;max-width:62ch">A visit is when a turtle came ashore but laid no eggs: she left tracks and went back (a false crawl), or started digging and gave up.</p>';
  h += '<div class="card spread" style="flex-wrap:nowrap"><div><b>Show visits on the map</b><div class="hint">' + (S.showVisits ? 'Visits appear as diamonds when you zoom in to a beach.' : 'Visits are hidden on the map.') + '</div></div>' + switchHtml(S.showVisits, 'toggle-visits', 'Show visits on the map') + '</div>';
  if (!all.length) { el.innerHTML = h + '<div class="card empty"><h3>No visits logged for ' + S.year + '</h3><p style="margin:0">Use Add visit when a patrol finds tracks without a nest.</p></div></div>'; return; }
  const tr = all.filter(v => v.kind === 'tracks').length;
  h += '<div class="stat-row">' +
    '<div class="stat"><b>' + all.length + '</b><span>visits</span></div>' +
    '<div class="stat"><b>' + tr + ' / ' + (all.length - tr) + '</b><span>tracks only / dug, no eggs</span></div>' +
    '<div class="stat"><b>' + all.filter(v => v.species === 'cc').length + ' / ' + all.filter(v => v.species === 'cm').length + '</b><span>loggerhead / green' + (all.some(v => v.species === 'unk') ? ' (' + all.filter(v => v.species === 'unk').length + ' not sure)' : '') + '</span></div>' +
    '<div class="stat"><b>' + (emerg ? Math.round(nests / emerg * 100) + '%' : '—') + '</b><span>nesting success: ' + nests + ' nests of ' + emerg + ' times ashore</span></div></div>';
  S.base.regions.forEach(r => {
    const secs = sectorsOf(r.id).map(s => [s, all.filter(v => v.sector_id === s.id)]).filter(x => x[1].length);
    if (!secs.length) return;
    h += '<div class="group-h"><h3>' + esc(r.name) + '</h3><span class="muted">' + plural(secs.reduce((a, x) => a + x[1].length, 0), 'visit') + '</span></div>';
    secs.forEach(([s, vs]) => { h += '<div class="list"><div class="list-sub"><span>' + esc(s.name) + '</span><span class="muted">' + plural(vs.length, 'visit') + '</span></div>' + vs.map(visitItem).join('') + '</div>'; });
  });
  el.innerHTML = h + '</div>';
  hydratePhotos(el);
}

/* =====================================================================
   Sheets: season, account, sector
   ===================================================================== */
SHEETS.year = () => {
  const years = S.base.seasons.map(s => s.year).sort((a, b) => b - a), now = new Date().getFullYear();
  let h = '<h2 style="font-size:28px">Choose a season</h2><p class="hint" style="margin:0">Every page shows the season you pick. Switch to an older season to type in its data.</p><div class="list">' +
    years.map(y => '<button class="item" data-a="set-year" data-y="' + y + '"><span class="nest-no">' + y + '</span><span class="meta"><span class="l2">' + (y === now ? 'Current season' : y > now ? 'Upcoming season' : 'Past season') + '</span></span><span class="end">' + (y === S.year ? '<span class="chip st-prot">Showing</span>' : '') + '</span></button>').join('') + '</div>';
  if (isAdmin()) h += '<button class="btn" data-a="add-year">' + ico('plus', 'sm') + 'Add season ' + ((years[0] || now) + 1) + '</button>';
  return { title: 'Season', html: h };
};
SHEETS.user = () => {
  const u = S.me, email = S.session?.user?.email || '';
  let h = '<div class="row"><span class="avatar" style="width:52px;height:52px;font-size:18px">' + esc((u.name || u.nickname).slice(0, 2).toUpperCase()) + '</span><div><h2 style="font-size:26px">' + esc(u.name || u.nickname) + '</h2><div class="hint mono">@' + esc(u.nickname) + ' · ' + esc(email) + '</div></div></div>';
  h += '<div class="row">' + (u.role === 'admin' ? '<span class="chip st-prot">Admin</span><span class="hint">You can edit the map, nests, visits and sectors.</span>' : '<span class="chip">Member</span><span class="hint">You can add nests, visits and photos.</span>') + '</div>';
  if (u.role !== 'admin') h += u.admin_request === 'pending' ? '<div class="msg tip">Admin access requested. An admin will approve or decline it.</div>' : '<div><button class="btn" data-a="request-admin">Ask for admin access</button></div>';
  h += '<div class="placeholder"><b>Put Turtle Patrol on your home screen</b><span>iPhone: tap Share, then "Add to Home Screen". Android: tap the ⋮ menu, then "Install app" or "Add to Home screen".</span></div>';
  h += '<button class="btn danger" data-a="sign-out">Sign out</button>';
  return { title: 'Your account', html: h };
};
SHEETS.sector = sh => {
  const s = sectorById(sh.id); if (!s) return null;
  const ns = S.data.nests.filter(n => n.sector_id === s.id).sort((a, b) => a.number - b.number);
  let h = '<div class="stack" style="gap:6px"><div class="eyebrow">' + esc(regionById(s.region_id)?.name || '') + ' · <span class="mono">' + esc(s.code) + '</span></div><h2 style="font-size:32px">' + esc(s.name) + '</h2>' +
    '<div class="hint">Usual need per season: ' + plural(s.usual_cages, 'cage') + ', ' + plural(s.usual_pyramids, 'pyramid') + '</div></div>';
  h += '<div class="section-h"><h3>Nests in ' + S.year + '</h3><button class="btn small primary" data-a="place-in-sector" data-id="' + s.id + '">' + ico('plus', 'sm') + 'Add nest here</button></div>';
  h += ns.length ? '<div class="list">' + ns.map(nestItem).join('') + '</div>' : '<div class="card empty"><p style="margin:0">No nests logged here for ' + S.year + '.</p></div>';
  if (isAdmin()) h += '<div class="row"><button class="btn small ghost" data-a="sector-form" data-id="' + s.id + '">Sector settings</button></div>';
  return { title: 'Beach sector', html: h };
};
SHEETS.sectorForm = sh => {
  const s = sh.id ? sectorById(sh.id) : null;
  const v = s || { name: '', code: '', region_id: sh.regionId || S.base.regions[0]?.id, usual_cages: 5, usual_pyramids: 5 };
  const h = '<h2 style="font-size:28px">' + (s ? 'Sector settings' : 'Name the new sector') + '</h2><form id="secForm" class="stack" novalidate>' +
    '<label class="field"><span>Sector name</span><input class="input" id="sf-name" value="' + esc(v.name) + '" placeholder="For example: Bedis Right"></label>' +
    '<div class="two"><label class="field"><span>Short code (for nest IDs)</span><input class="input mono" id="sf-code" maxlength="4" value="' + esc(v.code) + '" placeholder="BDR"></label>' +
    '<label class="field"><span>Region</span><select class="input" id="sf-reg">' + S.base.regions.map(r => '<option value="' + r.id + '"' + (r.id === v.region_id ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select></label></div>' +
    '<div class="two"><label class="field"><span>Usual need: cages</span><input class="input num" id="sf-minc" type="number" min="0" value="' + v.usual_cages + '"></label><label class="field"><span>Usual need: pyramids</span><input class="input num" id="sf-minp" type="number" min="0" value="' + v.usual_pyramids + '"></label></div>' +
    '<div class="hint">Usual need is how many this beach normally needs in a season. Gear tracking uses it.</div>' +
    '<div class="err" id="sf-err" role="alert"></div><div class="row"><button type="button" class="btn ghost" data-a="close-sheet">Cancel</button><button class="btn primary" type="submit">Save sector</button></div></form>';
  return { title: s ? 'Beach sector' : 'New beach sector', html: h, after() {
    $('#secForm').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('#sf-err'), name = $('#sf-name').value.trim(), code = $('#sf-code').value.trim().toUpperCase();
      const region_id = +$('#sf-reg').value, usual_cages = Number($('#sf-minc').value), usual_pyramids = Number($('#sf-minp').value);
      if (!name) { err.textContent = 'Give the sector a name.'; return; }
      if (!/^[A-ZÇĞİÖŞÜ]{2,4}$/.test(code)) { err.textContent = 'Use a code of 2 to 4 letters, like BDR.'; return; }
      if (![usual_cages, usual_pyramids].every(x => Number.isInteger(x) && x >= 0)) { err.textContent = 'Usual need must be whole numbers of 0 or more.'; return; }
      const fields = { name, code, region_id, usual_cages, usual_pyramids };
      busy(true);
      try {
        if (s) await api.updateSector(s.id, fields);
        else { await api.addSector({ ...fields, boundary: sh.boundary || [] }); M.mode = 'edit'; M.draft = []; M.drawFor = null; }
        S.base = await api.loadBase();
        closeAllSheets(); toast(name + ' saved'); renderAll();
      } catch (ex) { err.textContent = ex.code === '23505' ? 'Another sector already uses that name or code.' : friendly(ex); }
      finally { busy(false); }
    });
  } };
};

/* =====================================================================
   Sheets: nests
   ===================================================================== */
function coordsField(prefix, sh, withGps) {
  return '<div class="field"><span>Coordinates (latitude, longitude)</span><div class="coord-row"><input class="input mono" id="' + prefix + '-coords" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="35.14294, 33.93160" value="' + esc(sh.coordsText || fmtLL(sh.ll[0], sh.ll[1])) + '" aria-label="Coordinates">' +
    (withGps ? '<button type="button" class="btn" id="' + prefix + '-gps">' + ico('loc', 'sm') + '<span>My location</span></button>' : '') + '</div>' +
    '<span class="hint" id="' + prefix + '-where">' + placeInfoHtml(nearestSector(sh.ll, S.base.sectors)) + '</span></div>';
}
function bindCoords(sh, prefix, onSector) {
  const co = $('#' + prefix + '-coords'), where = $('#' + prefix + '-where');
  const read = () => {
    sh.coordsText = co.value;
    const r = parseCoords(co.value);
    if (!r.ok) { where.innerHTML = '<span class="err">' + esc(r.err) + '</span>'; return false; }
    sh.ll = [r.lat, r.lng];
    const info = nearestSector(sh.ll, S.base.sectors);
    where.innerHTML = placeInfoHtml(info);
    if (info && !sh.sectorTouched && info.km <= NEAR_KM && onSector) onSector(info.s.id);
    return !!info && info.km <= NEAR_KM;
  };
  co.addEventListener('change', read);
  const gps = $('#' + prefix + '-gps');
  if (gps) gps.addEventListener('click', () => startGps(me => { co.value = fmtLL(me.lat, me.lng); read(); toast('Your position, accurate to about ' + Math.round(me.acc) + ' m'); }));
  return read;
}
function photoField(prefix, has) {
  return '<div class="field"><span>Photo (optional)</span><div class="row" style="gap:12px"><div id="' + prefix + '-thumb"></div><label class="btn small file-btn">' + ico('cam', 'sm') + '<span id="' + prefix + '-photo-label">' + (has ? 'Replace photo' : 'Add photo') + '</span><input type="file" accept="image/*" id="' + prefix + '-photo" aria-label="Add a photo"></label></div></div>';
}
function bindPhoto(prefix, sh) {
  $('#' + prefix + '-photo').addEventListener('change', async e => {
    try {
      sh.photo = await resizePhoto(e.target.files[0]);
      $('#' + prefix + '-thumb').innerHTML = '<img class="thumb" src="' + URL.createObjectURL(sh.photo) + '" alt="Chosen photo">';
      $('#' + prefix + '-photo-label').textContent = 'Replace photo';
    } catch (ex) { toast(ex.message); }
  });
}
const sectorOptions = sel => S.base.regions.map(r => '<optgroup label="' + esc(r.name) + '">' + sectorsOf(r.id).map(x => '<option value="' + x.id + '"' + (x.id === sel ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</optgroup>').join('');
const nextNestNum = sid => Math.max(0, ...S.data.nests.concat(S.data.removed).filter(x => x.sector_id === sid).map(x => x.number)) + 1;
const choiceGroup = (name, options, value) => '<div class="checks" role="radiogroup">' + Object.keys(options).map(k => '<label class="check"><input type="radio" name="' + name + '" value="' + k + '"' + (k === value ? ' checked' : '') + '>' + options[k] + '</label>').join('') + '</div>';
const radioValue = name => { const r = document.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : null; };

SHEETS.newNest = sh => {
  const s = sectorById(sh.sectorId); if (!s) return null;
  const defFound = isCurrentSeason() ? today() : S.year + '-07-01';
  let h = '<div class="stack" style="gap:4px"><div class="eyebrow">Season ' + S.year + '</div><h2 style="font-size:30px" id="nn-title">New nest in ' + esc(s.name) + '</h2></div>';
  h += '<form id="newNestForm" class="stack" novalidate>' + coordsField('nn', sh, true) +
    '<label class="field"><span>Beach sector</span><select class="input" id="nn-sec">' + sectorOptions(s.id) + '</select></label>' +
    '<div class="two"><label class="field"><span>Nest number</span><input class="input num" id="nn-num" type="number" min="1" value="' + nextNestNum(s.id) + '"></label>' +
    '<label class="field"><span>Species</span><select class="input" id="nn-sp"><option value="cc">Caretta caretta</option><option value="cm">Chelonia mydas</option></select></label></div>' +
    '<div class="two narrow-stack"><label class="field"><span>Date found</span><input class="input" id="nn-found" type="date" value="' + defFound + '"></label>' +
    '<label class="field"><span>Expected hatching</span><input class="input" id="nn-exp" type="date" value="' + addMonths(defFound, S.base.settings.hatch_months) + '"></label></div>' +
    '<div class="field"><span>Protection placed</span><div class="checks"><label class="check"><input type="checkbox" id="nn-cage" checked>Cage</label><label class="check"><input type="checkbox" id="nn-pyr" checked>Pyramid</label></div>' +
    '<span class="hint">Untick what you could not place: the nest is then saved as Not protected.</span></div>' +
    photoField('nn', false) +
    '<label class="field"><span>Notes</span><textarea class="input" id="nn-notes" placeholder="Track width, distance from the sea, anything unusual"></textarea></label>' +
    '<div class="err" id="nn-err" role="alert"></div><div class="row"><button type="button" class="btn ghost" data-a="close-sheet">Cancel</button><button class="btn primary" type="submit" id="nn-go">Save nest</button></div></form>';
  return { title: 'Add nest', html: h, after() {
    const fo = $('#nn-found'), ex = $('#nn-exp'), num = $('#nn-num'), sec = $('#nn-sec');
    let expTouched = false, numTouched = false;
    ex.addEventListener('input', () => expTouched = true);
    num.addEventListener('input', () => numTouched = true);
    fo.addEventListener('input', () => { if (!expTouched && fo.value) ex.value = addMonths(fo.value, S.base.settings.hatch_months); });
    const useSector = id => { sh.sectorId = +id; sec.value = id; $('#nn-title').textContent = 'New nest in ' + sectorById(+id).name; if (!numTouched) num.value = nextNestNum(+id); };
    sec.addEventListener('change', () => { sh.sectorTouched = true; useSector(sec.value); });
    const read = bindCoords(sh, 'nn', useSector);
    bindPhoto('nn', sh);
    $('#newNestForm').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('#nn-err'), go = $('#nn-go'); err.textContent = '';
      if (!read()) { err.textContent = 'Fix the coordinates first. They must be near a beach sector.'; return; }
      const sid = +sec.value, number = Number(num.value), found = fo.value, exp = ex.value;
      if (!Number.isInteger(number) || number < 1) { err.textContent = 'The nest number must be a whole number of 1 or more.'; return; }
      if (S.data.nests.some(x => x.sector_id === sid && x.number === number)) { err.textContent = 'Nest #' + number + ' already exists in ' + sectorById(sid).name + ' for ' + S.year + '. Pick another number.'; return; }
      if (!found || +found.slice(0, 4) !== S.year) { err.textContent = 'Date found must be in the ' + S.year + ' season. To log another year, switch the Season button first.'; return; }
      if (!exp || exp < found) { err.textContent = 'Expected hatching must be on or after the date found.'; return; }
      const cage = $('#nn-cage').checked, pyr = $('#nn-pyr').checked;
      go.disabled = true; busy(true);
      try {
        const photo_path = sh.photo ? await api.uploadPhoto('nests/' + S.year, sh.photo) : null;
        const row = { season: S.year, sector_id: sid, number, species: $('#nn-sp').value, found_on: found, expected_hatch: exp,
          status: cage && pyr ? 'prot' : 'notprot', has_cage: cage, has_pyramid: pyr, lat: sh.ll[0], lng: sh.ll[1], notes: $('#nn-notes').value.trim(), photo_path };
        const saved = await api.addNest(row, isAdmin());
        M.mode = 'view'; M.placing = null; M.placeInfo = null; M.placeText = '';
        await loadSeason();
        const n = saved || S.data.nests.find(x => x.sector_id === sid && x.number === number);
        S.sheets = n ? [{ kind: 'nest', id: n.id }] : [];
        toast(row.status === 'notprot' ? 'Nest #' + number + ' saved as Not protected' : 'Nest #' + number + ' saved');
        if (!S.sheets.length) hideSheet();
        renderAll();
      } catch (ex2) {
        err.textContent = ex2.code === '23505' ? 'Nest #' + number + ' already exists in this sector. Pick another number.' : friendly(ex2);
        go.disabled = false;
      } finally { busy(false); }
    });
  } };
};

function resultsBlock(n) {
  const r = resultOf(n.id);
  const unlocked = n.status === 'hatched' || n.status === 'predation' || r || today() >= n.expected_hatch;
  let h = '<div class="card stack"><div class="section-h"><h3>Hatching results</h3>' + (r ? '<span class="chip lv-ok">Recorded</span>' : '') + '</div>';
  if (!unlocked) return h + '<div class="lock">' + ico('lock') + '<span>This section opens on <b>' + fmt(n.expected_hatch) + '</b>, the expected hatching date, or earlier if the nest is marked Hatched.</span></div></div>';
  if (r) h += '<div class="row" style="gap:28px"><div class="result-big"><b>' + (+r.hatching_success).toFixed(1) + '%</b><span class="muted">hatching success</span></div><div class="result-big"><b style="font-size:28px">' + (r.alive / r.total_eggs * 100).toFixed(1) + '%</b><span class="muted">alive hatchlings</span></div></div><div class="hint">Hatching success = hatched eggs ÷ total eggs × 100</div>';
  const f = (id, label, v) => '<label class="field"><span>' + label + '</span><input class="input num" id="' + id + '" type="number" inputmode="numeric" min="0" step="1" value="' + (v ?? '') + '"></label>';
  return h + '<form id="resForm" class="stack" novalidate><div class="two">' + f('rs-total', 'Total eggs', r?.total_eggs) + f('rs-hatched', 'Hatched eggs', r?.hatched) + f('rs-unhatched', 'Unhatched eggs', r?.unhatched) + '<div></div>' + f('rs-alive', 'Alive hatchlings', r?.alive) + f('rs-dead', 'Dead hatchlings', r?.dead) + '</div><div class="hint" id="rs-live"></div><div class="err" id="rs-err" role="alert"></div><div><button class="btn primary" type="submit">Save results</button></div></form></div>';
}
function describeChange(e) {
  if (e.table_name === 'nest_results') return e.action === 'delete' ? 'Removed hatching results' : 'Recorded hatching results';
  if (e.action === 'insert') return 'Added';
  if (e.action === 'delete') return 'Deleted';
  const names = { status: 'status', number: 'number', found_on: 'date found', expected_hatch: 'expected hatching', has_cage: 'cage', has_pyramid: 'pyramid', lat: 'location', lng: 'location', notes: 'notes', photo_path: 'photo', species: 'species', archived: 'removed/restored', sector_id: 'sector', kind: 'what was found', seen_on: 'date' };
  const keys = [...new Set(Object.keys(e.changes || {}).map(k => names[k] || k))];
  const st = e.changes?.status ? ' (to ' + (STATUS[e.changes.status.to] || e.changes.status.to) + ')' : '';
  return 'Changed ' + keys.join(', ') + st;
}
SHEETS.nest = sh => {
  const n = findNest(sh.id); if (!n) return null;
  const s = sectorById(n.sector_id), r = regionById(s?.region_id), admin = isAdmin();
  let h = '<div class="nest-title"><div class="eyebrow">Nest' + (n.archived ? ' · removed' : '') + '</div><div class="big">#' + n.number + '</div><div class="mono">' + esc(nestCode(n)) + '</div><div>' + esc(s?.name || '') + ' · ' + esc(r?.name || '') + ' · <i>' + SPECIES[n.species] + '</i></div><div class="row" style="margin-top:4px">' + statusChip(n.status) + '<span class="hint">' + esc(nestTiming(n)) + '</span></div></div>';
  if (admin) {
    const ll = fmtLL(n.lat, n.lng);
    h += '<div class="coordbox"><div style="min-width:0"><div class="eyebrow">Coordinates</div><span class="coords" id="nest-coords">' + ll + '</span></div>' +
      '<div class="row" style="gap:8px"><button class="btn small" data-a="copy-coords" data-v="' + ll + '" data-t="nest-coords">' + ico('copy', 'sm') + 'Copy</button><button class="btn small primary" data-a="show-on-map" data-id="' + n.id + '">' + ico('pin', 'sm') + 'Show on map</button></div></div>';
  }
  h += '<div class="photo' + (n.photo_path ? '' : ' empty') + '">' + (n.photo_path ? photoImg(n.photo_path, 'Photo of nest ' + nestCode(n)) : '<div class="stack" style="justify-items:center;gap:6px">' + ico('cam') + '<span>No photo yet</span></div>') +
    '<div class="photo-actions"><label class="btn small file-btn">' + ico('cam', 'sm') + (n.photo_path ? 'Replace photo' : 'Add photo') + '<input type="file" accept="image/*" id="nestPhoto" aria-label="Upload nest photo"></label></div></div>';
  if (admin) {
    h += '<div class="card"><form id="nestForm" class="stack" novalidate><div class="section-h"><h3>Details</h3></div>' +
      '<div class="two"><label class="field"><span>Nest number</span><input class="input num" id="nf-num" type="number" min="1" value="' + n.number + '"></label>' +
      '<label class="field"><span>Species</span><select class="input" id="nf-sp">' + Object.keys(SPECIES).map(k => '<option value="' + k + '"' + (k === n.species ? ' selected' : '') + '>' + SPECIES[k] + '</option>').join('') + '</select></label></div>' +
      '<label class="field"><span>Beach sector</span><select class="input" id="nf-sec">' + sectorOptions(n.sector_id) + '</select></label>' +
      '<div class="two narrow-stack"><label class="field"><span>Date found</span><input class="input" id="nf-found" type="date" value="' + n.found_on + '"></label>' +
      '<label class="field"><span>Expected hatching</span><input class="input" id="nf-exp" type="date" value="' + n.expected_hatch + '"></label></div>' +
      '<label class="field"><span>Status</span><select class="input" id="nf-status">' + Object.keys(STATUS).map(k => '<option value="' + k + '"' + (k === n.status ? ' selected' : '') + '>' + STATUS[k] + '</option>').join('') + '</select></label>' +
      '<div class="field"><span>Protection on the nest</span><div class="checks"><label class="check"><input type="checkbox" id="nf-cage"' + (n.has_cage ? ' checked' : '') + '>Cage</label><label class="check"><input type="checkbox" id="nf-pyr"' + (n.has_pyramid ? ' checked' : '') + '>Pyramid</label></div>' +
      '<span class="hint">A nest still incubating without both is saved as Not protected.</span></div>' +
      '<label class="field"><span>Coordinates (latitude, longitude)</span><input class="input mono" id="nf-coords" autocomplete="off" autocapitalize="none" spellcheck="false" value="' + fmtLL(n.lat, n.lng) + '"></label>' +
      '<label class="field"><span>Notes</span><textarea class="input" id="nf-notes">' + esc(n.notes) + '</textarea></label>' +
      '<div class="err" id="nf-err" role="alert"></div><div class="row"><button class="btn primary" type="submit">Save changes</button></div></form></div>';
    h += resultsBlock(n);
  } else {
    h += '<div class="card"><dl class="kv"><dt>Date found</dt><dd>' + fmt(n.found_on) + '</dd><dt>Expected hatching</dt><dd>' + fmt(n.expected_hatch) + '</dd><dt>Species</dt><dd><i>' + SPECIES[n.species] + '</i></dd><dt>Cage</dt><dd>' + (n.has_cage ? 'Yes' : 'No') + '</dd><dt>Pyramid</dt><dd>' + (n.has_pyramid ? 'Yes' : 'No') + '</dd><dt>Location</dt><dd class="hint">' + ico('lock', 'sm') + ' Coordinates are visible to admins only</dd>' + (n.notes ? '<dt>Notes</dt><dd>' + esc(n.notes) + '</dd>' : '') + '</dl></div>';
  }
  h += '<div class="card stack"><div class="section-h"><h3>' + ico('sensor') + ' Sensor</h3><span class="chip">None linked</span></div><div class="placeholder"><span>When the nest devices are online, their readings will appear here.</span></div></div>';
  if (admin) {
    h += '<div class="card stack"><div class="section-h"><h3>History</h3></div><div class="hist" id="nestHist"><p class="hint" style="margin:0">Loading…</p></div></div>';
    h += '<div class="row">' + (n.archived ? '<button class="btn small" data-a="nest-restore" data-id="' + n.id + '">Restore nest</button>' : '<button class="btn small danger" data-a="nest-remove" data-id="' + n.id + '">Remove nest</button><span class="hint">Removed nests can be restored from the Nests page.</span>') + '</div>';
  }
  return { title: 'Nest details · season ' + n.season, html: h, after() {
    $('#nestPhoto').addEventListener('change', async e => {
      let blob; try { blob = await resizePhoto(e.target.files[0]); } catch (ex) { return toast(ex.message); }
      await work('Uploading photo…', async () => { const path = await api.uploadPhoto('nests/' + n.season, blob); await api.setNestPhoto(n.id, path); await loadSeason(); toast('Photo added. Its hidden location data was removed.'); renderAll(); });
    });
    if (!admin) return;
    api.history(n.id).then(rows => {
      const el = $('#nestHist'); if (!el) return;
      el.innerHTML = rows.length ? rows.map(e => '<div><time>' + fmtStamp(e.at) + '</time><span>' + esc(describeChange(e)) + '</span><small>' + esc(personName(e.user_id)) + '</small></div>').join('') : '<p class="hint" style="margin:0">No changes recorded yet.</p>';
    }).catch(() => { const el = $('#nestHist'); if (el) el.innerHTML = '<p class="hint" style="margin:0">History could not be loaded.</p>'; });
    const fo = $('#nf-found'), ex = $('#nf-exp'); let touched = false;
    ex.addEventListener('input', () => touched = true);
    fo.addEventListener('input', () => { if (!touched && fo.value) ex.value = addMonths(fo.value, S.base.settings.hatch_months); });
    $('#nestForm').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('#nf-err'); err.textContent = '';
      const number = Number($('#nf-num').value), found = fo.value, exp = ex.value, sid = +$('#nf-sec').value, pc = parseCoords($('#nf-coords').value);
      if (!Number.isInteger(number) || number < 1) { err.textContent = 'The nest number must be a whole number of 1 or more.'; return; }
      if (S.data.nests.some(x => x.id !== n.id && x.sector_id === sid && x.number === number)) { err.textContent = 'Nest #' + number + ' already exists in ' + sectorById(sid).name + ' for ' + n.season + '. Pick another number.'; return; }
      if (!found || +found.slice(0, 4) !== n.season) { err.textContent = 'Date found must be in the ' + n.season + ' season.'; return; }
      if (!exp || exp < found) { err.textContent = 'Expected hatching must be on or after the date found.'; return; }
      if (!pc.ok) { err.textContent = pc.err; return; }
      const patch = { number, species: $('#nf-sp').value, sector_id: sid, found_on: found, expected_hatch: exp, status: $('#nf-status').value,
        has_cage: $('#nf-cage').checked, has_pyramid: $('#nf-pyr').checked, lat: pc.lat, lng: pc.lng, notes: $('#nf-notes').value.trim() };
      const ok = await work('Saving…', async () => { await api.updateNest(n.id, patch); await loadSeason(); });
      if (!ok) return;
      const where = nearestSector([pc.lat, pc.lng], S.base.sectors);
      toast(where && where.s.id !== sid && (where.inside || where.km < 0.5) ? 'Saved, but these coordinates are in ' + where.s.name + ', not ' + sectorById(sid).name + '. Check the position.' : 'Nest #' + number + ' saved');
      renderAll();
    });
    const rf = $('#resForm');
    if (rf) {
      const read = () => { const v = id => { const x = $('#' + id).value.trim(); return x === '' ? null : Number(x); }; return { total_eggs: v('rs-total'), hatched: v('rs-hatched'), unhatched: v('rs-unhatched'), alive: v('rs-alive'), dead: v('rs-dead') }; };
      const live = () => { const r = read(); $('#rs-live').textContent = (r.total_eggs > 0 && r.hatched !== null && r.hatched >= 0 && r.hatched <= r.total_eggs) ? 'Hatching success with these numbers: ' + (r.hatched / r.total_eggs * 100).toFixed(1) + '%' : ''; };
      rf.addEventListener('input', live); live();
      rf.addEventListener('submit', async e => {
        e.preventDefault();
        const r = read(), err = $('#rs-err'), keys = Object.keys(r);
        if (keys.some(k => r[k] === null)) { err.textContent = 'Fill in all five numbers. Use 0 where there were none.'; return; }
        if (keys.some(k => !Number.isInteger(r[k]) || r[k] < 0)) { err.textContent = 'Use whole numbers of 0 or more.'; return; }
        if (r.total_eggs === 0) { err.textContent = 'Total eggs must be more than 0.'; return; }
        if (r.hatched + r.unhatched !== r.total_eggs) { err.textContent = 'Hatched eggs (' + r.hatched + ') plus unhatched eggs (' + r.unhatched + ') should equal total eggs (' + r.total_eggs + ').'; return; }
        if (r.alive + r.dead > r.hatched) { err.textContent = 'Alive plus dead hatchlings (' + (r.alive + r.dead) + ') cannot be more than hatched eggs (' + r.hatched + ').'; return; }
        const ok = await work('Saving results…', async () => {
          await api.saveResults(n.id, r);
          if (ACTIVE.includes(n.status)) await api.updateNest(n.id, { status: 'hatched' });
          await loadSeason();
        });
        if (ok) { toast('Results saved for nest #' + n.number); renderAll(); }
      });
    }
  } };
};

/* =====================================================================
   Sheets: visits
   ===================================================================== */
SHEETS.newVisit = sh => {
  const s = sectorById(sh.sectorId); if (!s) return null;
  const defDate = isCurrentSeason() ? today() : S.year + '-07-01';
  let h = '<div class="stack" style="gap:4px"><div class="eyebrow">Season ' + S.year + ' · came ashore, no nest</div><h2 style="font-size:30px" id="nv-title">New visit in ' + esc(s.name) + '</h2></div>';
  h += '<form id="newVisitForm" class="stack" novalidate>' + coordsField('nv', sh, true) +
    '<label class="field"><span>Beach sector</span><select class="input" id="nv-sec">' + sectorOptions(s.id) + '</select></label>' +
    '<label class="field"><span>Date</span><input class="input" id="nv-date" type="date" value="' + defDate + '"></label>' +
    '<div class="field"><span>What did you find?</span>' + choiceGroup('nv-type', VISIT_TYPE_LONG, 'tracks') + '</div>' +
    '<div class="field"><span>Species</span>' + choiceGroup('nv-sp', SPECIES_V, 'cc') + '</div>' +
    photoField('nv', false) +
    '<label class="field"><span>Notes</span><textarea class="input" id="nv-notes" placeholder="What stopped her? Lights, sunbeds, hard sand, people"></textarea></label>' +
    (isAdmin() ? '' : '<p class="hint" style="margin:0">' + ico('lock', 'sm') + ' After saving, visits are visible to admins only.</p>') +
    '<div class="err" id="nv-err" role="alert"></div><div class="row"><button type="button" class="btn ghost" data-a="close-sheet">Cancel</button><button class="btn primary" type="submit" id="nv-go">Save visit</button></div></form>';
  return { title: 'Add visit', html: h, after() {
    const sec = $('#nv-sec');
    const useSector = id => { sh.sectorId = +id; sec.value = id; $('#nv-title').textContent = 'New visit in ' + sectorById(+id).name; };
    sec.addEventListener('change', () => { sh.sectorTouched = true; useSector(sec.value); });
    const read = bindCoords(sh, 'nv', useSector);
    bindPhoto('nv', sh);
    $('#newVisitForm').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('#nv-err'), date = $('#nv-date').value; err.textContent = '';
      if (!read()) { err.textContent = 'Fix the coordinates first. They must be near a beach sector.'; return; }
      if (!date || +date.slice(0, 4) !== S.year) { err.textContent = 'The date must be in the ' + S.year + ' season. To log another year, switch the Season button first.'; return; }
      if (date > today()) { err.textContent = 'The date cannot be in the future.'; return; }
      $('#nv-go').disabled = true; busy(true);
      try {
        const photo_path = sh.photo ? await api.uploadPhoto('visits/' + S.year, sh.photo) : null;
        const row = { season: S.year, sector_id: +sec.value, seen_on: date, kind: radioValue('nv-type') || 'tracks', species: radioValue('nv-sp') || 'unk',
          lat: sh.ll[0], lng: sh.ll[1], notes: $('#nv-notes').value.trim(), photo_path };
        const saved = await api.addVisit(row, isAdmin());
        M.mode = 'view'; M.placing = null; M.placeInfo = null; M.placeText = '';
        await loadSeason();
        if (saved) { S.sheets = [{ kind: 'visit', id: saved.id }]; toast('Visit saved'); }
        else { S.sheets = []; hideSheet(); toast('Visit saved. Thank you! Admins can see it in Visits.'); }
        renderAll();
      } catch (ex) { err.textContent = friendly(ex); $('#nv-go').disabled = false; }
      finally { busy(false); }
    });
  } };
};
SHEETS.visit = sh => {
  const v = findVisit(sh.id); if (!v || !isAdmin()) return null;
  const s = sectorById(v.sector_id), ll = fmtLL(v.lat, v.lng);
  let h = '<div class="nest-title"><div class="eyebrow">Visit · came ashore, no nest</div><div class="big" style="font-size:40px">' + longDate(v.seen_on) + '</div><div>' + esc(s?.name || '') + ' · ' + esc(regionById(s?.region_id)?.name || '') + '</div>' +
    '<div class="row" style="margin-top:4px"><span class="chip' + (v.kind === 'dig' ? ' lv-low' : '') + '">' + VISIT_TYPE[v.kind] + '</span><span class="chip">' + SPECIES_V[v.species] + '</span><span class="hint">Logged by ' + esc(personName(v.created_by)) + '</span></div></div>';
  h += '<div class="coordbox"><div style="min-width:0"><div class="eyebrow">Coordinates</div><span class="coords" id="visit-coords">' + ll + '</span></div>' +
    '<div class="row" style="gap:8px"><button class="btn small" data-a="copy-coords" data-v="' + ll + '" data-t="visit-coords">' + ico('copy', 'sm') + 'Copy</button><button class="btn small primary" data-a="show-visit-on-map" data-id="' + v.id + '">' + ico('pin', 'sm') + 'Show on map</button></div></div>';
  if (v.photo_path) h += '<div class="photo">' + photoImg(v.photo_path, 'Photo of the tracks') + '</div>';
  const vs = { ll: [v.lat, v.lng], coordsText: ll, sectorTouched: true };
  sh.form = vs;
  h += '<div class="card"><form id="visitForm" class="stack" novalidate><div class="section-h"><h3>Details</h3></div>' + coordsField('vf', vs, false) +
    '<label class="field"><span>Beach sector</span><select class="input" id="vf-sec">' + sectorOptions(v.sector_id) + '</select></label>' +
    '<label class="field"><span>Date</span><input class="input" id="vf-date" type="date" value="' + v.seen_on + '"></label>' +
    '<div class="field"><span>What was found</span>' + choiceGroup('vf-type', VISIT_TYPE_LONG, v.kind) + '</div>' +
    '<div class="field"><span>Species</span>' + choiceGroup('vf-sp', SPECIES_V, v.species) + '</div>' +
    photoField('vf', !!v.photo_path) +
    '<label class="field"><span>Notes</span><textarea class="input" id="vf-notes">' + esc(v.notes) + '</textarea></label>' +
    '<div class="err" id="vf-err" role="alert"></div><div class="row"><button class="btn primary" type="submit">Save changes</button></div></form></div>';
  h += '<div class="row"><button class="btn small danger" data-a="visit-delete" data-id="' + v.id + '">Delete visit</button></div>';
  return { title: 'Visit details · season ' + v.season, html: h, after() {
    const read = bindCoords(vs, 'vf', null);
    bindPhoto('vf', vs);
    $('#visitForm').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('#vf-err'), date = $('#vf-date').value; err.textContent = '';
      if (!read()) { err.textContent = 'Fix the coordinates first. They must be near a beach sector.'; return; }
      if (!date || +date.slice(0, 4) !== v.season) { err.textContent = 'The date must be in the ' + v.season + ' season.'; return; }
      const ok = await work('Saving…', async () => {
        const patch = { lat: vs.ll[0], lng: vs.ll[1], sector_id: +$('#vf-sec').value, seen_on: date, kind: radioValue('vf-type'), species: radioValue('vf-sp'), notes: $('#vf-notes').value.trim() };
        if (vs.photo) patch.photo_path = await api.uploadPhoto('visits/' + v.season, vs.photo);
        await api.updateVisit(v.id, patch); await loadSeason();
      });
      if (ok) { toast('Visit saved'); renderAll(); }
    });
  } };
};

/* =====================================================================
   Actions (every button with data-a="…")
   ===================================================================== */
function showOnMap(item) {
  closeAllSheets(); S.view = 'map'; S.legend = false; M.mode = 'view'; M.selSector = null; M.focus = item.id;
  renderAll();
  requestAnimationFrame(() => { M.view.invalidate(); M.view.center([item.lat, item.lng], Math.max(M.view.zoom(), 18)); });
}
function goPlace(kind, sector) {
  closeAllSheets(); S.view = 'map'; startPlace(kind); renderAll();
  requestAnimationFrame(() => {
    M.view.invalidate();
    if (sector && drawn(sector)) M.view.fitPoints(sector.boundary, 18);
    else if (M.view.zoom() < 12) { const r = S.base.regions[0]; if (r) M.view.regionView(r, S.base.sectors); }
  });
}
const ACTIONS = {
  'auth-create': () => showAuth('create'),
  'auth-login': () => showAuth('login'),
  'auth-forgot': () => showAuth('forgot'),
  'tab': el => { S.view = el.dataset.view; if (S.view !== 'map') { M.mode = 'view'; M.focus = null; } closeAllSheets(); renderAll(); const v = $('#main .view:not([hidden])'); if (v) v.scrollTop = 0; },
  'open-year': () => openSheet({ kind: 'year' }),
  'set-year': async el => { S.year = +el.dataset.y; M.focus = null; closeAllSheets(); await work('Loading ' + S.year + '…', loadSeason); renderAll(); toast('Showing the ' + S.year + ' season'); },
  'add-year': async () => { const y = Math.max(new Date().getFullYear(), ...S.base.seasons.map(s => s.year)) + 1; if (await work('Adding…', async () => { await api.addSeason(y); S.base = await api.loadBase(); })) { toast('Season ' + y + ' added'); renderAll(); } },
  'open-user': () => openSheet({ kind: 'user' }),
  'sign-out': async () => { closeAllSheets(); await api.signOut().catch(() => {}); S.me = null; showAuth('login'); },
  'reload': () => location.reload(),
  'request-admin': async () => { if (await work('Sending…', async () => { await api.requestAdmin(); S.me = await api.me(S.me.id); })) { toast('Request sent to the admins'); renderAll(); } },
  'close-sheet': () => { const top = S.sheets[S.sheets.length - 1]; if (top && top.kind === 'sectorForm' && !top.id) { closeAllSheets(); renderAll(); return; } closeSheet(); },
  'sheet-back': () => closeSheet(),
  'confirm-yes': () => { const fn = pendingConfirm; pendingConfirm = null; closeSheet(); if (fn) fn(); },
  'fit-region': el => { if (el.dataset.id === 'cy') M.view.fitCyprus(); else { const r = regionById(+el.dataset.id); if (r && !M.view.regionView(r, S.base.sectors)) toast('This region has no sectors drawn yet.'); } },
  'zoom-in': () => M.view.zoomIn(),
  'zoom-out': () => M.view.zoomOut(),
  'toggle-base': () => { M.view.setBase(M.view.base === 'satellite' ? 'streets' : 'satellite'); toast(M.view.base === 'satellite' ? 'Satellite map' : 'Street map', 1500); renderMapChrome(); },
  'toggle-legend': () => { S.legend = !S.legend; renderMapChrome(); },
  'locate': () => startGps(me => { M.view.center([me.lat, me.lng], Math.max(M.view.zoom(), 17)); toast('Your position, accurate to about ' + Math.round(me.acc) + ' m'); }),
  'close-card': () => { M.focus = null; renderMap(); },
  'toggle-edit': () => { if (!isAdmin()) return; M.mode = M.mode === 'view' ? 'edit' : 'view'; M.selSector = null; M.draft = []; M.border = null; M.focus = null; S.legend = false; renderMap(); },
  'edit-deselect': () => { M.selSector = null; renderMap(); },
  'draw-start': el => { M.mode = 'draw'; M.draft = []; M.drawFor = el.dataset.id ? +el.dataset.id : null; M.selSector = null;
    if (M.view.zoom() < 13) { const s = M.drawFor && sectorById(M.drawFor); const r = s ? regionById(s.region_id) : S.base.regions[0]; if (r) M.view.regionView(r, S.base.sectors); }
    renderMap(); },
  'draw-undo': () => { M.draft.pop(); renderMap(); },
  'draw-cancel': () => { M.mode = 'edit'; M.draft = []; M.drawFor = null; renderMap(); },
  'draw-finish': async () => {
    if (M.draft.length < 3) return;
    if (M.drawFor) {
      const s = sectorById(M.drawFor);
      if (await work('Saving border…', async () => { await api.updateSector(s.id, { boundary: M.draft }); S.base = await api.loadBase(); })) {
        toast('Border of ' + s.name + ' saved'); M.mode = 'edit'; M.draft = []; M.drawFor = null; M.selSector = s.id; renderAll();
      }
    } else {
      const near = nearestSector(M.draft[0], S.base.sectors);
      openSheet({ kind: 'sectorForm', id: null, boundary: M.draft.slice(), regionId: near ? near.s.region_id : undefined });
    }
  },
  'border-start': el => { const s = sectorById(+el.dataset.id); M.mode = 'border'; M.borderFor = s.id; M.border = s.boundary.map(p => [p[0], p[1]]); M.selVertex = null; M.borderDirty = false; M.view.fitPoints(s.boundary, 18); renderMap(); },
  'vertex-delete': () => { if (M.selVertex === null || M.border.length <= 3) return; M.border.splice(M.selVertex, 1); M.selVertex = null; M.borderDirty = true; renderMap(); },
  'border-cancel': () => { M.mode = 'edit'; M.border = null; M.selVertex = null; renderMap(); },
  'border-save': async () => {
    const s = sectorById(M.borderFor);
    if (await work('Saving border…', async () => { await api.updateSector(s.id, { boundary: M.border }); S.base = await api.loadBase(); })) {
      toast('Border of ' + s.name + ' saved'); M.mode = 'edit'; M.border = null; M.selSector = s.id; renderAll();
    }
  },
  'sector-form': el => openSheet({ kind: 'sectorForm', id: +el.dataset.id }),
  'sector-delete': el => {
    const s = sectorById(+el.dataset.id);
    confirmSheet('Delete sector', 'Delete <b>' + esc(s.name) + '</b>? This only works if it has no nests, visits or patrols in any season.', 'Delete sector', true, async () => {
      busy(true);
      try { await api.deleteSector(s.id); S.base = await api.loadBase(); M.selSector = null; toast(s.name + ' deleted'); renderAll(); }
      catch (e) { openSheet({ kind: 'info', title: 'Cannot delete ' + s.name, msg: e.code === '23503' ? esc(s.name) + ' has nests, visits, gear or patrols recorded, so it is kept to protect that history. Rename it or move its border instead.' : esc(friendly(e)) }); }
      finally { busy(false); }
    });
  },
  'open-nest': el => openSheet({ kind: 'nest', id: el.dataset.id }),
  'open-visit': el => openSheet({ kind: 'visit', id: el.dataset.id }),
  'start-place': el => { startPlace(el.dataset.kind); if (M.view.zoom() < 12) { const r = S.base.regions[0]; if (r) M.view.regionView(r, S.base.sectors); } renderMap(); },
  'place-in-sector': el => goPlace('nest', sectorById(+el.dataset.id)),
  'add-nest-from-list': () => goPlace('nest'),
  'add-visit-from-list': () => goPlace('visit'),
  'place-cancel': () => { M.mode = 'view'; M.placing = null; M.placeInfo = null; M.placeText = ''; M.placeErr = ''; renderMap(); },
  'place-gps': () => startGps(me => { setPlace([+me.lat.toFixed(5), +me.lng.toFixed(5)], true); toast('Your position, accurate to about ' + Math.round(me.acc) + ' m'); }),
  'place-continue': () => { const i = M.placeInfo; if (M.placing && i && i.km <= NEAR_KM) openSheet({ kind: M.placeKind === 'visit' ? 'newVisit' : 'newNest', sectorId: i.s.id, ll: M.placing, coordsText: fmtLL(M.placing[0], M.placing[1]) }); },
  'nest-filter': el => { S.nestFilter = el.dataset.id; renderNests(); },
  'nest-remove': el => { const n = findNest(el.dataset.id); confirmSheet('Remove nest', 'Remove nest <b>' + esc(nestCode(n)) + '</b>? It disappears from lists and the map. Admins can restore it from the Nests page.', 'Remove nest', true, async () => {
    if (await work('Removing…', async () => { await api.updateNest(n.id, { archived: true }); await loadSeason(); })) { closeAllSheets(); toast('Nest #' + n.number + ' removed'); renderAll(); } }); },
  'nest-restore': async el => { const n = findNest(el.dataset.id); if (await work('Restoring…', async () => { await api.updateNest(n.id, { archived: false }); await loadSeason(); })) { toast('Nest #' + n.number + ' restored'); renderAll(); } },
  'show-on-map': el => { const n = findNest(el.dataset.id); if (n && isAdmin()) showOnMap(n); },
  'show-visit-on-map': el => { const v = findVisit(el.dataset.id); if (v && isAdmin()) { S.showVisits = true; showOnMap(v); } },
  'toggle-visits': () => { if (!isAdmin()) return; S.showVisits = !S.showVisits; if (!S.showVisits && findVisit(M.focus)) M.focus = null; toast(S.showVisits ? 'Visits are shown on the map' : 'Visits are hidden on the map'); renderAll(); },
  'visit-delete': el => { const v = findVisit(el.dataset.id); confirmSheet('Delete visit', 'Delete the visit on <b>' + fmt(v.seen_on) + '</b> in ' + esc(sectorById(v.sector_id)?.name || '') + '? This cannot be undone.', 'Delete visit', true, async () => {
    if (await work('Deleting…', async () => { await api.deleteVisit(v.id); await loadSeason(); })) { if (M.focus === v.id) M.focus = null; closeAllSheets(); toast('Visit deleted'); renderAll(); } }); },
  'copy-coords': el => {
    const v = el.dataset.v, target = document.getElementById(el.dataset.t);
    const fallback = () => { if (target) { const r = document.createRange(); r.selectNodeContents(target); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } toast('Coordinates selected. Press and hold them to copy.'); };
    try { navigator.clipboard.writeText(v).then(() => toast('Copied: ' + v), fallback); } catch (_) { fallback(); }
  },
};

/* =====================================================================
   Start
   ===================================================================== */
export async function start() {
  const link = window.__authLink || {};
  S.recovery = !!link.recovery;
  if (link.error) S.linkError = /expired|otp/i.test(link.error + link.errorText)
    ? 'That email link has expired or was already used. Use "Forgot your password?" to get a new one.'
    : 'That email link did not work: ' + (link.errorText || link.error).replace(/\+/g, ' ');
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-a]');
    if (!el || el.disabled) return;
    const fn = ACTIONS[el.dataset.a];
    if (fn) { e.preventDefault(); fn(el); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.sheets.length) ACTIONS['close-sheet'](); });
  // Supabase reports sign-in changes here. Work is deferred so it never runs inside Supabase's own callback.
  api.onAuth((event, session) => setTimeout(async () => {
    if (event === 'PASSWORD_RECOVERY') { S.recovery = true; S.session = session; return showAuth('recovery'); }
    if (event === 'SIGNED_OUT' || !session) {
      S.me = null; S.session = null; S.recovery = false; M.mode = 'view'; M.focus = null;
      const msg = S.linkError || ''; S.linkError = '';
      return showAuth('login', msg);
    }
    S.session = session;
    if (S.recovery) return showAuth('recovery');   // opened from a reset email: choose a new password first
    if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
    if (S.me && S.me.id === session.user.id && !$('#app').hidden) return;   // already inside
    await enterApp(session);
  }, 0));
}
