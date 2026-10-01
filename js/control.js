// The admin Control panel: members and roles, attendance approvals, seasons, regions,
// nest rules, the full change history, and Excel export of a season.
import { api, friendly } from './api.js';
import { $, $$, esc, plural, today, fmt, fmtStamp, ico } from './util.js';
import {
  S, M, SPECIES, SPECIES_V, STATUS, VISIT_TYPE, ACTIVE, isAdmin, sectorById, regionById, sectorsOf, person, personName, firstName,
  nestCode, findPatrol, hm, loadSeason, reloadBase, toast, busy, work, switchHtml, SHEETS, openSheet, closeAllSheets,
  confirmSheet, VIEWS, ACTIONS, HOOKS, renderAll,
} from './core.js';
import { makeXlsx, downloadBlob } from './xlsx.js';

// Control-panel data that only admins load: emails, season counts, history.
const C = { members: null, summary: null, at: 0, loading: false, hist: [], histDone: false, histAt: 0, histLoading: false,
  look: { nests: new Map(), patrols: new Map(), att: new Map() } };
const stale = () => { C.at = 0; };

async function refresh() {
  if (C.loading) return;
  C.loading = true;
  try {
    const [members, summary] = await Promise.all([api.adminMembers(), api.seasonSummary()]);
    C.members = members; C.summary = summary; C.at = Date.now();
  } catch (e) { console.error(e); toast(friendly(e), 6000); C.at = Date.now(); }
  finally { C.loading = false; }
  if (S.view === 'control') renderControl();
}

/* ---------- change history in plain words ---------- */
async function loadHistory(reset) {
  if (C.histLoading) return;
  C.histLoading = true;
  try {
    if (reset) { C.hist = []; C.histDone = false; }
    const rows = await api.historyPage(C.hist.length, 40);
    const want = (set, ids) => [...new Set(ids)].filter(id => id && !set.has(id));
    const attIds = want(C.look.att, rows.filter(r => r.table_name === 'attendance' && r.action !== 'insert' && r.action !== 'delete').map(r => r.row_id));
    (await api.attendanceByIds(attIds)).forEach(a => C.look.att.set(a.id, a));
    const nestIds = want(C.look.nests, rows.filter(r => r.table_name === 'nests' || r.table_name === 'nest_results').map(r => r.row_id));
    const patrolIds = want(C.look.patrols, rows.flatMap(r =>
      r.table_name === 'patrols' ? [r.row_id] : r.table_name === 'patrol_team' ? [String(r.row_id).split('/')[0]] :
      r.table_name === 'attendance' ? [r.changes?.patrol_id || C.look.att.get(r.row_id)?.patrol_id] : []));
    const [nests, patrols] = await Promise.all([api.nestsByIds(nestIds), api.patrolsByIds(patrolIds)]);
    nests.forEach(n => C.look.nests.set(n.id, n)); patrols.forEach(p => C.look.patrols.set(p.id, p));
    rows.forEach(r => {   // rows that were deleted are still described from what the history kept
      if (r.action === 'delete' && r.table_name === 'nests' && r.changes) C.look.nests.set(r.row_id, r.changes);
      if (r.action === 'delete' && r.table_name === 'patrols' && r.changes) C.look.patrols.set(r.row_id, r.changes);
    });
    C.hist.push(...rows); C.histDone = rows.length < 40; C.histAt = Date.now();
  } catch (e) { console.error(e); toast(friendly(e), 6000); C.histAt = Date.now(); }
  finally { C.histLoading = false; }
  if (S.view === 'control') renderControl();
}
const nestName = (id, row) => { const n = C.look.nests.get(id) || row; return n && n.number ? 'nest ' + nestCode(n) : 'a nest'; };
const patrolName = id => { const p = C.look.patrols.get(id) || findPatrol(id); return p ? 'the patrol at ' + (sectorById(p.sector_id)?.name || '?') + ' on ' + fmt(p.day) : 'a patrol'; };
const sectorName = id => sectorById(+id)?.name || 'a sector';
const FIELD = { status: 'status', number: 'number', found_on: 'date found', expected_hatch: 'expected hatching', has_cage: 'cage', has_pyramid: 'pyramid', lat: 'location', lng: 'location',
  notes: 'notes', photo_path: 'photo', species: 'species', sector_id: 'sector', kind: 'what was found', seen_on: 'date', day: 'date', starts: 'start time', ends: 'finish time',
  usual_cages: 'usual cages', usual_pyramids: 'usual pyramids', boundary: 'border', name: 'name', code: 'code', region_id: 'region', hatch_months: 'months to hatching',
  soon_days: '"hatching soon" days', heat_start: 'hot hours', heat_end: 'hot hours', members_see_exact_positions: 'members\' map positions', total_eggs: 'eggs', hatched: 'hatched eggs',
  unhatched: 'unhatched eggs', alive: 'alive', dead: 'dead' };
