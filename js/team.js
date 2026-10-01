// Gear, patrols, attendance, alerts and the team: the parts of the app about people and equipment.
import { api, friendly } from './api.js';
import { $, $$, esc, plural, today, fmt, fmtStamp, daysBetween, addDays, parseISO, weekday, monthShort, longDate, dayMonth, monthYear, resizePhoto, ico } from './util.js';
import {
  S, M, SPECIES, ACTIVE, isAdmin, sectorById, regionById, sectorsOf, person, personName, firstName, hasResults, isCurrentSeason,
  nestCode, findNest, findPatrol, hm, nowHM, loadSeason, reloadBase, toast, busy, work, sectorOptions, avatar, hydratePhotos,
  SHEETS, openSheet, closeSheet, closeAllSheets, confirmSheet, VIEWS, ACTIONS, renderAll,
} from './core.js';

/* =====================================================================
   Gear: cages and pyramids per beach
   A nest that is still incubating holds one cage and one pyramid. Gear comes
   back to the beach's free stock when the nest is marked Hatched or Predation.
   ===================================================================== */
const stockOf = sid => S.data.gear.find(g => g.sector_id === sid) || { cages: 0, pyramids: 0 };
export const hasGearData = () => S.data.gear.length > 0;
export function gearInfo(sid) {
  const sec = sectorById(sid), st = stockOf(sid);
  const act = S.data.nests.filter(n => n.sector_id === sid && ACTIVE.includes(n.status));
  const usedC = act.filter(n => n.has_cage).length, usedP = act.filter(n => n.has_pyramid).length;
  const lackC = act.length - usedC, lackP = act.length - usedP;
  const freeC = Math.max(0, st.cages - usedC), freeP = Math.max(0, st.pyramids - usedP);
  const shortC = Math.max(0, lackC - freeC), shortP = Math.max(0, lackP - freeP);
  let level = 'ok';
  if (!hasGearData()) level = 'none';
  else if (shortC > 0 || shortP > 0) level = 'short';
  else if (st.cages < sec.usual_cages || st.pyramids < sec.usual_pyramids) level = 'low';
  return { st: { c: st.cages, p: st.pyramids }, usedC, usedP, freeC, freeP, lackC, lackP, shortC, shortP, active: act.length, level, sec };
}
const LEVEL = { ok: 'Stock OK', low: 'Below usual need', short: 'Short now', none: 'No gear logged' };
const levelChip = lv => '<span class="chip lv-' + lv + '"><span class="dot"></span>' + LEVEL[lv] + '</span>';

function suggestFrom(sid, t) {
  const me = sectorById(sid);
  return S.base.sectors.filter(s => s.id !== sid).map(s => ({ s, g: gearInfo(s.id) }))
    .filter(x => (t === 'c' ? x.g.freeC : x.g.freeP) > 0)
    .sort((a, b) => (a.s.region_id === me.region_id ? 0 : 1) - (b.s.region_id === me.region_id ? 0 : 1) || (t === 'c' ? b.g.freeC - a.g.freeC : b.g.freeP - a.g.freeP))
    .slice(0, 2);
}
function suggestText(sid, g) {
  const need = { c: g.shortC > 0 || (g.level === 'low' && g.st.c < g.sec.usual_cages), p: g.shortP > 0 || (g.level === 'low' && g.st.p < g.sec.usual_pyramids) };
  const by = new Map();
  ['c', 'p'].forEach(t => { if (!need[t]) return; suggestFrom(sid, t).forEach(x => { const e = by.get(x.s) || { c: 0, p: 0 }; e[t] = t === 'c' ? x.g.freeC : x.g.freeP; by.set(x.s, e); }); });
  const parts = [...by].map(([s, e]) => s.name + ' has ' + [e.c && plural(e.c, 'free cage'), e.p && plural(e.p, 'free pyramid')].filter(Boolean).join(' and '));
  return parts.length ? 'Free gear nearby: ' + parts.join('; ') + '.' : '';
}
// "Below usual need" and "Short now" open their explanation on tap. "Short now" starts open because it is urgent.
const levelOpen = (sid, lv) => (S.levelOpen[sid] ?? (lv === 'short'));
function levelButton(sid, lv) {
  if (lv !== 'low' && lv !== 'short') return levelChip(lv);
  const open = levelOpen(sid, lv);
  return '<button type="button" class="chip chip-btn lv-' + lv + '" data-a="toggle-level" data-id="' + sid + '" aria-expanded="' + open + '" aria-controls="lvg-' + sid + '"><span class="dot"></span>' + LEVEL[lv] + ico('down', 'sm') + '</button>';
}
function levelExplain(s, g) {
  if ((g.level !== 'low' && g.level !== 'short') || !levelOpen(s.id, g.level)) return '';
  let h = g.level === 'short'
    ? '<div class="msg crit">' + plural(g.active, 'nest') + ' found here, but ' + [g.shortC && plural(g.shortC, 'cage') + ' missing', g.shortP && plural(g.shortP, 'pyramid') + ' missing'].filter(Boolean).join(' and ') + '. Plan a delivery before the next patrol.</div>'
    : '<div class="msg warn">This beach usually needs ' + plural(s.usual_cages, 'cage') + ' and ' + plural(s.usual_pyramids, 'pyramid') + ' over a season. It has ' + g.st.c + ' and ' + g.st.p + '.</div>';
  const tip = suggestText(s.id, g);
  if (tip) h += '<div class="msg tip">' + esc(tip) + '</div>';
  return '<div class="stack" id="lvg-' + s.id + '" style="gap:8px">' + h + '</div>';
}
// The bar is the beach's own stock: green = on nests, empty = free, striped red = still missing for found nests.
function bar(used, total, lack) {
  const stock = Math.max(total, used), max = Math.max(stock + lack, 1);
  const pct = v => (v / max * 100).toFixed(2) + '%';
  return '<div class="bar" aria-hidden="true"><div class="fill" style="width:' + pct(used) + '"></div>' + (lack ? '<div class="need" style="left:' + pct(stock) + ';width:' + pct(lack) + '"></div>' : '') + '</div>';
}
const stepper = (s, t, v, word) =>
  '<span class="row" style="gap:6px;flex-wrap:nowrap"><span class="hint">' + word + '</span><span class="stepper">' +
  '<button data-a="gear-step" data-id="' + s.id + '" data-t="' + t + '" data-d="-1" aria-label="One ' + word.toLowerCase().replace(/s$/, '') + ' fewer at ' + esc(s.name) + '">−</button>' +
  '<input type="number" inputmode="numeric" min="0" step="1" value="' + v + '" data-gear="' + s.id + '" data-t="' + t + '" aria-label="' + word + ' at ' + esc(s.name) + '">' +
  '<button data-a="gear-step" data-id="' + s.id + '" data-t="' + t + '" data-d="1" aria-label="One ' + word.toLowerCase().replace(/s$/, '') + ' more at ' + esc(s.name) + '">+</button></span></span>';
