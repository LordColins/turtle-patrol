-- =====================================================================
--  Turtle Patrol: database setup
--  Run ONCE on a new, empty Supabase project:
--  Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
--
--  What it creates
--    • people (profiles), regions, beach sectors, seasons, settings
--    • nests, hatching results, visits (came ashore, no nest)
--    • gear stock, patrols, patrol teams, attendance
--    • change history, sensor tables (empty, for later)
--    • security rules: who can see and change what (admins vs members)
--    • a private photo store
--    • starting data: 3 regions, 4 sectors, seasons 2025–2027
--
--  Permission summary (enforced by the database, not just the app)
--    Signed-out visitors: nothing, except checking if a nickname is free.
--    Members: read places, gear, patrols, attendance, team profiles;
--             read nests through get_nests() (no hatching results);
--             add nests and visits; add photos; edit their own profile;
--             log their own attendance (waits for approval).
--    Admins:  everything, including results, visits, history, roles.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Safety check: stop with a clear message if this project is not empty
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  found_tables text := '';
begin
  if to_regclass('public.nests') is not null and to_regclass('public.profiles') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'nickname') then
    raise exception 'GOOD NEWS: Turtle Patrol setup has already been run on this project, so nothing was changed. Go on to the next step.';
  end if;
  foreach t in array array['profiles', 'regions', 'sectors', 'seasons', 'settings', 'nests', 'nest_results', 'visits',
                           'gear_stock', 'patrols', 'patrol_team', 'attendance', 'history', 'sensors', 'sensor_readings'] loop
    if to_regclass('public.' || t) is not null then found_tables := found_tables || ' ' || t; end if;
  end loop;
  if found_tables <> '' or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                    where n.nspname = 'public' and p.proname = 'handle_new_user') then
    raise exception 'This project already has tables or a sign-up function with the same names (found:%), for example from a Supabase starter template. Run 00_reset_before_setup.sql first, then run this script again. Nothing was changed.',
      coalesce(nullif(found_tables, ''), ' handle_new_user');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. People
-- ---------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  nickname      text not null check (nickname ~ '^[A-Za-z0-9_.çğıöşüÇĞİÖŞÜ-]{3,20}$'),
  email         text not null,
  name          text not null default '' check (char_length(name) <= 60),
  position      text not null default '' check (char_length(position) <= 60),
  status        text not null default '' check (char_length(status) <= 80),
  about         text not null default '' check (char_length(about) <= 400),
  photo_path    text,
  role          text not null default 'member' check (role in ('member', 'admin')),
  admin_request text check (admin_request in ('pending')),
  since         smallint not null default extract(year from now())::smallint,
  created_at    timestamptz not null default now()
);
create unique index profiles_nickname_unique on public.profiles (lower(nickname));

-- True when the signed-in person is an admin. Used by the security rules.
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------------------------------------------------------------------
-- 2. Places, seasons, settings
-- ---------------------------------------------------------------------
create table public.regions (
  id    smallint generated always as identity primary key,
  name  text not null unique,
  code  text not null unique check (code ~ '^[A-ZÇĞİÖŞÜ]{2,4}$')
);

create table public.sectors (
  id             smallint generated always as identity primary key,
  region_id      smallint not null references public.regions(id),
  name           text not null unique,
  code           text not null unique check (code ~ '^[A-ZÇĞİÖŞÜ]{2,4}$'),
  usual_cages    smallint not null default 5 check (usual_cages >= 0),
  usual_pyramids smallint not null default 5 check (usual_pyramids >= 0),
  boundary       jsonb not null default '[]'::jsonb,   -- border as a list of [latitude, longitude] points
  created_at     timestamptz not null default now()
);

create table public.seasons (
  year       smallint primary key check (year between 2000 and 2100),
  created_at timestamptz not null default now()
);

create table public.settings (
  id                          smallint primary key default 1 check (id = 1),
  hatch_months                smallint not null default 2 check (hatch_months between 1 and 4),
  soon_days                   smallint not null default 7 check (soon_days between 1 and 21),
  heat_start                  time not null default '11:00',
  heat_end                    time not null default '16:00',
  -- true: members' map shows nests at their exact spot.
  -- false: members get positions rounded to about 100 m.
  members_see_exact_positions boolean not null default true,
  check (heat_end > heat_start)
);