const fields = ch => [...new Set(Object.keys(ch || {}).filter(k => FIELD[k]).map(k => FIELD[k]))].join(', ');
function describe(e) {
  const ch = e.changes || {}, act = e.action, t = e.table_name;
  switch (t) {
    case 'nests': {
      const nm = nestName(e.row_id, ch);
      if (act === 'insert') return 'Added ' + nm + ' as ' + (STATUS[ch.status] || ch.status);
      if (act === 'delete') return 'Deleted ' + nm;
      if (ch.archived) return (ch.archived.to ? 'Removed ' : 'Restored ') + nm;
      return 'Changed ' + nm + ': ' + fields(ch) + (ch.status ? ' (now ' + (STATUS[ch.status.to] || ch.status.to) + ')' : '');
    }
    case 'nest_results': {
      const nm = nestName(e.row_id);
      if (act === 'insert') return 'Recorded hatching results for ' + nm + (ch.hatching_success != null ? ' (' + ch.hatching_success + '%)' : '');
      if (act === 'delete') return 'Removed the hatching results of ' + nm;
      return 'Corrected the hatching results of ' + nm + ': ' + fields(ch);
    }
    case 'visits':
      if (act === 'insert') return 'Added a visit at ' + sectorName(ch.sector_id) + ' (' + fmt(ch.seen_on) + ', ' + (VISIT_TYPE[ch.kind] || '').toLowerCase() + ')';
      if (act === 'delete') return 'Deleted the visit at ' + sectorName(ch.sector_id) + ' on ' + fmt(ch.seen_on);
      return 'Changed a visit: ' + fields(ch);
    case 'gear_stock': {
      const sid = String(e.row_id).split('/')[1], nm = sectorName(sid);
      if (act === 'insert') return 'Gear at ' + nm + ': ' + plural(ch.cages, 'cage') + ', ' + plural(ch.pyramids, 'pyramid');
      if (act === 'delete') return 'Cleared the gear counts of ' + nm;
      return 'Gear at ' + nm + ': ' + [ch.cages && 'cages ' + ch.cages.from + ' → ' + ch.cages.to, ch.pyramids && 'pyramids ' + ch.pyramids.from + ' → ' + ch.pyramids.to].filter(Boolean).join(', ');
    }
    case 'patrols':
      if (act === 'insert') return 'Planned a patrol at ' + sectorName(ch.sector_id) + ' on ' + fmt(ch.day) + ', ' + hm(ch.starts) + '–' + hm(ch.ends);
      if (act === 'delete') return 'Deleted the patrol at ' + sectorName(ch.sector_id) + ' on ' + fmt(ch.day);
      return 'Changed ' + patrolName(e.row_id) + ': ' + fields(ch);
    case 'patrol_team': {
      const [pid, uid] = String(e.row_id).split('/');
      return (act === 'insert' ? 'Put ' + (e.names || firstName(uid)) + ' on ' : 'Took ' + (e.names || firstName(uid)) + ' off ') + patrolName(pid);
    }
    case 'attendance': {
      const a = act === 'insert' || act === 'delete' ? ch : (C.look.att.get(e.row_id) || {});
      const who = a.user_id ? firstName(a.user_id) : 'someone', pn = patrolName(a.patrol_id);
      if (act === 'insert') return a.user_id === e.user_id ? (a.status === 'pending' ? 'Logged attendance for ' + pn + ' (waiting)' : 'Recorded own attendance for ' + pn) : 'Marked ' + who + ' present on ' + pn;
      if (act === 'delete') return 'Removed ' + who + '\'s attendance for ' + pn;
      if (ch.status) return (ch.status.to === 'approved' ? 'Approved ' : ch.status.to === 'declined' ? 'Declined ' : 'Reopened ') + who + '\'s attendance for ' + pn;
      return 'Changed ' + who + '\'s attendance';
    }
    case 'regions':
      if (act === 'insert') return 'Added region ' + ch.name + ' (' + ch.code + ')';
      if (act === 'delete') return 'Deleted region ' + ch.name;
      return 'Changed region ' + (regionById(+e.row_id)?.name || '') + ': ' + fields(ch);
    case 'sectors':
      if (act === 'insert') return 'Added sector ' + ch.name + ' (' + ch.code + ')';
      if (act === 'delete') return 'Deleted sector ' + ch.name;
      if (ch.boundary && Object.keys(ch).length === 1) return ((ch.boundary.from || []).length ? 'Moved the border of ' : 'Drew the border of ') + sectorName(e.row_id);
      return 'Changed sector ' + sectorName(e.row_id) + ': ' + fields(ch);
    case 'seasons': return (act === 'insert' ? 'Added season ' : act === 'delete' ? 'Deleted season ' : 'Changed season ') + (ch.year || e.row_id);
    case 'settings': return 'Changed the nest rules: ' + fields(ch);
    case 'profiles': {
      const who = personName(e.row_id);
      if (ch.role) return ch.role.to === 'admin' ? 'Made ' + who + ' an admin' : 'Made ' + who + ' a member';
      if (ch.admin_request) return ch.admin_request.to === 'pending' ? who + ' asked for admin access' : 'Declined ' + who + '\'s admin request';
      return 'Changed ' + who + '\'s profile';
    }
  }
  return act + ' in ' + t;
}
// One line for "Put Deniz, Mert on the patrol …" instead of one line per person.
function groupHistory(rows) {
  const out = [];
  rows.forEach(r => {
    const last = out[out.length - 1];
    if (r.table_name === 'patrol_team' && last && last.table_name === 'patrol_team' && last.action === r.action && last.user_id === r.user_id &&
        String(last.row_id).split('/')[0] === String(r.row_id).split('/')[0] && Math.abs(new Date(last.at) - new Date(r.at)) < 60000) {
      last.names = (last.names || firstName(String(last.row_id).split('/')[1])) + ', ' + firstName(String(r.row_id).split('/')[1]);
      return;
    }
    out.push({ ...r });
  });
  return out;
}

