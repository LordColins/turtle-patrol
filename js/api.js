// Everything that talks to Supabase lives in this file.
// If the project ever moves to another server, this is the file to rewrite.
import { CONFIG } from './config.js';
import { newId } from './util.js';

export const sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});

const PROFILE_COLS = 'id,nickname,name,position,status,about,photo_path,role,admin_request,since,created_at';

// Turns database and network errors into sentences people can act on.
export function friendly(err, fallback = 'Something went wrong. Try again.') {
  if (!err) return fallback;
  const msg = String(err.message || err.msg || err.error_description || err || '');
  const code = String(err.code || '');
  if (/failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(msg))
    return 'No connection to the database. Check your signal and try again. If it keeps happening, the database may be paused: an admin can restore it in the Supabase dashboard.';
  if (code === 'P0001') return msg;                       // our own messages from the database
  if (code === 'PGRST202') return 'The database needs an update: an admin should run database/03_part2.sql in Supabase → SQL Editor.';
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) return 'You don\'t have permission to do that.';
  if (code === '23505') return 'That already exists.';
  if (code === '23514' || code === '22P02' || code === '22007') return 'Some values are not allowed. Check the form and try again.';
  if (/jwt expired|invalid jwt|refresh token/i.test(msg)) return 'Your sign-in has expired. Sign in again.';
  return msg || fallback;
}
const must = ({ data, error }) => { if (error) throw error; return data; };
// Part-2 database functions may be missing if 03_part2.sql has not been run yet: load the rest anyway.
let partMissing = false;
const soft = r => { if (r.error && r.error.code === 'PGRST202') { partMissing = true; return []; } return must(r); };