-- ---------------------------------------------------------------------
-- 3. Nests, hatching results, visits
-- ---------------------------------------------------------------------
create table public.nests (
  id             uuid primary key default gen_random_uuid(),
  season         smallint not null references public.seasons(year),
  sector_id      smallint not null references public.sectors(id),
  number         smallint not null check (number >= 1),
  species        text not null check (species in ('cc', 'cm')),          -- cc = Caretta caretta, cm = Chelonia mydas
  found_on       date not null,
  expected_hatch date,                                                     -- filled automatically if left empty
  status         text not null default 'prot'
                 check (status in ('notprot', 'prot', 'hatching', 'hatched', 'predation')),
  has_cage       boolean not null default true,
  has_pyramid    boolean not null default true,
  lat            double precision not null check (lat between 34.45 and 35.75),
  lng            double precision not null check (lng between 32.2 and 34.65),
  notes          text not null default '',
  photo_path     text,
  archived       boolean not null default false,                           -- "removed" nests stay restorable
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (extract(year from found_on) = season),
  check (expected_hatch is null or expected_hatch >= found_on)
);
create unique index nests_number_unique on public.nests (season, sector_id, number) where not archived;
create index nests_season on public.nests (season);

create table public.nest_results (
  nest_id          uuid primary key references public.nests(id) on delete cascade,
  total_eggs       smallint not null check (total_eggs > 0),
  hatched          smallint not null check (hatched >= 0),
  unhatched        smallint not null check (unhatched >= 0),
  alive            smallint not null check (alive >= 0),
  dead             smallint not null check (dead >= 0),
  -- hatching success = hatched eggs ÷ total eggs × 100
  hatching_success numeric(5,1) generated always as (round(hatched * 100.0 / total_eggs, 1)) stored,
  recorded_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  recorded_at      timestamptz not null default now(),
  check (hatched + unhatched = total_eggs),
  check (alive + dead <= hatched)
);

create table public.visits (
  id         uuid primary key default gen_random_uuid(),
  season     smallint not null references public.seasons(year),
  sector_id  smallint not null references public.sectors(id),
  seen_on    date not null,
  kind       text not null check (kind in ('tracks', 'dig')),           -- tracks only (false crawl) / dug, no eggs
  species    text not null default 'unk' check (species in ('cc', 'cm', 'unk')),
  lat        double precision not null check (lat between 34.45 and 35.75),
  lng        double precision not null check (lng between 32.2 and 34.65),
  notes      text not null default '',
  photo_path text,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (extract(year from seen_on) = season)
);
create index visits_season on public.visits (season);

-- ---------------------------------------------------------------------
-- 4. Gear, patrols, attendance
-- ---------------------------------------------------------------------
create table public.gear_stock (
  season     smallint not null references public.seasons(year),
  sector_id  smallint not null references public.sectors(id),
  cages      smallint not null default 0 check (cages >= 0),
  pyramids   smallint not null default 0 check (pyramids >= 0),
  updated_at timestamptz not null default now(),
  primary key (season, sector_id)
);

create table public.patrols (
  id         uuid primary key default gen_random_uuid(),
  season     smallint not null references public.seasons(year),
  sector_id  smallint not null references public.sectors(id),
  day        date not null,
  starts     time not null,                 -- estimated start
  ends       time not null,                 -- estimated finish
  notes      text not null default '',
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends > starts),
  check (extract(year from day) = season)
);
create index patrols_day on public.patrols (day);