/* ---------- the page ---------- */
const card = (title, count, body, extra = '') => '<div class="card stack"><div class="section-h"><h3>' + title + '</h3>' + (count !== null ? '<span class="muted">' + count + '</span>' : '') + extra + '</div>' + body + '</div>';
const loading = '<p class="hint row" style="margin:0;gap:8px"><span class="spinner"></span>Loading…</p>';
function renderControl() {
  const el = $('#view-control');
  if (!isAdmin()) { el.innerHTML = '<div class="page"><div class="card empty"><h3>Admins only</h3><p style="margin:0">The control panel is for admins. You can ask for admin access from your account menu.</p></div></div>'; return; }
  if (Date.now() - C.at > 60000) refresh();
  if (Date.now() - C.histAt > 60000 && !C.histLoading) loadHistory(true);
  const me = S.me.id, set = S.base.settings;
  let h = '<div class="page"><div class="page-head"><div><div class="eyebrow">Admins only</div><h2>Control panel</h2></div></div><div class="ctl-grid">';

  // Admin requests
  const reqs = S.base.people.filter(u => u.admin_request === 'pending');
  const email = uid => C.members?.find(m => m.id === uid)?.email || '';
  h += card('Admin requests', reqs.length, reqs.length ? reqs.map(u => '<div class="mrow"><div><b>' + esc(u.name || u.nickname) + '</b> <span class="hint">@' + esc(u.nickname) + '</span><div class="hint mono" style="overflow-wrap:anywhere">' + esc(email(u.id)) + '</div></div><div class="row" style="gap:8px"><button class="btn small" data-a="req-decline" data-id="' + u.id + '">Decline</button><button class="btn small primary" data-a="req-approve" data-id="' + u.id + '">Approve</button></div></div>').join('')
    : '<p class="hint" style="margin:0">No open requests. Members ask from their account menu.</p>');

  // Attendance to approve (season shown)
  const pend = S.data.attendance.filter(a => a.status === 'pending').map(a => ({ a, p: findPatrol(a.patrol_id) })).filter(x => x.p).sort((x, y) => x.p.day.localeCompare(y.p.day));
  h += card('Attendance to approve · ' + S.year, pend.length, pend.length ? '<div>' + pend.map(({ a, p }) => '<div class="mrow"><div><b>' + esc(personName(a.user_id)) + '</b> <span class="hint">@' + esc(person(a.user_id)?.nickname || '') + '</span><div class="hint">' + esc(sectorById(p.sector_id)?.name || '') + ' · ' + fmt(p.day) + ' ' + hm(p.starts) + '–' + hm(p.ends) + (p.team.includes(a.user_id) ? '' : ' · not on the planned team') + '</div></div><div class="row" style="gap:8px"><button class="btn small" data-a="att-decline" data-id="' + a.id + '">Decline</button><button class="btn small primary" data-a="att-approve" data-id="' + a.id + '">Approve</button></div></div>').join('') + '</div>'
    : '<p class="hint" style="margin:0">Nothing waiting. Members log their duty on the Patrols page after the patrol.</p>');

  // Members
  const members = C.members;
  h += card('Members', members ? members.length : null, !members ? loading : '<div>' + members.map(u => '<div class="mrow"><div><b>' + esc(u.name || u.nickname) + '</b> <span class="hint">@' + esc(u.nickname) + (u.id === me ? ' (you)' : '') + '</span><div class="hint mono" style="overflow-wrap:anywhere">' + esc(u.email) + '</div></div><div class="row" style="gap:8px">' +
    (u.role === 'admin' ? '<span class="chip st-prot">Admin</span>' : '<span class="chip">Member</span>') +
    (u.id === me ? '' : u.role === 'admin' ? '<button class="btn small ghost" data-a="role-member" data-id="' + u.id + '">Make member</button>' : '<button class="btn small ghost" data-a="role-admin" data-id="' + u.id + '">Make admin</button>') + '</div></div>').join('') + '</div>' +
    '<p class="hint" style="margin:0">Keep at least two admins, so the project never depends on one person.</p>');

  // Seasons
  const years = (C.summary || []).map(r => r.year), top = Math.max(new Date().getFullYear(), ...S.base.seasons.map(s => s.year));
  h += card('Seasons', null, '<p class="hint" style="margin:0">Each season keeps its own nests, visits, gear counts and patrols. Beach sectors are shared by all seasons. The Excel file holds everything about a season, including coordinates and hatching results: share it with care.</p>' +
    (!C.summary ? loading : '<div class="table-wrap"><table><thead><tr><th>Season</th><th>Nests</th><th>Visits</th><th>Patrols</th><th></th></tr></thead><tbody>' + C.summary.map(r =>
      '<tr><td><b class="num">' + r.year + '</b>' + (r.year === S.year ? ' <span class="chip st-prot">Showing</span>' : '') + '</td><td class="num">' + r.nests + (r.removed ? ' <span class="hint">(' + r.removed + ' removed)</span>' : '') + '</td><td class="num">' + r.visits + '</td><td class="num">' + r.patrols + '</td><td style="text-align:right;white-space:nowrap">' +
      (!+r.gear_rows && years.includes(r.year - 1) ? '<button class="btn small ghost" data-a="carry-gear" data-y="' + r.year + '" data-from="' + (r.year - 1) + '">Copy gear from ' + (r.year - 1) + '</button> ' : '') +
      (r.year !== S.year ? '<button class="btn small ghost" data-a="set-year" data-y="' + r.year + '">Show</button> ' : '') +
      '<button class="btn small" data-a="export-season" data-y="' + r.year + '">' + ico('download', 'sm') + 'Excel</button></td></tr>').join('') + '</tbody></table></div>'),
    '<button class="btn small" data-a="add-year">' + ico('plus', 'sm') + 'Add ' + (top + 1) + '</button>');

  // Regions and sectors
  h += card('Regions and beach sectors', null, S.base.regions.map(r => '<div class="stack" style="gap:6px"><div class="spread"><b>' + esc(r.name) + ' <span class="mono hint">' + esc(r.code) + '</span></b><div class="row" style="gap:6px"><button class="btn small ghost" data-a="region-form" data-id="' + r.id + '">Rename</button><button class="btn small ghost" data-a="fit-and-go" data-id="' + r.id + '">Show on map</button></div></div>' +
    (sectorsOf(r.id).length ? '<div class="table-wrap"><table><tbody>' + sectorsOf(r.id).map(s => '<tr><td>' + esc(s.name) + '</td><td class="mono hint">' + esc(s.code) + '</td><td class="hint">usual need ' + s.usual_cages + ' / ' + s.usual_pyramids + '</td><td class="hint">' + ((s.boundary || []).length >= 3 ? 'border drawn' : 'no border yet') + '</td><td style="text-align:right"><button class="btn small ghost" data-a="sector-form" data-id="' + s.id + '">Edit</button></td></tr>').join('') + '</tbody></table></div>'
      : '<p class="hint" style="margin:0">No sectors yet. Draw one from the map\'s pencil button.</p>') + '</div>').join('') +
    '<form id="regionForm" class="row" style="align-items:flex-end" novalidate><label class="field" style="flex:1;min-width:140px"><span>New region name</span><input class="input" id="rg-name"></label><label class="field" style="width:96px"><span>Code</span><input class="input mono" id="rg-code" maxlength="4" placeholder="ABC"></label><button class="btn" type="submit">Add region</button></form><div class="err" id="rg-err" role="alert"></div>');

  // Nest rules
  h += card('Nest rules', null, '<form id="rulesForm" class="stack" novalidate>' +
    '<div class="two"><label class="field"><span>Expected hatching (months after found)</span><input class="input" id="ru-months" type="number" min="1" max="4" value="' + set.hatch_months + '"></label><label class="field"><span>"Hatching soon" alert (days before)</span><input class="input" id="ru-soon" type="number" min="1" max="21" value="' + set.soon_days + '"></label></div>' +
    '<div class="two"><label class="field"><span>Hot hours start</span><input class="input" id="ru-hs" type="time" value="' + hm(set.heat_start) + '"></label><label class="field"><span>Hot hours end</span><input class="input" id="ru-he" type="time" value="' + hm(set.heat_end) + '"></label></div>' +
    '<label class="check" style="min-height:auto;padding:10px 14px;font-weight:500"><input type="checkbox" id="ru-exact"' + (set.members_see_exact_positions ? ' checked' : '') + '><span>Members see nests at their exact spot on the map. Untick to show members positions rounded to about 100 m.</span></label>' +
    '<div class="err" id="ru-err" role="alert"></div><div><button class="btn primary" type="submit">Save rules</button></div></form>');

  // History
  const hist = groupHistory(C.hist);
  h += card('Change history', null, (!C.hist.length && C.histLoading ? loading : !C.hist.length ? '<p class="hint" style="margin:0">No changes recorded yet.</p>' :
    '<div class="hist">' + hist.map(e => '<div><time>' + fmtStamp(e.at) + '</time><span>' + esc(describe(e)) + '</span><small>' + esc(e.user_id ? personName(e.user_id) : 'Automatic') + (e.season ? ' · season ' + e.season : '') + '</small></div>').join('') + '</div>') +
    (C.hist.length && !C.histDone ? '<div><button class="btn small" data-a="hist-more"' + (C.histLoading ? ' disabled' : '') + '>Show older changes</button></div>' : '') +
    '<div class="placeholder"><b>Backups</b><span>Download a season with its Excel button above. A nightly copy of the whole database can be set up on GitHub (see the build plan).</span></div>',
    '<button class="btn small ghost" data-a="hist-refresh">Refresh</button>');

  h += card(ico('sensor') + ' Nest sensors', null, '<div class="placeholder"><b>No sensor devices yet</b><span>This section is ready for the nest devices. Once they are online, each device can be linked to a nest and its readings will show on that nest\'s page.</span></div>', '<span class="chip">Not connected</span>');
  h += card(ico('sat') + ' Turtle tracking', null, '<div class="placeholder"><b>Mediterranean map of tagged turtles</b><span>A later phase: a satellite map of the sea showing each tagged turtle\'s last known position and update time.</span></div>', '<span class="chip">Planned</span>');
  el.innerHTML = h + '</div></div>';
  $('#regionForm').addEventListener('submit', e => { e.preventDefault(); addRegion(); });
  $('#rulesForm').addEventListener('submit', e => { e.preventDefault(); saveRules(); });
}