function gearCard(s) {
  const g = gearInfo(s.id);
  let h = '<div class="gear-card' + (g.level === 'short' ? ' lv-short-card' : '') + '" id="gear-' + s.id + '"><div class="spread"><div><b style="font-size:18px">' + esc(s.name) + '</b> <span class="muted">· ' + plural(g.active, 'active nest') + '</span></div>' + levelButton(s.id, g.level) + '</div>';
  h += '<div class="bar-row"><span>Cages</span>' + bar(g.usedC, g.st.c, g.shortC) + '<span class="num"><b>' + g.usedC + '</b>/' + g.st.c + ' in use</span></div>';
  h += '<div class="bar-row"><span>Pyramids</span>' + bar(g.usedP, g.st.p, g.shortP) + '<span class="num"><b>' + g.usedP + '</b>/' + g.st.p + ' in use</span></div>';
  h += '<div class="bar-legend"><span><i style="background:var(--accent)"></i>On nests</span><span><i style="background:var(--surface-2);border:1px solid var(--line)"></i>Free</span>' + (g.shortC || g.shortP ? '<span><i style="background:var(--crit)"></i>Missing</span>' : '') + '<span>Usual need: ' + plural(s.usual_cages, 'cage') + ', ' + plural(s.usual_pyramids, 'pyramid') + '</span></div>';
  h += levelExplain(s, g);
  if (isAdmin()) h += '<div class="row" style="justify-content:space-between"><div class="row" style="gap:10px 14px">' + stepper(s, 'c', g.st.c, 'Cages') + stepper(s, 'p', g.st.p, 'Pyramids') + '</div><button class="btn small ghost" data-a="sector-form" data-id="' + s.id + '">Usual need</button></div>';
  return h + '</div>';
}
const prevSeason = () => S.base.seasons.map(s => s.year).filter(y => y < S.year).sort((a, b) => b - a)[0];
function renderGear() {
  const admin = isAdmin();
  let tc = 0, tp = 0, uc = 0, up = 0, mc = 0, mp = 0;
  S.base.sectors.forEach(s => { const g = gearInfo(s.id); tc += g.st.c; tp += g.st.p; uc += g.usedC; up += g.usedP; mc += g.shortC; mp += g.shortP; });
  let h = '<div class="page"><div class="page-head"><div><div class="eyebrow">Season ' + S.year + '</div><h2>Cages and pyramids</h2></div>' + (admin && hasGearData() ? '<button class="btn" data-a="move-gear">' + ico('move', 'sm') + 'Move gear</button>' : '') + '</div>';
  if (!hasGearData()) {
    const prev = prevSeason();
    h += '<div class="card empty"><h3>No equipment counts for ' + S.year + ' yet</h3><p style="margin:0">' + (admin ? 'Copy last season\'s counts to start, or type the counts for each beach below.' : 'An admin will add the cage and pyramid counts.') + '</p>' +
      (admin && prev ? '<button class="btn primary" data-a="carry-gear" data-y="' + S.year + '" data-from="' + prev + '">Copy counts from ' + prev + '</button>' : '') + '</div>';
    if (!admin) { $('#view-gear').innerHTML = h + '</div>'; return; }
  } else {
    h += '<div class="stat-row gear-stats">' +
      '<div class="stat"><b>' + uc + '</b><span>cages on nests</span></div>' +
      '<div class="stat"><b>' + up + '</b><span>pyramids on nests</span></div>' +
      '<div class="stat"><b>' + Math.max(0, tc - uc) + ' / ' + Math.max(0, tp - up) + '</b><span>free cages / pyramids</span></div>' +
      '<div class="stat"><b>' + tc + ' / ' + tp + '</b><span>total cages / pyramids</span></div>' +
      '<div class="stat wide' + (mc + mp ? ' alarm' : '') + '"><b>' + (mc + mp) + '</b><span>' + (mc + mp ? 'missing on found nests: ' + [mc && plural(mc, 'cage'), mp && plural(mp, 'pyramid')].filter(Boolean).join(', ') : 'missing on found nests') + '</span></div></div>';
    h += '<p class="hint" style="margin:0">A nest needs one cage and one pyramid. Gear returns to the beach\'s free stock automatically when a nest is marked Hatched or Predation.' + (admin ? ' Tap a number to type it.' : '') + '</p>';
  }
  S.base.regions.forEach(r => {
    const secs = sectorsOf(r.id); if (!secs.length) return;
    h += '<div class="group-h"><h3>' + esc(r.name) + '</h3></div><div class="stack">' + secs.map(gearCard).join('') + '</div>';
  });
  $('#view-gear').innerHTML = h + '</div>';
  $$('#view-gear input[data-gear]').forEach(inp => inp.addEventListener('change', () => setGearCount(+inp.dataset.gear, inp.dataset.t, inp.value)));
}
async function setGearCount(sid, t, raw) {
  const v = Number(raw), g = gearInfo(sid), used = t === 'c' ? g.usedC : g.usedP, word = t === 'c' ? 'cages' : 'pyramids';
  if (!Number.isInteger(v) || v < 0 || v > 9999) { toast('Enter a whole number of 0 or more.'); return renderAll(); }
  if (v < used) { toast(plural(used, t === 'c' ? 'cage is' : 'pyramid is', t === 'c' ? 'cages are' : 'pyramids are') + ' on nests at ' + g.sec.name + ', so the count cannot go below ' + used + '.', 5000); return renderAll(); }
  const c = t === 'c' ? v : g.st.c, p = t === 'p' ? v : g.st.p;
  const ok = await work('Saving…', async () => { await api.setGear(S.year, sid, c, p); await loadSeason(); });
  if (ok) toast(g.sec.name + ': ' + v + ' ' + word);
  renderAll();
}