create table public.patrol_team (
  patrol_id uuid not null references public.patrols(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  primary key (patrol_id, user_id)
);

create table public.attendance (
  id         uuid primary key default gen_random_uuid(),
  patrol_id  uuid not null references public.patrols(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  logged_at  timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  unique (patrol_id, user_id)
);

-- ---------------------------------------------------------------------
-- 5. Change history and sensors (sensors stay empty for now)
-- ---------------------------------------------------------------------
create table public.history (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  user_id    uuid references public.profiles(id) on delete set null,
  season     smallint,
  action     text not null,                 -- insert / update / delete
  table_name text not null,
  row_id     text,
  changes    jsonb
);
create index history_at on public.history (at desc);
create index history_row on public.history (table_name, row_id);

create table public.sensors (
  id         uuid primary key default gen_random_uuid(),
  device_id  text not null unique,
  nest_id    uuid references public.nests(id) on delete set null,
  label      text not null default '',
  created_at timestamptz not null default now()
);
create table public.sensor_readings (
  id          bigint generated always as identity primary key,
  sensor_id   uuid not null references public.sensors(id) on delete cascade,
  at          timestamptz not null,
  temperature numeric(5,2),
  humidity    numeric(5,2),
  raw         jsonb
);

-- =====================================================================
-- Automatic behaviour
-- =====================================================================

-- New sign-up → create their profile from the nickname they typed.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, nickname, email, name)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'nickname', ''), split_part(new.email, '@', 1)),
          new.email,
          coalesce(nullif(new.raw_user_meta_data->>'nickname', ''), ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep the stored email in step if someone changes it.
create function public.handle_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.handle_email_change();

-- Nest rules: expected hatching = found + N months; missing cage or pyramid → Not protected.
create function public.nest_rules() returns trigger
language plpgsql set search_path = '' as $$
declare v_months smallint;
begin
  if new.expected_hatch is null then
    select hatch_months into v_months from public.settings where id = 1;
    new.expected_hatch := (new.found_on + make_interval(months => coalesce(v_months, 2)))::date;
  end if;
  if new.status in ('notprot', 'prot', 'hatching') then
    if not (new.has_cage and new.has_pyramid) then
      new.status := 'notprot';
    elsif new.status = 'notprot' then
      new.status := 'prot';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger nests_rules before insert or update on public.nests
  for each row execute function public.nest_rules();

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger gear_touch before update on public.gear_stock
  for each row execute function public.touch_updated_at();

-- Change history: who changed what, and when.
create function public.log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb; v_new jsonb; v_changes jsonb; v_row jsonb; v_id text;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k)), '{}'::jsonb)
      into v_changes
      from jsonb_object_keys(v_new) as k
     where k not in ('updated_at') and (v_new -> k) is distinct from (v_old -> k);
    if v_changes = '{}'::jsonb then return new; end if;
  else
    v_changes := coalesce(v_new, v_old) - 'email';
  end if;
  v_row := coalesce(v_new, v_old);
  v_id := coalesce(v_row ->> 'id', v_row ->> 'nest_id',
                   concat_ws('/', v_row ->> 'season', v_row ->> 'sector_id', v_row ->> 'patrol_id', v_row ->> 'user_id', v_row ->> 'year'));
  insert into public.history (user_id, season, action, table_name, row_id, changes)
  values (auth.uid(),
          coalesce(nullif(v_row ->> 'season', ''), nullif(v_row ->> 'year', ''))::smallint,
          lower(tg_op), tg_table_name, v_id, v_changes);
  return coalesce(new, old);
end $$;

create trigger log_nests        after insert or update or delete on public.nests        for each row execute function public.log_change();
create trigger log_nest_results after insert or update or delete on public.nest_results for each row execute function public.log_change();
create trigger log_visits       after insert or update or delete on public.visits       for each row execute function public.log_change();
create trigger log_gear         after insert or update or delete on public.gear_stock   for each row execute function public.log_change();
create trigger log_patrols      after insert or update or delete on public.patrols      for each row execute function public.log_change();
create trigger log_patrol_team  after insert or update or delete on public.patrol_team  for each row execute function public.log_change();
create trigger log_attendance   after insert or update or delete on public.attendance   for each row execute function public.log_change();
create trigger log_regions      after insert or update or delete on public.regions      for each row execute function public.log_change();
create trigger log_sectors      after insert or update or delete on public.sectors      for each row execute function public.log_change();
create trigger log_seasons      after insert or update or delete on public.seasons      for each row execute function public.log_change();
create trigger log_settings     after update on public.settings                          for each row execute function public.log_change();
create trigger log_roles        after update of role, admin_request on public.profiles   for each row execute function public.log_change();

-- =====================================================================
-- Functions the app calls
-- =====================================================================

-- Sign-up form: is this nickname still free? (Callable before signing in.)
create function public.nickname_available(p_nick text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.profiles where lower(nickname) = lower(trim(p_nick)));
$$;