async function addRegion() {
  const name = $('#rg-name').value.trim(), code = $('#rg-code').value.trim().toUpperCase(), err = $('#rg-err');
  if (!name) { err.textContent = 'Enter a region name.'; return; }
  if (!/^[A-ZÇĞİÖŞÜ]{2,4}$/.test(code)) { err.textContent = 'Use a code of 2 to 4 letters, like KAR.'; return; }
  busy(true);
  try { await api.addRegion({ name, code }); await reloadBase(); toast(name + ' added. Draw its sectors from the map.'); renderAll(); }
  catch (e) { err.textContent = e.code === '23505' ? 'A region with that name or code already exists.' : friendly(e); }
  finally { busy(false); }
}
async function saveRules() {
  const m = Number($('#ru-months').value), d = Number($('#ru-soon').value), hs = $('#ru-hs').value, he = $('#ru-he').value, err = $('#ru-err');
  if (!Number.isInteger(m) || m < 1 || m > 4) { err.textContent = 'Months must be a whole number from 1 to 4.'; return; }
  if (!Number.isInteger(d) || d < 1 || d > 21) { err.textContent = 'Alert days must be a whole number from 1 to 21.'; return; }
  if (!hs || !he || he <= hs) { err.textContent = 'Hot hours must end after they start.'; return; }
  const ok = await work('Saving…', async () => { await api.saveSettings({ hatch_months: m, soon_days: d, heat_start: hs, heat_end: he, members_see_exact_positions: $('#ru-exact').checked }); await reloadBase(); });
  if (ok) { toast('Rules saved. They apply to new nests; existing dates stay as they are.', 4500); C.histAt = 0; renderAll(); }
}