SHEETS.moveGear = () => {
  const opts = S.base.regions.map(r => '<optgroup label="' + esc(r.name) + '">' + sectorsOf(r.id).map(s => { const g = gearInfo(s.id); return '<option value="' + s.id + '">' + esc(s.name) + ' (free: ' + g.freeC + ' cages, ' + g.freeP + ' pyramids)</option>'; }).join('') + '</optgroup>').join('');
  const h = '<h2 style="font-size:28px">Move gear between beaches</h2><form id="mvForm" class="stack" novalidate>' +
    '<label class="field"><span>From</span><select class="input" id="mv-from">' + opts + '</select></label>' +
    '<label class="field"><span>To</span><select class="input" id="mv-to">' + opts + '</select></label>' +
    '<div class="two"><label class="field"><span>What</span><select class="input" id="mv-type"><option value="cages">Cages</option><option value="pyramids">Pyramids</option></select></label><label class="field"><span>How many</span><input class="input num" id="mv-n" type="number" inputmode="numeric" min="1" value="1"></label></div>' +
    '<label class="check" id="mv-protect-row" hidden><input type="checkbox" id="mv-protect" checked><span id="mv-protect-text"></span></label>' +
    '<div class="hint">Only free gear can be moved. Gear on a nest stays until the nest is marked Hatched or Predation.</div>' +
    '<div class="err" id="mv-err" role="alert"></div><div class="row"><button type="button" class="btn ghost" data-a="close-sheet">Cancel</button><button class="btn primary" type="submit" id="mv-go">Move</button></div></form>';
  return { title: 'Gear', html: h, after() {
    const to = $('#mv-to'), from = $('#mv-from'), type = $('#mv-type');
    const waiting = () => {
      const n = S.data.nests.filter(x => x.sector_id === +to.value && x.status === 'notprot').length;
      $('#mv-protect-row').hidden = !n;
      $('#mv-protect-text').textContent = 'Also mark the ' + plural(n, 'nest') + ' waiting at ' + sectorById(+to.value).name + ' as protected (only tick this when the gear is placed on them)';
    };
    const short = S.base.sectors.find(s => gearInfo(s.id).level === 'short');
    if (short) {
      to.value = short.id; const g = gearInfo(short.id), t = g.shortP ? 'p' : 'c';
      type.value = t === 'p' ? 'pyramids' : 'cages';
      const src = suggestFrom(short.id, t)[0]; if (src) from.value = src.s.id;
      $('#mv-n').value = Math.max(1, t === 'p' ? g.shortP : g.shortC);
    } else if (from.value === to.value && to.options.length > 1) to.selectedIndex = 1;
    to.addEventListener('change', waiting); waiting();
    $('#mvForm').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('#mv-err'), f = +from.value, t = +to.value, kind = type.value, n = Number($('#mv-n').value);
      if (f === t) { err.textContent = 'Pick two different beaches.'; return; }
      if (!Number.isInteger(n) || n < 1) { err.textContent = 'Enter how many to move, 1 or more.'; return; }
      const g = gearInfo(f), free = kind === 'cages' ? g.freeC : g.freeP;
      if (n > free) { err.textContent = sectorById(f).name + ' has only ' + plural(free, kind === 'cages' ? 'free cage' : 'free pyramid') + '.'; return; }
      $('#mv-go').disabled = true; busy(true, 'Moving…');
      try {
        const fixed = await api.moveGear({ season: S.year, from: f, to: t, kind, count: n, protect: !$('#mv-protect-row').hidden && $('#mv-protect').checked });
        await loadSeason();
        closeAllSheets();
        toast('Moved ' + plural(n, kind === 'cages' ? 'cage' : 'pyramid') + ' to ' + sectorById(t).name + (fixed ? ' · ' + plural(fixed, 'nest') + ' now protected' : ''));
        renderAll();
      } catch (ex) { err.textContent = friendly(ex); $('#mv-go').disabled = false; }
      finally { busy(false); }
    });
  } };
};

/* =====================================================================
   Patrols and attendance
   ===================================================================== */
const ATT = {
  approved: { cls: 'att-ok', ico: 'check', chip: 'lv-ok', label: 'Approved' },
  pending: { cls: 'att-wait', ico: 'clock', chip: 'lv-low', label: 'Waiting' },
  declined: { cls: 'att-no', ico: 'x', chip: 'lv-short', label: 'Not approved' },
};
const heat = () => [hm(S.base.settings.heat_start || '11:00'), hm(S.base.settings.heat_end || '16:00')];
const isHot = p => { const [a, b] = heat(); return hm(p.starts) < b && hm(p.ends) > a; };
const patrolStarted = p => p.day < today() || (p.day === today() && hm(p.starts) <= nowHM());
const attOf = pid => S.data.attendance.filter(a => a.patrol_id === pid);
const myId = () => S.me && S.me.id;
const sortPatrols = list => list.slice().sort((a, b) => (a.day + a.starts).localeCompare(b.day + b.starts));
function upcomingPatrols() { const t = today(), now = nowHM(); return sortPatrols(S.data.patrols.filter(p => p.day > t || (p.day === t && hm(p.ends) > now))); }
export function nextPatrolDay() { const up = upcomingPatrols(); return up.length ? { day: up[0].day, list: up.filter(p => p.day === up[0].day) } : null; }
function dayWord(d) { const k = daysBetween(today(), d); return k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : weekday(d) + ' ' + parseISO(d).getDate(); }
const whoChip = (uid, cls = '') => '<span class="who ' + cls + (uid === myId() ? ' me' : '') + '">' + esc(firstName(uid)) + (uid === myId() ? ' (you)' : '') + '</span>';
const sectorLine = sid => { const s = sectorById(sid); return '<b style="font-size:18px">' + esc(s ? s.name : '?') + '</b> <span class="muted">· ' + esc(regionById(s?.region_id)?.name || '') + '</span>'; };