-- Nests for one season, for everyone signed in. Hatching results are NOT included.
create function public.get_nests(p_season integer)
returns table (id uuid, season smallint, sector_id smallint, number smallint, species text,
               found_on date, expected_hatch date, status text, has_cage boolean, has_pyramid boolean,
               lat double precision, lng double precision, notes text, photo_path text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select n.id, n.season, n.sector_id, n.number, n.species, n.found_on, n.expected_hatch, n.status,
         n.has_cage, n.has_pyramid,
         case when public.is_admin() or s.members_see_exact_positions then n.lat else round(n.lat::numeric, 3)::double precision end,
         case when public.is_admin() or s.members_see_exact_positions then n.lng else round(n.lng::numeric, 3)::double precision end,
         n.notes, n.photo_path, n.created_at
    from public.nests n cross join public.settings s
   where n.season = p_season and not n.archived and auth.uid() is not null
   order by n.sector_id, n.number;
$$;

-- Anyone signed in can attach a photo to a nest.
create function public.set_nest_photo(p_nest uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_path !~ '^nests/[A-Za-z0-9_./-]+$' then raise exception 'Photo path must start with nests/.'; end if;
  update public.nests set photo_path = p_path where id = p_nest and not archived;
  if not found then raise exception 'Nest not found.'; end if;
end $$;

-- A member asks to become an admin.
create function public.request_admin() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set admin_request = 'pending' where id = auth.uid() and role = 'member';
end $$;

-- Admins: change someone's role (approves a request, too). Keeps at least one admin.
create function public.set_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins can change roles.'; end if;
  if p_role not in ('member', 'admin') then raise exception 'Role must be member or admin.'; end if;
  if p_role = 'member' and (select count(*) from public.profiles where role = 'admin' and id <> p_user) = 0 then
    raise exception 'Keep at least one admin.';
  end if;
  update public.profiles set role = p_role, admin_request = null where id = p_user;
end $$;

-- Admins: decline an admin request.
create function public.decline_admin_request(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins can do this.'; end if;
  update public.profiles set admin_request = null where id = p_user;
end $$;

-- Admins: member list with emails (emails are hidden from members).
create function public.admin_members()
returns table (id uuid, nickname text, name text, email text, role text, admin_request text, since smallint, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins can see the member list.'; end if;
  return query select p.id, p.nickname, p.name, p.email, p.role, p.admin_request, p.since, p.created_at
                 from public.profiles p order by p.role, lower(p.nickname);
end $$;

-- Admins: copy cage and pyramid counts from one season to another.
create function public.copy_gear(p_from integer, p_to integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins can copy gear counts.'; end if;
  insert into public.gear_stock (season, sector_id, cages, pyramids)
  select p_to, sector_id, cages, pyramids from public.gear_stock where season = p_from
  on conflict (season, sector_id) do update set cages = excluded.cages, pyramids = excluded.pyramids;
end $$;

-- Used only by the nickname sign-in service on the server; never by the browser.
create function public.email_for_nickname(p_nick text) returns text
language sql stable security definer set search_path = '' as $$
  select email from public.profiles where lower(nickname) = lower(trim(p_nick));
$$;

-- =====================================================================
-- Security rules (row level security)
-- =====================================================================
alter table public.profiles        enable row level security;
alter table public.regions         enable row level security;
alter table public.sectors         enable row level security;
alter table public.seasons         enable row level security;
alter table public.settings        enable row level security;
alter table public.nests           enable row level security;
alter table public.nest_results    enable row level security;
alter table public.visits          enable row level security;
alter table public.gear_stock      enable row level security;
alter table public.patrols         enable row level security;
alter table public.patrol_team     enable row level security;
alter table public.attendance      enable row level security;
alter table public.history         enable row level security;
alter table public.sensors         enable row level security;
alter table public.sensor_readings enable row level security;

-- People: everyone signed in sees the team; you edit only your own profile.
create policy "team is visible to signed-in users" on public.profiles
  for select to authenticated using (true);
create policy "you can edit your own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Places, seasons, settings, gear, patrols, teams: everyone reads, admins change.
create policy "read regions"  on public.regions  for select to authenticated using (true);
create policy "admins change regions"  on public.regions  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "read sectors"  on public.sectors  for select to authenticated using (true);
create policy "admins change sectors"  on public.sectors  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "read seasons"  on public.seasons  for select to authenticated using (true);
create policy "admins change seasons"  on public.seasons  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "read settings" on public.settings for select to authenticated using (true);
create policy "admins change settings" on public.settings for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "read gear"     on public.gear_stock  for select to authenticated using (true);
create policy "admins change gear"     on public.gear_stock  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "read patrols"  on public.patrols     for select to authenticated using (true);
create policy "admins change patrols"  on public.patrols     for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "read teams"    on public.patrol_team for select to authenticated using (true);
create policy "admins change teams"    on public.patrol_team for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Nests: admins read and change the table directly; members read through get_nests()
-- and may add new nests that are Protected or Not protected.
create policy "admins read nests" on public.nests
  for select to authenticated using ((select public.is_admin()));
create policy "members and admins add nests" on public.nests
  for insert to authenticated with check (
    (select public.is_admin())
    or (created_by = (select auth.uid()) and status in ('prot', 'notprot') and not archived
        and (photo_path is null or photo_path ~ '^nests/')));
create policy "admins change nests" on public.nests
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete nests" on public.nests
  for delete to authenticated using ((select public.is_admin()));

-- Hatching results: admins only.
create policy "admins only: results" on public.nest_results
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Visits: anyone signed in can add one; only admins can see or change them.
create policy "admins read visits" on public.visits
  for select to authenticated using ((select public.is_admin()));
create policy "members and admins add visits" on public.visits
  for insert to authenticated with check ((select public.is_admin()) or created_by = (select auth.uid()));
create policy "admins change visits" on public.visits
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete visits" on public.visits
  for delete to authenticated using ((select public.is_admin()));

-- Attendance: everyone reads; you log your own duty (waits for approval)
-- once the patrol day has come; admins approve, decline or mark people present.
create policy "read attendance" on public.attendance
  for select to authenticated using (true);
create policy "log your own attendance" on public.attendance
  for insert to authenticated with check (
    (select public.is_admin())
    or (user_id = (select auth.uid()) and status = 'pending' and decided_by is null
        and exists (select 1 from public.patrols p where p.id = patrol_id and p.day <= current_date)));
create policy "admins change attendance" on public.attendance
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete attendance" on public.attendance
  for delete to authenticated using ((select public.is_admin()));

-- History and sensors: admins only.
create policy "admins read history" on public.history
  for select to authenticated using ((select public.is_admin()));
create policy "admins only: sensors" on public.sensors
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins only: sensor readings" on public.sensor_readings
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------------
-- Column-level protection
-- ---------------------------------------------------------------------
-- Signed-in users reach the tables (the rules above still decide which rows),
-- even if this project does not expose new tables automatically.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Signed-out visitors get no table access at all.
revoke all on all tables in schema public from anon;

-- Emails are hidden from members; roles change only through set_role().
revoke all on public.profiles from authenticated;
grant select (id, nickname, name, position, status, about, photo_path, role, admin_request, since, created_at)
  on public.profiles to authenticated;
grant update (name, position, status, about, photo_path) on public.profiles to authenticated;

-- History is written only by the database itself.
revoke insert, update, delete on public.history from authenticated;

-- Functions: signed-out visitors may only check nicknames.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.nickname_available(text) to anon, authenticated;
grant execute on function public.is_admin(), public.get_nests(integer), public.set_nest_photo(uuid, text),
                         public.request_admin(), public.set_role(uuid, text), public.decline_admin_request(uuid),
                         public.admin_members(), public.copy_gear(integer, integer)
  to authenticated;
revoke execute on function public.email_for_nickname(text) from authenticated;
grant execute on function public.email_for_nickname(text) to service_role;

-- =====================================================================
-- Photo store (private). Folders: nests/, visits/, profiles/<your id>/
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "photos: upload nest, visit and own profile photos" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'photos' and (
      (storage.foldername(name))[1] in ('nests', 'visits')
      or ((storage.foldername(name))[1] = 'profiles' and (storage.foldername(name))[2] = (select auth.uid())::text)));
create policy "photos: see nest and profile photos (admins see all)" on storage.objects
  for select to authenticated using (
    bucket_id = 'photos' and ((storage.foldername(name))[1] in ('nests', 'profiles') or (select public.is_admin())));
create policy "photos: replace your own profile photo" on storage.objects
  for update to authenticated using (
    bucket_id = 'photos' and (storage.foldername(name))[1] = 'profiles' and (storage.foldername(name))[2] = (select auth.uid())::text);
create policy "photos: delete your own profile photo, admins delete any" on storage.objects
  for delete to authenticated using (
    bucket_id = 'photos' and ((select public.is_admin())
      or ((storage.foldername(name))[1] = 'profiles' and (storage.foldername(name))[2] = (select auth.uid())::text)));

-- =====================================================================
-- Starting data
-- =====================================================================
insert into public.settings default values;
insert into public.seasons (year) values (2025), (2026), (2027);
insert into public.regions (name, code) values ('Famagusta', 'FAM'), ('İskele', 'ISK'), ('Bafra', 'BAF');
insert into public.sectors (region_id, name, code, usual_cages, usual_pyramids)
select r.id, s.name, s.code, s.cages, s.pyramids
  from (values ('FAM', 'Bedis Left',  'BDL',  5,  5),
               ('FAM', 'Bedis Right', 'BDR',  5,  5),
               ('FAM', 'Crystal',     'CRY',  4,  4),
               ('ISK', 'Zaradise',    'ZAR', 20, 20)) as s(region, name, code, cages, pyramids)
  join public.regions r on r.code = s.region;
-- Sector borders start empty. Admins draw them on the satellite map in the app.

commit;

-- =====================================================================
-- AFTER you sign up on the website for the first time, make yourself
-- the first admin by running this one line (put your nickname in):
--
--   update public.profiles set role = 'admin' where lower(nickname) = lower('YOUR_NICKNAME');
--
-- From then on, admins promote others inside the app.
-- =====================================================================