SHEETS.regionForm = sh => {
  const r = regionById(sh.id); if (!r) return null;
  const n = sectorsOf(r.id).length;
  return { title: 'Region', html: '<h2 style="font-size:28px">' + esc(r.name) + '</h2><form id="rgEdit" class="stack" novalidate>' +
    '<div class="two"><label class="field"><span>Name</span><input class="input" id="re-name" value="' + esc(r.name) + '"></label><label class="field"><span>Code (used in nest IDs)</span><input class="input mono" id="re-code" maxlength="4" value="' + esc(r.code) + '"></label></div>' +
    '<p class="hint" style="margin:0">Changing the code changes every nest ID in this region, in all seasons.</p>' +
    '<div class="err" id="re-err" role="alert"></div><div class="row">' + (n ? '' : '<button type="button" class="btn danger" data-a="region-delete" data-id="' + r.id + '">Delete</button>') + '<button type="button" class="btn ghost" data-a="close-sheet">Cancel</button><button class="btn primary" type="submit">Save</button></div>' +
    (n ? '<p class="hint" style="margin:0">A region can be deleted once it has no sectors.</p>' : '') + '</form>', after() {
    $('#rgEdit').addEventListener('submit', async e => {
      e.preventDefault();
      const name = $('#re-name').value.trim(), code = $('#re-code').value.trim().toUpperCase(), err = $('#re-err');
      if (!name) { err.textContent = 'Enter a name.'; return; }
      if (!/^[A-ZÇĞİÖŞÜ]{2,4}$/.test(code)) { err.textContent = 'Use a code of 2 to 4 letters, like KAR.'; return; }
      busy(true);
      try { await api.updateRegion(r.id, { name, code }); await reloadBase(); closeAllSheets(); toast('Region saved'); renderAll(); }
      catch (ex) { err.textContent = ex.code === '23505' ? 'Another region already uses that name or code.' : friendly(ex); }
      finally { busy(false); }
    });
  } };
};