function attendanceBlock(p) {
  const me = myId(), admin = isAdmin(), recs = attOf(p.id);
  const people = [...new Set([...p.team, ...recs.map(r => r.user_id)])];
  let h = '<div class="att"><div class="eyebrow">Attendance</div><div class="team">' + people.map(u => {
    const r = recs.find(x => x.user_id === u), a = r ? ATT[r.status] : null;
    const extra = !r ? ' · not logged' : r.status === 'pending' ? ' · waiting' : r.status === 'declined' ? ' · not approved' : '';
    return '<span class="who ' + (a ? a.cls : 'att-none') + '">' + (a ? ico(a.ico, 'sm') : '') + esc(firstName(u)) + (u === me ? ' (you)' : '') + extra + '</span>';
  }).join('') + '</div>';
  const mine = recs.find(r => r.user_id === me);
  if (!mine) {
    if (p.team.includes(me)) h += '<div><button class="btn small" data-a="att-log" data-id="' + p.id + '">' + ico('check', 'sm') + 'I was on duty</button></div>';
    else if (daysBetween(p.day, today()) <= 7) h += '<div><button class="btn small ghost" data-a="att-log" data-id="' + p.id + '">' + ico('plus', 'sm') + 'I joined this patrol too</button></div>';
  } else if (mine.status === 'pending' && !admin) {
    h += '<div class="row" style="gap:8px"><span class="hint">Your attendance is waiting for an admin.</span><button class="btn small ghost" data-a="att-withdraw" data-id="' + mine.id + '">Take back</button></div>';
  }
  if (admin) {
    recs.filter(r => r.status === 'pending').forEach(r => { h += '<div class="att-row"><span><b>' + esc(personName(r.user_id)) + '</b> says they were on duty' + (p.team.includes(r.user_id) ? '' : ' (not on the planned team)') + '</span><span class="row" style="gap:8px"><button class="btn small" data-a="att-decline" data-id="' + r.id + '">Decline</button><button class="btn small primary" data-a="att-approve" data-id="' + r.id + '">Approve</button></span></div>'; });
    p.team.filter(u => u !== me && !recs.some(r => r.user_id === u)).forEach(u => { h += '<div class="att-row"><span><b>' + esc(personName(u)) + '</b> has not logged it</span><button class="btn small ghost" data-a="att-mark" data-id="' + p.id + '" data-u="' + u + '">Mark present</button></div>'; });
  }
  return h + '</div>';
}
function patrolRow(p) {
  const d = parseISO(p.day);
  return '<div class="patrol" id="patrol-' + p.id + '"><div class="pdate"><span>' + weekday(p.day) + '</span><b>' + d.getDate() + '</b><span>' + monthShort(p.day) + '</span></div>' +
    '<div class="stack" style="gap:8px;min-width:0"><div class="spread" style="align-items:flex-start"><div>' + sectorLine(p.sector_id) + '</div>' + (isAdmin() ? '<button class="btn small ghost" data-a="patrol-form" data-id="' + p.id + '">Edit</button>' : '') + '</div>' +
    '<div class="row" style="gap:8px"><span class="ptime">' + hm(p.starts) + ' → ' + hm(p.ends) + '</span><span class="hint">estimated start and finish</span>' + (isHot(p) ? '<span class="chip lv-low">' + ico('sun', 'sm') + 'Hot hours</span>' : '') + '</div>' +
    (patrolStarted(p) ? attendanceBlock(p) : '<div class="team">' + p.team.map(u => whoChip(u)).join('') + '</div>') +
    (p.notes ? '<div class="hint" style="color:var(--ink)">' + esc(p.notes) + '</div>' : '') + '</div></div>';
}
function renderPatrols() {
  const ps = sortPatrols(S.data.patrols), t = today(), admin = isAdmin();
  let h = '<div class="page"><div class="page-head"><div><div class="eyebrow">Season ' + S.year + '</div><h2>Patrols</h2></div>' + (admin ? '<button class="btn primary" data-a="patrol-form">' + ico('plus', 'sm') + 'New patrol</button>' : '') + '</div>';
  if (isCurrentSeason()) {
    const days = []; for (let i = -1; i < 13; i++) days.push(addDays(t, i));
    h += '<div class="days" role="group" aria-label="Pick a day"><button class="day all" data-a="patrol-day" data-id="" aria-pressed="' + (!S.patrolDay) + '">All<br>upcoming</button>' + days.map(d => {
      const has = ps.some(p => p.day === d);
      return '<button class="day' + (d === t ? ' today' : '') + '" data-a="patrol-day" data-id="' + d + '" aria-pressed="' + (S.patrolDay === d) + '" style="position:relative"><span>' + (d === t ? 'Today' : weekday(d)) + '</span><b>' + parseISO(d).getDate() + '</b><span>' + monthShort(d) + '</span>' + (has ? '<span class="pdot" aria-label="has patrols"></span>' : '') + '</button>';
    }).join('') + '</div>';
    const shown = S.patrolDay ? ps.filter(p => p.day === S.patrolDay) : ps.filter(p => p.day >= t);
    const past = ps.filter(p => p.day < t);
    h += shown.length ? '<div class="list">' + shown.map(patrolRow).join('') + '</div>'
      : '<div class="card empty"><h3>No patrols ' + (S.patrolDay ? 'on ' + fmt(S.patrolDay) : 'coming up') + '</h3>' + (admin ? '<p style="margin:0">Use New patrol to plan one.</p>' : '') + '</div>';
    if (!S.patrolDay && past.length) h += '<details class="list"' + (S.pastOpen ? ' open' : '') + ' id="pastPatrols"><summary class="list-sub" style="cursor:pointer">Past patrols this season <span class="muted">' + past.length + '</span></summary>' + past.reverse().map(patrolRow).join('') + '</details>';
  } else {
    h += ps.length ? '<div class="list">' + ps.map(patrolRow).join('') + '</div>' : '<div class="card empty"><h3>No patrols logged for ' + S.year + '</h3>' + (admin ? '<p style="margin:0">Past patrols can be typed in with New patrol.</p>' : '') + '</div>';
  }
  const [a, b] = heat();
  h += '<p class="hint row" style="margin:0;gap:6px">' + ico('sun', 'sm') + 'Patrols between ' + a + ' and ' + b + ' are marked as hot hours.</p>';
  $('#view-patrols').innerHTML = h + '</div>';
  const det = $('#pastPatrols'); if (det) det.addEventListener('toggle', () => { S.pastOpen = det.open; });
}