export const api = {
  /* ---------- sign-in ---------- */
  async session() { return (await sb.auth.getSession()).data.session; },
  onAuth(cb) { return sb.auth.onAuthStateChange((event, session) => cb(event, session)); },
  async nicknameFree(nick) { return must(await sb.rpc('nickname_available', { p_nick: nick })); },
  async signUp({ nickname, email, password }) {
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { nickname }, emailRedirectTo: location.origin + location.pathname },
    });
    if (error) {
      if (/already registered|already exists/i.test(error.message)) throw new Error('An account already uses that email. Sign in, or reset your password.');
      if (/database error/i.test(error.message)) throw new Error('That nickname could not be saved. Use 3 to 20 letters, numbers, dots, dashes or underscores.');
      if (/password/i.test(error.message)) throw new Error('Choose a longer password: at least 8 characters.');
      throw error;
    }
    return data;   // data.session is empty when email confirmation is switched on
  },
  async signIn(nickname, password) {
    const email = must(await sb.rpc('login_email', { p_nick: nickname, p_password: password }));
    if (!email) throw new Error('Wrong nickname or password.');
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      if (/not confirmed/i.test(error.message)) throw new Error('Confirm your email first: open the link we sent you, then sign in.');
      throw error;
    }
  },
  async signOut() { await sb.auth.signOut(); },
  async sendReset(email) { must(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })); },
  async setPassword(password) { must(await sb.auth.updateUser({ password })); },
  async me(uid) { return must(await sb.from('profiles').select(PROFILE_COLS).eq('id', uid).single()); },
  async requestAdmin() { must(await sb.rpc('request_admin')); },

  /* ---------- places, seasons, people ---------- */
  async loadBase() {
    const [regions, sectors, seasons, settings, people] = await Promise.all([
      sb.from('regions').select('*').order('name'),
      sb.from('sectors').select('*').order('name'),
      sb.from('seasons').select('*').order('year'),
      sb.from('settings').select('*').eq('id', 1).single(),
      sb.from('profiles').select(PROFILE_COLS).order('nickname'),
    ]);
    return { regions: must(regions), sectors: must(sectors), seasons: must(seasons), settings: must(settings), people: must(people) };
  },
  async addSeason(year) { must(await sb.from('seasons').insert({ year })); },
  async addSector(s) { return must(await sb.from('sectors').insert(s).select().single()); },
  async updateSector(id, patch) { return must(await sb.from('sectors').update(patch).eq('id', id).select().single()); },
  async deleteSector(id) { must(await sb.from('sectors').delete().eq('id', id)); },

  /* ---------- one season's records ---------- */
  async loadSeason(year, admin) {
    partMissing = false;
    const shared = Promise.all([
      sb.from('gear_stock').select('*').eq('season', year),
      sb.rpc('get_patrols', { p_season: year }),
      sb.rpc('get_attendance', { p_season: year }),
    ]);
    if (!admin) {
      const [nests, [gear, patrols, attendance]] = await Promise.all([sb.rpc('get_nests', { p_season: year }), shared]);
      return { nests: must(nests), results: [], visits: [], removed: [], gear: must(gear), patrols: soft(patrols), attendance: soft(attendance), setupMissing: partMissing };
    }
    const [nests, results, visits, [gear, patrols, attendance]] = await Promise.all([
      sb.from('nests').select('*').eq('season', year).order('sector_id').order('number'),
      sb.from('nest_results').select('*'),
      sb.from('visits').select('*').eq('season', year).order('seen_on', { ascending: false }),
      shared,
    ]);
    const all = must(nests);
    return { nests: all.filter(n => !n.archived), removed: all.filter(n => n.archived), results: must(results), visits: must(visits),
      gear: must(gear), patrols: soft(patrols), attendance: soft(attendance), setupMissing: partMissing };
  },

  /* ---------- nests ---------- */
  // Members may add nests but not read the table directly, so only admins get the new row back.
  async addNest(nest, admin) {
    if (admin) return must(await sb.from('nests').insert(nest).select().single());
    must(await sb.from('nests').insert(nest)); return null;
  },
  async updateNest(id, patch) { return must(await sb.from('nests').update(patch).eq('id', id).select().single()); },
  async setNestPhoto(id, path) { must(await sb.rpc('set_nest_photo', { p_nest: id, p_path: path })); },
  async saveResults(nestId, r) { return must(await sb.from('nest_results').upsert({ nest_id: nestId, ...r }, { onConflict: 'nest_id' }).select().single()); },
  async history(rowId) {
    return must(await sb.from('history').select('at,user_id,action,table_name,changes').in('table_name', ['nests', 'nest_results', 'visits'])
      .eq('row_id', rowId).order('at', { ascending: false }).limit(15));
  },

  /* ---------- visits ---------- */
  async addVisit(v, admin) {
    if (admin) return must(await sb.from('visits').insert(v).select().single());
    must(await sb.from('visits').insert(v)); return null;
  },
  async updateVisit(id, patch) { return must(await sb.from('visits').update(patch).eq('id', id).select().single()); },
  async deleteVisit(id) { must(await sb.from('visits').delete().eq('id', id)); },

  /* ---------- gear ---------- */
  async setGear(season, sectorId, cages, pyramids) {
    must(await sb.from('gear_stock').upsert({ season, sector_id: sectorId, cages, pyramids }, { onConflict: 'season,sector_id' }));
  },
  async copyGear(from, to) { must(await sb.rpc('copy_gear', { p_from: from, p_to: to })); },
  async moveGear({ season, from, to, kind, count, protect }) {
    return must(await sb.rpc('move_gear', { p_season: season, p_from: from, p_to: to, p_kind: kind, p_count: count, p_protect: !!protect }));
  },

  /* ---------- patrols and attendance ---------- */
  async savePatrol(p) {
    return must(await sb.rpc('save_patrol', { p_id: p.id || null, p_season: p.season, p_sector: p.sector_id, p_day: p.day,
      p_starts: p.starts, p_ends: p.ends, p_notes: p.notes || '', p_team: p.team }));
  },
  async deletePatrol(id) { must(await sb.from('patrols').delete().eq('id', id)); },
  async logAttendance(patrolId) { must(await sb.from('attendance').insert({ patrol_id: patrolId })); },
  async withdrawAttendance(id) { must(await sb.from('attendance').delete().eq('id', id)); },
  async decideAttendance(id, status) { must(await sb.from('attendance').update({ status }).eq('id', id)); },
  async markPresent(patrolId, userId) { must(await sb.from('attendance').insert({ patrol_id: patrolId, user_id: userId, status: 'approved' })); },

  /* ---------- people ---------- */
  async updateProfile(uid, patch) { must(await sb.from('profiles').update(patch).eq('id', uid)); },
  async removePhoto(path) { if (path) await sb.storage.from('photos').remove([path]); },
  async adminMembers() { return must(await sb.rpc('admin_members')); },
  async setRole(uid, role) { must(await sb.rpc('set_role', { p_user: uid, p_role: role })); },
  async declineAdmin(uid) { must(await sb.rpc('decline_admin_request', { p_user: uid })); },

  /* ---------- control panel ---------- */
  async seasonSummary() { return must(await sb.rpc('season_summary')); },
  async addRegion(r) { must(await sb.from('regions').insert(r)); },
  async updateRegion(id, patch) { must(await sb.from('regions').update(patch).eq('id', id)); },
  async deleteRegion(id) { must(await sb.from('regions').delete().eq('id', id)); },
  async saveSettings(patch) { must(await sb.from('settings').update(patch).eq('id', 1)); },
  async historyPage(offset, limit) {
    return must(await sb.from('history').select('id,at,user_id,season,action,table_name,row_id,changes')
      .order('at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1));
  },
  async nestsByIds(ids) { return ids.length ? must(await sb.from('nests').select('id,season,sector_id,number,found_on').in('id', ids)) : []; },
  async attendanceByIds(ids) { return ids.length ? must(await sb.from('attendance').select('id,patrol_id,user_id,status').in('id', ids)) : []; },
  async patrolsByIds(ids) { return ids.length ? must(await sb.from('patrols').select('id,season,sector_id,day,starts').in('id', ids)) : []; },
  // Everything about one season, for the Excel export (admins).
  async exportSeason(year) {
    const [nests, results, visits, gear, patrols, attendance] = await Promise.all([
      sb.from('nests').select('*').eq('season', year).order('sector_id').order('number'),
      sb.from('nest_results').select('*'),
      sb.from('visits').select('*').eq('season', year).order('seen_on'),
      sb.from('gear_stock').select('*').eq('season', year),
      sb.rpc('get_patrols', { p_season: year }),
      sb.rpc('get_attendance', { p_season: year }),
    ]);
    return { nests: must(nests), results: must(results), visits: must(visits), gear: must(gear), patrols: must(patrols), attendance: must(attendance) };
  },

  /* ---------- photos (private store, shown through links that expire after an hour) ---------- */
  async uploadPhoto(folder, blob) {
    const path = folder + '/' + newId() + '.jpg';
    must(await sb.storage.from('photos').upload(path, await blob.arrayBuffer(), { contentType: 'image/jpeg', upsert: false }));
    return path;
  },
  _urls: new Map(),
  async photoUrls(paths) {
    const now = Date.now(), want = [...new Set(paths.filter(Boolean))].filter(p => !(this._urls.get(p)?.exp > now + 60000));
    if (want.length) {
      const { data, error } = await sb.storage.from('photos').createSignedUrls(want, 3600);
      if (!error) data.forEach(d => { if (d.signedUrl && !d.error) this._urls.set(d.path, { url: d.signedUrl, exp: now + 3600 * 1000 }); });
    }
    const out = {}; paths.forEach(p => { const c = this._urls.get(p); if (c) out[p] = c.url; }); return out;
  },
};