/* ---------- Excel export ---------- */
const yesNo = b => b ? 'Yes' : 'No';
async function exportSeason(year) {
  busy(true, 'Preparing Excel…');
  try {
    const d = await api.exportSeason(year);
    const res = new Map(d.results.map(r => [r.nest_id, r]));
    const reg = sid => regionById(sectorById(sid)?.region_id)?.name || '';
    const sec = sid => sectorById(sid)?.name || '';
    const place = sid => reg(sid) + ' ' + sec(sid);
    d.nests.sort((a, b) => place(a.sector_id).localeCompare(place(b.sector_id)) || a.number - b.number);
    d.visits.sort((a, b) => a.seen_on.localeCompare(b.seen_on) || place(a.sector_id).localeCompare(place(b.sector_id)));
    const live = d.nests.filter(n => !n.archived);
    const eggs = live.reduce((a, n) => a + (res.get(n.id)?.total_eggs || 0), 0), hatched = live.reduce((a, n) => a + (res.get(n.id)?.hatched || 0), 0);
    const summary = {
      name: 'Summary', columns: [{ title: 'Season ' + year, width: 36 }, { title: '', type: 'dec', width: 14 }],
      rows: [
        ['Nests', live.length], ['Loggerhead (Caretta caretta)', live.filter(n => n.species === 'cc').length], ['Green turtle (Chelonia mydas)', live.filter(n => n.species === 'cm').length],
        ['Nests with hatching results', live.filter(n => res.has(n.id)).length], ['Eggs counted', eggs], ['Hatched eggs', hatched],
        ['Hatching success % (hatched ÷ eggs × 100)', eggs ? Math.round(hatched / eggs * 1000) / 10 : null],
        ['Visits (came ashore, no nest)', d.visits.length], ['Nesting success % (nests ÷ times ashore × 100)', live.length + d.visits.length ? Math.round(live.length / (live.length + d.visits.length) * 1000) / 10 : null],
        ['Patrols', d.patrols.length], ['Approved duty days', d.attendance.filter(a => a.status === 'approved').length],
        ['Exported', fmtStamp(new Date().toISOString()) + ' by ' + (S.me.name || S.me.nickname)],
      ] };
    const nests = {
      name: 'Nests', columns: [
        { title: 'Nest ID', width: 24 }, { title: 'Number', type: 'num', width: 8 }, { title: 'Region' }, { title: 'Sector' }, { title: 'Species', width: 18 },
        { title: 'Found', type: 'date', width: 12 }, { title: 'Expected hatching', type: 'date', width: 12 }, { title: 'Status' }, { title: 'Cage', width: 7 }, { title: 'Pyramid', width: 8 },
        { title: 'Latitude', type: 'num', width: 11 }, { title: 'Longitude', type: 'num', width: 11 },
        { title: 'Total eggs', type: 'num', width: 10 }, { title: 'Hatched', type: 'num', width: 9 }, { title: 'Unhatched', type: 'num', width: 10 }, { title: 'Alive hatchlings', type: 'num', width: 10 }, { title: 'Dead hatchlings', type: 'num', width: 10 },
        { title: 'Hatching success %', type: 'dec', width: 11 }, { title: 'Notes', width: 40 }, { title: 'Removed', width: 9 }, { title: 'Added by', width: 16 }],
      rows: d.nests.map(n => { const r = res.get(n.id) || {}; return [nestCode(n), n.number, reg(n.sector_id), sec(n.sector_id), SPECIES[n.species], n.found_on, n.expected_hatch, STATUS[n.status], yesNo(n.has_cage), yesNo(n.has_pyramid),
        n.lat, n.lng, r.total_eggs, r.hatched, r.unhatched, r.alive, r.dead, r.hatching_success != null ? +r.hatching_success : null, n.notes, n.archived ? 'Removed' : '', n.created_by ? personName(n.created_by) : '']; }) };
    const visits = {
      name: 'Visits', columns: [{ title: 'Date', type: 'date', width: 12 }, { title: 'Region' }, { title: 'Sector' }, { title: 'What was found', width: 16 }, { title: 'Species', width: 16 },
        { title: 'Latitude', type: 'num', width: 11 }, { title: 'Longitude', type: 'num', width: 11 }, { title: 'Notes', width: 40 }, { title: 'Logged by', width: 16 }],
      rows: d.visits.map(v => [v.seen_on, reg(v.sector_id), sec(v.sector_id), VISIT_TYPE[v.kind], SPECIES_V[v.species], v.lat, v.lng, v.notes, v.created_by ? personName(v.created_by) : '']) };
    const gear = {
      name: 'Gear', columns: [{ title: 'Region' }, { title: 'Sector' }, { title: 'Cages', type: 'num', width: 8 }, { title: 'Pyramids', type: 'num', width: 9 }, { title: 'Cages on nests', type: 'num', width: 10 }, { title: 'Pyramids on nests', type: 'num', width: 10 }, { title: 'Usual need: cages', type: 'num', width: 10 }, { title: 'Usual need: pyramids', type: 'num', width: 10 }],
      rows: S.base.sectors.slice().sort((a, b) => place(a.id).localeCompare(place(b.id))).map(s => { const g = d.gear.find(x => x.sector_id === s.id) || {}; const act = live.filter(n => n.sector_id === s.id && ACTIVE.includes(n.status));
        return [reg(s.id), s.name, g.cages ?? null, g.pyramids ?? null, act.filter(n => n.has_cage).length, act.filter(n => n.has_pyramid).length, s.usual_cages, s.usual_pyramids]; }) };
    const att = (pid, st) => d.attendance.filter(a => a.patrol_id === pid && a.status === st).map(a => personName(a.user_id)).join(', ');
    const patrols = {
      name: 'Patrols', columns: [{ title: 'Date', type: 'date', width: 12 }, { title: 'Region' }, { title: 'Sector' }, { title: 'Start', width: 8 }, { title: 'Finish', width: 8 }, { title: 'Planned team', width: 30 }, { title: 'Attended (approved)', width: 30 }, { title: 'Waiting for approval', width: 20 }, { title: 'Notes', width: 30 }],
      rows: d.patrols.map(p => [p.day, reg(p.sector_id), sec(p.sector_id), hm(p.starts), hm(p.ends), p.team.map(personName).join(', '), att(p.id, 'approved'), att(p.id, 'pending'), p.notes]) };
    const pById = new Map(d.patrols.map(p => [p.id, p]));
    const attendance = {
      name: 'Attendance', columns: [{ title: 'Date', type: 'date', width: 12 }, { title: 'Sector' }, { title: 'Person', width: 20 }, { title: 'Nickname', width: 14 }, { title: 'Status', width: 13 }, { title: 'Decided by', width: 18 }],
      rows: d.attendance.map(a => ({ a, p: pById.get(a.patrol_id) })).filter(x => x.p).sort((x, y) => x.p.day.localeCompare(y.p.day))
        .map(({ a, p }) => [p.day, sec(p.sector_id), personName(a.user_id), person(a.user_id)?.nickname || '', { approved: 'Approved', pending: 'Waiting', declined: 'Not approved' }[a.status], a.decided_by ? personName(a.decided_by) : '']) };
    downloadBlob(makeXlsx([summary, nests, visits, gear, patrols, attendance]), 'turtle-patrol-' + year + '.xlsx');
    toast('Excel file for ' + year + ' downloaded');
  } catch (e) { console.error(e); toast(friendly(e), 6000); }
  finally { busy(false); }
}