SHEETS.patrolForm = sh => {
  const p = sh.id ? findPatrol(sh.id) : null;
  if (sh.id && !p) return null;
  const firstSector = S.base.sectors[0];
  const v = p ? { day: p.day, sector_id: p.sector_id, starts: hm(p.starts), ends: hm(p.ends), team: p.team, notes: p.notes }
    : { day: isCurrentSeason() ? addDays(today(), 1) : S.year + '-07-01', sector_id: firstSector?.id, starts: '06:00', ends: '08:00', team: [], notes: '' };
  const people = S.base.people.slice().sort((a, b) => (a.name || a.nickname).localeCompare(b.name || b.nickname));
  const att = p ? attOf(p.id).length : 0;
  let h = '<h2 style="font-size:28px">' + (p ? 'Edit patrol' : 'New patrol') + '</h2><form id="patForm" class="stack" novalidate>' +
    '<div class="two narrow-stack"><label class="field"><span>Date</span><input class="input" id="pf-date" type="date" value="' + v.day + '"></label>' +
    '<label class="field"><span>Beach sector</span><select class="input" id="pf-sec">' + sectorOptions(v.sector_id) + '</select></label></div>' +
    '<div class="two"><label class="field"><span>Estimated start</span><input class="input" id="pf-start" type="time" value="' + v.starts + '"></label><label class="field"><span>Estimated finish</span><input class="input" id="pf-end" type="time" value="' + v.ends + '"></label></div>' +
    '<div class="field"><span>Team <span class="muted" id="pf-count">(' + v.team.length + ' chosen)</span></span>' +
    (people.length > 10 ? '<input class="input" id="pf-find" placeholder="Find a person" autocomplete="off" style="margin-bottom:8px">' : '') +
    '<div class="checks" id="pf-team">' + people.map(u => '<label class="check" data-name="' + esc((u.name + ' ' + u.nickname).toLowerCase()) + '"><input type="checkbox" name="pf-team" value="' + u.id + '"' + (v.team.includes(u.id) ? ' checked' : '') + '>' + esc(u.name || u.nickname) + (u.name && u.name !== u.nickname ? ' <span class="muted" style="font-weight:400">@' + esc(u.nickname) + '</span>' : '') + '</label>').join('') + '</div></div>' +
    '<label class="field"><span>Notes for the team</span><textarea class="input" id="pf-notes" placeholder="What to bring, which nests to check">' + esc(v.notes) + '</textarea></label>' +
    '<div class="err" id="pf-err" role="alert"></div><div class="row">' + (p ? '<button type="button" class="btn danger" data-a="patrol-delete" data-id="' + p.id + '" data-att="' + att + '">Delete</button>' : '') + '<button type="button" class="btn ghost" data-a="close-sheet">Cancel</button><button class="btn primary" type="submit" id="pf-go">Save patrol</button></div></form>';
  return { title: 'Patrol · season ' + S.year, html: h, after() {
    const count = () => { $('#pf-count').textContent = '(' + $$('input[name="pf-team"]:checked').length + ' chosen)'; };
    $('#pf-team').addEventListener('change', count);
    const find = $('#pf-find');
    if (find) find.addEventListener('input', () => { const q = find.value.trim().toLowerCase(); $$('#pf-team .check').forEach(l => { l.hidden = !!q && !l.dataset.name.includes(q); }); });
    $('#patForm').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('#pf-err');
      const day = $('#pf-date').value, sector_id = +$('#pf-sec').value, starts = $('#pf-start').value, ends = $('#pf-end').value, notes = $('#pf-notes').value.trim();
      const team = $$('input[name="pf-team"]:checked').map(x => x.value);
      if (!day || +day.slice(0, 4) !== S.year) { err.textContent = 'Pick a date in the ' + S.year + ' season. For another year, switch the Season button first.'; return; }
      if (!sector_id) { err.textContent = 'Pick a beach sector.'; return; }
      if (!starts || !ends || ends <= starts) { err.textContent = 'The estimated finish must be later than the start.'; return; }
      if (!team.length) { err.textContent = 'Add at least one person to the team.'; return; }
      $('#pf-go').disabled = true; busy(true);
      try {
        await api.savePatrol({ id: p?.id, season: S.year, sector_id, day, starts, ends, notes, team });
        await loadSeason();
        closeAllSheets();
        const [a, b] = heat();
        toast('Patrol saved' + (starts < b && ends > a ? '. Note: it falls in hot hours.' : ''));
        renderAll();
      } catch (ex) { err.textContent = friendly(ex); $('#pf-go').disabled = false; }
      finally { busy(false); }
    });
  } };
};

/* The map's Patrol button: the next planned patrol day, one tap away. */
export function renderPatrolButton() {
  const btn = $('#patrolBtn'), pop = $('#patrolPop');
  const show = M.mode === 'view' && !M.focus;
  btn.hidden = !show;
  if (!show) { pop.hidden = true; return; }
  const next = nextPatrolDay(), me = myId();
  btn.innerHTML = ico('cal', 'sm') + 'Patrol' + (next ? ' <small>' + esc(dayWord(next.day)) + '</small>' : '');
  btn.setAttribute('aria-expanded', M.patrolOpen);
  pop.hidden = !M.patrolOpen;
  if (!M.patrolOpen) return;
  let h = '<div class="spread"><div class="eyebrow">Next patrol</div><button class="icon-btn" data-a="toggle-patrol" aria-label="Close" style="width:32px;height:32px">' + ico('x', 'sm') + '</button></div>';
  if (!next) {
    h += '<p style="margin:0">No patrols planned' + (isCurrentSeason() ? '' : ' for ' + S.year) + '.</p>' + (isAdmin() ? '<button class="btn small primary" data-a="patrol-form">' + ico('plus', 'sm') + 'Plan a patrol</button>' : '');
  } else {
    h += '<div><div class="day-big">' + esc(dayWord(next.day)) + '</div><div class="hint">' + longDate(next.day) + '</div></div>';
    next.list.forEach(p => {
      const s = sectorById(p.sector_id);
      h += '<div class="pp"><div><b style="font-size:17px">' + esc(s?.name || '') + '</b> <span class="muted">· ' + esc(regionById(s?.region_id)?.name || '') + '</span></div>' +
        '<div class="row" style="gap:8px"><span class="ptime">' + hm(p.starts) + ' → ' + hm(p.ends) + '</span><span class="hint">estimated</span>' + (isHot(p) ? '<span class="chip lv-low">' + ico('sun', 'sm') + 'Hot hours</span>' : '') + '</div>' +
        '<div class="team">' + p.team.map(u => whoChip(u)).join('') + '</div>' + (p.notes ? '<div style="font-size:14px">' + esc(p.notes) + '</div>' : '') + '</div>';
    });
    h += '<button class="btn small" data-a="go-patrols" data-id="' + next.day + '">See all patrols</button>';
  }
  pop.innerHTML = h;
}

/* =====================================================================
   Alerts
   ===================================================================== */
export function alerts() {
  if (!S.me) return [];
  const out = [], soon = S.base.settings.soon_days || 7, admin = isAdmin(), me = myId(), t = today();
  const add = (group, level, title, sub, target) => out.push({ group, level, title, sub, target });
  S.data.nests.forEach(n => {
    const s = sectorById(n.sector_id), where = '#' + n.number + ' · ' + (s ? s.name : '');
    if (n.status === 'hatched' && !hasResults(n)) add('now', 'crit', 'Nest ' + where + ' has hatched', admin ? 'Needs attention as soon as possible: excavate and record the hatching results.' : 'Needs attention as soon as possible. An admin records the hatching results.', { t: 'nest', id: n.id });
    if (n.status === 'notprot') add('now', 'crit', 'Nest ' + where + ' is not protected', 'Bring a ' + [!n.has_cage && 'cage', !n.has_pyramid && 'pyramid'].filter(Boolean).join(' and ') + ' on the next patrol to ' + (s ? s.name : 'this beach') + '.', { t: 'nest', id: n.id });
    if (ACTIVE.includes(n.status)) {
      const d = daysBetween(t, n.expected_hatch);
      if (d < 0) add('now', 'warn', 'Nest ' + where + ' is past its expected hatching date', plural(-d, 'day') + ' overdue (expected ' + fmt(n.expected_hatch) + '). Check the nest for signs of hatching.', { t: 'nest', id: n.id });
      else if (d <= soon) add('soon', d <= 2 ? 'warn' : 'info', 'Nest ' + where + (d === 0 ? ' may hatch today' : d === 1 ? ' may hatch tomorrow' : ' may hatch in ' + d + ' days'), 'Expected ' + fmt(n.expected_hatch) + ' · ' + SPECIES[n.species], { t: 'nest', id: n.id });
    }
  });
  if (!hasGearData()) {
    if (isCurrentSeason() || S.year > new Date().getFullYear())
      add('gear', 'info', 'No equipment counts for ' + S.year + ' yet', admin ? 'Open Gear to copy last season\'s cage and pyramid counts, or type them in.' : 'An admin will add the cage and pyramid counts before the season.', { t: 'view', id: 'gear' });
  } else {
    S.base.sectors.forEach(s => {
      const g = gearInfo(s.id);
      if (g.level === 'short') add('gear', 'crit', s.name + ' is short of gear', 'Needs ' + [g.shortC && plural(g.shortC, 'cage'), g.shortP && plural(g.shortP, 'pyramid')].filter(Boolean).join(' and ') + ' for nests already found. ' + suggestText(s.id, g), { t: 'sector', id: s.id });
      else if (g.level === 'low') add('gear', 'warn', s.name + ' stock is below its usual need', 'Has ' + g.st.c + ' cages and ' + g.st.p + ' pyramids; this beach usually needs ' + s.usual_cages + ' and ' + s.usual_pyramids + '. ' + suggestText(s.id, g), { t: 'sector', id: s.id });
    });
  }
  sortPatrols(S.data.patrols.filter(p => { const d = daysBetween(t, p.day); return d >= 0 && d <= 7; })).forEach(p => {
    const mine = p.team.includes(me), s = sectorById(p.sector_id);
    add('patrol', 'info', (mine ? 'Your patrol: ' : 'Patrol: ') + (s ? s.name : '') + ', ' + weekday(p.day) + ' ' + fmt(p.day), hm(p.starts) + '–' + hm(p.ends) + ' (estimated) · ' + p.team.map(firstName).join(', '), { t: 'patrol', id: p.id });
  });
  S.data.patrols.filter(p => p.team.includes(me) && patrolStarted(p) && daysBetween(p.day, t) <= 7 && !attOf(p.id).some(a => a.user_id === me))
    .forEach(p => add('duty', 'info', 'Log your attendance: ' + (sectorById(p.sector_id)?.name || '') + ', ' + longDate(p.day), 'Open the patrol and tap "I was on duty" so an admin can approve it.', { t: 'patrol', id: p.id }));
  if (admin) {
    const pend = S.data.attendance.filter(a => a.status === 'pending').map(a => ({ a, p: findPatrol(a.patrol_id) })).filter(x => x.p);
    if (pend.length) add('admin', 'warn', plural(pend.length, 'attendance record') + ' to approve', pend.slice(0, 3).map(({ a, p }) => firstName(a.user_id) + ', ' + (sectorById(p.sector_id)?.name || '') + ' ' + fmt(p.day)).join('; ') + (pend.length > 3 ? '; and more' : '') + '. Approve them in Control or on the patrol.', { t: 'view', id: 'control' });
    S.base.people.filter(u => u.admin_request === 'pending').forEach(u => add('admin', 'info', (u.name || u.nickname) + ' asked for admin access', 'Approve or decline in Control → Admin requests.', { t: 'view', id: 'control' }));
  }
  return out;
}
export const urgentCount = () => alerts().filter(a => a.level !== 'info').length;
function renderAlerts() {
  const A = alerts(), soon = S.base.settings.soon_days || 7;
  const G = [['now', 'Needs attention now'], ['soon', 'Hatching within ' + soon + ' days'], ['gear', 'Gear'], ['patrol', 'Patrols in the next 7 days'], ['duty', 'Your attendance'], ['admin', 'Waiting for your approval']];
  let h = '<div class="page"><div class="page-head"><div><div class="eyebrow">Season ' + S.year + '</div><h2>Alerts</h2></div></div>';
  if (!A.length) h += '<div class="card empty"><h3>All clear for ' + S.year + '</h3><p style="margin:0">Nothing needs attention right now.</p></div>';
  G.forEach(([k, title]) => {
    const items = A.filter(a => a.group === k); if (!items.length) return;
    h += '<div class="group-h"><h3>' + title + '</h3><span class="muted">' + items.length + '</span></div><div class="list">' +
      items.map(a => '<button class="alert ' + a.level + '" data-a="alert-open" data-t="' + a.target.t + '" data-id="' + a.target.id + '"><span class="stripe"></span><span><b>' + esc(a.title) + '</b><small>' + esc(a.sub) + '</small></span>' + ico('right', 'sm') + '</button>').join('') + '</div>';
  });
  $('#view-alerts').innerHTML = h + '</div>';
}

/* =====================================================================
   Team and profiles
   ===================================================================== */