/* ---------- buttons ---------- */
VIEWS.control = renderControl;
Object.assign(ACTIONS, {
  'req-approve': async el => { const u = person(el.dataset.id); if (await work('Saving…', async () => { await api.setRole(el.dataset.id, 'admin'); await reloadBase(); })) { stale(); C.histAt = 0; toast((u?.name || u?.nickname) + ' is now an admin'); renderAll(); } },
  'req-decline': async el => { const u = person(el.dataset.id); if (await work('Saving…', async () => { await api.declineAdmin(el.dataset.id); await reloadBase(); })) { stale(); C.histAt = 0; toast('Request from ' + (u?.name || u?.nickname) + ' declined'); renderAll(); } },
  'role-admin': el => {
    const u = person(el.dataset.id);
    confirmSheet('Make admin', 'Give <b>' + esc(u?.name || u?.nickname) + '</b> admin access? Admins can change all data, see coordinates and hatching results, and manage members.', 'Make admin', false, async () => {
      if (await work('Saving…', async () => { await api.setRole(u.id, 'admin'); await reloadBase(); })) { stale(); C.histAt = 0; toast((u.name || u.nickname) + ' is now an admin'); renderAll(); }
    });
  },
  'role-member': el => {
    const u = person(el.dataset.id);
    confirmSheet('Make member', 'Change <b>' + esc(u?.name || u?.nickname) + '</b> to a member? They will no longer see coordinates, hatching results or visits.', 'Make member', true, async () => {
      if (await work('Saving…', async () => { await api.setRole(u.id, 'member'); await reloadBase(); })) { stale(); C.histAt = 0; toast((u.name || u.nickname) + ' is now a member'); renderAll(); }
    });
  },
  'region-form': el => openSheet({ kind: 'regionForm', id: +el.dataset.id }),
  'region-delete': el => {
    const r = regionById(+el.dataset.id);
    confirmSheet('Delete region', 'Delete the region <b>' + esc(r.name) + '</b>?', 'Delete region', true, async () => {
      if (await work('Deleting…', async () => { await api.deleteRegion(r.id); await reloadBase(); })) { closeAllSheets(); toast(r.name + ' deleted'); renderAll(); }
    });
  },
  'fit-and-go': el => { closeAllSheets(); S.view = 'map'; M.mode = 'view'; renderAll(); requestAnimationFrame(() => { M.view.invalidate(); const r = regionById(+el.dataset.id); if (r && !M.view.regionView(r, S.base.sectors)) toast('This region has no sectors drawn yet.'); }); },
  'export-season': el => exportSeason(+el.dataset.y),
  'hist-more': () => loadHistory(false),
  'hist-refresh': () => { stale(); loadHistory(true); },
});
// Whenever data is reloaded after a change, the season counts and history are fetched again next time.
HOOKS.changed = () => { stale(); C.histAt = 0; };