const userAttendance = uid => S.data.attendance.filter(a => a.user_id === uid);
function teamCard(u) {
  const me = u.id === myId(), ok = userAttendance(u.id).filter(a => a.status === 'approved').length;
  return '<button class="tcard" data-a="open-profile" data-id="' + u.id + '">' + avatar(u, 76) + '<span class="tname">' + esc(u.name || u.nickname) + '</span><span class="tpos">' + esc(u.position || 'Team member') + '</span>' +
    (u.status ? '<span class="tstatus">' + esc(u.status) + '</span>' : '') +
    '<span class="tfoot">' + (u.role === 'admin' ? '<span class="chip st-prot">Admin</span>' : '') + (me ? '<span class="chip">You</span>' : '') + '<span class="hint num">' + plural(ok, 'duty', 'duties') + ' in ' + S.year + '</span></span></button>';
}
function renderTeam() {
  const users = S.base.people.slice().sort((a, b) => (a.role === 'admin' ? 0 : 1) - (b.role === 'admin' ? 0 : 1) || (a.name || a.nickname).localeCompare(b.name || b.nickname));
  let h = '<div class="page"><div class="page-head"><div><div class="eyebrow">Sea turtle patrol</div><h2>Meet the team</h2></div><button class="btn" data-a="edit-profile">' + ico('edit', 'sm') + 'Edit my profile</button></div>';
  h += '<p class="hint" style="margin:0">' + plural(users.length, 'person', 'people') + ' · ' + plural(users.filter(u => u.role === 'admin').length, 'admin') + '. Tap someone to see their profile and duty days in ' + S.year + '.</p>';
  $('#view-team').innerHTML = h + '<div class="team-grid">' + users.map(teamCard).join('') + '</div></div>';
  hydratePhotos($('#view-team'));
}
SHEETS.profile = sh => {
  const u = person(sh.id); if (!u) return null;
  const me = u.id === myId();
  const recs = userAttendance(u.id).map(a => ({ a, p: findPatrol(a.patrol_id) })).filter(x => x.p).sort((x, y) => (y.p.day + y.p.starts).localeCompare(x.p.day + x.p.starts));
  const ok = recs.filter(x => x.a.status === 'approved').length, wait = recs.filter(x => x.a.status === 'pending').length;
  let h = '<div class="profile-head">' + avatar(u, 104) + '<div class="stack" style="gap:4px;min-width:0"><h2 style="font-size:30px">' + esc(u.name || u.nickname) + '</h2><div class="hint">@' + esc(u.nickname) + (u.position ? ' · ' + esc(u.position) : '') + '</div>' +
    '<div class="row" style="gap:6px">' + (u.role === 'admin' ? '<span class="chip st-prot">Admin</span>' : '<span class="chip">Member</span>') + '<span class="hint">In the team since ' + u.since + '</span></div></div></div>';
  if (u.status) h += '<div class="status-line">' + ico('pin', 'sm') + '<span>' + esc(u.status) + '</span></div>';
  if (u.about) h += '<p style="margin:0;max-width:60ch;white-space:pre-line">' + esc(u.about) + '</p>';
  if (me) h += '<div class="row"><button class="btn primary" data-a="edit-profile">' + ico('edit', 'sm') + 'Edit my profile</button></div>';
  h += '<div class="card stack"><div class="section-h"><h3>Attendance · ' + S.year + '</h3></div>' +
    '<div class="row" style="gap:28px"><div class="result-big"><b>' + ok + '</b><span class="muted">' + (ok === 1 ? 'duty' : 'duties') + ' approved</span></div>' + (wait ? '<div class="result-big"><b style="font-size:28px;color:var(--warn)">' + wait + '</b><span class="muted">waiting for approval</span></div>' : '') + '</div>';
  if (!recs.length) h += '<p class="hint" style="margin:0">No duty days logged in ' + S.year + ' yet.</p>';
  else {
    let month = '';
    h += '<div class="att-list">' + recs.map(({ a, p }) => {
      const m = monthYear(p.day), st = ATT[a.status];
      const head = m !== month ? '<div class="att-month">' + m + '</div>' : ''; month = m;
      return head + '<div class="att-item"><span class="mono">' + weekday(p.day) + ' ' + dayMonth(p.day) + '</span><span>' + esc(sectorById(p.sector_id)?.name || '') + ' <span class="hint">' + hm(p.starts) + '–' + hm(p.ends) + '</span></span><span class="chip ' + st.chip + '">' + ico(st.ico, 'sm') + st.label + '</span></div>';
    }).join('') + '</div>';
  }
  h += '</div>';
  return { title: me ? 'Your profile' : 'Team member', html: h };
};
SHEETS.editProfile = sh => {
  const u = S.me;
  if (!('photo' in sh)) { sh.photo = undefined; sh.removePhoto = false; }   // undefined = unchanged
  const preview = () => sh.photo ? '<img class="av" style="width:88px;height:88px" src="' + URL.createObjectURL(sh.photo) + '" alt="New photo">' : avatar(sh.removePhoto ? { ...u, photo_path: null } : u, 88);
  const hasPhoto = () => sh.photo || (!sh.removePhoto && u.photo_path);
  const h = '<h2 style="font-size:28px">Edit your profile</h2><form id="profForm" class="stack" novalidate>' +
    '<div class="row" style="gap:16px"><span id="pr-av">' + preview() + '</span><div class="stack" style="gap:8px"><label class="btn small file-btn">' + ico('cam', 'sm') + '<span id="pr-photo-label">' + (hasPhoto() ? 'Change photo' : 'Add a photo') + '</span><input type="file" accept="image/*" id="pr-photo" aria-label="Choose a profile photo"></label>' +
    '<button type="button" class="btn small ghost" id="pr-remove"' + (hasPhoto() ? '' : ' hidden') + '>Remove photo</button></div></div>' +
    '<label class="field"><span>Full name</span><input class="input" id="pr-name" maxlength="60" autocomplete="name" value="' + esc(u.name || '') + '"></label>' +
    '<label class="field"><span>Position in the team</span><input class="input" id="pr-pos" maxlength="60" placeholder="For example: Marine biology student" value="' + esc(u.position || '') + '"></label>' +
    '<label class="field"><span>Status</span><input class="input" id="pr-status" maxlength="80" placeholder="For example: Free for morning patrols this week" value="' + esc(u.status || '') + '"></label>' +
    '<label class="field"><span>About you</span><textarea class="input" id="pr-about" maxlength="400" placeholder="A few words for the team">' + esc(u.about || '') + '</textarea></label>' +
    '<p class="hint" style="margin:0">Everyone in the team can see your profile. Your email stays private.</p>' +
    '<div class="err" id="pr-err" role="alert"></div><div class="row"><button type="button" class="btn ghost" data-a="close-sheet">Cancel</button><button class="btn primary" type="submit" id="pr-go">Save profile</button></div></form>';
  return { title: 'Your profile', html: h, after() {
    const show = () => { $('#pr-av').innerHTML = preview(); hydratePhotos($('#pr-av')); $('#pr-remove').hidden = !hasPhoto(); $('#pr-photo-label').textContent = hasPhoto() ? 'Change photo' : 'Add a photo'; };
    $('#pr-photo').addEventListener('change', async e => { try { sh.photo = await resizePhoto(e.target.files[0], 600); sh.removePhoto = false; show(); } catch (ex) { toast(ex.message); } });
    $('#pr-remove').addEventListener('click', () => { sh.photo = undefined; sh.removePhoto = true; show(); });
    $('#profForm').addEventListener('submit', async e => {
      e.preventDefault();
      const name = $('#pr-name').value.trim(), err = $('#pr-err');
      if (!name) { err.textContent = 'Enter your name so the team knows who you are.'; return; }
      $('#pr-go').disabled = true; busy(true);
      try {
        const patch = { name, position: $('#pr-pos').value.trim(), status: $('#pr-status').value.trim(), about: $('#pr-about').value.trim() };
        const old = u.photo_path;
        if (sh.photo) patch.photo_path = await api.uploadPhoto('profiles/' + u.id, sh.photo);
        else if (sh.removePhoto) patch.photo_path = null;
        await api.updateProfile(u.id, patch);
        if ('photo_path' in patch && old) api.removePhoto(old).catch(() => {});
        await reloadBase();
        closeSheet(); toast('Profile saved'); renderAll();
      } catch (ex) { err.textContent = friendly(ex); $('#pr-go').disabled = false; }
      finally { busy(false); }
    });
  } };
};

/* =====================================================================
   Pages and buttons
   ===================================================================== */
VIEWS.gear = renderGear;
VIEWS.patrols = renderPatrols;
VIEWS.alerts = renderAlerts;
VIEWS.team = renderTeam;

function goView(view, then) {
  closeAllSheets(); S.view = view; M.patrolOpen = false; renderAll();
  const v = $('#view-' + view); if (v) v.scrollTop = 0;
  if (then) requestAnimationFrame(then);
}
const scrollToEl = id => { const el = document.getElementById(id); if (el) el.scrollIntoView({ block: 'center' }); };
async function attendanceAction(text, fn, done) {
  if (await work(text, async () => { await fn(); await loadSeason(); })) { if (done) toast(done); renderAll(); }
}

Object.assign(ACTIONS, {
  'toggle-level': el => { const id = +el.dataset.id; S.levelOpen[id] = !levelOpen(id, gearInfo(id).level); renderAll(); },
  'gear-step': el => {
    const sid = +el.dataset.id, t = el.dataset.t, d = +el.dataset.d, g = gearInfo(sid);
    setGearCount(sid, t, (t === 'c' ? g.st.c : g.st.p) + d);
  },
  'carry-gear': async el => {
    const to = +el.dataset.y, from = +el.dataset.from;
    if (await work('Copying…', async () => { await api.copyGear(from, to); await loadSeason(); })) {
      toast(hasGearData() ? 'Gear counts copied from ' + from : from + ' had no gear counts to copy. Type them in below.', 4500);
      renderAll();
    }
  },
  'move-gear': () => openSheet({ kind: 'moveGear' }),
  'patrol-day': el => { S.patrolDay = el.dataset.id || null; renderPatrols(); },
  'patrol-form': el => { M.patrolOpen = false; openSheet({ kind: 'patrolForm', id: el.dataset.id || null }); },
  'patrol-delete': el => {
    const p = findPatrol(el.dataset.id); if (!p) return;
    const n = +el.dataset.att;
    confirmSheet('Delete patrol', 'Delete the patrol at <b>' + esc(sectorById(p.sector_id)?.name || '') + '</b> on ' + longDate(p.day) + '?' + (n ? ' Its ' + plural(n, 'attendance record') + ' will be deleted too.' : ' The team will no longer see it.'), 'Delete patrol', true, async () => {
      if (await work('Deleting…', async () => { await api.deletePatrol(p.id); await loadSeason(); })) { closeAllSheets(); toast('Patrol deleted'); renderAll(); }
    });
  },
  'att-log': el => {
    const p = findPatrol(el.dataset.id); if (!p) return;
    attendanceAction('Sending…', () => isAdmin() ? api.markPresent(p.id, myId()) : api.logAttendance(p.id), isAdmin() ? 'Attendance recorded' : 'Sent. An admin will approve your attendance.');
  },
  'att-withdraw': el => attendanceAction('Taking back…', () => api.withdrawAttendance(el.dataset.id), 'Attendance taken back'),
  'att-approve': el => { const a = S.data.attendance.find(x => x.id === el.dataset.id); attendanceAction('Approving…', () => api.decideAttendance(el.dataset.id, 'approved'), a ? firstName(a.user_id) + ' approved' : 'Approved'); },
  'att-decline': el => { const a = S.data.attendance.find(x => x.id === el.dataset.id); attendanceAction('Saving…', () => api.decideAttendance(el.dataset.id, 'declined'), a ? firstName(a.user_id) + ' not approved' : 'Declined'); },
  'att-mark': el => attendanceAction('Saving…', () => api.markPresent(el.dataset.id, el.dataset.u), firstName(el.dataset.u) + ' marked present'),
  'toggle-patrol': () => { M.patrolOpen = !M.patrolOpen; if (M.patrolOpen) { S.legend = false; M.focus = null; } renderAll(); },
  'go-patrols': el => { S.patrolDay = el.dataset.id || null; goView('patrols'); },
  'alert-open': el => {
    const t = el.dataset.t, id = el.dataset.id;
    if (t === 'nest') { if (findNest(id)) openSheet({ kind: 'nest', id }); return; }
    if (t === 'sector') { S.levelOpen[+id] = true; goView('gear', () => scrollToEl('gear-' + id)); return; }
    if (t === 'patrol') { const p = findPatrol(id); S.patrolDay = p && isCurrentSeason() ? p.day : null; goView('patrols', () => scrollToEl('patrol-' + id)); return; }
    if (t === 'view') goView(id);
  },
  'open-profile': el => openSheet({ kind: 'profile', id: el.dataset.id }),
  'edit-profile': () => openSheet({ kind: 'editProfile' }),
});
